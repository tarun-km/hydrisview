'use client';
/**
 * Glasses: Audit scan. Look at a paper record, capture each page with the Meta Ray-Ban camera
 * (or the device camera in the simulator), read it on the device with two independent OCR
 * passes, preview what was found, and send it to the console for dual verification.
 */
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Camera, CameraOff, CheckCircle2, FileImage, FileScan, Plus, RefreshCw, ScanLine, Send, Sparkles, Trash2, Upload, WifiOff } from 'lucide-react';
import { agreementScore, structureFromOcr } from '@hydris/domain';
import { scanPage, uploadBody, warmUpOcr, type ScannedPage } from '@/lib/ocr';
import { renderSampleAuditSheet } from '@/lib/sample-audit';
import { hasGlassesBridge, openCamera, type CameraError, type CameraKind, type CameraSource } from './camera';
import { CameraPicker, asCameraError, usePhotoPicker } from '@/lib/CameraHelp';
import { GuidedCapture, type CapturedPage } from '@/lib/GuidedCapture';
import type { GAuditScan, GlassesData } from './data';
import { HudItem, HudPill, HudTitle, useHud } from './hud';

type Stage = { s: 'menu' } | { s: 'camera' } | { s: 'reading'; stage: string; progress: number } | { s: 'review' } | { s: 'sending' } | { s: 'sent'; scan: GAuditScan } | { s: 'error'; message: string } | { s: 'camera-error'; err: CameraError };
const MAX_PAGES = 6;
const STATUS: Record<GAuditScan['status'], string> = { processing: 'processing', in_review: 'in review', verified: 'verified', approved: 'approved', rejected: 'rejected' };

