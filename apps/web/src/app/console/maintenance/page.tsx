'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Clock, Info, Plus, Search } from 'lucide-react';
import { MAINTENANCE_PRIORITIES, MAINTENANCE_STATUS_LABELS, type MaintenancePriority } from '@hydris/domain';
import { useApi } from '@/lib/query';
import { useCan } from '@/lib/session';
import { fmtDate, label as humanize, until } from '@/lib/format';
import { Avatar, Button, Capsule, DataTable, EmptyState, PageHeader, QueryView, Select, Skeleton, StateChip, Switch, SyntheticBadge, type Column } from '@/ui';
import { NO_ACTUATION, NewRequestDialog } from '@/console/work/maintenance-forms';
import { isOverdue, type MaintenanceRow } from '@/console/work/shared';
import { PRIORITY_COLORS, Sparkbars, StackedBar, median, perDay, type Datum } from '@/ui/charts';

type Filter = 'open_all' | 'in_progress' | 'on_hold' | 'completed' | 'all';
const OPEN = ['open', 'assigned', 'in_progress', 'on_hold'];
const EMPTY: Record<Filter, string> = {
  open_all: 'No open maintenance', in_progress: 'Nothing in progress', on_hold: 'Nothing on hold', completed: 'No completed tasks', all: 'No maintenance tasks yet',
};

