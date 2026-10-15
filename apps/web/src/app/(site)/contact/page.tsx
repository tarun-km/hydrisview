import type { Metadata } from 'next';
import Link from 'next/link';
import { ContactForm } from '@/site/ContactForm';
import { HlPill, SectionLabel } from '@/site/primitives';

export const metadata: Metadata = {
  title: 'Contact & demo request',
  description: 'Request a Hydris Field Glasses demo or send a general enquiry. We reply within two working days and use your details only to respond.',
  alternates: { canonical: '/contact' },
};

export default async function ContactPage({ searchParams }: { searchParams: Promise<{ type?: string | string[] }> }) {
  const sp = await searchParams;
  const type = Array.isArray(sp.type) ? sp.type[0] : sp.type;
  const initialKind = type === 'contact' ? 'contact' : 'demo';
  return (
    <section className="site-container pb-20 pt-10 lg:pb-32 lg:pt-16" aria-labelledby="page-title">
      <div className="site-grid gap-y-12">
        <div className="col-span-12 lg:col-span-5">
          <SectionLabel className="reveal">Contact</SectionLabel>
          <h1 id="page-title" className="t-hero reveal mt-8">
            Let’s look at <HlPill tone="lime">your</HlPill> plant together.
          </h1>
          <p className="reveal mt-6 max-w-md text-[16px] leading-relaxed text-text-2">
            Tell us about your sites and how operators work today. A demo takes about 30 minutes: the glasses viewport, the Operator Console, and how your
            gateway data would reach both — with available and planned capabilities kept clearly apart.
          </p>
          <div className="reveal mt-10 grid gap-3">
            <div className="rounded-[24px] bg-paper p-6 text-ink">
              <h2 className="t-card">How we use your details</h2>
              <ul className="mt-3 grid gap-2 text-[14px] leading-relaxed text-ink-2">
                <li>Stored securely so we can follow up on this enquiry.</li>
                <li>No marketing emails unless you separately opt in.</li>
                <li>Kept for up to 24 months, then deleted. Ask us to delete them sooner at any time.</li>
              </ul>
              <Link href="/privacy" className="mt-4 inline-block rounded text-[14px] underline underline-offset-4">Read the privacy notice</Link>
            </div>
          </div>
        </div>
        <div className="reveal col-span-12 lg:col-span-6 lg:col-start-7">
          <div className="rounded-[28px] border border-line bg-surface p-5 sm:p-8 lg:p-10">
            <ContactForm initialKind={initialKind} />
          </div>
        </div>
      </div>
    </section>
  );
}
