'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Circle, ExternalLink, Pause, Play, RotateCcw, Trash2, Wifi, WifiOff } from 'lucide-react';
import { SCENARIOS, type ScenarioKey } from '@hydris/domain';
import { getAccessToken, post, refreshSession } from '@/lib/api';
import { openStream } from '@/lib/realtime';
import { useSessionCtx } from '@/lib/session';
import { useApi } from '@/lib/query';
import { Button, Capsule, Chip, IconButton } from '@/ui';
import { useToast } from '@/ui/overlay';
import { ThemedLogo } from '@/console/ThemedLogo';
import { ThemeToggle } from '@/ui/theme';

interface LogLine { at: string; event: string; detail?: unknown }
interface SimInfo { available: boolean; canControl: boolean; scenarios: { key: ScenarioKey; title: string; summary: string; expected: string[]; steps: number }[]; stepSeconds: number; running: { id: string; scenarioKey: string; step: number; live: boolean }[] }

const SIZES = { '600x600': [600, 600], '640x480': [640, 480], '480x480': [480, 480] } as const;
type SizeKey = keyof typeof SIZES;

/**
 * Browser simulator: hosts the real glasses viewport in a device frame, injects input
 * and network conditions, and shows a device event console. Scenario controls are only
 * offered to signed-in users with simulation.control in a demo organization.
 */
