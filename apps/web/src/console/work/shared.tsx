'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import type {
  AssetType, DocumentKind, DocumentStatus, InspectionProgress, InspectionStatus, InspectionStep, MaintenanceKind, MaintenancePriority, MaintenanceStatus,
  Role, StepOutcome, StepValue, Freshness,
} from '@hydris/domain';
import { ApiError, errorMessage } from '@/lib/api';
import { useApi } from '@/lib/query';
import { Button } from '@/ui';

// ---------------------------------------------------------------- API shapes

export interface Attachment { id: string; filename: string; mime: string }

export interface InspectionRow {
  id: string; title: string; status: InspectionStatus; priority: 'normal' | 'high'; dueAt: string | null; siteId: string; assetId: string | null;
  assignedTo: string | null; startedAt: string | null; submittedAt: string | null; submittedVia: 'console' | 'glasses' | null; routeId: string | null;
  synthetic: boolean; revision: number; stepCount: number; answered: number; assetTag: string | null; assetName: string | null; assigneeName: string | null; siteName: string;
}

export interface StepResponse { value: StepValue; outcome: StepOutcome; note: string | null; recordedAt: string; deviceId: string | null }

export interface InspectionDetail {
  id: string; title: string; status: InspectionStatus; priority: 'normal' | 'high'; dueAt: string | null; siteId: string; assetId: string | null;
  templateId: string | null; templateVersion: number | null; routeId: string | null; steps: InspectionStep[]; safetyNotices: string[];
  assignedTo: string | null; assignedBy: string | null; startedAt: string | null; pausedAt: string | null; submittedAt: string | null;
  submittedVia: 'console' | 'glasses' | null; reviewedBy: string | null; reviewedAt: string | null; reviewNote: string | null; revision: number;
  synthetic: boolean; createdAt: string; updatedAt: string;
  asset: { id: string; tag: string; name: string; type: AssetType; status: string } | null;
  assignee: { id: string; name: string } | null;
  progress: InspectionProgress;
  attachments: Attachment[];
  responses: Record<string, StepResponse>;
}

export interface InspectionDetailResponse {
  inspection: InspectionDetail;
  followUps: { id: string; title: string; status: MaintenanceStatus; priority: MaintenancePriority }[];
  permissions: { execute: boolean; manage: boolean; review: boolean };
}

export interface Template {
  id: string; name: string; description: string | null; assetType: AssetType | null; version: number; steps: InspectionStep[]; safetyNotices: string[];
  estimatedMinutes: number | null; status: 'draft' | 'published' | 'archived'; updatedAt: string; createdAt: string;
}

export interface ChecklistItem { id: string; label: string; done: boolean; doneAt?: string | null; doneBy?: string | null }

export interface MaintenanceRow {
  id: string; title: string; description: string | null; kind: MaintenanceKind; priority: MaintenancePriority; status: MaintenanceStatus; siteId: string;
  assetId: string | null; assignedTo: string | null; requestedBy: string | null; sourceInspectionId: string | null; sourceAlarmId: string | null;
  checklist: ChecklistItem[]; dueAt: string | null; startedAt: string | null; completedAt: string | null; completionNote: string | null; synthetic: boolean;
  createdAt: string; updatedAt: string; assetTag: string | null; assetName: string | null; assigneeName: string | null; siteName: string;
}

export interface MaintenanceDetailResponse {
  task: Omit<MaintenanceRow, 'assetTag' | 'assetName' | 'assigneeName' | 'siteName'> & {
    asset: { id: string; tag: string; name: string; status: string } | null; assignee: { id: string; name: string } | null; attachments: Attachment[];
  };
  activity: { id: string; action: string; note: string | null; actorUserId: string | null; actorName: string | null; at: string }[];
  permissions: { manage: boolean; execute: boolean };
}

export interface DocumentRow {
  id: string; title: string; kind: DocumentKind; status: DocumentStatus; version: number; assetId: string | null; assetType: AssetType | null;
  siteId: string | null; tags: string[]; updatedAt: string; approvedAt: string | null;
}
export interface DocumentFull extends DocumentRow { body: string; approvedBy: string | null; createdBy: string | null; createdAt: string }

export interface AssistResponse {
  query: string;
  sources: { id: string; title: string; kind: DocumentKind; version: number; approvedAt: string | null; assetId: string | null; rank: number; passage: string }[];
  asset: { id: string; tag: string; name: string; status: string; manufacturer: string | null; model: string | null } | null;
  telemetry: { tag: string; label: string; value: number | null; unit: string; observedAt: string | null; freshness: Freshness; source: string | null; explanation: string }[];
  glossary: { term: string; unit: string; explanation: string }[];
  notice: string;
}

