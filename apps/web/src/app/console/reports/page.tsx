'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState, type ReactNode } from 'react';
import { Download, Info } from 'lucide-react';
import { download, errorMessage } from '@/lib/api';
import { useApi } from '@/lib/query';
import { useCan } from '@/lib/session';
import { fmtDateTime } from '@/lib/format';
import { Button, Capsule, Card, Chip, DataTable, EmptyState, KpiCard, PageHeader, QueryView, Select, SeverityChip, Skeleton, StateChip, SyntheticBadge, type Column } from '@/ui';
import { useToast } from '@/ui/overlay';
import { HBarList, NoAccess, prettyKey, useSites } from '@/console/admin/parts';

const KINDS = ['alarms', 'inspections', 'maintenance', 'devices', 'operators'] as const;
type Kind = (typeof KINDS)[number];
const KIND_LABELS: Record<Kind, string> = { alarms: 'Alarms', inspections: 'Inspections', maintenance: 'Maintenance', devices: 'Devices', operators: 'Operators' };
type Period = '7d' | '30d' | '90d' | 'custom';
const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
const SITE_FILTERED: Kind[] = ['alarms', 'inspections', 'maintenance'];

type Row = Record<string, unknown>;
interface Report { kind: Kind; from: string; to: string; rows: Row[]; summary: Record<string, unknown> }

export default function ReportsPage() {
  return <Suspense fallback={<Skeleton className="h-[480px] rounded-[24px]" />}><Reports /></Suspense>;
}

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function Reports() {
  const can = useCan();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const initial = params.get('kind');
  const [kind, setKindState] = useState<Kind>(KINDS.includes(initial as Kind) ? (initial as Kind) : 'alarms');
  const [period, setPeriod] = useState<Period>('30d');
  const today = isoDay(new Date());
  const [customFrom, setCustomFrom] = useState(isoDay(new Date(Date.now() - 30 * 86400_000)));
  const [customTo, setCustomTo] = useState(today);
  const [siteId, setSiteId] = useState('');
  const [severity, setSeverity] = useState('');
  const [exporting, setExporting] = useState(false);
  const sites = useSites();

  const setKind = (k: Kind) => {
    setKindState(k);
    router.replace(`${pathname}?kind=${k}`, { scroll: false });
  };

  // Stable range per day so the query key does not change on every render.
  const range = useMemo(() => {
    if (period === 'custom') {
      const from = new Date(`${customFrom}T00:00:00`);
      const to = new Date(`${customTo}T23:59:59.999`);
      return Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to ? null : { from: from.toISOString(), to: to.toISOString() };
    }
    const days = period === '7d' ? 7 : period === '90d' ? 90 : 30;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (days - 1));
    return { from: start.toISOString(), to: null as string | null };
  }, [period, customFrom, customTo]);

  const qs = useMemo(() => {
    if (!range) return null;
    const p = new URLSearchParams({ from: range.from });
    if (range.to) p.set('to', range.to);
    if (siteId && SITE_FILTERED.includes(kind)) p.set('siteId', siteId);
    if (severity && kind === 'alarms') p.set('severity', severity);
    return p.toString();
  }, [range, siteId, severity, kind]);

  const allowed = can('report.read');
  const q = useApi<Report>(allowed && qs ? `/reports/${kind}?${qs}` : null);

  const exportCsv = async () => {
    if (!qs) return;
    setExporting(true);
    try {
      await download(`/reports/${kind}?format=csv&${qs}`, `hydris-${kind}-${range!.from.slice(0, 10)}.csv`);
      toast({ title: 'Export downloaded', body: 'The export has been recorded in the audit log.', tone: 'ok' });
    } catch (e) {
      toast({ title: 'Export failed', body: errorMessage(e), tone: 'critical' });
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <PageHeader eyebrow="Insight" title="Reports & analytics"
        subtitle="Exact records for a period, with the totals derived from them. Exports contain the same rows."
        actions={can('report.export') ? <Button variant="primary" icon={<Download size={16} aria-hidden />} busy={exporting} disabled={!qs || !q.data} onClick={exportCsv}>Export CSV</Button> : undefined} />
      {!allowed ? <NoAccess what="reports" /> : (
        <div className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Capsule label="Report" value={kind} onChange={setKind} lime options={KINDS.map((k) => ({ value: k, label: KIND_LABELS[k] }))} />
            <Capsule label="Period" value={period} onChange={setPeriod} options={[
              { value: '7d', label: '7 days' }, { value: '30d', label: '30 days' }, { value: '90d', label: '90 days' }, { value: 'custom', label: 'Custom' },
            ]} />
          </div>
          <div className="flex flex-wrap items-end gap-3">
            {period === 'custom' && (
              <>
                <label className="field w-full sm:w-44"><span className="field-label">From</span><input type="date" className="input" value={customFrom} max={customTo} onChange={(e) => setCustomFrom(e.target.value)} /></label>
                <label className="field w-full sm:w-44"><span className="field-label">To</span><input type="date" className="input" value={customTo} min={customFrom} max={today} onChange={(e) => setCustomTo(e.target.value)} /></label>
              </>
            )}
            {SITE_FILTERED.includes(kind) && (sites.data?.sites.length ?? 0) > 0 && (
              <div className="w-full sm:w-60"><Select label="Site" value={siteId} onChange={(e) => setSiteId(e.target.value)} placeholder="All sites" options={sites.data!.sites.map((x) => ({ value: x.id, label: x.name }))} /></div>
            )}
            {kind === 'alarms' && (
              <div className="w-full sm:w-48"><Select label="Severity" value={severity} onChange={(e) => setSeverity(e.target.value)} placeholder="All severities" options={SEVERITIES.map((x) => ({ value: x, label: prettyKey(x) }))} /></div>
            )}
          </div>
          {!range ? (
            <p role="alert" className="field-error">Choose a start date before the end date.</p>
          ) : (
            <QueryView q={q} loading={<ReportSkeleton />}>
              {(r) => <ReportBody r={r} />}
            </QueryView>
          )}
        </div>
      )}
    </>
  );
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const counts = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, number>) : {});
const SEV_COLOR = (k: string) => (['critical', 'high', 'medium', 'low'].includes(k) ? `var(--color-${k})` : 'var(--color-text-2)');
const STATUS_COLOR = (k: string) => (['approved', 'completed', 'resolved', 'closed', 'active'].includes(k) ? 'var(--color-ok)'
  : ['rejected', 'revoked', 'cancelled'].includes(k) ? 'var(--color-high)'
  : ['suspended', 'on_hold', 'paused'].includes(k) ? 'var(--color-medium)'
  : ['in_progress', 'assigned', 'submitted'].includes(k) ? 'var(--color-cobalt)' : 'var(--color-text-2)');

