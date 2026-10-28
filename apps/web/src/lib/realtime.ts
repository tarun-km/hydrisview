'use client';

import { useEffect, useRef, useState } from 'react';

export type StreamStatus = 'connecting' | 'live' | 'reconnecting' | 'offline' | 'ended';
export interface StreamEvent { id?: string; type: string; data: Record<string, unknown> }

/**
 * Authenticated Server-Sent Events over fetch (keeps the bearer token out of URLs).
 * Reconnects with capped exponential backoff and resumes from the last event id.
 */
export function openStream(opts: {
  getToken: () => string | null;
  refresh: () => Promise<boolean>;
  onEvent: (e: StreamEvent) => void;
  onStatus: (s: StreamStatus) => void;
  isOnline?: () => boolean;
}): () => void {
  let stopped = false;
  let lastId = '';
  let attempt = 0;
  let controller: AbortController | null = null;

  const loop = async () => {
    while (!stopped) {
      if (opts.isOnline && !opts.isOnline()) {
        opts.onStatus('offline');
        await sleep(1500);
        continue;
      }
      opts.onStatus(attempt ? 'reconnecting' : 'connecting');
      controller = new AbortController();
      try {
        const token = opts.getToken();
        const res = await fetch('/api/events/stream', {
          headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(lastId ? { 'last-event-id': lastId } : {}), accept: 'text/event-stream' },
          signal: controller.signal,
          cache: 'no-store',
        });
        if (res.status === 401) {
          if (await opts.refresh()) continue;
          opts.onStatus('ended');
          return;
        }
        if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
        attempt = 0;
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += value;
          let idx;
          while ((idx = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const ev: StreamEvent = { type: 'message', data: {} };
            for (const line of chunk.split('\n')) {
              if (line.startsWith('id: ')) ev.id = line.slice(4);
              else if (line.startsWith('event: ')) ev.type = line.slice(7);
              else if (line.startsWith('data: ')) {
                try {
                  ev.data = JSON.parse(line.slice(6));
                } catch {
                  /* ignore malformed */
                }
              }
            }
            if (chunk.startsWith(':')) continue;
            if (ev.id) lastId = ev.id;
            if (ev.type === 'ready') opts.onStatus('live');
            // Suspended / removed (users) or revoked (glasses): deliver, then stop for good.
            if (ev.type === 'account.ended' || ev.type === 'session.revoked') {
              opts.onEvent(ev);
              opts.onStatus('ended');
              return;
            }
            if (ev.type === 'session.ended') {
              if (await opts.refresh()) break;
              opts.onStatus('ended');
              return;
            }
            opts.onEvent(ev);
          }
        }
      } catch {
        if (stopped) return;
      }
      attempt++;
      opts.onStatus('reconnecting');
      await sleep(Math.min(15000, 500 * 2 ** Math.min(attempt, 5)));
    }
  };
  void loop();
  return () => {
    stopped = true;
    controller?.abort();
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}

export function useLatest<T>(v: T) {
  const r = useRef(v);
  r.current = v;
  return r;
}
