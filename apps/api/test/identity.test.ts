/**
 * Phase 1 identity: account types (admin | operator), administrator self sign-up with the
 * work-domain rule, operator invitations (single + CSV), operator routing and console lockout,
 * suspend / reactivate / remove with immediate revocation, magic links, the Supabase Auth
 * adapter (against a fake GoTrue) and the legacy role migration.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq, sql } from 'drizzle-orm';
import { auditEvents, authSessions, users } from '../src/db/schema.js';
import { withSystem } from '../src/db/tenant.js';
import { createDatabase, defaultMigrationsFolder } from '../src/db/client.js';
import type { DomainEvent } from '../src/core/events.js';
import { SupabaseAuth } from '../src/core/supabase.js';
import { as, Client, harness, lastMailTo, linkToken, PW, type Harness } from './helpers.js';

let h: Harness;
before(async () => {
  h = await harness();
});
after(async () => {
  await h.app.close();
  await h.database.close();
});

const NEW_PW = 'a-long-operator-password';

test('admin sign-up: only work emails at ADMIN_SIGNUP_DOMAINS (default hydris.ai)', async () => {
  const anon = new Client(h.app);
  const base = { name: 'Someone', password: 'a-strong-admin-password', orgName: 'Somewhere' };
  for (const email of ['someone@gmail.com', 'ops@acme.com', 'x@hydris.ai.evil.com', 'x@sub.hydris.ai', 'x@notyhydris.ai']) {
    const r = await anon.req('POST', '/api/auth/signup', { ...base, email });
    assert.equal(r.statusCode, 403, email);
    assert.equal(r.json().error.code, 'signup_domain_not_allowed');
    assert.match(r.json().error.message, /@hydris\.ai/);
  }
  const cfg = (await anon.req('GET', '/api/auth/config')).json();
  assert.deepEqual(cfg.adminSignupDomains, ['hydris.ai']);
  assert.equal(cfg.provider, 'builtin');
});

test('admin sign-up → email verification → new org → setup wizard → console', async () => {
  const anon = new Client(h.app);
  const r = await anon.req('POST', '/api/auth/signup', { name: 'Tarun KM', email: 'Tarun@Hydris.ai', password: 'a-strong-admin-password', orgName: 'Hydris Pilot Plant' });
  assert.equal(r.statusCode, 201, r.body);
  assert.equal(r.json().verificationRequired, true);
  assert.equal((await anon.req('POST', '/api/auth/signup', { name: 'Tarun KM', email: 'tarun@hydris.ai', password: 'a-strong-admin-password', orgName: 'Again' })).statusCode, 409);

  // Cannot sign in before verifying.
  const early = await new Client(h.app).login('tarun@hydris.ai', 'a-strong-admin-password');
  assert.equal(early.statusCode, 403);
  assert.equal(early.json().error.code, 'email_not_verified');

  const mail = await lastMailTo(h, 'tarun@hydris.ai');
  const token = linkToken(mail!.bodyText, '/auth/verify');
  assert.ok(token);
  const admin = new Client(h.app);
  const v = await admin.req('POST', '/api/auth/verify-email', { token });
  assert.equal(v.statusCode, 200, v.body);
  const s = admin.absorb(v);
  assert.equal(s.role, 'admin');
  assert.equal(s.accountType, 'admin');
  assert.equal(s.org.name, 'Hydris Pilot Plant');
  assert.equal(s.org.setupCompleted, false);
  assert.equal(s.home, '/console/setup');
  assert.ok(s.permissions.includes('console.access'));
  assert.equal((await admin.req('POST', '/api/auth/verify-email', { token })).statusCode, 400, 'single use');

  const setup = (await admin.req('GET', '/api/org/setup')).json();
  assert.deepEqual(setup.steps, { organization: false, site: false, operators: false });
  assert.equal((await admin.req('POST', '/api/org/setup', { region: 'Tamil Nadu, IN', complete: true })).statusCode, 200);
  assert.equal((await admin.req('GET', '/api/auth/me')).json().home, '/console');
  // The new org is isolated from the demo tenant.
  assert.equal((await admin.req('GET', '/api/assets')).json().assets.length, 0);
  const login = await new Client(h.app).login('tarun@hydris.ai', 'a-strong-admin-password');
  assert.equal(login.statusCode, 200);
});

async function inviteOperator(admin: Client, email: string, extra: Record<string, unknown> = {}) {
  const r = await admin.req('POST', '/api/invitations', { email, name: 'Priya Op', employeeId: 'EMP-42', phone: '+91 90000 00042', shiftLabel: 'Night shift', allSites: false, siteIds: [h.demo.siteId], ...extra });
  assert.equal(r.statusCode, 201, r.body);
  assert.equal(r.json().delivery, 'outbox');
  const mail = await lastMailTo(h, email);
  return linkToken(mail!.bodyText, '/invite/');
}

test('invite operator → accept (set password) → operator login, routed to the operator home', async () => {
  const admin = await as(h.app, 'admin');
  const token = await inviteOperator(admin, 'priya@plant.test');
  const preview = (await new Client(h.app).req('GET', `/api/auth/invitations/${token}`)).json();
  assert.equal(preview.accountType, 'operator');
  const pending = (await admin.req('GET', '/api/members')).json().invitations.find((i: { email: string }) => i.email === 'priya@plant.test');
  assert.equal(pending.status, 'pending');
  assert.equal(pending.employeeId, 'EMP-42');

  const op = new Client(h.app);
  const acc = await op.req('POST', '/api/auth/invitations/accept', { token, name: 'Priya Op', password: NEW_PW });
  assert.equal(acc.statusCode, 200, acc.body);
  const s = op.absorb(acc);
  assert.equal(s.role, 'operator');
  assert.equal(s.home, '/operator');
  assert.deepEqual(s.siteScope, [h.demo.siteId]);
  assert.deepEqual(s.profile, { title: null, employeeId: 'EMP-42', phone: '+91 90000 00042', shiftLabel: 'Night shift' });
  assert.ok(!s.permissions.includes('console.access'));

  const again = new Client(h.app);
  assert.equal((await again.login('priya@plant.test', NEW_PW)).statusCode, 200);
  assert.equal((await again.req('GET', '/api/inspections')).statusCode, 200);
  const row = (await admin.req('GET', '/api/members')).json().members.find((m: { email: string }) => m.email === 'priya@plant.test');
  assert.equal(row.accountType, 'operator');
  assert.equal(row.shiftLabel, 'Night shift');
});

test('operators are forbidden from console APIs (server-side), but keep their field APIs', async () => {
  const op = await as(h.app, 'operator');
  const forbiddenCalls: [string, string, unknown?][] = [
    ['GET', '/api/members'], ['POST', '/api/invitations', { email: 'x@y.test' }], ['POST', '/api/invitations/bulk', { csv: 'email\nx@y.test' }],
    ['GET', '/api/audit'], ['GET', '/api/devices'], ['GET', '/api/org'], ['PATCH', '/api/org', { name: 'Hijack' }], ['GET', '/api/org/setup'],
    ['POST', '/api/org/setup', { complete: true }], ['GET', '/api/ui-profiles'], [`POST`, `/api/members/${h.demo.users.operator2}/suspend`],
    ['POST', `/api/members/${h.demo.users.admin}/remove`], ['POST', '/api/assets', { tag: 'Z' }], ['POST', '/api/simulation/start', { scenario: 'normal_operations', siteId: h.demo.siteId }],
  ];
  for (const [m, url, body] of forbiddenCalls) {
    const r = await op.req(m as 'GET', url, body);
    assert.equal(r.statusCode, 403, `${m} ${url} → ${r.statusCode}`);
  }
  for (const url of ['/api/overview', '/api/alarms', '/api/inspections', '/api/maintenance', '/api/sensors', '/api/notifications', '/api/auth/me']) {
    assert.equal((await op.req('GET', url)).statusCode, 200, url);
  }
  const me = (await op.req('GET', '/api/auth/me')).json();
  assert.equal(me.home, '/operator');
});

test('bulk CSV invitations report each row', async () => {
  const admin = await as(h.app, 'admin');
  const sites = (await admin.req('GET', '/api/sites')).json().sites as { id: string; code: string }[];
  const csv = [
    'Email,Name,Employee ID,Phone,Shift,Sites',
    `ravi@plant.test,Ravi,E-1,+91 1,A shift,${sites[0]!.code}`,
    '"meena@plant.test","Meena, K",E-2,,B shift,',
    'not-an-email,Bad,,,,',
    'ravi@plant.test,Ravi again,,,,',
    'kumar@plant.test,Kumar,,,,NOPE-SITE',
    `${'operator'}@demo.hydris.local,Existing,,,,`,
  ].join('\r\n');
  const r = await admin.req('POST', '/api/invitations/bulk', { csv });
  assert.equal(r.statusCode, 201, r.body);
  const out = r.json();
  assert.equal(out.invited, 2);
  assert.equal(out.failed, 4);
  assert.deepEqual(out.results.map((x: { ok: boolean }) => x.ok), [true, true, false, false, false, false]);
  const pending = (await admin.req('GET', '/api/members')).json().invitations;
  const meena = pending.find((i: { email: string }) => i.email === 'meena@plant.test');
  assert.equal(meena.name, 'Meena, K');
  assert.equal(meena.allSites, true);
  assert.equal(pending.find((i: { email: string }) => i.email === 'ravi@plant.test').allSites, false);
  assert.ok(await lastMailTo(h, 'ravi@plant.test'));
});

async function pairGlasses(op: Client, hardwareId: string) {
  const anon = new Client(h.app);
  const { challengeId, userCode, pollSecret } = (await anon.req('POST', '/api/pairing/challenges', { hardwareId, device: { kind: 'simulator', display: { width: 600, height: 600 } } })).json();
  assert.equal((await op.req('POST', '/api/pairing/approve', { code: userCode, siteId: h.demo.siteId })).statusCode, 200);
  await new Promise((r) => setTimeout(r, 2100));
  const done = (await anon.req('POST', `/api/pairing/challenges/${challengeId}/poll`, { pollSecret })).json();
  assert.equal(done.status, 'completed');
  return done as { accessToken: string; refreshToken: string; device: { id: string } };
}

test('suspend revokes user sessions and device tokens immediately, publishes sign-out events, reactivate restores', async () => {
  const admin = await as(h.app, 'admin');
  const token = await inviteOperator(admin, 'sunil@plant.test', { allSites: true, siteIds: [] });
  const op = new Client(h.app);
  op.absorb(await op.req('POST', '/api/auth/invitations/accept', { token, password: NEW_PW }));
  const opId = (await op.req('GET', '/api/auth/me')).json().user.id as string;
  const phone2 = new Client(h.app);
  assert.equal((await phone2.login('sunil@plant.test', NEW_PW)).statusCode, 200);
  const dev = await pairGlasses(op, 'sim-install-suspend-0001');
  const glasses = new Client(h.app);
  glasses.token = dev.accessToken;
  assert.equal((await glasses.req('GET', '/api/device/context')).statusCode, 200);

  const events: DomainEvent[] = [];
  const unsub = h.ctx.bus.subscribe((e) => events.push(e));
  const r = await admin.req('POST', `/api/members/${opId}/suspend`, { reason: 'Left the site' });
  unsub();
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().devicesRevoked, 1);

  // Every channel is dead at once: access tokens, refresh cookies (both phones), the glasses.
  assert.equal((await op.req('GET', '/api/overview')).statusCode, 401);
  assert.equal((await phone2.req('GET', '/api/overview')).statusCode, 401);
  const ref = await op.req('POST', '/api/auth/refresh');
  assert.equal(ref.statusCode, 403);
  assert.equal(ref.json().error.code, 'account_suspended');
  assert.equal((await glasses.req('GET', '/api/device/context')).statusCode, 401);
  assert.equal((await new Client(h.app).req('POST', '/api/device/refresh', { refreshToken: dev.refreshToken })).statusCode, 401);
  const live = await withSystem(h.database.db, (tx) => tx.select().from(authSessions).where(and(eq(authSessions.userId, opId), sql`${authSessions.revokedAt} is null`)));
  assert.equal(live.length, 0);

  // Realtime: the operator's app and the glasses are told to sign out.
  const ended = events.find((e) => e.type === 'account.ended');
  assert.deepEqual(ended?.userIds, [opId]);
  assert.equal((ended?.payload as { code: string }).code, 'account_suspended');
  assert.deepEqual(events.find((e) => e.type === 'session.revoked')?.deviceIds, [dev.device.id]);

  const login = await new Client(h.app).login('sunil@plant.test', NEW_PW);
  assert.equal(login.statusCode, 403);
  assert.equal(login.json().error.code, 'account_suspended');
  const audits = await withSystem(h.database.db, (tx) => tx.select().from(auditEvents).where(eq(auditEvents.action, 'member.suspended')));
  assert.ok(audits.some((a) => a.summary === 'Left the site' && a.actorUserId === h.demo.users.admin));
  assert.equal((await admin.req('POST', `/api/invitations`, { email: 'sunil@plant.test' })).statusCode, 409, 'suspended members are reactivated, not re-invited');

  assert.equal((await admin.req('POST', `/api/members/${opId}/reactivate`)).statusCode, 200);
  assert.equal((await new Client(h.app).login('sunil@plant.test', NEW_PW)).statusCode, 200);
  assert.equal((await admin.req('POST', `/api/members/${h.demo.users.admin}/suspend`)).statusCode, 403, 'cannot suspend yourself');
});

test('removed users cannot sign in (password or magic link) and must be invited again', async () => {
  const admin = await as(h.app, 'admin');
  const token = await inviteOperator(admin, 'gone@plant.test', { allSites: true, siteIds: [] });
  const op = new Client(h.app);
  op.absorb(await op.req('POST', '/api/auth/invitations/accept', { token, password: NEW_PW }));
  const opId = (await op.req('GET', '/api/auth/me')).json().user.id as string;
  assert.equal((await admin.req('POST', `/api/members/${opId}/remove`)).statusCode, 200);
  assert.equal((await op.req('GET', '/api/overview')).statusCode, 401);
  const login = await new Client(h.app).login('gone@plant.test', NEW_PW);
  assert.equal(login.statusCode, 403);
  assert.equal(login.json().error.code, 'account_removed');
  const before = await lastMailTo(h, 'gone@plant.test');
  await new Client(h.app).req('POST', '/api/auth/magic-link', { email: 'gone@plant.test' });
  assert.equal((await lastMailTo(h, 'gone@plant.test'))!.id, before!.id, 'no magic link for removed users');
  assert.equal((await admin.req('POST', `/api/members/${opId}/reactivate`)).statusCode, 409);
  const members = (await admin.req('GET', '/api/members')).json().members;
  assert.equal(members.find((m: { userId: string }) => m.userId === opId).status, 'removed');
  // A fresh invitation brings them back.
  const again = await inviteOperator(admin, 'gone@plant.test', { allSites: true, siteIds: [] });
  assert.equal((await new Client(h.app).req('POST', '/api/auth/invitations/accept', { token: again, password: NEW_PW })).statusCode, 200);
});

test('magic link (built-in): web and Android (hydrisfield://) links sign in once', async () => {
  const anon = new Client(h.app);
  assert.equal((await anon.req('POST', '/api/auth/magic-link', { email: 'operator2@demo.hydris.local', client: 'android' })).statusCode, 200);
  const mail = await lastMailTo(h, 'operator2@demo.hydris.local');
  assert.match(mail!.bodyText, /hydrisfield:\/\/auth-callback\?magic=/);
  const magic = /magic=([A-Za-z0-9_-]+)/.exec(mail!.bodyText)![1]!;
  const c = new Client(h.app);
  const r = await c.req('POST', '/api/auth/callback/exchange', { magicToken: magic });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(c.absorb(r).role, 'operator');
  assert.equal((await c.req('POST', '/api/auth/callback/exchange', { magicToken: magic })).statusCode, 400, 'single use');
  assert.equal((await anon.req('POST', '/api/auth/magic-link', { email: 'nobody@nowhere.test' })).statusCode, 200, 'no account enumeration');
});

// ------------------------------------------------------------------ Supabase adapter (fake GoTrue)
const SB_URL = 'https://proj.supabase.co';
const SB_SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long';
function sbToken(claims: Record<string, unknown>, secret = SB_SECRET) {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = enc({ alg: 'HS256', typ: 'JWT' });
  const body = enc({ aud: 'authenticated', iss: `${SB_URL}/auth/v1`, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated', ...claims });
  return `${head}.${body}.${createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')}`;
}

test('Supabase mode: sign-up via GoTrue, verified callback creates the org, password login maps to the Hydris session', async () => {
  const calls: { url: string; body?: string; auth?: string }[] = [];
  const sbUsers = new Map<string, { id: string; password: string; meta: Record<string, unknown> }>();
  const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
  const fake = async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    calls.push({ url, body: init?.body, auth: init?.headers?.authorization });
    const b = init?.body ? JSON.parse(init.body) : {};
    if (url.includes('/auth/v1/signup')) {
      const id = `00000000-0000-4000-8000-${String(sbUsers.size + 1).padStart(12, '0')}`;
      sbUsers.set(b.email, { id, password: b.password, meta: b.data });
      return json(200, { id, email: b.email });
    }
    if (url.includes('/auth/v1/token')) {
      const u = sbUsers.get(b.email);
      if (!u || u.password !== b.password) return json(400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      return json(200, { access_token: sbToken({ sub: u.id, email: b.email, user_metadata: u.meta }), refresh_token: 'r', expires_in: 3600, user: { id: u.id } });
    }
    if (url.includes('/auth/v1/invite')) return json(200, { id: '00000000-0000-4000-8000-0000000000aa', email: b.email });
    return json(404, { msg: 'not found' });
  };
  const saved = h.ctx.supabase;
  h.ctx.supabase = new SupabaseAuth({ url: SB_URL, anonKey: 'anon-key', serviceRoleKey: 'service-role-key', jwtSecret: SB_SECRET }, fake);
  try {
    const anon = new Client(h.app);
    assert.equal((await anon.req('GET', '/api/auth/config')).json().provider, 'supabase');
    assert.equal((await anon.req('POST', '/api/auth/signup', { name: 'Gmail', email: 'a@gmail.com', password: 'a-strong-admin-password', orgName: 'Gmail Org' })).statusCode, 403);
    assert.equal(calls.length, 0, 'domain rule enforced before Supabase is called');
    const r = await anon.req('POST', '/api/auth/signup', { name: 'Anu Admin', email: 'anu@hydris.ai', password: 'a-strong-admin-password', orgName: 'Hydris Labs' });
    assert.equal(r.statusCode, 201, r.body);
    assert.match(calls[0]!.url, /\/signup\?redirect_to=http.*%2Fauth%2Fcallback%3Fflow%3Dsignup/);
    assert.equal(JSON.parse(calls[0]!.body!).data.account_type, 'admin');

    // The confirmation link lands on /auth/callback with an access token: exchange it.
    const sbId = sbUsers.get('anu@hydris.ai')!.id;
    const forged = sbToken({ sub: sbId, email: 'anu@hydris.ai', user_metadata: { account_type: 'admin' } }, 'wrong-secret-wrong-secret-wrong-secret!!');
    assert.equal((await anon.req('POST', '/api/auth/callback/exchange', { accessToken: forged })).statusCode, 401, 'bad signature rejected');
    const c = new Client(h.app);
    const ex = await c.req('POST', '/api/auth/callback/exchange', { accessToken: sbToken({ sub: sbId, email: 'anu@hydris.ai', user_metadata: { account_type: 'admin', name: 'Anu Admin', org_name: 'Hydris Labs' } }) });
    assert.equal(ex.statusCode, 200, ex.body);
    const s = c.absorb(ex);
    assert.equal(s.org.name, 'Hydris Labs');
    assert.equal(s.home, '/console/setup');
    const [linked] = await withSystem(h.database.db, (tx) => tx.select().from(users).where(eq(users.email, 'anu@hydris.ai')));
    assert.equal(linked!.supabaseUserId, sbId);
    assert.equal(linked!.passwordHash, null, 'passwords live at Supabase only');

    // Password sign-in goes through GoTrue and yields the usual Hydris session + refresh cookie.
    const login = new Client(h.app);
    const lr = await login.login('anu@hydris.ai', 'a-strong-admin-password');
    assert.equal(lr.statusCode, 200, lr.body);
    assert.ok(login.cookie.startsWith('hg_refresh='));
    assert.equal((await login.req('GET', '/api/org/setup')).statusCode, 200);
    assert.equal((await new Client(h.app).login('anu@hydris.ai', 'wrong-password-123')).statusCode, 401);

    // Operator invites go through Supabase's invite email (service role, server side).
    const inv = await c.req('POST', '/api/invitations', { email: 'field@hydris-client.test' });
    assert.equal(inv.statusCode, 201, inv.body);
    assert.equal(inv.json().delivery, 'supabase');
    assert.equal(inv.json().invitationLink, null);
    const inviteCall = calls.find((x) => x.url.includes('/invite'))!;
    assert.equal(inviteCall.auth, 'Bearer service-role-key');
    assert.match(inviteCall.url, /flow%3Dinvite/);
    // Invite link → callback with the invited user's token (+ new password set at Supabase) → operator session.
    calls.length = 0;
    const opClient = new Client(h.app);
    const fakeWithPut = h.ctx.supabase;
    (fakeWithPut as unknown as { updatePassword: () => Promise<unknown> }).updatePassword = async () => ({ id: 'x' });
    const opEx = await opClient.req('POST', '/api/auth/callback/exchange', { accessToken: sbToken({ sub: '00000000-0000-4000-8000-0000000000aa', email: 'field@hydris-client.test' }), password: NEW_PW });
    assert.equal(opEx.statusCode, 200, opEx.body);
    assert.equal(opClient.absorb(opEx).home, '/operator');
    // No invitation and no admin sign-up metadata: no account is created.
    const stranger = await new Client(h.app).req('POST', '/api/auth/callback/exchange', { accessToken: sbToken({ sub: '00000000-0000-4000-8000-0000000000bb', email: 'random@x.test' }) });
    assert.equal(stranger.statusCode, 403);
    assert.equal(stranger.json().error.code, 'no_account');
  } finally {
    h.ctx.supabase = saved;
  }
});

test('migration 0009 maps the six legacy roles onto admin / operator', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hydris-mig-'));
  try {
    cpSync(defaultMigrationsFolder(), dir, { recursive: true });
    const journalPath = join(dir, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
    const full = structuredClone(journal);
    journal.entries = journal.entries.filter((e: { tag: string }) => e.tag < '0009');
    writeFileSync(journalPath, JSON.stringify(journal));
    const { PGlite } = await import('@electric-sql/pglite');
    const { drizzle } = await import('drizzle-orm/pglite');
    const { migrate } = await import('drizzle-orm/pglite/migrator');
    const client = new PGlite();
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: dir });
    const legacy = ['org_admin', 'factory_manager', 'supervisor', 'field_operator', 'maintenance_engineer', 'viewer'];
    await client.exec(`insert into organizations (id, name, slug) values ('11111111-1111-4111-8111-111111111111', 'Legacy', 'legacy')`);
    for (const [i, role] of legacy.entries()) {
      const uid = `22222222-2222-4222-8222-00000000000${i}`;
      await client.exec(`insert into users (id, email, name) values ('${uid}', '${role}@legacy.test', '${role}')`);
      await client.exec(`insert into memberships (org_id, user_id, role, status) values ('11111111-1111-4111-8111-111111111111', '${uid}', '${role}', '${i === 5 ? 'deactivated' : 'active'}')`);
    }
    await client.exec(`insert into invitations (org_id, email, role, token_hash, expires_at) values ('11111111-1111-4111-8111-111111111111', 'inv@legacy.test', 'supervisor', 'h', now() + interval '1 day')`);
    writeFileSync(journalPath, JSON.stringify(full));
    await migrate(db, { migrationsFolder: dir });
    const rows = (await client.query<{ email: string; role: string; status: string }>(`select u.email, m.role::text as role, m.status::text as status from memberships m join users u on u.id = m.user_id order by u.email`)).rows;
    const byRole = Object.fromEntries(rows.map((r) => [r.email.split('@')[0], r]));
    assert.equal(byRole.org_admin!.role, 'admin');
    assert.equal(byRole.factory_manager!.role, 'admin');
    assert.equal(byRole.supervisor!.role, 'admin');
    assert.equal(byRole.field_operator!.role, 'operator');
    assert.equal(byRole.maintenance_engineer!.role, 'operator');
    assert.equal(byRole.viewer!.role, 'operator');
    assert.equal(byRole.viewer!.status, 'suspended', 'deactivated → suspended');
    const inv = (await client.query<{ role: string; status: string }>(`select role::text as role, status from invitations`)).rows[0]!;
    assert.deepEqual(inv, { role: 'admin', status: 'pending' });
    const enumVals = (await client.query<{ v: string }>(`select unnest(enum_range(null::role))::text as v`)).rows.map((r) => r.v);
    assert.deepEqual(enumVals, ['admin', 'operator']);
    await client.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('demo seed: demo org has administrators and operators', async () => {
  const roles = await withSystem(h.database.db, (tx) => tx.execute(sql`select role::text as role, count(*)::int as n from memberships where org_id = ${h.demo.orgId} group by role order by role`));
  const r = (roles as unknown as { rows: { role: string; n: number }[] }).rows;
  assert.ok(r.find((x) => x.role === 'admin')!.n >= 3);
  assert.ok(r.find((x) => x.role === 'operator')!.n >= 4);
  void PW;
});
