'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Glasses, ShieldCheck, ShieldOff, UserCheck, UserX } from 'lucide-react';
import { ROLE_LABELS, assignableRoles, type Role } from '@hydris/domain';
import { patch } from '@/lib/api';
import { invalidatePaths, useAction, useApi } from '@/lib/query';
import { useCan, useSession } from '@/lib/session';
import { ago, fmtDate, fmtDateTime, until } from '@/lib/format';
import { Avatar, Button, Card, Chip, EmptyState, Input, KeyValues, QueryView, Select, Skeleton, StateChip } from '@/ui';
import { ConfirmDialog } from '@/ui/overlay';
import { MemberStatusChip, NoAccess, SiteAccessPicker, describeAgent, useSites, type Site } from '@/console/admin/parts';

interface MemberDetail {
  member: {
    membership: { id: string; role: Role; status: 'invited' | 'active' | 'deactivated'; allSites: boolean; title: string | null; createdAt: string; updatedAt: string; deactivatedAt: string | null };
    name: string; email: string; lastLoginAt: string | null; mfaEnabled: boolean; siteIds: string[];
  };
  devices: { id: string; name: string; status: string; lastSeenAt: string | null }[];
  inspections: { id: string; title: string; status: string; dueAt: string | null; submittedAt: string | null }[];
  tasks: { id: string; title: string; status: string; priority: string }[];
  sessions: { id: string; createdAt: string; userAgent: string | null }[];
}

