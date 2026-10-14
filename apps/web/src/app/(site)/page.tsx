import type { Metadata } from 'next';
import Link from 'next/link';
import clsx from 'clsx';
import { ArrowUpRight, Zap } from 'lucide-react';
import { ContourField, GlassesArt, RealityIcon } from '@/site/art';
import { PlatformDiagram } from '@/site/diagrams';
import { DemoStudio, HeroGlassesPreview } from '@/site/LiveGlasses';
import { ArrowCircle, CtaBand, HlIcon, HlPill, SectionLabel, StatPill } from '@/site/primitives';
import { Faq, IntegrationTable, RoadmapBlock, SafetyBlock, WorkflowStepper } from '@/site/sections';
import { ConsoleMock, DeviceFrame, GlassesScreen, HudList, HudReading, HudStep, LaptopFrame } from '@/site/vignettes';

export const metadata: Metadata = {
  title: { absolute: 'Hydris Field Glasses — live plant context in the operator’s field of view' },
  description:
    'Smart-glasses guidance for wastewater operators at ETPs, STPs and WTPs: live telemetry, guided inspections, alarms and approved SOPs in view, managed from a secure multi-tenant Operator Console. Advisory only.',
  alternates: { canonical: '/' },
};

export default function HomePage() {
  return (
    <>
      <Hero />
      <ValueProposition />
      <FrontlineContext />
      <DemoSection />
      <Capabilities />
      <UseCases />
      <ConnectedPlatform />
      <Workflow />
      <Intelligence />
      <section className="site-container site-section" aria-labelledby="safety-title"><SafetyBlock /></section>
      <Architecture />
      <Roadmap />
      <section className="site-container site-section-tight" aria-label="Frequently asked questions">
        <Faq
          title="Straight answers to common questions"
          intro="If you run a plant and want to know whether Hydris fits, these are the questions operations leads ask first."
          action={<Link href="/contact" className="btn bg-ink text-paper hover:bg-black">Ask our team <ArrowUpRight size={16} aria-hidden /></Link>}
          items={[
            { q: 'Can Hydris start, stop or adjust equipment?', a: 'No. Hydris is advisory only. It has no write path to SCADA, PLCs, pumps, valves, blowers or dosing systems. It shows context and records what operators observe and do.' },
            { q: 'Which glasses does it run on today?', a: 'Today the glasses experience runs as a 600 × 600 web viewport, with a browser simulator for training and demos. A native adapter for Meta Ray-Ban Display class monocular glasses is planned; we will confirm hardware support with you before any rollout.' },
            { q: 'How does plant data get in?', a: 'An edge gateway posts readings to Hydris over HTTPS with a per-site API key. Manual and lab readings can be entered in the console. MQTT and OPC UA adapters are planned, not available yet.' },
            { q: 'What happens when Wi-Fi drops on the round?', a: 'The viewport shows that it is offline and how fresh each value is. Inspection steps are queued on the device and synchronised in order when it reconnects.' },
          ]}
        />
      </section>
      <CtaBand />
    </>
  );
}

