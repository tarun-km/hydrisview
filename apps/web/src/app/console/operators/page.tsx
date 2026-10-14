'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Mail, Search, ShieldCheck, ShieldOff, UserPlus, X } from 'lucide-react';
import { ROLE_LABELS, type Role } from '@hydris/domain';
import { del, post } from '@/lib/api';
import { invalidatePaths, useAction, useApi } from '@/lib/query';
import { useCan, useSession } from '@/lib/session';
import { ago, fmtDate, fmtDateTime } from '@/lib/format';
import { Avatar, Button, Capsule, Card, Chip, DataTable, EmptyState, IconButton, Input, PageHeader, QueryView, Select, Skeleton, type Column } from '@/ui';
import { ConfirmDialog, Dialog } from '@/ui/overlay';
import { CopyField, MemberStatusChip, NoAccess, SiteAccessPicker, useSites, type InvitationRow, type MemberRow, type MembersResponse, type Site } from '@/console/admin/parts';

type StatusFilter = 'active' | 'deactivated' | 'all';

export default function OperatorsPage() {
  const can = useCan();
  const allowed = can('member.read');
  const q = useApi<MembersResponse>(allowed ? '/members' : null);
  const sites = useSites();
  const router = useRouter();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [status, setStatus] = useState<StatusFilter>('active');
  const [query, setQuery] = useState('');
  const [revoke, setRevoke] = useState<InvitationRow | null>(null);
  const qc = useQueryClient();
  const siteName = useMemo(() => new Map((sites.data?.sites ?? []).map((s) => [s.id, s.name])), [sites.data]);
  const canInvite = can('member.manage') && (q.data?.assignableRoles.length ?? 0) > 0;

  const columns: Column<MemberRow>[] = [
    { key: 'name', header: 'Person', cell: (m) => (
      <span className="flex min-w-[200px] items-center gap-3">
        <span className={m.status === 'deactivated' ? 'opacity-50' : undefined}><Avatar name={m.name} size={34} /></span>
        <span className="min-w-0">
          <span className="block truncate">{m.name}</span>
          <span className="block truncate text-xs text-muted">{m.title ?? m.email}</span>
        </span>
      </span>
    ) },
    { key: 'email', header: 'Email', className: 'hidden xl:table-cell', cell: (m) => <span className="text-text-2">{m.email}</span> },
    { key: 'role', header: 'Role', cell: (m) => <Chip tone={m.role === 'org_admin' ? 'lime' : 'default'}>{ROLE_LABELS[m.role]}</Chip> },
    { key: 'status', header: 'Status', cell: (m) => <MemberStatusChip status={m.status} /> },
    { key: 'sites', header: 'Site scope', cell: (m) => m.allSites ? <span className="text-text-2">All sites</span> : (
      <span className="text-text-2" title={m.siteIds.map((s) => siteName.get(s) ?? s).join(', ')}>
        {m.siteIds.length === 1 ? siteName.get(m.siteIds[0]!) ?? '1 site' : `${m.siteIds.length} sites`}
      </span>
    ) },
    { key: 'devices', header: 'Glasses', className: 'text-right', cell: (m) => <span className="num">{m.devices || <span className="text-muted">0</span>}</span> },
    { key: 'insp', header: 'Open inspections', className: 'text-right', cell: (m) => <span className="num">{m.openInspections || <span className="text-muted">0</span>}</span> },
    { key: 'tasks', header: 'Open tasks', className: 'text-right', cell: (m) => <span className="num">{m.openTasks || <span className="text-muted">0</span>}</span> },
    { key: 'mfa', header: 'MFA', cell: (m) => m.mfaEnabled
      ? <span className="inline-flex items-center gap-1.5 text-[13px] text-ok"><ShieldCheck size={15} aria-hidden />On</span>
      : <span className="inline-flex items-center gap-1.5 text-[13px] text-muted"><ShieldOff size={15} aria-hidden />Off</span> },
    { key: 'login', header: 'Last sign-in', cell: (m) => <span className="num whitespace-nowrap text-text-2" title={m.lastLoginAt ? new Date(m.lastLoginAt).toLocaleString() : undefined}>{m.lastLoginAt ? ago(m.lastLoginAt) : 'Never'}</span> },
  ];

  return (
    <>
      <PageHeader eyebrow="People & devices" title="Operators"
        subtitle="Everyone with access to this organization: their role, which sites they can see and what they are working on."
        actions={canInvite ? <Button variant="primary" icon={<UserPlus size={16} aria-hidden />} onClick={() => setInviteOpen(true)}>Invite people</Button> : undefined} />
      {!allowed ? <NoAccess what="members" /> : (
        <QueryView q={q} loading={<Skeleton className="h-[420px] rounded-[24px]" />}>
          {(data) => {
            const needle = query.trim().toLowerCase();
            const rows = data.members
              .filter((m) => status === 'all' || (status === 'active' ? m.status !== 'deactivated' : m.status === 'deactivated'))
              .filter((m) => !needle || `${m.name} ${m.email} ${ROLE_LABELS[m.role]}`.toLowerCase().includes(needle));
            const active = data.members.filter((m) => m.status === 'active');
            return (
              <div className="grid gap-4 fade-in">
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <Stat label="Active members" value={active.length} />
                  <Stat label="Wearing glasses" value={active.filter((m) => m.devices > 0).length} />
                  <Stat label="MFA enabled" value={`${active.length ? Math.round((active.filter((m) => m.mfaEnabled).length / active.length) * 100) : 0}%`} />
                  <Stat label="Pending invitations" value={data.invitations.length} />
                </div>
                <Card>
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <Capsule label="Member status" value={status} onChange={setStatus} options={[
                      { value: 'active', label: 'Current', count: data.members.filter((m) => m.status !== 'deactivated').length },
                      { value: 'deactivated', label: 'Deactivated', count: data.members.filter((m) => m.status === 'deactivated').length },
                      { value: 'all', label: 'All' },
                    ]} />
                    <div className="relative w-full sm:w-72">
                      <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
                      <input className="input input-search" placeholder="Search name, email or role" aria-label="Search members" value={query} onChange={(e) => setQuery(e.target.value)} />
                    </div>
                  </div>
                  <DataTable rows={rows} columns={columns} rowKey={(m) => m.userId} onRowClick={(m) => router.push(`/console/operators/${m.userId}`)}
                    empty={<EmptyState title={needle ? 'No one matches that search' : 'No members in this list'} />} />
                </Card>

                {(data.invitations.length > 0 || canInvite) && (
                  <Card title="Pending invitations" action={<span className="t-label num">{data.invitations.length}</span>}>
                    {data.invitations.length ? (
                      <ul className="grid gap-2">
                        {data.invitations.map((i) => {
                          const expired = new Date(i.expiresAt).getTime() < Date.now();
                          return (
                            <li key={i.id} className="card-inset flex flex-wrap items-center gap-3 px-4 py-3">
                              <span className="grid h-9 w-9 flex-none place-items-center rounded-full border border-dashed border-line-2 text-muted"><Mail size={15} aria-hidden /></span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm">{i.name ? `${i.name} · ` : ''}{i.email}</span>
                                <span className="block text-xs text-muted num">{ROLE_LABELS[i.role]} · invited {fmtDate(i.createdAt)} · {expired ? <span className="text-high">expired</span> : `expires ${fmtDateTime(i.expiresAt)}`}</span>
                              </span>
                              {can('member.manage') && <IconButton label={`Revoke invitation for ${i.email}`} size="sm" tone="ghost" onClick={() => setRevoke(i)}><X size={16} aria-hidden /></IconButton>}
                            </li>
                          );
                        })}
                      </ul>
                    ) : <p className="text-sm text-muted">No open invitations. Invited people appear here until they accept.</p>}
                  </Card>
                )}
                {inviteOpen && <InviteDialog roles={data.assignableRoles} sites={sites.data?.sites ?? []} onClose={() => setInviteOpen(false)} />}
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

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="card card-tight flex items-end justify-between gap-3">
      <span className="text-sm text-text-2">{label}</span>
      <span className="t-kpi-sm num">{value}</span>
    </div>
  );
}

function InviteDialog({ roles, sites, onClose }: { roles: Role[]; sites: Site[]; onClose: () => void }) {
  const s = useSession();
  const orgWide = s.siteScope === 'all';
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>(roles.includes('field_operator') ? 'field_operator' : roles[0]!);
  const [access, setAccess] = useState<{ allSites: boolean; siteIds: string[] }>({ allSites: orgWide, siteIds: [] });
  const [link, setLink] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const act = useAction((v: { email: string; name?: string; role: Role; allSites: boolean; siteIds: string[] }) => post<{ invitationLink: string }>('/invitations', v), {
    invalidate: ['/members'], success: 'Invitation created', onSuccess: (r) => setLink(r.invitationLink),
  });
  const emailErr = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? 'Enter a valid email address' : null;
  const sitesErr = !access.allSites && !access.siteIds.length;
  const submit = () => {
    setTouched(true);
    if (emailErr || sitesErr) return;
    act.mutate({ email: email.trim(), name: name.trim() || undefined, role, allSites: access.allSites, siteIds: access.allSites ? [] : access.siteIds });
  };
  const reset = () => { setLink(null); setEmail(''); setName(''); setTouched(false); };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={link ? 'Invitation ready' : 'Invite people'} wide
      description={link ? `${email} has been emailed an invitation. You can also share this link directly; it is single-use and expires in 7 days.` : 'Invited people choose their own password when they accept. Their role and site access apply from the first sign-in.'}
      footer={link ? <>
        <Button variant="ghost" onClick={reset}>Invite someone else</Button>
        <Button variant="primary" onClick={onClose}>Done</Button>
      </> : <>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" busy={act.isPending} onClick={submit}>Send invitation</Button>
      </>}>
      {link ? (
        <div className="grid gap-3">
          <CopyField label="Invitation link" value={link} mono />
          <p className="text-xs text-muted">Treat this link like a password: anyone who opens it can join as {ROLE_LABELS[role]}. Revoke it from Pending invitations if it was shared by mistake.</p>
        </div>
      ) : (
        <form className="grid gap-5" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} error={touched ? emailErr : null} autoFocus required />
            <Input label="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </div>
          <Select label="Role" value={role} onChange={(e) => setRole(e.target.value as Role)} options={roles.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
            hint={roles.length < 6 ? 'You can only grant roles below your own.' : undefined} />
          <SiteAccessPicker sites={sites} allSites={access.allSites} siteIds={access.siteIds} onChange={setAccess} allowAllSites={orgWide} />
          {touched && sitesErr && <p className="field-error" role="alert">Select at least one site.</p>}
        </form>
      )}
    </Dialog>
  );
}
