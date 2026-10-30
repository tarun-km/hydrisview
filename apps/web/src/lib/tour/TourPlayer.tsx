'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { estimateMs, type Tour, type TourManifest, type TourStep } from './types';

/**
 * One reusable guided-tour player: spotlight (dimmed backdrop with a cutout and a pulse ring),
 * an animated pointer that glides to the target, a caption card mirroring the narration, the
 * voice note, and controls (back, pause/resume, next, replay, mute, exit, progress).
 *
 * Audio: plays /tutorial/<tour>/<step>.mp3 and advances when it ends. If the file is missing or
 * autoplay is blocked it falls back to the browser's speech synthesis, and if that is unavailable
 * or muted, captions advance on a timer from the manifest duration (or a word-count estimate).
 *
 * Geometry comes from getBoundingClientRect, which already includes CSS transforms (the glasses
 * HUD scale), and is re-measured every animation frame so it follows scroll, resize and layout.
 */
export interface TourPlayerProps<Nav> {
  tour: Tour<Nav>;
  /** Move the host app to the step's screen/route. */
  navigate: (nav: Nav) => void | Promise<void>;
  onExit: () => void;
  /** z-index for the overlay (default 2147483000). */
  zIndex?: number;
}

type Rect = { x: number; y: number; w: number; h: number };
const PAD = 8;

function findTarget(sel: string | undefined): HTMLElement | null {
  if (!sel) return null;
  // Comma-separated selectors are fallbacks in priority order (not document order).
  for (const part of sel.split(/,(?![^[]*\])/)) {
    const hit = Array.from(document.querySelectorAll<HTMLElement>(part.trim())).find((el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; });
    if (hit) return hit;
  }
  return null;
}

