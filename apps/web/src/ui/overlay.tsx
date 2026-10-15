'use client';

import * as RDialog from '@radix-ui/react-dialog';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { Button } from './index';
import { errorMessage } from '@/lib/api';

/**
 * Modal dialog. Centered card on tablet/desktop, bottom sheet on phones; `side` renders a right-hand drawer.
 * Header and footer stay pinned while the body scrolls.
 */
export function Dialog({ open, onOpenChange, title, description, children, footer, wide, side }: {
  open: boolean; onOpenChange: (v: boolean) => void; title: string; description?: ReactNode; children?: ReactNode; footer?: ReactNode; wide?: boolean; side?: boolean;
}) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-40 bg-scrim backdrop-blur-[3px] fade-in" />
        <RDialog.Content
          className={clsx(
            'fixed z-50 flex flex-col border border-line-2 bg-surface shadow-[var(--shadow-3),var(--sheen)] focus:outline-none',
            side
              ? 'inset-y-3 right-3 w-[min(540px,calc(100vw-24px))] rounded-[var(--radius-xl)] slide-in-right'
              : clsx(
                // phone: bottom sheet
                'inset-x-0 bottom-0 max-h-[92dvh] rounded-t-[28px] sheet-up',
                // ≥ sm: centered card
                'sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-h-[88vh] sm:w-[min(var(--w),calc(100vw-32px))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[var(--radius-2xl)] sm:animate-[popIn_220ms_var(--ease-out)_both]',
              ),
          )}
          style={{ ['--w' as string]: wide ? '780px' : '540px' }}
        >
          {!side && <span aria-hidden className="mx-auto mt-2.5 h-1 w-10 flex-none rounded-full bg-line-2 sm:hidden" />}
          <div className="flex flex-none items-start justify-between gap-4 px-6 pb-2 pt-5 sm:px-7 sm:pt-6">
            <div className="min-w-0">
              <RDialog.Title className="t-section">{title}</RDialog.Title>
              {description ? <RDialog.Description className="mt-1.5 text-sm leading-relaxed text-text-2">{description}</RDialog.Description> : <RDialog.Description className="sr-only">{title}</RDialog.Description>}
            </div>
            <RDialog.Close className="icon-btn icon-btn-sm icon-btn-ghost -mr-1" aria-label="Close dialog"><X size={16} /></RDialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-4 sm:px-7">{children}</div>
          {footer && <div className="flex flex-none flex-wrap justify-end gap-2 border-t border-line bg-surface px-6 py-4 pb-[max(16px,env(safe-area-inset-bottom))] sm:px-7 sm:pb-4 max-sm:[&>.btn]:flex-1">{footer}</div>}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

/** Explicit confirmation for consequential actions, with optional required note. */
export function ConfirmDialog({ open, onOpenChange, title, body, confirmLabel, destructive, onConfirm, noteLabel, noteRequired }: {
  open: boolean; onOpenChange: (v: boolean) => void; title: string; body: ReactNode; confirmLabel: string; destructive?: boolean;
  onConfirm: (note: string) => Promise<unknown>; noteLabel?: string; noteRequired?: boolean;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const toast = useToast();
  const missingNote = !!noteRequired && !note.trim();
  const run = async () => {
    setTouched(true);
    if (missingNote) return;
    setBusy(true);
    setErr(null);
    try {
      await onConfirm(note.trim());
      setNote('');
      setTouched(false);
      onOpenChange(false);
      toast({ title: `${confirmLabel} — done`, tone: 'ok' });
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) { onOpenChange(v); if (!v) { setErr(null); setTouched(false); } } }} title={title} description={body}
      footer={<>
        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
        <Button variant={destructive ? 'danger-solid' : 'primary'} busy={busy} onClick={run}>{confirmLabel}</Button>
      </>}>
      {destructive && !noteLabel && (
        <p className="flex items-start gap-2.5 rounded-2xl border border-[rgb(255_40_0/0.3)] bg-[rgb(255_40_0/0.06)] p-3.5 text-sm text-text-2">
          <AlertTriangle size={16} className="mt-0.5 flex-none text-critical" aria-hidden /> This is recorded in the audit log.
        </p>
      )}
      {noteLabel && (
        <div className="field">
          <label htmlFor="confirm-note">{noteLabel}{noteRequired ? <span className="text-critical" aria-hidden> *</span> : <span className="font-normal text-muted"> (optional)</span>}</label>
          <textarea id="confirm-note" className="textarea" value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => setTouched(true)} autoFocus maxLength={2000}
            required={noteRequired} aria-invalid={touched && missingNote ? true : undefined} aria-describedby="confirm-note-hint" />
          {touched && missingNote
            ? <span id="confirm-note-hint" className="field-error" role="alert">A note is required — it becomes part of the audit record.</span>
            : <span id="confirm-note-hint" className="field-hint num">{note.length}/2000</span>}
        </div>
      )}
      {err && <p role="alert" className="field-error mt-3">{err}</p>}
    </Dialog>
  );
}

// ---------------- Toasts ----------------
interface ToastItem { id: number; title: string; body?: string; tone?: 'ok' | 'critical' | 'info' }
const ToastCtx = createContext<(t: Omit<ToastItem, 'id'>) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

const TOAST_MS = { ok: 4500, info: 5500, critical: 9000 } as const;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const push = useCallback((t: Omit<ToastItem, 'id'>) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs.slice(-3), { ...t, id }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), TOAST_MS[t.tone ?? 'info']);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-3 bottom-[92px] z-[60] ml-auto grid w-auto gap-2 sm:inset-x-auto sm:bottom-5 sm:right-5 sm:w-[380px] md:bottom-5">
        {items.map((t) => {
          const tone = t.tone ?? 'info';
          const Icon = tone === 'critical' ? AlertTriangle : tone === 'ok' ? CheckCircle2 : Info;
          const color = tone === 'critical' ? 'var(--color-critical)' : tone === 'ok' ? 'var(--color-lime)' : 'var(--color-cobalt)';
          return (
            <div key={t.id} role={tone === 'critical' ? 'alert' : 'status'}
              className={clsx('pointer-events-auto panel-glass relative flex items-start gap-3 overflow-hidden py-3 pl-3.5 pr-2 pop-in', tone === 'critical' && 'border-[rgb(255_40_0/0.45)]')}>
              <span className="mt-0.5 grid h-8 w-8 flex-none place-items-center rounded-full" style={{ background: `color-mix(in srgb, ${color} 16%, transparent)`, color }}><Icon size={16} aria-hidden /></span>
              <div className="min-w-0 flex-1 py-1">
                <div className="text-sm font-medium leading-snug">{t.title}</div>
                {t.body && <div className="mt-0.5 text-[13px] leading-snug text-text-2">{t.body}</div>}
              </div>
              <button type="button" onClick={() => dismiss(t.id)} className="icon-btn icon-btn-sm icon-btn-ghost border-transparent" aria-label="Dismiss notification"><X size={14} /></button>
              <span aria-hidden className="toast-timer absolute inset-x-0 bottom-0 h-[2px] opacity-60" style={{ background: color, animationDuration: `${TOAST_MS[tone]}ms` }} />
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}
