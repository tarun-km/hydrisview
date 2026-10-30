'use client';

import Link from 'next/link';
import clsx from 'clsx';
import { useRef, type ReactNode } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react';
import {
  Activity, ArrowRight, ArrowUpRight, BellRing, BookCheck, Check, ClipboardCheck, Clock, Download, Droplets, Gauge, Hand, MoveHorizontal, Plus, QrCode,
  Radio, Route, ShieldCheck, WifiOff, Waves,
} from 'lucide-react';
import { HeroGlassesPreview, DemoStudio } from './LiveGlasses';
import { PlatformDiagram } from './diagrams';
import { RealityIcon } from './art';
import { AVAILABLE_NOW, PLANNED } from './content';
import { IntegrationTable, SAFETY } from './sections';
import { ConsoleMock, DeviceFrame, GlassesScreen, HudList, HudReading, HudStep, LaptopFrame } from './vignettes';
import {
  Arches, CountUp, CrossMarks, DotGrid, DotMatrix, GlassTile, LiveDot, MiniBars, MistBackdrop, RingIcon, Rise, Sparkline, SplitWords, SunArc, Ticker, useLiveSeries,
} from './mist';

const APK = '/downloads/HydrisField.apk';

/* ================================================================ primitives */

type Tone = 'ice' | 'night' | 'signal';

/** One rounded panel per section; every section shares the same container, padding and heading block. */
function Panel({ tone, id, label, children, className }: { tone: Tone; id?: string; label: string; children: ReactNode; className?: string }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} aria-label={id ? undefined : label} className={clsx('hz-panel', `hz-${tone}`, tone !== 'ice' && 'force-dark', className)}>
      <MistBackdrop dunes={false} tone={tone === 'ice' ? 'ice' : 'dusk'} />
      <div className="relative">{children}</div>
    </section>
  );
}

function Head({ id, eyebrow, title, lead, action }: { id?: string; eyebrow: string; title: ReactNode; lead?: ReactNode; action?: ReactNode }) {
  return (
    <div className="hz-head">
      <Rise>
        <p className="hz-eyebrow">{eyebrow}</p>
        <h2 id={id ? `${id}-title` : undefined} className="hz-h2">{title}</h2>
      </Rise>
      {(lead || action) && (
        <Rise delay={0.08} className="hz-head-aside">
          {lead && <p className="hz-lead">{lead}</p>}
          {action}
        </Rise>
      )}
    </div>
  );
}

function RailHint() {
  return <p className="hz-rail-hint hz-small" aria-hidden><MoveHorizontal size={15} /> Swipe for more</p>;
}

