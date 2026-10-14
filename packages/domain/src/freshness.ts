/**
 * Data freshness. A reading is only meaningful together with when it was observed.
 * Missing data is reported as `no_data`, never as a zero value.
 */
export type Freshness = 'live' | 'delayed' | 'stale' | 'no_data';

export const FRESHNESS_LABELS: Record<Freshness, string> = {
  live: 'Live',
  delayed: 'Delayed',
  stale: 'Stale',
  no_data: 'No data',
};

/**
 * live:    observed within 2x the expected interval
 * delayed: within 5x the expected interval
 * stale:   older than that - values must be visibly marked and excluded from health roll-ups
 */
export function freshness(lastTs: Date | string | null | undefined, expectedIntervalS: number, now: Date = new Date()): Freshness {
  if (!lastTs) return 'no_data';
  const t = typeof lastTs === 'string' ? Date.parse(lastTs) : lastTs.getTime();
  if (!Number.isFinite(t)) return 'no_data';
  const ageS = Math.max(0, (now.getTime() - t) / 1000);
  const interval = Math.max(1, expectedIntervalS);
  if (ageS <= interval * 2) return 'live';
  if (ageS <= interval * 5) return 'delayed';
  return 'stale';
}

/** Lab/manual parameters are sampled infrequently; freshness for them is measured in days, not seconds. */
export function staleAfterSeconds(expectedIntervalS: number): number {
  return Math.max(1, expectedIntervalS) * 5;
}
