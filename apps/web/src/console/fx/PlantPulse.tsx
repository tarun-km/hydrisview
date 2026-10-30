'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Activity, ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { MEASURANDS, MEASURAND_DEFS } from '@hydris/domain';
import { useApi } from '@/lib/query';
import { ago } from '@/lib/format';
import { cx, SyntheticBadge } from '@/ui';
import type { HistoryResponse, SensorRow } from '@/console/alarms-telemetry/types';
import { DotMatrix } from './DotMatrix';
import { LiveWave } from './charts';
import { GlassTile, Ticker } from './motion';

const WINDOW_H = 6;

/**
 * Plant pulse: the live heartbeat of the key online instruments. Server history (last 6 h, downsampled) plus every new
 * reading the realtime stream brings in (the shell invalidates /sensors on telemetry.reading), so the wave re-flows live.
 */
export function PlantPulse({ className }: { className?: string }) {
  const q = useApi<{ sensors: SensorRow[] }>('/sensors', { refetchInterval: 15_000 });
  const picks = useMemo(() => {
    const live = (q.data?.sensors ?? []).filter((s) => s.method === 'continuous' && s.enabled && s.lastValue !== null);
    const rank = (s: SensorRow) => (s.openAlarms ? -100 : 0) + MEASURANDS.indexOf(s.measurand) + (s.freshness === 'live' ? 0 : 50);
    const seen = new Set<string>();
    return [...live].sort((a, b) => rank(a) - rank(b)).filter((s) => (seen.has(s.measurand) ? false : (seen.add(s.measurand), true))).slice(0, 4);
  }, [q.data]);
  const [sel, setSel] = useState<string | null>(null);
  const s = picks.find((p) => p.id === sel) ?? picks[0];

  return (
    <GlassTile as="section" aria-labelledby="pulse-title" className={cx('flex min-h-[340px] flex-col overflow-hidden !p-5 sm:!p-6', className)} tilt={2.5}>
      <span className="fx-scan" aria-hidden />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="pulse-title" className="flex items-center gap-2.5 text-[15px] text-text-2"><span className="fx-icon-ring !h-9 !w-9"><Activity size={16} aria-hidden /></span>Plant pulse<span className="dot pulse-dot bg-ok" aria-hidden /></h2>
        {picks.length > 1 && (
          <div role="tablist" aria-label="Instrument" className="flex flex-wrap gap-1 rounded-full border border-[var(--g-border)] bg-[var(--g-bg-inset)] p-1">
            {picks.map((p) => (
              <button key={p.id} role="tab" type="button" aria-selected={p.id === s?.id} onClick={() => setSel(p.id)}
                className={cx('relative h-8 rounded-full px-3 text-[12.5px] transition-colors', p.id === s?.id ? 'text-lime-ink' : 'text-text-2 hover:text-text')}>
                {p.id === s?.id && <motion.span layoutId="pulse-pill" className="absolute inset-0 rounded-full bg-lime" transition={{ type: 'spring', stiffness: 400, damping: 32 }} />}
                <span className="relative">{MEASURAND_DEFS[p.measurand].label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {s ? <Instrument key={s.id} s={s} /> : (
        <div className="grid flex-1 place-items-center text-center text-sm text-muted">{q.isLoading ? <span className="skeleton h-28 w-full rounded-2xl" /> : 'No online instruments reporting yet.'}</div>
      )}
      {picks.length > 1 && (
        <ul className="mt-4 grid grid-cols-2 gap-2 border-t border-[var(--g-border)] pt-4 sm:grid-cols-4">
          {picks.map((p) => {
            const def = MEASURAND_DEFS[p.measurand];
            const out = def.typicalRange && p.lastValue !== null && (p.lastValue < def.typicalRange[0] || p.lastValue > def.typicalRange[1]);
            return (
              <li key={p.id}>
                <button type="button" onClick={() => setSel(p.id)} className={cx('w-full rounded-2xl px-3 py-2 text-left transition-colors hover:bg-[var(--g-bg-inset)]', p.id === s?.id && 'bg-[var(--g-bg-inset)]')}>
                  <span className="block truncate text-[11.5px] uppercase tracking-[0.1em] text-muted">{p.assetTag ?? p.tag}</span>
                  <span className={cx('text-[19px] font-light', out && 'text-high-text')}><Ticker value={p.lastValue ?? 0} decimals={Math.min(2, def.decimals)} /></span>
                  <span className="ml-1 text-[12px] text-muted">{p.unit}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </GlassTile>
  );
}

function Instrument({ s }: { s: SensorRow }) {
  const def = MEASURAND_DEFS[s.measurand];
  const from = useMemo(() => new Date(Date.now() - WINDOW_H * 3600_000).toISOString(), []);
  const h = useApi<HistoryResponse>(`/telemetry/sensors/${s.id}/history?from=${encodeURIComponent(from)}&points=60`, { staleTime: 60_000 });
  // Readings that arrived after the history snapshot (via realtime invalidation of /sensors).
  const tail = useRef<{ t: string; v: number }[]>([]);
  const [, bump] = useState(0);
  useEffect(() => {
    if (s.lastValue === null || !s.lastTs) return;
    const last = tail.current[tail.current.length - 1];
    if (last?.t === s.lastTs) return;
    tail.current = [...tail.current, { t: s.lastTs, v: s.lastValue }].slice(-30);
    bump((n) => n + 1);
  }, [s.lastTs, s.lastValue]);
  const histEnd = h.data?.points.at(-1)?.t ?? '';
  const values = [...(h.data?.points.map((p) => p.v) ?? []), ...tail.current.filter((p) => p.t > histEnd).map((p) => p.v)];
  const series = values.length > 1 ? values : s.lastValue !== null ? [s.lastValue, s.lastValue] : [];
  const prev = series.length > 4 ? series[series.length - 5] : null;
  const trend = prev === null || s.lastValue === null ? 0 : Math.sign(Math.round((s.lastValue - prev) * 10 ** def.decimals));
  const out = def.typicalRange && s.lastValue !== null && (s.lastValue < def.typicalRange[0] || s.lastValue > def.typicalRange[1]);
  const shown = s.lastValue === null ? '--' : s.lastValue.toFixed(Math.min(2, def.decimals));

  return (
    <div className="mt-4 flex flex-1 flex-col">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href={`/console/telemetry/${s.id}`} className="group inline-flex items-end gap-2" aria-label={`${def.label} ${shown} ${s.unit}, open history`}>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span key={shown} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className={out ? 'text-high-text' : 'text-text'}>
                <DotMatrix value={shown} dot={6} gap={2.4} label="" />
              </motion.span>
            </AnimatePresence>
            <span className="mb-0.5 text-[15px] text-muted">{s.unit}</span>
          </Link>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-muted">
            <span className="text-text-2">{s.name}</span>·<span>{s.assetName ?? s.tag}</span>
            {s.lastSource === 'simulator' && <SyntheticBadge />}
          </p>
        </div>
        <div className="text-right text-[12.5px]">
          <div className={cx('inline-flex items-center gap-1 rounded-full px-2.5 py-1', out ? 'bg-[rgb(255_159_28/0.14)] text-high-text' : 'bg-[rgb(0_254_33/0.08)] text-ok-text')}>
            {trend > 0 ? <ArrowUpRight size={14} aria-hidden /> : trend < 0 ? <ArrowDownRight size={14} aria-hidden /> : <Minus size={14} aria-hidden />}
            {out ? 'Outside typical range' : 'Within typical range'}
          </div>
          <div className="mt-1.5 text-muted">{def.typicalRange ? `typical ${def.typicalRange[0]}–${def.typicalRange[1]} ${s.unit}` : ''}{s.lastTs ? ` · ${ago(s.lastTs)}` : ''}</div>
        </div>
      </div>
      <div className="relative mt-4 min-h-[120px] flex-1">
        <LiveWave values={series} band={def.typicalRange ?? null} className="absolute inset-0 h-full w-full" color={out ? '#ff9f1c' : 'var(--g-curve)'} />
        <span className="absolute bottom-1 left-0 text-[11px] text-muted">−{WINDOW_H} h</span>
        <span className="absolute bottom-1 right-0 text-[11px] text-muted">now</span>
      </div>
    </div>
  );
}
