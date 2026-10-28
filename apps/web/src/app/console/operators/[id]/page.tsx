'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import * as RMenu from '@radix-ui/react-dropdown-menu';
import { ChevronLeft, ClipboardList, Eye, Glasses, KeyRound, LogOut, MoreHorizontal, Pencil, ScanLine, Send, ShieldCheck, ShieldOff, UserCheck, UserMinus, UserX, Wrench } from 'lucide-react';
import { ROLE_LABELS, assignableRoles, type Role } from '@hydris/domain';
import { patch } from '@/lib/api';
import { useAction, useApi } from '@/lib/query';
import { useCan, useSession } from '@/lib/session';
import { ago, fmtDate, fmtDateTime, until } from '@/lib/format';
import { Avatar, Button, Card, Chip, EmptyState, Input, KeyValues, KpiCard, QueryView, Select, Skeleton, StateChip, Timeline } from '@/ui';
import { MemberStatusChip, NoAccess, SiteAccessPicker, describeAgent, useSites, type Site } from '@/console/admin/parts';
import { GlassesArt } from '@/console/admin/glasses';
import { LiveBadge, useFleetLive } from '@/console/admin/live';
import { AssignWorkDialog } from '@/console/command/AssignWork';
import { EditProfileDialog, MemberActionDialogs, type MemberAction } from '@/console/command/members';
import { activityTone, describeAction, type ActivityRow, type OperatorStats } from '@/console/command/types';

interface MemberDetail {
  member: {
    membership: {
      id: string; role: Role; status: 'invited' | 'active' | 'suspended' | 'removed'; allSites: boolean; title: string | null; createdAt: string; updatedAt: string;
      suspendedAt: string | null; removedAt: string | null; employeeId: string | null; phone: string | null; shiftLabel: string | null;
    };
    name: string; email: string; lastLoginAt: string | null; mfaEnabled: boolean; siteIds: string[];
  };
  devices: { id: string; name: string; status: string; lastSeenAt: string | null }[];
  inspections: { id: string; title: string; status: string; dueAt: string | null; submittedAt: string | null }[];
  tasks: { id: string; title: string; status: string; priority: string }[];
  sessions: { id: string; createdAt: string; userAgent: string | null; lastUsedAt?: string | null }[];
}

interface CommandDetail {
  stats: OperatorStats;
  timeline: ActivityRow[];
  alarmsHandled: { id: string; title: string; severity: string; state: string; triggeredAt: string }[];
  scans: { id: string; title: string; status: string; createdAt: string; pageCount: number }[];
  sessions: { id: string; createdAt: string; lastUsedAt: string | null; userAgent: string | null }[];
}

const MENU_ITEM = 'flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-sm outline-none data-[highlighted]:bg-surface-2';

