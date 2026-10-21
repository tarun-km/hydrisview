'use client';
/**
 * "Hey Hydris" on the glasses: always-on wake phrase, then a short spoken conversation.
 *
 *   idle ──"hey hydris"──► listening ──final transcript──► thinking ──answer──► speaking ──► follow-up (8 s) ──► idle
 *                     └─ "hey hydris, what's the pH?" (question in the same breath) ─► thinking
 *
 * Answers come from the paired account's live data via POST /assistant/ask (see voice-assistant.ts),
 * are shown as a card on the HUD and spoken (glasses speakers through the companion app, or the
 * browser's speech synthesis).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Mic, MicOff, Sparkles } from 'lucide-react';
import { afterWake } from '@hydris/domain';
import type { GAnswer, GlassesData } from './data';
import { openVoice, type VoiceEngine } from './voice';

type Mode = 'idle' | 'listening' | 'thinking' | 'answer';
const FOLLOW_UP_MS = 8000;
const LISTEN_TIMEOUT_MS = 8000;
const STOP_RE = /^(stop|cancel|thanks|thank you|never ?mind|that's all|bye)\b/i;

export function VoiceAssistant({ data, online, bottom = 62 }: { data: GlassesData; online: boolean; bottom?: number }) {
  const engine = useRef<VoiceEngine | null>(null);
  const [kind, setKind] = useState<VoiceEngine['kind']>('none');
  const [enabled, setEnabled] = useState(true);
  const [mic, setMic] = useState<'listening' | 'idle' | 'error'>('idle');
  const [micError, setMicError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('idle');
  const [heard, setHeard] = useState('');
  const [reply, setReply] = useState<GAnswer | null>(null);
  const modeRef = useRef<Mode>('idle');
  const history = useRef<{ role: 'user' | 'assistant'; text: string }[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setM = (m: Mode) => { modeRef.current = m; setMode(m); };
  const arm = (ms: number, then: () => void) => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(then, ms); };
  const close = useCallback(() => { setM('idle'); setHeard(''); history.current = []; }, []);

  const ask = useCallback(async (question: string) => {
    if (timer.current) clearTimeout(timer.current);
    setHeard(question);
    setM('thinking');
    try {
      const a = await data.ask(question, history.current.slice(-6));
      history.current.push({ role: 'user', text: question }, { role: 'assistant', text: a.answer });
      setReply(a);
      setM('answer');
      await engine.current?.speak(a.answer);
    } catch (e) {
      const msg = e instanceof Error && /offline|network/i.test(e.message) ? "I'm offline right now." : "Sorry, I couldn't get that answer.";
      setReply({ answer: msg, intent: 'error', engine: 'none', facts: [] });
      setM('answer');
      await engine.current?.speak(msg);
    }
    // Follow-up window: the next sentence is a question without repeating the wake phrase.
    if (modeRef.current === 'answer') arm(FOLLOW_UP_MS, close);
  }, [data, close]);

  const onText = useCallback((text: string, isFinal: boolean) => {
    const m = modeRef.current;
    if (m === 'thinking') return;
    if (m === 'idle') {
      const q = afterWake(text);
      if (q === null) return;
      if (isFinal && q.length > 2) { void ask(q); return; }
      setM('listening');
      setReply(null);
      setHeard(q);
      arm(LISTEN_TIMEOUT_MS, close);
      return;
    }
    // listening, or follow-up after an answer
    const clean = (afterWake(text) ?? text).trim();
    if (!clean) return;
    if (m === 'answer' && !isFinal) { setM('listening'); setReply(null); }
    setHeard(clean);
    if (!isFinal) { arm(LISTEN_TIMEOUT_MS, close); return; }
    if (STOP_RE.test(clean)) { close(); void engine.current?.speak('Okay.'); return; }
    if (clean.length > 2) void ask(clean);
  }, [ask, close]);

  useEffect(() => {
    if (!enabled) return;
    const e = openVoice();
    engine.current = e;
    setKind(e.kind);
    let listening = false;
    e.start(onText, (s, d) => { if (s === 'listening') listening = true; setMic(s); setMicError(s === 'error' ? d ?? 'Microphone unavailable' : null); });
    // A blocked microphone may never report back; don't leave the pill on "Starting".
    const watchdog = setTimeout(() => { if (!listening) { setMic('error'); setMicError((m) => m ?? 'Microphone unavailable'); } }, 6000);
    return () => { clearTimeout(watchdog); e.stop(); if (timer.current) clearTimeout(timer.current); };
  }, [enabled, onText]);

  // Push-to-talk from the Hydris AI screen / touchpad, and a test hook for the simulator.
  useEffect(() => {
    const activate = (ev: Event) => {
      const q = (ev as CustomEvent<{ question?: string }>).detail?.question;
      if (q && STOP_RE.test(q.trim())) { close(); return; }
      if (q) { void ask(q); return; }
      setReply(null);
      setHeard('');
      setM('listening');
      arm(LISTEN_TIMEOUT_MS, close);
    };
    window.addEventListener('hydris:voice-activate', activate);
    return () => window.removeEventListener('hydris:voice-activate', activate);
  }, [ask, close]);

  const label = kind === 'meta-glasses' ? 'glasses mic' : kind === 'browser' ? 'mic' : 'no mic';
  // Rendered into the status bar's own flex row (#hud-voice-slot) so it never overlaps other icons.
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => { setSlot(document.getElementById('hud-voice-slot')); }, []);
  const live = enabled && mic === 'listening';
  const state = !enabled ? 'Voice off' : live ? 'Hey Hydris' : micError ? 'No mic' : 'Starting';
  const pill = (
    <button type="button" onClick={() => setEnabled((x) => !x)}
      className={`flex h-[34px] flex-none items-center gap-2 whitespace-nowrap rounded-full border px-3.5 text-[15px] leading-none transition-colors ${live ? 'border-lime/50 bg-lime/10 text-white' : micError ? 'border-[#ff9a5c]/40 bg-[#2a1608] text-[#ffb98f]' : 'border-white/15 bg-white/5 text-white/60'}`}
      aria-label={enabled ? 'Turn off Hey Hydris' : 'Turn on Hey Hydris'} aria-pressed={enabled} title={micError ?? `Say "Hey Hydris" (${label})`}>
      {live ? <Mic size={16} className="flex-none text-lime" /> : <MicOff size={16} className="flex-none" />}
      <span>{state}</span>
      {live && <span className="h-[7px] w-[7px] flex-none animate-pulse rounded-full bg-lime" aria-hidden />}
    </button>
  );
  return (
    <>
      {slot && createPortal(pill, slot)}

      {mode !== 'idle' && (
        <div style={{ bottom: `calc(env(safe-area-inset-bottom) + ${bottom}px)` }} className="absolute inset-x-6 z-40 rounded-[28px] border-2 border-lime/70 bg-[#06121c]/95 px-6 py-5 shadow-[0_0_40px_rgba(25,84,241,0.35)]" role="dialog" aria-live="polite" aria-label="Hydris voice assistant">
          <div className="mb-2 flex items-center gap-2 text-[16px] uppercase tracking-[0.14em] text-lime">
            <Sparkles size={17} />Hydris
            <button type="button" onClick={close} aria-label="Close assistant" className="order-last -mr-2 grid h-[36px] w-[36px] place-items-center rounded-full text-white/60 hover:bg-white/10">✕</button>
            <span className="ml-auto text-[14px] normal-case tracking-normal text-white/45">{mode === 'listening' ? 'listening…' : mode === 'thinking' ? 'checking your plant data…' : reply?.engine === 'hydris-rules' || reply?.engine === 'demo' ? 'from live data' : reply?.engine ?? ''}</span>
          </div>
          {heard && <p className="text-[19px] leading-snug text-white/60">“{heard}”</p>}
          {mode === 'listening' && !heard && <p className="flex items-center gap-3 text-[22px]"><span className="h-3 w-3 animate-ping rounded-full bg-lime" />Ask me about readings, alarms or your tasks</p>}
          {mode === 'thinking' && <div className="mt-2 h-[6px] w-full overflow-hidden rounded-full bg-white/10"><div className="h-full w-1/3 animate-[pulse_1s_ease-in-out_infinite] rounded-full bg-lime" /></div>}
          {mode === 'answer' && reply && (
            <>
              <p className="mt-1 text-[23px] leading-snug text-white">{reply.answer}</p>
              {reply.facts.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {reply.facts.slice(0, 3).map((f, i) => (
                    <span key={i} className="rounded-full bg-white/10 px-3 py-1 text-[15px] text-white/80"><span className="num text-white">{f.value}{f.unit && f.unit !== 'pH' ? ` ${f.unit}` : ''}</span> · {f.label}</span>
                  ))}
                </div>
              )}
              <p className="mt-2 text-[14px] text-white/40">Ask a follow-up, or say “thanks”.</p>
            </>
          )}
          {!online && <p className="mt-2 text-[14px] text-[#ff9a5c]">Offline - answers use the last synced data.</p>}
        </div>
      )}
    </>
  );
}
