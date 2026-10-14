import clsx from 'clsx';
import type { ReactNode } from 'react';

/* Animated SVG system diagrams. Desktop renders a wide SVG; below lg an equivalent
 * stacked HTML version is used so labels stay readable at 360px. */

type Tone = 'dark' | 'lime' | 'paper' | 'ghost';
function Box({ x, y, w, h, title, lines = [], tone = 'dark', step }: { x: number; y: number; w: number; h: number; title: string; lines?: string[]; tone?: Tone; step?: string }) {
  const fill = tone === 'lime' ? 'var(--color-lime)' : tone === 'paper' ? 'var(--color-paper)' : tone === 'ghost' ? 'transparent' : '#1b1b1b';
  const ink = tone === 'lime' || tone === 'paper' ? '#141714' : '#f3f4f1';
  const sub = tone === 'lime' || tone === 'paper' ? 'rgb(20 23 20 / 0.7)' : '#a9aba6';
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={Math.min(28, h / 2)} fill={fill} stroke={tone === 'ghost' ? 'rgb(255 255 255 / 0.25)' : tone === 'dark' ? 'rgb(255 255 255 / 0.14)' : 'none'} strokeDasharray={tone === 'ghost' ? '5 6' : undefined} />
      {step && <text x={x + w - 22} y={y + 34} textAnchor="end" fontSize="14" fill={sub} fontFamily="var(--font-sans)">{step}</text>}
      <text x={x + 22} y={y + 36} fontSize="19" fill={ink} fontFamily="var(--font-sans)" style={{ letterSpacing: '-0.01em' }}>{title}</text>
      {lines.map((l, i) => (
        <text key={i} x={x + 22} y={y + 62 + i * 21} fontSize="14" fill={sub} fontFamily="var(--font-sans)">{l}</text>
      ))}
    </g>
  );
}

function Flow({ d, reverse, slow, color = 'var(--color-lime)', label, lx, ly, muted }: { d: string; reverse?: boolean; slow?: boolean; color?: string; label?: string; lx?: number; ly?: number; muted?: boolean }) {
  return (
    <g>
      <path d={d} fill="none" stroke="rgb(255 255 255 / 0.12)" strokeWidth="2" />
      <path d={d} fill="none" stroke={color} strokeWidth="2.5" className={clsx('flow-line', reverse && 'flow-line-rev', slow && 'flow-line-slow')} opacity={muted ? 0.6 : 1} />
      {label && lx !== undefined && ly !== undefined && (
        <g>
          <rect x={lx - 4} y={ly - 15} width={label.length * 7.4 + 16} height="24" rx="12" fill="#0a0a0a" stroke="rgb(255 255 255 / 0.14)" />
          <text x={lx + 4} y={ly + 2} fontSize="12.5" fill="#c4c6c0" fontFamily="var(--font-sans)">{label}</text>
        </g>
      )}
    </g>
  );
}

function StackItem({ title, body, tone = 'dark', tag }: { title: string; body: ReactNode; tone?: 'dark' | 'lime' | 'ghost'; tag?: string }) {
  return (
    <li className={clsx('relative rounded-[22px] p-5', tone === 'lime' ? 'bg-lime text-lime-ink' : tone === 'ghost' ? 'border border-dashed border-line-2' : 'border border-line bg-surface')}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="t-card">{title}</h3>
        {tag && <span className={clsx('num text-[13px]', tone === 'lime' ? 'text-lime-ink/70' : 'text-muted')}>{tag}</span>}
      </div>
      <p className={clsx('mt-1.5 text-[14px] leading-relaxed', tone === 'lime' ? 'text-lime-ink/75' : 'text-text-2')}>{body}</p>
    </li>
  );
}

function StackConnector({ label }: { label?: string }) {
  return (
    <li aria-hidden className="flex items-center gap-3 py-1 pl-8">
      <svg width="4" height="40" viewBox="0 0 4 40"><path d="M2 0v40" stroke="var(--color-lime)" strokeWidth="2.5" className="flow-line" /></svg>
      {label && <span className="text-[12.5px] text-muted">{label}</span>}
    </li>
  );
}

