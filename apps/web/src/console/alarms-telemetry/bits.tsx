'use client';

import { ClipboardPen, FlaskConical, Radio } from 'lucide-react';
import type { AlarmCondition, Freshness, MeasurementMethod } from '@hydris/domain';
import { ago, fmtValue } from '@/lib/format';
import { Chip, FreshnessBadge, cx } from '@/ui';

const METHOD: Record<MeasurementMethod, { label: string; icon: React.ReactNode; title: string }> = {
  continuous: { label: 'Online', icon: <Radio size={13} strokeWidth={1.8} aria-hidden />, title: 'Continuous online instrument' },
  lab: { label: 'Lab result', icon: <FlaskConical size={13} strokeWidth={1.8} aria-hidden />, title: 'Laboratory determination from a sample. Not a live reading.' },
  manual: { label: 'Manual', icon: <ClipboardPen size={13} strokeWidth={1.8} aria-hidden />, title: 'Manually recorded reading. Not a live stream.' },
};

export function MethodChip({ method }: { method: MeasurementMethod }) {
  const m = METHOD[method];
  return <Chip tone="outline" title={m.title}>{m.icon}{m.label}</Chip>;
}

/**
 * Freshness for online instruments; for lab/manual values a static "sampled" badge so a
 * laboratory result never pulses like a live stream.
 */
export function ReadingStatus({ method, freshness, ts }: { method: MeasurementMethod; freshness: Freshness; ts: string | null }) {
  if (method === 'continuous') return <FreshnessBadge freshness={freshness} ts={ts} />;
  const color = freshness === 'no_data' ? 'var(--color-muted)' : freshness === 'stale' ? 'var(--color-high)' : freshness === 'delayed' ? 'var(--color-medium)' : 'var(--color-cobalt)';
  const text = freshness === 'no_data' ? 'No sample recorded' : freshness === 'stale' ? `Sample overdue · ${ago(ts)}` : `Sampled ${ago(ts)}`;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-text-2" title={ts ? `Sampled ${new Date(ts).toLocaleString()}` : 'No sample recorded'}>
      <span className="dot" style={{ background: color }} aria-hidden />
      {text}
    </span>
  );
}

/** Value + unit; missing data is "—" (never 0), stale values are dimmed and labelled. */
export function SensorValue({ value, unit, decimals, freshness, size = 'sm' }: { value: number | null; unit: string; decimals?: number; freshness: Freshness; size?: 'sm' | 'lg' }) {
  const missing = value === null || freshness === 'no_data';
  return (
    <div className="flex min-w-0 items-baseline gap-1.5">
      <span className={cx(size === 'lg' ? 't-kpi' : 't-kpi-sm', 'num', (missing || freshness === 'stale') && 'opacity-45')}>{missing ? '—' : fmtValue(value, undefined, decimals)}</span>
      <span className="text-sm opacity-60">{missing ? 'No data' : unit}</span>
      {!missing && freshness === 'stale' && <span className="sr-only">(stale, last known value)</span>}
    </div>
  );
}

export const CONDITION_SHORT: Record<AlarmCondition, string> = { high_high: 'HH', high: 'H', low: 'L', low_low: 'LL', stale: 'Stale' };
export const conditionTone = (c: AlarmCondition) => (c === 'high_high' || c === 'low_low' ? 'var(--color-critical)' : 'var(--color-high)');

export function fmtDuration(s: number): string {
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${+(s / 60).toFixed(1)} min`;
  if (s < 86400) return `${+(s / 3600).toFixed(1)} h`;
  return `${+(s / 86400).toFixed(1)} d`;
}

/** Exact local time on hover, relative time inline. */
export function When({ at, className }: { at: string | null; className?: string }) {
  if (!at) return <span className={className}>—</span>;
  return <time dateTime={at} title={new Date(at).toLocaleString()} className={className}>{ago(at)}</time>;
}
