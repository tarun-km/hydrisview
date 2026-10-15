'use client';

import { useState } from 'react';
import { Ban, ChevronLeft, ChevronRight, Cpu, FlaskConical, PenLine, ShieldCheck, Sparkles, UserRound } from 'lucide-react';
import { MEASURAND_DEFS, type Measurand } from '@hydris/domain';
import { post } from '@/lib/api';
import { useAction, useApi } from '@/lib/query';
import { fmtDateTime, fmtValue } from '@/lib/format';
import { Button, Capsule, Card, Chip, DataTable, ErrorState, Input, Select, Skeleton, Textarea, Timeline } from '@/ui';
import { Dialog } from '@/ui/overlay';
import { fieldErrors } from '@/console/work/shared';

export interface CorrectionView {
  id: string; action: 'correct' | 'invalidate'; originalValue: number; correctedValue: number | null; reason: string;
  correctedBy: { id: string; name: string | null } | null; createdAt: string;
}
export interface ReadingView {
  id: number; ts: string; receivedAt: string; quality: 'good' | 'uncertain' | 'bad'; source: 'gateway' | 'manual' | 'lab' | 'simulator'; synthetic: boolean;
  originalValue: number; effectiveValue: number | null; status: 'original' | 'corrected' | 'invalidated';
  recordedBy: { id: string | null; name: string | null } | null; corrections: CorrectionView[];
}
interface ReadingsResponse { total: number; limit: number; offset: number; readings: ReadingView[] }

const PAGE = 25;
const SOURCE: Record<ReadingView['source'], { label: string; icon: React.ReactNode; tone: 'outline' | 'cobalt' | 'synthetic' | 'default'; title: string }> = {
  gateway: { label: 'Instrument', icon: <Cpu size={12} aria-hidden />, tone: 'outline', title: 'Online instrument via edge gateway' },
  manual: { label: 'Manual', icon: <UserRound size={12} aria-hidden />, tone: 'default', title: 'Entered by a person on site' },
  lab: { label: 'Lab', icon: <FlaskConical size={12} aria-hidden />, tone: 'cobalt', title: 'Laboratory result' },
  simulator: { label: 'Simulated', icon: <Sparkles size={12} aria-hidden />, tone: 'synthetic', title: 'Synthetic value from the demo simulator' },
};

export function SourceChip({ source }: { source: ReadingView['source'] }) {
  const s = SOURCE[source];
  return <Chip tone={s.tone} title={s.title}>{s.icon}{s.label}</Chip>;
}

