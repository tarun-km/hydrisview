'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, BatteryWarning, ChevronLeft, Monitor, Pause, Pencil, Play, Radio, Search, ShieldOff, UserRoundCog } from 'lucide-react';
import { ROLE_LABELS } from '@hydris/domain';
import { patch, post } from '@/lib/api';
import { invalidatePaths, useAction, useApi } from '@/lib/query';
import { useCan } from '@/lib/session';
import { ago, fmtDateTime } from '@/lib/format';
import { Avatar, Button, Card, Chip, EmptyState, Input, KeyValues, QueryView, Select, Skeleton, Timeline, cx } from '@/ui';
import { ConfirmDialog, Dialog } from '@/ui/overlay';
import { DEVICE_STATE_COLOR, DeviceKindChip, DeviceStateChip, GlassesArt } from '@/console/admin/glasses';
import { NoAccess, useSites, type DeviceRow, type MembersResponse, type MemberRow } from '@/console/admin/parts';

interface Detail {
  device: DeviceRow;
  assignments: { id: string; userId: string; name: string; assignedBy: string | null; assignedAt: string; unassignedAt: string | null; reason: string | null }[];
  activeSessions: { id: string; createdAt: string; lastUsedAt: string | null; expiresAt: string }[];
  events: { action: string; at: string; summary: string | null; actorUserId: string | null; actorName: string | null }[];
  diagnostics: { lastSeenAt: string | null; lastIp: string | null; streamOpen: boolean; appVersion: string | null; firmwareVersion: string | null; display: { width: number; height: number } | null; battery: null; batteryNote: string };
  canManage: boolean;
}

type Confirm = null | 'suspend' | 'reactivate' | 'revoke';

