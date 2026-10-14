'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { AlertTriangle, Camera, CheckSquare, Gauge, Glasses, ListChecks, Monitor, Type, X, Check } from 'lucide-react';
import { stepOutcome, type InspectionStep, type StepKind, type StepValue } from '@hydris/domain';
import { fmtDateTime } from '@/lib/format';
import { Button, Chip } from '@/ui';
import { ACCEPTED_IMAGES, AttachmentThumb, UploadButton } from './attachments';
import { describeError, type StepResponse } from './shared';

export const STEP_KIND_META: Record<StepKind, { label: string; hint: string; icon: ReactNode }> = {
  check: { label: 'Check', hint: 'Confirm a condition is OK or flag it', icon: <CheckSquare size={15} aria-hidden /> },
  reading: { label: 'Reading', hint: 'Record a measured value against an expected range', icon: <Gauge size={15} aria-hidden /> },
  choice: { label: 'Choice', hint: 'Pick one of a fixed set of observations', icon: <ListChecks size={15} aria-hidden /> },
  text: { label: 'Text', hint: 'Free-text observation', icon: <Type size={15} aria-hidden /> },
  photo: { label: 'Photo', hint: 'Capture photographic evidence', icon: <Camera size={15} aria-hidden /> },
};

export function rangeText(step: Pick<InspectionStep, 'expectedMin' | 'expectedMax' | 'unit'>) {
  const u = step.unit ? ` ${step.unit}` : '';
  if (step.expectedMin !== undefined && step.expectedMax !== undefined) return `${step.expectedMin}–${step.expectedMax}${u}`;
  if (step.expectedMin !== undefined) return `≥ ${step.expectedMin}${u}`;
  if (step.expectedMax !== undefined) return `≤ ${step.expectedMax}${u}`;
  return null;
}

export function OutcomeChip({ outcome }: { outcome: 'ok' | 'abnormal' | 'na' }) {
  if (outcome === 'abnormal') return <Chip tone="high"><AlertTriangle size={12} aria-hidden />Abnormal</Chip>;
  if (outcome === 'na') return <Chip tone="outline">N/A</Chip>;
  return <Chip tone="ok"><Check size={12} aria-hidden />OK</Chip>;
}

export function ViaChip({ deviceId }: { deviceId: string | null }) {
  return deviceId
    ? <Chip tone="cobalt" title="Recorded on paired field glasses"><Glasses size={12} aria-hidden />Glasses</Chip>
    : <Chip tone="outline" title="Recorded in the web console"><Monitor size={12} aria-hidden />Console</Chip>;
}

