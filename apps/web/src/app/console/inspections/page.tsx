'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ClipboardList, Clock, Eye, Glasses, LayoutList, Monitor, Pencil, Plus, Search } from 'lucide-react';
import { ASSET_TYPE_LABELS, INSPECTION_EDITABLE, INSPECTION_STATUS_LABELS } from '@hydris/domain';
import { useApi } from '@/lib/query';
import { useCan } from '@/lib/session';
import { until } from '@/lib/format';
import { Avatar, Button, Capsule, Chip, DataTable, EmptyState, PageHeader, Progress, QueryView, Skeleton, StateChip, SyntheticBadge, type Column } from '@/ui';
import { NewInspectionDialog } from '@/console/work/inspection-forms';
import { TemplateBuilder, TemplatePreviewDialog } from '@/console/work/TemplateBuilder';
import { isOverdue, type InspectionRow, type Template } from '@/console/work/shared';
import { BulletBar, Funnel, RadialGauge, StackedBar, type Datum } from '@/ui/charts';

type Filter = 'open' | 'review' | 'overdue' | 'approved' | 'all';
const FILTER_PATH: Record<Filter, string> = {
  open: '/inspections?status=open',
  review: '/inspections?status=review',
  overdue: '/inspections?overdue=true',
  approved: '/inspections?status=approved',
  all: '/inspections',
};
const EMPTY: Record<Filter, [string, string]> = {
  open: ['No open inspections', 'Scheduled, in-progress, paused and returned inspections appear here.'],
  review: ['Nothing awaiting review', 'Submitted inspections wait here for a supervisor to approve or return them.'],
  overdue: ['Nothing overdue', 'Every open inspection is within its due time.'],
  approved: ['No approved inspections yet', 'Approved inspections form the audit record of completed rounds.'],
  all: ['No inspections yet', 'Issue an inspection from a published template to get started.'],
};

export default function InspectionsPage() {
  const can = useCan();
  const [view, setViewState] = useState<'inspections' | 'templates'>('inspections');
  // Keep the view in the URL (?view=templates) so it can be linked and survives reloads.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('view') === 'templates') setViewState('templates');
  }, []);
  const setView = (v: 'inspections' | 'templates') => {
    setViewState(v);
    const u = new URL(window.location.href);
    if (v === 'templates') u.searchParams.set('view', 'templates');
    else u.searchParams.delete('view');
    window.history.replaceState(null, '', u);
  };
  const [newOpen, setNewOpen] = useState(false);
  const manage = can('inspection.manage');

  return (
    <>
      <PageHeader eyebrow="Work · Inspections" title="Inspections"
        subtitle="Rounds issued to operators, executed on field glasses or in the console, and reviewed by a second person."
        actions={<>
          <Capsule label="Inspections view" value={view} onChange={setView}
            options={[{ value: 'inspections', label: <><LayoutList size={15} aria-hidden />Inspections</> }, { value: 'templates', label: <><ClipboardList size={15} aria-hidden />Templates</> }]} />
          {manage && <Button variant="primary" icon={<Plus size={16} />} onClick={() => setNewOpen(true)}>New inspection</Button>}
        </>} />
      {view === 'inspections' ? <><InspectionInsights /><InspectionList /></> : <TemplateLibrary manage={manage} />}
      {manage && <NewInspectionDialog open={newOpen} onOpenChange={setNewOpen} />}
    </>
  );
}