function usePrefersReducedMotion() {
  const [r, setR] = useState(false);
  useEffect(() => {
    const m = window.matchMedia('(prefers-reduced-motion: reduce)');
    const f = () => setR(m.matches);
    f();
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, []);
  return r;
}

export function TourPlayer<Nav>({ tour, navigate, onExit, zIndex = 2147483000 }: TourPlayerProps<Nav>) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [rect, setRect] = useState<Rect | null>(null);
  const [vw, setVw] = useState({ w: 0, h: 0 });
  const [narrated, setNarrated] = useState(false); // voice for this step finished
  const [replayKey, setReplayKey] = useState(0);
  const [manifest, setManifest] = useState<TourManifest | null>(null);
  const reduced = usePrefersReducedMotion();
  const step: TourStep<Nav> = tour.steps[i]!;
  const last = i === tour.steps.length - 1;
  const audio = useRef<HTMLAudioElement | null>(null);
  const timer = useRef<{ id: ReturnType<typeof setTimeout> | null; due: number; remaining: number }>({ id: null, due: 0, remaining: 0 });
  const targetEl = useRef<HTMLElement | null>(null);

  useEffect(() => {
    fetch(`/tutorial/${tour.id}/manifest.json`).then((r) => (r.ok ? r.json() : null)).then(setManifest).catch(() => setManifest(null));
  }, [tour.id]);

  const next = useCallback(() => setI((x) => { if (x >= tour.steps.length - 1) { queueMicrotask(onExit); return x; } return x + 1; }), [tour.steps.length, onExit]);
  const back = useCallback(() => setI((x) => Math.max(0, x - 1)), []);

  // Navigate the host app when the step changes.
  useEffect(() => { if (step.nav !== undefined) void navigate(step.nav); }, [step, navigate]);

  // Track the target every frame (follows scroll, resize, transitions and late renders).
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      setVw((v) => (v.w === window.innerWidth && v.h === window.innerHeight ? v : { w: window.innerWidth, h: window.innerHeight }));
      const el = findTarget(step.target);
      if (el && el !== targetEl.current) {
        targetEl.current = el;
        // Bring small targets into view; never scroll for large panels (that would shift the host layout).
        const b = el.getBoundingClientRect();
        if (b.height < window.innerHeight * 0.5 && (b.top < 0 || b.bottom > window.innerHeight)) el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
      }
      if (!el) targetEl.current = null;
      const r = el?.getBoundingClientRect();
      setRect((cur) => {
        if (!r) return cur === null ? cur : null;
        // Clip to the viewport so the cutout and pointer stay on screen.
        const x0 = Math.max(4, r.left - PAD), y0 = Math.max(4, r.top - PAD);
        const x1 = Math.min(window.innerWidth - 4, r.right + PAD), y1 = Math.min(window.innerHeight - 4, r.bottom + PAD);
        const n = { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
        return cur && Math.abs(cur.x - n.x) < 0.5 && Math.abs(cur.y - n.y) < 0.5 && Math.abs(cur.w - n.w) < 0.5 && Math.abs(cur.h - n.h) < 0.5 ? cur : n;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); targetEl.current = null; };
  }, [step.target, reduced]);

  // Voice: audio file → speech synthesis → timer.
  const clearTimer = () => { if (timer.current.id) clearTimeout(timer.current.id); timer.current.id = null; };
  const startTimer = useCallback((ms: number) => {
    clearTimer();
    timer.current.remaining = ms;
    timer.current.due = Date.now() + ms;
    timer.current.id = setTimeout(() => setNarrated(true), ms);
  }, []);

  useEffect(() => {
    setNarrated(false);
    clearTimer();
    window.speechSynthesis?.cancel();
    const durationMs = manifest?.steps[step.id]?.durationMs ?? estimateMs(step.text);
    const a = audio.current ?? (audio.current = new Audio());
    a.onended = null; a.onerror = null;
    let cancelled = false;
    const speakFallback = () => {
      if (cancelled) return;
      const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
      if (!muted && synth && typeof SpeechSynthesisUtterance !== 'undefined') {
        const u = new SpeechSynthesisUtterance(step.text);
        u.lang = 'en-IN'; u.rate = 1;
        u.onend = () => { if (!cancelled) setNarrated(true); };
        synth.speak(u);
        startTimer(estimateMs(step.text) + 4000); // safety net if onend never fires
      } else startTimer(durationMs);
    };
    a.src = step.audio;
    a.muted = muted;
    a.currentTime = 0;
    a.onended = () => { if (!cancelled) { clearTimer(); setNarrated(true); } };
    a.onerror = () => speakFallback();
    if (muted) startTimer(durationMs);
    else {
      a.play().then(() => startTimer(durationMs + 6000)).catch((e: unknown) => {
        // Autoplay blocked or decode failure: speak or time it.
        if (e instanceof DOMException && e.name === 'AbortError') return;
        speakFallback();
      });
    }
    return () => { cancelled = true; a.pause(); clearTimer(); window.speechSynthesis?.cancel(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, replayKey, manifest]);

  useEffect(() => { if (audio.current) audio.current.muted = muted; if (muted) window.speechSynthesis?.cancel(); }, [muted]);

  // Pause / resume.
  useEffect(() => {
    const a = audio.current;
    if (paused) {
      a?.pause();
      window.speechSynthesis?.pause();
      if (timer.current.id) { timer.current.remaining = Math.max(0, timer.current.due - Date.now()); clearTimer(); timer.current.id = null; timer.current.due = -1; }
    } else {
      if (a && a.src && !a.ended && a.currentTime > 0) void a.play().catch(() => {});
      window.speechSynthesis?.resume();
      if (timer.current.due === -1) startTimer(timer.current.remaining);
    }
  }, [paused, startTimer]);

  // Auto-advance after narration (non-interactive steps).
  useEffect(() => {
    // Interactive steps wait for the tap, unless the target is not on screen (then they behave like normal steps).
    if (!narrated || paused || (step.interactive && findTarget(step.target))) return;
    const t = setTimeout(next, 700);
    return () => clearTimeout(t);
  }, [narrated, paused, step.interactive, next]);

  // Interactive: wait for a tap on the highlighted element.
  useEffect(() => {
    if (!step.interactive) return;
    const onClick = (e: MouseEvent) => {
      const el = targetEl.current;
      if (el && e.target instanceof Node && el.contains(e.target)) setTimeout(next, 350);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [step.interactive, next]);

  // Keyboard: arrows, space, Esc. Capture phase so the host app (HUD input) does not also react.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
      if (k === 'ArrowRight') next();
      else if (k === 'ArrowLeft') back();
      else if (k === ' ' || k === 'Spacebar') setPaused((p) => !p);
      else if (k === 'Escape') onExit();
      else if (k === 'Enter' && !(e.target instanceof HTMLButtonElement)) next();
      else return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [next, back, onExit]);

  useEffect(() => () => { audio.current?.pause(); window.speechSynthesis?.cancel(); }, []);

  const [mounted, setMounted] = useState(false);
  useLayoutEffect(() => setMounted(true), []);
  if (!mounted || vw.w === 0) return null;

  const W = vw.w, H = vw.h;
  const r = rect && rect.x < W && rect.y < H && rect.x + rect.w > 0 && rect.y + rect.h > 0 ? rect : null;
  const ease = reduced ? 'none' : 'all 650ms cubic-bezier(.22,.8,.24,1)';
  // Caption goes on the side with more free space; large panels get it at the bottom.
  const placement = step.placement && step.placement !== 'auto' ? step.placement : !r ? 'center' : r.h > H * 0.6 ? 'bottom' : r.y + r.h / 2 > H / 2 ? 'top' : 'bottom';
  const cardW = Math.min(440, W - 24);
  const cardStyle: React.CSSProperties = placement === 'center'
    ? { left: (W - cardW) / 2, top: '50%', transform: 'translateY(-50%)' }
    : placement === 'top' ? { left: (W - cardW) / 2, top: 'max(12px, env(safe-area-inset-top))' } : { left: (W - cardW) / 2, bottom: 'max(12px, env(safe-area-inset-bottom))' };
  // Pointer rests at the lower-right part of the target, inside it.
  const px = r ? r.x + Math.min(r.w * 0.62, r.w - 18) : W / 2;
  const py = r ? r.y + Math.min(r.h * 0.62, r.h - 14) : H / 2;
  const blockAll = !step.interactive || !r;
  const waiting = !!step.interactive && narrated;

  const words = step.text.split(/\s+/);
  const spokenS = (manifest?.steps[step.id]?.durationMs ?? estimateMs(step.text)) / 1000;
  const btn = 'grid h-9 min-w-9 place-items-center rounded-full px-2.5 text-[13px] font-medium text-white/85 hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1954f1] disabled:opacity-35';
  return createPortal(
    <div className="hydris-tour" style={{ position: 'fixed', inset: 0, zIndex, pointerEvents: 'none', fontFamily: 'var(--font-outfit), system-ui, sans-serif' }} data-tour-step={step.id} data-tour-active="" role="dialog" aria-modal="true" aria-label={`${tour.name}: step ${i + 1} of ${tour.steps.length}`}>
      <style>{`@keyframes hydrisTourPulse{0%{opacity:.85;transform:scale(1)}70%{opacity:0;transform:scale(1.18)}100%{opacity:0;transform:scale(1.18)}}
      @keyframes hydrisTourIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
      @media (prefers-reduced-motion: reduce){.hydris-tour *{animation:none!important;transition:none!important}}`}</style>
      {/* Backdrop with a cutout */}
      <svg width={W} height={H} style={{ position: 'absolute', inset: 0 }} aria-hidden>
        <defs>
          <mask id="hydris-tour-mask">
            <rect width={W} height={H} fill="white" />
            {r && <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={18} fill="black" style={{ transition: ease }} />}
          </mask>
        </defs>
        <rect width={W} height={H} fill="rgba(3,6,12,0.68)" mask="url(#hydris-tour-mask)" />
      </svg>
      {/* Click blockers: everything when not interactive; around the cutout when it is. */}
      {blockAll ? <div style={{ position: 'absolute', inset: 0, pointerEvents: 'auto' }} />
        : <>
          <div style={{ position: 'absolute', left: 0, top: 0, width: W, height: Math.max(0, r.y), pointerEvents: 'auto' }} />
          <div style={{ position: 'absolute', left: 0, top: r.y + r.h, width: W, height: Math.max(0, H - r.y - r.h), pointerEvents: 'auto' }} />
          <div style={{ position: 'absolute', left: 0, top: r.y, width: Math.max(0, r.x), height: r.h, pointerEvents: 'auto' }} />
          <div style={{ position: 'absolute', left: r.x + r.w, top: r.y, width: Math.max(0, W - r.x - r.w), height: r.h, pointerEvents: 'auto' }} />
        </>}
      {r && <>
        <div aria-hidden data-tour-spotlight style={{ position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h, borderRadius: 18, border: '2px solid #7aa2ff', boxShadow: '0 0 0 4px rgba(25,84,241,0.22), 0 0 36px rgba(80,130,255,0.55), inset 0 0 24px rgba(122,162,255,0.25)', transition: ease }} />
        {!reduced && <div aria-hidden style={{ position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h, borderRadius: 18, border: '3px solid rgba(25,84,241,0.75)', animation: 'hydrisTourPulse 1.8s ease-out infinite', transition: ease }} />}
      </>}
      {/* Pointer */}
      <div aria-hidden data-tour-pointer style={{ position: 'absolute', left: 0, top: 0, transform: `translate(${px}px, ${py}px)`, transition: reduced ? 'none' : 'transform 900ms cubic-bezier(.22,.8,.24,1), opacity 300ms', opacity: r ? 1 : 0, filter: 'drop-shadow(0 4px 10px rgba(0,0,0,.55))' }}>
        <svg width="34" height="38" viewBox="0 0 34 38"><path d="M3 2 L3 30 L10.5 23.5 L15.5 35 L21 32.6 L16 21.5 L26 21.5 Z" fill="#fff" stroke="#0b0f17" strokeWidth="2.2" strokeLinejoin="round" /></svg>
        {step.interactive && !reduced && <span style={{ position: 'absolute', left: -9, top: -9, width: 22, height: 22, borderRadius: 999, border: '2px solid #1954f1', animation: 'hydrisTourPulse 1.2s ease-out infinite' }} />}
      </div>
      {/* Caption + controls */}
      <div key={step.id} style={{ position: 'absolute', width: cardW, pointerEvents: 'auto', ...cardStyle }}>
        <motion.div initial={reduced ? false : { opacity: 0, y: 18, scale: 0.96, filter: 'blur(10px)' }} animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }} transition={{ type: 'spring', stiffness: 260, damping: 26 }}
          className="relative overflow-hidden rounded-[24px] p-4 text-white shadow-[0_24px_70px_rgba(0,0,0,0.6),0_0_40px_rgba(60,110,255,0.18)] backdrop-blur-xl"
          style={{ background: 'linear-gradient(155deg, rgba(40,58,98,0.92), rgba(10,15,28,0.94) 55%, rgba(18,34,70,0.92))', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.22), inset 0 0 0 1px rgba(160,190,255,0.22), 0 24px 70px rgba(0,0,0,0.6), 0 0 40px rgba(60,110,255,0.2)' }} data-tour-caption>
          {!reduced && <motion.span aria-hidden className="pointer-events-none absolute -inset-x-10 -top-24 h-40 rounded-full blur-3xl" style={{ background: 'radial-gradient(circle, rgba(122,162,255,0.35), transparent 70%)' }} animate={{ x: ['-20%', '20%'] }} transition={{ duration: 6, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' }} />}
          <div className="relative mb-1.5 flex items-center gap-2 text-[11.5px] uppercase tracking-[0.16em] text-[#a8c2ff]">
            <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[#1954f1] px-1.5 text-[10.5px] font-semibold tracking-normal text-white shadow-[0_0_12px_rgba(80,130,255,0.8)]">{i + 1}</span>
            <span>{step.title}</span>
            <span className="ml-auto tracking-normal text-white/50" data-tour-progress>{i + 1} / {tour.steps.length}</span>
          </div>
          <p className="relative text-[16px] leading-snug text-white/95" aria-live="polite">
            <span className="sr-only">{step.text}</span>
            <span aria-hidden>{words.map((w, k) => (
              <motion.span key={`${replayKey}-${k}`} initial={reduced || paused ? false : { opacity: 0.18, filter: 'blur(3px)' }} animate={{ opacity: 1, filter: 'blur(0px)' }}
                transition={{ duration: 0.35, delay: reduced ? 0 : (k / words.length) * spokenS }}>{w} </motion.span>
            ))}</span>
          </p>
          {step.interactive && (
            <p className={`mt-2 text-[13px] ${waiting ? 'text-[#8aa8ff]' : 'text-white/55'}`}>{waiting ? 'Waiting for your tap on the highlighted item…' : 'Tap the highlighted item when ready.'}</p>
          )}
          <div className="relative mt-3 flex gap-1" aria-hidden>
            {tour.steps.map((_, k) => (
              <span key={k} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/[0.12]">
                {k < i && <span className="block h-full bg-[#7aa2ff]" />}
                {k === i && <motion.span className="block h-full bg-gradient-to-r from-[#7aa2ff] to-[#a8ecff] shadow-[0_0_8px_rgba(168,236,255,0.9)]" initial={reduced ? false : { width: '0%' }} animate={{ width: '100%' }} key={replayKey} transition={{ duration: reduced ? 0 : spokenS, ease: 'linear' }} />}
              </span>
            ))}
          </div>
          <div className="relative mt-2.5 flex items-center gap-1">
            <button type="button" className={btn} onClick={back} disabled={i === 0} aria-label="Previous step">‹ Back</button>
            <button type="button" className={btn} onClick={() => setPaused((p) => !p)} aria-label={paused ? 'Resume' : 'Pause'} data-tour-control="pause">{paused ? '▶' : '❚❚'}</button>
            <button type="button" className={btn} onClick={() => { setPaused(false); setReplayKey((k) => k + 1); }} aria-label="Replay step">↻</button>
            <button type="button" className={btn} onClick={() => setMuted((m) => !m)} aria-label={muted ? 'Unmute' : 'Mute'} aria-pressed={muted}>{muted ? '🔇' : '🔊'}</button>
            <button type="button" className={btn} onClick={onExit} aria-label="Exit tour">Exit</button>
            <button type="button" onClick={next} data-tour-control="next"
              className="ml-auto h-9 rounded-full bg-[#1954f1] px-4 text-[13.5px] font-semibold text-white hover:brightness-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
              {step.interactive ? 'Skip ›' : last ? 'Finish' : 'Next ›'}
            </button>
          </div>
        </motion.div>
      </div>
    </div>,
    document.body,
  );
}

/** "Start the guided tour?" confirm dialog. */
export function TourConfirm({ minutes, onStart, onCancel, autoStartSeconds, zIndex = 2147483000 }: { minutes: number; onStart: () => void; onCancel: () => void; /** Start on its own after this many seconds (glasses: input may not reach the button). */ autoStartSeconds?: number; zIndex?: number }) {
  const startRef = useRef<HTMLButtonElement>(null);
  const [left, setLeft] = useState(autoStartSeconds ?? 0);
  const started = useRef(false);
  const go = useCallback(() => { if (!started.current) { started.current = true; onStart(); } }, [onStart]);
  useEffect(() => {
    if (!autoStartSeconds) return;
    const t = window.setInterval(() => setLeft((n) => n - 1), 1000);
    return () => window.clearInterval(t);
  }, [autoStartSeconds]);
  useEffect(() => { if (autoStartSeconds && left <= 0) go(); }, [autoStartSeconds, left, go]);
  useEffect(() => {
    startRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopImmediatePropagation(); onCancel(); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopImmediatePropagation(); go(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel, go]);
  const [mounted, setMounted] = useState(false);
  useLayoutEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex, fontFamily: 'var(--font-outfit), system-ui, sans-serif' }} className="grid place-items-center bg-[rgba(3,6,12,0.72)] p-4" role="alertdialog" aria-modal="true" aria-labelledby="tour-confirm-title" data-tour-confirm>
      <motion.div initial={{ opacity: 0, y: 16, scale: 0.95, filter: 'blur(10px)' }} animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }} transition={{ type: 'spring', stiffness: 260, damping: 26 }} className="w-full max-w-[400px] rounded-[26px] p-5 text-white backdrop-blur-xl" style={{ background: 'linear-gradient(155deg, rgba(40,58,98,0.94), rgba(10,15,28,0.96) 55%, rgba(18,34,70,0.94))', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.22), inset 0 0 0 1px rgba(160,190,255,0.22), 0 24px 70px rgba(0,0,0,0.6), 0 0 40px rgba(60,110,255,0.22)' }}>
        <div id="tour-confirm-title" className="text-[20px] font-medium">Start the guided tour?</div>
        <p className="mt-2 text-[15px] leading-snug text-white/75">About {minutes} minutes, with voice. Sound on recommended.</p>
        {autoStartSeconds ? (
          <div className="mt-4" aria-live="polite">
            <div className="text-[15px] text-white">Starting in <span className="font-semibold tabular-nums">{Math.max(left, 0)}</span> s</div>
            <div className="mt-2 h-[6px] overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-[#1954f1] to-[#a8ecff] shadow-[0_0_10px_rgba(168,236,255,0.7)] transition-[width] duration-1000 ease-linear" style={{ width: `${(1 - Math.max(left, 0) / autoStartSeconds) * 100}%` }} /></div>
          </div>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="h-10 rounded-full px-4 text-[14px] text-white/80 hover:bg-white/10">Not now</button>
          <button ref={startRef} type="button" onClick={go} className="h-10 rounded-full bg-[#1954f1] px-5 text-[14px] font-semibold text-white">{autoStartSeconds ? 'Start now' : 'Start'}</button>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}

/** Estimated tour length in whole minutes (at least 1). */
export function tourMinutes(tour: Tour<unknown>): number {
  const ms = tour.steps.reduce((s, x) => s + estimateMs(x.text) + 900, 0);
  return Math.max(1, Math.round(ms / 60000));
}