/** How a template step is presented to the operator (used by the builder preview and read-only template preview). */
export function StepPreview({ step, index, total, compact }: { step: InspectionStep; index: number; total: number; compact?: boolean }) {
  const meta = STEP_KIND_META[step.kind];
  const range = step.kind === 'reading' ? rangeText(step) : null;
  return (
    <div className={clsx('rounded-[var(--radius-lg)] border border-line-2 bg-bg-2', compact ? 'p-4' : 'p-5')}>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span className="num">Step {index + 1} of {total}</span>
        <span aria-hidden>·</span>
        <span className="inline-flex items-center gap-1">{meta.icon}{meta.label}</span>
        {step.required ? <Chip tone="lime" className="ml-auto !h-6">Required</Chip> : <Chip tone="outline" className="ml-auto !h-6">Optional</Chip>}
      </div>
      <div className="mt-3 text-[17px] font-medium leading-snug">{step.title || <span className="text-muted">Untitled step</span>}</div>
      {step.caution && (
        <div className="mt-3 flex gap-2 rounded-xl border border-[rgb(245_184_61/0.35)] bg-[rgb(245_184_61/0.08)] px-3 py-2 text-sm text-[#f7c96a]">
          <AlertTriangle size={15} className="mt-0.5 flex-none" aria-hidden /><span>{step.caution}</span>
        </div>
      )}
      {step.instruction && <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-text-2">{step.instruction}</p>}
      <div className="mt-4">
        {step.kind === 'check' && (
          <div className="flex flex-wrap gap-2" aria-hidden>
            <span className="chip chip-ok">OK / as expected</span><span className="chip chip-high">Not OK</span>
          </div>
        )}
        {step.kind === 'reading' && (
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex h-11 min-w-[140px] items-center justify-between gap-3 rounded-[var(--radius-md)] border border-line-2 px-4 text-muted" aria-hidden>
              <span className="num">0.00</span><span className="text-xs">{step.unit || 'unit'}</span>
            </span>
            <span className="text-xs text-muted">{range ? <>Expected <span className="num text-text-2">{range}</span>{step.measurand ? ` · ${step.measurand}` : ''}</> : 'No expected range — every value is accepted as OK'}</span>
          </div>
        )}
        {step.kind === 'choice' && (
          <div className="flex flex-wrap gap-2">
            {(step.options ?? []).length ? (step.options ?? []).map((o) => (
              <span key={o} className={clsx('chip', step.abnormalOptions?.includes(o) ? 'chip-high' : 'chip-outline')}>{o}{step.abnormalOptions?.includes(o) && <span className="sr-only"> (abnormal)</span>}</span>
            )) : <span className="text-xs text-muted">Add at least two options.</span>}
          </div>
        )}
        {step.kind === 'text' && <div className="h-16 rounded-[var(--radius-md)] border border-dashed border-line-2" aria-hidden />}
        {step.kind === 'photo' && (
          <div className="grid h-20 place-items-center rounded-[var(--radius-md)] border border-dashed border-line-2 text-xs text-muted"><span className="inline-flex items-center gap-2"><Camera size={15} aria-hidden />Capture photo</span></div>
        )}
      </div>
    </div>
  );
}

/** Human readable recorded value. */
export function ResponseValue({ step, r }: { step: InspectionStep; r: StepResponse }) {
  const v = r.value;
  switch (v.kind) {
    case 'check':
      return <span>{v.checked && !v.abnormal ? 'Confirmed OK' : 'Not OK'}</span>;
    case 'reading': {
      const range = rangeText(step);
      return <span><span className="num text-[17px]">{v.value}</span>{step.unit ? <span className="text-sm text-muted"> {step.unit}</span> : null}{range && <span className="text-xs text-muted"> · expected {range}</span>}</span>;
    }
    case 'choice':
      return <span>{v.option}</span>;
    case 'text':
      return <span className="whitespace-pre-line">{v.text}</span>;
    case 'photo':
      return <AttachmentThumb id={v.attachmentId} alt={`Photo evidence for ${step.title}`} size={112} />;
  }
}

export function ResponseMeta({ r }: { r: StepResponse }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
      <OutcomeChip outcome={r.outcome} />
      <ViaChip deviceId={r.deviceId} />
      <span className="num">Recorded {fmtDateTime(r.recordedAt, { second: '2-digit' })}</span>
    </div>
  );
}

