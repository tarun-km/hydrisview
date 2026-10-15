'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { LayoutGrid, List, Search, Siren } from 'lucide-react';
import { MEASURAND_DEFS, type MeasurementMethod, type Measurand } from '@hydris/domain';
import { useApi } from '@/lib/query';
import { fmtValue } from '@/lib/format';
import { Capsule, Card, Chip, DataTable, EmptyState, OpenLink, PageHeader, QueryView, Select, Skeleton, SyntheticBadge, type Column } from '@/ui';
import type { SensorRow } from '@/console/alarms-telemetry/types';
import { MethodChip, ReadingStatus, SensorValue } from '@/console/alarms-telemetry/bits';

type View = 'cards' | 'table';
const METHODS: { value: MeasurementMethod; label: string }[] = [
  { value: 'continuous', label: 'Online instruments' }, { value: 'lab', label: 'Lab results' }, { value: 'manual', label: 'Manual readings' },
];

export default function TelemetryPage() {
  // One cached list; filtering is client-side so typing never fires requests. Realtime events refresh '/sensors'.
  const q = useApi<{ sensors: SensorRow[] }>('/sensors', { refetchInterval: 30_000 });
  const [measurand, setMeasurand] = useState<Measurand | ''>('');
  const [method, setMethod] = useState<MeasurementMethod | ''>('');
  const [search, setSearch] = useState('');
  const [view, setView] = useState<View>('cards');

  const all = useMemo(() => q.data?.sensors ?? [], [q.data]);
  const measurands = useMemo(() => [...new Set(all.map((s) => s.measurand))].sort((a, b) => MEASURAND_DEFS[a].label.localeCompare(MEASURAND_DEFS[b].label)), [all]);
  const rows = useMemo(() => {
    const t = search.trim().toLowerCase();
    return all.filter((s) => (!measurand || s.measurand === measurand) && (!method || s.method === method)
      && (!t || [s.tag, s.name, s.assetTag ?? '', s.assetName ?? '', MEASURAND_DEFS[s.measurand].label].some((x) => x.toLowerCase().includes(t))));
  }, [all, measurand, method, search]);

  const live = all.filter((s) => s.method === 'continuous' && s.freshness === 'live').length;
  const stale = all.filter((s) => s.freshness === 'stale').length;
  const none = all.filter((s) => s.freshness === 'no_data').length;

  return (
    <>
      <PageHeader eyebrow="Operate · Sensor monitoring" title="Sensor monitoring"
        subtitle={q.data ? <><span className="num">{all.length}</span> sensors · <span className="num">{live}</span> online live · <span className="num">{stale}</span> stale · <span className="num">{none}</span> without data</> : 'Latest value, freshness and provenance of every instrument and lab parameter.'}
        actions={<Capsule label="View" value={view} onChange={setView} options={[
          { value: 'cards', label: <><LayoutGrid size={15} strokeWidth={1.8} aria-hidden />Cards</> },
          { value: 'table', label: <><List size={15} strokeWidth={1.8} aria-hidden />Table</> },
        ]} />} />

      <div className="mb-5 grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div className="relative">
          <Search size={16} strokeWidth={1.8} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
          <input type="search" className="input input-search" placeholder="Search tag, name or asset" aria-label="Search sensors" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select aria-label="Measurand" value={measurand} onChange={(e) => setMeasurand(e.target.value as Measurand | '')} placeholder="All measurands"
          options={measurands.map((m) => ({ value: m, label: MEASURAND_DEFS[m].label }))} />
        <Select aria-label="Measurement method" value={method} onChange={(e) => setMethod(e.target.value as MeasurementMethod | '')} placeholder="All methods" options={METHODS} />
      </div>

      <QueryView q={q} loading={<GridSkeleton />}>
        {() => !all.length
          ? <EmptyState title="No sensors configured" body="Sensors are added to assets in the asset registry. Once a gateway or operator records values they appear here." />
          : !rows.length
            ? <EmptyState icon={<Search size={20} aria-hidden />} title="No sensors match" body="Clear the search or choose another measurand or method." />
            : view === 'cards' ? <SensorGrid rows={rows} /> : <SensorTable rows={rows} />}
      </QueryView>
      <p className="sr-only" role="status" aria-live="polite">{q.data ? `${rows.length} sensors shown` : ''}</p>
    </>
  );
}

