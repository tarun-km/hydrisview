'use client';

import { useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { AlertTriangle, Check, Copy, KeyRound, Minus, Plus } from 'lucide-react';
import { MEASURANDS, MEASURAND_DEFS, type AssetType, type Criticality, type FacilityKind, type Measurand, type ProcessAreaKind } from '@hydris/domain';
import { api, errorMessage, patch, post } from '@/lib/api';
import { useAction, useApi } from '@/lib/query';
import { Button, Input, Select, Textarea } from '@/ui';
import { Dialog } from '@/ui/overlay';
import type { AssetSummary, Facility, ProcessArea, Site } from './types';
import { areaKindOptions, assetTypeOptions, criticalityOptions, facilityKindOptions, numOrNull, txtOrNull } from './util';

const CODE_RE = /^[A-Za-z0-9._-]{1,24}$/;
const CODE_HINT = 'Letters, digits, dot, dash or underscore (max 24).';
export const PLANT_PATHS = ['/sites', '/assets', '/hierarchy', '/overview', '/sensors'];

/** Dialog whose body is a <form>; the footer submit button is linked by form id so Enter submits. */
function FormDialog({ open, onOpenChange, title, description, submitLabel, busy, error, onSubmit, children, wide, extraFooter }: {
  open: boolean; onOpenChange: (v: boolean) => void; title: string; description?: ReactNode; submitLabel: string; busy: boolean; error: string | null;
  onSubmit: () => void; children: ReactNode; wide?: boolean; extraFooter?: ReactNode;
}) {
  const formId = useId();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }} title={title} description={description} wide={wide}
      footer={<>
        {extraFooter}
        <Button variant="ghost" type="button" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
        <Button variant="primary" type="submit" form={formId} busy={busy}>{submitLabel}</Button>
      </>}>
      <form id={formId} onSubmit={submit} noValidate className="grid gap-4">
        {children}
        {error && <p role="alert" className="field-error">{error}</p>}
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------- Site
export function SiteFormDialog({ open, onOpenChange, site, onSaved }: { open: boolean; onOpenChange: (v: boolean) => void; site?: Site; onSaved?: (s: Site) => void }) {
  const init = () => ({
    name: site?.name ?? '', code: site?.code ?? '', address: site?.address ?? '', city: site?.city ?? '', country: site?.country ?? '',
    lat: site?.lat?.toString() ?? '', lng: site?.lng?.toString() ?? '', timezone: site?.timezone ?? (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC'),
    w: String(site?.layoutWidthM ?? 100), h: String(site?.layoutHeightM ?? 80),
  });
  const [f, setF] = useState(init);
  const [errs, setErrs] = useState<Record<string, string>>({});
  useEffect(() => { if (open) { setF(init()); setErrs({}); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  const save = useAction(
    (body: Record<string, unknown>) => (site ? patch<{ site: Site }>(`/sites/${site.id}`, body) : post<{ site: Site }>('/sites', body)),
    { invalidate: PLANT_PATHS, success: site ? 'Site updated' : 'Site created', onSuccess: (r) => { onOpenChange(false); onSaved?.(r.site); } },
  );

  const submit = () => {
    const e: Record<string, string> = {};
    if (f.name.trim().length < 2) e.name = 'Enter at least 2 characters';
    if (!CODE_RE.test(f.code.trim())) e.code = CODE_HINT;
    const lat = numOrNull(f.lat), lng = numOrNull(f.lng), w = Number(f.w), h = Number(f.h);
    if (lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) e.lat = 'Between -90 and 90';
    if (lng !== null && (!Number.isFinite(lng) || lng < -180 || lng > 180)) e.lng = 'Between -180 and 180';
    if (!Number.isFinite(w) || w < 10 || w > 5000) e.w = '10 to 5000 m';
    if (!Number.isFinite(h) || h < 10 || h > 5000) e.h = '10 to 5000 m';
    setErrs(e);
    if (Object.keys(e).length) return;
    save.mutate({
      name: f.name.trim(), code: f.code.trim(), address: txtOrNull(f.address), city: txtOrNull(f.city), country: txtOrNull(f.country),
      lat, lng, timezone: f.timezone.trim() || 'UTC', layoutWidthM: w, layoutHeightM: h,
    });
  };

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={site ? 'Edit site details' : 'New site'} wide submitLabel={site ? 'Save changes' : 'Create site'}
      description={site ? undefined : 'A site is a physical plant location. Facilities, process areas and assets are added inside it.'}
      busy={save.isPending} error={save.error ? errorMessage(save.error) : null} onSubmit={submit}>
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
        <Input label="Site name" value={f.name} onChange={set('name')} error={errs.name} required autoFocus maxLength={120} />
        <Input label="Code" value={f.code} onChange={set('code')} error={errs.code} hint={CODE_HINT} required maxLength={24} />
      </div>
      <Input label="Address" value={f.address} onChange={set('address')} maxLength={200} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="City" value={f.city} onChange={set('city')} maxLength={80} />
        <Input label="Country" value={f.country} onChange={set('country')} maxLength={80} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Input label="Latitude" inputMode="decimal" value={f.lat} onChange={set('lat')} error={errs.lat} placeholder="13.0827" />
        <Input label="Longitude" inputMode="decimal" value={f.lng} onChange={set('lng')} error={errs.lng} placeholder="80.2707" />
        <Input label="Timezone" value={f.timezone} onChange={set('timezone')} hint="IANA name, e.g. Asia/Kolkata" maxLength={60} />
      </div>
      <fieldset className="grid gap-3 rounded-[var(--radius-lg)] border border-line p-4">
        <legend className="px-1 text-[13px] text-text-2">Plant layout canvas</legend>
        <p className="text-xs text-muted">Size of the site plan used by the plant map and route planner. Asset positions and process-area outlines are given in metres from the top-left corner.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Width (m)" inputMode="decimal" value={f.w} onChange={set('w')} error={errs.w} />
          <Input label="Height (m)" inputMode="decimal" value={f.h} onChange={set('h')} error={errs.h} />
        </div>
      </fieldset>
    </FormDialog>
  );
}

// ---------------------------------------------------------------- Facility
export function FacilityDialog({ open, onOpenChange, siteId, facility }: { open: boolean; onOpenChange: (v: boolean) => void; siteId: string; facility?: Facility }) {
  const init = () => ({ name: facility?.name ?? '', code: facility?.code ?? '', kind: (facility?.kind ?? 'etp') as FacilityKind, cap: facility?.capacityM3PerDay?.toString() ?? '', description: facility?.description ?? '' });
  const [f, setF] = useState(init);
  const [errs, setErrs] = useState<Record<string, string>>({});
  useEffect(() => { if (open) { setF(init()); setErrs({}); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useAction(
    (body: Record<string, unknown>) => (facility ? patch(`/facilities/${facility.id}`, body) : post('/facilities', { ...body, siteId })),
    { invalidate: PLANT_PATHS, success: facility ? 'Facility updated' : 'Facility added', onSuccess: () => onOpenChange(false) },
  );
  const submit = () => {
    const e: Record<string, string> = {};
    if (f.name.trim().length < 2) e.name = 'Enter at least 2 characters';
    if (!CODE_RE.test(f.code.trim())) e.code = CODE_HINT;
    const cap = numOrNull(f.cap);
    if (cap !== null && (!Number.isFinite(cap) || cap <= 0)) e.cap = 'Positive number';
    setErrs(e);
    if (Object.keys(e).length) return;
    save.mutate({ name: f.name.trim(), code: f.code.trim(), kind: f.kind, capacityM3PerDay: cap, description: txtOrNull(f.description) });
  };
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={facility ? 'Edit facility' : 'Add facility'} submitLabel={facility ? 'Save changes' : 'Add facility'}
      busy={save.isPending} error={save.error ? errorMessage(save.error) : null} onSubmit={submit}>
      <Input label="Facility name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} error={errs.name} autoFocus maxLength={120} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Code" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} error={errs.code} hint={CODE_HINT} maxLength={24} />
        <Select label="Kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as FacilityKind })} options={facilityKindOptions} />
      </div>
      <Input label="Design capacity (m³/day)" inputMode="decimal" value={f.cap} onChange={(e) => setF({ ...f, cap: e.target.value })} error={errs.cap} />
      <Textarea label="Description" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={500} />
    </FormDialog>
  );
}

// ---------------------------------------------------------------- Process area
export function parsePolygon(s: string): [number, number][] | null | 'invalid' {
  const t = s.trim();
  if (!t) return null;
  const pts = t.split(/[;\n]+/).map((p) => p.trim()).filter(Boolean).map((p) => p.split(/[\s,]+/).map(Number));
  if (pts.length < 3 || pts.length > 64 || pts.some((p) => p.length !== 2 || p.some((n) => !Number.isFinite(n)))) return 'invalid';
  return pts as [number, number][];
}
export const polygonText = (p: [number, number][] | null | undefined) => (p ? p.map(([x, y]) => `${x}, ${y}`).join('; ') : '');

export function ProcessAreaDialog({ open, onOpenChange, facilities, facilityId, area, layout }: {
  open: boolean; onOpenChange: (v: boolean) => void; facilities: Facility[]; facilityId?: string; area?: ProcessArea; layout?: { w: number; h: number };
}) {
  const init = () => ({
    facilityId: area?.facilityId ?? facilityId ?? facilities[0]?.id ?? '', name: area?.name ?? '', code: area?.code ?? '', kind: (area?.kind ?? 'aeration') as ProcessAreaKind,
    sortOrder: String(area?.sortOrder ?? 0), polygon: polygonText(area?.polygon),
  });
  const [f, setF] = useState(init);
  const [errs, setErrs] = useState<Record<string, string>>({});
  useEffect(() => { if (open) { setF(init()); setErrs({}); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useAction(
    (body: Record<string, unknown>) => (area ? patch(`/process-areas/${area.id}`, body) : post('/process-areas', body)),
    { invalidate: PLANT_PATHS, success: area ? 'Process area updated' : 'Process area added', onSuccess: () => onOpenChange(false) },
  );
  const submit = () => {
    const e: Record<string, string> = {};
    if (!area && !f.facilityId) e.facilityId = 'Choose a facility';
    if (f.name.trim().length < 2) e.name = 'Enter at least 2 characters';
    if (!CODE_RE.test(f.code.trim())) e.code = CODE_HINT;
    const so = Number(f.sortOrder);
    if (!Number.isInteger(so)) e.sortOrder = 'Whole number';
    const poly = parsePolygon(f.polygon);
    if (poly === 'invalid') e.polygon = 'Enter 3 to 64 points as "x, y; x, y; …" in metres';
    else if (poly && layout && poly.some(([x, y]) => x < 0 || y < 0 || x > layout.w || y > layout.h)) e.polygon = `Points must lie within the ${layout.w} × ${layout.h} m layout`;
    setErrs(e);
    if (Object.keys(e).length) return;
    const body: Record<string, unknown> = { name: f.name.trim(), code: f.code.trim(), kind: f.kind, sortOrder: so, polygon: poly === 'invalid' ? null : poly };
    if (!area) body.facilityId = f.facilityId;
    save.mutate(body);
  };
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={area ? 'Edit process area' : 'Add process area'} submitLabel={area ? 'Save changes' : 'Add process area'} wide
      busy={save.isPending} error={save.error ? errorMessage(save.error) : null} onSubmit={submit}>
      {!area && (
        <Select label="Facility" value={f.facilityId} onChange={(e) => setF({ ...f, facilityId: e.target.value })} error={errs.facilityId}
          options={facilities.map((x) => ({ value: x.id, label: `${x.code} · ${x.name}` }))} placeholder={facilities.length ? undefined : 'No facilities yet'} />
      )}
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
        <Input label="Area name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} error={errs.name} autoFocus maxLength={120} />
        <Input label="Code" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} error={errs.code} maxLength={24} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Select label="Process stage" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as ProcessAreaKind })} options={areaKindOptions} />
        <Input label="Sort order" inputMode="numeric" value={f.sortOrder} onChange={(e) => setF({ ...f, sortOrder: e.target.value })} error={errs.sortOrder} hint="Position along the treatment train" />
      </div>
      <Textarea label="Outline on the plant map (optional)" value={f.polygon} onChange={(e) => setF({ ...f, polygon: e.target.value })} error={errs.polygon}
        placeholder="6, 10; 44, 10; 44, 40; 6, 40" className="font-mono text-[13px]"
        hint={`Corner points in metres from the layout's top-left corner${layout ? ` (layout is ${layout.w} × ${layout.h} m)` : ''}. Shown as a zone on the plant map.`} />
    </FormDialog>
  );
}

// ---------------------------------------------------------------- Asset
interface Hierarchy {
  sites: { id: string; name: string; code: string; facilities: { id: string; name: string; code: string; processAreas: { id: string; name: string; code: string }[] }[] }[];
}

export function SpecsEditor({ rows, onChange }: { rows: { k: string; v: string }[]; onChange: (r: { k: string; v: string }[]) => void }) {
  return (
    <fieldset className="grid gap-2">
      <legend className="field-label mb-2">Specifications</legend>
      {rows.length === 0 && <p className="text-xs text-muted">No specifications yet. Add nameplate data such as rated flow, motor power or limits.</p>}
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[1fr_1.4fr_auto] items-center gap-2">
          <input className="input" aria-label={`Specification ${i + 1} name`} placeholder="Rated flow" value={r.k} maxLength={60}
            onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)))} />
          <input className="input" aria-label={`Specification ${i + 1} value`} placeholder="140 m³/h" value={r.v} maxLength={200}
            onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)))} />
          <button type="button" className="icon-btn icon-btn-sm" aria-label={`Remove specification ${r.k || i + 1}`} onClick={() => onChange(rows.filter((_, j) => j !== i))}><Minus size={15} /></button>
        </div>
      ))}
      <div><Button type="button" size="sm" variant="ghost" icon={<Plus size={14} />} onClick={() => onChange([...rows, { k: '', v: '' }])} disabled={rows.length >= 40}>Add specification</Button></div>
    </fieldset>
  );
}

