import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Check, X } from 'lucide-react';
import { PlantSchematic } from '@/site/art';
import { CtaBand, HlPill, PageIntro, SectionLabel } from '@/site/primitives';
import { DeviceFrame, GlassesScreen, HudAlert, HudList, HudReading, HudSop, HudStep } from '@/site/vignettes';

export const metadata: Metadata = {
  title: 'Wastewater operations',
  description:
    'How Hydris Field Glasses supports ETP, STP and WTP work: pump inspections, tank monitoring, chemical dosing observations, filtration, sensor verification, routine maintenance, fault documentation and SOP guidance. Advisory only.',
  alternates: { canonical: '/operations' },
};

interface UseCase { id: string; area: string; title: string; body: string; terms: string[]; screen: ReactNode }

const CASES: UseCase[] = [
  {
    id: 'pump-inspections', area: 'ETP · Equalization', title: 'Pump inspections',
    body: 'Walk up to transfer pump P-101 and see drive-end vibration, motor current and discharge pressure with their limits. The routine template asks for seal leakage, bearing temperature and abnormal noise — each step flagged if outside the expected range.',
    terms: ['DE / NDE bearing vibration (mm/s)', 'Mechanical seal leakage', 'Motor current vs FLA', 'Discharge pressure'],
    screen: <GlassesScreen label="Glasses: P-101 inspection step about mechanical seal leakage" header="P-101 · Transfer pump" status="Step 2/7" statusTone="lime"><HudStep step="Step 2 of 7" kind="Choice" title="Mechanical seal leakage" options={['None visible', 'Drips < 1 per min', 'Steady leak']} /></GlassesScreen>,
  },
  {
    id: 'tank-monitoring', area: 'ETP · Equalization', title: 'Tank monitoring',
    body: 'Level, pH and inflow context at the equalization tank. When LT-101 approaches its high limit the alarm reaches the operator on the round — the decision to start a standby pump or divert stays with the control room and procedure.',
    terms: ['Level (% span)', 'High / high-high limits', 'Freeboard', 'Inflow vs transfer rate'],
    screen: <GlassesScreen label="Glasses: LT-101 level 87 percent high" header="T-101 · Equalization tank" status="High" statusTone="high"><HudReading tag="LT-101" name="Tank level" value="87" unit="%" tone="high" state="High" limit="HH at 92" foot="P-101 running · 18.9 A" /></GlassesScreen>,
  },
  {
    id: 'chemical-dosing', area: 'Chemical dosing', title: 'Chemical dosing observations',
    body: 'Record coagulant pump stroke and speed, calibration-column drawdown, day-tank level and injection-point condition. Hydris records the observation; any dose change is made through the dosing controller by an authorised person.',
    terms: ['Calibration column drawdown', 'Stroke length / frequency', 'Day-tank level', 'Injection quill condition'],
    screen: <GlassesScreen label="Glasses: DP-301 coagulant dosing flow 0.42 litres per hour" header="DP-301 · Coagulant dosing" status="Live"><HudReading tag="FT-301" name="Dosing flow" value="0.42" unit="L/h" state="Within range" limit="0.38–0.46" /></GlassesScreen>,
  },
  {
    id: 'filtration', area: 'WTP · Filtration', title: 'Filtration & clarification',
    body: 'Check clarifier sludge blanket and effluent turbidity, filter head loss and backwash condition. Turbidity at the clarifier outlet and final analyzer sit side by side so a rising trend is caught before discharge.',
    terms: ['Turbidity (NTU)', 'Sludge blanket depth', 'Filter head loss', 'Backwash interval'],
    screen: <GlassesScreen label="Glasses: AIT-401 clarifier turbidity 4.2 NTU" header="CL-401 · Secondary clarifier" status="Live"><HudReading tag="AIT-401" name="Outlet turbidity" value="4.2" unit="NTU" state="Normal" limit="Final AIT-502 2.1" /></GlassesScreen>,
  },
  {
    id: 'sensor-verification', area: 'Instrumentation', title: 'Sensor verification',
    body: 'Compare an online analyzer against a handheld or grab sample at the panel. The reading step stores the manual value with its source next to the online value, so drift is visible in history — not hidden in a logbook.',
    terms: ['Online vs grab sample', 'Buffer check (pH 4 / 7)', 'Data freshness', 'Quality flag'],
    screen: <GlassesScreen label="Glasses: verification step comparing pH analyzer with handheld reading" header="AN-501 · Effluent analyzer" status="Step 4/6" statusTone="lime"><HudStep step="Step 4 of 6" kind="Reading" title="Handheld pH at sample tap" caution="Wear face shield at sample point" options={['Enter 7.38', 'Online AIT-501: 7.41']} /></GlassesScreen>,
  },
  {
    id: 'routine-maintenance', area: 'Maintenance', title: 'Routine maintenance',
    body: 'Preventive tasks arrive with their checklist: blower filter, belt tension, lubrication points, dosing-pump diaphragm. Each item is ticked with a timestamp; notes and follow-ups go back to the maintenance record in the console.',
    terms: ['PM checklist', 'Lubrication schedule', 'Belt tension', 'Runtime hours'],
    screen: <GlassesScreen label="Glasses: maintenance task list for the shift" header="Maintenance · Shift B" status="3 due" statusTone="medium"><HudList title="Today’s tasks" items={[{ label: 'BL-102 inlet filter', meta: 'PM', tone: 'medium' }, { label: 'DP-301 diaphragm', meta: 'PM', tone: 'medium' }, { label: 'P-101 grease DE/NDE', meta: '2 pts', tone: 'ok' }]} /></GlassesScreen>,
  },
  {
    id: 'fault-documentation', area: 'Alarms & faults', title: 'Fault documentation',
    body: 'When an alarm fires, the operator on the round sees it first in view. Observations — what was found, what was isolated under permit, what follow-up is needed — are recorded against the alarm and reviewed in the console.',
    terms: ['Alarm acknowledge → investigate → resolve', 'Notes with timestamps', 'Follow-up work order', 'Audit trail'],
    screen: <GlassesScreen label="Glasses: critical vibration alarm on P-101" header="Alarm" status="Critical" statusTone="critical"><HudAlert severity="critical" title="VT-101 vibration high-high" detail="7.4 mm/s · P-101 transfer pump" action="Record observation" /></GlassesScreen>,
  },
  {
    id: 'sop-guidance', area: 'Procedures', title: 'SOP guidance',
    body: 'Approved procedures linked to the asset or asset type, shown one step at a time with cautions first. Drafts never reach operators or devices; when a revision is approved, everyone sees the same one.',
    terms: ['Approved revisions only', 'Caution before step', 'Asset-linked', 'Full-text search in console'],
    screen: <GlassesScreen label="Glasses: approved SOP for blower restart checks" header="BL-102 · Aeration blower" status="SOP" statusTone="lime"><HudSop code="SOP-AER-02 · rev 5" title="Blower restart checks" current={1} steps={['Confirm reason for trip logged', 'Check inlet filter ΔP', 'Verify belt & guard in place', 'Notify control room to restart']} /></GlassesScreen>,
  },
];

