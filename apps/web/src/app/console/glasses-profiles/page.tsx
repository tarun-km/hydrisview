'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, History, Plus, RotateCcw, Save, Search, Send, Trash2, Undo2 } from 'lucide-react';
import {
  ASSET_TYPES, ASSET_TYPE_LABELS, DEFAULT_UI_PROFILE_CONFIG, MEASURANDS, MEASURAND_DEFS, ROLES, ROLE_LABELS, UI_ACTIONS, UI_ACTION_LABELS, UI_REQUIRED_SCREENS,
  UI_SCREEN_LABELS, UI_WIDGET_LABELS, diffUiProfileConfigs, normalizeUiProfileConfig, type Measurand, type Role, type UiProfileConfig,
} from '@hydris/domain';
import { del, errorMessage, patch, post, put } from '@/lib/api';
import { invalidatePaths, useApi } from '@/lib/query';
import { useSession } from '@/lib/session';
import { fmtDateTime } from '@/lib/format';
import { Button, Capsule, Card, Chip, EmptyState, Input, PageHeader, QueryView, Select, Switch, Textarea, cx } from '@/ui';
import { ConfirmDialog, Dialog, useToast } from '@/ui/overlay';
import { NoAccess, type DeviceRow, type MembersResponse } from '@/console/admin/parts';

interface ProfileRow { id: string; name: string; description: string | null; published: { version: number; publishedAt: string | null } | null; hasDraft: boolean; assignments: number; updatedAt: string }
interface ListResp { profiles: ProfileRow[]; canEdit: boolean }
interface Version { id: string; version: number; status: 'draft' | 'published' | 'superseded'; notes: string | null; config: UiProfileConfig; publishedAt: string | null; publishedByName: string | null; createdAt: string; changes: string[]; comparedTo: number | null }
interface Detail { profile: ProfileRow; versions: Version[]; draft: Version | null; published: Version | null; canEdit: boolean }
interface Assignment { id: string; profileId: string; profileName: string; scope: 'org' | 'role' | 'user' | 'device'; role: Role | null; userId: string | null; deviceId: string | null; userName: string | null; deviceName: string | null; createdAt: string }
interface Effective { subject: { deviceId: string | null; userId: string | null; role: Role | null }; effective: { profileId: string | null; name: string; version: number | null; source: string } }

export default function Page() {
  return <Suspense><GlassesProfiles /></Suspense>;
}

function GlassesProfiles() {
  const s = useSession();
  const canRead = s.role === 'org_admin' || s.role === 'factory_manager';
  const sp = useSearchParams();
  const [tab, setTab] = useState<'profiles' | 'assignments'>(sp.get('tab') === 'assignments' ? 'assignments' : 'profiles');
  const list = useApi<ListResp>(canRead ? '/ui-profiles' : null);
  const [selected, setSelected] = useState<string | null>(sp.get('profile'));
  const [creating, setCreating] = useState(false);
  useEffect(() => { if (!selected && list.data?.profiles[0]) setSelected(list.data.profiles[0].id); }, [list.data, selected]);
  if (!canRead) return <NoAccess what="glasses UI profiles" />;
  const canEdit = !!list.data?.canEdit;
  return (
    <>
      <PageHeader eyebrow="Field glasses" title="Glasses UI profiles"
        subtitle="Control which screens, widgets, measurements and actions each pair of glasses gets. The server enforces the same rules the glasses display."
        actions={canEdit ? <Button variant="primary" icon={<Plus size={16} />} onClick={() => setCreating(true)}>New profile</Button> : undefined}>
        <div className="mt-4"><Capsule label="Section" value={tab} onChange={setTab} options={[{ value: 'profiles', label: 'Profiles' }, { value: 'assignments', label: 'Assignments & precedence' }]} /></div>
      </PageHeader>
      {!canEdit && list.data && <p role="status" className="mb-4 text-sm text-text-2">Read-only: only organization administrators can edit, publish or assign profiles.</p>}
      {tab === 'profiles' ? (
        <QueryView q={list}>
          {(d) => d.profiles.length === 0 ? (
            <EmptyState title="No UI profiles yet" body="All glasses use the built-in default (every screen and action). Create a profile to restrict or reorder what operators see."
              action={canEdit ? <Button variant="primary" icon={<Plus size={16} />} onClick={() => setCreating(true)}>Create first profile</Button> : undefined} />
          ) : (
            <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
              <nav aria-label="Profiles" className="grid content-start gap-2">
                {d.profiles.map((p) => (
                  <button key={p.id} onClick={() => setSelected(p.id)} aria-current={selected === p.id || undefined}
                    className={cx('card-inset px-4 py-3 text-left transition-colors', selected === p.id ? 'ring-2 ring-lime' : 'hover:bg-surface-3')}>
                    <div className="font-medium">{p.name}</div>
                    <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                      {p.published ? <Chip tone="ok">v{p.published.version} live</Chip> : <Chip tone="outline">unpublished</Chip>}
                      {p.hasDraft && <Chip tone="medium">draft</Chip>}
                      <Chip tone="outline">{p.assignments} assignment{p.assignments === 1 ? '' : 's'}</Chip>
                    </div>
                  </button>
                ))}
              </nav>
              {selected ? <Editor key={selected} id={selected} canEdit={canEdit} onArchived={() => setSelected(null)} /> : null}
            </div>
          )}
        </QueryView>
      ) : <Assignments profiles={list.data?.profiles ?? []} canEdit={canEdit} />}
      {creating && <CreateDialog profiles={list.data?.profiles ?? []} onClose={(id) => { setCreating(false); if (id) setSelected(id); }} />}
    </>
  );
}

