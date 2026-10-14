'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowLeft, Ban, Check, CheckCircle2, Info, Pause, Pencil, Play, RotateCcw, Send } from 'lucide-react';
import { MAINTENANCE_STATUS_LABELS, MAINTENANCE_TRANSITIONS, canTransitionMaintenance, type MaintenanceAction } from '@hydris/domain';
import { post } from '@/lib/api';
import { invalidatePaths, useApi } from '@/lib/query';
import { useCan, useSession } from '@/lib/session';
import { ago, fmtDateTime, label as humanize, until } from '@/lib/format';
import { Button, Card, Chip, ErrorState, KeyValues, PageHeader, Skeleton, StateChip, SyntheticBadge, Timeline } from '@/ui';
import { ConfirmDialog, useToast } from '@/ui/overlay';
import { AttachmentList, UploadButton } from '@/console/work/attachments';
import { EditTaskDialog, NO_ACTUATION } from '@/console/work/maintenance-forms';
import { ConflictBanner, FormError, describeError, isConflict, isOverdue, type MaintenanceDetailResponse } from '@/console/work/shared';

const ACTION_META: Record<MaintenanceAction, { label: string; icon: ReactNode; variant: 'primary' | 'secondary' | 'ghost' | 'danger' }> = {
  start: { label: 'Start work', icon: <Play size={16} />, variant: 'primary' },
  hold: { label: 'Put on hold', icon: <Pause size={16} />, variant: 'secondary' },
  complete: { label: 'Mark complete', icon: <CheckCircle2 size={16} />, variant: 'primary' },
  cancel: { label: 'Cancel task', icon: <Ban size={16} />, variant: 'ghost' },
  reopen: { label: 'Reopen', icon: <RotateCcw size={16} />, variant: 'secondary' },
};
const EXECUTOR_ACTIONS: MaintenanceAction[] = ['start', 'hold', 'complete'];
const OPEN = ['open', 'assigned', 'in_progress', 'on_hold'];

const ACTIVITY: Record<string, { title: string; tone: 'lime' | 'critical' | 'ok' | 'muted' | 'cobalt' }> = {
  created: { title: 'Request created', tone: 'muted' }, assigned: { title: 'Assignment changed', tone: 'cobalt' }, updated: { title: 'Details updated', tone: 'muted' },
  checklist_done: { title: 'Checklist item done', tone: 'ok' }, checklist_undone: { title: 'Checklist item reopened', tone: 'muted' }, note: { title: 'Note', tone: 'muted' },
  start: { title: 'Work started', tone: 'cobalt' }, hold: { title: 'Put on hold', tone: 'muted' }, complete: { title: 'Completed', tone: 'ok' },
  cancel: { title: 'Cancelled', tone: 'critical' }, reopen: { title: 'Reopened', tone: 'lime' },
};

