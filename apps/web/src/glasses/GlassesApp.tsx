'use client';

import QRCode from 'qrcode';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle, Ban, Bell, Boxes, FileText, Gauge, Library, Minus, TrendingDown, TrendingUp, Layers, LocateFixed, Map as MapIcon, BookOpen, Sparkles, Check, ChevronRight, CircleDot, ClipboardCheck, Cog, Glasses, Info, RefreshCw, ShieldAlert, Signal, SignalZero, Wifi, WifiOff, Wrench, X, ScanLine, Mic, ChevronLeft,
} from 'lucide-react';
import {
  DEFAULT_UI_PROFILE_CONFIG, FRESHNESS_LABELS, actionAllowed, applyMeasurementProfile, inspectionProgress, isScenarioKey, normalizeUiProfileConfig, screenEnabled,
  type InspectionStep, type StepValue, type UiAction, type UiProfileConfig, type UiScreen,
} from '@hydris/domain';
import { openStream } from '@/lib/realtime';
import { DeviceError, DeviceLink, type PairingChallenge } from './link';
import { DemoData, LiveData, StaleError, cachedContext, type GAlarm, type GAsset, type GAssist, type GContext, type GDoc, type GDocSummary, type GInspection, type GlassesData, type GMeasurement, type GNotification } from './data';
import { emitToHost, useHudInput, type InputKey } from './input';
import { PlantMap, routeDistance } from './PlantMap';
import { AuditScanScreen } from './AuditScan';
import { VoiceAssistant } from './VoiceAssistant';
import { useLiveShare, type LiveState } from './live';
import { HudContext, HudItem, HudMetric, HudPill, HudTitle, SEV_HUD, useHud, useViewportLayout, type HudControl } from './hud';

type Screen =
  | { name: 'home' } | { name: 'alerts' } | { name: 'alert'; id: string } | { name: 'inspections' } | { name: 'inspection'; id: string }
  | { name: 'tasks' } | { name: 'task'; id: string } | { name: 'asset'; id: string } | { name: 'assist'; q: string; assetId?: string } | { name: 'status' } | { name: 'notifications' } | { name: 'ai' } | { name: 'map' } | { name: 'scan' }
  | { name: 'measurements' } | { name: 'assets' } | { name: 'sops' } | { name: 'sop'; id: string };
type Phase = 'boot' | 'setup' | 'ready' | 'app' | 'revoked' | 'suspended' | 'unassigned';

const APP_VERSION = '0.2.0';

/** Effective UI profile config for the current glasses session (server-provided, or the console's draft in preview). */
const ProfileCtx = createContext<UiProfileConfig>(DEFAULT_UI_PROFILE_CONFIG);
const useCfg = () => useContext(ProfileCtx);
const allowed = (cfg: UiProfileConfig, a: UiAction) => actionAllowed(cfg, a);
const canAssist = (cfg: UiProfileConfig) => actionAllowed(cfg, 'ask_ai') || actionAllowed(cfg, 'view_sops');

/** Which profile screens / actions a viewport screen requires (mirrors the server rules). */
function screenPermitted(cfg: UiProfileConfig, s: Screen): boolean {
  const on = (x: UiScreen) => screenEnabled(cfg, x);
  switch (s.name) {
    case 'home': case 'status': return true;
    case 'alerts': case 'alert': return on('alerts');
    case 'inspections': case 'inspection': return on('inspections');
    case 'tasks': case 'task': return on('tasks');
    case 'asset': return on('assets') || on('measurements') || on('inspections') || on('map');
    case 'assist': return canAssist(cfg);
    case 'notifications': return on('notifications');
    case 'scan': return on('scan');
    case 'ai': return on('ai') && allowed(cfg, 'ask_ai');
    case 'map': return on('map') && allowed(cfg, 'view_map');
    case 'measurements': return on('measurements');
    case 'assets': return on('assets');
    case 'sops': case 'sop': return on('sops') && allowed(cfg, 'view_sops');
  }
}