export default function OperationsPage() {
  return (
    <>
      <PageIntro
        tags={['ETP', 'STP', 'WTP', 'Advisory only']}
        label="Wastewater operations"
        title={<>Real rounds. Real tags. <HlPill tone="lime">ETP · STP · WTP</HlPill> work, guided step by step.</>}
        lead="Every example below uses the tags of our reference effluent treatment plant — the same plant that runs in the live demo. The terminology is the one your operators already use."
        aside={
          <div className="rounded-[28px] border border-line bg-surface p-4">
            <PlantSchematic className="h-auto w-full" highlight="P-101" />
            <p className="mt-2 px-2 text-[12.5px] text-muted">Reference plant ETP-01 · lime line = morning inspection round</p>
          </div>
        }
      />

      <nav aria-label="Use cases on this page" className="site-container">
        <ul className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-2 scrollbar-none sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
          {CASES.map((c) => <li key={c.id} className="flex-none snap-start"><a href={`#${c.id}`} className="btn btn-sm btn-secondary">{c.title}</a></li>)}
          <li className="flex-none snap-start"><a href="#advisory" className="btn btn-sm btn-primary">Advisory vs control</a></li>
        </ul>
      </nav>

      <div className="site-container site-section-tight">
        {CASES.map((c, i) => (
          <section key={c.id} id={c.id} aria-labelledby={`${c.id}-title`} className="grid scroll-mt-28 gap-10 border-t border-line py-14 lg:grid-cols-12 lg:items-center lg:py-20">
            <div className={`lg:col-span-6 ${i % 2 ? 'lg:order-2 lg:col-start-7' : ''}`}>
              <SectionLabel className="reveal" index={String(i + 1).padStart(2, '0')}>{c.area}</SectionLabel>
              <h2 id={`${c.id}-title`} className="t-hero reveal mt-5">{c.title}</h2>
              <p className="reveal mt-6 max-w-[56ch] text-[16px] leading-relaxed text-text-2">{c.body}</p>
              <ul className="reveal mt-8 flex flex-wrap gap-2" aria-label="Terminology">
                {c.terms.map((t) => <li key={t} className="tag-pill text-text-2">{t}</li>)}
              </ul>
            </div>
            <div className={`reveal mx-auto w-full max-w-[380px] lg:col-span-4 ${i % 2 ? 'lg:order-1 lg:col-start-2' : 'lg:col-start-8'}`}>
              <DeviceFrame>{c.screen}</DeviceFrame>
            </div>
          </section>
        ))}
      </div>

      <section id="advisory" className="site-container site-section-tight scroll-mt-28" aria-labelledby="advisory-title">
        <div className="stage-paper px-5 py-14 sm:px-10 lg:px-14 lg:py-24">
          <SectionLabel className="reveal">Advisory vs control</SectionLabel>
          <h2 id="advisory-title" className="t-statement reveal mt-8 max-w-[22ch]">Hydris informs the operator. <span className="text-ink-2">Your control system controls the plant.</span></h2>
          <div className="mt-14 grid gap-4 md:grid-cols-2">
            <div className="reveal rounded-[28px] bg-paper p-6 sm:p-8">
              <h3 className="t-section">Hydris does</h3>
              <ul className="mt-6 grid gap-3 text-[15.5px]">
                {['Show live readings, limits and data freshness', 'Raise and route alarms to the right people', 'Guide inspections, rounds and approved SOPs', 'Record observations, readings and checklist items', 'Keep an audit trail of who did what, when'].map((t) => (
                  <li key={t} className="flex gap-3"><Check size={18} className="mt-0.5 flex-none" aria-hidden />{t}</li>
                ))}
              </ul>
            </div>
            <div className="reveal reveal-d1 rounded-[28px] bg-ink p-6 text-paper sm:p-8">
              <h3 className="t-section">Hydris never</h3>
              <ul className="mt-6 grid gap-3 text-[15.5px]">
                {['Starts, stops or changes the speed of pumps and blowers', 'Opens or closes valves or gates', 'Changes chemical dose rates or setpoints', 'Writes to SCADA, PLCs, DCS or field devices', 'Authorises isolation, permits or lockout / tagout'].map((t) => (
                  <li key={t} className="flex gap-3"><X size={18} className="mt-0.5 flex-none text-critical" aria-hidden />{t}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <CtaBand title="Map Hydris to your own rounds." />
    </>
  );
}
