'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ArrowUpRight, CheckCircle2 } from 'lucide-react';
import { ALARM_SEVERITIES, ASSET_STATUS_LABELS, MAINTENANCE_PRIORITIES, type AlarmSeverity, type AssetStatus, type Freshness } from '@hydris/domain';
import { useApi } from '@/lib/query';
import { useCan, useSession } from '@/lib/session';
import { ago, fmtValue } from '@/lib/format';
import { Capsule, Card, EmptyState, KpiCard, OpenLink, PageHeader, QueryView, SeverityChip, Skeleton, StateChip, SyntheticBadge, Timeline } from '@/ui';
import { BarList, BulletBar, Delta, Donut, PRIORITY_COLORS, RadialGauge, SEVERITY_COLORS, Sparkbars, StackedBar, StatusStrip, type Datum } from '@/ui/charts';
import type { AlarmListRow } from '@/console/alarms-telemetry/types';
import type { MaintenanceRow } from '@/console/work/shared';

interface Overview {
  generatedAt: string;
  alarms: { active: number; critical: number; open: number; last24h: number };
  inspections: { due: number; overdue: number; review: number; done7d: number };
  maintenance: { open: number; urgent: number };
  devices: { registered: number; connected: number };
  activeOperators: number;
  sites: { id: string; name: string; code: string; assets: number; degraded: number; openAlarms: number; criticalAlarms: number }[];
  assetHealth: { status: AssetStatus; n: number }[];
  metrics: { id: string; tag: string; name: string; assetTag: string | null; label: string; unit: string; decimals: number; value: number | null; ts: string | null; source: string | null; freshness: Freshness }[];
  recentAlarms: { id: string; title: string; severity: AlarmSeverity; state: string; triggeredAt: string; assetTag: string | null; synthetic: boolean }[];
  activity: { id: string; action: string; summary: string | null; at: string; actorName: string | null; actorLabel: string | null }[];
  alarmTrend: { day: string; n: number }[];
}

const HEALTH_ORDER: AssetStatus[] = ['operational', 'standby', 'maintenance', 'degraded', 'down'];
// Active Green is for small indicators only; large fills use a dimmed mix so they never become neon.
const OK_FILL = 'color-mix(in srgb, var(--color-ok) 50%, var(--color-surface-3))';
const HEALTH_COLOR: Record<string, string> = {
  operational: OK_FILL, standby: 'var(--color-muted)', maintenance: 'var(--color-cobalt)', degraded: 'var(--color-medium)', down: 'var(--color-critical)',
};
const SEV_LABEL: Record<AlarmSeverity, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };
const SEV_RANK: Record<AlarmSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const HOUR = 3600_000;

