import clsx from 'clsx';
import type { ReactNode } from 'react';
import { ArrowDown, Check, FileClock, KeyRound, Layers, ShieldOff } from 'lucide-react';
import { AVAILABLE_NOW, CAPABILITY_TABLE, PLANNED } from './content';
import { AvailabilityTag, HlIcon, SectionLabel } from './primitives';

/* ---------- Operator workflow stepper (Usechannel process timeline) ---------- */
const STEPS = [
  { n: '01', t: 'Pair', subs: ['Scan QR or type code', 'Approved in console'] },
  { n: '02', t: 'Shift context', subs: ['Sites & areas', 'Open alarms'] },
  { n: '03', t: 'Round', subs: ['Ordered route', 'Asset in view'] },
  { n: '04', t: 'Inspect', subs: ['Check · reading · choice', 'Range-flagged values'] },
  { n: '05', t: 'Report', subs: ['Timestamped submit', 'Offline queue syncs'] },
  { n: '06', t: 'Review', subs: ['Approve or return', 'Audit trail'] },
];
const GROUPS = [
  { t: 'Start of shift', span: 'col-span-2' },
  { t: 'On the round', span: 'col-span-3' },
  { t: 'Supervisor', span: 'col-span-1' },
];

export function WorkflowStepper() {
  return (
    <div>
      {/* Desktop: staggered timeline */}
      <div className="relative hidden lg:block" aria-hidden>
        <div className="grid grid-cols-6 gap-4">
          {GROUPS.map((g) => (
            <div key={g.t} className={clsx(g.span, 'grid h-14 place-items-center rounded-full border border-ink/25 text-[17px]')}>{g.t}</div>
          ))}
        </div>
        <div className="relative mt-4 grid grid-cols-6 gap-x-4">
          <div className="pointer-events-none absolute inset-0 grid grid-cols-6 gap-x-4">
            {STEPS.map((s) => <div key={s.n} className="mx-auto w-px bg-ink/15" />)}
          </div>
          {STEPS.map((s, i) => {
            const lime = i === 0 || i === STEPS.length - 1;
            const start = Math.min(i, 4);
            return (
              <div key={s.n} className="relative" style={{ gridColumn: `${start + 1} / span 2`, gridRow: i + 1, marginLeft: i === 5 ? '50%' : undefined }}>
                <div className={clsx('flex h-14 items-center justify-between rounded-full px-6 text-[18px]', lime ? 'bg-lime text-lime-ink' : 'bg-paper')}>
                  <span>{s.t}</span>
                  <span className="num text-[15px] opacity-70">{s.n}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 pb-5">
                  {s.subs.map((x) => <span key={x} className="tag-pill bg-white text-ink">{x}</span>)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {/* Accessible list (also the mobile layout) */}
      <ol className="grid gap-3 lg:sr-only">
        {STEPS.map((s, i) => (
          <li key={s.n} className={clsx('rounded-[24px] p-5', i === 0 || i === STEPS.length - 1 ? 'bg-lime text-lime-ink' : 'bg-paper')}>
            <div className="flex items-baseline justify-between">
              <h3 className="text-[20px] tracking-[-0.02em]">{s.t}</h3>
              <span className="num text-[14px] opacity-70">{s.n}</span>
            </div>
            <ul className="mt-3 flex flex-wrap gap-2">
              {s.subs.map((x) => <li key={x} className="inline-flex h-9 items-center rounded-full border border-ink/50 px-4 text-[14px]">{x}</li>)}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ---------- Safety & reliability ---------- */
export const SAFETY = [
  { icon: ShieldOff, t: 'Advisory only', d: 'No write path to SCADA, PLCs or field devices. Hydris shows context and records observations; operators act through your existing controls and permits.' },
  { icon: Layers, t: 'Tenant isolation', d: 'Every query runs in the caller’s organisation context, enforced in the database. Realtime events are authorised per connection.' },
  { icon: FileClock, t: 'Audit trail', d: 'Pairing approvals, device assignments, alarm actions, inspection reviews and permission changes are recorded with who and when.' },
  { icon: KeyRound, t: 'Least privilege', d: 'Role- and site-scoped permissions. Devices get their own short-lived credentials and only see approved documents.' },
];

export function SafetyBlock({ headingId = 'safety-title' }: { headingId?: string }) {
  return (
    <div>
      <SectionLabel className="reveal">Safety & reliability</SectionLabel>
      <h2 id={headingId} className="t-statement reveal mt-8 max-w-[22ch]">
        Advisory only. Hydris <HlIcon className="bg-critical text-[#1a0705]"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg></HlIcon> never actuates pumps, valves or dosing.
      </h2>
      <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {SAFETY.map((s, i) => (
          <article key={s.t} className={clsx('reveal flex flex-col rounded-[28px] p-6 lg:min-h-[300px]', i === 0 ? 'bg-paper text-ink' : 'border border-line bg-surface', `reveal-d${Math.min(i, 3)}`)}>
            <span className={clsx('grid h-12 w-12 place-items-center rounded-full', i === 0 ? 'bg-lime text-white' : 'bg-surface-3 text-text')}>
              <s.icon size={20} aria-hidden />
            </span>
            <h3 className="t-section mt-auto pt-10">{s.t}</h3>
            <p className={clsx('mt-3 text-[14.5px] leading-relaxed', i === 0 ? 'text-ink-2' : 'text-text-2')}>{s.d}</p>
          </article>
        ))}
      </div>
    </div>
  );
}

/* ---------- Integrations table ---------- */
const INTEGRATIONS: { name: string; how: string; status: 'available' | 'planned' }[] = [
  { name: 'Edge gateway → HTTPS ingestion', how: 'JSON batches (≤ 500 readings) with a per-site API key; per-item accept / reject results; idempotent by message ID.', status: 'available' },
  { name: 'Manual & laboratory entry', how: 'Field and lab results entered in the console with source and timestamp provenance.', status: 'available' },
  { name: 'Realtime stream (SSE)', how: 'Server-Sent Events to console and glasses, authorised per connection, Last-Event-ID replay.', status: 'available' },
  { name: 'History export', how: 'Per-sensor history and CSV export for reporting and regulator submissions.', status: 'available' },
  { name: 'MQTT adapter', how: 'Edge adapter subscribing to existing broker topics and forwarding to ingestion.', status: 'planned' },
  { name: 'OPC UA adapter', how: 'Edge adapter reading tags from OPC UA servers.', status: 'planned' },
  { name: 'Native glasses adapter', how: 'Device packaging for Meta Ray-Ban Display class glasses; today the viewport runs in a browser.', status: 'planned' },
];

export function IntegrationTable() {
  return (
    <div className="overflow-hidden rounded-[28px] border border-line">
      <table className="w-full border-collapse text-left text-[14.5px]">
        <caption className="sr-only">Integration options and their availability</caption>
        <thead className="hidden md:table-header-group">
          <tr className="text-[12.5px] text-muted">
            <th scope="col" className="px-6 py-4 font-medium">Integration</th>
            <th scope="col" className="px-6 py-4 font-medium">How it works</th>
            <th scope="col" className="px-6 py-4 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {INTEGRATIONS.map((r) => (
            <tr key={r.name} className="grid border-t border-line p-5 md:table-row md:p-0">
              <th scope="row" className="font-normal text-text md:w-[28%] md:px-6 md:py-5 md:align-top">{r.name}</th>
              <td className="mt-1 text-text-2 md:mt-0 md:px-6 md:py-5 md:align-top">{r.how}</td>
              <td className="mt-3 md:mt-0 md:w-[170px] md:px-6 md:py-5 md:align-top"><AvailabilityTag status={r.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- Supported vs planned table ---------- */
export function CapabilityMatrix() {
  return (
    <div className="overflow-hidden rounded-[28px] bg-paper text-ink">
      <table className="w-full border-collapse text-left text-[14.5px]">
        <caption className="sr-only">Supported and planned capabilities</caption>
        <thead className="hidden md:table-header-group">
          <tr className="text-[12.5px] text-ink-2">
            <th scope="col" className="px-6 py-4 font-medium">Area</th>
            <th scope="col" className="px-6 py-4 font-medium">Capability</th>
            <th scope="col" className="px-6 py-4 font-medium">Detail</th>
            <th scope="col" className="px-6 py-4 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {CAPABILITY_TABLE.map((r) => (
            <tr key={r.name} className="grid border-t border-ink/10 p-5 md:table-row md:p-0">
              <td className="text-[12.5px] uppercase tracking-[0.1em] text-ink-2 md:px-6 md:py-4 md:align-top md:text-[13px] md:normal-case md:tracking-normal">{r.area}</td>
              <th scope="row" className="mt-1 font-medium md:mt-0 md:px-6 md:py-4 md:align-top">{r.name}</th>
              <td className="mt-1 text-ink-2 md:mt-0 md:px-6 md:py-4 md:align-top">{r.detail}</td>
              <td className="mt-3 md:mt-0 md:w-[160px] md:px-6 md:py-4 md:align-top"><AvailabilityTag status={r.status} onPaper /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- Roadmap ---------- */
export function RoadmapBlock() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="reveal rounded-[28px] bg-lime p-6 text-lime-ink sm:p-8">
        <div className="flex items-center justify-between">
          <h3 className="t-section">Available now</h3>
          <span className="inline-flex h-9 items-center rounded-full bg-white px-4 text-[13px] font-medium text-[#1746e4]">In this release</span>
        </div>
        <ul className="mt-8 grid gap-0">
          {AVAILABLE_NOW.map((a) => (
            <li key={a} className="flex items-start gap-3 border-t border-white/20 py-3.5 text-[15.5px]">
              <Check size={18} strokeWidth={2.2} className="mt-0.5 flex-none" aria-hidden />{a}
            </li>
          ))}
        </ul>
      </div>
      <div className="reveal reveal-d1 rounded-[28px] border border-dashed border-line-2 p-6 sm:p-8">
        <div className="flex items-center justify-between">
          <h3 className="t-section">Planned</h3>
          <span className="inline-flex h-9 items-center rounded-full border border-line-2 px-4 text-[13px] text-text-2">Not yet available</span>
        </div>
        <ul className="mt-8 grid">
          {PLANNED.map((p) => (
            <li key={p.t} className="border-t border-line py-3.5">
              <div className="text-[15.5px]">{p.t}</div>
              <div className="mt-1 text-[14px] leading-relaxed text-muted">{p.d}</div>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-[13px] leading-relaxed text-muted">Planned items describe direction, not committed delivery dates. We will tell you plainly what exists when you evaluate Hydris.</p>
      </div>
    </div>
  );
}

/* ---------- FAQ (Ambient style) ---------- */
export function Faq({ items, title, intro, action }: { items: { q: string; a: ReactNode }[]; title: ReactNode; intro?: ReactNode; action?: ReactNode }) {
  return (
    <div className="stage-paper faq px-5 py-14 sm:px-10 lg:px-14 lg:py-24">
      <div className="site-grid gap-y-10">
        <div className="col-span-12 flex flex-col lg:col-span-5">
          <h2 className="t-hero max-w-[14ch]">{title}</h2>
          {intro && <p className="mt-5 max-w-sm text-[15px] leading-relaxed text-ink-2">{intro}</p>}
          {action && <div className="mt-8 lg:mt-auto">{action}</div>}
        </div>
        <div className="col-span-12 lg:col-span-6 lg:col-start-7">
          {items.map((it, i) => (
            <details key={it.q} className="group border-b border-ink/15 py-6 first:pt-0" open={i === 0}>
              <summary className="flex items-start justify-between gap-6 rounded-lg text-[19px] leading-snug tracking-[-0.01em] lg:text-[21px]">
                {it.q}
                <span className="faq-icon grid h-10 w-10 flex-none place-items-center rounded-full border border-ink/20" aria-hidden><ArrowDown size={17} /></span>
              </summary>
              <div className="mt-3 max-w-[56ch] text-[15px] leading-relaxed text-ink-2">{it.a}</div>
            </details>
          ))}
        </div>
      </div>
    </div>
  );
}
