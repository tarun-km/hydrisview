import { MEASURAND_DEFS, type Measurand } from '@hydris/domain';

/** Times are stored in UTC and shown in the viewer's local zone with explicit context. */
export function fmtDateTime(v: string | Date | null | undefined, opts: Intl.DateTimeFormatOptions = {}) {
  if (!v) return '—';
  return new Date(v).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', ...opts });
}
export const fmtDate = (v: string | Date | null | undefined) => (v ? new Date(v).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const fmtTime = (v: string | Date | null | undefined) => (v ? new Date(v).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—');

export function ago(v: string | Date | null | undefined, now = Date.now()): string {
  if (!v) return 'never';
  const s = Math.round((now - new Date(v).getTime()) / 1000);
  if (s < 0) return 'just now';
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function until(v: string | Date | null | undefined, now = Date.now()): string {
  if (!v) return 'no due date';
  const s = Math.round((new Date(v).getTime() - now) / 1000);
  if (s < 0) return `overdue ${ago(v, now).replace(' ago', '')}`;
  if (s < 3600) return `due in ${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `due in ${Math.floor(s / 3600)}h`;
  return `due in ${Math.floor(s / 86400)}d`;
}

export function fmtValue(value: number | null | undefined, measurand?: string, decimals?: number): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const d = decimals ?? (measurand && measurand in MEASURAND_DEFS ? MEASURAND_DEFS[measurand as Measurand].decimals : 2);
  return value.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

export const label = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
export const initials = (name: string) => name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
