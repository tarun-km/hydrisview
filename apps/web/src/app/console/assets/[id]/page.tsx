'use client';

import { HistoryCard } from '@/console/history';

import { RangeBar } from '@/ui/charts';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, ArrowUpRight, FileText, Map as MapIcon, Paperclip, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { ASSET_STATUS_LABELS, ASSET_TYPE_LABELS, DOCUMENT_KIND_LABELS, MEASURAND_DEFS, type AssetStatus, type DocumentKind } from '@hydris/domain';
import { del, errorMessage, patch } from '@/lib/api';
import { invalidatePaths, useAction, useApi } from '@/lib/query';
import { useCan } from '@/lib/session';
import { ago, fmtDate, fmtDateTime, fmtValue, label } from '@/lib/format';
import { Button, Card, DataTable, EmptyState, FreshnessBadge, IconButton, KeyValues, OpenLink, QueryView, SeverityChip, Skeleton, StateChip, SyntheticBadge, Textarea, Select } from '@/ui';
import { ConfirmDialog, Dialog, useToast } from '@/ui/overlay';
import { AssetSchematic } from '@/console/plant/AssetSchematic';
import { AssetFormDialog, PLANT_PATHS, SensorDialog, uploadAttachment } from '@/console/plant/forms';
import type { AssetDetail, Sensor } from '@/console/plant/types';
import { assetStatusOptions, fmtBytes, healthColor, isApiError, openAttachment } from '@/console/plant/util';

export default function AssetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const q = useApi<AssetDetail>(`/assets/${id}`, { refetchInterval: 30_000 });
  return (
    <QueryView q={q} loading={<div className="grid gap-4"><Skeleton className="h-28" /><Skeleton className="h-[420px] rounded-[32px]" /><Skeleton className="h-64 rounded-[24px]" /></div>}>
      {(d) => <AssetView d={d} />}
    </QueryView>
  );
}

