import { and, inArray, lt } from 'drizzle-orm';
import type { Ctx } from './context.js';
import { pairingChallenges, simulationRuns } from './db/schema.js';
import { withSystem } from './db/tenant.js';
import { evaluateStaleRules } from './modules/alarms.js';
import { eq } from 'drizzle-orm';
import type { SimulationEngine } from './modules/simulation.js';

/** Background jobs: data-freshness alarms, pairing expiry, resuming demo simulations. */
export function startJobs(ctx: Ctx): () => void {
  const stale = setInterval(() => evaluateStaleRules(ctx).catch((e) => console.error('[jobs] stale rules', e)), 30_000);
  const expire = setInterval(
    () => withSystem(ctx.db, (tx) => tx.update(pairingChallenges).set({ status: 'expired' })
      .where(and(inArray(pairingChallenges.status, ['pending', 'approved']), lt(pairingChallenges.expiresAt, new Date())))).catch((e) => console.error('[jobs] pairing expiry', e)),
    60_000,
  );
  // Simulations that were running when the server stopped are resumed from their last step.
  void withSystem(ctx.db, (tx) => tx.select().from(simulationRuns).where(eq(simulationRuns.status, 'running'))).then((runs) => {
    const engine = (ctx as Ctx & { simulation?: SimulationEngine }).simulation;
    if (!engine || ctx.config.SIMULATOR_ENABLED !== 'true') return;
    for (const r of runs) engine.start(r.id, r.orgId, r.siteId, r.scenarioKey as never, r.step + 1);
  });
  return () => {
    clearInterval(stale);
    clearInterval(expire);
  };
}
