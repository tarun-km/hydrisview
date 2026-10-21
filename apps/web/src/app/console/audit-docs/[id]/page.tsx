'use client';

import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, CheckCheck, Download, Flag, Glasses, Pencil, RotateCcw, ShieldCheck, Sparkles, Stamp, X } from 'lucide-react';
import type { AuditField, AuditTable, BBox } from '@hydris/domain';
import { download, errorMessage, patch, post } from '@/lib/api';
import { invalidatePaths, useApi } from '@/lib/query';
import { fmtDateTime } from '@/lib/format';
import { BackLink, Button, Capsule, Chip, ErrorState, PageHeader, Progress, Skeleton, Timeline } from '@/ui';
import { ConfirmDialog } from '@/ui/overlay';
import { useToast } from '@/ui/overlay';
import { STATUS_LABEL, engineLabel, statusTone, useBlobUrl, type AuditDocDetail } from '@/console/work/auditdocs';

type Tab = 'values' | 'tables' | 'text' | 'figures' | 'history';
const AGREE: Record<AuditField['agreement'], { label: string; tone: 'ok' | 'medium' | 'critical' | 'outline' }> = {
  match: { label: 'Engines agree', tone: 'ok' }, close: { label: 'Minor difference', tone: 'medium' }, mismatch: { label: 'Engines disagree', tone: 'critical' }, single: { label: 'Single reading', tone: 'outline' },
};
const REVIEW_TONE = { pending: 'outline', confirmed: 'ok', corrected: 'cobalt', flagged: 'critical' } as const;