function AssetView({ d }: { d: AssetDetail }) {
  const a = d.asset;
  const can = useCan();
  const router = useRouter();
  const qc = useQueryClient();
  const canManage = can('asset.manage');
  const [editing, setEditing] = useState(false);
  const [addSensor, setAddSensor] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const accent = a.openAlarms && a.worstSeverity ? `var(--color-${a.worstSeverity})` : a.status === 'operational' ? 'var(--color-lime)' : healthColor(a);
  const heroSensors = d.sensors.filter((s) => s.enabled).slice(0, 4);
  const inv = [...PLANT_PATHS, `/assets/${a.id}`];

  return (
    <div className="grid gap-6 fade-in">
      {/* Title block — SolaFlux device page */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <nav aria-label="Breadcrumb" className="t-eyebrow mb-3 flex flex-wrap gap-1.5">
            <Link href="/console/assets" className="hover:text-text">Assets</Link><span aria-hidden>/</span>
            <Link href={`/console/sites/${a.siteId}`} className="hover:text-text">{a.siteName}</Link><span aria-hidden>/</span>
            <span>{a.facilityName}{a.areaName ? ` · ${a.areaName}` : ''}</span>
          </nav>
          <h1 className="t-hero">{a.name}</h1>
          <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-[15px] text-text-2">
            <span className="font-mono text-text">{a.tag}</span>
            <span aria-hidden>·</span><span>{ASSET_TYPE_LABELS[a.type]}</span>
            <span aria-hidden>·</span><span className="font-mono text-[13px] text-muted" title={a.id}>ID {a.id.slice(0, 8)}</span>
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="inline-flex h-9 items-center gap-2 rounded-full border border-line-2 bg-surface px-4 text-sm">
              <span className="dot" style={{ background: healthColor({ ...a, openAlarms: 0 }) }} aria-hidden />{ASSET_STATUS_LABELS[a.status]}
            </span>
            {a.openAlarms > 0 && a.worstSeverity && <SeverityChip severity={a.worstSeverity} />}
            {a.openAlarms > 0 && <span className="chip num">{a.openAlarms} open alarm{a.openAlarms > 1 ? 's' : ''}</span>}
            <span className="chip chip-outline">Criticality {label(a.criticality)}</span>
            {a.archivedAt && <StateChip state="archived" />}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {a.positionX !== null && a.positionY !== null && (
            <Link href={`/console/map?siteId=${a.siteId}&assetId=${a.id}`} className="btn btn-secondary"><MapIcon size={16} /> Show on map</Link>
          )}
          {canManage && <Button icon={<Pencil size={15} />} onClick={() => setEditing(true)}>Edit</Button>}
          {canManage && (
            <IconButton label={a.archivedAt ? 'Restore asset' : 'Archive asset'} onClick={() => setArchiving(true)}>
              {a.archivedAt ? <ArchiveRestore size={17} /> : <Archive size={17} />}
            </IconButton>
          )}
          {canManage && <IconButton label="Delete asset" onClick={() => setDeleting(true)}><Trash2 size={17} /></IconButton>}
        </div>
      </header>

      {/* Device hero */}
      <section aria-label="Live readings" className="relative overflow-hidden rounded-[var(--radius-2xl)] border border-line bg-[radial-gradient(ellipse_at_50%_45%,#1f201e_0%,#081116_70%)]">
        <div className="hatch pointer-events-none absolute inset-0 opacity-[0.25]" aria-hidden />
        <div className="relative grid gap-4 p-4 sm:p-6 lg:min-h-[420px] lg:grid-cols-[1fr_minmax(0,1.4fr)_1fr] lg:items-center">
          <div className="order-2 grid gap-3 sm:grid-cols-2 lg:order-1 lg:grid-cols-1">
            {heroSensors.filter((_, i) => i % 2 === 0).map((s) => <ValueCard key={s.id} s={s} />)}
          </div>
          <div className="order-1 mx-auto w-full max-w-[520px] lg:order-2">
            <AssetSchematic type={a.type} accent={accent} className="w-full" />
          </div>
          <div className="order-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            {heroSensors.filter((_, i) => i % 2 === 1).map((s) => <ValueCard key={s.id} s={s} />)}
          </div>
          {heroSensors.length === 0 && (
            <p className="order-2 text-center text-sm text-muted lg:col-span-3">No sensors on this asset yet{can('sensor.manage') ? ' — add one below to see live readings here.' : '.'}</p>
          )}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Card title="Specifications">
          <KeyValues items={[
            ['Manufacturer', a.manufacturer], ['Model', a.model], ['Serial number', a.serialNumber], ['Installed on', a.installedOn ? fmtDate(a.installedOn) : null],
            ['Process area', a.areaName ?? 'Unassigned'], ['Map position', a.positionX !== null && a.positionY !== null ? `${a.positionX.toFixed(1)} m, ${a.positionY.toFixed(1)} m` : 'Not placed'],
            ...Object.entries(a.specs).map(([k, v]) => [k, String(v)] as [string, string]),
          ]} />
          {a.positionX === null && canManage && <p className="mt-4 text-xs text-muted">Set a map position (Edit, or “Place asset” on the plant map) to include this asset in inspection rounds.</p>}
        </Card>
        <StatusCard d={d} />
      </div>

      <Card title="Sensors" action={can('sensor.manage') ? <Button size="sm" variant="primary" icon={<Plus size={14} />} onClick={() => setAddSensor(true)}>Add sensor</Button> : undefined}>
        <DataTable rows={d.sensors} rowKey={(s) => s.id} dense onRowClick={(s) => router.push(`/console/telemetry/${s.id}`)}
          empty={<EmptyState title="No sensors" body="Instruments and lab parameters measured on this asset appear here." />}
          columns={[
            { key: 'tag', header: 'Tag', cell: (s) => <Link href={`/console/telemetry/${s.id}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:underline">{s.tag}</Link> },
            { key: 'name', header: 'Measurand', cell: (s) => <span>{MEASURAND_DEFS[s.measurand].label}<span className="block text-xs text-muted">{s.name}</span></span> },
            { key: 'method', header: 'Method', cell: (s) => <span className="text-text-2">{label(s.method)}</span> },
            { key: 'value', header: 'Last value', className: 'num', cell: (s) => s.lastValue !== null ? <span>{fmtValue(s.lastValue, s.measurand)} <span className="text-muted">{s.unit}</span></span> : <span className="text-muted">—</span> },
            { key: 'fresh', header: 'Freshness', cell: (s) => <span className="flex items-center gap-2"><FreshnessBadge freshness={s.freshness} ts={s.lastTs} />{s.lastSource === 'simulator' && <SyntheticBadge />}</span> },
            { key: 'int', header: 'Expected', cell: (s) => <span className="text-text-2">every {interval(s.expectedIntervalS)}</span> },
          ]} />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Alarms" action={<Link className="text-sm text-text-2 hover:text-text" href="/console/alarms">All alarms</Link>}>
          {d.alarms.length ? (
            <ul className="grid gap-2">
              {d.alarms.map((al) => (
                <li key={al.id}>
                  <Link href={`/console/alarms/${al.id}`} className="flex items-center gap-3 rounded-2xl bg-bg-2 px-4 py-3 hover:bg-surface-2">
                    <span className="dot" style={{ background: `var(--color-${al.severity})` }} aria-hidden />
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm">{al.title}</span><span className="text-xs text-muted">{fmtDateTime(al.triggeredAt)} · {ago(al.triggeredAt)}</span></span>
                    {al.synthetic && <SyntheticBadge />}
                    <StateChip state={al.state} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : <EmptyState title="No alarms recorded" body="No alarm has been raised on this asset." />}
        </Card>
        <Card title="Maintenance history" action={<Link className="text-sm text-text-2 hover:text-text" href="/console/maintenance">Maintenance</Link>}>
          {d.maintenance.length ? (
            <ul className="grid gap-2">
              {d.maintenance.map((t) => (
                <li key={t.id}>
                  <Link href={`/console/maintenance/${t.id}`} className="flex items-center gap-3 rounded-2xl bg-bg-2 px-4 py-3 hover:bg-surface-2">
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm">{t.title}</span><span className="text-xs text-muted">{label(t.kind)} · {t.completedAt ? `completed ${fmtDate(t.completedAt)}` : `opened ${ago(t.createdAt)}`}</span></span>
                    <StateChip state={t.priority} /><StateChip state={t.status} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : <EmptyState title="No maintenance yet" body="Work orders and inspection follow-ups for this asset appear here." />}
        </Card>
        <Card title="Inspections" action={<Link className="text-sm text-text-2 hover:text-text" href="/console/inspections">Inspections</Link>}>
          {d.inspections.length ? (
            <ul className="grid gap-2">
              {d.inspections.map((i) => (
                <li key={i.id}>
                  <Link href={`/console/inspections/${i.id}`} className="flex items-center gap-3 rounded-2xl bg-bg-2 px-4 py-3 hover:bg-surface-2">
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm">{i.title}</span><span className="text-xs text-muted">{i.submittedAt ? `submitted ${fmtDateTime(i.submittedAt)}` : i.dueAt ? `due ${fmtDateTime(i.dueAt)}` : 'no due date'}</span></span>
                    <StateChip state={i.status} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : <EmptyState title="No inspections" body="Dispatch a round from the plant map to inspect this asset." />}
        </Card>
        <Card title="Approved documents" action={<Link className="text-sm text-text-2 hover:text-text" href="/console/documents">Library</Link>}>
          {d.documents.length ? (
            <ul className="grid gap-2">
              {d.documents.map((doc) => (
                <li key={doc.id}>
                  <Link href={`/console/documents/${doc.id}`} className="flex items-center gap-3 rounded-2xl bg-bg-2 px-4 py-3 hover:bg-surface-2">
                    <FileText size={16} className="text-muted" aria-hidden />
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm">{doc.title}</span><span className="text-xs text-muted">{DOCUMENT_KIND_LABELS[doc.kind as DocumentKind] ?? label(doc.kind)} · v{doc.version}</span></span>
                    <ArrowUpRight size={15} className="text-muted" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          ) : <EmptyState title="No approved documents" body="SOPs and manuals for this asset or its type appear here once approved." />}
        </Card>
      </div>

      <Attachments d={d} />

      <HistoryCard entityType="asset" entityId={a.id} version={a.updatedAt} />

      <AssetFormDialog open={editing} onOpenChange={setEditing} asset={a} />
      <SensorDialog open={addSensor} onOpenChange={setAddSensor} assetId={a.id} assetTag={a.tag} />
      <ConfirmDialog open={archiving} onOpenChange={setArchiving}
        title={a.archivedAt ? `Restore ${a.tag}?` : `Archive ${a.tag}?`}
        body={a.archivedAt ? 'The asset returns to the registry, the plant map and new work.' : 'The asset is removed from the registry, the plant map and new rounds. Its sensors, alarms, inspections and maintenance history are kept.'}
        confirmLabel={a.archivedAt ? 'Restore asset' : 'Archive asset'} destructive={!a.archivedAt}
        onConfirm={async () => { await patch(`/assets/${a.id}`, { archived: !a.archivedAt }); invalidatePaths(qc, inv); }} />
      <DeleteDialog open={deleting} onOpenChange={setDeleting} tag={a.tag} archived={!!a.archivedAt}
        onDelete={async () => { await del(`/assets/${a.id}`); invalidatePaths(qc, PLANT_PATHS); router.replace('/console/assets'); }}
        onArchive={async () => { await patch(`/assets/${a.id}`, { archived: true }); invalidatePaths(qc, inv); }} />
    </div>
  );
}

function interval(s: number) {
  if (s % 86400 === 0) return `${s / 86400} d`;
  if (s % 3600 === 0) return `${s / 3600} h`;
  if (s % 60 === 0) return `${s / 60} min`;
  return `${s} s`;
}

/** Floating value card: value / unit / time triad + freshness, linking to the sensor trend. */
function ValueCard({ s }: { s: Sensor }) {
  const def = MEASURAND_DEFS[s.measurand];
  const stale = s.freshness === 'stale' || s.freshness === 'no_data';
  return (
    <Link href={`/console/telemetry/${s.id}`} className="panel-glass group block p-4 transition-colors hover:border-[rgb(25_84_241/0.5)]" aria-label={`${def.label} ${s.tag}: ${s.lastValue === null ? 'no data' : `${fmtValue(s.lastValue, s.measurand)} ${s.unit}`}, ${s.freshness}. Open trend.`}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[13px] text-text-2">{def.label} · {s.tag}</span>
        <ArrowUpRight size={15} className="text-muted group-hover:text-lime" aria-hidden />
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className={`t-kpi-sm ${stale ? 'text-muted' : ''}`}>{fmtValue(s.lastValue, s.measurand)}</span>
        <span className="text-sm text-muted">{s.unit}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <FreshnessBadge freshness={s.freshness} ts={s.lastTs} />
        {s.method !== 'continuous' && <span className="chip chip-outline h-6 px-2 text-[11px]">{label(s.method)}</span>}
        {s.lastSource === 'simulator' && <span className="text-[11px] text-lime">synthetic</span>}
      </div>
      <div className="mt-1 text-[11.5px] text-muted">{s.lastTs ? `observed ${fmtDateTime(s.lastTs)}` : 'no measurement received'}</div>
      {def.typicalRange && (
        <div className="mt-3 grid gap-1">
          <RangeBar value={stale ? null : s.lastValue} band={def.typicalRange} ariaLabel={`${stale || s.lastValue === null ? 'No current value' : `${fmtValue(s.lastValue, s.measurand)} ${s.unit}`}; typical ${def.typicalRange[0]} to ${def.typicalRange[1]} ${s.unit}`} />
          <div className="flex justify-between text-[10.5px] text-muted num" aria-hidden><span>typical {def.typicalRange[0]}–{def.typicalRange[1]}</span>{!stale && s.lastValue !== null && (s.lastValue < def.typicalRange[0] || s.lastValue > def.typicalRange[1]) && <span className="text-high-text">outside band</span>}</div>
        </div>
      )}
    </Link>
  );
}

function StatusCard({ d }: { d: AssetDetail }) {
  const a = d.asset;
  const can = useCan();
  const allowed = can('inspection.execute') || can('asset.manage');
  const [status, setStatus] = useState<AssetStatus>(a.status);
  const [notes, setNotes] = useState(a.notes ?? '');
  const dirty = status !== a.status || notes !== (a.notes ?? '');
  // Re-sync when the server value changes (realtime updates) and the user has no pending edits.
  const last = useRef({ status: a.status, notes: a.notes });
  useEffect(() => {
    if (last.current.status !== a.status || last.current.notes !== a.notes) {
      if (!dirty) { setStatus(a.status); setNotes(a.notes ?? ''); }
      last.current = { status: a.status, notes: a.notes };
    }
  }, [a.status, a.notes, dirty]);
  const save = useAction((body: Record<string, unknown>) => patch(`/assets/${a.id}`, body), { invalidate: [...PLANT_PATHS, `/assets/${a.id}`], success: 'Operating status saved' });
  const submit = () => {
    const body: Record<string, unknown> = {};
    if (status !== a.status) body.status = status;
    if (notes !== (a.notes ?? '')) body.notes = notes.trim() || null;
    // The API authorises status/notes-only edits via inspection.execute (field roles). Managers without that
    // permission use the full asset.manage path, so include an unchanged field to route the request there.
    if (!can('inspection.execute') && can('asset.manage')) body.name = a.name;
    save.mutate(body);
  };
  return (
    <Card title="Operating status & notes" tone="paper">
      {allowed ? (
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (dirty) submit(); }}>
          <div className="field">
            <label htmlFor="op-status" className="!text-ink-2">Recorded status</label>
            <Select id="op-status" value={status} onChange={(e) => setStatus(e.target.value as AssetStatus)} options={assetStatusOptions} className="!border-ink/20 !bg-paper !text-ink" />
          </div>
          <div className="field">
            <label htmlFor="op-notes" className="!text-ink-2">Operator notes</label>
            <Textarea id="op-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} placeholder="Shift observations, temporary workarounds, isolation status…" className="!border-ink/20 !bg-paper !text-ink" />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-ink-2">Last updated {ago(a.updatedAt)}</span>
            <button type="submit" className="btn btn-sm bg-ink text-paper hover:opacity-90 disabled:opacity-40" disabled={!dirty || save.isPending} aria-busy={save.isPending || undefined}>
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      ) : (
        <div className="grid gap-3">
          <div className="text-[15px]">{ASSET_STATUS_LABELS[a.status]}</div>
          <p className="whitespace-pre-wrap text-sm text-ink-2">{a.notes || 'No operator notes.'}</p>
        </div>
      )}
    </Card>
  );
}

function Attachments({ d }: { d: AssetDetail }) {
  const a = d.asset;
  const can = useCan();
  const qc = useQueryClient();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    let ok = 0;
    for (const f of Array.from(files)) {
      if (f.size > 20 * 1024 * 1024) { toast({ title: `${f.name} is too large`, body: 'Maximum 20 MB per file.', tone: 'critical' }); continue; }
      try {
        await uploadAttachment('asset', a.id, f);
        ok++;
      } catch (e) {
        toast({ title: `Upload failed: ${f.name}`, body: errorMessage(e), tone: 'critical' });
      }
    }
    setBusy(false);
    if (input.current) input.current.value = '';
    if (ok) {
      toast({ title: `${ok} file${ok > 1 ? 's' : ''} uploaded`, tone: 'ok' });
      invalidatePaths(qc, [`/assets/${a.id}`]);
    }
  };
  const open = async (id: string) => {
    setOpening(id);
    try { await openAttachment(id); } catch (e) { toast({ title: 'Could not open file', body: errorMessage(e), tone: 'critical' }); } finally { setOpening(null); }
  };
  return (
    <Card title="Attachments" action={can('asset.manage') ? (
      <>
        <input ref={input} type="file" multiple className="sr-only" id="asset-file" accept="image/jpeg,image/png,image/webp,application/pdf,text/plain" onChange={(e) => void onFiles(e.target.files)} />
        <Button size="sm" icon={<Upload size={14} />} busy={busy} onClick={() => input.current?.click()}>Upload</Button>
      </>
    ) : undefined}>
      {d.attachments.length ? (
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {d.attachments.map((f) => (
            <li key={f.id}>
              <button type="button" onClick={() => void open(f.id)} className="flex w-full items-center gap-3 rounded-2xl bg-bg-2 px-4 py-3 text-left hover:bg-surface-2" aria-busy={opening === f.id || undefined}>
                <Paperclip size={16} className="flex-none text-muted" aria-hidden />
                <span className="min-w-0 flex-1"><span className="block truncate text-sm">{f.filename}</span><span className="text-xs text-muted">{fmtBytes(f.sizeBytes)} · {fmtDate(f.createdAt)}</span></span>
                <ArrowUpRight size={15} className="text-muted" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : <EmptyState title="No attachments" body={can('asset.manage') ? 'Upload nameplate photos, datasheets or drawings (JPEG, PNG, WebP, PDF or text).' : 'No files attached to this asset.'} />}
    </Card>
  );
}

function DeleteDialog({ open, onOpenChange, tag, archived, onDelete, onArchive }: {
  open: boolean; onOpenChange: (v: boolean) => void; tag: string; archived: boolean; onDelete: () => Promise<void>; onArchive: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ msg: string; inUse: boolean } | null>(null);
  const toast = useToast();
  useEffect(() => { if (open) setErr(null); }, [open]);
  const run = async (fn: () => Promise<void>, done: string) => {
    setBusy(true);
    try {
      await fn();
      toast({ title: done, tone: 'ok' });
      onOpenChange(false);
    } catch (e) {
      setErr({ msg: errorMessage(e), inUse: isApiError(e, 'in_use') });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }} title={`Delete ${tag}?`}
      description="Deleting is permanent and only possible for assets with no sensors, alarms, inspections or maintenance records. Archive keeps history."
      footer={<>
        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
        {err?.inUse && !archived ? <Button variant="primary" busy={busy} icon={<Archive size={15} />} onClick={() => void run(onArchive, 'Asset archived')}>Archive instead</Button>
          : <Button variant="danger-solid" busy={busy} disabled={!!err?.inUse} onClick={() => void run(onDelete, 'Asset deleted')}>Delete permanently</Button>}
      </>}>
      {err && (
        <p role="alert" className={err.inUse ? 'rounded-2xl border border-[rgb(245_184_61/0.35)] bg-[rgb(245_184_61/0.08)] p-4 text-sm' : 'field-error'}>
          {err.msg}{err.inUse && !archived ? ' Archiving removes it from the registry and map while keeping its history.' : ''}
        </p>
      )}
    </Dialog>
  );
}