export default function MaintenanceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const path = `/maintenance/${id}`;
  const q = useApi<MaintenanceDetailResponse>(path);
  const session = useSession();
  const can = useCan();
  const qc = useQueryClient();
  const toast = useToast();
  const [conflict, setConflict] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<MaintenanceAction | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [noteErr, setNoteErr] = useState<unknown>(null);

  const refresh = async () => {
    await q.refetch();
    invalidatePaths(qc, ['/maintenance', '/overview', '/assets/']);
  };
  const guard = async <T,>(fn: () => Promise<T>) => {
    try {
      return await fn();
    } catch (e) {
      if (isConflict(e)) setConflict(describeError(e));
      throw e;
    }
  };

  if (q.isError && !q.data) return <><BackLink /><ErrorState error={q.error} onRetry={() => void q.refetch()} /></>;
  if (!q.data) {
    return (
      <div className="grid gap-4" role="status" aria-label="Loading task">
        <Skeleton className="h-5 w-40" /><Skeleton className="h-12 w-2/3 max-w-xl" />
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]"><Skeleton className="h-[320px] rounded-[24px]" /><Skeleton className="h-[320px] rounded-[24px]" /></div>
      </div>
    );
  }

  const { task: t, activity, permissions } = q.data;
  const isOpen = OPEN.includes(t.status);
  const me = session.user.id;
  const canToggle = isOpen && (permissions.manage || t.assignedTo === me);
  const canNote = permissions.manage || t.assignedTo === me || t.requestedBy === me;
  const actions = (Object.keys(MAINTENANCE_TRANSITIONS) as MaintenanceAction[])
    .filter((a) => canTransitionMaintenance(t.status, a))
    .filter((a) => permissions.manage || (permissions.execute && EXECUTOR_ACTIONS.includes(a)));
  const doneCount = t.checklist.filter((c) => c.done).length;
  const checklistOpen = t.checklist.length - doneCount;

  const transition = (action: MaintenanceAction, n?: string) => guard(async () => {
    await post(`${path}/${action}`, n ? { note: n } : {});
    await refresh();
  });

  const runQuick = async (action: MaintenanceAction) => {
    if (action !== 'start') return setConfirm(action);
    setBusy(action);
    try {
      await transition(action);
      toast({ title: 'Work started', tone: 'ok' });
    } catch (e) {
      if (!isConflict(e)) toast({ title: 'Could not start', body: describeError(e), tone: 'critical' });
    } finally {
      setBusy(null);
    }
  };

  const toggle = async (itemId: string, done: boolean) => {
    setBusy(`c-${itemId}`);
    try {
      await guard(() => post(`${path}/checklist/${itemId}`, { done }));
      await refresh();
    } catch (e) {
      if (!isConflict(e)) toast({ title: 'Checklist not updated', body: describeError(e), tone: 'critical' });
    } finally {
      setBusy(null);
    }
  };

  const addNote = async () => {
    if (!note.trim()) return;
    setBusy('note');
    setNoteErr(null);
    try {
      await post(`${path}/notes`, { note: note.trim() });
      setNote('');
      await q.refetch();
    } catch (e) {
      setNoteErr(e);
    } finally {
      setBusy(null);
    }
  };

  const late = isOverdue(t.dueAt, isOpen);

  return (
    <>
      <BackLink />
      <PageHeader eyebrow={`Maintenance · ${humanize(t.kind)}`} title={t.title}
        actions={<>
          {actions.map((a) => (
            <Button key={a} variant={a === 'cancel' ? 'ghost' : ACTION_META[a].variant} icon={ACTION_META[a].icon} busy={busy === a}
              disabled={a === 'complete' && checklistOpen > 0} title={a === 'complete' && checklistOpen > 0 ? 'Tick every checklist item first' : undefined}
              onClick={() => void runQuick(a)}>{ACTION_META[a].label}</Button>
          ))}
          {permissions.manage && isOpen && <Button icon={<Pencil size={16} />} onClick={() => setEditOpen(true)}>Edit</Button>}
        </>}>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <StateChip state={t.status} label={MAINTENANCE_STATUS_LABELS[t.status]} />
          <StateChip state={t.priority} label={`${humanize(t.priority)} priority`} />
          {late && <Chip tone="high">{until(t.dueAt)}</Chip>}
          {t.synthetic && <SyntheticBadge />}
          {t.asset && <Link href={`/console/assets/${t.asset.id}`} className="chip chip-cobalt hover:brightness-125">{t.asset.tag} · {t.asset.name}</Link>}
        </div>
      </PageHeader>

      <div role="note" className="mb-4 flex items-start gap-3 rounded-[var(--radius-xl)] border border-[rgb(59_123_255/0.35)] bg-[rgb(59_123_255/0.07)] p-4 text-sm text-text-2">
        <Info size={17} className="mt-0.5 flex-none text-cobalt" aria-hidden /><span>{NO_ACTUATION}</span>
      </div>

      {conflict && <ConflictBanner message={conflict} busy={q.isFetching} onReload={() => { setConflict(null); void refresh(); }} />}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid min-w-0 content-start gap-4">
          <Card title="Description">
            {t.description ? <p className="whitespace-pre-line text-[15px] leading-relaxed text-text-2">{t.description}</p> : <p className="text-sm text-muted">No description provided.</p>}
          </Card>

          {t.status === 'completed' && t.completionNote && (
            <section className="card card-paper" aria-label="Completion record">
              <div className="flex items-center gap-2 text-sm opacity-75"><CheckCircle2 size={16} aria-hidden />Completed {fmtDateTime(t.completedAt)}</div>
              <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed">{t.completionNote}</p>
            </section>
          )}

          <Card title={<h2 className="t-card">Checklist {t.checklist.length > 0 && <span className="num text-muted">· {doneCount}/{t.checklist.length}</span>}</h2>}
            action={!canToggle && t.checklist.length > 0 && isOpen ? <span className="text-xs text-muted">Only the assignee or a planner can tick items</span> : undefined}>
            {t.checklist.length ? (
              <ul className="grid gap-2">
                {t.checklist.map((c) => (
                  <li key={c.id}>
                    <button type="button" role="checkbox" aria-checked={c.done} disabled={!canToggle || busy === `c-${c.id}`} onClick={() => void toggle(c.id, !c.done)}
                      className={clsx('flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors', c.done ? 'border-[rgb(78_217_142/0.3)] bg-[rgb(78_217_142/0.06)]' : 'border-line bg-bg-2', canToggle && 'hover:border-line-2', !canToggle && 'cursor-default')}>
                      <span className={clsx('grid h-6 w-6 flex-none place-items-center rounded-lg border', c.done ? 'border-transparent bg-ok text-ink' : 'border-line-2')}>{c.done && <Check size={15} aria-hidden />}</span>
                      <span className={clsx('min-w-0 flex-1 text-sm', c.done && 'text-text-2 line-through decoration-text-2/40')}>{c.label}</span>
                      {c.done && c.doneAt && <span className="text-xs text-muted num">{ago(c.doneAt)}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted">No checklist for this task.</p>}
          </Card>

          <Card title="Activity">
            {canNote && (
              <div className="mb-5 grid gap-2">
                <label htmlFor="mnote" className="field-label">Add a note</label>
                <textarea id="mnote" className="textarea !min-h-[72px]" maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Parts ordered, findings, handover…" />
                <div className="flex items-center gap-3">
                  <Button size="sm" variant="primary" icon={<Send size={14} />} busy={busy === 'note'} disabled={!note.trim()} onClick={() => void addNote()}>Add note</Button>
                  <span className="text-xs text-muted num">{note.length}/2000</span>
                </div>
                <FormError error={noteErr} />
              </div>
            )}
            <Timeline items={[...activity].reverse().map((a) => ({
              id: a.id,
              title: <><span className="font-medium">{ACTIVITY[a.action]?.title ?? humanize(a.action)}</span>{a.action.startsWith('checklist') && a.note ? <span className="text-text-2"> · {a.note}</span> : null}</>,
              meta: `${a.actorName ?? 'Hydris'} · ${fmtDateTime(a.at)}`,
              body: a.note && !a.action.startsWith('checklist') && a.action !== 'assigned' ? <span className="whitespace-pre-line">{a.note}</span> : undefined,
              tone: ACTIVITY[a.action]?.tone ?? 'muted',
            }))} />
          </Card>
        </div>

        <aside className="grid content-start gap-4">
          <Card title="Details">
            <KeyValues columns={1} items={[
              ['Asset', t.asset ? <Link className="text-[#9ebcff] hover:underline" href={`/console/assets/${t.asset.id}`}>{t.asset.tag} · {t.asset.name}</Link> : 'No specific asset'],
              ['Assignee', t.assignee?.name ?? 'Unassigned'],
              ['Due', t.dueAt ? <span className="num">{fmtDateTime(t.dueAt)}{isOpen && <span className="text-muted"> · {until(t.dueAt)}</span>}</span> : 'No due date'],
              ['Created', <span key="c" className="num">{fmtDateTime(t.createdAt)}</span>],
              ['Started', <span key="s" className="num">{fmtDateTime(t.startedAt)}</span>],
              ['Completed', <span key="d" className="num">{fmtDateTime(t.completedAt)}</span>],
            ]} />
          </Card>
          {(t.sourceInspectionId || t.sourceAlarmId) && (
            <Card title="Raised from">
              <div className="grid gap-2">
                {t.sourceInspectionId && <Link href={`/console/inspections/${t.sourceInspectionId}`} className="flex items-center justify-between rounded-2xl bg-bg-2 px-4 py-3 text-sm hover:bg-surface-2">Source inspection <span aria-hidden>↗</span></Link>}
                {t.sourceAlarmId && <Link href={`/console/alarms/${t.sourceAlarmId}`} className="flex items-center justify-between rounded-2xl bg-bg-2 px-4 py-3 text-sm hover:bg-surface-2">Source alarm <span aria-hidden>↗</span></Link>}
              </div>
            </Card>
          )}
          <Card title="Attachments" action={can('maintenance.request') ? <UploadButton ownerType="maintenance" ownerId={t.id} onUploaded={async () => { await q.refetch(); toast({ title: 'File attached', tone: 'ok' }); }} /> : undefined}>
            <AttachmentList items={t.attachments} emptyText="No photos or documents attached." />
            <p className="mt-3 text-xs text-muted">JPEG, PNG, WebP, PDF or plain text up to 10 MB.</p>
          </Card>
        </aside>
      </div>

      <ConfirmDialog open={confirm === 'complete'} onOpenChange={(v) => setConfirm(v ? 'complete' : null)} title="Mark task complete" confirmLabel="Complete task"
        body="Record what was done. This is the maintenance record — it does not change the equipment state in Hydris or on the plant." noteLabel="Work performed" noteRequired
        onConfirm={(n) => transition('complete', n)} />
      <ConfirmDialog open={confirm === 'hold'} onOpenChange={(v) => setConfirm(v ? 'hold' : null)} title="Put task on hold" confirmLabel="Put on hold"
        body="Use this while waiting for parts, access or a shutdown window." noteLabel="Reason" onConfirm={(n) => transition('hold', n)} />
      <ConfirmDialog open={confirm === 'cancel'} onOpenChange={(v) => setConfirm(v ? 'cancel' : null)} title="Cancel task" confirmLabel="Cancel task" destructive
        body="The task is closed without being completed. It can be reopened later." noteLabel="Reason" onConfirm={(n) => transition('cancel', n)} />
      <ConfirmDialog open={confirm === 'reopen'} onOpenChange={(v) => setConfirm(v ? 'reopen' : null)} title="Reopen task" confirmLabel="Reopen"
        body={t.assignedTo ? 'The task returns to the current assignee.' : 'The task returns to the open queue.'} noteLabel="Reason" onConfirm={(n) => transition('reopen', n)} />
      {permissions.manage && <EditTaskDialog open={editOpen} onOpenChange={setEditOpen} task={t} onDone={() => void refresh()} />}
    </>
  );
}

function BackLink() {
  return <Link href="/console/maintenance" className="mb-4 inline-flex items-center gap-1.5 text-sm text-text-2 hover:text-text"><ArrowLeft size={15} aria-hidden />All maintenance</Link>;
}
