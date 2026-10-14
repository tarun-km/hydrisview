'use client';

import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

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

/** Thin vertical bars (SolaFlux microchart) - used for alarm frequency per day. */
export function BarStrip({ data, height = 64, highlight = 'var(--color-orange)', ariaLabel }: { data: { label: string; value: number }[]; height?: number; highlight?: string; ariaLabel: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div role="img" aria-label={ariaLabel} className="flex items-end gap-[6px]" style={{ height }}>
      {data.map((d, i) => (
        <div key={i} className="flex flex-1 flex-col items-center justify-end" title={`${d.label}: ${d.value}`}>
          <div className="w-[3px] rounded-full" style={{ height: `${Math.max(6, (d.value / max) * 100)}%`, background: d.value === max && d.value > 0 ? highlight : 'currentColor', opacity: d.value ? 1 : 0.25 }} />
        </div>
      ))}
    </div>
  );
}

/** Semi-circular gauge (SolaFlux CO2 / Ambient sensor) with explicit value + unit. */
export function Gauge({ value, min = 0, max = 100, label, unit, tone = 'var(--color-orange)', size = 132 }: { value: number | null; min?: number; max?: number; label: string; unit?: string; tone?: string; size?: number }) {
  const r = size / 2 - 8;
  const frac = value === null ? 0 : Math.max(0, Math.min(1, (value - min) / (max - min || 1)));
  const arc = (f: number) => {
    const a = Math.PI * (1 - f);
    return `${size / 2 + r * Math.cos(a)},${size / 2 - r * Math.sin(a)}`;
  };
  return (
    <svg viewBox={`0 0 ${size} ${size / 2 + 6}`} width={size} role="img" aria-label={`${label}: ${value ?? 'no data'} ${unit ?? ''}`}>
      <path d={`M${arc(0)} A${r},${r} 0 0 1 ${arc(1)}`} fill="none" stroke="currentColor" strokeOpacity={0.15} strokeWidth={6} strokeLinecap="round" />
      {value !== null && <path d={`M${arc(0)} A${r},${r} 0 0 1 ${arc(frac)}`} fill="none" stroke={tone} strokeWidth={6} strokeLinecap="round" />}
    </svg>
  );
}

export interface TrendPoint { t: string; v: number; min?: number; max?: number }

/** Telemetry trend with unit, time axis, optional threshold lines and min/max band. */
export function TrendChart({ points, unit, decimals = 2, thresholds = [], height = 260, color = 'var(--color-lime)' }: {
  points: TrendPoint[]; unit: string; decimals?: number; thresholds?: { value: number; label: string; tone: string }[]; height?: number; color?: string;
}) {
  const data = points.map((p) => ({ ...p, ts: new Date(p.t).getTime(), band: p.min !== undefined && p.max !== undefined ? [p.min, p.max] : undefined }));
  const spanH = data.length > 1 ? (data[data.length - 1]!.ts - data[0]!.ts) / 3600_000 : 0;
  const tickFmt = (t: number) => new Date(t).toLocaleString(undefined, spanH > 48 ? { day: '2-digit', month: 'short' } : { hour: '2-digit', minute: '2-digit' });
  return (
    <div style={{ height }} className="w-full text-muted">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.28} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgb(255 255 255 / 0.06)" vertical={false} />
          <XAxis dataKey="ts" type="number" domain={['dataMin', 'dataMax']} scale="time" tickFormatter={tickFmt} stroke="currentColor" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={40} />
          <YAxis stroke="currentColor" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => v.toFixed(decimals > 1 ? 1 : decimals)} domain={['auto', 'auto']} />
          <Tooltip
            contentStyle={{ background: '#242424', border: '1px solid rgb(255 255 255 / 0.12)', borderRadius: 12, fontSize: 12, color: '#f3f4f1' }}
            labelFormatter={(t) => new Date(Number(t)).toLocaleString()}
            formatter={(v) => [`${Number(v).toFixed(decimals)} ${unit}`, 'Value']}
          />
          {data.some((d) => d.band) && <Area dataKey="band" stroke="none" fill={color} fillOpacity={0.08} isAnimationActive={false} />}
          <Area dataKey="v" stroke={color} strokeWidth={1.8} fill="url(#trendFill)" isAnimationActive={false} dot={false} />
          {thresholds.map((t, i) => <ReferenceLine key={i} y={t.value} stroke={t.tone} strokeDasharray="4 4" label={{ value: t.label, fill: t.tone, fontSize: 11, position: 'insideTopRight' }} />)}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
