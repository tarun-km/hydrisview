'use client';

/**
 * Hydris theme runtime: System / Light / Dark.
 *  - The blocking script in the root layout (theme-script.ts) sets `data-theme` before first paint.
 *  - This module keeps it in sync afterwards (OS changes, other tabs, dev Strict-Mode remounts) and
 *    exposes `useTheme()` + `<ThemeToggle />`. Self-contained: no dependency on other UI modules.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore, type KeyboardEvent } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { FORCED_DARK_RE, THEME_COLORS, THEME_DEFAULT_MODE, THEME_STORAGE_KEY, type ResolvedTheme, type ThemeMode } from './theme-script';

export type { ThemeMode, ResolvedTheme } from './theme-script';

const MODES: ThemeMode[] = ['system', 'light', 'dark'];
const LABEL: Record<ThemeMode, string> = { system: 'System', light: 'Light', dark: 'Dark' };
const ICON = { system: Monitor, light: Sun, dark: Moon } as const;

const isMode = (v: unknown): v is ThemeMode => v === 'system' || v === 'light' || v === 'dark';
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

// ---------------------------------------------------------------- external store
const listeners = new Set<() => void>();
let memoryMode: ThemeMode | null = null; // fallback when storage is unavailable

function readMode(): ThemeMode {
  if (memoryMode) return memoryMode;
  try {
    const v = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isMode(v) ? v : THEME_DEFAULT_MODE;
  } catch {
    return THEME_DEFAULT_MODE;
  }
}
function systemTheme(): ResolvedTheme {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
function forcedDark() {
  return typeof window !== 'undefined' && FORCED_DARK_RE.test(window.location.pathname);
}
function resolve(mode: ThemeMode): ResolvedTheme {
  if (forcedDark()) return 'dark';
  return mode === 'system' ? systemTheme() : mode;
}

/** Write the resolved theme to <html> and the browser chrome colour. */
function applyToDocument(mode: ThemeMode) {
  const root = document.documentElement;
  const r = resolve(mode);
  if (root.getAttribute('data-theme') !== r) root.setAttribute('data-theme', r);
  root.setAttribute('data-theme-mode', forcedDark() ? 'dark' : mode);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', THEME_COLORS[r]));
}

let switchTimer: ReturnType<typeof setTimeout> | undefined;
/** Apply with a brief cross-fade of colours (class on the root, removed after the transition; skipped for reduced motion). */
function applyWithTransition(mode: ThemeMode) {
  const root = document.documentElement;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduce || root.getAttribute('data-theme') === resolve(mode)) {
    applyToDocument(mode);
    return;
  }
  root.classList.add('theme-switching');
  applyToDocument(mode);
  clearTimeout(switchTimer);
  switchTimer = setTimeout(() => root.classList.remove('theme-switching'), 360);
}

function emit() {
  for (const l of listeners) l();
}
function subscribe(cb: () => void) {
  listeners.add(cb);
  const mq = window.matchMedia?.('(prefers-color-scheme: light)');
  const onMq = () => {
    if (readMode() === 'system') applyWithTransition('system');
    cb();
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key !== THEME_STORAGE_KEY) return;
    applyWithTransition(readMode());
    cb();
  };
  mq?.addEventListener('change', onMq);
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(cb);
    mq?.removeEventListener('change', onMq);
    window.removeEventListener('storage', onStorage);
  };
}

export function setThemeMode(mode: ThemeMode) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
    memoryMode = null;
  } catch {
    memoryMode = mode;
  }
  applyWithTransition(mode);
  emit();
}

const getModeSnapshot = () => readMode();
const getServerMode = () => THEME_DEFAULT_MODE;
const getResolvedSnapshot = () => resolve(readMode());
const getServerResolved = (): ResolvedTheme => (THEME_DEFAULT_MODE === 'light' ? 'light' : 'dark');

export interface ThemeState {
  /** The stored preference. */
  mode: ThemeMode;
  /** What is actually rendered right now. */
  resolved: ResolvedTheme;
  setMode: (m: ThemeMode) => void;
  /** Cycle System → Light → Dark. */
  cycle: () => void;
}

export function useTheme(): ThemeState {
  const mode = useSyncExternalStore(subscribe, getModeSnapshot, getServerMode);
  const resolved = useSyncExternalStore(subscribe, getResolvedSnapshot, getServerResolved);
  const cycle = useCallback(() => setThemeMode(MODES[(MODES.indexOf(readMode()) + 1) % MODES.length]!), []);
  return { mode, resolved, setMode: setThemeMode, cycle };
}

/**
 * Keeps <html data-theme> correct after hydration: re-applies after React's dev remount clears it,
 * and on client-side navigation into/out of forced-dark routes. Mount once (root providers).
 */
export function ThemeSync({ pathname }: { pathname?: string | null }) {
  useIsoLayoutEffect(() => {
    applyToDocument(readMode());
  }, [pathname]);
  useEffect(() => subscribe(() => {}), []);
  return null;
}

// ---------------------------------------------------------------- toggle
export interface ThemeToggleProps {
  /** Single circular button that cycles System → Light → Dark. */
  compact?: boolean;
  className?: string;
  /** Show text labels next to the icons in the segmented variant (default: icons only below 'sm', labels from 'sm'). */
  labels?: 'always' | 'never' | 'responsive';
  size?: 'sm' | 'md';
}

export function ThemeToggle({ compact, className, labels = 'never', size = 'md' }: ThemeToggleProps) {
  const { mode, resolved, setMode, cycle } = useTheme();
  const group = useRef<HTMLDivElement>(null);

  if (compact) {
    const next = MODES[(MODES.indexOf(mode) + 1) % MODES.length]!;
    const Icon = ICON[mode];
    const text = `Theme: ${LABEL[mode]}${mode === 'system' ? ` (${resolved})` : ''}. Switch to ${LABEL[next]}.`;
    return (
      <button type="button" onClick={cycle} aria-label={text} title={text}
        className={['theme-toggle-btn icon-btn', size === 'sm' ? 'icon-btn-sm' : '', className ?? ''].join(' ').trim()}>
        <Icon key={mode} size={size === 'sm' ? 16 : 18} strokeWidth={1.8} aria-hidden className="theme-toggle-icon" />
      </button>
    );
  }

  const onKey = (e: KeyboardEvent) => {
    const i = MODES.indexOf(mode);
    let n = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = (i + 1) % MODES.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = (i - 1 + MODES.length) % MODES.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = MODES.length - 1;
    if (n < 0) return;
    e.preventDefault();
    setMode(MODES[n]!);
    group.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[n]?.focus();
  };

  return (
    <div ref={group} role="radiogroup" aria-label="Colour theme" onKeyDown={onKey}
      className={['theme-toggle', size === 'sm' ? 'theme-toggle-sm' : '', className ?? ''].join(' ').trim()}>
      {MODES.map((m) => {
        const Icon = ICON[m];
        const on = m === mode;
        return (
          <button key={m} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} onClick={() => setMode(m)}
            title={m === 'system' ? `System (currently ${resolved})` : LABEL[m]} aria-label={labels === 'always' ? undefined : LABEL[m]}>
            <Icon size={size === 'sm' ? 14 : 15} strokeWidth={1.9} aria-hidden />
            {labels !== 'never' && <span className={labels === 'responsive' ? 'hidden sm:inline' : undefined}>{LABEL[m]}</span>}
          </button>
        );
      })}
    </div>
  );
}
