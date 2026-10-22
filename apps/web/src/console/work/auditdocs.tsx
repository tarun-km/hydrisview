'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, FileImage, Loader2, ScanLine, Sparkles, Upload, X } from 'lucide-react';
import type { AuditExtraction, AuditDocStatus } from '@hydris/domain';
import { apiBlob, errorMessage, post } from '@/lib/api';
import { useApi, invalidatePaths } from '@/lib/query';
import { scanPage, uploadBody, warmUpOcr, type ScannedPage } from '@/lib/ocr';
import { renderSampleAuditSheet } from '@/lib/sample-audit';
import { GuidedCapture } from '@/lib/GuidedCapture';
import { openCamera, type CameraKind, type CameraSource } from '@/glasses/camera';
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
export const engineLabel = (e: string) => (e.startsWith('vision:') ? 'Vision AI' : e === 'ocr:original' ? 'OCR · original' : e === 'ocr:enhanced' ? 'OCR · enhanced' : e);

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

  const startCamera = async (prefer?: CameraKind) => {
    setError(null);
    try {
      setCamera(await openCamera(prefer));
    } catch (e) {
      setError(`Camera unavailable: ${errorMessage(e)}`);
    }
  };

  const submit = async () => {
    setError(null);
    setBusy({ stage: 'Uploading and structuring', progress: 0.5 });
    try {
      const r = await post<AuditDocSummary>('/audit-docs', uploadBody(pages, title.trim() ? { title: title.trim() } : {}));
      if (r.aiStatus === 'pending') {
        setBusy({ stage: 'Vision AI is reading the layout (tables, figures, handwriting)…', progress: 0.75 });
        await post(`/audit-docs/${r.id}/enhance`).catch(() => {});
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
            <GuidedCapture source={camera} variant="console" onCaptured={(pg) => { camera.stop(); setCamera(null); void add(pg.blob); }} onError={(m) => { camera.stop(); setCamera(null); setError(m); }} />
          </div>
          <p className="text-xs text-muted">Hold the A4 sheet flat and square; it captures automatically when aligned and steady, then the page is flattened before OCR.</p>
          <div className="flex gap-2">
            <Button onClick={() => { camera.stop(); setCamera(null); }}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-3">
          <button type="button" disabled={!!busy || pages.length >= max} onClick={() => fileRef.current?.click()} className="card card-tight flex flex-col items-start gap-2 text-left transition-colors hover:border-line-2 disabled:opacity-50">
            <Upload size={18} aria-hidden /><span className="font-medium">Photo or file</span><span className="text-xs text-muted">JPEG/PNG of a page</span>
          </button>
          <button type="button" disabled={!!busy || pages.length >= max} onClick={() => void startCamera()} className="card card-tight flex flex-col items-start gap-2 text-left transition-colors hover:border-line-2 disabled:opacity-50">
            <Camera size={18} aria-hidden /><span className="font-medium">Camera</span><span className="text-xs text-muted">Guided A4 capture</span>
          </button>
          <button type="button" disabled={!!busy || pages.length >= max} onClick={() => void startCamera('simulated')} className="card card-tight flex flex-col items-start gap-2 text-left transition-colors hover:border-line-2 disabled:opacity-50">
            <FileImage size={18} aria-hidden /><span className="font-medium">Simulated glasses camera</span><span className="text-xs text-muted">Sample sheet filmed on a desk</span>
          </button>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" multiple hidden onChange={async (e) => {
            const files = [...(e.target.files ?? [])].slice(0, max - pages.length);
            e.target.value = '';
            for (const f of files) await add(f);
          }} />
        </div>
      )}

      {pages.length > 0 && (
        <ul className="flex gap-3 overflow-x-auto pb-1" aria-label="Scanned pages">
          {pages.map((p, i) => (
            <li key={i} className="relative w-[110px] flex-none">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.dataUrl} alt={`Page ${i + 1}`} className="aspect-[3/4] w-full rounded-xl border border-line object-cover" />
              <span className="mt-1 block text-center text-[11.5px] text-muted num">p{i + 1} · {Math.round(p.readings[0]!.conf)}% conf</span>
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
