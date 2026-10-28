'use client';
/**
 * Camera sources for audit scans.
 *
 * Ray-Ban Meta glasses expose their camera only to native apps through Meta's Wearables Device
 * Access Toolkit (DAT): a phone app registers with the Meta AI app, opens a device session, adds
 * the camera (`session.addCamera(StreamConfiguration(...))`), collects `camera.stream.videoStream`
 * frames and calls `camera.stream.capturePhoto()`. Web pages cannot open the glasses camera, so the
 * Hydris companion app (apps/glasses-bridge-android) hosts this web app in a WebView and bridges
 * the DAT camera into it. Supported bridge shapes, in order of preference:
 *
 *  1. Android JavascriptInterface `window.HydrisNative` (the companion app):
 *       startPreview(), stopPreview(), capturePhoto(requestId), deviceName()
 *     and the host calls back into the page with
 *       window.__hydrisCameraFrame(jpegBase64, width, height)   (live preview, ~8 fps)
 *       window.__hydrisCameraPhoto(requestId, jpegBase64)       (full-resolution photo)
 *       window.__hydrisCameraError(requestId, message)
 *  2. Injected promise API `window.HydrisWearables` = { capturePhoto(): Promise<{dataUrl}>,
 *     startPreview?(onFrame), stopPreview?(), deviceName? } (iOS WKWebView hosts).
 *  3. postMessage protocol for an embedding host: page → {type:'hydris:camera-start'|'hydris:camera-stop'|
 *     'hydris:camera-capture', requestId}; host → {type:'hydris:camera-ready', deviceName},
 *     {type:'hydris:camera-frame', dataUrl}, {type:'hydris:camera-photo', requestId, dataUrl},
 *     {type:'hydris:camera-error', requestId, message}.
 *
 * Fallbacks: the phone/laptop camera (getUserMedia), and a simulated glasses camera (the same idea
 * as DAT's Mock Device Kit) that films the sample A4 sheet moving into position, so the full
 * guided-capture pipeline runs without hardware.
 */
import { renderSampleAuditSheet } from '@/lib/sample-audit';

export type CameraKind = 'meta-glasses' | 'device-camera' | 'simulated';
export interface Frame { src: CanvasImageSource; w: number; h: number }

export interface CameraSource {
  kind: CameraKind;
  label: string;
  /** Latest preview frame for live detection (null until the first frame arrives). */
  frame(): Frame | null;
  /** Full-resolution still. */
  capture(): Promise<Blob>;
  stop(): void;
  /** Browser camera in use (device cameras only), for the camera picker. */
  deviceId?: string;
}

declare global {
  interface Window {
    HydrisNative?: {
      startPreview(): void; stopPreview(): void; capturePhoto(requestId: string): void; deviceName?(): string;
      /** Glasses microphone via DAT Speech + phone TextToSpeech (see voice.ts). */
      startSpeech?(): void; stopSpeech?(): void; speak?(text: string): void;
      /** Canonical DAT-derived hardware id (see canonicalHardwareId); null until the glasses are linked. */
      hardwareId?(): string | null;
    };
    HydrisWearables?: { capturePhoto(): Promise<{ dataUrl: string }>; startPreview?(onFrame: (dataUrl: string) => void): void; stopPreview?(): void; deviceName?: string };
    ReactNativeWebView?: { postMessage(msg: string): void };
    __hydrisCameraFrame?: (b64: string, w?: number, h?: number) => void;
    __hydrisCameraPhoto?: (requestId: string, b64: string) => void;
    __hydrisCameraError?: (requestId: string, message: string) => void;
  }
}

