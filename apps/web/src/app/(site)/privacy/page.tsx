import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { SectionLabel, StatPill } from '@/site/primitives';

export const metadata: Metadata = {
  title: 'Privacy notice',
  description: 'How Hydris handles the personal data you send through the website contact and demo forms: what we collect, why, how long we keep it and how to have it deleted.',
  alternates: { canonical: '/privacy' },
};

const SECTIONS: { t: string; body: ReactNode }[] = [
  { t: 'What we collect', body: <>When you submit the contact or demo form we store the details you enter: name, work email, and optionally organisation, role, phone number, number of sites and your message. We also record the date of your consent and the version of this notice, your browser’s user-agent string, and a salted hash of your IP address. We never store your IP address in readable form.</> },
  { t: 'Why we collect it', body: <>To reply to your enquiry, arrange and prepare a demo, and protect the form against spam and abuse (rate limiting and duplicate detection use the hashed IP address). We do not send marketing emails unless you separately opt in, and we do not sell or share your details with advertisers.</> },
  { t: 'How long we keep it', body: <>Enquiries are kept for up to 24 months after your last contact with us and then deleted. If you become a customer, contract records are kept under separate terms.</> },
  { t: 'Who can see it', body: <>Only Hydris staff who handle sales and support enquiries, and service providers that host our infrastructure under confidentiality and data-processing terms.</> },
  { t: 'Your rights', body: <>You can ask us to access, correct or delete your enquiry data, or to stop contacting you, at any time. Use the <Link href="/contact?type=contact" className="underline underline-offset-4">general enquiry form</Link> with the subject “Delete my data”, or write to privacy@hydris.ai. We will confirm deletion within 30 days.</> },
  { t: 'Product data is separate', body: <>This notice covers the public website only. Plant, operator and device data inside the Hydris platform is governed by the customer agreement for each tenant. Website demos use synthetic data only.</> },
];

export default function PrivacyPage() {
  return (
    <section className="site-container pb-20 pt-10 lg:pb-32 lg:pt-16" aria-labelledby="page-title">
      <SectionLabel className="reveal">Privacy</SectionLabel>
      <div className="site-grid mt-8 gap-y-10">
        <div className="col-span-12 lg:col-span-4">
          <h1 id="page-title" className="t-hero reveal">Privacy notice for enquiries</h1>
          <p className="reveal mt-6 text-[14px] text-muted">Last updated October 2026 · consent version 2026-10</p>
          <div className="reveal mt-10 flex flex-wrap gap-3">
            <StatPill k="Retention" v="24 months" lime />
            <StatPill k="IP address" v="Salted hash only" />
            <StatPill k="Marketing" v="Only if you opt in" />
          </div>
        </div>
        <div className="col-span-12 lg:col-span-7 lg:col-start-6">
          {SECTIONS.map((s, i) => (
            <section key={s.t} className="reveal grid gap-3 border-t border-line py-8 md:grid-cols-7 md:gap-6" aria-labelledby={`privacy-s${i}`}>
              <h2 id={`privacy-s${i}`} className="t-section md:col-span-2">{s.t}</h2>
              <p className="text-[15.5px] leading-relaxed text-text-2 md:col-span-5">{s.body}</p>
            </section>
          ))}
        </div>
      </div>
    </section>
  );
}
