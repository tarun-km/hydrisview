import { and, eq, inArray, lt } from 'drizzle-orm';
import type { Ctx } from './context';
import { pairingChallenges, simulationRuns } from './db/schema';
import { withSystem } from './db/tenant';
import { evaluateStaleRules } from './modules/alarms';
import type { SimulationEngine } from './modules/simulation';
import { pruneRealtimeEvents } from './core/events';
import { deliverOutbox } from './core/mailer';

const engineOf = (ctx: Ctx) => (ctx as Ctx & { simulation?: SimulationEngine }).simulation;

export function expirePairings(ctx: Ctx) {
  return withSystem(ctx.db, (tx) => tx.update(pairingChallenges).set({ status: 'expired' })
    .where(and(inArray(pairingChallenges.status, ['pending', 'approved']), lt(pairingChallenges.expiresAt, new Date()))));
}

export interface JobReport {
  staleRules: 'ok' | string;
  pairingExpiry: 'ok' | string;
  realtimePruned: number | string;
  simulationSteps: number | 'disabled' | string;
  mail?: { sent: number; failed: number } | 'disabled' | string;
}

const errText = (e: unknown) => `error: ${e instanceof Error ? e.message : String(e)}`;

/**
 * One pass of every background job. Used by the serverless cron route (Vercel Cron →
 * /api/cron); the long-running server schedules the same work with timers in startJobs.
 */
export async function runScheduledJobs(ctx: Ctx): Promise<JobReport> {
  const report: JobReport = { staleRules: 'ok', pairingExpiry: 'ok', realtimePruned: 0, simulationSteps: 'disabled' };
  await evaluateStaleRules(ctx).catch((e) => (report.staleRules = errText(e)));
  await expirePairings(ctx).catch((e) => (report.pairingExpiry = errText(e)));
  report.realtimePruned = await pruneRealtimeEvents(ctx.db).catch(errText);
  const engine = engineOf(ctx);
  if (engine && ctx.config.SIMULATOR_ENABLED === 'true') report.simulationSteps = await engine.advanceAll().catch(errText);
  report.mail = ctx.mailer ? await deliverOutbox(ctx.db, ctx.mailer, 50).catch(errText) : 'disabled';
  await ctx.bus.flush();
  return report;
}

/** Background jobs for the long-running server: data-freshness alarms, pairing expiry, resuming demo simulations. */
export function startJobs(ctx: Ctx): () => void {
  const stale = setInterval(() => evaluateStaleRules(ctx).catch((e) => console.error('[jobs] stale rules', e)), 30_000);
  const expire = setInterval(() => expirePairings(ctx).catch((e) => console.error('[jobs] pairing expiry', e)), 60_000);
  const mail = ctx.mailer ? setInterval(() => void deliverOutbox(ctx.db, ctx.mailer).catch(() => {}), 60_000) : null;
  const prune = ctx.bus.mode === 'db'
    ? setInterval(() => pruneRealtimeEvents(ctx.db).catch((e) => console.error('[jobs] realtime prune', e)), 3600_000)
    : null;
  // Simulations that were running when the server stopped are resumed from their last step.
  void withSystem(ctx.db, (tx) => tx.select().from(simulationRuns).where(eq(simulationRuns.status, 'running'))).then((runs) => {
    const engine = engineOf(ctx);
    if (!engine || ctx.config.SIMULATOR_ENABLED !== 'true') return;
    for (const r of runs) void engine.start(r.id, r.orgId, r.siteId, r.scenarioKey as never, r.step + 1);
  });
  return () => {
    clearInterval(stale);
    clearInterval(expire);
    if (prune) clearInterval(prune);
    if (mail) clearInterval(mail);
  };
}
