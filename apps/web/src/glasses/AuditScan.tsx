'use client';
/**
 * Glasses: Audit scan. Look at a paper record, capture each page with the Meta Ray-Ban camera
 * (or the device camera in the simulator), read it on the device with two independent OCR
 * passes, preview what was found, and send it to the console for dual verification.
 */
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Camera, CheckCircle2, FileImage, FileScan, Plus, RefreshCw, ScanLine, Send, Sparkles, Trash2, WifiOff } from 'lucide-react';
import { agreementScore, structureFromOcr } from '@hydris/domain';
import { scanPage, uploadBody, warmUpOcr, type ScannedPage } from '@/lib/ocr';
import { renderSampleAuditSheet } from '@/lib/sample-audit';
import { openCamera, type CameraSource } from './camera';
import type { GAuditScan, GlassesData } from './data';
import { HudItem, HudPill, HudTitle, useHud } from './hud';

type Stage = { s: 'menu' } | { s: 'camera' } | { s: 'reading'; stage: string; progress: number } | { s: 'review' } | { s: 'sending' } | { s: 'sent'; scan: GAuditScan } | { s: 'error'; message: string };
const MAX_PAGES = 6;
const STATUS: Record<GAuditScan['status'], string> = { processing: 'processing', in_review: 'in review', verified: 'verified', approved: 'approved', rejected: 'rejected' };

