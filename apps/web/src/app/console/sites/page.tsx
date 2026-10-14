'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Archive, ArchiveRestore, Building2, MapPin, Plus, Route } from 'lucide-react';
import { post } from '@/lib/api';
import { useApi } from '@/lib/query';
import { useCan, useSession } from '@/lib/session';
import { Button, EmptyState, IconButton, OpenLink, PageHeader, QueryView, SeverityChip, Skeleton, StateChip, Switch } from '@/ui';
import { ConfirmDialog } from '@/ui/overlay';
import { useQueryClient } from '@tanstack/react-query';
import { invalidatePaths } from '@/lib/query';
import { PLANT_PATHS, SiteFormDialog } from '@/console/plant/forms';
import type { SiteListItem } from '@/console/plant/types';

export default function SitesPage() {
  const can = useCan();
  const session = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [archiving, setArchiving] = useState<SiteListItem | null>(null);
  const q = useApi<{ sites: SiteListItem[] }>(`/sites${showArchived ? '?archived=true' : ''}`);
  const canManage = can('site.manage');
  const canCreate = canManage && session.siteScope === 'all';

  const totals = q.data?.sites.filter((s) => !s.archivedAt).reduce((a, s) => ({ assets: a.assets + s.assets, open: a.open + s.openAlarms, crit: a.crit + s.criticalAlarms }), { assets: 0, open: 0, crit: 0 });

  return (
    <>
      <PageHeader
        eyebrow="Plant · Sites & facilities"
        title="Sites"
        subtitle={totals ? `${q.data!.sites.filter((s) => !s.archivedAt).length} active sites · ${totals.assets} assets · ${totals.open} open alarms${totals.crit ? `, ${totals.crit} critical` : ''}` : 'Physical plant locations, their facilities and equipment.'}
        actions={<>
          {canManage && <Switch checked={showArchived} onChange={setShowArchived} label="Show archived" />}
          {canCreate && <Button variant="primary" icon={<Plus size={16} />} onClick={() => setCreating(true)}>New site</Button>}
        </>}
      />
      {canManage && !canCreate && (
        <p className="mb-4 text-sm text-muted">Only organization-wide managers can create new sites. You can edit the sites assigned to you.</p>
      )}

      <QueryView q={q} loading={<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[220px] rounded-[24px]" />)}</div>}>
        {(d) => d.sites.length === 0 ? (
          <EmptyState icon={<Building2 size={20} aria-hidden />} title={showArchived ? 'No sites' : 'No sites yet'}
            body={canCreate ? 'Create the first site to start modelling facilities, process areas and equipment.' : 'No sites are assigned to you yet. Ask an administrator for access.'}
            action={canCreate ? <Button variant="primary" icon={<Plus size={16} />} onClick={() => setCreating(true)}>New site</Button> : undefined} />
        ) : (
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 fade-in">
            {d.sites.map((s) => (
              <li key={s.id}>
                <article className={`card relative flex h-full flex-col gap-5 ${s.archivedAt ? 'opacity-60' : ''}`} aria-labelledby={`site-${s.id}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="t-eyebrow">{s.code}</div>
                      <h2 id={`site-${s.id}`} className="t-section mt-1 truncate">
                        <Link href={`/console/sites/${s.id}`} className="hover:underline focus-visible:underline">{s.name}</Link>
                      </h2>
                      <p className="mt-1 flex items-center gap-1.5 text-sm text-text-2">
                        <MapPin size={14} aria-hidden /> {[s.city, s.country].filter(Boolean).join(', ') || 'Location not set'}
                      </p>
                    </div>
                    <OpenLink href={`/console/sites/${s.id}`} label={`Open ${s.name}`} />
                  </div>
                  <dl className="grid grid-cols-3 gap-3">
                    <Metric label="Facilities" value={s.facilities} />
                    <Metric label="Assets" value={s.assets} />
                    <Metric label="Open alarms" value={s.openAlarms} accent={s.criticalAlarms ? 'critical' : s.openAlarms ? 'high' : undefined} />
                  </dl>
                  <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
                    <div className="flex flex-wrap gap-2">
                      {s.archivedAt ? <StateChip state="archived" /> : s.criticalAlarms ? <SeverityChip severity="critical" /> : s.openAlarms ? <StateChip state="acknowledged" label={`${s.openAlarms} open`} /> : <StateChip state="operational" label="Normal" />}
                      {s.criticalAlarms > 0 && !s.archivedAt && <span className="chip chip-critical num">{s.criticalAlarms} critical</span>}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {!s.archivedAt && <IconButton label={`Open ${s.name} on the plant map`} size="sm" tone="ghost" onClick={() => router.push(`/console/map?siteId=${s.id}`)}><Route size={15} /></IconButton>}
                      {canManage && (
                        <IconButton label={s.archivedAt ? `Restore ${s.name}` : `Archive ${s.name}`} size="sm" tone="ghost" onClick={() => setArchiving(s)}>
                          {s.archivedAt ? <ArchiveRestore size={15} /> : <Archive size={15} />}
                        </IconButton>
                      )}
                    </div>
                  </div>
                </article>
              </li>
            ))}
          </ul>
        )}
      </QueryView>

      <SiteFormDialog open={creating} onOpenChange={setCreating} onSaved={(s) => router.push(`/console/sites/${s.id}`)} />
      <ConfirmDialog
        open={!!archiving}
        onOpenChange={(v) => { if (!v) setArchiving(null); }}
        title={archiving?.archivedAt ? `Restore ${archiving?.name}?` : `Archive ${archiving?.name}?`}
        body={archiving?.archivedAt
          ? 'The site will appear again in navigation, the plant map and reports.'
          : 'The site is hidden from navigation, the plant map and new work. Its history, assets and records are kept and it can be restored at any time.'}
        confirmLabel={archiving?.archivedAt ? 'Restore site' : 'Archive site'}
        destructive={!archiving?.archivedAt}
        onConfirm={async () => {
          await post(`/sites/${archiving!.id}/archive`, { archived: !archiving!.archivedAt });
          invalidatePaths(qc, PLANT_PATHS);
        }}
      />
    </>
  );
}

function Metric({ label, value, accent }: { label: string; value: number; accent?: 'critical' | 'high' }) {
  return (
    <div className="rounded-2xl bg-bg-2 px-3 py-3">
      <dt className="t-label">{label}</dt>
      <dd className="t-kpi-sm mt-1" style={accent ? { color: `var(--color-${accent})` } : undefined}>{value}</dd>
    </div>
  );
}