function SensorGrid({ rows }: { rows: SensorRow[] }) {
  const groups = useMemo(() => {
    const m = new Map<string, { tag: string | null; name: string | null; assetId: string | null; items: SensorRow[] }>();
    for (const s of rows) {
      const k = s.assetId ?? '—';
      if (!m.has(k)) m.set(k, { tag: s.assetTag, name: s.assetName, assetId: s.assetId, items: [] });
      m.get(k)!.items.push(s);
    }
    return [...m.values()].sort((a, b) => (a.tag ?? '~').localeCompare(b.tag ?? '~'));
  }, [rows]);
  return (
    <div className="grid gap-8 fade-in">
      {groups.map((g) => (
        <section key={g.assetId ?? 'none'} aria-labelledby={`g-${g.assetId ?? 'none'}`}>
          <div className="mb-3 flex items-center gap-3">
            <h2 id={`g-${g.assetId ?? 'none'}`} className="t-card min-w-0 truncate">
              {g.assetId ? <Link href={`/console/assets/${g.assetId}`} className="link-quiet text-text">{g.tag}</Link> : 'Not linked to an asset'}
              {g.name && <span className="ml-2 font-normal text-muted">{g.name}</span>}
            </h2>
            <span className="t-label num ml-auto flex-none">{g.items.length} sensor{g.items.length === 1 ? '' : 's'}</span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {g.items.map((s) => <SensorCard key={s.id} s={s} />)}
          </div>
        </section>
      ))}
    </div>
  );
}

function SensorCard({ s }: { s: SensorRow }) {
  const def = MEASURAND_DEFS[s.measurand];
  return (
    <article className="card card-tight flex min-w-0 flex-col gap-4" aria-label={`${s.tag} ${s.name}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-[12px] text-muted">{s.tag}</div>
          <div className="mt-0.5 truncate text-[15px] font-medium" title={s.name}>{s.name}</div>
          <div className="truncate text-xs text-muted">{def.label}</div>
        </div>
        <OpenLink href={`/console/telemetry/${s.id}`} label={`Open ${s.tag} trend`} size="sm" tone="default" />
      </div>
      <SensorValue value={s.lastValue} unit={s.unit} decimals={def.decimals} freshness={s.freshness} />
      <div className="mt-auto flex flex-wrap items-center gap-2">
        <ReadingStatus method={s.method} freshness={s.freshness} ts={s.lastTs} />
        <span className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
          {s.lastSource === 'simulator' && <SyntheticBadge />}
          {s.openAlarms > 0 && <Chip tone="high" title="Open alarms on this sensor"><Siren size={13} strokeWidth={1.8} aria-hidden /><span className="num">{s.openAlarms}</span><span className="sr-only">open alarms</span></Chip>}
          <MethodChip method={s.method} />
        </span>
      </div>
      {!s.enabled && <p className="text-xs text-muted">Disabled. New readings are rejected.</p>}
    </article>
  );
}

function SensorTable({ rows }: { rows: SensorRow[] }) {
  const router = useRouter();
  const cols: Column<SensorRow>[] = [
    { key: 'tag', header: 'Tag', cell: (s) => <span className="font-mono text-[13px]">{s.tag}</span> },
    { key: 'name', header: 'Sensor', className: 'min-w-[180px]', cell: (s) => <><div>{s.name}</div><div className="text-xs text-muted">{MEASURAND_DEFS[s.measurand].label}</div></> },
    { key: 'asset', header: 'Asset', cell: (s) => s.assetTag ?? <span className="muted">—</span> },
    {
      key: 'val', header: <span className="block text-right">Value</span>, className: 'text-right',
      cell: (s) => {
        const missing = s.lastValue === null || s.freshness === 'no_data';
        return <span className={missing || s.freshness === 'stale' ? 'num text-muted' : 'num'}>{missing ? 'No data' : `${fmtValue(s.lastValue, undefined, MEASURAND_DEFS[s.measurand].decimals)} ${s.unit}`}</span>;
      },
    },
    { key: 'fresh', header: 'Freshness', cell: (s) => <span className="whitespace-nowrap"><ReadingStatus method={s.method} freshness={s.freshness} ts={s.lastTs} /></span> },
    { key: 'method', header: 'Method', cell: (s) => <span className="inline-flex items-center gap-1.5"><MethodChip method={s.method} />{s.lastSource === 'simulator' && <SyntheticBadge />}</span> },
    { key: 'alarms', header: 'Open alarms', className: 'text-right', cell: (s) => s.openAlarms ? <Chip tone="high"><span className="num">{s.openAlarms}</span></Chip> : <span className="num muted">0</span> },
  ];
  return (
    <Card className="fade-in p-3! sm:p-4!">
      <DataTable dense rows={rows} columns={cols} rowKey={(s) => s.id} onRowClick={(s) => router.push(`/console/telemetry/${s.id}`)} />
    </Card>
  );
}

function GridSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" role="status" aria-label="Loading sensors">
      {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-[184px] rounded-[24px]" />)}
    </div>
  );
}
