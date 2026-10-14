'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { ASSET_STATUS_LABELS, type AssetStatus, type Freshness } from '@hydris/domain';
import { useApi } from '@/lib/query';
import { useSession } from '@/lib/session';
import { ago, fmtValue } from '@/lib/format';
import { Capsule, Card, EmptyState, FreshnessBadge, KpiCard, OpenLink, PageHeader, QueryView, SeverityChip, Skeleton, StateChip, SyntheticBadge, Timeline } from '@/ui';
import { BarStrip } from '@/ui/charts';

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
  recentAlarms: { id: string; title: string; severity: 'critical' | 'high' | 'medium' | 'low'; state: string; triggeredAt: string; assetTag: string | null; synthetic: boolean }[];
  activity: { id: string; action: string; summary: string | null; at: string; actorName: string | null; actorLabel: string | null }[];
  alarmTrend: { day: string; n: number }[];
}

const HEALTH_ORDER: AssetStatus[] = ['operational', 'standby', 'maintenance', 'degraded', 'down'];
const HEALTH_COLOR: Record<string, string> = { operational: 'var(--color-ok)', standby: 'var(--color-muted)', maintenance: 'var(--color-cobalt)', degraded: 'var(--color-medium)', down: 'var(--color-critical)', decommissioned: 'var(--color-surface-3)' };

