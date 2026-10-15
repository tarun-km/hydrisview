import type { Metadata } from 'next';
import { PipelineDiagram } from '@/site/diagrams';
import { CtaBand, HlPill, PageIntro, SectionLabel, StatPill } from '@/site/primitives';
import { IntegrationTable, RoadmapBlock, SafetyBlock } from '@/site/sections';
import { DeviceFrame, GlassesScreen, HudList } from '@/site/vignettes';

export const metadata: Metadata = {
  title: 'Technology',
  description:
    'Inside Hydris: industrial IoT telemetry ingestion via edge gateways, validation and alarm evaluation, realtime Server-Sent Events, RFC 8628-style device pairing, offline-tolerant sync and a tenant-isolated security model. Computer vision is planned.',
  alternates: { canonical: '/technology' },
};

const PAIRING = [
  { n: '01', t: 'Glasses request a challenge', d: 'The device asks for a pairing challenge and receives a short user code plus a separate device secret that is never displayed.' },
  { n: '02', t: 'QR + 8-character code', d: 'The viewport shows XXXX-XXXX and a QR link. The alphabet avoids look-alike characters (no 0/O, 1/I/L).' },
  { n: '03', t: 'An authorised person approves', d: 'Signed in to the console on another device, they confirm the code and assign the glasses to an operator and sites.' },
  { n: '04', t: 'Device claims its credential', d: 'The glasses poll (no faster than every 3 s) and, once approved, exchange their secret for a short-lived device credential.' },
];

const CONTEXT = [
  { t: 'Who', d: 'One operator per device at a time. Reassignment clears the previous operator’s context and is audited.' },
  { t: 'Where', d: 'Only the sites and areas the operator is permitted for; events from other sites are never delivered.' },
  { t: 'What', d: 'The assets on the current round, their latest readings with freshness, open alarms and approved documents.' },
  { t: 'When', d: 'Values age visibly: live, delayed, stale, no data. A frozen number never masquerades as a healthy one.' },
];

