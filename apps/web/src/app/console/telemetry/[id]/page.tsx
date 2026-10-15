'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ClipboardPen, Download, FlaskConical, Info } from 'lucide-react';
import { CONDITION_LABELS, MEASURAND_DEFS } from '@hydris/domain';
import { download, errorMessage } from '@/lib/api';
import { useApi } from '@/lib/query';
import { useCan } from '@/lib/session';
import { fmtDateTime, fmtValue } from '@/lib/format';
import { Button, Capsule, Card, Chip, EmptyState, ErrorState, PageHeader, Skeleton, StateChip, SyntheticBadge, BackLink as UiBackLink } from '@/ui';
import { useToast } from '@/ui/overlay';
import { RadialGauge, TrendChart, gaugeDomain } from '@/ui/charts';
import type { AlarmListRow, AlarmRule, HistoryResponse, SensorRow } from '@/console/alarms-telemetry/types';
import { CONDITION_SHORT, MethodChip, ReadingStatus, SensorValue, When, conditionTone, fmtDuration } from '@/console/alarms-telemetry/bits';
import { RulesCard } from '@/console/alarms-telemetry/RulesCard';
import { ManualEntryDialog } from '@/console/alarms-telemetry/ManualEntryDialog';

const RANGES = { '1h': 3600_000, '6h': 6 * 3600_000, '24h': 86400_000, '7d': 7 * 86400_000, '30d': 30 * 86400_000 } as const;
type Range = keyof typeof RANGES;
const SOURCE_LABEL: Record<string, string> = { gateway: 'Edge gateway', manual: 'Manual entry', lab: 'Laboratory', simulator: 'Hydris simulator' };
const minuteFloor = (t: number) => Math.floor(t / 60_000) * 60_000;

