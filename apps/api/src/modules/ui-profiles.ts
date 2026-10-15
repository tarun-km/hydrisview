import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, asc, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  ASSET_TYPES, DEFAULT_UI_PROFILE_CONFIG, MEASURANDS, ROLES, UI_ACTIONS, UI_SCREENS, UI_WIDGETS, actionAllowed, diffUiProfileConfigs, normalizeUiProfileConfig,
  resolveUiAssignment, screenEnabled, type Role, type UiAction, type UiProfileConfig, type UiScreen,
} from '@hydris/domain';
import type { Ctx } from '../context.js';
import { authenticate, tenant } from '../context.js';
import { deviceAssignments, devices, memberships, uiProfileAssignments, uiProfileVersions, uiProfiles, users } from '../db/schema.js';
import type { Tx } from '../db/client.js';
import { withTenant } from '../db/tenant.js';
import { badRequest, conflict, forbidden, HttpError, notFound } from '../core/errors.js';
import type { Principal } from '../core/principal.js';
import { audit } from '../core/services.js';

/** Strict zod schema for a UI profile config (API boundary). Normalized afterwards. */
export const uiProfileConfigSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  screens: z.array(z.object({ id: z.enum(UI_SCREENS), enabled: z.boolean() })).max(UI_SCREENS.length),
  widgets: z.array(z.object({ id: z.enum(UI_WIDGETS), visible: z.boolean() })).max(UI_WIDGETS.length),
  measurements: z.object({
    allow: z.array(z.enum(MEASURANDS)).nullable(),
    orderByAssetType: z.partialRecord(z.enum(ASSET_TYPES), z.array(z.enum(MEASURANDS))).default({}),
  }),
  actions: z.object(Object.fromEntries(UI_ACTIONS.map((a) => [a, z.boolean()])) as Record<UiAction, z.ZodBoolean>),
  layout: z.object({ density: z.enum(['compact', 'comfortable']), textScale: z.number().min(0.85).max(1.4), handedness: z.enum(['left', 'right']) }),
});

export interface EffectiveProfile {
  profileId: string | null; name: string; version: number | null; versionId: string | null;
  source: 'device' | 'user' | 'role' | 'org' | 'default'; config: UiProfileConfig;
}

const DEFAULT_EFFECTIVE: EffectiveProfile = { profileId: null, name: 'Built-in default', version: null, versionId: null, source: 'default', config: DEFAULT_UI_PROFILE_CONFIG };

/** Resolve the effective published profile for a subject inside a tenant transaction. */
export async function effectiveProfile(tx: Tx, subject: { deviceId?: string | null; userId?: string | null; role?: Role | null }): Promise<EffectiveProfile> {
  const assigns = await tx.select({ scope: uiProfileAssignments.scope, profileId: uiProfileAssignments.profileId, role: uiProfileAssignments.role, userId: uiProfileAssignments.userId, deviceId: uiProfileAssignments.deviceId })
    .from(uiProfileAssignments);
  if (!assigns.length) return DEFAULT_EFFECTIVE;
  const published = await tx.select({ v: uiProfileVersions, name: uiProfiles.name }).from(uiProfileVersions).innerJoin(uiProfiles, eq(uiProfiles.id, uiProfileVersions.profileId))
    .where(and(eq(uiProfileVersions.status, 'published'), isNull(uiProfiles.archivedAt)));
  const byProfile = new Map(published.map((r) => [r.v.profileId, r]));
  const hit = resolveUiAssignment(assigns, subject, (id) => byProfile.has(id));
  if (!hit) return DEFAULT_EFFECTIVE;
  const r = byProfile.get(hit.profileId)!;
  return { profileId: hit.profileId, name: r.name, version: r.v.version, versionId: r.v.id, source: hit.scope, config: normalizeUiProfileConfig(r.v.config) };
}

// ---------------- per-request enforcement for device principals ----------------
const cache = new WeakMap<Ctx, Map<string, { at: number; p: EffectiveProfile }>>();
const CACHE_MS = 5000;
export function invalidateProfileCache(ctx: Ctx) { cache.get(ctx)?.clear(); }

