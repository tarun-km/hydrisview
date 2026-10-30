'use client';

import Link from 'next/link';
import clsx from 'clsx';
import { useRef } from 'react';
import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react';
import { Activity, ArrowLeft, ArrowRight, ArrowUpRight, Download, Droplets, Gauge, Hand, Route, ShieldCheck, WifiOff, Waves } from 'lucide-react';
import { HeroGlassesPreview } from './LiveGlasses';
import {
  Arches, CountUp, CrossMarks, DotGrid, DotMatrix, GlassTile, LiveDot, MiniBars, MistBackdrop, RingIcon, Rise, Sparkline, SplitWords, SunArc, Ticker, useLiveSeries,
} from './mist';

const APK = '/downloads/HydrisField.apk';

/* ===================================================================== Hero */
export function MistHero() {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] });
  const lift = useTransform(scrollYProgress, [0, 1], [0, reduced ? 0 : -70]);
  const fade = useTransform(scrollYProgress, [0.45, 1], [1, reduced ? 1 : 0.25]);

  return (
    <div ref={ref} className="mist-band mist-hero" aria-labelledby="hero-title">
      <MistBackdrop />
      <CrossMarks points={[['8%', '22%'], ['46%', '14%'], ['91%', '34%'], ['62%', '58%']]} />
      <motion.div style={{ y: lift, opacity: fade }} className="relative px-5 pb-28 pt-10 sm:px-10 lg:px-16 lg:pb-40 lg:pt-14">
        <Rise className="flex flex-wrap items-center gap-2 text-[12.5px]">
          <span className="mist-chip">Hydris AI · Field Glasses</span>
          <span className="mist-chip">ETP · STP · WTP</span>
          <span className="mist-chip"><LiveDot className="mr-1" /> Advisory only, never actuates</span>
        </Rise>

        <h1 id="hero-title" className="mt-10 lg:mt-14">
          <span className="block text-[13px] font-medium uppercase tracking-[0.22em] text-[#2c4f59]">Your universal field view</span>
          <span className="mist-display mt-3 block">
            <SplitWords text="Your plant," className="font-serif italic" />
          </span>
          <span className="mist-display block text-right">
            <SplitWords text="live" delay={0.25} className="font-serif italic" />
            <span className="mist-display-aside">
              <SplitWords text="in the operator’s field of view — rounds, alarms and approved procedures, hands-free." delay={0.45} />
            </span>
          </span>
        </h1>

        <div className="mt-12 grid gap-10 lg:mt-20 lg:grid-cols-12 lg:items-end">
          <Rise delay={0.5} className="lg:col-span-5">
            <p className="max-w-[46ch] text-[15.5px] leading-relaxed text-[#21414b]">
              Hydris Field Glasses puts live telemetry, guided inspections and approved SOPs on a monocular display, so wastewater operators keep their eyes on the
              equipment and their hands on the job. Supervisors run sites, assets, alarms and the glasses fleet from a secure Operator Console.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link href="/contact?type=demo" className="mist-btn mist-btn-ink">Request a demo <span className="mist-btn-dot"><ArrowUpRight size={15} aria-hidden /></span></Link>
              <Link href="/demo" className="mist-btn mist-btn-glass">Try the live viewport</Link>
              <a href={APK} className="mist-btn mist-btn-ghost" download><Download size={15} aria-hidden /> Android app (APK)</a>
            </div>
          </Rise>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:col-span-6 lg:col-start-7" aria-label="Principles">
            {[
              { i: <ShieldCheck size={18} />, t: 'Advisory', d: '0 control commands' },
              { i: <Hand size={18} />, t: 'Hands-free', d: '4 glove inputs' },
              { i: <WifiOff size={18} />, t: 'Offline-ready', d: 'Queued & synced' },
              { i: <Activity size={18} />, t: 'Audited', d: 'Every step stamped' },
            ].map((p, i) => (
              <Rise as="li" key={p.t} delay={0.6 + i * 0.08}>
                <div className="mist-square">
                  <span className="text-[#21414b]" aria-hidden>{p.i}</span>
                  <span className="mt-auto text-[14px] font-medium text-[#0d2a33]">{p.t}</span>
                  <span className="text-[11.5px] text-[#2c4f59]">{p.d}</span>
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
export function LiveBand() {
  const doS = useLiveSeries([2.1, 2.3, 2.2, 2.0, 2.4, 2.2, 2.3, 2.1, 2.2, 2.25], { lo: 1.6, hi: 2.9, step: 0.18 });
  const vib = useLiveSeries([4.1, 4.4, 4.2, 4.8, 5.0, 4.7, 5.2, 5.4, 5.6], { lo: 3.6, hi: 6.2, step: 0.35, every: 1500 });
  const flow = useLiveSeries([402, 410, 398, 420, 431, 425, 440, 436, 447, 452, 444, 450], { lo: 370, hi: 480, step: 12, every: 1900 });
  const lvl = useLiveSeries([2, 2, 3, 3, 4, 3], { lo: 0, hi: 4.49, step: 0.9, every: 2300 });
  const sun = Math.min(1, Math.max(0, (doS.last - 1.6) / 1.3));
  const vibHigh = vib.last > 4.5;

  return (
    <div className="mist-band mist-band-deep mist-arch" aria-labelledby="live-title">
      <MistBackdrop dunes={false} tone="dusk" />
      <div className="relative px-5 pb-24 pt-20 sm:px-10 lg:px-16 lg:pb-32 lg:pt-28">
        <div className="grid gap-6 lg:grid-cols-12 lg:items-end">
          <Rise className="lg:col-span-7">
            <h2 id="live-title" className="mist-h2 text-white">
              <span className="font-serif italic">Live</span> at the asset,<br className="hidden sm:block" /> not in the control room.
            </h2>
          </Rise>
          <Rise delay={0.1} className="lg:col-span-4 lg:col-start-9">
            <p className="text-[15px] leading-relaxed text-white/80">
              Every value carries its age and limit. These tiles tick on a synthetic reference plant, the same stream the glasses receive.
            </p>
          </Rise>
        </div>

        <div className="mt-12 grid gap-5 lg:mt-16 lg:grid-cols-12">
          {/* Real viewport in a frosted frame */}
          <Rise className="lg:col-span-5">
            <GlassTile tone="frost" tilt={false} className="h-full p-5 pb-12 sm:p-8 sm:pb-14">
              <div className="mb-5 flex items-center justify-between text-[12.5px] text-white/85">
                <span className="flex items-center gap-2"><LiveDot /> Riverbend · ETP-01</span>
                <span>synthetic reference plant</span>
              </div>
              <div className="mx-auto max-w-[380px]"><HeroGlassesPreview scenario="pump_vibration" /></div>
            </GlassTile>
          </Rise>

          <div className="grid gap-5 lg:col-span-7">
            {/* Daylight-style DO tile */}
            <Rise delay={0.05}>
              <GlassTile className="p-6 sm:p-8">
                <div ref={doS.ref} className="grid gap-6 sm:grid-cols-[1fr_1.3fr] sm:items-center">
                  <div>
                    <div className="text-[14px] text-white/85">Dissolved oxygen</div>
                    <div className="mt-4 flex items-start gap-2">
                      <DotMatrix text={doS.last.toFixed(1)} className="h-[64px] w-auto sm:h-[78px]" />
                      <span className="mt-1 text-[15px] text-white/75">mg/L</span>
                    </div>
                    <div className="mt-3 text-[14px] font-medium text-white">AB-201</div>
                    <div className="text-[13px] text-white/65">Aeration basin 1</div>
                  </div>
                  <div>
                    <SunArc t={sun} className="w-full" />
                    <div className="mt-2 grid grid-cols-3 text-center text-[12.5px] text-white/80">
                      <span><span className="block text-[17px] text-white">1.2</span>Low limit</span>
                      <span><span className="block text-[17px] text-white">{doS.last >= 1.2 ? 'Good' : 'Low'}</span>Status</span>
                      <span><span className="block text-[17px] text-white">3.0</span>Target max</span>
                    </div>
                  </div>
                </div>
              </GlassTile>
            </Rise>

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <Rise delay={0.1}>
                <GlassTile className="p-5 sm:p-6">
                  <div ref={vib.ref} className="flex h-full flex-col">
                    <div className="flex items-center gap-4"><RingIcon><Gauge size={20} aria-hidden /></RingIcon><span className="text-[17px] leading-tight text-white">Pump<br />vibration</span></div>
                    <div className="mt-6 flex items-end justify-between gap-3">
                      <span className="text-[44px] font-light leading-none text-white"><Ticker value={vib.last} /><span className="ml-1 text-[15px] text-white/70">mm/s</span></span>
                      <MiniBars data={vib.data} lo={3.5} hi={6.3} className="h-10 w-[110px]" />
                    </div>
                    <div className={clsx('mt-3 text-[12.5px]', vibHigh ? 'text-[#ffb59e]' : 'text-white/70')}>{vibHigh ? 'Above 4.5 limit · P-101' : 'Within limit · P-101'}</div>
                  </div>
                </GlassTile>
              </Rise>
              <Rise delay={0.15}>
                <GlassTile className="p-5 sm:p-6">
                  <div className="flex h-full flex-col">
                    <div className="flex items-center gap-4"><RingIcon><Route size={20} aria-hidden /></RingIcon><span className="text-[17px] leading-tight text-white">Morning<br />round</span></div>
                    <div className="mt-6 flex items-end justify-between gap-3">
                      <span className="text-[44px] font-light leading-none text-white"><CountUp to={3} /><span className="ml-1 text-[15px] text-white/70">/ 7</span></span>
                      <DotGrid filled={3} total={14} className="h-7 w-[110px]" />
                    </div>
                    <div className="mt-3 text-[12.5px] text-white/70">Next: aeration blower BL-102</div>
                  </div>
                </GlassTile>
              </Rise>
              <Rise delay={0.2}>
                <GlassTile className="p-5 sm:p-6">
                  <div ref={flow.ref} className="flex h-full flex-col">
                    <div className="flex items-center gap-4"><RingIcon><Droplets size={20} aria-hidden /></RingIcon><span className="text-[17px] leading-tight text-white">Plant<br />inflow</span></div>
                    <div className="mt-6 flex items-end justify-between gap-3">
                      <span className="text-[44px] font-light leading-none text-white"><Ticker value={flow.last} decimals={0} /><span className="ml-1 text-[15px] text-white/70">m³/h</span></span>
                      <Sparkline data={flow.data} lo={360} hi={490} className="h-10 w-[120px]" />
                    </div>
                    <div className="mt-3 text-[12.5px] text-white/70">FT-001 · live · 2 s ago</div>
                  </div>
                </GlassTile>
              </Rise>
              <Rise delay={0.25}>
                <GlassTile className="p-5 sm:p-6">
                  <div ref={lvl.ref} className="flex h-full flex-col">
                    <div className="flex items-center gap-4"><RingIcon><Waves size={20} aria-hidden /></RingIcon><span className="text-[17px] leading-tight text-white">Equalization<br />cycle</span></div>
                    <div className="mt-6 flex items-end justify-between gap-3">
                      <span className="text-[44px] font-light leading-none text-white">{Math.round(lvl.last) + 1}<span className="ml-1 text-[15px] text-white/70">of 5</span></span>
                      <Arches n={5} active={Math.round(lvl.last)} className="h-8 w-[130px]" />
                    </div>
                    <div className="mt-3 text-[12.5px] text-white/70">T-101 fill and transfer stages</div>
                  </div>
                </GlassTile>
              </Rise>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================================================================ Why band */
const WHY = [
  { t: 'Live context at the asset', d: 'The asset in front of the operator shows its live readings, limits and how fresh each value is.' },
  { t: 'Captured where it happens', d: 'Each inspection step is recorded on the spot, with timestamps and range checks, not from memory at shift end.' },
  { t: 'Only approved procedures', d: 'Only approved SOP revisions reach the glasses, one step at a time. No binder guesswork.' },
  { t: 'Advisory by design', d: 'Hydris shows context and records what people do. It has no write path to SCADA, PLCs or equipment.' },
];
const WHERE = [
  { t: 'Effluent treatment (ETP)', d: 'Equalization, transfer pumps, neutralisation and clarifier rounds.' },
  { t: 'Sewage treatment (STP)', d: 'Aeration basins, blower halls and dissolved-oxygen checks.' },
  { t: 'Water treatment (WTP)', d: 'Coagulant dosing, filtration and clear-water observations.' },
  { t: 'Rotating equipment', d: 'Vibration, motor current and bearing temperature at the pump.' },
  { t: 'Compliance & audit', d: 'Timestamped, range-checked records a supervisor approves.' },
];

export function WhyBand() {
  return (
    <div className="mist-band mist-arch" aria-labelledby="value-title">
      <MistBackdrop dunes={false} />
      <div className="relative px-5 pb-24 pt-20 sm:px-10 lg:px-16 lg:pb-32 lg:pt-28">
        <div className="grid gap-6 lg:grid-cols-12 lg:items-start">
          <Rise className="lg:col-span-5">
            <h2 id="value-title" className="mist-h2"><span className="font-serif italic">Why</span> Hydris</h2>
          </Rise>
          <Rise delay={0.1} className="lg:col-span-5 lg:col-start-8">
            <p className="text-[15.5px] leading-relaxed text-[#21414b]">
              An operational layer for wastewater plants that turns live telemetry, rounds and approved procedures into glanceable guidance on the move, for teams
              who need the right number at the right asset without a tablet in a gloved hand.
            </p>
          </Rise>
        </div>

        <ul className="mt-14 grid gap-5 sm:grid-cols-2 lg:mt-20 lg:grid-cols-4">
          {WHY.map((w, i) => (
            <Rise as="li" key={w.t} delay={i * 0.08} className={clsx(i % 2 === 1 && 'lg:-translate-y-6', i === 2 && 'lg:translate-y-4')}>
              <div className="folder-card">
                <span className="folder-num" aria-hidden>0{i + 1}</span>
                <h3 className="max-w-[16ch] text-[19px] font-medium leading-snug tracking-[-0.01em] text-[#0d2a33]">{w.t}</h3>
                <p className="mt-3 text-[14px] leading-relaxed text-[#2c4f59]">{w.d}</p>
              </div>
            </Rise>
          ))}
        </ul>

        <div className="mt-24 text-center lg:mt-32">
          <Rise><h3 className="mist-h3"><span className="font-serif italic">Where</span> Hydris works</h3></Rise>
          <Rise delay={0.1}><p className="mx-auto mt-3 max-w-md text-[14.5px] text-[#2c4f59]">One field layer across the treatment train.</p></Rise>
        </div>
        <ul className="mt-10 grid gap-x-6 gap-y-8 border-t border-[#0d2a33]/15 pt-8 sm:grid-cols-2 lg:grid-cols-5">
          {WHERE.map((w, i) => (
            <Rise as="li" key={w.t} delay={i * 0.06} className="lg:border-l lg:border-[#0d2a33]/15 lg:pl-5 lg:first:border-l-0 lg:first:pl-0">
              <h4 className="text-[15.5px] font-medium text-[#0d2a33]">{w.t}</h4>
              <p className="mt-2 text-[13.5px] leading-relaxed text-[#2c4f59]">{w.d}</p>
            </Rise>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ================================================================ How band */
const STEPS = [
  { t: 'Pair', d: 'Type the short code shown on the lens, or scan it in the simulator. An admin approves the device in the console.' },
  { t: 'Shift context', d: 'Sites, areas and open alarms load for the operator signed in on the glasses.' },
  { t: 'Round', d: 'An ordered route with the next asset in view and its live readings one glance away.' },
  { t: 'Inspect', d: 'Check, reading, choice and text steps. Values outside the expected range are flagged as they are entered.' },
  { t: 'Report', d: 'Timestamped submit. If the network drops, steps queue on the device and sync in order.' },
  { t: 'Review', d: 'A supervisor approves or returns the inspection, with a full audit trail.' },
];

export function HowBand() {
  const scroller = useRef<HTMLOListElement>(null);
  const by = (dir: number) => scroller.current?.scrollBy({ left: dir * Math.min(360, scroller.current.clientWidth * 0.8), behavior: 'smooth' });
  return (
    <div className="mist-band mist-band-mid mist-arch" aria-labelledby="workflow-title">
      <MistBackdrop dunes={false} />
      <div className="relative pb-24 pt-20 lg:pb-32 lg:pt-28">
        <div className="grid gap-6 px-5 sm:px-10 lg:grid-cols-12 lg:items-end lg:px-16">
          <Rise className="lg:col-span-6">
            <h2 id="workflow-title" className="mist-h2"><span className="font-serif italic">How</span> a shift flows</h2>
          </Rise>
          <Rise delay={0.1} className="lg:col-span-4 lg:col-start-8">
            <p className="text-[15px] leading-relaxed text-[#21414b]">From pairing to sign-off in six steps: the same sequence every shift, on the glasses and in the console.</p>
          </Rise>
          <div className="flex gap-2 lg:col-span-1 lg:justify-end">
            <button type="button" onClick={() => by(-1)} className="mist-round" aria-label="Previous steps"><ArrowLeft size={16} aria-hidden /></button>
            <button type="button" onClick={() => by(1)} className="mist-round" aria-label="Next steps"><ArrowRight size={16} aria-hidden /></button>
          </div>
        </div>
        <ol ref={scroller} className="mist-scroller mt-12 lg:mt-16" aria-label="Operator workflow">
          {STEPS.map((s, i) => (
            <Rise as="li" key={s.t} delay={i * 0.06} className="mist-step">
              <span className="mist-step-num" aria-hidden>0{i + 1}</span>
              <span className="sr-only">Step {i + 1}: </span>
              <h3 className="text-[19px] font-medium text-[#0d2a33]">{s.t}</h3>
              <p className="mt-3 text-[14px] leading-relaxed text-[#2c4f59]">{s.d}</p>
            </Rise>
          ))}
        </ol>
      </div>
    </div>
  );
}

/* ================================================================ Closing CTA */
export function MistCta() {
  return (
    <section className="site-container site-section-tight" aria-labelledby="cta-title">
      <div className="mist-shell mist-cta">
        <MistBackdrop />
        <CrossMarks points={[['12%', '18%'], ['84%', '26%']]} />
        <div className="relative px-5 pb-40 pt-20 text-center sm:px-10 lg:pb-56 lg:pt-28">
          <Rise>
            <h2 id="cta-title" className="mist-h2 mx-auto max-w-[18ch]">
              <span className="font-serif italic">See Hydris</span> on a plant like yours.
            </h2>
          </Rise>
          <Rise delay={0.1}>
            <p className="mx-auto mt-5 max-w-xl text-[15.5px] leading-relaxed text-[#21414b]">
              A 30-minute walkthrough: the glasses viewport, the operator console and how your gateway telemetry would reach both. We will be clear about what is
              available today and what is planned.
            </p>
          </Rise>
          <Rise delay={0.2} className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/contact?type=demo" className="mist-btn mist-btn-ink">Request a demo <span className="mist-btn-dot"><ArrowUpRight size={15} aria-hidden /></span></Link>
            <Link href="/demo" className="mist-btn mist-btn-glass">Try the live demo</Link>
            <a href={APK} className="mist-btn mist-btn-ghost" download><Download size={15} aria-hidden /> Android app</a>
          </Rise>
        </div>
      </div>
    </section>
  );
}
