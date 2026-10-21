'use client';
/**
 * Guided A4 capture: live preview from the glasses (or device / simulated) camera with an A4
 * guide, the detected sheet outlined in real time and one instruction at a time (move closer,
 * straighten, hold still…). When the sheet is aligned and steady it captures automatically,
 * re-detects the page on the full-resolution still and flattens it to a true A4 page.
 */
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { CameraSource } from '@/glasses/camera';
import { detectDocument, guide, insetQuad, quadMotion, warpToA4, type Detection, type Guidance, type Quad } from './docdetect';

export interface CapturedPage { blob: Blob; dataUrl: string; corrected: boolean }

const READY_MS = 900;
const DETECT_MS = 90;

export function GuidedCapture({ source, onCaptured, onError, controlRef, variant = 'hud', autoCapture = true }: {
  source: CameraSource;
  onCaptured: (p: CapturedPage) => void;
  onError: (message: string) => void;
  /** Lets the host (HUD select key / button) trigger a manual capture. */
  controlRef?: MutableRefObject<{ capture: () => void } | null>;
  variant?: 'hud' | 'console';
  autoCapture?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [g, setG] = useState<Guidance>({ code: 'no_document', message: 'Starting camera…', ok: false });
  const [readyPct, setReadyPct] = useState(0);
  const [busy, setBusy] = useState(false);
  const state = useRef({ last: null as Quad | null, stableCount: 0, readySince: 0, lastDetect: 0, det: null as Detection | null, capturing: false });

  const capture = useCallback(async () => {
    const s = state.current;
    if (s.capturing) return;
    s.capturing = true;
    setBusy(true);
    try {
      const photo = await createImageBitmap(await source.capture());
      // Re-detect on the still (more pixels, no motion blur); fall back to the preview quad.
      const d = detectDocument(photo, photo.width, photo.height);
      const q = d.quad && d.coverage > 0.2 && !d.touchesEdge ? d.quad : s.det?.quad && !s.det.touchesEdge ? s.det.quad : null;
      let out: HTMLCanvasElement;
      if (q) out = warpToA4(photo, insetQuad(q));
      else {
        out = document.createElement('canvas');
        out.width = photo.width;
        out.height = photo.height;
        out.getContext('2d')!.drawImage(photo, 0, 0);
      }
      photo.close();
      const blob = await new Promise<Blob>((res, rej) => out.toBlob((b) => (b ? res(b) : rej(new Error('Encoding failed'))), 'image/jpeg', 0.9));
      onCaptured({ blob, dataUrl: out.toDataURL('image/jpeg', 0.6), corrected: !!q });
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Capture failed');
    } finally {
      s.capturing = false;
      setBusy(false);
    }
  }, [source, onCaptured, onError]);

  useEffect(() => {
    if (controlRef) controlRef.current = { capture: () => void capture() };
    return () => { if (controlRef) controlRef.current = null; };
  }, [controlRef, capture]);

  useEffect(() => {
    let raf = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const f = source.frame();
      const c = canvas.current;
      if (!f || !c) return;
      if (c.width !== f.w || c.height !== f.h) { c.width = f.w; c.height = f.h; }
      const ctx = c.getContext('2d')!;
      ctx.drawImage(f.src, 0, 0, f.w, f.h);
      const s = state.current;
      if (now - s.lastDetect >= DETECT_MS) {
        s.lastDetect = now;
        const d = detectDocument(f.src, f.w, f.h);
        const motion = quadMotion(s.last, d.quad);
        s.stableCount = motion < 0.012 ? s.stableCount + 1 : 0;
        s.last = d.quad;
        s.det = d;
        const gd = guide(d, s.stableCount >= 4);
        setG((prev) => (prev.code === gd.code && prev.message === gd.message ? prev : gd));
        if (gd.ok) {
          s.readySince ||= now;
          const pct = Math.min(1, (now - s.readySince) / READY_MS);
          setReadyPct(pct);
          if (pct >= 1 && autoCapture && !s.capturing) void capture();
        } else {
          s.readySince = 0;
          setReadyPct(0);
        }
      }
      // Overlay: A4 guide + detected sheet.
      const det = s.det;
      const gw = f.h * 0.86 / Math.SQRT2;
      const gh = f.h * 0.86;
      ctx.save();
      ctx.lineWidth = Math.max(2, f.w / 320);
      ctx.setLineDash([f.w / 60, f.w / 90]);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.strokeRect((f.w - gw) / 2, (f.h - gh) / 2, gw, gh);
      ctx.setLineDash([]);
      if (det?.quad) {
        const ok = s.readySince > 0;
        ctx.strokeStyle = ok ? '#00FE21' : det.touchesEdge || det.skewDeg > 10 || Math.abs(det.tiltDeg) > 8 ? '#FF6A3D' : '#1954F1';
        ctx.fillStyle = ok ? 'rgba(0,254,33,0.12)' : 'rgba(25,84,241,0.12)';
        ctx.lineWidth = Math.max(3, f.w / 200);
        ctx.beginPath();
        det.quad.forEach((p, i) => (i ? ctx.lineTo(p.x * f.w, p.y * f.h) : ctx.moveTo(p.x * f.w, p.y * f.h)));
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        for (const p of det.quad) {
          ctx.beginPath();
          ctx.arc(p.x * f.w, p.y * f.h, Math.max(5, f.w / 110), 0, Math.PI * 2);
          ctx.fillStyle = ctx.strokeStyle;
          ctx.fill();
        }
      }
      ctx.restore();
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [source, capture, autoCapture]);

  const hud = variant === 'hud';
  return (
    <div className={`relative overflow-hidden bg-black ${hud ? 'h-full rounded-[26px] border-2 border-white/15' : 'rounded-[20px]'}`}>
      <canvas ref={canvas} className="block h-full w-full object-contain" aria-label="Live camera view with page detection" />
      <div className={`absolute inset-x-0 top-0 flex items-center gap-2 bg-gradient-to-b from-black/80 to-transparent ${hud ? 'px-4 pb-6 pt-3 text-[20px]' : 'px-3 pb-5 pt-2 text-sm'} text-white`} role="status" aria-live="polite">
        <span className={`h-3 w-3 flex-none rounded-full ${g.ok ? 'bg-[#00FE21]' : g.code === 'no_document' ? 'bg-white/40' : 'bg-[#FF6A3D]'}`} aria-hidden />
        <span className="min-w-0 flex-1 truncate">{busy ? 'Capturing and flattening the page…' : g.message}</span>
        <span className={`flex-none rounded-full bg-white/10 px-2 ${hud ? 'text-[15px]' : 'text-[11px]'} text-white/70`}>{source.kind === 'meta-glasses' ? 'Ray-Ban Meta' : source.kind === 'simulated' ? 'simulated' : 'camera'}</span>
      </div>
      {readyPct > 0 && !busy && (
        <div className="absolute bottom-3 left-1/2 h-[6px] w-1/2 -translate-x-1/2 overflow-hidden rounded-full bg-white/20" aria-hidden>
          <div className="h-full rounded-full bg-[#00FE21]" style={{ width: `${Math.round(readyPct * 100)}%` }} />
        </div>
      )}
    </div>
  );
}