export default function AuditDocPage() {
  const { id } = useParams<{ id: string }>();
  const path = `/audit-docs/${id}`;
  const q = useApi<AuditDocDetail>(path);
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('values');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | 'verify' | 'approve' | 'reject'>(null);

  const refresh = () => invalidatePaths(qc, ['/audit-docs']);
  const act = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try {
      await fn();
      refresh();
      if (ok) toast({ title: ok, tone: 'ok' });
    } catch (e) {
      toast({ title: 'Action failed', body: errorMessage(e), tone: 'critical' });
    } finally {
      setBusy(null);
    }
  };

  if (q.isError && !q.data) return <><BackLink href="/console/audit-docs">Audit documents</BackLink><ErrorState error={q.error} onRetry={() => void q.refetch()} /></>;
  if (!q.data) return <div className="grid gap-4" role="status" aria-label="Loading"><Skeleton className="h-12 w-2/3" /><Skeleton className="h-[600px] rounded-[24px]" /></div>;
  const d = q.data;
  const x = d.extraction;
  const locked = d.status === 'approved';
  const canReview = d.permissions.review && !locked;
  const item = (itemId: string, body: Record<string, unknown>, ok?: string) =>
    act(itemId, () => patch(`/audit-docs/${d.id}/items/${encodeURIComponent(itemId)}`, { ...body, expectedRevision: d.revision }), ok);
  const sel = x.fields.find((f) => f.id === selected) ?? x.tables.find((t) => t.id === selected) ?? null;

  return (
    <>
      <BackLink href="/console/audit-docs">Audit documents</BackLink>
      <PageHeader eyebrow={<span className="flex items-center gap-2">{d.capturedVia === 'glasses' && <Glasses size={14} aria-hidden />}Audit document · {d.docType}</span>} title={d.title}
        subtitle={`${d.pageCount} page${d.pageCount === 1 ? '' : 's'} · captured by ${d.capturedBy ?? 'unknown'} via ${d.capturedVia} · ${fmtDateTime(d.createdAt)}${d.siteName ? ` · ${d.siteName}` : ''}`}
        actions={<>
          <Chip tone={statusTone(d.status)}>{STATUS_LABEL[d.status]}</Chip>
          <Button icon={<Download size={16} />} disabled={busy === 'pdf'} onClick={() => act('pdf', () => download(`${path}/pdf`, `${d.title.replace(/[^\w -]+/g, '').trim() || 'audit-document'}.pdf`))}>PDF</Button>
        </>} />

      <VerificationSteps d={d} busy={busy} onVerify={() => setDialog('verify')} onApprove={() => setDialog('approve')} onReject={() => setDialog('reject')}
        onBulk={() => act('bulk', () => post(`${path}/confirm-agreed`), 'Values both engines agree on were confirmed')}
        onEnhance={() => act('enhance', () => post(`${path}/enhance`), 'Vision extraction finished')} />

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <section className="card card-tight grid content-start gap-3 xl:sticky xl:top-24 xl:self-start" aria-label="Scanned page">
          <div className="flex items-center gap-2">
            <span className="t-eyebrow">Original scan</span>
            {d.pages.length > 1 && <span className="ml-auto"><Capsule label="Page" value={String(page)} onChange={(v) => setPage(Number(v))} options={d.pages.map((p) => ({ value: String(p.pageNo), label: `p${p.pageNo}` }))} /></span>}
          </div>
          <PageViewer docId={d.id} page={d.pages.find((p) => p.pageNo === page) ?? d.pages[0]!} fields={x.fields.filter((f) => f.page === page)} tables={x.tables.filter((t) => t.page === page)}
            figures={x.figures.filter((f) => f.page === page).map((f) => f.bbox)} selected={selected} onSelect={(sid) => { setSelected(sid); setTab(x.tables.some((t) => t.id === sid) ? 'tables' : 'values'); }} />
          {sel && 'label' in sel && <p className="text-[13px] text-text-2">Highlighted: <b>{sel.label}</b> = {sel.value}{sel.unit ? ` ${sel.unit}` : ''}</p>}
        </section>

        <section className="grid min-w-0 content-start gap-3" aria-label="Extracted content">
          <Capsule label="View" value={tab} onChange={setTab} options={[
            { value: 'values', label: 'Values', count: x.fields.length }, { value: 'tables', label: 'Tables', count: x.tables.length },
            { value: 'text', label: 'Text' }, { value: 'figures', label: 'Figures', count: x.figures.length }, { value: 'history', label: 'History', count: d.events.length },
          ]} />
          {x.warnings.length > 0 && tab === 'values' && (
            <div className="rounded-2xl border border-[rgb(245_184_61/0.4)] bg-[rgb(245_184_61/0.08)] p-3 text-[13px]" role="note">
              {x.warnings.map((w, i) => <p key={i} className="flex gap-2"><AlertTriangle size={14} className="mt-0.5 flex-none" aria-hidden />{w}</p>)}
            </div>
          )}
          {tab === 'values' && (x.fields.length ? x.fields.map((f) => (
            <FieldRow key={f.id} f={f} selected={selected === f.id} canReview={canReview} busy={busy === f.id}
              onSelect={() => { setSelected(f.id); setPage(f.page); }}
              onConfirm={() => item(f.id, { action: 'confirm' })} onFlag={(note) => item(f.id, { action: 'flag', note })}
              onReset={() => item(f.id, { action: 'reset' })} onCorrect={(value, unit, note) => item(f.id, { action: 'correct', value, unit, note }, 'Correction saved - the extracted value is kept in history')} />
          )) : <p className="card text-sm text-muted">No labelled values were found. Check the Text tab{d.aiStatus === 'unavailable' ? ' - enabling the vision engine improves extraction of complex layouts' : ''}.</p>)}
          {tab === 'tables' && (x.tables.length ? x.tables.map((t) => (
            <TableCard key={t.id} t={t} selected={selected === t.id} canReview={canReview} busy={busy === t.id} onSelect={() => { setSelected(t.id); setPage(t.page); }}
              onConfirm={() => item(t.id, { action: 'confirm' })} onFlag={() => item(t.id, { action: 'flag' })}
              onSave={(header, rows) => item(t.id, { action: 'correct', header, rows }, 'Table corrected')} />
          )) : <p className="card text-sm text-muted">No tables detected.</p>)}
          {tab === 'text' && x.pages.map((p) => (
            <article key={p.page} className="card">
              <div className="t-eyebrow mb-2">Page {p.page} · {engineLabel(p.engine)}</div>
              <pre className="whitespace-pre-wrap break-words font-[inherit] text-[13.5px] leading-relaxed text-text-2">{p.text || '—'}</pre>
            </article>
          ))}
          {tab === 'figures' && (x.figures.length ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {x.figures.map((f) => (
                <figure key={f.id} className="card card-tight grid gap-2">
                  <FigureCrop docId={d.id} page={d.pages.find((p) => p.pageNo === f.page)!} box={f.bbox} />
                  <figcaption className="text-[13px]"><Chip>{f.kind}</Chip> <span className="text-text-2">{f.caption}</span> <span className="text-xs text-muted">· p{f.page}</span></figcaption>
                </figure>
              ))}
            </div>
          ) : <p className="card text-sm text-muted">{d.aiStatus === 'done' ? 'No figures on this document.' : 'Figures (photos, stamps, signatures, diagrams) are located by the vision engine.'} The full scan is always embedded in the PDF.</p>)}
          {tab === 'history' && (
            <div className="card">
              <Timeline items={d.events.map((e) => ({
                id: e.id, tone: e.action.includes('reject') || e.action.includes('flag') ? 'critical' : e.action === 'approved' || e.action === 'verified' ? 'ok' : 'muted',
                title: <span>{e.user ?? 'System'} · {e.action.replace('item.', '').replace(/[._]/g, ' ')}{e.target ? <span className="text-muted"> · {x.fields.find((f) => f.id === e.target)?.label ?? x.tables.find((t) => t.id === e.target)?.title ?? e.target}</span> : null}</span>,
                meta: `${fmtDateTime(e.at)}${e.viaGlasses ? ' · via glasses' : ''}`,
                body: <>
                  {e.action === 'item.correct' && hasValue(e.before) && hasValue(e.after) && <span className="num">“{e.before.value}” → “{e.after.value}”</span>}
                  {e.note && <span className="block text-text-2">{e.note}</span>}
                </>,
              }))} />
            </div>
          )}
        </section>
      </div>

      <ConfirmDialog open={dialog === 'verify'} onOpenChange={(o) => !o && setDialog(null)} title="Sign off the field review?"
        body={`You confirm that all ${d.review.total} extracted items match the paper document. An approver (a different person) then makes the final decision.`}
        confirmLabel="Verify document" noteLabel="Note (optional)" onConfirm={(note) => act('verify', () => post(`${path}/verify`, { note: note || undefined }), 'Verification recorded')} />
      <ConfirmDialog open={dialog === 'approve'} onOpenChange={(o) => !o && setDialog(null)} title="Approve this audit document?"
        body="Approval locks the document. The PDF carries the full verification trail." confirmLabel="Approve" noteLabel="Note (optional)"
        onConfirm={(note) => act('approve', () => post(`${path}/approve`, { decision: 'approve', note: note || undefined }), 'Document approved')} />
      <ConfirmDialog open={dialog === 'reject'} onOpenChange={(o) => !o && setDialog(null)} title="Reject this document?" destructive
        body="It returns to review. Say what has to change." confirmLabel="Reject" noteLabel="Reason" noteRequired
        onConfirm={(note) => act('reject', () => post(`${path}/approve`, { decision: 'reject', note }), 'Document rejected')} />
    </>
  );
}

