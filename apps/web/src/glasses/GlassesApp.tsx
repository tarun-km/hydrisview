'use client';

import QRCode from 'qrcode';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle, BookOpen, Check, ChevronRight, CircleDot, ClipboardCheck, Cog, Glasses, Info, RefreshCw, ShieldAlert, Signal, SignalZero, Wifi, WifiOff, Wrench, X,
} from 'lucide-react';
import { FRESHNESS_LABELS, inspectionProgress, isScenarioKey, type InspectionStep, type StepValue } from '@hydris/domain';
import { openStream } from '@/lib/realtime';
import { DeviceError, DeviceLink, type PairingChallenge } from './link';
import { DemoData, LiveData, type GAlarm, type GAsset, type GAssist, type GContext, type GInspection, type GlassesData } from './data';
import { emitToHost, useHudInput, type InputKey } from './input';
import { HudContext, HudItem, HudMetric, HudPill, HudTitle, SEV_HUD, useFitScale, useHud, type HudControl } from './hud';

type Screen =
  | { name: 'home' } | { name: 'alerts' } | { name: 'alert'; id: string } | { name: 'inspections' } | { name: 'inspection'; id: string }
  | { name: 'tasks' } | { name: 'task'; id: string } | { name: 'asset'; id: string } | { name: 'assist'; q: string; assetId?: string } | { name: 'status' };
type Phase = 'boot' | 'setup' | 'ready' | 'app' | 'revoked' | 'suspended' | 'unassigned';

const APP_VERSION = '0.2.0';