/* ===================================================================== Hero */
function Hero() {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] });
  const lift = useTransform(scrollYProgress, [0, 1], [0, reduced ? 0 : -60]);

  return (
    <div ref={ref} className="hz-panel hz-ice pb-[calc(var(--hz-pad-y)+56px)] lg:pb-[calc(var(--hz-pad-y)+96px)]">
      <MistBackdrop />
      <CrossMarks points={[['8%', '24%'], ['47%', '12%'], ['92%', '36%']]} />
      <motion.div style={{ y: lift }} className="relative">
        <Rise className="flex flex-wrap gap-2">
          <span className="hz-chip max-sm:hidden">Hydris AI · Field Glasses</span>
          <span className="hz-chip">ETP · STP · WTP</span>
          <span className="hz-chip"><LiveDot /> Advisory only — never actuates</span>
        </Rise>

        <h1 id="hero-title" className="mt-10 lg:mt-14">
          <span className="hz-eyebrow">Smart glasses for wastewater operators</span>
          <span className="hz-display mt-4 block">
            <SplitWords text="Your plant," className="hz-serif !text-[var(--hz-ink)]" />
          </span>
          <span className="hz-display block sm:text-right">
            <SplitWords text="live" delay={0.2} className="hz-serif" />
          </span>
          <span className="sr-only"> in the operator’s field of view.</span>
        </h1>

        <div className="mt-10 grid gap-10 lg:mt-14 lg:grid-cols-12 lg:items-end lg:gap-16">
          <Rise delay={0.35} className="lg:col-span-6">
            <p className="hz-lead !text-[var(--hz-ink)] !text-[19px] lg:!text-[21px] !leading-snug font-medium">
              Live readings, rounds, alarms and approved procedures — in the operator’s field of view, hands-free.
            </p>
            <p className="hz-body mt-4 max-w-[56ch]">
              Hydris Field Glasses keeps wastewater operators’ eyes on the equipment and hands on the job. Supervisors run sites, assets, alarms and the glasses
              fleet from a secure Operator Console.
            </p>
            <div className="hz-actions mt-8">
              <Link href="/contact?type=demo" className="hz-btn hz-btn-primary">Request a demo <ArrowUpRight size={17} aria-hidden /></Link>
              <Link href="/demo" className="hz-btn hz-btn-secondary">Try the live viewport</Link>
              <a href={APK} className="hz-btn hz-btn-link" download><Download size={16} aria-hidden /> Android app (APK)</a>
            </div>
          </Rise>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:col-span-6 lg:grid-cols-2 xl:grid-cols-4" aria-label="Principles">
            {[
              { i: <ShieldCheck size={20} />, t: 'Advisory', d: 'Zero control commands' },
              { i: <Hand size={20} />, t: 'Hands-free', d: 'Four glove inputs' },
              { i: <WifiOff size={20} />, t: 'Offline', d: 'Queued and synced' },
              { i: <Activity size={20} />, t: 'Audited', d: 'Every step stamped' },
            ].map((p, i) => (
              <Rise as="li" key={p.t} delay={0.45 + i * 0.06}>
                <div className="hz-square">
                  <span className="text-[var(--hz-blue)]" aria-hidden>{p.i}</span>
                  <span className="mt-auto text-[16px] font-semibold text-[var(--hz-ink)]">{p.t}</span>
                  <span className="hz-small">{p.d}</span>
                </div>
              </Rise>
            ))}
          </ul>
        </div>
      </motion.div>
    </div>
  );
}

