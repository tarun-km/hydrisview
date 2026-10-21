'use client';
/**
 * Voice I/O for "Hey Hydris".
 *
 * Engines, in order of preference:
 *  1. Ray-Ban Meta glasses (companion app, Meta DAT Speech capability): the glasses microphone is
 *     transcribed on the device by `session.addSpeech()`; the bridge forwards transcripts with
 *     window.__hydrisSpeech(text, isFinal) and speaks answers through the phone's TextToSpeech,
 *     which plays on the glasses' open-ear speakers. Calls: HydrisNative.startSpeech()/stopSpeech()/speak(text).
 *  2. Browser speech (Web Speech API: SpeechRecognition + speechSynthesis) - Chrome/Edge/Safari on a
 *     phone or the simulator.
 *  3. None - the assistant still works with typed questions.
 */
import { MEASURAND_DEFS, detectMeasurand, normalizeUtterance, type Measurand } from '@hydris/domain';
import type { GContext } from './data';

export type VoiceKind = 'meta-glasses' | 'browser' | 'none';
export interface VoiceEngine {
  kind: VoiceKind;
  /** Start continuous listening; `onText` receives partial and final transcripts. */
  start(onText: (text: string, isFinal: boolean) => void, onState?: (s: 'listening' | 'idle' | 'error', detail?: string) => void): void;
  stop(): void;
  speak(text: string): Promise<void>;
}

declare global {
  interface Window {
    __hydrisSpeech?: (text: string, isFinal: boolean) => void;
    __hydrisSpeechState?: (state: string, detail?: string) => void;
    __hydrisSpoken?: () => void;
    webkitSpeechRecognition?: new () => SpeechRec;
    SpeechRecognition?: new () => SpeechRec;
  }
}
interface SpeechRec {
  continuous: boolean; interimResults: boolean; lang: string;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null; onaudiostart: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}

function nativeVoice(): VoiceEngine | null {
  const n = typeof window !== 'undefined' ? window.HydrisNative : undefined;
  if (!n?.startSpeech || !n.speak) return null;
  return {
    kind: 'meta-glasses',
    start(onText, onState) {
      window.__hydrisSpeech = (t, f) => onText(t, f);
      window.__hydrisSpeechState = (s, d) => onState?.(s === 'listening' ? 'listening' : s === 'error' ? 'error' : 'idle', d);
      n.startSpeech!();
    },
    stop() { n.stopSpeech?.(); },
    speak: (text) => new Promise<void>((resolve) => {
      const done = setTimeout(resolve, Math.min(20_000, 1500 + text.length * 70));
      window.__hydrisSpoken = () => { clearTimeout(done); resolve(); };
      n.speak!(text);
    }),
  };
}

function browserVoice(): VoiceEngine | null {
  if (typeof window === 'undefined') return null;
  const Rec = window.SpeechRecognition ?? window.webkitSpeechRecognition;
  if (!Rec) return null;
  let rec: SpeechRec | null = null;
  let active = false;
  let paused = false;
  return {
    kind: 'browser',
    start(onText, onState) {
      active = true;
      let failures = 0;
      let opened = false;
      const boot = () => {
        if (!active || paused) return;
        rec = new Rec();
        rec.continuous = true;
        rec.interimResults = true;
        rec.lang = navigator.language || 'en-US';
        rec.onresult = (e) => {
          for (let i = e.resultIndex; i < e.results.length; i++) onText(e.results[i]![0].transcript, e.results[i]!.isFinal);
        };
        // "listening" only once the microphone really opens.
        opened = false;
        rec.onaudiostart = () => { opened = true; failures = 0; onState?.('listening'); };
        rec.onerror = (e) => {
          if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { active = false; onState?.('error', 'Microphone permission denied'); }
          else if (e.error === 'audio-capture') { active = false; onState?.('error', 'No microphone found'); }
        };
        // Browsers end recognition after silence; keep it running while the assistant is enabled,
        // but give up (and say so) when the microphone never opens.
        rec.onend = () => {
          if (!opened && ++failures >= 3) { active = false; onState?.('error', 'Microphone unavailable'); return; }
          if (active && !paused) setTimeout(boot, 300); else onState?.('idle');
        };
        try { rec.start(); } catch { /* already started */ }
      };
      boot();
    },
    stop() { active = false; rec?.abort(); },
    speak: (text) => new Promise<void>((resolve) => {
      if (!('speechSynthesis' in window)) return resolve();
      // Don't transcribe our own answer.
      paused = true;
      rec?.abort();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.02;
      const end = () => { paused = false; resolve(); };
      u.onend = end;
      u.onerror = end;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
      setTimeout(() => { if (paused) end(); }, Math.min(20_000, 2000 + text.length * 80));
    }).then(() => { /* restart listening */ if (active) setTimeout(() => { try { rec?.start(); } catch { /* running */ } }, 150); }),
  };
}

export function openVoice(): VoiceEngine {
  return nativeVoice() ?? browserVoice() ?? { kind: 'none', start: (_t, s) => s?.('error', 'Speech recognition is not available on this device'), stop: () => {}, speak: async () => {} };
}

// ------------------------------------------------------------------ offline / demo answers
/** Answer from the glasses' context (demo mode, or offline with cached data). Same rules as the API. */
export function answerFromContext(ctx: GContext, text: string): { answer: string; intent: string } {
  const t = normalizeUtterance(text);
  const m = detectMeasurand(text) as Measurand | null;
  if (/\b(alarm|alarms|alert|alerts)\b/.test(t)) {
    const a = ctx.alarms;
    if (!a.length) return { intent: 'alarms', answer: 'There are no open alarms.' };
    const crit = a.filter((x) => x.severity === 'critical').length;
    return { intent: 'alarms', answer: `${a.length} open alarm${a.length === 1 ? '' : 's'}${crit ? `, ${crit} critical` : ''}. Most urgent: ${a[0]!.title}${a[0]!.assetTag ? ` on ${a[0]!.assetTag}` : ''}.` };
  }
  if (/\b(task|tasks|inspection|inspections|my work|to do|assigned|next)\b/.test(t)) {
    const next = ctx.inspections[0]?.title ?? ctx.tasks[0]?.title;
    return { intent: 'my_work', answer: `You have ${ctx.inspections.length} inspection${ctx.inspections.length === 1 ? '' : 's'} and ${ctx.tasks.length} maintenance task${ctx.tasks.length === 1 ? '' : 's'}.${next ? ` Next up: ${next}.` : ''}` };
  }
  if (m) {
    const ms = (ctx.measurements ?? []).filter((x) => x.measurand === m && x.lastValue !== null);
    const label = MEASURAND_DEFS[m].label;
    if (!ms.length) return { intent: 'reading', answer: `I can't find a live ${label} reading on this site.` };
    const parts = ms.slice(0, 3).map((x) => `${x.assetTag ?? x.name} ${x.lastValue!.toFixed(Math.min(2, x.decimals))}${x.unit === 'pH' ? '' : ` ${x.unit}`}`);
    const off = ms.filter((x) => x.threshold !== 'normal').map((x) => x.assetTag ?? x.name);
    return { intent: 'reading', answer: `Current ${label}: ${parts.join('; ')}.${off.length ? ` Check ${off.join(', ')}.` : ' All within the typical range.'}` };
  }
  return { intent: 'unknown', answer: "I can't answer that from your plant data. Ask for a reading, alarms or your tasks." };
}
