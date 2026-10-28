'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { Check, Copy, Lock } from 'lucide-react';
import type { DeviceState, Role } from '@hydris/domain';
import { useApi } from '@/lib/query';
import { Chip, EmptyState } from '@/ui';

// ---------------- API shapes ----------------
export interface Site { id: string; name: string; code: string }

export interface DeviceRow {
  id: string; siteId: string | null; name: string; kind: 'hardware' | 'simulator'; model: string | null;
  firmwareVersion: string | null; appVersion: string | null; displayInfo: { width: number; height: number } | null;
  status: 'active' | 'suspended' | 'revoked'; pairedAt: string; lastSeenAt: string | null; lastIp: string | null;
  suspendedAt: string | null; revokedAt: string | null; revokeReason: string | null; createdAt: string;
  siteName: string | null; assignee: { id: string; name: string | null; since: string | null } | null;
  streamOpen: boolean; state: DeviceState;
  /** Ownership approval (org policy requireDeviceApproval). */
  approvalState?: 'approved' | 'pending' | 'denied'; pendingUserId?: string | null;
}

export interface MemberRow {
  membershipId: string; userId: string; name: string; email: string; role: Role; status: 'invited' | 'active' | 'suspended' | 'removed';
  allSites: boolean; title: string | null; lastLoginAt: string | null; mfaEnabled: boolean; createdAt: string;
  employeeId: string | null; phone: string | null; shiftLabel: string | null; suspendedAt: string | null; removedAt: string | null;
  siteIds: string[]; devices: number; openInspections: number; openTasks: number;
}
export interface InvitationRow {
  id: string; email: string; name: string | null; role: Role; expiresAt: string; createdAt: string; status: 'pending' | 'expired';
  allSites: boolean; siteIds: string[]; employeeId: string | null; phone: string | null; shiftLabel: string | null;
}
export interface MembersResponse { members: MemberRow[]; invitations: InvitationRow[]; assignableRoles: Role[] }

export function useSites() {
  return useApi<{ sites: Site[] }>('/sites', { staleTime: 60_000 });
}

// ---------------- Small parts ----------------
export function NoAccess({ what }: { what: string }) {
  return <EmptyState icon={<Lock size={20} aria-hidden />} title="You do not have access to this" body={`Your role does not include permission to view ${what}. Ask an organization administrator if you need it.`} />;
}

export function MemberStatusChip({ status }: { status: MemberRow['status'] }) {
  if (status === 'active') return <Chip tone="ok">Active</Chip>;
  if (status === 'invited') return <Chip tone="outline">Invited</Chip>;
  if (status === 'suspended') return <Chip tone="high">Suspended</Chip>;
  return <Chip tone="outline" className="opacity-70">Removed</Chip>;
}

