'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, Ban, CalendarClock, CheckCircle2, ChevronDown, ChevronUp, Pause, Play, Send, Undo2, UserRoundCog, Wrench } from 'lucide-react';
import { ASSET_TYPE_LABELS, INSPECTION_EDITABLE, INSPECTION_STATUS_LABELS, MAINTENANCE_STATUS_LABELS, canTransitionInspection, type InspectionAction, type StepValue } from '@hydris/domain';
import { ApiError, post } from '@/lib/api';
import { invalidatePaths, useApi } from '@/lib/query';
import { fmtDateTime, until } from '@/lib/format';
import { Button, Card, Chip, ErrorState, KeyValues, PageHeader, Progress, Skeleton, StateChip, Switch, SyntheticBadge, Timeline, BackLink as UiBackLink } from '@/ui';
import { ConfirmDialog, Dialog, useToast } from '@/ui/overlay';
import { AttachmentList } from '@/console/work/attachments';
import { ReassignDialog } from '@/console/work/inspection-forms';
import { ResponseMeta, ResponseValue, STEP_KIND_META, StepRecorder } from '@/console/work/steps';
import { SafetyCard } from '@/console/work/TemplateBuilder';
import { ConflictBanner, FormError, describeError, isConflict, isOverdue, newOpId, type InspectionDetail, type InspectionDetailResponse } from '@/console/work/shared';

const CONFLICT_REASONS: Record<string, string> = {
  unknown_step: 'that step no longer exists on this inspection',
  kind_mismatch: 'the response type does not match the step',
  timestamp_in_future: 'the device clock is ahead of the server',
};

