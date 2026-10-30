'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { cx } from '@/ui';
import { DotMatrix } from './DotMatrix';
import { GlassTile } from './motion';

/**
 * Headline KPI (reference: the four credit tiles): outlined icon ring + two-line label, a dot-matrix numeral with a small
 * unit, and a live micro-infographic to its right. The whole tile is one link.
 */
export function KpiTile({ icon, label, value, unit, viz, href, sub, accent, ariaValue }: {
  icon: ReactNode; label: string; value: number | string; unit?: string; viz?: ReactNode; href?: string; sub?: ReactNode;
  accent?: 'critical' | 'high' | 'ok'; ariaValue: string;
}) {
  const body = (
    <>
      <div className="flex items-center gap-3.5">
        <span className="fx-icon-ring" aria-hidden>{icon}</span>
        <span className="min-w-0 flex-1 text-[15px] leading-[1.2] text-text">{label}</span>
        {href && <ArrowUpRight size={16} className="flex-none self-start text-muted transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden />}
      </div>
      <div className="mt-5 flex items-end justify-between gap-3">
        <div className={cx('flex items-end gap-1.5', accent === 'critical' ? 'text-critical-text' : accent === 'high' ? 'text-high-text' : 'text-text')}>
          <DotMatrix value={value} dot={5} gap={2} label="" />
          {unit && <span className="mb-[-2px] text-[15px] text-muted">{unit}</span>}
        </div>
        {viz && <div className="min-w-0 flex-1 text-text-2 [&>svg]:ml-auto [&>svg]:block [&>svg]:h-auto [&>svg]:max-h-11 [&>svg]:max-w-full">{viz}</div>}
      </div>
      {sub && <div className="mt-3 text-[12.5px] leading-snug text-muted">{sub}</div>}
      <span className="sr-only">{ariaValue}</span>
    </>
  );
  return (
    <GlassTile className="group flex flex-col !rounded-[28px] !p-5">
      {href ? <Link href={href} className="flex flex-1 flex-col rounded-[20px] outline-offset-4">{body}</Link> : body}
    </GlassTile>
  );
}