export function GlassesApp({ demoScenario, simulator }: { demoScenario?: string | null; simulator?: boolean }) {
  const demo = demoScenario !== undefined && demoScenario !== null;
  const link = useMemo(() => new DeviceLink(), []);
  const data: GlassesData = useMemo(() => (demo ? new DemoData(isScenarioKey(demoScenario) ? demoScenario : 'normal_operations') : new LiveData(link)), [demo, demoScenario, link]);
  const [phase, setPhase] = useState<Phase>(demo ? 'app' : 'boot');
  const [ctx, setCtx] = useState<GContext | null>(null);
  const [stack, setStack] = useState<Screen[]>([{ name: 'home' }]);
  const [cursor, setCursor] = useState(0);
  const control = useRef<HudControl>({ actions: [] });
  const [online, setOnline] = useState(true);
  const [queued, setQueued] = useState(0);
  const [banner, setBanner] = useState<{ text: string; tone: 'lime' | 'critical' | 'high' } | null>(null);
  const [interrupt, setInterrupt] = useState<GAlarm | null>(null);
  const [stream, setStream] = useState<'live' | 'connecting' | 'offline'>('connecting');
  const scale = useFitScale();
  const screen = stack[stack.length - 1]!;

  const push = useCallback((s: Screen) => { setStack((st) => [...st, s]); setCursor(0); }, []);
  const pop = useCallback(() => { setStack((st) => (st.length > 1 ? st.slice(0, -1) : st)); setCursor(0); }, []);
  const home = useCallback(() => { setStack([{ name: 'home' }]); setCursor(0); }, []);
  const flash = useCallback((text: string, tone: 'lime' | 'critical' | 'high' = 'lime') => {
    setBanner({ text, tone });
    setTimeout(() => setBanner((b) => (b?.text === text ? null : b)), 4000);
  }, []);

  const loadContext = useCallback(async () => {
    try {
      const c = await data.context();
      setCtx(c);
      return c;
    } catch (e) {
      if (e instanceof DeviceError) {
        if (e.code === 'device_revoked' || e.code === 'device_session_invalid' || e.code === 'not_paired') setPhase(e.code === 'device_revoked' ? 'revoked' : 'setup');
        else if (e.code === 'device_suspended') setPhase('suspended');
        else if (e.code === 'device_unassigned') setPhase('unassigned');
      }
      throw e;
    }
  }, [data]);

  // Boot: resume an existing device session, otherwise start pairing.
  useEffect(() => {
    if (demo) { void loadContext(); return; }
    if (!link.hasCredential()) { setPhase('setup'); return; }
    link.refresh().then(() => loadContext()).then(() => setPhase('ready')).catch((e) => {
      if (!(e instanceof DeviceError) || e.status === 0) { setPhase('ready'); setOnline(false); }
      else if (e.code === 'device_revoked') setPhase('revoked');
      else if (e.code === 'device_suspended') setPhase('suspended');
      else if (e.code === 'device_unassigned') setPhase('unassigned');
      else setPhase('setup');
    });
  }, [demo, link, loadContext]);

  // Connectivity + queue state from the device link.
  useEffect(() => {
    const off = link.subscribe(() => { setOnline(link.online); setQueued(link.queue().length); });
    return () => { off(); };
  }, [link]);
  useEffect(() => {
    setQueued(link.queue().length);
    const up = () => setOnline(link.online);
    window.addEventListener('online', up);
    window.addEventListener('offline', up);
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const d = e.data as { type?: string; online?: boolean };
      if (d?.type === 'hydris:network' && typeof d.online === 'boolean') {
        link.setSimulatedOffline(!d.online);
        emitToHost(d.online ? 'network.restored' : 'network.lost');
      }
    };
    window.addEventListener('message', onMsg);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', up); window.removeEventListener('message', onMsg); };
  }, [link]);

  // On reconnect: replay queued inspection responses and surface conflicts.
  const wasOnline = useRef(true);
  useEffect(() => {
    if (online && !wasOnline.current && phase === 'app') {
      link.flush().then((r) => {
        if (r.conflicts.length) flash(`${r.conflicts.length} queued step(s) rejected: ${r.conflicts[0]!.reason.replace(/_/g, ' ')}`, 'high');
        else if (r.sent) flash(`Back online · ${r.sent} queued step(s) synced`);
        else flash('Back online');
        emitToHost('queue.flushed', r);
        void loadContext().catch(() => {});
      }).catch(() => {});
    }
    wasOnline.current = online;
  }, [online, phase, link, flash, loadContext]);

  // Realtime: device-scoped event stream.
  useEffect(() => {
    if (demo || (phase !== 'app' && phase !== 'ready')) return;
    let lastReload = 0;
    const reload = () => { if (Date.now() - lastReload > 1500) { lastReload = Date.now(); void loadContext().catch(() => {}); } };
    const stop = openStream({
      getToken: () => link.getAccessToken(),
      refresh: async () => { try { await link.refresh(); return true; } catch (e) { if (e instanceof DeviceError && e.code === 'device_revoked') setPhase('revoked'); return false; } },
      isOnline: () => link.online,
      onStatus: (s) => setStream(s === 'live' ? 'live' : s === 'offline' ? 'offline' : 'connecting'),
      onEvent: (e) => {
        emitToHost(`sse:${e.type}`, e.data);
        if (e.type === 'alarm.created') {
          const a = e.data as unknown as GAlarm & { siteId?: string };
          if (a.severity === 'critical' || a.severity === 'high') setInterrupt({ ...a, assetTag: null });
          reload();
        } else if (e.type === 'device.revoked') { link.forget(); setPhase('revoked'); }
        else if (e.type === 'device.context_changed') {
          void link.refresh().then(() => loadContext()).then((c) => flash(`Device now assigned to ${c.operator.name}`)).catch((err) => {
            if (err instanceof DeviceError && err.code === 'device_suspended') setPhase('suspended');
            if (err instanceof DeviceError && err.code === 'device_unassigned') setPhase('unassigned');
          });
          home();
        } else if (['alarm.updated', 'inspection.updated', 'maintenance.updated', 'notification.created'].includes(e.type)) reload();
      },
    });
    return stop;
  }, [demo, phase, link, loadContext, flash, home]);

  // Demo mode: poll the synthetic plant model.
  useEffect(() => {
    if (!demo) return;
    const t = setInterval(() => void loadContext().then((c) => {
      const crit = c.alarms.find((a) => a.severity === 'critical' && a.state === 'active');
      if (crit) setInterrupt((cur) => cur ?? crit);
    }), 2500);
    return () => clearInterval(t);
  }, [demo, loadContext]);

  useHudInput((k) => {
    emitToHost('input', k);
    if (interrupt) {
      if (k === 'select') { push({ name: 'alert', id: interrupt.id }); setInterrupt(null); }
      if (k === 'back') setInterrupt(null);
      return;
    }
    if (control.current.onKey?.(k)) return;
    const n = control.current.actions.length;
    if (k === 'up' || k === 'left') setCursor((c) => (n ? (c - 1 + n) % n : 0));
    else if (k === 'down' || k === 'right') setCursor((c) => (n ? (c + 1) % n : 0));
    else if (k === 'select') { const a = control.current.actions[cursor]; if (a && !a.disabled) a.onSelect(); }
    else if (k === 'back' && phase === 'app') pop();
  });

  const register = useCallback((c: HudControl) => { control.current = c; }, []);
  useEffect(() => { emitToHost('screen', { phase, screen: screen.name }); }, [phase, screen.name]);

  const nav = { push, pop, home, flash, reload: loadContext };
  let body: ReactNode;
  if (phase === 'boot') body = <Centered icon={<Glasses size={46} />} title="Starting Hydris" body="Checking device session…" />;
  else if (phase === 'setup') body = <PairingScreen link={link} simulator={!!simulator} online={online} onPaired={async () => { await loadContext(); setPhase('ready'); emitToHost('paired'); }} />;
  else if (phase === 'revoked') body = <TerminalScreen icon={<ShieldAlert size={46} />} title="Device revoked" body="An administrator revoked these glasses. Sessions have ended. Pair again to continue." actionLabel="Pair again" onAction={() => { link.forget(); setPhase('setup'); }} />;
  else if (phase === 'suspended') body = <TerminalScreen icon={<ShieldAlert size={46} />} title="Device suspended" body="These glasses are temporarily suspended. Contact your supervisor." actionLabel="Check again" onAction={() => { link.refresh().then(() => loadContext()).then(() => setPhase('app')).catch(() => {}); }} />;
  else if (phase === 'unassigned') body = <TerminalScreen icon={<Info size={46} />} title="No operator assigned" body="Ask an administrator to assign these glasses to an operator." actionLabel="Check again" onAction={() => { link.refresh().then(() => loadContext()).then(() => setPhase('app')).catch(() => {}); }} />;
  else if (phase === 'ready') body = <ReadyScreen ctx={ctx} online={online} onEnter={() => { setPhase('app'); home(); }} />;
  else if (!ctx) body = <Centered icon={online ? <RefreshCw size={40} className="animate-spin" /> : <WifiOff size={40} />} title={online ? 'Loading context' : 'Offline'} body={online ? 'Fetching your assignments…' : 'Assignments will load when the connection returns.'} />;
  else body = <ScreenView key={JSON.stringify(screen)} screen={screen} ctx={ctx} data={data} nav={nav} online={online} />;

  return (
    <div className="fixed inset-0 grid place-items-center overflow-hidden bg-black text-white" style={{ fontFamily: 'var(--font-outfit), system-ui, sans-serif' }}>
      <div className="relative h-[600px] w-[600px] origin-center" style={{ transform: `scale(${scale})` }} role="application" aria-label="Hydris glasses viewport" aria-roledescription="smart glasses display">
        <HudContext.Provider value={{ cursor, register }}>
          {phase === 'app' && ctx && <StatusBar ctx={ctx} online={online} queued={queued} stream={demo ? 'live' : stream} demo={demo} />}
          <div className={phase === 'app' ? 'absolute inset-x-0 bottom-[54px] top-[64px] overflow-hidden px-8' : 'absolute inset-0 px-8 py-8'}>{body}</div>
          {phase === 'app' && <HintBar />}
          {banner && <div role="status" className={`absolute inset-x-8 top-[70px] z-20 rounded-[22px] border-2 px-5 py-3 text-[19px] ${banner.tone === 'critical' ? 'border-[#ff5a4e] bg-[#2a0d0b]' : banner.tone === 'high' ? 'border-[#f26414] bg-[#2a1608]' : 'border-lime bg-[#1b2207]'}`}>{banner.text}</div>}
          {interrupt && <AlertInterrupt a={interrupt} />}
          {!online && phase === 'app' && <div className="absolute inset-x-0 bottom-[54px] z-10 bg-[#2a1608] py-1.5 text-center text-[17px] text-[#ff9a5c]">Offline · steps are saved on the glasses and sync automatically</div>}
        </HudContext.Provider>
      </div>
    </div>
  );
}

