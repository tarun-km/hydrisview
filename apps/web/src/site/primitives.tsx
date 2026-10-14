import clsx from 'clsx';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowUpRight, Check, Clock } from 'lucide-react';

/** Small top-left section label (Usechannel "What is …?" style). */
export function SectionLabel({ children, className, index }: { children: ReactNode; className?: string; index?: string }) {
  return (
    <p className={clsx('flex items-center gap-3 text-[15px] tracking-[-0.01em] text-muted', className)}>
      {index && <span className="num text-[13px] opacity-80">/{index}</span>}
      <span>{children}</span>
    </p>
  );
}

/** Inline pill inside a headline. Decorative text is still read by screen readers as part of the sentence. */
export function HlPill({ children, tone = 'lime', icon }: { children?: ReactNode; tone?: 'lime' | 'outline' | 'dark' | 'surface'; icon?: ReactNode }) {
  return (
    <span className={clsx('hl-pill', `hl-pill-${tone}`)}>
      {icon}
      {children && <span className="hl-pill-text">{children}</span>}
    </span>
  );
}

export function HlIcon({ children, className }: { children: ReactNode; className?: string }) {
  return <span aria-hidden className={clsx('hl-icon', className)}>{children}</span>;
}

export function StatPill({ k, v, lime, className }: { k: string; v: ReactNode; lime?: boolean; className?: string }) {
  return (
    <div className={clsx('stat-pill', lime && 'stat-pill-lime', className)}>
      <span className="stat-k">{k}</span>
      <span className="stat-v num">{v}</span>
    </div>
  );
}

/** Decorative circular ↗ used inside a link/card that already has an accessible name. */
export function ArrowCircle({ tone = 'light', className }: { tone?: 'light' | 'lime' | 'dark' | 'outline' | 'ink'; className?: string }) {
  return (
    <span aria-hidden className={clsx(
      'arrow-circle',
      tone === 'light' && 'bg-white text-ink',
      tone === 'lime' && 'bg-lime text-lime-ink',
      tone === 'dark' && 'bg-surface-2 text-text border border-line-2',
      tone === 'outline' && 'border border-line-2 text-text',
      tone === 'ink' && 'bg-ink text-paper',
      className,
    )}>
      <ArrowUpRight size={18} strokeWidth={1.8} />
    </span>
  );
}

export type Availability = 'available' | 'planned' | 'simulator' | 'partial';
export function AvailabilityTag({ status, onPaper }: { status: Availability; onPaper?: boolean }) {
  if (status === 'available')
    return (
      <span className={clsx('chip', onPaper ? 'avail-ok-paper' : 'chip-ok')}>
        <Check size={13} strokeWidth={2.4} aria-hidden /> Available now
      </span>
    );
  if (status === 'partial')
    return <span className={clsx('chip', onPaper ? 'avail-plain-paper' : 'chip-cobalt')}>Available · limited</span>;
  if (status === 'simulator')
    return <span className={clsx('chip', onPaper ? 'avail-plain-paper' : 'chip-synthetic')}>Simulator</span>;
  return (
    <span className={clsx('chip', onPaper ? 'avail-planned-paper' : 'avail-planned')}>
      <Clock size={12} strokeWidth={2.2} aria-hidden /> Planned
    </span>
  );
}

/** Page intro used by inner pages: label, huge statement, lead paragraph, optional aside. */
export function PageIntro({ label, title, lead, aside, children }: { label: string; title: ReactNode; lead?: ReactNode; aside?: ReactNode; children?: ReactNode }) {
  return (
    <section className="site-container pb-16 pt-10 lg:pb-24 lg:pt-16" aria-labelledby="page-title">
      <SectionLabel className="reveal">{label}</SectionLabel>
      <div className="site-grid mt-8 gap-y-10 lg:mt-12">
        <h1 id="page-title" className="t-display reveal col-span-12 xl:col-span-11">{title}</h1>
        {(lead || aside) && (
          <div className="col-span-12 grid gap-8 md:grid-cols-12 lg:mt-6">
            <div className="md:col-span-6 lg:col-span-5 lg:col-start-7">
              {lead && <div className="t-lead reveal reveal-d1 text-text-2">{lead}</div>}
              {children}
            </div>
            {aside && <div className="reveal reveal-d2 md:col-span-6 md:row-start-1 lg:col-span-5">{aside}</div>}
          </div>
        )}
      </div>
    </section>
  );
}

export function CtaBand({ title, body }: { title?: ReactNode; body?: ReactNode }) {
  return (
    <section className="site-container site-section-tight" aria-labelledby="cta-title">
      <div className="card-lime reveal relative overflow-hidden rounded-[28px] px-6 py-12 sm:px-10 lg:rounded-[40px] lg:px-16 lg:py-20">
        <svg aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-[420px] w-[420px] opacity-30 lg:h-[620px] lg:w-[620px]" viewBox="0 0 200 200">
          {Array.from({ length: 9 }, (_, i) => (
            <circle key={i} cx="100" cy="100" r={20 + i * 10} fill="none" stroke="#141714" strokeWidth="0.6" />
          ))}
        </svg>
        <div className="relative grid gap-10 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-8">
            <h2 id="cta-title" className="t-hero">{title ?? <>See Hydris on a plant <span className="whitespace-nowrap">like yours.</span></>}</h2>
            <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-lime-ink/75">
              {body ?? 'A 30-minute walkthrough: the glasses viewport, the operator console and how your gateway telemetry would reach both. We will be clear about what is available today and what is planned.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-3 lg:col-span-4 lg:justify-end">
            <Link href="/contact?type=demo" className="btn btn-lg btn-ink">
              Request a demo <ArrowUpRight size={16} aria-hidden />
            </Link>
            <Link href="/demo" className="btn btn-lg btn-outline-ink">Try the live demo</Link>
          </div>
        </div>
      </div>
    </section>
  );
}