export function AssetFormDialog({ open, onOpenChange, asset, prefill, onSaved, layout }: {
  open: boolean; onOpenChange: (v: boolean) => void; asset?: AssetSummary;
  prefill?: { siteId?: string; facilityId?: string; processAreaId?: string | null }; onSaved?: (a: { id: string }) => void; layout?: { w: number; h: number };
}) {
  const h = useApi<Hierarchy>(open ? '/hierarchy' : null);
  const init = () => ({
    siteId: asset?.siteId ?? prefill?.siteId ?? '', facilityId: asset?.facilityId ?? prefill?.facilityId ?? '', processAreaId: asset?.processAreaId ?? prefill?.processAreaId ?? '',
    tag: asset?.tag ?? '', name: asset?.name ?? '', type: (asset?.type ?? 'pump') as AssetType, manufacturer: asset?.manufacturer ?? '', model: asset?.model ?? '',
    serialNumber: asset?.serialNumber ?? '', installedOn: asset?.installedOn ?? '', criticality: (asset?.criticality ?? 'medium') as Criticality,
    x: asset?.positionX?.toString() ?? '', y: asset?.positionY?.toString() ?? '',
    specs: Object.entries(asset?.specs ?? {}).map(([k, v]) => ({ k, v: String(v) })),
  });
  const [f, setF] = useState(init);
  const [errs, setErrs] = useState<Record<string, string>>({});
  useEffect(() => { if (open) { setF(init()); setErrs({}); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const sites = h.data?.sites ?? [];
  const facilityOptions = useMemo(() => sites.flatMap((s) => s.facilities.map((x) => ({ value: x.id, label: `${s.name} · ${x.code} ${x.name}`, siteId: s.id }))), [sites]);
  // Keep the site id in sync with the chosen facility (it decides the layout bounds).
  const fac = sites.flatMap((s) => s.facilities).find((x) => x.id === f.facilityId);
  const areaOptions = (fac?.processAreas ?? []).map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }));

  const save = useAction(
    (body: Record<string, unknown>) => (asset ? patch<{ asset: { id: string } }>(`/assets/${asset.id}`, body) : post<{ asset: { id: string } }>('/assets', body)),
    { invalidate: PLANT_PATHS, success: asset ? 'Asset updated' : 'Asset registered', onSuccess: (r) => { onOpenChange(false); onSaved?.(r.asset); } },
  );

  const submit = () => {
    const e: Record<string, string> = {};
    if (!asset && !f.facilityId) e.facilityId = 'Choose the facility the asset belongs to';
    if (!CODE_RE.test(f.tag.trim())) e.tag = CODE_HINT;
    if (f.name.trim().length < 2) e.name = 'Enter at least 2 characters';
    const x = numOrNull(f.x), y = numOrNull(f.y);
    if ((x === null) !== (y === null)) e.x = 'Enter both X and Y, or neither';
    if (x !== null && (!Number.isFinite(x) || x < 0 || (layout && x > layout.w))) e.x = layout ? `0 to ${layout.w} m` : 'Zero or more';
    if (y !== null && (!Number.isFinite(y) || y < 0 || (layout && y > layout.h))) e.y = layout ? `0 to ${layout.h} m` : 'Zero or more';
    if (f.installedOn && !/^\d{4}-\d{2}-\d{2}$/.test(f.installedOn)) e.installedOn = 'Use a date';
    const keys = f.specs.filter((s) => s.k.trim() || s.v.trim());
    if (keys.some((s) => !s.k.trim())) e.specs = 'Every specification needs a name';
    else if (new Set(keys.map((s) => s.k.trim())).size !== keys.length) e.specs = 'Specification names must be unique';
    setErrs(e);
    if (Object.keys(e).length) return;
    const body: Record<string, unknown> = {
      processAreaId: f.processAreaId || null, tag: f.tag.trim(), name: f.name.trim(), type: f.type, manufacturer: txtOrNull(f.manufacturer), model: txtOrNull(f.model),
      serialNumber: txtOrNull(f.serialNumber), installedOn: txtOrNull(f.installedOn), criticality: f.criticality, positionX: x, positionY: y,
      specs: Object.fromEntries(keys.map((s) => [s.k.trim(), s.v.trim()])),
    };
    if (!asset) body.facilityId = f.facilityId;
    save.mutate(body);
  };

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={asset ? `Edit ${asset.tag}` : 'Register asset'} wide submitLabel={asset ? 'Save changes' : 'Register asset'}
      description={asset ? undefined : 'Add a piece of equipment to the plant hierarchy. Sensors, inspections and maintenance attach to it.'}
      busy={save.isPending} error={save.error ? errorMessage(save.error) : h.isError ? errorMessage(h.error) : null} onSubmit={submit}>
      {!asset ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Facility" value={f.facilityId} error={errs.facilityId} disabled={h.isLoading}
            onChange={(e) => setF({ ...f, facilityId: e.target.value, processAreaId: '', siteId: facilityOptions.find((o) => o.value === e.target.value)?.siteId ?? '' })}
            options={facilityOptions} placeholder={h.isLoading ? 'Loading…' : facilityOptions.length ? 'Choose facility' : 'No facilities — add one on a site first'} />
          <Select label="Process area" value={f.processAreaId ?? ''} onChange={(e) => setF({ ...f, processAreaId: e.target.value })} options={areaOptions}
            placeholder={f.facilityId ? 'Unassigned' : 'Choose a facility first'} disabled={!f.facilityId} />
        </div>
      ) : (
        <Select label="Process area" value={f.processAreaId ?? ''} onChange={(e) => setF({ ...f, processAreaId: e.target.value })} options={areaOptions} placeholder="Unassigned"
          hint={`Facility: ${asset.facilityName}. To move an asset to another facility, register it again there.`} disabled={h.isLoading} />
      )}
      <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
        <Input label="Tag" value={f.tag} onChange={(e) => setF({ ...f, tag: e.target.value })} error={errs.tag} placeholder="P-101" maxLength={24} autoFocus={!asset} />
        <Input label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} error={errs.name} placeholder="Equalization transfer pump" maxLength={120} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Select label="Type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as AssetType })} options={assetTypeOptions} />
        <Select label="Criticality" value={f.criticality} onChange={(e) => setF({ ...f, criticality: e.target.value as Criticality })} options={criticalityOptions} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Input label="Manufacturer" value={f.manufacturer} onChange={(e) => setF({ ...f, manufacturer: e.target.value })} maxLength={80} />
        <Input label="Model" value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} maxLength={80} />
        <Input label="Serial number" value={f.serialNumber} onChange={(e) => setF({ ...f, serialNumber: e.target.value })} maxLength={80} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Input label="Installed on" type="date" value={f.installedOn} onChange={(e) => setF({ ...f, installedOn: e.target.value })} error={errs.installedOn} />
        <Input label="Map position X (m)" inputMode="decimal" value={f.x} onChange={(e) => setF({ ...f, x: e.target.value })} error={errs.x} hint="From the layout's left edge" />
        <Input label="Map position Y (m)" inputMode="decimal" value={f.y} onChange={(e) => setF({ ...f, y: e.target.value })} error={errs.y} hint="From the layout's top edge" />
      </div>
      <SpecsEditor rows={f.specs} onChange={(specs) => setF({ ...f, specs })} />
      {errs.specs && <p className="field-error" role="alert">{errs.specs}</p>}
    </FormDialog>
  );
}

