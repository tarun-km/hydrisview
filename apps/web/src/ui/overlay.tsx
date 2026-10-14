'use client';

import * as RDialog from '@radix-ui/react-dialog';
import clsx from 'clsx';
import { X } from 'lucide-react';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { Button } from './index';
import { errorMessage } from '@/lib/api';

export function Dialog({ open, onOpenChange, title, description, children, footer, wide, side }: {
  open: boolean; onOpenChange: (v: boolean) => void; title: string; description?: ReactNode; children?: ReactNode; footer?: ReactNode; wide?: boolean; side?: boolean;
}) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-40 bg-black/70 backdrop-blur-[2px] fade-in" />
        <RDialog.Content
          className={clsx(
            'fixed z-50 flex max-h-[88vh] flex-col border border-line-2 bg-surface shadow-[var(--shadow-3)] fade-in focus:outline-none',
            side ? 'inset-y-3 right-3 w-[min(520px,calc(100vw-24px))] rounded-[var(--radius-xl)] max-h-none'
              : 'left-1/2 top-1/2 w-[min(var(--w),calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-2xl)]',
          )}
          style={{ ['--w' as string]: wide ? '760px' : '520px' }}
        >
          <div className="flex items-start justify-between gap-4 px-7 pb-2 pt-6">
            <div>
              <RDialog.Title className="t-section">{title}</RDialog.Title>
              {description ? <RDialog.Description className="mt-1.5 text-sm text-text-2">{description}</RDialog.Description> : <RDialog.Description className="sr-only">{title}</RDialog.Description>}
            </div>
            <RDialog.Close className="icon-btn icon-btn-sm" aria-label="Close"><X size={16} /></RDialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-7 py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-7 py-4">{footer}</div>}
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
  const toast = useToast();
  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      await onConfirm(note.trim());
      setNote('');
      onOpenChange(false);
      toast({ title: `${confirmLabel} — done`, tone: 'ok' });
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }} title={title} description={body}
      footer={<>
        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
        <Button variant={destructive ? 'danger-solid' : 'primary'} busy={busy} disabled={noteRequired && !note.trim()} onClick={run}>{confirmLabel}</Button>
      </>}>
      {noteLabel && (
        <div className="field">
          <label htmlFor="confirm-note">{noteLabel}{noteRequired ? '' : ' (optional)'}</label>
          <textarea id="confirm-note" className="textarea" value={note} onChange={(e) => setNote(e.target.value)} autoFocus maxLength={2000} />
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

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((t: Omit<ToastItem, 'id'>) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs.slice(-3), { ...t, id }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), t.tone === 'critical' ? 9000 : 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-5 right-5 z-[60] grid w-[min(380px,calc(100vw-40px))] gap-2">
        {items.map((t) => (
          <div key={t.id} role={t.tone === 'critical' ? 'alert' : 'status'} className="pointer-events-auto panel-glass flex items-start gap-3 px-4 py-3 fade-in">
            <span className="mt-1.5 dot" style={{ background: t.tone === 'critical' ? 'var(--color-critical)' : t.tone === 'ok' ? 'var(--color-lime)' : 'var(--color-cobalt)' }} aria-hidden />
            <div className="min-w-0">
              <div className="text-sm font-medium">{t.title}</div>
              {t.body && <div className="text-[13px] text-text-2">{t.body}</div>}
            </div>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
