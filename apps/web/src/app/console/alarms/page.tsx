'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CheckCircle2, Siren } from 'lucide-react';
import { ALARM_SEVERITIES, ALARM_STATE_LABELS, ALARM_STATES, type AlarmSeverity, type AlarmState } from '@hydris/domain';
import { useApi } from '@/lib/query';
import { Capsule, Card, DataTable, EmptyState, KpiCard, PageHeader, QueryView, Select, SeverityChip, Skeleton, StateChip, Switch, SyntheticBadge, type Column } from '@/ui';
import type { AlarmListRow } from '@/console/alarms-telemetry/types';
import { When } from '@/console/alarms-telemetry/bits';

type StateFilter = 'open' | AlarmState | 'all';
const STATE_OPTIONS: { value: StateFilter; label: string }[] = [
  { value: 'open', label: 'Open' },
  ...ALARM_STATES.map((s) => ({ value: s as StateFilter, label: ALARM_STATE_LABELS[s] })),
  { value: 'all', label: 'All' },
];
const LIMIT = 200;

export default function AlarmsPage() {
  const router = useRouter();
  const [state, setState] = useState<StateFilter>('open');
  const [severity, setSeverity] = useState<AlarmSeverity | ''>('');
  const [mine, setMine] = useState(false);

  // Summary islands always reflect every open alarm, independent of the table filters.
  const open = useApi<{ alarms: AlarmListRow[] }>('/alarms?state=open&limit=500', { refetchInterval: 30_000 });
  const qs = new URLSearchParams();
  if (state !== 'all') qs.set('state', state);
  if (severity) qs.set('severity', severity);
  if (mine) qs.set('assignedToMe', 'true');
  qs.set('limit', String(LIMIT));
  const list = useApi<{ alarms: AlarmListRow[] }>(`/alarms?${qs}`, { refetchInterval: 30_000, placeholderData: (prev) => prev });

  const o = open.data?.alarms ?? [];
  const counts = {
    active: o.filter((a) => a.state === 'active').length,
    critical: o.filter((a) => a.severity === 'critical').length,
    acknowledged: o.filter((a) => a.state === 'acknowledged').length,
    stillInAlarm: o.filter((a) => !a.clearedAt).length,
  };

  const columns: Column<AlarmListRow>[] = [
    { key: 'sev', header: 'Severity', cell: (a) => <SeverityChip severity={a.severity} /> },
    {
      key: 'title', header: 'Alarm', className: 'min-w-[240px]',
      cell: (a) => (
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{a.title}</span>{a.synthetic && <SyntheticBadge />}</div>
          {a.description && <div className="mt-0.5 line-clamp-1 text-xs text-muted">{a.description}</div>}
        </div>
      ),
    },
    { key: 'asset', header: 'Asset', cell: (a) => a.assetTag ? <span className="text-text-2" title={a.assetName ?? undefined}>{a.assetTag}</span> : <span className="muted">—</span> },
    { key: 'at', header: 'Triggered', cell: (a) => <When at={a.triggeredAt} className="num whitespace-nowrap text-text-2" /> },
    { key: 'state', header: 'State', cell: (a) => <StateChip state={a.state} label={ALARM_STATE_LABELS[a.state]} /> },
    { key: 'who', header: 'Assignee', cell: (a) => a.assigneeName ? <span className="whitespace-nowrap">{a.assigneeName}</span> : <span className="muted">Unassigned</span> },
    {
      key: 'cond', header: 'Condition',
      cell: (a) => a.clearedAt
        ? <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-text-2" title={`Returned to normal ${new Date(a.clearedAt).toLocaleString()}`}><span className="dot" style={{ background: 'var(--color-ok)' }} aria-hidden />Condition cleared</span>
        : a.state === 'resolved' || a.state === 'closed'
          ? <span className="text-xs muted">—</span>
          : <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-[#ff9a5c]"><span className="dot pulse-dot" style={{ background: `var(--color-${a.severity === 'critical' ? 'critical' : 'high'})` }} aria-hidden />Still in alarm</span>,
    },
  ];

  const filtered = state !== 'open' || severity || mine;

  return (
    <>
      <PageHeader eyebrow="Operate · Alarms & events" title="Alarms & events"
        subtitle="Every threshold breach raised by the alarm engine. Acknowledge to record that you have seen an alarm, investigate, then resolve with a note once the condition is dealt with." />

      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        {open.isError ? null : open.data ? (
          <>
            <KpiCard label="Active · not yet acknowledged" value={counts.active} accent={counts.active ? 'high' : undefined} sub={<>{counts.stillInAlarm} open alarm{counts.stillInAlarm === 1 ? '' : 's'} still in alarm</>} />
            <KpiCard label="Critical open" value={counts.critical} accent={counts.critical ? 'critical' : undefined} sub={<>of {o.length} open alarm{o.length === 1 ? '' : 's'}</>} />
            <KpiCard label="Acknowledged, awaiting investigation" value={counts.acknowledged} sub="Seen by an operator; nobody investigating yet" />
          </>
        ) : [0, 1, 2].map((i) => <Skeleton key={i} className="h-[148px] rounded-[24px]" />)}
      </div>

      <Card>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Capsule label="Alarm state" value={state} onChange={setState} lime
            options={STATE_OPTIONS.map((s) => (s.value === 'open' && open.data ? { ...s, count: o.length } : s))} />
          <div className="flex flex-wrap items-center gap-4 sm:ml-auto">
            <Select aria-label="Severity" className="w-[180px]!" value={severity} onChange={(e) => setSeverity(e.target.value as AlarmSeverity | '')}
              placeholder="All severities" options={ALARM_SEVERITIES.map((s) => ({ value: s, label: s[0]!.toUpperCase() + s.slice(1) }))} />
            <Switch checked={mine} onChange={setMine} label="Assigned to me" />
          </div>
        </div>

        <QueryView q={list} loading={<div className="grid gap-2" role="status" aria-label="Loading alarms">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12" />)}</div>}>
          {(d) => (
            <div className={list.isFetching && list.isPlaceholderData ? 'opacity-60 transition-opacity' : undefined} aria-busy={list.isFetching || undefined}>
              <DataTable dense rows={d.alarms} rowKey={(a) => a.id} columns={columns} onRowClick={(a) => router.push(`/console/alarms/${a.id}`)}
                empty={filtered
                  ? <EmptyState icon={<Siren size={20} aria-hidden />} title="No alarms match these filters" body="Try another state or severity, or turn off “Assigned to me”." />
                  : <EmptyState icon={<CheckCircle2 size={20} aria-hidden />} title="No open alarms" body="All monitored conditions are within their configured limits." />} />
              {d.alarms.length >= LIMIT && <p className="mt-3 text-xs text-muted">Showing the {LIMIT} most relevant alarms. Narrow the filters to see older events.</p>}
              <p className="sr-only" role="status">{d.alarms.length} alarm{d.alarms.length === 1 ? '' : 's'} listed</p>
            </div>
          )}
        </QueryView>
      </Card>
    </>
  );
}
