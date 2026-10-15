import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { GlassesArt } from '@/site/art';
import { CapabilityMatrix } from '@/site/sections';
import { CtaBand, HlPill, PageIntro, SectionLabel, StatPill } from '@/site/primitives';
import { ConsoleMock, DeviceFrame, GlassesScreen, HudAlert, HudReading, HudSop, LaptopFrame } from '@/site/vignettes';

export const metadata: Metadata = {
  title: 'Product',
  description:
    'What Hydris Field Glasses is: a 600 × 600 glasses viewport for wastewater operators, connected to a multi-tenant Operator Console. Supported vs planned capabilities, hardware ecosystem, prerequisites and limitations.',
  alternates: { canonical: '/product' },
};

const ECOSYSTEM = [
  { k: 'Target hardware', v: 'Meta Ray-Ban Display class', d: 'Monocular in-lens display, roughly 600 × 600, with neural-band or touch input where the device supports it.', status: 'Planned adapter' },
  { k: 'Today', v: 'Web viewport', d: 'The glasses experience runs as a 600 × 600 web viewport in a browser, driven by four inputs: up, down, select, back.', status: 'Available' },
  { k: 'Training & demos', v: 'Browser simulator', d: 'The same viewport on any desktop, against a deterministic simulator of a reference plant — isolated from customer data.', status: 'Available' },
  { k: 'Back office', v: 'Operator Console', d: 'A secure, multi-tenant web console for sites, assets, sensors, alarms, inspections, maintenance, operators and the glasses fleet.', status: 'Available' },
];

const FLOW = [
  { n: '01', t: 'The plant reports', d: 'An edge gateway posts sensor readings over HTTPS. Lab and manual readings are entered in the console.' },
  { n: '02', t: 'The platform qualifies', d: 'Readings are validated, normalised and stored per tenant. Alarm rules are evaluated with deadband and on-delay.' },
  { n: '03', t: 'Context is scoped', d: 'Each pair of glasses is assigned to one operator with site-scoped permissions. Only their sites, tasks and approved documents are sent.' },
  { n: '04', t: 'The operator sees it at the asset', d: 'Live values with freshness, the next round step, cautions and alarm interrupts — over a realtime stream.' },
];

const ENVIRONMENTS = [
  { t: 'Effluent treatment plants (ETP)', d: 'Industrial parks and single-site manufacturers: equalization, neutralisation, biological treatment, discharge monitoring.' },
  { t: 'Sewage treatment plants (STP)', d: 'Municipal and campus plants: screening, aeration, clarification, sludge handling, disinfection.' },
  { t: 'Water treatment plants (WTP)', d: 'Coagulation and flocculation, filtration, chemical dosing, clear-water storage and distribution pumping.' },
];

const LIMITS = [
  { t: 'Advisory, not control', d: 'Hydris never writes to SCADA, PLCs or field devices. Control actions remain with your control system, procedures and permits.' },
  { t: 'Network coverage', d: 'Live context needs Wi-Fi or cellular at least intermittently. Offline, the viewport flags staleness and queues inspection steps until it reconnects.' },
  { t: 'Data source', d: 'Live telemetry requires an edge gateway able to make HTTPS requests (or manual entry). MQTT and OPC UA adapters are planned, not available.' },
  { t: 'Hardware certification', d: 'Hazardous-area (ATEX / IECEx) suitability depends on the device you choose. Hydris does not certify hardware; follow your site safety rules.' },
  { t: 'Native device support', d: 'Native packaging for Meta Ray-Ban Display class glasses is a planned adapter. Today, the experience runs in a browser viewport and simulator.' },
  { t: 'Not a replacement for training', d: 'Guidance supports qualified operators following your approved procedures. It does not replace competence, supervision or lockout / tagout.' },
];

