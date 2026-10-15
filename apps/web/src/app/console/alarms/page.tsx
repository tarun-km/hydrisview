'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CheckCircle2, Siren } from 'lucide-react';
import { ALARM_SEVERITIES, ALARM_STATE_LABELS, ALARM_STATES, type AlarmSeverity, type AlarmState } from '@hydris/domain';
import { useApi } from '@/lib/query';
import { Capsule, Card, DataTable, EmptyState, KpiCard, PageHeader, QueryView, Select, SeverityChip, Skeleton, StateChip, Switch, SyntheticBadge, type Column } from '@/ui';
import type { AlarmListRow } from '@/console/alarms-telemetry/types';
import { When } from '@/console/alarms-telemetry/bits';
import { HOURS, Heatmap, SEVERITY_COLORS, Sparkbars, StackedBar, WEEKDAYS, perDay, weekHourGrid, Delta, type Datum } from '@/ui/charts';

const DAY = 86400_000;
const SEV_LABEL: Record<AlarmSeverity, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };

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
  // 28 local days of history (all states) for the trend + time-of-day pattern; key changes once a day.
  const histFrom = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() - 27 * DAY; })();
  const hist = useApi<{ alarms: AlarmListRow[] }>(`/alarms?from=${new Date(histFrom).toISOString()}&limit=500`, { refetchInterval: 60_000 });

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
          : <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-high-text"><span className="dot pulse-dot" style={{ background: `var(--color-${a.severity === 'critical' ? 'critical' : 'high'})` }} aria-hidden />Still in alarm</span>,
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

      <div className="mb-4 grid gap-4 lg:grid-cols-[1fr_1.2fr_1.3fr]">
        <Card title="Open by severity">
          {open.isError ? <p className="text-sm text-muted">Could not load open alarms.</p> : !open.data ? <Skeleton className="h-[120px]" /> : <SeverityMix alarms={o} />}
        </Card>
        <Card title="Raised per day" action={<span className="t-label">last 14 days</span>}>
          {hist.isError ? <p className="text-sm text-muted">Could not load alarm history.</p> : !hist.data ? <Skeleton className="h-[120px]" /> : <DailyBars alarms={hist.data.alarms} />}
        </Card>
        <Card title="When alarms happen" action={<span className="t-label">last 28 days · local time</span>}>
          {hist.isError ? <p className="text-sm text-muted">Could not load alarm history.</p> : !hist.data ? <Skeleton className="h-[120px]" /> : hist.data.alarms.length ? (
            <>
              <Heatmap rows={weekHourGrid(hist.data.alarms.map((a) => a.triggeredAt))} rowLabels={WEEKDAYS} colLabels={HOURS} color="var(--color-orange)" cell={11} unit="alarms"
                ariaLabel={`Alarms raised by weekday and hour over the last 28 days, ${hist.data.alarms.length} in total`} />
              {hist.data.alarms.length >= 500 && <p className="mt-2 text-xs text-muted">Based on the 500 most relevant alarms.</p>}
            </>
          ) : <p className="text-sm text-muted">No alarms raised in the last 28 days.</p>}
        </Card>
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

function SeverityMix({ alarms }: { alarms: AlarmListRow[] }) {
  const data: Datum[] = ALARM_SEVERITIES.map((s) => ({ key: s, label: SEV_LABEL[s], value: alarms.filter((a) => a.severity === s).length, color: SEVERITY_COLORS[s] }));
  const acked = alarms.filter((a) => a.state !== 'active').length;
  return (
    <div className="grid gap-4">
      <div className="flex items-baseline gap-2"><span className="t-kpi-sm">{alarms.length}</span><span className="text-sm text-muted">open · {acked} acknowledged</span></div>
      <StackedBar data={data} height={14} table empty="No open alarms" ariaLabel={`Open alarms by severity: ${data.map((d) => `${d.value} ${d.key}`).join(', ')}`} />
    </div>
  );
}

function DailyBars({ alarms }: { alarms: AlarmListRow[] }) {
  const days = perDay(alarms.map((a) => a.triggeredAt), 28);
  const last = days.slice(-14);
  const sum = (xs: { value: number }[]) => xs.reduce((a, d) => a + d.value, 0);
  const thisWeek = sum(days.slice(-7)), lastWeek = sum(days.slice(-14, -7));
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="t-kpi-sm">{sum(last)}</span><span className="text-sm text-muted">raised</span>
        <Delta value={thisWeek} previous={lastWeek} goodWhen="down" suffix="this week vs last" />
      </div>
      <Sparkbars data={last} height={64} highlight="var(--color-orange)" color="var(--color-surface-3)" table emphasise="peak"
        ariaLabel={`Alarms raised per day, last 14 days: ${last.map((d) => d.value).join(', ')}`} axis={[last[0]?.label ?? '', 'today']} />
    </div>
  );
}