// ---------------- chrome ----------------
function StatusBar({ ctx, online, queued, stream, demo }: { ctx: GContext; online: boolean; queued: number; stream: string; demo: boolean }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 15000); return () => clearInterval(t); }, []);
  return (
    <div className="absolute inset-x-0 top-0 flex h-[64px] items-center gap-3 px-8 text-[18px]">
      <span className="num font-medium">{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      <span className="text-white/50">{ctx.site?.code ?? ''}</span>
      {demo && <span className="rounded-full border border-dashed border-lime/60 px-2.5 text-[15px] text-lime">synthetic demo</span>}
      <span className="ml-auto flex items-center gap-2">
        {queued > 0 && <span className="num rounded-full bg-[#f26414] px-2.5 text-[15px] font-semibold text-black">{queued} queued</span>}
        {online ? (stream === 'live' ? <Signal size={22} className="text-lime" aria-label="Connected" /> : <Wifi size={22} className="text-white/60" aria-label="Connecting" />) : <SignalZero size={22} className="text-[#ff9a5c]" aria-label="Offline" />}
        <span className="grid h-[38px] w-[38px] place-items-center rounded-full bg-white/10 text-[15px]">{ctx.operator.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}</span>
      </span>
    </div>
  );
}

function HintBar() {
  return (
    <div className="absolute inset-x-0 bottom-0 flex h-[54px] items-center justify-center gap-6 text-[16px] text-white/45" aria-hidden>
      <span>↑ ↓ move</span><span>● select</span><span>← back</span>
    </div>
  );
}

function Centered({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div className="grid h-full place-items-center text-center">
      <div>
        <div className="mx-auto mb-6 grid h-[96px] w-[96px] place-items-center rounded-full border-2 border-white/15 text-lime">{icon}</div>
        <div className="text-[34px] tracking-[-0.03em]">{title}</div>
        <p className="mx-auto mt-3 max-w-[440px] text-[20px] text-white/60">{body}</p>
      </div>
    </div>
  );
}

function TerminalScreen({ icon, title, body, actionLabel, onAction }: { icon: ReactNode; title: string; body: string; actionLabel: string; onAction: () => void }) {
  const cursor = useHud({ actions: [{ key: 'a', onSelect: onAction }] });
  return (
    <div className="grid h-full content-center gap-8">
      <Centered icon={icon} title={title} body={body} />
      <HudItem active={cursor === 0} tone="lime" onClick={onAction}><span className="mx-auto">{actionLabel}</span></HudItem>
    </div>
  );
}

function AlertInterrupt({ a }: { a: GAlarm }) {
  return (
    <div role="alertdialog" aria-label={`${a.severity} alarm`} className="absolute inset-0 z-30 grid place-items-center bg-black/90 px-8">
      <div className={`w-full rounded-[34px] border-[3px] p-8 ${a.severity === 'critical' ? 'border-[#ff5a4e]' : 'border-[#f26414]'}`}>
        <div className="flex items-center gap-3 text-[20px] uppercase tracking-[0.12em]" style={{ color: a.severity === 'critical' ? '#ff8a80' : '#ff9a5c' }}>
          <AlertTriangle size={26} /> {a.severity} alarm {a.synthetic && <span className="text-[15px] normal-case tracking-normal text-lime">· synthetic</span>}
        </div>
        <div className="mt-4 text-[34px] leading-tight tracking-[-0.02em]">{a.title}</div>
        {a.triggerValue !== null && <div className="mt-3 text-[24px] text-white/75 num">{a.triggerValue} {a.unit}</div>}
        <div className="mt-8 grid grid-cols-2 gap-3 text-[21px]">
          <span className="rounded-full bg-lime py-3 text-center text-[#141714]">● View</span>
          <span className="rounded-full border-2 border-white/25 py-3 text-center">← Dismiss</span>
        </div>
      </div>
    </div>
  );
}

// ---------------- pairing ----------------
function PairingScreen({ link, simulator, online, onPaired }: { link: DeviceLink; simulator: boolean; online: boolean; onPaired: () => Promise<void> }) {
  const [c, setC] = useState<PairingChallenge | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [status, setStatus] = useState<'requesting' | 'waiting' | 'approved' | 'expired' | 'denied' | 'error'>('requesting');
  const [left, setLeft] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  const start = useCallback(async () => {
    setStatus('requesting');
    setErr(null);
    try {
      const ch = await link.createChallenge({ kind: simulator ? 'simulator' : 'hardware', model: simulator ? 'Hydris browser simulator' : 'Web viewport', appVersion: APP_VERSION, display: { width: 600, height: 600 } });
      setC(ch);
      setQr(await QRCode.toDataURL(ch.verificationUriComplete, { margin: 1, width: 360, color: { dark: '#ffffff', light: '#000000' }, errorCorrectionLevel: 'M' }));
      setStatus('waiting');
      emitToHost('pairing.challenge', { code: ch.userCode, url: ch.verificationUriComplete, expiresAt: ch.expiresAt });
    } catch (e) {
      setStatus('error');
      setErr(e instanceof Error ? e.message : 'Could not start pairing');
    }
  }, [link, simulator]);

  // Deferred so a mount that is immediately torn down (dev StrictMode, fast navigation) never issues a challenge.
  useEffect(() => {
    const t = setTimeout(() => void start(), 0);
    return () => clearTimeout(t);
  }, [start]);

  useEffect(() => {
    if (!c || status !== 'waiting') return;
    let stop = false;
    const tick = setInterval(() => setLeft(Math.max(0, Math.round((new Date(c.expiresAt).getTime() - Date.now()) / 1000))), 1000);
    const poll = async () => {
      while (!stop) {
        await new Promise((r) => setTimeout(r, c.pollIntervalS * 1000));
        if (stop) return;
        try {
          const r = await link.poll(c);
          if (r.status === 'completed') { setStatus('approved'); emitToHost('pairing.completed'); await onPaired(); return; }
          if (r.status === 'expired' || r.status === 'cancelled') { setStatus('expired'); return; }
          if (r.status === 'denied') { setStatus('denied'); return; }
        } catch {
          /* transient (offline) — keep polling until expiry */
        }
      }
    };
    void poll();
    return () => { stop = true; clearInterval(tick); };
  }, [c, status, link, onPaired]);

  const cursor = useHud({ actions: [{ key: 'regen', onSelect: () => { if (c) void link.cancelChallenge(c); void start(); } }] });
  const mm = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;

  return (
    <div className="grid h-full grid-cols-[1fr_auto] gap-6">
      <div className="flex flex-col">
        <div className="flex items-center gap-3 text-[20px]"><span className="grid h-10 w-10 place-items-center rounded-full bg-lime text-[#141714]"><Glasses size={22} /></span> hydris<span className="text-white/45">/glasses</span></div>
        <div className="mt-8 text-[36px] leading-[1.05] tracking-[-0.03em]">Pair these glasses</div>
        <ol className="mt-5 grid gap-2 text-[19px] text-white/70">
          <li>1 · Sign in to Hydris on your phone</li>
          <li>2 · Scan the code, or open <span className="text-white">/pair</span></li>
          <li>3 · Check the code matches, then approve</li>
        </ol>
        <div className="mt-auto">
          <div className="text-[16px] uppercase tracking-[0.14em] text-white/50">Pairing code</div>
          <div className="num mt-1 whitespace-nowrap text-[44px] font-light tracking-[0.06em] text-lime">{c?.userCode ?? '····-····'}</div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {status === 'waiting' && <HudPill tone={left < 60 ? 'high' : 'line'}>expires {mm}</HudPill>}
            {status === 'approved' && <HudPill tone="ok"><Check size={18} /> approved</HudPill>}
            {status === 'expired' && <HudPill tone="high">expired</HudPill>}
            {status === 'denied' && <HudPill tone="critical">denied</HudPill>}
            {status === 'error' && <HudPill tone="critical">{err}</HudPill>}
            <HudPill tone={online ? 'ok' : 'high'}>{online ? <Wifi size={17} /> : <WifiOff size={17} />}{online ? 'online' : 'offline'}</HudPill>
          </div>
        </div>
      </div>
      <div className="flex w-[230px] flex-col items-center justify-between">
        <div className="grid h-[230px] w-[230px] place-items-center rounded-[28px] border-2 border-white/15 p-3" aria-label={c ? `QR code linking to ${c.verificationUri} with code ${c.userCode}` : 'QR code loading'}>
          {qr && status === 'waiting' ? <img src={qr} alt="" className="h-full w-full" /> : <span className="text-[18px] text-white/40">{status === 'requesting' ? 'Generating…' : '—'}</span>}
        </div>
        <p className="text-center text-[15px] leading-snug text-white/45">Single-use · short-lived · contains no credentials</p>
        <HudItem active={cursor === 0} onClick={() => { if (c) void link.cancelChallenge(c); void start(); }}><RefreshCw size={22} /><span>New code</span></HudItem>
      </div>
    </div>
  );
}

