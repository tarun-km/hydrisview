import clsx from 'clsx';
import type { ReactNode } from 'react';
import { PlantSchematic } from './art';

/* Static product-UI vignettes. Sizes use container-query units (cqw) so each vignette
 * scales as a picture at any width. All values are synthetic reference-plant data. */

type HudTone = 'ok' | 'medium' | 'high' | 'critical' | 'stale' | 'lime';
const TONE: Record<HudTone, string> = {
  ok: 'var(--color-ok)', medium: 'var(--color-medium)', high: 'var(--color-high)', critical: 'var(--color-critical)', stale: 'var(--color-muted)', lime: 'var(--color-lime)',
};

/** Square black glasses display (600×600 design canvas, scaled). */
export function GlassesScreen({ children, label, className, header, status = 'Live', statusTone = 'ok' }: { children: ReactNode; label: string; className?: string; header?: string; status?: string; statusTone?: HudTone }) {
  return (
    <div role="img" aria-label={label} className={clsx('@container relative aspect-square w-full overflow-hidden rounded-[9%] bg-black ring-1 ring-line-2', className)}>
      <div aria-hidden className="absolute inset-0 flex flex-col p-[6.5cqw] text-[4.6cqw] leading-[1.25] text-text">
        {header && (
          <div className="flex items-center justify-between text-[3.8cqw] text-text-2">
            <span className="truncate">{header}</span>
            <span className="flex items-center gap-[1.4cqw]">
              <span className="inline-block h-[2cqw] w-[2cqw] rounded-full" style={{ background: TONE[statusTone] }} />
              {status}
            </span>
          </div>
        )}
        <div className="mt-[4cqw] flex min-h-0 flex-1 flex-col">{children}</div>
      </div>
    </div>
  );
}

export function HudReading({ tag, name, value, unit, tone = 'ok', state, limit, foot }: { tag: string; name: string; value: string; unit: string; tone?: HudTone; state: string; limit?: string; foot?: string }) {
  return (
    <>
      <div className="text-[4cqw] text-text-2">{tag}</div>
      <div className="text-[5.4cqw]">{name}</div>
      <div className="mt-auto flex items-baseline gap-[2cqw]">
        <span className="text-[21cqw] font-light leading-none tracking-[-0.05em]" style={{ color: tone === 'ok' ? undefined : TONE[tone] }}>{value}</span>
        <span className="text-[5cqw] text-text-2">{unit}</span>
      </div>
      <div className="mt-[3cqw] flex items-center justify-between border-t border-white/15 pt-[3cqw] text-[3.8cqw]">
        <span className="rounded-full px-[2.6cqw] py-[0.8cqw]" style={{ background: `color-mix(in oklab, ${TONE[tone]} 22%, transparent)`, color: TONE[tone] }}>{state}</span>
        {limit && <span className="text-text-2">{limit}</span>}
      </div>
      {foot && <div className="mt-[2cqw] text-[3.4cqw] text-muted">{foot}</div>}
    </>
  );
}

export function HudStep({ step, title, caution, options, focus = 0, kind }: { step: string; title: string; caution?: string; options: string[]; focus?: number; kind?: string }) {
  return (
    <>
      <div className="flex items-center justify-between text-[3.8cqw] text-text-2">
        <span>{step}</span>
        {kind && <span className="rounded-full border border-white/25 px-[2.4cqw] py-[0.6cqw]">{kind}</span>}
      </div>
      <div className="mt-[2cqw] text-[6.4cqw] leading-[1.15] tracking-[-0.02em]">{title}</div>
      {caution && <div className="mt-[2.4cqw] rounded-[3cqw] border border-medium/50 px-[3cqw] py-[1.6cqw] text-[3.6cqw] text-medium">⚠ {caution}</div>}
      <div className="mt-auto grid gap-[2cqw]">
        {options.map((o, i) => (
          <div key={o} className={clsx('rounded-[4cqw] px-[4cqw] py-[2.6cqw] text-[4.4cqw]', i === focus ? 'bg-lime text-lime-ink outline outline-[0.9cqw] outline-offset-[0.8cqw] outline-lime' : 'bg-white/[0.08]')}>{o}</div>
        ))}
      </div>
    </>
  );
}