export function AuditScanScreen({ data, online, flash }: { data: GlassesData; online: boolean; flash: (t: string, tone?: 'lime' | 'critical' | 'high') => void }) {
  const [stage, setStage] = useState<Stage>({ s: 'menu' });
  const [pages, setPages] = useState<ScannedPage[]>([]);
  const [recent, setRecent] = useState<GAuditScan[] | null>(null);
  const cam = useRef<CameraSource | null>(null);
  const [source, setSource] = useState<CameraSource | null>(null);
  const shutter = useRef<{ capture: () => void } | null>(null);
  const lastKind = useRef<CameraKind | undefined>(undefined);

  useEffect(() => warmUpOcr(), []);
  useEffect(() => {
    if (online) data.auditScans().then(setRecent).catch(() => setRecent([]));
  }, [data, online, stage.s]);
  useEffect(() => () => cam.current?.stop(), []);
  // Ray-Ban capture button (companion app → DAT Inputs): shoot while framing, or start a scan.
  const stageRef = useRef(stage.s);
  stageRef.current = stage.s;
  useEffect(() => {
    const onButton = () => {
      if (stageRef.current === 'camera') shutter.current?.capture();
      else if (stageRef.current === 'menu' || stageRef.current === 'review') void startCamera(lastKind.current);
    };
    window.addEventListener('hydris:glasses-capture-button', onButton);
    return () => window.removeEventListener('hydris:glasses-capture-button', onButton);
  });

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

  const closeCamera = () => {
    cam.current?.stop();
    cam.current = null;
    setSource(null);
  };
  const startCamera = async (prefer?: CameraKind, deviceId?: string) => {
    try {
      closeCamera();
      cam.current = await openCamera(prefer, deviceId);
      lastKind.current = cam.current.kind;
      setSource(cam.current);
      setStage({ s: 'camera' });
    } catch (e) {
      // Explain the failure (permission, in use, no camera, insecure page) and offer retry / upload.
      setStage({ s: 'camera-error', err: asCameraError(e) });
    }
  };
  const photo = usePhotoPicker((files) => { closeCamera(); void read(files[0]!); });
  const onCaptured = (p: CapturedPage) => {
    closeCamera();
    void read(p.blob);
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
    stage.s === 'menu' ? [{ key: 'cam', onSelect: () => void startCamera() }, { key: 'upload', onSelect: photo.open }, { key: 'sim', onSelect: () => void startCamera('simulated') }, { key: 'sample', onSelect: () => void sample() }]
      : stage.s === 'camera-error' ? [{ key: 'retry', onSelect: () => void startCamera(lastKind.current === 'simulated' ? undefined : lastKind.current) }, { key: 'upload', onSelect: photo.open }, { key: 'sim', onSelect: () => void startCamera('simulated') }, { key: 'back', onSelect: () => setStage({ s: pages.length ? 'review' : 'menu' }) }]
      : stage.s === 'camera' ? [{ key: 'shoot', onSelect: () => shutter.current?.capture() }, { key: 'upload', onSelect: photo.open }, { key: 'cancel', onSelect: () => { closeCamera(); setStage({ s: pages.length ? 'review' : 'menu' }); } }]
        : stage.s === 'review' ? [
          { key: 'send', onSelect: () => void send(), disabled: !online },
          { key: 'more', onSelect: () => void startCamera(lastKind.current), disabled: pages.length >= MAX_PAGES },
          { key: 'sample', onSelect: () => void sample(), disabled: pages.length >= MAX_PAGES },
          { key: 'drop', onSelect: () => { setPages([]); setStage({ s: 'menu' }); } },
        ]
          : stage.s === 'sent' || stage.s === 'error' ? [{ key: 'again', onSelect: () => setStage({ s: pages.length ? 'review' : 'menu' }) }]
            : [];
  const cursor = useHud({ actions });

  if (stage.s === 'camera' && source) {
    return (
      <div className="flex h-full flex-col gap-2.5">
        <div className="flex items-baseline justify-between">
          <span className="text-[17px] uppercase tracking-[0.14em] text-white/55">Page {pages.length + 1} · {source.label}</span>
          <span className="text-[16px] text-white/45">auto-captures when aligned</span>
        </div>
        <div className="min-h-0 flex-1">
          <GuidedCapture source={source} controlRef={shutter} onCaptured={onCaptured} onError={(m) => { closeCamera(); setStage({ s: 'error', message: m }); }} />
        </div>
        {source.kind === 'device-camera' && <div className="flex justify-end"><CameraPicker variant="hud" current={source.deviceId} onPick={(id) => void startCamera('device-camera', id)} /></div>}
        <div className="grid grid-cols-[1fr_auto_auto] gap-2">
          {/* Always works: takes the photo now even when no page outline was detected. */}
          <HudItem active={cursor === 0} tone="lime" onClick={() => shutter.current?.capture()}><Camera size={24} /><span className="flex-1">Take photo</span></HudItem>
          <HudItem active={cursor === 1} onClick={photo.open}><Upload size={22} /><span className="text-[19px]">Upload</span></HudItem>
          {photo.input}
          <HudItem active={cursor === 2} onClick={() => { closeCamera(); setStage({ s: pages.length ? 'review' : 'menu' }); }}><span className="text-[19px]">Cancel</span></HudItem>
        </div>
      </div>
    );
  }

  if (stage.s === 'camera-error') {
    const err = stage.err;
    return (
      <div className="flex h-full flex-col gap-3">
        <HudTitle eyebrow="Camera did not open">{err.message}</HudTitle>
        <ol className="grid list-decimal gap-1 pl-6 text-[18px] leading-snug text-white/70" role="alert">
          {err.help.map((h, i) => <li key={i}>{h}</li>)}
        </ol>
        <div className="mt-auto grid gap-2">
          <HudItem active={cursor === 0} tone="lime" onClick={() => void startCamera(lastKind.current === 'simulated' ? undefined : lastKind.current)}><RefreshCw size={24} /><span className="flex-1">Retry camera</span></HudItem>
          <HudItem active={cursor === 1} onClick={photo.open}><Upload size={24} /><span className="flex-1">Upload photo / choose file</span></HudItem>
          <div className="grid grid-cols-2 gap-2">
            <HudItem active={cursor === 2} onClick={() => void startCamera('simulated')}><ScanLine size={22} /><span className="text-[19px]">Simulated camera</span></HudItem>
            <HudItem active={cursor === 3} onClick={() => setStage({ s: pages.length ? 'review' : 'menu' })}><CameraOff size={22} /><span className="text-[19px]">Back</span></HudItem>
          </div>
        </div>
        {photo.input}
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
          <HudPill tone="ok"><CheckCircle2 size={17} />{sc.fields} value{sc.fields === 1 ? "" : "s"}</HudPill>
          <HudPill tone="line">{sc.tables} table{sc.tables === 1 ? "" : "s"}</HudPill>
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
    const disagree = fields.filter((f) => f.agreement === 'mismatch' || f.note).length + parts.reduce((n, x) => n + x.tables.reduce((k, t) => k + (t.issues?.length ?? 0), 0), 0);
    return (
      <div className="flex h-full flex-col gap-3">
        <HudTitle eyebrow={`${pages.length} page${pages.length === 1 ? '' : 's'} read on this device`}>Check the capture</HudTitle>
        <div className="flex flex-wrap gap-2">
          <HudPill tone="line">{fields.length} value{fields.length === 1 ? "" : "s"}</HudPill>
          <HudPill tone="line">{tables} table{tables === 1 ? "" : "s"}</HudPill>
          {agree !== null && <HudPill tone={disagree ? 'high' : 'ok'}>{disagree ? `${disagree} unclear` : 'both passes agree'}</HudPill>}
          {pages[pages.length - 1]!.readings[0] ? <HudPill tone="line">{Math.round(pages[pages.length - 1]!.readings[0]!.conf)}% OCR conf</HudPill> : <HudPill tone="line">server OCR</HudPill>}
        </div>
        <ul className="grid grid-cols-[minmax(0,1fr)] min-h-0 gap-1.5 overflow-y-auto text-[19px] scrollbar-none">
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
            <HudItem active={cursor === 1} disabled={pages.length >= MAX_PAGES} onClick={() => void startCamera(lastKind.current)}><Camera size={22} /><span className="text-[19px]">Add page</span></HudItem>
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
        <Camera size={26} /><span className="min-w-0 flex-1"><span className="block">Scan a document</span><span className="block text-[17px] text-white/55">{hasGlassesBridge() ? 'Ray-Ban Meta camera' : 'Camera'} · guided A4 framing · up to {MAX_PAGES} pages</span></span>
      </HudItem>
      <HudItem active={cursor === 1} onClick={photo.open}>
        <Upload size={26} /><span className="min-w-0 flex-1"><span className="block">Upload photo / choose file</span><span className="block text-[17px] text-white/55">Use a photo already taken of the page</span></span>
      </HudItem>
      {photo.input}
      <HudItem active={cursor === 2} onClick={() => void startCamera('simulated')}>
        <ScanLine size={26} /><span className="min-w-0 flex-1"><span className="block">Simulated glasses camera</span><span className="block text-[17px] text-white/55">Watch guided capture without hardware</span></span>
      </HudItem>
      <HudItem active={cursor === 3} onClick={() => void sample()}>
        <FileImage size={26} /><span className="min-w-0 flex-1"><span className="block">Use sample audit sheet</span><span className="block text-[17px] text-white/55">Try the pipeline without paper</span></span>
      </HudItem>
      <div className="mt-1 text-[17px] uppercase tracking-[0.14em] text-white/50">My recent scans</div>
      {!online ? <p className="flex items-center gap-2 text-[19px] text-white/55"><WifiOff size={18} /> Offline</p>
        : !recent ? <p className="text-[19px] text-white/55">Loading…</p>
          : recent.length ? (
            <ul className="grid grid-cols-[minmax(0,1fr)] min-h-0 gap-1.5 overflow-y-auto scrollbar-none">
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
