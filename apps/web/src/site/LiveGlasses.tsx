'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, ChevronDown, ChevronUp, CircleDot, CornerUpLeft, Loader2, RotateCcw } from 'lucide-react';
import { SCENARIOS, SCENARIO_KEYS, type ScenarioKey } from '@hydris/domain';

export type GlassesKey = 'up' | 'down' | 'select' | 'back';
const KEYS: { key: GlassesKey; label: string; icon: typeof ChevronUp }[] = [
  { key: 'up', label: 'Up', icon: ChevronUp },
  { key: 'down', label: 'Down', icon: ChevronDown },
  { key: 'select', label: 'Select', icon: CircleDot },
  { key: 'back', label: 'Back', icon: CornerUpLeft },
];

export function SyntheticNotice({ className }: { className?: string }) {
  return (
    <p className={clsx('inline-flex flex-wrap items-center gap-2 rounded-full border border-dashed border-lime/60 px-4 py-2 text-[13px] text-lime', className)}>
      <span className="dot pulse-dot bg-lime" aria-hidden />
      Synthetic demonstration data — isolated from customer data
    </p>
  );
}

/**
 * The real glasses viewport (/glasses?demo=1) in a scaled 600×600 iframe. On-screen controls
 * post `hydris:input` messages to the frame; keyboard input works when the frame has focus.
 */
function useGlassesFrame(scenario: ScenarioKey) {
  const boxRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [scale, setScale] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [lastKey, setLastKey] = useState<string>('');

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const update = () => setScale(el.clientWidth / 600);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = boxRef.current;
    if (!el || !('IntersectionObserver' in window)) return setInView(true);
    const io = new IntersectionObserver(([e]) => { if (e?.isIntersecting) { setInView(true); io.disconnect(); } }, { rootMargin: '300px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // The frame stays `inert` until the visitor engages with it, so the viewport's own focus
  // handling cannot steal focus from this page.
  const [active, setActive] = useState(false);
  const patched = useRef(false);
  useEffect(() => {
    setLoaded(false);
    setActive(false);
    patched.current = false;
  }, [scenario, nonce]);

  // The viewport keeps its highlighted item visible with scrollIntoView(), which also scrolls
  // every ancestor document — i.e. this page. Once the frame has loaded we confine that call to
  // the frame's own scroll containers; until then, undo page scrolls the visitor did not cause.
  useEffect(() => {
    if (!inView) return;
    let y = window.scrollY;
    let intentAt = 0;
    const intent = () => { intentAt = performance.now(); };
    const onScroll = () => {
      if (patched.current || performance.now() - intentAt < 1200) { y = window.scrollY; return; }
      if (Math.abs(window.scrollY - y) > 1) window.scrollTo(0, y);
    };
    const evs = ['wheel', 'touchstart', 'touchmove', 'pointerdown', 'keydown'] as const;
    evs.forEach((e) => window.addEventListener(e, intent, { passive: true, capture: true }));
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      evs.forEach((e) => window.removeEventListener(e, intent, { capture: true }));
      window.removeEventListener('scroll', onScroll);
    };
  }, [inView, scenario, nonce]);

  const onFrameLoad = useCallback(() => {
    setLoaded(true);
    confineScrollIntoView(frameRef.current);
    patched.current = true;
  }, []);

  const activate = useCallback(() => {
    setActive(true);
    requestAnimationFrame(() => {
      frameRef.current?.focus();
      frameRef.current?.contentWindow?.focus();
    });
  }, []);

  const send = useCallback((key: GlassesKey) => {
    frameRef.current?.contentWindow?.postMessage({ type: 'hydris:input', key }, window.location.origin);
    setLastKey(`${key[0]!.toUpperCase()}${key.slice(1)} sent to the glasses`);
  }, []);

  return { boxRef, frameRef, scale, loaded, onFrameLoad, send, lastKey, restart: () => setNonce((n) => n + 1), nonce, active, activate, inView };
}

/** Replace scrollIntoView inside the (same-origin) frame with a version that never scrolls the host page. */
function confineScrollIntoView(frame: HTMLIFrameElement | null) {
  try {
    const w = frame?.contentWindow as (Window & typeof globalThis & { __hydrisConfined?: boolean }) | null | undefined;
    if (!w || w.__hydrisConfined) return;
    w.Element.prototype.scrollIntoView = function confined(this: Element) {
      const r = this.getBoundingClientRect();
      for (let p = this.parentElement; p; p = p.parentElement) {
        const oy = w.getComputedStyle(p).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) {
          const pr = p.getBoundingClientRect();
          if (r.top < pr.top) p.scrollTop -= pr.top - r.top;
          else if (r.bottom > pr.bottom) p.scrollTop += r.bottom - pr.bottom;
          return;
        }
      }
      if (r.top < 0) w.scrollBy(0, r.top);
      else if (r.bottom > w.innerHeight) w.scrollBy(0, r.bottom - w.innerHeight);
    };
    w.__hydrisConfined = true;
  } catch {
    /* cross-origin or unavailable: the scroll guard above still applies */
  }
}