export function HudAlert({ severity, title, detail, action }: { severity: 'critical' | 'high' | 'medium'; title: string; detail: string; action?: string }) {
  return (
    <div className="-m-[2cqw] flex flex-1 flex-col rounded-[6cqw] p-[5cqw]" style={{ background: `color-mix(in oklab, ${TONE[severity]} 18%, black)`, boxShadow: `inset 0 0 0 0.8cqw ${TONE[severity]}` }}>
      <div className="text-[3.8cqw] uppercase tracking-[0.12em]" style={{ color: TONE[severity] }}>{severity} alarm</div>
      <div className="mt-[2cqw] text-[7cqw] leading-[1.1] tracking-[-0.02em]">{title}</div>
      <div className="mt-[2.4cqw] text-[4.2cqw] text-text-2">{detail}</div>
      {action && <div className="mt-auto rounded-[4cqw] bg-white px-[4cqw] py-[2.6cqw] text-[4.4cqw] text-ink">{action}</div>}
    </div>
  );
}

export function HudList({ title, items, focus = 0 }: { title: string; items: { label: string; meta?: string; tone?: HudTone }[]; focus?: number }) {
  return (
    <>
      <div className="text-[6cqw] tracking-[-0.02em]">{title}</div>
      <div className="mt-auto grid gap-[1.8cqw]">
        {items.map((it, i) => (
          <div key={it.label} className={clsx('flex items-center justify-between gap-[2cqw] rounded-[4cqw] px-[4cqw] py-[2.4cqw] text-[4.2cqw]', i === focus ? 'outline outline-[0.9cqw] outline-lime bg-white/[0.06]' : 'bg-white/[0.06]')}>
            <span className="flex min-w-0 items-center gap-[2cqw]">
              {it.tone && <span className="inline-block h-[2.2cqw] w-[2.2cqw] flex-none rounded-full" style={{ background: TONE[it.tone] }} />}
              <span className="truncate">{it.label}</span>
            </span>
            {it.meta && <span className="flex-none text-[3.6cqw] text-text-2">{it.meta}</span>}
          </div>
        ))}
      </div>
    </>
  );
}

export function HudSop({ code, title, steps, current }: { code: string; title: string; steps: string[]; current: number }) {
  return (
    <>
      <div className="flex items-center gap-[2cqw] text-[3.6cqw]">
        <span className="rounded-full bg-white/[0.1] px-[2.4cqw] py-[0.6cqw]">{code}</span>
        <span className="text-[var(--color-ok)]">Approved</span>
      </div>
      <div className="mt-[2cqw] text-[6cqw] leading-[1.15] tracking-[-0.02em]">{title}</div>
      <ol className="mt-auto grid gap-[1.6cqw]">
        {steps.map((s, i) => (
          <li key={s} className={clsx('flex gap-[2.4cqw] text-[4cqw]', i < current && 'text-muted line-through decoration-white/30', i === current && 'text-lime')}>
            <span className="num w-[5cqw] flex-none">{String(i + 1).padStart(2, '0')}</span>
            <span>{s}</span>
          </li>
        ))}
      </ol>
    </>
  );
}

/* ---------- Device + laptop frames ---------- */

/** Bezel around a glasses vignette, with optional caption below. */
export function DeviceFrame({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('device-bezel rounded-[34px] p-3 sm:p-4', className)}>{children}</div>;
}

export function LaptopFrame({ children, className, label }: { children: ReactNode; className?: string; label: string }) {
  return (
    <figure className={clsx('m-0', className)}>
      <div className="laptop-lid">
        <div role="img" aria-label={label} className="@container relative aspect-[16/10] overflow-hidden rounded-[10px] bg-bg">{children}</div>
      </div>
      <div aria-hidden className="laptop-base" />
    </figure>
  );
}

