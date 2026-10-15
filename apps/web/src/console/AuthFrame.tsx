import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from '@/site/Logo';
import { ThemeToggle } from '@/ui/theme';
import { ThemedLogo } from './ThemedLogo';

/** Split layout for auth flows: brand-book royal-blue statement panel left, focused form right. */
export function AuthFrame({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-[radial-gradient(120%_120%_at_100%_0%,#2a63ff_0%,#1746e4_42%,#0c1e85_100%)] p-12 text-white lg:flex lg:flex-col lg:justify-between">
        {/* brand outline mark as quiet texture */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/mark-stroke.png" alt="" aria-hidden className="pointer-events-none absolute -bottom-24 -right-28 w-[620px] max-w-none select-none opacity-[0.14] mix-blend-screen" />
        <Link href="/" aria-label="Hydris AI home" className="relative w-fit rounded-full"><Logo tone="white" /></Link>
        <div className="relative">
          <p className="t-eyebrow mb-5 !text-white/85">Hydris Field Glasses</p>
          <p className="t-hero max-w-[14ch]">Plant context, in view.</p>
          <p className="mt-6 max-w-md text-[17px] leading-relaxed text-white/90">Live telemetry, guided inspections and approved procedures for wastewater teams — on smart glasses and in a secure console.</p>
        </div>
        <div className="relative flex flex-wrap gap-2">
          {['Tenant-isolated', 'Audited', 'Advisory only — no remote control'].map((t) => (
            <span key={t} className="chip border-white/30 bg-white/10 text-white backdrop-blur-sm">{t}</span>
          ))}
        </div>
      </aside>
      <main id="main" className="relative flex items-center justify-center px-5 py-12">
        <div className="absolute right-4 top-4 sm:right-6 sm:top-6"><ThemeToggle size="sm" /></div>
        <div className="w-full max-w-[420px] fade-in">
          <Link href="/" className="mb-10 inline-block rounded-full lg:hidden" aria-label="Hydris AI home"><ThemedLogo /></Link>
          <h1 className="t-page">{title}</h1>
          {subtitle && <p className="mt-2 text-text-2">{subtitle}</p>}
          <div className="mt-8">{children}</div>
        </div>
      </main>
    </div>
  );
}
