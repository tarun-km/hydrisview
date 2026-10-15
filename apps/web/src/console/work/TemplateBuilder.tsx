'use client';

import { useEffect, useMemo, useState } from 'react';
import * as RDialog from '@radix-ui/react-dialog';
import clsx from 'clsx';
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, Check, Clock, Copy, Plus, ShieldAlert, Trash2, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { ASSET_TYPES, ASSET_TYPE_LABELS, STEP_KINDS, type AssetType, type InspectionStep, type StepKind } from '@hydris/domain';
import { post, put } from '@/lib/api';
import { invalidatePaths } from '@/lib/query';
import { Button, Chip, IconButton, Input, Select, Switch, Textarea } from '@/ui';
import { Dialog, useToast } from '@/ui/overlay';
import { STEP_KIND_META, StepPreview } from './steps';
import { FormError, type Template } from './shared';

type Stage = 'basics' | 'safety' | 'steps' | 'review';
const STAGES: { key: Stage; label: string }[] = [
  { key: 'basics', label: 'Basics' },
  { key: 'safety', label: 'Safety' },
  { key: 'steps', label: 'Steps' },
  { key: 'review', label: 'Review' },
];

interface DraftStep {
  id: string; kind: StepKind; title: string; instruction: string; caution: string; required: boolean;
  measurand: string; unit: string; minText: string; maxText: string; options: string[]; abnormalOptions: string[];
}
interface Draft {
  name: string; description: string; assetType: AssetType | ''; estimatedMinutes: string; status: Template['status'];
  safetyNotices: string[]; steps: DraftStep[];
}
interface Problem { stage: Stage; message: string; step?: number }