function Viewport({ scenario, f, title, eager }: { scenario: ScenarioKey; f: ReturnType<typeof useGlassesFrame>; title: string; eager?: boolean }) {
  return (
    <div ref={f.boxRef} className="device-screen aspect-square w-full rounded-[22px] sm:rounded-[26px]">
      {f.scale !== null && (eager || f.inView) && (
        <iframe
          key={`${scenario}-${f.nonce}`}
          ref={f.frameRef}
          src={`/glasses?demo=1&scenario=${scenario}`}
          title={title}
          width={600}
          height={600}
          inert={!f.active}
          tabIndex={f.active ? 0 : -1}
          onLoad={f.onFrameLoad}
          className="absolute left-0 top-0 border-0"
          style={{ width: 600, height: 600, transform: `scale(${f.scale})`, transformOrigin: '0 0' }}
        />
      )}
      {!f.loaded && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-[13px] text-muted" aria-hidden>
          <span className="inline-flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> Starting glasses viewport…</span>
        </div>
      )}
      {f.loaded && !f.active && (
        <button type="button" onClick={f.activate}
          className="group absolute inset-0 flex items-end justify-center rounded-[inherit] pb-4 outline-offset-[-4px]">
          <span className="rounded-full border border-line-2 bg-black/75 px-3.5 py-1.5 text-[12.5px] text-text-2 opacity-80 backdrop-blur transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
            Click to use the keyboard in the viewport
          </span>
        </button>
      )}
    </div>
  );
}

function Controls({ f, size = 'md', className }: { f: ReturnType<typeof useGlassesFrame>; size?: 'md' | 'lg'; className?: string }) {
  return (
    <div className={clsx('flex flex-wrap items-center gap-2', className)}>
      <div role="group" aria-label="Glasses controls" className="inline-flex items-center gap-1.5 rounded-full border border-line-2 bg-surface/90 p-1.5 backdrop-blur">
        {KEYS.map(({ key, label, icon: Icon }) => (
          <button key={key} type="button" onClick={() => f.send(key)} aria-label={`${label}`} title={label}
            className={clsx('icon-btn', size === 'lg' ? 'icon-btn-lg' : '', key === 'select' ? 'icon-btn-lime' : 'icon-btn-light')}>
            <Icon size={size === 'lg' ? 22 : 19} strokeWidth={2} aria-hidden />
          </button>
        ))}
      </div>
      <span className="sr-only" aria-live="polite">{f.lastKey}</span>
    </div>
  );
}

/** Compact live preview used in the homepage hero. */
export function HeroGlassesPreview({ scenario = 'pump_vibration' as ScenarioKey }: { scenario?: ScenarioKey }) {
  const f = useGlassesFrame(scenario);
  return (
    <div className="relative">
      <div className="device-bezel rounded-[30px] p-2.5 sm:p-3">
        <Viewport scenario={scenario} f={f} eager title={`Live Hydris glasses viewport — ${SCENARIOS[scenario].title} (synthetic demonstration)`} />
      </div>
      <Controls f={f} className="absolute -bottom-7 left-1/2 -translate-x-1/2" />
    </div>
  );
}

