'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Check, CheckCircle2, ClipboardList, ScanLine, X } from 'lucide-react';
import { post } from '@/lib/api';
import { invalidatePaths, useApi } from '@/lib/query';
import { useCan, useSession } from '@/lib/session';
import { ago, fmtDateTime } from '@/lib/format';
import { Avatar, Button, Capsule, Card, Chip, EmptyState, KpiCard, PageHeader, QueryView, Skeleton, StateChip, SyntheticBadge } from '@/ui';
import { ConfirmDialog } from '@/ui/overlay';
import { NoAccess } from '@/console/admin/parts';
import { PendingDevicesCard, type PendingDevice } from '@/console/command/pending';

interface Approvals {
  inspections: { id: string; title: string; submittedAt: string | null; submittedVia: string | null; siteName: string; assetTag: string | null; by: string | null; byId: string | null; priority: string; synthetic: boolean }[];
  devices?: PendingDevice[];
  documents: { id: string; title: string; status: 'in_review' | 'verified'; docType: string; createdAt: string; pageCount: number; capturedVia: string; siteName: string | null; by: string | null; byId: string | null; verifiedAt: string | null }[];
}

type Tab = 'all' | 'scans' | 'inspections';
type Item =
  | { kind: 'inspection'; id: string; title: string; at: string | null; by: string | null; byId: string | null; where: string; detail: string; synthetic: boolean; ready: boolean; status: string }
  | { kind: 'scan'; id: string; title: string; at: string | null; by: string | null; byId: string | null; where: string; detail: string; synthetic: false; ready: boolean; status: string };

const DAY = 24 * 3600_000;

