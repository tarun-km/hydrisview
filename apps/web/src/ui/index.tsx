'use client';

import Link from 'next/link';
import clsx from 'clsx';
import { forwardRef, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { AlertTriangle, ArrowUpRight, Inbox, Loader2, RefreshCw } from 'lucide-react';
import * as RTooltip from '@radix-ui/react-tooltip';
import * as RSwitch from '@radix-ui/react-switch';
import type { UseQueryResult } from '@tanstack/react-query';
import { FRESHNESS_LABELS, type Freshness } from '@hydris/domain';
import { errorMessage } from '@/lib/api';
import { ago, initials } from '@/lib/format';

export { clsx as cx };

// ---------------- Buttons ----------------
type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'light' | 'danger' | 'danger-solid';
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant;
  size?: 'sm' | 'md' | 'lg';
  busy?: boolean;
  icon?: ReactNode;
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'secondary', size = 'md', busy, icon, className, children, disabled, ...p }, ref) {
  return (
    <button ref={ref} className={clsx('btn', `btn-${variant}`, size !== 'md' && `btn-${size}`, className)} disabled={disabled || busy} aria-busy={busy || undefined} {...p}>
      {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export function ButtonLink({ href, variant = 'secondary', size = 'md', icon, className, children }: { href: string; variant?: BtnVariant; size?: 'sm' | 'md' | 'lg'; icon?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <Link href={href} className={clsx('btn', `btn-${variant}`, size !== 'md' && `btn-${size}`, className)}>
      {icon}
      {children}
    </Link>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Mandatory accessible name; also shown as tooltip. */
  label: string;
  tone?: 'default' | 'light' | 'lime' | 'ghost' | 'on-paper';
  size?: 'sm' | 'md' | 'lg';
  busy?: boolean;
  badge?: number;
}
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({ label, tone = 'default', size = 'md', busy, badge, className, children, ...p }, ref) {
  return (
    <Tooltip label={label}>
      <button ref={ref} aria-label={label} className={clsx('icon-btn relative', tone !== 'default' && `icon-btn-${tone}`, size !== 'md' && `icon-btn-${size}`, className)} {...p}>
        {busy ? <Loader2 size={18} className="animate-spin" aria-hidden /> : children}
        {!!badge && <span className="absolute -right-0.5 -top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-lime px-1 text-[10.5px] font-semibold text-lime-ink num">{badge > 99 ? '99+' : badge}</span>}
      </button>
    </Tooltip>
  );
});

/** Circular ↗ "open details" action (Ambient / Trivi cards). Always a navigation, never a command. */
export function OpenLink({ href, label, tone = 'light', size = 'md' }: { href: string; label: string; tone?: 'light' | 'default' | 'on-paper'; size?: 'sm' | 'md' }) {
  return (
    <Tooltip label={label}>
      <Link href={href} aria-label={label} className={clsx('icon-btn', tone === 'light' && 'icon-btn-light', tone === 'on-paper' && 'icon-btn-on-paper', size === 'sm' && 'icon-btn-sm')}>
        <ArrowUpRight size={size === 'sm' ? 16 : 18} strokeWidth={1.8} aria-hidden />
      </Link>
    </Tooltip>
  );
}

export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <RTooltip.Root delayDuration={350}>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content sideOffset={6} className="z-50 rounded-lg bg-surface-3 px-2.5 py-1.5 text-xs text-text shadow-[var(--shadow-2)] fade-in">{label}</RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}

// ---------------- Capsule / segmented ----------------
export function Capsule<T extends string>({ value, onChange, options, label, lime }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; count?: number }[]; label: string; lime?: boolean }) {
  return (
    <div role="tablist" aria-label={label} className={clsx('capsule max-w-full overflow-x-auto scrollbar-none', lime && 'capsule-lime')}>
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
          {o.count !== undefined && <span className="num rounded-full bg-black/25 px-1.5 text-[11px]">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ---------------- Chips & status ----------------
export function Chip({ tone, children, className, title }: { tone?: 'default' | 'outline' | 'lime' | 'critical' | 'high' | 'medium' | 'low' | 'ok' | 'cobalt' | 'synthetic'; children: ReactNode; className?: string; title?: string }) {
  return <span title={title} className={clsx('chip', tone && tone !== 'default' && `chip-${tone}`, className)}>{children}</span>;
}

const SEV_TONE = { critical: 'critical', high: 'high', medium: 'medium', low: 'low' } as const;
export function SeverityChip({ severity }: { severity: 'critical' | 'high' | 'medium' | 'low' }) {
  return (
    <Chip tone={SEV_TONE[severity]}>
      <span className="dot" style={{ background: `var(--color-${severity})` }} aria-hidden />
      {severity[0]!.toUpperCase() + severity.slice(1)}
    </Chip>
  );
}

const STATE_TONE: Record<string, Parameters<typeof Chip>[0]['tone']> = {
  active: 'critical', acknowledged: 'medium', investigating: 'cobalt', resolved: 'ok', closed: 'outline',
  scheduled: 'outline', in_progress: 'cobalt', paused: 'medium', submitted: 'lime', approved: 'ok', rejected: 'high', cancelled: 'outline',
  open: 'outline', assigned: 'cobalt', on_hold: 'medium', completed: 'ok',
  operational: 'ok', degraded: 'medium', down: 'critical', maintenance: 'cobalt', standby: 'outline', decommissioned: 'outline',
  connected: 'ok', disconnected: 'medium', paired: 'outline', suspended: 'high', revoked: 'critical', pending_pairing: 'outline', unregistered: 'outline',
  invited: 'outline', deactivated: 'outline', draft: 'outline', archived: 'outline', urgent: 'critical', high: 'high', medium: 'medium', low: 'low', normal: 'outline',
};
export function StateChip({ state, label }: { state: string; label?: string }) {
  return <Chip tone={STATE_TONE[state] ?? 'outline'}>{label ?? state.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())}</Chip>;
}

const FRESH_COLOR: Record<Freshness, string> = { live: 'var(--color-ok)', delayed: 'var(--color-medium)', stale: 'var(--color-high)', no_data: 'var(--color-muted)' };
export function FreshnessBadge({ freshness, ts }: { freshness: Freshness; ts?: string | null }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-text-2" title={ts ? `Observed ${new Date(ts).toLocaleString()}` : 'No measurement received'}>
      <span className={clsx('dot', freshness === 'live' && 'pulse-dot')} style={{ background: FRESH_COLOR[freshness] }} aria-hidden />
      {FRESHNESS_LABELS[freshness]}
      {ts && freshness !== 'live' && <span className="muted">· {ago(ts)}</span>}
    </span>
  );
}

export function SyntheticBadge() {
  return <Chip tone="synthetic" title="Generated by the Hydris simulator for demonstration. Not a real measurement.">Synthetic</Chip>;
}

export function Avatar({ name, size = 36, tone = 'surface' }: { name: string; size?: number; tone?: 'surface' | 'lime' | 'cobalt' }) {
  return (
    <span aria-hidden className={clsx('inline-grid flex-none place-items-center rounded-full font-medium', tone === 'lime' ? 'bg-lime text-lime-ink' : tone === 'cobalt' ? 'bg-cobalt text-white' : 'bg-surface-3 text-text')} style={{ width: size, height: size, fontSize: size * 0.36 }}>
      {initials(name)}
    </span>
  );
}

// ---------------- Layout ----------------
export function PageHeader({ eyebrow, title, subtitle, actions, children }: { eyebrow?: ReactNode; title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="t-eyebrow mb-2">{eyebrow}</div>}
        <h1 className="t-page">{title}</h1>
        {subtitle && <p className="mt-2 max-w-2xl text-[15px] text-text-2">{subtitle}</p>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Card({ title, action, children, className, tone, tight, as: As = 'section' }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; tone?: 'paper' | 'lime'; tight?: boolean; as?: 'section' | 'div' | 'article' }) {
  return (
    <As className={clsx('card', tone && `card-${tone}`, tight && 'card-tight', className)}>
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {typeof title === 'string' ? <h2 className="t-card">{title}</h2> : title}
          {action}
        </div>
      )}
      {children}
    </As>
  );
}

