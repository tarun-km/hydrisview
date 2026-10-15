'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BellRing, Pencil, Plus, Trash2 } from 'lucide-react';
import type { UseQueryResult } from '@tanstack/react-query';
import { ALARM_CONDITIONS, ALARM_SEVERITIES, CONDITION_LABELS, staleAfterSeconds, type AlarmCondition, type AlarmSeverity } from '@hydris/domain';
import { del, patch, post } from '@/lib/api';
import { invalidatePaths, useAction } from '@/lib/query';
import { fmtValue, label } from '@/lib/format';
import { Button, Card, Chip, EmptyState, ErrorState, IconButton, Input, LoadingBlock, Select, SeverityChip, Switch, Textarea } from '@/ui';
import { ConfirmDialog, Dialog } from '@/ui/overlay';
import type { AlarmRule } from './types';
import { CONDITION_SHORT, conditionTone, fmtDuration } from './bits';

interface SensorLite { id: string; tag: string; unit: string; decimals: number; expectedIntervalS: number }
const INVALIDATE = (sensorId: string) => ['/alarm-rules', '/sensors', `/telemetry/sensors/${sensorId}`];

export function RulesCard({ q, sensor, canManage }: { q: UseQueryResult<{ rules: AlarmRule[] }>; sensor: SensorLite; canManage: boolean }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<AlarmRule | 'new' | null>(null);
  const [removing, setRemoving] = useState<AlarmRule | null>(null);
  const toggle = useAction((r: AlarmRule) => patch<{ rule: AlarmRule }>(`/alarm-rules/${r.id}`, { enabled: !r.enabled }), {
    invalidate: INVALIDATE(sensor.id), success: (res) => (res.rule.enabled ? 'Rule enabled' : 'Rule disabled'),
  });

  const body = q.data ? (
    q.data.rules.length ? (
      <ul className="grid gap-2">
        {q.data.rules.map((r) => (
          <li key={r.id} className="card-inset flex flex-wrap items-start gap-3 p-4" style={{ opacity: r.enabled ? 1 : 0.6 }}>
            <span className="grid h-9 min-w-9 flex-none place-items-center rounded-full px-2 text-[12px] font-semibold" style={{ color: conditionTone(r.condition), background: 'var(--color-tint)', border: `1px solid ${conditionTone(r.condition)}` }} aria-hidden>{CONDITION_SHORT[r.condition]}</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{CONDITION_LABELS[r.condition]}</span>
                <span className="num text-text-2">{ruleLimit(r, sensor)}</span>
                <SeverityChip severity={r.severity} />
                {!r.enabled && <Chip tone="outline">Disabled</Chip>}
              </div>
              <div className="mt-1 text-xs text-muted">
                {r.name}
                {r.condition !== 'stale' && <> · deadband <span className="num">{fmtValue(r.deadband, undefined, sensor.decimals)} {sensor.unit}</span></>}
                {' · '}{r.onDelayS ? <>on-delay <span className="num">{fmtDuration(r.onDelayS)}</span></> : 'no on-delay'}
              </div>
              {r.recommendedAction && <p className="mt-2 line-clamp-2 text-[13px] text-text-2">{r.recommendedAction}</p>}
            </div>
            {canManage && (
              <div className="flex flex-none items-center gap-2">
                <Switch checked={r.enabled} onChange={() => toggle.mutate(r)} disabled={toggle.isPending} label={r.enabled ? 'On' : 'Off'} />
                <IconButton label={`Edit ${CONDITION_LABELS[r.condition]} rule`} size="sm" onClick={() => setEditing(r)}><Pencil size={15} strokeWidth={1.8} /></IconButton>
                <IconButton label={`Remove ${CONDITION_LABELS[r.condition]} rule`} size="sm" onClick={() => setRemoving(r)}><Trash2 size={15} strokeWidth={1.8} /></IconButton>
              </div>
            )}
          </li>
        ))}
      </ul>
    ) : <EmptyState icon={<BellRing size={20} aria-hidden />} title="No alarm rules" body={canManage ? 'Add a threshold so Hydris raises an alarm when this value leaves its safe band.' : 'No thresholds are configured for this sensor.'} />
  ) : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : <LoadingBlock rows={2} />;

  return (
    <Card title="Alarm rules" action={canManage ? <Button size="sm" icon={<Plus size={15} aria-hidden />} onClick={() => setEditing('new')}>Add rule</Button> : undefined}>
      {body}
      {canManage && <RuleDialog key={editing === 'new' ? 'new' : editing?.id ?? 'closed'} open={!!editing} rule={editing === 'new' ? null : editing} sensor={sensor} onOpenChange={(v) => !v && setEditing(null)} />}
      {removing && (
        <ConfirmDialog open onOpenChange={(v) => !v && setRemoving(null)} title="Remove this rule?" confirmLabel="Remove rule" destructive
          body={<>{CONDITION_LABELS[removing.condition]} {ruleLimit(removing, sensor)}. Rules that have already raised alarms are disabled instead of deleted, so past alarms keep their context.</>}
          onConfirm={async () => { await del(`/alarm-rules/${removing.id}`); invalidatePaths(qc, INVALIDATE(sensor.id)); }} />
      )}
    </Card>
  );
}

function ruleLimit(r: AlarmRule, s: SensorLite) {
  if (r.condition === 'stale') return `no data for > ${fmtDuration(staleAfterSeconds(s.expectedIntervalS))}`;
  return `${r.condition.startsWith('high') ? '>' : '<'} ${fmtValue(r.threshold, undefined, s.decimals)} ${s.unit}`;
}

