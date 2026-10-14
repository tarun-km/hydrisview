'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { MAINTENANCE_PRIORITIES, ROLE_LABELS, type MaintenancePriority } from '@hydris/domain';
import { patch, post } from '@/lib/api';
import { invalidatePaths } from '@/lib/query';
import { label as humanize } from '@/lib/format';
import { Button, IconButton, Input, Select, Textarea } from '@/ui';
import { Dialog, useToast } from '@/ui/overlay';
import { FormError, MAINTENANCE_ASSIGNEE_ROLES, fromLocalInput, toLocalInput, useAssets, useMembers, useSites, zoneName } from './shared';

export const NO_ACTUATION = 'Maintenance records document and coordinate work. Hydris never starts, stops or changes equipment — isolate and operate plant only under your site permit-to-work procedure.';

const PRIORITY_DOT: Record<MaintenancePriority, string> = { low: 'var(--color-low)', medium: 'var(--color-medium)', high: 'var(--color-high)', urgent: 'var(--color-critical)' };

function PriorityPicker({ value, onChange }: { value: MaintenancePriority; onChange: (v: MaintenancePriority) => void }) {
  return (
    <div className="field">
      <span className="field-label">Priority</span>
      <div className="capsule max-w-full overflow-x-auto scrollbar-none" role="radiogroup" aria-label="Priority">
        {MAINTENANCE_PRIORITIES.map((p) => (
          <button key={p} type="button" role="radio" aria-checked={value === p} data-active={value === p} onClick={() => onChange(p)}>
            <span className="dot" style={{ background: PRIORITY_DOT[p] }} aria-hidden />{humanize(p)}
          </button>
        ))}
      </div>
    </div>
  );
}

export function NewRequestDialog({ open, onOpenChange, canAssign }: { open: boolean; onOpenChange: (v: boolean) => void; canAssign: boolean }) {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const assets = useAssets(open);
  const sites = useSites(open);
  const members = useMembers(MAINTENANCE_ASSIGNEE_ROLES, open && canAssign);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assetId, setAssetId] = useState('');
  const [siteId, setSiteId] = useState('');
  const [priority, setPriority] = useState<MaintenancePriority>('medium');
  const [kind, setKind] = useState<'corrective' | 'preventive'>('corrective');
  const [due, setDue] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [checklist, setChecklist] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(''); setDescription(''); setAssetId(''); setSiteId(''); setPriority('medium'); setKind('corrective'); setDue(''); setAssignedTo(''); setChecklist([]);
    setErr(null); setTouched(false);
  }, [open]);

  const siteList = sites.data?.sites ?? [];
  useEffect(() => {
    if (siteList.length === 1 && !siteId) setSiteId(siteList[0]!.id);
  }, [siteList, siteId]);

  const errors = {
    title: title.trim().length < 3 ? 'Give the request a title of at least 3 characters' : null,
    where: !assetId && !siteId ? 'Choose the asset, or the site if no single asset applies' : null,
  };

  const submit = async () => {
    setTouched(true);
    if (errors.title || errors.where) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await post<{ task: { id: string; title: string } }>('/maintenance', {
        title: title.trim(), description: description.trim() || null, assetId: assetId || null, ...(assetId ? {} : { siteId }), priority, kind,
        dueAt: fromLocalInput(due), checklist: checklist.map((c) => c.trim()).filter(Boolean), ...(canAssign && assignedTo ? { assignedTo } : {}),
      });
      invalidatePaths(qc, ['/maintenance', '/overview', '/assets/']);
      toast({ title: 'Maintenance request created', body: r.task.title, tone: 'ok' });
      onOpenChange(false);
      router.push(`/console/maintenance/${r.task.id}`);
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }} title="New maintenance request" wide description={NO_ACTUATION}
      footer={<>
        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
        <Button variant="primary" busy={busy} onClick={() => void submit()}>Create request</Button>
      </>}>
      <div className="grid gap-4">
        <Input label="Title" value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Blower B-2 abnormal vibration" error={touched ? errors.title : null} autoFocus />
        <Textarea label="Description" value={description} maxLength={4000} onChange={(e) => setDescription(e.target.value)} placeholder="What was observed, where, and since when" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Asset" value={assetId} onChange={(e) => setAssetId(e.target.value)} placeholder={assets.isLoading ? 'Loading assets…' : 'No specific asset'}
            options={(assets.data?.assets ?? []).map((a) => ({ value: a.id, label: `${a.tag} · ${a.name}` }))} error={touched ? errors.where : null} />
          {!assetId && <Select label="Site" value={siteId} onChange={(e) => setSiteId(e.target.value)} placeholder="Choose a site" options={siteList.map((s) => ({ value: s.id, label: s.name }))} />}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <PriorityPicker value={priority} onChange={setPriority} />
          <div className="field">
            <span className="field-label">Kind</span>
            <div className="capsule w-fit" role="radiogroup" aria-label="Kind">
              {(['corrective', 'preventive'] as const).map((k) => (
                <button key={k} type="button" role="radio" aria-checked={kind === k} data-active={kind === k} onClick={() => setKind(k)}>{humanize(k)}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Due (optional)" type="datetime-local" className="num" value={due} onChange={(e) => setDue(e.target.value)} hint={zoneName()} />
          {canAssign && !members.q.isError && (
            <Select label="Assignee" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} placeholder={members.q.isLoading ? 'Loading people…' : 'Leave unassigned'}
              options={members.list.map((m) => ({ value: m.userId, label: `${m.name} · ${ROLE_LABELS[m.role]} · ${m.openTasks} open` }))} />
          )}
        </div>
        <div className="field">
          <span className="field-label">Checklist <span className="text-muted">(optional, up to 40 items)</span></span>
          <div className="grid gap-2">
            {checklist.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="num w-6 text-right text-xs text-muted">{i + 1}</span>
                <input className="input !min-h-[40px]" aria-label={`Checklist item ${i + 1}`} value={c} maxLength={200} onChange={(e) => setChecklist(checklist.map((x, j) => (j === i ? e.target.value : x)))}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (checklist.length < 40) setChecklist([...checklist, '']); } }} />
                <IconButton label={`Remove checklist item ${i + 1}`} size="sm" tone="ghost" onClick={() => setChecklist(checklist.filter((_, j) => j !== i))}><Trash2 size={14} /></IconButton>
              </div>
            ))}
            <Button size="sm" className="w-fit" icon={<Plus size={14} />} disabled={checklist.length >= 40} onClick={() => setChecklist([...checklist, ''])}>Add checklist item</Button>
          </div>
          <span className="field-hint">Every item must be ticked before the task can be completed.</span>
        </div>
        <FormError error={err} />
      </div>
    </Dialog>
  );
}