/** KPI island: label / value+unit / context, with ↗ to the detail view (SolaFlux paper card). */
export function KpiCard({ label, value, unit, sub, href, tone = 'paper', accent, footer }: { label: string; value: ReactNode; unit?: string; sub?: ReactNode; href?: string; tone?: 'paper' | 'dark' | 'lime'; accent?: 'critical' | 'high' | 'ok'; footer?: ReactNode }) {
  return (
    <div className={clsx('card relative flex min-h-[148px] flex-col justify-between', tone === 'paper' && 'card-paper', tone === 'lime' && 'card-lime')}>
      <div className="flex items-start justify-between gap-3">
        <span className={clsx('text-[14px]', tone === 'dark' ? 'text-text-2' : 'opacity-75')}>{label}</span>
        {href && <OpenLink href={href} label={`Open ${label}`} tone={tone === 'dark' ? 'default' : 'on-paper'} size="sm" />}
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="t-kpi" style={accent ? { color: `var(--color-${accent})` } : undefined}>{value}</span>
        {unit && <span className="text-[15px] opacity-60">{unit}</span>}
      </div>
      {sub && <div className="mt-2 text-[13px] opacity-70">{sub}</div>}
      {footer}
    </div>
  );
}

// ---------------- States ----------------
export function EmptyState({ title, body, action, icon }: { title: string; body?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="grid place-items-center gap-3 rounded-[var(--radius-xl)] border border-dashed border-line-2 px-6 py-12 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-surface-2 text-muted">{icon ?? <Inbox size={20} aria-hidden />}</span>
      <div className="t-card">{title}</div>
      {body && <p className="max-w-md text-sm text-muted">{body}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = errorMessage(error);
  const forbidden = (error as { status?: number })?.status === 403;
  return (
    <div role="alert" className="flex flex-wrap items-center gap-4 rounded-[var(--radius-xl)] border border-[rgb(255_90_78/0.3)] bg-[rgb(255_90_78/0.06)] p-5">
      <AlertTriangle className="text-critical" size={20} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="font-medium">{forbidden ? 'You do not have access to this' : 'Could not load this view'}</div>
        <div className="text-sm text-text-2">{msg}</div>
      </div>
      {onRetry && !forbidden && <Button size="sm" onClick={onRetry} icon={<RefreshCw size={14} />}>Retry</Button>}
    </div>
  );
}

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={clsx('skeleton', className)} style={style} aria-hidden />;
}

export function LoadingBlock({ rows = 3 }: { rows?: number }) {
  return (
    <div className="grid gap-3" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-14" />)}
    </div>
  );
}

/** Render loading / error / data for a query, keeping the last good data visible while refetching. */
export function QueryView<T>({ q, children, loading }: { q: UseQueryResult<T>; children: (data: T) => ReactNode; loading?: ReactNode }) {
  if (q.data !== undefined) return <>{children(q.data)}</>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  return <>{loading ?? <LoadingBlock />}</>;
}

// ---------------- Forms ----------------
export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? <span className="field-error" role="alert">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label?: string; hint?: ReactNode; error?: string | null }>(function Input({ label, hint, error, className, id, ...p }, ref) {
  const auto = useId();
  const el = <input ref={ref} id={id ?? auto} className={clsx('input', className)} aria-invalid={!!error || undefined} {...p} />;
  return label ? <Field label={label} hint={hint} error={error} htmlFor={id ?? auto}>{el}</Field> : el;
});

