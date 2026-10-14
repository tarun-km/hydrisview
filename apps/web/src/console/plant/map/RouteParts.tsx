'use client';

import clsx from 'clsx';
import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ClipboardCheck } from 'lucide-react';
import { ROLE_LABELS, type Role } from '@hydris/domain';
import { errorMessage, post } from '@/lib/api';
import { useAction, useApi } from '@/lib/query';
import { Button, ButtonLink, Input, Select } from '@/ui';
import { Dialog } from '@/ui/overlay';
import type { AssetSummary, InspectionRoute, InspectionTemplate, Member } from '../types';
import { attentionLevel, healthColor, healthLabel } from '../util';
import { fmtMetres, templateFor, type RouteMetrics } from './geometry';

/**
 * Route profile strip — the BikeRoute elevation-profile analogue. The x axis is cumulative walking
 * distance; one bar per stop whose height and colour encode that asset's health / worst alarm.
 * Hover or focus is shared with the map through `hover` / `onHover`.
 */
export function RouteProfile({ metrics, hover, onHover }: { metrics: RouteMetrics; hover: number | null; onHover: (i: number | null) => void }) {
  const { stops, distanceM } = metrics;
  if (!stops.length) return null;
  const xOf = (i: number) => (distanceM > 0 ? (stops[i]!.at / distanceM) : stops.length > 1 ? i / (stops.length - 1) : 0.5);
  return (
    <div>
      <div className="relative h-[108px] px-3" role="group" aria-label="Route profile: asset health along the route by walking distance">
        {/* baseline with casing */}
        <div className="absolute inset-x-3 bottom-[14px] h-[6px] rounded-full bg-[#050505]" aria-hidden />
        <div className="absolute inset-x-3 bottom-[16px] h-[2px] rounded-full bg-lime" aria-hidden />
        <div className="absolute inset-x-3 bottom-0 top-0">
          {stops.map((s, i) => {
            const x = xOf(i) * 100;
            const lvl = s.asset ? attentionLevel(s.asset) : 0.18;
            const color = s.asset ? healthColor(s.asset) : 'var(--color-muted)';
            const on = hover === i;
            return (
              <button key={`${s.assetId}-${i}`} type="button"
                className="group absolute bottom-[10px] top-0 flex w-6 -translate-x-1/2 flex-col items-center justify-end outline-none"
                style={{ left: `${x}%` }}
                aria-label={`Stop ${i + 1}: ${s.asset ? `${s.asset.tag}, ${healthLabel(s.asset)}` : 'asset unavailable'}. ${fmtMetres(s.at)} along the route.`}
                onMouseEnter={() => onHover(i)} onMouseLeave={() => onHover(null)} onFocus={() => onHover(i)} onBlur={() => onHover(null)}>
                <span className={clsx('w-[6px] rounded-full transition-all group-focus-visible:ring-2 group-focus-visible:ring-lime', on && 'w-[10px]')}
                  style={{ height: `${Math.round(lvl * 72)}px`, background: color, opacity: hover === null || on ? 1 : 0.45 }} />
                <span className={clsx('mt-1 grid h-[14px] w-[14px] place-items-center rounded-full border-2 border-[#050505] bg-lime text-[8px] font-bold text-lime-ink transition-transform', on && 'scale-150')} aria-hidden />
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-1 flex justify-between px-3 text-[11px] text-muted num">
        <span>0 m</span>
        <span aria-live="polite">{hover !== null && stops[hover] ? `Stop ${hover + 1} · ${stops[hover]!.asset?.tag ?? '—'} · ${fmtMetres(stops[hover]!.at)}` : ''}</span>
        <span>{fmtMetres(distanceM)}</span>
      </div>
    </div>
  );
}

const EXECUTOR_ROLES: Role[] = ['field_operator', 'maintenance_engineer', 'supervisor', 'factory_manager', 'org_admin'];

export function DispatchDialog({ open, onOpenChange, route, siteId, assetsById, templates }: {
  open: boolean; onOpenChange: (v: boolean) => void; route: InspectionRoute; siteId: string; assetsById: Map<string, AssetSummary>; templates: InspectionTemplate[];
}) {
  const members = useApi<{ members: Member[] }>(open ? '/members' : null);
  const published = templates.filter((t) => t.status === 'published');
  const [assignee, setAssignee] = useState('');
  const [due, setDue] = useState('');
  const [fallback, setFallback] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ created: number } | null>(null);
  useEffect(() => {
    if (!open) return;
    setAssignee(''); setErr(null); setResult(null);
    const d = new Date(Date.now() + 4 * 3600_000);
    d.setMinutes(0, 0, 0);
    setDue(new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16));
    setFallback(published.find((t) => !t.assetType)?.id ?? published[0]?.id ?? '');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const eligible = useMemo(() => (members.data?.members ?? [])
    .filter((m) => m.status === 'active' && EXECUTOR_ROLES.includes(m.role as Role) && (m.allSites || m.siteIds.includes(siteId)))
    .sort((a, b) => Number(b.role === 'field_operator') - Number(a.role === 'field_operator') || a.name.localeCompare(b.name)), [members.data, siteId]);

  const typed = route.assetIds.filter((id) => templateFor(assetsById.get(id) ?? null, templates)).length;
  const viaFallback = route.assetIds.length - typed;

  const dispatch = useAction(
    (b: { assignedTo: string; dueAt?: string; fallbackTemplateId: string }) => post<{ created: number; inspectionIds: string[] }>(`/inspection-routes/${route.id}/dispatch`, b),
    { invalidate: ['/inspections', '/overview', '/members'], success: (r) => `Round dispatched: ${r.created} inspection${r.created === 1 ? '' : 's'} created`, onSuccess: (r) => setResult({ created: r.created }) },
  );

  const submit = () => {
    if (!assignee) return setErr('Choose who will walk the round');
    if (!fallback) return setErr('Choose a fallback template');
    const dueAt = due ? new Date(due) : null;
    if (dueAt && Number.isNaN(dueAt.getTime())) return setErr('Enter a valid due date');
    setErr(null);
    dispatch.mutate({ assignedTo: assignee, fallbackTemplateId: fallback, ...(dueAt ? { dueAt: dueAt.toISOString() } : {}) });
  };

  if (result) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange} title="Round dispatched"
        footer={<>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Back to map</Button>
          <ButtonLink href="/console/inspections" variant="primary" icon={<ClipboardCheck size={16} />}>Open inspections</ButtonLink>
        </>}>
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 text-ok" size={22} aria-hidden />
          <p className="text-[15px]">
            {result.created} inspection{result.created === 1 ? '' : 's'} created for <b>{route.name}</b>
            {result.created < route.assetIds.length ? ` (${route.assetIds.length - result.created} stop${route.assetIds.length - result.created === 1 ? '' : 's'} skipped: asset unavailable or no published template)` : ''}.
            The assignee has been notified and will see the round on their field glasses.
          </p>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!dispatch.isPending) onOpenChange(v); }} title={`Dispatch ${route.name}`}
      description={`Creates one inspection per stop (${route.assetIds.length}) in route order, assigned to one person.`}
      footer={<>
        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={dispatch.isPending}>Cancel</Button>
        <Button variant="primary" busy={dispatch.isPending} onClick={submit} disabled={!published.length}>Dispatch round</Button>
      </>}>
      <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        {members.isError ? <p className="field-error" role="alert">Could not load people: {errorMessage(members.error)}</p> : (
          <Select label="Assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)} disabled={members.isLoading}
            placeholder={members.isLoading ? 'Loading people…' : eligible.length ? 'Choose a person' : 'Nobody with access to this site can execute inspections'}
            options={eligible.map((m) => ({ value: m.userId, label: `${m.name} · ${ROLE_LABELS[m.role as Role] ?? m.role}${m.openInspections ? ` · ${m.openInspections} open` : ''}` }))} />
        )}
        <Input label="Due" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} hint="Your local time. Leave empty for no due date." />
        <Select label="Fallback template" value={fallback} onChange={(e) => setFallback(e.target.value)}
          options={published.map((t) => ({ value: t.id, label: `${t.name}${t.estimatedMinutes ? ` · ${t.estimatedMinutes} min` : ''}` }))}
          placeholder={published.length ? undefined : 'No published templates'}
          hint={`${typed} stop${typed === 1 ? '' : 's'} use the template for their asset type; ${viaFallback} will use this fallback.`} />
        {err && <p role="alert" className="field-error">{err}</p>}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