async function cachedDeviceProfile(ctx: Ctx, p: Principal): Promise<EffectiveProfile> {
  let m = cache.get(ctx);
  if (!m) cache.set(ctx, (m = new Map()));
  const key = `${p.deviceId}:${p.userId}:${p.role}`;
  const hit = m.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.p;
  const prof = await withTenant(ctx.db, p.orgId, (tx) => effectiveProfile(tx, { deviceId: p.deviceId, userId: p.userId, role: p.role }));
  m.set(key, { at: Date.now(), p: prof });
  return prof;
}

type Need = { screen?: UiScreen; screensAny?: UiScreen[]; action?: UiAction; actionsAny?: UiAction[] } | null;
type Rule = { method: string; url: string; need: (req: FastifyRequest) => Need };
const P = (req: FastifyRequest) => req.params as Record<string, string>;

/** Route → profile requirement for glasses. Kept here so other modules stay unaware of profiles. */
const RULES: Rule[] = [
  { method: 'GET', url: '/api/alarms', need: () => ({ screen: 'alerts' }) },
  { method: 'GET', url: '/api/alarms/:id', need: () => ({ screen: 'alerts' }) },
  { method: 'POST', url: '/api/alarms/:id/:action', need: (r) => (P(r).action === 'acknowledge' ? { screen: 'alerts', action: 'acknowledge_alarm' } : { screen: 'alerts' }) },
  { method: 'GET', url: '/api/inspections', need: () => ({ screen: 'inspections' }) },
  { method: 'GET', url: '/api/inspections/:id', need: () => ({ screen: 'inspections' }) },
  { method: 'POST', url: '/api/inspections/:id/responses', need: () => ({ screen: 'inspections', action: 'record_inspection' }) },
  { method: 'POST', url: '/api/inspections/:id/:action', need: (r) => ({ screen: 'inspections', action: P(r).action === 'submit' ? 'submit_inspection' : 'record_inspection' }) },
  { method: 'GET', url: '/api/maintenance', need: () => ({ screen: 'tasks' }) },
  { method: 'GET', url: '/api/maintenance/:id', need: () => ({ screen: 'tasks' }) },
  { method: 'POST', url: '/api/maintenance/:id/checklist/:itemId', need: () => ({ screen: 'tasks', action: 'toggle_checklist' }) },
  { method: 'GET', url: '/api/assist', need: () => ({ actionsAny: ['ask_ai', 'view_sops'] }) },
  { method: 'GET', url: '/api/documents', need: () => ({ screen: 'sops', action: 'view_sops' }) },
  { method: 'GET', url: '/api/documents/:id', need: () => ({ action: 'view_sops' }) },
  { method: 'GET', url: '/api/notifications', need: () => ({ screen: 'notifications' }) },
  { method: 'POST', url: '/api/notifications/read', need: () => ({ screen: 'notifications', action: 'mark_notifications_read' }) },
  { method: 'GET', url: '/api/sensors', need: () => ({ screensAny: ['measurements', 'assets'] }) },
  { method: 'GET', url: '/api/telemetry/sensors/:id/history', need: () => ({ screensAny: ['measurements', 'assets'] }) },
];

export function checkNeed(cfg: UiProfileConfig, need: Need): string | null {
  if (!need) return null;
  if (need.screen && !screenEnabled(cfg, need.screen)) return `The "${need.screen}" screen is not permitted by this device's UI profile`;
  if (need.screensAny && !need.screensAny.some((s) => screenEnabled(cfg, s))) return 'This screen is not permitted by this device\'s UI profile';
  if (need.action && !actionAllowed(cfg, need.action)) return `The "${need.action}" action is not permitted by this device's UI profile`;
  if (need.actionsAny && !need.actionsAny.some((a) => actionAllowed(cfg, a))) return 'This action is not permitted by this device\'s UI profile';
  return null;
}

/** Install BEFORE route modules: appends a profile check after each matching route's authentication. */
export function installProfileEnforcement(app: FastifyInstance, ctx: Ctx) {
  app.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    const rule = RULES.find((r) => methods.includes(r.method as never) && r.url === route.url);
    if (!rule) return;
    const check = async (req: FastifyRequest) => {
      const p = req.principal;
      if (!p || p.kind !== 'device') return;
      const prof = await cachedDeviceProfile(ctx, p);
      const why = checkNeed(prof.config, rule.need(req));
      if (why) throw new HttpError(403, 'profile_forbidden', why);
    };
    const pre = route.preHandler;
    route.preHandler = [...(Array.isArray(pre) ? pre : pre ? [pre] : []), check];
  });
}