/** Glasses ↔ platform ↔ console, fed by edge gateways. */
export function PlatformDiagram() {
  return (
    <figure className="m-0">
      <svg viewBox="0 0 1200 560" role="img" aria-labelledby="pd-title pd-desc" className="hidden w-full lg:block">
        <title id="pd-title">Hydris connected platform</title>
        <desc id="pd-desc">Plant equipment readings reach the Hydris platform through an edge gateway over HTTPS. The platform streams live context to the operator console and the field glasses; glasses send step responses back. There is no control path from Hydris to plant equipment.</desc>
        {/* flows */}
        <Flow d="M155 170 V 236" label="readings" lx={168} ly={210} />
        <Flow d="M270 296 C 360 296, 360 280, 440 280" label="HTTPS · batches" lx={300} ly={268} />
        <Flow d="M270 452 C 360 452, 360 330, 440 330" slow label="manual & lab entry" lx={262} ly={430} muted />
        <Flow d="M760 220 C 840 220, 840 150, 920 150" label="live context" lx={784} ly={160} />
        <Flow d="M760 360 C 840 360, 840 420, 920 420" label="rounds · alarms · SOPs" lx={770} ly={428} />
        <Flow d="M920 456 C 830 456, 830 392, 760 392" reverse slow color="#9ebcff" />
        <Flow d="M1060 210 V 360" slow color="#9ebcff" label="dispatch & assign" lx={1072} ly={290} />
        {/* no control path */}
        <path d="M440 200 C 360 120, 330 120, 270 120" fill="none" stroke="var(--color-critical)" strokeWidth="2" strokeDasharray="4 7" opacity="0.8" />
        <g transform="translate(352 128)">
          <circle r="13" fill="#0a0a0a" stroke="var(--color-critical)" strokeWidth="2" />
          <path d="M-5 -5 L5 5 M5 -5 L-5 5" stroke="var(--color-critical)" strokeWidth="2.2" strokeLinecap="round" />
        </g>
        <text x="292" y="98" fontSize="13" fill="#ff8a80" fontFamily="var(--font-sans)">No control path — advisory only</text>

        <Box x={40} y={70} w={230} h={100} title="Plant equipment" lines={['Pumps, blowers, tanks,', 'analyzers · your SCADA/PLC']} />
        <Box x={40} y={236} w={230} h={120} title="Edge gateway" lines={['Per-site API key', 'HTTPS POST, ≤ 500/batch', 'MQTT · OPC UA: planned']} />
        <Box x={40} y={400} w={230} h={104} title="Lab & manual" lines={['Grab samples, field', 'readings with provenance']} tone="ghost" />

        <rect x="440" y="150" width="320" height="300" rx="32" fill="#141414" stroke="var(--color-lime)" strokeOpacity="0.55" strokeWidth="1.5" />
        <text x="468" y="194" fontSize="22" fill="#f3f4f1" fontFamily="var(--font-sans)">Hydris platform</text>
        <text x="468" y="218" fontSize="13.5" fill="#a9aba6" fontFamily="var(--font-sans)">Multi-tenant · audited · least privilege</text>
        {['Ingestion & validation', 'Alarm evaluation', 'Tenant-isolated storage', 'Realtime stream (SSE)'].map((t, i) => (
          <g key={t}>
            <rect x="464" y={240 + i * 49} width="272" height="40" rx="20" fill={i === 3 ? 'var(--color-lime)' : '#222'} />
            <text x="484" y={265 + i * 49} fontSize="14.5" fill={i === 3 ? '#141714' : '#e5e6e2'} fontFamily="var(--font-sans)">{t}</text>
          </g>
        ))}
        <circle cx="440" cy="280" r="5" fill="var(--color-lime)" />
        <circle cx="440" cy="280" r="5" fill="var(--color-lime)" className="flow-pulse" />

        <Box x={920} y={90} w={250} h={120} title="Operator Console" lines={['Sites, assets, alarms,', 'inspections, fleet, audit']} tone="paper" />
        <Box x={920} y={360} w={250} h={130} title="Field Glasses" lines={['600 × 600 display viewport', 'Context, rounds, SOPs', 'Offline step queue']} tone="lime" />
      </svg>

      <ol className="grid lg:hidden" aria-label="Hydris connected platform, step by step">
        <StackItem title="Plant equipment" body="Pumps, blowers, tanks and analyzers. Your SCADA/PLC stays in control." />
        <StackConnector label="readings" />
        <StackItem title="Edge gateway" body="Per-site API key, HTTPS batches of up to 500 readings. MQTT and OPC UA adapters are planned." />
        <StackConnector label="HTTPS" />
        <StackItem title="Hydris platform" body="Ingestion & validation, alarm evaluation, tenant-isolated storage and a realtime (SSE) stream." />
        <StackConnector label="live context" />
        <StackItem title="Operator Console" body="Sites, assets, alarms, inspections, maintenance, operators and the glasses fleet." />
        <StackConnector label="rounds · alarms · SOPs" />
        <StackItem title="Field Glasses" tone="lime" body="Live context, guided rounds and approved SOPs; step responses are queued offline and synced back." />
        <li className="mt-4 rounded-[18px] border border-[rgb(255_90_78/0.35)] p-4 text-[14px] text-[#ff8a80]">No control path from Hydris to plant equipment — advisory only.</li>
      </ol>
      <figcaption className="sr-only">Diagram of how plant data reaches operators through Hydris.</figcaption>
    </figure>
  );
}