function ReadyScreen({ ctx, online, onEnter }: { ctx: GContext | null; online: boolean; onEnter: () => void }) {
  const cursor = useHud({ actions: [{ key: 'enter', onSelect: onEnter }] });
  return (
    <div className="flex h-full flex-col">
      <HudTitle eyebrow="Paired · ready">{ctx ? `Hello, ${ctx.operator.name.split(' ')[0]}` : 'Paired'}</HudTitle>
      {ctx ? (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-[20px]">
          <Kv k="Operator" v={ctx.operator.name} /><Kv k="Organization" v={ctx.organization.name} />
          <Kv k="Site" v={ctx.site?.name ?? 'All assigned sites'} /><Kv k="Device" v={ctx.device.name} />
          <Kv k="Connection" v={online ? 'Online' : 'Offline'} /><Kv k="Session" v="Active · device-bound" />
        </dl>
      ) : <p className="text-[20px] text-white/60">Context will load when the connection returns.</p>}
      <div className="mt-auto"><HudItem active={cursor === 0} tone="lime" onClick={onEnter}><span className="mx-auto font-medium">Enter viewport</span><ChevronRight /></HudItem></div>
    </div>
  );
}

const Kv = ({ k, v }: { k: string; v: string }) => (
  <div className="min-w-0"><dt className="text-[16px] text-white/50">{k}</dt><dd className="truncate">{v}</dd></div>
);

// ---------------- app screens ----------------
interface Nav { push: (s: Screen) => void; pop: () => void; home: () => void; flash: (t: string, tone?: 'lime' | 'critical' | 'high') => void; reload: () => Promise<GContext> }

function ScreenView({ screen, ctx, data, nav, online }: { screen: Screen; ctx: GContext; data: GlassesData; nav: Nav; online: boolean }) {
  switch (screen.name) {
    case 'home': return <Home ctx={ctx} nav={nav} />;
    case 'alerts': return <AlertsList ctx={ctx} nav={nav} />;
    case 'alert': return <AlertDetail ctx={ctx} id={screen.id} data={data} nav={nav} online={online} />;
    case 'inspections': return <InspectionsList ctx={ctx} nav={nav} />;
    case 'inspection': return <InspectionRunner id={screen.id} data={data} nav={nav} online={online} />;
    case 'tasks': return <TasksList ctx={ctx} nav={nav} />;
    case 'task': return <TaskDetail ctx={ctx} id={screen.id} data={data} nav={nav} online={online} />;
    case 'asset': return <AssetContext id={screen.id} data={data} nav={nav} />;
    case 'assist': return <Assist q={screen.q} assetId={screen.assetId} data={data} online={online} />;
    case 'status': return <Status ctx={ctx} online={online} />;
  }
}

function Home({ ctx, nav }: { ctx: GContext; nav: Nav }) {
  const crit = ctx.alarms.filter((a) => a.severity === 'critical').length;
  const active = ctx.alarms.filter((a) => a.state === 'active').length;
  const next = ctx.inspections[0];
  const items = [
    { key: 'alerts', icon: <AlertTriangle size={26} />, label: 'Alerts', meta: ctx.alarms.length ? `${ctx.alarms.length} open${crit ? ` · ${crit} critical` : ''}` : 'none', tone: crit ? 'critical' as const : active ? 'high' as const : undefined, go: () => nav.push({ name: 'alerts' }) },
    { key: 'insp', icon: <ClipboardCheck size={26} />, label: 'Inspections', meta: `${ctx.inspections.length} assigned`, go: () => nav.push({ name: 'inspections' }) },
    { key: 'tasks', icon: <Wrench size={26} />, label: 'Maintenance', meta: `${ctx.tasks.length} tasks`, go: () => nav.push({ name: 'tasks' }) },
    { key: 'status', icon: <Cog size={26} />, label: 'Device & session', meta: ctx.device.name, go: () => nav.push({ name: 'status' }) },
  ];
  const cursor = useHud({ actions: [...(next ? [{ key: 'next', onSelect: () => nav.push({ name: 'inspection', id: next.id }) }] : []), ...items.map((i) => ({ key: i.key, onSelect: i.go }))] });
  const offset = next ? 1 : 0;
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-[17px] uppercase tracking-[0.14em] text-white/55">{ctx.site?.name ?? ctx.organization.name}</div>
          <div className="text-[34px] tracking-[-0.03em]">{ctx.operator.name.split(' ')[0]}’s shift</div>
        </div>
        {crit > 0 && <HudPill tone="critical">{crit} critical</HudPill>}
      </div>
      {next && (
        <HudItem active={cursor === 0} tone="lime" onClick={() => nav.push({ name: 'inspection', id: next.id })}>
          <span className="grid h-[44px] w-[44px] flex-none place-items-center rounded-full bg-lime text-[#141714]"><ClipboardCheck size={24} /></span>
          <span className="min-w-0 flex-1"><span className="block truncate text-white">Next: {next.title}</span><span className="block text-[17px] text-white/55">{next.stepCount} steps · {next.status.replace('_', ' ')}</span></span>
          <ChevronRight />
        </HudItem>
      )}
      <div className="grid gap-2.5">
        {items.map((i, idx) => (
          <HudItem key={i.key} active={cursor === idx + offset} tone={i.tone} onClick={i.go}>
            {i.icon}<span className="flex-1 text-white">{i.label}</span><span className="text-[18px] text-white/55">{i.meta}</span>
          </HudItem>
        ))}
      </div>
    </div>
  );
}

