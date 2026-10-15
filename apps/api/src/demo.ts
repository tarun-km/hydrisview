/**
 * Demo mode runtime (DEMO_MODE=true, or on Vercel without DATABASE_URL).
 *
 * Each (serverless) instance runs its own in-memory database seeded with the same
 * deterministic synthetic tenant. Because instances share nothing, demo mode relaxes a few
 * stateful checks so a user or a pair of glasses can be served by any instance:
 *
 * - user access tokens (12 h) are accepted when their refresh-session family is unknown on
 *   this instance (a family revoked on *this* instance is still rejected);
 * - `/auth/refresh` falls back to a signed `hg_demo` cookie when the refresh-token row is
 *   unknown here, and re-creates the session family locally;
 * - device tokens carry the assigned operator and site, and device refresh tokens are
 *   self-contained (HMAC-signed), so a device record + assignment is re-created lazily on an
 *   instance that never saw the pairing.
 *
 * Live-ness without cron: `DemoTicker.poke()` is called on every API request and on every
 * realtime poll; at most every 5 s it advances the running simulations by one step and feeds
 * the second site's instruments through the normal ingestion/alarm pipeline.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { SIM_STEP_SECONDS } from '@hydris/domain';
import type { Ctx } from './context';
import type { Database } from './db/client';
import { devices, sensors } from './db/schema';
import { withSystem, withTenant } from './db/tenant';
import { ingest } from './modules/telemetry';
import type { SimulationEngine } from './modules/simulation';
import { ALL_SIGNALS, DEMO_CONNECTED_DEVICE_ID, DEMO_ORG_ID, STP_SENSOR_TAGS, seedDemoShowcase, signalValue } from './seed/showcase';
import { demoId } from './seed/ids';

/** Seed the demo tenant into a freshly migrated database (idempotent). */
export async function bootDemo(database: Pick<Database, 'db'>): Promise<void> {
  const t = Date.now();
  await seedDemoShowcase(database.db);
  if (process.env.API_LOG === 'true' || process.env.NODE_ENV !== 'test') console.log(`[hydris] demo tenant ready in ${Date.now() - t} ms (sign in as tarun@hydris.ai)`);
}

// ------------------------------------------------------------------ lazy live data
export class DemoTicker {
  private last = 0;
  private running: Promise<void> | null = null;
  constructor(private ctx: Ctx, private minIntervalMs = SIM_STEP_SECONDS * 1000) {}

  /** Non-blocking: schedule a step when one is due. */
  poke(): void {
    if (this.running || Date.now() - this.last < this.minIntervalMs) return;
    this.last = Date.now();
    this.running = this.step().catch((e) => console.error('[demo] tick failed', e)).finally(() => (this.running = null));
  }

  /** Run one step now (tests). */
  async step(): Promise<void> {
    const engine = (this.ctx as Ctx & { simulation?: SimulationEngine }).simulation;
    if (engine) await engine.advanceAll();
    await withTenant(this.ctx.db, DEMO_ORG_ID, async (tx) => {
      const rows = await tx.select({ id: sensors.id, tag: sensors.tag }).from(sensors);
      if (!rows.length) return;
      const now = Date.now();
      const items = rows.filter((r) => STP_SENSOR_TAGS.includes(r.tag)).map((r) => ({
        sensorId: r.id, ts: new Date(now), value: signalValue(ALL_SIGNALS.find((g) => g.tag === r.tag)!, now), messageId: `demo-live:${r.tag}:${now}`,
      }));
      if (items.length) await ingest(this.ctx, tx, DEMO_ORG_ID, items, { source: 'simulator', isDemoOrg: true });
      // The pre-paired "Karthik" glasses are shown as connected.
      await tx.update(devices).set({ lastSeenAt: new Date(now) }).where(and(eq(devices.id, DEMO_CONNECTED_DEVICE_ID), eq(devices.status, 'active')));
    });
    await this.ctx.bus.flush();
  }
}

/** Look a device up in system context (used by the demo refresh path). */
export async function loadDevice(ctx: Ctx, id: string) {
  return withSystem(ctx.db, async (tx) => (await tx.select().from(devices).where(eq(devices.id, id)))[0]);
}

export { demoId };
export * from './core/demo-auth';
