'use client';

import * as RDialog from '@radix-ui/react-dialog';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Boxes, FileText, Gauge, Search, UserRound } from 'lucide-react';
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
        <RDialog.Overlay className="fixed inset-0 z-40 bg-black/60 fade-in" />
        <RDialog.Content className="fixed left-1/2 top-[12vh] z-50 w-[min(640px,calc(100vw-24px))] -translate-x-1/2 overflow-hidden rounded-[var(--radius-2xl)] border border-line-2 bg-surface shadow-[var(--shadow-3)] fade-in" aria-describedby={undefined}>
          <RDialog.Title className="sr-only">Command palette</RDialog.Title>
          <div className="flex items-center gap-3 border-b border-line px-5">
            <Search size={18} className="text-muted" aria-hidden />
            <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setCursor(0); }} placeholder="Jump to a page, asset tag, sensor, SOP or person"
              aria-label="Search" className="h-16 flex-1 bg-transparent text-[16px] outline-none placeholder:text-muted"
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(entries.length - 1, c + 1)); }
                if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
                if (e.key === 'Enter' && entries[cursor]) go(entries[cursor]!.href);
              }} />
          </div>
          <ul role="listbox" aria-label="Results" className="max-h-[52vh] overflow-y-auto p-2">
            {entries.map((e, i) => (
              <li key={e.key} role="option" aria-selected={i === cursor}>
                {(i === 0 || entries[i - 1]!.group !== e.group) && <div className="t-eyebrow px-3 pb-1 pt-3">{e.group}</div>}
                <button onMouseEnter={() => setCursor(i)} onClick={() => go(e.href)} className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left ${i === cursor ? 'bg-surface-2' : ''}`}>
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-surface-3 text-text-2">{e.icon}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm">{e.label}</span>{e.sub && <span className="block truncate text-xs text-muted">{e.sub.replace(/_/g, ' ')}</span>}</span>
                </button>
              </li>
            ))}
            {!entries.length && <li className="px-3 py-8 text-center text-sm text-muted">No matches.</li>}
          </ul>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}