/** Pipeline + punctuality computed from the inspections visible to this user (most recent 300). */
function InspectionInsights() {
  const q = useApi<{ inspections: InspectionRow[] }>('/inspections', { refetchInterval: 60_000 });
  if (q.isError) return null;
  if (!q.data) {
    return (
      <div className="mb-4 grid gap-4 lg:grid-cols-[1.5fr_1fr_1fr]" role="status" aria-label="Loading inspection insights">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[230px] rounded-[24px]" />)}
      </div>
    );
  }
  const all = q.data.inspections.filter((r) => r.status !== 'cancelled');
  if (!all.length) return null;
  const started = all.filter((r) => r.startedAt || ['in_progress', 'paused', 'submitted', 'approved', 'rejected'].includes(r.status));
  const submitted = all.filter((r) => r.submittedAt || r.status === 'submitted' || r.status === 'approved');
  const approved = all.filter((r) => r.status === 'approved');
  const closed = all.filter((r) => r.submittedAt);
  const onTime = closed.filter((r) => !r.dueAt || new Date(r.submittedAt!).getTime() <= new Date(r.dueAt).getTime()).length;
  const onTimeRate = closed.length ? Math.round((onTime / closed.length) * 100) : null;
  const openNow = all.filter((r) => INSPECTION_EDITABLE.includes(r.status));
  const overdue = openNow.filter((r) => isOverdue(r.dueAt, true)).length;
  const viaGlasses = closed.filter((r) => r.submittedVia === 'glasses').length;
  const status: Datum[] = [
    { key: 'in_progress', label: 'In progress', value: openNow.filter((r) => r.status === 'in_progress' || r.status === 'paused').length, color: 'var(--color-signal)' },
    { key: 'scheduled', label: 'Scheduled', value: openNow.filter((r) => r.status === 'scheduled').length, color: 'var(--color-signal)', hatch: true },
    { key: 'rejected', label: 'Returned', value: openNow.filter((r) => r.status === 'rejected').length, color: 'var(--color-high)' },
  ];
  return (
    <div className="stagger mb-4 grid gap-4 lg:grid-cols-[1.5fr_1fr_1fr]">
      <section className="card" aria-labelledby="insp-funnel">
        <div className="mb-4 flex items-baseline justify-between gap-3"><h2 id="insp-funnel" className="t-card">Inspection pipeline</h2><span className="t-label num">{all.length} issued</span></div>
        <Funnel table ariaLabel={`Inspection pipeline: ${all.length} issued, ${started.length} started, ${submitted.length} submitted, ${approved.length} approved`} stages={[
          { key: 'issued', label: 'Issued', value: all.length, color: 'var(--color-brand-deep)' },
          { key: 'started', label: 'Started', value: started.length, color: 'var(--color-brand)' },
          { key: 'submitted', label: 'Submitted', value: submitted.length, color: 'var(--color-signal)' },
          { key: 'approved', label: 'Approved', value: approved.length, color: 'var(--color-purple)' },
        ]} />
        <p className="mt-3 text-xs text-muted">Percentages are the share of the previous stage. Based on the {all.length} most recent inspections you can see.</p>
      </section>
      <section className="card grid place-items-center gap-2" aria-labelledby="insp-ontime">
        <h2 id="insp-ontime" className="t-card justify-self-start">On-time completion</h2>
        <RadialGauge value={onTimeRate} unit="%" size={150} label={closed.length ? `${onTime} of ${closed.length} on time` : 'nothing submitted yet'}
          tone={onTimeRate !== null && onTimeRate < 80 ? 'var(--color-high)' : 'var(--color-signal)'} marks={[{ value: 90, color: 'var(--color-text)', label: 'Target 90%' }]}
          ariaLabel={onTimeRate === null ? 'No submitted inspections yet' : `${onTimeRate}% of submitted inspections were on time (${onTime} of ${closed.length}); target 90%`} />
        <p className="text-center text-[12px] text-muted">{viaGlasses} of {closed.length} submitted hands-free on glasses</p>
      </section>
      <section className="card grid content-start gap-4" aria-labelledby="insp-open">
        <div className="flex items-baseline justify-between gap-3"><h2 id="insp-open" className="t-card">Open work</h2><span className="t-label num">{openNow.length} open</span></div>
        <StackedBar data={status} height={14} table empty="Nothing open" ariaLabel={`Open inspections: ${status.map((s) => `${s.value} ${s.label.toLowerCase()}`).join(', ')}`} />
        <BulletBar value={openNow.length ? Math.round(((openNow.length - overdue) / openNow.length) * 100) : null} target={100} label="Within due time" targetLabel="Goal"
          ariaLabel={`${openNow.length - overdue} of ${openNow.length} open inspections are within their due time; ${overdue} overdue`} />
      </section>
    </div>
  );
}

