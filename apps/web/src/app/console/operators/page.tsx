'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import * as RMenu from '@radix-ui/react-dropdown-menu';
import clsx from 'clsx';
import {
  AlertTriangle, CheckCircle2, FileUp, Glasses, KeyRound, LayoutGrid, List, LogOut, Mail, MoreHorizontal, Pencil, RotateCw, Search, Send, ShieldCheck, ShieldOff, UserCheck, UserMinus, UserPlus, UserX, X,
} from 'lucide-react';
import { ROLE_LABELS, type Role } from '@hydris/domain';
import { del, post } from '@/lib/api';
import { invalidatePaths, useAction, useApi } from '@/lib/query';
import { useCan, useSession } from '@/lib/session';
import { ago, fmtDate, fmtDateTime } from '@/lib/format';
import { Avatar, Button, Capsule, Card, Chip, DataTable, EmptyState, IconButton, Input, KpiCard, PageHeader, QueryView, Select, Skeleton, type Column } from '@/ui';
import { ConfirmDialog, Dialog } from '@/ui/overlay';
import { CopyField, MemberStatusChip, NoAccess, SiteAccessPicker, useSites, type InvitationRow, type MemberRow, type MembersResponse, type Site } from '@/console/admin/parts';
import { AssignWorkDialog } from '@/console/command/AssignWork';
import { EditProfileDialog, MemberActionDialogs, type ActionTarget, type MemberAction } from '@/console/command/members';
import type { OperatorStats } from '@/console/command/types';

type StatusFilter = 'current' | 'active' | 'invited' | 'suspended' | 'removed' | 'all';
type View = 'cards' | 'table';
type Row = MemberRow & { stats?: OperatorStats; invitation?: InvitationRow };

const VIEW_KEY = 'hydris.operators.view';