function ListScreen<T extends { id: string }>({ title, eyebrow, rows, render, onOpen, empty }: { title: string; eyebrow: string; rows: T[]; render: (r: T) => ReactNode; onOpen: (r: T) => void; empty: string }) {
  const cursor = useHud({ actions: rows.map((r) => ({ key: r.id, onSelect: () => onOpen(r) })) });
  return (
    <div className="flex h-full flex-col">
      <HudTitle eyebrow={eyebrow}>{title}</HudTitle>
      {rows.length ? <div className="grid gap-2.5 overflow-y-auto pb-2 scrollbar-none">{rows.map((r, i) => <HudItem key={r.id} active={cursor === i} onClick={() => onOpen(r)}>{render(r)}</HudItem>)}</div>
        : <p className="text-[22px] text-white/60">{empty}</p>}
    </div>
  );
}

function AlertsList({ ctx, nav }: { ctx: GContext; nav: Nav }) {
  return <ListScreen title="Alerts" eyebrow={`${ctx.alarms.length} open`} rows={ctx.alarms} empty="No open alerts on your site." onOpen={(a) => nav.push({ name: 'alert', id: a.id })}
    render={(a) => (<>
      <CircleDot size={24} style={{ color: a.severity === 'critical' ? '#ff5a4e' : a.severity === 'high' ? '#f26414' : '#f5b83d' }} />
      <span className="min-w-0 flex-1"><span className="block truncate text-white">{a.title}</span><span className="block text-[17px] text-white/55">{a.state} · {timeAgo(a.triggeredAt)}{a.synthetic ? ' · synthetic' : ''}</span></span>
    </>)} />;
}

function AlertDetail({ ctx, id, data, nav, online }: { ctx: GContext; id: string; data: GlassesData; nav: Nav; online: boolean }) {
  const a = ctx.alarms.find((x) => x.id === id);
  const [busy, setBusy] = useState(false);
  const ack = async () => {
    if (!a || !online) return;
    setBusy(true);
    try { await data.acknowledge(a.id); await nav.reload(); nav.flash('Acknowledged. The equipment state is unchanged.'); }
    catch (e) { nav.flash(e instanceof Error ? e.message : 'Failed', 'critical'); }
    finally { setBusy(false); }
  };
  const actions = a ? [
    ...(a.state === 'active' ? [{ key: 'ack', onSelect: () => void ack(), disabled: !online || busy }] : []),
    { key: 'proc', onSelect: () => nav.push({ name: 'assist', q: a.title }) },
  ] : [];
  const cursor = useHud({ actions });
  if (!a) return <p className="text-[22px] text-white/60">This alert is no longer open.</p>;
  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center gap-2"><HudPill tone={SEV_HUD[a.severity]}>{a.severity}</HudPill><HudPill>{a.state}</HudPill>{a.synthetic && <HudPill tone="lime">synthetic</HudPill>}</div>
      <div className="text-[32px] leading-[1.1] tracking-[-0.02em]">{a.title}</div>
      <div className="mt-4 flex items-end gap-8">
        {a.triggerValue !== null && <HudMetric value={a.triggerValue} unit={a.unit ?? ''} label={`at trigger · ${timeAgo(a.triggeredAt)}`} tone={a.severity === 'critical' ? '#ff8a80' : '#ff9a5c'} />}
        {a.assetTag && <div className="text-[20px] text-white/60">Asset<br /><span className="text-white">{a.assetTag}</span></div>}
      </div>
      {a.recommendedAction && <p className="mt-4 rounded-[20px] border-2 border-white/10 px-4 py-3 text-[19px] text-white/80">Next step (approved procedure): {a.recommendedAction}</p>}
      <div className="mt-auto grid gap-2.5">
        {a.state === 'active' && <HudItem active={cursor === 0} tone="lime" disabled={!online || busy} onClick={() => void ack()}><Check size={24} /><span className="flex-1">{online ? 'Acknowledge' : 'Acknowledge (needs connection)'}</span><span className="text-[16px] text-white/50">does not change equipment</span></HudItem>}
        <HudItem active={cursor === (a.state === 'active' ? 1 : 0)} onClick={() => nav.push({ name: 'assist', q: a.title })}><BookOpen size={24} /><span>Open procedure</span></HudItem>
      </div>
    </div>
  );
}

function InspectionsList({ ctx, nav }: { ctx: GContext; nav: Nav }) {
  return <ListScreen title="Inspections" eyebrow="assigned to you" rows={ctx.inspections} empty="No inspections assigned." onOpen={(i) => nav.push({ name: 'inspection', id: i.id })}
    render={(i) => (<>
      <ClipboardCheck size={24} className={i.priority === 'high' ? 'text-[#ff9a5c]' : 'text-lime'} />
      <span className="min-w-0 flex-1"><span className="block truncate text-white">{i.title}</span><span className="block text-[17px] text-white/55">{i.stepCount} steps · {i.status.replace('_', ' ')}{i.dueAt ? ` · due ${timeUntil(i.dueAt)}` : ''}</span></span>
    </>)} />;
}

