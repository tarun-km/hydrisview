/**
 * Demo mode: named guest accounts.
 *
 * "Enter demo mode" asks for a name and creates a personal account in the demo tenant
 * (org admin, all sites) with its own copy of the owner's open inspections and maintenance
 * tasks, so paired glasses show that person's name and work.
 *
 * Ids are deterministic (same name → same account) and the name is kept in the shared demo
 * store, so any serverless instance can rebuild the account from a token's user id.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { inspections, maintenanceTasks, memberships, users } from '../db/schema';
import { demoId } from '../seed/ids';
import { DEMO_ORG_ID, DEMO_OWNER_ID } from '../seed/showcase';
import { demoShared } from './demo-shared';

const GUEST_TTL_S = 60 * 60 * 24 * 30;
const key = (uid: string) => `guest:${uid}`;

export const normalizeGuestName = (name: string) => name.normalize('NFKC').trim().replace(/\s+/g, ' ').slice(0, 40);
export const guestUserId = (name: string) => demoId('guest', normalizeGuestName(name).toLowerCase());

/** Create (idempotently) the guest account and its personal work in this instance's database. */
export async function createGuest(tx: Tx, rawName: string): Promise<{ id: string; name: string }> {
  const name = normalizeGuestName(rawName);
  const id = guestUserId(name);
  await demoShared().set(key(id), { name }, GUEST_TTL_S);
  await materializeGuest(tx, id, name);
  return { id, name };
}

/** If `userId` is a guest created on another instance, rebuild it here. Returns true when it exists now. */
export async function ensureGuest(tx: Tx, userId: string): Promise<boolean> {
  const [u] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId));
  if (u) return true;
  const g = await demoShared().get<{ name: string }>(key(userId));
  if (!g?.name || guestUserId(g.name) !== userId) return false;
  await materializeGuest(tx, userId, g.name);
  return true;
}

async function materializeGuest(tx: Tx, id: string, name: string) {
  const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.id, id));
  if (existing) return;
  await tx.insert(users).values({
    id, name, email: `guest-${id.slice(0, 8)}@demo.hydris.local`, defaultOrgId: DEMO_ORG_ID, emailVerifiedAt: new Date(), lastLoginAt: new Date(),
  }).onConflictDoNothing();
  await tx.insert(memberships).values({ id: demoId('membership-guest', id), orgId: DEMO_ORG_ID, userId: id, role: 'org_admin', title: 'Demo guest' }).onConflictDoNothing();

  // Personal copy of the owner's open work (deterministic ids → identical on every instance).
  const insp = await tx.select().from(inspections).where(and(eq(inspections.assignedTo, DEMO_OWNER_ID), inArray(inspections.status, ['scheduled'])));
  for (const r of insp) {
    await tx.insert(inspections).values({ ...r, id: demoId('guest-inspection', id, r.id), assignedTo: id, createdAt: new Date(), updatedAt: new Date() }).onConflictDoNothing();
  }
  const tasks = await tx.select().from(maintenanceTasks).where(and(eq(maintenanceTasks.assignedTo, DEMO_OWNER_ID), inArray(maintenanceTasks.status, ['open', 'assigned'])));
  for (const r of tasks) {
    await tx.insert(maintenanceTasks).values({
      ...r, id: demoId('guest-task', id, r.id), assignedTo: id, checklist: r.checklist.map((c) => ({ ...c, done: false, doneAt: null, doneBy: null })), createdAt: new Date(), updatedAt: new Date(),
    }).onConflictDoNothing();
  }
}
