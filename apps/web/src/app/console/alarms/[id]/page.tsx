'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Activity, Boxes, Check, FileText, Info, UserPlus, Wrench } from 'lucide-react';
import { ALARM_STATES, ALARM_STATE_LABELS, CONDITION_LABELS, MEASURAND_DEFS, type AlarmAction, type AlarmState } from '@hydris/domain';
import { post } from '@/lib/api';
import { invalidatePaths, useAction, useApi } from '@/lib/query';
import { useCan, useSession } from '@/lib/session';
import { ago, fmtDateTime, fmtValue } from '@/lib/format';
import { Button, ButtonLink, Card, KeyValues, PageHeader, QueryView, SeverityChip, Skeleton, StateChip, SyntheticBadge, Textarea, Timeline, cx, BackLink as UiBackLink } from '@/ui';
import { ConfirmDialog } from '@/ui/overlay';
import type { AlarmDetailResponse, AlarmHistoryEntry, Member } from '@/console/alarms-telemetry/types';
import { AssignDialog, FollowUpDialog } from '@/console/alarms-telemetry/AlarmDialogs';

const ACTIONS: Record<AlarmAction, { label: string; title: string; body: ReactNode; noteLabel: string; required?: boolean; destructive?: boolean }> = {
  acknowledge: {
    label: 'Acknowledge', title: 'Acknowledge this alarm?', noteLabel: 'Note',
    body: 'Acknowledging records that you have seen this alarm. It does not change the physical process, stop equipment or clear the condition. Follow the recommended action on site.',
  },
  investigate: { label: 'Start investigation', title: 'Start investigating?', noteLabel: 'Note', body: 'Marks the alarm as under investigation. If nobody is assigned yet, it is assigned to you.' },
  resolve: {
    label: 'Resolve', title: 'Resolve this alarm', noteLabel: 'What was done to resolve the condition', required: true,
    body: 'Record what was done about the underlying condition. Resolving is a record-keeping step and does not change the process.',
  },
  close: { label: 'Close', title: 'Close this alarm?', noteLabel: 'Review note', body: 'Closing archives the alarm after review. A closed alarm can no longer be reassigned or changed.' },
};

const HISTORY: Record<string, { title: string; tone: 'lime' | 'critical' | 'ok' | 'muted' | 'cobalt' }> = {
  triggered: { title: 'Alarm triggered', tone: 'critical' },
  condition_cleared: { title: 'Measured condition returned to normal', tone: 'ok' },
  acknowledge: { title: 'Acknowledged', tone: 'lime' },
  investigate: { title: 'Investigation started', tone: 'cobalt' },
  resolve: { title: 'Resolved', tone: 'ok' },
  close: { title: 'Closed', tone: 'muted' },
  assigned: { title: 'Assignment changed', tone: 'cobalt' },
  note: { title: 'Note added', tone: 'muted' },
};

export default function AlarmDetailPage() {
  const { id } = useParams<{ id: string }>();
  const q = useApi<AlarmDetailResponse>(`/alarms/${id}`, { refetchInterval: 30_000 });
  return (
    <>
      <UiBackLink href="/console/alarms">All alarms</UiBackLink>
      <QueryView q={q} loading={<DetailSkeleton />}>{(d) => <AlarmDetail d={d} refetch={() => void q.refetch()} />}</QueryView>
    </>
  );
}

