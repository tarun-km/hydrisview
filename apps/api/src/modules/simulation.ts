import type { FastifyInstance } from 'fastify';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { SCENARIOS, SCENARIO_KEYS, SIM_STEP_SECONDS, scenarioFrame, type ScenarioEvent, type ScenarioKey } from '@hydris/domain';
import type { Ctx } from '../context';
import { authenticate, tenant } from '../context';
import { assets, deviceAssignments, devices, inspectionTemplates, maintenanceTasks, memberships, organizations, sensors, simulationRuns, sites, users } from '../db/schema';
import type { Tx } from '../db/client';
import { withSystem, withTenant } from '../db/tenant';
import { conflict, forbidden, notFound } from '../core/errors';
import { requirePerm } from '../core/principal';
import { audit } from '../core/services';
import { ingest } from './telemetry';
import { createInspection } from './inspections';

/**
 * Demo-tenant simulator. Runs deterministic scenarios through the normal ingestion
 * pipeline with source=simulator, which the pipeline refuses for non-demo tenants.
 */
export class SimulationEngine {
  private timers = new Map<string, NodeJS.Timeout>();
  constructor(private ctx: Ctx) {}

  isRunning(runId: string) {
    return this.timers.has(runId);
  }

  /**
   * Start ticking a run. Returns the first tick. In serverless mode no timer is kept
   * (instances freeze between requests): only the first step is applied here and the
   * cron job (`runScheduledJobs`) advances running runs one step per invocation.
   */
  start(runId: string, orgId: string, siteId: string, scenario: ScenarioKey, startStep = 0): Promise<void> {
    this.stop(runId);
    let step = startStep;
    const tick = async () => {
      try {
        const done = await withTenant(this.ctx.db, orgId, (tx) => this.applyStep(tx, runId, orgId, siteId, scenario, step));
        step++;
        if (done) this.stop(runId);
      } catch (e) {
        console.error('[simulation] tick failed', e);
      }
    };
    const first = tick();
    if (!this.ctx.config.serverless) this.timers.set(runId, setInterval(tick, SIM_STEP_SECONDS * 1000));
    return first;
  }

  /** Serverless: advance every running demo simulation by exactly one step. */
  async advanceAll(): Promise<number> {
    const runs = await withSystem(this.ctx.db, (tx) => tx.select().from(simulationRuns).where(eq(simulationRuns.status, 'running')));
    let n = 0;
    for (const r of runs) {
      try {
        await withTenant(this.ctx.db, r.orgId, (tx) => this.applyStep(tx, r.id, r.orgId, r.siteId, r.scenarioKey as ScenarioKey, r.step + 1));
        n++;
      } catch (e) {
        console.error('[simulation] step failed', r.id, e);
      }
    }
    return n;
  }

  stop(runId: string) {
    const t = this.timers.get(runId);
    if (t) clearInterval(t);
    this.timers.delete(runId);
  }

  stopAll() {
    for (const id of [...this.timers.keys()]) this.stop(id);
  }

  /** Apply one scenario step. Exposed for deterministic tests. Returns true when the scenario ended. */
  async applyStep(tx: Tx, runId: string, orgId: string, siteId: string, scenario: ScenarioKey, step: number): Promise<boolean> {
    const [run] = await tx.select().from(simulationRuns).where(eq(simulationRuns.id, runId));
    if (!run || run.status !== 'running') return true;
    // Normal operations is the continuous baseline: it loops instead of ending.
    const loops = scenario === 'normal_operations';
    const frame = scenarioFrame(scenario, loops ? step % SCENARIOS[scenario].steps : step);
    const rows = await tx.select({ id: sensors.id, tag: sensors.tag }).from(sensors).where(and(eq(sensors.siteId, siteId), inArray(sensors.tag, Object.keys(frame.values))));
    const ts = new Date();
    const items = rows.filter((r) => frame.values[r.tag] !== null && frame.values[r.tag] !== undefined).map((r) => ({ sensorId: r.id, ts, value: frame.values[r.tag]!, messageId: `sim:${runId}:${step}:${r.tag}` }));
    if (items.length) await ingest(this.ctx, tx, orgId, items, { source: 'simulator', isDemoOrg: true });
    for (const ev of frame.events) await this.applyEvent(tx, orgId, siteId, ev);
    const last = !loops && step >= SCENARIOS[scenario].steps - 1;
    await tx.update(simulationRuns).set({ step, status: last ? 'completed' : 'running', stoppedAt: last ? new Date() : null }).where(eq(simulationRuns.id, runId));
    this.ctx.bus.publish({ type: 'simulation.step', orgId, siteId, permission: 'telemetry.read', payload: { runId, scenario, step, events: frame.events } });
    return last;
  }

