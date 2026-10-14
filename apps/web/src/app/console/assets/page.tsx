'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Boxes, Plus, Search, X } from 'lucide-react';
import { ASSET_STATUS_LABELS, ASSET_TYPE_LABELS } from '@hydris/domain';
import { useApi } from '@/lib/query';
import { useCan } from '@/lib/session';
import { label } from '@/lib/format';
import { Button, Card, DataTable, EmptyState, LoadingBlock, PageHeader, QueryView, Select, SeverityChip, StateChip } from '@/ui';
import { AssetFormDialog } from '@/console/plant/forms';
import type { AssetSummary, SiteListItem } from '@/console/plant/types';
import { assetStatusOptions, assetTypeOptions, healthColor } from '@/console/plant/util';

export default function AssetsPage() {
  return <Suspense fallback={<LoadingBlock rows={6} />}><AssetRegistry /></Suspense>;
}

function AssetRegistry() {
  const can = useCan();
  const router = useRouter();
  const params = useSearchParams();
  const [text, setText] = useState(params.get('q') ?? '');
  const [q, setQ] = useState(text);
  const [siteId, setSiteId] = useState(params.get('siteId') ?? '');
  const [type, setType] = useState(params.get('type') ?? '');
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [creating, setCreating] = useState(false);

  // Debounce free-text search so typing does not fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);

  // Keep filters shareable via the URL.
  useEffect(() => {
    const sp = new URLSearchParams();
    if (q) sp.set('q', q);
    if (siteId) sp.set('siteId', siteId);
    if (type) sp.set('type', type);
    if (status) sp.set('status', status);
    const s = sp.toString();
    router.replace(`/console/assets${s ? `?${s}` : ''}`, { scroll: false });
  }, [q, siteId, type, status, router]);

  const sites = useApi<{ sites: SiteListItem[] }>('/sites');
  const sp = new URLSearchParams();
  if (q) sp.set('q', q);
  if (siteId) sp.set('siteId', siteId);
  if (type) sp.set('type', type);
  if (status) sp.set('status', status);
  const path = `/assets${sp.toString() ? `?${sp}` : ''}`;
  const assets = useApi<{ assets: AssetSummary[] }>(path, { placeholderData: (prev) => prev });
  const filtered = !!(q || siteId || type || status);
  const clear = () => { setText(''); setQ(''); setSiteId(''); setType(''); setStatus(''); };
  const multiSite = (sites.data?.sites.length ?? 0) > 1;

  return (
    <>
      <PageHeader eyebrow="Plant · Assets & equipment" title="Asset registry"
        subtitle={assets.data ? `${assets.data.assets.length} asset${assets.data.assets.length === 1 ? '' : 's'}${filtered ? ' match the filters' : ' registered'} · ${assets.data.assets.filter((a) => a.openAlarms).length} with open alarms` : 'Equipment across your sites with live health, alarms and open work.'}
        actions={can('asset.manage') ? <Button variant="primary" icon={<Plus size={16} />} onClick={() => setCreating(true)}>Register asset</Button> : undefined} />

      <Card tight className="mb-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto] md:items-end">
          <div className="relative">
            <label htmlFor="asset-search" className="sr-only">Search assets by tag, name or manufacturer</label>
            <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
            <input id="asset-search" type="search" className="input input-search" placeholder="Search tag, name or manufacturer" value={text} onChange={(e) => setText(e.target.value)} maxLength={80} />
          </div>
          <Select aria-label="Filter by site" value={siteId} onChange={(e) => setSiteId(e.target.value)} placeholder="All sites" options={(sites.data?.sites ?? []).map((s) => ({ value: s.id, label: s.name }))} />
          <Select aria-label="Filter by type" value={type} onChange={(e) => setType(e.target.value)} placeholder="All types" options={assetTypeOptions} />
          <Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All statuses" options={assetStatusOptions} />
          {filtered ? <Button variant="ghost" icon={<X size={15} />} onClick={clear}>Clear</Button> : <span className="hidden md:block" />}
        </div>
      </Card>

      <Card tight>
        <QueryView q={assets} loading={<LoadingBlock rows={8} />}>
          {(d) => (
            <div aria-busy={assets.isFetching || undefined}>
              <DataTable rows={d.assets} rowKey={(a) => a.id} dense onRowClick={(a) => router.push(`/console/assets/${a.id}`)}
                empty={<EmptyState icon={<Boxes size={20} aria-hidden />} title={filtered ? 'No assets match these filters' : 'No assets registered'}
                  body={filtered ? 'Try a different search or clear the filters.' : can('asset.manage') ? 'Register equipment so sensors, inspections and maintenance can be attached to it.' : 'No equipment has been registered on your sites yet.'}
                  action={filtered ? <Button size="sm" onClick={clear}>Clear filters</Button> : can('asset.manage') ? <Button size="sm" variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>Register asset</Button> : undefined} />}
                columns={[
                  { key: 'tag', header: 'Tag', cell: (a) => (
                    <Link href={`/console/assets/${a.id}`} onClick={(e) => e.stopPropagation()} className="flex items-center gap-2 font-medium hover:underline">
                      <span className="dot" style={{ background: healthColor(a) }} aria-hidden />{a.tag}
                    </Link>
                  ) },
                  { key: 'name', header: 'Name', cell: (a) => <span className="block max-w-[260px] truncate">{a.name}</span> },
                  { key: 'type', header: 'Type', cell: (a) => <span className="text-text-2">{ASSET_TYPE_LABELS[a.type]}</span> },
                  { key: 'area', header: 'Area', cell: (a) => <span className="text-text-2">{a.areaName ?? '—'}{multiSite && <span className="block text-xs text-muted">{a.siteName}</span>}</span> },
                  { key: 'status', header: 'Status', cell: (a) => <StateChip state={a.status} label={ASSET_STATUS_LABELS[a.status]} /> },
                  { key: 'crit', header: 'Criticality', cell: (a) => <span className={a.criticality === 'high' ? 'text-text' : 'text-text-2'}>{label(a.criticality)}</span> },
                  { key: 'sensors', header: 'Sensors', className: 'text-right num', cell: (a) => a.sensorCount },
                  { key: 'alarms', header: 'Open alarms', cell: (a) => a.openAlarms ? <span className="flex items-center gap-2"><span className="num">{a.openAlarms}</span>{a.worstSeverity && <SeverityChip severity={a.worstSeverity} />}</span> : <span className="text-muted">0</span> },
                  { key: 'tasks', header: 'Open tasks', className: 'text-right num', cell: (a) => a.openTasks || <span className="text-muted">0</span> },
                ]} />
            </div>
          )}
        </QueryView>
      </Card>

      <AssetFormDialog open={creating} onOpenChange={setCreating} prefill={{ siteId: siteId || undefined }} onSaved={(a) => router.push(`/console/assets/${a.id}`)} />
    </>
  );
}