/** Raw readings with provenance; corrections are appended and never overwrite the original value. */
export function ReadingsCard({ sensor, canCorrect }: {
  sensor: { id: string; tag: string; unit: string; decimals: number; measurand: Measurand }; canCorrect: boolean;
}) {
  const [offset, setOffset] = useState(0);
  const [source, setSource] = useState<'all' | ReadingView['source']>('all');
  const [status, setStatus] = useState<'all' | 'corrected' | 'invalidated'>('all');
  const [selected, setSelected] = useState<ReadingView | null>(null);
  const q = useApi<ReadingsResponse>(`/telemetry/sensors/${sensor.id}/readings?limit=${PAGE}&offset=${offset}${source !== 'all' ? `&source=${source}` : ''}${status !== 'all' ? `&status=${status}` : ''}`,
    { placeholderData: (prev) => prev });
  const v = (n: number | null) => (n === null ? '—' : fmtValue(n, undefined, sensor.decimals));
  const total = q.data?.total ?? 0;

  return (
    <Card title={<h2 className="t-card">Readings</h2>}
      action={<div className="flex flex-wrap gap-2">
        <Select aria-label="Filter by source" value={source} onChange={(e) => { setSource(e.target.value as typeof source); setOffset(0); }}
          options={[{ value: 'all', label: 'All sources' }, { value: 'gateway', label: 'Instrument' }, { value: 'manual', label: 'Manual' }, { value: 'lab', label: 'Lab' }, { value: 'simulator', label: 'Simulated' }]} />
        <Capsule label="Filter by correction status" value={status} onChange={(s) => { setStatus(s); setOffset(0); }}
          options={[{ value: 'all', label: 'All' }, { value: 'corrected', label: 'Corrected' }, { value: 'invalidated', label: 'Invalidated' }]} />
      </div>}>
      <p className="mb-3 flex items-start gap-2 text-xs text-muted">
        <ShieldCheck size={14} className="mt-0.5 flex-none" aria-hidden />
        Stored readings are never edited. A correction or invalidation is added alongside the original with who, when and why; charts, exports and the latest value use the effective value.
      </p>
      {q.isError && !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data ? <Skeleton className="h-48" /> : (
        <div className={q.isFetching && q.isPlaceholderData ? 'opacity-60 transition-opacity' : undefined} aria-busy={q.isFetching || undefined}>
          <DataTable<ReadingView> dense rows={q.data.readings} rowKey={(r) => String(r.id)} onRowClick={(r) => setSelected(r)}
            empty={<p className="py-6 text-center text-sm text-muted">No readings match these filters.</p>}
            columns={[
              { key: 'ts', header: 'Observed', cell: (r) => <span className="num whitespace-nowrap">{fmtDateTime(r.ts)}</span> },
              { key: 'value', header: `Value (${sensor.unit})`, className: 'num', cell: (r) => r.status === 'original' ? <span>{v(r.originalValue)}</span> : (
                <span className="whitespace-nowrap">
                  <span className="text-muted line-through decoration-1" title="Original stored value (kept)">{v(r.originalValue)}</span>
                  {r.status === 'corrected' && <> → <strong>{v(r.effectiveValue)}</strong></>}
                </span>
              ) },
              { key: 'status', header: 'Status', cell: (r) => r.status === 'corrected' ? <Chip tone="cobalt" title="Corrected; original kept">Corrected</Chip>
                : r.status === 'invalidated' ? <Chip tone="critical" title="Excluded from charts and aggregates; original kept">Invalidated</Chip> : <span className="text-xs text-muted">Original</span> },
              { key: 'source', header: 'Source', cell: (r) => <SourceChip source={r.source} /> },
              { key: 'quality', header: 'Quality', cell: (r) => r.quality === 'good' ? <span className="text-xs text-muted">Good</span> : <Chip tone={r.quality === 'bad' ? 'critical' : 'medium'}>{r.quality}</Chip> },
              { key: 'by', header: 'Recorded by', cell: (r) => r.recordedBy?.name ?? (r.source === 'gateway' ? <span className="text-xs text-muted">Gateway</span> : r.source === 'simulator' ? <span className="text-xs text-muted">Simulator</span> : <span className="text-xs text-muted">Unknown</span>) },
              { key: 'act', header: <span className="sr-only">Actions</span>, cell: (r) => <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setSelected(r); }}>{canCorrect && r.status !== 'invalidated' ? 'Correct…' : 'Details'}</Button> },
            ]} />
          <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted">
            <span className="num">{total ? `${offset + 1}–${Math.min(offset + PAGE, total)} of ${total.toLocaleString()}` : '0 readings'}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" icon={<ChevronLeft size={14} />} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Newer</Button>
              <Button size="sm" variant="ghost" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>Older<ChevronRight size={14} aria-hidden /></Button>
            </div>
          </div>
        </div>
      )}
      {selected && <CorrectionDialog reading={(q.data?.readings.find((r) => r.id === selected.id)) ?? selected} sensor={sensor} canCorrect={canCorrect} onClose={() => setSelected(null)} />}
    </Card>
  );
}

