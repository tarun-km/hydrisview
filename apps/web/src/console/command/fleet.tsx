'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BatteryCharging, BatteryLow, BatteryMedium, ShieldCheck, UserRoundCog, XCircle } from 'lucide-react';
import { patch, post } from '@/lib/api';
import { invalidatePaths, useAction, useApi } from '@/lib/query';
import { ago } from '@/lib/format';
import { Avatar, Button, Card, Chip, IconButton, Select, Skeleton, Switch, Tooltip } from '@/ui';
import { ConfirmDialog, Dialog } from '@/ui/overlay';
import { DeviceKindChip, DeviceStateChip } from '@/console/admin/glasses';
import { LiveBadge, type LiveView } from '@/console/admin/live';
import type { DeviceRow, MembersResponse } from '@/console/admin/parts';
import type { FleetDevice, OrgSettings } from './types';

export function BatteryValue({ value, charging }: { value: number | null; charging?: boolean | null }) {
  if (value === null) return <span className="text-muted">—</span>;
  const Icon = charging ? BatteryCharging : value < 20 ? BatteryLow : BatteryMedium;
  return <span className={`inline-flex items-center gap-1.5 num ${value < 20 && !charging ? 'text-critical-text' : ''}`}><Icon size={15} aria-hidden />{Math.round(value)}%</span>;
}