/** Read-only value with a copy button (invitation links, MFA secrets). */
export function CopyField({ value, label, mono }: { value: string; label: string; mono?: boolean }) {
  const id = useId();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      (document.getElementById(id) as HTMLInputElement | null)?.select();
    }
  };
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="flex gap-2">
        <input id={id} readOnly value={value} className={clsx('input min-w-0 flex-1', mono && 'font-mono text-[13px]')} onFocus={(e) => e.currentTarget.select()} />
        <button type="button" onClick={copy} className={clsx('btn flex-none', copied ? 'btn-primary' : 'btn-secondary')} aria-live="polite">
          {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

/** "All sites" vs specific sites, with multi-select checkboxes. */
export function SiteAccessPicker({ sites, allSites, siteIds, onChange, allowAllSites = true, disabled }: {
  sites: Site[]; allSites: boolean; siteIds: string[]; onChange: (v: { allSites: boolean; siteIds: string[] }) => void; allowAllSites?: boolean; disabled?: boolean;
}) {
  const name = useId();
  const toggle = (id: string) => onChange({ allSites: false, siteIds: siteIds.includes(id) ? siteIds.filter((x) => x !== id) : [...siteIds, id] });
  return (
    <fieldset className="grid gap-3" disabled={disabled}>
      <legend className="field-label mb-2">Site access</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className={clsx('card-inset flex cursor-pointer items-start gap-3 p-3.5', allSites && 'border-lime/60', !allowAllSites && 'cursor-not-allowed opacity-50')}>
          <input type="radio" name={name} className="mt-1 accent-[var(--color-lime)]" checked={allSites} disabled={!allowAllSites} onChange={() => onChange({ allSites: true, siteIds: [] })} />
          <span><span className="block text-sm">All sites</span><span className="text-xs text-muted">{allowAllSites ? 'Including sites added later' : 'Only organization-wide managers can grant this'}</span></span>
        </label>
        <label className={clsx('card-inset flex cursor-pointer items-start gap-3 p-3.5', !allSites && 'border-lime/60')}>
          <input type="radio" name={name} className="mt-1 accent-[var(--color-lime)]" checked={!allSites} onChange={() => onChange({ allSites: false, siteIds })} />
          <span><span className="block text-sm">Specific sites</span><span className="text-xs text-muted">Access limited to the sites selected below</span></span>
        </label>
      </div>
      {!allSites && (
        sites.length ? (
          <ul className="grid max-h-56 gap-1 overflow-y-auto rounded-[var(--radius-md)] border border-line p-1.5" aria-label="Sites">
            {sites.map((s) => (
              <li key={s.id}>
                <label className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-surface-2">
                  <input type="checkbox" className="h-4 w-4 accent-[var(--color-lime)]" checked={siteIds.includes(s.id)} onChange={() => toggle(s.id)} />
                  <span className="min-w-0 flex-1 truncate text-sm">{s.name}</span>
                  <span className="text-xs text-muted">{s.code}</span>
                </label>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted">No sites are available to you.</p>
      )}
      {!allSites && !siteIds.length && sites.length > 0 && <p className="field-hint">Select at least one site.</p>}
    </fieldset>
  );
}

/** Horizontal labelled bars on a hatched track (Trivi tiles). */
export function HBarList({ data, label, colorFor, limit = 8, empty = 'No records in this period.' }: {
  data: Record<string, number> | { key: string; value: number }[]; label: string; colorFor?: (key: string) => string; limit?: number; empty?: string;
}) {
  const entries = (Array.isArray(data) ? data.map((d) => [d.key, d.value] as [string, number]) : Object.entries(data)).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return <p className="text-sm text-muted">{empty}</p>;
  const shown = entries.slice(0, limit);
  const rest = entries.slice(limit).reduce((a, [, v]) => a + v, 0);
  const max = Math.max(1, ...shown.map(([, v]) => v));
  const total = entries.reduce((a, [, v]) => a + v, 0);
  return (
    <div>
      <ul className="grid gap-3" aria-label={label}>
        {shown.map(([k, v]) => (
          <li key={k} className="grid gap-1.5">
            <div className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="min-w-0 truncate text-text-2">{prettyKey(k)}</span>
              <span className="num flex-none">{v.toLocaleString()} <span className="text-muted">· {Math.round((v / total) * 100)}%</span></span>
            </div>
            <div className="hatch h-2.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
              <div className="h-full rounded-full" style={{ width: `${Math.max(2, (v / max) * 100)}%`, background: colorFor?.(k) ?? 'var(--color-text-2)' }} />
            </div>
          </li>
        ))}
      </ul>
      {rest > 0 && <p className="mt-3 text-xs text-muted">+ {entries.length - limit} more ({rest.toLocaleString()} records)</p>}
    </div>
  );
}

export const prettyKey = (k: string) => (k === '—' || k === 'null' ? 'Not set' : k.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()));

// ---------------- Formatting helpers ----------------
/** "2026-10-14 09:12:03 UTC" */
export const utcStamp = (v: string | Date) => `${new Date(v).toISOString().replace('T', ' ').slice(0, 19)} UTC`;

/** Very small user-agent summary for session lists ("Chrome on Windows"). */
export function describeAgent(ua: string | null | undefined) {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /curl|node|undici/i.test(ua) ? 'API client' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : null;
  return os ? `${browser} on ${os}` : browser;
}

export function timezones(): string[] {
  try {
    const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    const list = fn ? fn('timeZone') : [];
    return list.includes('UTC') ? list : ['UTC', ...list];
  } catch {
    return ['UTC'];
  }
}

export function Section({ title, children, aside }: { title: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="t-section">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}