function CorrectionDialog({ reading: r, sensor, canCorrect, onClose }: {
  reading: ReadingView; sensor: { id: string; tag: string; unit: string; decimals: number; measurand: Measurand }; canCorrect: boolean; onClose: () => void;
}) {
  const def = MEASURAND_DEFS[sensor.measurand];
  const [mode, setMode] = useState<'correct' | 'invalidate'>('correct');
  const [value, setValue] = useState(r.effectiveValue !== null ? String(r.effectiveValue) : String(r.originalValue));
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const act = useAction((b: { action: 'correct' | 'invalidate'; correctedValue?: number; reason: string }) => post(`/telemetry/readings/${r.id}/corrections`, b), {
    invalidate: ['/telemetry', '/sensors', '/overview', '/history'],
    success: mode === 'correct' ? 'Correction recorded. The original reading is kept.' : 'Reading invalidated. The original reading is kept.',
    onSuccess: () => { setReason(''); setTried(false); onClose(); },
  });
  const server = fieldErrors(act.error);
  const n = Number(value.replace(',', '.'));
  const valueErr = mode !== 'correct' ? null : value.trim() === '' || !Number.isFinite(n) ? 'Enter a number'
    : n < def.validRange[0] || n > def.validRange[1] ? `Outside the plausible range ${def.validRange[0]} – ${def.validRange[1]} ${def.unit}`
      : r.effectiveValue !== null && n === r.effectiveValue ? 'Same as the current value' : null;
  const reasonErr = reason.trim().length < 5 ? 'Explain why (at least 5 characters)' : null;
  const submit = () => {
    setTried(true);
    if (valueErr || reasonErr) return;
    act.mutate(mode === 'correct' ? { action: 'correct', correctedValue: n, reason: reason.trim() } : { action: 'invalidate', reason: reason.trim() });
  };
  const fmt = (x: number | null) => (x === null ? '—' : `${fmtValue(x, undefined, sensor.decimals)} ${sensor.unit}`);
  const editable = canCorrect && r.status !== 'invalidated';

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !act.isPending) onClose(); }} title={`Reading · ${fmtDateTime(r.ts)}`} wide
      description={<>{sensor.tag}. The stored value is never overwritten; corrections are appended to an audited trail.</>}
      footer={editable ? <>
        <Button variant="ghost" onClick={onClose} disabled={act.isPending}>Cancel</Button>
        <Button variant={mode === 'invalidate' ? 'danger-solid' : 'primary'} busy={act.isPending} onClick={submit} icon={mode === 'invalidate' ? <Ban size={15} /> : <PenLine size={15} />}>
          {mode === 'correct' ? 'Record correction' : 'Invalidate reading'}</Button>
      </> : <Button onClick={onClose}>Close</Button>}>
      <div className="grid gap-5">
        <dl className="grid grid-cols-2 gap-3 rounded-2xl bg-bg-2 p-4 text-sm sm:grid-cols-4">
          <div><dt className="t-label">Original (kept)</dt><dd className="num mt-1">{fmt(r.originalValue)}</dd></div>
          <div><dt className="t-label">Effective</dt><dd className="num mt-1">{r.status === 'invalidated' ? <Chip tone="critical">Invalidated</Chip> : fmt(r.effectiveValue)}</dd></div>
          <div><dt className="t-label">Source</dt><dd className="mt-1"><SourceChip source={r.source} /></dd></div>
          <div><dt className="t-label">Recorded by</dt><dd className="mt-1">{r.recordedBy?.name ?? (r.source === 'gateway' ? 'Gateway' : r.source === 'simulator' ? 'Simulator' : '—')}</dd></div>
          <div><dt className="t-label">Quality</dt><dd className="mt-1">{r.quality}</dd></div>
          <div className="col-span-2"><dt className="t-label">Received</dt><dd className="num mt-1">{fmtDateTime(r.receivedAt)}</dd></div>
        </dl>

        {editable && (
          <form className="grid gap-4" noValidate onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <Capsule label="Correction type" value={mode} onChange={(m) => { setMode(m); setTried(false); }}
              options={[{ value: 'correct', label: 'Correct value' }, { value: 'invalidate', label: 'Invalidate' }]} />
            {mode === 'correct' ? (
              <Input label={`Corrected value (${def.unit})`} inputMode="decimal" className="num" value={value} onChange={(e) => setValue(e.target.value)}
                error={(tried ? valueErr : null) ?? server.correctedValue ?? null} hint={`Plausible range ${def.validRange[0]} – ${def.validRange[1]} ${def.unit}`} disabled={act.isPending} />
            ) : (
              <p className="text-sm text-text-2">The reading will be excluded from charts, the effective value in exports and the latest value. It stays in the record and can be corrected later to reinstate it.</p>
            )}
            <Textarea label="Reason (required)" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} disabled={act.isPending}
              placeholder="e.g. Probe fouled; value confirmed with calibrated handheld" error={(tried ? reasonErr : null) ?? server.reason ?? null} />
            {act.error && !Object.keys(server).length ? <p role="alert" className="text-sm text-critical-text">{(act.error as Error).message}</p> : null}
            <button type="submit" hidden aria-hidden tabIndex={-1} />
          </form>
        )}
        {!canCorrect && <p className="text-xs text-muted">Only users who manage sensors can correct readings.</p>}

        <section aria-label="Correction trail">
          <h3 className="t-label mb-3">Correction trail</h3>
          {r.corrections.length ? (
            <Timeline items={[...r.corrections].reverse().map((c) => ({
              id: c.id, tone: c.action === 'invalidate' ? 'critical' : 'cobalt',
              title: c.action === 'invalidate' ? <span className="font-medium">Invalidated</span>
                : <><span className="font-medium">Corrected to {fmt(c.correctedValue)}</span> <span className="text-text-2">(original {fmt(c.originalValue)})</span></>,
              meta: <>{c.correctedBy?.name ?? 'Unknown'} · {fmtDateTime(c.createdAt)}</>,
              body: c.reason,
            }))} />
          ) : <p className="text-sm text-muted">No corrections. This is the value as originally recorded.</p>}
        </section>
      </div>
    </Dialog>
  );
}