/** Guided inspection: verify equipment → safety → steps → review → submit; resumable and offline-tolerant. */
function InspectionRunner({ id, data, nav, online }: { id: string; data: GlassesData; nav: Nav; online: boolean }) {
  const [insp, setInsp] = useState<GInspection | null>(null);
  const [stage, setStage] = useState<'verify' | 'safety' | 'step' | 'review' | 'done'>('verify');
  const [idx, setIdx] = useState(0);
  const [local, setLocal] = useState<Record<string, StepValue>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    data.inspection(id).then((i) => {
      setInsp(i);
      const firstOpen = i.steps.findIndex((s) => !i.responses[s.id]);
      if (Object.keys(i.responses).length) { setStage('step'); setIdx(firstOpen < 0 ? i.steps.length - 1 : firstOpen); }
    }).catch((e) => setError(e instanceof Error ? e.message : 'Could not load inspection'));
  }, [data, id]);

  const answered = (s: InspectionStep) => !!local[s.id] || !!insp?.responses[s.id];
  const record = async (s: InspectionStep, v: StepValue) => {
    setLocal((l) => ({ ...l, [s.id]: v }));
    try {
      const r = await data.record(id, s.id, v);
      if (r === 'queued') nav.flash('Saved on glasses · will sync when online', 'high');
    } catch (e) { nav.flash(e instanceof Error ? e.message : 'Not saved', 'critical'); }
    if (insp && idx < insp.steps.length - 1) setIdx(idx + 1); else setStage('review');
  };
  const submit = async () => {
    if (!online) { nav.flash('Submitting needs a connection. Your steps are saved.', 'high'); return; }
    setBusy(true);
    try {
      // No expectedRevision here: recording steps legitimately advances the revision; the server
      // still rejects submits for inspections that were cancelled/reassigned meanwhile.
      const r = await data.transition(id, 'submit');
      setStage('done');
      nav.flash(r.followUpId ? 'Submitted · follow-up maintenance opened' : 'Submitted and synced to the console');
      void nav.reload();
    } catch (e) { nav.flash(e instanceof Error ? e.message : 'Submit failed', 'critical'); }
    finally { setBusy(false); }
  };
  const pause = async () => {
    try { if (online) await data.transition(id, 'pause'); } catch { /* resumable either way */ }
    nav.flash('Paused · resume any time from Inspections');
    nav.pop();
  };

  const step = insp?.steps[idx];
  const stepCtl = useStepControl(step, (v) => void record(step!, v));
  const actions: HudControl['actions'] =
    stage === 'verify' ? [{ key: 'confirm', onSelect: () => setStage(insp?.safetyNotices.length ? 'safety' : 'step') }, ...(insp?.asset ? [{ key: 'asset', onSelect: () => nav.push({ name: 'asset', id: insp.asset!.id }) }] : [])]
      : stage === 'safety' ? [{ key: 'ack', onSelect: () => setStage('step') }]
        : stage === 'step' ? [...stepCtl.actions, { key: 'pause', onSelect: () => void pause() }]
          : stage === 'review' ? [{ key: 'submit', onSelect: () => void submit(), disabled: busy }, { key: 'back', onSelect: () => { setStage('step'); setIdx(0); } }]
            : [{ key: 'home', onSelect: nav.home }];
  const cursor = useHud({ actions, onKey: stage === 'step' ? stepCtl.onKey : undefined });

  if (error) return <Centered icon={<AlertTriangle size={40} />} title="Inspection unavailable" body={error} />;
  if (!insp) return <Centered icon={<RefreshCw size={40} className="animate-spin" />} title="Loading" body="Fetching inspection steps…" />;
  const merged = new Map(insp.steps.map((s) => [s.id, insp.responses[s.id] ?? (local[s.id] ? { outcome: 'ok' as const } : undefined)]).filter(([, v]) => v) as [string, { outcome: 'ok' | 'abnormal' | 'na' }][]);
  const progress = inspectionProgress(insp.steps, merged);

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex items-center gap-3 text-[17px] text-white/55">
        <span className="truncate">{insp.title}</span>
        <span className="ml-auto num">{progress.answered}/{progress.total}</span>
      </div>
      <div className="mb-4 h-[6px] overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-lime transition-[width]" style={{ width: `${progress.percent}%` }} /></div>
      {stage === 'verify' && (<>
        <HudTitle eyebrow="Step 0 · verify equipment">{insp.asset ? `${insp.asset.tag}` : 'Confirm location'}</HudTitle>
        <p className="text-[22px] text-white/75">{insp.asset ? `${insp.asset.name}. Confirm you are at this equipment before starting.` : 'Confirm you are at the inspection location.'}</p>
        <div className="mt-auto grid gap-2.5">
          <HudItem active={cursor === 0} tone="lime" onClick={actions[0]!.onSelect}><Check size={24} /><span>I am at {insp.asset?.tag ?? 'the location'}</span></HudItem>
          {insp.asset && <HudItem active={cursor === 1} onClick={actions[1]!.onSelect}><Info size={24} /><span>Show equipment context</span></HudItem>}
        </div>
      </>)}
      {stage === 'safety' && (<>
        <HudTitle eyebrow="Safety notices"><span className="text-[#f7c96a]">Before you start</span></HudTitle>
        <ul className="grid gap-3 text-[22px]">{insp.safetyNotices.map((n) => <li key={n} className="flex gap-3"><ShieldAlert size={26} className="mt-0.5 flex-none text-[#f5b83d]" />{n}</li>)}</ul>
        <div className="mt-auto"><HudItem active={cursor === 0} tone="lime" onClick={() => setStage('step')}><Check size={24} /><span>Read and understood</span></HudItem></div>
      </>)}
      {stage === 'step' && step && (<>
        <div className="text-[17px] uppercase tracking-[0.14em] text-white/55">Step {idx + 1} of {insp.steps.length}{step.required ? '' : ' · optional'}{answered(step) ? ' · recorded' : ''}</div>
        <div className="mt-1 text-[30px] leading-[1.1] tracking-[-0.02em]">{step.title}</div>
        {step.caution && <p className="mt-2 flex gap-2 text-[19px] text-[#f7c96a]"><ShieldAlert size={22} className="mt-0.5 flex-none" />{step.caution}</p>}
        {step.instruction && <p className="mt-2 text-[19px] text-white/65">{step.instruction}</p>}
        <div className="mt-auto">{stepCtl.render(cursor)}
          <HudItem active={cursor === stepCtl.actions.length} tone="muted" onClick={() => void pause()}><span>Pause and resume later</span></HudItem>
        </div>
      </>)}
      {stage === 'review' && (<>
        <HudTitle eyebrow="Review">{progress.complete ? 'Ready to submit' : `${progress.required - progress.requiredAnswered} required open`}</HudTitle>
        <div className="flex gap-8"><HudMetric value={progress.answered} label="steps recorded" /><HudMetric value={progress.abnormal} label="abnormal findings" tone={progress.abnormal ? '#ff9a5c' : undefined} /></div>
        {progress.abnormal > 0 && <p className="mt-3 text-[19px] text-white/65">Abnormal findings open a follow-up maintenance request automatically.</p>}
        <div className="mt-auto grid gap-2.5">
          <HudItem active={cursor === 0} tone="lime" disabled={busy || !progress.complete} onClick={() => void submit()}><Check size={24} /><span>{online ? 'Submit inspection' : 'Submit (needs connection)'}</span></HudItem>
          <HudItem active={cursor === 1} onClick={() => { setStage('step'); setIdx(0); }}><span>Review steps</span></HudItem>
        </div>
      </>)}
      {stage === 'done' && <Centered icon={<Check size={44} />} title="Submitted" body="Results are now visible in the operator console for review." />}
    </div>
  );
}