// ---------------- routes ----------------
const canRead = (p: Principal) => p.kind === 'user' && (p.role === 'org_admin' || p.role === 'factory_manager');
const requireRead = (p: Principal) => { if (!canRead(p)) throw forbidden(); };
const requireEdit = (p: Principal) => { if (p.kind !== 'user' || p.role !== 'org_admin') throw forbidden('Only organization administrators can change glasses UI profiles'); };

const idParam = z.object({ id: z.uuid() });

export async function uiProfileRoutes(app: FastifyInstance, ctx: Ctx) {
  const auth = { preHandler: authenticate(ctx) };

  /** Active devices with their current operator and role (for affected-device computation). */
  async function fleet(tx: Tx) {
    return tx.select({ deviceId: devices.id, userId: deviceAssignments.userId, role: memberships.role }).from(devices)
      .innerJoin(deviceAssignments, and(eq(deviceAssignments.deviceId, devices.id), isNull(deviceAssignments.unassignedAt)))
      .innerJoin(memberships, eq(memberships.userId, deviceAssignments.userId))
      .where(eq(devices.status, 'active'));
  }

  /** Notify devices whose effective profile is (or was) the given one, or that match a changed assignment scope. */
  async function notify(tx: Tx, orgId: string, filter: (d: { deviceId: string; userId: string; role: Role }, eff: EffectiveProfile) => boolean, payload: Record<string, unknown>) {
    invalidateProfileCache(ctx);
    const rows = await fleet(tx);
    const ids: string[] = [];
    for (const d of rows) {
      const eff = await effectiveProfile(tx, { deviceId: d.deviceId, userId: d.userId, role: d.role as Role });
      if (filter(d as { deviceId: string; userId: string; role: Role }, eff)) ids.push(d.deviceId);
    }
    if (ids.length) ctx.bus.publish({ type: 'device.profile_changed', orgId, deviceIds: ids, payload });
    ctx.bus.publish({ type: 'ui_profile.updated', orgId, permission: 'device.read', payload: { ...payload, affectedDevices: ids.length } });
    return ids;
  }

  async function loadProfile(tx: Tx, id: string) {
    const [pr] = await tx.select().from(uiProfiles).where(eq(uiProfiles.id, id));
    if (!pr) throw notFound('UI profile');
    return pr;
  }

  app.get('/ui-profiles', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requireRead(p);
    const profiles = await tx.select().from(uiProfiles).where(isNull(uiProfiles.archivedAt)).orderBy(asc(uiProfiles.name));
    const versions = await tx.select({ profileId: uiProfileVersions.profileId, version: uiProfileVersions.version, status: uiProfileVersions.status, publishedAt: uiProfileVersions.publishedAt })
      .from(uiProfileVersions).where(ne(uiProfileVersions.status, 'superseded'));
    const assigns = await tx.select({ profileId: uiProfileAssignments.profileId, n: sql<number>`count(*)::int` }).from(uiProfileAssignments).groupBy(uiProfileAssignments.profileId);
    return {
      profiles: profiles.map((pr) => ({
        ...pr,
        published: versions.find((v) => v.profileId === pr.id && v.status === 'published') ?? null,
        hasDraft: versions.some((v) => v.profileId === pr.id && v.status === 'draft'),
        assignments: assigns.find((a) => a.profileId === pr.id)?.n ?? 0,
      })),
      canEdit: p.role === 'org_admin',
      defaultConfig: DEFAULT_UI_PROFILE_CONFIG,
    };
  }));

  app.post('/ui-profiles', auth, async (req, reply) => tenant(ctx, req, async (tx, p) => {
    requireEdit(p);
    const body = z.object({ name: z.string().trim().min(2).max(80), description: z.string().trim().max(300).optional(), copyFromProfileId: z.uuid().optional() }).parse(req.body);
    let config: UiProfileConfig = DEFAULT_UI_PROFILE_CONFIG;
    if (body.copyFromProfileId) {
      const [src] = await tx.select().from(uiProfileVersions).where(eq(uiProfileVersions.profileId, body.copyFromProfileId)).orderBy(desc(uiProfileVersions.version)).limit(1);
      if (!src) throw notFound('Source profile');
      config = normalizeUiProfileConfig(src.config);
    }
    const [pr] = await tx.insert(uiProfiles).values({ orgId: p.orgId, name: body.name, description: body.description, createdBy: p.userId }).returning();
    await tx.insert(uiProfileVersions).values({ orgId: p.orgId, profileId: pr!.id, version: 1, config: config as unknown as Record<string, unknown>, status: 'draft', createdBy: p.userId });
    await audit(tx, p, { orgId: p.orgId, action: 'ui_profile.created', entityType: 'ui_profile', entityId: pr!.id, summary: pr!.name, ip: req.ip });
    return reply.code(201).send({ profile: pr });
  }));

  app.get('/ui-profiles/:id', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requireRead(p);
    const { id } = idParam.parse(req.params);
    const pr = await loadProfile(tx, id);
    const vs = await tx.select({ v: uiProfileVersions, createdByName: users.name }).from(uiProfileVersions).leftJoin(users, eq(users.id, uiProfileVersions.publishedBy))
      .where(eq(uiProfileVersions.profileId, id)).orderBy(desc(uiProfileVersions.version));
    const ordered = vs.map((r) => ({ ...r.v, config: normalizeUiProfileConfig(r.v.config), publishedByName: r.createdByName }));
    const history = ordered.filter((v) => v.status !== 'draft');
    const versions = ordered.map((v) => {
      const prev = history.find((h) => h.version < v.version && h.id !== v.id);
      return { ...v, changes: diffUiProfileConfigs(prev?.config ?? DEFAULT_UI_PROFILE_CONFIG, v.config), comparedTo: prev?.version ?? null };
    });
    const assignments = await tx.select().from(uiProfileAssignments).where(eq(uiProfileAssignments.profileId, id));
    return {
      profile: pr, versions,
      draft: versions.find((v) => v.status === 'draft') ?? null,
      published: versions.find((v) => v.status === 'published') ?? null,
      assignments, canEdit: p.role === 'org_admin',
    };
  }));

  app.patch('/ui-profiles/:id', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requireEdit(p);
    const { id } = idParam.parse(req.params);
    const body = z.object({ name: z.string().trim().min(2).max(80).optional(), description: z.string().trim().max(300).nullable().optional() }).parse(req.body);
    await loadProfile(tx, id);
    const [pr] = await tx.update(uiProfiles).set({ ...body, updatedAt: new Date() }).where(eq(uiProfiles.id, id)).returning();
    await audit(tx, p, { orgId: p.orgId, action: 'ui_profile.updated', entityType: 'ui_profile', entityId: id, summary: pr!.name, metadata: body, ip: req.ip });
    return { profile: pr };
  }));

  app.post('/ui-profiles/:id/archive', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requireEdit(p);
    const { id } = idParam.parse(req.params);
    const pr = await loadProfile(tx, id);
    const [used] = await tx.select({ id: uiProfileAssignments.id }).from(uiProfileAssignments).where(eq(uiProfileAssignments.profileId, id)).limit(1);
    if (used) throw conflict('profile_assigned', 'Remove this profile\'s assignments before archiving it');
    await tx.update(uiProfiles).set({ archivedAt: new Date(), updatedAt: new Date() }).where(eq(uiProfiles.id, id));
    await audit(tx, p, { orgId: p.orgId, action: 'ui_profile.archived', entityType: 'ui_profile', entityId: id, summary: pr.name, ip: req.ip });
    return { ok: true };
  }));

  /** Save the draft (one per profile). Creates it as the next version if none exists. */
  app.put('/ui-profiles/:id/draft', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requireEdit(p);
    const { id } = idParam.parse(req.params);
    const body = z.object({ config: uiProfileConfigSchema, notes: z.string().trim().max(500).optional() }).parse(req.body);
    const pr = await loadProfile(tx, id);
    if (pr.archivedAt) throw conflict('profile_archived', 'Archived profiles cannot be edited');
    const config = normalizeUiProfileConfig(body.config) as unknown as Record<string, unknown>;
    const [draft] = await tx.select().from(uiProfileVersions).where(and(eq(uiProfileVersions.profileId, id), eq(uiProfileVersions.status, 'draft')));
    let row;
    if (draft) [row] = await tx.update(uiProfileVersions).set({ config, notes: body.notes ?? draft.notes }).where(eq(uiProfileVersions.id, draft.id)).returning();
    else {
      const [{ max }] = await tx.select({ max: sql<number>`coalesce(max(${uiProfileVersions.version}), 0)::int` }).from(uiProfileVersions).where(eq(uiProfileVersions.profileId, id)) as [{ max: number }];
      [row] = await tx.insert(uiProfileVersions).values({ orgId: p.orgId, profileId: id, version: max + 1, config, notes: body.notes, status: 'draft', createdBy: p.userId }).returning();
    }
    await audit(tx, p, { orgId: p.orgId, action: 'ui_profile.draft_saved', entityType: 'ui_profile', entityId: id, summary: `${pr.name} v${row!.version} draft`, ip: req.ip });
    return { draft: { ...row!, config: normalizeUiProfileConfig(row!.config) } };
  }));

  app.delete('/ui-profiles/:id/draft', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requireEdit(p);
    const { id } = idParam.parse(req.params);
    const pr = await loadProfile(tx, id);
    const del = await tx.delete(uiProfileVersions).where(and(eq(uiProfileVersions.profileId, id), eq(uiProfileVersions.status, 'draft'))).returning();
    if (!del.length) throw notFound('Draft');
    await audit(tx, p, { orgId: p.orgId, action: 'ui_profile.draft_discarded', entityType: 'ui_profile', entityId: id, summary: pr.name, ip: req.ip });
    return { ok: true };
  }));

  async function publishVersion(tx: Tx, p: Principal, profileId: string, versionId: string) {
    const now = new Date();
    await tx.update(uiProfileVersions).set({ status: 'superseded' }).where(and(eq(uiProfileVersions.profileId, profileId), eq(uiProfileVersions.status, 'published')));
    const [v] = await tx.update(uiProfileVersions).set({ status: 'published', publishedAt: now, publishedBy: p.userId }).where(eq(uiProfileVersions.id, versionId)).returning();
    await tx.update(uiProfiles).set({ updatedAt: now }).where(eq(uiProfiles.id, profileId));
    return v!;
  }

  app.post('/ui-profiles/:id/publish', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requireEdit(p);
    const { id } = idParam.parse(req.params);
    const { notes } = z.object({ notes: z.string().trim().max(500).optional() }).parse(req.body ?? {});
    const pr = await loadProfile(tx, id);
    if (pr.archivedAt) throw conflict('profile_archived', 'Archived profiles cannot be published');
    const [draft] = await tx.select().from(uiProfileVersions).where(and(eq(uiProfileVersions.profileId, id), eq(uiProfileVersions.status, 'draft')));
    if (!draft) throw badRequest('no_draft', 'There is no draft to publish');
    if (notes) await tx.update(uiProfileVersions).set({ notes }).where(eq(uiProfileVersions.id, draft.id));
    const v = await publishVersion(tx, p, id, draft.id);
    await audit(tx, p, { orgId: p.orgId, action: 'ui_profile.published', entityType: 'ui_profile', entityId: id, summary: `${pr.name} v${v.version}`, metadata: { version: v.version, notes }, ip: req.ip });
    const affected = await notify(tx, p.orgId, (_d, eff) => eff.profileId === id, { profileId: id, version: v.version, reason: 'published' });
    return { version: { ...v, config: normalizeUiProfileConfig(v.config) }, affectedDevices: affected.length };
  }));

  /** Rollback: re-publish an earlier version's config as a NEW version (history is never rewritten). */
  app.post('/ui-profiles/:id/rollback', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requireEdit(p);
    const { id } = idParam.parse(req.params);
    const body = z.object({ versionId: z.uuid(), notes: z.string().trim().max(500).optional() }).parse(req.body);
    const pr = await loadProfile(tx, id);
    const [src] = await tx.select().from(uiProfileVersions).where(and(eq(uiProfileVersions.id, body.versionId), eq(uiProfileVersions.profileId, id)));
    if (!src) throw notFound('Version');
    if (src.status === 'draft') throw badRequest('cannot_rollback_to_draft', 'Publish the draft instead');
    if (src.status === 'published') throw conflict('already_published', 'That version is already live');
    const [{ max }] = await tx.select({ max: sql<number>`coalesce(max(${uiProfileVersions.version}), 0)::int` }).from(uiProfileVersions).where(eq(uiProfileVersions.profileId, id)) as [{ max: number }];
    // Keep the open draft (if any) as the next version after the rollback.
    await tx.update(uiProfileVersions).set({ version: max + 2 }).where(and(eq(uiProfileVersions.profileId, id), eq(uiProfileVersions.status, 'draft')));
    const [nv] = await tx.insert(uiProfileVersions).values({
      orgId: p.orgId, profileId: id, version: max + 1, config: src.config, status: 'draft', createdBy: p.userId, notes: body.notes ?? `Rollback to v${src.version}`,
    }).returning();
    const v = await publishVersion(tx, p, id, nv!.id);
    await audit(tx, p, { orgId: p.orgId, action: 'ui_profile.rolled_back', entityType: 'ui_profile', entityId: id, summary: `${pr.name} v${v.version} (from v${src.version})`, metadata: { fromVersion: src.version, version: v.version, notes: body.notes }, ip: req.ip });
    const affected = await notify(tx, p.orgId, (_d, eff) => eff.profileId === id, { profileId: id, version: v.version, reason: 'rollback' });
    return { version: { ...v, config: normalizeUiProfileConfig(v.config) }, affectedDevices: affected.length };
  }));

  // ---------------- assignments ----------------
  app.get('/ui-profile-assignments', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requireRead(p);
    const rows = await tx.select({ a: uiProfileAssignments, profileName: uiProfiles.name, userName: users.name, deviceName: devices.name })
      .from(uiProfileAssignments).innerJoin(uiProfiles, eq(uiProfiles.id, uiProfileAssignments.profileId))
      .leftJoin(users, eq(users.id, uiProfileAssignments.userId)).leftJoin(devices, eq(devices.id, uiProfileAssignments.deviceId))
      .orderBy(asc(uiProfileAssignments.scope), asc(uiProfileAssignments.createdAt));
    return { assignments: rows.map((r) => ({ ...r.a, profileName: r.profileName, userName: r.userName, deviceName: r.deviceName })), canEdit: p.role === 'org_admin' };
  }));

  const assignBody = z.discriminatedUnion('scope', [
    z.object({ scope: z.literal('org'), profileId: z.uuid() }),
    z.object({ scope: z.literal('role'), profileId: z.uuid(), role: z.enum(ROLES) }),
    z.object({ scope: z.literal('user'), profileId: z.uuid(), userId: z.uuid() }),
    z.object({ scope: z.literal('device'), profileId: z.uuid(), deviceId: z.uuid() }),
  ]);

  const matcher = (b: z.infer<typeof assignBody>) => (d: { deviceId: string; userId: string; role: Role }) =>
    b.scope === 'org' ? true : b.scope === 'role' ? d.role === b.role : b.scope === 'user' ? d.userId === b.userId : d.deviceId === b.deviceId;

  /** Create or replace the assignment for a target (one per org / role / user / device). */
  app.post('/ui-profile-assignments', auth, async (req, reply) => tenant(ctx, req, async (tx, p) => {
    requireEdit(p);
    const b = assignBody.parse(req.body);
    const [pr] = await tx.select().from(uiProfiles).where(and(eq(uiProfiles.id, b.profileId), eq(uiProfiles.orgId, p.orgId)));
    if (!pr || pr.archivedAt) throw badRequest('invalid_profile', 'Profile not found in this organization');
    if (b.scope === 'user') {
      const [m] = await tx.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.userId, b.userId), eq(memberships.orgId, p.orgId)));
      if (!m) throw badRequest('invalid_user', 'User is not a member of this organization');
    }
    if (b.scope === 'device') {
      const [d] = await tx.select({ id: devices.id }).from(devices).where(and(eq(devices.id, b.deviceId), eq(devices.orgId, p.orgId)));
      if (!d) throw badRequest('invalid_device', 'Device is not registered to this organization');
    }
    const target = b.scope === 'org' ? undefined : b.scope === 'role' ? eq(uiProfileAssignments.role, b.role) : b.scope === 'user' ? eq(uiProfileAssignments.userId, b.userId) : eq(uiProfileAssignments.deviceId, b.deviceId);
    const [prev] = await tx.select().from(uiProfileAssignments).where(and(eq(uiProfileAssignments.scope, b.scope), target));
    if (prev) await tx.delete(uiProfileAssignments).where(eq(uiProfileAssignments.id, prev.id));
    const [a] = await tx.insert(uiProfileAssignments).values({
      orgId: p.orgId, profileId: b.profileId, scope: b.scope, role: b.scope === 'role' ? b.role : null, userId: b.scope === 'user' ? b.userId : null,
      deviceId: b.scope === 'device' ? b.deviceId : null, createdBy: p.userId,
    }).returning();
    await audit(tx, p, { orgId: p.orgId, action: prev ? 'ui_profile.assignment_replaced' : 'ui_profile.assigned', entityType: 'ui_profile', entityId: b.profileId, summary: `${pr.name} → ${b.scope}`, metadata: { ...b, previousProfileId: prev?.profileId ?? null }, ip: req.ip });
    const affected = await notify(tx, p.orgId, matcher(b), { profileId: b.profileId, reason: 'assignment' });
    return reply.code(prev ? 200 : 201).send({ assignment: a, replaced: !!prev, affectedDevices: affected.length });
  }));

  app.delete('/ui-profile-assignments/:id', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requireEdit(p);
    const { id } = idParam.parse(req.params);
    const [a] = await tx.delete(uiProfileAssignments).where(eq(uiProfileAssignments.id, id)).returning();
    if (!a) throw notFound('Assignment');
    await audit(tx, p, { orgId: p.orgId, action: 'ui_profile.unassigned', entityType: 'ui_profile', entityId: a.profileId, summary: a.scope, metadata: { scope: a.scope, role: a.role, userId: a.userId, deviceId: a.deviceId }, ip: req.ip });
    const b = (a.scope === 'org' ? { scope: 'org', profileId: a.profileId } : a.scope === 'role' ? { scope: 'role', profileId: a.profileId, role: a.role! } : a.scope === 'user' ? { scope: 'user', profileId: a.profileId, userId: a.userId! } : { scope: 'device', profileId: a.profileId, deviceId: a.deviceId! }) as z.infer<typeof assignBody>;
    const affected = await notify(tx, p.orgId, matcher(b), { profileId: a.profileId, reason: 'unassigned' });
    return { ok: true, affectedDevices: affected.length };
  }));

  /** "Which profile would this device / user get?" — preview of the precedence resolution. */
  app.get('/ui-profiles-effective', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requireRead(p);
    const q = z.object({ deviceId: z.uuid().optional(), userId: z.uuid().optional() }).parse(req.query);
    if (!q.deviceId && !q.userId) throw badRequest('subject_required', 'Pass deviceId or userId');
    let userId = q.userId ?? null;
    if (q.deviceId) {
      const [d] = await tx.select({ id: devices.id }).from(devices).where(eq(devices.id, q.deviceId));
      if (!d) throw notFound('Device');
      const [a] = await tx.select({ userId: deviceAssignments.userId }).from(deviceAssignments).where(and(eq(deviceAssignments.deviceId, q.deviceId), isNull(deviceAssignments.unassignedAt)));
      userId = a?.userId ?? userId;
    }
    let role: Role | null = null;
    if (userId) {
      const [m] = await tx.select({ role: memberships.role }).from(memberships).where(eq(memberships.userId, userId));
      if (!m && q.userId) throw notFound('Member');
      role = (m?.role as Role) ?? null;
    }
    return { subject: { deviceId: q.deviceId ?? null, userId, role }, effective: await effectiveProfile(tx, { deviceId: q.deviceId, userId, role }) };
  }));
}
