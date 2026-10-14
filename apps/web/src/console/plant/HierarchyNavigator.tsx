'use client';

import Link from 'next/link';
import clsx from 'clsx';
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Archive, ArrowUpRight, Boxes, Factory, Layers, Map as MapIcon, Pencil, Plus } from 'lucide-react';
import { ASSET_STATUS_LABELS, ASSET_TYPE_LABELS, FACILITY_KIND_LABELS, PROCESS_AREA_KIND_LABELS } from '@hydris/domain';
import { label } from '@/lib/format';
import { SeverityChip, StateChip } from '@/ui';
import type { AssetSummary, Facility, ProcessArea, SiteDetail } from './types';
import { healthColor } from './util';

type Focus = { kind: 'site' } | { kind: 'facility'; id: string } | { kind: 'area'; id: string } | { kind: 'asset'; id: string };
const UNASSIGNED = '__unassigned';

export interface NavigatorActions {
  canSite: boolean;
  canAsset: boolean;
  onEditSite: () => void;
  onAddFacility: () => void;
  onEditFacility: (f: Facility) => void;
  onArchiveFacility: (f: Facility) => void;
  onAddArea: (facilityId: string) => void;
  onEditArea: (a: ProcessArea) => void;
  onArchiveArea: (a: ProcessArea) => void;
  onAddAsset: (p: { facilityId: string; processAreaId: string | null }) => void;
}

interface Link { from: string; to: string; hot: boolean }
interface Seg { d: string; hot: boolean; key: string }

/**
 * EHR-style node-link navigator: facilities → process areas → assets as columns of pills,
 * joined by bezier links. The selected path is cobalt; the record for the focused node is shown
 * on a white floating panel.
 */