function ReportBody({ r }: { r: Report }) {
  const s = r.summary;
  const period = <span className="num">{fmtDateTime(r.from, { year: 'numeric' })} → {fmtDateTime(r.to, { year: 'numeric' })}</span>;
  let kpis: ReactNode = null;
  let charts: ReactNode = null;

  if (r.kind === 'alarms') {
    const sev = counts(s.bySeverity);
    const ack = num(s.medianMinutesToAcknowledge);
    kpis = <>
      <KpiCard label="Alarms raised" value={num(s.total) ?? 0} sub={period} />
      <KpiCard label="Critical" value={sev.critical ?? 0} accent={sev.critical ? 'critical' : undefined} sub={`${sev.high ?? 0} high · ${sev.medium ?? 0} medium · ${sev.low ?? 0} low`} />
      <KpiCard label="Median time to acknowledge" value={ack === null ? '—' : ack < 120 ? Math.round(ack) : Math.round((ack / 60) * 10) / 10} unit={ack === null ? undefined : ack < 120 ? 'min' : 'h'}
        sub={ack === null ? 'No alarm in this period has been acknowledged yet' : 'From trigger to first acknowledgement'} />
      <KpiCard tone="dark" label="Still unresolved" value={r.rows.filter((x) => !x.resolvedAt).length} sub="Of the alarms raised in this period" />
    </>;
    charts = <>
      <Card title="By severity"><HBarList label="Alarms by severity" data={sev} colorFor={SEV_COLOR} /></Card>
      <Card title="By asset"><HBarList label="Alarms by asset" data={counts(s.byAsset)} colorFor={() => 'var(--color-orange)'} /></Card>
    </>;
  } else if (r.kind === 'inspections') {
    const comp = num(s.completionRate), onTime = num(s.onTimeRate);
    kpis = <>
      <KpiCard label="Inspections created" value={num(s.total) ?? 0} sub={period} />
      <KpiCard label="Completion rate" value={comp ?? '—'} unit={comp === null ? undefined : '%'} sub={comp === null ? 'No inspections were created in this period' : 'Submitted or approved'} />
      <KpiCard label="On time" value={onTime ?? '—'} unit={onTime === null ? undefined : '%'} sub={onTime === null ? 'Nothing has been completed yet, so there is no on-time rate' : 'Completed before the due time'} />
      <KpiCard tone="lime" label="Completed on glasses" value={num(s.viaGlasses) ?? 0} sub="Submitted hands-free from the field" />
    </>;
    charts = <>
      <Card title="By status"><HBarList label="Inspections by status" data={counts(s.byStatus)} colorFor={STATUS_COLOR} /></Card>
      <Card title="By assignee"><HBarList label="Inspections by assignee" data={counts(s.byAssignee)} colorFor={() => 'var(--color-cobalt)'} /></Card>
    </>;
  } else if (r.kind === 'maintenance') {
    const hrs = num(s.medianHoursToComplete);
    const st = counts(s.byStatus);
    kpis = <>
      <KpiCard label="Tasks created" value={num(s.total) ?? 0} sub={period} />
      <KpiCard label="Completed" value={st.completed ?? 0} sub={`${(st.open ?? 0) + (st.assigned ?? 0) + (st.in_progress ?? 0) + (st.on_hold ?? 0)} still open`} />
      <KpiCard label="Median time to complete" value={hrs ?? '—'} unit={hrs === null ? undefined : 'h'} sub={hrs === null ? 'No task created in this period has been completed' : 'From creation to completion'} />
      <KpiCard tone="dark" label="Task kinds" value={Object.keys(counts(s.byKind)).length} sub="Distinct kinds in this period" />
    </>;
    charts = <>
      <Card title="By status"><HBarList label="Tasks by status" data={st} colorFor={STATUS_COLOR} /></Card>
      <Card title="By kind"><HBarList label="Tasks by kind" data={counts(s.byKind)} colorFor={() => 'var(--color-cobalt)'} /></Card>
    </>;
  } else if (r.kind === 'devices') {
    const st = counts(s.byStatus);
    const total = num(s.total) ?? 0;
    kpis = <>
      <KpiCard label="Glasses registered" value={total} sub="All time, including revoked" />
      <KpiCard label="Used in period" value={num(s.usedInPeriod) ?? 0} sub={<>Last seen since {fmtDateTime(r.from)}</>} />
      <KpiCard label="Active" value={st.active ?? 0} sub={`${st.suspended ?? 0} suspended · ${st.revoked ?? 0} revoked`} />
      <KpiCard tone="dark" label="Simulators" value={r.rows.filter((x) => x.kind === 'simulator').length} sub={`${r.rows.filter((x) => x.kind === 'hardware').length} hardware`} />
    </>;
    charts = <>
      <Card title="By status"><HBarList label="Glasses by status" data={st} colorFor={STATUS_COLOR} /></Card>
      <Card title="By site"><HBarList label="Glasses by site" data={tally(r.rows, 'site')} colorFor={() => 'var(--color-cobalt)'} /></Card>
    </>;
  } else {
    const sum = (k: string) => r.rows.reduce((a, x) => a + (num(x[k]) ?? 0), 0);
    kpis = <>
      <KpiCard label="Members" value={num(s.total) ?? 0} sub={`${r.rows.filter((x) => x.status === 'active').length} active`} />
      <KpiCard label="Inspections submitted" value={sum('inspectionsDone')} sub={period} />
      <KpiCard label="Tasks completed" value={sum('tasksDone')} sub={period} />
      <KpiCard tone="dark" label="Alarms acknowledged" value={sum('alarmsAcknowledged')} sub={period} />
    </>;
    charts = <>
      <Card title="Inspections submitted by person"><HBarList label="Inspections submitted per person" data={r.rows.map((x) => ({ key: String(x.name), value: num(x.inspectionsDone) ?? 0 })).filter((x) => x.value > 0)} colorFor={() => 'var(--color-lime)'} empty="No inspections submitted in this period." /></Card>
      <Card title="Alarms acknowledged by person"><HBarList label="Alarms acknowledged per person" data={r.rows.map((x) => ({ key: String(x.name), value: num(x.alarmsAcknowledged) ?? 0 })).filter((x) => x.value > 0)} colorFor={() => 'var(--color-orange)'} empty="No alarms acknowledged in this period." /></Card>
    </>;
  }

  return (
    <div className="grid gap-4 fade-in">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{kpis}</div>
      <div className="grid gap-4 lg:grid-cols-2">{charts}</div>
      <RecordsTable key={`${r.kind}-${r.from}-${r.to}`} r={r} />
    </div>
  );
}