interface Form { name: string; condition: AlarmCondition; threshold: string; deadband: string; onDelayS: string; severity: AlarmSeverity; recommendedAction: string; enabled: boolean }

function RuleDialog({ open, onOpenChange, rule, sensor }: { open: boolean; onOpenChange: (v: boolean) => void; rule: AlarmRule | null; sensor: SensorLite }) {
  const autoName = (c: AlarmCondition) => `${CONDITION_LABELS[c]} ${sensor.tag}`;
  const [f, setF] = useState<Form>(() => rule ? {
    name: rule.name, condition: rule.condition, threshold: rule.threshold === null ? '' : String(rule.threshold), deadband: String(rule.deadband),
    onDelayS: String(rule.onDelayS), severity: rule.severity, recommendedAction: rule.recommendedAction ?? '', enabled: rule.enabled,
  } : { name: autoName('high'), condition: 'high', threshold: '', deadband: '0', onDelayS: '0', severity: 'medium', recommendedAction: '', enabled: true });
  const [nameTouched, setNameTouched] = useState(!!rule);
  const [tried, setTried] = useState(false);
  const stale = f.condition === 'stale';

  const errs = {
    name: f.name.trim().length < 2 ? 'At least 2 characters' : null,
    threshold: stale ? null : f.threshold.trim() === '' || !Number.isFinite(Number(f.threshold)) ? 'Enter a numeric limit' : null,
    deadband: !Number.isFinite(Number(f.deadband)) || Number(f.deadband) < 0 ? 'Zero or a positive number' : null,
    onDelayS: !/^\d+$/.test(f.onDelayS.trim()) || Number(f.onDelayS) > 86400 ? 'Whole seconds, 0 – 86400' : null,
  };
  const valid = !Object.values(errs).some(Boolean);

  const save = useAction(async (v: Form) => {
    const body = {
      name: v.name.trim(), condition: v.condition, threshold: v.condition === 'stale' ? null : Number(v.threshold), deadband: Number(v.deadband || 0),
      onDelayS: Number(v.onDelayS || 0), severity: v.severity, recommendedAction: v.recommendedAction.trim() || null, enabled: v.enabled,
    };
    return rule ? patch(`/alarm-rules/${rule.id}`, body) : post('/alarm-rules', { ...body, sensorId: sensor.id });
  }, { invalidate: INVALIDATE(sensor.id), success: rule ? 'Rule updated' : 'Rule created', onSuccess: () => onOpenChange(false) });

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const err = (k: keyof typeof errs) => (tried ? errs[k] : null);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!save.isPending) onOpenChange(v); }} wide title={rule ? 'Edit alarm rule' : 'New alarm rule'}
      description={<>Applies to <b>{sensor.tag}</b>. Changes take effect on the next reading and reset any pending on-delay.</>}
      footer={<>
        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={save.isPending}>Cancel</Button>
        <Button variant="primary" busy={save.isPending} onClick={() => { setTried(true); if (valid) save.mutate(f); }}>{rule ? 'Save rule' : 'Create rule'}</Button>
      </>}>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); setTried(true); if (valid) save.mutate(f); }} noValidate>
        <Select label="Condition" value={f.condition} options={ALARM_CONDITIONS.map((c) => ({ value: c, label: CONDITION_LABELS[c] }))}
          onChange={(e) => { const c = e.target.value as AlarmCondition; setF((x) => ({ ...x, condition: c, name: nameTouched ? x.name : autoName(c) })); }} />
        <Select label="Severity" value={f.severity} options={ALARM_SEVERITIES.map((s) => ({ value: s, label: label(s) }))} onChange={(e) => set('severity', e.target.value as AlarmSeverity)} />
        {!stale ? (
          <>
            <Input label={`Threshold (${sensor.unit})`} inputMode="decimal" className="num" value={f.threshold} onChange={(e) => set('threshold', e.target.value)} error={err('threshold')}
              hint={f.condition.startsWith('high') ? 'Alarm when the value rises above this limit.' : 'Alarm when the value falls below this limit.'} />
            <Input label={`Deadband (${sensor.unit})`} inputMode="decimal" className="num" value={f.deadband} onChange={(e) => set('deadband', e.target.value)} error={err('deadband')}
              hint="Hysteresis: how far back inside the limit the value must return before the condition counts as cleared." />
          </>
        ) : (
          <p className="text-sm text-text-2 sm:col-span-2">Raises an alarm when no reading arrives for {fmtDuration(staleAfterSeconds(sensor.expectedIntervalS))} (5× the expected interval).</p>
        )}
        <Input label="On-delay (seconds)" inputMode="numeric" className="num" value={f.onDelayS} onChange={(e) => set('onDelayS', e.target.value)} error={err('onDelayS')}
          hint="The breach must persist this long before an alarm is raised. Filters short spikes." />
        <Input label="Rule name" value={f.name} maxLength={120} onChange={(e) => { setNameTouched(true); set('name', e.target.value); }} error={err('name')} />
        <div className="sm:col-span-2">
          <Textarea label="Recommended action (optional)" value={f.recommendedAction} maxLength={1000} onChange={(e) => set('recommendedAction', e.target.value)}
            hint="Shown to operators on the alarm and in the glasses." />
        </div>
        <div className="sm:col-span-2"><Switch checked={f.enabled} onChange={(v) => set('enabled', v)} label="Rule enabled" /></div>
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Dialog>
  );
}