export default function OperatorsPage() {
  const can = useCan();
  const allowed = can('member.read');
  const q = useApi<MembersResponse>(allowed ? '/members' : null);
  const stats = useApi<{ operators: OperatorStats[] }>(allowed && can('console.access') ? '/command/operators' : null, { refetchInterval: 30_000 });
  const sites = useSites();
  const router = useRouter();
  const qc = useQueryClient();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [status, setStatus] = useState<StatusFilter>('current');
  const [siteFilter, setSiteFilter] = useState('');
  const [shiftFilter, setShiftFilter] = useState('');
  const [query, setQuery] = useState('');
  const [view, setView] = useState<View>('cards');
  const [revoke, setRevoke] = useState<InvitationRow | null>(null);
  const [action, setAction] = useState<{ target: ActionTarget; action: MemberAction } | null>(null);
  const [editing, setEditing] = useState<MemberRow | null>(null);
  const [assignTo, setAssignTo] = useState<string[] | null>(null);
  const canManage = can('member.manage');
  const canInvite = canManage && (q.data?.assignableRoles.length ?? 0) > 0;
  const siteName = useMemo(() => new Map((sites.data?.sites ?? []).map((s) => [s.id, s.name])), [sites.data]);
  const statsBy = useMemo(() => new Map((stats.data?.operators ?? []).map((o) => [o.userId, o])), [stats.data]);

  useEffect(() => {
    try { const v = localStorage.getItem(VIEW_KEY); if (v === 'cards' || v === 'table') setView(v); } catch { /* storage unavailable */ }
    if (new URLSearchParams(window.location.search).get('invite') === '1') setInviteOpen(true);
  }, []);
  const changeView = (v: View) => { setView(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* ignore */ } };

  const resend = useAction((id: string) => post<{ invitationLink: string | null }>(`/invitations/${id}/resend`, {}), { invalidate: ['/members'], success: 'Invitation sent again with a fresh link' });
  const act = (m: MemberRow, a: MemberAction) => setAction({ target: { userId: m.userId, name: m.name, status: m.status, devices: m.devices }, action: a });

  return (
    <>
      <PageHeader eyebrow="Team" title="Operators"
        subtitle="Invite and manage the people in the field: their shifts, sites, glasses and work. Operators join by invitation and use the Hydris Field app and glasses."
        actions={canInvite ? <>
          <Button variant="secondary" icon={<FileUp size={16} aria-hidden />} onClick={() => setBulkOpen(true)}>Invite from CSV</Button>
          <Button variant="primary" icon={<UserPlus size={16} aria-hidden />} onClick={() => setInviteOpen(true)}>Invite people</Button>
        </> : undefined} />
      {!allowed ? <NoAccess what="members" /> : (
        <QueryView q={q} loading={<OperatorsSkeleton />}>
          {(data) => {
            const members: Row[] = data.members.map((m) => ({ ...m, stats: statsBy.get(m.userId) }));
            const shifts = [...new Set([...data.members.map((m) => m.shiftLabel), ...data.invitations.map((i) => i.shiftLabel)].filter((x): x is string => !!x))].sort();
            const needle = query.trim().toLowerCase();
            const inStatus = (m: Row) => status === 'all' || (status === 'current' ? m.status === 'active' || m.status === 'invited' : m.status === status);
            const rows = members
              .filter(inStatus)
              .filter((m) => !siteFilter || m.allSites || m.siteIds.includes(siteFilter))
              .filter((m) => !shiftFilter || m.shiftLabel === shiftFilter)
              .filter((m) => !needle || `${m.name} ${m.email} ${m.employeeId ?? ''} ${m.phone ?? ''} ${m.shiftLabel ?? ''} ${ROLE_LABELS[m.role]}`.toLowerCase().includes(needle));
            const invites = data.invitations
              .filter(() => status === 'current' || status === 'invited' || status === 'all')
              .filter((i) => !siteFilter || i.allSites || i.siteIds.includes(siteFilter))
              .filter((i) => !shiftFilter || i.shiftLabel === shiftFilter)
              .filter((i) => !needle || `${i.name ?? ''} ${i.email} ${i.employeeId ?? ''}`.toLowerCase().includes(needle));
            const active = members.filter((m) => m.status === 'active');
            const ops = active.filter((m) => m.role === 'operator');
            const online = ops.filter((m) => m.stats?.devices.some((d) => d.connected)).length;
            const weekA = ops.reduce((a, m) => a + (m.stats?.rounds.weekAssigned ?? 0), 0);
            const weekC = ops.reduce((a, m) => a + (m.stats?.rounds.weekCompleted ?? 0), 0);
            const filtered = !!(needle || siteFilter || shiftFilter);
            const clearFilters = () => { setQuery(''); setSiteFilter(''); setShiftFilter(''); };
            const scope = (m: { allSites: boolean; siteIds: string[] }) => m.allSites ? 'All sites' : m.siteIds.length === 1 ? siteName.get(m.siteIds[0]!) ?? '1 site' : `${m.siteIds.length} sites`;
            const menu = (m: Row) => (
              <RowMenu m={m} canManage={canManage && data.assignableRoles.includes(m.role)}
                onOpen={() => router.push(`/console/operators/${m.userId}`)} onEdit={() => setEditing(m)} onAssign={() => setAssignTo([m.userId])} onAction={(a) => act(m, a)} />
            );

            const columns: Column<Row>[] = [
              { key: 'name', header: 'Person', sort: (m) => m.name, cell: (m) => (
                <span className="flex min-w-[210px] items-center gap-3">
                  <span className={clsx('relative', m.status !== 'active' && 'opacity-50')}>
                    <Avatar name={m.name} size={34} />
                    {m.stats?.devices.some((d) => d.connected) && <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-ok ring-2 ring-surface" title="Glasses connected" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate">{m.name}</span>
                    <span className="block truncate text-xs text-muted">{[m.employeeId, m.email].filter(Boolean).join(' · ')}</span>
                  </span>
                </span>
              ) },
              { key: 'status', header: 'Status', sort: (m) => m.status, cell: (m) => <span className="flex items-center gap-1.5"><MemberStatusChip status={m.status} />{m.role === 'admin' && <Chip tone="lime">Admin</Chip>}</span> },
              { key: 'shift', header: 'Shift', sort: (m) => m.shiftLabel, cell: (m) => <span className="whitespace-nowrap text-text-2">{m.shiftLabel ?? <span className="text-muted">—</span>}</span> },
              { key: 'sites', header: 'Sites', cell: (m) => <span className="whitespace-nowrap text-text-2" title={m.siteIds.map((s) => siteName.get(s) ?? s).join(', ')}>{scope(m)}</span> },
              { key: 'devices', header: 'Devices', sort: (m) => m.devices, cell: (m) => m.stats?.devices.length ? (
                <span className="flex flex-col gap-0.5">
                  {m.stats.devices.map((d) => <Link key={d.id} href={`/console/devices/${d.id}`} className="flex items-center gap-1.5 whitespace-nowrap text-[13px] hover:underline"><span className={clsx('dot', d.connected ? 'bg-ok' : 'bg-surface-3')} style={{ width: 6, height: 6 }} aria-hidden />{d.name}{d.battery !== null && <span className="text-muted num">{Math.round(d.battery)}%</span>}</Link>)}
                </span>
              ) : <span className="text-muted">None</span> },
              { key: 'active', header: 'Last active', sort: (m) => (m.stats?.lastActiveAt ? -new Date(m.stats.lastActiveAt).getTime() : null), cell: (m) => {
                const t = m.stats?.lastActiveAt ?? m.lastLoginAt;
                return <span className="num whitespace-nowrap text-text-2" title={t ? new Date(t).toLocaleString() : undefined}>{t ? ago(t) : 'Never'}</span>;
              } },
              { key: 'rounds', header: 'Rounds this week', className: 'text-right', sort: (m) => m.stats?.rounds.weekCompleted ?? 0, cell: (m) => m.stats ? (
                <span className="num whitespace-nowrap">{m.stats.rounds.weekCompleted}<span className="text-muted">/{m.stats.rounds.weekAssigned}</span>{m.stats.rounds.overdue > 0 && <span className="ml-1.5 text-xs text-high-text">{m.stats.rounds.overdue} late</span>}</span>
              ) : <span className="text-muted">—</span> },
              { key: 'alarms', header: 'Open alarms', className: 'text-right', sort: (m) => m.stats?.openAlarms ?? 0, cell: (m) => <span className={clsx('num', m.stats?.openAlarms ? 'font-medium text-critical-text' : 'text-muted')}>{m.stats?.openAlarms ?? 0}</span> },
              { key: 'mfa', header: 'MFA', cell: (m) => m.mfaEnabled ? <ShieldCheck size={15} className="text-ok-text" aria-label="MFA on" /> : <ShieldOff size={15} className="text-muted" aria-label="MFA off" /> },
              { key: 'menu', header: <span className="sr-only">Actions</span>, className: 'w-10 text-right', cell: menu },
            ];

            return (
              <div className="grid grid-cols-[minmax(0,1fr)] gap-4 fade-in">
                <div className="stagger grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
                  <KpiCard label="Active operators" value={ops.length} sub={`${active.length - ops.length} administrator${active.length - ops.length === 1 ? '' : 's'}`} />
                  <KpiCard label="Glasses connected now" value={<>{online}<span className="text-[0.5em] opacity-50">/{ops.length}</span></>} href="/console/devices" sub="Operators wearing connected glasses" />
                  <KpiCard label="Rounds this week" value={<>{weekC}<span className="text-[0.5em] opacity-50">/{weekA}</span></>} href="/console/inspections" sub={weekA ? `${Math.round((weekC / weekA) * 100)}% completed` : 'Nothing assigned this week'} />
                  <KpiCard label="Pending invitations" value={data.invitations.length} accent={data.invitations.some((i) => i.status === 'expired') ? 'high' : undefined}
                    sub={`${data.invitations.filter((i) => i.status === 'expired').length} expired`} />
                </div>

                <Card>
                  <div className="mb-4 grid grid-cols-[minmax(0,1fr)] gap-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <Capsule label="Member status" value={status} onChange={setStatus} options={[
                        { value: 'current', label: 'Current', count: members.filter((m) => m.status === 'active').length + data.invitations.length },
                        { value: 'active', label: 'Active', count: active.length },
                        { value: 'invited', label: 'Invited', count: data.invitations.length },
                        { value: 'suspended', label: 'Suspended', count: members.filter((m) => m.status === 'suspended').length },
                        { value: 'removed', label: 'Removed', count: members.filter((m) => m.status === 'removed').length },
                        { value: 'all', label: 'All' },
                      ]} />
                      <div className="capsule" role="group" aria-label="Layout">
                        <button type="button" aria-pressed={view === 'cards'} aria-label="Card view" onClick={() => changeView('cards')} data-active={view === 'cards'}><LayoutGrid size={15} aria-hidden /><span className="max-sm:sr-only">Cards</span></button>
                        <button type="button" aria-pressed={view === 'table'} aria-label="Table view" onClick={() => changeView('table')} data-active={view === 'table'}><List size={15} aria-hidden /><span className="max-sm:sr-only">Table</span></button>
                      </div>
                    </div>
                    <div className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-[1fr_200px_220px]">
                      <div className="relative">
                        <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
                        <input className="input input-search" placeholder="Search name, email, employee ID, phone" aria-label="Search operators" value={query} onChange={(e) => setQuery(e.target.value)} />
                      </div>
                      <Select aria-label="Filter by site" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} placeholder="All sites" options={(sites.data?.sites ?? []).map((s) => ({ value: s.id, label: s.name }))} />
                      <Select aria-label="Filter by shift" value={shiftFilter} onChange={(e) => setShiftFilter(e.target.value)} placeholder="All shifts" options={shifts.map((s) => ({ value: s, label: s }))} />
                    </div>
                    {filtered && <div className="flex items-center gap-2 text-[13px] text-text-2"><span className="num">{rows.length + invites.length} match{rows.length + invites.length === 1 ? '' : 'es'}</span><button type="button" className="link-quiet" onClick={clearFilters}>Clear filters</button></div>}
                  </div>

                  {!rows.length && !invites.length ? (
                    <EmptyState title={filtered ? 'No one matches these filters' : data.members.length ? 'No members in this list' : 'No operators yet'}
                      body={filtered ? undefined : 'Invite your field team; each person gets an email to set a password and install the Hydris Field app.'}
                      action={filtered ? <Button onClick={clearFilters}>Clear filters</Button> : canInvite ? <Button variant="primary" icon={<UserPlus size={16} aria-hidden />} onClick={() => setInviteOpen(true)}>Invite people</Button> : undefined} />
                  ) : view === 'table' ? (
                    <>
                      {rows.length > 0 && <DataTable rows={rows} columns={columns} rowKey={(m) => m.userId} onRowClick={(m) => router.push(`/console/operators/${m.userId}`)} />}
                      {invites.length > 0 && <InvitationList invites={invites} canManage={canManage} scope={scope} onResend={(i) => resend.mutate(i.id)} resending={resend.isPending ? resend.variables : undefined} onRevoke={setRevoke} />}
                    </>
                  ) : (
                    <ul className="stagger grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {rows.map((m) => <li key={m.userId}><MemberCard m={m} scope={scope(m)} menu={menu(m)} /></li>)}
                      {invites.map((i) => <li key={i.id}><InviteCard i={i} scope={scope(i)} canManage={canManage} onResend={() => resend.mutate(i.id)} busy={resend.isPending && resend.variables === i.id} onRevoke={() => setRevoke(i)} /></li>)}
                    </ul>
                  )}
                </Card>

                {bulkOpen && <BulkInviteDialog sites={sites.data?.sites ?? []} existing={new Set([...data.members.filter((m) => m.status !== 'removed').map((m) => m.email.toLowerCase())])} onClose={() => setBulkOpen(false)} />}
                {inviteOpen && <InviteDialog roles={data.assignableRoles} sites={sites.data?.sites ?? []} shifts={shifts} onClose={() => setInviteOpen(false)} />}
                {editing && <EditProfileDialog member={editing} sites={sites.data?.sites ?? []} shifts={shifts} onClose={() => setEditing(null)} />}
                {assignTo && <AssignWorkDialog open preselect={assignTo} onClose={() => setAssignTo(null)} />}
                <MemberActionDialogs target={action?.target ?? null} action={action?.action ?? null} onDone={() => setAction(null)} />
                <ConfirmDialog open={!!revoke} onOpenChange={(v) => !v && setRevoke(null)} title="Revoke invitation?" destructive
                  body={<>The link sent to {revoke?.email} stops working immediately. You can invite them again later.</>}
                  confirmLabel="Revoke invitation" onConfirm={async () => { await del(`/invitations/${revoke!.id}`); invalidatePaths(qc, ['/members']); }} />
              </div>
            );
          }}
        </QueryView>
      )}
    </>
  );
}