  private async applyEvent(tx: Tx, orgId: string, siteId: string, ev: ScenarioEvent) {
    const operator = await this.demoOperator(tx);
    if (ev.type === 'assign_inspection' && operator) {
      const [asset] = await tx.select().from(assets).where(and(eq(assets.siteId, siteId), eq(assets.tag, ev.assetTag)));
      const [tpl] = await tx.select().from(inspectionTemplates).where(eq(inspectionTemplates.key, ev.templateKey));
      if (asset && tpl) await createInspection(this.ctx, tx, { orgId, userId: null, system: true }, { templateId: tpl.id, assetId: asset.id, assignedTo: operator, dueAt: new Date(Date.now() + 2 * 3600_000), synthetic: true });
    } else if (ev.type === 'assign_maintenance' && operator) {
      const [asset] = await tx.select().from(assets).where(and(eq(assets.siteId, siteId), eq(assets.tag, ev.assetTag)));
      const [t] = await tx.insert(maintenanceTasks).values({
        orgId, siteId, assetId: asset?.id, title: ev.title, kind: 'preventive', priority: ev.priority, status: 'assigned', assignedTo: operator, synthetic: true,
        checklist: [
          { id: 'iso', label: 'Isolate and lock out the pump', done: false },
          { id: 'diaph', label: 'Inspect diaphragm for cracks or swelling', done: false },
          { id: 'valves', label: 'Check suction and discharge valves', done: false },
          { id: 'test', label: 'Restore and verify dosing rate', done: false },
        ],
      }).returning();
      this.ctx.bus.publish({ type: 'maintenance.updated', orgId, siteId, permission: 'maintenance.read', payload: { id: t!.id, status: t!.status } });
    } else if (ev.type === 'asset_offline') {
      const [a] = await tx.update(assets).set({ status: ev.offline ? 'down' : 'operational', updatedAt: new Date() }).where(and(eq(assets.siteId, siteId), eq(assets.tag, ev.assetTag))).returning();
      if (a) this.ctx.bus.publish({ type: 'asset.updated', orgId, siteId, permission: 'asset.read', payload: { id: a.id, status: a.status } });
    } else if (ev.type === 'reassign_device') {
      const ops = await tx.select({ userId: memberships.userId }).from(memberships).where(and(eq(memberships.role, 'operator'), eq(memberships.status, 'active'))).orderBy(asc(memberships.createdAt));
      const sims = await tx.select().from(devices).where(and(eq(devices.kind, 'simulator'), eq(devices.status, 'active')));
      for (const d of sims) {
        const [cur] = await tx.select().from(deviceAssignments).where(and(eq(deviceAssignments.deviceId, d.id), isNull(deviceAssignments.unassignedAt)));
        const next = ops.find((o) => o.userId !== cur?.userId);
        if (!next) continue;
        if (cur) await tx.update(deviceAssignments).set({ unassignedAt: new Date(), reason: 'simulated handover' }).where(eq(deviceAssignments.id, cur.id));
        await tx.insert(deviceAssignments).values({ orgId, deviceId: d.id, userId: next.userId, reason: 'simulated handover' });
        await tx.update(devices).set({ sessionVersion: d.sessionVersion + 1 }).where(eq(devices.id, d.id));
        await audit(tx, { label: 'simulator' }, { orgId, action: 'device.reassigned', entityType: 'device', entityId: d.id, summary: d.name, metadata: { from: cur?.userId, to: next.userId, simulated: true } });
        this.ctx.bus.publish({ type: 'device.context_changed', orgId, deviceIds: [d.id], payload: { reason: 'reassigned' } });
      }
    }
    // glasses_network and note events are consumed by the browser simulator from the simulation.step event.
  }

