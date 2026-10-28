'use client';

import { ArrowRightLeft, Check, Glasses, X } from 'lucide-react';
import { post } from '@/lib/api';
import { invalidatePaths, useAction, useApi } from '@/lib/query';
import { ago, fmtDateTime } from '@/lib/format';
import { Avatar, Button, Card, Chip } from '@/ui';

export interface PendingDevice {
  id: string; name: string; model: string | null; kind: 'hardware' | 'simulator'; siteName: string | null;
  pendingUserId: string; pendingSince: string | null; requesterName: string | null;
  currentOwner: { id: string; name: string } | null; transfer: boolean;
}

/**
 * Glasses waiting for an administrator (org policy "Require device approval"): first registrations
 * from Hydris Field (auto-claim / QR scan) and ownership transfers. Updates live via device.pending.
 */
export function PendingDevicesCard({ devices: given, compact = false }: { devices?: PendingDevice[]; compact?: boolean }) {
  const q = useApi<{ devices: PendingDevice[] }>(given ? null : '/devices/pending', { refetchInterval: 30_000 });
  const decide = useAction(({ id, decision }: { id: string; decision: 'approve' | 'deny' }) => post(`/devices/${id}/${decision}`, {}), {
    invalidate: ['/devices', '/command', '/overview'],
    success: 'Decision recorded',
  });
  const list = given ?? q.data?.devices ?? [];
  if (!list.length) return null;
  return (
    <Card className="border-high/40" data-testid="pending-devices">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="t-label">Glasses awaiting approval</div>
          {!compact && <p className="mt-1 text-[13px] text-text-2">Registered from Hydris Field while “Require device approval” is on. Approving signs the glasses in for the requester.</p>}
        </div>
        <Chip tone="outline">{list.length}</Chip>
      </div>
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
        {list.map((d) => (
          <li key={d.id} className="card-inset flex flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap">
            <span className="grid h-10 w-10 flex-none place-items-center rounded-full bg-surface-2 text-text-2">{d.transfer ? <ArrowRightLeft size={17} aria-hidden /> : <Glasses size={17} aria-hidden />}</span>
            <span className="min-w-0 flex-1 basis-[220px]">
              <span className="block truncate text-[15px] font-medium">{d.name}</span>
              <span className="block truncate text-xs text-muted">
                {d.transfer ? `Transfer from ${d.currentOwner?.name ?? 'current owner'}` : 'New registration'} · {d.model ?? (d.kind === 'simulator' ? 'Simulator' : 'Model not reported')} · {d.siteName ?? 'No site'}
              </span>
            </span>
            <span className="flex flex-none items-center gap-2 text-[13px] text-text-2">{d.requesterName && <Avatar name={d.requesterName} size={24} />}<span className="max-w-[140px] truncate">{d.requesterName ?? 'Member'}</span></span>
            <span className="num w-[90px] flex-none text-right text-[13px] text-muted" title={d.pendingSince ? fmtDateTime(d.pendingSince) : undefined}>{d.pendingSince ? ago(d.pendingSince) : '—'}</span>
            <span className="flex flex-none gap-1.5">
              <Button size="sm" variant="primary" icon={<Check size={14} aria-hidden />} disabled={decide.isPending} onClick={() => decide.mutate({ id: d.id, decision: 'approve' })}>Approve</Button>
              <Button size="sm" variant="ghost" icon={<X size={14} aria-hidden />} disabled={decide.isPending} onClick={() => decide.mutate({ id: d.id, decision: 'deny' })}>Deny</Button>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