const b64ToBlob = (b64: string, type = 'image/jpeg') => {
  const bin = atob(b64.replace(/^data:[^,]+,/, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
};
const safeJson = (s: string) => { try { return JSON.parse(s) as unknown; } catch { return null; } };
const rid = () => Math.random().toString(36).slice(2);

/** Keeps the most recent decoded preview frame (drops frames while decoding to stay real-time). */
function frameSink() {
  let latest: ImageBitmap | null = null;
  let busy = false;
  return {
    push(blob: Blob) {
      if (busy) return;
      busy = true;
      createImageBitmap(blob).then((bmp) => { latest?.close(); latest = bmp; }).catch(() => {}).finally(() => { busy = false; });
    },
    frame: (): Frame | null => (latest ? { src: latest, w: latest.width, h: latest.height } : null),
    close() { latest?.close(); latest = null; },
  };
}

// ---- 1. Android companion app (DAT) -------------------------------------------------------
function nativeBridge(): CameraSource | null {
  const n = window.HydrisNative;
  if (!n) return null;
  const sink = frameSink();
  const pending = new Map<string, { resolve: (b: Blob) => void; reject: (e: Error) => void }>();
  window.__hydrisCameraFrame = (b64) => sink.push(b64ToBlob(b64));
  window.__hydrisCameraPhoto = (id, b64) => { pending.get(id)?.resolve(b64ToBlob(b64)); pending.delete(id); };
  window.__hydrisCameraError = (id, message) => { pending.get(id)?.reject(new Error(message)); pending.delete(id); };
  n.startPreview();
  return {
    kind: 'meta-glasses',
    label: `${n.deviceName?.() || 'Ray-Ban Meta'} camera`,
    frame: sink.frame,
    capture: () => new Promise<Blob>((resolve, reject) => {
      const id = rid();
      pending.set(id, { resolve, reject });
      setTimeout(() => { if (pending.delete(id)) reject(new Error('The glasses did not return a photo')); }, 20_000);
      n.capturePhoto(id);
    }),
    stop: () => { n.stopPreview(); sink.close(); },
  };
}

// ---- 2. Injected promise API (iOS host) ----------------------------------------------------
function injectedBridge(): CameraSource | null {
  const api = window.HydrisWearables;
  if (!api) return null;
  const sink = frameSink();
  api.startPreview?.((dataUrl) => sink.push(b64ToBlob(dataUrl)));
  return {
    kind: 'meta-glasses',
    label: `${api.deviceName ?? 'Ray-Ban Meta'} camera`,
    frame: sink.frame,
    capture: async () => b64ToBlob((await api.capturePhoto()).dataUrl),
    stop: () => { api.stopPreview?.(); sink.close(); },
  };
}

// ---- 3. postMessage host ------------------------------------------------------------------
let announced: string | null = null;
if (typeof window !== 'undefined') {
  window.addEventListener('message', (e) => {
    const d = (typeof e.data === 'string' ? safeJson(e.data) : e.data) as { type?: string; deviceName?: string } | null;
    if (d?.type === 'hydris:camera-ready') announced = d.deviceName ?? 'Ray-Ban Meta';
  });
}
function postToHost(msg: unknown) {
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(msg));
  else if (window.parent !== window) window.parent.postMessage(msg, '*');
}
function messageBridge(): CameraSource | null {
  if (!announced) return null;
  const sink = frameSink();
  const onMsg = (e: MessageEvent) => {
    const d = (typeof e.data === 'string' ? safeJson(e.data) : e.data) as { type?: string; dataUrl?: string } | null;
    if (d?.type === 'hydris:camera-frame' && d.dataUrl) sink.push(b64ToBlob(d.dataUrl));
  };
  window.addEventListener('message', onMsg);
  postToHost({ type: 'hydris:camera-start' });
  return {
    kind: 'meta-glasses',
    label: `${announced} camera`,
    frame: sink.frame,
    capture: () => new Promise<Blob>((resolve, reject) => {
      const requestId = rid();
      const timer = setTimeout(() => { window.removeEventListener('message', on); reject(new Error('The glasses did not return a photo')); }, 20_000);
      function on(e: MessageEvent) {
        const d = (typeof e.data === 'string' ? safeJson(e.data) : e.data) as { type?: string; requestId?: string; dataUrl?: string; message?: string } | null;
        if (!d || d.requestId !== requestId) return;
        clearTimeout(timer);
        window.removeEventListener('message', on);
        if (d.type === 'hydris:camera-photo' && d.dataUrl) resolve(b64ToBlob(d.dataUrl));
        else reject(new Error(d.message ?? 'Camera error'));
      }
      window.addEventListener('message', on);
      postToHost({ type: 'hydris:camera-capture', requestId });
    }),
    stop: () => { postToHost({ type: 'hydris:camera-stop' }); window.removeEventListener('message', onMsg); sink.close(); },
  };
}

// ---- device camera ------------------------------------------------------------------------
export type CameraErrorCode = 'insecure' | 'unsupported' | 'denied' | 'policy' | 'not_found' | 'busy' | 'overconstrained' | 'timeout' | 'unknown';

/** A camera failure the UI can explain (what happened + what the user can do about it). */
export class CameraError extends Error {
  constructor(public code: CameraErrorCode, message: string, public help: string[] = []) {
    super(message);
    this.name = 'CameraError';
  }
}

const inFrame = () => typeof window !== 'undefined' && window.parent !== window;

/** Translate a getUserMedia DOMException into a CameraError with concrete next steps. */
export function cameraError(e: unknown): CameraError {
  if (e instanceof CameraError) return e;
  const name = (e as { name?: string })?.name ?? '';
  const msg = (e as { message?: string })?.message ?? String(e);
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    // Chrome reports a Permissions-Policy / iframe `allow` block as NotAllowedError mentioning the policy.
    if (/policy|feature/i.test(msg)) return new CameraError('policy', 'The camera is blocked for this embedded page', ['Open the page directly (not inside a frame), or allow "camera" on the frame.', 'You can still upload a photo of the page instead.']);
    return new CameraError('denied', 'Camera permission was denied', [
      'Click the camera icon (or the lock icon) in the address bar, choose Allow, then press Retry.',
      'On a phone: Settings → your browser → Camera → Allow.',
      inFrame() ? 'In the simulator the prompt belongs to the outer page - allow it there.' : 'If no prompt appears, the browser remembers an earlier "Block" - reset it in the site settings.',
      'You can still upload a photo of the page instead.',
    ]);
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return new CameraError('not_found', 'No camera was found on this device', ['Connect a camera, or upload a photo of the page instead.']);
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
    return new CameraError('busy', 'The camera is in use by another app or tab', ['Close other apps or tabs using the camera (video calls, other scanners), then press Retry.']);
  }
  if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') return new CameraError('overconstrained', 'This camera does not support the requested mode', ['Press Retry, or pick another camera.']);
  return new CameraError('unknown', msg || 'The camera could not be opened', ['Press Retry, or upload a photo of the page instead.']);
}