function RowMenu({ m, canManage, onOpen, onEdit, onAssign, onAction }: { m: Row; canManage: boolean; onOpen: () => void; onEdit: () => void; onAssign: () => void; onAction: (a: MemberAction) => void }) {
  const s = useSession();
  const self = m.userId === s.user.id;
  const item = 'flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-sm outline-none data-[highlighted]:bg-surface-2';
  return (
    <RMenu.Root>
      <RMenu.Trigger asChild>
        <IconButton label={`Actions for ${m.name}`} size="sm" tone="ghost"><MoreHorizontal size={16} aria-hidden /></IconButton>
      </RMenu.Trigger>
      <RMenu.Portal>
        {/* React events bubble through portals: keep menu clicks from reaching the table row's click handler. */}
        <RMenu.Content onClick={(e) => e.stopPropagation()} align="end" sideOffset={6} className="z-50 min-w-[220px] rounded-[var(--radius-lg)] border border-line-2 bg-surface p-1.5 shadow-[var(--shadow-3)] fade-in">
          <RMenu.Item className={item} onSelect={onOpen}><UserCheck size={15} aria-hidden />Open profile</RMenu.Item>
          {canManage && m.status !== 'removed' && <RMenu.Item className={item} onSelect={onEdit}><Pencil size={15} aria-hidden />Edit profile, shift & sites</RMenu.Item>}
          {m.status === 'active' && <RMenu.Item className={item} onSelect={onAssign}><Send size={15} aria-hidden />Assign work</RMenu.Item>}
          {canManage && !self && m.status !== 'removed' && (
            <>
              <RMenu.Separator className="my-1 h-px bg-line" />
              {m.status === 'active' && <RMenu.Item className={item} onSelect={() => onAction('reset')}><KeyRound size={15} aria-hidden />Reset access</RMenu.Item>}
              {m.status === 'active' && <RMenu.Item className={item} onSelect={() => onAction('sessions')}><LogOut size={15} aria-hidden />Sign out everywhere</RMenu.Item>}
              {m.status === 'suspended'
                ? <RMenu.Item className={item} onSelect={() => onAction('reactivate')}><UserCheck size={15} aria-hidden />Reactivate</RMenu.Item>
                : <RMenu.Item className={clsx(item, 'text-high-text')} onSelect={() => onAction('suspend')}><UserX size={15} aria-hidden />Suspend</RMenu.Item>}
              <RMenu.Item className={clsx(item, 'text-critical-text')} onSelect={() => onAction('remove')}><UserMinus size={15} aria-hidden />Remove</RMenu.Item>
            </>
          )}
        </RMenu.Content>
      </RMenu.Portal>
    </RMenu.Root>
  );
}

