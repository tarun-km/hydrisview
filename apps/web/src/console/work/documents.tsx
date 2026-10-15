'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { ASSET_TYPES, ASSET_TYPE_LABELS, DOCUMENT_KINDS, DOCUMENT_KIND_LABELS, type AssetType, type DocumentKind } from '@hydris/domain';
import { patch, post } from '@/lib/api';
import { invalidatePaths } from '@/lib/query';
import { Button, Input, Select, Textarea } from '@/ui';
import { Dialog, useToast } from '@/ui/overlay';
import { FormError, type DocumentFull } from './shared';

export const KIND_SHORT: Record<DocumentKind, string> = { sop: 'SOP', manual: 'Manual', datasheet: 'Datasheet', safety: 'Safety', troubleshooting: 'Troubleshooting', other: 'Other' };

/**
 * Plain-text reader: blank lines separate blocks; "1." / "1)" lines become numbered steps,
 * "-" / "•" lines become bullets, short lines ending in ":" become subheadings. Line breaks are preserved.
 */
export function DocumentBody({ body }: { body: string }) {
  const blocks = body.replace(/\r\n/g, '\n').split(/\n{2,}/).map((b) => b.replace(/^\n+|\n+$/g, '')).filter(Boolean);
  const out: ReactNode[] = [];
  blocks.forEach((block, bi) => {
    const lines = block.split('\n');
    let para: string[] = [];
    let list: { type: 'ol' | 'ul'; items: { n?: number; text: string }[] } | null = null;
    const flushPara = () => {
      if (para.length) out.push(<p key={`${bi}-p-${out.length}`} className="whitespace-pre-line">{para.join('\n')}</p>);
      para = [];
    };
    const flushList = () => {
      if (!list) return;
      const l = list;
      if (l.type === 'ol') {
        out.push(
          <ol key={`${bi}-ol-${out.length}`} className="grid gap-3" start={l.items[0]?.n}>
            {l.items.map((it, i) => (
              <li key={i} className="flex gap-3.5">
                <span className="num mt-0.5 grid h-7 w-7 flex-none place-items-center rounded-full bg-lime text-[13px] font-medium text-lime-ink" aria-hidden>{it.n ?? i + 1}</span>
                <span className="min-w-0 flex-1 whitespace-pre-line pt-0.5">{it.text}</span>
              </li>
            ))}
          </ol>,
        );
      } else {
        out.push(
          <ul key={`${bi}-ul-${out.length}`} className="grid gap-2">
            {l.items.map((it, i) => <li key={i} className="flex gap-3"><span className="mt-[0.7em] h-1.5 w-1.5 flex-none rounded-full bg-text-2" aria-hidden /><span className="whitespace-pre-line">{it.text}</span></li>)}
          </ul>,
        );
      }
      list = null;
    };
    for (const line of lines) {
      const ol = line.match(/^\s*(\d{1,3})[.)]\s+(.*)$/);
      const ul = line.match(/^\s*[-•*]\s+(.*)$/);
      if (ol) {
        flushPara();
        if (list?.type !== 'ol') { flushList(); list = { type: 'ol', items: [] }; }
        list!.items.push({ n: Number(ol[1]), text: ol[2]! });
      } else if (ul) {
        flushPara();
        if (list?.type !== 'ul') { flushList(); list = { type: 'ul', items: [] }; }
        list!.items.push({ text: ul[1]! });
      } else if (list && /^\s{2,}\S/.test(line)) {
        const last = list.items[list.items.length - 1];
        if (last) last.text += `\n${line.trim()}`;
      } else if (line.trim().length <= 80 && /:\s*$/.test(line) && lines.length > 1 && para.length === 0) {
        flushList();
        out.push(<h3 key={`${bi}-h-${out.length}`} className="pt-2 text-[17px] font-medium text-text">{line.trim().replace(/:\s*$/, '')}</h3>);
      } else {
        flushList();
        para.push(line);
      }
    }
    flushPara();
    flushList();
  });
  return <div className="grid max-w-[72ch] gap-5 text-[16px] leading-[1.75] text-text-2">{out}</div>;
}

interface DocForm { title: string; kind: DocumentKind; assetType: AssetType | ''; body: string; tags: string }

