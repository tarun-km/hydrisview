import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { isScenarioKey } from '@hydris/domain';
import { DemoStudio, SyntheticNotice } from '@/site/LiveGlasses';
import { CtaBand, HlPill, SectionLabel } from '@/site/primitives';

export const metadata: Metadata = {
  title: 'Interactive demo',
  description:
    'Try the Hydris Field Glasses viewport in your browser: pick one of ten wastewater scenarios and drive the 600 × 600 display with up, down, select and back. Synthetic demonstration data, isolated from customer data.',
  alternates: { canonical: '/demo' },
};

export default async function DemoPage({ searchParams }: { searchParams: Promise<{ scenario?: string | string[] }> }) {
  const sp = await searchParams;
  const requested = Array.isArray(sp.scenario) ? sp.scenario[0] : sp.scenario;
  const initial = isScenarioKey(requested) ? requested : 'normal_operations';

  return (
    <>
      <section className="site-container pb-10 pt-10 lg:pb-14 lg:pt-16" aria-labelledby="page-title">
        <SectionLabel className="reveal">Interactive demo</SectionLabel>
        <div className="site-grid mt-8 gap-y-8">
          <h1 id="page-title" className="t-hero reveal col-span-12 lg:col-span-8">
            Drive the <HlPill tone="lime">real</HlPill> glasses viewport with four buttons.
          </h1>
          <div className="reveal col-span-12 self-end lg:col-span-4">
            <SyntheticNotice />
            <p className="mt-4 text-[15px] leading-relaxed text-text-2">
              This is the production glasses UI running in a browser frame against a deterministic simulator of our reference plant. On real glasses the
              same inputs come from the device; a native device adapter is planned.
            </p>
          </div>
        </div>
      </section>

      <section className="site-container" aria-label="Glasses demo">
        <div className="stage px-4 py-10 sm:px-8 lg:px-10 lg:py-14">
          <DemoStudio variant="full" initial={initial} />
        </div>
      </section>

      <section className="site-container site-section-tight" aria-labelledby="how-title">
        <h2 id="how-title" className="t-section">How to use the demo</h2>
        <ol className="mt-6 grid gap-4 md:grid-cols-3">
          {[
            ['Choose a scenario', 'Each one replays the same way every time — useful for training and for comparing notes with colleagues.'],
            ['Use the controls', 'Up and Down move the highlight, Select opens or confirms, Back returns. Click the display to use your keyboard instead.'],
            ['Watch for events', 'Alarms, stale data, network loss and handovers appear on cue, exactly as an operator would see them.'],
          ].map(([t, d], i) => (
            <li key={t} className="rounded-[24px] border border-line bg-surface p-6">
              <span className="num text-[13px] text-muted">0{i + 1}</span>
              <h3 className="t-card mt-4">{t}</h3>
              <p className="mt-2 text-[14.5px] leading-relaxed text-text-2">{d}</p>
            </li>
          ))}
        </ol>
        <Link href="/contact?type=demo" className="btn btn-primary btn-lg mt-10">Book a guided demo <ArrowUpRight size={16} aria-hidden /></Link>
      </section>

      <CtaBand title="Want to see it with your tags?" />
    </>
  );
}