const PIPE = [
  { n: '01', t: 'Plant equipment', l: ['Sensors on pumps, blowers,', 'tanks and analyzers'] },
  { n: '02', t: 'Edge gateway', l: ['Per-site key, HTTPS POST', 'MQTT / OPC UA planned'] },
  { n: '03', t: 'Ingestion API', l: ['Gateway auth, rate limits', 'Unknown tags rejected per item'] },
  { n: '04', t: 'Validate & normalise', l: ['Units, timestamps, quality', 'Duplicates dropped by message ID'] },
  { n: '05', t: 'Store & evaluate', l: ['Tenant-scoped time series', 'Deadband + on-delay alarms'] },
  { n: '06', t: 'Realtime (SSE)', l: ['Per-connection authorisation', 'Last-Event-ID replay'] },
  { n: '07', t: 'Operator Console', l: ['Live overview, alarms,', 'history & CSV export'] },
  { n: '08', t: 'Field Glasses', l: ['Asset context in view', 'Freshness on every value'] },
];

/** Telemetry ingestion pipeline, snake layout. */
export function PipelineDiagram() {
  const W = 236, H = 118, G = 52, X0 = 34;
  const col = (i: number) => X0 + i * (W + G);
  return (
    <figure className="m-0">
      <svg viewBox="0 0 1200 470" role="img" aria-labelledby="pp-title pp-desc" className="hidden w-full lg:block">
        <title id="pp-title">Telemetry ingestion pipeline</title>
        <desc id="pp-desc">{PIPE.map((p) => `${p.n} ${p.t}: ${p.l.join(' ')}`).join('. ')}</desc>
        {/* row 1 flows */}
        {[0, 1, 2].map((i) => <Flow key={i} d={`M${col(i) + W} ${60 + H / 2} H ${col(i + 1)}`} />)}
        {/* down the right edge */}
        <Flow d={`M${col(3) + W / 2} ${60 + H} V 300`} />
        {/* row 2 flows (right to left) */}
        <Flow d={`M${col(3)} ${300 + H / 2} H ${col(2) + W}`} />
        <Flow d={`M${col(2)} ${300 + H / 2 - 22} C ${col(2) - 26} ${300 + H / 2 - 22}, ${col(1) + W + 26} ${300 + 30}, ${col(1) + W} ${300 + 30}`} />
        <Flow d={`M${col(2)} ${300 + H / 2 + 22} C ${col(1) + W} ${440}, ${col(0) + W + 60} ${440}, ${col(0) + W / 2} ${300 + H}`} slow />
        {/* rejected branch */}
        <path d={`M${col(2) + W / 2} ${60 + H} V 230`} stroke="rgb(255 138 128 / 0.7)" strokeWidth="2" strokeDasharray="3 6" fill="none" />
        <text x={col(2) + W / 2 + 10} y={222} fontSize="13" fill="#ff8a80" fontFamily="var(--font-sans)">rejected items returned with a reason</text>
        {PIPE.slice(0, 4).map((p, i) => <Box key={p.n} x={col(i)} y={60} w={W} h={H} title={p.t} lines={p.l} step={p.n} tone={i === 3 ? 'paper' : 'dark'} />)}
        <Box x={col(3)} y={300} w={W} h={H} title={PIPE[4]!.t} lines={PIPE[4]!.l} step={PIPE[4]!.n} />
        <Box x={col(2)} y={300} w={W} h={H} title={PIPE[5]!.t} lines={PIPE[5]!.l} step={PIPE[5]!.n} tone="lime" />
        <Box x={col(1)} y={300} w={W} h={H} title={PIPE[6]!.t} lines={PIPE[6]!.l} step={PIPE[6]!.n} />
        <Box x={col(0)} y={300} w={W} h={H} title={PIPE[7]!.t} lines={PIPE[7]!.l} step={PIPE[7]!.n} />
      </svg>
      <ol className="grid lg:hidden" aria-label="Telemetry ingestion pipeline">
        {PIPE.map((p, i) => (
          <StackRow key={p.n} last={i === PIPE.length - 1}>
            <StackItem title={p.t} body={p.l.join(' ')} tag={p.n} tone={p.n === '06' ? 'lime' : 'dark'} />
          </StackRow>
        ))}
      </ol>
    </figure>
  );
}

function StackRow({ children, last }: { children: ReactNode; last?: boolean }) {
  return (
    <>
      {children}
      {!last && <StackConnector />}
    </>
  );
}