/** Pre-flight checks that explain the failure before the browser does (or silently does not) prompt. */
export function cameraPreflight(): CameraError | null {
  if (typeof window === 'undefined') return new CameraError('unsupported', 'No browser');
  if (!window.isSecureContext) return new CameraError('insecure', 'The camera needs a secure (https) connection', [`Open ${location.href.replace(/^http:/, 'https:')}, or use http://localhost during development.`, 'You can still upload a photo of the page instead.']);
  if (!navigator.mediaDevices?.getUserMedia) return new CameraError('unsupported', 'This browser cannot open a camera', ['Use a current Chrome, Edge, Safari or Firefox, or upload a photo instead.']);
  return null;
}

/** 'granted' | 'denied' | 'prompt' | 'unknown' (the Permissions API is not available everywhere). */
export async function cameraPermission(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
  try {
    return (await navigator.permissions.query({ name: 'camera' as PermissionName })).state;
  } catch {
    return 'unknown';
  }
}

export interface CameraDevice { deviceId: string; label: string }
/** Video inputs (labels are only filled in after permission has been granted once). */
export async function listCameras(): Promise<CameraDevice[]> {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === 'videoinput' && d.deviceId).map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
  } catch {
    return [];
  }
}

/**
 * Constraint ladder: rear camera at a document-friendly resolution → rear camera any resolution →
 * any camera → any camera at low resolution. Only "mode not supported / busy" failures step down;
 * a permission denial stops immediately (asking again would not help).
 */
