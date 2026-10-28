import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { canReceive } from '../src/modules/realtime.js';
import { latestEventId, pruneRealtimeEvents, readEventsSince } from '../src/core/events.js';
import { realtimeEvents } from '../src/db/schema.js';
import { withSystem, withTenant } from '../src/db/tenant.js';
import { runScheduledJobs } from '../src/jobs.js';
import { as, harness, type Harness } from './helpers.js';

// Serverless realtime: events persist to realtime_events and are read back by id cursor.
let h: Harness;
before(async () => {
  h = await harness({ REALTIME_MODE: 'db', SERVERLESS: '1' });
});
after(async () => {
  await h.app.close();
  await h.database.close();
});

test('db mode: published events are persisted after the request and filtered per principal', async () => {
  assert.equal(h.ctx.bus.mode, 'db');
  const head = await latestEventId(h.database.db);
  const mgr = await as(h.app, 'manager');
  // Publish from inside a request-like flow, then flush as the onSend hook would.
  h.ctx.bus.publish({ type: 'alarm.updated', orgId: h.demo.orgId, siteId: h.demo.siteId, permission: 'alarm.read', payload: { id: 'x' } });
  h.ctx.bus.publish({ type: 'notification.created', orgId: h.demo.orgId, userIds: ['00000000-0000-0000-0000-000000000000'], payload: {} });
  await h.ctx.bus.flush();
  const evs = await readEventsSince(h.database.db, head, h.demo.orgId);
  assert.deepEqual(evs.map((e) => e.type), ['alarm.updated', 'notification.created']);
  assert.ok(evs[0]!.id > head);
  const me = await mgr.req('GET', '/api/auth/me');
  assert.equal(me.statusCode, 200);
  // Same canReceive rules as the in-memory hub.
  const p = { kind: 'user', userId: h.demo.users.manager!, orgId: h.demo.orgId, role: 'admin', allSites: true, siteIds: [], isDemoOrg: true, isPlatformAdmin: false } as never;
  assert.equal(canReceive(p, evs[0]!), true);
  assert.equal(canReceive(p, evs[1]!), false);
});

test('db mode: realtime_events is not visible in tenant context (system only)', async () => {
  const rows = await withTenant(h.database.db, h.demo.orgId, (tx) => tx.select().from(realtimeEvents));
  assert.equal(rows.length, 0);
});

test('db mode: cron job pass prunes old events and reports each job', async () => {
  await withSystem(h.database.db, (tx) => tx.insert(realtimeEvents).values({ orgId: h.demo.orgId, type: 'old', createdAt: new Date(Date.now() - 2 * 24 * 3600_000) }));
  const report = await runScheduledJobs(h.ctx);
  assert.equal(report.staleRules, 'ok');
  assert.equal(report.pairingExpiry, 'ok');
  assert.ok(typeof report.realtimePruned === 'number' && report.realtimePruned >= 1);
  assert.equal(await pruneRealtimeEvents(h.database.db), 0);
});
