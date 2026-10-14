'use client';

import { useEffect, useRef } from 'react';

export type InputKey = 'up' | 'down' | 'left' | 'right' | 'select' | 'back';

/**
 * Input adapter. The browser model maps keyboard, touch swipes and simulator
 * postMessage controls onto a small directional vocabulary. Hardware gestures
 * (e.g. neural-band pinch/swipe, frame touchpad, voice) plug in here once their
 * delivery to the web runtime is verified on a device.
 */
export function useHudInput(onInput: (k: InputKey) => void) {
  const ref = useRef(onInput);
  ref.current = onInput;
  useEffect(() => {
    const keymap: Record<string, InputKey> = {
      ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'select', ' ': 'select', Escape: 'back', Backspace: 'back',
    };
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') && e.key !== 'Escape' && e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      const k = keymap[e.key];
      if (!k) return;
      e.preventDefault();
      ref.current(k);
    };
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const d = e.data as { type?: string; key?: InputKey };
      if (d?.type === 'hydris:input' && d.key) ref.current(d.key);
    };
    let sx = 0, sy = 0;
    const onStart = (e: TouchEvent) => { sx = e.touches[0]!.clientX; sy = e.touches[0]!.clientY; };
    const onEnd = (e: TouchEvent) => {
      const dx = e.changedTouches[0]!.clientX - sx, dy = e.changedTouches[0]!.clientY - sy;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 40) return;
      if (Math.abs(dy) > Math.abs(dx)) ref.current(dy > 0 ? 'down' : 'up');
      else ref.current(dx > 0 ? 'right' : 'back');
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('message', onMsg);
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchend', onEnd);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('message', onMsg);
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchend', onEnd);
    };
  }, []);
}

/** Report viewport events to an embedding simulator (event console). */
export function emitToHost(event: string, detail?: unknown) {
  if (typeof window === 'undefined' || window.parent === window) return;
  window.parent.postMessage({ type: 'hydris:event', event, detail, at: new Date().toISOString() }, window.location.origin);
}
