'use client';

import { useState } from 'react';
import { History } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { useApi } from '@/lib/query';
import { ago, fmtDateTime } from '@/lib/format';
import { Button, Card, ErrorState, Skeleton, Timeline } from '@/ui';

export type HistoryEntity = 'asset' | 'sensor' | 'alarm_rule' | 'maintenance' | 'document' | 'inspection_template';

export interface HistoryEvent {
  id: string;
  action: string;
  summary: string | null;
  metadata: { changes?: Record<string, { from: unknown; to: unknown }>; reason?: string; [k: string]: unknown } | null;
  at: string;
  actor: { id: string | null; name: string | null };
}

const VERB: Record<string, string> = {
  created: 'Created', updated: 'Edited', archived: 'Archived', restored: 'Restored', deleted: 'Deleted', approved: 'Approved', published: 'Published',
  unpublished: 'Moved to draft', enabled: 'Enabled', disabled: 'Disabled', manual_entry: 'Reading entered', reading_corrected: 'Reading corrected',
  reading_invalidated: 'Reading invalidated', threshold_changed: 'Alarm threshold changed', threshold_added: 'Alarm threshold added', exported: 'Data exported',
  uploaded: 'File attached', complete: 'Completed', start: 'Started', hold: 'Put on hold', cancel: 'Cancelled', reopen: 'Reopened',
};

const FIELD: Record<string, string> = {
  expectedIntervalS: 'expected interval (s)', gatewayId: 'gateway', sourceRef: 'gateway reference', processAreaId: 'process area', assignedTo: 'assignee',
  dueAt: 'due', serialNumber: 'serial number', installedOn: 'installed on', estimatedMinutes: 'estimated minutes', assetType: 'asset type',
  onDelayS: 'on-delay (s)', recommendedAction: 'recommended action', procedureDocumentId: 'procedure', positionX: 'map X', positionY: 'map Y', assetId: 'asset',
};

const tone = (action: string): 'lime' | 'critical' | 'ok' | 'muted' | 'cobalt' =>
  /archived|invalidated|deleted|disabled|cancel/.test(action) ? 'critical' : /created|restored|approved|published|complete|enabled/.test(action) ? 'ok' : /corrected|threshold/.test(action) ? 'cobalt' : 'lime';

function show(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.length ? v.map(show).join(', ') : '—';
  if (typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v)) return fmtDateTime(v);
  if (typeof v === 'string' && /^[0-9a-f-]{36}$/.test(v)) return `…${v.slice(-6)}`;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export function describeAction(action: string) {
  const verb = action.split('.').pop() ?? action;
  return VERB[verb] ?? verb.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * Change history for one record, read from the append-only audit trail. `version` should change
 * whenever the record changes (e.g. its updatedAt) so the panel refreshes after an edit.
 */
export function HistoryCard({ entityType, entityId, version, title = 'History', initial = 8 }: {
  entityType: HistoryEntity; entityId: string; version?: string | number | null; title?: string; initial?: number;
}) {
  const q = useApi<{ events: HistoryEvent[] }>(`/history/${entityType}/${entityId}?limit=200${version !== undefined && version !== null ? `&v=${encodeURIComponent(String(version))}` : ''}`, { retry: false });
  const [all, setAll] = useState(false);
  if (q.error instanceof ApiError && q.error.status === 403) return null;
  const events = q.data?.events ?? [];
  const shown = all ? events : events.slice(0, initial);
  return (
    <Card title={<h2 className="t-card flex items-center gap-2"><History size={16} aria-hidden />{title}</h2>}
      action={events.length > initial ? <Button size="sm" variant="ghost" onClick={() => setAll((v) => !v)}>{all ? 'Show recent' : `Show all ${events.length}`}</Button> : undefined}>
      {q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data ? <Skeleton className="h-24" /> : (
        <Timeline items={shown.map((e) => {
          const changes = Object.entries(e.metadata?.changes ?? {});
          const reason = typeof e.metadata?.reason === 'string' ? e.metadata.reason : null;
          return {
            id: e.id,
            tone: tone(e.action),
            title: <><span className="font-medium">{describeAction(e.action)}</span>{e.summary ? <span className="text-text-2"> · {e.summary}</span> : null}</>,
            meta: <><span>{e.actor.name ?? 'System'}</span> · <time dateTime={e.at} title={fmtDateTime(e.at)}>{ago(e.at)}</time></>,
            body: changes.length || reason ? (
              <div className="grid gap-1">
                {changes.slice(0, 8).map(([k, c]) => (
                  <div key={k} className="text-[13px]"><span className="text-muted">{FIELD[k] ?? k.replace(/([A-Z])/g, ' $1').toLowerCase()}:</span>{' '}
                    <span className="line-through decoration-1 opacity-70">{show(c.from)}</span> → <span>{show(c.to)}</span></div>
                ))}
                {changes.length > 8 && <div className="text-xs text-muted">+{changes.length - 8} more fields</div>}
                {reason && <div className="text-[13px]"><span className="text-muted">Reason:</span> {reason}</div>}
              </div>
            ) : undefined,
          };
        })} />
      )}
    </Card>
  );
}