/** Input controls for executing one step from the console. */
export function StepRecorder({ step, inspectionId, current, onRecord }: {
  step: InspectionStep; inspectionId: string; current?: StepResponse; onRecord: (value: StepValue, note: string | undefined) => Promise<void>;
}) {
  const uid = useId();
  const [value, setValue] = useState<StepValue | null>(current?.value ?? null);
  const [readingText, setReadingText] = useState(current?.value.kind === 'reading' ? String(current.value.value) : '');
  const [note, setNote] = useState(current?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => setSaved(false), [value, note]);

  const commit = async (v: StepValue | null) => {
    if (!v) return;
    setBusy(true);
    setErr(null);
    try {
      await onRecord(v, note.trim() || undefined);
      setSaved(true);
    } catch (e) {
      setErr(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  let readingValue: StepValue | null = null;
  if (step.kind === 'reading') {
    const n = Number(readingText.replace(',', '.'));
    readingValue = readingText.trim() !== '' && Number.isFinite(n) ? { kind: 'reading', value: n } : null;
  }
  const pending = step.kind === 'reading' ? readingValue : value;
  const preview = pending ? stepOutcome(step, pending) : null;
  const range = rangeText(step);

  return (
    <div className="grid gap-3 rounded-[var(--radius-lg)] border border-line-2 bg-surface-2/40 p-4">
      {step.kind === 'check' && (
        <div role="radiogroup" aria-label={`${step.title} result`} className="flex flex-wrap gap-2">
          {[{ ok: true, label: 'OK / as expected' }, { ok: false, label: 'Not OK — flag abnormal' }].map((o) => {
            const sel = value?.kind === 'check' && (o.ok ? value.checked && !value.abnormal : !value.checked || !!value.abnormal);
            return (
              <button key={String(o.ok)} type="button" role="radio" aria-checked={sel} onClick={() => setValue(o.ok ? { kind: 'check', checked: true } : { kind: 'check', checked: false, abnormal: true })}
                className={clsx('btn btn-sm', sel ? (o.ok ? 'bg-ok text-ink' : 'bg-high text-ink') : 'btn-secondary')}>
                {o.ok ? <Check size={15} aria-hidden /> : <X size={15} aria-hidden />}{o.label}
              </button>
            );
          })}
        </div>
      )}

      {step.kind === 'reading' && (
        <div className="grid gap-1.5">
          <label htmlFor={`${uid}-r`} className="field-label">Measured value{step.unit ? ` (${step.unit})` : ''}</label>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative w-[180px]">
              <input id={`${uid}-r`} inputMode="decimal" className="input num pr-14" value={readingText} onChange={(e) => setReadingText(e.target.value)} aria-describedby={`${uid}-rh`}
                aria-invalid={readingText.trim() !== '' && !readingValue ? true : undefined} placeholder="0.00" />
              {step.unit && <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs text-muted">{step.unit}</span>}
            </div>
            <span id={`${uid}-rh`} className="text-xs text-muted">{range ? <>Expected <span className="num text-text-2">{range}</span></> : 'No expected range'}</span>
          </div>
          {readingText.trim() !== '' && !readingValue && <span className="field-error">Enter a number.</span>}
        </div>
      )}

      {step.kind === 'choice' && (
        <div role="radiogroup" aria-label={`${step.title} observation`} className="flex flex-wrap gap-2">
          {(step.options ?? []).map((o) => {
            const sel = value?.kind === 'choice' && value.option === o;
            const abn = step.abnormalOptions?.includes(o);
            return (
              <button key={o} type="button" role="radio" aria-checked={sel} onClick={() => setValue({ kind: 'choice', option: o })}
                className={clsx('btn btn-sm', sel ? (abn ? 'bg-high text-ink' : 'btn-light') : 'btn-secondary')}>
                {o}{abn && <span className="text-[11px] opacity-70">(abnormal)</span>}
              </button>
            );
          })}
        </div>
      )}

      {step.kind === 'text' && (
        <div className="field">
          <label htmlFor={`${uid}-t`}>Observation</label>
          <textarea id={`${uid}-t`} className="textarea" maxLength={4000} value={value?.kind === 'text' ? value.text : ''} onChange={(e) => setValue(e.target.value.trim() ? { kind: 'text', text: e.target.value } : null)} />
        </div>
      )}

      {step.kind === 'photo' && (
        <div className="flex flex-wrap items-center gap-4">
          {current?.value.kind === 'photo' && <AttachmentThumb id={current.value.attachmentId} alt={`Current photo for ${step.title}`} size={72} />}
          <UploadButton ownerType="inspection" ownerId={inspectionId} accept={ACCEPTED_IMAGES} label={current ? 'Replace photo' : 'Upload photo'}
            onUploaded={async (a) => { const v: StepValue = { kind: 'photo', attachmentId: a.id }; setValue(v); await commit(v); }} />
          <span className="text-xs text-muted">JPEG, PNG or WebP up to 10 MB. Uploading records the step.</span>
        </div>
      )}

      {step.kind !== 'photo' && (
        <div className="field">
          <label htmlFor={`${uid}-n`}>Note <span className="text-muted">(optional)</span></label>
          <input id={`${uid}-n`} className="input" maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything the reviewer should know" />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {step.kind !== 'photo' && (
          <Button size="sm" variant="primary" busy={busy} disabled={!pending} onClick={() => void commit(pending)}>{current ? 'Update response' : 'Record response'}</Button>
        )}
        {preview && step.kind !== 'photo' && <span className="text-xs text-muted">Will be recorded as</span>}
        {preview && step.kind !== 'photo' && <OutcomeChip outcome={preview} />}
        {saved && !busy && <span role="status" className="text-xs text-ok">Saved</span>}
      </div>
      {err && <p role="alert" className="field-error">{err}</p>}
    </div>
  );
}
