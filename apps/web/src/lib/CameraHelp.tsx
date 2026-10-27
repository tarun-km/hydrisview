'use client';
/**
 * Camera problem panel + camera picker, shared by the glasses scan screen (HUD) and the console
 * scan dialog. Explains why the camera did not open (permission denied, blocked by the page, in
 * use, no camera, insecure page) with concrete steps, and always offers Retry and photo upload.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CameraOff, RefreshCw, SwitchCamera, Upload } from 'lucide-react';
import { CameraError, listCameras, type CameraDevice } from '@/glasses/camera';

export function asCameraError(e: unknown): CameraError {
  return e instanceof CameraError ? e : new CameraError('unknown', e instanceof Error ? e.message : 'The camera could not be opened', ['Press Retry, or upload a photo of the page instead.']);
}

/** Hidden `<input type=file accept=image/* capture=environment>`; call `open()` from a click. */
export function usePhotoPicker(onFiles: (files: File[]) => void, multiple = false) {
  const ref = useRef<HTMLInputElement>(null);
  const input = (
    <input ref={ref} type="file" accept="image/*" capture="environment" multiple={multiple} hidden data-testid="photo-input"
      onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ''; if (f.length) onFiles(f); }} />
  );
  return { input, open: () => ref.current?.click() };
}

export function CameraProblem({ error, onRetry, onUpload, extra, variant = 'console' }: { error: CameraError; onRetry: () => void; onUpload: () => void; extra?: ReactNode; variant?: 'hud' | 'console' }) {
  const hud = variant === 'hud';
  return (
    <div role="alert" className={hud ? 'grid gap-3 text-left' : 'grid gap-3 rounded-2xl border border-[rgb(245_184_61/0.45)] bg-[rgb(245_184_61/0.08)] p-4 text-sm'}>
      <div className={`flex items-center gap-2 font-medium ${hud ? 'text-[26px]' : ''}`}><CameraOff size={hud ? 28 : 18} aria-hidden />{error.message}</div>
      {error.help.length > 0 && (
        <ol className={`grid list-decimal gap-1 pl-5 ${hud ? 'text-[18px] text-white/70' : 'text-text-2'}`}>
          {error.help.map((h, i) => <li key={i}>{h}</li>)}
        </ol>
      )}
      <div className={`flex flex-wrap gap-2 ${hud ? 'mt-1' : ''}`}>
        <button type="button" onClick={onRetry} className={hud ? 'flex items-center gap-2 rounded-[18px] bg-lime px-5 py-3 text-[20px] text-black' : 'btn btn-primary'}><RefreshCw size={hud ? 22 : 15} aria-hidden />Retry camera</button>
        <button type="button" onClick={onUpload} className={hud ? 'flex items-center gap-2 rounded-[18px] bg-white/10 px-5 py-3 text-[20px]' : 'btn'}><Upload size={hud ? 22 : 15} aria-hidden />Upload a photo instead</button>
        {extra}
      </div>
    </div>
  );
}

/** Camera picker (only rendered when there is more than one camera). */
export function CameraPicker({ current, onPick, variant = 'console' }: { current?: string; onPick: (deviceId: string) => void; variant?: 'hud' | 'console' }) {
  const [cams, setCams] = useState<CameraDevice[]>([]);
  useEffect(() => { void listCameras().then(setCams); }, [current]);
  if (cams.length < 2) return null;
  if (variant === 'hud') {
    const i = Math.max(0, cams.findIndex((c) => c.deviceId === current));
    const next = cams[(i + 1) % cams.length]!;
    return <button type="button" onClick={() => onPick(next.deviceId)} className="flex items-center gap-2 rounded-[16px] bg-white/10 px-4 py-2 text-[17px]" aria-label="Switch camera"><SwitchCamera size={20} aria-hidden />Switch camera</button>;
  }
  return (
    <label className="flex items-center gap-2 text-xs text-muted">
      <SwitchCamera size={14} aria-hidden />Camera
      <select className="input h-8 py-0 text-xs" value={current ?? ''} onChange={(e) => onPick(e.target.value)} aria-label="Choose camera">
        {cams.map((c) => <option key={c.deviceId} value={c.deviceId}>{c.label}</option>)}
      </select>
    </label>
  );
}