const hasValue = (v: unknown): v is { value: string } => !!v && typeof v === 'object' && 'value' in v;

function VerificationSteps({ d, busy, onVerify, onApprove, onReject, onBulk, onEnhance }: { d: AuditDocDetail; busy: string | null; onVerify: () => void; onApprove: () => void; onReject: () => void; onBulk: () => void; onEnhance: () => void }) {
  const x = d.extraction;
  const multi = x.fields.filter((f) => f.sources.length > 1);
  const disagree = x.fields.filter((f) => f.agreement === 'mismatch').length;
  const pct = d.review.total ? Math.round((d.review.done / d.review.total) * 100) : 0;
  const step = (n: number, title: string, state: 'done' | 'active' | 'todo', body: React.ReactNode) => (
    <div className={`card card-tight grid content-start gap-2 ${state === 'active' ? 'border-lime' : ''}`}>
      <div className="flex items-center gap-2">
        <span className={`grid h-7 w-7 place-items-center rounded-full text-[13px] font-semibold ${state === 'done' ? 'bg-[var(--color-ok)] text-black' : state === 'active' ? 'bg-lime text-lime-ink' : 'bg-bg-2 text-muted'}`}>{state === 'done' ? <Check size={15} /> : n}</span>
        <h2 className="text-[15px] font-medium">{title}</h2>
      </div>
      {body}
    </div>
  );
  return (
    <div className="grid gap-3 lg:grid-cols-3" aria-label="Dual verification">
      {step(1, 'Machine cross-check', 'done', <>
        <p className="text-[13px] text-text-2">{multi.length ? <>{multi.length - disagree} of {multi.length} values read the same by independent engines{disagree ? <> · <b className="text-[var(--color-critical)]">{disagree} disagree</b></> : null}.</> : 'Only one reading per value - review every value manually.'}</p>
        <div className="flex flex-wrap gap-1.5">{d.engines.map((e) => <Chip key={e} tone={e.startsWith('vision:') ? 'cobalt' : 'outline'}>{engineLabel(e)}</Chip>)}</div>
        {d.aiStatus === 'pending' && d.status === 'in_review' && <Button icon={<Sparkles size={15} />} disabled={busy === 'enhance'} onClick={onEnhance}>{busy === 'enhance' ? 'Reading layout…' : 'Run vision extraction'}</Button>}
        {d.aiStatus === 'failed' && <p className="text-xs text-[var(--color-high)]">Vision engine: {d.aiError}</p>}
        {d.aiStatus === 'unavailable' && <p className="text-xs text-muted">Vision AI not configured (ANTHROPIC_API_KEY) - using on-device OCR readings.</p>}
      </>)}
      {step(2, 'Field review (verification 1)', d.verifiedBy ? 'done' : d.status === 'in_review' ? 'active' : 'todo', <>
        <Progress value={pct} tone={d.review.complete ? 'ok' : 'lime'} label="Items reviewed" />
        <p className="text-[13px] text-text-2">{d.review.done}/{d.review.total} confirmed or corrected{d.review.flagged ? ` · ${d.review.flagged} flagged` : ''}</p>
        {d.verifiedBy ? <p className="text-xs text-muted">Verified by {d.verifiedBy.name} · {fmtDateTime(d.verifiedBy.at)}</p> : d.status === 'in_review' && (
          <div className="flex flex-wrap gap-2">
            {d.permissions.review && <Button icon={<CheckCheck size={15} />} disabled={busy === 'bulk'} onClick={onBulk}>Confirm agreed values</Button>}
            {d.permissions.verify && <Button variant="primary" icon={<ShieldCheck size={15} />} disabled={!d.review.complete || d.review.flagged > 0 || busy === 'verify'} onClick={onVerify}>Verify</Button>}
          </div>
        )}
      </>)}
      {step(3, 'Approval (verification 2)', d.status === 'approved' ? 'done' : d.status === 'verified' ? 'active' : 'todo', <>
        <p className="text-[13px] text-text-2">A second person accepts or rejects the verified record. Approval locks it.</p>
        {d.approvedBy ? <p className="text-xs text-muted">{d.status === 'rejected' ? 'Rejected' : 'Approved'} by {d.approvedBy.name} · {fmtDateTime(d.approvedBy.at)}{d.rejectedReason ? ` - ${d.rejectedReason}` : ''}</p>
          : d.status === 'verified' && d.permissions.approve && (
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" icon={<Stamp size={15} />} disabled={busy === 'approve'} onClick={onApprove}>Approve</Button>
              <Button icon={<X size={15} />} disabled={busy === 'reject'} onClick={onReject}>Reject</Button>
            </div>
          )}
      </>)}
    </div>
  );
}

