'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Lock, Search, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useCan } from '@/lib/session';
import { fmtDateTime } from '@/lib/format';
import { Button, Card, EmptyState, ErrorState, LoadingBlock, PageHeader, Select, cx } from '@/ui';
import { NoAccess, utcStamp } from '@/console/admin/parts';

interface AuditEvent {
  id: string; orgId: string | null; actorUserId: string | null; actorDeviceId: string | null; actorLabel: string | null; actorName: string | null;
  action: string; entityType: string | null; entityId: string | null; summary: string | null; metadata: Record<string, unknown> | null; ip: string | null; at: string;
}

const PAGE = 100;
const ACTIONS = ['alarm', 'alarm_rule', 'asset', 'auth', 'device', 'document', 'facility', 'gateway', 'inspection', 'maintenance', 'member', 'organization', 'report', 'sensor', 'simulation', 'site'];
const ENTITIES = ['alarm', 'alarm_rule', 'asset', 'device', 'document', 'facility', 'gateway', 'inspection', 'inspection_template', 'invitation', 'maintenance', 'membership', 'organization', 'pairing', 'report', 'sensor', 'session', 'simulation', 'site', 'user'];
const pretty = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export default function AuditPage() {
  const can = useCan();
  const allowed = can('audit.read');
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);

  const base = useMemo(() => {
    const p = new URLSearchParams({ limit: String(PAGE) });
    if (action) p.set('action', `${action}.`);
    if (entityType) p.set('entityType', entityType);
    if (debounced) p.set('q', debounced);
    if (from) p.set('from', new Date(`${from}T00:00:00`).toISOString());
    if (to) p.set('to', new Date(`${to}T23:59:59.999`).toISOString());
    return `/audit?${p.toString()}`;
  }, [action, entityType, debounced, from, to]);

  // Keyed under 'api' so realtime invalidation by path prefix also refreshes this list.
  const q = useInfiniteQuery({
    queryKey: ['api', base, 'pages'],
    enabled: allowed,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api<{ events: AuditEvent[] }>(pageParam ? `${base}&before=${encodeURIComponent(pageParam)}` : base),
    getNextPageParam: (last) => (last.events.length === PAGE ? last.events[last.events.length - 1]!.at : null),
  });
  const events = q.data?.pages.flatMap((p) => p.events) ?? [];
  const filtered = !!(action || entityType || debounced || from || to);
  const clear = () => { setAction(''); setEntityType(''); setText(''); setFrom(''); setTo(''); };

  return (
    <>
      <PageHeader eyebrow="Insight" title="Audit log" subtitle="Who did what, when and from where, across the console, the glasses and the simulator." />
      {!allowed ? <NoAccess what="the audit log" /> : (
        <div className="grid gap-4">
          <div className="flex items-start gap-3 rounded-[var(--radius-xl)] border border-line bg-bg-2 px-5 py-4 text-sm text-text-2">
            <Lock size={16} className="mt-0.5 flex-none text-lime" aria-hidden />
            <p>The audit log is append-only: events are written as actions happen and cannot be edited or deleted from Hydris, including by administrators. Times are stored in UTC and also shown in your local time zone.</p>
          </div>
          <Card tight>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[1.4fr_1fr_1fr_auto_auto_auto] xl:items-end">
              <div className="field">
                <label htmlFor="audit-q">Search</label>
                <div className="relative">
                  <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
                  <input id="audit-q" className="input input-search" placeholder="Summary or person" value={text} onChange={(e) => setText(e.target.value)} />
                </div>
              </div>
              <Select label="Action" value={action} onChange={(e) => setAction(e.target.value)} placeholder="All actions" options={ACTIONS.map((a) => ({ value: a, label: `${pretty(a)} (${a}.*)` }))} />
              <Select label="Entity" value={entityType} onChange={(e) => setEntityType(e.target.value)} placeholder="All entities" options={ENTITIES.map((a) => ({ value: a, label: pretty(a) }))} />
              <label className="field"><span className="field-label">From</span><input type="date" className="input" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></label>
              <label className="field"><span className="field-label">To</span><input type="date" className="input" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></label>
              <Button variant="ghost" icon={<X size={15} aria-hidden />} disabled={!filtered} onClick={clear}>Clear</Button>
            </div>
          </Card>

          <Card>
            {q.isError && !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} />
              : !q.data ? <LoadingBlock rows={6} />
              : !events.length ? <EmptyState title={filtered ? 'No events match these filters' : 'No audit events yet'} body={filtered ? 'Widen the date range or clear filters.' : undefined} />
              : (
                <div className="-mx-2 overflow-x-auto px-2">
                  <table className="table">
                    <thead>
                      <tr>
                        <th scope="col" className="w-8"><span className="sr-only">Expand</span></th>
                        <th scope="col">Time</th>
                        <th scope="col">Actor</th>
                        <th scope="col">Action</th>
                        <th scope="col">Entity</th>
                        <th scope="col">Summary</th>
                        <th scope="col">IP</th>
                      </tr>
                    </thead>
                    <tbody>
                      {events.map((e) => {
                        const expanded = open === e.id;
                        return (
                          <Fragment key={e.id}>
                            <tr className={cx(expanded && 'bg-tint')} data-href="" onClick={() => setOpen(expanded ? null : e.id)}>
                              <td className="pr-0">
                                <button type="button" className="icon-btn icon-btn-sm h-7 w-7 border-transparent bg-transparent" aria-expanded={expanded} aria-controls={`audit-${e.id}`}
                                  aria-label={expanded ? 'Hide details' : 'Show details'} onClick={(ev) => { ev.stopPropagation(); setOpen(expanded ? null : e.id); }}>
                                  {expanded ? <ChevronDown size={15} aria-hidden /> : <ChevronRight size={15} aria-hidden />}
                                </button>
                              </td>
                              <td className="whitespace-nowrap">
                                <div className="num text-[13px]">{utcStamp(e.at)}</div>
                                <div className="num text-xs text-muted">{fmtDateTime(e.at, { second: '2-digit' })} local</div>
                              </td>
                              <td className="whitespace-nowrap">
                                {e.actorName ?? e.actorLabel ?? (e.actorDeviceId ? 'Field glasses' : 'System')}
                                {e.actorDeviceId && <div className="text-xs text-muted">via glasses</div>}
                              </td>
                              <td><code className={cx('rounded-md px-1.5 py-0.5 font-mono text-[12.5px]', /revoked|failed|reuse|deactivated|suspended/.test(e.action) ? 'bg-[rgb(255_40_0/0.12)] text-critical-text' : 'bg-surface-2 text-text-2')}>{e.action}</code></td>
                              <td className="whitespace-nowrap text-text-2">{e.entityType ? pretty(e.entityType) : '—'}</td>
                              <td><span className="block max-w-[360px] truncate" title={e.summary ?? undefined}>{e.summary ?? <span className="text-muted">—</span>}</span></td>
                              <td className="whitespace-nowrap font-mono text-[12.5px] text-muted">{e.ip ?? '—'}</td>
                            </tr>
                            {expanded && (
                              <tr id={`audit-${e.id}`}>
                                <td />
                                <td colSpan={6} className="pt-0">
                                  <div className="grid gap-3 rounded-2xl bg-bg-2 p-4 text-[13px] lg:grid-cols-[260px_1fr]">
                                    <dl className="grid content-start gap-2">
                                      <div><dt className="t-label">Event id</dt><dd className="break-all font-mono text-xs">{e.id}</dd></div>
                                      {e.entityId && <div><dt className="t-label">Entity id</dt><dd className="break-all font-mono text-xs">{e.entityId}</dd></div>}
                                      {e.actorUserId && <div><dt className="t-label">Actor user id</dt><dd className="break-all font-mono text-xs">{e.actorUserId}</dd></div>}
                                      {e.actorDeviceId && <div><dt className="t-label">Actor device id</dt><dd className="break-all font-mono text-xs">{e.actorDeviceId}</dd></div>}
                                    </dl>
                                    <div className="min-w-0">
                                      <div className="t-label mb-1">Metadata</div>
                                      {e.metadata && Object.keys(e.metadata).length
                                        ? <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-xl border border-line bg-bg p-3 font-mono text-xs leading-relaxed text-text-2">{JSON.stringify(e.metadata, null, 2)}</pre>
                                        : <p className="text-muted">No metadata recorded for this event.</p>}
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            {q.data && events.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 text-sm text-muted">
                <span className="num">{events.length.toLocaleString()} events loaded</span>
                {q.hasNextPage
                  ? <Button size="sm" busy={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>Load older events</Button>
                  : <span>Beginning of the log for these filters</span>}
              </div>
            )}
            {q.isError && q.data && <p role="alert" className="field-error mt-3">Could not load more events. Try again.</p>}
          </Card>
        </div>
      )}
    </>
  );
}
