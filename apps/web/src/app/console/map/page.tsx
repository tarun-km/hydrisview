'use client';

import Link from 'next/link';
import clsx from 'clsx';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpRight, Building2, Clock, Crosshair, Footprints, MapPin, Move, Pencil, Play, Plus, Route as RouteIcon, Save, Send, X } from 'lucide-react';
import { ASSET_TYPE_LABELS, MEASURAND_DEFS } from '@hydris/domain';
import { patch, post, put } from '@/lib/api';
import { useAction, useApi } from '@/lib/query';
import { useCan } from '@/lib/session';
import { fmtValue } from '@/lib/format';
import { Button, ButtonLink, EmptyState, ErrorState, FreshnessBadge, Input, LoadingBlock, PageHeader, SeverityChip, Skeleton, StateChip } from '@/ui';
import { PLANT_PATHS } from '@/console/plant/forms';
import { DEFAULT_LAYERS, PlantCanvas, type MapLayers } from '@/console/plant/map/PlantCanvas';
import { DispatchDialog, RouteProfile } from '@/console/plant/map/RouteParts';
import { fmtMetres, fmtMinutes, hasPos, routeMetrics, WALK_SPEED_MPS, type Pt } from '@/console/plant/map/geometry';
import type { AssetSummary, InspectionRoute, InspectionTemplate, SensorListItem, SiteDetail, SiteListItem } from '@/console/plant/types';
import { STATUS_COLOR, healthColor, healthLabel } from '@/console/plant/util';

type Mode = 'explore' | 'edit' | 'preview';
interface Draft { id: string | null; name: string; description: string; assetIds: string[] }

export default function MapPage() {
  return <Suspense fallback={<LoadingBlock rows={4} />}><PlantMap /></Suspense>;
}

function PlantMap() {
  const params = useSearchParams();
  const router = useRouter();
  const sites = useApi<{ sites: SiteListItem[] }>('/sites');
  const requested = params.get('siteId');
  const siteId = sites.data?.sites.find((s) => s.id === requested)?.id ?? sites.data?.sites[0]?.id ?? null;
  const setSite = (id: string) => router.replace(`/console/map?siteId=${id}`, { scroll: false });

  return (
    <>
      <PageHeader eyebrow="Operate · Plant map & rounds" title="Plant map"
        subtitle="Live equipment health on the site layout. Plan inspection rounds by linking assets into a route, preview walking distance and health along it, then dispatch it to an operator." />
      {sites.isError ? <ErrorState error={sites.error} onRetry={() => void sites.refetch()} />
        : !sites.data ? <Skeleton className="h-[60dvh] rounded-[32px]" />
          : !siteId ? (
            <EmptyState icon={<Building2 size={20} aria-hidden />} title="No sites available" body="Create a site with a layout size before using the plant map." action={<ButtonLink href="/console/sites" variant="primary">Go to sites</ButtonLink>} />
          ) : <SiteMap key={siteId} siteId={siteId} sites={sites.data.sites} onSite={setSite} initialAsset={params.get('assetId')} />}
    </>
  );
}