// ---------------------------------------------------------------- Sensor
const INTERVAL_UNITS = [{ value: '1', label: 'seconds' }, { value: '60', label: 'minutes' }, { value: '3600', label: 'hours' }, { value: '86400', label: 'days' }];

export function SensorDialog({ open, onOpenChange, assetId, assetTag }: { open: boolean; onOpenChange: (v: boolean) => void; assetId: string; assetTag: string }) {
  const init = () => ({ tag: '', name: '', measurand: 'ph' as Measurand, method: 'continuous' as 'continuous' | 'lab' | 'manual', every: '1', unit: '60', sourceRef: '' });
  const [f, setF] = useState(init);
  const [errs, setErrs] = useState<Record<string, string>>({});
  useEffect(() => { if (open) { setF(init()); setErrs({}); } }, [open]);
  const def = MEASURAND_DEFS[f.measurand];
  const save = useAction((body: Record<string, unknown>) => post('/sensors', body), { invalidate: [...PLANT_PATHS, '/telemetry'], success: 'Sensor added', onSuccess: () => onOpenChange(false) });
  const onMeasurand = (m: Measurand) => {
    const d = MEASURAND_DEFS[m];
    setF((x) => ({ ...x, measurand: m, method: d.defaultMethod, every: '1', unit: d.defaultMethod === 'continuous' ? '60' : '86400', name: x.name || `${d.label} ${assetTag}` }));
  };
  const submit = () => {
    const e: Record<string, string> = {};
    if (!CODE_RE.test(f.tag.trim())) e.tag = CODE_HINT;
    if (f.name.trim().length < 2) e.name = 'Enter at least 2 characters';
    const secs = Math.round(Number(f.every) * Number(f.unit));
    if (!Number.isFinite(secs) || secs < 1 || secs > 30 * 86400) e.every = 'Between 1 second and 30 days';
    setErrs(e);
    if (Object.keys(e).length) return;
    save.mutate({ assetId, tag: f.tag.trim(), name: f.name.trim(), measurand: f.measurand, method: f.method, expectedIntervalS: secs, sourceRef: txtOrNull(f.sourceRef) });
  };
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={`Add sensor to ${assetTag}`} submitLabel="Add sensor" wide
      description="Readings are stored in the measurand's canonical unit. Freshness is judged against the expected reporting interval."
      busy={save.isPending} error={save.error ? errorMessage(save.error) : null} onSubmit={submit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Select label="Measurand" value={f.measurand} onChange={(e) => onMeasurand(e.target.value as Measurand)}
          options={MEASURANDS.map((m) => ({ value: m, label: `${MEASURAND_DEFS[m].label} (${MEASURAND_DEFS[m].unit})` }))} hint={def.explanation.split('.')[0] + '.'} />
        <Select label="Method" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as typeof f.method })}
          options={[{ value: 'continuous', label: 'Continuous (online instrument)' }, { value: 'lab', label: 'Laboratory' }, { value: 'manual', label: 'Manual reading' }]}
          hint={f.method !== 'continuous' ? 'Never presented as a live stream.' : undefined} />
      </div>
      <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
        <Input label="Tag" value={f.tag} onChange={(e) => setF({ ...f, tag: e.target.value })} error={errs.tag} placeholder="PH-101" maxLength={24} autoFocus />
        <Input label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} error={errs.name} maxLength={120} />
      </div>
      <div className="grid gap-4 sm:grid-cols-[1fr_1fr_2fr]">
        <Input label="Expected every" inputMode="decimal" value={f.every} onChange={(e) => setF({ ...f, every: e.target.value })} error={errs.every} />
        <Select label="Unit" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} options={INTERVAL_UNITS} />
        <Input label="Source reference" value={f.sourceRef} onChange={(e) => setF({ ...f, sourceRef: e.target.value })} placeholder="ETP01.PH-101" hint="Tag or address on the gateway / PLC" maxLength={120} />
      </div>
    </FormDialog>
  );
}