export function constraintLadder(deviceId?: string): MediaTrackConstraints[] {
  if (deviceId) return [{ deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1440 } }, { deviceId: { exact: deviceId } }, {}];
  return [
    { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } },
    { facingMode: { ideal: 'environment' } },
    {},
    { width: { ideal: 640 }, height: { ideal: 480 } },
  ];
}

async function getStream(deviceId?: string): Promise<MediaStream> {
  let last: CameraError | null = null;
  for (const video of constraintLadder(deviceId)) {
    try {
      return await navigator.mediaDevices.getUserMedia({ video: Object.keys(video).length ? video : true, audio: false });
    } catch (e) {
      last = cameraError(e);
      if (last.code !== 'overconstrained' && last.code !== 'busy' && last.code !== 'unknown') throw last;
    }
  }
  throw last ?? new CameraError('unknown', 'The camera could not be opened');
}

export async function deviceCamera(deviceId?: string): Promise<CameraSource> {
  const pre = cameraPreflight();
  if (pre) throw pre;
  const stream = await getStream(deviceId);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('muted', '');
  video.srcObject = stream;
  const release = () => { stream.getTracks().forEach((t) => t.stop()); video.srcObject = null; };
  try {
    await new Promise<void>((res, rej) => {
      if (video.readyState >= 1) return res();
      const t = setTimeout(() => rej(new CameraError('timeout', 'The camera opened but sent no picture', ['Press Retry, pick another camera, or upload a photo.'])), 8000);
      video.onloadedmetadata = () => { clearTimeout(t); res(); };
    });
    await video.play().catch(() => {}); // muted inline video autoplays; a rejected play() is not fatal
  } catch (e) {
    release();
    throw e;
  }
  const track = stream.getVideoTracks()[0];
  const ready = async () => {
    for (let i = 0; i < 50 && !video.videoWidth; i++) await new Promise((r) => setTimeout(r, 100));
    if (!video.videoWidth) throw new CameraError('timeout', 'The camera sent no picture yet - try again');
  };
  return {
    kind: 'device-camera',
    label: track?.label || 'Device camera',
    deviceId: track?.getSettings().deviceId,
    frame: () => (video.videoWidth ? { src: video, w: video.videoWidth, h: video.videoHeight } : null),
    capture: async () => {
      await ready();
      const c = document.createElement('canvas');
      c.width = video.videoWidth;
      c.height = video.videoHeight;
      c.getContext('2d')!.drawImage(video, 0, 0);
      return new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Capture failed'))), 'image/jpeg', 0.92));
    },
    stop: release,
  };
}

// ---- simulated glasses camera (mock device) -------------------------------------------------
/**
 * Films the sample A4 sheet on a dark desk as a wearer would: first too close (corners cut off),
 * then too far, then tilted, then settling square and still - exercising every guidance state.
 */
