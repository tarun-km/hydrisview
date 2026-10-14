'use client';

import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Building2, Plus, ShieldAlert } from 'lucide-react';
import { post } from '@/lib/api';
import { invalidatePaths, useAction, useApi } from '@/lib/query';
import { useSession } from '@/lib/session';
import { fmtDate } from '@/lib/format';
import { Button, Card, Chip, DataTable, EmptyState, Input, PageHeader, QueryView, Select, Skeleton, Switch, type Column } from '@/ui';
import { ConfirmDialog, Dialog } from '@/ui/overlay';
import { CopyField, timezones } from '@/console/admin/parts';

interface OrgRow { id: string; name: string; slug: string; isDemo: boolean; status: 'active' | 'suspended'; region: string | null; createdAt: string; members: number; sites: number }

export default function PlatformPage() {
  const s = useSession();
  if (!s.user.isPlatformAdmin) {
    return (
      <>
        <PageHeader eyebrow="Platform" title="Platform administration" />
        <EmptyState icon={<ShieldAlert size={20} aria-hidden />} title="Not authorized" body="Platform administration is limited to Hydris platform administrators. Organization settings are under Admin in the navigation." />
      </>
    );
  }
  return <Platform />;
}

function Platform() {
  const q = useApi<{ organizations: OrgRow[] }>('/platform/organizations');
  const qc = useQueryClient();
  const [create, setCreate] = useState(false);
  const [target, setTarget] = useState<OrgRow | null>(null);
  const columns: Column<OrgRow>[] = [
    { key: 'name', header: 'Organization', cell: (o) => (
      <span className="flex min-w-[200px] items-center gap-3">
        <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-surface-2"><Building2 size={16} aria-hidden /></span>
        <span className="min-w-0"><span className="block truncate">{o.name}</span><span className="block font-mono text-xs text-muted">{o.slug}</span></span>
      </span>
    ) },
    { key: 'type', header: 'Type', cell: (o) => o.isDemo ? <Chip tone="synthetic">Demo</Chip> : <Chip tone="outline">Customer</Chip> },
    { key: 'status', header: 'Status', cell: (o) => o.status === 'active' ? <Chip tone="ok">Active</Chip> : <Chip tone="high">Suspended</Chip> },
    { key: 'region', header: 'Region', cell: (o) => o.region ?? <span className="text-muted">—</span> },
    { key: 'members', header: 'Members', className: 'text-right', cell: (o) => <span className="num">{o.members}</span> },
    { key: 'sites', header: 'Sites', className: 'text-right', cell: (o) => <span className="num">{o.sites}</span> },
    { key: 'created', header: 'Created', cell: (o) => <span className="num whitespace-nowrap text-text-2">{fmtDate(o.createdAt)}</span> },
    { key: 'actions', header: <span className="sr-only">Actions</span>, className: 'text-right', cell: (o) => (
      <Button size="sm" variant={o.status === 'active' ? 'danger' : 'secondary'} onClick={() => setTarget(o)}>{o.status === 'active' ? 'Suspend' : 'Reactivate'}</Button>
    ) },
  ];
  return (
    <>
      <PageHeader eyebrow="Platform" title="Platform administration" subtitle="Tenants on this Hydris deployment. Data stays isolated per organization; this view shows only counts."
        actions={<Button variant="primary" icon={<Plus size={16} aria-hidden />} onClick={() => setCreate(true)}>Create organization</Button>} />
      <QueryView q={q} loading={<Skeleton className="h-[360px] rounded-[24px]" />}>
        {({ organizations }) => (
          <div className="grid gap-4 fade-in">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="card card-paper card-tight"><div className="text-sm opacity-75">Organizations</div><div className="t-kpi-sm mt-2">{organizations.length}</div></div>
              <div className="card card-tight"><div className="text-sm text-text-2">Active members</div><div className="t-kpi-sm mt-2">{organizations.reduce((a, o) => a + o.members, 0)}</div></div>
              <div className="card card-tight"><div className="text-sm text-text-2">Suspended</div><div className="t-kpi-sm mt-2">{organizations.filter((o) => o.status === 'suspended').length}</div></div>
            </div>
            <Card>
              <DataTable rows={organizations} columns={columns} rowKey={(o) => o.id} empty={<EmptyState title="No organizations yet" body="Create the first organization and send its administrator the invitation link." />} />
            </Card>
          </div>
        )}
      </QueryView>
      {create && <CreateDialog onClose={() => setCreate(false)} />}
      <ConfirmDialog open={!!target} onOpenChange={(v) => !v && setTarget(null)} destructive={target?.status === 'active'}
        title={target?.status === 'active' ? `Suspend ${target?.name}?` : `Reactivate ${target?.name}?`}
        body={target?.status === 'active'
          ? 'Members of this organization lose access and its glasses stop receiving work until it is reactivated. No data is deleted.'
          : 'Members regain access with their existing roles.'}
        confirmLabel={target?.status === 'active' ? 'Suspend organization' : 'Reactivate organization'}
        onConfirm={async () => { await post(`/platform/organizations/${target!.id}/status`, { status: target!.status === 'active' ? 'suspended' : 'active' }); invalidatePaths(qc, ['/platform']); }} />
    </>
  );
}

