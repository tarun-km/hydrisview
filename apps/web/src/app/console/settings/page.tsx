'use client';

import { useMemo, useState } from 'react';
import { FlaskConical, Play, Square } from 'lucide-react';
import { patch, post } from '@/lib/api';
import { useAction, useApi } from '@/lib/query';
import { useCan, useSessionCtx } from '@/lib/session';
import { ago, fmtDate } from '@/lib/format';
import { Button, Card, Chip, EmptyState, Input, KeyValues, PageHeader, QueryView, Select, Skeleton } from '@/ui';
import { ConfirmDialog } from '@/ui/overlay';
import { NoAccess, timezones, useSites } from '@/console/admin/parts';

interface Org { id: string; name: string; slug: string; isDemo: boolean; region: string | null; timezone: string; status: 'active' | 'suspended'; createdAt: string; updatedAt: string }
interface Scenario { key: string; title: string; summary: string; expected: string[]; steps: number }
interface Run { id: string; siteId: string; scenarioKey: string; status: string; step: number; startedAt: string; startedBy: string | null; live: boolean }
interface Simulation { available: boolean; canControl: boolean; scenarios: Scenario[]; stepSeconds: number; running: Run[] }

export default function SettingsPage() {
  const can = useCan();
  const allowed = can('org.manage');
  const q = useApi<{ organization: Org }>(allowed ? '/org' : null);
  return (
    <>
      <PageHeader eyebrow="Admin" title="Organization settings" subtitle="Identity and defaults for this organization. Changes are recorded in the audit log." />
      {!allowed ? <NoAccess what="organization settings" /> : (
        <QueryView q={q} loading={<Skeleton className="h-[320px] rounded-[24px]" />}>
          {({ organization: o }) => (
            <div className="grid gap-4 fade-in">
              {o.isDemo && (
                <div className="flex flex-wrap items-start gap-3 rounded-[var(--radius-xl)] border border-dashed border-[rgb(25_84_241/0.45)] px-5 py-4 text-sm">
                  <FlaskConical size={18} className="mt-0.5 flex-none text-lime" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-lime">Demo organization</div>
                    <p className="mt-1 text-text-2">This tenant may receive synthetic telemetry from the Hydris simulator. Everything the simulator produces is labeled synthetic in the console, reports and exports. Customer organizations never accept simulator data.</p>
                  </div>
                </div>
              )}
              <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
                <OrgForm key={o.updatedAt} org={o} />
                <Card title="Organization record">
                  <KeyValues columns={1} items={[
                    ['Slug', <span key="s" className="font-mono text-[13px]">{o.slug}</span>],
                    ['Status', o.status === 'active' ? <Chip key="st" tone="ok">Active</Chip> : <Chip key="st" tone="high">Suspended</Chip>],
                    ['Type', o.isDemo ? 'Demo tenant' : 'Customer tenant'],
                    ['Created', fmtDate(o.createdAt)],
                    ['Organization id', <span key="i" className="break-all font-mono text-xs">{o.id}</span>],
                  ]} />
                  <p className="mt-4 text-xs text-muted">The slug and tenant type are set by Hydris platform administrators.</p>
                </Card>
              </div>
              <SimulatorPanel />
            </div>
          )}
        </QueryView>
      )}
    </>
  );
}

function OrgForm({ org }: { org: Org }) {
  const { reload } = useSessionCtx();
  const [name, setName] = useState(org.name);
  const [region, setRegion] = useState(org.region ?? '');
  const [tz, setTz] = useState(org.timezone);
  const zones = useMemo(() => {
    const z = timezones();
    return z.includes(org.timezone) ? z : [org.timezone, ...z];
  }, [org.timezone]);
  const act = useAction((v: { name?: string; region?: string | null; timezone?: string }) => patch('/org', v), {
    invalidate: ['/org'], success: 'Organization updated',
    // Refresh the session so the organization name in the console header updates.
    onSuccess: () => void reload(),
  });
  const body: { name?: string; region?: string | null; timezone?: string } = {};
  if (name.trim() !== org.name) body.name = name.trim();
  if (region.trim() !== (org.region ?? '')) body.region = region.trim() || null;
  if (tz !== org.timezone) body.timezone = tz;
  const dirty = Object.keys(body).length > 0;
  const nameErr = name.trim().length < 2 ? 'Use at least 2 characters' : null;
  return (
    <Card title="General">
      <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (dirty && !nameErr) act.mutate(body); }}>
        <Input label="Organization name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} error={nameErr} required />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Region (optional)" value={region} onChange={(e) => setRegion(e.target.value)} maxLength={80} placeholder="e.g. Gujarat, India" hint="Shown to platform administrators." />
          <Select label="Time zone" value={tz} onChange={(e) => setTz(e.target.value)} options={zones.map((z) => ({ value: z, label: z.replace(/_/g, ' ') }))}
            hint="Used for schedules and daily summaries. Records are always stored in UTC." />
        </div>
        <div className="flex justify-end gap-2">
          {dirty && <Button type="button" variant="ghost" onClick={() => { setName(org.name); setRegion(org.region ?? ''); setTz(org.timezone); }}>Discard</Button>}
          <Button type="submit" variant="primary" busy={act.isPending} disabled={!dirty || !!nameErr}>Save changes</Button>
        </div>
      </form>
    </Card>
  );
}

