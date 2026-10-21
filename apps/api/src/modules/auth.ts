import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { permissionsFor } from '@hydris/domain';
import { TTL, accessTokenTtl } from '../config';
import type { Ctx, DemoSessionJwt } from '../context';
import { authenticate, principal, resolvePrincipal } from '../context';
import { authSessions, authTokens, invitations, membershipSites, memberships, organizations, users } from '../db/schema';
import { withSystem } from '../db/tenant';
import type { Tx } from '../db/client';
import { badRequest, HttpError, unauthorized } from '../core/errors';
import { decrypt, dummyVerify, encrypt, hashPassword, newTotpSecret, passwordProblems, randomToken, sha256, verifyPassword, verifyTotp } from '../core/crypto';
import { audit, sendMail } from '../core/services';
import { createGuest, ensureGuest } from '../core/demo-guests';
import { DEMO_ORG_ID } from '../seed/showcase';

const COOKIE = 'hg_refresh';
/** Demo mode only: signed session fallback for instances that never saw the refresh-token row. */
const DEMO_COOKIE = 'hg_demo';
/** Grace window for concurrent refreshes (multiple tabs). Replays after it are treated as token theft. */
const REUSE_INTERVAL_MS = 30_000;
const emailSchema = z.string().trim().toLowerCase().pipe(z.email());

