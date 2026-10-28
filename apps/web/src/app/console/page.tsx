'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowUpRight, BatteryLow, BatteryMedium, CheckCircle2, ClipboardList, Glasses, ScanLine, Send, Siren, UserPlus, Wrench } from 'lucide-react';
import { useApi } from '@/lib/query';
import { useCan, useSession } from '@/lib/session';
import { ago, until } from '@/lib/format';
import { Avatar, Button, ButtonLink, Card, Chip, EmptyState, KpiCard, OpenLink, PageHeader, QueryView, SeverityChip, Skeleton, StateChip, SyntheticBadge, Timeline, cx } from '@/ui';
import { RadialGauge } from '@/ui/charts';
import { GlassesArt } from '@/console/admin/glasses';
import { useFleetLive, type LiveView } from '@/console/admin/live';
import { AssignWorkDialog } from '@/console/command/AssignWork';
import { activityTone, describeAction, type Dashboard, type OnShiftCard } from '@/console/command/types';

/** Command center: the administrator's live picture of the field team. */
export default function CommandPage() {
  const s = useSession();
  const can = useCan();
  const q = useApi<Dashboard>('/command/dashboard', { refetchInterval: 20_000 });
  const live = useFleetLive(can('device.read'));
  const [assign, setAssign] = useState(false);
  const firstName = s.user.name.split(' ')[0];

  return (
    <>
      <PageHeader
        eyebrow={<span className="inline-flex items-center gap-2">Command{q.data && <> · updated {ago(q.data.generatedAt)}</>}</span>}
        title={<>Good {greeting()}, {firstName}.<br /><span className="text-muted">{q.data ? summaryLine(q.data) : ' '}</span></>}
        actions={<>
          {can('member.manage') && <ButtonLink href="/console/operators?invite=1" icon={<UserPlus size={16} aria-hidden />}>Invite operator</ButtonLink>}
          {(can('inspection.manage') || can('maintenance.manage')) && <Button variant="primary" icon={<Send size={16} aria-hidden />} onClick={() => setAssign(true)}>Assign work</Button>}
        </>}
      />
      <QueryView q={q} loading={<CommandSkeleton />}>
        {(d) => {
          const on = d.onShift.filter((o) => o.onShift);
          const off = d.onShift.filter((o) => !o.onShift);
          const roundsPct = d.kpis.roundsAssigned ? Math.round((d.kpis.roundsCompleted / d.kpis.roundsAssigned) * 100) : null;
          return (
            <div className="grid grid-cols-[minmax(0,1fr)] gap-4 fade-in">
              <div className="stagger grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
                <KpiCard label="On shift now" value={<>{d.kpis.onShift}<span className="text-[0.5em] opacity-50">/{d.kpis.operators}</span></>} href="/console/operators"
                  sub={<>{d.onShift.filter((o) => o.connected).length} wearing connected glasses</>} />
                <KpiCard label="Open alarms" value={d.kpis.openAlarms} href="/console/alarms" accent={d.kpis.criticalAlarms ? 'critical' : undefined}
                  sub={<>{d.kpis.criticalAlarms} critical · <span className={d.kpis.unownedAlarms ? 'font-medium' : undefined}>{d.kpis.unownedAlarms} without an owner</span></>} />
                <KpiCard label="Today's rounds" value={<>{d.kpis.roundsCompleted}<span className="text-[0.5em] opacity-50">/{d.kpis.roundsAssigned}</span></>} href="/console/inspections"
                  sub={roundsPct === null ? 'Nothing scheduled for today' : <>{roundsPct}% complete</>}
                  footer={roundsPct !== null ? <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[rgb(15_23_42/0.08)]" aria-hidden><div className="h-full rounded-full bg-[var(--color-signal)] transition-[width] duration-700" style={{ width: `${roundsPct}%` }} /></div> : undefined} />
                <KpiCard label="Awaiting approval" value={d.kpis.approvals} href="/console/approvals" accent={d.kpis.approvals ? 'high' : undefined}
                  sub={<>{d.approvals.scans} scans · {d.approvals.inspections} inspections</>} />
              </div>

              <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)]">
                <section className="card" aria-labelledby="on-shift">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 id="on-shift" className="t-section flex items-center gap-2.5">On shift now<span className="dot pulse-dot bg-ok" aria-hidden /></h2>
                    <Link href="/console/operators" className="link-quiet text-sm">All operators</Link>
                  </div>
                  {!d.onShift.length ? (
                    <div className="mt-5"><EmptyState icon={<UserPlus size={20} aria-hidden />} title="No operators yet" body="Invite Field Operators; they appear here as soon as they sign in on the Hydris Field app or put on their glasses."
                      action={can('member.manage') ? <ButtonLink href="/console/operators?invite=1" variant="primary">Invite operators</ButtonLink> : undefined} /></div>
                  ) : !on.length ? (
                    <div className="mt-5"><EmptyState compact title="Nobody on shift right now" body="Operators show up here when their glasses connect or they are active in the app (last 8 hours)." /></div>
                  ) : (
                    <ul className="stagger mt-5 grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                      {on.map((o) => <li key={o.userId}><OperatorCard o={o} live={o.glasses ? live.get(o.glasses.id) : undefined} /></li>)}
                    </ul>
                  )}
                  {off.length > 0 && (
                    <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-4">
                      <span className="t-label">Off shift · {off.length}</span>
                      <ul className="flex flex-wrap gap-1.5">
                        {off.map((o) => (
                          <li key={o.userId}>
                            <Link href={`/console/operators/${o.userId}`} title={`${o.name}${o.lastActiveAt ? ` · active ${ago(o.lastActiveAt)}` : ' · never active'}`} className="block rounded-full opacity-70 transition-opacity hover:opacity-100">
                              <Avatar name={o.name} size={30} />
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </section>

                <div className="grid grid-cols-[minmax(0,1fr)] content-start gap-4">
                  <FleetPanel d={d} />
                  <Card title="Open alarms & owners" action={<OpenLink href="/console/alarms" label="Open alarms" tone="default" size="sm" />}>
                    {d.alarms.length ? (
                      <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
                        {d.alarms.slice(0, 5).map((a) => (
                          <li key={a.id}>
                            <Link href={`/console/alarms/${a.id}`} className="flex items-center gap-3 rounded-2xl bg-bg-2 px-3.5 py-2.5 transition-[background-color,transform] hover:bg-surface-2 active:scale-[0.99]">
                              <span className="dot" style={{ background: `var(--color-${a.severity})` }} aria-hidden />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm">{a.title}</span>
                                <span className="block truncate text-xs text-muted">{ago(a.triggeredAt)} · {a.assetTag ?? a.siteName}</span>
                              </span>
                              {a.synthetic && <SyntheticBadge />}
                              {a.owner ? (
                                <span className="flex flex-none items-center gap-1.5 text-xs text-text-2" title={`${a.owner.via === 'assigned' ? 'Assigned to' : 'Acknowledged by'} ${a.owner.name}`}><Avatar name={a.owner.name} size={22} /><span className="max-w-[90px] truncate max-sm:hidden">{a.owner.name.split(' ')[0]}</span></span>
                              ) : <Chip tone="high" className="flex-none">No owner</Chip>}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    ) : <EmptyState compact icon={<CheckCircle2 size={20} className="text-ok-text" />} title="No open alarms" body="All monitored conditions are within limits." />}
                    {d.alarms.length > 5 && <p className="mt-3 text-xs text-muted">+ {d.kpis.openAlarms - 5} more open</p>}
                  </Card>
                </div>
              </div>

              <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)]">
                <Card title="Today's rounds by operator" action={<OpenLink href="/console/inspections" label="Open rounds" tone="default" size="sm" />}>
                  {d.rounds.length ? (
                    <ul className="grid grid-cols-[minmax(0,1fr)] gap-3.5">
                      {d.rounds.slice(0, 8).map((r) => {
                        const pct = r.assigned ? Math.round((r.completed / r.assigned) * 100) : 0;
                        return (
                          <li key={r.userId}>
                            <Link href={`/console/operators/${r.userId}`} className="group grid grid-cols-[minmax(0,1fr)] gap-1.5">
                              <div className="flex items-baseline justify-between gap-3 text-[13.5px]">
                                <span className="min-w-0 truncate text-text-2 group-hover:text-text">{r.name}</span>
                                <span className="num flex-none">{r.completed}<span className="text-muted">/{r.assigned}</span>{r.overdue > 0 && <span className="ml-2 text-high-text">{r.overdue} overdue</span>}</span>
                              </div>
                              <div className="hatch h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label={`${r.name}: ${r.completed} of ${r.assigned} rounds done`} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                                <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${Math.max(pct, 2)}%`, background: pct === 100 ? 'var(--color-ok)' : 'var(--color-signal)' }} />
                              </div>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  ) : <EmptyState compact icon={<ClipboardList size={20} aria-hidden />} title="No rounds today" body="Assign a round to an operator or a whole shift."
                    action={can('inspection.manage') ? <Button size="sm" onClick={() => setAssign(true)}>Assign work</Button> : undefined} />}
                </Card>
                <Card title="Awaiting approval" action={<OpenLink href="/console/approvals" label="Open approvals" tone="default" size="sm" />}>
                  {d.approvals.items.length ? (
                    <ul className="grid grid-cols-[minmax(0,1fr)] gap-1">
                      {d.approvals.items.map((i) => (
                        <li key={`${i.kind}-${i.id}`}>
                          <Link href={i.kind === 'scan' ? `/console/audit-docs/${i.id}` : `/console/inspections/${i.id}`} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors hover:bg-surface-2">
                            <span className="grid h-8 w-8 flex-none place-items-center rounded-full bg-surface-2 text-text-2">{i.kind === 'scan' ? <ScanLine size={15} aria-hidden /> : <ClipboardList size={15} aria-hidden />}</span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm">{i.title}</span>
                              <span className="block truncate text-xs text-muted">{i.by ?? 'Unknown'} · {i.at ? ago(i.at) : '—'}</span>
                            </span>
                            {i.status && <StateChip state={i.status} />}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : <EmptyState compact icon={<CheckCircle2 size={20} className="text-ok-text" />} title="Queue is clear" body="Scans and inspections waiting for sign-off appear here." />}
                </Card>
                <Card title="Recent activity" action={<Link className="link-quiet text-sm" href="/console/audit">Audit log</Link>}>
                  <Timeline items={d.activity.slice(0, 7).map((a) => ({ id: a.id, title: describeAction(a), meta: `${a.actorName ?? a.actorLabel ?? 'Hydris'} · ${ago(a.at)}`, tone: activityTone(a.action) }))} />
                </Card>
              </div>
            </div>
          );
        }}
      </QueryView>
      {assign && <AssignWorkDialog open={assign} onClose={() => setAssign(false)} />}
    </>
  );
}

/** One operator on shift: who, where, what their glasses show, and what they are doing. */
function OperatorCard({ o, live }: { o: OnShiftCard; live?: LiveView }) {
  const streaming = !!live?.live && !!live.view;
  const g = o.glasses;
  const battery = live?.battery ?? g?.battery ?? null;
  const site = o.allSites ? 'All sites' : o.sites.map((s) => s.name).join(', ') || 'No site';
  return (
    <article className="card-inset lift group flex h-full flex-col overflow-hidden">
      <Link href={`/console/operators/${o.userId}`} className="flex items-center gap-3 p-3.5 pb-3">
        <span className="relative flex-none">
          <Avatar name={o.name} size={40} tone={o.connected ? 'cobalt' : 'surface'} />
          <span className={cx('absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-[var(--color-bg-2)]', o.connected ? 'bg-ok' : 'bg-medium')} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium">{o.name}</span>
          <span className="block truncate text-xs text-muted">{[o.shiftLabel, site].filter(Boolean).join(' · ')}</span>
        </span>
        <ArrowUpRight size={16} className="flex-none text-muted transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden />
      </Link>
      <Link href={g ? `/console/devices/${g.id}` : `/console/operators/${o.userId}`} className="relative mx-3.5 block aspect-[16/9] overflow-hidden rounded-[16px] border border-line bg-[#05070d]" aria-label={g ? `Live view of ${g.name}` : 'No glasses assigned'}>
        {streaming ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={live!.view!} alt={`What ${o.name.split(' ')[0]} sees: ${live!.title ?? ''}`} className="h-full w-full object-contain" />
        ) : (
          <span className="grid h-full place-items-center px-6">
            <GlassesArt state={g ? (o.connected ? 'connected' : 'disconnected') : 'paired'} className="h-16 w-full max-w-[200px] opacity-80" />
          </span>
        )}
        <span className="absolute left-2 top-2 flex items-center gap-1.5">
          {streaming ? <span className="chip chip-critical h-6 gap-1.5 bg-black/60 px-2 text-[11px] backdrop-blur"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-critical" aria-hidden />Live</span>
            : <span className="chip h-6 border-white/15 bg-black/50 px-2 text-[11px] text-white/80 backdrop-blur">{g ? (o.connected ? 'Connected' : 'Glasses offline') : 'No glasses'}</span>}
        </span>
        {battery !== null && (
          <span className="absolute right-2 top-2 chip h-6 gap-1 border-white/15 bg-black/50 px-2 text-[11px] text-white/85 backdrop-blur num" title="Glasses battery">
            {battery < 20 ? <BatteryLow size={13} className="text-critical" aria-hidden /> : <BatteryMedium size={13} aria-hidden />}{Math.round(battery)}%
          </span>
        )}
        {streaming && live?.title && <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/80 to-transparent px-3 pb-2 pt-6 text-[12px] text-white/90">{live.title}</span>}
      </Link>
      <div className="mt-auto grid grid-cols-[minmax(0,1fr)] gap-2 p-3.5 pt-3 text-[13px]">
        {o.alarm ? (
          <Link href={`/console/alarms/${o.alarm.id}`} className="flex items-center gap-2 rounded-xl bg-[rgb(255_40_0/0.06)] px-2.5 py-1.5 hover:bg-[rgb(255_40_0/0.1)]">
            <Siren size={14} className="flex-none text-critical" aria-hidden /><span className="min-w-0 flex-1 truncate">{o.alarm.title}</span><SeverityChip severity={o.alarm.severity} />
          </Link>
        ) : null}
        {o.current ? (
          <Link href={o.current.kind === 'maintenance' ? `/console/maintenance/${o.current.id}` : `/console/inspections/${o.current.id}`} className="flex items-center gap-2 text-text-2 hover:text-text">
            {o.current.kind === 'maintenance' ? <Wrench size={14} className="flex-none" aria-hidden /> : <ClipboardList size={14} className="flex-none" aria-hidden />}
            <span className="min-w-0 flex-1 truncate">{o.current.status === 'in_progress' ? 'Doing ' : o.current.status === 'paused' ? 'Paused ' : 'Next: '}<span className="text-text">{o.current.title}</span></span>
            {o.current.status !== 'in_progress' && o.current.dueAt ? <span className="flex-none text-xs text-muted">{until(o.current.dueAt)}</span> : null}
          </Link>
        ) : <span className="text-muted">No open work assigned</span>}
        <div className="flex items-center justify-between gap-2 text-xs text-muted">
          <span className="num">{o.rounds.todayCompleted}/{o.rounds.todayAssigned} rounds today</span>
          <span className="num">{o.lastActiveAt ? `active ${ago(o.lastActiveAt)}` : 'not active yet'}</span>
        </div>
      </div>
    </article>
  );
}

/** Blue focal panel: glasses fleet connectivity and battery. */
function FleetPanel({ d }: { d: Dashboard }) {
  const f = d.fleet;
  const pct = f.glasses.total ? Math.round((f.glasses.connected / f.glasses.total) * 100) : null;
  return (
    <section className="card card-lime" aria-labelledby="fleet">
      <div className="flex items-center justify-between gap-3">
        <h2 id="fleet" className="t-section">Fleet status</h2>
        <Link href="/console/devices" className="chip chip-dark-on-lime">Devices <ArrowUpRight size={13} /></Link>
      </div>
      {f.glasses.total ? (
        <div className="mt-4 grid grid-cols-[auto_1fr] items-center gap-5">
          <RadialGauge value={pct} unit="%" size={128} thickness={9} tone="#ffffff" label="connected" ariaLabel={`${f.glasses.connected} of ${f.glasses.total} glasses connected`} />
          <dl className="grid grid-cols-[minmax(0,1fr)] gap-3 text-sm">
            <div className="flex items-baseline justify-between gap-2"><dt className="opacity-80">Glasses connected</dt><dd className="t-kpi-sm num">{f.glasses.connected}<span className="text-[0.6em] opacity-60">/{f.glasses.total}</span></dd></div>
            <div className="flex items-baseline justify-between gap-2"><dt className="opacity-80">Streaming live</dt><dd className="num text-[17px]">{f.glasses.streaming}</dd></div>
            <div className="flex items-baseline justify-between gap-2"><dt className="opacity-80">Average battery</dt><dd className="num text-[17px]">{f.battery.average === null ? <span className="text-[13px] opacity-70">not reported</span> : `${f.battery.average}%`}</dd></div>
            {(f.battery.low > 0 || f.glasses.unassigned > 0 || f.suspended > 0) && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {f.battery.low > 0 && <span className="chip chip-dark-on-lime h-6 px-2 text-[11.5px]"><BatteryLow size={13} aria-hidden />{f.battery.low} low battery</span>}
                {f.glasses.unassigned > 0 && <span className="chip chip-outline h-6 px-2 text-[11.5px]">{f.glasses.unassigned} unassigned</span>}
                {f.suspended > 0 && <span className="chip chip-outline h-6 px-2 text-[11.5px]">{f.suspended} suspended</span>}
              </div>
            )}
          </dl>
        </div>
      ) : (
        <div className="mt-4 flex items-center gap-4">
          <span className="grid h-12 w-12 flex-none place-items-center rounded-full bg-white/15"><Glasses size={20} aria-hidden /></span>
          <p className="text-sm opacity-90">No glasses yet. Operators register their glasses from the Hydris Field app, or pair a pair from the Devices page.</p>
        </div>
      )}
    </section>
  );
}

function CommandSkeleton() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4" role="status" aria-label="Loading command center">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[148px] rounded-[24px]" />)}</div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)]"><Skeleton className="h-[520px] rounded-[24px]" /><div className="grid grid-cols-[minmax(0,1fr)] gap-4"><Skeleton className="h-[220px] rounded-[24px]" /><Skeleton className="h-[280px] rounded-[24px]" /></div></div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[300px] rounded-[24px]" />)}</div>
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}

function summaryLine(d: Dashboard) {
  const parts: string[] = [];
  parts.push(`${d.kpis.onShift} of ${d.kpis.operators} operator${d.kpis.operators === 1 ? '' : 's'} on shift`);
  if (d.kpis.criticalAlarms) parts.push(`${d.kpis.criticalAlarms} critical alarm${d.kpis.criticalAlarms > 1 ? 's' : ''}`);
  else if (d.kpis.unownedAlarms) parts.push(`${d.kpis.unownedAlarms} alarm${d.kpis.unownedAlarms > 1 ? 's' : ''} without an owner`);
  if (d.kpis.approvals) parts.push(`${d.kpis.approvals} awaiting approval`);
  return `${parts.join(', ')}.`;
}