export function Select({ label, hint, error, options, className, id, placeholder, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { label?: string; hint?: ReactNode; error?: string | null; options: { value: string; label: string }[]; placeholder?: string }) {
  const auto = useId();
  const el = (
    <select id={id ?? auto} className={clsx('select', className)} aria-invalid={!!error || undefined} {...p}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
  return label ? <Field label={label} hint={hint} error={error} htmlFor={id ?? auto}>{el}</Field> : el;
}

export function Textarea({ label, hint, error, className, id, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string; hint?: ReactNode; error?: string | null }) {
  const auto = useId();
  const el = <textarea id={id ?? auto} className={clsx('textarea', className)} aria-invalid={!!error || undefined} {...p} />;
  return label ? <Field label={label} hint={hint} error={error} htmlFor={id ?? auto}>{el}</Field> : el;
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-3 text-sm">
      <RSwitch.Root checked={checked} onCheckedChange={onChange} disabled={disabled} aria-label={label}
        className="relative h-[26px] w-[46px] rounded-full bg-surface-3 transition-colors data-[state=checked]:bg-lime disabled:opacity-50">
        <RSwitch.Thumb className="block h-[20px] w-[20px] translate-x-[3px] rounded-full bg-white transition-transform data-[state=checked]:translate-x-[23px] data-[state=checked]:bg-lime-ink" />
      </RSwitch.Root>
      {label}
    </label>
  );
}

// ---------------- Data table ----------------
export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
  sort?: (row: T) => string | number | null;
}
export function DataTable<T>({ rows, columns, onRowClick, rowKey, empty, dense }: { rows: T[]; columns: Column<T>[]; onRowClick?: (row: T) => void; rowKey: (row: T) => string; empty?: ReactNode; dense?: boolean }) {
  if (!rows.length) return <>{empty ?? <EmptyState title="Nothing here yet" />}</>;
  return (
    <div className="-mx-2 overflow-x-auto px-2">
      <table className={clsx('table', dense && '[&_td]:py-2.5')}>
        <thead>
          <tr>{columns.map((c) => <th key={c.key} scope="col" className={c.className}>{c.header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)} data-href={onRowClick ? '' : undefined} onClick={onRowClick ? () => onRowClick(r) : undefined}
              onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter') onRowClick(r); } : undefined} tabIndex={onRowClick ? 0 : undefined}>
              {columns.map((c) => <td key={c.key} className={c.className}>{c.cell(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------- Timeline ----------------
export function Timeline({ items }: { items: { id: string; title: ReactNode; meta?: ReactNode; body?: ReactNode; tone?: 'lime' | 'critical' | 'ok' | 'muted' | 'cobalt' }[] }) {
  if (!items.length) return <p className="text-sm text-muted">No activity yet.</p>;
  return (
    <ol className="relative grid gap-5 border-l border-line-2 pl-5">
      {items.map((i) => (
        <li key={i.id} className="relative">
          <span className="absolute -left-[26px] top-1.5 h-[11px] w-[11px] rounded-full ring-4 ring-surface" style={{ background: i.tone === 'lime' ? 'var(--color-lime)' : i.tone === 'critical' ? 'var(--color-critical)' : i.tone === 'ok' ? 'var(--color-ok)' : i.tone === 'cobalt' ? 'var(--color-cobalt)' : 'var(--color-surface-3)' }} aria-hidden />
          <div className="text-sm">{i.title}</div>
          {i.meta && <div className="mt-0.5 text-xs text-muted">{i.meta}</div>}
          {i.body && <div className="mt-2 rounded-xl bg-bg-2 px-3 py-2 text-sm text-text-2">{i.body}</div>}
        </li>
      ))}
    </ol>
  );
}

export function KeyValues({ items, columns = 2 }: { items: [ReactNode, ReactNode][]; columns?: 1 | 2 | 3 }) {
  return (
    <dl className={clsx('grid gap-x-6 gap-y-4', columns === 2 && 'sm:grid-cols-2', columns === 3 && 'sm:grid-cols-3')}>
      {items.map(([k, v], i) => (
        <div key={i} className="min-w-0">
          <dt className="t-label">{k}</dt>
          <dd className="mt-1 truncate text-[15px]">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Progress({ value, tone = 'lime', label }: { value: number; tone?: 'lime' | 'ok' | 'critical'; label: string }) {
  return (
    <div role="progressbar" aria-label={label} aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100} className="h-2 w-full overflow-hidden rounded-full bg-surface-3">
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: `var(--color-${tone})` }} />
    </div>
  );
}