export default function OverviewPage() {
  const s = useSession();
  const sites = useApi<{ sites: { id: string; name: string }[] }>('/sites');
  const [siteId, setSiteId] = useState<string>('all');
  const q = useApi<Overview>(`/overview${siteId !== 'all' ? `?siteId=${siteId}` : ''}`, { refetchInterval: 30_000 });
  const firstName = s.user.name.split(' ')[0];

  return (
    <>
      <PageHeader
        eyebrow={<>Overview · {q.data ? `updated ${ago(q.data.generatedAt)}` : 'loading'}</>}
        title={<>Good {greeting()}, {firstName}.<br /><span className="text-muted">{q.data ? summaryLine(q.data) : ' '}</span></>}
        actions={(sites.data?.sites.length ?? 0) > 1 ? (
          <Capsule label="Site filter" value={siteId} onChange={setSiteId} options={[{ value: 'all', label: 'All sites' }, ...sites.data!.sites.map((x) => ({ value: x.id, label: x.name }))]} />
        ) : undefined}
      />
      <QueryView q={q} loading={<OverviewSkeleton />}>
        {(d) => (
          <div className="grid gap-4 fade-in">
            {/* Tier 1 — executive signal */}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
                      <Link key={m.id} href={`/console/telemetry/${m.id}`} className="group min-w-0 rounded-2xl p-1 -m-1 hover:bg-black/5">
                        <div className="flex items-baseline gap-1.5">
                          <span className="t-kpi-sm">{fmtValue(m.freshness === 'stale' || m.freshness === 'no_data' ? null : m.value, undefined, m.decimals)}</span>
                          <span className="text-sm opacity-60">{m.unit}</span>
                        </div>
                        <div className="mt-1 truncate text-[13px] font-medium">{m.label} · {m.tag}</div>
                        <div className="text-[12px] opacity-60">{m.freshness === 'live' ? `observed ${ago(m.ts)}` : m.freshness === 'no_data' ? 'no data received' : `stale · last ${ago(m.ts)}`}</div>
                      </Link>
                    ))}
                  </div>
                ) : <p className="mt-6 text-sm opacity-70">No online instruments configured yet.</p>}
              </section>
              <Card title="Alarm frequency" action={<span className="t-label">last 14 days</span>}>
                <div className="flex items-end justify-between gap-6">
                  <div>
                    <div className="t-kpi">{d.alarms.last24h}</div>
                    <div className="t-label mt-1">raised in the last 24 h</div>
                  </div>
                  <OpenLink href="/console/reports?kind=alarms" label="Open alarm report" tone="default" size="sm" />
                </div>
                <div className="mt-6 text-surface-3">
                  <BarStrip data={d.alarmTrend.map((t) => ({ label: t.day, value: t.n }))} height={86} ariaLabel={`Alarms per day for the last 14 days: ${d.alarmTrend.map((t) => t.n).join(', ')}`} />
                </div>
                <div className="mt-2 flex justify-between text-[11px] text-muted"><span>{d.alarmTrend[0]?.day.slice(5)}</span><span>today</span></div>
              </Card>
            </div>

            {/* Tier 3 — exceptions & health */}
            <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr_1fr]">
              <Card title="Needs attention" action={<Link className="text-sm text-text-2 hover:text-text" href="/console/alarms">All alarms</Link>}>
                {d.recentAlarms.length ? (
                  <ul className="grid gap-2">
                    {d.recentAlarms.map((a) => (
                      <li key={a.id}>
                        <Link href={`/console/alarms/${a.id}`} className="flex items-center gap-3 rounded-2xl bg-bg-2 px-4 py-3 hover:bg-surface-2">
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
                ) : <EmptyState title="No open alarms" body="All monitored conditions are within configured limits." />}
              </Card>
              <Card title="Equipment health" action={<OpenLink href="/console/assets" label="Open asset registry" tone="default" size="sm" />}>
                <HealthBars health={d.assetHealth} />
              </Card>
              <Card title="Recent activity">
                <Timeline items={d.activity.slice(0, 6).map((a) => ({ id: a.id, title: a.summary ?? a.action.replace(/[._]/g, ' '), meta: `${a.actorName ?? a.actorLabel ?? 'Hydris'} · ${ago(a.at)}`, tone: a.action.startsWith('alarm.triggered') ? 'critical' : a.action.includes('submitted') || a.action.includes('approved') ? 'ok' : 'muted' }))} />
              </Card>
            </div>

            {d.sites.length > 0 && (
              <Card title="Facility operating status">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {d.sites.map((x) => (
                    <Link key={x.id} href={`/console/sites/${x.id}`} className="card-inset flex items-center justify-between gap-4 p-5 hover:border-line-2">
                      <div>
                        <div className="t-card">{x.name}</div>
                        <div className="t-label mt-1">{x.assets} assets · {x.degraded} degraded or down</div>
                      </div>
                      {x.criticalAlarms ? <SeverityChip severity="critical" /> : x.openAlarms ? <StateChip state="acknowledged" label={`${x.openAlarms} open`} /> : <StateChip state="operational" label="Normal" />}
                    </Link>
                  ))}
                </div>
              </Card>
            )}
          </div>
        )}
      </QueryView>
    </>
  );
}

function HealthBars({ health }: { health: { status: string; n: number }[] }) {
  const total = health.reduce((a, b) => a + b.n, 0);
  if (!total) return <EmptyState title="No assets registered" />;
  return (
    <div className="grid gap-4">
      <div className="flex h-3 overflow-hidden rounded-full" role="img" aria-label={health.map((h) => `${h.n} ${h.status}`).join(', ')}>
        {HEALTH_ORDER.map((k) => {
          const n = health.find((h) => h.status === k)?.n ?? 0;
          return n ? <div key={k} style={{ width: `${(n / total) * 100}%`, background: HEALTH_COLOR[k] }} /> : null;
        })}
      </div>
      <ul className="grid gap-2.5">
        {HEALTH_ORDER.map((k) => {
          const n = health.find((h) => h.status === k)?.n ?? 0;
          return (
            <li key={k} className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-text-2"><span className="dot" style={{ background: HEALTH_COLOR[k] }} aria-hidden />{ASSET_STATUS_LABELS[k]}</span>
              <span className="num">{n}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[148px] rounded-[24px]" />)}</div>
      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]"><Skeleton className="h-[260px] rounded-[24px]" /><Skeleton className="h-[260px] rounded-[24px]" /></div>
    </div>
  );
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
