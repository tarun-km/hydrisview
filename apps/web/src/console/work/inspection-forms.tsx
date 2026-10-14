'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { ASSET_TYPE_LABELS, ROLE_LABELS } from '@hydris/domain';
import { patch, post } from '@/lib/api';
import { invalidatePaths, useApi } from '@/lib/query';
import { Button, Input, Select } from '@/ui';
import { Dialog, useToast } from '@/ui/overlay';
import { FormError, INSPECTION_EXECUTOR_ROLES, fromLocalInput, toLocalInput, useAssets, useMembers, useSites, zoneName, type Template } from './shared';

function PriorityPicker({ value, onChange }: { value: 'normal' | 'high'; onChange: (v: 'normal' | 'high') => void }) {
  return (
    <div className="field">
      <span className="field-label">Priority</span>
      <div className="capsule w-fit" role="radiogroup" aria-label="Priority">
        {(['normal', 'high'] as const).map((p) => (
          <button key={p} type="button" role="radio" aria-checked={value === p} data-active={value === p} onClick={() => onChange(p)}>
            {p === 'high' && <span className="dot" style={{ background: 'var(--color-high)' }} aria-hidden />}{p === 'normal' ? 'Normal' : 'High'}
          </button>
        ))}
      </div>
    </div>
  );
}

export function NewInspectionDialog({ open, onOpenChange, presetTemplateId }: { open: boolean; onOpenChange: (v: boolean) => void; presetTemplateId?: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const templates = useApi<{ templates: Template[] }>(open ? '/inspection-templates' : null);
  const assets = useAssets(open);
  const sites = useSites(open);
  const members = useMembers(INSPECTION_EXECUTOR_ROLES, open);
  const [templateId, setTemplateId] = useState('');
  const [assetId, setAssetId] = useState('');
  const [siteId, setSiteId] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [due, setDue] = useState('');
  const [priority, setPriority] = useState<'normal' | 'high'>('normal');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTemplateId(presetTemplateId ?? '');
    setAssetId('');
    setSiteId('');
    setAssignedTo('');
    const d = new Date(Date.now() + 4 * 3600_000);
    d.setMinutes(0, 0, 0);
    setDue(toLocalInput(d.toISOString()));
    setPriority('normal');
    setTitle('');
    setErr(null);
    setTouched(false);
  }, [open, presetTemplateId]);

  const published = useMemo(() => (templates.data?.templates ?? []).filter((t) => t.status === 'published'), [templates.data]);
  const tpl = published.find((t) => t.id === templateId);
  const assetOptions = useMemo(() => {
    const list = [...(assets.data?.assets ?? [])];
    if (tpl?.assetType) list.sort((a, b) => Number(b.type === tpl.assetType) - Number(a.type === tpl.assetType));
    return list.map((a) => ({ value: a.id, label: `${a.tag} · ${a.name}${tpl?.assetType && a.type === tpl.assetType ? '  ✓ matches template' : ''}` }));
  }, [assets.data, tpl]);
  const siteList = sites.data?.sites ?? [];
  useEffect(() => {
    if (siteList.length === 1 && !siteId) setSiteId(siteList[0]!.id);
  }, [siteList, siteId]);

  const errors = {
    template: !templateId ? 'Choose a published template' : null,
    where: !assetId && !siteId ? 'Choose an asset, or a site for a site-wide inspection' : null,
    title: title.trim() && title.trim().length < 3 ? 'Title must be at least 3 characters' : null,
  };
  const invalid = Object.values(errors).some(Boolean);

  const submit = async () => {
    setTouched(true);
    if (invalid) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await post<{ inspection: { id: string; title: string } }>('/inspections', {
        templateId, assetId: assetId || null, ...(assetId ? {} : { siteId }), assignedTo: assignedTo || null, dueAt: fromLocalInput(due), priority, ...(title.trim() ? { title: title.trim() } : {}),
      });
      invalidatePaths(qc, ['/inspections', '/overview', '/members']);
      toast({ title: 'Inspection issued', body: r.inspection.title, tone: 'ok' });
      onOpenChange(false);
      router.push(`/console/inspections/${r.inspection.id}`);
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }} title="New inspection" wide
      description="Issue an inspection from a published template. The assignee sees it on their field glasses and in the console."
      footer={<>
        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
        <Button variant="primary" busy={busy} onClick={() => void submit()}>Issue inspection</Button>
      </>}>
      <div className="grid gap-4">
        <Select label="Template" value={templateId} onChange={(e) => setTemplateId(e.target.value)} placeholder={templates.isLoading ? 'Loading templates…' : 'Choose a template'}
          options={published.map((t) => ({ value: t.id, label: `${t.name} · v${t.version} · ${t.steps.length} steps${t.assetType ? ` · ${ASSET_TYPE_LABELS[t.assetType]}` : ''}` }))}
          error={touched ? errors.template : null} hint={!templates.isLoading && !published.length ? 'No published templates yet — create one in the Templates tab.' : tpl?.estimatedMinutes ? `About ${tpl.estimatedMinutes} minutes.` : undefined} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Asset" value={assetId} onChange={(e) => setAssetId(e.target.value)} placeholder={assets.isLoading ? 'Loading assets…' : 'No specific asset (site-wide)'} options={assetOptions}
            error={touched ? errors.where : null} />
          {!assetId && (
            <Select label="Site" value={siteId} onChange={(e) => setSiteId(e.target.value)} placeholder="Choose a site" options={siteList.map((s) => ({ value: s.id, label: s.name }))} />
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {members.q.isError ? (
            <p className="text-sm text-muted">You cannot list members, so the inspection will be issued unassigned.</p>
          ) : (
            <Select label="Assignee" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} placeholder={members.q.isLoading ? 'Loading people…' : 'Unassigned'}
              options={members.list.map((m) => ({ value: m.userId, label: `${m.name} · ${ROLE_LABELS[m.role]} · ${m.openInspections} open` }))}
              hint="Only people whose role can execute inspections are listed." />
          )}
          <Input label="Due" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} hint={`Your time zone: ${zoneName()}`} className="num" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <PriorityPicker value={priority} onChange={setPriority} />
          <Input label="Title (optional)" value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} placeholder={tpl ? `${tpl.name} · ASSET` : 'Defaults to template name and asset tag'}
            error={touched ? errors.title : null} />
        </div>
        <FormError error={err} />
      </div>
    </Dialog>
  );
}