/** Ownership view of the fleet: owner, battery, firmware, with reassign and revoke. */
export function OwnershipTable({ devices, fleet, live, canManage }: { devices: DeviceRow[]; fleet: Map<string, FleetDevice>; live: Map<string, LiveView>; canManage: boolean }) {
  const [reassign, setReassign] = useState<DeviceRow | null>(null);
  const [revoke, setRevoke] = useState<DeviceRow | null>(null);
  const qc = useQueryClient();
  return (
    <div className="card">
      <div className="-mx-2 overflow-x-auto px-2">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Device</th><th scope="col">Owner</th><th scope="col">Site</th><th scope="col">Battery</th><th scope="col">Firmware / app</th><th scope="col">Last seen</th><th scope="col">State</th>
              {canManage && <th scope="col" className="text-right"><span className="sr-only">Actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {devices.map((d) => {
              const f = fleet.get(d.id);
              const lv = live.get(d.id);
              return (
                <tr key={d.id}>
                  <td>
                    <Link href={`/console/devices/${d.id}`} className="flex min-w-[180px] items-center gap-3 hover:underline">
                      <span className="min-w-0"><span className="block truncate font-medium">{d.name}</span><span className="block truncate text-xs text-muted">{d.model ?? (d.kind === 'simulator' ? 'Browser simulator' : 'Model not reported')}</span></span>
                    </Link>
                  </td>
                  <td>
                    {d.assignee ? (
                      <Link href={`/console/operators/${d.assignee.id}`} className="flex items-center gap-2 whitespace-nowrap hover:underline"><Avatar name={d.assignee.name ?? '?'} size={26} />{d.assignee.name}</Link>
                    ) : <Chip tone="outline">Unassigned</Chip>}
                  </td>
                  <td className="whitespace-nowrap text-text-2">{d.siteName ?? '—'}</td>
                  <td><BatteryValue value={f?.battery ?? lv?.battery ?? null} charging={f?.charging ?? lv?.charging} /></td>
                  <td className="whitespace-nowrap text-text-2 num">{d.firmwareVersion ?? '—'}{d.appVersion ? <span className="text-muted"> · app {d.appVersion}</span> : null}</td>
                  <td className="whitespace-nowrap text-text-2 num">{lv?.live ? <LiveBadge live /> : d.lastSeenAt ? ago(d.lastSeenAt) : 'Never'}</td>
                  <td><span className="flex items-center gap-1.5"><DeviceStateChip state={d.state} /><DeviceKindChip kind={d.kind} /></span></td>
                  {canManage && (
                    <td className="text-right">
                      {d.status !== 'revoked' && (
                        <span className="inline-flex gap-1">
                          {d.status === 'active' && <Tooltip label="Reassign"><IconButton label={`Reassign ${d.name}`} size="sm" tone="ghost" onClick={() => setReassign(d)}><UserRoundCog size={16} aria-hidden /></IconButton></Tooltip>}
                          <Tooltip label="Revoke"><IconButton label={`Revoke ${d.name}`} size="sm" tone="ghost" onClick={() => setRevoke(d)}><XCircle size={16} aria-hidden /></IconButton></Tooltip>
                        </span>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {reassign && <ReassignDialog device={reassign} onClose={() => setReassign(null)} />}
      <ConfirmDialog open={!!revoke} onOpenChange={(v) => !v && setRevoke(null)} destructive title={`Revoke ${revoke?.name ?? ''}?`} noteLabel="Reason" noteRequired
        body="The glasses are signed out immediately, unassigned from their operator and must be registered again before anyone can use them."
        confirmLabel="Revoke glasses" onConfirm={async (reason) => { await post(`/devices/${revoke!.id}/revoke`, { reason }); invalidatePaths(qc, ['/devices', '/command', '/members']); }} />
    </div>
  );
}

function ReassignDialog({ device, onClose }: { device: DeviceRow; onClose: () => void }) {
  const members = useApi<MembersResponse>('/members');
  const [userId, setUserId] = useState('');
  const [reason, setReason] = useState('');
  const act = useAction((v: { userId: string; reason?: string }) => post(`/devices/${device.id}/assign`, v), {
    invalidate: ['/devices', '/command', '/members'], success: 'Glasses reassigned', onSuccess: onClose,
  });
  const options = (members.data?.members ?? []).filter((m) => m.status === 'active' && m.userId !== device.assignee?.id)
    .sort((a, b) => Number(b.role === 'operator') - Number(a.role === 'operator') || a.name.localeCompare(b.name))
    .map((m) => ({ value: m.userId, label: `${m.name}${m.shiftLabel ? ` · ${m.shiftLabel}` : ''}${m.role === 'admin' ? ' · Administrator' : ''}` }));
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={`Reassign ${device.name}`}
      description={device.assignee?.name ? `Currently worn by ${device.assignee.name}. The glasses sign out and reconnect as the new owner.` : 'The glasses sign out and reconnect as the new owner.'}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" busy={act.isPending} disabled={!userId} onClick={() => act.mutate({ userId, reason: reason.trim() || undefined })}>Reassign</Button>
      </>}>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
        {!members.data ? <Skeleton className="h-12" /> : <Select label="New owner" value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="Choose an operator" options={options} />}
        <div className="field">
          <label htmlFor="reassign-reason">Reason <span className="font-normal text-muted">(optional)</span></label>
          <input id="reassign-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="e.g. shift handover" />
        </div>
      </div>
    </Dialog>
  );
}

/** Organization policy for new glasses (stored in org settings; used by glasses auto-registration). */
export function DevicePolicyCard() {
  const q = useApi<{ settings: OrgSettings }>('/org/settings');
  const act = useAction((v: Partial<OrgSettings>) => patch<{ settings: OrgSettings }>('/org/settings', v), {
    invalidate: ['/org/settings', '/command/fleet'], success: (r) => (r.settings.requireDeviceApproval ? 'New glasses now need administrator approval' : 'New glasses are approved automatically'),
  });
  const on = q.data?.settings.requireDeviceApproval ?? false;
  return (
    <Card title="Device policy" action={<ShieldCheck size={18} className="text-muted" aria-hidden />}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-2xl">
          <p className="text-[15px]">Require administrator approval for new glasses</p>
          <p className="mt-1 text-sm text-text-2">
            Off (default): when an operator registers glasses from the Hydris Field app they can use them straight away. On: newly registered glasses wait here until an administrator approves them.
          </p>
        </div>
        {q.isLoading ? <Skeleton className="h-[26px] w-[46px] rounded-full" /> : (
          <Switch checked={on} disabled={act.isPending || q.isError} onChange={(v) => act.mutate({ requireDeviceApproval: v })} label={on ? 'On' : 'Off'} />
        )}
      </div>
      {q.isError && <p className="mt-3 text-xs text-critical-text">Could not load the policy.</p>}
    </Card>
  );
}
