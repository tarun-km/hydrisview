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
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../core/errors';
import { requirePerm } from '../core/principal';
import { randomToken, sha256 } from '../core/crypto';
import { audit, sendMail } from '../core/services';
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
      const link = await createInvitation(tx, org!.id, req.platformUserId!, { email: body.admin.email, name: body.admin.name, role: 'org_admin', allSites: true, siteIds: [] });
      await audit(tx, { userId: req.platformUserId }, { orgId: org!.id, action: 'organization.created', entityType: 'organization', entityId: org!.id, summary: body.name });
      return { organization: org, adminInvitationLink: link };
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
    const [o] = await tx.select().from(organizations).where(eq(organizations.id, p.orgId));
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
  async function createInvitation(tx: Parameters<Parameters<typeof withSystem>[1]>[0], orgId: string, invitedBy: string, i: { email: string; name?: string; role: Role; allSites: boolean; siteIds: string[] }) {
    const raw = randomToken();
    await tx.update(invitations).set({ revokedAt: new Date() }).where(and(eq(invitations.orgId, orgId), sql`lower(${invitations.email}) = ${i.email}`, isNull(invitations.acceptedAt), isNull(invitations.revokedAt)));
    await tx.insert(invitations).values({ orgId, email: i.email, name: i.name, role: i.role, allSites: i.allSites, siteIds: i.siteIds, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + TTL.inviteMs), invitedBy });
    const link = `${ctx.config.PUBLIC_APP_URL}/invite/${raw}`;
    await sendMail(tx, i.email, 'You have been invited to Hydris', `You have been invited to join an organization on Hydris Field Glasses.\nAccept within 7 days: ${link}`);
    return link;
  }

  app.get('/members', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'member.read');
    const rows = await tx
      .select({
        membershipId: memberships.id, userId: users.id, name: users.name, email: users.email, role: memberships.role, status: memberships.status,
        allSites: memberships.allSites, title: memberships.title, lastLoginAt: users.lastLoginAt, mfaEnabled: users.mfaEnabled, createdAt: memberships.createdAt,
        siteIds: sql<string[]>`coalesce((select json_agg(ms.site_id) from membership_sites ms where ms.membership_id = ${memberships.id}), '[]'::json)`,
        devices: sql<number>`(select count(*)::int from device_assignments da join devices d on d.id = da.device_id where da.user_id = ${users.id} and da.unassigned_at is null and d.status = 'active')`,
        openInspections: sql<number>`(select count(*)::int from inspections i where i.assigned_to = ${users.id} and i.status in ('scheduled','in_progress','paused','rejected'))`,
        openTasks: sql<number>`(select count(*)::int from maintenance_tasks t where t.assigned_to = ${users.id} and t.status in ('open','assigned','in_progress','on_hold'))`,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.orgId, p.orgId))
      .orderBy(users.name);
    const pending = p.role === 'org_admin' || p.role === 'factory_manager'
      ? await tx.select({ id: invitations.id, email: invitations.email, name: invitations.name, role: invitations.role, expiresAt: invitations.expiresAt, createdAt: invitations.createdAt })
          .from(invitations).where(and(isNull(invitations.acceptedAt), isNull(invitations.revokedAt))).orderBy(desc(invitations.createdAt))
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
    const sessions = p.role === 'org_admin'
      ? await tx.select({ id: authSessions.familyId, createdAt: authSessions.createdAt, userAgent: authSessions.userAgent })
          .from(authSessions).where(and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt), isNull(authSessions.rotatedAt)))
      : [];
    return { member: { ...m, siteIds }, devices: assigned, inspections: recentInspections, tasks, sessions };
  }));

  app.post('/invitations', auth, async (req, reply) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'member.manage');
    const body = z.object({
      email: emailSchema, name: z.string().trim().max(120).optional(), role: z.enum(ROLES),
      allSites: z.boolean().default(true), siteIds: z.array(z.uuid()).max(200).default([]),
    }).parse(req.body);
    if (!assignableRoles(p.role).includes(body.role)) throw forbidden('You cannot grant that role');
    // Site-scoped managers can only invite into their own sites.
    if (!p.allSites && (body.allSites || body.siteIds.some((s) => !p.siteIds.includes(s)))) throw forbidden('You can only grant access to your own sites');
    if (!body.allSites && !body.siteIds.length) throw badRequest('sites_required', 'Select at least one site');
    if (body.siteIds.length) {
      const found = await tx.select({ id: sites.id }).from(sites).where(inArray(sites.id, body.siteIds));
      if (found.length !== body.siteIds.length) throw badRequest('invalid_sites');
    }
    const [existing] = await tx.select({ id: memberships.id }).from(memberships).innerJoin(users, eq(users.id, memberships.userId))
      .where(and(sql`lower(${users.email}) = ${body.email}`, eq(memberships.status, 'active')));
    if (existing) throw conflict('already_member', 'This person is already an active member');
    const link = await createInvitation(tx, p.orgId, p.userId, body);
    await audit(tx, p, { orgId: p.orgId, action: 'member.invited', entityType: 'invitation', summary: `${body.email} as ${body.role}`, metadata: { role: body.role } });
    // The link is also e-mailed; it is returned so administrators can share it when mail delivery is not configured.
    return reply.code(201).send({ invitationLink: link });
  }));

  app.delete('/invitations/:id', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'member.manage');
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const [inv] = await tx.update(invitations).set({ revokedAt: new Date() }).where(and(eq(invitations.id, id), isNull(invitations.acceptedAt))).returning();
    if (!inv) throw notFound('Invitation');
    await audit(tx, p, { orgId: p.orgId, action: 'member.invitation_revoked', entityType: 'invitation', entityId: id, summary: inv.email });
    return { ok: true };
  }));

  app.patch('/members/:userId', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'member.manage');
    const { userId } = z.object({ userId: z.uuid() }).parse(req.params);
    const body = z.object({
      role: z.enum(ROLES).optional(), title: z.string().trim().max(80).nullable().optional(),
      allSites: z.boolean().optional(), siteIds: z.array(z.uuid()).optional(),
      status: z.enum(['active', 'deactivated']).optional(),
    }).parse(req.body);
    if (userId === p.userId && (body.role || body.status)) throw forbidden('You cannot change your own role or status');
    const [m] = await tx.select().from(memberships).where(eq(memberships.userId, userId));
    if (!m) throw notFound('Member');
    const allowed = assignableRoles(p.role);
    if (!allowed.includes(m.role) || (body.role && !allowed.includes(body.role))) throw forbidden('You cannot manage members with that role');
    if (!p.allSites && (body.allSites || body.siteIds?.some((s) => !p.siteIds.includes(s)))) throw forbidden('You can only grant access to your own sites');
    await tx.update(memberships).set({
      role: body.role, title: body.title, allSites: body.allSites, status: body.status,
      deactivatedAt: body.status === 'deactivated' ? new Date() : body.status === 'active' ? null : undefined, updatedAt: new Date(),
    }).where(eq(memberships.id, m.id));
    if (body.siteIds) {
      await tx.delete(membershipSites).where(eq(membershipSites.membershipId, m.id));
      if (body.siteIds.length) await tx.insert(membershipSites).values(body.siteIds.map((siteId) => ({ membershipId: m.id, siteId, orgId: p.orgId })));
    }
    if (body.status === 'deactivated') {
      // Deactivation takes effect immediately: end the member's sessions and unassign their glasses.
      // auth_sessions is not tenant-partitioned; update it within this transaction (no nested transaction).
      await tx.update(authSessions).set({ revokedAt: new Date() }).where(and(eq(authSessions.userId, userId), eq(authSessions.orgId, p.orgId), isNull(authSessions.revokedAt)));
      const active = await tx.select().from(deviceAssignments).where(and(eq(deviceAssignments.userId, userId), isNull(deviceAssignments.unassignedAt)));
      for (const a of active) {
        await tx.update(deviceAssignments).set({ unassignedAt: new Date(), reason: 'member deactivated' }).where(eq(deviceAssignments.id, a.id));
        await tx.update(devices).set({ sessionVersion: sql`${devices.sessionVersion} + 1`, updatedAt: new Date() }).where(eq(devices.id, a.deviceId));
        ctx.bus.publish({ type: 'device.context_changed', orgId: p.orgId, deviceIds: [a.deviceId], payload: { reason: 'operator_deactivated' } });
      }
    }
    await audit(tx, p, { orgId: p.orgId, action: body.status === 'deactivated' ? 'member.deactivated' : 'member.updated', entityType: 'membership', entityId: m.id, metadata: body });
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
