'use client';

import { useEffect, useState } from 'react';
import { patch } from '@/lib/api';
import { useAction } from '@/lib/query';
import { Button, Input, Select, Switch } from '@/ui';
import { Dialog } from '@/ui/overlay';
import { FormError, fieldErrors } from '@/console/work/shared';

export interface SensorDetail {
  sensor: {
    id: string; siteId: string; assetId: string | null; tag: string; name: string; measurand: string; unit: string; method: 'continuous' | 'lab' | 'manual';
    expectedIntervalS: number; gatewayId: string | null; sourceRef: string | null; enabled: boolean; archivedAt: string | null; updatedAt: string; label: string;
  };
  asset: { id: string; tag: string; name: string } | null;
  gateway: { id: string; name: string; status: string } | null;
  gateways: { id: string; name: string; status: string; protocol: string }[];
  counts: { rules: number; readings: number; corrections: number };
}

const UNITS = [{ value: '1', label: 'seconds' }, { value: '60', label: 'minutes' }, { value: '3600', label: 'hours' }, { value: '86400', label: 'days' }];
const TAG_RE = /^[A-Za-z0-9._-]+$/;

/** Edit sensor identity, expected reporting interval and gateway binding. Measurand and unit are fixed to keep stored history consistent. */
export function SensorEditDialog({ open, onOpenChange, detail }: { open: boolean; onOpenChange: (v: boolean) => void; detail: SensorDetail }) {
  const s = detail.sensor;
  const [name, setName] = useState(s.name);
  const [tag, setTag] = useState(s.tag);
  const [every, setEvery] = useState('');
  const [unit, setUnit] = useState('60');
  const [gatewayId, setGatewayId] = useState(s.gatewayId ?? '');
  const [sourceRef, setSourceRef] = useState(s.sourceRef ?? '');
  const [enabled, setEnabled] = useState(s.enabled);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (!open) return;
    const u = [86400, 3600, 60, 1].find((x) => s.expectedIntervalS % x === 0) ?? 1;
    setName(s.name); setTag(s.tag); setEvery(String(s.expectedIntervalS / u)); setUnit(String(u));
    setGatewayId(s.gatewayId ?? ''); setSourceRef(s.sourceRef ?? ''); setEnabled(s.enabled); setTried(false);
  }, [open, s.id, s.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useAction((b: Record<string, unknown>) => patch(`/sensors/${s.id}`, b), {
    invalidate: ['/sensors', '/telemetry', '/assets', '/hierarchy', '/history'], success: 'Sensor saved', onSuccess: () => onOpenChange(false),
  });
  const server = fieldErrors(save.error);
  const interval = Math.round(Number(every) * Number(unit));
  const errs = {
    name: name.trim().length < 2 ? 'At least 2 characters' : null,
    tag: !tag.trim() ? 'Required' : !TAG_RE.test(tag.trim()) ? 'Letters, digits, dot, dash or underscore' : tag.trim().length > 24 ? 'At most 24 characters' : null,
    expectedIntervalS: !Number.isFinite(interval) || interval < 1 ? 'Enter a positive interval' : interval > 30 * 86400 ? 'At most 30 days' : null,
  };
  const submit = () => {
    setTried(true);
    if (Object.values(errs).some(Boolean)) return;
    const body: Record<string, unknown> = {};
    if (name.trim() !== s.name) body.name = name.trim();
    if (tag.trim() !== s.tag) body.tag = tag.trim();
    if (interval !== s.expectedIntervalS) body.expectedIntervalS = interval;
    if ((gatewayId || null) !== s.gatewayId) body.gatewayId = gatewayId || null;
    if ((sourceRef.trim() || null) !== s.sourceRef) body.sourceRef = sourceRef.trim() || null;
    if (enabled !== s.enabled) body.enabled = enabled;
    if (!Object.keys(body).length) { onOpenChange(false); return; }
    save.mutate(body);
  };
  const err = (k: keyof typeof errs) => (tried ? errs[k] : null) ?? server[k] ?? null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!save.isPending) onOpenChange(v); }} title={`Edit ${s.tag}`}
      description={`${s.label} · ${s.unit}. The measurand and unit cannot change, so stored history stays comparable.`}
      footer={<>
        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={save.isPending}>Cancel</Button>
        <Button variant="primary" busy={save.isPending} onClick={submit}>Save changes</Button>
      </>}>
      <form className="grid gap-4" noValidate onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <fieldset disabled={save.isPending} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
            <Input label="Tag" className="font-mono" value={tag} onChange={(e) => setTag(e.target.value)} error={err('tag')} />
            <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} error={err('name')} />
          </div>
          <div className="grid grid-cols-[1fr_140px] gap-4">
            <Input label="Expected reporting interval" inputMode="numeric" className="num" value={every} onChange={(e) => setEvery(e.target.value)} error={err('expectedIntervalS')}
              hint="Used to flag the value as stale and for stale-data alarms." />
            <Select label="Unit" value={unit} onChange={(e) => setUnit(e.target.value)} options={UNITS} />
          </div>
          {s.method === 'continuous' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Select label="Edge gateway" value={gatewayId} onChange={(e) => setGatewayId(e.target.value)} placeholder="Any gateway on this site" error={server.gatewayId ?? null}
                options={detail.gateways.map((g) => ({ value: g.id, label: `${g.name}${g.status !== 'active' ? ' (revoked)' : ''}` }))}
                hint={detail.gateways.length ? undefined : 'No gateways on this site yet'} />
              <Input label="Gateway reference" className="font-mono" value={sourceRef} onChange={(e) => setSourceRef(e.target.value)} error={server.sourceRef ?? null}
                hint="Name the gateway uses for this signal, if different from the tag." />
            </div>
          )}
          <Switch checked={enabled} onChange={setEnabled} label={enabled ? 'Enabled: accepts new readings' : 'Disabled: new readings are rejected'} />
        </fieldset>
        {save.error && !Object.keys(server).length ? <FormError error={save.error} /> : null}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Dialog>
  );
}
