import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from '@/site/Logo';

/** Split layout for auth flows: editorial statement left, focused form right. */
export function AuthFrame({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden border-r border-line bg-bg-2 p-12 lg:flex lg:flex-col lg:justify-between">
        <Link href="/" aria-label="Hydris home"><Logo /></Link>
        <div>
          <p className="t-eyebrow mb-5">Hydris Field Glasses</p>
          <p className="t-hero max-w-[14ch]">Plant context, <span className="text-lime">in view.</span></p>
          <p className="mt-6 max-w-md text-text-2">Live telemetry, guided inspections and approved procedures for wastewater teams — on smart glasses and in a secure console.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {['Tenant-isolated', 'Audited', 'Advisory only — no remote control'].map((t) => <span key={t} className="chip chip-outline">{t}</span>)}
        </div>
        <svg aria-hidden className="pointer-events-none absolute -right-24 top-24 h-[520px] w-[520px] text-line-2" viewBox="0 0 400 400" fill="none">
          {Array.from({ length: 9 }, (_, i) => <path key={i} d={`M${20 + i * 6} ${380 - i * 10} C ${120 + i * 9} ${260 - i * 22}, ${220 - i * 4} ${300 - i * 30}, ${380 - i * 8} ${40 + i * 14}`} stroke="currentColor" />)}
          <path d="M40 360 C 140 250, 230 280, 360 70" stroke="var(--color-lime)" strokeWidth="3" strokeLinecap="round" />
          <circle cx="360" cy="70" r="7" fill="var(--color-lime)" />
        </svg>
      </aside>
      <main id="main" className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-[420px]">
          <Link href="/" className="mb-10 inline-block lg:hidden" aria-label="Hydris home"><Logo /></Link>
          <h1 className="t-page">{title}</h1>
          {subtitle && <p className="mt-2 text-text-2">{subtitle}</p>}
          <div className="mt-8">{children}</div>
        </div>
      </main>
    </div>
  );
}