function CreateDialog({ profiles, onClose }: { profiles: ProfileRow[]; onClose: (id?: string) => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [copy, setCopy] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await post<{ profile: { id: string } }>('/ui-profiles', { name, description: description || undefined, copyFromProfileId: copy || undefined });
      invalidatePaths(qc, ['/ui-profiles']);
      toast({ title: 'Profile created as a draft', tone: 'ok' });
      onClose(r.profile.id);
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title="New UI profile" description="Starts as a draft. Nothing changes on glasses until you publish and assign it."
      footer={<><Button onClick={() => onClose()}>Cancel</Button><Button variant="primary" busy={busy} disabled={name.trim().length < 2} onClick={() => void submit()}>Create draft</Button></>}>
      <div className="grid gap-3">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Operators — read-only rounds" />
        <Textarea label="Description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
        <Select label="Start from" value={copy} onChange={(e) => setCopy(e.target.value)} options={[{ value: '', label: 'Built-in default (everything enabled)' }, ...profiles.map((p) => ({ value: p.id, label: `Copy of ${p.name}` }))]} />
        {err && <p role="alert" className="text-sm text-critical">{err}</p>}
      </div>
    </Dialog>
  );
}

function move<T>(xs: T[], i: number, d: -1 | 1): T[] {
  const j = i + d;
  if (j < 0 || j >= xs.length) return xs;
  const out = xs.slice();
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}

function OrderList<T extends { id: string }>({ items, label, render, onChange, disabled }: { items: T[]; label: (t: T) => string; render: (t: T) => React.ReactNode; onChange: (xs: T[]) => void; disabled: boolean }) {
  return (
    <ol className="grid gap-1.5">
      {items.map((it, i) => (
        <li key={it.id} className="card-inset flex items-center gap-2 px-3 py-2 text-sm">
          <span className="w-5 text-right text-xs text-muted num">{i + 1}</span>
          <span className="min-w-0 flex-1 truncate">{label(it)}</span>
          {render(it)}
          <button type="button" className="icon-btn icon-btn-sm icon-btn-ghost" aria-label={`Move ${label(it)} up`} disabled={disabled || i === 0} onClick={() => onChange(move(items, i, -1))}><ArrowUp size={14} /></button>
          <button type="button" className="icon-btn icon-btn-sm icon-btn-ghost" aria-label={`Move ${label(it)} down`} disabled={disabled || i === items.length - 1} onClick={() => onChange(move(items, i, 1))}><ArrowDown size={14} /></button>
        </li>
      ))}
    </ol>
  );
}

