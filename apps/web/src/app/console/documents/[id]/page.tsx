'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Archive, ArrowLeft, CheckCircle2, Info, Pencil, Printer, RotateCcw } from 'lucide-react';
import { ASSET_TYPE_LABELS, DOCUMENT_KIND_LABELS } from '@hydris/domain';
import { patch } from '@/lib/api';
import { invalidatePaths, useApi } from '@/lib/query';
import { useCan } from '@/lib/session';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { Button, Card, Chip, ErrorState, KeyValues, Skeleton, StateChip } from '@/ui';
import { ConfirmDialog } from '@/ui/overlay';
import { DocumentBody, DocumentFormDialog, KIND_SHORT } from '@/console/work/documents';
import type { DocumentFull } from '@/console/work/shared';

export default function DocumentReaderPage() {
  const { id } = useParams<{ id: string }>();
  const path = `/documents/${id}`;
  const q = useApi<{ document: DocumentFull }>(path);
  const can = useCan();
  const manage = can('document.manage');
  const qc = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [confirm, setConfirm] = useState<null | 'approve' | 'archive' | 'restore'>(null);

  if (q.isError && !q.data) return <><BackLink /><ErrorState error={q.error} onRetry={() => void q.refetch()} /></>;
  if (!q.data) {
    return (
      <div className="grid gap-4" role="status" aria-label="Loading document">
        <Skeleton className="h-5 w-40" /><Skeleton className="h-12 w-2/3 max-w-xl" />
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]"><Skeleton className="h-[480px] rounded-[24px]" /><Skeleton className="h-[260px] rounded-[24px]" /></div>
      </div>
    );
  }
  const d = q.data.document;

  const setStatus = async (status: 'approved' | 'archived' | 'draft') => {
    await patch(path, { status });
    await q.refetch();
    invalidatePaths(qc, ['/documents', '/assist']);
  };

  return (
    <>
      <BackLink />
      <article className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="card min-w-0 sm:!p-10">
          <header className="mb-8 border-b border-line pb-6">
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone={d.kind === 'safety' ? 'medium' : 'default'}>{KIND_SHORT[d.kind]}</Chip>
              <StateChip state={d.status === 'approved' ? 'approved' : d.status} />
              <span className="num text-sm text-muted">Version {d.version}</span>
            </div>
            <h1 className="t-page mt-4 max-w-[28ch]">{d.title}</h1>
            <p className="mt-3 text-sm text-muted">{d.status === 'approved' && d.approvedAt ? `Approved ${fmtDate(d.approvedAt)}` : d.status === 'draft' ? 'Draft — not visible to operators, field glasses or the procedures assistant' : 'Archived — kept for the record, no longer in use'}</p>
          </header>
          <DocumentBody body={d.body} />
          <footer className="mt-10 flex items-start gap-2 border-t border-line pt-5 text-[13px] text-muted">
            <Info size={15} className="mt-0.5 flex-none" aria-hidden />
            Follow the full procedure and your site permit-to-work rules. Hydris displays documents; it does not control equipment.
          </footer>
        </div>

        <aside className="grid content-start gap-4 xl:sticky xl:top-24 xl:self-start">
          {manage && (
            <Card title="Manage">
              <div className="grid gap-2">
                {d.status === 'draft' && <Button variant="primary" icon={<CheckCircle2 size={16} />} onClick={() => setConfirm('approve')}>Approve version {d.version}</Button>}
                {d.status !== 'archived' && <Button icon={<Pencil size={16} />} onClick={() => setEditOpen(true)}>Edit</Button>}
                {d.status !== 'archived' && <Button variant="ghost" icon={<Archive size={16} />} onClick={() => setConfirm('archive')}>Archive</Button>}
                {d.status === 'archived' && <Button icon={<RotateCcw size={16} />} onClick={() => setConfirm('restore')}>Restore as draft</Button>}
              </div>
              {d.status === 'approved' && <p className="mt-3 text-xs leading-relaxed text-muted">Editing the content of an approved document creates a new draft version that must be approved again before operators see it.</p>}
            </Card>
          )}
          <Card title="Details">
            <KeyValues columns={1} items={[
              ['Kind', DOCUMENT_KIND_LABELS[d.kind]],
              ['Applies to', d.assetId ? <Link className="text-[#9ebcff] hover:underline" href={`/console/assets/${d.assetId}`}>Specific asset</Link> : d.assetType ? ASSET_TYPE_LABELS[d.assetType] : 'Any asset'],
              ['Version', <span key="v" className="num">{d.version}</span>],
              ['Approved', d.approvedAt ? <span className="num">{fmtDateTime(d.approvedAt)}</span> : 'Not approved'],
              ['Last updated', <span key="u" className="num">{fmtDateTime(d.updatedAt)}</span>],
            ]} />
            {d.tags.length > 0 && <div className="mt-4 flex flex-wrap gap-1.5">{d.tags.map((t) => <span key={t} className="rounded-full bg-bg-2 px-2 py-0.5 text-[12px] text-text-2">#{t}</span>)}</div>}
          </Card>
          <Button variant="ghost" icon={<Printer size={16} />} onClick={() => window.print()}>Print</Button>
        </aside>
      </article>

      {manage && <DocumentFormDialog open={editOpen} onOpenChange={setEditOpen} doc={d} />}
      <ConfirmDialog open={confirm === 'approve'} onOpenChange={(v) => setConfirm(v ? 'approve' : null)} title={`Approve version ${d.version}`} confirmLabel="Approve"
        body="Once approved, this version is shown to operators on the console and field glasses and becomes searchable in Ask the procedures. Make sure it has been reviewed." onConfirm={() => setStatus('approved')} />
      <ConfirmDialog open={confirm === 'archive'} onOpenChange={(v) => setConfirm(v ? 'archive' : null)} title="Archive document" confirmLabel="Archive" destructive
        body="Archived documents are hidden from operators and the assistant but kept for the record." onConfirm={() => setStatus('archived')} />
      <ConfirmDialog open={confirm === 'restore'} onOpenChange={(v) => setConfirm(v ? 'restore' : null)} title="Restore as draft" confirmLabel="Restore"
        body="The document returns as a draft. Approve it again to publish." onConfirm={() => setStatus('draft')} />
    </>
  );
}

function BackLink() {
  return <Link href="/console/documents" className="mb-4 inline-flex items-center gap-1.5 text-sm text-text-2 hover:text-text"><ArrowLeft size={15} aria-hidden />Documents & SOPs</Link>;
}
