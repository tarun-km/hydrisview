'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, FileImage, Loader2, ScanLine, Sparkles, Upload, X } from 'lucide-react';
import type { SoftcopyModel } from '@hydris/domain';
import { CameraPicker, CameraProblem, asCameraError } from '@/lib/CameraHelp';
import type { AuditExtraction, AuditDocStatus } from '@hydris/domain';
import { apiBlob, errorMessage, post } from '@/lib/api';
import { useApi, invalidatePaths } from '@/lib/query';
import { scanPage, uploadBody, warmUpOcr, type ScannedPage } from '@/lib/ocr';
import { renderSampleAuditSheet } from '@/lib/sample-audit';
import { GuidedCapture } from '@/lib/GuidedCapture';
import { openCamera, type CameraError, type CameraKind, type CameraSource } from '@/glasses/camera';
import { Button, Chip, Progress } from '@/ui';
import { useQueryClient } from '@tanstack/react-query';

export interface ReviewProgress { total: number; done: number; flagged: number; pending: number; complete: boolean }
export interface AuditDocSummary {
  id: string; title: string; docType: string; status: AuditDocStatus; siteId: string | null; siteName: string | null; pageCount: number;
  capturedVia: 'glasses' | 'console' | 'mobile'; capturedBy: string | null; createdAt: string; updatedAt: string; engines: string[];
  aiStatus: 'none' | 'pending' | 'done' | 'failed' | 'unavailable'; agreement: number | null; fields: number; tables: number; figures: number;
  review: ReviewProgress; attention: number;
}
export interface AuditDocEvent { id: string; action: string; target: string | null; before: unknown; after: unknown; note: string | null; at: string; user: string | null; viaGlasses: boolean }
export interface AuditDocDetail extends AuditDocSummary {
  extraction: AuditExtraction; revision: number; aiError: string | null;
  verifiedBy: { id: string; name: string | null; at: string } | null;
  approvedBy: { id: string; name: string | null; at: string } | null;
  rejectedReason: string | null;
  pages: { pageNo: number; width: number; height: number; mime: string }[];
  events: AuditDocEvent[];
  permissions: { review: boolean; verify: boolean; approve: boolean };
}
export interface AuditCapabilities { vision: boolean; visionEngine: string; maxPages: number }

export const STATUS_LABEL: Record<AuditDocStatus, string> = {
  processing: 'Processing', in_review: 'In review', verified: 'Verified · awaiting approval', approved: 'Approved', rejected: 'Rejected',
};
export const statusTone = (s: AuditDocStatus) => (s === 'approved' ? 'ok' : s === 'rejected' ? 'critical' : s === 'verified' ? 'cobalt' : 'medium') as 'ok' | 'critical' | 'cobalt' | 'medium';
export const engineLabel = (e: string) => (e.startsWith('vision:') ? 'Vision AI' : e === 'ocr:original' ? 'OCR · original' : e === 'ocr:enhanced' ? 'OCR · enhanced' : e === 'ocr:server' ? 'Server OCR' : e === 'ocr:device' ? 'On-device OCR' : /mlkit/i.test(e) ? 'ML Kit (Android)' : e);

/** Object URL for an authenticated image/PDF path (revoked on change/unmount). */
export function useBlobUrl(path: string | null) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    let made: string | null = null;
    apiBlob(path).then((b) => {
      if (!alive) return;
      made = URL.createObjectURL(b);
      setUrl(made);
    }).catch((e) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [path]);
  return { url, error };
}

/**
 * Scan dialog body: add pages from a photo/file, the device camera, or the built-in sample sheet;
 * every page is OCR'd twice on this device, then uploaded and (if configured) refined by the vision engine.
 */