/** Operator Console overview mock (reference plant, synthetic). */
export function ConsoleMock() {
  const kpis = [
    { k: 'Open alarms', v: '3', s: '1 critical', tone: 'paper' },
    { k: 'Inspections due today', v: '5', s: '2 in progress', tone: 'lime' },
    { k: 'Glasses connected', v: '4/5', s: '1 offline · queued', tone: 'dark' },
    { k: 'Sensors live', v: '14/15', s: 'BL-102 stale', tone: 'dark' },
  ];
  const alarms = [
    { t: 'VT-101 vibration high-high', a: 'P-101 · Equalization', sev: 'critical', time: '2 min' },
    { t: 'LT-101 level high', a: 'T-101 · Equalization', sev: 'high', time: '14 min' },
    { t: 'AIT-502 turbidity high', a: 'AN-501 · Discharge', sev: 'medium', time: '41 min' },
  ] as const;
  return (
    <div aria-hidden className="absolute inset-0 flex text-[1.25cqw] text-text">
      <div className="flex w-[6cqw] flex-col items-center gap-[1.6cqw] border-r border-line py-[2cqw]">
        <span className="h-[3.4cqw] w-[3.4cqw] rounded-full bg-lime" />
        {Array.from({ length: 6 }, (_, i) => <span key={i} className={clsx('h-[3cqw] w-[3cqw] rounded-full', i === 0 ? 'bg-surface-3' : 'bg-surface')} />)}
      </div>
      <div className="flex min-w-0 flex-1 flex-col p-[2.2cqw]">
        <div className="flex items-center justify-between">
          <div className="flex gap-[0.4cqw] rounded-full border border-line bg-surface p-[0.4cqw]">
            {['Overview', 'Alarms', 'Inspections', 'Fleet'].map((t, i) => (
              <span key={t} className={clsx('rounded-full px-[1.4cqw] py-[0.6cqw]', i === 0 ? 'bg-white text-ink' : 'text-text-2')}>{t}</span>
            ))}
          </div>
          <span className="rounded-full border border-dashed border-lime/50 px-[1.2cqw] py-[0.4cqw] text-lime">Synthetic</span>
        </div>
        <div className="mt-[2cqw] text-[3.2cqw] tracking-[-0.04em]">Riverbend · ETP-01</div>
        <div className="mt-[1.6cqw] grid grid-cols-4 gap-[1.2cqw]">
          {kpis.map((k) => (
            <div key={k.k} className={clsx('rounded-[1.6cqw] p-[1.4cqw]', k.tone === 'paper' && 'bg-paper text-ink', k.tone === 'lime' && 'bg-lime text-lime-ink', k.tone === 'dark' && 'border border-line bg-surface')}>
              <div className="opacity-70">{k.k}</div>
              <div className="mt-[1cqw] text-[3.4cqw] font-light leading-none tracking-[-0.04em]">{k.v}</div>
              <div className="mt-[0.6cqw] opacity-70">{k.s}</div>
            </div>
          ))}
        </div>
        <div className="mt-[1.2cqw] grid min-h-0 flex-1 grid-cols-5 gap-[1.2cqw]">
          <div className="col-span-2 rounded-[1.6cqw] border border-line bg-surface p-[1.2cqw]">
            <div className="text-text-2">Plant map</div>
            <PlantSchematic className="mt-[0.4cqw] h-auto w-full" highlight="P-101" />
          </div>
          <div className="col-span-3 rounded-[1.6cqw] border border-line bg-surface p-[1.4cqw]">
            <div className="flex justify-between text-text-2"><span>Active alarms</span><span>Advisory</span></div>
            <div className="mt-[1cqw] grid gap-[0.8cqw]">
              {alarms.map((a) => (
                <div key={a.t} className="flex items-center gap-[1cqw] rounded-[1.2cqw] bg-bg-2 px-[1.2cqw] py-[1cqw]">
                  <span className="h-[1cqw] w-[1cqw] flex-none rounded-full" style={{ background: `var(--color-${a.sev})` }} />
                  <span className="min-w-0 flex-1 truncate">{a.t}<span className="text-muted"> · {a.a}</span></span>
                  <span className="text-muted">{a.time}</span>
                  <span className="grid h-[2.4cqw] w-[2.4cqw] place-items-center rounded-full bg-white text-ink">↗</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
