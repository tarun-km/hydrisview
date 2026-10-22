'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AlertTriangle, FileScan, Glasses, Monitor, ScanLine, Smartphone } from 'lucide-react';
import { useApi } from '@/lib/query';
import { useCan } from '@/lib/session';
import { ago } from '@/lib/format';
import { Button, Capsule, Chip, EmptyState, KpiCard, PageHeader, Progress, QueryView, Skeleton } from '@/ui';
import { Dialog } from '@/ui/overlay';
import { STATUS_LABEL, ScanComposer, engineLabel, statusTone, type AuditDocSummary } from '@/console/work/auditdocs';

type Filter = 'all' | 'in_review' | 'verified' | 'approved' | 'rejected';

export default function AuditDocsPage() {
  const can = useCan();
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('all');
  const [scanOpen, setScanOpen] = useState(false);
  const q = useApi<AuditDocSummary[]>('/audit-docs', { refetchInterval: 15_000 });
  const all = q.data ?? [];
  const rows = filter === 'all' ? all : all.filter((d) => d.status === filter);
  const count = (s: Filter) => all.filter((d) => d.status === s).length;
  const scored = all.filter((d) => d.agreement !== null);
  const avgAgree = scored.length ? Math.round((scored.reduce((s, d) => s + d.agreement!, 0) / scored.length) * 100) : null;

  return (
    <>
      <PageHeader eyebrow="Work · Compliance" title="Audit documents"
        subtitle="Paper records scanned on the field glasses or here: every value is read by independent engines, cross-checked, reviewed by a person and approved by another."
        actions={can('auditdoc.capture') ? <Button variant="primary" icon={<ScanLine size={16} />} onClick={() => setScanOpen(true)}>Scan document</Button> : undefined} />

      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Awaiting review" value={count('in_review')} sub="field-by-field check" accent={count('in_review') ? 'high' : undefined} />
        <KpiCard label="Awaiting approval" value={count('verified')} sub="second person sign-off" />
        <KpiCard label="Approved" value={count('approved')} sub="locked · PDF archived" accent="ok" />
        <KpiCard label="Engine agreement" value={avgAgree ?? '—'} unit={avgAgree === null ? undefined : '%'} sub="values read identically by independent engines" tone="lime" />
      </div>

      <div className="card card-tight mb-4 flex flex-wrap items-center gap-3">
        <Capsule label="Status" value={filter} onChange={setFilter} options={[
          { value: 'all', label: 'All', count: all.length }, { value: 'in_review', label: 'In review', count: count('in_review') },
          { value: 'verified', label: 'Verified', count: count('verified') }, { value: 'approved', label: 'Approved', count: count('approved') },
          { value: 'rejected', label: 'Rejected', count: count('rejected') },
        ]} />
      </div>

      <QueryView q={q} loading={<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[210px] rounded-[24px]" />)}</div>}>
        {() => rows.length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((d) => (
              <Link key={d.id} href={`/console/audit-docs/${d.id}`} className="card group flex flex-col gap-3 transition-colors hover:border-line-2">
                <div className="flex items-center gap-2">
                  <Chip tone={statusTone(d.status)}>{STATUS_LABEL[d.status]}</Chip>
                  <span className="ml-auto flex items-center gap-1 text-xs text-muted">{d.capturedVia === 'glasses' ? <Glasses size={13} aria-hidden /> : d.capturedVia === 'mobile' ? <Smartphone size={13} aria-hidden /> : <Monitor size={13} aria-hidden />}{d.capturedVia}</span>
                </div>
                <h2 className="t-card group-hover:text-lime">{d.title}</h2>
                <p className="text-xs text-muted">{d.docType} · {d.pageCount} page{d.pageCount === 1 ? '' : 's'} · {d.fields} values · {d.tables} tables · {d.figures} figures</p>
                <Progress value={d.review.total ? Math.round((d.review.done / d.review.total) * 100) : 0} tone={d.review.complete ? 'ok' : 'lime'} label="Review progress" />
                <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                  <span>{d.review.done}/{d.review.total} reviewed</span>
                  {d.agreement !== null && <span>· {Math.round(d.agreement * 100)}% engine agreement</span>}
                  {d.attention > 0 && d.status === 'in_review' && <span className="flex items-center gap-1 text-[var(--color-high)]"><AlertTriangle size={12} aria-hidden />{d.attention} need attention</span>}
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted">
                  {d.engines.map((e) => <span key={e} className="rounded-full bg-bg-2 px-2 py-0.5">{engineLabel(e)}</span>)}
                  <span className="ml-auto">{d.capturedBy ?? 'unknown'} · {ago(d.createdAt)}</span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState icon={<FileScan size={20} aria-hidden />} title={filter === 'all' ? 'No audit documents yet' : 'Nothing in this state'}
            body="Scan a paper record with the field glasses (Audit scan) or upload a photo here. Try the sample audit sheet for a quick end-to-end run."
            action={can('auditdoc.capture') && filter === 'all' ? <Button variant="primary" icon={<ScanLine size={16} />} onClick={() => setScanOpen(true)}>Scan document</Button> : undefined} />
        )}
      </QueryView>

      <Dialog open={scanOpen} onOpenChange={setScanOpen} title="Scan audit document" description="Pages are read on this device first (nothing leaves it until you press Extract)." wide>
        {scanOpen && <ScanComposer onCancel={() => setScanOpen(false)} onDone={(id) => { setScanOpen(false); router.push(`/console/audit-docs/${id}`); }} />}
      </Dialog>
    </>
  );
}