export function EditTaskDialog({ open, onOpenChange, task, onDone }: {
  open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void;
  task: { id: string; priority: MaintenancePriority; assignedTo: string | null; dueAt: string | null };
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const members = useMembers(MAINTENANCE_ASSIGNEE_ROLES, open);
  const [priority, setPriority] = useState<MaintenancePriority>('medium');
  const [assignedTo, setAssignedTo] = useState('');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);

  useEffect(() => {
    if (!open) return;
    setPriority(task.priority);
    setAssignedTo(task.assignedTo ?? '');
    setDue(toLocalInput(task.dueAt));
    setErr(null);
  }, [open, task.id]); // re-seed on open only

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const body: Record<string, unknown> = { priority, dueAt: fromLocalInput(due) };
      if (!members.q.isError && (assignedTo || null) !== task.assignedTo) body.assignedTo = assignedTo || null;
      await patch(`/maintenance/${task.id}`, body);
      invalidatePaths(qc, ['/maintenance', '/overview']);
      toast({ title: 'Task updated', tone: 'ok' });
      onOpenChange(false);
      onDone();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }} title="Edit task" description="Reassigning notifies the new assignee."
      footer={<>
        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
        <Button variant="primary" busy={busy} onClick={() => void submit()}>Save changes</Button>
      </>}>
      <div className="grid gap-4">
        <PriorityPicker value={priority} onChange={setPriority} />
        {!members.q.isError && (
          <Select label="Assignee" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} placeholder="Unassigned"
            options={members.list.map((m) => ({ value: m.userId, label: `${m.name} · ${ROLE_LABELS[m.role]}` }))} />
        )}
        <Input label="Due" type="datetime-local" className="num" value={due} onChange={(e) => setDue(e.target.value)} hint={`Leave empty for no due date · ${zoneName()}`} />
        <FormError error={err} />
      </div>
    </Dialog>
  );
}