function MemberCard({ m, scope, menu }: { m: Row; scope: string; menu: React.ReactNode }) {
  const st = m.stats;
  const connected = st?.devices.some((d) => d.connected);
  const pct = st?.rounds.weekAssigned ? Math.round((st.rounds.weekCompleted / st.rounds.weekAssigned) * 100) : null;
  return (
    <article className={clsx('card-inset lift relative flex h-full flex-col gap-4 p-4', m.status !== 'active' && 'opacity-75')}>
      <div className="flex items-start gap-3">
        <Link href={`/console/operators/${m.userId}`} className="flex min-w-0 flex-1 items-center gap-3">
          <span className="relative flex-none">
            <Avatar name={m.name} size={44} tone={connected ? 'cobalt' : 'surface'} />
            {connected && <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-ok ring-2 ring-[var(--color-bg-2)]" title="Glasses connected" />}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[15.5px] font-medium">{m.name}</span>
            <span className="block truncate text-xs text-muted">{m.employeeId ? `${m.employeeId} · ` : ''}{m.email}</span>
          </span>
        </Link>
        {menu}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <MemberStatusChip status={m.status} />
        {m.role === 'admin' ? <Chip tone="lime">{ROLE_LABELS.admin}</Chip> : null}
        {m.shiftLabel && <Chip tone="outline">{m.shiftLabel}</Chip>}
        <Chip tone="outline">{scope}</Chip>
      </div>
      <dl className="grid grid-cols-3 gap-2 border-t border-line pt-3 text-center">
        <div><dt className="text-[11.5px] text-muted">Rounds wk</dt><dd className="num text-[15px]">{st ? <>{st.rounds.weekCompleted}<span className="text-muted">/{st.rounds.weekAssigned}</span></> : '—'}</dd></div>
        <div><dt className="text-[11.5px] text-muted">Open alarms</dt><dd className={clsx('num text-[15px]', st?.openAlarms ? 'text-critical-text' : undefined)}>{st?.openAlarms ?? 0}</dd></div>
        <div><dt className="text-[11.5px] text-muted">Open tasks</dt><dd className="num text-[15px]">{m.openTasks}</dd></div>
      </dl>
      {pct !== null && <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden><div className="h-full rounded-full bg-[var(--color-signal)]" style={{ width: `${Math.max(pct, 3)}%` }} /></div>}
      <div className="mt-auto flex items-center justify-between gap-2 text-[12.5px] text-text-2">
        <span className="flex min-w-0 items-center gap-1.5"><Glasses size={14} className="flex-none text-muted" aria-hidden /><span className="truncate">{st?.devices.length ? st.devices.map((d) => d.name).join(', ') : 'No glasses'}</span></span>
        <span className="num flex-none text-muted">{st?.lastActiveAt ? `active ${ago(st.lastActiveAt)}` : m.lastLoginAt ? `signed in ${ago(m.lastLoginAt)}` : 'never signed in'}</span>
      </div>
    </article>
  );
}

function InviteCard({ i, scope, canManage, onResend, onRevoke, busy }: { i: InvitationRow; scope: string; canManage: boolean; onResend: () => void; onRevoke: () => void; busy: boolean }) {
  const expired = i.status === 'expired';
  return (
    <article className="flex h-full flex-col gap-4 rounded-[var(--radius-lg)] border border-dashed border-line-2 p-4">
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 flex-none place-items-center rounded-full border border-dashed border-line-2 text-muted"><Mail size={16} aria-hidden /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15.5px] font-medium">{i.name ?? i.email}</span>
          <span className="block truncate text-xs text-muted">{i.name ? i.email : ROLE_LABELS[i.role]}</span>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {expired ? <Chip tone="high">Invite expired</Chip> : <Chip tone="outline">Invited</Chip>}
        {i.shiftLabel && <Chip tone="outline">{i.shiftLabel}</Chip>}
        <Chip tone="outline">{scope}</Chip>
      </div>
      <p className="text-[12.5px] text-muted num">Invited {fmtDate(i.createdAt)} · {expired ? 'link expired' : `expires ${fmtDateTime(i.expiresAt)}`}</p>
      {canManage && (
        <div className="mt-auto flex gap-2">
          <Button size="sm" icon={<RotateCw size={14} aria-hidden />} busy={busy} onClick={onResend}>Resend</Button>
          <Button size="sm" variant="ghost" icon={<X size={14} aria-hidden />} onClick={onRevoke}>Revoke</Button>
        </div>
      )}
    </article>
  );
}

function InvitationList({ invites, canManage, scope, onResend, onRevoke, resending }: { invites: InvitationRow[]; canManage: boolean; scope: (i: InvitationRow) => string; onResend: (i: InvitationRow) => void; onRevoke: (i: InvitationRow) => void; resending?: string }) {
  return (
    <section className="mt-6" aria-labelledby="pending-invites">
      <h2 id="pending-invites" className="t-card mb-3">Pending invitations <span className="t-label num">· {invites.length}</span></h2>
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
        {invites.map((i) => (
          <li key={i.id} className="card-inset flex flex-wrap items-center gap-3 px-4 py-3">
            <span className="grid h-9 w-9 flex-none place-items-center rounded-full border border-dashed border-line-2 text-muted"><Mail size={15} aria-hidden /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{i.name ? `${i.name} · ` : ''}{i.email}</span>
              <span className="block text-xs text-muted num">{ROLE_LABELS[i.role]}{i.shiftLabel ? ` · ${i.shiftLabel}` : ''} · {scope(i)} · invited {fmtDate(i.createdAt)} · {i.status === 'expired' ? <span className="text-high-text">expired</span> : `expires ${fmtDateTime(i.expiresAt)}`}</span>
            </span>
            {canManage && <>
              <Button size="sm" icon={<RotateCw size={14} aria-hidden />} busy={resending === i.id} onClick={() => onResend(i)}>Resend</Button>
              <IconButton label={`Revoke invitation for ${i.email}`} size="sm" tone="ghost" onClick={() => onRevoke(i)}><X size={16} aria-hidden /></IconButton>
            </>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function InviteDialog({ roles, sites, shifts, onClose }: { roles: Role[]; sites: Site[]; shifts: string[]; onClose: () => void }) {
  const s = useSession();
  const orgWide = s.siteScope === 'all';
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>(roles.includes('operator') ? 'operator' : roles[0]!);
  const [employeeId, setEmployeeId] = useState('');
  const [phone, setPhone] = useState('');
  const [shiftLabel, setShiftLabel] = useState('');
  const [access, setAccess] = useState<{ allSites: boolean; siteIds: string[] }>({ allSites: orgWide, siteIds: [] });
  const [link, setLink] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [sentBySupabase, setSentBySupabase] = useState(false);
  const act = useAction((v: { email: string; name?: string; role: Role; allSites: boolean; siteIds: string[]; employeeId?: string; phone?: string; shiftLabel?: string }) => post<{ invitationLink: string | null; delivery: 'supabase' | 'outbox' }>('/invitations', v), {
    invalidate: ['/members', '/command'], success: 'Invitation sent', onSuccess: (r) => { setSentBySupabase(r.delivery === 'supabase'); setLink(r.invitationLink ?? ''); },
  });
  const emailErr = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? 'Enter a valid email address' : null;
  const sitesErr = !access.allSites && !access.siteIds.length;
  const submit = () => {
    setTouched(true);
    if (emailErr || sitesErr) return;
    act.mutate({
      email: email.trim(), name: name.trim() || undefined, role, allSites: access.allSites, siteIds: access.allSites ? [] : access.siteIds,
      ...(role === 'operator' ? { employeeId: employeeId.trim() || undefined, phone: phone.trim() || undefined, shiftLabel: shiftLabel.trim() || undefined } : {}),
    });
  };
  const reset = () => { setLink(null); setEmail(''); setName(''); setEmployeeId(''); setPhone(''); setTouched(false); };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={link !== null ? 'Invitation ready' : 'Invite people'} wide
      description={link !== null ? (sentBySupabase ? `${email} has been emailed an invitation. It expires in 7 days.` : `${email} has been emailed an invitation. You can also share this link directly; it is single-use and expires in 7 days.`) : 'Invited people set their own password when they accept. Field Operators are then guided to install the Hydris Field app.'}
      footer={link !== null ? <>
        <Button variant="ghost" onClick={reset}>Invite someone else</Button>
        <Button variant="primary" onClick={onClose}>Done</Button>
      </> : <>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" busy={act.isPending} onClick={submit}>Send invitation</Button>
      </>}>
      {link !== null ? (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
          {link ? <CopyField label="Invitation link" value={link} mono /> : <p className="text-sm text-text-2">Delivered by email. The person sets a password from the link, then gets the app.</p>}
          <p className="text-xs text-muted">Treat this link like a password: anyone who opens it can join as {ROLE_LABELS[role]}. Revoke it from the operators list if it was shared by mistake.</p>
        </div>
      ) : (
        <form className="grid grid-cols-[minmax(0,1fr)] gap-5" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
            <Input label="Email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} error={touched ? emailErr : null} autoFocus required />
            <Input label="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </div>
          <Select label="Account type" value={role} onChange={(e) => setRole(e.target.value as Role)} options={roles.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
            hint={role === 'operator' ? 'Uses the Hydris Field app and glasses. No console access.' : 'Full console access for this organization; may also use glasses.'} />
          {role === 'operator' && (
            <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-3">
              <Input label="Employee ID (optional)" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} maxLength={40} />
              <Input label="Phone (optional)" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} />
              <Input label="Shift (optional)" value={shiftLabel} onChange={(e) => setShiftLabel(e.target.value)} maxLength={60} placeholder="A shift (06:00-14:00)" list="invite-shifts" />
              <datalist id="invite-shifts">{shifts.map((x) => <option key={x} value={x} />)}</datalist>
            </div>
          )}
          <SiteAccessPicker sites={sites} allSites={access.allSites} siteIds={access.siteIds} onChange={setAccess} allowAllSites={orgWide} />
          {touched && sitesErr && <p className="field-error" role="alert">Select at least one site.</p>}
        </form>
      )}
    </Dialog>
  );
}

interface BulkResult { invited: number; failed: number; results: { row: number; email: string; ok: boolean; error?: string }[] }
interface PreviewRow { row: number; email: string; name: string; employeeId: string; phone: string; shift: string; sites: string; problems: string[] }

const CSV_PLACEHOLDER = 'email,name,employee_id,phone,shift,sites\npriya@plant.example,Priya,EMP-42,+91 90000 00042,A shift,ETP-01';

/** Minimal RFC 4180 parser (mirrors the API's) for the client-side preview. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && src[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

function preview(csv: string, sites: Site[], existing: Set<string>): { rows: PreviewRow[]; error: string | null } {
  const rows = parseCsv(csv);
  if (!rows.length) return { rows: [], error: null };
  const header = rows[0]!.map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_'));
  const col = (names: string[]) => header.findIndex((h) => names.includes(h));
  const ix = { email: col(['email', 'e_mail', 'work_email']), name: col(['name', 'full_name']), employeeId: col(['employee_id', 'employee', 'emp_id']), phone: col(['phone', 'mobile']), shift: col(['shift', 'shift_label']), sites: col(['sites', 'site', 'site_codes']) };
  if (ix.email < 0) return { rows: [], error: 'The first row must be a header with an "email" column.' };
  if (rows.length - 1 > 500) return { rows: [], error: 'Invite at most 500 operators per file.' };
  const seen = new Set<string>();
  return {
    error: rows.length < 2 ? 'Add at least one operator below the header row.' : null,
    rows: rows.slice(1).map((cells, i) => {
      const get = (n: number) => (n >= 0 ? (cells[n] ?? '').trim() : '');
      const email = get(ix.email).toLowerCase();
      const problems: string[] = [];
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) problems.push('Invalid email');
      else if (seen.has(email)) problems.push('Duplicate in file');
      else if (existing.has(email)) problems.push('Already a member');
      seen.add(email);
      const refs = get(ix.sites).split(/[;|]/).map((x) => x.trim()).filter(Boolean);
      const unknown = refs.filter((r) => !sites.some((s) => s.id === r || s.code.toLowerCase() === r.toLowerCase()));
      if (unknown.length) problems.push(`Unknown site ${unknown.join(', ')}`);
      if (get(ix.employeeId).length > 40) problems.push('Employee ID too long');
      return { row: i + 2, email, name: get(ix.name), employeeId: get(ix.employeeId), phone: get(ix.phone), shift: get(ix.shift), sites: refs.join('; ') || 'All sites', problems };
    }),
  };
}

/** Bulk operator invitations from CSV with a validated preview before anything is sent. */
function BulkInviteDialog({ sites, existing, onClose }: { sites: Site[]; existing: Set<string>; onClose: () => void }) {
  const [csv, setCsv] = useState('');
  const [result, setResult] = useState<BulkResult | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const p = useMemo(() => preview(csv, sites, existing), [csv, sites, existing]);
  const valid = p.rows.filter((r) => !r.problems.length);
  const act = useAction((v: { csv: string }) => post<BulkResult>('/invitations/bulk', v), { invalidate: ['/members', '/command'], onSuccess: (r) => setResult(r) });
  const send = () => {
    // Only rows that passed validation are sent (header kept).
    const lines = parseCsv(csv);
    const keep = new Set(valid.map((r) => r.row));
    const out = [lines[0]!, ...lines.slice(1).filter((_, i) => keep.has(i + 2))].map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n');
    act.mutate({ csv: out });
  };
  const onFile = async (f: File | undefined) => { if (f) { setFileName(f.name); setCsv(await f.text()); } };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={result ? 'Invitations sent' : 'Invite Field Operators from CSV'} wide
      description={result ? `${result.invited} invited · ${result.failed} skipped` : 'One operator per row. Columns: email (required), name, employee_id, phone, shift, sites (site codes separated by ";"; empty means all sites). Check the preview, then send.'}
      footer={result ? <Button variant="primary" onClick={onClose}>Done</Button> : <>
        <span className="mr-auto self-center text-[13px] text-muted max-sm:hidden">{p.rows.length ? `${valid.length} ready · ${p.rows.length - valid.length} with problems` : ''}</span>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" busy={act.isPending} disabled={!valid.length || !!p.error} onClick={send}>Send {valid.length || ''} invitation{valid.length === 1 ? '' : 's'}</Button>
      </>}>
      {result ? (
        <ul className="grid grid-cols-[minmax(0,1fr)] max-h-[50vh] gap-1.5 overflow-auto text-sm">
          {result.results.map((r) => (
            <li key={`${r.row}-${r.email}`} className="card-inset flex items-center justify-between gap-3 px-3 py-2">
              <span className="min-w-0 truncate">{r.email || '(no email)'}</span>
              {r.ok ? <Chip tone="ok">Invited</Chip> : <span className="text-right text-xs text-high-text">{r.error}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
          <label className="card-inset flex cursor-pointer items-center gap-3 border-dashed p-4 hover:border-line-2">
            <span className="grid h-10 w-10 flex-none place-items-center rounded-full bg-surface-2"><FileUp size={17} aria-hidden /></span>
            <span className="min-w-0 flex-1"><span className="block text-sm">{fileName ?? 'Choose a .csv file'}</span><span className="text-xs text-muted">or paste the rows below</span></span>
            <input type="file" accept=".csv,text/csv" className="sr-only" aria-label="CSV file" onChange={(e) => void onFile(e.target.files?.[0])} />
          </label>
          <textarea className="input min-h-[120px] font-mono text-[13px]" aria-label="CSV content" placeholder={CSV_PLACEHOLDER} value={csv} onChange={(e) => setCsv(e.target.value)} />
          {p.error && <p className="field-error" role="alert">{p.error}</p>}
          {p.rows.length > 0 && (
            <div className="-mx-2 max-h-[40vh] overflow-auto px-2">
              <table className="table table-dense">
                <thead><tr><th scope="col">Row</th><th scope="col">Email</th><th scope="col">Name</th><th scope="col">Employee</th><th scope="col">Shift</th><th scope="col">Sites</th><th scope="col">Check</th></tr></thead>
                <tbody>
                  {p.rows.map((r) => (
                    <tr key={r.row}>
                      <td className="num text-muted">{r.row}</td>
                      <td className="max-w-[200px] truncate">{r.email || <span className="text-muted">(empty)</span>}</td>
                      <td className="max-w-[140px] truncate">{r.name}</td>
                      <td className="num">{r.employeeId}</td>
                      <td className="max-w-[120px] truncate">{r.shift}</td>
                      <td className="max-w-[120px] truncate">{r.sites}</td>
                      <td>{r.problems.length ? <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-high-text"><AlertTriangle size={13} aria-hidden />{r.problems[0]}</span> : <CheckCircle2 size={15} className="text-ok-text" aria-label="Ready" />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

function OperatorsSkeleton() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[148px] rounded-[24px]" />)}</div>
      <Skeleton className="h-[460px] rounded-[24px]" />
    </div>
  );
}