function InspectionList() {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('open');
  const [text, setText] = useState('');
  const q = useApi<{ inspections: InspectionRow[] }>(FILTER_PATH[filter], { refetchInterval: 60_000 });

  const rows = useMemo(() => {
    const t = text.trim().toLowerCase();
    const all = q.data?.inspections ?? [];
    return t ? all.filter((r) => [r.title, r.assetTag, r.assetName, r.assigneeName, r.siteName].some((v) => v?.toLowerCase().includes(t))) : all;
  }, [q.data, text]);

  const columns: Column<InspectionRow>[] = [
    {
      key: 'title', header: 'Inspection', cell: (r) => (
        <div className="min-w-[220px]">
          <div className="flex items-center gap-2">
            <span className="font-medium">{r.title}</span>
            {r.priority === 'high' && <Chip tone="high">High</Chip>}
            {r.synthetic && <SyntheticBadge />}
          </div>
          <div className="text-xs text-muted">{r.siteName}</div>
        </div>
      ),
    },
    { key: 'asset', header: 'Asset', cell: (r) => (r.assetTag ? <div className="min-w-[120px]"><div className="num text-sm">{r.assetTag}</div><div className="truncate text-xs text-muted">{r.assetName}</div></div> : <span className="text-muted">Site-wide</span>) },
    {
      key: 'assignee', header: 'Assignee', cell: (r) => (r.assigneeName
        ? <span className="flex items-center gap-2 whitespace-nowrap"><Avatar name={r.assigneeName} size={28} />{r.assigneeName}</span>
        : <span className="text-muted">Unassigned</span>),
    },
    {
      key: 'due', header: 'Due', cell: (r) => {
        const open = INSPECTION_EDITABLE.includes(r.status);
        if (!open) return <span className="text-sm text-muted">—</span>;
        const late = isOverdue(r.dueAt, open);
        return <span className={late ? 'inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-high-text' : 'whitespace-nowrap text-sm text-text-2'} title={r.dueAt ? new Date(r.dueAt).toLocaleString() : undefined}>
          {late && <Clock size={13} aria-hidden />}{until(r.dueAt)}
        </span>;
      },
    },
    { key: 'status', header: 'Status', cell: (r) => <StateChip state={r.status} label={INSPECTION_STATUS_LABELS[r.status]} /> },
    {
      key: 'progress', header: 'Progress', cell: (r) => (
        <div className="w-[120px]">
          <div className="mb-1 text-xs text-text-2 num">{r.answered}/{r.stepCount} steps</div>
          <Progress value={r.stepCount ? (r.answered / r.stepCount) * 100 : 0} tone={r.answered >= r.stepCount && r.stepCount ? 'ok' : 'lime'} label={`${r.answered} of ${r.stepCount} steps answered`} />
        </div>
      ),
    },
    {
      key: 'via', header: 'Submitted via', cell: (r) => (r.submittedVia === 'glasses'
        ? <Chip tone="cobalt"><Glasses size={12} aria-hidden />Glasses</Chip>
        : r.submittedVia === 'console' ? <Chip tone="outline"><Monitor size={12} aria-hidden />Console</Chip> : <span className="text-muted">—</span>),
    },
  ];

  return (
    <section className="card fade-in" aria-label="Inspection list">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Capsule label="Inspection status filter" value={filter} onChange={setFilter} options={[
          { value: 'open', label: 'Open' }, { value: 'review', label: 'Awaiting review' }, { value: 'overdue', label: 'Overdue' },
          { value: 'approved', label: 'Completed' }, { value: 'all', label: 'All' },
        ]} />
        <div className="relative ml-auto w-full sm:w-[280px]">
          <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
          <input className="input input-search" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Filter by title, asset, person" aria-label="Filter inspections" />
        </div>
      </div>
      <QueryView q={q} loading={<div className="grid gap-2" role="status" aria-label="Loading inspections">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-14" />)}</div>}>
        {() => (
          <>
            <DataTable rows={rows} rowKey={(r) => r.id} columns={columns} onRowClick={(r) => router.push(`/console/inspections/${r.id}`)}
              empty={text ? <EmptyState title="No matches" body={`No inspection in this view matches “${text}”.`} /> : <EmptyState title={EMPTY[filter][0]} body={EMPTY[filter][1]} />} />
            {rows.length > 0 && <p className="mt-3 text-xs text-muted num">{rows.length} inspection{rows.length === 1 ? '' : 's'}{q.isFetching ? ' · refreshing…' : ''}</p>}
          </>
        )}
      </QueryView>
    </section>
  );
}

function TemplateLibrary({ manage }: { manage: boolean }) {
  const q = useApi<{ templates: Template[] }>('/inspection-templates');
  const [editing, setEditing] = useState<Template | null>(null);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [preview, setPreview] = useState<Template | null>(null);
  const [issueFrom, setIssueFrom] = useState<string | null>(null);
  const [status, setStatus] = useState<'published' | 'draft' | 'archived' | 'all'>('published');

  const list = (q.data?.templates ?? []).filter((t) => status === 'all' || t.status === status);

  return (
    <section className="fade-in" aria-label="Inspection templates">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Capsule label="Template status filter" value={status} onChange={setStatus} options={[
          { value: 'published', label: 'Published' }, { value: 'draft', label: 'Drafts' }, { value: 'archived', label: 'Archived' }, { value: 'all', label: 'All' },
        ]} />
        {manage && <Button className="ml-auto" icon={<Plus size={16} />} onClick={() => { setEditing(null); setBuilderOpen(true); }}>New template</Button>}
      </div>
      <QueryView q={q} loading={<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[190px] rounded-[24px]" />)}</div>}>
        {() => list.length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {list.map((t) => (
              <article key={t.id} className="card flex flex-col gap-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="t-card">{t.name}</h2>
                    <div className="mt-1 text-xs text-muted num">Version {t.version}{t.assetType ? ` · ${ASSET_TYPE_LABELS[t.assetType]}` : ' · Any asset'}</div>
                  </div>
                  <StateChip state={t.status === 'published' ? 'approved' : t.status} label={t.status[0]!.toUpperCase() + t.status.slice(1)} />
                </div>
                {t.description && <p className="line-clamp-2 text-sm text-text-2">{t.description}</p>}
                <dl className="grid grid-cols-3 gap-2 rounded-2xl bg-bg-2 p-3 text-center">
                  <div><dt className="t-label">Steps</dt><dd className="num text-lg">{t.steps.length}</dd></div>
                  <div><dt className="t-label">Required</dt><dd className="num text-lg">{t.steps.filter((s) => s.required).length}</dd></div>
                  <div><dt className="t-label">Minutes</dt><dd className="num text-lg">{t.estimatedMinutes ?? '—'}</dd></div>
                </dl>
                <div className="mt-auto flex flex-wrap gap-2">
                  <Button size="sm" variant="ghost" icon={<Eye size={15} />} onClick={() => setPreview(t)}>Preview</Button>
                  {manage && <Button size="sm" icon={<Pencil size={15} />} onClick={() => { setEditing(t); setBuilderOpen(true); }}>Edit</Button>}
                  {manage && t.status === 'published' && <Button size="sm" variant="primary" className="ml-auto" onClick={() => setIssueFrom(t.id)}>Issue</Button>}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title={status === 'published' ? 'No published templates' : 'No templates in this view'}
            body="Templates define the steps, safety notices and expected ranges of a round."
            action={manage ? <Button variant="primary" icon={<Plus size={16} />} onClick={() => { setEditing(null); setBuilderOpen(true); }}>Build a template</Button> : undefined} />
        )}
      </QueryView>
      {manage && <TemplateBuilder open={builderOpen} onOpenChange={setBuilderOpen} template={editing} />}
      <TemplatePreviewDialog template={preview} onOpenChange={(v) => { if (!v) setPreview(null); }} />
      {manage && <NewInspectionDialog open={!!issueFrom} onOpenChange={(v) => { if (!v) setIssueFrom(null); }} presetTemplateId={issueFrom ?? undefined} />}
    </section>
  );
}