export default function MemberDetailPage() {
  const { id } = useParams<{ id: string }>();
  const s = useSession();
  const can = useCan();
  const allowed = can('member.read');
  const q = useApi<MemberDetail>(allowed ? `/members/${id}` : null);
  const sites = useSites();
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<null | 'deactivated' | 'active'>(null);

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
            return (
              <div className="grid gap-4 fade-in">
                <section className="card grid gap-6 sm:grid-cols-[auto_1fr] sm:items-center" aria-labelledby="member-name">
                  <Avatar name={m.name} size={88} tone={m.membership.status === 'active' ? 'lime' : 'surface'} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Chip tone={m.membership.role === 'org_admin' ? 'lime' : 'default'}>{ROLE_LABELS[m.membership.role]}</Chip>
                      <MemberStatusChip status={m.membership.status} />
                      {m.mfaEnabled ? <Chip tone="ok"><ShieldCheck size={13} aria-hidden />MFA on</Chip> : <Chip tone="outline"><ShieldOff size={13} aria-hidden />MFA off</Chip>}
                      {self && <Chip tone="cobalt">You</Chip>}
                    </div>
                    <h1 id="member-name" className="t-page mt-3 break-words">{m.name}</h1>
                    <p className="mt-1 break-all text-text-2">{m.email}{m.membership.title ? ` · ${m.membership.title}` : ''}</p>
                    <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
                      <dl className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
                        <div><dt className="t-label">Last sign-in</dt><dd className="num mt-0.5">{m.lastLoginAt ? `${fmtDateTime(m.lastLoginAt)} · ${ago(m.lastLoginAt)}` : 'Never'}</dd></div>
                        <div><dt className="t-label">Member since</dt><dd className="num mt-0.5">{fmtDate(m.membership.createdAt)}</dd></div>
                        <div><dt className="t-label">Site access</dt><dd className="mt-0.5">{m.membership.allSites ? 'All sites' : `${m.siteIds.length} site${m.siteIds.length === 1 ? '' : 's'}`}</dd></div>
                      </dl>
                      {manageable && !self && (m.membership.status === 'deactivated'
                        ? <Button icon={<UserCheck size={16} aria-hidden />} onClick={() => setConfirm('active')}>Reactivate member</Button>
                        : <Button variant="danger" icon={<UserX size={16} aria-hidden />} onClick={() => setConfirm('deactivated')}>Deactivate member</Button>)}
                    </div>
                  </div>
                </section>

                <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
                  {manageable ? (
                    <AccessEditor key={m.membership.updatedAt} userId={id} self={self} detail={data} sites={siteList} roles={assignableRoles(s.role!)} orgWide={s.siteScope === 'all'} />
                  ) : (
                    <Card title="Role and access">
                      <KeyValues columns={1} items={[
                        ['Role', ROLE_LABELS[m.membership.role]],
                        ['Job title', m.membership.title ?? '—'],
                        ['Sites', m.membership.allSites ? 'All sites, including sites added later' : siteNames.join(', ') || 'No sites'],
                      ]} />
                      <p className="mt-4 text-xs text-muted">{can('member.manage') ? 'Your role cannot change members with this role.' : 'Only administrators and factory managers can change roles and access.'}</p>
                    </Card>
                  )}
                  <Card title="Assigned glasses" action={<span className="t-label num">{data.devices.length}</span>}>
                    {data.devices.length ? (
                      <ul className="grid gap-2">
                        {data.devices.map((d) => (
                          <li key={d.id}>
                            <Link href={`/console/devices/${d.id}`} className="card-inset flex items-center gap-3 px-4 py-3 hover:border-line-2">
                              <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-surface-2"><Glasses size={16} aria-hidden /></span>
                              <span className="min-w-0 flex-1"><span className="block truncate text-sm">{d.name}</span><span className="text-xs text-muted">{d.lastSeenAt ? `seen ${ago(d.lastSeenAt)}` : 'never connected'}</span></span>
                              <StateChip state={d.status === 'active' ? 'paired' : d.status} label={d.status === 'active' ? 'Active' : undefined} />
                            </Link>
                          </li>
                        ))}
                      </ul>
                    ) : <EmptyState icon={<Glasses size={20} aria-hidden />} title="No glasses assigned" body="Assign glasses from the field glasses page or pair a new pair to this person." />}
                  </Card>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <Card title="Recent inspections" action={<Link href="/console/inspections" className="text-sm text-text-2 hover:text-text">All inspections</Link>}>
                    {data.inspections.length ? (
                      <ul className="grid gap-1">
                        {data.inspections.map((i) => (
                          <li key={i.id}>
                            <Link href={`/console/inspections/${i.id}`} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 hover:bg-surface-2">
                              <span className="min-w-0 flex-1"><span className="block truncate text-sm">{i.title}</span>
                                <span className="text-xs text-muted num">{i.submittedAt ? `submitted ${fmtDateTime(i.submittedAt)}` : until(i.dueAt)}</span></span>
                              <StateChip state={i.status} />
                            </Link>
                          </li>
                        ))}
                      </ul>
                    ) : <p className="text-sm text-muted">No inspections assigned yet.</p>}
                  </Card>
                  <Card title="Maintenance tasks" action={<Link href="/console/maintenance" className="text-sm text-text-2 hover:text-text">All tasks</Link>}>
                    {data.tasks.length ? (
                      <ul className="grid gap-1">
                        {data.tasks.map((t) => (
                          <li key={t.id}>
                            <Link href={`/console/maintenance/${t.id}`} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 hover:bg-surface-2">
                              <span className="min-w-0 flex-1 truncate text-sm">{t.title}</span>
                              <StateChip state={t.priority} />
                              <StateChip state={t.status} />
                            </Link>
                          </li>
                        ))}
                      </ul>
                    ) : <p className="text-sm text-muted">No maintenance tasks assigned.</p>}
                  </Card>
                </div>

                {s.role === 'org_admin' && (
                  <Card title="Active sign-in sessions" action={<span className="t-label num">{data.sessions.length}</span>}>
                    {data.sessions.length ? (
                      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                        {data.sessions.map((x) => (
                          <li key={x.id} className="card-inset px-4 py-3 text-sm">
                            <div>{describeAgent(x.userAgent)}</div>
                            <div className="mt-0.5 text-xs text-muted num">Signed in {fmtDateTime(x.createdAt)}</div>
                          </li>
                        ))}
                      </ul>
                    ) : <p className="text-sm text-muted">No active console sessions.</p>}
                    <p className="mt-4 text-xs text-muted">Deactivating the member ends all of these sessions immediately. Members can end their own sessions from Account & security.</p>
                  </Card>
                )}

                <ConfirmDialog open={confirm === 'deactivated'} onOpenChange={(v) => !v && setConfirm(null)} destructive title={`Deactivate ${m.name}?`}
                  body={<>This takes effect immediately: every console session for {m.name.split(' ')[0]} ends, {data.devices.length ? `their ${data.devices.length} assigned glasses are unassigned and signed out` : 'any glasses assigned to them are unassigned'}, and they can no longer sign in to this organization. Their records and audit history are kept. You can reactivate them later.</>}
                  confirmLabel="Deactivate member"
                  onConfirm={async () => { await patch(`/members/${id}`, { status: 'deactivated' }); invalidatePaths(qc, ['/members', '/devices', '/overview']); }} />
                <ConfirmDialog open={confirm === 'active'} onOpenChange={(v) => !v && setConfirm(null)} title={`Reactivate ${m.name}?`}
                  body={<>They can sign in again with their existing password and keep their previous role and site access. Glasses are not reassigned automatically.</>}
                  confirmLabel="Reactivate member"
                  onConfirm={async () => { await patch(`/members/${id}`, { status: 'active' }); invalidatePaths(qc, ['/members']); }} />
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
  const act = useAction((v: Record<string, unknown>) => patch(`/members/${userId}`, v), { invalidate: ['/members'], success: 'Access updated' });
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
      <form className="grid gap-5" onSubmit={(e) => { e.preventDefault(); if (dirty && !sitesInvalid) save(); }}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Role" value={role} onChange={(e) => setRole(e.target.value as Role)} disabled={self}
            options={roles.map((r) => ({ value: r, label: ROLE_LABELS[r] }))} hint={self ? 'You cannot change your own role.' : 'Takes effect on their next request.'} />
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