/** Scenario picker + device frame + controls. `full` is the /demo page layout. */
export function DemoStudio({ variant = 'full', initial = 'normal_operations' }: { variant?: 'full' | 'compact'; initial?: ScenarioKey }) {
  const [scenario, setScenario] = useState<ScenarioKey>(initial);
  const f = useGlassesFrame(scenario);
  const def = SCENARIOS[scenario];
  const full = variant === 'full';

  const picker = (
    <div role="group" aria-label="Choose a scenario" className={clsx(full ? 'grid gap-2' : 'flex gap-2 overflow-x-auto pb-2 scrollbar-none')}>
      {SCENARIO_KEYS.map((k, i) => {
        const on = k === scenario;
        return full ? (
          <button key={k} type="button" aria-pressed={on} onClick={() => setScenario(k)}
            className={clsx('group w-full rounded-[20px] border px-4 py-3.5 text-left transition-colors', on ? 'border-transparent bg-lime text-lime-ink' : 'border-line bg-surface hover:border-line-2 hover:bg-surface-2')}>
            <span className="flex items-baseline justify-between gap-3">
              <span className="text-[15.5px] font-medium tracking-[-0.01em]">{SCENARIOS[k].title}</span>
              <span className={clsx('num text-[12px]', on ? 'text-lime-ink/70' : 'text-muted')}>{String(i + 1).padStart(2, '0')}</span>
            </span>
            <span className={clsx('mt-1 block text-[13.5px] leading-snug', on ? 'text-lime-ink/75' : 'text-text-2')}>{SCENARIOS[k].summary}</span>
          </button>
        ) : (
          <button key={k} type="button" aria-pressed={on} onClick={() => setScenario(k)}
            className={clsx('btn btn-sm flex-none', on ? 'btn-primary' : 'btn-secondary')}>
            {SCENARIOS[k].title}
          </button>
        );
      })}
    </div>
  );

  const frame = (
    <div className="relative mx-auto w-full max-w-[640px]">
      <div className="device-bezel rounded-[34px] p-3 sm:p-4">
        <div className="mb-3 flex items-center justify-between px-1 text-[12.5px] text-muted">
          <span className="inline-flex items-center gap-2"><span className="dot bg-ok pulse-dot" aria-hidden /> Glasses viewport · 600 × 600</span>
          <button type="button" onClick={f.restart} className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 hover:text-text">
            <RotateCcw size={13} aria-hidden /> Restart
          </button>
        </div>
        <Viewport scenario={scenario} f={f} eager={full} title={`Hydris glasses viewport running the “${def.title}” scenario with synthetic data. Focus it to use arrow keys, Enter and Escape.`} />
      </div>
    </div>
  );

  const controls = (
    <div className="flex flex-col items-center gap-3">
      <Controls f={f} size={full ? 'lg' : 'md'} />
      <p className="text-center text-[13px] text-muted">
        Or click the display and use <Kbd>↑</Kbd> <Kbd>↓</Kbd> <Kbd>Enter</Kbd> <Kbd>Esc</Kbd>
      </p>
    </div>
  );

  if (!full)
    return (
      <div className="grid gap-10 lg:grid-cols-12 lg:items-center">
        <div className="lg:col-span-7">
          {frame}
          <div className="mt-6">{controls}</div>
        </div>
        <div className="min-w-0 lg:col-span-5">
          <SyntheticNotice />
          <h3 className="t-sub mt-6">{def.title}</h3>
          <p className="mt-3 text-[15.5px] leading-relaxed text-text-2">{def.summary}</p>
          <ul className="mt-5 grid gap-2">
            {def.expected.map((e) => (
              <li key={e} className="flex gap-3 text-[14.5px] text-text-2"><span className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-lime" aria-hidden />{e}</li>
            ))}
          </ul>
          <div className="mt-8">{picker}</div>
          <Link href={`/demo?scenario=${scenario}`} className="btn btn-light mt-6">Open the full demo <ArrowUpRight size={16} aria-hidden /></Link>
        </div>
      </div>
    );

  return (
    <div className="site-grid gap-y-10">
      <div className="col-span-12 lg:col-span-4 xl:col-span-3">
        <h2 className="t-eyebrow mb-4">Scenarios</h2>
        {picker}
      </div>
      <div className="col-span-12 lg:col-span-8 xl:col-span-6">
        {frame}
        <div className="mt-6">{controls}</div>
      </div>
      <aside className="col-span-12 xl:col-span-3" aria-label="Scenario details">
        <div className="card xl:sticky xl:top-28">
          <span className="chip chip-synthetic">Synthetic</span>
          <h2 className="t-section mt-4">{def.title}</h2>
          <p className="mt-2 text-[14.5px] leading-relaxed text-text-2">{def.summary}</p>
          <h3 className="t-eyebrow mt-6">What to look for</h3>
          <ul className="mt-3 grid gap-2.5">
            {def.expected.map((e) => (
              <li key={e} className="flex gap-3 text-[14px] text-text-2"><span className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-lime" aria-hidden />{e}</li>
            ))}
          </ul>
          <p className="mt-6 border-t border-line pt-4 text-[12.5px] leading-relaxed text-muted">
            Values replay deterministically from the reference plant simulator (5 s steps). Nothing here touches a customer tenant.
          </p>
        </div>
      </aside>
    </div>
  );
}

function Kbd({ children }: { children: string }) {
  return <kbd className="mx-0.5 inline-grid min-w-[26px] place-items-center rounded-md border border-line-2 bg-surface-2 px-1.5 py-0.5 font-sans text-[12px] text-text">{children}</kbd>;
}
