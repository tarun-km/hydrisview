'use client';

import {
  ASSET_STATUSES, ASSET_STATUS_LABELS, ASSET_TYPES, ASSET_TYPE_LABELS, CRITICALITIES, FACILITY_KINDS, FACILITY_KIND_LABELS, PROCESS_AREA_KINDS, PROCESS_AREA_KIND_LABELS,
  type AlarmSeverity, type AssetStatus,
} from '@hydris/domain';
import { ApiError, getAccessToken, refreshSession } from '@/lib/api';
import { label } from '@/lib/format';

export const STATUS_COLOR: Record<AssetStatus, string> = {
  operational: 'var(--color-ok)',
  standby: 'var(--color-muted)',
  maintenance: 'var(--color-cobalt)',
  degraded: 'var(--color-medium)',
  down: 'var(--color-critical)',
  decommissioned: 'var(--color-surface-3)',
};

export const SEVERITY_RANK: Record<AlarmSeverity, number> = { low: 1, medium: 2, high: 3, critical: 4 };

/** Pin / bar colour: worst open alarm wins; otherwise the recorded operating status. */
export function healthColor(a: { status: AssetStatus; worstSeverity: AlarmSeverity | null; openAlarms: number }) {
  if (a.openAlarms > 0 && a.worstSeverity) return `var(--color-${a.worstSeverity})`;
  return STATUS_COLOR[a.status];
}

/** 0..1 "attention" level used by the route profile strip. */
export function attentionLevel(a: { status: AssetStatus; worstSeverity: AlarmSeverity | null; openAlarms: number }) {
  const sev = a.openAlarms > 0 && a.worstSeverity ? SEVERITY_RANK[a.worstSeverity] / 4 : 0;
  const st = a.status === 'down' ? 1 : a.status === 'degraded' ? 0.55 : a.status === 'maintenance' ? 0.4 : 0;
  return Math.max(0.18, sev, st);
}

export function healthLabel(a: { status: AssetStatus; worstSeverity: AlarmSeverity | null; openAlarms: number }) {
  const st = ASSET_STATUS_LABELS[a.status];
  return a.openAlarms > 0 && a.worstSeverity ? `${st}, ${a.openAlarms} open alarm${a.openAlarms > 1 ? 's' : ''} (worst ${a.worstSeverity})` : st;
}

export const assetTypeOptions = ASSET_TYPES.map((t) => ({ value: t, label: ASSET_TYPE_LABELS[t] }));
export const assetStatusOptions = ASSET_STATUSES.map((s) => ({ value: s, label: ASSET_STATUS_LABELS[s] }));
export const criticalityOptions = CRITICALITIES.map((c) => ({ value: c, label: label(c) }));
export const facilityKindOptions = FACILITY_KINDS.map((k) => ({ value: k, label: FACILITY_KIND_LABELS[k] }));
export const areaKindOptions = PROCESS_AREA_KINDS.map((k) => ({ value: k, label: PROCESS_AREA_KIND_LABELS[k] }));

export const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** Optional number from a form field; '' -> null, invalid -> NaN (caller validates). */
export function numOrNull(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  return Number(t);
}
export const txtOrNull = (v: string) => (v.trim() ? v.trim() : null);

/**
 * Authenticated binary fetch for attachments. The bearer token lives in memory only, so
 * attachments cannot be linked directly; we fetch the blob and open an object URL instead.
 */
export async function fetchBlob(path: string): Promise<Blob> {
  const go = () => {
    const t = getAccessToken();
    return fetch(`/api${path}`, { headers: t ? { authorization: `Bearer ${t}` } : {}, credentials: 'same-origin' });
  };
  let res = await go();
  if (res.status === 401 && (await refreshSession())) res = await go();
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: { code?: string; message?: string } };
    throw new ApiError(res.status, data.error?.code ?? 'request_failed', data.error?.message ?? `Request failed (${res.status})`);
  }
  return res.blob();
}

export async function openAttachment(id: string) {
  // Open the tab synchronously (inside the click) so pop-up blockers allow it, then navigate it.
  const win = window.open('', '_blank');
  try {
    const blob = await fetchBlob(`/attachments/${id}`);
    const url = URL.createObjectURL(blob);
    if (win) win.location.href = url;
    else window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    win?.close();
    throw e;
  }
}

export const isApiError = (e: unknown, code?: string): e is ApiError => e instanceof ApiError && (code === undefined || e.code === code);