export function AuditScanScreen({ data, online, flash }: { data: GlassesData; online: boolean; flash: (t: string, tone?: 'lime' | 'critical' | 'high') => void }) {
  const [stage, setStage] = useState<Stage>({ s: 'menu' });
  const [pages, setPages] = useState<ScannedPage[]>([]);
  const [recent, setRecent] = useState<GAuditScan[] | null>(null);
  const cam = useRef<CameraSource | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => warmUpOcr(), []);
  useEffect(() => {
    if (online) data.auditScans().then(setRecent).catch(() => setRecent([]));
  }, [data, online, stage.s]);
  useEffect(() => () => cam.current?.stop(), []);
  useEffect(() => { if (video.current && stream) video.current.srcObject = stream; }, [stream, stage.s]);

  const read = async (blob: Blob) => {
    setStage({ s: 'reading', stage: 'Preparing', progress: 0 });
    try {
      const p = await scanPage(blob, (x) => setStage({ s: 'reading', stage: x.stage, progress: x.progress }));
      setPages((ps) => [...ps, p]);
      setStage({ s: 'review' });
    } catch (e) {
      setStage({ s: 'error', message: e instanceof Error ? e.message : 'Could not read the page' });
    }
  };

  const startCamera = async () => {
    try {
      cam.current?.stop();
      cam.current = await openCamera();
      setStream(cam.current.stream ?? null);
      setStage({ s: 'camera' });
    } catch (e) {
      setStage({ s: 'error', message: e instanceof Error ? e.message : 'Camera unavailable' });
    }
  };
  const capture = async () => {
    const c = cam.current;
    if (!c) return;
    try {
      const blob = await c.capture();
      c.stop();
      cam.current = null;
      setStream(null);
      await read(blob);
    } catch (e) {
      setStage({ s: 'error', message: e instanceof Error ? e.message : 'Capture failed' });
    }
  };
  const sample = async () => read(await renderSampleAuditSheet(Math.floor(Math.random() * 20)));

  const send = async () => {
    setStage({ s: 'sending' });
    try {
      const scan = await data.submitAuditScan(uploadBody(pages));
      setPages([]);
      setStage({ s: 'sent', scan });
      flash('Scan sent for verification', 'lime');
      if (scan.aiStatus === 'pending') void data.enhanceAuditScan(scan.id).catch(() => {});
    } catch (e) {
      setStage({ s: 'error', message: e instanceof Error ? e.message : 'Upload failed' });
    }
  };

  // ---- actions per stage (directional input: ↑↓ move, ● select)
  const actions =
    stage.s === 'menu' ? [{ key: 'cam', onSelect: () => void startCamera() }, { key: 'sample', onSelect: () => void sample() }]
      : stage.s === 'camera' ? [{ key: 'shoot', onSelect: () => void capture() }]
        : stage.s === 'review' ? [
          { key: 'send', onSelect: () => void send(), disabled: !online },
          { key: 'more', onSelect: () => void startCamera(), disabled: pages.length >= MAX_PAGES },
          { key: 'sample', onSelect: () => void sample(), disabled: pages.length >= MAX_PAGES },
          { key: 'drop', onSelect: () => { setPages([]); setStage({ s: 'menu' }); } },
        ]
          : stage.s === 'sent' || stage.s === 'error' ? [{ key: 'again', onSelect: () => setStage({ s: pages.length ? 'review' : 'menu' }) }]
            : [];
  const cursor = useHud({ actions });

  if (stage.s === 'camera') {
    return (
      <div className="flex h-full flex-col gap-3">
        <HudTitle eyebrow={cam.current?.label ?? 'Camera'}>Frame the page</HudTitle>
        {stream ? (
          <div className="relative min-h-0 flex-1 overflow-hidden rounded-[26px] border-2 border-white/15">
            <video ref={video} autoPlay playsInline muted className="h-full w-full object-cover" />
            <div className="pointer-events-none absolute inset-[8%] rounded-[18px] border-[3px] border-dashed border-lime/80" aria-hidden />
          </div>
        ) : (
          <div className="grid flex-1 place-items-center rounded-[26px] border-2 border-dashed border-lime/60 px-6 text-center text-[22px] text-white/75">
            Look straight at the document, fill your view with the page and hold still.
          </div>
        )}
        <HudItem active={cursor === 0} tone="lime" onClick={() => void capture()}><Camera size={26} /><span className="flex-1">Capture page {pages.length + 1}</span></HudItem>
      </div>
    );
  }

  if (stage.s === 'reading' || stage.s === 'sending') {
    const pct = stage.s === 'reading' ? Math.round(stage.progress * 100) : 70;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-6 text-center">
        <ScanLine size={56} className="animate-pulse text-lime" />
        <div className="text-[30px]">{stage.s === 'reading' ? 'Reading the page' : 'Sending for verification'}</div>
        <div className="text-[20px] text-white/60">{stage.s === 'reading' ? stage.stage : 'Structuring values and tables…'}</div>
        <div className="h-[10px] w-[80%] overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-lime transition-all" style={{ width: `${pct}%` }} /></div>
      </div>
    );
  }

  if (stage.s === 'error') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-5 text-center">
        <AlertTriangle size={52} className="text-[#ff9a5c]" />
        <div className="text-[28px]">Scan problem</div>
        <p className="text-[20px] text-white/65">{stage.message}</p>
        <div className="w-full"><HudItem active={cursor === 0} onClick={() => setStage({ s: pages.length ? 'review' : 'menu' })}><RefreshCw size={24} /><span className="flex-1">Back</span></HudItem></div>
      </div>
    );
  }

  if (stage.s === 'sent') {
    const sc = stage.scan;
    return (
      <div className="flex h-full flex-col gap-4">
        <HudTitle eyebrow="Sent · awaiting dual verification">{sc.title}</HudTitle>
        <div className="flex flex-wrap gap-2">
          <HudPill tone="ok"><CheckCircle2 size={17} />{sc.fields} values</HudPill>
          <HudPill tone="line">{sc.tables} tables</HudPill>
          {sc.agreement !== null && <HudPill tone={sc.agreement >= 0.9 ? 'ok' : 'medium'}>{Math.round(sc.agreement * 100)}% engines agree</HudPill>}
          {sc.attention > 0 && <HudPill tone="high"><AlertTriangle size={17} />{sc.attention} to check</HudPill>}
          {sc.aiStatus === 'pending' && <HudPill tone="lime"><Sparkles size={17} />vision AI reading</HudPill>}
        </div>
        <p className="text-[20px] leading-snug text-white/70">A reviewer confirms every value against the paper in the console (Work → Audit documents), then a second person approves. The searchable PDF is generated there.</p>
        <div className="mt-auto"><HudItem active={cursor === 0} tone="lime" onClick={() => setStage({ s: 'menu' })}><Plus size={26} /><span className="flex-1">Scan another document</span></HudItem></div>
      </div>
    );
  }

  if (stage.s === 'review') {
    const parts = pages.map((p, i) => structureFromOcr(i + 1, p.readings));
    const fields = parts.flatMap((x) => x.fields);
    const tables = parts.reduce((n, x) => n + x.tables.length, 0);
    const agree = agreementScore(fields);
    const disagree = fields.filter((f) => f.agreement === 'mismatch' || f.note).length;
    return (
      <div className="flex h-full flex-col gap-3">
        <HudTitle eyebrow={`${pages.length} page${pages.length === 1 ? '' : 's'} read on this device`}>Check the capture</HudTitle>
        <div className="flex flex-wrap gap-2">
          <HudPill tone="line">{fields.length} values</HudPill>
          <HudPill tone="line">{tables} tables</HudPill>
          {agree !== null && <HudPill tone={disagree ? 'high' : 'ok'}>{disagree ? `${disagree} unclear` : 'both passes agree'}</HudPill>}
          <HudPill tone="line">{Math.round(pages[pages.length - 1]!.readings[0]!.conf)}% OCR conf</HudPill>
        </div>
        <ul className="grid min-h-0 gap-1.5 overflow-y-auto text-[19px] scrollbar-none">
          {fields.slice(0, 5).map((f) => (
            <li key={f.id} className="flex gap-3 rounded-[16px] bg-white/5 px-4 py-1.5">
              <span className="truncate text-white/55">{f.label}</span>
              <span className={`ml-auto num ${f.agreement === 'mismatch' || f.note ? 'text-[#ff9a5c]' : 'text-white'}`}>{f.value}{f.unit ? ` ${f.unit}` : ''}</span>
            </li>
          ))}
          {!fields.length && <li className="text-white/60">No labelled values found yet - the page text is still sent and can be reviewed.</li>}
        </ul>
        <div className="mt-auto grid gap-2">
          <HudItem active={cursor === 0} tone="lime" disabled={!online} onClick={() => void send()}><Send size={24} /><span className="flex-1">{online ? 'Send for verification' : 'Offline - connect to send'}</span></HudItem>
          <div className="grid grid-cols-3 gap-2">
            <HudItem active={cursor === 1} disabled={pages.length >= MAX_PAGES} onClick={() => void startCamera()}><Camera size={22} /><span className="text-[19px]">Add page</span></HudItem>
            <HudItem active={cursor === 2} disabled={pages.length >= MAX_PAGES} onClick={() => void sample()}><FileImage size={22} /><span className="text-[19px]">Sample</span></HudItem>
            <HudItem active={cursor === 3} onClick={() => { setPages([]); setStage({ s: 'menu' }); }}><Trash2 size={22} /><span className="text-[19px]">Discard</span></HudItem>
          </div>
        </div>
      </div>
    );
  }

  // menu
  return (
    <div className="flex h-full flex-col gap-3">
      <HudTitle eyebrow="Paper records → verified digital audit">Audit scan</HudTitle>
      <HudItem active={cursor === 0} tone="lime" onClick={() => void startCamera()}>
        <Camera size={26} /><span className="min-w-0 flex-1"><span className="block">Scan a document</span><span className="block text-[17px] text-white/55">Glasses camera · up to {MAX_PAGES} pages</span></span>
      </HudItem>
      <HudItem active={cursor === 1} onClick={() => void sample()}>
        <FileImage size={26} /><span className="min-w-0 flex-1"><span className="block">Use sample audit sheet</span><span className="block text-[17px] text-white/55">Try the pipeline without paper</span></span>
      </HudItem>
      <div className="mt-1 text-[17px] uppercase tracking-[0.14em] text-white/50">My recent scans</div>
      {!online ? <p className="flex items-center gap-2 text-[19px] text-white/55"><WifiOff size={18} /> Offline</p>
        : !recent ? <p className="text-[19px] text-white/55">Loading…</p>
          : recent.length ? (
            <ul className="grid min-h-0 gap-1.5 overflow-y-auto scrollbar-none">
              {recent.slice(0, 4).map((r) => (
                <li key={r.id} className="flex items-center gap-3 rounded-[16px] bg-white/5 px-4 py-2 text-[19px]">
                  <FileScan size={20} className="flex-none text-white/50" />
                  <span className="min-w-0 flex-1 truncate">{r.title}</span>
                  <span className={r.status === 'approved' ? 'text-[#34d27a]' : r.status === 'rejected' ? 'text-[#ff5a4e]' : 'text-white/55'}>{STATUS[r.status]}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-[19px] text-white/55">No scans yet.</p>}
    </div>
  );
}