export interface AssetLite { id: string; tag: string; name: string; type: AssetType; siteId: string; siteName: string; status: string }
export interface Member { userId: string; name: string; email: string; role: Role; status: 'invited' | 'active' | 'deactivated'; title: string | null; openInspections: number; openTasks: number }

// ---------------------------------------------------------------- lookups

export function useAssets(enabled = true) {
  const q = useApi<{ assets: AssetLite[] }>(enabled ? '/assets' : null, { staleTime: 60_000 });
  return q;
}

export function useSites(enabled = true) {
  return useApi<{ sites: { id: string; name: string }[] }>(enabled ? '/sites' : null, { staleTime: 60_000 });
}

/** Active members, optionally restricted to roles. Requires member.read; callers hide the picker on error. */
export function useMembers(roles: readonly Role[] | null, enabled = true) {
  const q = useApi<{ members: Member[] }>(enabled ? '/members' : null, { staleTime: 60_000, retry: (n, e) => (e as ApiError)?.status !== 403 && n < 2 });
  const list = useMemo(() => (q.data?.members ?? []).filter((m) => m.status === 'active' && (!roles || roles.includes(m.role))), [q.data, roles]);
  return { q, list };
}

export const INSPECTION_EXECUTOR_ROLES: readonly Role[] = ['field_operator', 'maintenance_engineer', 'supervisor', 'factory_manager', 'org_admin'];
export const MAINTENANCE_ASSIGNEE_ROLES: readonly Role[] = ['maintenance_engineer', 'field_operator', 'supervisor', 'factory_manager', 'org_admin'];

// ---------------------------------------------------------------- dates

/** ISO → value for <input type="datetime-local"> in the viewer's zone. */
export function toLocalInput(v: string | null | undefined) {
  if (!v) return '';
  const d = new Date(v);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
export const zoneName = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'local time';
  }
};

export function isOverdue(dueAt: string | null, open: boolean) {
  return open && !!dueAt && new Date(dueAt).getTime() < Date.now();
}

// ---------------------------------------------------------------- errors

export const isConflict = (e: unknown) => e instanceof ApiError && e.status === 409;
export const isForbidden = (e: unknown) => e instanceof ApiError && e.status === 403;

/** Error message with field-level validation details when the API provides them. */
export function describeError(e: unknown): string {
  if (e instanceof ApiError && e.code === 'validation_failed' && Array.isArray(e.details)) {
    const parts = (e.details as { path?: string; message?: string }[]).slice(0, 4).map((d) => `${d.path ? `${d.path}: ` : ''}${d.message ?? ''}`);
    return `${e.message}. ${parts.join(' · ')}`;
  }
  return errorMessage(e);
}

export function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="flex items-start gap-2 rounded-2xl border border-[rgb(255_90_78/0.3)] bg-[rgb(255_90_78/0.06)] px-4 py-3 text-sm text-[#ffb1aa]">
      <AlertTriangle size={16} className="mt-0.5 flex-none text-critical" aria-hidden />
      <span>{describeError(error)}</span>
    </p>
  );
}

/** Persistent banner shown when the server reports the record changed underneath us. */
export function ConflictBanner({ message, onReload, busy }: { message: string; onReload: () => void; busy?: boolean }) {
  return (
    <div role="alert" className="mb-4 flex flex-wrap items-center gap-4 rounded-[var(--radius-xl)] border border-[rgb(245_184_61/0.4)] bg-[rgb(245_184_61/0.08)] p-4">
      <AlertTriangle size={20} className="text-medium" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="font-medium">This record changed since you loaded it</div>
        <div className="text-sm text-text-2">{message} Reload to see the latest version before trying again.</div>
      </div>
      <Button size="sm" variant="light" busy={busy} onClick={onReload} icon={<RefreshCw size={14} />}>Reload</Button>
    </div>
  );
}

// ---------------------------------------------------------------- small UI

export function useDebounced<T>(v: T, ms = 300) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

/** Labelled stat used inside detail headers. */
export function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="t-label">{label}</div>
      <div className="mt-1 truncate text-[15px]">{children}</div>
    </div>
  );
}

/** Renders text where the API wrapped matches in « » as highlighted marks. */
export function Highlighted({ text, tone = 'dark' }: { text: string; tone?: 'dark' | 'lime' }) {
  const parts = text.split(/(«[^»]*»)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('«') && p.endsWith('»') ? (
          <mark key={i} className={tone === 'lime' ? 'rounded bg-lime-ink px-1 text-lime' : 'rounded bg-lime px-1 text-lime-ink'}>{p.slice(1, -1)}</mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

export function newOpId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `op-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