export default function DeviceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const can = useCan();
  const allowed = can('device.read');
  const path = `/devices/${id}`;
  const q = useApi<Detail>(allowed ? path : null, { refetchInterval: 15_000 });
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [reassign, setReassign] = useState(false);
  const [edit, setEdit] = useState(false);

  const lifecycle = async (action: Exclude<Confirm, null>, reason: string) => {
    await post(`/devices/${id}/${action}`, reason ? { reason } : {});
    invalidatePaths(qc, ['/devices', '/overview', '/members']);
  };

  return (
    <>
      <Link href="/console/devices" className="mb-4 inline-flex items-center gap-1.5 text-sm text-text-2 hover:text-text"><ChevronLeft size={16} aria-hidden />Field glasses</Link>
      {!allowed ? <NoAccess what="field glasses" /> : (
        <QueryView q={q} loading={<DetailSkeleton />}>
          {(data) => {
            const d = data.device;
            const manage = data.canManage && d.status !== 'revoked';
            return (
              <div className="grid gap-4 fade-in">
                <Hero data={data} manage={manage} onEdit={() => setEdit(true)} onConfirm={setConfirm} />

                {d.status === 'revoked' && (
                  <div role="status" className="flex items-start gap-3 rounded-[var(--radius-xl)] border border-[rgb(255_90_78/0.3)] bg-[rgb(255_90_78/0.06)] p-5">
                    <ShieldOff className="mt-0.5 flex-none text-critical" size={18} aria-hidden />
                    <div className="text-sm">
                      <div className="font-medium">Revoked {fmtDateTime(d.revokedAt)}</div>
                      <div className="mt-1 text-text-2">Reason: {d.revokeReason ?? 'not recorded'}. These glasses can no longer sign in. Pair them again to bring them back into service.</div>
                    </div>
                  </div>
                )}

                <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
                  <AssignmentCard data={data} onReassign={() => setReassign(true)} />
                  <Diagnostics data={data} />
                </div>

                <div className="grid gap-4 lg:grid-cols-3">
                  <Card title="Assignment history" action={<span className="t-label num">{data.assignments.length}</span>}>
                    <Timeline items={data.assignments.map((a) => ({
                      id: a.id,
                      title: <Link href={`/console/operators/${a.userId}`} className="hover:underline">{a.name}</Link>,
                      meta: <span className="num">{fmtDateTime(a.assignedAt)} → {a.unassignedAt ? fmtDateTime(a.unassignedAt) : 'now'}</span>,
                      body: a.reason ?? undefined,
                      tone: a.unassignedAt ? 'muted' : 'cobalt',
                    }))} />
                  </Card>
                  <Card title="Active sessions" action={<span className="t-label num">{data.activeSessions.length}</span>}>
                    {data.activeSessions.length ? (
                      <ul className="grid gap-2">
                        {data.activeSessions.map((s) => (
                          <li key={s.id} className="card-inset px-4 py-3 text-sm">
                            <div className="flex items-center justify-between gap-2"><span>Device session</span><span className="font-mono text-xs text-muted">{s.id.slice(0, 8)}</span></div>
                            <div className="mt-1 text-xs text-muted num">Started {fmtDateTime(s.createdAt)} · last refresh {s.lastUsedAt ? ago(s.lastUsedAt) : 'not yet'} · expires {fmtDateTime(s.expiresAt)}</div>
                          </li>
                        ))}
                      </ul>
                    ) : <p className="text-sm text-muted">No active device sessions. The glasses must be paired again before they can sign in.</p>}
                    <p className="mt-4 text-xs text-muted">Suspending, reassigning or revoking invalidates outstanding device tokens immediately.</p>
                  </Card>
                  <Card title="Device events" action={<Link href={`/console/audit`} className="text-sm text-text-2 hover:text-text">Audit log</Link>}>
                    <Timeline items={data.events.map((e, i) => ({
                      id: `${e.at}-${i}`,
                      title: eventTitle(e.action),
                      meta: <>{e.actorName ?? 'Hydris'} · <time dateTime={e.at} title={new Date(e.at).toLocaleString()}>{ago(e.at)}</time></>,
                      tone: e.action.includes('revoked') ? 'critical' : e.action.includes('suspended') ? 'muted' : e.action.includes('paired') || e.action.includes('reactivated') ? 'lime' : e.action.includes('reassigned') ? 'cobalt' : 'muted',
                    }))} />
                  </Card>
                </div>

                <ConfirmDialog open={confirm === 'suspend'} onOpenChange={(v) => !v && setConfirm(null)} title={`Suspend ${d.name}?`}
                  body={<>The glasses are signed out within seconds and cannot be used until reactivated. The operator assignment and pairing are kept, so reactivation needs no re-pairing.</>}
                  confirmLabel="Suspend glasses" noteLabel="Reason" onConfirm={(note) => lifecycle('suspend', note)} />
                <ConfirmDialog open={confirm === 'reactivate'} onOpenChange={(v) => !v && setConfirm(null)} title={`Reactivate ${d.name}?`}
                  body={<>{d.assignee ? `${d.assignee.name} can sign in on these glasses again` : 'The glasses can sign in again'} as soon as they reconnect.</>}
                  confirmLabel="Reactivate glasses" noteLabel="Reason" onConfirm={(note) => lifecycle('reactivate', note)} />
                <ConfirmDialog open={confirm === 'revoke'} onOpenChange={(v) => !v && setConfirm(null)} title={`Revoke ${d.name}?`} destructive noteRequired
                  body={<>Revocation is permanent. Every device session ends immediately, {d.assignee ? `${d.assignee.name} is unassigned` : 'any assignment is released'}, and the glasses must be paired again from scratch before anyone can use them. Use suspend for a temporary block.</>}
                  confirmLabel="Revoke glasses" noteLabel="Reason for revocation" onConfirm={(note) => lifecycle('revoke', note)} />
                {reassign && <ReassignDialog device={d} onClose={() => setReassign(false)} />}
                {edit && <EditDialog device={d} onClose={() => setEdit(false)} />}
              </div>
            );
          }}
        </QueryView>
      )}
    </>
  );
}