export default function SimulatorPage() {
  const frame = useRef<HTMLIFrameElement>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [online, setOnline] = useState(true);
  const [size, setSize] = useState<SizeKey>('600x600');
  const [chrome, setChrome] = useState<'frame' | 'viewport'>('frame');
  const [scale, setScale] = useState(1);
  const { state } = useSessionCtx();
  const authed = state.status === 'authed';
  const sim = useApi<SimInfo>(authed ? '/simulation' : null, { refetchInterval: 5000 });
  const sites = useApi<{ sites: { id: string; name: string }[] }>(authed ? '/sites' : null);
  const toast = useToast();
  const [w, h] = SIZES[size];

  const send = useCallback((msg: unknown) => frame.current?.contentWindow?.postMessage(msg, window.location.origin), []);
  const input = (key: string) => { send({ type: 'hydris:input', key }); frame.current?.focus(); };
  const setNetwork = useCallback((v: boolean) => { setOnline(v); send({ type: 'hydris:network', online: v }); }, [send]);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const d = e.data as { type?: string; event?: string; detail?: unknown; at?: string };
      if (d?.type === 'hydris:event' && d.event) setLog((l) => [{ at: d.at ?? new Date().toISOString(), event: d.event!, detail: d.detail }, ...l].slice(0, 200));
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  useEffect(() => {
    const fit = () => setScale(Math.min(1, (window.innerWidth < 1100 ? window.innerWidth - 48 : window.innerWidth - 520) / (w + (chrome === 'frame' ? 120 : 0))));
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [w, chrome]);

  // Scenario network events (glasses_network) are applied to the simulated device.
  useEffect(() => {
    if (!authed || !sim.data?.available) return;
    return openStream({
      getToken: getAccessToken, refresh: async () => !!(await refreshSession()), onStatus: () => {},
      onEvent: (e) => {
        if (e.type !== 'simulation.step') return;
        const events = (e.data.events as { type: string; online?: boolean }[] | undefined) ?? [];
        for (const ev of events) if (ev.type === 'glasses_network' && typeof ev.online === 'boolean') { setNetwork(ev.online); toast({ title: ev.online ? 'Scenario: network restored' : 'Scenario: glasses lost network', tone: 'info' }); }
      },
    });
  }, [authed, sim.data?.available, setNetwork, toast]);

  const start = async (scenario: ScenarioKey) => {
    const siteId = sites.data?.sites[0]?.id;
    if (!siteId) return;
    try { await post('/simulation/start', { scenario, siteId }); toast({ title: `Scenario started: ${SCENARIOS[scenario].title}`, tone: 'ok' }); void sim.refetch(); }
    catch (e) { toast({ title: 'Could not start scenario', body: (e as Error).message, tone: 'critical' }); }
  };
  const stop = async () => { try { await post('/simulation/stop'); void sim.refetch(); } catch (e) { toast({ title: 'Stop failed', body: (e as Error).message, tone: 'critical' }); } };
  const running = sim.data?.running[0];

  return (
    <div className="min-h-dvh bg-bg">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
        <Link href="/console" aria-label="Back to console"><ThemedLogo /></Link>
        <Chip tone="outline">Glasses simulator</Chip>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Capsule label="Display size" value={size} onChange={setSize} options={(Object.keys(SIZES) as SizeKey[]).map((k) => ({ value: k, label: k.replace('x', '×') }))} />
          <Capsule label="Presentation" value={chrome} onChange={setChrome} options={[{ value: 'frame', label: 'Device frame' }, { value: 'viewport', label: 'Viewport only' }]} />
          <Link href="/glasses?sim=1" target="_blank" className="btn btn-ghost btn-sm"><ExternalLink size={14} /> Open viewport alone</Link>
          <ThemeToggle compact size="sm" />
        </div>
      </header>

      <div className="grid gap-6 p-5 lg:grid-cols-[1fr_440px]">
        <section aria-label="Simulated device" className="grid place-items-center overflow-hidden rounded-[var(--radius-2xl)] border border-line bg-[radial-gradient(circle_at_50%_40%,#1a1d14_0%,#081116_60%)] py-10">
          <div style={{ transform: `scale(${scale})`, transformOrigin: 'top center', height: (h + (chrome === 'frame' ? 160 : 0)) * scale }}>
            <div className={chrome === 'frame' ? 'relative rounded-[120px] border-[14px] border-[#1d1f1c] bg-[#121311] px-[60px] py-[70px] shadow-[0_40px_120px_rgb(0_0_0/0.6)]' : ''}>
              {chrome === 'frame' && <>
                <span aria-hidden className="absolute -left-[150px] top-1/2 h-[18px] w-[150px] -translate-y-1/2 rounded-l-full bg-[#1d1f1c]" />
                <span aria-hidden className="absolute -right-[150px] top-1/2 h-[18px] w-[150px] -translate-y-1/2 rounded-r-full bg-[#1d1f1c]" />
                <span aria-hidden className="absolute left-1/2 top-[22px] h-[10px] w-[10px] -translate-x-1/2 rounded-full bg-[#2b2e28]" />
              </>}
              <iframe ref={frame} title="Hydris glasses viewport (simulated)" src="/glasses?sim=1" width={w} height={h}
                className="block rounded-[28px] bg-black ring-1 ring-white/10" allow="clipboard-write; camera" />
            </div>
          </div>
        </section>

        <aside className="grid content-start gap-4">
          <div className="card">
            <h2 className="t-card mb-1">Controls</h2>
            <p className="t-label mb-4">Maps to swipe / pinch / back on hardware. Arrow keys, Enter and Esc also work when the viewport is focused.</p>
            <div className="grid grid-cols-3 place-items-center gap-2" role="group" aria-label="Directional controls">
              <span />
              <IconButton label="Up" size="lg" onClick={() => input('up')}><ArrowUp size={20} /></IconButton>
              <span />
              <IconButton label="Left (previous digit)" size="lg" onClick={() => input('left')}><ArrowLeft size={20} /></IconButton>
              <IconButton label="Select" size="lg" tone="lime" onClick={() => input('select')}><Circle size={20} fill="currentColor" /></IconButton>
              <IconButton label="Right (next digit)" size="lg" onClick={() => input('right')}><ArrowRight size={20} /></IconButton>
              <span />
              <IconButton label="Down" size="lg" onClick={() => input('down')}><ArrowDown size={20} /></IconButton>
              <span />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" onClick={() => input('back')} icon={<RotateCcw size={14} />}>Back</Button>
              <Button size="sm" variant={online ? 'secondary' : 'danger'} onClick={() => setNetwork(!online)} icon={online ? <Wifi size={14} /> : <WifiOff size={14} />} aria-pressed={!online}>
                {online ? 'Simulate network loss' : 'Restore network'}
              </Button>
            </div>
          </div>

          <div className="card">
            <div className="mb-3 flex items-center justify-between"><h2 className="t-card">Scenarios</h2>{running && <Chip tone="lime">Running · step {running.step}</Chip>}</div>
            {!authed && <p className="text-sm text-text-2"><Link href="/login?next=/simulator" className="text-lime underline-offset-4 hover:underline">Sign in</Link> with a demo organization account to drive scenarios. Pairing works without it.</p>}
            {authed && sim.data && !sim.data.available && <p className="text-sm text-text-2">Scenarios are only available in demo organizations. Synthetic events never enter customer tenants.</p>}
            {authed && sim.data?.available && !sim.data.canControl && <p className="text-sm text-text-2">Your role can watch scenarios but not start them.</p>}
            {authed && sim.data?.available && (
              <ul className="grid max-h-[340px] gap-2 overflow-y-auto pr-1">
                {sim.data.scenarios.map((s) => (
                  <li key={s.key} className="card-inset flex items-start gap-3 p-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{s.title}</div>
                      <div className="text-xs text-muted">{s.summary}</div>
                    </div>
                    {sim.data!.canControl && (running?.scenarioKey === s.key
                      ? <IconButton label={`Stop ${s.title}`} size="sm" onClick={stop}><Pause size={14} /></IconButton>
                      : <IconButton label={`Start ${s.title}`} size="sm" tone="lime" onClick={() => void start(s.key)}><Play size={14} /></IconButton>)}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card">
            <div className="mb-3 flex items-center justify-between"><h2 className="t-card">Device event console</h2><IconButton label="Clear log" size="sm" onClick={() => setLog([])}><Trash2 size={14} /></IconButton></div>
            <ol className="max-h-[300px] overflow-y-auto font-mono text-[12px] leading-relaxed" aria-live="polite">
              {!log.length && <li className="text-muted">Waiting for viewport events…</li>}
              {log.map((l, i) => (
                <li key={i} className="border-b border-line py-1"><span className="text-muted">{new Date(l.at).toLocaleTimeString()}</span> <span className="text-lime">{l.event}</span>{l.detail !== undefined && <span className="text-text-2"> {JSON.stringify(l.detail).slice(0, 140)}</span>}</li>
              ))}
            </ol>
          </div>
        </aside>
      </div>
    </div>
  );
}