function SiteMap({ siteId, sites, onSite, initialAsset }: { siteId: string; sites: SiteListItem[]; onSite: (id: string) => void; initialAsset: string | null }) {
  const can = useCan();
  const canManageRoutes = can('inspection.manage');
  const canReadRoutes = can('inspection.read');
  const canPlace = can('asset.manage');

  const detail = useApi<SiteDetail>(`/sites/${siteId}`);
  const assetsQ = useApi<{ assets: AssetSummary[] }>(`/assets?siteId=${siteId}`, { refetchInterval: 30_000 });
  const sensorsQ = useApi<{ sensors: SensorListItem[] }>(`/sensors?siteId=${siteId}`, { refetchInterval: 30_000 });
  const routesQ = useApi<{ routes: InspectionRoute[] }>(canReadRoutes ? `/inspection-routes?siteId=${siteId}` : null);
  const templatesQ = useApi<{ templates: InspectionTemplate[] }>(canReadRoutes ? '/inspection-templates' : null);

  const [mode, setMode] = useState<Mode>('explore');
  const [layers, setLayers] = useState<MapLayers>(DEFAULT_LAYERS);
  const [selected, setSelected] = useState<string | null>(initialAsset);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [placing, setPlacing] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ x: number; y: number; nonce: number } | null>(null);
  const [dispatchOpen, setDispatchOpen] = useState(false);

  const assets = assetsQ.data?.assets ?? [];
  const byId = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);
  const routes = routesQ.data?.routes ?? [];
  const templates = templatesQ.data?.templates ?? [];
  const saved = draft?.id ? routes.find((r) => r.id === draft.id) ?? null : null;
  const dirty = !!draft && (!saved || saved.name !== draft.name.trim() || (saved.description ?? '') !== draft.description.trim() || saved.assetIds.join() !== draft.assetIds.join());
  const metrics = useMemo(() => routeMetrics(draft?.assetIds ?? [], byId, templates), [draft?.assetIds, byId, templates]);
  const positionedCount = assets.filter(hasPos).length;
  const unplaced = assets.filter((a) => !hasPos(a));

  // Centre the deep-linked asset once data has arrived.
  useEffect(() => {
    if (!initialAsset) return;
    const a = byId.get(initialAsset);
    if (a && hasPos(a)) setFocus({ x: a.positionX, y: a.positionY, nonce: Date.now() });
  }, [initialAsset, byId.size > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // Escape leaves placement / closes the floating card.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (placing) setPlacing(null);
      else if (mode === 'explore') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [placing, mode]);

  const loadRoute = (id: string) => {
    if (id === '__new') return setDraft({ id: null, name: '', description: '', assetIds: [] });
    const r = routes.find((x) => x.id === id);
    if (r) setDraft({ id: r.id, name: r.name, description: r.description ?? '', assetIds: [...r.assetIds] });
  };
  const goMode = (m: Mode) => {
    setPlacing(null);
    setHover(null);
    if (m !== 'explore' && !draft) {
      if (routes[0]) loadRoute(routes[0].id);
      else if (m === 'edit') setDraft({ id: null, name: '', description: '', assetIds: [] });
    }
    setMode(m);
  };
  const toggleStop = (id: string) => setDraft((d) => (d ? { ...d, assetIds: d.assetIds.includes(id) ? d.assetIds.filter((x) => x !== id) : [...d.assetIds, id] } : d));
  const move = (i: number, by: -1 | 1) => setDraft((d) => {
    if (!d) return d;
    const j = i + by;
    if (j < 0 || j >= d.assetIds.length) return d;
    const ids = [...d.assetIds];
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    return { ...d, assetIds: ids };
  });
  const locate = (a: AssetSummary) => {
    setSelected(a.id);
    if (hasPos(a)) setFocus({ x: a.positionX, y: a.positionY, nonce: Date.now() });
  };

  const saveRoute = useAction(
    (d: Draft) => {
      const body = { name: d.name.trim(), description: d.description.trim() || null, assetIds: d.assetIds };
      return d.id ? put<{ route: InspectionRoute }>(`/inspection-routes/${d.id}`, body) : post<{ route: InspectionRoute }>('/inspection-routes', { ...body, siteId });
    },
    { invalidate: ['/inspection-routes'], success: 'Route saved', onSuccess: (r) => setDraft((d) => (d ? { ...d, id: r.route.id } : d)) },
  );
  const place = useAction(
    ({ id, p }: { id: string; p: Pt }) => patch(`/assets/${id}`, { positionX: Math.round(p.x * 10) / 10, positionY: Math.round(p.y * 10) / 10 }),
    { invalidate: PLANT_PATHS, success: 'Asset position saved', onSuccess: () => setPlacing(null) },
  );

  const onPin = (a: AssetSummary) => {
    if (placing) return;
    if (mode === 'edit') return toggleStop(a.id);
    if (mode === 'preview' && draft) {
      const i = draft.assetIds.indexOf(a.id);
      if (i >= 0) { setHover(i); return; }
    }
    setSelected((s) => (s === a.id ? null : a.id));
  };

  if (detail.isError) return <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />;
  if (assetsQ.isError) return <ErrorState error={assetsQ.error} onRetry={() => void assetsQ.refetch()} />;
  if (!detail.data || !assetsQ.data) return <Skeleton className="h-[60dvh] rounded-[32px]" />;

  const site = detail.data.site;
  const sheetOpen = mode !== 'explore';
  const selAsset = selected ? byId.get(selected) : undefined;
  const saveDisabled = !draft || draft.name.trim().length < 2 || draft.assetIds.length === 0 || !dirty;

  return (
    <div className="grid gap-4">
      <div className="relative lg:h-[calc(100dvh-230px)] lg:min-h-[600px]">
        <div className="relative h-[64dvh] min-h-[420px] overflow-hidden rounded-[var(--radius-2xl)] border border-line lg:h-full">
          <PlantCanvas siteKey={site.id} widthM={site.layoutWidthM} heightM={site.layoutHeightM} areas={detail.data.processAreas} assets={assets}
            layers={layers} onLayersChange={setLayers} selectedId={mode === 'explore' ? selected : null}
            route={draft?.assetIds ?? null} routeMode={mode === 'explore' ? 'off' : mode} hoverStop={hover} onHoverStop={setHover}
            onPinClick={onPin} placing={!!placing} focus={focus}
            onBackgroundClick={(p) => {
              if (placing) place.mutate({ id: placing, p });
              else if (mode === 'explore') setSelected(null);
            }}
            railClassName={sheetOpen ? 'lg:right-[412px]' : undefined}>

            {/* top-left HUD: site capsule + state machine capsule */}
            <div data-map-ui className="absolute left-3 top-3 flex max-w-[calc(100%-80px)] flex-wrap items-center gap-2">
              <label className="relative inline-flex h-11 items-center rounded-full border border-line-2 bg-surface/90 pl-4 pr-2 backdrop-blur">
                <MapPin size={15} className="text-lime" aria-hidden />
                <span className="sr-only">Site</span>
                <select value={site.id} onChange={(e) => onSite(e.target.value)} className="h-full max-w-[200px] cursor-pointer appearance-none truncate bg-transparent pl-2 pr-6 text-sm outline-none">
                  {sites.map((s) => <option key={s.id} value={s.id} className="bg-surface">{s.name}</option>)}
                </select>
                <span className="pointer-events-none absolute right-3 text-muted" aria-hidden>▾</span>
              </label>
              {canReadRoutes && (
                <div role="tablist" aria-label="Map mode" className="capsule capsule-lime border-line-2 bg-surface/90 backdrop-blur">
                  <button type="button" role="tab" aria-selected={mode === 'explore'} onClick={() => goMode('explore')}><Crosshair size={14} aria-hidden />Explore</button>
                  <button type="button" role="tab" aria-selected={mode === 'edit'} onClick={() => goMode('edit')} disabled={!canManageRoutes}
                    title={canManageRoutes ? undefined : 'Requires permission to manage inspections'} className="disabled:cursor-not-allowed disabled:opacity-40"><Pencil size={14} aria-hidden />Edit</button>
                  <button type="button" role="tab" aria-selected={mode === 'preview'} onClick={() => goMode('preview')} disabled={!draft && routes.length === 0}
                    className="disabled:cursor-not-allowed disabled:opacity-40"><Play size={14} aria-hidden />Preview</button>
                </div>
              )}
            </div>

            {/* placement banner */}
            {placing && (
              <div data-map-ui role="status" className="absolute left-1/2 top-[68px] flex -translate-x-1/2 items-center gap-3 rounded-full bg-lime py-1.5 pl-4 pr-1.5 text-sm text-lime-ink shadow-[var(--shadow-2)]">
                <Move size={15} aria-hidden /> Click the layout to place <b>{byId.get(placing)?.tag}</b>
                <button type="button" onClick={() => setPlacing(null)} className="grid h-8 w-8 place-items-center rounded-full bg-lime-ink text-lime" aria-label="Cancel placement"><X size={14} /></button>
              </div>
            )}

            {/* empty state: nothing has a position yet */}
            {positionedCount === 0 && !placing && (
              <div data-map-ui className="absolute inset-0 grid place-items-center p-6">
                <div className="panel-glass max-w-md p-6 text-center">
                  <MapPin className="mx-auto text-lime" size={22} aria-hidden />
                  <div className="t-card mt-3">No assets are placed on this layout yet</div>
                  <p className="mt-2 text-sm text-text-2">
                    The map is {site.layoutWidthM} × {site.layoutHeightM} m. Give each asset a position in metres from the top-left corner:
                    open the asset, choose <b>Edit</b> and fill in <b>Map position X / Y</b>{canPlace && unplaced.length ? <>, or pick one below and click the layout</> : null}.
                    Process-area outlines are set on the site page.
                  </p>
                  {canPlace && unplaced.length > 0 && (
                    <div className="mt-4 flex flex-wrap justify-center gap-2">
                      {unplaced.slice(0, 6).map((a) => <button key={a.id} type="button" className="chip hover:border-lime" onClick={() => setPlacing(a.id)}>{a.tag}</button>)}
                    </div>
                  )}
                  <div className="mt-4 flex justify-center gap-2">
                    <ButtonLink href={`/console/sites/${site.id}`} size="sm">Site layout</ButtonLink>
                    <ButtonLink href={`/console/assets?siteId=${site.id}`} size="sm">Assets</ButtonLink>
                  </div>
                </div>
              </div>
            )}

            {/* legend */}
            <Legend />

            {/* explore: floating asset card */}
            {mode === 'explore' && selAsset && !placing && (
              <AssetCard a={selAsset} sensors={(sensorsQ.data?.sensors ?? []).filter((s) => s.assetId === selAsset.id)} onClose={() => setSelected(null)}
                onMove={canPlace ? () => setPlacing(selAsset.id) : undefined} />
            )}
          </PlantCanvas>
        </div>

        {/* Route sheet: floating right panel on desktop, bottom sheet below the map on small screens */}
        {sheetOpen && (
          <aside aria-label={mode === 'edit' ? 'Route editor' : 'Route preview'}
            className="relative z-10 -mt-6 flex flex-col rounded-t-[var(--radius-2xl)] border border-line-2 bg-surface shadow-[var(--shadow-3)] lg:absolute lg:bottom-3 lg:right-3 lg:top-3 lg:mt-0 lg:w-[396px] lg:rounded-[var(--radius-2xl)]">
            <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-line-2 lg:hidden" aria-hidden />
            <div className="flex items-center justify-between gap-2 px-5 pb-2 pt-4">
              <div className="t-eyebrow flex items-center gap-2"><RouteIcon size={14} aria-hidden />{mode === 'edit' ? 'Edit route' : 'Preview round'}</div>
              <button type="button" className="icon-btn icon-btn-sm" aria-label="Close route panel" onClick={() => goMode('explore')}><X size={15} /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
              {routesQ.isError ? <ErrorState error={routesQ.error} /> : (
                <div className="field mb-4">
                  <label htmlFor="route-pick">Route</label>
                  <select id="route-pick" className="select" value={draft?.id ?? (draft ? '__new' : '')} onChange={(e) => loadRoute(e.target.value)}>
                    {!draft && <option value="">Choose a route</option>}
                    {routes.map((r) => <option key={r.id} value={r.id}>{r.name} · {r.assetIds.length} stops</option>)}
                    {canManageRoutes && <option value="__new">+ New route</option>}
                  </select>
                </div>
              )}

              {!draft ? <p className="text-sm text-muted">{routes.length ? 'Choose a route to preview.' : 'No routes on this site yet.'}</p> : mode === 'edit' ? (
                <div className="grid gap-4">
                  <Input label="Route name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Morning aeration round" maxLength={120}
                    error={draft.name.trim().length > 0 && draft.name.trim().length < 2 ? 'At least 2 characters' : null} />
                  <Input label="Description (optional)" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} maxLength={500} />
                  <p className="rounded-2xl bg-bg-2 px-4 py-3 text-[13px] text-text-2">Click pins on the map — or use the asset list below the map — to add or remove stops. Reorder with the arrows.</p>
                  <MiniSummary metrics={metrics} />
                  <ol className="grid gap-1.5" aria-label="Route stops in order">
                    {draft.assetIds.length === 0 && <li className="rounded-2xl border border-dashed border-line-2 px-4 py-5 text-center text-sm text-muted">No stops yet.</li>}
                    {metrics.stops.map((s, i) => (
                      <li key={`${s.assetId}-${i}`} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
                        className={clsx('flex items-center gap-2 rounded-2xl px-2 py-1.5', hover === i ? 'bg-surface-3' : 'bg-bg-2')}>
                        <span className="grid h-7 w-7 flex-none place-items-center rounded-full bg-lime text-[12px] font-semibold text-lime-ink num">{i + 1}</span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5 text-sm"><span className="dot" style={{ background: s.asset ? healthColor(s.asset) : 'var(--color-muted)' }} aria-hidden /><b className="font-medium">{s.asset?.tag ?? 'Unavailable'}</b></span>
                          <span className="block truncate text-xs text-muted">{s.asset?.name ?? 'Archived or removed asset'}{!s.pos ? ' · not on map' : i > 0 && s.leg ? ` · +${fmtMetres(s.leg)}` : ''}</span>
                        </span>
                        <button type="button" className="icon-btn icon-btn-sm icon-btn-ghost" aria-label={`Move stop ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={14} /></button>
                        <button type="button" className="icon-btn icon-btn-sm icon-btn-ghost" aria-label={`Move stop ${i + 1} down`} disabled={i === draft.assetIds.length - 1} onClick={() => move(i, 1)}><ArrowDown size={14} /></button>
                        <button type="button" className="icon-btn icon-btn-sm icon-btn-ghost" aria-label={`Remove stop ${i + 1}`} onClick={() => setDraft({ ...draft, assetIds: draft.assetIds.filter((_, j) => j !== i) })}><X size={14} /></button>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : (
                <div className="grid gap-5">
                  <div>
                    <h2 className="t-section">{draft.name || 'Untitled route'}</h2>
                    {draft.description && <p className="mt-1 text-sm text-text-2">{draft.description}</p>}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <Stat label="Stops" value={String(draft.assetIds.length)} />
                    <Stat label="Walking" value={fmtMetres(metrics.distanceM)} />
                    <Stat label="Est. time" value={fmtMinutes(metrics.totalMinutes)} />
                  </div>
                  <p className="text-xs text-muted">
                    <Footprints size={12} className="mr-1 inline" aria-hidden />{fmtMinutes(metrics.walkMinutes)} walking at {WALK_SPEED_MPS} m/s (straight-line between stops)
                    {' '}+ <Clock size={12} className="mx-1 inline" aria-hidden />{fmtMinutes(metrics.inspectMinutes)} inspecting
                    {metrics.missingEstimate ? ` · ${metrics.missingEstimate} stop${metrics.missingEstimate > 1 ? 's' : ''} without a template estimate` : ''}
                    {metrics.unpositioned ? ` · ${metrics.unpositioned} not on the map` : ''}.
                  </p>
                  <section aria-label="Route profile" className="rounded-[var(--radius-lg)] bg-bg-2 py-3">
                    <div className="mb-1 flex items-center justify-between px-3"><span className="t-label">Route profile · health along the walk</span></div>
                    <RouteProfile metrics={metrics} hover={hover} onHover={setHover} />
                  </section>
                  {dirty && <p className="rounded-2xl border border-[rgb(245_184_61/0.35)] bg-[rgb(245_184_61/0.08)] px-4 py-3 text-[13px]">This route has unsaved changes. Save it before dispatching.</p>}
                </div>
              )}
            </div>
            {draft && (
              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-4">
                {mode === 'edit' ? (<>
                  {dirty && saved && <Button size="sm" variant="ghost" onClick={() => loadRoute(saved.id)}>Discard</Button>}
                  <Button size="sm" variant="secondary" icon={<Play size={14} />} onClick={() => setMode('preview')} disabled={!draft.assetIds.length}>Preview</Button>
                  <Button size="sm" variant="primary" icon={<Save size={14} />} busy={saveRoute.isPending} disabled={saveDisabled} onClick={() => saveRoute.mutate(draft)}>Save route</Button>
                </>) : (<>
                  {canManageRoutes && <Button size="sm" variant="secondary" icon={<Pencil size={14} />} onClick={() => setMode('edit')}>Edit route</Button>}
                  {canManageRoutes && dirty && <Button size="sm" variant="secondary" icon={<Save size={14} />} busy={saveRoute.isPending} disabled={saveDisabled} onClick={() => saveRoute.mutate(draft)}>Save</Button>}
                  {canManageRoutes && <Button size="sm" variant="primary" icon={<Send size={14} />} disabled={!draft.id || dirty || !draft.assetIds.length} onClick={() => setDispatchOpen(true)}>Dispatch round</Button>}
                </>)}
              </div>
            )}
          </aside>
        )}
      </div>

      {/* Accessible text alternative to the map — always present */}
      <TextList mode={mode} assets={assets} draft={draft} metrics={metrics} hover={hover} onHover={setHover} onLocate={locate} onToggle={toggleStop}
        canPlace={canPlace} onPlace={(id) => { setMode('explore'); setPlacing(id); }} />

      {draft?.id && saved && (
        <DispatchDialog open={dispatchOpen} onOpenChange={setDispatchOpen} route={saved} siteId={site.id} assetsById={byId} templates={templates} />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-paper px-3 py-3 text-ink">
      <div className="text-[11.5px] text-ink-2">{label}</div>
      <div className="mt-0.5 text-[20px] font-light tracking-[-0.02em] num">{value}</div>
    </div>
  );
}

function MiniSummary({ metrics }: { metrics: ReturnType<typeof routeMetrics> }) {
  return (
    <div className="flex flex-wrap gap-2 text-[12.5px]">
      <span className="chip">{metrics.stops.length} stops</span>
      <span className="chip"><Footprints size={13} aria-hidden />{fmtMetres(metrics.distanceM)}</span>
      <span className="chip"><Clock size={13} aria-hidden />~{fmtMinutes(metrics.totalMinutes)}</span>
      {metrics.unpositioned > 0 && <span className="chip chip-medium">{metrics.unpositioned} not on map</span>}
    </div>
  );
}

function Legend() {
  const [open, setOpen] = useState(false);
  const items: [string, string][] = [
    ['Operational', STATUS_COLOR.operational], ['Standby', STATUS_COLOR.standby], ['Maintenance', STATUS_COLOR.maintenance],
    ['Degraded / medium alarm', 'var(--color-medium)'], ['High alarm', 'var(--color-high)'], ['Down / critical alarm', 'var(--color-critical)'],
  ];
  return (
    <div data-map-ui className="absolute bottom-3 left-3 hidden sm:block">
      {open ? (
        <div className="panel-glass w-[230px] p-4">
          <div className="mb-2 flex items-center justify-between"><span className="t-eyebrow">Legend</span>
            <button type="button" className="icon-btn icon-btn-sm icon-btn-ghost" aria-label="Hide legend" onClick={() => setOpen(false)}><X size={14} /></button></div>
          <ul className="grid gap-1.5 text-[12.5px] text-text-2">
            {items.map(([l, c]) => <li key={l} className="flex items-center gap-2"><span className="dot" style={{ background: c }} aria-hidden />{l}</li>)}
            <li className="flex items-center gap-2"><span className="grid h-4 w-4 place-items-center rounded-full bg-lime text-[9px] font-bold text-lime-ink">1</span>Route stop</li>
            <li className="flex items-center gap-2"><span className="h-[3px] w-5 rounded-full bg-lime ring-2 ring-black" aria-hidden />Route (dashed while editing)</li>
            <li className="flex items-center gap-2"><span className="h-3 w-5 rounded-sm border border-text/30 bg-text/5" aria-hidden />Process area</li>
          </ul>
        </div>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="chip h-9 border-line-2 bg-surface/90 px-4 backdrop-blur">Legend</button>
      )}
    </div>
  );
}

function AssetCard({ a, sensors, onClose, onMove }: { a: AssetSummary; sensors: SensorListItem[]; onClose: () => void; onMove?: () => void }) {
  return (
    <div data-map-ui role="dialog" aria-label={`${a.tag} ${a.name}`}
      className="absolute inset-x-3 bottom-3 max-h-[60%] overflow-y-auto rounded-[var(--radius-xl)] border border-line-2 bg-surface p-5 shadow-[var(--shadow-3)] fade-in sm:inset-x-auto sm:left-3 sm:w-[360px] sm:bottom-14">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="t-eyebrow">{ASSET_TYPE_LABELS[a.type]} · {a.tag}</div>
          <div className="t-card mt-1">{a.name}</div>
          <div className="t-label mt-0.5">{a.areaName ?? 'No process area'}</div>
        </div>
        <div className="flex gap-1.5">
          <Link href={`/console/assets/${a.id}`} aria-label={`Open asset ${a.tag}`} className="icon-btn icon-btn-sm icon-btn-light"><ArrowUpRight size={16} /></Link>
          <button type="button" className="icon-btn icon-btn-sm" aria-label="Close asset card" onClick={onClose}><X size={15} /></button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <StateChip state={a.status} />
        {a.openAlarms > 0 && a.worstSeverity && <SeverityChip severity={a.worstSeverity} />}
        {a.openAlarms > 0 && <Link href="/console/alarms" className="chip hover:border-line-2">{a.openAlarms} open alarm{a.openAlarms > 1 ? 's' : ''}</Link>}
        {a.openTasks > 0 && <span className="chip">{a.openTasks} open task{a.openTasks > 1 ? 's' : ''}</span>}
      </div>
      {sensors.length > 0 ? (
        <ul className="mt-4 grid gap-1.5">
          {sensors.slice(0, 5).map((s) => (
            <li key={s.id}>
              <Link href={`/console/telemetry/${s.id}`} className="flex items-center gap-3 rounded-2xl bg-bg-2 px-3 py-2 hover:bg-surface-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-text-2">{MEASURAND_DEFS[s.measurand].label} · {s.tag}</span>
                  <FreshnessBadge freshness={s.freshness} ts={s.lastTs} />
                </span>
                <span className="num text-right"><span className={clsx('text-[18px] font-light', (s.freshness === 'stale' || s.freshness === 'no_data') && 'text-muted')}>{fmtValue(s.lastValue, s.measurand)}</span> <span className="text-xs text-muted">{s.unit}</span></span>
              </Link>
            </li>
          ))}
        </ul>
      ) : <p className="mt-4 text-sm text-muted">No sensors on this asset.</p>}
      {onMove && <div className="mt-4"><Button size="sm" variant="ghost" icon={<Move size={14} />} onClick={onMove}>Move on map</Button></div>}
    </div>
  );
}

function TextList({ mode, assets, draft, metrics, hover, onHover, onLocate, onToggle, canPlace, onPlace }: {
  mode: Mode; assets: AssetSummary[]; draft: Draft | null; metrics: ReturnType<typeof routeMetrics>; hover: number | null; onHover: (i: number | null) => void;
  onLocate: (a: AssetSummary) => void; onToggle: (id: string) => void; canPlace: boolean; onPlace: (id: string) => void;
}) {
  const showStops = mode === 'preview' && draft;
  return (
    <section className="card card-tight" aria-labelledby="map-list-h">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="map-list-h" className="t-card">{showStops ? `Stops on ${draft.name || 'this route'}` : mode === 'edit' ? 'Assets — add or remove stops' : 'Assets on this site'}</h2>
        <span className="t-label">Text view of the map</span>
      </div>
      {showStops ? (
        draft.assetIds.length === 0 ? <p className="text-sm text-muted">This route has no stops.</p> : (
          <ol className="grid gap-1.5">
            {metrics.stops.map((s, i) => (
              <li key={`${s.assetId}-${i}`} onMouseEnter={() => onHover(i)} onMouseLeave={() => onHover(null)}
                className={clsx('grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-2xl px-3 py-2', hover === i ? 'bg-surface-3' : 'bg-bg-2')}>
                <span className="grid h-7 w-7 place-items-center rounded-full bg-lime text-[12px] font-semibold text-lime-ink num" aria-hidden>{i + 1}</span>
                <span className="min-w-0">
                  <span className="sr-only">Stop {i + 1}: </span>
                  {s.asset ? <Link href={`/console/assets/${s.asset.id}`} className="font-medium hover:underline">{s.asset.tag}</Link> : <span className="text-muted">Unavailable asset</span>}
                  <span className="ml-2 text-sm text-text-2">{s.asset?.name}</span>
                  <span className="block text-xs text-muted">{s.asset ? healthLabel(s.asset) : ''}{s.pos ? ` · ${i === 0 ? 'start' : `+${fmtMetres(s.leg)}`} · ${fmtMetres(s.at)} total` : ' · not on map'}{s.minutes ? ` · ${s.minutes} min inspection` : ''}</span>
                </span>
                {s.asset && hasPos(s.asset) && <Button size="sm" variant="ghost" icon={<Crosshair size={14} />} onClick={() => onLocate(s.asset!)} aria-label={`Locate ${s.asset.tag} on the map`}>Locate</Button>}
              </li>
            ))}
          </ol>
        )
      ) : assets.length === 0 ? (
        <EmptyState title="No assets on this site" body="Register equipment on the site to see it on the map." action={<ButtonLink href="/console/assets" size="sm">Asset registry</ButtonLink>} />
      ) : (
        <ul className="grid gap-1.5 md:grid-cols-2">
          {assets.map((a) => {
            const idx = draft?.assetIds.indexOf(a.id) ?? -1;
            return (
              <li key={a.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-2xl bg-bg-2 px-3 py-2">
                <span className="dot" style={{ background: healthColor(a) }} aria-hidden />
                <span className="min-w-0">
                  <Link href={`/console/assets/${a.id}`} className="font-medium hover:underline">{a.tag}</Link>
                  <span className="ml-2 truncate text-sm text-text-2">{a.name}</span>
                  <span className="block text-xs text-muted">{healthLabel(a)} · {hasPos(a) ? `${a.positionX.toFixed(0)}, ${a.positionY.toFixed(0)} m` : 'not placed'}</span>
                </span>
                <span className="flex gap-1">
                  {mode === 'edit' && draft ? (
                    <Button size="sm" variant={idx >= 0 ? 'secondary' : 'ghost'} icon={idx >= 0 ? <X size={14} /> : <Plus size={14} />} onClick={() => onToggle(a.id)}
                      aria-label={idx >= 0 ? `Remove ${a.tag} (stop ${idx + 1}) from the route` : `Add ${a.tag} to the route`}>{idx >= 0 ? `Stop ${idx + 1}` : 'Add'}</Button>
                  ) : hasPos(a) ? (
                    <Button size="sm" variant="ghost" icon={<Crosshair size={14} />} onClick={() => onLocate(a)} aria-label={`Locate ${a.tag} on the map`}>Locate</Button>
                  ) : canPlace ? (
                    <Button size="sm" variant="ghost" icon={<MapPin size={14} />} onClick={() => onPlace(a.id)} aria-label={`Place ${a.tag} on the map`}>Place</Button>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