export function GlassesApp({ demoScenario, simulator, profilePreview }: { demoScenario?: string | null; simulator?: boolean; profilePreview?: boolean }) {
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
  // Simulator and embedded previews always show the glasses field of view; phones get the phone layout.
  const vp = useViewportLayout(!!simulator || !!demoScenario && typeof window !== 'undefined' && window.parent !== window);
  const phone = vp.mode === 'phone';
  const bottomBar = phone ? 92 : 54;
  const screen = stack[stack.length - 1]!;
  const [previewCfg, setPreviewCfg] = useState<UiProfileConfig | null>(null);
  const [staleAt, setStaleAt] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const cfg = useMemo(() => normalizeUiProfileConfig(previewCfg ?? ctx?.profile?.config ?? DEFAULT_UI_PROFILE_CONFIG), [previewCfg, ctx?.profile?.config]);
  // In-memory trend history per sensor (value samples, newest last) for the live measurements screen.
  const history = useRef(new Map<string, { ts: string; v: number }[]>());
  useEffect(() => {
    for (const m of ctx?.measurements ?? []) {
      if (m.lastValue === null || !m.lastTs) continue;
      const h = history.current.get(m.id) ?? [];
      if (h[h.length - 1]?.ts !== m.lastTs) history.current.set(m.id, [...h, { ts: m.lastTs, v: m.lastValue }].slice(-30));
    }
  }, [ctx]);

  // Screen stack is mirrored into browser history so the browser/OS back button walks back
  // through glasses screens instead of leaving the app. history.state.hud = stack depth.
  const stackRef = useRef(stack);
  stackRef.current = stack;
  const push = useCallback((s: Screen) => {
    setStack((st) => [...st, s]);
    setCursor(0);
    window.history.pushState({ hud: stackRef.current.length + 1 }, '');
  }, []);
  const pop = useCallback(() => {
    if (stackRef.current.length > 1) window.history.back();
  }, []);
  const home = useCallback(() => {
    const extra = stackRef.current.length - 1;
    if (extra > 0) window.history.go(-extra);
    else { setStack([{ name: 'home' }]); setCursor(0); }
  }, []);
  useEffect(() => {
    // Guard entry: back on the home screen stays inside the glasses app.
    window.history.replaceState({ hud: 0 }, '');
    window.history.pushState({ hud: 1 }, '');
    const onPop = (e: PopStateEvent) => {
      const depth = typeof e.state?.hud === 'number' ? e.state.hud : 0;
      if (depth < 1) { window.history.pushState({ hud: 1 }, ''); setStack([{ name: 'home' }]); setCursor(0); return; }
      setInterrupt(null);
      setStack((st) => (st.length > depth ? st.slice(0, depth) : st));
      setCursor(0);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const flash = useCallback((text: string, tone: 'lime' | 'critical' | 'high' = 'lime') => {
    setBanner({ text, tone });
    setTimeout(() => setBanner((b) => (b?.text === text ? null : b)), 4000);
  }, []);

  const loadContext = useCallback(async () => {
    try {
      const c = await data.context();
      setCtx(c);
      setStaleAt(null);
      setLastSync(new Date().toISOString());
      return c;
    } catch (e) {
      if (e instanceof DeviceError && e.status === 0) {
        // Offline: fall back to the last context cached on the glasses.
        const cached = cachedContext();
        if (cached) { setCtx((cur) => cur ?? cached.v); setStaleAt((cur) => cur ?? cached.at); }
      }
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
      if (!(e instanceof DeviceError) || e.status === 0) {
        const cached = cachedContext();
        if (cached) { setCtx(cached.v); setStaleAt(cached.at); }
        setPhase('ready'); setOnline(false);
      }
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

  // Live preview from the console profile editor (demo mode only): {type:'hydris:profile', config}.
  useEffect(() => {
    if (!demo || !profilePreview) return;
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const d = e.data as { type?: string; config?: unknown };
      if (d?.type !== 'hydris:profile') return;
      const c = normalizeUiProfileConfig(d.config);
      if (data instanceof DemoData) data.previewConfig = c;
      setPreviewCfg(c);
      void loadContext().catch(() => {});
    };
    window.addEventListener('message', onMsg);
    if (window.parent !== window) window.parent.postMessage({ type: 'hydris:preview-ready' }, window.location.origin);
    return () => window.removeEventListener('message', onMsg);
  }, [demo, profilePreview, data, loadContext]);

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
        } else if (e.type === 'device.revoked' || e.type === 'session.revoked') { link.forget(); setPhase('revoked'); }
        else if (e.type === 'device.context_changed') {
          void link.refresh().then(() => loadContext()).then((c) => flash(`Device now assigned to ${c.operator.name}`)).catch((err) => {
            if (err instanceof DeviceError && err.code === 'device_suspended') setPhase('suspended');
            if (err instanceof DeviceError && err.code === 'device_unassigned') setPhase('unassigned');
          });
          home();
        } else if (e.type === 'device.profile_changed') {
          void loadContext().then((c) => flash(`Profile updated · ${c.profile?.name ?? 'default'}${c.profile?.version ? ` v${c.profile.version}` : ''}`)).catch(() => {});
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

  const logout = useCallback(() => {
    void link.logout().finally(() => {
      setStack([{ name: 'home' }]);
      setCursor(0);
      setCtx(null);
      setPhase('setup');
      emitToHost('logout');
    });
  }, [link]);
  const nav = { push, pop, home, flash, reload: loadContext, logout };
  const status: StatusInfo = { online, queued, stream: demo ? 'live' : stream, staleAt, lastSync, demo, profile: previewCfg ? { name: 'Draft preview', version: null, source: 'preview' } : ctx?.profile ?? null };
  let body: ReactNode;
  if (phase === 'boot') body = <Centered icon={<Glasses size={46} />} title="Starting Hydris" body="Checking device session…" />;
  else if (phase === 'setup') body = <PairingScreen link={link} simulator={!!simulator} online={online} onPaired={async () => { await loadContext(); setPhase('ready'); emitToHost('paired'); }} />;
  else if (phase === 'revoked') body = <TerminalScreen icon={<ShieldAlert size={46} />} title="Device revoked" body="An administrator revoked these glasses. Sessions have ended. Pair again to continue." actionLabel="Pair again" onAction={() => { link.forget(); setPhase('setup'); }} />;
  else if (phase === 'suspended') body = <TerminalScreen icon={<ShieldAlert size={46} />} title="Device suspended" body="These glasses are temporarily suspended. Contact your supervisor." actionLabel="Check again" onAction={() => { link.refresh().then(() => loadContext()).then(() => setPhase('app')).catch(() => {}); }} />;
  else if (phase === 'unassigned') body = <TerminalScreen icon={<Info size={46} />} title="No operator assigned" body="Ask an administrator to assign these glasses to an operator." actionLabel="Check again" onAction={() => { link.refresh().then(() => loadContext()).then(() => setPhase('app')).catch(() => {}); }} />;
  else if (phase === 'ready') body = <ReadyScreen ctx={ctx} online={online} onEnter={() => { setPhase('app'); home(); }} />;
  else if (!ctx) body = <Centered icon={online ? <RefreshCw size={40} className="animate-spin" /> : <WifiOff size={40} />} title={online ? 'Loading context' : 'Offline'} body={online ? 'Fetching your assignments…' : 'Assignments will load when the connection returns.'} />;
  else body = screenPermitted(cfg, screen)
    ? <ScreenView key={JSON.stringify(screen)} screen={screen} ctx={ctx} data={data} nav={nav} online={online} status={status} history={history.current} />
    : <NotPermitted key={JSON.stringify(screen)} nav={nav} />;

  // Live view to the control room: paired glasses only, never during pairing, demo or profile preview.
  const liveRoot = useRef<HTMLDivElement>(null);
  const liveState = useMemo(() => describeScreen(screen, ctx), [screen, ctx]);
  const sharing = useLiveShare(link, !demo && !profilePreview && phase === 'app' && !!ctx, liveRoot, liveState);

  return (
    <div className={`fixed inset-0 overflow-hidden bg-black text-white ${phone ? '' : 'grid place-items-center'}`} style={{ fontFamily: 'var(--font-outfit), system-ui, sans-serif' }}>
      <div ref={liveRoot} className={`relative ${phone ? 'origin-top-left' : 'origin-center'}`} style={{ width: vp.w, height: vp.h, transform: `scale(${vp.scale})` }} role="application" aria-label="Hydris glasses viewport" aria-roledescription={phone ? 'Hydris mobile companion' : 'smart glasses display'}>
        <ProfileCtx.Provider value={cfg}>
        <HudContext.Provider value={{ cursor, register, density: cfg.layout.density }}>
          {phase === 'app' && ctx && <StatusBar ctx={ctx} online={online} queued={queued} stream={demo ? 'live' : stream} demo={demo} phone={phone} sharing={sharing} />}
          <div className={phase === 'app' ? `absolute inset-x-0 overflow-hidden ${phone ? 'px-6' : 'px-8'}` : `absolute inset-0 ${phone ? 'px-6 pb-8 pt-[calc(env(safe-area-inset-top)+32px)]' : 'px-8 py-8'}`}
            style={phase === 'app' ? { top: phone ? 'calc(env(safe-area-inset-top) + 68px)' : 64, bottom: phone ? `calc(env(safe-area-inset-bottom) + ${bottomBar}px)` : bottomBar } : undefined}>
            {/* Profile text scale: zoom the content and enlarge the box inversely so it still fills the area. */}
            <div data-live-content style={{ zoom: cfg.layout.textScale, width: `${100 / cfg.layout.textScale}%`, height: `${100 / cfg.layout.textScale}%` }}>{body}</div>
          </div>
          {phase === 'app' && !phone && <HintBar hand={cfg.layout.handedness} />}
          {phase === 'app' && phone && <PhoneTabBar screen={screen.name} canBack={stack.length > 1} onBack={pop} onHome={home} onPush={push} alerts={ctx?.alarms.length ?? 0} />}
          {phase === 'app' && ctx && <VoiceAssistant data={data} online={online} bottom={phone ? bottomBar + 10 : 62} />}
          {phase === 'app' && !phone && stack.length > 1 && (
            <button type="button" onClick={pop} aria-label="Back" className="absolute bottom-[8px] left-8 z-20 flex h-[38px] items-center gap-2 rounded-full bg-white/10 px-4 text-[16px] text-white/80 hover:bg-white/20">
              ← Back
            </button>
          )}
          {banner && <div role="status" className={`absolute inset-x-8 top-[70px] z-20 rounded-[22px] border-2 px-5 py-3 text-[19px] ${banner.tone === 'critical' ? 'border-[#ff5a4e] bg-[#2a0d0b]' : banner.tone === 'high' ? 'border-[#f26414] bg-[#2a1608]' : 'border-lime bg-[#1b2207]'}`}>{banner.text}</div>}
          {interrupt && <AlertInterrupt a={interrupt} />}
          {!online && phase === 'app' && <div style={{ bottom: phone ? `calc(env(safe-area-inset-bottom) + ${bottomBar}px)` : bottomBar }} className="absolute inset-x-0 z-10 bg-[#2a1608] py-1.5 text-center text-[17px] text-[#ff9a5c]">{staleAt ? `Offline · showing data cached ${timeAgo(staleAt)}` : 'Offline · steps are saved on the glasses and sync automatically'}</div>}
          {previewCfg && phase === 'app' && <div className="absolute left-8 top-[46px] z-10 text-[13px] uppercase tracking-[0.14em] text-lime/80">draft preview</div>}
        </HudContext.Provider>
        </ProfileCtx.Provider>
      </div>
    </div>
  );
}

// ---------------- live view description ----------------
const SCREEN_TITLES: Record<Screen['name'], string> = {
  home: 'Home', alerts: 'Alerts', alert: 'Alert', inspections: 'Inspections', inspection: 'Inspection', tasks: 'Tasks', task: 'Task', asset: 'Asset', assist: 'Assist',
  status: 'Device status', notifications: 'Notifications', ai: 'Ask Hydris', map: 'Plant map', scan: 'Audit scan', measurements: 'Measurements', assets: 'Assets', sops: 'SOPs', sop: 'SOP',
};
/** Structured screen / title / summary sent to the control room (summary empty = mirror the visible text). */
function describeScreen(screen: Screen, ctx: GContext | null): LiveState {
  const base = SCREEN_TITLES[screen.name];
  if (!ctx) return { screen: screen.name, title: base, summary: [] };
  const alarm = (a: GAlarm) => `${a.severity.toUpperCase()} · ${a.assetTag ? `${a.assetTag} · ` : ''}${a.title}`;
  switch (screen.name) {
    case 'home': return { screen: 'home', title: `Home · ${ctx.site?.name ?? ctx.organization.name}`, summary: [`${ctx.alarms.length} open alarms`, `${ctx.inspections.length} inspections`, `${ctx.tasks.length} tasks`, ...ctx.alarms.slice(0, 3).map(alarm)] };
    case 'alerts': return { screen: 'alerts', title: 'Alerts', summary: ctx.alarms.length ? ctx.alarms.slice(0, 12).map(alarm) : ['No open alarms'] };
    case 'alert': {
      const a = ctx.alarms.find((x) => x.id === screen.id);
      return { screen: 'alert', title: a ? `Alert · ${a.title}` : base, summary: a ? [alarm(a), a.triggerValue !== null ? `Value ${a.triggerValue} ${a.unit ?? ''}`.trim() : '', a.recommendedAction ?? ''].filter(Boolean) : [] };
    }
    case 'inspections': return { screen: 'inspections', title: 'Inspections', summary: ctx.inspections.length ? ctx.inspections.slice(0, 12).map((i) => `${i.assetTag ? `${i.assetTag} · ` : ''}${i.title} (${i.status.replace('_', ' ')})`) : ['No assigned inspections'] };
    case 'inspection': {
      const i = ctx.inspections.find((x) => x.id === screen.id);
      return { screen: 'inspection', title: i ? `Inspection · ${i.title}` : base, summary: [] };
    }
    case 'tasks': return { screen: 'tasks', title: 'Tasks', summary: ctx.tasks.length ? ctx.tasks.slice(0, 12).map((t) => `${t.assetTag ? `${t.assetTag} · ` : ''}${t.title}`) : ['No open tasks'] };
    case 'task': {
      const t = ctx.tasks.find((x) => x.id === screen.id);
      return { screen: 'task', title: t ? `Task · ${t.title}` : base, summary: t ? t.checklist.slice(0, 12).map((c) => `${c.done ? '[x]' : '[ ]'} ${c.label}`) : [] };
    }
    case 'asset': {
      const a = ctx.assets?.find((x) => x.id === screen.id);
      return { screen: 'asset', title: a ? `Asset · ${a.tag} ${a.name}` : base, summary: [] };
    }
    case 'assist': return { screen: 'assist', title: `Assist · ${screen.q}`.slice(0, 120), summary: [] };
    default: return { screen: screen.name, title: base, summary: [] };
  }
}

// ---------------- chrome ----------------
function StatusBar({ ctx, online, queued, stream, demo, phone, sharing }: { ctx: GContext; online: boolean; queued: number; stream: string; demo: boolean; phone?: boolean; sharing?: boolean }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 15000); return () => clearInterval(t); }, []);
  return (
    <div className={`absolute inset-x-0 top-0 flex items-center gap-3 text-[18px] ${phone ? 'border-b border-white/10 bg-black/80 px-6 backdrop-blur' : 'h-[64px] px-8'}`} style={phone ? { paddingTop: 'env(safe-area-inset-top)', height: 'calc(env(safe-area-inset-top) + 64px)' } : undefined}>
      <span className="num font-medium">{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      <span className="truncate text-white/50">{ctx.site?.code ?? ''}</span>
      {demo && <span className="flex-none whitespace-nowrap rounded-full border border-dashed border-lime/60 px-2.5 text-[15px] text-lime">demo</span>}
      <span className="ml-auto flex min-w-0 items-center gap-3">
        {sharing && (
          <span role="status" title="This screen and the camera are shared live with the control room" className="flex min-w-0 items-center gap-1.5 rounded-full border border-[#ff5a4e]/50 px-2.5 text-[14px] text-[#ff8a80]">
            <span className="h-[8px] w-[8px] flex-none animate-pulse rounded-full bg-[#ff5a4e]" aria-hidden />
            <span className="truncate">Live to control room</span>
          </span>
        )}
        <span id="hud-voice-slot" className="flex flex-none items-center" />
        {queued > 0 && <span className="num rounded-full bg-[#f26414] px-2.5 text-[15px] font-semibold text-black">{queued} queued</span>}
        {online ? (stream === 'live' ? <Signal size={22} className="text-lime" aria-label="Connected" /> : <Wifi size={22} className="text-white/60" aria-label="Connecting" />) : <SignalZero size={22} className="text-[#ff9a5c]" aria-label="Offline" />}
        <span className="grid h-[38px] w-[38px] flex-none place-items-center rounded-full bg-white/10 text-[15px]">{ctx.operator.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}</span>
      </span>
    </div>
  );
}

/** Phone layout: thumb-reach tab bar (the camera glasses' temple touchpad is replaced by the touchscreen). */
function PhoneTabBar({ screen, canBack, onBack, onHome, onPush, alerts }: { screen: string; canBack: boolean; onBack: () => void; onHome: () => void; onPush: (s: Screen) => void; alerts: number }) {
  const tab = (key: string, label: string, icon: ReactNode, onClick: () => void, active: boolean, badge?: number) => (
    <button key={key} type="button" onClick={onClick} aria-current={active || undefined}
      className={`relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-[20px] py-2 text-[15px] transition-colors ${active ? 'text-lime' : 'text-white/60 active:bg-white/10'}`}>
      {icon}
      <span className="truncate">{label}</span>
      {badge ? <span className="absolute right-[22%] top-1 grid h-[20px] min-w-[20px] place-items-center rounded-full bg-[#ff5a4e] px-1 text-[12px] font-semibold text-white">{badge}</span> : null}
    </button>
  );
  return (
    <nav aria-label="Main" className="absolute inset-x-0 bottom-0 z-30 flex items-stretch gap-1 border-t border-white/10 bg-black/90 px-3 pt-1.5 backdrop-blur"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 8px)', height: 'calc(env(safe-area-inset-bottom) + 92px)' }}>
      {canBack ? tab('back', 'Back', <ChevronLeft size={28} />, onBack, false) : tab('home', 'Home', <Glasses size={28} />, onHome, screen === 'home')}
      {tab('scan', 'Scan', <ScanLine size={28} />, () => onPush({ name: 'scan' }), screen === 'scan')}
      {tab('voice', 'Hey Hydris', <Mic size={28} />, () => window.dispatchEvent(new CustomEvent('hydris:voice-activate', { detail: {} })), false)}
      {tab('alerts', 'Alerts', <AlertTriangle size={28} />, () => onPush({ name: 'alerts' }), screen === 'alerts', alerts)}
    </nav>
  );
}

function HintBar({ hand }: { hand: 'left' | 'right' }) {
  // Handedness hint: controls sit on the operator's preferred temple, so hints align to that side.
  return (
    <div className={`absolute inset-x-0 bottom-0 flex h-[54px] items-center gap-6 px-10 text-[16px] text-white/45 ${hand === 'left' ? 'justify-start' : 'justify-end'}`} aria-hidden>
      {hand === 'left' && <span className="text-white/30">◧ left temple</span>}
      <span>↑ ↓ move</span><span>● select</span><span>← back</span>
      {hand === 'right' && <span className="text-white/30">right temple ◨</span>}
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
interface Nav { push: (s: Screen) => void; pop: () => void; home: () => void; flash: (t: string, tone?: 'lime' | 'critical' | 'high') => void; reload: () => Promise<GContext>; logout: () => void }

interface StatusInfo {
  online: boolean; queued: number; stream: string; staleAt: string | null; lastSync: string | null; demo: boolean;
  profile: { name: string; version: number | null; source: string } | null;
}
type History = Map<string, { ts: string; v: number }[]>;

const screenFor = (s: UiScreen): Screen => (s === 'tasks' ? { name: 'tasks' } : { name: s } as Screen);

function NotPermitted({ nav }: { nav: Nav }) {
  const cursor = useHud({ actions: [{ key: 'home', onSelect: nav.home }] });
  return (
    <div className="grid h-full content-center gap-8">
      <Centered icon={<Ban size={44} />} title="Not permitted by your profile" body="Your administrator has turned this screen off for these glasses. Ask them if you need it." />
      <HudItem active={cursor === 0} tone="lime" onClick={nav.home}><span className="mx-auto">Back to home</span></HudItem>
    </div>
  );
}

/** Inline explanation for an action the profile blocks (shown instead of the control). */
function Blocked({ what }: { what: string }) {
  return <p className="flex items-center gap-2 rounded-[20px] border-2 border-dashed border-white/15 px-4 py-2.5 text-[18px] text-white/55"><Ban size={20} className="flex-none" />{what} · not permitted by your profile</p>;
}

function ScreenView({ screen, ctx, data, nav, online, status, history }: { screen: Screen; ctx: GContext; data: GlassesData; nav: Nav; online: boolean; status: StatusInfo; history: History }) {
  switch (screen.name) {
    case 'home': return <Home ctx={ctx} nav={nav} />;
    case 'measurements': return <Measurements ctx={ctx} nav={nav} history={history} demo={status.demo} />;
    case 'assets': return <AssetsList ctx={ctx} nav={nav} />;
    case 'sops': return <SopLibrary data={data} nav={nav} />;
    case 'sop': return <SopReader id={screen.id} data={data} />;
    case 'alerts': return <AlertsList ctx={ctx} nav={nav} />;
    case 'alert': return <AlertDetail ctx={ctx} id={screen.id} data={data} nav={nav} online={online} />;
    case 'inspections': return <InspectionsList ctx={ctx} nav={nav} />;
    case 'inspection': return <InspectionRunner id={screen.id} data={data} nav={nav} online={online} />;
    case 'tasks': return <TasksList ctx={ctx} nav={nav} />;
    case 'task': return <TaskDetail ctx={ctx} id={screen.id} data={data} nav={nav} online={online} />;
    case 'asset': return <AssetContext id={screen.id} data={data} nav={nav} />;
    case 'assist': return <Assist q={screen.q} assetId={screen.assetId} data={data} online={online} />;
    case 'status': return <Status ctx={ctx} status={status} onLogout={nav.logout} />;
    case 'notifications': return <Notifications data={data} nav={nav} online={online} />;
    case 'ai': return <HydrisAI ctx={ctx} nav={nav} />;
    case 'map': return <MapScreen ctx={ctx} nav={nav} />;
    case 'scan': return <AuditScanScreen data={data} online={online} flash={nav.flash} />;
  }
}

function Home({ ctx, nav }: { ctx: GContext; nav: Nav }) {
  const crit = ctx.alarms.filter((a) => a.severity === 'critical').length;
  const active = ctx.alarms.filter((a) => a.state === 'active').length;
  const cfg = useCfg();
  const ms = ctx.measurements ?? [];
  const checks = ctx.tasks.flatMap((t) => t.checklist);
  type Item = { key: string; icon: ReactNode; label: string; meta: string; tone?: 'critical' | 'high'; go: () => void };
  const catalog: Partial<Record<UiScreen, Item>> = {
    alerts: { key: 'alerts', icon: <AlertTriangle size={26} />, label: 'Alerts', meta: ctx.alarms.length ? `${ctx.alarms.length} open${crit ? ` · ${crit} critical` : ''}` : 'none', tone: crit ? 'critical' : active ? 'high' : undefined, go: () => nav.push({ name: 'alerts' }) },
    inspections: { key: 'insp', icon: <ClipboardCheck size={26} />, label: 'Inspections', meta: `${ctx.inspections.length} assigned`, go: () => nav.push({ name: 'inspections' }) },
    tasks: { key: 'tasks', icon: <Wrench size={26} />, label: 'Maintenance', meta: `${ctx.tasks.length} task${ctx.tasks.length === 1 ? '' : 's'}`, go: () => nav.push({ name: 'tasks' }) },
    map: { key: 'map', icon: <MapIcon size={26} />, label: 'Plant map', meta: 'route to next asset', go: () => nav.push({ name: 'map' }) },
    measurements: { key: 'meas', icon: <Gauge size={26} />, label: 'Live measurements', meta: `${ms.length} sensors`, tone: ms.some((m) => m.threshold === 'alarm') ? 'high' : undefined, go: () => nav.push({ name: 'measurements' }) },
    assets: { key: 'assets', icon: <Boxes size={26} />, label: 'Assets', meta: `${ctx.assets?.length ?? 0} on site`, go: () => nav.push({ name: 'assets' }) },
    sops: { key: 'sops', icon: <Library size={26} />, label: 'SOP library', meta: 'approved procedures', go: () => nav.push({ name: 'sops' }) },
    ai: { key: 'ai', icon: <Sparkles size={26} />, label: 'Ask Hydris AI', meta: 'procedures & answers', go: () => nav.push({ name: 'ai' }) },
    scan: { key: 'scan', icon: <ScanLine size={26} />, label: 'Audit scan', meta: 'paper → verified record', go: () => nav.push({ name: 'scan' }) },
    notifications: { key: 'notif', icon: <Bell size={26} />, label: 'Notifications', meta: 'updates for you', go: () => nav.push({ name: 'notifications' }) },
    status: { key: 'status', icon: <Cog size={26} />, label: 'Device & log out', meta: ctx.device.name, go: () => nav.push({ name: 'status' }) },
  };
  // Menu order and visibility come from the UI profile.
  const items = cfg.screens.filter((s) => s.id !== 'home' && screenPermitted(cfg, screenFor(s.id))).map((s) => catalog[s.id]).filter((x): x is Item => !!x);
  const widgets = cfg.widgets.filter((w) => w.visible).map((w) => w.id);
  const next = widgets.includes('next_inspection') && screenEnabled(cfg, 'inspections') ? ctx.inspections[0] : undefined;
  const cursor = useHud({ actions: [...(next ? [{ key: 'next', onSelect: () => nav.push({ name: 'inspection', id: next.id }) }] : []), ...items.map((i) => ({ key: i.key, onSelect: i.go }))] });
  const offset = next ? 1 : 0;
  const widgetNodes: Record<string, ReactNode> = {
    next_inspection: next && (
      <HudItem key="next" active={cursor === 0} tone="lime" onClick={() => nav.push({ name: 'inspection', id: next.id })}>
        <span className="grid h-[44px] w-[44px] flex-none place-items-center rounded-full bg-lime text-[#141714]"><ClipboardCheck size={24} /></span>
        <span className="min-w-0 flex-1"><span className="block truncate text-white">Next: {next.title}</span><span className="block text-[17px] text-white/55">{next.stepCount} steps · {next.status.replace('_', ' ')}</span></span>
        <ChevronRight />
      </HudItem>
    ),
    measurements_glance: screenEnabled(cfg, 'measurements') && ms.length > 0 && (
      <div key="glance" className="flex gap-5 px-2 text-[18px] text-white/60">
        {ms.slice(0, 3).map((m) => (
          <span key={m.id} className="min-w-0 truncate"><span className={m.threshold === 'normal' ? 'num text-white' : 'num text-[#ff9a5c]'}>{m.lastValue === null ? '—' : m.lastValue.toFixed(Math.min(2, m.decimals))}</span> {m.unit} <span className="text-white/45">{m.assetTag ?? m.tag}</span></span>
        ))}
      </div>
    ),
    task_progress: screenEnabled(cfg, 'tasks') && checks.length > 0 && (
      <div key="tp" className="flex items-center gap-3 px-2 text-[18px] text-white/60">
        <span className="flex-none">Checklists</span>
        <span className="h-[6px] flex-1 overflow-hidden rounded-full bg-white/10"><span className="block h-full rounded-full bg-lime" style={{ width: `${Math.round((checks.filter((c) => c.done).length / checks.length) * 100)}%` }} /></span>
        <span className="num flex-none">{checks.filter((c) => c.done).length}/{checks.length}</span>
      </div>
    ),
  };
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-[17px] uppercase tracking-[0.14em] text-white/55">{ctx.site?.name ?? ctx.organization.name}</div>
          <div className="text-[34px] tracking-[-0.03em]">{ctx.operator.name.split(' ')[0]}’s shift</div>
        </div>
        {widgets.includes('alarm_summary') && crit > 0 && <HudPill tone="critical">{crit} critical</HudPill>}
      </div>
      {widgets.filter((w) => w !== 'alarm_summary').map((w) => widgetNodes[w])}
      <div className="grid grid-cols-[minmax(0,1fr)] min-h-0 gap-2.5 overflow-y-auto pb-1 scrollbar-none">
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
      {rows.length ? <div className="grid grid-cols-[minmax(0,1fr)] gap-2.5 overflow-y-auto pb-2 scrollbar-none">{rows.map((r, i) => <HudItem key={r.id} active={cursor === i} onClick={() => onOpen(r)}>{render(r)}</HudItem>)}</div>
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
  const cfg = useCfg();
  const canAck = allowed(cfg, 'acknowledge_alarm');
  const canProc = canAssist(cfg);
  const [busy, setBusy] = useState(false);
  const ack = async () => {
    if (!a || !online || !canAck) return;
    setBusy(true);
    try { await data.acknowledge(a.id); await nav.reload(); nav.flash('Acknowledged. The equipment state is unchanged.'); }
    catch (e) { nav.flash(e instanceof Error ? e.message : 'Failed', 'critical'); }
    finally { setBusy(false); }
  };
  const actions = a ? [
    ...(a.state === 'active' && canAck ? [{ key: 'ack', onSelect: () => void ack(), disabled: !online || busy }] : []),
    ...(canProc ? [{ key: 'proc', onSelect: () => nav.push({ name: 'assist', q: a.title }) }] : []),
  ] : [];
  const ackShown = !!a && a.state === 'active' && canAck;
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
        {ackShown && <HudItem active={cursor === 0} tone="lime" disabled={!online || busy} onClick={() => void ack()}><Check size={24} /><span className="flex-1">{online ? 'Acknowledge' : 'Acknowledge (needs connection)'}</span><span className="text-[16px] text-white/50">does not change equipment</span></HudItem>}
        {a.state === 'active' && !canAck && <Blocked what="Acknowledging alarms" />}
        {canProc ? <HudItem active={cursor === (ackShown ? 1 : 0)} onClick={() => nav.push({ name: 'assist', q: a.title })}><BookOpen size={24} /><span>Open procedure</span></HudItem> : <Blocked what="Procedures" />}
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

  const cfg = useCfg();
  const canRecord = allowed(cfg, 'record_inspection');
  const canSubmit = allowed(cfg, 'submit_inspection');
  const step = insp?.steps[idx];
  const advance = () => { if (insp && idx < insp.steps.length - 1) setIdx(idx + 1); else setStage('review'); };
  const editCtl = useStepControl(step, (v) => void record(step!, v));
  // View-only walk-through when the profile does not permit recording.
  const stepCtl = canRecord ? editCtl : {
    actions: [{ key: 'next', onSelect: advance }], onKey: undefined,
    render: (cursor: number) => (
      <div className="mb-3 grid gap-2.5"><Blocked what="Recording steps" />
        <HudItem active={cursor === 0} onClick={advance}><ChevronRight size={24} /><span>Next step (view only)</span></HudItem></div>
    ),
  };
  const actions: HudControl['actions'] =
    stage === 'verify' ? [{ key: 'confirm', onSelect: () => setStage(insp?.safetyNotices.length ? 'safety' : 'step') }, ...(insp?.asset ? [{ key: 'asset', onSelect: () => nav.push({ name: 'asset', id: insp.asset!.id }) }] : [])]
      : stage === 'safety' ? [{ key: 'ack', onSelect: () => setStage('step') }]
        : stage === 'step' ? [...stepCtl.actions, { key: 'pause', onSelect: () => void pause() }]
          : stage === 'review' ? [{ key: 'submit', onSelect: () => void submit(), disabled: busy || !canSubmit }, { key: 'back', onSelect: () => { setStage('step'); setIdx(0); } }]
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
          {!canSubmit && <Blocked what="Submitting inspections" />}
          <HudItem active={cursor === 0} tone="lime" disabled={busy || !progress.complete || !canSubmit} onClick={() => { if (canSubmit) void submit(); }}><Check size={24} /><span>{!canSubmit ? 'Submit (not permitted)' : online ? 'Submit inspection' : 'Submit (needs connection)'}</span></HudItem>
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
  const canToggle = allowed(useCfg(), 'toggle_checklist');
  const toggle = async (itemId: string, done: boolean) => {
    if (!canToggle) { nav.flash('Checklist changes are not permitted by your profile', 'high'); return; }
    if (!online) { nav.flash('Checklist updates need a connection', 'high'); return; }
    try { await data.toggleChecklist(id, itemId, done); await nav.reload(); } catch (e) { nav.flash(e instanceof Error ? e.message : 'Failed', 'critical'); }
  };
  const cursor = useHud({ actions: (t?.checklist ?? []).map((c) => ({ key: c.id, onSelect: () => void toggle(c.id, !c.done) })) });
  if (!t) return <p className="text-[22px] text-white/60">Task no longer assigned.</p>;
  const done = t.checklist.filter((c) => c.done).length;
  const pct = t.checklist.length ? Math.round((done / t.checklist.length) * 100) : 0;
  return (
    <div className="flex h-full flex-col">
      <HudTitle eyebrow={`${t.assetTag ?? 'maintenance'} · ${t.priority}`}>{t.title}</HudTitle>
      <div className="mb-2 flex items-center gap-3 text-[17px] text-white/55">
        <span className="h-[6px] flex-1 overflow-hidden rounded-full bg-white/10"><span className="block h-full rounded-full bg-lime transition-[width]" style={{ width: `${pct}%` }} /></span>
        <span className="num">{done}/{t.checklist.length}</span>
        {t.checklist.length > 0 && done === t.checklist.length && <HudPill tone="ok"><Check size={16} />complete</HudPill>}
      </div>
      {canToggle ? <p className="mb-3 text-[17px] text-white/50">Records only — Hydris does not operate equipment.</p> : <div className="mb-3"><Blocked what="Ticking checklist items" /></div>}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-2.5 overflow-y-auto scrollbar-none">
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
  const cfg = useCfg();
  const canProc = canAssist(cfg);
  const cursor = useHud({ actions: a && canProc ? [{ key: 'assist', onSelect: () => nav.push({ name: 'assist', q: `${a.type} ${a.name}`, assetId: a.id }) }] : [] });
  if (err) return <Centered icon={<AlertTriangle size={40} />} title="Equipment unavailable" body={err} />;
  if (!a) return <Centered icon={<RefreshCw size={40} className="animate-spin" />} title="Loading" body="Fetching equipment context…" />;
  const sensorsShown = applyMeasurementProfile(cfg, a.sensors, a.type);
  const last = sensorsShown.map((s) => s.lastTs).filter(Boolean).sort().pop();
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between">
        <HudTitle eyebrow={`${a.tag} · ${a.type.replace('_', ' ')}`}>{a.name}</HudTitle>
        <HudPill tone={a.status === 'operational' ? 'ok' : a.status === 'down' ? 'critical' : 'medium'}>{a.status}</HudPill>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-4">
        {sensorsShown.length === 0 && <p className="col-span-2 text-[19px] text-white/55">No measurements for this equipment are shown on your profile.</p>}
        {sensorsShown.slice(0, 4).map((s) => (
          <HudMetric key={s.id} value={s.freshness === 'stale' || s.freshness === 'no_data' || s.lastValue === null ? '—' : s.lastValue.toFixed(s.unit === 'h' ? 0 : 2)} unit={s.unit}
            label={<>{s.name} · <span className={s.freshness === 'live' ? 'text-lime' : 'text-[#ff9a5c]'}>{FRESHNESS_LABELS[s.freshness]}</span>{s.lastSource === 'simulator' ? ' · synthetic' : ''}</>} />
        ))}
      </div>
      <div className="mt-3 text-[17px] text-white/50">{a.openAlarms} open alarm(s) · updated {last ? timeAgo(last) : 'never'}</div>
      <div className="mt-auto">{canProc ? <HudItem active={cursor === 0} onClick={() => nav.push({ name: 'assist', q: `${a.type} ${a.name}`, assetId: a.id })}><BookOpen size={24} /><span>Procedures for this equipment</span></HudItem> : <Blocked what="Procedures" />}</div>
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

function Status({ ctx, status, onLogout }: { ctx: GContext; status: StatusInfo; onLogout: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const cursor = useHud({ actions: confirm
    ? [{ key: 'yes', onSelect: onLogout }, { key: 'no', onSelect: () => setConfirm(false) }]
    : [{ key: 'logout', onSelect: () => setConfirm(true) }] });
  const pr = status.profile;
  const conn = !status.online ? 'Offline' : status.stream === 'live' ? 'Online · live stream' : 'Online · connecting stream';
  return (
    <div className="flex h-full flex-col">
      <HudTitle eyebrow="Device & session">{ctx.device.name}</HudTitle>
      <div className="mb-4 flex flex-wrap gap-2">
        <HudPill tone={status.online ? (status.stream === 'live' ? 'ok' : 'medium') : 'high'}>{status.online ? <Wifi size={17} /> : <WifiOff size={17} />}{conn}</HudPill>
        <HudPill tone={status.queued ? 'high' : 'line'}>{status.queued} queued</HudPill>
        {status.staleAt && <HudPill tone="high">cached {timeAgo(status.staleAt)}</HudPill>}
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-[20px]">
        <Kv k="Operator" v={ctx.operator.name} /><Kv k="Account" v={ctx.role === 'admin' ? 'Administrator' : ctx.role === 'operator' ? 'Field Operator' : ctx.role.replace(/_/g, ' ')} />
        <Kv k="Site" v={ctx.site?.name ?? '—'} /><Kv k="Session" v={status.demo ? 'Demo · client-side' : 'Active · device-bound'} />
        <Kv k="UI profile" v={pr ? `${pr.name}${pr.version ? ` · v${pr.version}` : ''}` : 'Built-in default'} /><Kv k="Applied via" v={pr?.source ?? 'default'} />
        <Kv k="Last sync" v={status.lastSync ? timeAgo(status.lastSync) : 'not yet'} /><Kv k="App version" v={`${APP_VERSION} · ${ctx.device.kind}`} />
      </dl>
      <div className="mt-auto grid gap-2">
        {confirm ? (
          <>
            <p className="text-[18px] text-white/70">Log out and unpair these glasses? You can pair them to another account straight away.</p>
            <div className="grid grid-cols-2 gap-3">
              <HudItem active={cursor === 0} tone="critical" onClick={onLogout}><span className="mx-auto">Yes, log out</span></HudItem>
              <HudItem active={cursor === 1} onClick={() => setConfirm(false)}><span className="mx-auto">Cancel</span></HudItem>
            </div>
          </>
        ) : (
          <HudItem active={cursor === 0} tone="critical" onClick={() => setConfirm(true)}><span className="mx-auto">Log out &amp; unpair</span></HudItem>
        )}
      </div>
    </div>
  );
}

function Notifications({ data, nav, online }: { data: GlassesData; nav: Nav; online: boolean }) {
  const [r, setR] = useState<{ notifications: GNotification[]; unread: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const canMark = allowed(useCfg(), 'mark_notifications_read');
  useEffect(() => {
    if (!online) return;
    data.notifications().then((x) => { setR(x); if (x.unread && canMark) void data.markNotificationsRead().catch(() => {}); }).catch((e) => setErr(e instanceof Error ? e.message : 'Unavailable'));
  }, [data, online, canMark]);
  const rows = r?.notifications ?? [];
  const cursor = useHud({ actions: rows.map((n) => ({ key: n.id, onSelect: () => { if (n.kind === 'alarm') nav.push({ name: 'alerts' }); else if (n.kind.startsWith('inspection')) nav.push({ name: 'inspections' }); else if (n.kind.startsWith('maintenance')) nav.push({ name: 'tasks' }); } })) });
  if (!online) return <Centered icon={<WifiOff size={40} />} title="Offline" body="Notifications load when the connection returns." />;
  if (err) return <Centered icon={<AlertTriangle size={40} />} title="Unavailable" body={err} />;
  if (!r) return <Centered icon={<RefreshCw size={40} className="animate-spin" />} title="Loading" body="Fetching notifications…" />;
  return (
    <div className="flex h-full flex-col">
      <HudTitle eyebrow={`${r.unread} unread${canMark ? '' : ' · read receipts off by profile'}`}>Notifications</HudTitle>
      {rows.length ? (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-2.5 overflow-y-auto pb-2 scrollbar-none">
          {rows.map((n, i) => (
            <HudItem key={n.id} active={cursor === i} tone={n.severity === 'critical' ? 'critical' : n.severity === 'warning' ? 'high' : undefined}>
              <CircleDot size={22} className={n.readAt ? 'text-white/30' : 'text-lime'} />
              <span className="min-w-0 flex-1"><span className="block truncate text-white">{n.title}</span><span className="block text-[17px] text-white/55">{n.body ? `${n.body} · ` : ''}{timeAgo(n.createdAt)}</span></span>
            </HudItem>
          ))}
        </div>
      ) : <p className="text-[22px] text-white/60">You are all caught up.</p>}
    </div>
  );
}

/** Hydris AI: grounded answers from approved procedures and live asset data — never generated instructions. */
function HydrisAI({ ctx, nav }: { ctx: GContext; nav: Nav }) {
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestions = [
    ...ctx.alarms.slice(0, 2).map((a) => `What do I do about: ${a.title}?`),
    ...(ctx.inspections[0]?.assetTag ? [`How do I inspect ${ctx.inspections[0].assetTag}?`] : []),
    'Pump vibration response',
    'Lockout / tagout steps',
    'Low dissolved oxygen',
  ].slice(0, 5);
  const ask = (text: string) => { if (text.trim()) nav.push({ name: 'assist', q: text.trim() }); };
  const talk = (question?: string) => window.dispatchEvent(new CustomEvent('hydris:voice-activate', { detail: { question } }));
  const live = ['What is the current pH?', 'Any open alarms?', 'What are my tasks?'];
  const cursor = useHud({ actions: [{ key: 'talk', onSelect: () => talk() }, ...live.map((l) => ({ key: l, onSelect: () => talk(l) })), { key: 'type', onSelect: () => inputRef.current?.focus() }, ...suggestions.map((s) => ({ key: s, onSelect: () => ask(s) }))] });
  const o = 1 + live.length;
  return (
    <div className="flex h-full flex-col">
      <HudTitle eyebrow="Hydris AI"><span className="flex items-center gap-3"><Sparkles size={30} className="text-lime" />Ask a question</span></HudTitle>
      <div className="mb-3 grid gap-2">
        <HudItem active={cursor === 0} tone="lime" onClick={() => talk()}><Mic size={24} /><span className="min-w-0 flex-1"><span className="block">Talk to Hydris</span><span className="block text-[16px] text-white/55">or just say “Hey Hydris” anytime</span></span></HudItem>
        <div className="grid grid-cols-3 gap-2">
          {live.map((l, i) => <HudItem key={l} active={cursor === i + 1} onClick={() => talk(l)}><span className="text-[16px] leading-tight">{l}</span></HudItem>)}
        </div>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); ask(q); }} className={`mb-3 rounded-[26px] border-2 px-5 py-3 ${cursor === o ? 'border-lime bg-lime/10' : 'border-white/10'}`}>
        <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type with a keyboard, or pick below…" aria-label="Ask Hydris AI"
          className="w-full bg-transparent text-[22px] text-white outline-none placeholder:text-white/40" />
      </form>
      <div className="grid grid-cols-[minmax(0,1fr)] min-h-0 flex-1 content-start gap-2 overflow-y-auto pb-1 scrollbar-none">
        {suggestions.map((s, i) => <HudItem key={s} active={cursor === i + o + 1} onClick={() => ask(s)}><span className="truncate">{s}</span></HudItem>)}
      </div>
      <p className="flex-none truncate pt-2 text-[15px] text-white/45">Live values from your account · procedures from approved SOPs</p>
    </div>
  );
}

/** Rydeon-style plant map: luminous route from the operator's last asset to the next target. */
function MapScreen({ ctx, nav }: { ctx: GContext; nav: Nav }) {
  const map = ctx.map;
  const pins = map?.assets ?? [];
  const byTag = (t: string | null | undefined) => pins.find((p) => p.tag === t)?.id ?? null;
  const targets = [
    ...ctx.inspections.map((i) => ({ id: byTag(i.assetTag), why: `Inspection · ${i.title}` })),
    ...ctx.alarms.map((a) => ({ id: byTag(a.assetTag), why: `Alarm · ${a.title}` })),
  ].filter((t): t is { id: string; why: string } => !!t.id).filter((t, i, arr) => arr.findIndex((x) => x.id === t.id) === i);
  const [ti, setTi] = useState(0);
  const [zoom, setZoom] = useState(2);
  const [all, setAll] = useState(true);
  const target = targets[ti] ?? null;
  const from = pins.find((p) => p.id !== target?.id)?.id ?? null;
  const tp = pins.find((p) => p.id === target?.id);
  useHud({
    actions: [{ key: 'open', onSelect: () => { if (target) nav.push({ name: 'asset', id: target.id }); } }],
    onKey: (k) => {
      if (k === 'left' || k === 'right') { if (targets.length) setTi((i) => (i + (k === 'right' ? 1 : targets.length - 1)) % targets.length); return true; }
      if (k === 'up') { setZoom((z) => Math.min(3, z + 0.5)); return true; }
      if (k === 'down') { setZoom((z) => (z <= 1 ? (setAll((v) => !v), 1) : z - 0.5)); return true; }
      return false;
    },
  });
  if (!map) return <Centered icon={<MapIcon size={40} />} title="No plant map" body="Asset positions for this site have not been configured in the console." />;
  const d = routeDistance(map, from, target?.id);
  return (
    <div className="relative -mx-4 h-full">
      <PlantMap map={map} fromId={from} toId={target?.id} zoom={zoom} showAll={all} size={436} />
      <div className="absolute right-0 top-3 grid gap-3" aria-hidden>
        <span className="grid h-[52px] w-[52px] place-items-center rounded-full bg-[#2a2c2e]/90 text-white"><Layers size={24} /></span>
        <span className="grid h-[52px] w-[52px] place-items-center rounded-full bg-[#2a2c2e]/90 text-white"><LocateFixed size={24} /></span>
      </div>
      <div className="absolute inset-x-6 bottom-1 flex items-center gap-3 rounded-full bg-white px-5 py-2.5 text-[18px] text-[#0b0c0d]">
        <span className="h-3 w-3 flex-none rounded-full bg-[#1954F1]" />
        <span className="min-w-0 flex-1 truncate font-medium">{tp ? `${tp.tag} · ${target!.why}` : 'No targets — all clear'}</span>
        {d !== null && <span className="num font-semibold">{d} m · {Math.max(1, Math.round(d / 72))} min</span>}
      </div>
      <p className="sr-only">Left and right switch target, up zooms in, down zooms out or toggles labels, select opens the equipment.</p>
    </div>
  );
}

// ---------------- expansion screens ----------------
const THRESH_COLOR = { normal: undefined, out_of_range: '#f7c96a', alarm: '#ff8a80' } as const;

/** Live measurements: every sensor the profile permits, with value, freshness, trend and threshold state. */
function Measurements({ ctx, nav, history, demo }: { ctx: GContext; nav: Nav; history: History; demo: boolean }) {
  const rows = ctx.measurements ?? [];
  const [, tick] = useState(0);
  useEffect(() => {
    // Keep values fresh while this screen is open (demo context already polls).
    const t = setInterval(() => { if (!demo) void nav.reload().catch(() => {}); tick((x) => x + 1); }, demo ? 2500 : 10_000);
    return () => clearInterval(t);
  }, [demo, nav]);
  const cursor = useHud({ actions: rows.map((m) => ({ key: m.id, onSelect: () => { if (m.assetId) nav.push({ name: 'asset', id: m.assetId }); } })) });
  return (
    <div className="flex h-full flex-col">
      <HudTitle eyebrow={`${rows.length} sensors · ${rows.filter((m) => m.threshold !== 'normal').length} attention`}>Live measurements</HudTitle>
      {rows.length ? (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-2.5 overflow-y-auto pb-2 scrollbar-none">
          {rows.map((m, i) => <MeasurementRow key={m.id} m={m} active={cursor === i} trend={trendOf(history.get(m.id))} onOpen={() => { if (m.assetId) nav.push({ name: 'asset', id: m.assetId }); }} />)}
        </div>
      ) : <p className="text-[22px] text-white/60">No measurements are configured for this site, or none are shown on your profile.</p>}
    </div>
  );
}

function MeasurementRow({ m, active, trend, onOpen }: { m: GMeasurement; active: boolean; trend: -1 | 0 | 1 | null; onOpen: () => void }) {
  const stale = m.freshness === 'stale' || m.freshness === 'no_data' || m.lastValue === null;
  const TrendIcon = trend === 1 ? TrendingUp : trend === -1 ? TrendingDown : Minus;
  return (
    <HudItem active={active} tone={m.threshold === 'alarm' ? 'critical' : m.threshold === 'out_of_range' ? 'high' : undefined} onClick={onOpen}>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-white">{m.label} · {m.assetTag ?? m.tag}</span>
        <span className="block text-[17px] text-white/55">
          <span className={m.freshness === 'live' ? 'text-lime' : 'text-[#ff9a5c]'}>{FRESHNESS_LABELS[m.freshness]}</span>
          {m.lastTs ? ` · ${timeAgo(m.lastTs)}` : ''}{m.threshold === 'alarm' ? ' · in alarm' : m.threshold === 'out_of_range' ? ' · outside typical range' : ''}{m.lastSource === 'simulator' ? ' · synthetic' : ''}
        </span>
      </span>
      {trend !== null && !stale && <TrendIcon size={22} className="flex-none text-white/60" aria-label={trend === 1 ? 'rising' : trend === -1 ? 'falling' : 'steady'} />}
      <span className="num flex-none text-right text-[30px] font-light" style={{ color: stale ? 'rgb(255 255 255 / 0.4)' : THRESH_COLOR[m.threshold] }}>
        {stale ? '—' : m.lastValue!.toFixed(Math.min(2, m.decimals))}<span className="ml-1 text-[17px] text-white/55">{m.unit}</span>
      </span>
    </HudItem>
  );
}

function trendOf(h: { v: number }[] | undefined): -1 | 0 | 1 | null {
  if (!h || h.length < 2) return null;
  const a = h[Math.max(0, h.length - 4)]!.v, b = h[h.length - 1]!.v;
  const d = b - a, eps = Math.max(Math.abs(a) * 0.01, 1e-6);
  return d > eps ? 1 : d < -eps ? -1 : 0;
}

function AssetsList({ ctx, nav }: { ctx: GContext; nav: Nav }) {
  return <ListScreen title="Assets" eyebrow={ctx.site?.name ?? 'site equipment'} rows={ctx.assets ?? []} empty="No equipment registered for this site." onOpen={(a) => nav.push({ name: 'asset', id: a.id })}
    render={(a) => (<>
      <Boxes size={24} className={a.openAlarms ? 'text-[#ff9a5c]' : 'text-lime'} />
      <span className="min-w-0 flex-1"><span className="block truncate text-white">{a.tag} · {a.name}</span><span className="block text-[17px] text-white/55">{a.type.replace(/_/g, ' ')} · {a.status}{a.openAlarms ? ` · ${a.openAlarms} alarm(s)` : ''}</span></span>
    </>)} />;
}

/** Load with offline fallback: StaleError carries the cached copy. */
function useCached<T>(load: () => Promise<T>, deps: unknown[]) {
  const [s, setS] = useState<{ v: T | null; err: string | null; staleAt: string | null; loading: boolean }>({ v: null, err: null, staleAt: null, loading: true });
  useEffect(() => {
    let live = true;
    load().then((v) => live && setS({ v, err: null, staleAt: null, loading: false }))
      .catch((e) => live && setS(e instanceof StaleError ? { v: e.value as T, err: null, staleAt: e.at, loading: false } : { v: null, err: e instanceof Error ? e.message : 'Unavailable', staleAt: null, loading: false }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return s;
}

function StaleNote({ at }: { at: string | null }) {
  return at ? <div className="mb-3"><HudPill tone="high"><WifiOff size={16} />Offline copy · saved {timeAgo(at)}</HudPill></div> : null;
}

function SopLibrary({ data, nav }: { data: GlassesData; nav: Nav }) {
  const s = useCached<GDocSummary[]>(() => data.documents(), [data]);
  const rows = s.v ?? [];
  const cursor = useHud({ actions: rows.map((d) => ({ key: d.id, onSelect: () => nav.push({ name: 'sop', id: d.id }) })) });
  if (s.loading) return <Centered icon={<RefreshCw size={40} className="animate-spin" />} title="Loading" body="Fetching approved procedures…" />;
  if (s.err) return <Centered icon={<AlertTriangle size={40} />} title="SOP library unavailable" body={s.err} />;
  return (
    <div className="flex h-full flex-col">
      <HudTitle eyebrow={`${rows.length} approved`}>SOP library</HudTitle>
      <StaleNote at={s.staleAt} />
      {rows.length ? (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-2.5 overflow-y-auto pb-2 scrollbar-none">
          {rows.map((d, i) => (
            <HudItem key={d.id} active={cursor === i} onClick={() => nav.push({ name: 'sop', id: d.id })}>
              <FileText size={24} className="text-lime" />
              <span className="min-w-0 flex-1"><span className="block truncate text-white">{d.title}</span><span className="block text-[17px] text-white/55">{d.kind.toUpperCase()} · v{d.version}</span></span>
            </HudItem>
          ))}
        </div>
      ) : <p className="text-[22px] text-white/60">No approved documents yet. Ask your supervisor.</p>}
    </div>
  );
}

/** Paged SOP reader: ↑ ↓ scroll through the document, which is cached for offline reading. */
function SopReader({ id, data }: { id: string; data: GlassesData }) {
  const s = useCached<GDoc>(() => data.document(id), [data, id]);
  const box = useRef<HTMLDivElement>(null);
  useHud({ actions: [], onKey: (k) => { if ((k === 'down' || k === 'up') && box.current) { box.current.scrollBy({ top: k === 'down' ? 180 : -180, behavior: 'smooth' }); return true; } return false; } });
  if (s.loading) return <Centered icon={<RefreshCw size={40} className="animate-spin" />} title="Opening" body="Loading the approved procedure…" />;
  if (s.err || !s.v) return <Centered icon={<AlertTriangle size={40} />} title="Document unavailable" body={s.err ?? 'Not available offline — open it once while online to keep a copy.'} />;
  const d = s.v;
  return (
    <div className="flex h-full flex-col">
      <div className="mb-1 text-[17px] uppercase tracking-[0.14em] text-white/55">{d.kind} · version {d.version}</div>
      <div className="mb-3 text-[28px] leading-tight tracking-[-0.02em]">{d.title}</div>
      <StaleNote at={s.staleAt} />
      <div ref={box} className="min-h-0 flex-1 overflow-y-auto whitespace-pre-line pb-4 text-[21px] leading-snug text-white/85 scrollbar-none">{d.body}</div>
      <p className="pt-1 text-[15px] text-white/45">↑ ↓ scroll · approved document — follow site permit-to-work rules</p>
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
