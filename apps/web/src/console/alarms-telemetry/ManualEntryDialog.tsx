'use client';

import { useState } from 'react';
import { MEASURAND_DEFS, type Measurand } from '@hydris/domain';
import { post } from '@/lib/api';
import { useAction } from '@/lib/query';
import { Button, Input, Select } from '@/ui';
import { Dialog } from '@/ui/overlay';

interface IngestResult { accepted: number; duplicates: number; alarmsRaised: number }

const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

/** Records a lab result (source 'lab') or a manual reading (source 'manual') through the single ingestion path. */
export function ManualEntryDialog({ open, onOpenChange, sensor, source }: {
  open: boolean; onOpenChange: (v: boolean) => void; source: 'lab' | 'manual';
  sensor: { id: string; tag: string; name: string; measurand: Measurand; unit: string };
}) {
  const def = MEASURAND_DEFS[sensor.measurand];
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState(def.unit);
  const [at, setAt] = useState(() => toLocalInput(new Date()));
  const [tried, setTried] = useState(false);

  const n = Number(value.replace(',', '.'));
  const conv = def.alternativeUnits.find((u) => u.unit === unit);
  const canonical = conv ? conv.toCanonical(n) : n;
  const when = new Date(at);
  const valueErr = value.trim() === '' || !Number.isFinite(n) ? 'Enter a number'
    : canonical < def.validRange[0] || canonical > def.validRange[1] ? `Outside the plausible range ${def.validRange[0]} – ${def.validRange[1]} ${def.unit}` : null;
  const atErr = !at || Number.isNaN(when.getTime()) ? 'Enter a date and time'
    : when.getTime() > Date.now() + 5 * 60_000 ? 'Cannot be in the future'
      : source === 'manual' && when.getTime() < Date.now() - 30 * 86400_000 ? 'Manual readings older than 30 days are not accepted' : null;

  const act = useAction(() => post<IngestResult>('/telemetry/manual', {
    sensorId: sensor.id, value: n, unit: unit === def.unit ? undefined : unit, ts: when.toISOString(), source,
  }), {
    invalidate: ['/telemetry', '/sensors', '/alarms', '/overview'],
    success: (r) => r.duplicates ? 'A reading already exists at that time. Nothing was changed.' : r.alarmsRaised ? `Recorded. ${r.alarmsRaised} alarm${r.alarmsRaised > 1 ? 's' : ''} raised.` : 'Reading recorded',
    onSuccess: () => { setValue(''); setTried(false); onOpenChange(false); },
  });
  const submit = () => { setTried(true); if (!valueErr && !atErr) act.mutate(undefined); };
  const isLab = source === 'lab';

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!act.isPending) onOpenChange(v); }} title={isLab ? 'Record lab result' : 'Record manual reading'}
      description={<>{sensor.tag} · {sensor.name}. {isLab ? 'Enter the laboratory result with the time the sample was taken. It is stored as a lab value and never shown as live.' : 'Enter the value read on site. It is stored as a manual reading.'} Thresholds are evaluated immediately.</>}
      footer={<>
        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={act.isPending}>Cancel</Button>
        <Button variant="primary" busy={act.isPending} onClick={submit}>Record</Button>
      </>}>
      <form className="grid gap-4" noValidate onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
          <Input label={`${def.label} value`} inputMode="decimal" className="num" autoFocus value={value} onChange={(e) => setValue(e.target.value)} error={tried ? valueErr : null}
            hint={def.typicalRange ? `Typical band ${def.typicalRange[0]} – ${def.typicalRange[1]} ${def.unit}` : undefined} />
          {def.alternativeUnits.length ? (
            <Select label="Unit" value={unit} onChange={(e) => setUnit(e.target.value)} options={[def.unit, ...def.alternativeUnits.map((u) => u.unit)].map((u) => ({ value: u, label: u }))}
              hint={unit !== def.unit ? `Stored in ${def.unit}` : undefined} />
          ) : <Input label="Unit" value={def.unit} readOnly aria-readonly />}
        </div>
        <Input type="datetime-local" label={isLab ? 'Sampled at' : 'Observed at'} value={at} max={toLocalInput(new Date())} onChange={(e) => setAt(e.target.value)} error={tried ? atErr : null}
          hint={`Your local time (${Intl.DateTimeFormat().resolvedOptions().timeZone}).`} />
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Dialog>
  );
}
