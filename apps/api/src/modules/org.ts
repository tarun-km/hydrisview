import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, desc, eq, gte, ilike, isNull, lte, or, sql, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { assignableRoles, ROLES, type Role } from '@hydris/domain';
import type { Ctx } from '../context';
import { authenticate, resolvePrincipal, tenant } from '../context';
import {
  auditEvents, authSessions, deviceAssignments, devices, inspections, invitations, maintenanceTasks, membershipSites, memberships,
  notifications, organizations, sites, users,
} from '../db/schema';
import { withSystem } from '../db/tenant';
import { badRequest, conflict, forbidden, HttpError, notFound, unauthorized } from '../core/errors';
import { revokeMemberAccess } from '../core/identity';
import { requirePerm } from '../core/principal';
import { randomToken, sha256 } from '../core/crypto';
import { audit, sendTemplate } from '../core/services';
import { accountEndedMail, inviteMail } from '../core/mail-templates';
import { TTL } from '../config';

const emailSchema = z.string().trim().toLowerCase().pipe(z.email());

export async function orgRoutes(app: FastifyInstance, ctx: Ctx) {
  const auth = { preHandler: authenticate(ctx) };

  // ================= Platform administration (cross-tenant, platform admins only) =================
  async function platformOnly(req: FastifyRequest) {
    await resolvePrincipal(ctx, req);
    if (!req.platformUserId) throw unauthorized();
  }

  app.get('/platform/organizations', { preHandler: platformOnly }, async () =>
    withSystem(ctx.db, async (tx) => ({
      organizations: await tx
        .select({
          id: organizations.id, name: organizations.name, slug: organizations.slug, isDemo: organizations.isDemo, status: organizations.status,
          region: organizations.region, createdAt: organizations.createdAt,
          members: sql<number>`(select count(*)::int from memberships m where m.org_id = ${organizations.id} and m.status = 'active')`,
          sites: sql<number>`(select count(*)::int from sites s where s.org_id = ${organizations.id} and s.archived_at is null)`,
        })
        .from(organizations)
        .orderBy(desc(organizations.createdAt)),
    })),
  );

  app.post('/platform/organizations', { preHandler: platformOnly }, async (req, reply) => {
    const body = z.object({
      name: z.string().trim().min(2).max(120),
      slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,40}$/),
      region: z.string().trim().max(80).optional(),
      timezone: z.string().max(60).default('UTC'),
      isDemo: z.boolean().default(false),
      admin: z.object({ name: z.string().trim().min(2).max(120), email: emailSchema }),
    }).parse(req.body);
    const out = await withSystem(ctx.db, async (tx) => {
      const [dupe] = await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, body.slug));
      if (dupe) throw conflict('slug_taken', 'That organization slug is already in use');
      const [org] = await tx.insert(organizations).values({ name: body.name, slug: body.slug, region: body.region, timezone: body.timezone, isDemo: body.isDemo }).returning();
      const { link, delivery } = await createInvitation(tx, org!.id, req.platformUserId!, { email: body.admin.email, name: body.admin.name, role: 'admin', allSites: true, siteIds: [] });
      await audit(tx, { userId: req.platformUserId }, { orgId: org!.id, action: 'organization.created', entityType: 'organization', entityId: org!.id, summary: body.name });
      return { organization: org, adminInvitationLink: link, delivery };
    });
    return reply.code(201).send(out);
  });

  app.post('/platform/organizations/:id/status', { preHandler: platformOnly }, async (req) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const { status } = z.object({ status: z.enum(['active', 'suspended']) }).parse(req.body);
    return withSystem(ctx.db, async (tx) => {
      const [o] = await tx.update(organizations).set({ status, updatedAt: new Date() }).where(eq(organizations.id, id)).returning();
      if (!o) throw notFound('Organization');
      await audit(tx, { userId: req.platformUserId }, { orgId: id, action: `organization.${status === 'active' ? 'reactivated' : 'suspended'}`, entityType: 'organization', entityId: id });
      return { organization: o };
    });
  });

  // ================= Organization settings =================
  app.get('/org', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'console.access');
    const [o] = await tx.select().from(organizations).where(eq(organizations.id, p.orgId));
    return { organization: o };
  }));

  /** Console setup wizard (shown to an administrator after self sign-up). */
  app.get('/org/setup', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'console.access');
    const [o] = await tx.select().from(organizations).where(eq(organizations.id, p.orgId));
    const [{ n: siteCount }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(sites).where(isNull(sites.archivedAt))) as [{ n: number }];
    const [{ n: operatorCount }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(memberships).where(and(eq(memberships.role, 'operator'), inArray(memberships.status, ['active', 'invited'])))) as [{ n: number }];
    const [{ n: inviteCount }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(invitations).where(and(isNull(invitations.acceptedAt), isNull(invitations.revokedAt)))) as [{ n: number }];
    return {
      organization: { id: o!.id, name: o!.name, region: o!.region, timezone: o!.timezone, setupCompletedAt: o!.setupCompletedAt },
      steps: { organization: !!o!.region, site: siteCount > 0, operators: operatorCount + inviteCount > 0 },
      counts: { sites: siteCount, operators: operatorCount, pendingInvitations: inviteCount },
    };
  }));

  app.post('/org/setup', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'org.manage');
    const body = z.object({
      name: z.string().trim().min(2).max(120).optional(), region: z.string().trim().max(80).nullable().optional(), timezone: z.string().max(60).optional(),
      complete: z.boolean().default(false),
    }).parse(req.body ?? {});
    const [o] = await tx.update(organizations).set({
      name: body.name, region: body.region, timezone: body.timezone, updatedAt: new Date(), ...(body.complete ? { setupCompletedAt: new Date() } : {}),
    }).where(eq(organizations.id, p.orgId)).returning();
    await audit(tx, p, { orgId: p.orgId, action: body.complete ? 'organization.setup_completed' : 'organization.updated', entityType: 'organization', entityId: p.orgId });
    return { organization: o };
  }));

  app.patch('/org', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'org.manage');
    const body = z.object({ name: z.string().trim().min(2).max(120).optional(), region: z.string().trim().max(80).nullable().optional(), timezone: z.string().max(60).optional() }).parse(req.body);
    const [o] = await tx.update(organizations).set({ ...body, updatedAt: new Date() }).where(eq(organizations.id, p.orgId)).returning();
    await audit(tx, p, { orgId: p.orgId, action: 'organization.updated', entityType: 'organization', entityId: p.orgId, metadata: body });
    return { organization: o };
  }));

  // ================= Members & invitations =================
  interface InviteInput { email: string; name?: string | undefined; role: Role; allSites: boolean; siteIds: string[]; employeeId?: string | null | undefined; phone?: string | null | undefined; shiftLabel?: string | null | undefined }

  /**
   * Record the invitation (sites, operator profile, expiry) and deliver it: through Supabase's invite
   * email when Supabase is configured with a service-role key (the link opens /auth/callback?flow=invite
   * to set a password), otherwise through the mail outbox with a Hydris /invite/<token> link.
   */
  async function createInvitation(tx: Parameters<Parameters<typeof withSystem>[1]>[0], orgId: string, invitedBy: string, i: InviteInput): Promise<{ link: string | null; delivery: 'supabase' | 'outbox' }> {
    const raw = randomToken();
    await tx.update(invitations).set({ revokedAt: new Date(), status: 'revoked' }).where(and(eq(invitations.orgId, orgId), sql`lower(${invitations.email}) = ${i.email}`, isNull(invitations.acceptedAt), isNull(invitations.revokedAt)));
    await tx.insert(invitations).values({
      orgId, email: i.email, name: i.name, role: i.role, allSites: i.allSites, siteIds: i.siteIds, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + TTL.inviteMs), invitedBy,
      employeeId: i.employeeId ?? null, phone: i.phone ?? null, shiftLabel: i.shiftLabel ?? null,
    });
    const link = `${ctx.config.PUBLIC_APP_URL}/invite/${raw}`;
    const [org] = await tx.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, orgId));
    if (ctx.supabase?.canAdmin) {
      try {
        await ctx.supabase.inviteUser(i.email, { name: i.name, org_name: org?.name, account_type: i.role }, `${ctx.config.PUBLIC_APP_URL}/auth/callback?flow=invite`);
        return { link: null, delivery: 'supabase' };
      } catch (e) {
        // Already registered at Supabase (e.g. a member of another organization): fall back to the
        // Hydris invitation link, which they accept by signing in.
        if (!(e instanceof HttpError) || e.code !== 'email_taken') throw e;
      }
    }
    await sendTemplate(tx, i.email, inviteMail({ url: link, orgName: org?.name ?? 'your organization', accountType: i.role, name: i.name }));
    return { link, delivery: 'outbox' };
  }

  async function validateInvite(tx: Parameters<Parameters<typeof withSystem>[1]>[0], p: { role: Role; allSites: boolean; siteIds: string[] }, body: InviteInput) {
    if (!assignableRoles(p.role).includes(body.role)) throw forbidden('You cannot grant that account type');
    if (!p.allSites && (body.allSites || body.siteIds.some((s) => !p.siteIds.includes(s)))) throw forbidden('You can only grant access to your own sites');
    if (!body.allSites && !body.siteIds.length) throw badRequest('sites_required', 'Select at least one site');
    if (body.siteIds.length) {
      const found = await tx.select({ id: sites.id }).from(sites).where(inArray(sites.id, body.siteIds));
      if (found.length !== body.siteIds.length) throw badRequest('invalid_sites');
    }
    const [existing] = await tx.select({ id: memberships.id, status: memberships.status }).from(memberships).innerJoin(users, eq(users.id, memberships.userId))
      .where(sql`lower(${users.email}) = ${body.email}`);
    if (existing?.status === 'active') throw conflict('already_member', 'This person is already an active member');
    if (existing?.status === 'suspended') throw conflict('member_suspended', 'This person is suspended. Reactivate them instead of inviting again.');
  }

  app.get('/members', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'member.read');
    const rows = await tx
      .select({
        membershipId: memberships.id, userId: users.id, name: users.name, email: users.email, role: memberships.role, accountType: memberships.role, status: memberships.status,
        allSites: memberships.allSites, title: memberships.title, lastLoginAt: users.lastLoginAt, mfaEnabled: users.mfaEnabled, createdAt: memberships.createdAt,
        employeeId: memberships.employeeId, phone: memberships.phone, shiftLabel: memberships.shiftLabel, suspendedAt: memberships.suspendedAt, removedAt: memberships.removedAt,
        siteIds: sql<string[]>`coalesce((select json_agg(ms.site_id) from membership_sites ms where ms.membership_id = ${memberships.id}), '[]'::json)`,
        devices: sql<number>`(select count(*)::int from device_assignments da join devices d on d.id = da.device_id where da.user_id = ${users.id} and da.unassigned_at is null and d.status = 'active')`,
        openInspections: sql<number>`(select count(*)::int from inspections i where i.assigned_to = ${users.id} and i.status in ('scheduled','in_progress','paused','rejected'))`,
        openTasks: sql<number>`(select count(*)::int from maintenance_tasks t where t.assigned_to = ${users.id} and t.status in ('open','assigned','in_progress','on_hold'))`,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.orgId, p.orgId))
      .orderBy(users.name);
    const pending = p.role === 'admin'
      ? (await tx.select({
          id: invitations.id, email: invitations.email, name: invitations.name, role: invitations.role, expiresAt: invitations.expiresAt, createdAt: invitations.createdAt,
          allSites: invitations.allSites, siteIds: invitations.siteIds, employeeId: invitations.employeeId, phone: invitations.phone, shiftLabel: invitations.shiftLabel, invitedBy: invitations.invitedBy,
        }).from(invitations).where(and(isNull(invitations.acceptedAt), isNull(invitations.revokedAt))).orderBy(desc(invitations.createdAt)))
          .map((i) => ({ ...i, accountType: i.role, status: i.expiresAt < new Date() ? 'expired' : 'pending' }))
      : [];
    return { members: rows, invitations: pending, assignableRoles: assignableRoles(p.role) };
  }));

  app.get('/members/:userId', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'member.read');
    const { userId } = z.object({ userId: z.uuid() }).parse(req.params);
    const [m] = await tx.select({ membership: memberships, name: users.name, email: users.email, lastLoginAt: users.lastLoginAt, mfaEnabled: users.mfaEnabled })
      .from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(eq(memberships.userId, userId));
    if (!m) throw notFound('Member');
    const siteIds = (await tx.select({ s: membershipSites.siteId }).from(membershipSites).where(eq(membershipSites.membershipId, m.membership.id))).map((r) => r.s);
    const assigned = await tx.select({ id: devices.id, name: devices.name, status: devices.status, lastSeenAt: devices.lastSeenAt }).from(deviceAssignments)
      .innerJoin(devices, eq(devices.id, deviceAssignments.deviceId)).where(and(eq(deviceAssignments.userId, userId), isNull(deviceAssignments.unassignedAt)));
    const recentInspections = await tx.select({ id: inspections.id, title: inspections.title, status: inspections.status, dueAt: inspections.dueAt, submittedAt: inspections.submittedAt })
      .from(inspections).where(eq(inspections.assignedTo, userId)).orderBy(desc(inspections.updatedAt)).limit(10);
    const tasks = await tx.select({ id: maintenanceTasks.id, title: maintenanceTasks.title, status: maintenanceTasks.status, priority: maintenanceTasks.priority })
      .from(maintenanceTasks).where(eq(maintenanceTasks.assignedTo, userId)).orderBy(desc(maintenanceTasks.updatedAt)).limit(10);
    const sessions = p.role === 'admin'
      ? await tx.select({ id: authSessions.familyId, createdAt: authSessions.createdAt, userAgent: authSessions.userAgent })
          .from(authSessions).where(and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt), isNull(authSessions.rotatedAt)))
      : [];
    return { member: { ...m, siteIds }, devices: assigned, inspections: recentInspections, tasks, sessions };
  }));

  const inviteSchema = z.object({
    email: emailSchema, name: z.string().trim().max(120).optional(),
    /** Account type. Operators are invite-only; administrators may also invite further administrators. */
    role: z.enum(ROLES).default('operator'),
    allSites: z.boolean().default(true), siteIds: z.array(z.uuid()).max(200).default([]),
    employeeId: z.string().trim().max(40).optional(), phone: z.string().trim().max(30).optional(), shiftLabel: z.string().trim().max(60).optional(),
  });

  app.post('/invitations', auth, async (req, reply) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'member.manage');
    const body = inviteSchema.parse(req.body);
    await validateInvite(tx, p, body);
    const { link, delivery } = await createInvitation(tx, p.orgId, p.userId, body);
    await audit(tx, p, { orgId: p.orgId, action: 'member.invited', entityType: 'invitation', summary: `${body.email} as ${body.role}`, metadata: { role: body.role, delivery } });
    // In outbox mode the link is also returned so administrators can share it when mail delivery is not configured.
    return reply.code(201).send({ invitationLink: link, delivery });
  }));

  /**
   * Bulk operator invitations from CSV. Header row required; columns (case-insensitive):
   * email (required), name, employee_id, phone, shift, sites (site codes or ids separated by ';' or '|'; empty = all sites).
   * Each row is validated and delivered independently; the response reports every row.
   */
  app.post('/invitations/bulk', auth, async (req, reply) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'member.manage');
    const { csv } = z.object({ csv: z.string().min(1).max(200_000) }).parse(req.body);
    const rows = parseCsv(csv);
    if (rows.length < 2) throw badRequest('csv_empty', 'The CSV needs a header row and at least one operator');
    const header = rows[0]!.map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_'));
    const col = (names: string[]) => header.findIndex((h) => names.includes(h));
    const ix = { email: col(['email', 'e_mail', 'work_email']), name: col(['name', 'full_name']), employeeId: col(['employee_id', 'employee', 'emp_id']), phone: col(['phone', 'mobile']), shift: col(['shift', 'shift_label']), sites: col(['sites', 'site', 'site_codes']) };
    if (ix.email < 0) throw badRequest('csv_missing_email', 'The CSV must have an "email" column');
    if (rows.length - 1 > 500) throw badRequest('csv_too_large', 'Invite at most 500 operators per file');
    const orgSites = await tx.select({ id: sites.id, code: sites.code }).from(sites).where(isNull(sites.archivedAt));
    const results: { row: number; email: string; ok: boolean; error?: string; delivery?: string }[] = [];
    const seen = new Set<string>();
    for (let r = 1; r < rows.length; r++) {
      const cells = rows[r]!;
      const get = (i: number) => (i >= 0 ? (cells[i] ?? '').trim() : '');
      const email = get(ix.email).toLowerCase();
      if (!email && cells.every((c) => !c.trim())) continue;
      try {
        if (seen.has(email)) throw badRequest('duplicate_row', 'Duplicate email in this file');
        seen.add(email);
        const siteRefs = get(ix.sites).split(/[;|]/).map((x) => x.trim()).filter(Boolean);
        const siteIds = siteRefs.map((ref) => {
          const s = orgSites.find((o) => o.id === ref || o.code.toLowerCase() === ref.toLowerCase());
          if (!s) throw badRequest('invalid_sites', `Unknown site "${ref}"`);
          return s.id;
        });
        const body = inviteSchema.parse({
          email, role: 'operator', allSites: siteIds.length === 0, siteIds,
          name: get(ix.name) || undefined, employeeId: get(ix.employeeId) || undefined, phone: get(ix.phone) || undefined, shiftLabel: get(ix.shift) || undefined,
        });
        await validateInvite(tx, p, body);
        const { delivery } = await createInvitation(tx, p.orgId, p.userId, body);
        results.push({ row: r + 1, email, ok: true, delivery });
      } catch (e) {
        const msg = e instanceof HttpError ? e.message : e instanceof z.ZodError ? (e.issues[0]?.message ?? 'Invalid row') : 'Could not invite';
        results.push({ row: r + 1, email, ok: false, error: msg });
      }
    }
    const invited = results.filter((x) => x.ok).length;
    await audit(tx, p, { orgId: p.orgId, action: 'member.bulk_invited', entityType: 'invitation', summary: `${invited} operator invitation(s) from CSV`, metadata: { invited, failed: results.length - invited } });
    return reply.code(201).send({ invited, failed: results.length - invited, results });
  }));

  app.delete('/invitations/:id', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'member.manage');
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const [inv] = await tx.update(invitations).set({ revokedAt: new Date(), status: 'revoked' }).where(and(eq(invitations.id, id), isNull(invitations.acceptedAt))).returning();
    if (!inv) throw notFound('Invitation');
    await audit(tx, p, { orgId: p.orgId, action: 'member.invitation_revoked', entityType: 'invitation', entityId: id, summary: inv.email });
    return { ok: true };
  }));

  /** Load a member of the caller's org that the caller may manage (never themselves). */
  async function manageableMember(tx: Parameters<Parameters<typeof withSystem>[1]>[0], p: { userId: string; role: Role }, userId: string) {
    if (userId === p.userId) throw forbidden('You cannot change your own account status');
    const [m] = await tx.select().from(memberships).where(eq(memberships.userId, userId));
    if (!m) throw notFound('Member');
    if (!assignableRoles(p.role).includes(m.role)) throw forbidden('You cannot manage members of that account type');
    return m;
  }

  /**
   * Provider-side ban as well (best effort, Supabase only). Operators belong to a single
   * organization, so their Supabase user is banned / unbanned with the membership; administrators
   * may belong to several organizations and are only blocked here, at the Hydris membership.
   */
  async function syncProviderBan(tx: Parameters<Parameters<typeof withSystem>[1]>[0], userId: string, role: Role, banned: boolean) {
    if (!ctx.supabase?.canAdmin || role !== 'operator') return;
    const [u] = await tx.select({ sid: users.supabaseUserId }).from(users).where(eq(users.id, userId));
    if (!u?.sid) return;
    await ctx.supabase.adminSetBanned(u.sid, banned).catch((e) => console.warn('[hydris] supabase ban sync failed', (e as Error).message));
  }

  async function setStatus(tx: Parameters<Parameters<typeof withSystem>[1]>[0], p: Parameters<typeof audit>[1] & { orgId: string; userId: string; role: Role }, userId: string, to: 'active' | 'suspended' | 'removed', reason?: string) {
    const m = await manageableMember(tx, p, userId);
    if (to === 'active' && m.status === 'removed') throw conflict('member_removed', 'Removed members must be invited again');
    if (to === 'suspended' && m.status === 'removed') throw conflict('member_removed', 'This member was removed');
    const now = new Date();
    await tx.update(memberships).set({
      status: to, statusChangedBy: p.userId, updatedAt: now,
      ...(to === 'suspended' ? { suspendedAt: now, deactivatedAt: now } : to === 'removed' ? { removedAt: now } : { suspendedAt: null, deactivatedAt: null }),
    }).where(eq(memberships.id, m.id));
    let revoked = { devices: 0 };
    if (to !== 'active') {
      revoked = await revokeMemberAccess(tx, ctx, p.orgId, userId, to);
      const [who] = await tx.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, userId));
      const [org] = await tx.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, p.orgId));
      if (who) await sendTemplate(tx, who.email, accountEndedMail({ orgName: org?.name ?? 'your organization', status: to, name: who.name }));
      if (to === 'removed') {
        const [u] = await tx.select({ email: users.email }).from(users).where(eq(users.id, userId));
        if (u) await tx.update(invitations).set({ revokedAt: now, status: 'revoked' }).where(and(sql`lower(${invitations.email}) = ${u.email.toLowerCase()}`, isNull(invitations.acceptedAt), isNull(invitations.revokedAt)));
      }
    }
    await syncProviderBan(tx, userId, m.role, to !== 'active');
    const action = to === 'active' ? 'member.reactivated' : to === 'suspended' ? 'member.suspended' : 'member.removed';
    await audit(tx, p, { orgId: p.orgId, action, entityType: 'membership', entityId: m.id, summary: reason, metadata: { userId, from: m.status, to, devicesRevoked: revoked.devices } });
    return { ok: true, status: to, devicesRevoked: revoked.devices };
  }

  const reasonSchema = z.object({ reason: z.string().trim().max(200).optional() });
  app.post('/members/:userId/suspend', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'member.manage');
    const { userId } = z.object({ userId: z.uuid() }).parse(req.params);
    return setStatus(tx, p, userId, 'suspended', reasonSchema.parse(req.body ?? {}).reason);
  }));
  app.post('/members/:userId/reactivate', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'member.manage');
    const { userId } = z.object({ userId: z.uuid() }).parse(req.params);
    return setStatus(tx, p, userId, 'active', reasonSchema.parse(req.body ?? {}).reason);
  }));
  app.post('/members/:userId/remove', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'member.manage');
    const { userId } = z.object({ userId: z.uuid() }).parse(req.params);
    return setStatus(tx, p, userId, 'removed', reasonSchema.parse(req.body ?? {}).reason);
  }));

  app.patch('/members/:userId', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'member.manage');
    const { userId } = z.object({ userId: z.uuid() }).parse(req.params);
    const body = z.object({
      role: z.enum(ROLES).optional(), title: z.string().trim().max(80).nullable().optional(),
      allSites: z.boolean().optional(), siteIds: z.array(z.uuid()).optional(),
      /** 'deactivated' is accepted as a legacy alias of 'suspended'. */
      status: z.enum(['active', 'suspended', 'deactivated']).optional(),
      employeeId: z.string().trim().max(40).nullable().optional(), phone: z.string().trim().max(30).nullable().optional(), shiftLabel: z.string().trim().max(60).nullable().optional(),
    }).parse(req.body);
    if (userId === p.userId && (body.role || body.status)) throw forbidden('You cannot change your own role or status');
    const [m] = await tx.select().from(memberships).where(eq(memberships.userId, userId));
    if (!m) throw notFound('Member');
    const allowed = assignableRoles(p.role);
    if (!allowed.includes(m.role) || (body.role && !allowed.includes(body.role))) throw forbidden('You cannot manage members with that role');
    if (!p.allSites && (body.allSites || body.siteIds?.some((s) => !p.siteIds.includes(s)))) throw forbidden('You can only grant access to your own sites');
    await tx.update(memberships).set({
      role: body.role, title: body.title, allSites: body.allSites, employeeId: body.employeeId, phone: body.phone, shiftLabel: body.shiftLabel, updatedAt: new Date(),
    }).where(eq(memberships.id, m.id));
    if (body.siteIds) {
      await tx.delete(membershipSites).where(eq(membershipSites.membershipId, m.id));
      if (body.siteIds.length) await tx.insert(membershipSites).values(body.siteIds.map((siteId) => ({ membershipId: m.id, siteId, orgId: p.orgId })));
    }
    const { status, ...rest } = body;
    await audit(tx, p, { orgId: p.orgId, action: 'member.updated', entityType: 'membership', entityId: m.id, metadata: rest });
    if (status && (status === 'active') !== (m.status === 'active')) return setStatus(tx, p, userId, status === 'active' ? 'active' : 'suspended');
    return { ok: true };
  }));

  // ================= Notifications (personal) =================
  app.get('/notifications', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    const rows = await tx.select().from(notifications).where(eq(notifications.userId, p.userId)).orderBy(desc(notifications.createdAt)).limit(50);
    const [{ unread }] = (await tx.select({ unread: sql<number>`count(*)::int` }).from(notifications).where(and(eq(notifications.userId, p.userId), isNull(notifications.readAt)))) as [{ unread: number }];
    return { notifications: rows, unread };
  }));

  app.post('/notifications/read', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    const { ids } = z.object({ ids: z.array(z.uuid()).max(200).optional() }).parse(req.body ?? {});
    await tx.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, p.userId), isNull(notifications.readAt), ids ? inArray(notifications.id, ids) : undefined));
    return { ok: true };
  }));

  // ================= Audit log =================
  app.get('/audit', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'audit.read');
    const q = z.object({
      action: z.string().max(60).optional(), entityType: z.string().max(40).optional(), q: z.string().max(80).optional(),
      from: z.coerce.date().optional(), to: z.coerce.date().optional(), limit: z.coerce.number().int().min(1).max(500).default(100), before: z.coerce.date().optional(),
    }).parse(req.query);
    const rows = await tx.select({ e: auditEvents, actorName: users.name }).from(auditEvents).leftJoin(users, eq(users.id, auditEvents.actorUserId))
      .where(and(
        q.action ? ilike(auditEvents.action, `${q.action}%`) : undefined,
        q.entityType ? eq(auditEvents.entityType, q.entityType) : undefined,
        q.q ? or(ilike(auditEvents.summary, `%${q.q}%`), ilike(users.name, `%${q.q}%`)) : undefined,
        q.from ? gte(auditEvents.at, q.from) : undefined,
        q.to ? lte(auditEvents.at, q.to) : undefined,
        q.before ? sql`${auditEvents.at} < ${q.before}` : undefined,
      ))
      .orderBy(desc(auditEvents.at)).limit(q.limit);
    return { events: rows.map((r) => ({ ...r.e, actorName: r.actorName ?? r.e.actorLabel })) };
  }));
}

/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}