function AlarmDetail({ d, refetch }: { d: AlarmDetailResponse; refetch: () => void }) {
  const { alarm: a } = d;
  const can = useCan();
  const me = useSession().user;
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<AlarmAction | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [followOpen, setFollowOpen] = useState(false);
  const members = useApi<{ members: Member[] }>(d.canAssign && can('member.read') ? '/members' : null, { retry: false });
  const canAssignHere = d.canAssign && a.state !== 'closed' && !!members.data;
  const decimals = a.measurand ? MEASURAND_DEFS[a.measurand].decimals : undefined;
  const unit = a.unit ?? '';
  const cleared = !!a.clearedAt;
  const open = a.state === 'active' || a.state === 'acknowledged' || a.state === 'investigating';
  const accent = a.severity === 'critical' ? 'var(--color-critical)' : a.severity === 'high' ? 'var(--color-high)' : a.severity === 'medium' ? 'var(--color-medium)' : 'var(--color-low)';

  const run = (action: AlarmAction) => async (note: string) => {
    try {
      await post(`/alarms/${a.id}/${action}`, note ? { note } : {});
    } catch (e) {
      refetch(); // e.g. someone else changed the state; show the current one behind the dialog
      throw e;
    }
    invalidatePaths(qc, ['/alarms', '/overview', '/assets']);
  };

  const stepAt: Record<AlarmState, string | null> = {
    active: a.triggeredAt, acknowledged: a.acknowledgedAt, investigating: [...d.history].reverse().find((h) => h.action === 'investigate')?.at ?? null,
    resolved: a.resolvedAt, closed: a.closedAt,
  };

  return (
    <div className="fade-in">
      <PageHeader eyebrow={<>Alarm{a.assetTag ? ` · ${a.assetTag}` : ''}{a.sensorTag ? ` · ${a.sensorTag}` : ''}</>} title={a.title}>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <SeverityChip severity={a.severity} />
          <StateChip state={a.state} label={ALARM_STATE_LABELS[a.state]} />
          {a.synthetic && <SyntheticBadge />}
        </div>
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-[1.55fr_1fr]">
        <div className="grid min-w-0 content-start gap-4">
          {/* Hero: measured value vs limit */}
          <section className="card" aria-labelledby="hero-h">
            <h2 id="hero-h" className="sr-only">Measured condition</h2>
            <div className="grid gap-6 sm:grid-cols-[1.2fr_1fr]">
              <div className="min-w-0">
                <div className="t-label">{a.condition === 'stale' ? 'Condition' : 'Value at trigger'}</div>
                {a.condition === 'stale' ? (
                  <div className="t-kpi-sm mt-2" style={{ color: accent }}>No fresh data</div>
                ) : (
                  <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="t-kpi num" style={{ color: accent }}>{fmtValue(a.triggerValue, undefined, decimals)}</span>
                    <span className="text-[15px] text-text-2">{unit}</span>
                  </div>
                )}
                <p className="mt-2 text-sm text-text-2">{a.description ?? CONDITION_LABELS[a.condition]}</p>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <Stat k="Condition" v={CONDITION_LABELS[a.condition]} />
                <Stat k="Limit" v={a.threshold === null ? '—' : <span className="num">{fmtValue(a.threshold, undefined, decimals)} {unit}</span>} />
                <Stat k={a.condition.startsWith('low') ? 'Lowest seen' : 'Peak'} v={a.peakValue === null ? '—' : <span className="num">{fmtValue(a.peakValue, undefined, decimals)} {unit}</span>} />
                <Stat k="Triggered" v={<time dateTime={a.triggeredAt} title={new Date(a.triggeredAt).toLocaleString()}>{fmtDateTime(a.triggeredAt)}</time>} sub={ago(a.triggeredAt)} />
                <div className="col-span-2">
                  <dt className="t-label">Measured condition</dt>
                  <dd className="mt-1">
                    {cleared
                      ? <span className="inline-flex items-center gap-2"><span className="dot" style={{ background: 'var(--color-ok)' }} aria-hidden />Cleared {ago(a.clearedAt)} <span className="muted">· {fmtDateTime(a.clearedAt)}</span></span>
                      : <span className="inline-flex items-center gap-2" style={{ color: open ? accent : undefined }}><span className={cx('dot', open && 'pulse-dot')} style={{ background: accent }} aria-hidden />Still in alarm</span>}
                  </dd>
                </div>
              </dl>
            </div>

            <Stepper state={a.state} at={stepAt} />

            <div className="mt-6 border-t border-line pt-5">
              {d.allowedActions.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                  {d.allowedActions.map((x, i) => (
                    <Button key={x} variant={i === 0 ? 'primary' : 'secondary'} onClick={() => setConfirm(x)} icon={x === 'acknowledge' ? <Check size={16} aria-hidden /> : undefined}>{ACTIONS[x].label}</Button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted">{a.state === 'closed' ? 'This alarm is closed. No further actions.' : 'Your role cannot change the state of this alarm.'}</p>
              )}
              <p className="mt-3 flex items-start gap-2 text-[13px] text-muted"><Info size={15} strokeWidth={1.8} className="mt-0.5 flex-none" aria-hidden />
                Acknowledging records that a person has seen the alarm. It does not change the physical process. Act on the equipment following the procedure.</p>
            </div>
          </section>

          {(a.recommendedAction || d.procedure) && (
            <section className="card card-paper" aria-labelledby="rec-h">
              <h2 id="rec-h" className="t-card">Recommended action</h2>
              {a.recommendedAction ? <p className="mt-3 whitespace-pre-line text-[15px] leading-relaxed">{a.recommendedAction}</p> : <p className="mt-3 text-sm muted">No recommended action configured for this rule.</p>}
              {d.procedure && (
                <Link href={`/console/documents/${d.procedure.id}`} className="mt-4 inline-flex items-center gap-2 rounded-full border border-ink/20 px-4 py-2 text-sm font-medium hover:bg-ink/5">
                  <FileText size={16} strokeWidth={1.8} aria-hidden />Open procedure: {d.procedure.title}
                </Link>
              )}
            </section>
          )}

          <Card title="Notes & history">
            {can('alarm.acknowledge') && <NoteForm alarmId={a.id} />}
            <Timeline items={[...d.history].reverse().map((h) => historyItem(h))} />
          </Card>
        </div>

        <div className="grid min-w-0 content-start gap-4">
          <Card title="Details">
            <KeyValues columns={1} items={[
              ['Asset', a.assetId ? <Link className="hover:underline" href={`/console/assets/${a.assetId}`}>{a.assetTag}{a.assetName ? ` · ${a.assetName}` : ''}</Link> : null],
              ['Sensor', a.sensorId ? <Link className="hover:underline" href={`/console/telemetry/${a.sensorId}`}>{a.sensorTag}{a.sensorName ? ` · ${a.sensorName}` : ''}</Link> : null],
              ['Assignee', d.assignee?.name ?? <span className="muted">Unassigned</span>],
              ['Acknowledged', a.acknowledgedAt ? `${fmtDateTime(a.acknowledgedAt)} · ${ago(a.acknowledgedAt)}` : null],
              ['Resolved', a.resolvedAt ? `${fmtDateTime(a.resolvedAt)} · ${ago(a.resolvedAt)}` : null],
              ['Rule', d.rule ? `${d.rule.name}${d.rule.onDelayS ? ` · ${d.rule.onDelayS}s on-delay` : ''}` : null],
            ]} />
            <div className="mt-5 flex flex-wrap gap-2">
              {canAssignHere && <Button size="sm" icon={<UserPlus size={15} aria-hidden />} onClick={() => setAssignOpen(true)}>{a.assignedTo ? 'Reassign' : 'Assign'}</Button>}
              {a.sensorId && <ButtonLink size="sm" href={`/console/telemetry/${a.sensorId}`} icon={<Activity size={15} aria-hidden />}>Sensor trend</ButtonLink>}
              {a.assetId && <ButtonLink size="sm" href={`/console/assets/${a.assetId}`} icon={<Boxes size={15} aria-hidden />}>Asset</ButtonLink>}
            </div>
          </Card>

          {a.resolutionNote && (
            <Card title="Resolution">
              <p className="whitespace-pre-line text-sm text-text-2">{a.resolutionNote}</p>
            </Card>
          )}

          <Card title="Follow-up maintenance" action={can('maintenance.request') && a.state !== 'closed'
            ? <Button size="sm" icon={<Wrench size={15} aria-hidden />} onClick={() => setFollowOpen(true)}>Create</Button> : undefined}>
            {d.followUps.length ? (
              <ul className="grid gap-2">
                {d.followUps.map((t) => (
                  <li key={t.id}>
                    <Link href={`/console/maintenance/${t.id}`} className="flex items-center gap-3 rounded-2xl bg-bg-2 px-4 py-3 hover:bg-surface-2">
                      <span className="min-w-0 flex-1 truncate text-sm">{t.title}</span>
                      <StateChip state={t.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted">No maintenance task has been raised from this alarm.</p>}
          </Card>
        </div>
      </div>

      {d.allowedActions.map((x) => (
        <ConfirmDialog key={x} open={confirm === x} onOpenChange={(v) => setConfirm(v ? x : null)} title={ACTIONS[x].title} confirmLabel={ACTIONS[x].label}
          noteLabel={ACTIONS[x].noteLabel} noteRequired={ACTIONS[x].required} onConfirm={run(x)}
          body={<>{ACTIONS[x].body}{x === 'resolve' && !cleared && <span className="mt-2 block text-high-text">The measured value has not returned to normal yet.</span>}</>} />
      ))}
      {members.data && <AssignDialog open={assignOpen} onOpenChange={setAssignOpen} alarmId={a.id} currentId={a.assignedTo} members={members.data.members} meId={me.id} />}
      <FollowUpDialog open={followOpen} onOpenChange={setFollowOpen} alarm={a} />
    </div>
  );
}

function Stat({ k, v, sub }: { k: string; v: ReactNode; sub?: string }) {
  return (
    <div className="min-w-0">
      <dt className="t-label">{k}</dt>
      <dd className="mt-1 truncate">{v}{sub && <span className="block text-xs text-muted">{sub}</span>}</dd>
    </div>
  );
}

function Stepper({ state, at }: { state: AlarmState; at: Record<AlarmState, string | null> }) {
  const cur = ALARM_STATES.indexOf(state);
  return (
    <ol className="mt-6 grid grid-cols-5 gap-1" aria-label="Alarm lifecycle">
      {ALARM_STATES.map((s, i) => {
        const done = i < cur, current = i === cur;
        return (
          <li key={s} className="relative flex min-w-0 flex-col items-center text-center" aria-current={current ? 'step' : undefined}>
            {i > 0 && <span className={cx('absolute top-[13px] h-0.5 rounded-full', i <= cur ? 'bg-lime' : 'bg-surface-3')} style={{ left: 'calc(-50% + 18px)', right: 'calc(50% + 18px)' }} aria-hidden />}
            <span className={cx('relative grid h-7 w-7 place-items-center rounded-full text-[11px] font-semibold',
              done && 'bg-lime/80 text-lime-ink', current && 'bg-lime text-lime-ink ring-4 ring-[rgb(25_84_241/0.18)]', !done && !current && 'border border-line-2 bg-surface text-muted')}>
              {done ? <Check size={14} strokeWidth={2.4} aria-hidden /> : i + 1}
            </span>
            <span className={cx('mt-2 max-w-full text-[11.5px] leading-tight sm:text-[12.5px]', current ? 'font-medium text-text' : done ? 'text-text-2' : 'text-muted')}>{ALARM_STATE_LABELS[s]}</span>
            {(done || current) && at[s] && <span className="num mt-0.5 hidden text-[11px] text-muted sm:block" title={new Date(at[s]!).toLocaleString()}>{ago(at[s])}</span>}
            <span className="sr-only">{done ? '(completed)' : current ? '(current state)' : '(not reached)'}</span>
          </li>
        );
      })}
    </ol>
  );
}

function NoteForm({ alarmId }: { alarmId: string }) {
  const [note, setNote] = useState('');
  const act = useAction((n: string) => post(`/alarms/${alarmId}/notes`, { note: n }), { invalidate: [`/alarms/${alarmId}`], success: 'Note added', onSuccess: () => setNote('') });
  return (
    <form className="mb-6 grid gap-2" onSubmit={(e) => { e.preventDefault(); if (note.trim()) act.mutate(note.trim()); }}>
      <Textarea label="Add a note" placeholder="Observations, readings taken on site, who was informed…" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} rows={3} />
      <div className="flex justify-end"><Button type="submit" size="sm" busy={act.isPending} disabled={!note.trim()}>Add note</Button></div>
    </form>
  );
}

function historyItem(h: AlarmHistoryEntry) {
  const m = HISTORY[h.action] ?? { title: h.action.replace(/_/g, ' '), tone: 'muted' as const };
  const who = h.actorName ?? 'Hydris';
  return {
    id: h.id,
    title: <><span className="font-medium">{m.title}</span>{h.action !== 'triggered' && h.action !== 'condition_cleared' && <span className="text-text-2"> · {who}</span>}</>,
    meta: <time dateTime={h.at} title={new Date(h.at).toLocaleString()}>{fmtDateTime(h.at)} · {ago(h.at)}</time>,
    body: h.note ? <span className="whitespace-pre-line">{h.note}</span> : undefined,
    tone: m.tone,
  };
}

function DetailSkeleton() {
  return (
    <div className="grid gap-4" role="status" aria-label="Loading alarm">
      <Skeleton className="h-10 w-2/3" />
      <div className="grid gap-4 lg:grid-cols-[1.55fr_1fr]">
        <Skeleton className="h-[360px] rounded-[24px]" />
        <Skeleton className="h-[360px] rounded-[24px]" />
      </div>
    </div>
  );
}