function Editor({ id, canEdit, onArchived }: { id: string; canEdit: boolean; onArchived: () => void }) {
  const q = useApi<Detail>(`/ui-profiles/${id}`);
  const qc = useQueryClient();
  const toast = useToast();
  const [cfg, setCfg] = useState<UiProfileConfig | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<null | 'publish' | 'discard' | 'archive' | { rollback: Version }>(null);
  const [assetType, setAssetType] = useState<string>('pump');
  const base = q.data ? (q.data.draft ?? q.data.published ?? q.data.versions[0])?.config ?? DEFAULT_UI_PROFILE_CONFIG : null;
  useEffect(() => { if (base && !dirty) setCfg(normalizeUiProfileConfig(base)); }, [base, dirty]);

  // ---- live preview: push the working config to the demo glasses iframe ----
  const frame = useRef<HTMLIFrameElement>(null);
  const sendPreview = useCallback(() => {
    if (cfg) frame.current?.contentWindow?.postMessage({ type: 'hydris:profile', config: cfg }, window.location.origin);
  }, [cfg]);
  useEffect(() => { sendPreview(); }, [sendPreview]);
  useEffect(() => {
    const onMsg = (e: MessageEvent) => { if (e.origin === window.location.origin && (e.data as { type?: string })?.type === 'hydris:preview-ready') sendPreview(); };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [sendPreview]);

  if (q.isLoading || !cfg) return <QueryView q={q}>{() => null}</QueryView>;
  if (q.error || !q.data) return <QueryView q={q}>{() => null}</QueryView>;
  const d = q.data;
  const ro = !canEdit;
  const update = (fn: (c: UiProfileConfig) => UiProfileConfig) => { setCfg((c) => (c ? fn(c) : c)); setDirty(true); };
  const pendingChanges = diffUiProfileConfigs(d.published?.config ?? DEFAULT_UI_PROFILE_CONFIG, cfg);
  const refresh = () => invalidatePaths(qc, ['/ui-profiles', '/ui-profile-assignments']);

  const saveDraft = async () => {
    setSaving(true);
    try { await put(`/ui-profiles/${id}/draft`, { config: cfg }); setDirty(false); refresh(); toast({ title: 'Draft saved', body: 'Not live yet — publish to update glasses.', tone: 'ok' }); }
    catch (e) { toast({ title: 'Could not save draft', body: errorMessage(e), tone: 'critical' }); }
    finally { setSaving(false); }
  };
  const publish = async (notes: string) => {
    if (dirty) await put(`/ui-profiles/${id}/draft`, { config: cfg });
    const r = await post<{ version: Version; affectedDevices: number }>(`/ui-profiles/${id}/publish`, { notes: notes || undefined });
    setDirty(false); refresh();
    toast({ title: `Published v${r.version.version}`, body: `${r.affectedDevices} connected glasses notified to resync.`, tone: 'ok' });
  };
  const rollback = async (v: Version, notes: string) => {
    const r = await post<{ version: Version; affectedDevices: number }>(`/ui-profiles/${id}/rollback`, { versionId: v.id, notes: notes || undefined });
    setDirty(false); refresh();
    toast({ title: `Rolled back: v${v.version} re-published as v${r.version.version}`, body: `${r.affectedDevices} glasses notified.`, tone: 'ok' });
  };
  const allow = cfg.measurements.allow;
  const typeOrder = (cfg.measurements.orderByAssetType as Record<string, Measurand[] | undefined>)[assetType] ?? [];
  const orderItems = [...typeOrder, ...MEASURANDS.filter((m) => !typeOrder.includes(m) && (allow === null || allow.includes(m)))].filter((m) => allow === null || allow.includes(m)).map((m) => ({ id: m }));

  return (
    <div className="grid gap-4">
      <Card title={<span className="flex flex-wrap items-center gap-2">{d.profile.name}{d.published ? <Chip tone="ok">v{d.published.version} live</Chip> : <Chip tone="outline">never published</Chip>}{(d.draft || dirty) && <Chip tone="medium">{dirty ? 'unsaved changes' : `draft v${d.draft!.version}`}</Chip>}</span>}
        action={canEdit ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" icon={<Save size={15} />} busy={saving} disabled={!dirty} onClick={() => void saveDraft()}>Save draft</Button>
            {d.draft && !dirty && <Button size="sm" icon={<Undo2 size={15} />} onClick={() => setConfirm('discard')}>Discard draft</Button>}
            <Button size="sm" variant="primary" icon={<Send size={15} />} disabled={!d.draft && !dirty} onClick={() => setConfirm('publish')}>Publish</Button>
          </div>
        ) : undefined}>
        <ProfileMeta d={d} canEdit={canEdit} onArchive={() => setConfirm('archive')} />
        <p className="mt-3 text-xs text-muted">Precedence: device &gt; user &gt; role &gt; organization &gt; built-in default. The most specific assigned profile wins <strong>entirely</strong> — settings are never merged across levels.</p>
      </Card>

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Screens & menu order">
            <OrderList items={cfg.screens} disabled={ro} label={(s) => UI_SCREEN_LABELS[s.id]} onChange={(screens) => update((c) => ({ ...c, screens }))}
              render={(s) => <Switch label={`${UI_SCREEN_LABELS[s.id]} enabled`} checked={s.enabled} disabled={ro || UI_REQUIRED_SCREENS.has(s.id)} onChange={(v) => update((c) => ({ ...c, screens: c.screens.map((x) => (x.id === s.id ? { ...x, enabled: v } : x)) }))} />} />
            <p className="mt-2 text-xs text-muted">Home and Device &amp; session are always available.</p>
          </Card>
          <div className="grid content-start gap-4">
            <Card title="Home widgets">
              <OrderList items={cfg.widgets} disabled={ro} label={(w) => UI_WIDGET_LABELS[w.id]} onChange={(widgets) => update((c) => ({ ...c, widgets }))}
                render={(w) => <Switch label={`${UI_WIDGET_LABELS[w.id]} visible`} checked={w.visible} disabled={ro} onChange={(v) => update((c) => ({ ...c, widgets: c.widgets.map((x) => (x.id === w.id ? { ...x, visible: v } : x)) }))} />} />
            </Card>
            <Card title="Permitted actions">
              <ul className="grid gap-2">
                {UI_ACTIONS.map((a) => (
                  <li key={a} className="flex items-center justify-between gap-3 text-sm"><span>{UI_ACTION_LABELS[a]}</span>
                    <Switch label={UI_ACTION_LABELS[a]} checked={cfg.actions[a]} disabled={ro} onChange={(v) => update((c) => ({ ...c, actions: { ...c.actions, [a]: v } }))} /></li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted">Blocked actions are rejected by the server (403) and shown as “not permitted by your profile” on the glasses.</p>
            </Card>
          </div>
          <Card title="Displayed measurements">
            <label className="mb-3 flex items-center justify-between gap-3 text-sm">Show every measurand
              <Switch label="Show every measurand" checked={allow === null} disabled={ro} onChange={(v) => update((c) => ({ ...c, measurements: { ...c.measurements, allow: v ? null : [...MEASURANDS] } }))} /></label>
            <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Measurand allow-list">
              {MEASURANDS.map((m) => (
                <label key={m} className={cx('flex items-center gap-2 text-sm', allow === null && 'opacity-50')}>
                  <input type="checkbox" disabled={ro || allow === null} checked={allow === null || allow.includes(m)}
                    onChange={(e) => update((c) => ({ ...c, measurements: { ...c.measurements, allow: e.target.checked ? [...(c.measurements.allow ?? []), m] : (c.measurements.allow ?? []).filter((x) => x !== m) } }))} />
                  {MEASURAND_DEFS[m].label}
                </label>
              ))}
            </div>
            <div className="mt-4 border-t border-line pt-3">
              <Select label="Order for asset type" value={assetType} onChange={(e) => setAssetType(e.target.value)} options={ASSET_TYPES.map((t) => ({ value: t, label: ASSET_TYPE_LABELS[t] }))} />
              <div className="mt-2 max-h-[260px] overflow-y-auto">
                <OrderList items={orderItems} disabled={ro} label={(m) => MEASURAND_DEFS[m.id as Measurand].label} render={() => null}
                  onChange={(xs) => update((c) => ({ ...c, measurements: { ...c.measurements, orderByAssetType: { ...c.measurements.orderByAssetType, [assetType]: xs.map((x) => x.id as Measurand) } } }))} />
              </div>
            </div>
          </Card>
          <Card title="Layout">
            <div className="grid gap-3">
              <Capsule label="Density" value={cfg.layout.density} onChange={(v) => !ro && update((c) => ({ ...c, layout: { ...c.layout, density: v } }))} options={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]} />
              <Capsule label="Text scale" value={String(cfg.layout.textScale)} onChange={(v) => !ro && update((c) => ({ ...c, layout: { ...c.layout, textScale: Number(v) } }))} options={['0.9', '1', '1.15', '1.3'].map((v) => ({ value: v, label: `${Math.round(Number(v) * 100)} %` }))} />
              <Capsule label="Handedness" value={cfg.layout.handedness} onChange={(v) => !ro && update((c) => ({ ...c, layout: { ...c.layout, handedness: v } }))} options={[{ value: 'right', label: 'Right-handed' }, { value: 'left', label: 'Left-handed' }]} />
            </div>
          </Card>
        </div>

        <div className="grid content-start gap-4">
          <Card title="Live preview" action={<span className="text-xs text-muted">synthetic demo · draft config</span>}>
            <div className="mx-auto aspect-square w-full max-w-[380px] overflow-hidden rounded-[var(--radius-xl)] bg-black">
              <iframe ref={frame} src="/glasses?demo=1&profile=preview" title="Glasses live preview" className="h-full w-full border-0" onLoad={sendPreview} />
            </div>
            <p className="mt-2 text-xs text-muted">Click inside the preview and use arrow keys / Enter / Backspace to navigate. Updates as you edit.</p>
          </Card>
          <Card title={<span className="flex items-center gap-2"><History size={16} />Version history</span>}>
            {pendingChanges.length > 0 && (
              <div className="card-inset mb-3 px-3 py-2 text-xs"><div className="mb-1 font-medium">Pending vs live</div><ul className="list-disc pl-4 text-text-2">{pendingChanges.map((c) => <li key={c}>{c}</li>)}</ul></div>
            )}
            <ol className="grid gap-2">
              {d.versions.map((v) => (
                <li key={v.id} className="card-inset px-3 py-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-medium num">v{v.version}</span>
                    <Chip tone={v.status === 'published' ? 'ok' : v.status === 'draft' ? 'medium' : 'outline'}>{v.status}</Chip>
                    <span className="ml-auto text-xs text-muted num">{v.publishedAt ? fmtDateTime(v.publishedAt) : fmtDateTime(v.createdAt)}</span>
                  </div>
                  {v.notes && <div className="mt-1 text-xs text-text-2">“{v.notes}”{v.publishedByName ? ` — ${v.publishedByName}` : ''}</div>}
                  <div className="mt-1 text-xs text-muted">{v.changes.length ? v.changes.slice(0, 4).join(' · ') + (v.changes.length > 4 ? ` · +${v.changes.length - 4} more` : '') : 'No changes from default'}{v.comparedTo ? ` (vs v${v.comparedTo})` : ''}</div>
                  {canEdit && v.status === 'superseded' && <Button size="sm" className="mt-2" icon={<RotateCcw size={14} />} onClick={() => setConfirm({ rollback: v })}>Roll back to v{v.version}</Button>}
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>

      <ConfirmDialog open={confirm === 'publish'} onOpenChange={(v) => !v && setConfirm(null)} title={`Publish ${d.profile.name}?`} confirmLabel="Publish" noteLabel="Release notes (optional)"
        body={<>Connected glasses using this profile resync within seconds. {pendingChanges.length ? <ul className="mt-2 list-disc pl-5 text-sm">{pendingChanges.map((c) => <li key={c}>{c}</li>)}</ul> : 'No differences from the live version.'}</>}
        onConfirm={publish} />
      <ConfirmDialog open={typeof confirm === 'object' && confirm !== null} onOpenChange={(v) => !v && setConfirm(null)}
        title={confirm && typeof confirm === 'object' ? `Roll back to v${confirm.rollback.version}?` : 'Roll back'} confirmLabel="Roll back" noteLabel="Reason"
        body="The selected version is re-published as a new version; history is kept. Any open draft is preserved."
        onConfirm={(n) => (confirm && typeof confirm === 'object' ? rollback(confirm.rollback, n) : Promise.resolve())} />
      <ConfirmDialog open={confirm === 'discard'} onOpenChange={(v) => !v && setConfirm(null)} title="Discard draft?" destructive confirmLabel="Discard draft"
        body="The draft is deleted. The live version is unchanged." onConfirm={async () => { await del(`/ui-profiles/${id}/draft`); setDirty(false); refresh(); }} />
      <ConfirmDialog open={confirm === 'archive'} onOpenChange={(v) => !v && setConfirm(null)} title={`Archive ${d.profile.name}?`} destructive confirmLabel="Archive profile"
        body="Archived profiles disappear from the list. Remove its assignments first." onConfirm={async () => { await post(`/ui-profiles/${id}/archive`); refresh(); onArchived(); }} />
    </div>
  );
}

function ProfileMeta({ d, canEdit, onArchive }: { d: Detail; canEdit: boolean; onArchive: () => void }) {
  const [name, setName] = useState(d.profile.name);
  const [desc, setDesc] = useState(d.profile.description ?? '');
  const qc = useQueryClient();
  const toast = useToast();
  const changed = name !== d.profile.name || desc !== (d.profile.description ?? '');
  const save = async () => {
    try { await patch(`/ui-profiles/${d.profile.id}`, { name, description: desc || null }); invalidatePaths(qc, ['/ui-profiles']); toast({ title: 'Profile details saved', tone: 'ok' }); }
    catch (e) { toast({ title: 'Could not save', body: errorMessage(e), tone: 'critical' }); }
  };
  if (!canEdit) return <p className="text-sm text-text-2">{d.profile.description ?? 'No description.'}</p>;
  return (
    <div className="grid gap-2 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
      <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <Input label="Description" value={desc} onChange={(e) => setDesc(e.target.value)} />
      <div className="flex gap-2"><Button size="sm" disabled={!changed || name.trim().length < 2} onClick={() => void save()}>Save</Button><Button size="sm" icon={<Trash2 size={14} />} onClick={onArchive}>Archive</Button></div>
    </div>
  );
}

function Assignments({ profiles, canEdit }: { profiles: ProfileRow[]; canEdit: boolean }) {
  const q = useApi<{ assignments: Assignment[] }>('/ui-profile-assignments');
  const members = useApi<MembersResponse>('/members');
  const devices = useApi<{ devices: DeviceRow[] }>('/devices');
  const qc = useQueryClient();
  const toast = useToast();
  const [scope, setScope] = useState<Assignment['scope']>('role');
  const [profileId, setProfileId] = useState('');
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [checkKind, setCheckKind] = useState<'device' | 'user'>('device');
  const [checkId, setCheckId] = useState('');
  const eff = useApi<Effective>(checkId ? `/ui-profiles-effective?${checkKind}Id=${checkId}` : null);
  const published = profiles.filter((p) => p.published);
  const targetOptions = useMemo(() => scope === 'role' ? ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))
    : scope === 'user' ? (members.data?.members ?? []).filter((m) => m.status === 'active').map((m) => ({ value: m.userId, label: `${m.name} · ${ROLE_LABELS[m.role]}` }))
      : scope === 'device' ? (devices.data?.devices ?? []).filter((x) => x.status !== 'revoked').map((x) => ({ value: x.id, label: `${x.name}${x.assignee?.name ? ` · ${x.assignee.name}` : ''}` })) : [], [scope, members.data, devices.data]);

  const assign = async () => {
    setBusy(true);
    try {
      const body = { scope, profileId, ...(scope === 'role' ? { role: target } : scope === 'user' ? { userId: target } : scope === 'device' ? { deviceId: target } : {}) };
      const r = await post<{ replaced: boolean; affectedDevices: number }>('/ui-profile-assignments', body);
      invalidatePaths(qc, ['/ui-profile-assignments', '/ui-profiles']);
      toast({ title: r.replaced ? 'Assignment replaced' : 'Profile assigned', body: `${r.affectedDevices} glasses notified to resync.`, tone: 'ok' });
      setTarget('');
    } catch (e) { toast({ title: 'Assignment failed', body: errorMessage(e), tone: 'critical' }); } finally { setBusy(false); }
  };
  const remove = async (a: Assignment) => {
    try { await del(`/ui-profile-assignments/${a.id}`); invalidatePaths(qc, ['/ui-profile-assignments', '/ui-profiles']); toast({ title: 'Assignment removed', tone: 'ok' }); }
    catch (e) { toast({ title: 'Could not remove', body: errorMessage(e), tone: 'critical' }); }
  };
  const ORDER = { device: 0, user: 1, role: 2, org: 3 } as const;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <Card title="Assignments">
        <p className="mb-3 text-sm text-text-2">Most specific wins entirely: <strong>device</strong> → <strong>user</strong> → <strong>role</strong> → <strong>organization</strong> → built-in default. Profiles without a published version are skipped.</p>
        <QueryView q={q}>
          {(d) => d.assignments.length ? (
            <ul className="grid gap-2">
              {d.assignments.slice().sort((a, b) => ORDER[a.scope] - ORDER[b.scope]).map((a) => (
                <li key={a.id} className="card-inset flex items-center gap-3 px-3 py-2 text-sm">
                  <Chip tone="cobalt">{a.scope}</Chip>
                  <span className="min-w-0 flex-1 truncate">{a.scope === 'org' ? 'Whole organization' : a.scope === 'role' ? ROLE_LABELS[a.role!] : a.scope === 'user' ? a.userName : <Link className="hover:underline" href={`/console/devices/${a.deviceId}`}>{a.deviceName}</Link>}</span>
                  <span className="truncate text-text-2">→ {a.profileName}</span>
                  {canEdit && <button className="icon-btn icon-btn-sm icon-btn-ghost" aria-label="Remove assignment" onClick={() => void remove(a)}><Trash2 size={14} /></button>}
                </li>
              ))}
            </ul>
          ) : <EmptyState compact title="No assignments" body="Every pair of glasses uses the built-in default profile." />}
        </QueryView>
        {canEdit && (
          <div className="mt-4 grid gap-2 border-t border-line pt-4 sm:grid-cols-2">
            <Select label="Scope" value={scope} onChange={(e) => { setScope(e.target.value as Assignment['scope']); setTarget(''); }} options={[{ value: 'org', label: 'Organization' }, { value: 'role', label: 'Role' }, { value: 'user', label: 'User' }, { value: 'device', label: 'Device' }]} />
            {scope !== 'org' && <Select label={scope === 'role' ? 'Role' : scope === 'user' ? 'User' : 'Device'} value={target} placeholder="Choose…" onChange={(e) => setTarget(e.target.value)} options={targetOptions} />}
            <Select label="Profile" value={profileId} placeholder="Choose a profile…" onChange={(e) => setProfileId(e.target.value)} options={profiles.map((p) => ({ value: p.id, label: `${p.name}${p.published ? ` (v${p.published.version})` : ' (unpublished)'}` }))} />
            <div className="flex items-end"><Button variant="primary" busy={busy} disabled={!profileId || (scope !== 'org' && !target)} onClick={() => void assign()}>Assign</Button></div>
            {profileId && !published.some((p) => p.id === profileId) && <p className="text-xs text-medium sm:col-span-2">This profile is not published yet, so the assignment has no effect until it is.</p>}
          </div>
        )}
      </Card>
      <Card title={<span className="flex items-center gap-2"><Search size={16} />Effective profile checker</span>}>
        <div className="grid gap-2">
          <Capsule label="Check" value={checkKind} onChange={(v) => { setCheckKind(v); setCheckId(''); }} options={[{ value: 'device', label: 'Device' }, { value: 'user', label: 'User' }]} />
          <Select label={checkKind === 'device' ? 'Device' : 'User'} value={checkId} placeholder="Choose…" onChange={(e) => setCheckId(e.target.value)}
            options={checkKind === 'device' ? (devices.data?.devices ?? []).map((x) => ({ value: x.id, label: x.name })) : (members.data?.members ?? []).map((m) => ({ value: m.userId, label: m.name }))} />
        </div>
        {checkId && (
          <div className="mt-4">
            <QueryView q={eff}>
              {(r) => (
                <div className="card-inset px-4 py-3 text-sm">
                  <div className="text-lg font-medium">{r.effective.name}{r.effective.version ? <span className="text-text-2"> · v{r.effective.version}</span> : null}</div>
                  <div className="mt-1 text-text-2">Applied via <strong>{r.effective.source}</strong>{r.subject.role ? ` · operator role ${ROLE_LABELS[r.subject.role]}` : ''}</div>
                  {r.effective.source === 'default' && <div className="mt-1 text-xs text-muted">No published profile matches; all screens and actions are available.</div>}
                </div>
              )}
            </QueryView>
          </div>
        )}
      </Card>
    </div>
  );
}