function tally(rows: Row[], key: string) {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = String(r[key] ?? '—');
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

const PAGE = 200;
const DATE_KEY = /At$/;

function RecordsTable({ r }: { r: Report }) {
  const [limit, setLimit] = useState(PAGE);
  const keys = r.rows.length ? Object.keys(r.rows[0]!) : [];
  const columns: Column<{ i: number; row: Row }>[] = keys.map((k) => ({
    key: k,
    header: prettyKey(k.replace(/([A-Z])/g, '_$1').toLowerCase()),
    className: typeof r.rows[0]![k] === 'number' ? 'text-right' : undefined,
    cell: ({ row }) => renderCell(k, row[k]),
  }));
  const rows = r.rows.slice(0, limit).map((row, i) => ({ i, row }));
  return (
    <Card title="Records" action={<span className="t-label num">{r.rows.length.toLocaleString()} rows{r.rows.length >= 5000 ? ' (capped at 5,000)' : ''}</span>}>
      {r.kind === 'devices' && <p className="mb-3 flex items-center gap-2 text-xs text-muted"><Info size={14} aria-hidden />The device list is not limited by period; only “used in period” is.</p>}
      <DataTable dense rows={rows} columns={columns} rowKey={(x) => String(x.i)} empty={<EmptyState title="No records in this period" body="Widen the period or clear filters." />} />
      {r.rows.length > limit && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
          <span className="num">Showing {limit.toLocaleString()} of {r.rows.length.toLocaleString()}. The CSV export contains every row.</span>
          <Button size="sm" onClick={() => setLimit((l) => l + PAGE)}>Show {Math.min(PAGE, r.rows.length - limit)} more</Button>
        </div>
      )}
    </Card>
  );
}