export default function MaintenancePage() {
  const can = useCan();
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('open_all');
  const [priority, setPriority] = useState<MaintenancePriority | ''>('');
  const [mine, setMine] = useState(false);
  const [text, setText] = useState('');
  const [newOpen, setNewOpen] = useState(false);

  const params = new URLSearchParams();
  if (filter !== 'all') params.set('status', filter);
  if (priority) params.set('priority', priority);
  if (mine) params.set('mine', 'true');
  const qs = params.toString();
  const q = useApi<{ tasks: MaintenanceRow[] }>(`/maintenance${qs ? `?${qs}` : ''}`, { refetchInterval: 60_000 });

  const rows = useMemo(() => {
    const t = text.trim().toLowerCase();
    const all = q.data?.tasks ?? [];
    return t ? all.filter((r) => [r.title, r.assetTag, r.assetName, r.assigneeName].some((v) => v?.toLowerCase().includes(t))) : all;
  }, [q.data, text]);

  const columns: Column<MaintenanceRow>[] = [
    { key: 'priority', header: 'Priority', cell: (r) => <StateChip state={r.priority} label={humanize(r.priority)} /> },
    {
      key: 'title', header: 'Task', cell: (r) => (
        <div className="min-w-[220px]">
          <div className="flex items-center gap-2"><span className="font-medium">{r.title}</span>{r.synthetic && <SyntheticBadge />}</div>
          <div className="text-xs text-muted num">{r.checklist.length ? `${r.checklist.filter((c) => c.done).length}/${r.checklist.length} checklist · ` : ''}{r.siteName}</div>
        </div>
      ),
    },
    { key: 'asset', header: 'Asset', cell: (r) => (r.assetTag ? <div><div className="num text-sm">{r.assetTag}</div><div className="max-w-[180px] truncate text-xs text-muted">{r.assetName}</div></div> : <span className="text-muted">—</span>) },
    { key: 'assignee', header: 'Assignee', cell: (r) => (r.assigneeName ? <span className="flex items-center gap-2 whitespace-nowrap"><Avatar name={r.assigneeName} size={28} />{r.assigneeName}</span> : <span className="text-muted">Unassigned</span>) },
    { key: 'status', header: 'Status', cell: (r) => <StateChip state={r.status} label={MAINTENANCE_STATUS_LABELS[r.status]} /> },
    {
      key: 'due', header: 'Due', cell: (r) => {
        if (r.status === 'completed') return <span className="whitespace-nowrap text-sm text-muted">done {fmtDate(r.completedAt)}</span>;
        if (!OPEN.includes(r.status)) return <span className="text-muted">—</span>;
        const late = isOverdue(r.dueAt, true);
        return <span className={late ? 'inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-high-text' : 'whitespace-nowrap text-sm text-text-2'}>{late && <Clock size={13} aria-hidden />}{until(r.dueAt)}</span>;
      },
    },
    { key: 'kind', header: 'Kind', cell: (r) => <span className="whitespace-nowrap text-sm text-text-2">{humanize(r.kind)}</span> },
  ];

  return (
    <>
      <PageHeader eyebrow="Work · Maintenance" title="Maintenance"
        subtitle="Corrective and preventive work, including follow-ups raised automatically from abnormal inspections and alarms."
        actions={can('maintenance.request') ? <Button variant="primary" icon={<Plus size={16} />} onClick={() => setNewOpen(true)}>New request</Button> : undefined} />

      <MaintenanceInsights />

      <p className="mb-4 flex items-start gap-2 text-[13px] text-text-2"><Info size={15} className="mt-0.5 flex-none text-cobalt" aria-hidden />{NO_ACTUATION}</p>

      <section className="card fade-in" aria-label="Maintenance tasks">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Capsule label="Task status filter" value={filter} onChange={setFilter} options={[
            { value: 'open_all', label: 'Open' }, { value: 'in_progress', label: 'In progress' }, { value: 'on_hold', label: 'On hold' }, { value: 'completed', label: 'Completed' }, { value: 'all', label: 'All' },
          ]} />
          <Select aria-label="Priority filter" className="!w-[160px]" value={priority} onChange={(e) => setPriority(e.target.value as MaintenancePriority | '')} placeholder="Any priority"
            options={MAINTENANCE_PRIORITIES.map((p) => ({ value: p, label: humanize(p) }))} />
          <Switch checked={mine} onChange={setMine} label="Mine" />
          <div className="relative ml-auto w-full sm:w-[260px]">
            <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
            <input className="input input-search" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Filter by title, asset, person" aria-label="Filter tasks" />
          </div>
        </div>
        <QueryView q={q} loading={<div className="grid gap-2" role="status" aria-label="Loading tasks">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-14" />)}</div>}>
          {() => (
            <>
              <DataTable rows={rows} rowKey={(r) => r.id} columns={columns} onRowClick={(r) => router.push(`/console/maintenance/${r.id}`)}
                empty={<EmptyState title={text ? 'No matches' : EMPTY[filter]} body={text ? `No task in this view matches “${text}”.` : mine ? 'Nothing here is assigned to you.' : 'Requests raised by operators, inspections and alarms appear here.'} />} />
              {rows.length > 0 && <p className="mt-3 text-xs text-muted num">{rows.length} task{rows.length === 1 ? '' : 's'}{q.isFetching ? ' · refreshing…' : ''}</p>}
            </>
          )}
        </QueryView>
      </section>
      {can('maintenance.request') && <NewRequestDialog open={newOpen} onOpenChange={setNewOpen} canAssign={can('maintenance.manage')} />}
    </>
  );
}

const STATUS_FILL: Record<string, string> = {
  open: 'var(--color-muted)', assigned: 'var(--color-purple)', in_progress: 'var(--color-signal)', on_hold: 'var(--color-medium)',
};

/** Backlog shape + throughput from the task list (all statuses the user can see). */
function MaintenanceInsights() {
  const q = useApi<{ tasks: MaintenanceRow[] }>('/maintenance', { refetchInterval: 60_000 });
  if (q.isError) return null;
  if (!q.data) {
    return <div className="mb-4 grid gap-4 lg:grid-cols-3" role="status" aria-label="Loading maintenance insights">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[200px] rounded-[24px]" />)}</div>;
  }
  const tasks = q.data.tasks;
  if (!tasks.length) return null;
  const open = tasks.filter((t) => OPEN.includes(t.status));
  const byPriority: Datum[] = [...MAINTENANCE_PRIORITIES].reverse().map((p) => ({ key: p, label: humanize(p), value: open.filter((t) => t.priority === p).length, color: PRIORITY_COLORS[p] }));
  const byStatus: Datum[] = OPEN.map((s) => ({ key: s, label: MAINTENANCE_STATUS_LABELS[s as keyof typeof MAINTENANCE_STATUS_LABELS], value: open.filter((t) => t.status === s).length, color: STATUS_FILL[s]!, hatch: s === 'open' || s === 'on_hold' }));
  const done = tasks.filter((t) => t.completedAt);
  const hrs = median(done.map((t) => (new Date(t.completedAt!).getTime() - new Date(t.createdAt).getTime()) / 3600_000));
  const perDayDone = perDay(done.map((t) => t.completedAt), 14);
  const overdue = open.filter((t) => isOverdue(t.dueAt, true)).length;
  return (
    <div className="stagger mb-4 grid gap-4 lg:grid-cols-3">
      <section className="card grid content-start gap-4" aria-labelledby="mt-prio">
        <div className="flex items-baseline justify-between gap-3"><h2 id="mt-prio" className="t-card">Open backlog by priority</h2><span className="t-label num">{open.length} open</span></div>
        <StackedBar data={byPriority} height={14} table empty="No open tasks" ariaLabel={`Open tasks by priority: ${byPriority.map((d) => `${d.value} ${d.key}`).join(', ')}`} />
        <p className="text-[12px] text-muted"><span className={overdue ? 'text-high-text' : undefined}>{overdue} overdue</span> · {open.filter((t) => !t.assignedTo).length} unassigned</p>
      </section>
      <section className="card grid content-start gap-4" aria-labelledby="mt-status">
        <h2 id="mt-status" className="t-card">Where open work stands</h2>
        <StackedBar data={byStatus} height={14} table empty="No open tasks" ariaLabel={`Open tasks by status: ${byStatus.map((d) => `${d.value} ${d.label.toLowerCase()}`).join(', ')}`} />
      </section>
      <section className="card grid content-start gap-3" aria-labelledby="mt-ttc">
        <div className="flex items-baseline justify-between gap-3"><h2 id="mt-ttc" className="t-card">Median time to complete</h2><span className="t-label num">{done.length} completed</span></div>
        <div className="flex items-baseline gap-1.5">
          <span className="t-kpi-sm">{hrs === null ? '—' : hrs < 48 ? Math.round(hrs * 10) / 10 : Math.round((hrs / 24) * 10) / 10}</span>
          <span className="text-sm text-muted">{hrs === null ? 'no completed tasks yet' : hrs < 48 ? 'hours, request to done' : 'days, request to done'}</span>
        </div>
        <Sparkbars data={perDayDone} height={48} color="var(--color-surface-3)" highlight="var(--color-signal)" emphasise="last" table
          ariaLabel={`Tasks completed per day, last 14 days: ${perDayDone.map((d) => d.value).join(', ')}`} axis={[perDayDone[0]?.label ?? '', 'today']} />
      </section>
    </div>
  );
}