export default function TechnologyPage() {
  return (
    <>
      <PageIntro
        tags={['IIoT', 'SSE', 'RFC 8628', 'Tenant isolation']}
        label="Technology"
        title={<>Industrial IoT, built to be <HlPill tone="lime">trusted</HlPill> at the asset.</>}
        lead="Hydris is a multi-tenant platform: edge gateways push telemetry over HTTPS, the platform validates and evaluates it, and a realtime stream delivers exactly the right context to the console and to each pair of glasses."
        aside={
          <div className="flex flex-wrap gap-3">
            <StatPill k="Gateway batch" v="≤ 500 readings" lime />
            <StatPill k="Pairing challenge" v="5 min · single-use" />
            <StatPill k="Realtime" v="SSE + replay" />
          </div>
        }
      />

      <section id="pipeline" className="site-container site-section-tight scroll-mt-28" aria-labelledby="pipeline-title">
        <div className="stage px-4 py-12 sm:px-8 lg:px-12 lg:py-20">
          <SectionLabel className="reveal" index="01">Telemetry ingestion pipeline</SectionLabel>
          <h2 id="pipeline-title" className="t-hero reveal mt-6 max-w-[22ch]">Equipment to eyes, with every reading checked on the way.</h2>
          <div className="reveal mt-12 lg:mt-16"><PipelineDiagram /></div>
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {[
              { t: 'Per-item results', d: 'A batch never fails silently: each reading is accepted, flagged as duplicate, or rejected with a reason such as unknown sensor or timestamp in the future.' },
              { t: 'Idempotent & ordered', d: 'Message IDs make retries safe; out-of-order readings are stored by observation time, not arrival time.' },
              { t: 'Alarm evaluation', d: 'High, high-high, low and low-low rules with deadband hysteresis and on-delay, evaluated as readings land.' },
            ].map((c, i) => (
              <article key={c.t} className={`reveal reveal-d${i} rounded-[24px] border border-line bg-surface p-6`}>
                <h3 className="t-card">{c.t}</h3>
                <p className="mt-2 text-[14.5px] leading-relaxed text-text-2">{c.d}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="site-container site-section" aria-labelledby="context-title">
        <div className="grid gap-12 lg:grid-cols-12 lg:items-center">
          <div className="lg:col-span-6">
            <SectionLabel className="reveal" index="02">Context awareness</SectionLabel>
            <h2 id="context-title" className="t-hero reveal mt-6">The right context for the right operator.</h2>
            <dl className="mt-10">
              {CONTEXT.map((c) => (
                <div key={c.t} className="reveal grid gap-2 border-t border-line py-5 sm:grid-cols-4">
                  <dt className="text-[20px] tracking-[-0.02em]">{c.t}</dt>
                  <dd className="text-[14.5px] leading-relaxed text-muted sm:col-span-3">{c.d}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="reveal mx-auto w-full max-w-[360px] lg:col-span-4 lg:col-start-8">
            <DeviceFrame>
              <GlassesScreen label="Glasses showing assets on the round with freshness" header="Shift B · ETP-01" status="Live">
                <HudList title="Freshness on the round" items={[{ label: 'P-101 transfer pump', meta: 'live', tone: 'ok' }, { label: 'BL-102 blower', meta: 'stale 6 min', tone: 'stale' }, { label: 'AN-501 analyzer', meta: 'delayed', tone: 'medium' }]} />
              </GlassesScreen>
            </DeviceFrame>
          </div>
        </div>
      </section>

      <section id="pairing" className="site-container site-section-tight scroll-mt-28" aria-labelledby="pairing-title">
        <div className="stage-paper px-5 py-14 sm:px-10 lg:px-14 lg:py-24">
          <SectionLabel className="reveal" index="03">Device pairing & identity</SectionLabel>
          <h2 id="pairing-title" className="t-hero reveal mt-6 max-w-[20ch]">Pairing modelled on the device authorisation grant (RFC 8628).</h2>
          <p className="reveal mt-6 max-w-[60ch] text-[16px] leading-relaxed text-ink-2">Glasses have no keyboard, so they never handle a password. The QR code carries no reusable credential; challenges are single-use, expire after five minutes and are rate-limited against guessing.</p>
          <ol className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {PAIRING.map((p, i) => (
              <li key={p.n} className={`reveal reveal-d${Math.min(i, 3)} flex min-h-[240px] flex-col rounded-[28px] p-6 ${i === 1 ? 'bg-lime text-lime-ink' : 'bg-paper'}`}>
                <span className="num text-[14px] opacity-70">{p.n}</span>
                <h3 className="t-section mt-auto pt-8">{p.t}</h3>
                <p className="mt-2 text-[14.5px] leading-relaxed opacity-80">{p.d}</p>
              </li>
            ))}
          </ol>
          <p className="reveal mt-8 text-[14px] text-ink-2">Lifecycle: unregistered → pending pairing → paired → assigned → connected / disconnected. Any device can be suspended or revoked from the console.</p>
        </div>
      </section>

      <section id="offline" className="site-container site-section scroll-mt-28" aria-labelledby="offline-title">
        <div className="site-grid gap-y-10">
          <div className="col-span-12 lg:col-span-5">
            <SectionLabel className="reveal" index="04">Offline-capable sync & realtime</SectionLabel>
            <h2 id="offline-title" className="t-hero reveal mt-6">Dead spots are part of the plant.</h2>
          </div>
          <div className="col-span-12 grid gap-4 sm:grid-cols-2 lg:col-span-7">
            {[
              { t: 'Degraded mode, stated plainly', d: 'When the network drops, the viewport says so and every value shows its age.' },
              { t: 'Local step queue', d: 'Inspection responses queue on the device and sync in order on reconnect.' },
              { t: 'Server-Sent Events', d: 'One long-lived HTTPS stream per client, with the token in a header — never in the URL.' },
              { t: 'Replay after reconnect', d: 'Last-Event-ID replay closes gaps; sessions are re-validated every 30 s so revoked devices are disconnected.' },
            ].map((c, i) => (
              <article key={c.t} className={`reveal reveal-d${i % 2} rounded-[24px] p-6 ${i === 0 ? 'bg-paper text-ink' : 'border border-line bg-surface'}`}>
                <h3 className="t-card">{c.t}</h3>
                <p className="mt-2 text-[14.5px] leading-relaxed opacity-80">{c.d}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="security" className="site-container site-section-tight scroll-mt-28" aria-labelledby="security-title">
        <SafetyBlock headingId="security-title" />
        <ul className="mt-10 grid gap-x-10 md:grid-cols-2">
          {[
            ['Session tokens', 'Short-lived access tokens held in memory; refresh tokens are httpOnly, SameSite=Strict cookies and rotate on use.'],
            ['Gateway keys', 'Per-site gateway keys are stored as hashes and can be revoked instantly from the console.'],
            ['Synthetic data separation', 'Simulator data is only accepted in demo tenants and is labelled synthetic wherever it is shown.'],
            ['Account provisioning', 'Accounts are invited by an administrator; there is no self-registration into a customer tenant.'],
          ].map(([t, d]) => (
            <li key={t} className="reveal grid gap-2 border-t border-line py-6">
              <h3 className="text-[20px] tracking-[-0.02em]">{t}</h3>
              <p className="text-[14.5px] leading-relaxed text-muted">{d}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="site-container site-section-tight" aria-labelledby="integrations-title">
        <SectionLabel className="reveal" index="05">Integrations</SectionLabel>
        <h2 id="integrations-title" className="t-hero reveal mt-6">What connects today, and what is planned.</h2>
        <div className="reveal mt-10"><IntegrationTable /></div>
      </section>

      <section id="roadmap" className="site-container site-section scroll-mt-28" aria-labelledby="roadmap-title">
        <SectionLabel className="reveal" index="06">Future: computer vision & more</SectionLabel>
        <h2 id="roadmap-title" className="t-hero reveal mt-6 max-w-[22ch]">Computer vision is planned — <span className="text-muted">and labelled that way.</span></h2>
        <p className="reveal mt-6 max-w-[60ch] text-[16px] leading-relaxed text-text-2">We are exploring gauge reading and visual anomaly prompts from the glasses camera. Any such feature will suggest, never decide: the operator confirms what is recorded. None of it is available today.</p>
        <div className="mt-12"><RoadmapBlock /></div>
      </section>

      <CtaBand title="Talk to an engineer, not a script." />
    </>
  );
}