  private async demoOperator(tx: Tx): Promise<string | null> {
    const [op] = await tx.select({ id: users.id }).from(memberships).innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.role, 'operator'), eq(memberships.status, 'active'))).orderBy(asc(memberships.createdAt)).limit(1);
    return op?.id ?? null;
  }
}

export async function simulationRoutes(app: FastifyInstance, ctx: Ctx) {
  const engine = new SimulationEngine(ctx);
  (ctx as Ctx & { simulation?: SimulationEngine }).simulation = engine;
  app.addHook('onClose', async () => engine.stopAll());
  const auth = { preHandler: authenticate(ctx) };

  app.get('/simulation', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    const [org] = await tx.select({ isDemo: organizations.isDemo }).from(organizations).where(eq(organizations.id, p.orgId));
    const runs = await tx.select().from(simulationRuns).where(eq(simulationRuns.status, 'running'));
    return {
      available: !!org?.isDemo && ctx.config.SIMULATOR_ENABLED === 'true', canControl: p.kind === 'user' && org?.isDemo && p.role === 'admin',
      scenarios: SCENARIO_KEYS.map((k) => ({ key: k, title: SCENARIOS[k].title, summary: SCENARIOS[k].summary, expected: SCENARIOS[k].expected, steps: SCENARIOS[k].steps })),
      stepSeconds: SIM_STEP_SECONDS,
      running: runs.map((r) => ({ ...r, live: ctx.config.serverless || engine.isRunning(r.id) })),
    };
  }));

  app.post('/simulation/start', auth, async (req, reply) => {
    const body = z.object({ scenario: z.enum(SCENARIO_KEYS), siteId: z.uuid() }).parse(req.body);
    const run = await tenant(ctx, req, async (tx, p) => {
      requirePerm(p, 'simulation.control');
      if (!p.isDemoOrg) throw forbidden('Simulation is only available in demo organizations');
      if (ctx.config.SIMULATOR_ENABLED !== 'true') throw forbidden('Simulator is disabled on this server');
      const [site] = await tx.select().from(sites).where(eq(sites.id, body.siteId));
      if (!site) throw notFound('Site');
      const running = await tx.select().from(simulationRuns).where(and(eq(simulationRuns.siteId, body.siteId), eq(simulationRuns.status, 'running')));
      for (const r of running) {
        engine.stop(r.id);
        await tx.update(simulationRuns).set({ status: 'stopped', stoppedAt: new Date() }).where(eq(simulationRuns.id, r.id));
      }
      const [r] = await tx.insert(simulationRuns).values({ orgId: p.orgId, siteId: body.siteId, scenarioKey: body.scenario, startedBy: p.userId }).returning();
      await audit(tx, p, { orgId: p.orgId, action: 'simulation.started', entityType: 'simulation', entityId: r!.id, summary: SCENARIOS[body.scenario].title });
      return r!;
    });
    const first = engine.start(run.id, run.orgId, run.siteId, body.scenario);
    if (ctx.config.serverless) await first; // the instance may freeze right after responding
    return reply.code(201).send({ run });
  });

  app.post('/simulation/stop', auth, async (req) => tenant(ctx, req, async (tx, p) => {
    requirePerm(p, 'simulation.control');
    const runs = await tx.select().from(simulationRuns).where(eq(simulationRuns.status, 'running'));
    if (!runs.length) throw conflict('not_running', 'No simulation is running');
    for (const r of runs) {
      engine.stop(r.id);
      await tx.update(simulationRuns).set({ status: 'stopped', stoppedAt: new Date() }).where(eq(simulationRuns.id, r.id));
      await audit(tx, p, { orgId: p.orgId, action: 'simulation.stopped', entityType: 'simulation', entityId: r.id });
    }
    return { ok: true };
  }));
}