/** Per-kind step input for directional controls (no keyboard needed, glove-friendly). */
function useStepControl(step: InspectionStep | undefined, commit: (v: StepValue) => void) {
  const [digits, setDigits] = useState<number[]>([0, 0, 0, 0]);
  const [pos, setPos] = useState(0);
  const decimals = step?.unit === 'pH' || step?.measurand === 'ph' ? 2 : step?.measurand === 'vibration' || step?.measurand === 'pressure' ? 2 : 1;
  useEffect(() => {
    const seed = step?.expectedMax ?? step?.expectedMin ?? 0;
    const n = Math.round(Math.abs(seed) * 10 ** decimals);
    setDigits(String(n).padStart(4, '0').slice(-4).split('').map(Number));
    setPos(0);
  }, [step?.id, step?.expectedMax, step?.expectedMin, decimals]);
  if (!step) return { actions: [], render: () => null, onKey: undefined };
  const value = Number(digits.join('')) / 10 ** decimals;

  if (step.kind === 'reading') {
    return {
      actions: [{ key: 'confirm', onSelect: () => commit({ kind: 'reading', value }) }],
      onKey: (k: InputKey) => {
        if (k === 'left') { setPos((p) => Math.max(0, p - 1)); return true; }
        if (k === 'right') { setPos((p) => Math.min(3, p + 1)); return true; }
        if (k === 'up' || k === 'down') { setDigits((d) => d.map((x, i) => (i === pos ? (x + (k === 'up' ? 1 : 9)) % 10 : x))); return true; }
        return false;
      },
      render: (cursor: number) => (
        <div className="mb-3">
          <div className="mb-2 flex items-baseline justify-center gap-1" aria-label={`Value ${value} ${step.unit ?? ''}`}>
            {digits.map((d, i) => (
              <span key={i} className="flex items-baseline">
                {i === 4 - decimals && <span className="text-[56px] font-light">.</span>}
                <span className={`num grid h-[78px] w-[54px] place-items-center rounded-[16px] text-[56px] font-light ${i === pos ? 'bg-lime text-[#141714]' : 'bg-white/10'}`}>{d}</span>
              </span>
            ))}
            <span className="ml-2 text-[22px] text-white/60">{step.unit}</span>
          </div>
          <p className="mb-2 text-center text-[16px] text-white/50">← → digit · ↑ ↓ change{step.expectedMax !== undefined ? ` · limit ${step.expectedMin ?? 0}–${step.expectedMax}` : ''}</p>
          <HudItem active={cursor === 0} tone="lime" onClick={() => commit({ kind: 'reading', value })}><Check size={24} /><span>Record {value} {step.unit}</span></HudItem>
        </div>
      ),
    };
  }
  const options: { key: string; label: string; v: StepValue; tone?: 'critical' }[] =
    step.kind === 'check' ? [{ key: 'ok', label: 'OK — confirmed', v: { kind: 'check', checked: true } }, { key: 'bad', label: 'Not OK — abnormal', v: { kind: 'check', checked: false, abnormal: true }, tone: 'critical' }]
      : step.kind === 'choice' ? (step.options ?? []).map((o) => ({ key: o, label: o, v: { kind: 'choice', option: o }, tone: step.abnormalOptions?.includes(o) ? 'critical' as const : undefined }))
        : step.kind === 'text' ? ['No observations', 'Leak observed', 'Unusual noise', 'Area untidy / obstruction'].map((t) => ({ key: t, label: t, v: { kind: 'text', text: t } }))
          : [];
  if (step.kind === 'photo') {
    return {
      actions: step.required ? [] : [{ key: 'skip', onSelect: () => commit({ kind: 'text', text: 'Photo to be attached from console' } as StepValue) }],
      onKey: undefined,
      render: (cursor: number) => (
        <div className="mb-3 grid gap-2.5">
          <p className="text-[19px] text-white/65">Camera capture is not available in this runtime. Attach the photo from the console.</p>
          {!step.required && <HudItem active={cursor === 0} onClick={() => commit({ kind: 'text', text: 'Photo to be attached from console' } as StepValue)}><span>Skip — attach later</span></HudItem>}
        </div>
      ),
    };
  }
  return {
    actions: options.map((o) => ({ key: o.key, onSelect: () => commit(o.v) })),
    onKey: undefined,
    render: (cursor: number) => <div className="mb-3 grid max-h-[260px] gap-2.5 overflow-y-auto scrollbar-none">{options.map((o, i) => <HudItem key={o.key} active={cursor === i} tone={o.tone} onClick={() => commit(o.v)}>{o.label}</HudItem>)}</div>,
  };
}

function TasksList({ ctx, nav }: { ctx: GContext; nav: Nav }) {
  return <ListScreen title="Maintenance" eyebrow="assigned to you" rows={ctx.tasks} empty="No maintenance tasks assigned." onOpen={(t) => nav.push({ name: 'task', id: t.id })}
    render={(t) => (<>
      <Wrench size={24} className={t.priority === 'urgent' || t.priority === 'high' ? 'text-[#ff9a5c]' : 'text-lime'} />
      <span className="min-w-0 flex-1"><span className="block truncate text-white">{t.title}</span><span className="block text-[17px] text-white/55">{t.checklist.filter((c) => c.done).length}/{t.checklist.length} checks · {t.status.replace('_', ' ')}{t.assetTag ? ` · ${t.assetTag}` : ''}</span></span>
    </>)} />;
}

function TaskDetail({ ctx, id, data, nav, online }: { ctx: GContext; id: string; data: GlassesData; nav: Nav; online: boolean }) {
  const t = ctx.tasks.find((x) => x.id === id);
  const toggle = async (itemId: string, done: boolean) => {
    if (!online) { nav.flash('Checklist updates need a connection', 'high'); return; }
    try { await data.toggleChecklist(id, itemId, done); await nav.reload(); } catch (e) { nav.flash(e instanceof Error ? e.message : 'Failed', 'critical'); }
  };
  const cursor = useHud({ actions: (t?.checklist ?? []).map((c) => ({ key: c.id, onSelect: () => void toggle(c.id, !c.done) })) });
  if (!t) return <p className="text-[22px] text-white/60">Task no longer assigned.</p>;
  return (
    <div className="flex h-full flex-col">
      <HudTitle eyebrow={`${t.assetTag ?? 'maintenance'} · ${t.priority}`}>{t.title}</HudTitle>
      <p className="mb-3 text-[17px] text-white/50">Records only — Hydris does not operate equipment.</p>
      <div className="grid gap-2.5 overflow-y-auto scrollbar-none">
        {t.checklist.map((c, i) => (
          <HudItem key={c.id} active={cursor === i} onClick={() => void toggle(c.id, !c.done)}>
            <span className={`grid h-[34px] w-[34px] flex-none place-items-center rounded-full border-2 ${c.done ? 'border-lime bg-lime text-[#141714]' : 'border-white/30'}`}>{c.done && <Check size={20} />}</span>
            <span className={c.done ? 'text-white/50 line-through' : 'text-white'}>{c.label}</span>
          </HudItem>
        ))}
      </div>
    </div>
  );
}