const slugify = (v: string) => v.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

function CreateDialog({ onClose }: { onClose: () => void }) {
  const zones = useMemo(() => timezones(), []);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [region, setRegion] = useState('');
  const [tz, setTz] = useState('UTC');
  const [isDemo, setIsDemo] = useState(false);
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [touched, setTouched] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const act = useAction((v: unknown) => post<{ adminInvitationLink: string }>('/platform/organizations', v), {
    invalidate: ['/platform'], success: 'Organization created', onSuccess: (r) => setLink(r.adminInvitationLink),
  });
  const effSlug = slugEdited ? slug : slugify(name);
  const errs = {
    name: name.trim().length < 2 ? 'Use at least 2 characters' : null,
    slug: !/^[a-z0-9-]{2,40}$/.test(effSlug) ? 'Lowercase letters, digits and hyphens, 2–40 characters' : null,
    adminName: adminName.trim().length < 2 ? 'Enter the administrator name' : null,
    adminEmail: !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail.trim()) ? 'Enter a valid email address' : null,
  };
  const invalid = Object.values(errs).some(Boolean);
  const submit = () => {
    setTouched(true);
    if (invalid) return;
    act.mutate({ name: name.trim(), slug: effSlug, region: region.trim() || undefined, timezone: tz, isDemo, admin: { name: adminName.trim(), email: adminEmail.trim() } });
  };
  const e = (k: keyof typeof errs) => (touched ? errs[k] : null);

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} wide title={link ? 'Organization created' : 'Create organization'}
      description={link ? `${adminEmail} has been emailed an invitation to administer ${name}. You can also share the link below; it is single-use and expires in 7 days.` : 'The first administrator receives an invitation and sets their own password.'}
      footer={link ? <Button variant="primary" onClick={onClose}>Done</Button> : <>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" busy={act.isPending} onClick={submit}>Create organization</Button>
      </>}>
      {link ? <CopyField label="Administrator invitation link" value={link} mono /> : (
        <form className="grid gap-5" onSubmit={(ev) => { ev.preventDefault(); submit(); }}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Organization name" value={name} onChange={(ev) => setName(ev.target.value)} maxLength={120} error={e('name')} autoFocus />
            <Input label="Slug" value={effSlug} onChange={(ev) => { setSlugEdited(true); setSlug(ev.target.value.toLowerCase()); }} maxLength={40} error={e('slug')} hint="Permanent identifier, unique across the platform." className="font-mono text-[13.5px]" />
            <Input label="Region (optional)" value={region} onChange={(ev) => setRegion(ev.target.value)} maxLength={80} />
            <Select label="Time zone" value={tz} onChange={(ev) => setTz(ev.target.value)} options={zones.map((z) => ({ value: z, label: z.replace(/_/g, ' ') }))} />
          </div>
          <div className="card-inset grid gap-1 p-4">
            <Switch checked={isDemo} onChange={setIsDemo} label="Demo tenant" />
            <p className="text-xs text-muted">Demo tenants may receive simulator data, always labeled synthetic. This cannot be changed from the organization itself.</p>
          </div>
          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="t-eyebrow mb-3">First administrator</legend>
            <Input label="Name" value={adminName} onChange={(ev) => setAdminName(ev.target.value)} maxLength={120} error={e('adminName')} />
            <Input label="Email" type="email" value={adminEmail} onChange={(ev) => setAdminEmail(ev.target.value)} error={e('adminEmail')} />
          </fieldset>
        </form>
      )}
    </Dialog>
  );
}