function PageViewer({ docId, page, fields, tables, figures, selected, onSelect }: { docId: string; page: AuditDocDetail['pages'][number]; fields: AuditField[]; tables: AuditTable[]; figures: BBox[]; selected: string | null; onSelect: (id: string) => void }) {
  const img = useBlobUrl(`/audit-docs/${docId}/pages/${page.pageNo}`);
  const box = (b: BBox) => ({ left: `${b[0] * 100}%`, top: `${b[1] * 100}%`, width: `${b[2] * 100}%`, height: `${b[3] * 100}%` });
  const color = (f: AuditField) => (f.status === 'confirmed' || f.status === 'corrected' ? 'var(--color-ok)' : f.agreement === 'mismatch' || f.status === 'flagged' ? 'var(--color-critical)' : 'var(--color-lime, #1954F1)');
  return (
    <div className="relative overflow-hidden rounded-xl border border-line bg-white" style={{ aspectRatio: `${page.width} / ${page.height}` }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {img.url ? <img src={img.url} alt={`Scanned page ${page.pageNo}`} className="absolute inset-0 h-full w-full" /> : <Skeleton className="absolute inset-0" />}
      {figures.map((b, i) => <div key={`g${i}`} className="pointer-events-none absolute border-2 border-dashed border-[#8A60F0]" style={box(b)} aria-hidden />)}
      {tables.filter((t) => t.bbox).map((t) => (
        <button key={t.id} type="button" onClick={() => onSelect(t.id)} aria-label={`Table ${t.title ?? ''}`} className="absolute border-2 transition-colors" style={{ ...box(t.bbox!), borderColor: selected === t.id ? '#FF2800' : 'rgba(25,84,241,0.55)', background: selected === t.id ? 'rgba(255,40,0,0.06)' : 'transparent' }} />
      ))}
      {fields.filter((f) => f.bbox).map((f) => (
        <button key={f.id} type="button" onClick={() => onSelect(f.id)} aria-label={`${f.label}: ${f.value}`} title={`${f.label}: ${f.value}`}
          className="absolute rounded-sm border-2 transition-all" style={{ ...box(f.bbox!), borderColor: selected === f.id ? '#FF2800' : color(f), background: selected === f.id ? 'rgba(255,40,0,0.12)' : 'transparent' }} />
      ))}
    </div>
  );
}

function FigureCrop({ docId, page, box }: { docId: string; page: AuditDocDetail['pages'][number]; box: BBox }) {
  const img = useBlobUrl(`/audit-docs/${docId}/pages/${page.pageNo}`);
  const [x, y, w, h] = box;
  return (
    <div className="relative w-full overflow-hidden rounded-lg border border-line bg-white" style={{ aspectRatio: `${w * page.width} / ${h * page.height}` }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {img.url && <img src={img.url} alt="" className="absolute max-w-none" style={{ width: `${100 / w}%`, left: `${(-x / w) * 100}%`, top: `${(-y / h) * 100}%` }} />}
    </div>
  );
}

function FieldRow({ f, selected, canReview, busy, onSelect, onConfirm, onFlag, onReset, onCorrect }: {
  f: AuditField; selected: boolean; canReview: boolean; busy: boolean; onSelect: () => void; onConfirm: () => void; onFlag: (note?: string) => void; onReset: () => void; onCorrect: (value: string, unit: string | null, note?: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(f.value);
  const [unit, setUnit] = useState(f.unit ?? '');
  const [note, setNote] = useState('');
  const a = AGREE[f.agreement];
  return (
    <article className={`card card-tight grid gap-2 ${selected ? 'border-[#FF2800]' : ''}`} onClick={onSelect}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] text-muted">{f.label}</span>
        <Chip tone={a.tone}>{a.label}</Chip>
        <span className="text-[11.5px] text-muted num">{Math.round(f.conf * 100)}% conf · p{f.page}</span>
        <span className="ml-auto"><Chip tone={REVIEW_TONE[f.status]}>{f.status}</Chip></span>
      </div>
      {editing ? (
        <div className="grid gap-2" onClick={(e) => e.stopPropagation()}>
          <div className="flex gap-2">
            <input className="input" value={value} onChange={(e) => setValue(e.target.value)} aria-label={`Corrected ${f.label}`} autoFocus />
            <input className="input !w-28" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="unit" aria-label="Unit" />
          </div>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why (optional) - e.g. checked against paper" aria-label="Correction note" />
          <div className="flex gap-2">
            <Button variant="primary" disabled={busy || !value.trim()} onClick={() => { onCorrect(value, unit.trim() || null, note || undefined); setEditing(false); }}>Save correction</Button>
            <Button onClick={() => { setEditing(false); setValue(f.value); }}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="text-[19px] font-medium num">{f.value}{f.unit && <span className="ml-1 text-sm text-muted">{f.unit}</span>}
          {f.status === 'corrected' && f.extracted && f.extracted !== f.value && <span className="ml-2 text-[12.5px] font-normal text-muted line-through">{f.extracted}</span>}
        </div>
      )}
      {f.note && <p className="flex gap-2 text-[12.5px] text-[var(--color-high)]"><AlertTriangle size={13} className="mt-0.5 flex-none" aria-hidden />{f.note}</p>}
      {f.sources.length > 1 && (
        <div className="grid gap-1 rounded-xl bg-bg-2 p-2 text-[12.5px]" aria-label="Independent readings">
          {f.sources.map((s) => <div key={s.engine} className="flex gap-2"><span className="w-[110px] flex-none text-muted">{engineLabel(s.engine)}</span><span className="num">{s.value}</span><span className="ml-auto text-muted num">{Math.round(s.conf * 100)}%</span></div>)}
        </div>
      )}
      {canReview && !editing && (
        <div className="flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
          {f.status !== 'confirmed' && <Button icon={<Check size={14} />} disabled={busy} onClick={onConfirm}>Confirm</Button>}
          <Button icon={<Pencil size={14} />} disabled={busy} onClick={() => setEditing(true)}>Correct</Button>
          {f.status !== 'flagged' && <Button icon={<Flag size={14} />} disabled={busy} onClick={() => onFlag()}>Flag</Button>}
          {f.status !== 'pending' && <Button icon={<RotateCcw size={14} />} disabled={busy} onClick={onReset}>Reset</Button>}
        </div>
      )}
    </article>
  );
}

function TableCard({ t, selected, canReview, busy, onSelect, onConfirm, onFlag, onSave }: { t: AuditTable; selected: boolean; canReview: boolean; busy: boolean; onSelect: () => void; onConfirm: () => void; onFlag: () => void; onSave: (header: string[], rows: string[][]) => void }) {
  const [edit, setEdit] = useState(false);
  const [header, setHeader] = useState(t.header);
  const [rows, setRows] = useState(t.rows);
  const cols = useMemo(() => Math.max(header.length, ...rows.map((r) => r.length)), [header, rows]);
  const cell = (v: string, on: (v: string) => void, label: string, head = false) => edit
    ? <input className={`w-full min-w-[80px] rounded-md border border-line bg-surface px-2 py-1 text-[13px] ${head ? 'font-medium' : ''}`} value={v} onChange={(e) => on(e.target.value)} aria-label={label} />
    : v;
  return (
    <article className={`card card-tight grid gap-2 ${selected ? 'border-[#FF2800]' : ''}`} onClick={onSelect}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[15px] font-medium">{t.title || 'Table'}</h3>
        <span className="text-[11.5px] text-muted">p{t.page} · {engineLabel(t.engine)}</span>
        <span className="ml-auto"><Chip tone={REVIEW_TONE[t.status]}>{t.status}</Chip></span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead><tr>{Array.from({ length: cols }, (_, c) => <th key={c} className="border border-line bg-bg-2 px-2 py-1.5 text-left font-medium">{cell(header[c] ?? '', (v) => setHeader((h) => Object.assign([...h], { [c]: v })), `Header ${c + 1}`, true)}</th>)}</tr></thead>
          <tbody>{rows.map((r, ri) => <tr key={ri}>{Array.from({ length: cols }, (_, c) => <td key={c} className="border border-line px-2 py-1.5 num">{cell(r[c] ?? '', (v) => setRows((rs) => rs.map((row, i) => (i === ri ? Object.assign([...row], { [c]: v }) : row))), `Row ${ri + 1} column ${c + 1}`)}</td>)}</tr>)}</tbody>
        </table>
      </div>
      {canReview && (
        <div className="flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
          {edit ? <>
            <Button variant="primary" disabled={busy} onClick={() => { onSave(header, rows); setEdit(false); }}>Save table</Button>
            <Button onClick={() => { setEdit(false); setHeader(t.header); setRows(t.rows); }}>Cancel</Button>
          </> : <>
            {t.status !== 'confirmed' && <Button icon={<Check size={14} />} disabled={busy} onClick={onConfirm}>Confirm table</Button>}
            <Button icon={<Pencil size={14} />} disabled={busy} onClick={() => setEdit(true)}>Edit cells</Button>
            {t.status !== 'flagged' && <Button icon={<Flag size={14} />} disabled={busy} onClick={onFlag}>Flag</Button>}
          </>}
        </div>
      )}
    </article>
  );
}