/* ================================================================ Live band */
function LiveBand() {
  const doS = useLiveSeries([2.1, 2.3, 2.2, 2.0, 2.4, 2.2, 2.3, 2.1, 2.2, 2.25], { lo: 1.6, hi: 2.9, step: 0.18 });
  const vib = useLiveSeries([4.1, 4.4, 4.2, 4.8, 5.0, 4.7, 5.2, 5.4, 5.6], { lo: 3.6, hi: 6.2, step: 0.35, every: 1500 });
  const flow = useLiveSeries([402, 410, 398, 420, 431, 425, 440, 436, 447, 452, 444, 450], { lo: 370, hi: 480, step: 12, every: 1900 });
  const lvl = useLiveSeries([2, 2, 3, 3, 4, 3], { lo: 0, hi: 4.49, step: 0.9, every: 2300 });
  const sun = Math.min(1, Math.max(0, (doS.last - 1.6) / 1.3));
  const vibHigh = vib.last > 4.5;

  const tile = (icon: ReactNode, name: ReactNode, value: ReactNode, chart: ReactNode, foot: ReactNode, ref?: React.Ref<HTMLDivElement>, alert?: boolean) => (
    <GlassTile className="h-full p-5 sm:p-6">
      <div ref={ref} className="flex h-full flex-col">
        <div className="flex items-center gap-4"><RingIcon className="!h-12 !w-12">{icon}</RingIcon><span className="text-[17px] font-medium leading-tight text-white">{name}</span></div>
        <div className="mt-6 flex items-end justify-between gap-3">
          <span className="whitespace-nowrap text-[42px] font-light leading-none text-white">{value}</span>
          {chart}
        </div>
        <div className={clsx('mt-auto pt-3 text-[13px]', alert ? 'text-[#ffb59e]' : 'text-white/70')}>{foot}</div>
      </div>
    </GlassTile>
  );

  return (
    <section id="live" aria-labelledby="live-title" className="hz-panel hz-night hz-arch force-dark">
      <MistBackdrop dunes={false} tone="dusk" />
      <div className="relative">
        <Head id="live" eyebrow="Live at the asset" title={<><span className="hz-serif">Live</span> at the asset, not in the control room.</>}
          lead="Every value carries its age and its limit. These tiles tick on a synthetic reference plant — the same stream the glasses receive." />

        <div className="grid gap-4 lg:grid-cols-12">
          <Rise className="lg:col-span-5">
            <GlassTile tone="frost" tilt={false} className="h-full p-5 sm:p-7">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-2 text-[13px] text-white/80">
                <span className="flex items-center gap-2"><LiveDot /> Riverbend · ETP-01</span>
                <span>Synthetic reference plant</span>
              </div>
              <div className="mx-auto max-w-[400px]"><HeroGlassesPreview scenario="pump_vibration" /></div>
            </GlassTile>
          </Rise>

          <div className="grid gap-4 lg:col-span-7">
            <Rise delay={0.05}>
              <GlassTile className="p-6 sm:p-7">
                <div ref={doS.ref} className="grid gap-6 sm:grid-cols-[1fr_1.3fr] sm:items-center">
                  <div>
                    <div className="text-[15px] font-medium text-white/85">Dissolved oxygen</div>
                    <div className="mt-4 flex items-start gap-2">
                      <DotMatrix text={doS.last.toFixed(1)} className="h-[64px] w-auto sm:h-[76px]" />
                      <span className="mt-1 text-[15px] text-white/75">mg/L</span>
                    </div>
                    <div className="mt-3 text-[15px] font-medium text-white">AB-201 · Aeration basin 1</div>
                  </div>
                  <div>
                    <SunArc t={sun} className="w-full" accent="#9db5ff" />
                    <div className="mt-2 grid grid-cols-3 text-center text-[13px] text-white/75">
                      <span><span className="block text-[18px] text-white">1.2</span>Low limit</span>
                      <span><span className="block text-[18px] text-white">{doS.last >= 1.2 ? 'Good' : 'Low'}</span>Status</span>
                      <span><span className="block text-[18px] text-white">3.0</span>Target max</span>
                    </div>
                  </div>
                </div>
              </GlassTile>
            </Rise>
            <div className="hz-rail">
              <Rise delay={0.1} className="h-full">{tile(<Gauge size={20} aria-hidden />, 'Pump vibration', <><Ticker value={vib.last} /><span className="ml-1 text-[15px] text-white/70">mm/s</span></>,
                <MiniBars data={vib.data} lo={3.5} hi={6.3} className="h-10 w-[104px]" />, vibHigh ? 'Above the 4.5 limit · P-101' : 'Within limit · P-101', vib.ref, vibHigh)}</Rise>
              <Rise delay={0.14} className="h-full">{tile(<Route size={20} aria-hidden />, 'Morning round', <><CountUp to={3} /><span className="ml-1 text-[15px] text-white/70">/ 7</span></>,
                <DotGrid filled={3} total={14} className="h-7 w-[104px]" />, 'Next: aeration blower BL-102')}</Rise>
              <Rise delay={0.18} className="h-full">{tile(<Droplets size={20} aria-hidden />, 'Plant inflow', <><Ticker value={flow.last} decimals={0} /><span className="ml-1 text-[15px] text-white/70">m³/h</span></>,
                <Sparkline data={flow.data} lo={360} hi={490} className="h-10 w-[112px]" />, 'FT-001 · live · 2 s ago', flow.ref)}</Rise>
              <Rise delay={0.22} className="h-full">{tile(<Waves size={20} aria-hidden />, 'Equalization cycle', <>{Math.round(lvl.last) + 1}<span className="ml-1 text-[15px] text-white/70">of 5</span></>,
                <Arches n={5} active={Math.round(lvl.last)} className="h-8 w-[124px]" />, 'T-101 fill and transfer stages', lvl.ref)}</Rise>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function HeroShell() {
  return (
    <div className="hz-shell">
      <Hero />
      <LiveBand />
    </div>
  );
}

/* ============================================================ Capabilities */
const REALITIES = [
  { k: 'noise' as const, t: 'Loud blower halls', d: 'Alarms arrive as colour, severity and plain text — never sound alone.' },
  { k: 'wet' as const, t: 'Wet decks', d: 'Information comes to the eye, so hands stay on rails and tools.' },
  { k: 'gloves' as const, t: 'Gloved hands', d: 'Four inputs — up, down, select, back — with large targets.' },
  { k: 'rounds' as const, t: 'Long rounds', d: 'Ordered routes; what is due next is one glance away.' },
  { k: 'permit' as const, t: 'Permits & isolation', d: 'Cautions before the step. Hydris records, never authorises.' },
  { k: 'light' as const, t: 'Glare & night shifts', d: 'Pure-black UI for additive displays, sized for 600 × 600.' },
];
const CAPS = [
  { icon: Radio, t: 'Contextual telemetry', d: 'Readings for the asset you are standing at, with units, limits and a freshness state on every value.', href: '/technology#pipeline' },
  { icon: ClipboardCheck, t: 'Guided inspections', d: 'Check, reading, choice and text steps. Out-of-range values are flagged as they are entered; supervisors approve.', href: '/operations#pump-inspections' },
  { icon: BellRing, t: 'Alarm awareness', d: 'Deadband and on-delay cut chatter. Critical alarms interrupt the view; follow-up lives in the console.', href: '/operations#fault-documentation', blue: true },
  { icon: BookCheck, t: 'Approved SOPs', d: 'Procedures linked to the asset or asset type. Operators and devices only ever see approved revisions.', href: '/operations#sop-guidance' },
  { icon: QrCode, t: 'Secure pairing & fleet', d: 'A single-use code that expires in five minutes. Assign, suspend or revoke any glasses from the console.', href: '/technology#pairing' },
  { icon: WifiOff, t: 'Offline-tolerant sync', d: 'When the network drops the view says so, values show their age, and steps queue and sync in order.', href: '/technology#offline' },
];

export function CapabilitiesBand() {
  return (
    <Panel tone="ice" id="capabilities" label="Capabilities">
      <Head id="capabilities" eyebrow="Built for the plant floor" title={<>Six capabilities, one <span className="hz-serif">calm</span> field of view.</>}
        lead="Treatment plants are noisy, wet and spread out. Work happens in gloves, on rounds, under permits — every interaction in Hydris is shaped by those constraints first."
        action={<Link href="/operations" className="hz-btn hz-btn-secondary">Wastewater operations <ArrowUpRight size={17} aria-hidden /></Link>} />

      <ul className="hz-rail hz-rail-3" aria-label="Core capabilities">
        {CAPS.map((c, i) => (
          <Rise as="li" key={c.t} delay={(i % 3) * 0.06}>
            <article className={clsx('hz-card hz-card-hover group', c.blue && 'hz-card-blue')}>
              <span className={clsx('hz-icon', c.blue && '!bg-white/15 !text-white !shadow-none')} aria-hidden><c.icon size={21} /></span>
              <h3 className="hz-h3 mt-6">{c.t}</h3>
              <p className="hz-body mt-3">{c.d}</p>
              <div className="hz-card-foot">
                <Link href={c.href} className={clsx('hz-more after:absolute after:inset-0 after:content-[\'\']', c.blue && '!text-white')}>
                  Learn more <ArrowUpRight size={16} aria-hidden /><span className="sr-only"> about {c.t.toLowerCase()}</span>
                </Link>
              </div>
            </article>
          </Rise>
        ))}
      </ul>
      <RailHint />

      <div className="mt-12 lg:mt-16">
        <Rise><h3 className="hz-h3">Designed around the realities of the shift</h3></Rise>
        <ul className="mt-6 grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
          {REALITIES.map((r, i) => (
            <Rise as="li" key={r.t} delay={(i % 3) * 0.05} className="flex gap-4 border-t border-[rgb(8_17_22/0.1)] pt-5">
              <span className="-mt-1 flex-none text-[var(--hz-blue)] [&_svg]:h-10 [&_svg]:w-10"><RealityIcon kind={r.k} /></span>
              <span>
                <span className="block text-[16px] font-semibold text-[var(--hz-ink)]">{r.t}</span>
                <span className="hz-body mt-1 block">{r.d}</span>
              </span>
            </Rise>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

/* ==================================================================== Demo */
export function DemoBand() {
  return (
    <Panel tone="night" id="demo" label="Interactive demonstration">
      <Head id="demo" eyebrow="Interactive demo" title={<>Press a button. <span className="hz-serif">Watch the plant respond.</span></>}
        lead="The real glasses viewport, running against a deterministic simulator of a reference effluent plant. Pick a scenario and step through it with the same four inputs an operator has." />
      <Rise><DemoStudio variant="compact" initial="pump_vibration" /></Rise>
    </Panel>
  );
}

/* ================================================================ How band */
const STEPS = [
  { t: 'Pair', d: 'Type the short code shown on the lens. An admin approves the device in the console.' },
  { t: 'Shift context', d: 'Sites, areas and open alarms load for the operator signed in on the glasses.' },
  { t: 'Round', d: 'An ordered route with the next asset in view and its live readings a glance away.' },
  { t: 'Inspect', d: 'Check, reading, choice and text steps; out-of-range values are flagged on entry.' },
  { t: 'Report', d: 'Timestamped submit. If the network drops, steps queue on the device and sync in order.' },
  { t: 'Review', d: 'A supervisor approves or returns the inspection, with a full audit trail.' },
];

export function HowBand() {
  return (
    <Panel tone="ice" id="workflow" label="How a shift flows">
      <Head id="workflow" eyebrow="Workflow" title={<>How a <span className="hz-serif">shift</span> flows.</>}
        lead="From pairing to sign-off in six steps — the same sequence every shift, on the glasses and in the console." />
      <ol className="hz-rail hz-rail-3" aria-label="Operator workflow">
        {STEPS.map((s, i) => (
          <Rise as="li" key={s.t} delay={(i % 3) * 0.06}>
            <div className="hz-card">
              <div className="flex items-start justify-between gap-4">
                <h3 className="hz-h3 pt-2"><span className="sr-only">Step {i + 1}: </span>{s.t}</h3>
                <span className="hz-num" aria-hidden>0{i + 1}</span>
              </div>
              <p className="hz-body mt-3">{s.d}</p>
            </div>
          </Rise>
        ))}
      </ol>
      <RailHint />
    </Panel>
  );
}

/* =============================================================== Use cases */
const USES = [
  {
    href: '/operations#pump-inspections', plant: 'Effluent treatment (ETP)', title: 'Transfer-pump rounds at the equalization tank', tags: ['Equalization', 'Transfer pumps', 'Clarifiers'],
    screen: <GlassesScreen label="Glasses showing P-101 vibration 5.6 mm/s, high alarm" header="P-101 · Transfer pump" status="High" statusTone="high"><HudReading tag="VT-101" name="Vibration (DE bearing)" value="5.6" unit="mm/s" tone="high" state="High" limit="Limit 4.5" /></GlassesScreen>,
  },
  {
    href: '/operations#tank-monitoring', plant: 'Sewage treatment (STP)', title: 'Dissolved-oxygen checks before the blower hall', tags: ['Aeration', 'Blowers', 'DO'],
    screen: <GlassesScreen label="Glasses showing DO-201 dissolved oxygen 1.1 mg/L, low" header="AB-201 · Aeration basin 1" status="Low" statusTone="high"><HudReading tag="DO-201" name="Dissolved oxygen" value="1.1" unit="mg/L" tone="high" state="Low" limit="Low 1.2" foot="BL-102 motor current 0.0 A — check blower" /></GlassesScreen>,
  },
  {
    href: '/operations#chemical-dosing', plant: 'Water treatment (WTP)', title: 'Coagulant dosing and filtration observations', tags: ['Dosing', 'Filtration', 'Clear water'],
    screen: <GlassesScreen label="Glasses showing a dosing pump inspection step" header="DP-301 · Coagulant dosing" status="Step 3/6" statusTone="lime"><HudStep step="Step 3 of 6" kind="Reading" title="Calibration column drawdown" options={['Within 0.38–0.46 L/h', 'Outside range', 'Not possible']} /></GlassesScreen>,
  },
];

export function UseCasesBand() {
  return (
    <Panel tone="night" id="use-cases" label="Use cases">
      <Head id="use-cases" eyebrow="Use cases" title={<>Where the glasses <span className="hz-serif">earn their place.</span></>}
        lead="One field layer across the treatment train — plus rotating equipment checks and the compliance records a supervisor approves."
        action={<Link href="/operations" className="hz-btn hz-btn-secondary">All operations <ArrowUpRight size={17} aria-hidden /></Link>} />
      <ul className="hz-rail hz-rail-3 hz-rail-wide" aria-label="Use cases">
        {USES.map((u, i) => (
          <Rise as="li" key={u.title} delay={i * 0.06}>
            <article className="hz-card hz-card-hover group !p-4 sm:!p-5">
              <div className="rounded-[18px] bg-black/40 p-5 ring-1 ring-white/10"><div className="mx-auto max-w-[280px]">{u.screen}</div></div>
              <div className="flex flex-1 flex-col px-1 pt-5 sm:px-2">
                <p className="hz-small font-semibold uppercase tracking-[0.12em] !text-[#9db5ff]">{u.plant}</p>
                <h3 className="hz-h3 mt-2">{u.title}</h3>
                <ul className="mt-4 flex flex-wrap gap-2" aria-label="Areas">{u.tags.map((t) => <li key={t} className="hz-chip !h-8">{t}</li>)}</ul>
                <div className="hz-card-foot">
                  <Link href={u.href} className="hz-more after:absolute after:inset-0 after:content-['']">See the workflow <ArrowUpRight size={16} aria-hidden /><span className="sr-only">: {u.title}</span></Link>
                </div>
              </div>
            </article>
          </Rise>
        ))}
      </ul>
      <RailHint />
    </Panel>
  );
}

/* ================================================================ Platform */
const INTEL = [
  { t: 'Freshness on every value', d: 'Each reading carries its age — live, delayed, stale or no data — so a frozen number never looks healthy.' },
  { t: 'Alarms that do not chatter', d: 'Per-sensor high, high-high, low and low-low rules with deadband hysteresis and on-delay.' },
  { t: 'Validated, normalised telemetry', d: 'Units normalised, bad timestamps rejected, quality flags kept, duplicates dropped by message ID.' },
  { t: 'Every figure drills down', d: 'Overview numbers link to the alarm, inspection or asset behind them; history exports to CSV.' },
  { t: 'Deterministic training scenarios', d: 'Ten replayable scenarios, from pump vibration to network loss, for onboarding and acceptance tests.' },
];

export function PlatformBand() {
  return (
    <Panel tone="ice" id="platform" label="Connected platform">
      <Head id="platform" eyebrow="Connected platform" title={<>Glasses, console and gateways — <span className="hz-serif">one live picture.</span></>}
        lead="Gateways push readings in. The platform validates, stores and evaluates them, then streams the right context to the right people and devices. Nothing flows back to the equipment."
        action={<Link href="/technology" className="hz-btn hz-btn-secondary">Technology deep-dive <ArrowUpRight size={17} aria-hidden /></Link>} />
      <Tabs.Root defaultValue="arch">
        <Tabs.List className="hz-tabs" aria-label="Platform views">
          <Tabs.Trigger value="arch" className="hz-tab">Architecture</Tabs.Trigger>
          <Tabs.Trigger value="apps" className="hz-tab">Console & glasses</Tabs.Trigger>
          <Tabs.Trigger value="integrations" className="hz-tab">Integrations</Tabs.Trigger>
          <Tabs.Trigger value="quality" className="hz-tab">Data quality</Tabs.Trigger>
        </Tabs.List>
        <div className="mt-6">
          <Tabs.Content value="arch" className="force-dark rounded-[24px] bg-[var(--hz-night)] p-4 text-white sm:p-8">
            <PlatformDiagram />
          </Tabs.Content>
          <Tabs.Content value="apps" className="force-dark rounded-[24px] bg-[var(--hz-night)] p-5 text-white sm:p-8">
            <div className="grid gap-10 lg:grid-cols-12 lg:items-end">
              <div className="lg:col-span-8">
                <LaptopFrame label="Operator Console overview for the reference plant: open alarms, inspections due, connected glasses and a plant map"><ConsoleMock /></LaptopFrame>
                <p className="mt-5 text-[15px] text-white/75"><span className="font-semibold text-white">Operator Console</span> — plan rounds, triage alarms, review inspections, manage the fleet.</p>
              </div>
              <div className="mx-auto w-full max-w-[320px] lg:col-span-4">
                <DeviceFrame>
                  <GlassesScreen label="Glasses showing the next three assets on the morning round" header="Morning round · ETP-01" status="Live">
                    <HudList title="Next on your round" focus={0} items={[{ label: 'BL-102 blower', meta: 'Due', tone: 'lime' }, { label: 'AB-201 basin', meta: '2 steps', tone: 'ok' }, { label: 'DP-301 dosing', meta: 'SOP', tone: 'medium' }]} />
                  </GlassesScreen>
                </DeviceFrame>
                <p className="mt-5 text-[15px] text-white/75"><span className="font-semibold text-white">Field Glasses</span> — execute in the field, hands-free.</p>
              </div>
            </div>
          </Tabs.Content>
          <Tabs.Content value="integrations" className="force-dark rounded-[24px] bg-[var(--hz-night)] p-2 text-white sm:p-4">
            <IntegrationTable />
          </Tabs.Content>
          <Tabs.Content value="quality" className="rounded-[24px]">
            <ul className="hz-card !h-auto !py-2">
              {INTEL.map((it, i) => (
                <li key={it.t} className={clsx('hz-row', i === 0 && '!border-t-0')}>
                  <h3 className="text-[17px] font-semibold text-[var(--hz-ink)]">{it.t}</h3>
                  <p className="hz-body">{it.d}</p>
                </li>
              ))}
            </ul>
          </Tabs.Content>
        </div>
      </Tabs.Root>
    </Panel>
  );
}

/* ================================================================== Safety */
export function SafetyBand() {
  return (
    <Panel tone="night" id="safety" label="Safety and reliability">
      <Head id="safety" eyebrow="Safety & reliability" title={<>Advisory only. Hydris <span className="hz-serif">never actuates</span> pumps, valves or dosing.</>}
        lead="Your control system stays the system of record for control. Hydris shows context and records what people observe and do." />
      <ul className="hz-rail hz-rail-4" aria-label="Safety principles">
        {SAFETY.map((s, i) => (
          <Rise as="li" key={s.t} delay={i * 0.05}>
            <article className={clsx('hz-card', i === 0 && 'hz-card-blue')}>
              <span className={clsx('hz-icon', i === 0 && '!bg-white/15 !shadow-none')} aria-hidden><s.icon size={21} /></span>
              <h3 className="hz-h3 mt-6">{s.t}</h3>
              <p className="hz-body mt-3">{s.d}</p>
            </article>
          </Rise>
        ))}
      </ul>
      <RailHint />
    </Panel>
  );
}

/* ================================================================= Roadmap */
export function RoadmapBand() {
  return (
    <Panel tone="ice" id="roadmap" label="Roadmap">
      <Head id="roadmap" eyebrow="Roadmap" title={<>Available now <span className="hz-serif">vs</span> planned.</>}
        lead="Computer vision, voice and predictive maintenance are on the roadmap — and labelled that way everywhere on this site." />
      <div className="grid gap-4 lg:grid-cols-12">
        <Rise className="lg:col-span-6">
          <div className="hz-card hz-card-blue">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="hz-h3">Available now</h3>
              <span className="inline-flex h-8 items-center rounded-full bg-white px-3.5 text-[13px] font-semibold text-[var(--hz-blue)]">In this release</span>
            </div>
            <ul className="mt-5 grid gap-x-8 sm:grid-cols-2 lg:grid-cols-1">
              {AVAILABLE_NOW.map((a) => (
                <li key={a} className="flex items-start gap-3 border-t border-white/20 py-3 text-[15px] leading-snug"><Check size={18} strokeWidth={2.2} className="mt-0.5 flex-none" aria-hidden />{a}</li>
              ))}
            </ul>
            <div className="hz-card-foot">
              <Link href="/demo" className="hz-more !text-white">Try it now in the live viewport <ArrowUpRight size={16} aria-hidden /></Link>
            </div>
          </div>
        </Rise>
        <Rise delay={0.08} className="lg:col-span-6">
          <div className="hz-card">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="hz-h3">Planned</h3>
              <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-dashed border-[rgb(8_17_22/0.3)] px-3.5 text-[13px] font-medium text-[var(--hz-ink-2)]"><Clock size={13} aria-hidden /> Not yet available</span>
            </div>
            <ul className="mt-5">
              {PLANNED.map((p) => (
                <li key={p.t} className="border-t border-[rgb(8_17_22/0.1)] py-3">
                  <span className="block text-[15px] font-semibold text-[var(--hz-ink)]">{p.t}</span>
                  <span className="hz-small mt-0.5 block !text-[14px]">{p.d}</span>
                </li>
              ))}
            </ul>
            <p className="hz-small mt-auto pt-4">Planned items describe direction, not committed dates.</p>
          </div>
        </Rise>
      </div>
    </Panel>
  );
}

/* ===================================================================== FAQ */
const FAQ = [
  { q: 'Can Hydris start, stop or adjust equipment?', a: 'No. Hydris is advisory only. It has no write path to SCADA, PLCs, pumps, valves, blowers or dosing systems. It shows context and records what operators observe and do.' },
  { q: 'Which glasses does it run on today?', a: 'The glasses experience runs as a 600 × 600 viewport, with an Android companion app and a browser simulator for training and demos. A native adapter for Meta Ray-Ban Display class glasses is planned; we confirm hardware support with you before any rollout.' },
  { q: 'How does plant data get in?', a: 'An edge gateway posts readings to Hydris over HTTPS with a per-site API key. Manual and lab readings can be entered in the console. MQTT and OPC UA adapters are planned, not available yet.' },
  { q: 'What happens when Wi-Fi drops on the round?', a: 'The viewport shows that it is offline and how fresh each value is. Inspection steps are queued on the device and synchronised in order when it reconnects.' },
];

export function FaqBand() {
  return (
    <Panel tone="night" id="faq" label="Frequently asked questions">
      <div className="grid gap-10 lg:grid-cols-12 lg:gap-16">
        <Rise className="lg:col-span-5">
          <p className="hz-eyebrow">FAQ</p>
          <h2 id="faq-title" className="hz-h2 mt-4">Straight answers to <span className="hz-serif">common questions.</span></h2>
          <p className="hz-lead mt-5">If you run a plant and want to know whether Hydris fits, these are the questions operations leads ask first.</p>
          <div className="hz-actions mt-8"><Link href="/contact" className="hz-btn hz-btn-secondary">Ask our team <ArrowUpRight size={17} aria-hidden /></Link></div>
        </Rise>
        <Rise delay={0.08} className="hz-faq lg:col-span-7">
          {FAQ.map((it, i) => (
            <details key={it.q} open={i === 0}>
              <summary>{it.q}<span className="hz-faq-icon" aria-hidden><Plus size={18} /></span></summary>
              <div><p className="hz-body">{it.a}</p></div>
            </details>
          ))}
        </Rise>
      </div>
    </Panel>
  );
}

/* ============================================================= Closing CTA */
export function ClosingBand() {
  return (
    <section aria-labelledby="cta-title" className="hz-panel hz-signal force-dark text-center">
      <MistBackdrop dunes={false} tone="dusk" />
      <div className="relative mx-auto max-w-[760px] pb-16 lg:pb-28">
        <Rise>
          <p className="hz-eyebrow justify-center before:hidden">Hydris AI · founded 2024</p>
          <h2 id="cta-title" className="hz-h2 mt-4"><span className="hz-serif">See Hydris</span> on a plant like yours.</h2>
        </Rise>
        <Rise delay={0.08}>
          <p className="hz-lead mx-auto mt-5">
            A 30-minute walkthrough: the glasses viewport, the operator console and how your gateway telemetry would reach both — and a clear line between what
            is available today and what is planned.
          </p>
        </Rise>
        <Rise delay={0.16} className="hz-actions mt-8 sm:justify-center">
          <Link href="/contact?type=demo" className="hz-btn hz-btn-primary">Request a demo <ArrowUpRight size={17} aria-hidden /></Link>
          <Link href="/demo" className="hz-btn hz-btn-secondary">Try the live viewport</Link>
          <a href={APK} className="hz-btn hz-btn-link sm:!self-center" download><Download size={16} aria-hidden /> Android app (APK)</a>
        </Rise>
        <Rise delay={0.24}>
          <p className="hz-small mx-auto mt-10 flex max-w-[52ch] items-center justify-center gap-2">
            <ArrowRight size={14} aria-hidden className="flex-none" /> Guiding water systems with clarity and confidence.
          </p>
        </Rise>
      </div>
    </section>
  );
}