function SimulatorPanel() {
  const q = useApi<Simulation>('/simulation', { refetchInterval: (query) => ((query.state.data as Simulation | undefined)?.running.length ? 5000 : 30_000) });
  const sites = useSites();
  const [siteId, setSiteId] = useState('');
  const [stopOpen, setStopOpen] = useState(false);
  const start = useAction((v: { scenario: string; siteId: string }) => post('/simulation/start', v), { invalidate: ['/simulation'], success: 'Scenario started' });
  const stop = useAction(() => post('/simulation/stop'), { invalidate: ['/simulation'] });
  const siteList = sites.data?.sites ?? [];
  const effectiveSite = siteId || siteList[0]?.id || '';

  if (q.isLoading) return <Skeleton className="h-[200px] rounded-[24px]" />;
  if (!q.data) return null; // simulation status is optional context; errors are not blocking here
  const sim = q.data;
  if (!sim.available || !sim.canControl) {
    return (
      <Card title="Simulator">
        <p className="text-sm text-muted">{!sim.available
          ? 'The scenario simulator is only available in demo organizations on servers where it is enabled.'
          : 'Only organization administrators and factory managers can run simulator scenarios.'}</p>
      </Card>
    );
  }
  const byKey = new Map(sim.scenarios.map((s) => [s.key, s]));
  return (
    <Card title={<div><h2 className="t-card">Scenario simulator</h2><p className="t-label mt-1">Runs deterministic scenarios through the normal ingestion pipeline. Every reading it produces is labeled synthetic.</p></div>}
      action={sim.running.length ? <Button size="sm" variant="danger" icon={<Square size={13} aria-hidden />} onClick={() => setStopOpen(true)}>Stop all</Button> : undefined}>
      {sim.running.length > 0 && (
        <ul className="mb-5 grid gap-2">
          {sim.running.map((r) => {
            const sc = byKey.get(r.scenarioKey);
            const total = sc?.steps ?? 1;
            const loops = r.scenarioKey === 'normal_operations';
            const step = loops ? (r.step % total) + 1 : Math.min(r.step + 1, total);
            return (
              <li key={r.id} className="card card-lime card-tight grid gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium">{sc?.title ?? r.scenarioKey}</div>
                    <div className="text-xs opacity-70">{siteList.find((x) => x.id === r.siteId)?.name ?? 'Site'} · started {ago(r.startedAt)}{loops ? ' · loops continuously' : ''}</div>
                  </div>
                  <span className="chip chip-dark-on-lime num">{r.live ? `Step ${step} / ${total}` : 'Paused (server restarted)'}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-ink/15" role="progressbar" aria-label={`${sc?.title ?? 'Scenario'} progress`} aria-valuemin={0} aria-valuemax={total} aria-valuenow={step}>
                  <div className="h-full rounded-full bg-lime-ink transition-[width] duration-500" style={{ width: `${(step / total) * 100}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {siteList.length ? (
        <>
          <div className="mb-4 max-w-sm">
            <Select label="Run on site" value={effectiveSite} onChange={(e) => setSiteId(e.target.value)} options={siteList.map((s) => ({ value: s.id, label: `${s.name} (${s.code})` }))}
              hint="Starting a scenario stops any scenario already running on that site." />
          </div>
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {sim.scenarios.map((s) => {
              const running = sim.running.some((r) => r.scenarioKey === s.key && r.siteId === effectiveSite);
              return (
                <li key={s.key} className="card-inset flex flex-col gap-3 p-5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="t-card">{s.title}</div>
                    <span className="t-label num flex-none">~{Math.max(1, Math.round((s.steps * sim.stepSeconds) / 60))} min</span>
                  </div>
                  <p className="text-sm text-text-2">{s.summary}</p>
                  <div>
                    <div className="t-eyebrow mb-1.5">Expect</div>
                    <ul className="grid gap-1 text-[13px] text-text-2">
                      {s.expected.map((x) => <li key={x} className="flex gap-2"><span className="mt-[7px] h-1 w-1 flex-none rounded-full bg-lime" aria-hidden />{x}</li>)}
                    </ul>
                  </div>
                  <div className="mt-auto pt-1">
                    <Button size="sm" variant={running ? 'secondary' : 'light'} icon={<Play size={13} aria-hidden />} disabled={running || start.isPending}
                      busy={start.isPending && start.variables?.scenario === s.key} onClick={() => start.mutate({ scenario: s.key, siteId: effectiveSite })}>
                      {running ? 'Running' : 'Start scenario'}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      ) : <EmptyState title="No sites" body="Create a site before running simulator scenarios." />}
      <ConfirmDialog open={stopOpen} onOpenChange={setStopOpen} title="Stop all scenarios?" body="Synthetic readings stop immediately. Alarms, inspections and tasks already created by the scenarios stay in place."
        confirmLabel="Stop scenarios" onConfirm={() => stop.mutateAsync(undefined)} />
    </Card>
  );
}