const newId = () => `s-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const blankStep = (kind: StepKind): DraftStep => ({
  id: newId(), kind, title: '', instruction: '', caution: '', required: true, measurand: '', unit: '', minText: '', maxText: '',
  options: kind === 'choice' ? ['Normal', 'Abnormal'] : [], abnormalOptions: kind === 'choice' ? ['Abnormal'] : [],
});

function fromTemplate(t: Template | null): Draft {
  if (!t) return { name: '', description: '', assetType: '', estimatedMinutes: '', status: 'published', safetyNotices: [], steps: [blankStep('check')] };
  return {
    name: t.name, description: t.description ?? '', assetType: t.assetType ?? '', estimatedMinutes: t.estimatedMinutes ? String(t.estimatedMinutes) : '', status: t.status,
    safetyNotices: [...t.safetyNotices],
    steps: t.steps.map((s) => ({
      id: s.id, kind: s.kind, title: s.title, instruction: s.instruction ?? '', caution: s.caution ?? '', required: s.required, measurand: s.measurand ?? '', unit: s.unit ?? '',
      minText: s.expectedMin !== undefined ? String(s.expectedMin) : '', maxText: s.expectedMax !== undefined ? String(s.expectedMax) : '',
      options: [...(s.options ?? [])], abnormalOptions: [...(s.abnormalOptions ?? [])],
    })),
  };
}

const num = (s: string) => (s.trim() === '' ? undefined : Number(s.replace(',', '.')));

function toStep(d: DraftStep): InspectionStep {
  const s: InspectionStep = { id: d.id, kind: d.kind, title: d.title.trim(), required: d.required };
  if (d.instruction.trim()) s.instruction = d.instruction.trim();
  if (d.caution.trim()) s.caution = d.caution.trim();
  if (d.kind === 'reading') {
    if (d.unit.trim()) s.unit = d.unit.trim();
    if (d.measurand.trim()) s.measurand = d.measurand.trim();
    const mn = num(d.minText), mx = num(d.maxText);
    if (mn !== undefined && Number.isFinite(mn)) s.expectedMin = mn;
    if (mx !== undefined && Number.isFinite(mx)) s.expectedMax = mx;
  }
  if (d.kind === 'choice') {
    const opts = d.options.map((o) => o.trim()).filter(Boolean);
    s.options = opts;
    s.abnormalOptions = d.abnormalOptions.filter((o) => opts.includes(o.trim())).map((o) => o.trim());
  }
  return s;
}

function validate(d: Draft): Problem[] {
  const p: Problem[] = [];
  const name = d.name.trim();
  if (name.length < 3 || name.length > 120) p.push({ stage: 'basics', message: 'Name must be 3–120 characters.' });
  if (d.description.length > 1000) p.push({ stage: 'basics', message: 'Description is limited to 1000 characters.' });
  if (d.estimatedMinutes.trim()) {
    const m = Number(d.estimatedMinutes);
    if (!Number.isInteger(m) || m < 1 || m > 600) p.push({ stage: 'basics', message: 'Estimated duration must be a whole number of minutes between 1 and 600.' });
  }
  if (d.safetyNotices.length > 10) p.push({ stage: 'safety', message: 'At most 10 safety notices.' });
  d.safetyNotices.forEach((n, i) => {
    if (!n.trim()) p.push({ stage: 'safety', message: `Safety notice ${i + 1} is empty — remove it or add text.` });
    if (n.length > 500) p.push({ stage: 'safety', message: `Safety notice ${i + 1} exceeds 500 characters.` });
  });
  if (!d.steps.length) p.push({ stage: 'steps', message: 'Add at least one step.' });
  if (d.steps.length > 60) p.push({ stage: 'steps', message: 'At most 60 steps per template.' });
  d.steps.forEach((s, i) => {
    const t = s.title.trim();
    if (t.length < 2 || t.length > 200) p.push({ stage: 'steps', step: i, message: `Step ${i + 1}: title must be 2–200 characters.` });
    if (s.instruction.length > 1000) p.push({ stage: 'steps', step: i, message: `Step ${i + 1}: instruction is limited to 1000 characters.` });
    if (s.caution.length > 500) p.push({ stage: 'steps', step: i, message: `Step ${i + 1}: caution is limited to 500 characters.` });
    if (s.kind === 'reading') {
      const mn = num(s.minText), mx = num(s.maxText);
      if (mn !== undefined && !Number.isFinite(mn)) p.push({ stage: 'steps', step: i, message: `Step ${i + 1}: expected minimum is not a number.` });
      if (mx !== undefined && !Number.isFinite(mx)) p.push({ stage: 'steps', step: i, message: `Step ${i + 1}: expected maximum is not a number.` });
      if (mn !== undefined && mx !== undefined && Number.isFinite(mn) && Number.isFinite(mx) && mn > mx) p.push({ stage: 'steps', step: i, message: `Step ${i + 1}: minimum is greater than maximum.` });
      if (s.unit.length > 20) p.push({ stage: 'steps', step: i, message: `Step ${i + 1}: unit is limited to 20 characters.` });
    }
    if (s.kind === 'choice') {
      const opts = s.options.map((o) => o.trim()).filter(Boolean);
      if (opts.length < 2) p.push({ stage: 'steps', step: i, message: `Step ${i + 1}: a choice needs at least two options.` });
      if (opts.length > 12) p.push({ stage: 'steps', step: i, message: `Step ${i + 1}: at most 12 options.` });
      if (new Set(opts).size !== opts.length) p.push({ stage: 'steps', step: i, message: `Step ${i + 1}: options must be unique.` });
      if (opts.some((o) => o.length > 80)) p.push({ stage: 'steps', step: i, message: `Step ${i + 1}: options are limited to 80 characters.` });
    }
  });
  return p;
}

/** Usechannel-style guided builder: stepper pills, editor on the left, lime live-preview panel on the right. */
export function TemplateBuilder({ open, onOpenChange, template }: { open: boolean; onOpenChange: (v: boolean) => void; template: Template | null }) {
  const [draft, setDraft] = useState<Draft>(() => fromTemplate(template));
  const [stage, setStage] = useState<Stage>('basics');
  const [sel, setSel] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [showProblems, setShowProblems] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();

  useEffect(() => {
    if (open) {
      setDraft(fromTemplate(template));
      setStage('basics');
      setSel(0);
      setErr(null);
      setShowProblems(false);
    }
  }, [open, template]);

  const problems = useMemo(() => validate(draft), [draft]);
  const stageIdx = STAGES.findIndex((s) => s.key === stage);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setStep = (i: number, patch: Partial<DraftStep>) => setDraft((d) => ({ ...d, steps: d.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  const moveStep = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= draft.steps.length) return;
    setDraft((d) => {
      const steps = [...d.steps];
      [steps[i], steps[j]] = [steps[j]!, steps[i]!];
      return { ...d, steps };
    });
    setSel(j);
  };
  const removeStep = (i: number) => {
    setDraft((d) => ({ ...d, steps: d.steps.filter((_, j) => j !== i) }));
    setSel((s) => Math.max(0, s >= i ? s - 1 : s));
  };
  const addStep = (kind: StepKind) => {
    setDraft((d) => ({ ...d, steps: [...d.steps, blankStep(kind)] }));
    setSel(draft.steps.length);
  };
  const duplicateStep = (i: number) => {
    setDraft((d) => {
      const src = d.steps[i];
      if (!src) return d;
      const steps = [...d.steps];
      steps.splice(i + 1, 0, { ...src, id: newId(), title: `${src.title} (copy)`.slice(0, 200), options: [...src.options], abnormalOptions: [...src.abnormalOptions] });
      return { ...d, steps };
    });
    setSel(i + 1);
  };

  const save = async () => {
    setShowProblems(true);
    if (problems.length) {
      setStage(problems[0]!.stage);
      if (problems[0]!.step !== undefined) setSel(problems[0]!.step);
      return;
    }
    setBusy(true);
    setErr(null);
    const body = {
      name: draft.name.trim(), description: draft.description.trim() || null, assetType: draft.assetType || null,
      estimatedMinutes: draft.estimatedMinutes.trim() ? Number(draft.estimatedMinutes) : null, status: draft.status,
      safetyNotices: draft.safetyNotices.map((n) => n.trim()).filter(Boolean), steps: draft.steps.map(toStep),
    };
    try {
      if (template) await put(`/inspection-templates/${template.id}`, body);
      else await post('/inspection-templates', body);
      invalidatePaths(qc, ['/inspection-templates']);
      toast({ title: template ? `Template saved as version ${template.version + 1}` : 'Template created', tone: 'ok' });
      onOpenChange(false);
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };

  const current = draft.steps[sel];
  const stageProblems = (k: Stage) => problems.filter((p) => p.stage === k).length;

  return (
    <RDialog.Root open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-40 bg-scrim backdrop-blur-[2px] fade-in" />
        <RDialog.Content className="fixed left-1/2 top-1/2 z-50 flex h-[min(94dvh,920px)] w-[min(1220px,calc(100vw-16px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[var(--radius-2xl)] border border-line-2 bg-surface shadow-[var(--shadow-3)] fade-in focus:outline-none">
          {/* Header + stepper */}
          <div className="flex flex-wrap items-center gap-4 border-b border-line px-5 py-4 sm:px-7">
            <div className="min-w-0 flex-1">
              <RDialog.Title className="t-section truncate">{template ? `Edit template · ${template.name}` : 'New inspection template'}</RDialog.Title>
              <RDialog.Description className="mt-1 text-sm text-text-2">
                {template ? `Currently version ${template.version}. Saving creates version ${template.version + 1}; inspections already issued keep the steps they were created with.` : 'Define the round once; every inspection issued from it snapshots these steps.'}
              </RDialog.Description>
            </div>
            <RDialog.Close className="icon-btn icon-btn-sm" aria-label="Close builder" disabled={busy}><X size={16} /></RDialog.Close>
            <ol className="flex w-full gap-1.5 overflow-x-auto scrollbar-none" aria-label="Builder steps">
              {STAGES.map((s, i) => {
                const active = s.key === stage;
                const done = i < stageIdx;
                const bad = showProblems && stageProblems(s.key) > 0;
                return (
                  <li key={s.key} className="flex-none">
                    <button type="button" onClick={() => setStage(s.key)} aria-current={active ? 'step' : undefined}
                      className={clsx('inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm transition-colors',
                        active ? 'border-transparent bg-lime text-lime-ink' : done ? 'border-line-2 bg-surface-2 text-text' : 'border-line bg-transparent text-text-2 hover:text-text')}>
                      <span className={clsx('grid h-6 w-6 place-items-center rounded-full text-[12px] num', active ? 'bg-lime-ink text-lime' : done ? 'bg-ok text-ink' : 'bg-surface-3')}>
                        {done && !bad ? <Check size={13} aria-hidden /> : i + 1}
                      </span>
                      {s.label}
                      {s.key === 'steps' && <span className="num text-xs opacity-70">{draft.steps.length}</span>}
                      {bad && <AlertTriangle size={14} className={active ? '' : 'text-high-text'} aria-label={`${stageProblems(s.key)} issue(s)`} />}
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>

          {/* Body: editor | preview */}
          <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_420px] lg:overflow-hidden">
            <div className="min-h-0 px-5 py-5 sm:px-7 lg:overflow-y-auto">
              {stage === 'basics' && (
                <div className="grid max-w-2xl gap-4 fade-in">
                  <Input label="Template name" value={draft.name} onChange={(e) => set('name', e.target.value)} maxLength={120} placeholder="e.g. Blower daily round" autoFocus />
                  <Textarea label="Description" hint="Shown to supervisors when assigning work." value={draft.description} onChange={(e) => set('description', e.target.value)} maxLength={1000} />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Select label="Asset type" hint="Used to match templates when dispatching rounds." value={draft.assetType} onChange={(e) => set('assetType', e.target.value as AssetType | '')}
                      placeholder="Any asset type" options={ASSET_TYPES.map((t) => ({ value: t, label: ASSET_TYPE_LABELS[t] }))} />
                    <Input label="Estimated minutes" inputMode="numeric" value={draft.estimatedMinutes} onChange={(e) => set('estimatedMinutes', e.target.value.replace(/[^\d]/g, ''))} placeholder="e.g. 15" className="num" />
                  </div>
                  <div className="field">
                    <span className="field-label">Status</span>
                    <div className="capsule w-fit" role="radiogroup" aria-label="Template status">
                      {(['published', 'draft', 'archived'] as const).map((s) => (
                        <button key={s} type="button" role="radio" aria-checked={draft.status === s} data-active={draft.status === s} onClick={() => set('status', s)}>{s[0]!.toUpperCase() + s.slice(1)}</button>
                      ))}
                    </div>
                    <span className="field-hint">Only published templates can be used to issue new inspections.</span>
                  </div>
                </div>
              )}

              {stage === 'safety' && (
                <div className="grid max-w-2xl gap-4 fade-in">
                  <p className="text-sm text-text-2">Safety notices are shown before the first step, on the console and on the glasses. Keep each one short and specific (PPE, isolation, hazards).</p>
                  {draft.safetyNotices.map((n, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <span className="mt-3 grid h-6 w-6 flex-none place-items-center rounded-full bg-[rgb(245_184_61/0.15)] text-[12px] text-medium-text num">{i + 1}</span>
                      <Textarea aria-label={`Safety notice ${i + 1}`} className="!min-h-[64px]" value={n} maxLength={500} onChange={(e) => set('safetyNotices', draft.safetyNotices.map((x, j) => (j === i ? e.target.value : x)))} />
                      <IconButton label={`Remove safety notice ${i + 1}`} size="sm" tone="ghost" className="mt-2" onClick={() => set('safetyNotices', draft.safetyNotices.filter((_, j) => j !== i))}><Trash2 size={15} /></IconButton>
                    </div>
                  ))}
                  {!draft.safetyNotices.length && <p className="rounded-2xl border border-dashed border-line-2 p-5 text-sm text-muted">No safety notices. Add at least one if the round involves rotating equipment, chemicals or confined spaces.</p>}
                  <Button size="sm" className="w-fit" icon={<Plus size={15} />} disabled={draft.safetyNotices.length >= 10} onClick={() => set('safetyNotices', [...draft.safetyNotices, ''])}>Add safety notice</Button>
                </div>
              )}

              {stage === 'steps' && (
                <div className="grid gap-5 fade-in xl:grid-cols-[300px_minmax(0,1fr)]">
                  <div className="grid content-start gap-2">
                    <div className="t-label">Steps · {draft.steps.length}/60</div>
                    <ol className="grid gap-1.5">
                      {draft.steps.map((s, i) => {
                        const bad = showProblems && problems.some((p) => p.step === i);
                        return (
                          <li key={s.id} className={clsx('flex items-center gap-1 rounded-2xl border pr-1', i === sel ? 'border-lime/60 bg-surface-2' : 'border-line bg-bg-2', bad && 'border-[rgb(255_40_0/0.6)]')}>
                            <button type="button" onClick={() => setSel(i)} aria-current={i === sel ? 'true' : undefined} className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left">
                              <span className="num w-5 flex-none text-xs text-muted">{i + 1}</span>
                              <span className="flex-none text-text-2">{STEP_KIND_META[s.kind].icon}</span>
                              <span className={clsx('truncate text-sm', !s.title && 'text-muted')}>{s.title || 'Untitled step'}</span>
                              {s.required && <span className="ml-auto flex-none text-[11px] text-lime" title="Required">●<span className="sr-only">Required</span></span>}
                            </button>
                            <button type="button" className="icon-btn icon-btn-sm !h-8 !w-8 icon-btn-ghost" aria-label={`Move step ${i + 1} up`} disabled={i === 0} onClick={() => moveStep(i, -1)}><ArrowDown size={14} className="rotate-180" /></button>
                            <button type="button" className="icon-btn icon-btn-sm !h-8 !w-8 icon-btn-ghost" aria-label={`Move step ${i + 1} down`} disabled={i === draft.steps.length - 1} onClick={() => moveStep(i, 1)}><ArrowDown size={14} /></button>
                          </li>
                        );
                      })}
                    </ol>
                    <div className="mt-2 grid gap-1.5">
                      <div className="t-label">Add a step</div>
                      <div className="flex flex-wrap gap-1.5">
                        {STEP_KINDS.map((k) => (
                          <button key={k} type="button" className="chip hover:bg-surface-3 disabled:opacity-40" disabled={draft.steps.length >= 60} onClick={() => addStep(k)} title={STEP_KIND_META[k].hint}>
                            <Plus size={12} aria-hidden />{STEP_KIND_META[k].label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {current ? (
                    <StepEditor key={current.id} step={current} index={sel} onChange={(p) => setStep(sel, p)}
                      onRemove={draft.steps.length > 1 ? () => removeStep(sel) : undefined} onDuplicate={() => duplicateStep(sel)} />
                  ) : <p className="text-sm text-muted">Add a step to begin.</p>}
                </div>
              )}

              {stage === 'review' && (
                <div className="grid max-w-2xl gap-4 fade-in">
                  <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <ReviewStat label="Steps" value={draft.steps.length} />
                    <ReviewStat label="Required" value={draft.steps.filter((s) => s.required).length} />
                    <ReviewStat label="Safety notices" value={draft.safetyNotices.filter((n) => n.trim()).length} />
                    <ReviewStat label="Est. minutes" value={draft.estimatedMinutes || '—'} />
                  </dl>
                  {problems.length ? (
                    <div className="rounded-2xl border border-[rgb(255_40_0/0.35)] bg-[rgb(255_40_0/0.06)] p-4">
                      <div className="mb-2 font-medium">Fix {problems.length} issue{problems.length > 1 ? 's' : ''} before saving</div>
                      <ul className="grid gap-1.5 text-sm">
                        {problems.map((p, i) => (
                          <li key={i}>
                            <button type="button" className="text-left text-critical-text underline-offset-2 hover:underline" onClick={() => { setStage(p.stage); if (p.step !== undefined) setSel(p.step); }}>{p.message}</button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p className="flex items-center gap-2 rounded-2xl border border-[rgb(0_254_33/0.3)] bg-[rgb(0_254_33/0.06)] p-4 text-sm"><Check size={16} className="text-ok-text" aria-hidden />Ready to save as <b className="font-medium">{draft.status}</b>.</p>
                  )}
                  {template && <p className="text-sm text-text-2">Existing inspections are not changed — they keep the step snapshot (template v{template.version}) they were issued with.</p>}
                </div>
              )}

              {showProblems && stage !== 'review' && stageProblems(stage) > 0 && (
                <ul className="mt-5 grid max-w-2xl gap-1 text-sm text-critical-text" role="alert">
                  {problems.filter((p) => p.stage === stage).map((p, i) => <li key={i}>• {p.message}</li>)}
                </ul>
              )}
              {!!err && <div className="mt-5 max-w-2xl"><FormError error={err} /></div>}
            </div>

            {/* Live preview — the lime focal surface */}
            <aside className="card-lime m-3 flex min-h-0 flex-col rounded-[var(--radius-xl)] p-4 sm:m-4 lg:ml-0 lg:overflow-y-auto" aria-label="Live preview">
              <div className="flex items-center justify-between gap-2 px-1">
                <span className="text-sm font-medium">Live preview</span>
                <span className="chip chip-dark-on-lime">What the operator sees</span>
              </div>
              <div className="mt-3 flex-1 rounded-[var(--radius-lg)] bg-bg p-3 text-text">
                <PreviewPane draft={draft} stage={stage} sel={sel} />
              </div>
            </aside>
          </div>

          {/* Footer */}
          <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3 sm:px-7">
            <Button variant="ghost" icon={<ArrowLeft size={15} />} disabled={stageIdx === 0 || busy} onClick={() => setStage(STAGES[stageIdx - 1]!.key)}>Back</Button>
            <span className="text-xs text-muted">{stageIdx + 1} / {STAGES.length}</span>
            <div className="ml-auto flex flex-wrap gap-2">
              {stageIdx < STAGES.length - 1 && <Button variant="secondary" disabled={busy} onClick={() => setStage(STAGES[stageIdx + 1]!.key)}>Next <ArrowRight size={15} aria-hidden /></Button>}
              <Button variant="primary" busy={busy} onClick={() => void save()}>{template ? 'Save new version' : 'Create template'}</Button>
            </div>
          </div>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

function ReviewStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card-paper rounded-2xl p-4">
      <dt className="text-xs opacity-70">{label}</dt>
      <dd className="t-kpi-sm mt-1">{value}</dd>
    </div>
  );
}

function StepEditor({ step, index, onChange, onRemove, onDuplicate }: { step: DraftStep; index: number; onChange: (p: Partial<DraftStep>) => void; onRemove?: () => void; onDuplicate: () => void }) {
  const changeKind = (kind: StepKind) => {
    const p: Partial<DraftStep> = { kind };
    if (kind === 'choice' && !step.options.length) Object.assign(p, { options: ['Normal', 'Abnormal'], abnormalOptions: ['Abnormal'] });
    onChange(p);
  };
  return (
    <div className="grid content-start gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="t-card">Step {index + 1}</span>
        <div className="ml-auto flex gap-1.5">
          <IconButton label="Duplicate step" size="sm" onClick={onDuplicate}><Copy size={15} /></IconButton>
          {onRemove && <IconButton label="Remove step" size="sm" onClick={onRemove}><Trash2 size={15} /></IconButton>}
        </div>
      </div>
      <div className="field">
        <span className="field-label">Response type</span>
        <div className="capsule max-w-full overflow-x-auto scrollbar-none" role="radiogroup" aria-label="Response type">
          {STEP_KINDS.map((k) => (
            <button key={k} type="button" role="radio" aria-checked={step.kind === k} data-active={step.kind === k} onClick={() => changeKind(k)}>{STEP_KIND_META[k].icon}{STEP_KIND_META[k].label}</button>
          ))}
        </div>
        <span className="field-hint">{STEP_KIND_META[step.kind].hint}.</span>
      </div>
      <Input label="Title" value={step.title} maxLength={200} onChange={(e) => onChange({ title: e.target.value })} placeholder="e.g. Check bearing temperature" />
      <Textarea label="Instruction" hint="How to perform the step. Plain language, one action per line." value={step.instruction} maxLength={1000} onChange={(e) => onChange({ instruction: e.target.value })} />
      <Input label="Caution (optional)" hint="Shown highlighted before the step." value={step.caution} maxLength={500} onChange={(e) => onChange({ caution: e.target.value })} placeholder="e.g. Hot surface — use IR thermometer" />
      <Switch checked={step.required} onChange={(v) => onChange({ required: v })} label="Required to submit" />

      {step.kind === 'reading' && (
        <div className="grid gap-4 rounded-2xl border border-line p-4 sm:grid-cols-2">
          <Input label="Unit" value={step.unit} maxLength={20} onChange={(e) => onChange({ unit: e.target.value })} placeholder="e.g. °C, bar, mg/L" />
          <Input label="Measurand (optional)" value={step.measurand} maxLength={40} onChange={(e) => onChange({ measurand: e.target.value })} placeholder="e.g. temperature" />
          <Input label="Expected minimum" inputMode="decimal" className="num" value={step.minText} onChange={(e) => onChange({ minText: e.target.value })} placeholder="none" />
          <Input label="Expected maximum" inputMode="decimal" className="num" value={step.maxText} onChange={(e) => onChange({ maxText: e.target.value })} placeholder="none" />
          <p className="text-xs text-muted sm:col-span-2">Values outside the range are recorded as abnormal and open a follow-up maintenance request on submit.</p>
        </div>
      )}

      {step.kind === 'choice' && (
        <div className="grid gap-2 rounded-2xl border border-line p-4">
          <div className="flex items-center justify-between"><span className="field-label">Options</span><span className="text-xs text-muted">Mark options that indicate an abnormal condition</span></div>
          {step.options.map((o, i) => {
            const abn = step.abnormalOptions.includes(o);
            return (
              <div key={i} className="flex items-center gap-2">
                <input className="input !min-h-[40px]" aria-label={`Option ${i + 1}`} value={o} maxLength={80}
                  onChange={(e) => onChange({ options: step.options.map((x, j) => (j === i ? e.target.value : x)), abnormalOptions: abn ? step.abnormalOptions.map((x) => (x === o ? e.target.value : x)) : step.abnormalOptions })} />
                <button type="button" aria-pressed={abn} onClick={() => onChange({ abnormalOptions: abn ? step.abnormalOptions.filter((x) => x !== o) : [...step.abnormalOptions, o] })}
                  className={clsx('chip flex-none', abn ? 'chip-high' : 'chip-outline')}><ShieldAlert size={12} aria-hidden />{abn ? 'Abnormal' : 'Normal'}</button>
                <IconButton label={`Remove option ${i + 1}`} size="sm" tone="ghost" onClick={() => onChange({ options: step.options.filter((_, j) => j !== i), abnormalOptions: step.abnormalOptions.filter((x) => x !== o) })}><Trash2 size={14} /></IconButton>
              </div>
            );
          })}
          <Button size="sm" className="w-fit" icon={<Plus size={14} />} disabled={step.options.length >= 12} onClick={() => onChange({ options: [...step.options, ''] })}>Add option</Button>
        </div>
      )}
    </div>
  );
}

function PreviewPane({ draft, stage, sel }: { draft: Draft; stage: Stage; sel: number }) {
  const steps = draft.steps.map(toStep);
  const notices = draft.safetyNotices.map((n) => n.trim()).filter(Boolean);
  if (stage === 'basics') {
    return (
      <div className="grid gap-3">
        <div className="rounded-[var(--radius-lg)] border border-line-2 bg-bg-2 p-5">
          <div className="t-eyebrow">Inspection</div>
          <div className="mt-2 text-[19px] font-medium leading-snug">{draft.name.trim() || <span className="text-muted">Template name</span>}</div>
          {draft.description.trim() && <p className="mt-2 text-sm text-text-2">{draft.description}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            {draft.assetType && <Chip>{ASSET_TYPE_LABELS[draft.assetType]}</Chip>}
            <Chip><span className="num">{steps.length}</span> steps</Chip>
            {draft.estimatedMinutes && <Chip><Clock size={12} aria-hidden /><span className="num">{draft.estimatedMinutes}</span> min</Chip>}
            <Chip tone={draft.status === 'published' ? 'ok' : 'outline'}>{draft.status}</Chip>
          </div>
        </div>
        <p className="px-1 text-xs text-muted">Inspections issued from this template are titled “{draft.name.trim() || 'Template name'} · ASSET-TAG”.</p>
      </div>
    );
  }
  if (stage === 'safety') return <SafetyCard notices={notices} empty="No safety notices — operators go straight to step 1." />;
  if (stage === 'steps') {
    const s = steps[sel];
    return s ? (
      <div className="grid gap-3">
        {sel === 0 && notices.length > 0 && <SafetyCard notices={notices} compact />}
        <StepPreview step={s} index={sel} total={steps.length} />
        <div className="flex justify-center gap-1" aria-hidden>
          {steps.map((x, i) => <span key={x.id} className={clsx('h-1.5 rounded-full', i === sel ? 'w-5 bg-lime' : 'w-1.5 bg-surface-3')} />)}
        </div>
      </div>
    ) : <p className="p-4 text-sm text-muted">No step selected.</p>;
  }
  return (
    <div className="grid gap-2">
      {notices.length > 0 && <SafetyCard notices={notices} compact />}
      {steps.map((s, i) => <StepPreview key={s.id} step={s} index={i} total={steps.length} compact />)}
    </div>
  );
}

export function SafetyCard({ notices, compact, empty }: { notices: string[]; compact?: boolean; empty?: string }) {
  if (!notices.length) return empty ? <p className="p-4 text-sm text-muted">{empty}</p> : null;
  return (
    <section className={clsx('rounded-[var(--radius-lg)] border border-[rgb(245_184_61/0.4)] bg-[rgb(245_184_61/0.07)]', compact ? 'p-4' : 'p-5')} aria-label="Safety notices">
      <div className="flex items-center gap-2 font-medium text-medium-text"><ShieldAlert size={17} aria-hidden />Safety first</div>
      <ul className="mt-3 grid gap-2">
        {notices.map((n, i) => (
          <li key={i} className="flex gap-2.5 text-sm leading-relaxed">
            <span className="num mt-0.5 grid h-5 w-5 flex-none place-items-center rounded-full bg-[rgb(245_184_61/0.18)] text-[11px] text-medium-text">{i + 1}</span>
            <span>{n}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Read-only template preview for people who cannot edit templates. */
export function TemplatePreviewDialog({ template, onOpenChange }: { template: Template | null; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={!!template} onOpenChange={onOpenChange} wide title={template?.name ?? 'Template'}
      description={template ? `Version ${template.version} · ${template.steps.length} steps${template.estimatedMinutes ? ` · about ${template.estimatedMinutes} min` : ''}${template.assetType ? ` · ${ASSET_TYPE_LABELS[template.assetType]}` : ''}` : undefined}>
      {template && (
        <div className="grid gap-3">
          {template.description && <p className="text-sm text-text-2">{template.description}</p>}
          <SafetyCard notices={template.safetyNotices} compact />
          {template.steps.map((s, i) => <StepPreview key={s.id} step={s} index={i} total={template.steps.length} compact />)}
        </div>
      )}
    </Dialog>
  );
}