export default function PlantOverviewPage() {
  const s = useSession();
  const can = useCan();
  const sites = useApi<{ sites: { id: string; name: string }[] }>('/sites');
  const [siteId, setSiteId] = useState<string>('all');
  const siteQs = siteId !== 'all' ? `siteId=${siteId}` : '';
  const q = useApi<Overview>(`/overview${siteQs ? `?${siteQs}` : ''}`, { refetchInterval: 30_000 });
  // Distributions are computed client-side from the list endpoints (the overview payload only carries totals).
  const canAlarms = can('alarm.read');
  const canMaint = can('maintenance.read');
  const openAlarms = useApi<{ alarms: AlarmListRow[] }>(canAlarms ? `/alarms?state=open&limit=500${siteQs ? `&${siteQs}` : ''}` : null, { refetchInterval: 30_000 });
  // Last 24 whole hours; the query key only changes once an hour.
  const since = Math.floor(Date.now() / HOUR) * HOUR - 23 * HOUR;
  const dayAlarms = useApi<{ alarms: AlarmListRow[] }>(canAlarms ? `/alarms?from=${new Date(since).toISOString()}&limit=500${siteQs ? `&${siteQs}` : ''}` : null, { refetchInterval: 60_000 });
  const backlog = useApi<{ tasks: MaintenanceRow[] }>(canMaint ? `/maintenance?status=open_all${siteQs ? `&${siteQs}` : ''}` : null, { refetchInterval: 60_000 });
  const firstName = s.user.name.split(' ')[0];

  return (
    <>
      <PageHeader
        eyebrow={<>Plant overview · {q.data ? `updated ${ago(q.data.generatedAt)}` : 'loading'}</>}
        title={<>Good {greeting()}, {firstName}.<br /><span className="text-muted">{q.data ? summaryLine(q.data) : ' '}</span></>}
        actions={(sites.data?.sites.length ?? 0) > 1 ? (
          <Capsule label="Site filter" value={siteId} onChange={setSiteId} options={[{ value: 'all', label: 'All sites' }, ...sites.data!.sites.map((x) => ({ value: x.id, label: x.name }))]} />
        ) : undefined}
      />
      <QueryView q={q} loading={<OverviewSkeleton />}>
        {(d) => {
          const week = d.alarmTrend.slice(-7).reduce((a, t) => a + t.n, 0);
          const prevWeek = d.alarmTrend.length >= 14 ? d.alarmTrend.slice(0, 7).reduce((a, t) => a + t.n, 0) : null;
          return (
            <div className="grid gap-4 fade-in">
              {/* Tier 1 — executive signal */}
              <div className="stagger grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
                <KpiCard label="Open alarms" value={d.alarms.open} href="/console/alarms" accent={d.alarms.critical ? 'critical' : undefined}
                  sub={<>{d.alarms.critical} critical · {d.alarms.active} unacknowledged</>} />
                <KpiCard label="Inspections due" value={d.inspections.due} href="/console/inspections" accent={d.inspections.overdue ? 'high' : undefined}
                  sub={<>{d.inspections.overdue} overdue · {d.inspections.review} awaiting review</>} />
                <KpiCard label="Open maintenance" value={d.maintenance.open} href="/console/maintenance" sub={<>{d.maintenance.urgent} high or urgent priority</>} />
                <KpiCard label="Field glasses connected" value={<>{d.devices.connected}<span className="text-[0.5em] opacity-50">/{d.devices.registered}</span></>} href="/console/devices" sub={<>{d.activeOperators} operators with assigned glasses</>} />
              </div>

              {/* Tier 2 — diagnostics */}
              <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
                <section className="card card-lime" aria-labelledby="snapshot">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 id="snapshot" className="t-section">Process snapshot</h2>
                    <div className="flex items-center gap-2">
                      {d.metrics.some((m) => m.source === 'simulator') && <span className="chip chip-dark-on-lime">Synthetic demo data</span>}
                      <Link href="/console/telemetry" className="chip chip-dark-on-lime">All sensors <ArrowUpRight size={13} /></Link>
                    </div>
                  </div>
                  {d.metrics.length ? (
                    <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-3">
                      {d.metrics.slice(0, 6).map((m) => (
                        <Link key={m.id} href={`/console/telemetry/${m.id}`} className="group -m-2 min-w-0 rounded-2xl p-2 transition-[background-color,transform] duration-200 hover:bg-white/10 active:scale-[0.98]">
                          <div className="flex items-baseline gap-1.5">
                            <span className="t-kpi-sm">{fmtValue(m.freshness === 'stale' || m.freshness === 'no_data' ? null : m.value, undefined, m.decimals)}</span>
                            <span className="text-sm opacity-80">{m.unit}</span>
                          </div>
                          <div className="mt-1 truncate text-[13px] font-medium">{m.label} · {m.tag}</div>
                          <div className="flex items-center gap-1.5 text-[12px] opacity-80">
                            <span className={m.freshness === 'live' ? 'dot pulse-dot bg-white' : 'dot bg-white/50'} style={{ width: 6, height: 6 }} aria-hidden />
                            {m.freshness === 'live' ? `observed ${ago(m.ts)}` : m.freshness === 'no_data' ? 'no data received' : `stale · last ${ago(m.ts)}`}
                          </div>
                        </Link>
                      ))}
                    </div>
                  ) : <p className="mt-6 text-sm opacity-85">No online instruments configured yet.</p>}
                </section>
                <Card title="Alarm frequency" action={<span className="t-label">last 14 days</span>}>
                  <div className="flex items-end justify-between gap-6">
                    <div>
                      <div className="t-kpi">{d.alarms.last24h}</div>
                      <div className="t-label mt-1">raised in the last 24 h</div>
                      <Delta className="mt-2" value={week} previous={prevWeek} goodWhen="down" suffix="this week vs last" />
                    </div>
                    <OpenLink href="/console/reports?kind=alarms" label="Open alarm report" tone="default" size="sm" />
                  </div>
                  <div className="relative mt-4">
                    {d.alarmTrend.every((t) => t.n === 0) && <span className="absolute inset-x-0 top-8 text-center text-xs text-muted">No alarms raised in the last 14 days</span>}
                    <Sparkbars data={d.alarmTrend.map((t) => ({ label: dayLabel(t.day), value: t.n }))} height={78} highlight="var(--color-orange)" color="var(--color-surface-3)" table
                      ariaLabel={`Alarms per day for the last 14 days: ${d.alarmTrend.map((t) => t.n).join(', ')}`} axis={[d.alarmTrend[0] ? dayLabel(d.alarmTrend[0].day) : '', 'today']} />
                  </div>
                </Card>
              </div>

              {/* Tier 2b — distributions */}
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Card title="Open alarms by severity" action={<OpenLink href="/console/alarms" label="Open alarms" tone="default" size="sm" />}>
                  {!canAlarms ? <p className="text-sm text-muted">You do not have access to alarms.</p> : openAlarms.isError ? <p className="text-sm text-muted">Could not load alarms.</p> : !openAlarms.data ? <Skeleton className="mx-auto h-[140px] w-[140px] rounded-full" /> : (
                    <SeverityDonut alarms={openAlarms.data.alarms} />
                  )}
                </Card>
                <Card title="Inspection throughput">
                  <InspectionRing d={d.inspections} />
                </Card>
                <Card title="Maintenance backlog" action={<OpenLink href="/console/maintenance" label="Open maintenance" tone="default" size="sm" />}>
                  {!canMaint || backlog.isError ? <p className="text-sm text-muted">The backlog is not available.</p> : !backlog.data ? <Skeleton className="h-[160px]" /> : <Backlog tasks={backlog.data.tasks} />}
                </Card>
                <Card title="Fleet connectivity" action={<OpenLink href="/console/devices" label="Open field glasses" tone="default" size="sm" />}>
                  <div className="grid place-items-center">
                    <RadialGauge value={d.devices.registered ? Math.round((d.devices.connected / d.devices.registered) * 100) : null} unit="%" size={152}
                      label={`${d.devices.connected} of ${d.devices.registered} connected`} tone="var(--color-signal)"
                      ariaLabel={d.devices.registered ? `${d.devices.connected} of ${d.devices.registered} field glasses connected` : 'No field glasses registered'} />
                    <p className="mt-2 text-center text-[12.5px] text-muted">{d.devices.registered ? `${d.activeOperators} operator${d.activeOperators === 1 ? '' : 's'} with assigned glasses` : 'Pair glasses to see fleet status'}</p>
                  </div>
                </Card>
              </div>

              {/* Tier 3 — exceptions & health */}
              <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr_1fr]">
                <Card title="Needs attention" action={<Link className="link-quiet text-sm" href="/console/alarms">All alarms</Link>}>
                  {d.recentAlarms.length ? (
                    <ul className="grid gap-2">
                      {d.recentAlarms.map((a) => (
                        <li key={a.id}>
                          <Link href={`/console/alarms/${a.id}`} className="flex items-center gap-3 rounded-2xl bg-bg-2 px-4 py-3 transition-[background-color,transform] hover:bg-surface-2 active:scale-[0.99]">
                            <span className="dot" style={{ background: `var(--color-${a.severity})` }} aria-hidden />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm">{a.title}</span>
                              <span className="text-xs text-muted">{ago(a.triggeredAt)}{a.assetTag ? ` · ${a.assetTag}` : ''}</span>
                            </span>
                            {a.synthetic && <SyntheticBadge />}
                            <StateChip state={a.state} />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : <EmptyState compact icon={<CheckCircle2 size={20} className="text-ok-text" />} title="No open alarms" body="All monitored conditions are within configured limits." />}
                </Card>
                <Card title="Equipment health" action={<OpenLink href="/console/assets" label="Open asset registry" tone="default" size="sm" />}>
                  <HealthBars health={d.assetHealth} />
                </Card>
                <Card title="Recent activity">
                  <Timeline items={d.activity.slice(0, 6).map((a) => ({ id: a.id, title: a.summary ?? a.action.replace(/[._]/g, ' '), meta: `${a.actorName ?? a.actorLabel ?? 'Hydris'} · ${ago(a.at)}`, tone: a.action.startsWith('alarm.triggered') ? 'critical' : a.action.includes('submitted') || a.action.includes('approved') ? 'ok' : 'muted' }))} />
                </Card>
              </div>

              {/* Tier 4 — compliance & facilities */}
              <div className="grid gap-4 xl:grid-cols-[1fr_1.4fr]">
                <Card title="24-hour compliance" action={<span className="t-label">new alarms per hour</span>}>
                  {!canAlarms ? <p className="text-sm text-muted">You do not have access to alarms.</p> : dayAlarms.isError ? <p className="text-sm text-muted">Could not load alarms.</p> : !dayAlarms.data ? <Skeleton className="h-[110px]" /> : <ComplianceStrip alarms={dayAlarms.data.alarms} since={since} />}
                </Card>
                <Card title="Facility operating status">
                  {d.sites.length ? (
                    <ul className="grid gap-3 md:grid-cols-2">
                      {d.sites.map((x) => {
                        const healthy = x.assets ? Math.round(((x.assets - x.degraded) / x.assets) * 100) : null;
                        return (
                          <li key={x.id}>
                            <Link href={`/console/sites/${x.id}`} className="card-inset lift grid gap-3 p-4">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="t-card truncate">{x.name}</div>
                                  <div className="t-label mt-0.5">{x.assets} assets · {x.degraded} degraded or down</div>
                                </div>
                                {x.criticalAlarms ? <SeverityChip severity="critical" /> : x.openAlarms ? <StateChip state="acknowledged" label={`${x.openAlarms} open`} /> : <StateChip state="operational" label="Normal" />}
                              </div>
                              <BulletBar value={healthy} target={90} label="Assets not degraded or down" targetLabel="Target"
                                ariaLabel={healthy === null ? `${x.name}: no assets registered` : `${x.name}: ${healthy}% of assets not degraded or down, target 90%`} />
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  ) : <EmptyState compact title="No sites yet" body="Sites and their assets appear here once registered." />}
                </Card>
              </div>
            </div>
          );
        }}
      </QueryView>
    </>
  );
}

function SeverityDonut({ alarms }: { alarms: AlarmListRow[] }) {
  if (!alarms.length) return <EmptyState compact icon={<CheckCircle2 size={20} className="text-ok-text" />} title="No open alarms" />;
  const data: Datum[] = ALARM_SEVERITIES.map((s) => ({ key: s, label: SEV_LABEL[s], value: alarms.filter((a) => a.severity === s).length, color: SEVERITY_COLORS[s] }));
  return <Donut data={data} size={140} thickness={13} centerLabel="open" table ariaLabel={`Open alarms by severity: ${data.map((x) => `${x.value} ${x.label.toLowerCase()}`).join(', ')}`} />;
}

function InspectionRing({ d }: { d: Overview['inspections'] }) {
  // Last-7-day throughput: completed (submitted/approved) vs still open. The denominator is shown below the ring.
  const total = d.done7d + d.due;
  const rate = total ? Math.round((d.done7d / total) * 100) : null;
  return (
    <div className="grid place-items-center gap-3">
      <RadialGauge value={rate} unit="%" size={152} label="completed vs open" tone="var(--color-signal)"
        ariaLabel={rate === null ? 'No inspections completed or open' : `${d.done7d} inspections completed in the last 7 days; ${d.due} still open, ${d.overdue} overdue`} />
      <dl className="grid w-full grid-cols-3 gap-2 text-center text-[12px]">
        <div><dt className="text-muted">Done 7 d</dt><dd className="num text-[15px] font-medium">{d.done7d}</dd></div>
        <div><dt className="text-muted">Open</dt><dd className="num text-[15px] font-medium">{d.due}</dd></div>
        <div><dt className="text-muted">Overdue</dt><dd className={d.overdue ? 'num text-[15px] font-medium text-high-text' : 'num text-[15px] font-medium'}>{d.overdue}</dd></div>
      </dl>
    </div>
  );
}

function Backlog({ tasks }: { tasks: MaintenanceRow[] }) {
  if (!tasks.length) return <EmptyState compact icon={<CheckCircle2 size={20} className="text-ok-text" />} title="No open work" />;
  const data: Datum[] = [...MAINTENANCE_PRIORITIES].reverse().map((p) => ({ key: p, label: p[0]!.toUpperCase() + p.slice(1), value: tasks.filter((t) => t.priority === p).length, color: PRIORITY_COLORS[p] }));
  const now = Date.now();
  const overdue = tasks.filter((t) => t.dueAt && new Date(t.dueAt).getTime() < now).length;
  const unassigned = tasks.filter((t) => !t.assignedTo).length;
  return (
    <div className="grid gap-4">
      <div className="flex items-baseline gap-2"><span className="t-kpi-sm">{tasks.length}</span><span className="text-sm text-muted">open tasks</span></div>
      <BarList data={data} ariaLabel={`Open maintenance by priority: ${data.map((x) => `${x.value} ${x.key}`).join(', ')}`} />
      <p className="text-[12px] text-muted"><span className={overdue ? 'text-high-text' : undefined}>{overdue} overdue</span> · {unassigned} unassigned</p>
    </div>
  );
}

function ComplianceStrip({ alarms, since }: { alarms: AlarmListRow[]; since: number }) {
  const cells = useMemo(() => {
    const now = Date.now();
    return Array.from({ length: 24 }, (_, i) => {
      const t0 = since + i * HOUR;
      const inHour = alarms.filter((a) => { const t = new Date(a.triggeredAt).getTime(); return t >= t0 && t < t0 + HOUR; });
      const worst = inHour.reduce<AlarmSeverity | null>((w, a) => (w === null || SEV_RANK[a.severity] < SEV_RANK[w] ? a.severity : w), null);
      const hour = new Date(t0).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      const future = t0 > now;
      return {
        key: String(t0), hour, n: inHour.length,
        color: future ? null : worst ? SEVERITY_COLORS[worst] : OK_FILL,
        title: `${hour}: ${inHour.length ? `${inHour.length} alarm${inHour.length > 1 ? 's' : ''}, worst ${worst}` : 'no new alarm'}`,
      };
    });
  }, [alarms, since]);
  const clean = cells.filter((c) => c.n === 0).length;
  return (
    <div className="grid gap-4">
      <div className="flex items-baseline gap-2">
        <span className="t-kpi-sm">{clean}<span className="text-[0.6em] opacity-50">/24</span></span>
        <span className="text-sm text-muted">hours without a new alarm</span>
      </div>
      <StatusStrip cells={cells} ariaLabel={`Last 24 hours: ${clean} hours without a new alarm. ${cells.filter((c) => c.n).map((c) => `${c.hour}: ${c.n}`).join(', ') || 'No alarms raised.'}`}
        axis={[cells[0]?.hour, cells[12]?.hour, 'now']} />
      <ul className="chart-legend" aria-hidden>
        <li><span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: OK_FILL }} />No new alarm</li>
        {ALARM_SEVERITIES.map((s) => <li key={s}><span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: SEVERITY_COLORS[s] }} />{SEV_LABEL[s]}</li>)}
      </ul>
      {alarms.length >= 500 && <p className="text-xs text-muted">Based on the first 500 alarms of this period.</p>}
    </div>
  );
}

function HealthBars({ health }: { health: { status: string; n: number }[] }) {
  const total = health.reduce((a, b) => a + b.n, 0);
  if (!total) return <EmptyState compact title="No assets registered" />;
  const data: Datum[] = HEALTH_ORDER.map((k) => ({ key: k, label: ASSET_STATUS_LABELS[k], value: health.find((h) => h.status === k)?.n ?? 0, color: HEALTH_COLOR[k]! }));
  const up = (data[0]?.value ?? 0) + (data[1]?.value ?? 0);
  return (
    <div className="grid gap-4">
      <div className="flex items-baseline gap-2"><span className="t-kpi-sm">{Math.round((up / total) * 100)}<span className="text-[0.6em] opacity-50">%</span></span><span className="text-sm text-muted">operational or standby</span></div>
      <StackedBar data={data} legend={false} table ariaLabel={`Asset health: ${data.map((h) => `${h.value} ${h.label.toLowerCase()}`).join(', ')}`} />
      <ul className="grid gap-2.5">
        {data.map((h) => (
          <li key={h.key} className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-text-2"><span className="dot" style={{ background: h.color }} aria-hidden />{h.label}</span>
            <span className="num">{h.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="grid gap-4" role="status" aria-label="Loading overview">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[148px] rounded-[24px]" />)}</div>
      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]"><Skeleton className="h-[260px] rounded-[24px]" /><Skeleton className="h-[260px] rounded-[24px]" /></div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[250px] rounded-[24px]" />)}</div>
      <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr_1fr]">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[300px] rounded-[24px]" />)}</div>
    </div>
  );
}

function dayLabel(day: string) {
  const d = new Date(`${day}T00:00:00`);
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}

function summaryLine(d: Overview) {
  if (d.alarms.critical) return `${d.alarms.critical} critical alarm${d.alarms.critical > 1 ? 's' : ''} need attention.`;
  if (d.alarms.open) return `${d.alarms.open} open alarm${d.alarms.open > 1 ? 's' : ''}, nothing critical.`;
  return d.inspections.overdue ? `${d.inspections.overdue} inspection${d.inspections.overdue > 1 ? 's are' : ' is'} overdue.` : 'All monitored conditions are normal.';
}
