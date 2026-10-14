'use client';

import { useEffect, useState } from 'react';
import { MAINTENANCE_PRIORITIES, type AlarmSeverity, type MaintenancePriority } from '@hydris/domain';
import { post } from '@/lib/api';
import { useAction } from '@/lib/query';
import { label } from '@/lib/format';
import { Button, Input, Select, Textarea } from '@/ui';
import { Dialog } from '@/ui/overlay';
import type { AlarmDetailResponse, Member } from './types';

export function AssignDialog({ open, onOpenChange, alarmId, currentId, members, meId }: {
  open: boolean; onOpenChange: (v: boolean) => void; alarmId: string; currentId: string | null; members: Member[]; meId: string;
}) {
  const [userId, setUserId] = useState(currentId ?? '');
  const [note, setNote] = useState('');
  useEffect(() => { if (open) { setUserId(currentId ?? ''); setNote(''); } }, [open, currentId]);
  const act = useAction((v: { userId: string | null; note?: string }) => post(`/alarms/${alarmId}/assign`, v), {
    invalidate: ['/alarms', '/overview'], success: (userId === '' ? 'Alarm unassigned' : 'Alarm assigned'), onSuccess: () => onOpenChange(false),
  });
  const active = members.filter((m) => m.status === 'active');
  const unchanged = (userId || null) === currentId;
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!act.isPending) onOpenChange(v); }} title="Assign alarm"
      description="The assignee is notified and sees the alarm under “Assigned to me”."
      footer={<>
        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={act.isPending}>Cancel</Button>
        <Button variant="primary" busy={act.isPending} disabled={unchanged} onClick={() => act.mutate({ userId: userId || null, note: note.trim() || undefined })}>{userId ? 'Assign' : 'Remove assignee'}</Button>
      </>}>
      <div className="grid gap-4">
        <Select label="Assignee" value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="Unassigned"
          options={active.map((m) => ({ value: m.userId, label: `${m.name}${m.userId === meId ? ' (you)' : ''} · ${label(m.role)}` }))} />
        <Textarea label="Note for the assignee (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      </div>
    </Dialog>
  );
}

const PRIORITY_FOR: Record<AlarmSeverity, MaintenancePriority> = { critical: 'urgent', high: 'high', medium: 'medium', low: 'low' };

export function FollowUpDialog({ open, onOpenChange, alarm, onCreated }: {
  open: boolean; onOpenChange: (v: boolean) => void; alarm: AlarmDetailResponse['alarm']; onCreated?: (taskId: string) => void;
}) {
  const initial = () => ({
    title: `Follow-up: ${alarm.title}`.slice(0, 160),
    description: [alarm.description, alarm.recommendedAction ? `Recommended action: ${alarm.recommendedAction}` : null].filter(Boolean).join('\n\n'),
    priority: PRIORITY_FOR[alarm.severity],
  });
  const [f, setF] = useState(initial);
  // Re-seed the form each time the dialog opens (alarm text may have changed meanwhile).
  const [seededFor, setSeededFor] = useState(false);
  if (open !== seededFor) {
    setSeededFor(open);
    if (open) setF(initial());
  }
  const act = useAction((v: typeof f) => post<{ task: { id: string } }>('/maintenance', {
    title: v.title.trim(), description: v.description.trim() || null, priority: v.priority, sourceAlarmId: alarm.id,
    ...(alarm.assetId ? { assetId: alarm.assetId } : { siteId: alarm.siteId }),
  }), { invalidate: [`/alarms/${alarm.id}`, '/maintenance', '/overview'], success: 'Follow-up maintenance created', onSuccess: (r) => { onOpenChange(false); onCreated?.(r.task.id); } });
  const titleErr = f.title.trim().length < 3 ? 'At least 3 characters' : null;
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!act.isPending) onOpenChange(v); }} title="Create follow-up maintenance"
      description={<>Raises a corrective task linked to this alarm{alarm.assetTag ? <> on <b>{alarm.assetTag}</b></> : null}. Planners assign it from Maintenance.</>}
      footer={<>
        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={act.isPending}>Cancel</Button>
        <Button variant="primary" busy={act.isPending} disabled={!!titleErr} onClick={() => act.mutate(f)}>Create task</Button>
      </>}>
      <div className="grid gap-4">
        <Input label="Title" value={f.title} maxLength={160} required onChange={(e) => setF({ ...f, title: e.target.value })} error={f.title && titleErr ? titleErr : null} />
        <Select label="Priority" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as MaintenancePriority })}
          options={MAINTENANCE_PRIORITIES.map((p) => ({ value: p, label: label(p) }))} hint="Pre-set from the alarm severity." />
        <Textarea label="Description" value={f.description} maxLength={4000} onChange={(e) => setF({ ...f, description: e.target.value })} />
      </div>
    </Dialog>
  );
}