export function ScanComposer({ onDone, onCancel }: { onDone: (id: string) => void; onCancel: () => void }) {
  const caps = useApi<AuditCapabilities>('/audit-docs/capabilities');
  const qc = useQueryClient();
  const [pages, setPages] = useState<ScannedPage[]>([]);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState<{ stage: string; progress: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [camera, setCamera] = useState<CameraSource | null>(null);
  const [camErr, setCamErr] = useState<CameraError | null>(null);
  const shutter = useRef<{ capture: () => void } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const max = caps.data?.maxPages ?? 6;

  useEffect(() => warmUpOcr(), []);
  useEffect(() => () => camera?.stop(), [camera]);

  const add = async (src: Blob) => {
    setError(null);
    try {
      const p = await scanPage(src, setBusy);
      setPages((x) => [...x, p]);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const startCamera = async (prefer?: CameraKind, deviceId?: string) => {
    setError(null);
    setCamErr(null);
    camera?.stop();
    setCamera(null);
    try {
      setCamera(await openCamera(prefer, deviceId));
    } catch (e) {
      setCamErr(asCameraError(e));
    }
  };

  const submit = async () => {
    setError(null);
    setBusy({ stage: 'Uploading and structuring', progress: 0.5 });
    try {
      const r = await post<AuditDocSummary>('/audit-docs', uploadBody(pages, title.trim() ? { title: title.trim() } : {}));
      if (r.aiStatus === 'pending') {
        setBusy({ stage: `Server processing: cleaning the page, OCR engines${caps.data?.vision ? ' + vision AI' : ''}, fusion…`, progress: 0.75 });
        await post(`/audit-docs/${r.id}/process`).catch(() => {});
      }
      invalidatePaths(qc, ['/audit-docs']);
      onDone(r.id);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-text-2">
        <Chip tone="ok">On-device OCR · 2 independent passes</Chip>
        {caps.data && (caps.data.vision ? <Chip tone="cobalt"><Sparkles size={12} aria-hidden /> Vision AI layout extraction</Chip> : <Chip tone="outline" title="Set ANTHROPIC_API_KEY on the server to enable">Vision AI off</Chip>)}
        <span className="ml-auto num text-muted">{pages.length}/{max} pages</span>
      </div>

      {camera ? (
        <div className="grid gap-3">
          <div className="aspect-[4/3] w-full">
            <GuidedCapture source={camera} variant="console" controlRef={shutter} onCaptured={(pg) => { camera.stop(); setCamera(null); void add(pg.blob); }} onError={(m) => { camera.stop(); setCamera(null); setError(m); }} />
          </div>
          <p className="text-xs text-muted">Hold the A4 sheet flat and square; it captures automatically when aligned and steady, then the page is flattened before OCR.</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" icon={<Camera size={16} />} onClick={() => shutter.current?.capture()}>Take photo</Button>
            <Button icon={<Upload size={16} />} onClick={() => fileRef.current?.click()}>Upload instead</Button>
            <Button onClick={() => { camera.stop(); setCamera(null); }}>Cancel</Button>
            {camera.kind === 'device-camera' && <span className="ml-auto"><CameraPicker current={camera.deviceId} onPick={(id) => void startCamera('device-camera', id)} /></span>}
          </div>
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-3">
          <button type="button" disabled={!!busy || pages.length >= max} onClick={() => fileRef.current?.click()} className="card card-tight flex flex-col items-start gap-2 text-left transition-colors hover:border-line-2 disabled:opacity-50">
            <Upload size={18} aria-hidden /><span className="font-medium">Photo or file</span><span className="text-xs text-muted">Photo, scan or PDF page image</span>
          </button>
          <button type="button" disabled={!!busy || pages.length >= max} onClick={() => void startCamera()} className="card card-tight flex flex-col items-start gap-2 text-left transition-colors hover:border-line-2 disabled:opacity-50">
            <Camera size={18} aria-hidden /><span className="font-medium">Camera</span><span className="text-xs text-muted">Guided A4 capture</span>
          </button>
          <button type="button" disabled={!!busy || pages.length >= max} onClick={() => void startCamera('simulated')} className="card card-tight flex flex-col items-start gap-2 text-left transition-colors hover:border-line-2 disabled:opacity-50">
            <FileImage size={18} aria-hidden /><span className="font-medium">Simulated glasses camera</span><span className="text-xs text-muted">Sample sheet filmed on a desk</span>
          </button>
        </div>
      )}
      <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple hidden data-testid="photo-input" onChange={async (e) => {
        const files = [...(e.target.files ?? [])].slice(0, max - pages.length);
        e.target.value = '';
        if (files.length && camera) { camera.stop(); setCamera(null); }
        for (const f of files) await add(f);
      }} />
      {camErr && !camera && <CameraProblem error={camErr} onRetry={() => void startCamera()} onUpload={() => fileRef.current?.click()} extra={<Button onClick={() => { setCamErr(null); void startCamera('simulated'); }}>Simulated camera</Button>} />}

      {pages.length > 0 && (
        <ul className="flex gap-3 overflow-x-auto pb-1" aria-label="Scanned pages">
          {pages.map((p, i) => (
            <li key={i} className="relative w-[110px] flex-none">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.dataUrl} alt={`Page ${i + 1}`} className="aspect-[3/4] w-full rounded-xl border border-line object-cover" />
              <span className="mt-1 block text-center text-[11.5px] text-muted num">p{i + 1} · {p.readings[0] ? `${Math.round(p.readings[0].conf)}% conf` : 'server OCR'}</span>
              <button type="button" aria-label={`Remove page ${i + 1}`} onClick={() => setPages((x) => x.filter((_, j) => j !== i))} className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-full bg-black/60 text-white"><X size={14} /></button>
            </li>
          ))}
        </ul>
      )}

      {busy && (
        <div className="grid gap-2 rounded-2xl bg-bg-2 p-4" role="status">
          <div className="flex items-center gap-2 text-sm"><Loader2 size={15} className="animate-spin" aria-hidden />{busy.stage}</div>
          <Progress value={Math.round(busy.progress * 100)} label="Scan progress" />
        </div>
      )}
      {error && <p role="alert" className="field-error">{error}</p>}

      <input className="input" placeholder="Title (optional - detected from the page)" value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} aria-label="Document title" />
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="primary" icon={<ScanLine size={16} />} disabled={!pages.length || !!busy} onClick={() => void submit()}>Extract document</Button>
      </div>
    </div>
  );
}

const pct = (n: number | null | undefined) => (n === null || n === undefined ? '-' : `${Math.round(n * 100)}%`);

/**
 * Polished soft copy preview: the fused document model rendered as a typed A4 page (the same
 * model the API typesets as DOCX and clean PDF), with per-engine confidence / agreement chips.
 */
export function SoftcopyPreview({ docId, revision, engines, stats, agreement }: {
  docId: string; revision: number; engines: string[]; agreement: number | null;
  stats?: { engine: string; fields: number; tables: number; conf: number | null; agreement: number | null }[];
}) {
  const q = useApi<SoftcopyModel>(`/audit-docs/${docId}/softcopy?rev=${revision}`);
  const m = q.data;
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]" aria-label="Engines">
        {(stats?.length ? stats : engines.map((e) => ({ engine: e, fields: 0, tables: 0, conf: null, agreement: null }))).map((s) => (
          <Chip key={s.engine} tone={s.agreement === null ? 'outline' : s.agreement >= 0.9 ? 'ok' : s.agreement >= 0.7 ? 'medium' : 'critical'}
            title={`${s.fields} values · ${s.tables} tables · mean confidence ${pct(s.conf)} · agrees with fused result on ${pct(s.agreement)}`}>
            {engineLabel(s.engine)} · conf {pct(s.conf)} · agree {pct(s.agreement)}
          </Chip>
        ))}
        {agreement !== null && <Chip tone={agreement >= 0.9 ? 'ok' : 'medium'}>Cross-engine agreement {pct(agreement)}</Chip>}
      </div>
      {!m ? (q.isError ? <p className="card text-sm text-muted">{errorMessage(q.error)}</p> : <div className="card flex items-center gap-2 text-sm text-muted"><Loader2 size={15} className="animate-spin" aria-hidden />Typesetting…</div>) : (
        <article className="mx-auto w-full max-w-[720px] bg-white text-[#12161c] shadow-[0_8px_40px_rgb(0_0_0/0.25)]" style={{ aspectRatio: '210 / 297', padding: '6.7%', fontFamily: 'Calibri, Carlito, "Segoe UI", Arial, sans-serif', fontSize: 'clamp(9px, 1.45vw, 13px)', overflow: 'auto' }} aria-label="Soft copy preview">
          {m.letterhead.map((l, i) => <div key={i} style={i === 0 ? { color: '#1954F1', fontWeight: 700 } : { color: '#6B7580', fontSize: '0.85em' }}>{l}</div>)}
          <h2 style={{ fontSize: '1.75em', fontWeight: 700, margin: '0.6em 0 0.8em', paddingBottom: '0.3em', borderBottom: '2px solid #1954F1' }}>{m.title}</h2>
          {m.blocks.map((b, bi) => {
            const cellS = { border: '1px solid #8C949E', padding: '0.35em 0.6em', verticalAlign: 'top' as const };
            if (b.kind === 'meta') return (
              <table key={bi} style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '1.2em' }}><tbody>
                {b.items.map((k) => <tr key={k.id}><th style={{ ...cellS, width: '36%', textAlign: 'left' }}>{k.label}</th><td style={{ ...cellS, background: k.attention ? '#FFF2D9' : undefined }}>{k.value}{k.unit ? ` ${k.unit}` : ''}</td></tr>)}
              </tbody></table>
            );
            if (b.kind === 'table') return (
              <section key={bi} style={{ marginBottom: '1.2em' }}>
                {b.title && <h3 style={{ fontWeight: 700, fontSize: '1.15em', margin: '0 0 0.4em' }}>{b.title}</h3>}
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>{b.header.map((h, i) => <th key={i} style={{ ...cellS, background: '#EBF0FA', textAlign: 'left' }}>{h}</th>)}</tr></thead>
                  <tbody>{b.rows.map((r, ri) => <tr key={ri}>{b.header.map((_, ci) => <td key={ci} style={{ ...cellS, background: b.flagged.some((f) => f.row === ri && f.col === ci) ? '#FFF2D9' : undefined }}>{r[ci] ?? ''}</td>)}</tr>)}</tbody>
                </table>
              </section>
            );
            if (b.kind === 'checklist') return (
              <section key={bi} style={{ marginBottom: '1.2em' }}>
                {b.title && <h3 style={{ fontWeight: 700, fontSize: '1.15em', margin: '0 0 0.4em' }}>{b.title}</h3>}
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>{b.items.map((it, i) => (
                  <li key={i} style={{ display: 'flex', gap: '0.6em', alignItems: 'center', margin: '0.25em 0' }}>
                    <span aria-label={it.checked === false ? 'not checked' : 'checked'} style={{ width: '1em', height: '1em', border: '1.5px solid #12161c', display: 'inline-grid', placeItems: 'center', fontSize: '0.9em', lineHeight: 1 }}>{it.checked === false ? '' : '✓'}</span>{it.text}
                  </li>
                ))}</ul>
              </section>
            );
            if (b.kind === 'figure') return b.figure.image ? (
              <figure key={bi} style={{ margin: '0 auto 1.2em', width: `${Math.min(100, Math.max(25, b.figure.bbox[2] * 100 / 0.866))}%`, textAlign: 'center' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={b.figure.image} alt={b.figure.caption} style={{ width: '100%', border: '1px solid #C0C6CE' }} />
                <figcaption style={{ color: '#6B7580', fontSize: '0.85em', fontStyle: 'italic' }}>{b.figure.caption}</figcaption>
              </figure>
            ) : null;
            if (b.kind === 'paragraph') return <p key={bi} style={{ margin: '0 0 1em' }}>{b.title && <b>{b.title}: </b>}{b.text}</p>;
            return (
              <section key={bi}>{b.items.map((sg, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-end', gap: '1.2em', margin: '1.6em 0 0.6em' }}>
                  <b style={{ minWidth: '28%' }}>{sg.label}</b>
                  <span style={{ flex: 1, borderBottom: '1px solid #12161c', minHeight: '2.6em', display: 'flex', alignItems: 'flex-end' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {sg.image ? <img src={sg.image} alt="Signature" style={{ height: '2.6em' }} /> : <span style={{ color: '#6B7580' }}>{sg.present ? '(signed on paper)' : ''}</span>}
                  </span>
                </div>
              ))}</section>
            );
          })}
          <footer style={{ marginTop: '2em', paddingTop: '0.4em', borderTop: '1px solid #C0C6CE', color: '#6B7580', fontSize: '0.75em' }}>
            Document {m.footer.documentId} · Engines: {m.footer.engines.map(engineLabel).join(', ')} · {m.footer.verification}
          </footer>
        </article>
      )}
    </div>
  );
}
