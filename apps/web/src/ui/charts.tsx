'use client';

/**
 * Hydris infographic kit (SolaFlux / Trivi / Usechannel language): thin microcharts, rings, hatched tracks.
 * Every chart:
 *  - reads colours from CSS variables (re-themes with light/dark, no JS),
 *  - is an accessible image (role="img" + aria-label) and can render a screen-reader data table (`table` prop),
 *  - renders an explicit empty state instead of inventing numbers.
 */
import { useId, useMemo, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export interface Datum { key: string; label: string; value: number; color: string; hatch?: boolean }

const pct = (v: number, total: number) => (total ? Math.round((v / total) * 100) : 0);
const fmt = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 1 });
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Screen-reader data table (visually hidden) so every chart has a text equivalent. */
export function SrTable({ caption, head, rows }: { caption: string; head: [string, string]; rows: [ReactNode, ReactNode][] }) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead><tr><th scope="col">{head[0]}</th><th scope="col">{head[1]}</th></tr></thead>
      <tbody>{rows.map(([a, b], i) => <tr key={i}><th scope="row">{a}</th><td>{b}</td></tr>)}</tbody>
    </table>
  );
}

/** Small legend with colour swatches, optional values and percentages. */
export function Legend({ data, total, className, showPct = true }: { data: Datum[]; total?: number; className?: string; showPct?: boolean }) {
  const t = total ?? data.reduce((a, d) => a + d.value, 0);
  return (
    <ul className={clsx('chart-legend', className)} aria-hidden>
      {data.map((d) => (
        <li key={d.key}>
          <span className={clsx('h-2.5 w-2.5 flex-none rounded-[3px]', d.hatch && 'hatch')} style={{ background: d.color }} />
          <span>{d.label}</span>
          <span className="num font-medium text-text">{fmt(d.value)}</span>
          {showPct && t > 0 && <span className="num text-muted">{pct(d.value, t)}%</span>}
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------ Sparkline (existing)
/** Minimal sparkline for KPI islands (no axes; the value and unit are shown next to it). */
export function Sparkline({ values, stroke = 'var(--color-lime)', height = 40, ariaLabel }: { values: (number | null)[]; stroke?: string; height?: number; ariaLabel: string }) {
  const pts = values.filter((v): v is number => v !== null);
  if (pts.length < 2) return <div style={{ height }} className="grid place-items-center text-xs text-muted">no trend yet</div>;
  const min = Math.min(...pts), max = Math.max(...pts);
  const span = max - min || 1;
  const w = 120;
  const d = values.map((v, i) => (v === null ? null : `${(i / (values.length - 1)) * w},${height - 4 - ((v - min) / span) * (height - 8)}`)).filter(Boolean).join(' L');
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" role="img" aria-label={ariaLabel} className="w-full" style={{ height }}>
      <path d={`M${d}`} fill="none" stroke={stroke} strokeWidth={1.8} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

// ------------------------------------------------------------------ BarStrip (existing)
/** Thin vertical bars (SolaFlux microchart) - used for alarm frequency per day. The peak bar is highlighted. */
export function BarStrip({ data, height = 64, highlight = 'var(--color-orange)', ariaLabel }: { data: { label: string; value: number }[]; height?: number; highlight?: string; ariaLabel: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const peak = Math.max(...data.map((d) => d.value));
  return (
    <div role="img" aria-label={ariaLabel} className="relative flex items-end gap-[6px]" style={{ height }}>
      <span aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-current opacity-30" />
      {data.map((d, i) => (
        <div key={i} className="group relative flex h-full flex-1 flex-col items-center justify-end" title={`${d.label}: ${d.value}`}>
          <div className="chart-bar w-[3px] rounded-full group-hover:w-[5px]"
            style={{ height: d.value ? `${Math.max(8, (d.value / max) * 100)}%` : 4, background: d.value === peak && d.value > 0 ? highlight : 'currentColor', opacity: d.value ? 1 : 0.45 }} />
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ Sparkbars
/**
 * Compact vertical bars with a hover read-out (Trivi bars). The last bar can be emphasised ("today"),
 * the peak is highlighted. Zero values show a stub so the time axis stays readable.
 */
export function Sparkbars({ data, height = 72, color = 'var(--color-text-2)', highlight = 'var(--color-signal)', emphasise = 'peak', ariaLabel, table, axis }: {
  data: { label: string; value: number }[]; height?: number; color?: string; highlight?: string; emphasise?: 'peak' | 'last' | 'none'; ariaLabel: string; table?: boolean;
  axis?: [ReactNode, ReactNode];
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const peak = data.reduce((m, d, i) => (d.value > (data[m]?.value ?? -1) ? i : m), 0);
  const em = emphasise === 'last' ? data.length - 1 : emphasise === 'peak' && (data[peak]?.value ?? 0) > 0 ? peak : -1;
  const shown = hover ?? em;
  return (
    <div>
      <div className="mb-1 flex h-4 items-center justify-end text-[11.5px] text-muted num" aria-hidden>
        {shown >= 0 && data[shown] && <span><span className="font-medium text-text">{fmt(data[shown]!.value)}</span> · {data[shown]!.label}</span>}
      </div>
      <div role="img" aria-label={ariaLabel} className="relative flex items-end gap-[3px] sm:gap-1" style={{ height }} onMouseLeave={() => setHover(null)}>
        <span aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-line-2" />
        {data.map((d, i) => (
          <div key={i} className="relative flex h-full flex-1 items-end" onMouseEnter={() => setHover(i)}>
            <div className="chart-bar w-full rounded-t-[4px] rounded-b-[1px]"
              style={{ height: d.value ? `${Math.max(6, (d.value / max) * 100)}%` : 3, background: i === em || i === hover ? highlight : color, opacity: d.value ? (hover === null || hover === i ? 1 : 0.55) : 0.35 }} />
          </div>
        ))}
      </div>
      {axis && <div className="mt-1.5 flex justify-between text-[11px] text-muted" aria-hidden><span>{axis[0]}</span><span>{axis[1]}</span></div>}
      {table && <SrTable caption={ariaLabel} head={['Period', 'Count']} rows={data.map((d) => [d.label, d.value])} />}
    </div>
  );
}

// ------------------------------------------------------------------ Gauge (existing semi-circle)
/** Semi-circular gauge (SolaFlux CO2 / Ambient sensor) with explicit value + unit. */
export function Gauge({ value, min = 0, max = 100, label, unit, tone = 'var(--color-orange)', size = 132 }: { value: number | null; min?: number; max?: number; label: string; unit?: string; tone?: string; size?: number }) {
  const r = size / 2 - 8;
  const frac = value === null ? 0 : clamp01((value - min) / (max - min || 1));
  const arc = (f: number) => {
    const a = Math.PI * (1 - f);
    return `${size / 2 + r * Math.cos(a)},${size / 2 - r * Math.sin(a)}`;
  };
  return (
    <svg viewBox={`0 0 ${size} ${size / 2 + 6}`} width={size} role="img" aria-label={`${label}: ${value ?? 'no data'} ${unit ?? ''}`}>
      <path d={`M${arc(0)} A${r},${r} 0 0 1 ${arc(1)}`} fill="none" className="chart-track" strokeWidth={6} strokeLinecap="round" />
      {value !== null && <path d={`M${arc(0)} A${r},${r} 0 0 1 ${arc(frac)}`} fill="none" stroke={tone} strokeWidth={6} strokeLinecap="round" />}
    </svg>
  );
}

// ------------------------------------------------------------------ RadialGauge (ring)
/**
 * 270° ring gauge with the value in the centre. Optional band markers (e.g. alarm limits) are drawn as ticks on the ring.
 * `value === null` renders the empty track with an em dash — never a fake zero.
 */
export function RadialGauge({ value, min = 0, max = 100, label, display, unit, sub, tone = 'var(--color-signal)', size = 148, thickness = 10, marks = [], ariaLabel, band }: {
  value: number | null; min?: number; max?: number; label?: ReactNode; display?: ReactNode; unit?: string; sub?: ReactNode; tone?: string; size?: number; thickness?: number;
  marks?: { value: number; color: string; label: string }[]; ariaLabel: string; band?: [number, number];
}) {
  const r = (size - thickness) / 2 - 2;
  const c = size / 2;
  const SWEEP = 270;
  const start = 135; // degrees, clockwise from +x
  const toXY = (deg: number, rr = r) => [c + rr * Math.cos((deg * Math.PI) / 180), c + rr * Math.sin((deg * Math.PI) / 180)] as const;
  const arcPath = (f0: number, f1: number) => {
    const a0 = start + SWEEP * clamp01(f0), a1 = start + SWEEP * clamp01(f1);
    const [x0, y0] = toXY(a0), [x1, y1] = toXY(a1);
    return `M${x0},${y0} A${r},${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1},${y1}`;
  };
  const f = (v: number) => (v - min) / (max - min || 1);
  const frac = value === null ? 0 : clamp01(f(value));
  return (
    <div className="relative inline-grid place-items-center" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={ariaLabel} className="absolute inset-0">
        <path d={arcPath(0, 1)} fill="none" className="chart-track" strokeWidth={thickness} strokeLinecap="round" />
        {band && <path d={arcPath(f(band[0]), f(band[1]))} fill="none" stroke="var(--color-ok)" strokeOpacity={0.28} strokeWidth={thickness} />}
        {value !== null && frac > 0 && <path className="chart-arc" d={arcPath(0, Math.max(frac, 0.005))} fill="none" stroke={tone} strokeWidth={thickness} strokeLinecap="round" />}
        {marks.map((m, i) => {
          const a = start + SWEEP * clamp01(f(m.value));
          const [x0, y0] = toXY(a, r - thickness / 2 - 3), [x1, y1] = toXY(a, r + thickness / 2 + 3);
          return <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} stroke={m.color} strokeWidth={2} strokeLinecap="round"><title>{m.label}</title></line>;
        })}
      </svg>
      <div className="relative grid place-items-center text-center" aria-hidden>
        <div className="flex items-baseline gap-1">
          <span className="num text-[28px] font-light leading-none tracking-[-0.04em]" style={{ fontSize: Math.round(size * 0.2) }}>{value === null ? '—' : display ?? fmt(value)}</span>
          {unit && value !== null && <span className="text-[12px] opacity-60">{unit}</span>}
        </div>
        {label && <div className="mt-1 max-w-[90%] text-[11.5px] leading-tight opacity-70">{label}</div>}
        {sub && <div className="mt-0.5 text-[11px] leading-tight opacity-60">{sub}</div>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Donut / segmented ring
/** Segmented ring with gaps between segments; hovering a segment (or legend) reads it out in the centre. */
export function Donut({ data, size = 156, thickness = 14, center, centerLabel, ariaLabel, table, legend = true, empty = 'No data' }: {
  data: Datum[]; size?: number; thickness?: number; center?: ReactNode; centerLabel?: ReactNode; ariaLabel: string; table?: boolean; legend?: boolean; empty?: ReactNode;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const total = data.reduce((a, d) => a + d.value, 0);
  const r = (size - thickness) / 2;
  const C = 2 * Math.PI * r;
  const nonZero = data.filter((d) => d.value > 0);
  const gap = nonZero.length > 1 ? Math.min(6, C * 0.012) : 0;
  let acc = 0;
  const hd = hover ? data.find((d) => d.key === hover) : undefined;
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
      <div className="chart-hover relative inline-grid flex-none place-items-center" style={{ width: size, height: size }} onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={ariaLabel} className="absolute inset-0 -rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" className="chart-track" strokeWidth={thickness} />
          {total > 0 && nonZero.map((d) => {
            const len = (d.value / total) * C;
            const seg = (
              <circle key={d.key} className="chart-seg chart-arc" cx={size / 2} cy={size / 2} r={r} fill="none" stroke={d.color} strokeWidth={thickness}
                strokeDasharray={`${Math.max(0.5, len - gap)} ${C}`} strokeDashoffset={-acc} onMouseEnter={() => setHover(d.key)}>
                <title>{`${d.label}: ${fmt(d.value)} (${pct(d.value, total)}%)`}</title>
              </circle>
            );
            acc += len;
            return seg;
          })}
        </svg>
        <div className="relative grid place-items-center px-3 text-center" aria-hidden>
          {total === 0 ? <span className="text-[12px] text-muted">{empty}</span> : hd ? (
            <>
              <span className="num text-[26px] font-light leading-none tracking-[-0.04em]">{fmt(hd.value)}</span>
              <span className="mt-1 text-[11.5px] leading-tight text-muted">{hd.label} · {pct(hd.value, total)}%</span>
            </>
          ) : (
            <>
              <span className="num text-[30px] font-light leading-none tracking-[-0.04em]">{center ?? fmt(total)}</span>
              {centerLabel && <span className="mt-1 text-[11.5px] leading-tight text-muted">{centerLabel}</span>}
            </>
          )}
        </div>
      </div>
      {legend && total > 0 && (
        <ul className="grid min-w-[150px] flex-1 gap-2" aria-hidden onMouseLeave={() => setHover(null)}>
          {data.map((d) => (
            <li key={d.key} onMouseEnter={() => setHover(d.key)} className={clsx('flex items-center justify-between gap-3 rounded-lg px-1.5 py-0.5 text-[13px] transition-colors', hover === d.key && 'bg-tint')}>
              <span className="flex min-w-0 items-center gap-2 text-text-2"><span className="h-2.5 w-2.5 flex-none rounded-[3px]" style={{ background: d.color }} /><span className="truncate">{d.label}</span></span>
              <span className="num flex-none">{fmt(d.value)} <span className="text-muted">{pct(d.value, total)}%</span></span>
            </li>
          ))}
        </ul>
      )}
      {table && <SrTable caption={ariaLabel} head={['Category', 'Count']} rows={data.map((d) => [d.label, `${fmt(d.value)} (${pct(d.value, total)}%)`])} />}
    </div>
  );
}

// ------------------------------------------------------------------ StackedBar / StatusBar
/** One horizontal bar split into segments (status distribution). Hatched segments read as "pending / not yet". */
export function StackedBar({ data, height = 12, ariaLabel, table, legend = true, empty = 'No records' }: {
  data: Datum[]; height?: number; ariaLabel: string; table?: boolean; legend?: boolean; empty?: ReactNode;
}) {
  const total = data.reduce((a, d) => a + d.value, 0);
  return (
    <div className="grid gap-3">
      <div role="img" aria-label={ariaLabel} className="chart-hover flex w-full gap-[3px] overflow-hidden rounded-full bg-surface-2" style={{ height }}>
        {total === 0 ? <span className="hatch h-full w-full" title={typeof empty === 'string' ? empty : undefined} /> : data.filter((d) => d.value > 0).map((d) => (
          <span key={d.key} className={clsx('chart-seg chart-bar h-full first:rounded-l-full last:rounded-r-full', d.hatch && 'hatch')}
            style={{ width: `${(d.value / total) * 100}%`, minWidth: 4, background: d.hatch ? undefined : d.color, backgroundColor: d.hatch ? `color-mix(in srgb, ${d.color} 35%, transparent)` : undefined }}
            title={`${d.label}: ${fmt(d.value)} (${pct(d.value, total)}%)`} />
        ))}
      </div>
      {legend && (total > 0 ? <Legend data={data.filter((d) => d.value > 0)} total={total} /> : <p className="text-xs text-muted">{empty}</p>)}
      {table && <SrTable caption={ariaLabel} head={['Category', 'Count']} rows={data.map((d) => [d.label, `${fmt(d.value)} (${pct(d.value, total)}%)`])} />}
    </div>
  );
}

// ------------------------------------------------------------------ Bar list (ranked horizontal bars)
/** Ranked horizontal bars on hatched tracks, value + share on the right. */
export function BarList({ data, ariaLabel, max: maxIn, empty = 'No records', unit }: { data: Datum[]; ariaLabel: string; max?: number; empty?: ReactNode; unit?: string }) {
  const total = data.reduce((a, d) => a + d.value, 0);
  if (!data.length || total === 0) return <p className="text-sm text-muted">{empty}</p>;
  const max = maxIn ?? Math.max(1, ...data.map((d) => d.value));
  return (
    <ul className="grid gap-3" aria-label={ariaLabel}>
      {data.map((d) => (
        <li key={d.key} className="group grid gap-1.5">
          <div className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="min-w-0 truncate text-text-2">{d.label}</span>
            <span className="num flex-none">{fmt(d.value)}{unit ? ` ${unit}` : ''} <span className="text-muted">· {pct(d.value, total)}%</span></span>
          </div>
          <div className="hatch h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
            <div className="chart-bar h-full rounded-full group-hover:brightness-110" style={{ width: `${d.value ? Math.max(2, (d.value / max) * 100) : 0}%`, background: d.color }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------ Heatmap (day × hour)
/** Grid heatmap: rows (e.g. weekdays) × columns (e.g. hours). Intensity is a mix of `color` into the track colour. */
export function Heatmap({ rows, rowLabels, colLabels, color = 'var(--color-signal)', ariaLabel, cell = 14, unit = 'events', colTicks }: {
  rows: number[][]; rowLabels: string[]; colLabels: string[]; color?: string; ariaLabel: string; cell?: number; unit?: string; colTicks?: number[];
}) {
  const max = Math.max(0, ...rows.flat());
  const ticks = colTicks ?? colLabels.map((_, i) => i).filter((i) => i % 6 === 0);
  return (
    <div className="overflow-x-auto scrollbar-none">
      <div role="img" aria-label={ariaLabel} className="inline-grid gap-[3px]" style={{ gridTemplateColumns: `28px repeat(${colLabels.length}, ${cell}px)` }}>
        {rows.map((r, ri) => (
          <div key={ri} className="contents">
            <span className="pr-1 text-right text-[10.5px] leading-[14px] text-muted" style={{ lineHeight: `${cell}px` }} aria-hidden>{rowLabels[ri]}</span>
            {r.map((v, ci) => (
              <span key={ci} className="heat-cell rounded-[3px]" title={`${rowLabels[ri]} ${colLabels[ci]}: ${v} ${unit}`}
                style={{ width: cell, height: cell, background: v === 0 || max === 0 ? 'var(--color-chart-track)' : `color-mix(in srgb, ${color} ${Math.round(18 + (v / max) * 82)}%, transparent)` }} />
            ))}
          </div>
        ))}
        <span aria-hidden />
        {colLabels.map((l, ci) => <span key={ci} className="text-center text-[10px] text-muted" aria-hidden>{ticks.includes(ci) ? l : ''}</span>)}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Bullet / target bar
/** Bullet bar: value bar on a track with a target marker and optional qualitative ranges (as fractions of max). */
export function BulletBar({ value, target, max = 100, label, unit = '%', tone = 'var(--color-signal)', ariaLabel, targetLabel = 'Target' }: {
  value: number | null; target?: number; max?: number; label?: ReactNode; unit?: string; tone?: string; ariaLabel: string; targetLabel?: string;
}) {
  const f = value === null ? 0 : clamp01(value / (max || 1));
  const tf = target === undefined ? null : clamp01(target / (max || 1));
  const below = value !== null && target !== undefined && value < target;
  return (
    <div className="grid gap-1.5">
      {label !== undefined && (
        <div className="flex items-baseline justify-between gap-3 text-[13px]">
          <span className="min-w-0 truncate text-text-2">{label}</span>
          <span className="num flex-none font-medium">{value === null ? '—' : `${fmt(value)}${unit}`}{target !== undefined && <span className="font-normal text-muted"> / {targetLabel.toLowerCase()} {fmt(target)}{unit}</span>}</span>
        </div>
      )}
      <div role="img" aria-label={ariaLabel} className="hatch relative h-2.5 rounded-full bg-surface-2">
        <div className="chart-bar h-full rounded-full" style={{ width: `${f * 100}%`, background: below ? 'var(--color-high)' : tone }} />
        {tf !== null && <span aria-hidden className="absolute -top-1 h-[18px] w-[3px] -translate-x-1/2 rounded-full bg-text" style={{ left: `${tf * 100}%` }} />}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ RangeBar (value vs typical band)
/** Thin track with the typical band shaded and a marker at the latest value (asset value cards). */
export function RangeBar({ value, band, ariaLabel }: { value: number | null; band: [number, number]; ariaLabel: string }) {
  const dom = gaugeDomain([value, band[0], band[1]]) ?? [band[0], band[1]];
  const f = (v: number) => clamp01((v - dom[0]) / (dom[1] - dom[0] || 1)) * 100;
  const out = value !== null && (value < band[0] || value > band[1]);
  return (
    <div role="img" aria-label={ariaLabel} className="relative h-1.5 rounded-full bg-surface-3">
      <span aria-hidden className="absolute inset-y-0 rounded-full" style={{ left: `${f(band[0])}%`, width: `${f(band[1]) - f(band[0])}%`, background: 'color-mix(in srgb, var(--color-ok) 45%, transparent)' }} />
      {value !== null && <span aria-hidden className="absolute top-1/2 h-3.5 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface" style={{ left: `${f(value)}%`, background: out ? 'var(--color-high)' : 'var(--color-text)' }} />}
    </div>
  );
}

// ------------------------------------------------------------------ Delta
/** Change indicator vs a previous period. `goodWhen` sets which direction is green. */
export function Delta({ value, previous, goodWhen = 'down', suffix = 'vs previous', className }: { value: number; previous: number | null | undefined; goodWhen?: 'up' | 'down'; suffix?: string; className?: string }) {
  if (previous === null || previous === undefined) return null;
  const diff = value - previous;
  const p = previous === 0 ? null : Math.round((diff / previous) * 100);
  const dir = diff === 0 ? 0 : diff > 0 ? 1 : -1;
  const good = dir === 0 ? null : (dir < 0) === (goodWhen === 'down');
  const Icon = dir === 0 ? ArrowRight : dir > 0 ? ArrowUpRight : ArrowDownRight;
  const text = dir === 0 ? 'No change' : `${dir > 0 ? '+' : '−'}${p === null ? Math.abs(diff) : `${Math.abs(p)}%`}`;
  return (
    <span className={clsx('inline-flex items-center gap-1 text-[12px]', className)} aria-label={`${text} ${suffix} (${fmt(previous)} before)`}>
      <span className={clsx('inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-medium num',
        good === null ? 'bg-surface-2 text-text-2' : good ? 'bg-[rgb(0_194_26/0.12)] text-ok-text' : 'bg-[rgb(255_40_0/0.1)] text-critical-text')}>
        <Icon size={12} strokeWidth={2.2} aria-hidden />{text}
      </span>
      <span className="text-muted" aria-hidden>{suffix}</span>
    </span>
  );
}

// ------------------------------------------------------------------ MiniTrend with threshold band
/** Small line chart with an "expected band" (e.g. typical range) and optional dashed limits. */
export function MiniTrend({ values, band, limits = [], height = 56, color = 'var(--color-signal)', ariaLabel }: {
  values: { t: number; v: number }[]; band?: [number, number] | null; limits?: { value: number; color: string; label: string }[]; height?: number; color?: string; ariaLabel: string;
}) {
  const id = useId().replace(/:/g, '');
  if (values.length < 2) return <div style={{ height }} className="grid place-items-center rounded-xl border border-dashed border-line-2 text-xs text-muted">Not enough readings for a trend</div>;
  const ys = [...values.map((p) => p.v), ...(band ?? []), ...limits.map((l) => l.value)];
  let lo = Math.min(...ys), hi = Math.max(...ys);
  const pad = (hi - lo || Math.abs(hi) || 1) * 0.1;
  lo -= pad; hi += pad;
  const t0 = values[0]!.t, t1 = values[values.length - 1]!.t;
  const W = 300;
  const x = (t: number) => ((t - t0) / (t1 - t0 || 1)) * W;
  const y = (v: number) => height - ((v - lo) / (hi - lo)) * height;
  const d = values.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  const last = values[values.length - 1]!;
  return (
    <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" role="img" aria-label={ariaLabel} className="w-full overflow-visible" style={{ height }}>
      <defs><linearGradient id={`mt${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.22} /><stop offset="100%" stopColor={color} stopOpacity={0} /></linearGradient></defs>
      {band && <rect x={0} width={W} y={y(band[1])} height={Math.max(1, y(band[0]) - y(band[1]))} fill="var(--color-ok)" fillOpacity={0.1} />}
      {limits.map((l, i) => <line key={i} x1={0} x2={W} y1={y(l.value)} y2={y(l.value)} stroke={l.color} strokeDasharray="4 4" vectorEffect="non-scaling-stroke"><title>{l.label}</title></line>)}
      <path d={`${d}L${W},${height}L0,${height}Z`} fill={`url(#mt${id})`} />
      <path d={d} fill="none" stroke={color} strokeWidth={1.8} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      <circle cx={x(last.t)} cy={y(last.v)} r={3} fill={color} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// ------------------------------------------------------------------ Funnel / stage bars
/** Stage bars (pipeline): each stage's bar is relative to the first, with the step conversion shown. */
export function Funnel({ stages, ariaLabel, table }: { stages: { key: string; label: string; value: number; color?: string; hint?: string }[]; ariaLabel: string; table?: boolean }) {
  const top = Math.max(1, ...stages.map((s) => s.value));
  if (stages.every((s) => s.value === 0)) return <p className="text-sm text-muted">No records in this period.</p>;
  return (
    <div>
      <ol role="img" aria-label={ariaLabel} className="grid gap-2.5">
        {stages.map((s, i) => {
          const prev = i ? stages[i - 1]!.value : null;
          return (
            <li key={s.key} className="group grid grid-cols-[minmax(96px,30%)_1fr_auto] items-center gap-3 text-[13px]">
              <span className="truncate text-text-2" title={s.hint}>{s.label}</span>
              <span className="relative h-7 overflow-hidden rounded-lg bg-surface-2">
                <span className="chart-bar absolute inset-y-0 left-0 rounded-lg group-hover:brightness-110" style={{ width: `${s.value ? Math.max(3, (s.value / top) * 100) : 0}%`, background: s.color ?? 'var(--color-signal)' }} />
                <span className="num absolute inset-y-0 left-2.5 flex items-center font-medium mix-blend-normal" style={{ color: s.value / top > 0.18 ? '#ffffff' : 'var(--color-text)' }}>{fmt(s.value)}</span>
              </span>
              <span className="num w-12 text-right text-[12px] text-muted">{prev ? `${pct(s.value, prev)}%` : i === 0 ? '100%' : '—'}</span>
            </li>
          );
        })}
      </ol>
      {table && <SrTable caption={ariaLabel} head={['Stage', 'Count']} rows={stages.map((s) => [s.label, s.value])} />}
    </div>
  );
}

// ------------------------------------------------------------------ StatusStrip (compliance strip)
/** A row of equal cells (e.g. the last 24 hours), each coloured by status; hatched cells mean "no data / future". */
export function StatusStrip({ cells, ariaLabel, height = 28, axis }: {
  cells: { key: string; color: string | null; title: string }[]; ariaLabel: string; height?: number; axis?: ReactNode[];
}) {
  return (
    <div>
      <div role="img" aria-label={ariaLabel} className="flex gap-[3px]" style={{ height }}>
        {cells.map((c) => (
          <span key={c.key} title={c.title} className={clsx('heat-cell flex-1 rounded-[4px]', !c.color && 'hatch bg-surface-2')} style={c.color ? { background: c.color } : undefined} />
        ))}
      </div>
      {axis && <div className="mt-1.5 flex justify-between text-[11px] text-muted" aria-hidden>{axis.map((a, i) => <span key={i}>{a}</span>)}</div>}
    </div>
  );
}

// ------------------------------------------------------------------ TrendChart (recharts)
export interface TrendPoint { t: string; v: number; min?: number; max?: number }

/** Telemetry trend with unit, time axis, optional threshold lines and min/max band. Colours are CSS variables, so it re-themes. */
export function TrendChart({ points, unit, decimals = 2, thresholds = [], height = 260, color = 'var(--color-lime)', band }: {
  points: TrendPoint[]; unit: string; decimals?: number; thresholds?: { value: number; label: string; tone: string }[]; height?: number; color?: string;
  /** Typical operating band, drawn as a soft green zone. */
  band?: [number, number] | null;
}) {
  const gid = useId().replace(/:/g, '');
  const data = useMemo(() => points.map((p) => ({ ...p, ts: new Date(p.t).getTime(), band: p.min !== undefined && p.max !== undefined ? [p.min, p.max] : undefined })), [points]);
  const spanH = data.length > 1 ? (data[data.length - 1]!.ts - data[0]!.ts) / 3600_000 : 0;
  const tickFmt = (t: number) => new Date(t).toLocaleString(undefined, spanH > 48 ? { day: '2-digit', month: 'short' } : { hour: '2-digit', minute: '2-digit' });
  return (
    <div style={{ height }} className="w-full text-muted">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`trendFill${gid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.28} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--color-chart-grid)" vertical={false} />
          <XAxis dataKey="ts" type="number" domain={['dataMin', 'dataMax']} scale="time" tickFormatter={tickFmt} stroke="currentColor" tick={{ fontSize: 11, fill: 'currentColor' }} tickLine={false} axisLine={false} minTickGap={40} />
          <YAxis stroke="currentColor" tick={{ fontSize: 11, fill: 'currentColor' }} tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => v.toFixed(decimals > 1 ? 1 : decimals)} domain={['auto', 'auto']} />
          <Tooltip
            cursor={{ stroke: 'var(--color-line-2)' }}
            contentStyle={{ background: 'var(--color-tooltip)', border: '1px solid var(--color-line-2)', borderRadius: 12, fontSize: 12, color: 'var(--color-tooltip-ink)', boxShadow: 'var(--shadow-2)' }}
            itemStyle={{ color: 'var(--color-tooltip-ink)' }}
            labelStyle={{ color: 'var(--color-tooltip-ink)', opacity: 0.75 }}
            labelFormatter={(t) => new Date(Number(t)).toLocaleString()}
            formatter={(v) => [`${Number(v).toFixed(decimals)} ${unit}`, 'Value']}
          />
          {band && <ReferenceLine y={band[0]} stroke="var(--color-ok)" strokeOpacity={0.5} strokeDasharray="2 6" />}
          {band && <ReferenceLine y={band[1]} stroke="var(--color-ok)" strokeOpacity={0.5} strokeDasharray="2 6" />}
          {data.some((d) => d.band) && <Area dataKey="band" stroke="none" fill={color} fillOpacity={0.08} isAnimationActive={false} />}
          <Area dataKey="v" stroke={color} strokeWidth={1.8} fill={`url(#trendFill${gid})`} isAnimationActive={false} dot={false} />
          {thresholds.map((t, i) => <ReferenceLine key={i} y={t.value} stroke={t.tone} strokeDasharray="4 4" label={{ value: t.label, fill: t.tone, fontSize: 11, position: 'insideTopRight' }} />)}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ------------------------------------------------------------------ helpers for pages
/** Bucket ISO timestamps into the last `days` calendar days (local time), oldest first. */
export function perDay(timestamps: (string | null | undefined)[], days: number, now = new Date()): { label: string; day: string; value: number }[] {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  const out = Array.from({ length: days }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return { day: d.toISOString(), label: d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' }), value: 0 };
  });
  for (const ts of timestamps) {
    if (!ts) continue;
    const t = new Date(ts);
    const idx = Math.floor((new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime() - start.getTime()) / 86400_000);
    if (idx >= 0 && idx < days) out[idx]!.value++;
  }
  return out;
}

/** Weekday (Mon..Sun) × hour (0..23) counts for a list of timestamps. */
export function weekHourGrid(timestamps: (string | null | undefined)[]): number[][] {
  const g = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const ts of timestamps) {
    if (!ts) continue;
    const d = new Date(ts);
    g[(d.getDay() + 6) % 7]![d.getHours()]!++;
  }
  return g;
}
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const HOURS = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}h`);

/** A padded [min, max] that contains every given value (for gauges); null if nothing is known. */
export function gaugeDomain(values: (number | null | undefined)[]): [number, number] | null {
  const v = values.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  if (!v.length) return null;
  let lo = Math.min(...v), hi = Math.max(...v);
  const pad = (hi - lo || Math.abs(hi) || 1) * 0.15;
  lo -= pad; hi += pad;
  if (Math.min(...v) >= 0 && lo < 0) lo = 0;
  return [lo, hi];
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Standard semantic colour maps (all CSS variables). */
export const SEVERITY_COLORS: Record<'critical' | 'high' | 'medium' | 'low', string> = {
  critical: 'var(--color-critical)', high: 'var(--color-high)', medium: 'var(--color-medium)', low: 'var(--color-low)',
};
export const PRIORITY_COLORS: Record<'urgent' | 'high' | 'medium' | 'low', string> = {
  urgent: 'var(--color-critical)', high: 'var(--color-high)', medium: 'var(--color-medium)', low: 'var(--color-low)',
};