export async function authRoutes(app: FastifyInstance, ctx: Ctx, opts: { relaxedLimits?: boolean }) {
  const strict = (max: number) => ({ config: { rateLimit: { max: opts.relaxedLimits ? 10_000 : max, timeWindow: '1 minute' } } });

  async function startSession(tx: Tx, req: FastifyRequest, reply: FastifyReply, userId: string, orgId: string | null, familyId: string = randomUUID()) {
    const raw = randomToken(48);
    await tx.insert(authSessions).values({
      userId, orgId, familyId, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + TTL.refreshMs),
      userAgent: req.headers['user-agent']?.slice(0, 200), ip: req.ip,
    });
    reply.setCookie(COOKIE, raw, { httpOnly: true, sameSite: 'strict', secure: ctx.config.isProd, path: '/api/auth', maxAge: TTL.refreshMs / 1000 });
    if (ctx.config.demoMode) {
      const demo: DemoSessionJwt = { typ: 'demo_session', sub: userId, org: orgId, sid: familyId };
      reply.setCookie(DEMO_COOKIE, app.jwt.sign(demo, { expiresIn: Math.floor(TTL.refreshMs / 1000) }), { httpOnly: true, sameSite: 'strict', secure: ctx.config.isProd, path: '/api/auth', maxAge: TTL.refreshMs / 1000 });
    }
    const accessToken = app.jwt.sign({ typ: 'user', sub: userId, org: orgId, sid: familyId }, { expiresIn: accessTokenTtl(ctx.config) });
    return { accessToken, ...(await sessionView(tx, userId, orgId)) };
  }

  /** Everything the client needs to render: identity, memberships, active role and permissions. */
  async function sessionView(tx: Tx, userId: string, orgId: string | null) {
    const [u] = await tx.select().from(users).where(eq(users.id, userId));
    const ms = await tx
      .select({ orgId: memberships.orgId, orgName: organizations.name, role: memberships.role, isDemo: organizations.isDemo, allSites: memberships.allSites, membershipId: memberships.id })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.orgId))
      .where(and(eq(memberships.userId, userId), eq(memberships.status, 'active'), eq(organizations.status, 'active')));
    const current = ms.find((m) => m.orgId === orgId) ?? null;
    const siteIds = current && !current.allSites
      ? (await tx.select({ s: membershipSites.siteId }).from(membershipSites).where(eq(membershipSites.membershipId, current.membershipId))).map((r) => r.s)
      : [];
    return {
      user: { id: u!.id, name: u!.name, email: u!.email, isPlatformAdmin: u!.isPlatformAdmin, mfaEnabled: u!.mfaEnabled },
      memberships: ms.map(({ membershipId: _m, ...m }) => m),
      org: current ? { id: current.orgId, name: current.orgName, isDemo: current.isDemo } : null,
      role: current?.role ?? null,
      permissions: current ? permissionsFor(current.role) : [],
      siteScope: current ? (current.allSites ? 'all' : siteIds) : [],
    };
  }

  async function pickOrg(tx: Tx, userId: string, preferred?: string | null): Promise<string | null> {
    const ms = await tx.select({ orgId: memberships.orgId }).from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.orgId))
      .where(and(eq(memberships.userId, userId), eq(memberships.status, 'active'), eq(organizations.status, 'active')));
    if (preferred && ms.some((m) => m.orgId === preferred)) return preferred;
    return ms[0]?.orgId ?? null;
  }

  // ---------- login / MFA ----------
  // Demo mode only: one-click sign-in as a named guest (own account + personal work in the demo tenant).
  app.post('/auth/demo', strict(20), async (req, reply) => {
    if (!ctx.config.demoMode) throw new HttpError(404, 'not_found', 'Not found');
    const body = z.object({ name: z.string().trim().min(2, 'Enter your name').max(40) }).parse(req.body);
    return withSystem(ctx.db, async (tx) => {
      const g = await createGuest(tx, body.name);
      await tx.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, g.id));
      await audit(tx, { userId: g.id }, { orgId: DEMO_ORG_ID, action: 'auth.login', entityType: 'user', entityId: g.id, metadata: { demoGuest: true }, ip: req.ip });
      return startSession(tx, req, reply, g.id, DEMO_ORG_ID);
    });
  });

  app.post('/auth/login', strict(10), async (req, reply) => {
    const body = z.object({ email: emailSchema, password: z.string().min(1).max(200) }).parse(req.body);
    return withSystem(ctx.db, async (tx) => {
      const [u] = await tx.select().from(users).where(sql`lower(${users.email}) = ${body.email}`);
      const invalid = new HttpError(401, 'invalid_credentials', 'Email or password is incorrect');
      if (!u || !u.passwordHash) {
        await dummyVerify(body.password);
        throw invalid;
      }
      if (u.lockedUntil && u.lockedUntil > new Date()) throw new HttpError(423, 'account_locked', 'Too many failed attempts. Try again later.');
      const ok = await verifyPassword(body.password, u.passwordHash);
      if (!ok) {
        const fails = u.failedLogins + 1;
        await tx.update(users).set({ failedLogins: fails, lockedUntil: fails >= TTL.maxFailedLogins ? new Date(Date.now() + TTL.lockoutMs) : null }).where(eq(users.id, u.id));
        await audit(tx, { userId: u.id }, { orgId: null, action: 'auth.login_failed', entityType: 'user', entityId: u.id, ip: req.ip });
        throw invalid;
      }
      if (u.status !== 'active') throw invalid;
      await tx.update(users).set({ failedLogins: 0, lockedUntil: null }).where(eq(users.id, u.id));
      if (u.mfaEnabled) {
        return { mfaRequired: true, mfaToken: app.jwt.sign({ typ: 'mfa', sub: u.id }, { expiresIn: TTL.mfaChallenge }) };
      }
      await tx.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, u.id));
      const orgId = await pickOrg(tx, u.id, u.defaultOrgId);
      await audit(tx, { userId: u.id }, { orgId, action: 'auth.login', entityType: 'user', entityId: u.id, ip: req.ip });
      return startSession(tx, req, reply, u.id, orgId);
    });
  });

  app.post('/auth/mfa/verify', strict(10), async (req, reply) => {
    const body = z.object({ mfaToken: z.string(), code: z.string() }).parse(req.body);
    let tok: { typ: string; sub: string };
    try {
      tok = app.jwt.verify(body.mfaToken);
    } catch {
      throw unauthorized('mfa_expired', 'Sign-in step expired. Start again.');
    }
    if (tok.typ !== 'mfa') throw unauthorized();
    return withSystem(ctx.db, async (tx) => {
      const [u] = await tx.select().from(users).where(eq(users.id, tok.sub));
      if (!u?.mfaSecretEnc || !verifyTotp(decrypt(u.mfaSecretEnc, ctx.config.DATA_KEY), body.code)) {
        throw new HttpError(401, 'invalid_mfa_code', 'The code is not valid');
      }
      const orgId = await pickOrg(tx, u.id, u.defaultOrgId);
      await tx.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, u.id));
      await audit(tx, { userId: u.id }, { orgId, action: 'auth.login', entityType: 'user', entityId: u.id, metadata: { mfa: true }, ip: req.ip });
      return startSession(tx, req, reply, u.id, orgId);
    });
  });

  // ---------- refresh / logout ----------
  app.post('/auth/refresh', strict(60), async (req, reply) => {
    const raw = req.cookies[COOKIE] ?? '';
    const demoRaw = ctx.config.demoMode ? req.cookies[DEMO_COOKIE] : undefined;
    if (!raw && !demoRaw) throw unauthorized('no_session', 'No active session');
    const fail = (code: string) => {
      reply.clearCookie(COOKIE, { path: '/api/auth' });
      if (ctx.config.demoMode) reply.clearCookie(DEMO_COOKIE, { path: '/api/auth' });
      return unauthorized(code, 'Session ended. Please sign in again.');
    };
    // Demo mode: the refresh-token row may live on another instance. Re-create the session
    // family here from the signed demo cookie (same family id, so a local logout still applies).
    const demoFallback = async (tx: Tx) => {
      let d: DemoSessionJwt;
      try {
        d = app.jwt.verify<DemoSessionJwt>(demoRaw ?? '');
      } catch {
        throw fail('no_session');
      }
      if (d.typ !== 'demo_session') throw fail('no_session');
      const [known] = await tx.select({ id: authSessions.id }).from(authSessions).where(and(eq(authSessions.familyId, d.sid), isNull(authSessions.revokedAt), isNull(authSessions.rotatedAt))).limit(1);
      const [revoked] = known ? [] : await tx.select({ id: authSessions.id }).from(authSessions).where(and(eq(authSessions.familyId, d.sid), sql`${authSessions.revokedAt} is not null`)).limit(1);
      if (revoked) throw fail('session_revoked');
      await ensureGuest(tx, d.sub);
      const [u] = await tx.select({ status: users.status }).from(users).where(eq(users.id, d.sub));
      if (!u || u.status !== 'active') throw fail('no_session');
      return startSession(tx, req, reply, d.sub, await pickOrg(tx, d.sub, d.org), d.sid);
    };
    // Reuse detection commits in its own transaction so the revocation survives the rejection.
    const reused = await withSystem(ctx.db, async (tx) => {
      const [s] = await tx.select().from(authSessions).where(eq(authSessions.tokenHash, sha256(raw)));
      if (!s?.rotatedAt || s.revokedAt) return false;
      // Reuse interval: several tabs refreshing at once present the same token within moments.
      // Inside the interval we issue another successor in the same family instead of revoking.
      if (Date.now() - s.rotatedAt.getTime() < REUSE_INTERVAL_MS) return false;
      // A rotated refresh token was replayed later: treat as theft and end the whole session family.
      await tx.update(authSessions).set({ revokedAt: new Date() }).where(eq(authSessions.familyId, s.familyId));
      await audit(tx, { userId: s.userId }, { orgId: s.orgId, action: 'auth.refresh_reuse_detected', entityType: 'user', entityId: s.userId, ip: req.ip });
      return true;
    });
    if (reused) throw fail('session_revoked');
    return withSystem(ctx.db, async (tx) => {
      const [s] = await tx.select().from(authSessions).where(eq(authSessions.tokenHash, sha256(raw)));
      if (!s && demoRaw) return demoFallback(tx);
      if (!s || s.revokedAt) throw fail('no_session');
      if (s.rotatedAt && Date.now() - s.rotatedAt.getTime() >= REUSE_INTERVAL_MS) throw fail('no_session');
      if (s.expiresAt < new Date()) throw fail('session_expired');
      const [u] = await tx.select({ status: users.status }).from(users).where(eq(users.id, s.userId));
      if (!u || u.status !== 'active') throw fail('no_session');
      await tx.update(authSessions).set({ rotatedAt: s.rotatedAt ?? new Date(), lastUsedAt: new Date() }).where(eq(authSessions.id, s.id));
      const orgId = await pickOrg(tx, s.userId, s.orgId);
      return startSession(tx, req, reply, s.userId, orgId, s.familyId);
    });
  });

  app.post('/auth/logout', async (req, reply) => {
    const raw = req.cookies[COOKIE];
    if (raw) {
      await withSystem(ctx.db, async (tx) => {
        const [s] = await tx.select().from(authSessions).where(eq(authSessions.tokenHash, sha256(raw)));
        if (s) {
          await tx.update(authSessions).set({ revokedAt: new Date() }).where(eq(authSessions.familyId, s.familyId));
          await audit(tx, { userId: s.userId }, { orgId: s.orgId, action: 'auth.logout', entityType: 'user', entityId: s.userId, ip: req.ip });
        }
      });
    }
    reply.clearCookie(COOKIE, { path: '/api/auth' });
    if (ctx.config.demoMode) reply.clearCookie(DEMO_COOKIE, { path: '/api/auth' });
    return { ok: true };
  });

  /** Session view for platform admins without org membership as well as members. */
  app.get('/auth/me', async (req) => {
    const p = await resolvePrincipal(ctx, req);
    const uid = p?.userId ?? req.platformUserId;
    if (!uid) throw unauthorized();
    return withSystem(ctx.db, (tx) => sessionView(tx, uid, p?.orgId ?? null));
  });

  app.post('/auth/switch-org', { preHandler: authenticate(ctx) }, async (req, reply) => {
    const { orgId } = z.object({ orgId: z.uuid() }).parse(req.body);
    const p = principal(req);
    return withSystem(ctx.db, async (tx) => {
      if ((await pickOrg(tx, p.userId, orgId)) !== orgId) throw new HttpError(403, 'forbidden', 'Not a member of that organization');
      await tx.update(authSessions).set({ revokedAt: new Date() }).where(eq(authSessions.familyId, p.sessionId!));
      await tx.update(users).set({ defaultOrgId: orgId }).where(eq(users.id, p.userId));
      return startSession(tx, req, reply, p.userId, orgId);
    });
  });

  // ---------- password management ----------
  app.post('/auth/change-password', { preHandler: authenticate(ctx) }, async (req, reply) => {
    const body = z.object({ currentPassword: z.string().min(1), newPassword: z.string() }).parse(req.body);
    const problem = passwordProblems(body.newPassword);
    if (problem) throw badRequest('weak_password', problem);
    const p = principal(req);
    return withSystem(ctx.db, async (tx) => {
      const [u] = await tx.select().from(users).where(eq(users.id, p.userId));
      if (!u?.passwordHash || !(await verifyPassword(body.currentPassword, u.passwordHash))) throw badRequest('wrong_password', 'Current password is incorrect');
      await tx.update(users).set({ passwordHash: await hashPassword(body.newPassword), updatedAt: new Date() }).where(eq(users.id, u.id));
      await tx.update(authSessions).set({ revokedAt: new Date() }).where(and(eq(authSessions.userId, u.id), isNull(authSessions.revokedAt)));
      await audit(tx, p, { orgId: p.orgId, action: 'auth.password_changed', entityType: 'user', entityId: u.id, ip: req.ip });
      return startSession(tx, req, reply, u.id, p.orgId);
    });
  });

  app.post('/auth/password-reset/request', strict(5), async (req) => {
    const { email } = z.object({ email: emailSchema }).parse(req.body);
    await withSystem(ctx.db, async (tx) => {
      const [u] = await tx.select().from(users).where(sql`lower(${users.email}) = ${email}`);
      if (!u || u.status !== 'active') return;
      const raw = randomToken();
      await tx.insert(authTokens).values({ purpose: 'password_reset', userId: u.id, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + TTL.resetMs) });
      await sendMail(tx, u.email, 'Reset your Hydris password', `Use this link within 30 minutes to set a new password:\n${ctx.config.PUBLIC_APP_URL}/reset-password?token=${raw}\n\nIf you did not request this, ignore this email.`);
      await audit(tx, { userId: u.id }, { orgId: null, action: 'auth.password_reset_requested', entityType: 'user', entityId: u.id, ip: req.ip });
    });
    return { ok: true }; // identical response whether or not the account exists
  });

  app.post('/auth/password-reset/complete', strict(10), async (req) => {
    const body = z.object({ token: z.string().min(10), password: z.string() }).parse(req.body);
    const problem = passwordProblems(body.password);
    if (problem) throw badRequest('weak_password', problem);
    await withSystem(ctx.db, async (tx) => {
      const [t] = await tx.select().from(authTokens).where(and(eq(authTokens.tokenHash, sha256(body.token)), eq(authTokens.purpose, 'password_reset'), isNull(authTokens.usedAt), gt(authTokens.expiresAt, new Date())));
      if (!t) throw badRequest('invalid_token', 'This link is invalid or has expired');
      await tx.update(authTokens).set({ usedAt: new Date() }).where(eq(authTokens.id, t.id));
      await tx.update(users).set({ passwordHash: await hashPassword(body.password), failedLogins: 0, lockedUntil: null, emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, now())` }).where(eq(users.id, t.userId));
      await tx.update(authSessions).set({ revokedAt: new Date() }).where(and(eq(authSessions.userId, t.userId), isNull(authSessions.revokedAt)));
      await audit(tx, { userId: t.userId }, { orgId: null, action: 'auth.password_reset', entityType: 'user', entityId: t.userId, ip: req.ip });
    });
    return { ok: true };
  });

  // ---------- invitations (accepting = email verification) ----------
  async function findInvite(tx: Tx, token: string) {
    const [inv] = await tx.select({ inv: invitations, orgName: organizations.name }).from(invitations)
      .innerJoin(organizations, eq(organizations.id, invitations.orgId))
      .where(and(eq(invitations.tokenHash, sha256(token)), isNull(invitations.acceptedAt), isNull(invitations.revokedAt), gt(invitations.expiresAt, new Date())));
    if (!inv) throw badRequest('invalid_invitation', 'This invitation is invalid, used or expired');
    return inv;
  }

  app.get('/auth/invitations/:token', strict(30), async (req) => {
    const { token } = req.params as { token: string };
    return withSystem(ctx.db, async (tx) => {
      const { inv, orgName } = await findInvite(tx, token);
      const [existing] = await tx.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${inv.email.toLowerCase()}`);
      return { email: inv.email, name: inv.name, role: inv.role, orgName, existingAccount: !!existing };
    });
  });

  app.post('/auth/invitations/accept', strict(10), async (req, reply) => {
    const body = z.object({ token: z.string(), name: z.string().trim().min(2).max(120).optional(), password: z.string() }).parse(req.body);
    return withSystem(ctx.db, async (tx) => {
      const { inv } = await findInvite(tx, body.token);
      let [u] = await tx.select().from(users).where(sql`lower(${users.email}) = ${inv.email.toLowerCase()}`);
      if (u) {
        if (!u.passwordHash || !(await verifyPassword(body.password, u.passwordHash))) throw badRequest('wrong_password', 'Enter the password of your existing Hydris account');
      } else {
        const problem = passwordProblems(body.password);
        if (problem) throw badRequest('weak_password', problem);
        [u] = await tx.insert(users).values({ email: inv.email, name: body.name ?? inv.name ?? inv.email, passwordHash: await hashPassword(body.password), emailVerifiedAt: new Date() }).returning();
      }
      const [m] = await tx.insert(memberships).values({ orgId: inv.orgId, userId: u!.id, role: inv.role, allSites: inv.allSites, status: 'active' })
        .onConflictDoUpdate({ target: [memberships.orgId, memberships.userId], set: { role: inv.role, allSites: inv.allSites, status: 'active', deactivatedAt: null, updatedAt: new Date() } })
        .returning();
      await tx.delete(membershipSites).where(eq(membershipSites.membershipId, m!.id));
      if (!inv.allSites && inv.siteIds.length) await tx.insert(membershipSites).values(inv.siteIds.map((siteId) => ({ membershipId: m!.id, siteId, orgId: inv.orgId })));
      await tx.update(invitations).set({ acceptedAt: new Date() }).where(eq(invitations.id, inv.id));
      await tx.update(users).set({ defaultOrgId: inv.orgId }).where(eq(users.id, u!.id));
      await audit(tx, { userId: u!.id }, { orgId: inv.orgId, action: 'member.invitation_accepted', entityType: 'membership', entityId: m!.id, ip: req.ip });
      return startSession(tx, req, reply, u!.id, inv.orgId);
    });
  });

  // ---------- MFA enrolment ----------
  app.post('/auth/mfa/setup', { preHandler: authenticate(ctx) }, async (req) => {
    const p = principal(req);
    return withSystem(ctx.db, async (tx) => {
      const [u] = await tx.select().from(users).where(eq(users.id, p.userId));
      if (u!.mfaEnabled) throw badRequest('mfa_already_enabled');
      const secret = newTotpSecret();
      await tx.update(users).set({ mfaSecretEnc: encrypt(secret, ctx.config.DATA_KEY) }).where(eq(users.id, p.userId));
      return { secret, otpauthUrl: `otpauth://totp/Hydris:${encodeURIComponent(u!.email)}?secret=${secret}&issuer=Hydris&period=30&digits=6` };
    });
  });

  app.post('/auth/mfa/enable', { preHandler: authenticate(ctx) }, async (req) => {
    const { code } = z.object({ code: z.string() }).parse(req.body);
    const p = principal(req);
    return withSystem(ctx.db, async (tx) => {
      const [u] = await tx.select().from(users).where(eq(users.id, p.userId));
      if (!u?.mfaSecretEnc || !verifyTotp(decrypt(u.mfaSecretEnc, ctx.config.DATA_KEY), code)) throw badRequest('invalid_mfa_code', 'The code is not valid');
      await tx.update(users).set({ mfaEnabled: true }).where(eq(users.id, p.userId));
      await audit(tx, p, { orgId: p.orgId, action: 'auth.mfa_enabled', entityType: 'user', entityId: p.userId });
      return { ok: true };
    });
  });

  app.post('/auth/mfa/disable', { preHandler: authenticate(ctx) }, async (req) => {
    const { password, code } = z.object({ password: z.string(), code: z.string() }).parse(req.body);
    const p = principal(req);
    return withSystem(ctx.db, async (tx) => {
      const [u] = await tx.select().from(users).where(eq(users.id, p.userId));
      if (!u?.passwordHash || !(await verifyPassword(password, u.passwordHash))) throw badRequest('wrong_password', 'Password is incorrect');
      if (!u.mfaSecretEnc || !verifyTotp(decrypt(u.mfaSecretEnc, ctx.config.DATA_KEY), code)) throw badRequest('invalid_mfa_code', 'The code is not valid');
      await tx.update(users).set({ mfaEnabled: false, mfaSecretEnc: null }).where(eq(users.id, p.userId));
      await audit(tx, p, { orgId: p.orgId, action: 'auth.mfa_disabled', entityType: 'user', entityId: p.userId });
      return { ok: true };
    });
  });

  // ---------- active sessions ----------
  app.get('/auth/sessions', { preHandler: authenticate(ctx) }, async (req) => {
    const p = principal(req);
    return withSystem(ctx.db, async (tx) => {
      const rows = await tx.select().from(authSessions)
        .where(and(eq(authSessions.userId, p.userId), isNull(authSessions.revokedAt), isNull(authSessions.rotatedAt), gt(authSessions.expiresAt, new Date())))
        .orderBy(desc(authSessions.createdAt));
      return { sessions: rows.map((s) => ({ id: s.familyId, userAgent: s.userAgent, ip: s.ip, createdAt: s.createdAt, current: s.familyId === p.sessionId })) };
    });
  });

  app.delete('/auth/sessions/:id', { preHandler: authenticate(ctx) }, async (req) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const p = principal(req);
    await withSystem(ctx.db, async (tx) => {
      await tx.update(authSessions).set({ revokedAt: new Date() }).where(and(eq(authSessions.familyId, id), eq(authSessions.userId, p.userId)));
      await audit(tx, p, { orgId: p.orgId, action: 'auth.session_revoked', entityType: 'session', entityId: id });
    });
    return { ok: true };
  });
}