export async function simulatedCamera(): Promise<CameraSource> {
  const sheet = await createImageBitmap(await renderSampleAuditSheet(Math.floor(Math.random() * 20)));
  const t0 = performance.now();
  const W = 960;
  const H = 720;
  const preview = document.createElement('canvas');
  preview.width = W;
  preview.height = H;
  const pose = (t: number) => {
    // Keyframes: [time s, scale (sheet height / frame height), rotation deg, shear, dx, dy]
    const K: [number, number, number, number, number, number][] = [
      [0, 1.35, 4, 0.0, 0.05, 0.1], [1.4, 1.3, 3, 0.0, 0.0, 0.05], [2.2, 0.45, -6, 0.05, -0.15, 0.0],
      [3.2, 0.8, -20, 0.22, -0.03, 0.02], [4.4, 0.8, -19, 0.2, -0.03, 0.02], [5.4, 0.86, -1, 0.01, 0.0, 0.0], [6.2, 0.9, 0, 0, 0, 0],
    ];
    let i = 0;
    while (i < K.length - 2 && t > K[i + 1]![0]) i++;
    const [ta, ...a] = K[i]!;
    const [tb, ...b] = K[i + 1]!;
    const u = Math.min(1, Math.max(0, (t - ta) / (tb - ta)));
    const e = u * u * (3 - 2 * u);
    const v = a.map((x, j) => x + (b[j]! - x) * e);
    const settle = Math.max(0, 1 - Math.max(0, t - 6.2) / 0.6);
    const jitter = 0.004 * settle + 0.0008; // natural head movement, calming down
    return { scale: v[0]!, rot: v[1]! + Math.sin(t * 7) * 0.4 * settle, shear: v[2]!, dx: v[3]! + Math.sin(t * 5.3) * jitter, dy: v[4]! + Math.cos(t * 4.1) * jitter };
  };
  const draw = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const p = pose((performance.now() - t0) / 1000);
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#2b211b');
    g.addColorStop(1, '#3b2c22');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    const sh = h * p.scale;
    const sw = sh / Math.SQRT2;
    ctx.translate(w / 2 + p.dx * w, h / 2 + p.dy * h);
    ctx.rotate((p.rot * Math.PI) / 180);
    ctx.transform(1, 0, p.shear, 1, 0, 0);
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = h * 0.03;
    ctx.drawImage(sheet, -sw / 2, -sh / 2, sw, sh);
    ctx.restore();
    // Uneven light from the side, like a real room.
    const l = ctx.createRadialGradient(w * 0.2, h * 0.1, 0, w * 0.2, h * 0.1, w);
    l.addColorStop(0, 'rgba(255,240,220,0.10)');
    l.addColorStop(1, 'rgba(0,0,0,0.12)');
    ctx.fillStyle = l;
    ctx.fillRect(0, 0, w, h);
  };
  return {
    kind: 'simulated',
    label: 'Simulated glasses camera',
    frame: () => {
      draw(preview.getContext('2d')!, W, H);
      return { src: preview, w: W, h: H };
    },
    capture: async () => {
      const c = document.createElement('canvas');
      c.width = 2016;
      c.height = 1512; // 12 MP-class still at 4:3, like the glasses camera
      draw(c.getContext('2d')!, c.width, c.height);
      return new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Capture failed'))), 'image/jpeg', 0.9));
    },
    stop: () => sheet.close(),
  };
}

export const hasGlassesBridge = () => typeof window !== 'undefined' && (!!window.HydrisNative || !!window.HydrisWearables || !!announced);

// The camera currently framing a shot (read by the live view to mirror frames to the control room).
let activeCamera: CameraSource | null = null;
export const activeCameraSource = () => activeCamera;
function track(src: CameraSource): CameraSource {
  activeCamera = src;
  return { ...src, frame: () => src.frame(), capture: () => src.capture(), stop: () => { if (activeCamera === src) activeCamera = null; src.stop(); } };
}

/**
 * Ray-Ban Meta camera when bridged; otherwise the device camera. A device-camera failure is thrown
 * as a CameraError (permission denied, no camera, in use, insecure page) so the UI can explain it
 * and offer Retry / upload, instead of silently switching to the simulation.
 */
export async function openCamera(prefer?: CameraKind, deviceId?: string): Promise<CameraSource> {
  return track(await openCameraRaw(prefer, deviceId));
}
async function openCameraRaw(prefer?: CameraKind, deviceId?: string): Promise<CameraSource> {
  if (prefer === 'simulated') return simulatedCamera();
  const bridged = prefer === 'device-camera' || deviceId ? null : nativeBridge() ?? injectedBridge() ?? messageBridge();
  if (bridged) return bridged;
  try {
    return await deviceCamera(deviceId);
  } catch (e) {
    throw cameraError(e);
  }
}