// ---------------------------------------------------------------- Gateway
export function GatewayDialog({ open, onOpenChange, siteId }: { open: boolean; onOpenChange: (v: boolean) => void; siteId: string }) {
  const [name, setName] = useState('');
  const [protocol, setProtocol] = useState<'https' | 'mqtt' | 'opcua'>('https');
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ name: string; apiKey: string } | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (open) { setName(''); setProtocol('https'); setErr(null); setResult(null); setCopied(false); } }, [open]);
  const save = useAction((b: { name: string; protocol: string }) => post<{ gateway: { id: string; name: string }; apiKey: string }>('/gateways', { ...b, siteId }), {
    invalidate: ['/sites'], onSuccess: (r) => setResult({ name: r.gateway.name, apiKey: r.apiKey }),
  });
  const copy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.apiKey);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  if (result) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange} title={`Gateway "${result.name}" created`}
        footer={<Button variant="primary" onClick={() => onOpenChange(false)}>I have stored the key</Button>}>
        <div className="grid gap-4">
          <div role="alert" className="flex gap-3 rounded-[var(--radius-lg)] border border-[rgb(242_100_20/0.4)] bg-[rgb(242_100_20/0.08)] p-4 text-sm">
            <AlertTriangle size={18} className="mt-0.5 flex-none text-high" aria-hidden />
            <div>
              <div className="font-medium">Copy this API key now. It will not be shown again.</div>
              <div className="mt-1 text-text-2">Hydris stores only a hash. Configure it on the edge gateway as a bearer token. If it is lost, revoke this gateway and create a new one.</div>
            </div>
          </div>
          <div className="field">
            <span className="field-label">Gateway API key</span>
            <div className="flex items-stretch gap-2">
              <code className="min-w-0 flex-1 select-all break-all rounded-[var(--radius-md)] border border-line-2 bg-bg-2 px-4 py-3 font-mono text-[13px] text-lime">{result.apiKey}</code>
              <Button variant="secondary" onClick={copy} icon={copied ? <Check size={15} /> : <Copy size={15} />} aria-label="Copy API key to clipboard">{copied ? 'Copied' : 'Copy'}</Button>
            </div>
            <span className="sr-only" aria-live="polite">{copied ? 'API key copied to clipboard' : ''}</span>
          </div>
        </div>
      </Dialog>
    );
  }
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="New gateway" submitLabel="Create gateway"
      description="A gateway is an edge device that pushes plant telemetry into Hydris with its own API key."
      busy={save.isPending} error={err ?? (save.error ? errorMessage(save.error) : null)}
      onSubmit={() => {
        if (name.trim().length < 2) return setErr('Enter a name of at least 2 characters');
        setErr(null);
        save.mutate({ name: name.trim(), protocol });
      }}>
      <Input label="Gateway name" value={name} onChange={(e) => setName(e.target.value)} placeholder="ETP edge PLC bridge" maxLength={80} autoFocus />
      <Select label="Protocol" value={protocol} onChange={(e) => setProtocol(e.target.value as typeof protocol)}
        options={[{ value: 'https', label: 'HTTPS push' }, { value: 'mqtt', label: 'MQTT' }, { value: 'opcua', label: 'OPC UA bridge' }]} />
      <p className="flex items-center gap-2 text-xs text-muted"><KeyRound size={14} aria-hidden /> The API key is displayed once after creation.</p>
    </FormDialog>
  );
}

/** Upload one file as multipart to /attachments (fetch sets the boundary). */
export function uploadAttachment(ownerType: 'asset', ownerId: string, file: File) {
  const fd = new FormData();
  fd.append('ownerType', ownerType);
  fd.append('ownerId', ownerId);
  fd.append('file', file);
  return api<{ attachment: { id: string } }>('/attachments', { method: 'POST', body: fd });
}