function AssetContext({ id, data, nav }: { id: string; data: GlassesData; nav: Nav }) {
  const [a, setA] = useState<GAsset | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const load = () => data.asset(id).then(setA).catch((e) => setErr(e instanceof Error ? e.message : 'Unavailable'));
    void load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [data, id]);
  const cursor = useHud({ actions: a ? [{ key: 'assist', onSelect: () => nav.push({ name: 'assist', q: `${a.type} ${a.name}`, assetId: a.id }) }] : [] });
  if (err) return <Centered icon={<AlertTriangle size={40} />} title="Equipment unavailable" body={err} />;
  if (!a) return <Centered icon={<RefreshCw size={40} className="animate-spin" />} title="Loading" body="Fetching equipment context…" />;
  const last = a.sensors.map((s) => s.lastTs).filter(Boolean).sort().pop();
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between">
        <HudTitle eyebrow={`${a.tag} · ${a.type.replace('_', ' ')}`}>{a.name}</HudTitle>
        <HudPill tone={a.status === 'operational' ? 'ok' : a.status === 'down' ? 'critical' : 'medium'}>{a.status}</HudPill>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-4">
        {a.sensors.slice(0, 4).map((s) => (
          <HudMetric key={s.id} value={s.freshness === 'stale' || s.freshness === 'no_data' || s.lastValue === null ? '—' : s.lastValue.toFixed(s.unit === 'h' ? 0 : 2)} unit={s.unit}
            label={<>{s.name} · <span className={s.freshness === 'live' ? 'text-lime' : 'text-[#ff9a5c]'}>{FRESHNESS_LABELS[s.freshness]}</span>{s.lastSource === 'simulator' ? ' · synthetic' : ''}</>} />
        ))}
      </div>
      <div className="mt-3 text-[17px] text-white/50">{a.openAlarms} open alarm(s) · updated {last ? timeAgo(last) : 'never'}</div>
      <div className="mt-auto"><HudItem active={cursor === 0} onClick={() => nav.push({ name: 'assist', q: `${a.type} ${a.name}`, assetId: a.id })}><BookOpen size={24} /><span>Procedures for this equipment</span></HudItem></div>
    </div>
  );
}

function Assist({ q, assetId, data, online }: { q: string; assetId?: string; data: GlassesData; online: boolean }) {
  const [r, setR] = useState<GAssist | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (online) data.assist(q, assetId).then(setR).catch((e) => setErr(e instanceof Error ? e.message : 'Unavailable')); }, [data, q, assetId, online]);
  const [page, setPage] = useState(0);
  const sources = r?.sources ?? [];
  useHud({ actions: sources.map((_, i) => ({ key: String(i), onSelect: () => setPage(i) })), onKey: (k) => { if (k === 'down' || k === 'up') { setPage((p) => Math.max(0, Math.min(sources.length - 1, p + (k === 'down' ? 1 : -1)))); return true; } return false; } });
  if (!online) return <Centered icon={<WifiOff size={40} />} title="Procedures need a connection" body="Approved documents are retrieved from the console when online." />;
  if (err) return <Centered icon={<AlertTriangle size={40} />} title="Unavailable" body={err} />;
  if (!r) return <Centered icon={<RefreshCw size={40} className="animate-spin" />} title="Searching procedures" body={q} />;
  const s = sources[page];
  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 text-[17px] uppercase tracking-[0.14em] text-white/55">Approved procedures {sources.length > 1 ? `· ${page + 1}/${sources.length}` : ''}</div>
      {s ? (<>
        <div className="text-[28px] leading-tight tracking-[-0.02em]">{s.title}</div>
        <div className="mt-1 text-[16px] text-white/50">{s.kind.toUpperCase()} · version {s.version}</div>
        <p className="mt-4 text-[22px] leading-snug text-white/85">{renderHighlights(s.passage)}</p>
      </>) : <p className="text-[22px] text-white/70">No approved document matches. Ask your supervisor — do not improvise safety-critical steps.</p>}
      <p className="mt-auto text-[16px] leading-snug text-white/45">{r.notice}</p>
    </div>
  );
}

function Status({ ctx, online }: { ctx: GContext; online: boolean }) {
  useHud({ actions: [] });
  return (
    <div className="flex h-full flex-col">
      <HudTitle eyebrow="Device & session">{ctx.device.name}</HudTitle>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-[20px]">
        <Kv k="Operator" v={ctx.operator.name} /><Kv k="Role" v={ctx.role.replace('_', ' ')} />
        <Kv k="Organization" v={ctx.organization.name} /><Kv k="Site" v={ctx.site?.name ?? '—'} />
        <Kv k="Connection" v={online ? 'Online' : 'Offline'} /><Kv k="Device type" v={ctx.device.kind} />
        <Kv k="App version" v={APP_VERSION} /><Kv k="Server time" v={new Date(ctx.serverTime).toLocaleTimeString()} />
      </dl>
      <p className="mt-auto text-[16px] text-white/45">To unpair or hand over these glasses, ask an administrator (Console → Field glasses). Revocation ends this session immediately.</p>
    </div>
  );
}

// ---------------- helpers ----------------
function renderHighlights(s: string) {
  return s.split(/(«[^»]*»)/g).map((part, i) => (part.startsWith('«') ? <mark key={i} className="rounded bg-lime/20 px-1 text-lime">{part.slice(1, -1)}</mark> : <span key={i}>{part}</span>));
}
function timeAgo(v: string) {
  const s = Math.round((Date.now() - new Date(v).getTime()) / 1000);
  return s < 60 ? 'now' : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`;
}
function timeUntil(v: string) {
  const s = Math.round((new Date(v).getTime() - Date.now()) / 1000);
  return s < 0 ? 'overdue' : s < 3600 ? `in ${Math.max(1, Math.floor(s / 60))}m` : `in ${Math.floor(s / 3600)}h`;
}

export { X };