export default function SensorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const can = useCan();
  const toast = useToast();
  const [range, setRange] = useState<Range>('24h');
  // Window start advances once a minute; the server uses "now" as the end so new readings appear on realtime refresh.
  const [anchor, setAnchor] = useState(() => minuteFloor(Date.now()));
  useEffect(() => {
    const t = setInterval(() => setAnchor(minuteFloor(Date.now())), 60_000);
    return () => clearInterval(t);
  }, []);
  const from = new Date(anchor - RANGES[range]).toISOString();

  const hist = useApi<HistoryResponse>(`/telemetry/sensors/${id}/history?from=${encodeURIComponent(from)}`, { placeholderData: (prev) => prev });
  const list = useApi<{ sensors: SensorRow[] }>('/sensors');
  const canAlarms = can('alarm.read');
  const rulesQ = useApi<{ rules: AlarmRule[] }>(canAlarms ? `/alarm-rules?sensorId=${id}` : null, { retry: false });
  const openQ = useApi<{ alarms: AlarmListRow[] }>(canAlarms ? '/alarms?state=open&limit=500' : null);
  const [entryOpen, setEntryOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const data = hist.data && hist.data.sensor.id === id ? hist.data : undefined;
  if (!data) {
    return (
      <>
        <BackLink />
        {hist.isError ? <ErrorState error={hist.error} onRetry={() => void hist.refetch()} /> : (
          <div className="grid gap-4" role="status" aria-label="Loading sensor">
            <Skeleton className="h-10 w-1/2" />
            <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]"><Skeleton className="h-[220px] rounded-[24px]" /><Skeleton className="h-[220px] rounded-[24px]" /></div>
            <Skeleton className="h-[340px] rounded-[24px]" />
          </div>
        )}
      </>
    );
  }

  const s = data.sensor;
  const meta = list.data?.sensors.find((x) => x.id === id);
  const def = MEASURAND_DEFS[s.measurand];
  const rules = rulesQ.data?.rules ?? [];
  const thresholds = rules.filter((r) => r.enabled && r.condition !== 'stale' && r.threshold !== null)
    .map((r) => ({ value: r.threshold!, label: `${CONDITION_SHORT[r.condition]} ${fmtValue(r.threshold, undefined, s.decimals)}`, tone: conditionTone(r.condition) }));
  const openAlarms = (openQ.data?.alarms ?? []).filter((a) => a.sensorId === id);
  const entrySource = !s.enabled ? null : s.method === 'lab' ? (can('sensor.manage') ? 'lab' : null) : s.method === 'manual' ? (can('inspection.execute') ? 'manual' : null) : null;
  const rulesForbidden = (rulesQ.error as { status?: number } | null)?.status === 403;
  const isLabLike = s.method !== 'continuous';

  const exportCsv = async () => {
    setExporting(true);
    try {
      await download(`/telemetry/sensors/${id}/export.csv?from=${encodeURIComponent(from)}&to=${encodeURIComponent(new Date().toISOString())}`, `${s.tag}-${range}-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (e) {
      toast({ title: 'Export failed', body: errorMessage(e), tone: 'critical' });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="fade-in">
      <BackLink />
      <PageHeader eyebrow={<>Sensor · <span className="font-mono normal-case tracking-normal">{s.tag}</span></>} title={s.name}
        actions={<>
          {entrySource && <Button variant="primary" icon={entrySource === 'lab' ? <FlaskConical size={16} aria-hidden /> : <ClipboardPen size={16} aria-hidden />} onClick={() => setEntryOpen(true)}>
            {entrySource === 'lab' ? 'Record lab result' : 'Record reading'}</Button>}
          {can('report.export') && <Button icon={<Download size={16} aria-hidden />} busy={exporting} onClick={() => void exportCsv()}>Export CSV</Button>}
        </>}>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-text-2">
          <span>{s.label}</span>
          {meta?.assetId && <><span aria-hidden>·</span><Link href={`/console/assets/${meta.assetId}`} className="hover:text-text hover:underline">{meta.assetTag}{meta.assetName ? ` ${meta.assetName}` : ''}</Link></>}
          <MethodChip method={s.method} />
          {s.lastSource === 'simulator' && <SyntheticBadge />}
          {!s.enabled && <Chip tone="outline">Disabled</Chip>}
        </div>
      </PageHeader>

      <div className="grid gap-4">
        <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
          <section className="card flex flex-col gap-4" aria-labelledby="latest-h">
            <h2 id="latest-h" className="t-label">{isLabLike ? (s.method === 'lab' ? 'Latest lab result' : 'Latest manual reading') : 'Latest value'}</h2>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="grid gap-3">
                <SensorValue value={s.lastValue} unit={s.unit} decimals={s.decimals} freshness={s.freshness} size="lg" />
                <ReadingStatus method={s.method} freshness={s.freshness} ts={s.lastTs} />
              </div>
              <LimitGauge value={s.lastValue} stale={s.freshness === 'stale' || s.freshness === 'no_data'} unit={s.unit} decimals={s.decimals} typical={s.typicalRange ?? null} limits={thresholds} />
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <div><dt className="t-label">{isLabLike ? 'Sampled' : 'Observed'}</dt><dd className="num mt-1">{fmtDateTime(s.lastTs)}</dd></div>
              <div><dt className="t-label">Source</dt><dd className="mt-1">{s.lastSource ? SOURCE_LABEL[s.lastSource] ?? s.lastSource : '—'}</dd></div>
              <div><dt className="t-label">Expected every</dt><dd className="num mt-1">{fmtDuration(s.expectedIntervalS)}</dd></div>
              <div><dt className="t-label">Quality</dt><dd className="mt-1">{s.lastQuality ? (s.lastQuality === 'good' ? 'Good' : <Chip tone="medium">{s.lastQuality}</Chip>) : '—'}</dd></div>
            </dl>
            {s.freshness === 'stale' && <p className="text-[13px] text-high-text">This value is stale and may not reflect current conditions.</p>}
          </section>

          <section className="card card-paper" aria-labelledby="what-h">
            <h2 id="what-h" className="t-card">What this measures</h2>
            <p className="mt-3 text-[15px] leading-relaxed">{s.explanation}</p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div><div className="t-label">Measurand · unit</div><div className="mt-1">{def.label} · {s.unit}</div></div>
              <div><div className="t-label">Typical operating band</div>
                <div className="num mt-1">{s.typicalRange ? `${s.typicalRange[0]} – ${s.typicalRange[1]} ${s.unit}` : 'Depends on plant design'}</div>
                {s.typicalRange && <div className="text-xs muted">Orientation only, not an alarm limit.</div>}
              </div>
            </div>
          </section>
        </div>

        <Card title="Trend" action={<Capsule label="Time range" value={range} onChange={setRange} options={(Object.keys(RANGES) as Range[]).map((r) => ({ value: r, label: r }))} />}>
          <div className={hist.isFetching && hist.isPlaceholderData ? 'opacity-60 transition-opacity' : undefined} aria-busy={hist.isFetching || undefined}>
            {data.points.length ? (
              <>
                <TrendChart points={data.points} unit={s.unit} decimals={s.decimals} thresholds={thresholds} height={300} band={s.typicalRange ?? null} />
                <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                  <span className="num">{data.totalReadings.toLocaleString()} reading{data.totalReadings === 1 ? '' : 's'}</span>
                  <span>{data.bucketSeconds ? `Averaged per ${fmtDuration(data.bucketSeconds)} · shaded band shows min–max` : 'Raw readings'}</span>
                  <span className="num">{fmtDateTime(data.from)} – {fmtDateTime(data.to)}</span>
                  {thresholds.length > 0 && <span>Dashed lines: enabled alarm limits</span>}
                  {s.typicalRange && <span>Dotted green: typical operating band</span>}
                </p>
                {isLabLike && <p className="mt-2 flex items-start gap-2 text-xs text-muted"><Info size={14} strokeWidth={1.8} className="mt-0.5 flex-none" aria-hidden />Each point is an individual {s.method === 'lab' ? 'lab result' : 'manual reading'}; the line between points is not a measurement.</p>}
              </>
            ) : (
              <EmptyState title={`No ${isLabLike ? 'results' : 'readings'} in the last ${range}`} body={s.lastTs ? `The most recent value was recorded ${fmtDateTime(s.lastTs)}. Choose a longer range.` : 'This sensor has not reported any data yet.'} />
            )}
          </div>
        </Card>

        {canAlarms && !rulesForbidden && (
          <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <RulesCard q={rulesQ} canManage={can('alarm_rule.manage')} sensor={{ id: s.id, tag: s.tag, unit: s.unit, decimals: s.decimals, expectedIntervalS: s.expectedIntervalS }} />
            <Card title="Open alarms on this sensor">
              {openQ.isError ? <ErrorState error={openQ.error} onRetry={() => void openQ.refetch()} /> : !openQ.data ? <Skeleton className="h-16" /> : openAlarms.length ? (
                <ul className="grid gap-2">
                  {openAlarms.map((a) => (
                    <li key={a.id}>
                      <Link href={`/console/alarms/${a.id}`} className="flex items-center gap-3 rounded-2xl bg-bg-2 px-4 py-3 hover:bg-surface-2">
                        <span className="dot" style={{ background: `var(--color-${a.severity})` }} aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">{CONDITION_LABELS[a.condition]} · {a.title}</span>
                          <When at={a.triggeredAt} className="text-xs text-muted" />
                        </span>
                        {a.synthetic && <SyntheticBadge />}
                        <StateChip state={a.state} />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-muted">No open alarms. The value is within all configured limits.</p>}
            </Card>
          </div>
        )}
      </div>

      {entrySource && entryOpen && <ManualEntryDialog open onOpenChange={setEntryOpen} source={entrySource} sensor={{ id: s.id, tag: s.tag, name: s.name, measurand: s.measurand, unit: s.unit }} />}
    </div>
  );
}

/** Latest value on a ring scaled to the typical band and alarm limits, with the limits as ticks. */
function LimitGauge({ value, stale, unit, decimals, typical, limits }: { value: number | null; stale: boolean; unit: string; decimals: number; typical: [number, number] | null; limits: { value: number; label: string; tone: string }[] }) {
  const dom = gaugeDomain([value, ...(typical ?? []), ...limits.map((l) => l.value)]);
  if (!dom || (!typical && !limits.length)) return null;
  const breached = value !== null && limits.some((l) => (l.label.startsWith('H') || l.label.startsWith('>') ? value >= l.value : value <= l.value));
  const out = value !== null && typical && (value < typical[0] || value > typical[1]);
  return (
    <RadialGauge value={stale ? null : value} min={dom[0]} max={dom[1]} display={value === null ? undefined : fmtValue(value, undefined, decimals)} unit={unit} size={132} thickness={9}
      band={typical ?? undefined} marks={limits.map((l) => ({ value: l.value, color: l.tone, label: l.label }))}
      tone={breached ? 'var(--color-critical)' : out ? 'var(--color-high)' : 'var(--color-signal)'}
      label={stale ? 'stale' : breached ? 'beyond a limit' : out ? 'outside typical' : typical ? 'within typical' : 'latest'}
      ariaLabel={`Latest value ${value === null || stale ? 'not available' : `${fmtValue(value, undefined, decimals)} ${unit}`}${typical ? `, typical band ${typical[0]} to ${typical[1]} ${unit}` : ''}${limits.length ? `, alarm limits ${limits.map((l) => l.label).join(', ')}` : ''}`} />
  );
}

function BackLink() {
  return <UiBackLink href="/console/telemetry">All sensors</UiBackLink>;
}
