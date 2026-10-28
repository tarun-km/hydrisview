'use client';

import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { MAINTENANCE_PRIORITIES } from '@hydris/domain';
import { post } from '@/lib/api';
import { useAction, useApi } from '@/lib/query';
import { Avatar, Button, Capsule, Input, Select, Textarea } from '@/ui';
import { Dialog } from '@/ui/overlay';
import { useSites } from '@/console/admin/parts';
import type { OperatorStats } from './types';

type Kind = 'round' | 'inspection' | 'maintenance';
type Target = 'people' | 'team';

interface Template { id: string; name: string; status: string; assetType: string | null }
interface RouteRow { id: string; name: string; siteId: string; assetIds: string[] }
interface AssetRow { id: string; tag: string; name: string; siteId: string }

/**
 * Assign rounds, single inspections or maintenance tasks to operators, or to a team
 * (everyone on a shift and/or with access to a site). Posts to /command/assign.
 */
export function AssignWorkDialog({ open, onClose, preselect }: { open: boolean; onClose: () => void; preselect?: string[] }) {
  const ops = useApi<{ operators: OperatorStats[] }>(open ? '/command/operators' : null);
  const templates = useApi<{ templates: Template[] }>(open ? '/inspection-templates' : null);
  const routes = useApi<{ routes: RouteRow[] }>(open ? '/inspection-routes' : null);
  const sites = useSites();
  const [kind, setKind] = useState<Kind>('round');
  const [target, setTarget] = useState<Target>('people');
  const [picked, setPicked] = useState<string[]>(preselect ?? []);
  const [shift, setShift] = useState('');
  const [teamSite, setTeamSite] = useState('');
  const [routeId, setRouteId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [siteId, setSiteId] = useState('');
  const [assetId, setAssetId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [taskPriority, setTaskPriority] = useState('medium');
  const [priority, setPriority] = useState<'normal' | 'high'>('normal');
  const [due, setDue] = useState('');
  const [checklist, setChecklist] = useState('');
  const [touched, setTouched] = useState(false);
  const assets = useApi<{ assets: AssetRow[] }>(open && siteId ? `/assets?siteId=${siteId}` : null);

  const active = useMemo(() => (ops.data?.operators ?? []).filter((o) => o.status === 'active' && o.role === 'operator'), [ops.data]);
  const shifts = useMemo(() => [...new Set(active.map((o) => o.shiftLabel).filter((s): s is string => !!s))].sort(), [active]);
  const teamMembers = useMemo(() => active.filter((o) => (!shift || (o.shiftLabel ?? '').toLowerCase() === shift.toLowerCase()) && (!teamSite || o.allSites || o.sites.some((s) => s.id === teamSite))), [active, shift, teamSite]);
  const published = (templates.data?.templates ?? []).filter((t) => t.status === 'published');
  const route = routes.data?.routes.find((r) => r.id === routeId);
  const assignees = target === 'people' ? picked.length : (shift || teamSite ? teamMembers.length : 0);

  const problems = [
    !assignees && (target === 'people' ? 'Choose at least one operator' : 'Choose a shift or a site for the team'),
    kind === 'round' && !routeId && 'Choose a round',
    kind === 'round' && !templateId && 'Choose a fallback template for stops without a matching template',
    kind === 'inspection' && !templateId && 'Choose an inspection template',
    kind === 'inspection' && !siteId && !assetId && 'Choose a site or an asset',
    kind === 'maintenance' && title.trim().length < 3 && 'Give the task a title (3+ characters)',
    kind === 'maintenance' && !siteId && 'Choose a site',
  ].filter(Boolean) as string[];

  const act = useAction((v: Record<string, unknown>) => post<{ created: number; assignees: number }>('/command/assign', v), {
    invalidate: ['/command', '/inspections', '/maintenance', '/members', '/overview'],
    success: (r) => `${r.created} ${kind === 'maintenance' ? 'task' : 'inspection'}${r.created === 1 ? '' : 's'} assigned to ${r.assignees} operator${r.assignees === 1 ? '' : 's'}`,
    onSuccess: () => onClose(),
  });

  const submit = () => {
    setTouched(true);
    if (problems.length) return;
    act.mutate({
      kind,
      userIds: target === 'people' ? picked : [],
      team: target === 'team' ? { ...(shift ? { shiftLabel: shift } : {}), ...(teamSite ? { siteId: teamSite } : {}) } : undefined,
      dueAt: due ? new Date(due).toISOString() : null,
      ...(kind === 'round' ? { routeId, fallbackTemplateId: templateId, priority } : {}),
      ...(kind === 'inspection' ? { templateId, siteId: siteId || undefined, assetId: assetId || null, priority } : {}),
      ...(kind === 'maintenance' ? { title: title.trim(), description: description.trim() || null, siteId, assetId: assetId || null, taskPriority, checklist: checklist.split('\n').map((x) => x.trim()).filter(Boolean) } : {}),
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()} title="Assign work" wide
      description="Send a round, an inspection or a maintenance task to operators or a whole team. Each person gets their own copy on the Hydris Field app and glasses."
      footer={<>
        <span className="mr-auto self-center text-[13px] text-muted max-sm:hidden">{assignees ? `${assignees} operator${assignees === 1 ? '' : 's'} selected` : 'Nobody selected yet'}</span>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" busy={act.isPending} onClick={submit}>Assign{assignees ? ` to ${assignees}` : ''}</Button>
      </>}>
      <form className="grid grid-cols-[minmax(0,1fr)] gap-5" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Capsule label="Kind of work" value={kind} onChange={setKind} options={[
          { value: 'round', label: 'Inspection round' }, { value: 'inspection', label: 'Single inspection' }, { value: 'maintenance', label: 'Maintenance task' },
        ]} />

        {kind === 'round' && (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
            <Select label="Round" value={routeId} onChange={(e) => setRouteId(e.target.value)} placeholder={routes.data ? (routes.data.routes.length ? 'Choose a round' : 'No rounds yet: create one on the plant map') : 'Loading…'}
              options={(routes.data?.routes ?? []).map((r) => ({ value: r.id, label: `${r.name} · ${r.assetIds.length} stops` }))} />
            <Select label="Fallback template" value={templateId} onChange={(e) => setTemplateId(e.target.value)} placeholder="Choose a template"
              options={published.map((t) => ({ value: t.id, label: t.name }))} hint={route ? 'Used for stops whose equipment type has no template of its own.' : undefined} />
          </div>
        )}
        {kind === 'inspection' && (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-3">
            <Select label="Template" value={templateId} onChange={(e) => setTemplateId(e.target.value)} placeholder="Choose a template" options={published.map((t) => ({ value: t.id, label: t.name }))} />
            <Select label="Site" value={siteId} onChange={(e) => { setSiteId(e.target.value); setAssetId(''); }} placeholder="Choose a site" options={(sites.data?.sites ?? []).map((s) => ({ value: s.id, label: s.name }))} />
            <Select label="Asset (optional)" value={assetId} onChange={(e) => setAssetId(e.target.value)} placeholder={siteId ? 'Whole site' : 'Choose a site first'} disabled={!siteId}
              options={(assets.data?.assets ?? []).map((a) => ({ value: a.id, label: `${a.tag} · ${a.name}` }))} />
          </div>
        )}
        {kind === 'maintenance' && (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
            <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-[2fr_1fr]">
              <Input label="Task" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} placeholder="e.g. Grease transfer pump bearings" />
              <Select label="Priority" value={taskPriority} onChange={(e) => setTaskPriority(e.target.value)} options={[...MAINTENANCE_PRIORITIES].reverse().map((p) => ({ value: p, label: p[0]!.toUpperCase() + p.slice(1) }))} />
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
              <Select label="Site" value={siteId} onChange={(e) => { setSiteId(e.target.value); setAssetId(''); }} placeholder="Choose a site" options={(sites.data?.sites ?? []).map((s) => ({ value: s.id, label: s.name }))} />
              <Select label="Asset (optional)" value={assetId} onChange={(e) => setAssetId(e.target.value)} placeholder={siteId ? 'No specific asset' : 'Choose a site first'} disabled={!siteId}
                options={(assets.data?.assets ?? []).map((a) => ({ value: a.id, label: `${a.tag} · ${a.name}` }))} />
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
              <Textarea label="Notes (optional)" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} rows={3} />
              <Textarea label="Checklist (one item per line)" value={checklist} onChange={(e) => setChecklist(e.target.value)} rows={3} placeholder={'Isolate and lock out\nCheck coupling'} />
            </div>
          </div>
        )}

        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
          <Input label="Due (optional)" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
          {kind !== 'maintenance' && <Select label="Priority" value={priority} onChange={(e) => setPriority(e.target.value as 'normal' | 'high')} options={[{ value: 'normal', label: 'Normal' }, { value: 'high', label: 'High' }]} />}
        </div>

        <fieldset className="grid grid-cols-[minmax(0,1fr)] gap-3">
          <legend className="field-label mb-2">Assign to</legend>
          <Capsule label="Assign to people or a team" value={target} onChange={setTarget} options={[{ value: 'people', label: 'Operators' }, { value: 'team', label: 'Team' }]} />
          {target === 'people' ? (
            !ops.data ? <p className="text-sm text-muted">Loading operators…</p> : !active.length ? <p className="text-sm text-muted">No active operators yet. Invite operators from Team → Operators.</p> : (
              <ul className="grid grid-cols-[minmax(0,1fr)] max-h-60 gap-1 overflow-y-auto rounded-[var(--radius-md)] border border-line p-1.5 sm:grid-cols-2" aria-label="Operators">
                {active.map((o) => {
                  const on = picked.includes(o.userId);
                  return (
                    <li key={o.userId}>
                      <label className={clsx('flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 transition-colors hover:bg-surface-2', on && 'bg-surface-2')}>
                        <input type="checkbox" className="h-4 w-4 accent-[var(--color-lime)]" checked={on} onChange={() => setPicked(on ? picked.filter((x) => x !== o.userId) : [...picked, o.userId])} />
                        <Avatar name={o.name} size={28} />
                        <span className="min-w-0 flex-1"><span className="block truncate text-sm">{o.name}</span><span className="block truncate text-xs text-muted">{o.shiftLabel ?? 'No shift'} · {o.rounds.open} open</span></span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )
          ) : (
            <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
              <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
                <Select label="Shift" value={shift} onChange={(e) => setShift(e.target.value)} placeholder="Any shift" options={shifts.map((s) => ({ value: s, label: s }))} />
                <Select label="Site" value={teamSite} onChange={(e) => setTeamSite(e.target.value)} placeholder="Any site" options={(sites.data?.sites ?? []).map((s) => ({ value: s.id, label: s.name }))} />
              </div>
              <p className="text-[13px] text-text-2">{shift || teamSite ? (teamMembers.length ? <>Team: {teamMembers.map((o) => o.name).join(', ')}</> : 'No active operator matches this team.') : 'Pick a shift and/or a site to form the team.'}</p>
            </div>
          )}
        </fieldset>
        {touched && problems.length > 0 && <p className="field-error" role="alert">{problems[0]}</p>}
      </form>
    </Dialog>
  );
}
