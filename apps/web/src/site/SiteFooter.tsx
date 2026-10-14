import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { Logo } from './Logo';

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
        <div className="stage overflow-hidden px-5 pb-6 pt-12 sm:px-8 lg:px-12 lg:pt-16">
          <h2 id="footer-title" className="sr-only">Site footer</h2>
          <div className="site-grid gap-y-12">
            <div className="col-span-12 lg:col-span-4">
              <Logo />
              <p className="mt-6 max-w-sm text-[15px] leading-relaxed text-text-2">
                Plant context, guided inspections and approved procedures in the operator&apos;s field of view — connected to a secure,
                multi-tenant operations console for wastewater teams.
              </p>
              <Link href="/contact?type=demo" className="btn btn-primary mt-8">
                Request a demo <ArrowUpRight size={16} aria-hidden />
              </Link>
            </div>
            <div className="col-span-12 grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-4 lg:col-span-8">
              {COLUMNS.map((c) => (
                <nav key={c.title} aria-label={c.title}>
                  <h3 className="t-eyebrow">{c.title}</h3>
                  <ul className="mt-4 grid gap-3">
                    {c.links.map((l) => (
                      <li key={l.href}>
                        <Link href={l.href} className="rounded text-[15px] text-text-2 transition-colors hover:text-text">{l.label}</Link>
                      </li>
                    ))}
                  </ul>
                </nav>
              ))}
            </div>
          </div>

          <div className="mt-16 grid gap-3 rounded-[24px] border border-line p-5 text-[13.5px] leading-relaxed text-text-2 md:grid-cols-2 lg:mt-20">
            <p><span className="text-text">Advisory only.</span> Hydris displays plant context and guidance. It never starts, stops or adjusts pumps, valves, blowers or chemical dosing — control stays with your SCADA/PLC and your people.</p>
            <p><span className="text-text">Demonstration data.</span> Website demos run on a deterministic simulator of a reference plant and are isolated from customer tenants. Planned capabilities are labelled as planned.</p>
          </div>

          <p aria-hidden className="t-mega mt-14 select-none whitespace-nowrap text-center text-surface-3 lg:mt-20">
            hydris<span className="text-lime/80">/</span>glasses
          </p>

          <div className="mt-6 flex flex-col gap-3 border-t border-line pt-6 text-[13px] text-muted sm:flex-row sm:items-center sm:justify-between">
            <span>© 2026 Hydris. All rights reserved.</span>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <Link href="/privacy" className="hover:text-text">Privacy</Link>
              <Link href="/technology#security" className="hover:text-text">Security</Link>
              <Link href="/contact" className="hover:text-text">Contact</Link>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