export default function MemberDetailPage() {
  const { id } = useParams<{ id: string }>();
  const s = useSession();
  const can = useCan();
  const allowed = can('member.read');
  const q = useApi<MemberDetail>(allowed ? `/members/${id}` : null);
  const cq = useApi<CommandDetail>(allowed && can('console.access') ? `/command/operators/${id}` : null, { refetchInterval: 30_000 });
  const live = useFleetLive(can('device.read'));
  const sites = useSites();
  const [action, setAction] = useState<MemberAction | null>(null);
  const [editing, setEditing] = useState(false);
  const [assign, setAssign] = useState(false);

  return (
    <>
      <Link href="/console/operators" className="mb-4 inline-flex items-center gap-1.5 text-sm text-text-2 hover:text-text"><ChevronLeft size={16} aria-hidden />Operators</Link>
      {!allowed ? <NoAccess what="members" /> : (
        <QueryView q={q} loading={<Skeleton className="h-[420px] rounded-[24px]" />}>
          {(data) => {
            const m = data.member;
            const self = id === s.user.id;
            const manageable = can('member.manage') && !!s.role && assignableRoles(s.role).includes(m.membership.role);
            const siteList = sites.data?.sites ?? [];
            const siteNames = m.siteIds.map((x) => siteList.find((y) => y.id === x)?.name ?? 'Site outside your scope');
            const c = cq.data;
            const st = c?.stats;
            const connected = st?.devices.some((d) => d.connected);
            const active = m.membership.status === 'active';
            const sessions = c?.sessions ?? data.sessions;
            return (
              <div className="grid grid-cols-[minmax(0,1fr)] gap-4 fade-in">
                <section className="card grid grid-cols-[minmax(0,1fr)] gap-6 sm:grid-cols-[auto_1fr] sm:items-center" aria-labelledby="member-name">
                  <span className="relative w-fit">
                    <Avatar name={m.name} size={88} tone={active ? 'lime' : 'surface'} />
                    {connected && <span className="absolute bottom-1 right-1 h-4 w-4 rounded-full bg-ok ring-4 ring-surface" title="Glasses connected" />}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Chip tone={m.membership.role === 'admin' ? 'lime' : 'default'}>{ROLE_LABELS[m.membership.role]}</Chip>
                      <MemberStatusChip status={m.membership.status} />
                      {m.membership.shiftLabel && <Chip tone="outline">{m.membership.shiftLabel}</Chip>}
                      {m.mfaEnabled ? <Chip tone="ok"><ShieldCheck size={13} aria-hidden />MFA on</Chip> : <Chip tone="outline"><ShieldOff size={13} aria-hidden />MFA off</Chip>}
                      {self && <Chip tone="cobalt">You</Chip>}
                    </div>
                    <h1 id="member-name" className="t-page mt-3 break-words">{m.name}</h1>
                    <p className="mt-1 break-all text-text-2">{m.email}{m.membership.title ? ` · ${m.membership.title}` : ''}</p>
                    {(m.membership.employeeId || m.membership.phone) && (
                      <p className="mt-1 text-sm text-text-2 num">{[m.membership.employeeId && `Employee ${m.membership.employeeId}`, m.membership.phone].filter(Boolean).join(' · ')}</p>
                    )}
                    <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
                      <dl className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
                        <div><dt className="t-label">Last active</dt><dd className="num mt-0.5">{st?.lastActiveAt ? ago(st.lastActiveAt) : m.lastLoginAt ? ago(m.lastLoginAt) : 'Never'}</dd></div>
                        <div><dt className="t-label">Last sign-in</dt><dd className="num mt-0.5">{m.lastLoginAt ? fmtDateTime(m.lastLoginAt) : 'Never'}</dd></div>
                        <div><dt className="t-label">Member since</dt><dd className="num mt-0.5">{fmtDate(m.membership.createdAt)}</dd></div>
                        <div><dt className="t-label">Sites</dt><dd className="mt-0.5">{m.membership.allSites ? 'All sites' : siteNames.join(', ') || 'None'}</dd></div>
                      </dl>
                      <div className="flex flex-wrap gap-2">
                        {active && (can('inspection.manage') || can('maintenance.manage')) && <Button variant="primary" icon={<Send size={16} aria-hidden />} onClick={() => setAssign(true)}>Assign work</Button>}
                        {manageable && m.membership.status !== 'removed' && <Button icon={<Pencil size={16} aria-hidden />} onClick={() => setEditing(true)}>Edit profile</Button>}
                        {manageable && !self && m.membership.status !== 'removed' && (
                          <RMenu.Root>
                            <RMenu.Trigger asChild><Button variant="ghost" icon={<MoreHorizontal size={16} aria-hidden />}>More</Button></RMenu.Trigger>
                            <RMenu.Portal>
                              <RMenu.Content align="end" sideOffset={6} className="z-50 min-w-[220px] rounded-[var(--radius-lg)] border border-line-2 bg-surface p-1.5 shadow-[var(--shadow-3)] fade-in">
                                {active && <RMenu.Item className={MENU_ITEM} onSelect={() => setAction('reset')}><KeyRound size={15} aria-hidden />Reset access</RMenu.Item>}
                                {active && <RMenu.Item className={MENU_ITEM} onSelect={() => setAction('sessions')}><LogOut size={15} aria-hidden />Sign out everywhere</RMenu.Item>}
                                {m.membership.status === 'suspended'
                                  ? <RMenu.Item className={MENU_ITEM} onSelect={() => setAction('reactivate')}><UserCheck size={15} aria-hidden />Reactivate</RMenu.Item>
                                  : <RMenu.Item className={`${MENU_ITEM} text-high-text`} onSelect={() => setAction('suspend')}><UserX size={15} aria-hidden />Suspend</RMenu.Item>}
                                <RMenu.Item className={`${MENU_ITEM} text-critical-text`} onSelect={() => setAction('remove')}><UserMinus size={15} aria-hidden />Remove</RMenu.Item>
                              </RMenu.Content>
                            </RMenu.Portal>
                          </RMenu.Root>
                        )}
                      </div>
                    </div>
                  </div>
                </section>

                <div className="stagger grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
                  <KpiCard label="Rounds this week" value={st ? <>{st.rounds.weekCompleted}<span className="text-[0.5em] opacity-50">/{st.rounds.weekAssigned}</span></> : '—'} href="/console/inspections"
                    sub={st ? `${st.rounds.open} open · ${st.rounds.overdue} overdue` : 'Loading'} accent={st?.rounds.overdue ? 'high' : undefined} />
                  <KpiCard label="Open alarms owned" value={st?.openAlarms ?? '—'} href="/console/alarms" accent={st?.openAlarms ? 'critical' : undefined} sub={`${c?.alarmsHandled.length ?? 0} handled recently`} />
                  <KpiCard label="Open maintenance" value={st?.openTasks ?? '—'} href="/console/maintenance" sub={`${data.tasks.length} recent tasks`} />
                  <KpiCard label="Scans captured" value={st?.scans.total ?? '—'} href="/console/audit-docs" sub={`${st?.scans.week ?? 0} this week`} />
                </div>

                <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
                  <Card title="Paired glasses" action={<span className="t-label num">{data.devices.length}</span>}>
                    {data.devices.length ? (
                      <ul className="grid grid-cols-[minmax(0,1fr)] gap-3">
                        {data.devices.map((d) => {
                          const sd = st?.devices.find((x) => x.id === d.id);
                          const lv = live.get(d.id);
                          const streaming = !!lv?.live && !!lv.view;
                          const battery = lv?.battery ?? sd?.battery ?? null;
                          return (
                            <li key={d.id} className="card-inset grid grid-cols-[minmax(0,1fr)] gap-3 p-3 sm:grid-cols-[180px_1fr] sm:items-center">
                              <Link href={`/console/devices/${d.id}`} className="relative block aspect-[16/9] overflow-hidden rounded-[14px] border border-line bg-[#05070d]" aria-label={`Live view of ${d.name}`}>
                                {streaming ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={lv!.view!} alt={`Glasses screen: ${lv!.title ?? ''}`} className="h-full w-full object-contain" />
                                ) : <span className="grid h-full place-items-center px-4"><GlassesArt state={sd?.connected ? 'connected' : d.status === 'active' ? 'disconnected' : 'suspended'} className="h-12 w-full opacity-80" /></span>}
                                {streaming && <LiveBadge live className="absolute left-2 top-2" />}
                              </Link>
                              <div className="min-w-0">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="truncate text-[15px] font-medium">{d.name}</span>
                                  {d.status === 'active' ? <Chip tone={sd?.connected ? 'ok' : 'outline'}>{sd?.connected ? 'Connected' : 'Offline'}</Chip> : <StateChip state={d.status} />}
                                </div>
                                <p className="mt-1 text-xs text-muted num">{battery !== null ? `Battery ${Math.round(battery)}% · ` : ''}{d.lastSeenAt ? `seen ${ago(d.lastSeenAt)}` : 'never connected'}</p>
                                {streaming && lv?.title && <p className="mt-1 truncate text-[13px] text-text-2">Looking at <span className="text-text">{lv.title}</span></p>}
                                <Link href={`/console/devices/${d.id}`} className="link-quiet mt-2 inline-flex items-center gap-1 text-[13px]"><Eye size={14} aria-hidden />Open live view</Link>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    ) : <EmptyState compact icon={<Glasses size={20} aria-hidden />} title="No glasses assigned" body="Glasses registered from the Hydris Field app, or assigned on the Devices page, appear here." />}
                  </Card>
                  {manageable ? (
                    <AccessEditor key={m.membership.updatedAt} userId={id} self={self} detail={data} sites={siteList} roles={assignableRoles(s.role!)} orgWide={s.siteScope === 'all'} />
                  ) : (
                    <Card title="Role and access">
                      <KeyValues columns={1} items={[
                        ['Role', ROLE_LABELS[m.membership.role]],
                        ['Job title', m.membership.title ?? '—'],
                        ['Sites', m.membership.allSites ? 'All sites, including sites added later' : siteNames.join(', ') || 'No sites'],
                      ]} />
                      <p className="mt-4 text-xs text-muted">Only administrators can change account types and access.</p>
                    </Card>
                  )}
                </div>

                <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
                  <Card title="Activity" action={<Link href="/console/audit" className="text-sm text-text-2 hover:text-text">Audit log</Link>}>
                    {cq.isError ? <p className="text-sm text-muted">Activity could not be loaded.</p> : !c ? <Skeleton className="h-[240px]" /> : (
                      <div className="max-h-[520px] overflow-y-auto pr-1">
                        <Timeline items={c.timeline.slice(0, 30).map((a) => ({
                          id: a.id, title: describeAction(a), tone: activityTone(a.action),
                          meta: `${a.actorUserId === id ? m.name.split(' ')[0] : a.actorName ?? a.actorLabel ?? 'Hydris'} · ${fmtDateTime(a.at)}`,
                        }))} />
                      </div>
                    )}
                  </Card>
                  <div className="grid grid-cols-[minmax(0,1fr)] content-start gap-4">
                    <Card title="Assigned work" action={<Link href="/console/inspections" className="text-sm text-text-2 hover:text-text">All rounds</Link>}>
                      {data.inspections.length || data.tasks.length ? (
                        <ul className="grid grid-cols-[minmax(0,1fr)] gap-1">
                          {data.inspections.map((i) => (
                            <li key={i.id}>
                              <Link href={`/console/inspections/${i.id}`} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 hover:bg-surface-2">
                                <ClipboardList size={15} className="flex-none text-muted" aria-hidden />
                                <span className="min-w-0 flex-1"><span className="block truncate text-sm">{i.title}</span>
                                  <span className="text-xs text-muted num">{i.submittedAt ? `submitted ${fmtDateTime(i.submittedAt)}` : until(i.dueAt)}</span></span>
                                <StateChip state={i.status} />
                              </Link>
                            </li>
                          ))}
                          {data.tasks.map((t) => (
                            <li key={t.id}>
                              <Link href={`/console/maintenance/${t.id}`} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 hover:bg-surface-2">
                                <Wrench size={15} className="flex-none text-muted" aria-hidden />
                                <span className="min-w-0 flex-1 truncate text-sm">{t.title}</span>
                                <StateChip state={t.priority} />
                                <StateChip state={t.status} />
                              </Link>
                            </li>
                          ))}
                        </ul>
                      ) : <EmptyState compact title="No work assigned" action={active && can('inspection.manage') ? <Button size="sm" onClick={() => setAssign(true)}>Assign work</Button> : undefined} />}
                    </Card>
                    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-2">
                      <Card title="Alarms handled">
                        {!c ? <Skeleton className="h-[120px]" /> : c.alarmsHandled.length ? (
                          <ul className="grid grid-cols-[minmax(0,1fr)] gap-1">
                            {c.alarmsHandled.slice(0, 6).map((a) => (
                              <li key={a.id}>
                                <Link href={`/console/alarms/${a.id}`} className="flex items-center gap-2.5 rounded-2xl px-2.5 py-2 hover:bg-surface-2">
                                  <span className="dot" style={{ background: `var(--color-${a.severity})` }} aria-hidden />
                                  <span className="min-w-0 flex-1"><span className="block truncate text-sm">{a.title}</span><span className="text-xs text-muted">{ago(a.triggeredAt)}</span></span>
                                  <StateChip state={a.state} />
                                </Link>
                              </li>
                            ))}
                          </ul>
                        ) : <p className="text-sm text-muted">No alarms owned or handled yet.</p>}
                      </Card>
                      <Card title="Scans captured">
                        {!c ? <Skeleton className="h-[120px]" /> : c.scans.length ? (
                          <ul className="grid grid-cols-[minmax(0,1fr)] gap-1">
                            {c.scans.slice(0, 6).map((d) => (
                              <li key={d.id}>
                                <Link href={`/console/audit-docs/${d.id}`} className="flex items-center gap-2.5 rounded-2xl px-2.5 py-2 hover:bg-surface-2">
                                  <ScanLine size={15} className="flex-none text-muted" aria-hidden />
                                  <span className="min-w-0 flex-1"><span className="block truncate text-sm">{d.title}</span><span className="text-xs text-muted num">{d.pageCount} page{d.pageCount === 1 ? '' : 's'} · {ago(d.createdAt)}</span></span>
                                  <StateChip state={d.status} />
                                </Link>
                              </li>
                            ))}
                          </ul>
                        ) : <p className="text-sm text-muted">No documents scanned yet.</p>}
                      </Card>
                    </div>
                  </div>
                </div>

                {s.role === 'admin' && (
                  <Card title="Active sign-in sessions" action={manageable && !self && sessions.length > 0
                    ? <Button size="sm" variant="ghost" icon={<LogOut size={14} aria-hidden />} onClick={() => setAction('sessions')}>Revoke all</Button>
                    : <span className="t-label num">{sessions.length}</span>}>
                    {sessions.length ? (
                      <ul className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2 xl:grid-cols-3">
                        {sessions.map((x) => (
                          <li key={x.id} className="card-inset px-4 py-3 text-sm">
                            <div>{describeAgent(x.userAgent)}</div>
                            <div className="mt-0.5 text-xs text-muted num">Signed in {fmtDateTime(x.createdAt)}{x.lastUsedAt ? ` · used ${ago(x.lastUsedAt)}` : ''}</div>
                          </li>
                        ))}
                      </ul>
                    ) : <p className="text-sm text-muted">No active sessions.</p>}
                    <p className="mt-4 text-xs text-muted">Suspending or removing the member also ends all of these sessions and signs out their glasses.</p>
                  </Card>
                )}

                <MemberActionDialogs target={{ userId: id, name: m.name, status: m.membership.status, devices: data.devices.length }} action={action} onDone={() => setAction(null)} />
                {editing && (
                  <EditProfileDialog sites={siteList} shifts={[]} onClose={() => setEditing(false)} member={{
                    userId: id, name: m.name, title: m.membership.title, employeeId: m.membership.employeeId, phone: m.membership.phone, shiftLabel: m.membership.shiftLabel,
                    allSites: m.membership.allSites, siteIds: m.siteIds,
                  }} />
                )}
                {assign && <AssignWorkDialog open preselect={[id]} onClose={() => setAssign(false)} />}
              </div>
            );
          }}
        </QueryView>
      )}
    </>
  );
}

function AccessEditor({ userId, self, detail, sites, roles, orgWide }: { userId: string; self: boolean; detail: MemberDetail; sites: Site[]; roles: Role[]; orgWide: boolean }) {
  const m = detail.member;
  const [role, setRole] = useState<Role>(m.membership.role);
  const [title, setTitle] = useState(m.membership.title ?? '');
  const [access, setAccess] = useState({ allSites: m.membership.allSites, siteIds: m.siteIds });
  const act = useAction((v: Record<string, unknown>) => patch(`/members/${userId}`, v), { invalidate: ['/members', '/command'], success: 'Access updated' });
  const accessDirty = access.allSites !== m.membership.allSites || (!access.allSites && (access.siteIds.length !== m.siteIds.length || access.siteIds.some((x) => !m.siteIds.includes(x))));
  const titleDirty = title.trim() !== (m.membership.title ?? '');
  const roleDirty = !self && role !== m.membership.role;
  const dirty = accessDirty || titleDirty || roleDirty;
  const sitesInvalid = !access.allSites && !access.siteIds.length;
  // Send only what changed: site-scoped managers may not re-send "all sites".
  const save = () => {
    const body: Record<string, unknown> = {};
    if (titleDirty) body.title = title.trim() || null;
    if (accessDirty) Object.assign(body, { allSites: access.allSites, siteIds: access.allSites ? [] : access.siteIds });
    if (roleDirty) body.role = role;
    act.mutate(body);
  };
  return (
    <Card title="Role and access">
      <form className="grid grid-cols-[minmax(0,1fr)] gap-5" onSubmit={(e) => { e.preventDefault(); if (dirty && !sitesInvalid) save(); }}>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
          <Select label="Account type" value={role} onChange={(e) => setRole(e.target.value as Role)} disabled={self}
            options={roles.map((r) => ({ value: r, label: ROLE_LABELS[r] }))} hint={self ? 'You cannot change your own account type.' : 'Takes effect on their next request.'} />
          <Input label="Job title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="e.g. Night shift lead" />
        </div>
        <SiteAccessPicker sites={sites} allSites={access.allSites} siteIds={access.siteIds} onChange={setAccess} allowAllSites={orgWide} />
        <div className="flex flex-wrap items-center justify-end gap-2">
          {dirty && <Button type="button" variant="ghost" onClick={() => { setRole(m.membership.role); setTitle(m.membership.title ?? ''); setAccess({ allSites: m.membership.allSites, siteIds: m.siteIds }); }}>Discard</Button>}
          <Button type="submit" variant="primary" busy={act.isPending} disabled={!dirty || sitesInvalid}>Save access</Button>
        </div>
      </form>
    </Card>
  );
}
