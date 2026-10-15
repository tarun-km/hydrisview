import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { Logo, Wordmark } from './Logo';

const COLUMNS: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: 'Product',
    links: [
      { href: '/product', label: 'Field Glasses overview' },
      { href: '/product#ecosystem', label: 'Hardware & software' },
      { href: '/product#capabilities', label: 'Supported vs planned' },
      { href: '/product#limitations', label: 'Prerequisites & limits' },
      { href: '/demo', label: 'Interactive demo' },
    ],
  },
  {
    title: 'Operations',
    links: [
      { href: '/operations#pump-inspections', label: 'Pump inspections' },
      { href: '/operations#tank-monitoring', label: 'Tank monitoring' },
      { href: '/operations#chemical-dosing', label: 'Chemical dosing' },
      { href: '/operations#sensor-verification', label: 'Sensor verification' },
      { href: '/operations#advisory', label: 'Advisory vs control' },
    ],
  },
  {
    title: 'Technology',
    links: [
      { href: '/technology#pipeline', label: 'Telemetry pipeline' },
      { href: '/technology#pairing', label: 'Device pairing' },
      { href: '/technology#offline', label: 'Offline-tolerant sync' },
      { href: '/technology#security', label: 'Security model' },
      { href: '/technology#roadmap', label: 'Planned: computer vision' },
    ],
  },
  {
    title: 'Company',
    links: [
      { href: '/contact?type=demo', label: 'Request a demo' },
      { href: '/contact?type=contact', label: 'General enquiry' },
      { href: '/login', label: 'Console sign in' },
      { href: '/privacy', label: 'Privacy notice' },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="mt-10 pb-6" aria-labelledby="footer-title">
      <div className="site-container">
        <div className="stage-blue px-5 pb-6 pt-12 sm:px-8 lg:px-12 lg:pt-16">
          <div aria-hidden className="brand-stroke absolute -right-40 -top-24 h-[760px] w-[540px] text-white/25 lg:-right-20" />
          <h2 id="footer-title" className="sr-only">Site footer</h2>
          <div className="relative site-grid gap-y-12">
            <div className="col-span-12 lg:col-span-4">
              <Logo size={36} />
              <p className="mt-6 max-w-sm text-[17px] leading-relaxed text-white">
                Guiding water systems with clarity and confidence.
              </p>
              <p className="mt-3 max-w-sm text-[14.5px] leading-relaxed text-white/80">
                Hydris AI turns operators&apos; hard-won plant knowledge into calm, real-time guidance — in the field of view and in a secure operations console.
              </p>
              <Link href="/contact?type=demo" className="btn btn-light mt-8">
                Request a demo <ArrowUpRight size={16} aria-hidden />
              </Link>
            </div>
            <div className="col-span-12 grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-4 lg:col-span-8">
              {COLUMNS.map((c) => (
                <nav key={c.title} aria-label={c.title}>
                  <h3 className="text-[12px] font-semibold uppercase tracking-[0.16em] text-white/80">{c.title}</h3>
                  <ul className="mt-4 grid gap-3">
                    {c.links.map((l) => (
                      <li key={l.href}>
                        <Link href={l.href} className="rounded text-[15px] text-white/90 underline-offset-4 transition-colors hover:text-white hover:underline">{l.label}</Link>
                      </li>
                    ))}
                  </ul>
                </nav>
              ))}
            </div>
          </div>

          <div className="relative mt-16 grid gap-3 rounded-[24px] border border-white/30 p-5 text-[13.5px] leading-relaxed text-white/85 md:grid-cols-2 lg:mt-20">
            <p><span className="font-semibold text-white">Advisory only.</span> Hydris displays plant context and guidance. It never starts, stops or adjusts pumps, valves, blowers or chemical dosing — control stays with your SCADA/PLC and your people.</p>
            <p><span className="font-semibold text-white">Demonstration data.</span> Website demos run on a deterministic simulator of a reference plant and are isolated from customer tenants. Planned capabilities are labelled as planned.</p>
          </div>

          <div aria-hidden className="relative mt-14 select-none text-white/20 lg:mt-20 [&_svg]:!h-auto [&_svg]:!w-full">
            <Wordmark height={120} />
          </div>

          <div className="relative mt-8 flex flex-col gap-3 border-t border-white/25 pt-6 text-[13px] text-white/85 sm:flex-row sm:items-center sm:justify-between">
            <span>© 2026 Hydris AI. All rights reserved.</span>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <Link href="/privacy" className="hover:text-white hover:underline">Privacy</Link>
              <Link href="/technology#security" className="hover:text-white hover:underline">Security</Link>
              <Link href="/contact" className="hover:text-white hover:underline">Contact</Link>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