export default function ProductPage() {
  return (
    <>
      <PageIntro
        tags={['Glasses viewport', 'Operator Console', 'Fleet']}
        label="Product"
        title={<>A field of view that knows <HlPill tone="lime">which</HlPill> asset you are standing at.</>}
        lead="Hydris Field Glasses is two things working together: a glasses viewport that gives operators live plant context, rounds and approved procedures hands-free, and an Operator Console where supervisors manage sites, assets, alarms, inspections and the glasses fleet."
        aside={
          <div className="flex flex-wrap gap-3">
            <StatPill k="Display canvas" v="600 × 600" lime />
            <StatPill k="Inputs" v="Up · Down · Select · Back" />
            <StatPill k="Control commands" v="None — advisory" />
          </div>
        }
      >
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/demo" className="btn btn-primary btn-lg">Try the viewport <ArrowUpRight size={16} aria-hidden /></Link>
          <Link href="/contact?type=demo" className="btn btn-outline btn-lg">Request a demo</Link>
        </div>
      </PageIntro>

      <section className="site-container" aria-label="Product overview visual">
        <div className="stage-blue stage-deep reveal">
          <div aria-hidden className="brand-stroke absolute -right-32 -top-48 h-[900px] w-[640px] text-white/20" />
          <div className="relative grid gap-10 px-4 py-12 sm:px-8 lg:grid-cols-12 lg:items-center lg:px-12 lg:py-16">
            <div className="lg:col-span-7">
              <GlassesArt className="h-auto w-full max-w-[620px] text-white/85" />
            </div>
            <div className="grid grid-cols-2 gap-4 lg:col-span-5">
              <DeviceFrame className="!rounded-[26px] !p-2.5">
                <GlassesScreen label="Glasses showing tank level 87 percent, high" header="T-101 · Equalization" status="High" statusTone="high">
                  <HudReading tag="LT-101" name="Tank level" value="87" unit="%" tone="high" state="High" limit="High 85" />
                </GlassesScreen>
              </DeviceFrame>
              <DeviceFrame className="mt-10 !rounded-[26px] !p-2.5">
                <GlassesScreen label="Glasses showing a critical low dissolved oxygen alarm" header="AB-201 · Aeration" status="Alarm" statusTone="critical">
                  <HudAlert severity="critical" title="DO-201 low-low" detail="0.5 mg/L · BL-102 not running" action="Open SOP" />
                </GlassesScreen>
              </DeviceFrame>
            </div>
          </div>
        </div>
      </section>

      <section id="ecosystem" className="site-container site-section scroll-mt-28" aria-labelledby="eco-title">
        <SectionLabel className="reveal" index="01">Hardware & software ecosystem</SectionLabel>
        <h2 id="eco-title" className="t-hero reveal mt-6 max-w-[20ch]">Built for display glasses. <span className="text-muted">Runs in a browser today.</span></h2>
        <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {ECOSYSTEM.map((e, i) => (
            <article key={e.k} className={`reveal reveal-d${i} flex min-h-[280px] flex-col rounded-[28px] p-6 ${i === 1 ? 'bg-lime text-lime-ink' : i === 3 ? 'bg-paper text-ink' : 'border border-line bg-surface'}`}>
              <div className="flex items-center justify-between gap-3 text-[13px]">
                <span className="opacity-70">{e.k}</span>
                <span className={`rounded-full px-3 py-1 ${e.status === 'Available' ? (i === 1 ? 'bg-white text-[#1746e4]' : i === 3 ? 'bg-[#1746e4] text-white' : 'chip-ok border') : 'border border-dashed border-line-2 text-text-2'}`}>{e.status}</span>
              </div>
              <h3 className="t-section mt-auto pt-10">{e.v}</h3>
              <p className="mt-3 text-[14.5px] leading-relaxed opacity-80">{e.d}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="site-container site-section-tight" aria-labelledby="flow-title">
        <div className="stage-paper px-5 py-14 sm:px-10 lg:px-14 lg:py-24">
          <SectionLabel className="reveal" index="02">How context reaches operators</SectionLabel>
          <h2 id="flow-title" className="t-hero reveal mt-6 max-w-[18ch]">From sensor to sightline in four moves.</h2>
          <ol className="mt-14">
            {FLOW.map((f) => (
              <li key={f.n} className="reveal grid gap-3 border-t border-ink/15 py-7 md:grid-cols-12 md:gap-5">
                <span className="num text-[14px] text-ink-2 md:col-span-1">/{f.n}</span>
                <h3 className="text-[22px] leading-snug tracking-[-0.02em] md:col-span-4">{f.t}</h3>
                <p className="text-[16px] leading-relaxed text-ink-2 md:col-span-6 md:col-start-7">{f.d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="site-container site-section" aria-labelledby="console-title">
        <div className="grid gap-12 lg:grid-cols-12 lg:items-center">
          <div className="lg:col-span-4">
            <SectionLabel className="reveal" index="03">Relation to the console</SectionLabel>
            <h2 id="console-title" className="t-hero reveal mt-6">Plan and review in the console. Execute in the field.</h2>
            <ul className="reveal mt-8 grid gap-3 text-[15px] text-text-2">
              {['Supervisors build inspection templates and routes, then dispatch them', 'Pairing is approved by an authorised person in the console', 'Alarms are acknowledged, investigated and resolved with notes', 'Submitted inspections are approved or returned with comments', 'Devices can be reassigned, suspended or revoked at any time'].map((t) => (
                <li key={t} className="flex gap-3"><span className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-lime" aria-hidden />{t}</li>
              ))}
            </ul>
          </div>
          <div className="reveal lg:col-span-8">
            <LaptopFrame label="Operator Console overview for the reference plant with alarms, inspections and connected glasses"><ConsoleMock /></LaptopFrame>
          </div>
        </div>
      </section>

      <section id="capabilities" className="site-container site-section-tight scroll-mt-28" aria-labelledby="matrix-title">
        <div className="site-grid gap-y-6">
          <div className="col-span-12 lg:col-span-7">
            <SectionLabel className="reveal" index="04">Supported vs planned</SectionLabel>
            <h2 id="matrix-title" className="t-hero reveal mt-6">Exactly what you get today.</h2>
          </div>
          <p className="reveal col-span-12 self-end text-[16px] leading-relaxed text-text-2 lg:col-span-4 lg:col-start-9">Anything marked planned is not available in the current release, and we will not demonstrate it as if it were.</p>
        </div>
        <div className="reveal mt-12"><CapabilityMatrix /></div>
      </section>

      <section className="site-container site-section" aria-labelledby="env-title">
        <div className="grid gap-12 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <SectionLabel className="reveal" index="05">Typical environments</SectionLabel>
            <h2 id="env-title" className="t-hero reveal mt-6">Wherever water gets treated.</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-3 lg:col-span-8">
            {ENVIRONMENTS.map((e, i) => (
              <article key={e.t} className={`reveal reveal-d${i} rounded-[28px] border border-line bg-surface p-6`}>
                <h3 className="t-card">{e.t}</h3>
                <p className="mt-3 text-[14.5px] leading-relaxed text-text-2">{e.d}</p>
              </article>
            ))}
            <DeviceFrame className="reveal md:col-span-3 md:mx-auto md:w-[340px]">
              <GlassesScreen label="Glasses showing an approved SOP for a dosing pump diaphragm check" header="DP-301 · Dosing" status="SOP" statusTone="lime">
                <HudSop code="SOP-DOS-04 · rev 3" title="Diaphragm check" current={2} steps={['Confirm permit & isolation', 'Relieve line pressure', 'Inspect diaphragm for cracks', 'Record stroke setting']} />
              </GlassesScreen>
            </DeviceFrame>
          </div>
        </div>
      </section>

      <section id="limitations" className="site-container site-section-tight scroll-mt-28" aria-labelledby="limits-title">
        <SectionLabel className="reveal" index="06">Prerequisites & limitations</SectionLabel>
        <h2 id="limits-title" className="t-hero reveal mt-6 max-w-[20ch]">What Hydris needs — and what it does not do.</h2>
        <ul className="mt-12 grid gap-x-10 md:grid-cols-2">
          {LIMITS.map((l) => (
            <li key={l.t} className="reveal grid gap-2 border-t border-line py-6">
              <h3 className="text-[20px] tracking-[-0.02em]">{l.t}</h3>
              <p className="text-[14.5px] leading-relaxed text-muted">{l.d}</p>
            </li>
          ))}
        </ul>
      </section>

      <CtaBand />
    </>
  );
}