export function DocumentFormDialog({ open, onOpenChange, doc }: { open: boolean; onOpenChange: (v: boolean) => void; doc?: DocumentFull }) {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState<DocForm>({ title: '', kind: 'sop', assetType: '', body: '', tags: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setF(doc ? { title: doc.title, kind: doc.kind, assetType: doc.assetType ?? '', body: doc.body, tags: doc.tags.join(', ') } : { title: '', kind: 'sop', assetType: '', body: '', tags: '' });
    setErr(null);
    setTouched(false);
  }, [open, doc?.id]); // seed on open only

  const tags = f.tags.split(',').map((t) => t.trim()).filter(Boolean);
  const errors = {
    title: f.title.trim().length < 3 ? 'Title must be at least 3 characters' : null,
    body: !f.body.trim() ? 'The document needs content' : null,
    tags: tags.length > 20 ? 'At most 20 tags' : tags.some((t) => t.length > 40) ? 'Tags are limited to 40 characters' : null,
  };
  const bodyChanged = !!doc && f.body !== doc.body;
  const redraft = bodyChanged && doc?.status === 'approved';

  const submit = async () => {
    setTouched(true);
    if (errors.title || errors.body || errors.tags) return;
    setBusy(true);
    setErr(null);
    const payload = { title: f.title.trim(), kind: f.kind, assetType: f.assetType || null, tags };
    try {
      if (doc) {
        await patch(`/documents/${doc.id}`, bodyChanged ? { ...payload, body: f.body } : payload);
        invalidatePaths(qc, ['/documents', '/assist']);
        toast({ title: redraft ? `Saved as draft version ${doc.version + 1}` : 'Document saved', body: redraft ? 'Approve it again to publish to operators.' : undefined, tone: 'ok' });
        onOpenChange(false);
      } else {
        const r = await post<{ document: { id: string } }>('/documents', { ...payload, body: f.body });
        invalidatePaths(qc, ['/documents']);
        toast({ title: 'Draft created', body: 'Approve it to make it available to operators.', tone: 'ok' });
        onOpenChange(false);
        router.push(`/console/documents/${r.document.id}`);
      }
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }} wide title={doc ? `Edit · ${doc.title}` : 'New document'}
      description={doc ? `Version ${doc.version} · ${doc.status}` : 'New documents start as drafts. Operators, field glasses and the procedures assistant only see approved documents.'}
      footer={<>
        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
        <Button variant="primary" busy={busy} onClick={() => void submit()}>{doc ? (redraft ? `Save as draft v${doc.version + 1}` : 'Save') : 'Create draft'}</Button>
      </>}>
      <div className="grid gap-4">
        <Input label="Title" value={f.title} maxLength={160} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. SOP-04 Blower changeover" error={touched ? errors.title : null} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as DocumentKind })} options={DOCUMENT_KINDS.map((k) => ({ value: k, label: DOCUMENT_KIND_LABELS[k] }))} />
          <Select label="Asset type" value={f.assetType} onChange={(e) => setF({ ...f, assetType: e.target.value as AssetType | '' })} placeholder="Applies to any asset"
            options={ASSET_TYPES.map((t) => ({ value: t, label: ASSET_TYPE_LABELS[t] }))} hint="Links the document to matching equipment in the assistant." />
        </div>
        <Textarea label="Content" className="!min-h-[300px] font-mono !text-[13.5px]" value={f.body} maxLength={100_000} onChange={(e) => setF({ ...f, body: e.target.value })}
          error={touched ? errors.body : null}
          hint={'Plain text. Blank lines separate paragraphs; lines starting "1." become numbered steps, "-" bullets, and short lines ending ":" headings.'} />
        <Input label="Tags" value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} placeholder="blower, changeover, aeration" hint="Comma separated, up to 20." error={touched ? errors.tags : null} />
        {redraft && (
          <p role="note" className="flex gap-2 rounded-2xl border border-[rgb(245_184_61/0.4)] bg-[rgb(245_184_61/0.08)] px-4 py-3 text-sm">
            <AlertTriangle size={16} className="mt-0.5 flex-none text-medium-text" aria-hidden />
            <span>You changed the content of an approved document. Saving creates <b className="font-medium">version {doc!.version + 1} as a draft</b>; until it is approved again it is hidden from operators, field glasses and the procedures assistant.</span>
          </p>
        )}
        <FormError error={err} />
      </div>
    </Dialog>
  );
}