function renderCell(key: string, v: unknown): ReactNode {
  if (v === null || v === undefined || v === '') return <span className="text-muted">—</span>;
  if (key === 'synthetic') return v ? <SyntheticBadge /> : <span className="text-muted">No</span>;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (key === 'severity' && typeof v === 'string' && (SEVERITIES as readonly string[]).includes(v)) return <SeverityChip severity={v as (typeof SEVERITIES)[number]} />;
  if ((key === 'status' || key === 'state' || key === 'priority') && typeof v === 'string') return <StateChip state={v} />;
  if (key === 'role' && typeof v === 'string') return <Chip>{prettyKey(v)}</Chip>;
  if (typeof v === 'number') return <span className="num">{v.toLocaleString()}</span>;
  if (typeof v === 'string' && DATE_KEY.test(key) && !Number.isNaN(Date.parse(v))) return <span className="num whitespace-nowrap" title={new Date(v).toISOString()}>{fmtDateTime(v)}</span>;
  return <span className="block max-w-[340px] truncate" title={String(v)}>{String(v)}</span>;
}

function ReportSkeleton() {
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[148px] rounded-[24px]" />)}</div>
      <div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-[220px] rounded-[24px]" /><Skeleton className="h-[220px] rounded-[24px]" /></div>
    </div>
  );
}