export default function InspectionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const isTemplatesAlias = id === 'templates';
  const path = `/inspections/${id}`;
  const q = useApi<InspectionDetailResponse>(isTemplatesAlias ? null : path);
  // "/console/inspections/templates" is a natural guess for the template library; forward it.
  useEffect(() => { if (isTemplatesAlias) router.replace('/console/inspections?view=templates'); }, [isTemplatesAlias, router]);
  const qc = useQueryClient();
  const toast = useToast();
  const [conflict, setConflict] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | 'submit' | 'approve' | 'reject' | 'cancel' | 'reassign'>(null);
  const [busyAction, setBusyAction] = useState<InspectionAction | null>(null);
  const [showMissing, setShowMissing] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const refresh = async () => {
    await q.refetch();
    invalidatePaths(qc, ['/inspections', '/overview', '/maintenance']);
  };
  const reload = async () => {
    setConflict(null);
    await refresh();
  };

  /** Run a server call; 409s become a persistent "changed, reload" banner. */
  const guard = async <T,>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      if (isConflict(e)) {
        const d = (e as ApiError).details as { revision?: number; status?: string } | undefined;
        setConflict(`${(e as ApiError).message}${d?.status ? ` It is now ${INSPECTION_STATUS_LABELS[d.status as keyof typeof INSPECTION_STATUS_LABELS]?.toLowerCase() ?? d.status}${d.revision ? ` (revision ${d.revision})` : ''}.` : '.'}`);
      }
      throw e;
    }
  };

  if (q.isError && !q.data) {
    return (
      <>
        <BackLink />
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </>
    );
  }
  if (!q.data) return <DetailSkeleton />;

  const { inspection: i, followUps, permissions } = q.data;
  const editable = INSPECTION_EDITABLE.includes(i.status);
  const canExecute = permissions.execute && editable;
  const missing = i.steps.filter((s) => s.required && !i.responses[s.id]);

  const transition = async (action: InspectionAction, extra: { note?: string; createFollowUp?: boolean } = {}) =>
    guard(async () => {
      const r = await post<{ inspection: InspectionDetail; followUpId: string | null }>(`${path}/${action}`, { expectedRevision: i.revision, ...(extra.note ? { note: extra.note } : {}), ...(extra.createFollowUp !== undefined ? { createFollowUp: extra.createFollowUp } : {}) });
      qc.setQueryData<InspectionDetailResponse>(['api', path], (old) => (old ? { ...old, inspection: r.inspection } : old));
      await refresh();
      return r;
    });

  const quick = async (action: 'start' | 'pause') => {
    setBusyAction(action);
    try {
      await transition(action);
      toast({ title: action === 'start' ? 'Inspection started' : 'Inspection paused', tone: 'ok' });
    } catch (e) {
      if (!isConflict(e)) toast({ title: `Could not ${action}`, body: describeError(e), tone: 'critical' });
    } finally {
      setBusyAction(null);
    }
  };

  const record = async (stepId: string, value: StepValue, note: string | undefined) => {
    const r = await guard(() => post<{ applied: number; duplicates: number; conflicts: { opId: string; reason: string }[]; inspection: InspectionDetail }>(`${path}/responses`, {
      ops: [{ opId: newOpId(), stepId, value, ...(note ? { note } : {}), recordedAt: new Date().toISOString() }],
    }));
    qc.setQueryData<InspectionDetailResponse>(['api', path], (old) => (old ? { ...old, inspection: r.inspection } : old));
    invalidatePaths(qc, ['/inspections', '/overview']);
    if (r.conflicts.length) {
      const reason = r.conflicts[0]!.reason;
      if (reason.startsWith('inspection_')) {
        setConflict(`The response was not saved because the inspection is now ${reason.replace('inspection_', '').replace('_', ' ')}.`);
        void q.refetch();
        throw new Error('Not saved — this inspection is no longer open for responses.');
      }
      throw new Error(`Not saved — ${CONFLICT_REASONS[reason] ?? reason}.`);
    }
  };

  const late = isOverdue(i.dueAt, editable);

  const timeline = [
    { id: 'created', title: 'Issued', meta: fmtDateTime(i.createdAt), tone: 'muted' as const },
    ...(i.startedAt ? [{ id: 'started', title: 'Started', meta: fmtDateTime(i.startedAt), tone: 'cobalt' as const }] : []),
    ...(i.pausedAt && i.status === 'paused' ? [{ id: 'paused', title: 'Paused', meta: fmtDateTime(i.pausedAt), tone: 'muted' as const }] : []),
    ...(i.submittedAt ? [{ id: 'submitted', title: `Submitted via ${i.submittedVia === 'glasses' ? 'field glasses' : 'console'}`, meta: fmtDateTime(i.submittedAt), tone: 'lime' as const }] : []),
    ...(i.reviewedAt ? [{ id: 'reviewed', title: i.status === 'rejected' ? 'Returned for correction' : 'Approved', meta: fmtDateTime(i.reviewedAt), body: i.reviewNote ?? undefined, tone: i.status === 'rejected' ? 'critical' as const : 'ok' as const }] : []),
  ];

  return (
    <>
      <BackLink />
      <PageHeader
        eyebrow={<span className="num">Inspection · revision {i.revision}{i.templateVersion ? ` · template v${i.templateVersion}` : ''}</span>}
        title={i.title}
        actions={<>
          {canExecute && canTransitionInspection(i.status, 'start') && (
            <Button variant={i.status === 'scheduled' ? 'primary' : 'secondary'} icon={<Play size={16} />} busy={busyAction === 'start'} onClick={() => void quick('start')}>{i.status === 'scheduled' ? 'Start' : 'Resume'}</Button>
          )}
          {canExecute && canTransitionInspection(i.status, 'pause') && <Button icon={<Pause size={16} />} busy={busyAction === 'pause'} onClick={() => void quick('pause')}>Pause</Button>}
          {canExecute && canTransitionInspection(i.status, 'submit') && <Button variant="primary" icon={<Send size={16} />} onClick={() => setDialog('submit')}>Submit for review</Button>}
          {permissions.review && i.status === 'submitted' && <>
            <Button variant="danger" icon={<Undo2 size={16} />} onClick={() => setDialog('reject')}>Return</Button>
            <Button variant="primary" icon={<CheckCircle2 size={16} />} onClick={() => setDialog('approve')}>Approve</Button>
          </>}
          {permissions.manage && editable && <Button icon={<UserRoundCog size={16} />} onClick={() => setDialog('reassign')}>Reassign</Button>}
          {permissions.manage && canTransitionInspection(i.status, 'cancel') && <Button variant="ghost" icon={<Ban size={16} />} onClick={() => setDialog('cancel')}>Cancel</Button>}
        </>}>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <StateChip state={i.status} label={INSPECTION_STATUS_LABELS[i.status]} />
          {i.priority === 'high' && <Chip tone="high">High priority</Chip>}
          {late && <Chip tone="high"><CalendarClock size={12} aria-hidden />{until(i.dueAt)}</Chip>}
          {i.synthetic && <SyntheticBadge />}
          {i.asset && <Link href={`/console/assets/${i.asset.id}`} className="chip chip-cobalt hover:brightness-125">{i.asset.tag} · {i.asset.name}</Link>}
        </div>
      </PageHeader>

      {conflict && <ConflictBanner message={conflict} busy={q.isFetching} onReload={() => void reload()} />}

      {i.status === 'rejected' && i.reviewNote && (
        <div role="note" className="mb-4 flex gap-3 rounded-[var(--radius-xl)] border border-[rgb(255_159_28/0.4)] bg-[rgb(255_159_28/0.08)] p-4">
          <Undo2 size={18} className="mt-0.5 flex-none text-high-text" aria-hidden />
          <div><div className="font-medium">Returned for correction</div><p className="mt-1 whitespace-pre-line text-sm text-text-2">{i.reviewNote}</p></div>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid min-w-0 content-start gap-4">
          {i.safetyNotices.length > 0 && <SafetyCard notices={i.safetyNotices} />}

          <Card title={<h2 className="t-card">Steps <span className="num text-muted">· {i.progress.answered}/{i.progress.total}</span></h2>}
            action={canExecute ? <span className="text-xs text-muted">Recording from the console</span> : !permissions.execute && editable ? <span className="text-xs text-muted">Read-only — only the assignee records responses</span> : undefined}>
            {showMissing && missing.length > 0 && (
              <div role="alert" className="mb-4 flex gap-2 rounded-2xl border border-[rgb(255_40_0/0.35)] bg-[rgb(255_40_0/0.06)] px-4 py-3 text-sm">
                <AlertTriangle size={16} className="mt-0.5 flex-none text-critical" aria-hidden />
                <span>{missing.length} required step{missing.length > 1 ? 's are' : ' is'} still open: {missing.map((s) => s.title).join(', ')}.</span>
              </div>
            )}
            <ol className="grid gap-3">
              {i.steps.map((s, idx) => {
                const r = i.responses[s.id];
                const isMissing = showMissing && s.required && !r;
                const open = canExecute && (expanded[s.id] ?? !r);
                return (
                  <li key={s.id} id={`step-${s.id}`} className={clsx('rounded-[var(--radius-lg)] border bg-bg-2 p-4', isMissing ? 'border-[rgb(255_40_0/0.6)]' : r?.outcome === 'abnormal' ? 'border-[rgb(255_159_28/0.4)]' : 'border-line')}>
                    <div className="flex items-start gap-3">
                      <span className={clsx('num grid h-8 w-8 flex-none place-items-center rounded-full text-sm', r ? (r.outcome === 'abnormal' ? 'bg-high text-ink' : 'bg-ok text-ink') : 'bg-surface-3 text-text-2')}>{idx + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{s.title}</span>
                          <span className="inline-flex items-center gap-1 text-xs text-muted">{STEP_KIND_META[s.kind].icon}{STEP_KIND_META[s.kind].label}</span>
                          {s.required ? <span className="text-xs text-lime">Required</span> : <span className="text-xs text-muted">Optional</span>}
                        </div>
                        {s.caution && <p className="mt-2 flex gap-1.5 text-sm text-medium-text"><AlertTriangle size={14} className="mt-0.5 flex-none" aria-hidden />{s.caution}</p>}
                        {s.instruction && <p className="mt-1.5 whitespace-pre-line text-sm text-text-2">{s.instruction}</p>}
                        {r ? (
                          <div className="mt-3 grid gap-2">
                            <div><ResponseValue step={s} r={r} /></div>
                            {r.note && <p className="rounded-xl bg-surface px-3 py-2 text-sm text-text-2">“{r.note}”</p>}
                            <ResponseMeta r={r} />
                          </div>
                        ) : <p className={clsx('mt-3 text-sm', isMissing ? 'text-critical-text' : 'text-muted')}>{isMissing ? 'Required — not recorded yet' : 'Not recorded'}</p>}
                        {canExecute && r && (
                          <button type="button" className="mt-3 inline-flex items-center gap-1 text-sm text-text-2 hover:text-text" aria-expanded={open} onClick={() => setExpanded((x) => ({ ...x, [s.id]: !open }))}>
                            {open ? <ChevronUp size={15} aria-hidden /> : <ChevronDown size={15} aria-hidden />}{open ? 'Close' : 'Change response'}
                          </button>
                        )}
                        {open && (
                          <div className="mt-3">
                            <StepRecorder step={s} inspectionId={i.id} current={r} onRecord={async (v, n) => {
                              await record(s.id, v, n);
                              setExpanded((x) => ({ ...x, [s.id]: false }));
                            }} />
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </Card>
        </div>

        <aside className="grid content-start gap-4">
          <div className="card card-paper">
            <div className="flex items-start justify-between"><span className="text-[14px] opacity-75">Progress</span><span className="text-xs opacity-60 num">{i.progress.percent}%</span></div>
            <div className="mt-3 flex items-baseline gap-2"><span className="t-kpi">{i.progress.answered}</span><span className="text-[15px] opacity-60 num">/ {i.progress.total} steps</span></div>
            <div className="mt-4"><Progress value={i.progress.percent} tone={i.progress.complete ? 'ok' : 'lime'} label="Steps answered" /></div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px] opacity-75 num">
              <span>{i.progress.requiredAnswered}/{i.progress.required} required</span>
              <span className={i.progress.abnormal ? 'kpi-accent-high' : undefined}>{i.progress.abnormal} abnormal</span>
            </div>
          </div>

          <Card title="Details">
            <KeyValues columns={1} items={[
              ['Asset', i.asset ? <Link className="text-accent hover:underline" href={`/console/assets/${i.asset.id}`}>{i.asset.tag} · {i.asset.name}</Link> : 'Site-wide'],
              ['Asset type', i.asset ? ASSET_TYPE_LABELS[i.asset.type] : '—'],
              ['Assignee', i.assignee?.name ?? 'Unassigned'],
              ['Due', i.dueAt ? <span className="num">{fmtDateTime(i.dueAt)} <span className="text-muted">· {editable ? until(i.dueAt) : 'closed'}</span></span> : 'No due date'],
              ['Revision', <span key="r" className="num">{i.revision}</span>],
            ]} />
          </Card>

          <Card title="Follow-up maintenance">
            {followUps.length ? (
              <ul className="grid gap-2">
                {followUps.map((f) => (
                  <li key={f.id}>
                    <Link href={`/console/maintenance/${f.id}`} className="flex items-center gap-3 rounded-2xl bg-bg-2 px-3 py-2.5 hover:bg-surface-2">
                      <Wrench size={16} className="flex-none text-text-2" aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-sm">{f.title}</span>
                      <StateChip state={f.status} label={MAINTENANCE_STATUS_LABELS[f.status]} />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted">{i.progress.abnormal ? 'Abnormal findings open a maintenance request automatically when the inspection is submitted.' : 'None. Abnormal findings create one on submit.'}</p>}
          </Card>

          <Card title="Evidence files"><AttachmentList items={i.attachments} emptyText="No photos or files uploaded." /></Card>
          <Card title="Record"><Timeline items={timeline} /></Card>
        </aside>
      </div>

      <SubmitDialog open={dialog === 'submit'} onOpenChange={(v) => setDialog(v ? 'submit' : null)} inspection={i}
        onIncomplete={() => setShowMissing(true)} onSubmit={async (createFollowUp) => {
          const r = await transition('submit', { createFollowUp });
          toast({ title: 'Submitted for review', body: r.followUpId ? 'A follow-up maintenance request was opened for abnormal findings.' : undefined, tone: 'ok' });
          setShowMissing(false);
        }} />
      <ConfirmDialog open={dialog === 'approve'} onOpenChange={(v) => setDialog(v ? 'approve' : null)} title="Approve inspection" confirmLabel="Approve"
        body={`Approving closes this inspection as the audit record. ${i.progress.abnormal ? `${i.progress.abnormal} abnormal finding(s) were recorded — check the follow-up maintenance.` : 'No abnormal findings were recorded.'}`}
        noteLabel="Review note" onConfirm={(note) => transition('approve', { note })} />
      <ConfirmDialog open={dialog === 'reject'} onOpenChange={(v) => setDialog(v ? 'reject' : null)} title="Return for correction" confirmLabel="Return to assignee" destructive
        body="The assignee is notified and can correct responses and submit again." noteLabel="What needs to be corrected" noteRequired
        onConfirm={(note) => transition('reject', { note })} />
      <ConfirmDialog open={dialog === 'cancel'} onOpenChange={(v) => setDialog(v ? 'cancel' : null)} title="Cancel inspection" confirmLabel="Cancel inspection" destructive
        body="The inspection is withdrawn from the assignee's glasses. Recorded responses are kept for the audit trail. This cannot be undone." noteLabel="Reason"
        onConfirm={(note) => transition('cancel', { note })} />
      {permissions.manage && <ReassignDialog open={dialog === 'reassign'} onOpenChange={(v) => setDialog(v ? 'reassign' : null)} inspection={i} onDone={() => void refresh()} />}
    </>
  );
}

function SubmitDialog({ open, onOpenChange, inspection: i, onSubmit, onIncomplete }: {
  open: boolean; onOpenChange: (v: boolean) => void; inspection: InspectionDetail; onSubmit: (createFollowUp: boolean) => Promise<void>; onIncomplete: () => void;
}) {
  const [followUp, setFollowUp] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const missing = i.steps.filter((s) => s.required && !i.responses[s.id]);
  const abnormal = i.steps.filter((s) => i.responses[s.id]?.outcome === 'abnormal');

  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      await onSubmit(followUp);
      onOpenChange(false);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'incomplete') onIncomplete();
      setErr(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) { setErr(null); onOpenChange(v); } }} title="Submit for review"
      description="A second person reviews and approves the inspection. You cannot change responses after submitting unless it is returned."
      footer={<>
        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Keep working</Button>
        <Button variant="primary" busy={busy} disabled={missing.length > 0} onClick={() => void go()} icon={<Send size={15} />}>Submit</Button>
      </>}>
      <div className="grid gap-4">
        {missing.length > 0 ? (
          <div role="alert" className="rounded-2xl border border-[rgb(255_40_0/0.35)] bg-[rgb(255_40_0/0.06)] p-4">
            <div className="font-medium">Incomplete — {missing.length} required step{missing.length > 1 ? 's' : ''} still open</div>
            <ul className="mt-2 grid gap-1 text-sm text-text-2">
              {missing.map((s) => <li key={s.id}>• <a className="underline-offset-2 hover:underline" href={`#step-${s.id}`} onClick={() => { onIncomplete(); onOpenChange(false); }}>{s.title}</a></li>)}
            </ul>
          </div>
        ) : <p className="flex items-center gap-2 text-sm"><CheckCircle2 size={16} className="text-ok-text" aria-hidden />All <span className="num">{i.progress.required}</span> required steps recorded.</p>}
        {abnormal.length > 0 && (
          <div className="grid gap-3 rounded-2xl border border-[rgb(255_159_28/0.35)] bg-[rgb(255_159_28/0.06)] p-4">
            <div className="text-sm"><b className="font-medium">{abnormal.length} abnormal finding{abnormal.length > 1 ? 's' : ''}:</b> {abnormal.map((s) => s.title).join(', ')}</div>
            <Switch checked={followUp} onChange={setFollowUp} label="Open a follow-up maintenance request" />
          </div>
        )}
        <FormError error={err} />
      </div>
    </Dialog>
  );
}

function BackLink() {
  return <UiBackLink href="/console/inspections">All inspections</UiBackLink>;
}

function DetailSkeleton() {
  return (
    <div className="grid gap-4" role="status" aria-label="Loading inspection">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-12 w-2/3 max-w-xl" />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid gap-3">{[0, 1, 2, 3].map((k) => <Skeleton key={k} className="h-28 rounded-[18px]" />)}</div>
        <div className="grid gap-4"><Skeleton className="h-[170px] rounded-[24px]" /><Skeleton className="h-[220px] rounded-[24px]" /></div>
      </div>
    </div>
  );
}
