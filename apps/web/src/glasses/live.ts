'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { activeCameraSource } from './camera';
import type { DeviceLink } from './link';

/**
 * Live view: mirrors what the wearer sees to the control room. Every 2-3 s (and right after a
 * screen change) the glasses post a small snapshot: structured screen/title/summary, a ~480 px
 * JPEG of the HUD and, while a camera is framing, the latest camera frame (≤ 1 fps).
 * Only the latest snapshot is kept server-side. Failures back off silently and never touch the UI.
 */
export interface LiveState { screen: string; title: string; summary: string[] }

const INTERVAL_MS = 2500;
const CAMERA_INTERVAL_MS = 1100;
const MAX_BYTES = 115 * 1024;
const WIDTH = 480;

const bytesOf = (dataUrl: string) => Math.floor(((dataUrl.length - dataUrl.indexOf(',') - 1) * 3) / 4);

type Shot = (node: Node, opts: Record<string, unknown>) => Promise<string>;
let shot: Promise<Shot | null> | null = null;
/** Lazily load the DOM-to-image renderer (kept out of the main glasses bundle). */
const renderer = () => (shot ??= import('modern-screenshot').then((m) => m.domToJpeg as unknown as Shot).catch(() => null));

async function renderView(root: HTMLElement): Promise<string | undefined> {
  const toJpeg = await renderer();
  if (!toJpeg) return undefined;
  const w = root.offsetWidth || 600;
  for (const quality of [0.6, 0.4]) {
    const url = await toJpeg(root, { scale: WIDTH / w, quality, backgroundColor: '#000', font: false, style: { transform: 'none' }, timeout: 3000 });
    if (url.startsWith('data:image/jpeg') && bytesOf(url) <= MAX_BYTES) return url;
  }
  return undefined;
}

function cameraFrame(): string | undefined {
  const f = activeCameraSource()?.frame();
  if (!f || !f.w || !f.h) return undefined;
  const c = document.createElement('canvas');
  c.width = Math.min(WIDTH, f.w);
  c.height = Math.round((c.width / f.w) * f.h);
  c.getContext('2d')!.drawImage(f.src, 0, 0, c.width, c.height);
  for (const q of [0.6, 0.4]) {
    const url = c.toDataURL('image/jpeg', q);
    if (bytesOf(url) <= MAX_BYTES) return url;
  }
  return undefined;
}

/** Fallback summary: the visible text lines of the HUD content area. */
function domLines(root: HTMLElement | null): string[] {
  const el = root?.querySelector<HTMLElement>('[data-live-content]') ?? root;
  const out: string[] = [];
  for (const raw of (el?.innerText ?? '').split(/\r?\n/)) {
    const l = raw.trim().slice(0, 160);
    if (l.length > 1 && !out.includes(l)) out.push(l);
    if (out.length >= 12) break;
  }
  return out;
}

/** Share snapshots while `enabled` and the page is visible. Returns whether sharing is active. */
export function useLiveShare(link: DeviceLink, enabled: boolean, root: RefObject<HTMLElement | null>, state: LiveState): boolean {
  const stateRef = useRef(state);
  stateRef.current = state;
  const [visible, setVisible] = useState(true);
  const kick = useRef<() => void>(() => {});

  useEffect(() => {
    const f = () => setVisible(document.visibilityState === 'visible');
    f();
    document.addEventListener('visibilitychange', f);
    return () => document.removeEventListener('visibilitychange', f);
  }, []);

  const active = enabled && visible;
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;
    let busy = false;
    let lastView = 0;
    let lastScreen = '';
    const schedule = (ms: number) => {
      if (timer) clearTimeout(timer);
      if (!stopped) timer = setTimeout(tick, ms);
    };
    async function tick() {
      if (stopped || busy) return;
      busy = true;
      const s = stateRef.current;
      const camOn = !!activeCameraSource();
      try {
        // The HUD mirror is the expensive part: refresh it on screen changes and every few seconds.
        const needView = s.screen !== lastScreen || Date.now() - lastView >= INTERVAL_MS - 200;
        const view = needView && root.current ? await renderView(root.current).catch(() => undefined) : undefined;
        if (view) lastView = Date.now();
        const camera = camOn ? cameraFrame() : undefined;
        await link.call('/device/live', { method: 'POST', json: { screen: s.screen, title: s.title, summary: (s.summary.length ? s.summary : domLines(root.current)).slice(0, 12), view, camera, cameraActive: camOn } });
        lastScreen = s.screen;
        failures = 0;
      } catch {
        failures++;
      } finally {
        busy = false;
      }
      schedule(failures ? Math.min(60_000, INTERVAL_MS * 2 ** failures) : camOn ? CAMERA_INTERVAL_MS : INTERVAL_MS);
    }
    kick.current = () => { if (!failures) schedule(350); };
    schedule(600);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      kick.current = () => {};
    };
  }, [active, link, root]);

  // Screen changes are sent right away (after the new screen has painted).
  useEffect(() => { kick.current(); }, [state.screen, state.title]);
  return active;
}
