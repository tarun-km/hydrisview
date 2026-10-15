'use client';

import * as RDialog from '@radix-ui/react-dialog';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, Boxes, CornerDownLeft, FileText, Gauge, Loader2, Search, SearchX, UserRound } from 'lucide-react';
import { useApi } from '@/lib/query';

interface Hit { id: string; label: string; sub: string | null }
interface Results { assets: Hit[]; sensors: Hit[]; documents: Hit[]; people: Hit[] }

export function CommandPalette({ open, onOpenChange, nav }: { open: boolean; onOpenChange: (v: boolean) => void; nav: { href: string; label: string; icon: ReactNode }[] }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [cursor, setCursor] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => { if (!open) { setQ(''); setCursor(0); } }, [open]);
  const res = useApi<Results>(debounced.length >= 1 ? `/search?q=${encodeURIComponent(debounced)}` : null);
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);
  const searching = !!q.trim() && (q.trim() !== debounced || res.isFetching);

  const entries = useMemo(() => {
    const list: { key: string; label: string; sub?: string; href: string; icon: ReactNode; group: string }[] = [];
    const ql = q.toLowerCase();
    for (const n of nav) if (!ql || n.label.toLowerCase().includes(ql)) list.push({ key: n.href, label: n.label, href: n.href, icon: n.icon, group: 'Go to' });
    if (res.data && debounced) {
      for (const a of res.data.assets) list.push({ key: `a${a.id}`, label: a.label, sub: a.sub ?? undefined, href: `/console/assets/${a.id}`, icon: <Boxes size={16} />, group: 'Assets' });
      for (const s of res.data.sensors) list.push({ key: `s${s.id}`, label: s.label, sub: s.sub ?? undefined, href: `/console/telemetry/${s.id}`, icon: <Gauge size={16} />, group: 'Sensors' });
      for (const d of res.data.documents) list.push({ key: `d${d.id}`, label: d.label, sub: d.sub ?? undefined, href: `/console/documents/${d.id}`, icon: <FileText size={16} />, group: 'Documents' });
      for (const p of res.data.people) list.push({ key: `p${p.id}`, label: p.label, sub: p.sub ?? undefined, href: `/console/operators/${p.id}`, icon: <UserRound size={16} />, group: 'People' });
    }
    return list.slice(0, 40);
  }, [nav, q, res.data, debounced]);

  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };

  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-40 bg-scrim backdrop-blur-[3px] fade-in" />
        <RDialog.Content className="pop-in fixed left-1/2 top-[10vh] z-50 w-[min(660px,calc(100vw-24px))] -translate-x-1/2 overflow-hidden rounded-[28px] border border-line-2 bg-surface shadow-[var(--shadow-3),var(--sheen)]" aria-describedby={undefined}>
          <RDialog.Title className="sr-only">Command palette</RDialog.Title>
          <div className="flex items-center gap-3 border-b border-line px-5">
            {searching ? <Loader2 size={18} className="animate-spin text-muted" aria-hidden /> : <Search size={18} className="text-muted" aria-hidden />}
            <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setCursor(0); }} placeholder="Jump to a page, asset tag, sensor, SOP or person"
              aria-label="Search" role="combobox" aria-expanded aria-controls="palette-results" aria-activedescendant={entries[cursor] ? `opt-${entries[cursor]!.key}` : undefined} className="h-16 flex-1 bg-transparent text-[16px] outline-none placeholder:text-muted"
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(entries.length - 1, c + 1)); }
                if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
                if (e.key === 'Enter' && entries[cursor]) go(entries[cursor]!.href);
              }} />
          </div>
          <ul ref={listRef} id="palette-results" role="listbox" aria-label="Results" className="max-h-[52vh] overflow-y-auto p-2">
            {entries.map((e, i) => (
              <li key={e.key} id={`opt-${e.key}`} role="option" aria-selected={i === cursor}>
                {(i === 0 || entries[i - 1]!.group !== e.group) && <div className="t-eyebrow px-3 pb-1 pt-3">{e.group}</div>}
                <button onMouseEnter={() => setCursor(i)} onClick={() => go(e.href)} tabIndex={-1} className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors ${i === cursor ? 'bg-surface-2' : ''}`}>
                  <span className={`grid h-9 w-9 flex-none place-items-center rounded-full transition-colors ${i === cursor ? 'bg-lime text-lime-ink' : 'bg-surface-3 text-text-2'}`}>{e.icon}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm">{e.label}</span>{e.sub && <span className="block truncate text-xs text-muted">{e.sub.replace(/_/g, ' ')}</span>}</span>
                  {i === cursor && <ArrowRight size={15} className="flex-none text-muted" aria-hidden />}
                </button>
              </li>
            ))}
            {!entries.length && (
              <li className="grid place-items-center gap-2 px-3 py-10 text-center">
                {searching ? <Loader2 size={20} className="animate-spin text-muted" aria-hidden /> : <SearchX size={22} className="text-muted" aria-hidden />}
                <span className="text-sm text-text-2">{searching ? 'Searching…' : <>No matches for “{q.trim()}”</>}</span>
                {!searching && <span className="text-xs text-muted">Try an asset tag (P-101), a sensor tag (AIT-501) or an SOP number.</span>}
              </li>
            )}
          </ul>
          <div className="hidden items-center gap-4 border-t border-line px-5 py-2.5 text-[11.5px] text-muted sm:flex">
            <span className="inline-flex items-center gap-1.5"><kbd className="rounded border border-line-2 px-1">↑</kbd><kbd className="rounded border border-line-2 px-1">↓</kbd> navigate</span>
            <span className="inline-flex items-center gap-1.5"><kbd className="grid h-[18px] place-items-center rounded border border-line-2 px-1"><CornerDownLeft size={10} /></kbd> open</span>
            <span className="inline-flex items-center gap-1.5"><kbd className="rounded border border-line-2 px-1">Esc</kbd> close</span>
          </div>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}
