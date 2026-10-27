'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Camera, Eye, EyeOff } from 'lucide-react';
import { useApi, invalidatePaths } from '@/lib/query';
import { ago } from '@/lib/format';
import { Avatar, Card, Chip, EmptyState, cx } from '@/ui';

/** Latest live snapshot of a pair of glasses (GET /devices/:id/live). */
export interface LiveView {
  deviceId: string;
  deviceName: string;
  operator: { id: string; name: string } | null;
  screen: string | null;
  title: string | null;
  summary: string[];
  view: string | null;
  camera?: string | null;
  cameraActive: boolean;
  updatedAt: string | null;
  live: boolean;
}

/** Fleet-wide live state (no camera frames), keyed by device id. Refreshed by `device.live` events. */
export function useFleetLive(enabled: boolean) {
  const q = useApi<{ live: LiveView[] }>(enabled ? '/devices/live' : null, { refetchInterval: 5_000 });
  const map = new Map((q.data?.live ?? []).map((l) => [l.deviceId, l]));
  return map;
}

/** Re-render every second so "last seen Xs ago" stays honest. */
function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

export function LiveBadge({ live, className }: { live: boolean; className?: string }) {
  return live
    ? <span className={cx('chip chip-critical gap-1.5', className)}><span className="h-2 w-2 animate-pulse rounded-full bg-critical" aria-hidden />Live</span>
    : <span className={cx('chip', className)}>Not streaming</span>;
}

/** Control-room mirror: who wears the glasses, the screen they see and (when active) their camera. */
export function LiveViewPanel({ deviceId }: { deviceId: string }) {
  const path = `/devices/${deviceId}/live`;
  // Poll as the fallback; `device.live` SSE events trigger an immediate refetch (see Shell).
  const q = useApi<LiveView>(path, { refetchInterval: 2_000, refetchIntervalInBackground: false });
  const qc = useQueryClient();
  useEffect(() => {
    const on = (e: Event) => { if ((e as CustomEvent<{ deviceId?: string }>).detail?.deviceId === deviceId) invalidatePaths(qc, [path]); };
    window.addEventListener('hydris:device-live', on);
    return () => window.removeEventListener('hydris:device-live', on);
  }, [qc, path, deviceId]);
  const now = useNow();
  const v = q.data;
  const streaming = !!v?.updatedAt && now - Date.parse(v.updatedAt) < 10_000;
  const state = streaming ? 'Live' : v?.updatedAt ? `Last seen ${ago(v.updatedAt, now)}` : 'Not streaming';

  return (
    <Card
      title={<h2 className="t-card flex items-center gap-2"><Eye size={18} aria-hidden />Live view</h2>}
      action={<span className="flex items-center gap-2 text-sm text-text-2" aria-live="polite">{streaming ? <LiveBadge live /> : <span className="chip num">{state}</span>}</span>}
    >
      {!v || !v.updatedAt ? (
        <EmptyState compact icon={<EyeOff size={20} aria-hidden />} title="Not streaming"
          body="When these glasses are paired and in use, the screen the wearer sees (and their camera while scanning) is mirrored here every few seconds." />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <div className="grid gap-4">
            <figure className="m-0">
              <div className={cx('relative overflow-hidden rounded-[var(--radius-xl)] border border-line bg-black', !streaming && 'opacity-60 grayscale')} style={{ aspectRatio: '1 / 1' }}>
                {v.view
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={v.view} alt={`Glasses screen: ${v.title ?? v.screen ?? ''}`} className="h-full w-full object-contain" />
                  : <div className="grid h-full place-items-center text-sm text-white/60">Screen image not available</div>}
              </div>
              <figcaption className="mt-2 text-xs text-muted">Mirrored glasses screen{v.updatedAt ? <> · updated <time className="num" dateTime={v.updatedAt}>{ago(v.updatedAt, now)}</time></> : null}</figcaption>
            </figure>
            {v.cameraActive && (
              <figure className="m-0">
                <div className="relative overflow-hidden rounded-[var(--radius-xl)] border border-line bg-black">
                  {v.camera
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={v.camera} alt="Glasses camera feed" className="w-full object-contain" />
                    : <div className="grid aspect-video place-items-center text-sm text-white/60">Waiting for camera frame…</div>}
                  <span className="absolute left-3 top-3"><Chip tone="critical"><Camera size={13} aria-hidden />Camera</Chip></span>
                </div>
                <figcaption className="mt-2 text-xs text-muted">Camera feed (about one frame per second)</figcaption>
              </figure>
            )}
          </div>
          <div className="grid content-start gap-4">
            <div className="flex items-center gap-3">
              <Avatar name={v.operator?.name ?? '?'} size={48} tone="cobalt" />
              <div className="min-w-0">
                <div className="t-label">Worn by</div>
                <div className="truncate text-lg font-medium">{v.operator?.name ?? 'Unknown operator'}</div>
              </div>
            </div>
            <div>
              <div className="t-label">Looking at</div>
              <div className="mt-1 text-[22px] leading-tight tracking-[-0.02em]">{v.title ?? v.screen ?? 'Unknown screen'}</div>
              {v.screen && <Chip tone="outline" className="mt-2">{v.screen}</Chip>}
            </div>
            {v.summary.length > 0 && (
              <div>
                <div className="t-label mb-2">On screen</div>
                <ul className="grid gap-1.5">
                  {v.summary.map((l, i) => <li key={`${i}-${l}`} className="card-inset px-3 py-2 text-sm">{l}</li>)}
                </ul>
              </div>
            )}
            <p className="text-xs text-muted">The wearer sees a &ldquo;Live to control room&rdquo; indicator while sharing. Only the latest snapshot is kept, for about a minute.</p>
          </div>
        </div>
      )}
    </Card>
  );
}