function Hero({ data, manage, onEdit, onConfirm }: { data: Detail; manage: boolean; onEdit: () => void; onConfirm: (c: Confirm) => void }) {
  const d = data.device;
  const glow = DEVICE_STATE_COLOR[d.state];
  const connection = d.streamOpen ? 'Live stream open' : d.lastSeenAt ? `Seen ${ago(d.lastSeenAt)}` : 'Never connected';
  const display = data.diagnostics.display;
  const pills = [
    { key: 'state', node: <DeviceStateChip state={d.state} /> },
    { key: 'conn', node: <span className="chip"><Radio size={13} className={d.streamOpen ? 'text-lime' : 'text-muted'} aria-hidden />{connection}</span> },
    { key: 'app', node: <span className="chip num">App {d.appVersion ?? 'unknown'}</span> },
    { key: 'disp', node: <span className="chip num"><Monitor size={13} aria-hidden />{display ? `${display.width}×${display.height}` : 'Display not reported'}</span> },
  ];
  return (
    <section className="card relative overflow-hidden p-0" aria-labelledby="device-name">
      <div className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(60% 70% at 70% 45%, color-mix(in srgb, ${glow} 14%, transparent), transparent 70%)` }} aria-hidden />
      <div className="relative grid gap-6 p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] lg:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><DeviceKindChip kind={d.kind} />{d.siteName && <Chip tone="outline">{d.siteName}</Chip>}</div>
          <h1 id="device-name" className="t-hero mt-4 break-words">{d.name}</h1>
          <p className="mt-2 text-text-2">{d.model ?? 'Model not reported'} · paired {fmtDateTime(d.pairedAt)}</p>
          {manage && (
            <div className="mt-6 flex flex-wrap gap-2">
              <Button size="sm" icon={<Pencil size={14} aria-hidden />} onClick={onEdit}>Rename or move</Button>
              {d.status === 'suspended'
                ? <Button size="sm" icon={<Play size={14} aria-hidden />} onClick={() => onConfirm('reactivate')}>Reactivate</Button>
                : <Button size="sm" icon={<Pause size={14} aria-hidden />} onClick={() => onConfirm('suspend')}>Suspend</Button>}
              <Button size="sm" variant="danger" icon={<ShieldOff size={14} aria-hidden />} onClick={() => onConfirm('revoke')}>Revoke</Button>
            </div>
          )}
        </div>
        <div className="relative">
          <GlassesArt state={d.state} className={cx('mx-auto w-full max-w-[560px]', (d.state === 'revoked' || d.state === 'suspended') && 'opacity-60 grayscale')} />
          {/* Floating status pills (stacked below the render on small screens) */}
          <ul className="mt-4 flex flex-wrap justify-center gap-2 lg:hidden">{pills.map((p) => <li key={p.key}>{p.node}</li>)}</ul>
          <div className="hidden lg:block">
            <div className="absolute left-[2%] top-[2%]">{pills[0]!.node}</div>
            <div className="absolute right-[2%] top-[0%]">{pills[1]!.node}</div>
            <div className="absolute bottom-[0%] left-[8%]">{pills[2]!.node}</div>
            <div className="absolute bottom-[4%] right-[6%]">{pills[3]!.node}</div>
          </div>
        </div>
      </div>
    </section>
  );
}

function AssignmentCard({ data, onReassign }: { data: Detail; onReassign: () => void }) {
  const d = data.device;
  const canReassign = data.canManage && d.status === 'active';
  return (
    <section className="card card-paper flex flex-col justify-between gap-6" aria-labelledby="assign-h">
      <div className="flex items-start justify-between gap-3">
        <h2 id="assign-h" className="text-[14px] opacity-75">Assigned operator</h2>
        {d.assignee && <Link href={`/console/operators/${d.assignee.id}`} className="text-sm underline-offset-4 hover:underline">Profile</Link>}
      </div>
      {d.assignee ? (
        <div className="flex items-center gap-4">
          <Avatar name={d.assignee.name ?? '?'} size={64} tone="cobalt" />
          <div className="min-w-0">
            <div className="t-kpi-sm truncate">{d.assignee.name}</div>
            <div className="muted mt-1 text-sm">Wearing since {fmtDateTime(d.assignee.since)}{d.assignee.since ? ` · ${ago(d.assignee.since).replace(' ago', '')}` : ''}</div>
          </div>
        </div>
      ) : (
        <div>
          <div className="t-kpi-sm">Unassigned</div>
          <p className="muted mt-1 text-sm">Glasses without an operator cannot sign in or receive work.</p>
        </div>
      )}
      {data.canManage && (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" icon={<UserRoundCog size={16} aria-hidden />} disabled={!canReassign} onClick={onReassign}>{d.assignee ? 'Reassign glasses' : 'Assign operator'}</Button>
          {!canReassign && <span className="muted text-xs">{d.status === 'revoked' ? 'Revoked glasses must be paired again.' : 'Reactivate the glasses before reassigning.'}</span>}
          {canReassign && <span className="muted text-xs">The current wearer is signed out of the glasses immediately.</span>}
        </div>
      )}
    </section>
  );
}

function Diagnostics({ data }: { data: Detail }) {
  const g = data.diagnostics;
  return (
    <Card title="Diagnostics" action={<span className="t-label">reported by the device</span>}>
      <KeyValues items={[
        ['Last seen', g.lastSeenAt ? <span className="num" title={new Date(g.lastSeenAt).toLocaleString()}>{fmtDateTime(g.lastSeenAt)} · {ago(g.lastSeenAt)}</span> : 'Never'],
        ['Realtime stream', g.streamOpen ? <span className="inline-flex items-center gap-1.5"><span className="dot pulse-dot bg-lime" aria-hidden />Open</span> : 'Closed'],
        ['Last IP address', g.lastIp ? <span className="font-mono text-[13px]">{g.lastIp}</span> : '—'],
        ['App version', g.appVersion ? <span className="num">{g.appVersion}</span> : 'Not reported'],
        ['Firmware', g.firmwareVersion ? <span className="num">{g.firmwareVersion}</span> : 'Not reported'],
        ['Display', g.display ? <span className="num">{g.display.width} × {g.display.height} px</span> : 'Not reported'],
      ]} />
      <div className="mt-5 flex items-start gap-3 rounded-2xl border border-dashed border-line-2 px-4 py-3 text-sm text-text-2">
        <BatteryWarning size={18} className="mt-0.5 flex-none text-muted" aria-hidden />
        <div><span className="text-text">Battery: not available.</span> {g.batteryNote}</div>
      </div>
    </Card>
  );
}

function ReassignDialog({ device, onClose }: { device: DeviceRow; onClose: () => void }) {
  const can = useCan();
  const members = useApi<MembersResponse>(can('member.read') ? '/members' : null);
  const [pick, setPick] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [query, setQuery] = useState('');
  const act = useAction((v: { userId: string; reason?: string }) => post(`/devices/${device.id}/assign`, v), {
    invalidate: ['/devices', '/members', '/overview'], success: 'Glasses reassigned', onSuccess: onClose,
  });
  const list = useMemo(() => (members.data?.members ?? [])
    .filter((m) => m.status === 'active' && m.role !== 'viewer')
    .filter((m) => !query.trim() || `${m.name} ${m.email}`.toLowerCase().includes(query.trim().toLowerCase())), [members.data, query]);
  const hasSite = (m: MemberRow) => m.allSites || !device.siteId || m.siteIds.includes(device.siteId);
  const chosen = list.find((m) => m.userId === pick);

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={device.assignee ? `Reassign ${device.name}` : `Assign ${device.name}`}
      description="Choose who wears these glasses. The previous wearer is signed out of the glasses and the handover is recorded in the audit log."
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" busy={act.isPending} disabled={!pick || pick === device.assignee?.id} onClick={() => act.mutate({ userId: pick!, reason: reason.trim() || undefined })}>Assign to {chosen?.name.split(' ')[0] ?? 'operator'}</Button>
      </>}>
      {!can('member.read') ? <p className="text-sm text-muted">Your role cannot list members.</p> : (
        <QueryView q={members}>
          {() => (
            <div className="grid gap-4">
              <div className="relative">
                <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
                <input className="input input-search" placeholder="Search people" aria-label="Search people" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              {list.length ? (
                <ul className="grid max-h-[320px] gap-1 overflow-y-auto" role="radiogroup" aria-label="Operator">
                  {list.map((m) => {
                    const current = device.assignee?.id === m.userId;
                    return (
                      <li key={m.userId}>
                        <label className={cx('flex cursor-pointer items-center gap-3 rounded-2xl border px-3 py-2.5', pick === m.userId ? 'border-cobalt bg-cobalt/10' : 'border-transparent hover:bg-surface-2')}>
                          <input type="radio" name="assignee" className="sr-only" checked={pick === m.userId} onChange={() => setPick(m.userId)} disabled={current} />
                          <Avatar name={m.name} size={34} tone={pick === m.userId ? 'cobalt' : 'surface'} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm">{m.name}{current && <span className="text-muted"> · current</span>}</span>
                            <span className="block truncate text-xs text-muted">{ROLE_LABELS[m.role]} · {m.devices} glasses assigned</span>
                          </span>
                          {!hasSite(m) && <Chip tone="medium" title="This person has no access to the site these glasses are registered to">No site access</Chip>}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              ) : <EmptyState title="No matching active members" />}
              {chosen && !hasSite(chosen) && (
                <p className="flex items-start gap-2 text-sm text-[#f7c96a]"><AlertTriangle size={16} className="mt-0.5 flex-none" aria-hidden />{chosen.name} has no access to {device.siteName ?? 'this site'}, so the glasses will show no work. Grant site access or move the glasses first.</p>
              )}
              <Input label="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="e.g. Shift handover" />
            </div>
          )}
        </QueryView>
      )}
    </Dialog>
  );
}

function EditDialog({ device, onClose }: { device: DeviceRow; onClose: () => void }) {
  const sites = useSites();
  const [name, setName] = useState(device.name);
  const [siteId, setSiteId] = useState(device.siteId ?? '');
  const act = useAction((v: { name?: string; siteId?: string }) => patch(`/devices/${device.id}`, v), { invalidate: ['/devices'], success: 'Glasses updated', onSuccess: onClose });
  const body: { name?: string; siteId?: string } = {};
  if (name.trim() !== device.name) body.name = name.trim();
  if (siteId && siteId !== device.siteId) body.siteId = siteId;
  const nameErr = name.trim().length < 2 ? 'Use at least 2 characters' : null;
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title="Rename or move glasses"
      description="Moving glasses to another site changes which work and alarms the wearer sees; the glasses refresh their context automatically."
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" busy={act.isPending} disabled={!!nameErr || !Object.keys(body).length} onClick={() => act.mutate(body)}>Save changes</Button>
      </>}>
      <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (!nameErr && Object.keys(body).length) act.mutate(body); }}>
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} error={name !== device.name ? nameErr : null} autoFocus />
        <Select label="Site" value={siteId} onChange={(e) => setSiteId(e.target.value)} placeholder={device.siteId ? undefined : 'Not set'}
          options={(sites.data?.sites ?? []).map((s) => ({ value: s.id, label: `${s.name} (${s.code})` }))} disabled={!sites.data} />
        {sites.isError && <p className="field-error">Could not load sites.</p>}
      </form>
    </Dialog>
  );
}

const EVENT_LABELS: Record<string, string> = {
  'device.paired': 'Paired', 'device.updated': 'Details updated', 'device.reassigned': 'Reassigned', 'device.suspended': 'Suspended',
  'device.reactivated': 'Reactivated', 'device.revoked': 'Revoked', 'device.refresh_reuse_detected': 'Token reuse detected, sessions ended',
};
const eventTitle = (a: string) => EVENT_LABELS[a] ?? a.replace(/^device\./, '').replace(/[._]/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

function DetailSkeleton() {
  return (
    <div className="grid gap-4">
      <Skeleton className="h-[340px] rounded-[24px]" />
      <div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-[240px] rounded-[24px]" /><Skeleton className="h-[240px] rounded-[24px]" /></div>
    </div>
  );
}