/** Manager edit of an open inspection: reassign, change due date, priority. */
export function ReassignDialog({ open, onOpenChange, inspection, onDone }: {
  open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void;
  inspection: { id: string; assignedTo: string | null; dueAt: string | null; priority: 'normal' | 'high' };
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const members = useMembers(INSPECTION_EXECUTOR_ROLES, open);
  const [assignedTo, setAssignedTo] = useState('');
  const [due, setDue] = useState('');
  const [priority, setPriority] = useState<'normal' | 'high'>('normal');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);

  useEffect(() => {
    if (!open) return;
    setAssignedTo(inspection.assignedTo ?? '');
    setDue(toLocalInput(inspection.dueAt));
    setPriority(inspection.priority);
    setErr(null);
    // Only re-seed when the dialog opens, so a background refetch never wipes edits in progress.
  }, [open, inspection.id]);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const body: Record<string, unknown> = { priority, dueAt: fromLocalInput(due) };
      if (!members.q.isError) body.assignedTo = assignedTo || null;
      await patch(`/inspections/${inspection.id}`, body);
      invalidatePaths(qc, ['/inspections', '/overview', '/members']);
      toast({ title: 'Inspection updated', tone: 'ok' });
      onOpenChange(false);
      onDone();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }} title="Reassign or reschedule"
      description="Changes notify the new assignee. Responses already recorded are kept."
      footer={<>
        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
        <Button variant="primary" busy={busy} onClick={() => void submit()}>Save changes</Button>
      </>}>
      <div className="grid gap-4">
        {!members.q.isError && (
          <Select label="Assignee" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} placeholder="Unassigned"
            options={members.list.map((m) => ({ value: m.userId, label: `${m.name} · ${ROLE_LABELS[m.role]}` }))} />
        )}
        <Input label="Due" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} hint={`Leave empty for no due date · ${zoneName()}`} className="num" />
        <PriorityPicker value={priority} onChange={setPriority} />
        <FormError error={err} />
      </div>
    </Dialog>
  );
}