/* ---------------------------------------------------------------- Hero */
function Hero() {
  return (
    <section className="site-container pt-6 lg:pt-12" aria-labelledby="hero-title">
      <div className="reveal flex flex-wrap items-center gap-2">
        <span className="chip chip-outline">ETP · STP · WTP operations</span>
        <span className="chip chip-outline"><span className="dot bg-lime" aria-hidden /> Advisory only — never actuates</span>
      </div>
      <h1 id="hero-title" className="t-display reveal mt-8 max-w-[17ch] lg:mt-10">
        Your plant, <HlPill tone="lime" icon={<span className="h-[0.16em] w-[0.16em] rounded-full bg-lime-ink" aria-hidden />}>live</HlPill> in the operator’s field of view — rounds, alarms and <HlPill tone="surface">SOP</HlPill> approved procedures, hands-free.
      </h1>

      <div className="site-grid mt-10 gap-y-10 lg:mt-14">
        <div className="reveal reveal-d1 col-span-12 md:col-span-6 lg:col-span-5">
          <p className="t-lead text-text-2">
            Hydris Field Glasses puts live telemetry, guided inspections and approved SOPs on a monocular display, so wastewater operators keep their eyes on the
            equipment and their hands on the job. Supervisors run sites, assets, alarms and the glasses fleet from a secure Operator Console.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/contact?type=demo" className="btn btn-primary btn-lg">Request a demo <ArrowUpRight size={16} aria-hidden /></Link>
            <Link href="/demo" className="btn btn-outline btn-lg">Try the live viewport</Link>
          </div>
        </div>
        <div className="reveal reveal-d2 col-span-12 flex flex-col items-start gap-3 md:col-span-6 md:items-end lg:col-span-6 lg:col-start-7">
          <div className="flex flex-wrap gap-3 md:justify-end">
            <StatPill k="Control commands sent" v="0 — advisory" lime />
            <StatPill k="Display canvas" v="600 × 600" />
          </div>
          <div className="flex flex-wrap gap-3 md:justify-end">
            <StatPill k="Inputs" v="4 buttons" />
            <StatPill k="Pairing code" v="5 min, single-use" />
            <StatPill k="Scenarios" v="10" />
          </div>
        </div>
      </div>

      {/* Stage: contour field, glasses line-art, live viewport */}
      <div className="stage reveal relative mt-14 overflow-hidden lg:mt-20">
        <ContourField className="absolute inset-0 h-full w-full text-[#3b3d39]" cx={360} cy={360} rings={18} />
        <div className="relative grid gap-12 px-4 pb-16 pt-10 sm:px-8 lg:grid-cols-12 lg:items-center lg:px-12 lg:py-16">
          <div className="lg:col-span-7">
            <div className="flex items-center gap-3 text-[13px] text-muted">
              <span className="dot pulse-dot bg-ok" aria-hidden /> Riverbend Industrial Park · ETP-01 · synthetic reference plant
            </div>
            <GlassesArt className="mt-8 h-auto w-full max-w-[640px] text-[#8b8d88]" />
            <div className="mt-8 grid max-w-[620px] grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="float-y rounded-[24px] bg-paper p-5 text-ink shadow-[var(--shadow-2)]">
                <div className="flex items-center justify-between text-[13px] text-ink-2"><span>VT-101 · Transfer pump P-101</span><span className="dot bg-high" aria-hidden /></div>
                <div className="mt-3 flex items-baseline gap-2"><span className="t-kpi">5.6</span><span className="text-[14px] text-ink-2">mm/s</span></div>
                <div className="mt-2 text-[13px] text-ink-2">High limit 4.5 · rising for 4 min</div>
              </div>
              <div className="rounded-[24px] bg-lime p-5 text-lime-ink">
                <div className="text-[13px] text-lime-ink/70">Morning round</div>
                <div className="mt-3 t-kpi">3<span className="text-[22px] text-lime-ink/60"> / 7</span></div>
                <div className="mt-2 text-[13px] text-lime-ink/75">Next: aeration blower BL-102</div>
              </div>
            </div>
          </div>
          <div className="mx-auto w-full max-w-[420px] pb-6 lg:col-span-5">
            <HeroGlassesPreview scenario="pump_vibration" />
            <p className="mt-12 text-center text-[12.5px] text-muted">Live viewport · synthetic data · use the buttons</p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------- Value proposition */
const PROBLEMS = [
  { p: 'Operators walk the plant without live data; the numbers are on a screen in the control room.', s: 'The asset in front of them shows its live readings, limits and how fresh each value is.' },
  { p: 'Checklists are completed from memory at the end of the shift.', s: 'Each step is captured where it happens, with timestamps and range checks.' },
  { p: 'The current SOP revision sits in a binder — or nobody is sure which one is current.', s: 'Only approved procedure revisions reach the glasses, one step at a time.' },
];

function ValueProposition() {
  return (
    <section className="site-container site-section-tight" aria-labelledby="value-title">
      <div className="stage-paper px-5 py-14 sm:px-10 lg:px-14 lg:py-24">
        <SectionLabel className="reveal">What is Hydris Field Glasses?</SectionLabel>
        <h2 id="value-title" className="t-statement reveal mt-10 max-w-[24ch] lg:mt-16">
          <span className="pl-[1.6em]" /> An <span className="hl-underline">operational layer</span> for wastewater plants that turns <HlIcon className="bg-ink text-paper"><Zap fill="currentColor" strokeWidth={0} /></HlIcon> live telemetry, rounds and approved procedures into <HlPill tone="lime">glanceable</HlPill> guidance on the move.
        </h2>
        <div className="site-grid mt-12 gap-y-10 lg:mt-16">
          <div className="reveal col-span-12 flex flex-wrap content-start gap-2.5 lg:col-span-5 lg:col-start-8">
            {['ETP', 'STP', 'WTP', 'Pumps & blowers', 'Chemical dosing', 'Analyzers', 'Rounds'].map((t) => <span key={t} className="tag-pill">{t}</span>)}
            <p className="mt-6 text-[16px] leading-relaxed text-ink-2">
              Built for effluent, sewage and water treatment teams who need the right number at the right asset — without a tablet in a gloved hand or a
              trip back to the control room.
            </p>
          </div>
        </div>
        <ol className="mt-16 lg:mt-24">
          {PROBLEMS.map((r, i) => (
            <li key={i} className="reveal grid gap-4 border-t border-ink/15 py-7 md:grid-cols-12 md:gap-5">
              <span className="num text-[14px] text-ink-2 md:col-span-1">/0{i + 1}</span>
              <p className="text-[17px] leading-snug text-ink-2 md:col-span-5">{r.p}</p>
              <p className="text-[19px] leading-snug tracking-[-0.01em] md:col-span-6"><span className="mr-2 inline-block h-2 w-2 -translate-y-0.5 rounded-full bg-ink" aria-hidden />{r.s}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* --------------------------------------------- Industrial context */
const REALITIES = [
  { k: 'noise' as const, t: 'Loud blower halls', d: 'No reliance on sound. Alarms arrive as colour, severity and plain text.' },
  { k: 'wet' as const, t: 'Wet decks & splash zones', d: 'Information comes to the eye, so hands stay on rails, valves and tools.' },
  { k: 'gloves' as const, t: 'Gloved hands', d: 'Four inputs only — up, down, select, back — with large targets and a thick focus ring.' },
  { k: 'rounds' as const, t: 'Long rounds', d: 'Ordered routes with asset-by-asset context; what is due next is one glance away.' },
  { k: 'permit' as const, t: 'Permits & isolation', d: 'Caution notes appear before the step. Hydris records — it never authorises isolation.' },
  { k: 'light' as const, t: 'Glare & night shifts', d: 'Pure-black UI for additive displays; type sized for a 600 × 600 canvas.' },
];

function FrontlineContext() {
  return (
    <section className="site-container site-section" aria-labelledby="context-title">
      <div className="site-grid gap-y-12">
        <div className="col-span-12 lg:col-span-4">
          <SectionLabel className="reveal" index="01">Frontline realities</SectionLabel>
          <h2 id="context-title" className="t-hero reveal mt-8">Designed for the plant floor, not the office.</h2>
          <p className="reveal mt-6 max-w-md text-[16px] leading-relaxed text-text-2">
            Treatment plants are noisy, wet and spread out. Work happens in gloves, on rounds, under permits. Every interaction in Hydris is shaped by those
            constraints first.
          </p>
          <Link href="/operations" className="btn btn-primary reveal mt-10">Wastewater operations <ArrowUpRight size={16} aria-hidden /></Link>
        </div>
        <ul className="col-span-12 grid sm:grid-cols-2 lg:col-span-7 lg:col-start-6 lg:grid-cols-3">
          {REALITIES.map((r, i) => (
            <li key={r.t} className={clsx('reveal border-line p-6 lg:p-8', 'border-t sm:[&:nth-child(-n+2)]:border-t-0 lg:[&:nth-child(-n+3)]:border-t-0', 'sm:[&:nth-child(odd)]:border-r lg:[&:nth-child(odd)]:border-r-0 lg:[&:not(:nth-child(3n))]:border-r', `reveal-d${i % 3}`)}>
              <span className="text-text-2"><RealityIcon kind={r.k} /></span>
              <h3 className="t-section mt-8">{r.t}</h3>
              <p className="mt-3 text-[14.5px] leading-relaxed text-muted">{r.d}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ------------------------------------------------------- Demo */
function DemoSection() {
  return (
    <section className="site-container site-section-tight" aria-labelledby="demo-title">
      <div className="stage px-4 py-12 sm:px-8 lg:px-12 lg:py-20">
        <SectionLabel className="reveal" index="02">Interactive demonstration</SectionLabel>
        <h2 id="demo-title" className="t-hero reveal mt-6 max-w-[18ch]">
          Press a button. <span className="text-muted">Watch the</span> plant <HlPill tone="lime">respond</HlPill>
        </h2>
        <p className="reveal mt-5 max-w-2xl text-[16px] leading-relaxed text-text-2">
          This is the real glasses viewport, running against a deterministic simulator of a reference effluent treatment plant. Pick a scenario — a pump
          vibrating, a tank filling, a blower tripping — and step through it with the same four inputs an operator has.
        </p>
        <div className="mt-12">
          <DemoStudio variant="compact" initial="pump_vibration" />
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------- Capabilities */
function CapLink({ href, label, tone = 'light' }: { href: string; label: string; tone?: 'light' | 'ink' | 'dark' }) {
  return (
    <Link href={href} aria-label={label} className="group rounded-full">
      <ArrowCircle tone={tone} />
    </Link>
  );
}

function Capabilities() {
  return (
    <section className="site-container site-section" aria-labelledby="cap-title">
      <div className="site-grid gap-y-8">
        <div className="col-span-12 lg:col-span-8">
          <SectionLabel className="reveal" index="03">Core capabilities</SectionLabel>
          <h2 id="cap-title" className="t-statement reveal mt-8">Six capabilities, one <HlPill tone="outline">calm</HlPill> field of view.</h2>
        </div>
        <p className="reveal col-span-12 self-end text-[16px] leading-relaxed text-text-2 lg:col-span-4">
          Each one works on its own in the console, and comes together on the glasses as a single, quiet view of what matters at the asset in front of you.
        </p>
      </div>

      <div className="mt-14 grid gap-4 md:grid-cols-6 lg:mt-20 lg:grid-cols-12">
        {/* Contextual telemetry */}
        <article className="reveal flex flex-col rounded-[32px] bg-paper p-6 text-ink md:col-span-6 lg:col-span-5 lg:row-span-2 lg:p-8">
          <div className="flex items-start justify-between gap-4">
            <span className="inline-flex h-11 items-center gap-2 rounded-full border border-ink/15 px-4 text-[15px]"><Zap size={15} fill="currentColor" strokeWidth={0} aria-hidden /> Contextual telemetry</span>
            <CapLink href="/technology#pipeline" label="How telemetry reaches the glasses" tone="ink" />
          </div>
          <div className="mt-10 flex items-baseline gap-3"><span className="text-[72px] font-light leading-none tracking-[-0.05em] lg:text-[96px]">2.2</span><span className="text-[18px] text-ink-2">mg/L DO</span></div>
          <div className="mt-8 flex h-40 items-end gap-2" aria-hidden>
            {[0.55, 0.42, 0.62, 0.8, 0.66, 0.38, 0.58, 0.72, 1].map((h, i, a) => (
              <div key={i} className="flex h-full flex-1 flex-col justify-end rounded-full bg-ink/[0.07]">
                <div className={clsx('rounded-full', i === a.length - 1 ? 'bg-lime' : 'bg-ink')} style={{ height: `${h * 70}%` }} />
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-between text-[12px] text-ink-2" aria-hidden><span>06:00</span><span>09:00</span><span>now</span></div>
          <p className="mt-auto pt-8 text-[15px] leading-relaxed text-ink-2">
            Readings for the asset you are standing at — with units, limits and a freshness state on every value: live, delayed, stale or no data.
          </p>
        </article>

        <CapCard className="md:col-span-3 lg:col-span-4" title="Guided inspections" href="/operations#pump-inspections"
          body="Templates with check, reading, choice and text steps. Expected ranges flag abnormal values as they are entered; supervisors approve or return." />
        <CapCard className="md:col-span-3 lg:col-span-3" tone="lime" title="Alarm awareness" href="/operations#fault-documentation"
          body="Threshold rules with deadband and on-delay cut chatter. Critical alarms interrupt the view; acknowledgement and follow-up live in the console." />
        <CapCard className="md:col-span-3 lg:col-span-3" title="Approved SOP assistance" href="/operations#sop-guidance"
          body="Procedures linked to the asset or asset type. Operators and devices only ever see approved revisions." />
        <CapCard className="md:col-span-3 lg:col-span-4" tone="paper-outline" title="Secure pairing & fleet" href="/technology#pairing"
          body="QR plus an 8-character code — single-use, expires in 5 minutes. Assign, suspend or revoke any pair of glasses from the console." />
        <CapCard className="md:col-span-6 lg:col-span-7" title="Offline-tolerant sync" href="/technology#offline" wide
          body="Plants have dead spots. When the network drops the view says so, values show their age, and inspection steps queue locally and sync in order on reconnect." />
      </div>
    </section>
  );
}

function CapCard({ title, body, href, tone = 'dark', className, wide }: { title: string; body: string; href: string; tone?: 'dark' | 'lime' | 'paper-outline'; className?: string; wide?: boolean }) {
  return (
    <article className={clsx('reveal flex min-h-[240px] flex-col rounded-[32px] p-6 lg:p-8', tone === 'dark' && 'border border-line bg-surface', tone === 'lime' && 'bg-lime text-lime-ink', tone === 'paper-outline' && 'border border-line-2 bg-bg-2', className)}>
      <div className="flex items-start justify-between gap-4">
        <h3 className="t-section max-w-[14ch]">{title}</h3>
        <CapLink href={href} label={`More about ${title.toLowerCase()}`} tone={tone === 'lime' ? 'ink' : 'light'} />
      </div>
      <p className={clsx('mt-auto pt-8 text-[15px] leading-relaxed', tone === 'lime' ? 'text-lime-ink/75' : 'text-text-2', wide && 'max-w-[60ch]')}>{body}</p>
    </article>
  );
}

/* ------------------------------------------------------ Use cases */
function UseCases() {
  const cards = [
    {
      href: '/operations#pump-inspections', title: 'Transfer-pump rounds at the equalization tank', meta: 'ETP · Equalization · P-101',
      screen: <GlassesScreen label="Glasses showing P-101 vibration 5.6 mm/s, high alarm" header="P-101 · Transfer pump" status="High" statusTone="high"><HudReading tag="VT-101" name="Vibration (DE bearing)" value="5.6" unit="mm/s" tone="high" state="High" limit="Limit 4.5" /></GlassesScreen>,
    },
    {
      href: '/operations#tank-monitoring', title: 'Dissolved-oxygen checks before the blower hall', meta: 'STP · Aeration · AB-201', featured: true,
      screen: <GlassesScreen label="Glasses showing DO-201 dissolved oxygen 1.1 mg/L, low" header="AB-201 · Aeration basin 1" status="Low" statusTone="high"><HudReading tag="DO-201" name="Dissolved oxygen" value="1.1" unit="mg/L" tone="high" state="Low" limit="Low 1.2" foot="BL-102 motor current 0.0 A — check blower" /></GlassesScreen>,
    },
    {
      href: '/operations#chemical-dosing', title: 'Coagulant dosing and filtration observations', meta: 'WTP · Dosing · DP-301',
      screen: <GlassesScreen label="Glasses showing a dosing pump inspection step" header="DP-301 · Coagulant dosing" status="Step 3/6" statusTone="lime"><HudStep step="Step 3 of 6" kind="Reading" title="Calibration column drawdown" options={['Within 0.38–0.46 L/h', 'Outside range', 'Not possible']} /></GlassesScreen>,
    },
  ];
  return (
    <section className="site-container site-section" aria-labelledby="usecases-title">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <SectionLabel className="reveal" index="04">Wastewater use cases</SectionLabel>
          <h2 id="usecases-title" className="t-hero reveal mt-6 max-w-[16ch]">Where the glasses earn their place</h2>
        </div>
        <Link href="/operations" className="btn btn-outline reveal">All operations <ArrowUpRight size={16} aria-hidden /></Link>
      </div>
      <div className="mt-14 grid gap-6 md:grid-cols-3 md:items-start">
        {cards.map((c, i) => (
          <article key={c.title} className={clsx('group reveal relative', `reveal-d${i}`, c.featured && 'md:mt-16')}>
            <div className={clsx('lift rounded-[32px] p-8 lg:p-10', c.featured ? 'bg-paper' : 'border border-line bg-surface')}>
              <div className="mx-auto max-w-[300px]">{c.screen}</div>
            </div>
            <div className="mt-6 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-[20px] leading-snug tracking-[-0.02em]">
                  <Link href={c.href} className="rounded after:absolute after:inset-0 after:content-['']">{c.title}</Link>
                </h3>
                <p className="mt-2 text-[13px] text-muted">{c.meta}</p>
              </div>
              <ArrowCircle tone="lime" className="!h-9 !w-9" />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

/* --------------------------------------------- Connected platform */
function ConnectedPlatform() {
  return (
    <section className="site-container site-section-tight" aria-labelledby="platform-title">
      <div className="stage px-4 py-12 sm:px-8 lg:px-12 lg:py-20">
        <div className="site-grid gap-y-8">
          <div className="col-span-12 lg:col-span-7">
            <SectionLabel className="reveal" index="05">Connected platform</SectionLabel>
            <h2 id="platform-title" className="t-hero reveal mt-6">Glasses, console and edge gateways — <span className="text-muted">one live picture.</span></h2>
          </div>
          <p className="reveal col-span-12 self-end text-[16px] leading-relaxed text-text-2 lg:col-span-4 lg:col-start-9">
            Gateways push readings in. The platform validates, stores and evaluates them, then streams the right context to the right people and devices.
            Nothing flows back to the equipment.
          </p>
        </div>
        <div className="reveal mt-12 lg:mt-16"><PlatformDiagram /></div>
        <div className="mt-16 grid gap-10 lg:mt-24 lg:grid-cols-12 lg:items-end">
          <div className="reveal lg:col-span-8">
            <LaptopFrame label="Operator Console overview for the reference plant: open alarms, inspections due, connected glasses and a plant map"><ConsoleMock /></LaptopFrame>
            <p className="mt-6 text-[14px] text-muted"><span className="text-text">Operator Console</span> — plan rounds, triage alarms, review inspections and manage the fleet.</p>
          </div>
          <div className="reveal reveal-d1 mx-auto w-full max-w-[340px] lg:col-span-4">
            <DeviceFrame>
              <GlassesScreen label="Glasses showing the next three assets on the morning round" header="Morning round · ETP-01" status="Live">
                <HudList title="Next on your round" focus={0} items={[{ label: 'BL-102 blower', meta: 'Due', tone: 'lime' }, { label: 'AB-201 basin', meta: '2 steps', tone: 'ok' }, { label: 'DP-301 dosing', meta: 'SOP', tone: 'medium' }]} />
              </GlassesScreen>
            </DeviceFrame>
            <p className="mt-6 text-[14px] text-muted"><span className="text-text">Field Glasses</span> — execute in the field, hands-free.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------- Workflow */
function Workflow() {
  return (
    <section className="site-container site-section-tight" aria-labelledby="workflow-title">
      <div className="stage-paper px-5 py-14 sm:px-10 lg:px-14 lg:py-24">
        <div className="site-grid gap-y-6">
          <div className="col-span-12 lg:col-span-6">
            <SectionLabel className="reveal" index="06">Operator workflow</SectionLabel>
            <h2 id="workflow-title" className="t-hero reveal mt-6">From pairing to sign-off in six steps.</h2>
          </div>
          <p className="reveal col-span-12 self-end text-[16px] leading-relaxed text-ink-2 lg:col-span-4 lg:col-start-9">
            The same sequence every shift: pair the glasses, load the shift, walk the round, record the inspection, submit, and let a supervisor review it in the console.
          </p>
        </div>
        <div className="reveal mt-14 lg:mt-20"><WorkflowStepper /></div>
      </div>
    </section>
  );
}

/* --------------------------------------------- Industrial intelligence */
const INTEL = [
  { t: 'Freshness on every value', d: 'Each reading carries its age and is marked live, delayed, stale or no data — so a frozen number never looks like a healthy one.' },
  { t: 'Alarms that do not chatter', d: 'Per-sensor rules (high, high-high, low, low-low) with deadband hysteresis and on-delay before an alarm is raised.' },
  { t: 'Validated, normalised telemetry', d: 'Units normalised, future or stale timestamps rejected, quality flags kept, duplicates dropped by message ID.' },
  { t: 'Every figure drills down', d: 'Overview numbers link to the alarm, inspection or asset behind them. History exports to CSV for reporting.' },
  { t: 'Deterministic training scenarios', d: 'Ten replayable scenarios — from pump vibration to network loss — for onboarding and acceptance tests on synthetic data.' },
];

function Intelligence() {
  return (
    <section className="site-container site-section" aria-labelledby="intel-title">
      <div className="site-grid gap-y-12">
        <div className="col-span-12 lg:col-span-4">
          <SectionLabel className="reveal" index="07">Industrial intelligence</SectionLabel>
          <h2 id="intel-title" className="t-hero reveal mt-6">Signal, not noise.</h2>
          <p className="reveal mt-6 max-w-sm text-[16px] leading-relaxed text-text-2">The platform does the unglamorous work that makes a number trustworthy before it reaches an operator.</p>
        </div>
        <ul className="col-span-12 lg:col-span-7 lg:col-start-6">
          {INTEL.map((it) => (
            <li key={it.t} className="reveal grid gap-3 border-t border-line py-7 last:border-b sm:grid-cols-2 sm:gap-8">
              <h3 className="text-[21px] leading-snug tracking-[-0.02em]">{it.t}</h3>
              <p className="text-[14.5px] leading-relaxed text-muted">{it.d}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ------------------------------------------------- Architecture */
function Architecture() {
  return (
    <section className="site-container site-section-tight" aria-labelledby="arch-title">
      <div className="site-grid gap-y-8">
        <div className="col-span-12 lg:col-span-6">
          <SectionLabel className="reveal" index="08">Architecture & integration</SectionLabel>
          <h2 id="arch-title" className="t-hero reveal mt-6">Integrates at the edge. <span className="text-muted">Honest about what is next.</span></h2>
        </div>
        <div className="reveal col-span-12 self-end lg:col-span-5 lg:col-start-8">
          <p className="text-[16px] leading-relaxed text-text-2">HTTPS gateway ingestion is live today. MQTT and OPC UA edge adapters are planned. Your control system remains the system of record for control.</p>
          <Link href="/technology" className="btn btn-outline mt-6">Technology deep-dive <ArrowUpRight size={16} aria-hidden /></Link>
        </div>
      </div>
      <div className="reveal mt-12"><IntegrationTable /></div>
    </section>
  );
}

/* ------------------------------------------------------ Roadmap */
function Roadmap() {
  return (
    <section className="site-container site-section" aria-labelledby="roadmap-title">
      <div className="site-grid gap-y-8">
        <div className="col-span-12 lg:col-span-7">
          <SectionLabel className="reveal" index="09">Roadmap</SectionLabel>
          <h2 id="roadmap-title" className="t-hero reveal mt-6">Available now <HlPill tone="lime">vs</HlPill> planned.</h2>
        </div>
        <p className="reveal col-span-12 self-end text-[16px] leading-relaxed text-text-2 lg:col-span-4 lg:col-start-9">
          Computer vision, voice and predictive maintenance are on the roadmap — and labelled that way everywhere on this site.
        </p>
      </div>
      <div className="mt-12"><RoadmapBlock /></div>
    </section>
  );
}


