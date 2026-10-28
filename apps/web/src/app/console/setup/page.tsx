'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Building2, CheckCircle2, Circle, Smartphone, Users } from 'lucide-react';
import { post } from '@/lib/api';
import { useAction, useApi } from '@/lib/query';
import { useCan, useSessionCtx } from '@/lib/session';
import { Button, Card, Input, PageHeader, QueryView, Select, Skeleton } from '@/ui';
import { NoAccess, timezones } from '@/console/admin/parts';

interface Setup {
  organization: { id: string; name: string; region: string | null; timezone: string; setupCompletedAt: string | null };
  steps: { organization: boolean; site: boolean; operators: boolean };
  counts: { sites: number; operators: number; pendingInvitations: number };
}

/**
 * Setup wizard shown after administrator sign-up (stub for Phase 1): confirm the organization,
 * add a site, invite Field Operators, then finish. Each step links to the full console page.
 */
export default function SetupWizard() {
  const can = useCan();
  const allowed = can('org.manage');
  const q = useApi<Setup>(allowed ? '/org/setup' : null);
  const { reload } = useSessionCtx();
  const router = useRouter();
  const finish = useAction(() => post('/org/setup', { complete: true }), {
    invalidate: ['/org'], success: 'Setup complete',
    onSuccess: () => { void reload().then(() => router.replace('/console')); },
  });
  return (
    <>
      <PageHeader eyebrow="Getting started" title="Set up your organization" subtitle="Three short steps. You can change everything later in the console." />
      {!allowed ? <NoAccess what="organization setup" /> : (
        <QueryView q={q} loading={<Skeleton className="h-[420px] rounded-[24px]" />}>
          {(d) => (
            <div className="grid max-w-3xl gap-4 fade-in">
              <OrgStep key={d.organization.name + (d.organization.region ?? '')} setup={d} />
              <Step done={d.steps.site} icon={<Building2 size={18} aria-hidden />} title="2. Add your first site" body={d.counts.sites ? `${d.counts.sites} site(s) configured.` : 'Sites hold your facilities, assets and sensors. Operators are scoped to sites.'}
                action={<Link href="/console/sites" className="btn btn-secondary">{d.counts.sites ? 'Manage sites' : 'Add a site'}</Link>} />
              <Step done={d.steps.operators} icon={<Users size={18} aria-hidden />} title="3. Invite your Field Operators" body={d.steps.operators ? `${d.counts.operators} operator(s), ${d.counts.pendingInvitations} pending invitation(s).` : 'Invite operators one by one or from a CSV. They set a password from the email and install the Hydris Field app.'}
                action={<Link href="/console/operators" className="btn btn-secondary">Invite operators</Link>} />
              <Card>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="flex items-center gap-2 text-text-2"><Smartphone size={18} aria-hidden />Operators work in the Hydris Field app and on glasses; the console is for administrators.</p>
                  <Button variant="primary" busy={finish.isPending} onClick={() => finish.mutate(undefined)}>Finish setup</Button>
                </div>
              </Card>
            </div>
          )}
        </QueryView>
      )}
    </>
  );
}

function Step({ done, icon, title, body, action }: { done: boolean; icon: React.ReactNode; title: string; body: string; action: React.ReactNode }) {
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-4">
        <span className={done ? 'text-ok-text' : 'text-muted'}>{done ? <CheckCircle2 size={22} aria-label="Done" /> : <Circle size={22} aria-label="To do" />}</span>
        <div className="min-w-0 flex-1">
          <p className="t-card flex items-center gap-2">{icon}{title}</p>
          <p className="mt-1 text-sm text-text-2">{body}</p>
        </div>
        {action}
      </div>
    </Card>
  );
}

function OrgStep({ setup }: { setup: Setup }) {
  const o = setup.organization;
  const [name, setName] = useState(o.name);
  const [region, setRegion] = useState(o.region ?? '');
  const [timezone, setTimezone] = useState(o.timezone);
  const save = useAction((v: { name: string; region: string | null; timezone: string }) => post('/org/setup', v), { invalidate: ['/org'], success: 'Organization saved' });
  return (
    <Card>
      <div className="mb-4 flex items-center gap-4">
        <span className={setup.steps.organization ? 'text-ok-text' : 'text-muted'}>{setup.steps.organization ? <CheckCircle2 size={22} aria-label="Done" /> : <Circle size={22} aria-label="To do" />}</span>
        <p className="t-card">1. Confirm your organization</p>
      </div>
      <form className="grid gap-4 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); save.mutate({ name: name.trim(), region: region.trim() || null, timezone }); }}>
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
        <Input label="Region" value={region} onChange={(e) => setRegion(e.target.value)} maxLength={80} placeholder="e.g. Tamil Nadu, IN" />
        <Select label="Time zone" value={timezone} onChange={(e) => setTimezone(e.target.value)} options={timezones().map((t) => ({ value: t, label: t }))} />
        <div className="sm:col-span-3 flex justify-end"><Button type="submit" busy={save.isPending} disabled={name.trim().length < 2}>Save</Button></div>
      </form>
    </Card>
  );
}
