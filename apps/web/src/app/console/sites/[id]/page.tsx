'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Ban, Map as MapIcon, Pencil, Plus, Radio } from 'lucide-react';
import { patch, post } from '@/lib/api';
import { invalidatePaths, useApi } from '@/lib/query';
import { useCan } from '@/lib/session';
import { ago } from '@/lib/format';
import { Button, ButtonLink, Card, DataTable, EmptyState, IconButton, KpiCard, PageHeader, QueryView, Skeleton, StateChip } from '@/ui';
import { ConfirmDialog } from '@/ui/overlay';
import { AssetFormDialog, FacilityDialog, GatewayDialog, PLANT_PATHS, ProcessAreaDialog, SiteFormDialog } from '@/console/plant/forms';
import { HierarchyNavigator } from '@/console/plant/HierarchyNavigator';
import type { Facility, Gateway, ProcessArea, SiteDetail } from '@/console/plant/types';

type Confirm =
  | { kind: 'site' }
  | { kind: 'facility'; f: Facility }
  | { kind: 'area'; a: ProcessArea }
  | { kind: 'gateway'; g: Gateway };

export default function SiteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const can = useCan();
  const qc = useQueryClient();
  const q = useApi<SiteDetail>(`/sites/${id}`);
  const canSite = can('site.manage');
  const canAsset = can('asset.manage');
  const canGateway = can('gateway.manage');

  const [editSite, setEditSite] = useState(false);
  const [facDlg, setFacDlg] = useState<{ open: boolean; f?: Facility }>({ open: false });
  const [areaDlg, setAreaDlg] = useState<{ open: boolean; facilityId?: string; a?: ProcessArea }>({ open: false });
  const [assetDlg, setAssetDlg] = useState<{ open: boolean; facilityId?: string; processAreaId?: string | null }>({ open: false });
  const [gwDlg, setGwDlg] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  const d = q.data;
  const confirmCfg = (() => {
    if (!confirm || !d) return null;
    switch (confirm.kind) {
      case 'site': {
        const archived = !!d.site.archivedAt;
        return {
          title: archived ? `Restore ${d.site.name}?` : `Archive ${d.site.name}?`,
          body: archived ? 'The site will appear again in navigation, the plant map and reports.' : 'The site is hidden from navigation and the plant map. All history is kept and it can be restored.',
          label: archived ? 'Restore site' : 'Archive site', destructive: !archived,
          run: () => post(`/sites/${d.site.id}/archive`, { archived: !archived }),
        };
      }
      case 'facility':
        return {
          title: `Archive ${confirm.f.name}?`, body: 'The facility is hidden from the navigator and new work. Its process areas, assets and history are kept.',
          label: 'Archive facility', destructive: true, run: () => patch(`/facilities/${confirm.f.id}`, { archived: true }),
        };
      case 'area':
        return {
          title: `Archive ${confirm.a.name}?`, body: 'The process area is hidden from the navigator and the plant map. Assets keep their history.',
          label: 'Archive process area', destructive: true, run: () => patch(`/process-areas/${confirm.a.id}`, { archived: true }),
        };
      case 'gateway':
        return {
          title: `Revoke gateway ${confirm.g.name}?`,
          body: <>Its API key (<code className="font-mono">{confirm.g.keyPrefix}…</code>) stops working immediately and telemetry from it will be rejected. This cannot be undone; create a new gateway to resume ingestion.</>,
          label: 'Revoke gateway', destructive: true, run: () => post(`/gateways/${confirm.g.id}/revoke`, {}),
        };
    }
  })();

  return (
    <>
    <QueryView q={q} loading={<div className="grid gap-4"><Skeleton className="h-24" /><Skeleton className="h-[480px] rounded-[32px]" /></div>}>
      {(d) => {
        const openAlarms = d.assets.reduce((n, a) => n + a.openAlarms, 0);
        const critical = d.assets.filter((a) => a.worstSeverity === 'critical' && a.openAlarms > 0).length;
        return (
          <div className="grid gap-6 fade-in">
            <PageHeader
              eyebrow={<>Site · {d.site.code}{d.site.archivedAt ? ' · Archived' : ''}</>}
              title={d.site.name}
              subtitle={[d.site.address, d.site.city, d.site.country].filter(Boolean).join(', ') || 'No address recorded'}
              actions={<>
                <ButtonLink href={`/console/map?siteId=${d.site.id}`} icon={<MapIcon size={16} />}>Plant map</ButtonLink>
                {canSite && <Button icon={<Pencil size={15} />} onClick={() => setEditSite(true)}>Edit details</Button>}
                {canSite && (
                  <IconButton label={d.site.archivedAt ? 'Restore site' : 'Archive site'} onClick={() => setConfirm({ kind: 'site' })}>
                    {d.site.archivedAt ? <ArchiveRestore size={17} /> : <Archive size={17} />}
                  </IconButton>
                )}
              </>}
            />

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard label="Facilities" value={d.facilities.length} sub={`${d.processAreas.length} process areas`} />
              <KpiCard label="Assets" value={d.assets.length} href={`/console/assets?siteId=${d.site.id}`} sub={`${d.assets.filter((a) => a.status === 'degraded' || a.status === 'down').length} degraded or down`} />
              <KpiCard label="Open alarms" value={openAlarms} href="/console/alarms" accent={critical ? 'critical' : openAlarms ? 'high' : undefined} sub={`${critical} assets with critical alarms`} />
              <KpiCard label="Layout" value={`${d.site.layoutWidthM}×${d.site.layoutHeightM}`} unit="m" tone="dark"
                sub={`${d.assets.filter((a) => a.positionX !== null && a.positionY !== null).length} of ${d.assets.length} assets placed on the map`} />
            </div>

            <section aria-labelledby="hierarchy-h">
              <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 id="hierarchy-h" className="t-section">Plant hierarchy</h2>
                  <p className="t-label mt-1">Facilities → process areas → assets. Select a node to open its record.</p>
                </div>
              </div>
              <HierarchyNavigator detail={d} actions={{
                canSite, canAsset,
                onEditSite: () => setEditSite(true),
                onAddFacility: () => setFacDlg({ open: true }),
                onEditFacility: (f) => setFacDlg({ open: true, f }),
                onArchiveFacility: (f) => setConfirm({ kind: 'facility', f }),
                onAddArea: (facilityId) => setAreaDlg({ open: true, facilityId }),
                onEditArea: (a) => setAreaDlg({ open: true, a }),
                onArchiveArea: (a) => setConfirm({ kind: 'area', a }),
                onAddAsset: (p) => setAssetDlg({ open: true, ...p }),
              }} />
            </section>

            <Card title={<div><h2 className="t-card">Telemetry gateways</h2><p className="t-label mt-0.5">Edge devices pushing plant data into Hydris with their own API key.</p></div>}
              action={canGateway ? <Button size="sm" variant="primary" icon={<Plus size={14} />} onClick={() => setGwDlg(true)}>New gateway</Button> : undefined}>
              <DataTable rows={d.gateways} rowKey={(g) => g.id} dense
                empty={<EmptyState icon={<Radio size={20} aria-hidden />} title="No gateways" body={canGateway ? 'Create a gateway to obtain an API key for pushing telemetry from the plant.' : 'No telemetry gateways are registered for this site.'} />}
                columns={[
                  { key: 'name', header: 'Name', cell: (g) => <span className="font-medium">{g.name}</span> },
                  { key: 'protocol', header: 'Protocol', cell: (g) => g.protocol.toUpperCase() },
                  { key: 'key', header: 'Key', cell: (g) => <code className="font-mono text-[13px] text-text-2">{g.keyPrefix}…</code> },
                  { key: 'status', header: 'Status', cell: (g) => <StateChip state={g.status === 'revoked' ? 'revoked' : 'connected'} label={g.status === 'revoked' ? 'Revoked' : 'Active'} /> },
                  { key: 'seen', header: 'Last seen', cell: (g) => <span className="text-text-2">{g.lastSeenAt ? ago(g.lastSeenAt) : 'never'}</span> },
                  ...(canGateway ? [{
                    key: 'act', header: <span className="sr-only">Actions</span>, className: 'text-right',
                    cell: (g: Gateway) => g.status === 'active' ? <Button size="sm" variant="danger" icon={<Ban size={14} />} onClick={() => setConfirm({ kind: 'gateway', g })}>Revoke</Button> : null,
                  }] : []),
                ]} />
            </Card>

            <SiteFormDialog open={editSite} onOpenChange={setEditSite} site={d.site} />
            <FacilityDialog open={facDlg.open} onOpenChange={(v) => setFacDlg((s) => ({ ...s, open: v }))} siteId={d.site.id} facility={facDlg.f} />
            <ProcessAreaDialog open={areaDlg.open} onOpenChange={(v) => setAreaDlg((s) => ({ ...s, open: v }))} facilities={d.facilities} facilityId={areaDlg.facilityId} area={areaDlg.a}
              layout={{ w: d.site.layoutWidthM, h: d.site.layoutHeightM }} />
            <AssetFormDialog open={assetDlg.open} onOpenChange={(v) => setAssetDlg((s) => ({ ...s, open: v }))}
              prefill={{ siteId: d.site.id, facilityId: assetDlg.facilityId, processAreaId: assetDlg.processAreaId }} layout={{ w: d.site.layoutWidthM, h: d.site.layoutHeightM }} />
            <GatewayDialog open={gwDlg} onOpenChange={setGwDlg} siteId={d.site.id} />
          </div>
        );
      }}
    </QueryView>
    <ConfirmDialog
      open={!!confirm && !!confirmCfg}
      onOpenChange={(v) => { if (!v) setConfirm(null); }}
      title={confirmCfg?.title ?? ''}
      body={confirmCfg?.body ?? ''}
      confirmLabel={confirmCfg?.label ?? 'Confirm'}
      destructive={confirmCfg?.destructive}
      onConfirm={async () => {
        await confirmCfg!.run();
        invalidatePaths(qc, PLANT_PATHS);
      }}
    />
    </>
  );
}