/** Unified approvals queue: scanned audit documents and submitted inspections awaiting sign-off. */
export default function ApprovalsPage() {
  const can = useCan();
  const s = useSession();
  const allowed = can('console.access');
  const q = useApi<Approvals>(allowed ? '/command/approvals' : null, { refetchInterval: 30_000 });
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('all');
  const [decide, setDecide] = useState<{ item: Item; decision: 'approve' | 'reject' } | null>(null);

  const decideOn = async (note: string) => {
    if (!decide) return;
    const { item, decision } = decide;
    if (item.kind === 'inspection') await post(`/inspections/${item.id}/${decision}`, { note: note || undefined });
    else await post(`/audit-docs/${item.id}/approve`, { decision, note: note || undefined });
    invalidatePaths(qc, ['/command', '/inspections', '/audit-docs', '/overview']);
  };

  return (
    <>
      <PageHeader eyebrow="Work" title="Approvals"
        subtitle="Everything your field team has submitted that needs an administrator's sign-off: new or transferred glasses, scanned audit documents and completed inspections. Oldest first." />
      {!allowed ? <NoAccess what="approvals" /> : (
        <QueryView q={q} loading={<div className="grid grid-cols-[minmax(0,1fr)] gap-4"><div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[148px] rounded-[24px]" />)}</div><Skeleton className="h-[420px] rounded-[24px]" /></div>}>
          {(d) => {
            const items: Item[] = [
              ...d.documents.map((x): Item => ({
                kind: 'scan', id: x.id, title: x.title, at: x.createdAt, by: x.by, byId: x.byId, where: x.siteName ?? 'No site', synthetic: false,
                detail: `${x.pageCount} page${x.pageCount === 1 ? '' : 's'} · ${x.docType.replace(/_/g, ' ')} · via ${x.capturedVia}`, ready: x.status === 'verified', status: x.status,
              })),
              ...d.inspections.map((x): Item => ({
                kind: 'inspection', id: x.id, title: x.title, at: x.submittedAt, by: x.by, byId: x.byId, where: [x.siteName, x.assetTag].filter(Boolean).join(' · '), synthetic: x.synthetic,
                detail: `Submitted${x.submittedVia ? ` via ${x.submittedVia}` : ''}${x.priority === 'high' ? ' · high priority' : ''}`, ready: true, status: 'submitted',
              })),
            ].sort((a, b) => (a.at ? Date.parse(a.at) : 0) - (b.at ? Date.parse(b.at) : 0));
            const shown = items.filter((i) => tab === 'all' || (tab === 'scans' ? i.kind === 'scan' : i.kind === 'inspection'));
            const old = items.filter((i) => i.at && Date.now() - Date.parse(i.at) > DAY).length;
            return (
              <div className="grid grid-cols-[minmax(0,1fr)] gap-4 fade-in">
                <div className="stagger grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
                  <KpiCard label="Awaiting approval" value={items.length + (d.devices?.length ?? 0)} accent={items.length + (d.devices?.length ?? 0) ? 'high' : undefined} sub={items.length ? `oldest ${ago(items[0]!.at)}` : 'Queue is clear'} />
                  <KpiCard label="Scans to review" value={d.documents.filter((x) => x.status === 'in_review').length} href="/console/audit-docs" sub="Field review not yet verified" />
                  <KpiCard label="Scans ready to approve" value={d.documents.filter((x) => x.status === 'verified').length} sub="Verified, waiting for final sign-off" />
                  <KpiCard label="Waiting over 24 h" value={old} accent={old ? 'critical' : undefined} sub={`${d.inspections.length} inspections in review`} />
                </div>
                <PendingDevicesCard devices={d.devices ?? []} />
                <Card>
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <Capsule label="Approval type" value={tab} onChange={setTab} options={[
                      { value: 'all', label: 'All', count: items.length },
                      { value: 'scans', label: 'Audit documents', count: d.documents.length },
                      { value: 'inspections', label: 'Inspections', count: d.inspections.length },
                    ]} />
                  </div>
                  {!shown.length ? (
                    <EmptyState icon={<CheckCircle2 size={20} className="text-ok-text" />} title="Nothing waiting for you" body="New scans and submitted inspections appear here as soon as operators send them." />
                  ) : (
                    <ul className="stagger grid grid-cols-[minmax(0,1fr)] gap-2">
                      {shown.map((i) => {
                        const href = i.kind === 'scan' ? `/console/audit-docs/${i.id}` : `/console/inspections/${i.id}`;
                        const late = !!i.at && Date.now() - Date.parse(i.at) > DAY;
                        const mine = i.byId === s.user.id;
                        return (
                          <li key={`${i.kind}-${i.id}`} className="card-inset flex flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap">
                            <span className="grid h-10 w-10 flex-none place-items-center rounded-full bg-surface-2 text-text-2">{i.kind === 'scan' ? <ScanLine size={17} aria-hidden /> : <ClipboardList size={17} aria-hidden />}</span>
                            <Link href={href} className="min-w-0 flex-1 basis-[220px]">
                              <span className="flex items-center gap-2"><span className="truncate text-[15px] font-medium">{i.title}</span>{i.synthetic && <SyntheticBadge />}</span>
                              <span className="block truncate text-xs text-muted">{i.where} · {i.detail}</span>
                            </Link>
                            <span className="flex flex-none items-center gap-2 text-[13px] text-text-2">
                              {i.by && <Avatar name={i.by} size={24} />}<span className="max-w-[120px] truncate">{i.by ?? 'Unknown'}</span>
                            </span>
                            <span className={`num w-[110px] flex-none text-right text-[13px] ${late ? 'text-high-text' : 'text-muted'}`} title={i.at ? fmtDateTime(i.at) : undefined}>{i.at ? ago(i.at) : '—'}</span>
                            {i.kind === 'scan' ? <StateChip state={i.status} label={i.status === 'verified' ? 'Verified' : 'In review'} /> : <Chip tone="outline">Inspection</Chip>}
                            <span className="flex flex-none gap-1.5">
                              {i.ready && !mine ? <>
                                <Button size="sm" variant="primary" icon={<Check size={14} aria-hidden />} onClick={() => setDecide({ item: i, decision: 'approve' })}>Approve</Button>
                                <Button size="sm" variant="ghost" icon={<X size={14} aria-hidden />} onClick={() => setDecide({ item: i, decision: 'reject' })}>Reject</Button>
                              </> : <Link href={href} className="btn btn-secondary btn-sm">Review <ArrowUpRight size={14} aria-hidden /></Link>}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Card>
                <ConfirmDialog open={!!decide} onOpenChange={(v) => !v && setDecide(null)} destructive={decide?.decision === 'reject'}
                  title={decide ? `${decide.decision === 'approve' ? 'Approve' : 'Reject'} “${decide.item.title}”?` : ''}
                  body={decide?.decision === 'approve' ? 'This records your sign-off in the audit trail.' : 'The submitter is told what needs correcting; the item goes back to them.'}
                  noteLabel={decide?.decision === 'reject' ? 'What needs to be corrected' : 'Note'} noteRequired={decide?.decision === 'reject'}
                  confirmLabel={decide?.decision === 'approve' ? 'Approve' : 'Reject'} onConfirm={decideOn} />
              </div>
            );
          }}
        </QueryView>
      )}
    </>
  );
}
