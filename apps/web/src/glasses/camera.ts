'use client';
/**
 * Camera sources for audit scans.
 *
 * Meta Ray-Ban glasses do not expose their camera to web pages directly. Third-party access goes
 * through Meta's Wearables Device Access Toolkit in a companion phone app, which hosts this web
 * app in a web view and bridges photos into it. Two bridge shapes are supported:
 *
 *  1. Injected API (preferred): the host defines
 *       window.HydrisWearables = { capturePhoto(): Promise<{ dataUrl: string }>, deviceName?: string }
 *  2. postMessage: the page posts {type:'hydris:camera-capture', requestId} to the host
 *     (window.parent / ReactNativeWebView), and the host replies with
 *       {type:'hydris:camera-photo', requestId, dataUrl} (or {type:'hydris:camera-error', requestId, message}).
 *     The host announces availability with {type:'hydris:camera-ready', deviceName}.
 *
 * Without a bridge (browser simulator, phone, laptop) the device camera is used via getUserMedia.
 */

export interface CameraSource {
  kind: 'meta-glasses' | 'device-camera';
  label: string;
  /** Live preview stream (device camera only; the glasses show the world directly). */
  stream?: MediaStream;
  capture(): Promise<Blob>;
  stop(): void;
}

declare global {
  interface Window {
    HydrisWearables?: { capturePhoto(): Promise<{ dataUrl: string }>; deviceName?: string };
    ReactNativeWebView?: { postMessage(msg: string): void };
  }
}

let bridgeAnnounced: string | null = null;
if (typeof window !== 'undefined') {
  window.addEventListener('message', (e) => {
    const d = e.data as { type?: string; deviceName?: string } | null;
    if (d?.type === 'hydris:camera-ready') bridgeAnnounced = d.deviceName ?? 'Meta Ray-Ban';
  });
}

const dataUrlToBlob = async (u: string) => (await fetch(u)).blob();

function postToHost(msg: unknown) {
  const s = JSON.stringify(msg);
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(s);
  else if (window.parent !== window) window.parent.postMessage(msg, '*');
}

function bridgeSource(): CameraSource | null {
  const api = window.HydrisWearables;
  if (api) {
    return { kind: 'meta-glasses', label: api.deviceName ?? 'Meta Ray-Ban camera', capture: async () => dataUrlToBlob((await api.capturePhoto()).dataUrl), stop: () => {} };
  }
  if (!bridgeAnnounced) return null;
  return {
    kind: 'meta-glasses',
    label: `${bridgeAnnounced} camera`,
    capture: () => new Promise<Blob>((resolve, reject) => {
      const requestId = Math.random().toString(36).slice(2);
      const timer = setTimeout(() => { window.removeEventListener('message', onMsg); reject(new Error('The glasses did not return a photo')); }, 20_000);
      function onMsg(e: MessageEvent) {
        const d = (typeof e.data === 'string' ? safeJson(e.data) : e.data) as { type?: string; requestId?: string; dataUrl?: string; message?: string } | null;
        if (!d || d.requestId !== requestId) return;
        if (d.type === 'hydris:camera-photo' && d.dataUrl) { clearTimeout(timer); window.removeEventListener('message', onMsg); void dataUrlToBlob(d.dataUrl).then(resolve, reject); }
        if (d.type === 'hydris:camera-error') { clearTimeout(timer); window.removeEventListener('message', onMsg); reject(new Error(d.message ?? 'Camera error')); }
      }
      window.addEventListener('message', onMsg);
      postToHost({ type: 'hydris:camera-capture', requestId });
    }),
    stop: () => {},
  };
}

const safeJson = (s: string) => { try { return JSON.parse(s) as unknown; } catch { return null; } };

async function deviceCamera(): Promise<CameraSource> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('No camera available in this browser');
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1920 } }, audio: false });
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await video.play();
  return {
    kind: 'device-camera',
    label: stream.getVideoTracks()[0]?.label || 'Device camera',
    stream,
    capture: async () => {
      const c = document.createElement('canvas');
      c.width = video.videoWidth;
      c.height = video.videoHeight;
      c.getContext('2d')!.drawImage(video, 0, 0);
      return new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Capture failed'))), 'image/jpeg', 0.92));
    },
    stop: () => stream.getTracks().forEach((t) => t.stop()),
  };
}

/** Meta glasses camera when bridged, otherwise the device camera. */
export async function openCamera(): Promise<CameraSource> {
  return bridgeSource() ?? deviceCamera();
}

export const hasGlassesBridge = () => typeof window !== 'undefined' && (!!window.HydrisWearables || !!bridgeAnnounced);