export function HierarchyNavigator({ detail, actions }: { detail: SiteDetail; actions: NavigatorActions }) {
  const { facilities, processAreas, assets, site } = detail;
  const [activeFacility, setActiveFacility] = useState<string | null>(facilities[0]?.id ?? null);
  const [activeArea, setActiveArea] = useState<string | null>(null);
  const [focus, setFocus] = useState<Focus>({ kind: 'site' });

  const facId = facilities.some((f) => f.id === activeFacility) ? activeFacility : facilities[0]?.id ?? null;
  const areas = processAreas.filter((a) => a.facilityId === facId);
  const facAssets = assets.filter((a) => a.facilityId === facId);
  const hasUnassigned = facAssets.some((a) => !a.processAreaId);
  const shownAssets = activeArea === null ? facAssets : facAssets.filter((a) => (activeArea === UNASSIGNED ? !a.processAreaId : a.processAreaId === activeArea));
  const focusedAsset = focus.kind === 'asset' ? assets.find((a) => a.id === focus.id) : undefined;

  const links: Link[] = [];
  if (facId) {
    const areaKeys = [...areas.map((a) => a.id), ...(hasUnassigned ? [UNASSIGNED] : [])];
    for (const a of areaKeys) links.push({ from: `f:${facId}`, to: `a:${a}`, hot: activeArea === a || (focusedAsset ? (focusedAsset.processAreaId ?? UNASSIGNED) === a : false) || focus.kind === 'facility' });
    for (const x of shownAssets) {
      const a = x.processAreaId ?? UNASSIGNED;
      links.push({ from: `a:${a}`, to: `x:${x.id}`, hot: focusedAsset?.id === x.id || (activeArea === a && focus.kind === 'area') });
    }
  }
  // Stable signature so the measuring effect only re-runs when the drawn graph changes.
  const linkKey = links.map((l) => `${l.from}>${l.to}:${l.hot ? 1 : 0}`).join('|');
  const linksRef = useRef(links);
  linksRef.current = links;

  // --- link geometry, measured from the DOM so it follows wrapping and responsive layout
  const wrap = useRef<HTMLDivElement>(null);
  const nodes = useRef(new Map<string, HTMLElement>());
  const reg = useCallback((key: string) => (el: HTMLElement | null) => { if (el) nodes.current.set(key, el); else nodes.current.delete(key); }, []);
  const [segs, setSegs] = useState<Seg[]>([]);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => {
      const base = el.getBoundingClientRect();
      setBox((b) => (b.w === base.width && b.h === base.height ? b : { w: base.width, h: base.height }));
      const next: Seg[] = [];
      for (const l of linksRef.current) {
        const a = nodes.current.get(l.from)?.getBoundingClientRect();
        const b = nodes.current.get(l.to)?.getBoundingClientRect();
        if (!a || !b || b.left <= a.right) continue; // stacked (mobile): no links
        const x1 = a.right - base.left, y1 = a.top + a.height / 2 - base.top;
        const x2 = b.left - base.left, y2 = b.top + b.height / 2 - base.top;
        const dx = (x2 - x1) * 0.55;
        next.push({ key: `${l.from}>${l.to}`, hot: l.hot, d: `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}` });
      }
      setSegs((prev) => (prev.length === next.length && prev.every((p, i) => p.d === next[i]!.d && p.hot === next[i]!.hot) ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [linkKey]);

  const pickFacility = (f: Facility) => { setActiveFacility(f.id); setActiveArea(null); setFocus({ kind: 'facility', id: f.id }); };
  const pickArea = (id: string) => {
    if (activeArea === id && focus.kind === 'area') { setActiveArea(null); setFocus(facId ? { kind: 'facility', id: facId } : { kind: 'site' }); return; }
    setActiveArea(id);
    setFocus({ kind: 'area', id });
  };
  const pickAsset = (a: AssetSummary) => setFocus({ kind: 'asset', id: a.id });

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div ref={wrap} className="relative rounded-[var(--radius-2xl)] border border-line bg-black p-4 sm:p-6">
        <svg className="pointer-events-none absolute inset-0 hidden lg:block" width={box.w} height={box.h} aria-hidden>
          {segs.filter((s) => !s.hot).map((s) => <path key={s.key} d={s.d} fill="none" stroke="rgb(255 255 255 / 0.16)" strokeWidth={1} />)}
          {segs.filter((s) => s.hot).map((s) => <path key={s.key} d={s.d} fill="none" stroke="var(--color-cobalt-2)" strokeWidth={2} />)}
        </svg>
        <div className="relative grid gap-6 lg:grid-cols-3 lg:gap-16">
          <Column title="Facilities" icon={<Factory size={15} aria-hidden />} count={facilities.length}
            add={actions.canSite ? { label: 'Add facility', onClick: actions.onAddFacility } : undefined}>
            {facilities.length === 0 && <ColumnEmpty>No facilities yet.{actions.canSite ? ' Add the first treatment plant on this site.' : ''}</ColumnEmpty>}
            {facilities.map((f) => (
              <Node key={f.id} nodeRef={reg(`f:${f.id}`)} selected={f.id === facId} focused={focus.kind === 'facility' && focus.id === f.id} onClick={() => pickFacility(f)}
                eyebrow={f.code} title={f.name} meta={`${FACILITY_KIND_LABELS[f.kind]} · ${processAreas.filter((a) => a.facilityId === f.id).length} areas · ${assets.filter((a) => a.facilityId === f.id).length} assets`} />
            ))}
          </Column>
          <Column title="Process areas" icon={<Layers size={15} aria-hidden />} count={areas.length}
            add={actions.canSite && facId ? { label: 'Add process area', onClick: () => actions.onAddArea(facId) } : undefined}>
            {!facId ? <ColumnEmpty>Select a facility.</ColumnEmpty> : areas.length === 0 && !hasUnassigned ? <ColumnEmpty>No process areas in this facility.</ColumnEmpty> : null}
            {areas.map((a) => (
              <Node key={a.id} nodeRef={reg(`a:${a.id}`)} selected={activeArea === a.id} focused={focus.kind === 'area' && focus.id === a.id} onClick={() => pickArea(a.id)}
                eyebrow={`${a.code} · ${PROCESS_AREA_KIND_LABELS[a.kind]}`} title={a.name} meta={`${assets.filter((x) => x.processAreaId === a.id).length} assets${a.polygon ? ' · on map' : ''}`} />
            ))}
            {hasUnassigned && (
              <Node nodeRef={reg(`a:${UNASSIGNED}`)} selected={activeArea === UNASSIGNED} focused={focus.kind === 'area' && focus.id === UNASSIGNED} onClick={() => pickArea(UNASSIGNED)}
                eyebrow="No area" title="Unassigned equipment" meta={`${facAssets.filter((a) => !a.processAreaId).length} assets`} muted />
            )}
          </Column>
          <Column title="Assets" icon={<Boxes size={15} aria-hidden />} count={shownAssets.length}
            add={actions.canAsset && facId ? { label: 'Add asset', onClick: () => actions.onAddAsset({ facilityId: facId, processAreaId: activeArea && activeArea !== UNASSIGNED ? activeArea : null }) } : undefined}>
            {facId && shownAssets.length === 0 && <ColumnEmpty>No assets here yet.</ColumnEmpty>}
            {shownAssets.map((x) => (
              <Node key={x.id} nodeRef={reg(`x:${x.id}`)} selected={focus.kind === 'asset' && focus.id === x.id} focused={focus.kind === 'asset' && focus.id === x.id} onClick={() => pickAsset(x)}
                eyebrow={x.tag} title={x.name} compact
                lead={<span className="dot" style={{ background: healthColor(x) }} aria-hidden />}
                trailing={x.openAlarms ? <span className="num rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: `var(--color-${x.worstSeverity ?? 'medium'})`, color: '#140b08' }} aria-label={`${x.openAlarms} open alarms`}>{x.openAlarms}</span> : undefined} />
            ))}
          </Column>
        </div>
      </div>

      <DetailPanel focus={focus} detail={detail} actions={actions} siteName={site.name} />
    </div>
  );
}

function Column({ title, icon, count, add, children }: { title: string; icon: ReactNode; count: number; add?: { label: string; onClick: () => void }; children: ReactNode }) {
  return (
    <section aria-label={title} className="min-w-0">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="t-eyebrow flex items-center gap-2">{icon}{title} <span className="num text-text-2">{count}</span></h3>
        {add && <button type="button" onClick={add.onClick} className="icon-btn icon-btn-sm icon-btn-ghost" aria-label={add.label} title={add.label}><Plus size={15} /></button>}
      </div>
      <ul className="grid gap-2">{children}</ul>
    </section>
  );
}

function ColumnEmpty({ children }: { children: ReactNode }) {
  return <li className="rounded-[var(--radius-lg)] border border-dashed border-line-2 px-4 py-5 text-sm text-muted">{children}</li>;
}

function Node({ nodeRef, selected, focused, onClick, eyebrow, title, meta, lead, trailing, compact, muted }: {
  nodeRef: (el: HTMLElement | null) => void; selected: boolean; focused: boolean; onClick: () => void; eyebrow: string; title: string; meta?: string;
  lead?: ReactNode; trailing?: ReactNode; compact?: boolean; muted?: boolean;
}) {
  return (
    <li>
      <button ref={nodeRef} type="button" onClick={onClick} aria-pressed={selected}
        className={clsx(
          'flex w-full items-center gap-3 text-left transition-colors',
          compact ? 'min-h-[52px] rounded-full px-4 py-2' : 'min-h-[64px] rounded-[22px] px-5 py-3',
          selected ? 'bg-cobalt-2 text-white shadow-[0_8px_30px_rgb(0_103_255/0.35)]' : muted ? 'border border-dashed border-line-2 bg-transparent hover:bg-surface' : 'bg-surface-2 hover:bg-surface-3',
          focused && 'ring-2 ring-white/80 ring-offset-2 ring-offset-black',
        )}>
        {lead}
        <span className="min-w-0 flex-1">
          <span className={clsx('block truncate text-[11.5px] uppercase tracking-[0.08em]', selected ? 'text-white/75' : 'text-muted')}>{eyebrow}</span>
          <span className={clsx('block truncate', compact ? 'text-[14px]' : 'text-[15.5px]')}>{title}</span>
          {meta && <span className={clsx('block truncate text-[12px]', selected ? 'text-white/70' : 'text-muted')}>{meta}</span>}
        </span>
        {trailing}
      </button>
    </li>
  );
}

function PanelAction({ onClick, icon, children, primary }: { onClick: () => void; icon: ReactNode; children: ReactNode; primary?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={clsx('btn btn-sm', primary ? 'bg-cobalt-2 text-white hover:bg-cobalt' : 'border-[rgb(17_18_17/0.18)] bg-transparent text-ink hover:bg-[rgb(17_18_17/0.06)]')}>
      {icon}{children}
    </button>
  );
}

function PanelRows({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-[12px] text-ink-2">{k}</dt>
          <dd className="mt-0.5 truncate text-[14.5px]">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

function DetailPanel({ focus, detail, actions, siteName }: { focus: Focus; detail: SiteDetail; actions: NavigatorActions; siteName: string }) {
  const { site, facilities, processAreas, assets } = detail;
  let body: ReactNode;
  if (focus.kind === 'facility') {
    const f = facilities.find((x) => x.id === focus.id);
    if (!f) return null;
    body = (
      <>
        <PanelHead eyebrow={`Facility · ${f.code}`} title={f.name} />
        <PanelRows items={[
          ['Kind', FACILITY_KIND_LABELS[f.kind]], ['Capacity', f.capacityM3PerDay ? `${f.capacityM3PerDay.toLocaleString()} m³/day` : '—'],
          ['Process areas', String(processAreas.filter((a) => a.facilityId === f.id).length)], ['Assets', String(assets.filter((a) => a.facilityId === f.id).length)],
        ]} />
        {f.description && <p className="mt-4 text-sm text-ink-2">{f.description}</p>}
        <div className="mt-6 flex flex-wrap gap-2">
          {actions.canSite && <PanelAction primary onClick={() => actions.onAddArea(f.id)} icon={<Plus size={14} />}>Add area</PanelAction>}
          {actions.canAsset && <PanelAction onClick={() => actions.onAddAsset({ facilityId: f.id, processAreaId: null })} icon={<Plus size={14} />}>Add asset</PanelAction>}
          {actions.canSite && <PanelAction onClick={() => actions.onEditFacility(f)} icon={<Pencil size={14} />}>Edit</PanelAction>}
          {actions.canSite && <PanelAction onClick={() => actions.onArchiveFacility(f)} icon={<Archive size={14} />}>Archive</PanelAction>}
        </div>
      </>
    );
  } else if (focus.kind === 'area') {
    const a = processAreas.find((x) => x.id === focus.id);
    const list = assets.filter((x) => (a ? x.processAreaId === a.id : !x.processAreaId));
    body = a ? (
      <>
        <PanelHead eyebrow={`Process area · ${a.code}`} title={a.name} />
        <PanelRows items={[
          ['Stage', PROCESS_AREA_KIND_LABELS[a.kind]], ['Sort order', String(a.sortOrder)], ['Assets', String(list.length)],
          ['Map outline', a.polygon ? `${a.polygon.length} points` : 'Not drawn'],
        ]} />
        <AssetMiniList items={list} />
        <div className="mt-6 flex flex-wrap gap-2">
          {actions.canAsset && <PanelAction primary onClick={() => actions.onAddAsset({ facilityId: a.facilityId, processAreaId: a.id })} icon={<Plus size={14} />}>Add asset here</PanelAction>}
          {actions.canSite && <PanelAction onClick={() => actions.onEditArea(a)} icon={<Pencil size={14} />}>Edit</PanelAction>}
          {actions.canSite && <PanelAction onClick={() => actions.onArchiveArea(a)} icon={<Archive size={14} />}>Archive</PanelAction>}
        </div>
      </>
    ) : (
      <>
        <PanelHead eyebrow="No process area" title="Unassigned equipment" />
        <p className="mt-3 text-sm text-ink-2">These assets belong to the facility but are not placed in a process stage. Edit an asset to assign its area.</p>
        <AssetMiniList items={list} />
      </>
    );
  } else if (focus.kind === 'asset') {
    const x = assets.find((a) => a.id === focus.id);
    if (!x) return null;
    body = (
      <>
        <div className="flex items-start justify-between gap-3">
          <PanelHead eyebrow={`${ASSET_TYPE_LABELS[x.type]} · ${x.tag}`} title={x.name} />
          <Link href={`/console/assets/${x.id}`} aria-label={`Open asset ${x.tag}`} className="icon-btn flex-none border-transparent bg-cobalt-2 text-white hover:bg-cobalt"><ArrowUpRight size={18} /></Link>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <StateChip state={x.status} label={ASSET_STATUS_LABELS[x.status]} />
          {x.worstSeverity && x.openAlarms > 0 && <SeverityChip severity={x.worstSeverity} />}
        </div>
        <PanelRows items={[
          ['Area', x.areaName ?? 'Unassigned'], ['Criticality', label(x.criticality)], ['Sensors', String(x.sensorCount)], ['Open alarms', String(x.openAlarms)],
          ['Open tasks', String(x.openTasks)], ['Map position', x.positionX !== null && x.positionY !== null ? `${x.positionX.toFixed(0)}, ${x.positionY.toFixed(0)} m` : 'Not placed'],
        ]} />
      </>
    );
  } else {
    body = (
      <>
        <PanelHead eyebrow={`Site · ${site.code}`} title={siteName} />
        <PanelRows items={[
          ['Facilities', String(facilities.length)], ['Process areas', String(processAreas.length)], ['Assets', String(assets.length)],
          ['Open alarms', String(assets.reduce((n, a) => n + a.openAlarms, 0))], ['Timezone', site.timezone], ['Layout', `${site.layoutWidthM} × ${site.layoutHeightM} m`],
        ]} />
        <p className="mt-4 text-sm text-ink-2">Select a facility, process area or asset to see its record.</p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Link href={`/console/map?siteId=${site.id}`} className="btn btn-sm bg-cobalt-2 text-white hover:bg-cobalt"><MapIcon size={14} /> Plant map</Link>
          {actions.canSite && <PanelAction onClick={actions.onEditSite} icon={<Pencil size={14} />}>Edit site</PanelAction>}
          {actions.canSite && <PanelAction onClick={actions.onAddFacility} icon={<Plus size={14} />}>Add facility</PanelAction>}
        </div>
      </>
    );
  }
  return (
    <aside aria-label="Selected record" aria-live="polite" className="self-start rounded-[var(--radius-2xl)] bg-white p-6 text-ink shadow-[var(--shadow-3)] xl:sticky xl:top-24">
      {body}
    </aside>
  );
}

function PanelHead({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[12px] uppercase tracking-[0.12em] text-ink-2">{eyebrow}</div>
      <h3 className="mt-1 text-[26px] leading-[1.1] tracking-[-0.03em]">{title}</h3>
    </div>
  );
}

function AssetMiniList({ items }: { items: AssetSummary[] }) {
  if (!items.length) return <p className="mt-4 text-sm text-ink-2">No assets yet.</p>;
  return (
    <ul className="mt-4 grid max-h-[220px] gap-1 overflow-y-auto">
      {items.map((x) => (
        <li key={x.id}>
          <Link href={`/console/assets/${x.id}`} className="flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm hover:bg-[rgb(17_18_17/0.06)]">
            <span className="dot" style={{ background: healthColor(x) }} aria-hidden />
            <span className="font-medium">{x.tag}</span>
            <span className="truncate text-ink-2">{x.name}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
