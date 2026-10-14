'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { BookOpenText, FileText, Plus, Quote, Search, Sparkles } from 'lucide-react';
import { ASSET_TYPE_LABELS, DOCUMENT_KINDS, DOCUMENT_KIND_LABELS, type DocumentKind } from '@hydris/domain';
import { useApi } from '@/lib/query';
import { useCan } from '@/lib/session';
import { fmtDate, fmtDateTime, fmtValue } from '@/lib/format';
import { Button, Capsule, Chip, EmptyState, ErrorState, FreshnessBadge, PageHeader, QueryView, Select, Skeleton, StateChip } from '@/ui';
import { DocumentFormDialog, KIND_SHORT } from '@/console/work/documents';
import { Highlighted, useAssets, useDebounced, type AssistResponse, type DocumentRow } from '@/console/work/shared';

type StatusFilter = 'all' | 'approved' | 'draft' | 'archived';

export default function DocumentsPage() {
  const can = useCan();
  const manage = can('document.manage');
  const [text, setText] = useState('');
  const [kind, setKind] = useState<DocumentKind | 'all'>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [newOpen, setNewOpen] = useState(false);
  const qText = useDebounced(text.trim(), 300);

  const params = new URLSearchParams();
  if (qText) params.set('q', qText);
  if (kind !== 'all') params.set('kind', kind);
  if (manage && status !== 'all') params.set('status', status);
  const qs = params.toString();
  const q = useApi<{ documents: DocumentRow[] }>(`/documents${qs ? `?${qs}` : ''}`, { placeholderData: (prev) => prev });

  return (
    <>
      <PageHeader eyebrow="Work · Knowledge" title="Documents & SOPs"
        subtitle="Approved procedures, manuals and safety notices — the same library operators read on their field glasses."
        actions={manage ? <Button variant="primary" icon={<Plus size={16} />} onClick={() => setNewOpen(true)}>New document</Button> : undefined} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section className="grid min-w-0 content-start gap-4" aria-label="Document library">
          <div className="card card-tight flex flex-wrap items-center gap-3">
            <div className="relative w-full md:w-[300px]">
              <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
              <input className="input input-search" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search titles and content" aria-label="Search documents" />
            </div>
            <Select aria-label="Document kind" className="!w-auto min-w-[200px]" value={kind} onChange={(e) => setKind(e.target.value as DocumentKind | 'all')}
              options={[{ value: 'all', label: 'All kinds' }, ...DOCUMENT_KINDS.map((k) => ({ value: k, label: DOCUMENT_KIND_LABELS[k] }))]} />
            {manage && (
              <Capsule label="Document status" value={status} onChange={setStatus} options={[
                { value: 'all', label: 'All' }, { value: 'approved', label: 'Approved' }, { value: 'draft', label: 'Drafts' }, { value: 'archived', label: 'Archived' },
              ]} />
            )}
          </div>

          <QueryView q={q} loading={<div className="grid gap-4 md:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[168px] rounded-[24px]" />)}</div>}>
            {(d) => d.documents.length ? (
              <div className="grid gap-4 md:grid-cols-2" aria-busy={q.isFetching}>
                {d.documents.map((doc) => (
                  <Link key={doc.id} href={`/console/documents/${doc.id}`} className="card group flex flex-col gap-3 transition-colors hover:border-line-2">
                    <div className="flex items-center gap-2">
                      <Chip tone={doc.kind === 'safety' ? 'medium' : 'default'} title={DOCUMENT_KIND_LABELS[doc.kind]}>{KIND_SHORT[doc.kind]}</Chip>
                      <span className="num text-xs text-muted">v{doc.version}</span>
                      <span className="ml-auto"><StateChip state={doc.status === 'approved' ? 'approved' : doc.status} /></span>
                    </div>
                    <h2 className="t-card group-hover:text-lime">{doc.title}</h2>
                    <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                      <span>{doc.approvedAt ? `Approved ${fmtDate(doc.approvedAt)}` : `Updated ${fmtDate(doc.updatedAt)}`}</span>
                      {doc.assetType && <span>· {ASSET_TYPE_LABELS[doc.assetType]}</span>}
                    </div>
                    {doc.tags.length > 0 && <div className="flex flex-wrap gap-1.5">{doc.tags.slice(0, 5).map((t) => <span key={t} className="rounded-full bg-bg-2 px-2 py-0.5 text-[11.5px] text-text-2">#{t}</span>)}</div>}
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyState icon={<FileText size={20} aria-hidden />} title={qText || kind !== 'all' || status !== 'all' ? 'No documents match' : 'No documents yet'}
                body={qText ? `Nothing matches “${qText}”. Try fewer or different words.` : manage ? 'Add your SOPs, manuals and safety notices so operators can read them in the field.' : 'Approved documents will appear here.'}
                action={manage && !qText ? <Button variant="primary" icon={<Plus size={16} />} onClick={() => setNewOpen(true)}>New document</Button> : undefined} />
            )}
          </QueryView>
        </section>

        <AskProcedures />
      </div>
      {manage && <DocumentFormDialog open={newOpen} onOpenChange={setNewOpen} />}
    </>
  );
}

function AskProcedures() {
  const assets = useAssets();
  const [draft, setDraft] = useState('');
  const [assetId, setAssetId] = useState('');
  const [asked, setAsked] = useState<{ q: string; assetId: string } | null>(null);
  const tooShort = draft.trim().length < 2;
  const path = asked ? `/assist?q=${encodeURIComponent(asked.q)}${asked.assetId ? `&assetId=${asked.assetId}` : ''}` : null;
  const r = useApi<AssistResponse>(path, { staleTime: 30_000 });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (tooShort) return;
    setAsked({ q: draft.trim().slice(0, 200), assetId });
  };

  return (
    <aside className="grid content-start gap-4 xl:sticky xl:top-24 xl:self-start" aria-label="Ask the procedures">
      <section className="card card-lime">
        <div className="flex items-center gap-2">
          <BookOpenText size={20} aria-hidden />
          <h2 className="t-section">Ask the procedures</h2>
        </div>
        <p className="mt-2 text-[13.5px] leading-relaxed opacity-75">
          Finds the relevant passages in <b className="font-medium">approved</b> documents. Answers are quoted excerpts — nothing is generated or invented, and Hydris never operates equipment.
        </p>
        <form onSubmit={submit} className="mt-4 grid gap-3">
          <label htmlFor="assist-q" className="sr-only">Question</label>
          <input id="assist-q" className="h-12 w-full rounded-[var(--radius-md)] border border-black/15 bg-white/70 px-4 text-[15px] text-lime-ink placeholder:text-lime-ink/50 focus:border-lime-ink focus:outline-none"
            value={draft} maxLength={200} onChange={(e) => setDraft(e.target.value)} placeholder="e.g. how to change over a blower" />
          <label htmlFor="assist-asset" className="sr-only">Asset context</label>
          <select id="assist-asset" className="h-11 w-full rounded-[var(--radius-md)] border border-black/15 bg-white/70 px-3 text-sm text-lime-ink focus:border-lime-ink focus:outline-none"
            value={assetId} onChange={(e) => setAssetId(e.target.value)}>
            <option value="">No asset context</option>
            {(assets.data?.assets ?? []).map((a) => <option key={a.id} value={a.id}>{a.tag} · {a.name}</option>)}
          </select>
          <button type="submit" disabled={tooShort || r.isFetching} className="btn bg-lime-ink text-lime hover:opacity-90">
            <Search size={16} aria-hidden />{r.isFetching ? 'Searching…' : 'Search approved documents'}
          </button>
        </form>
      </section>

      {asked && (
        <section className="card fade-in" aria-live="polite" aria-label="Assistant results">
          {r.isError ? <ErrorState error={r.error} onRetry={() => void r.refetch()} /> : !r.data ? (
            <div className="grid gap-3" role="status" aria-label="Searching">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20" />)}</div>
          ) : (
            <div className="grid gap-5">
              <p className={r.data.sources.length ? 'flex gap-2 rounded-2xl bg-bg-2 px-4 py-3 text-[13px] text-text-2' : 'flex gap-2 rounded-2xl border border-[rgb(245_184_61/0.4)] bg-[rgb(245_184_61/0.08)] px-4 py-3 text-[13px]'} role="note">
                <Sparkles size={15} className="mt-0.5 flex-none text-lime" aria-hidden />{r.data.notice}
              </p>

              {r.data.sources.length > 0 && (
                <div className="grid gap-3">
                  <div className="t-eyebrow">Sources · {r.data.sources.length}</div>
                  {r.data.sources.map((s) => (
                    <article key={s.id} className="rounded-[var(--radius-lg)] border border-line bg-bg-2 p-4">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                        <Chip tone={s.kind === 'safety' ? 'medium' : 'default'}>{KIND_SHORT[s.kind]}</Chip>
                        <span className="num">v{s.version}</span>
                        {s.approvedAt && <span>approved {fmtDate(s.approvedAt)}</span>}
                      </div>
                      <Link href={`/console/documents/${s.id}`} className="mt-2 block font-medium hover:text-lime">{s.title}</Link>
                      <blockquote className="mt-2 flex gap-2 text-sm leading-relaxed text-text-2">
                        <Quote size={14} className="mt-1 flex-none text-muted" aria-hidden />
                        <span>…<Highlighted text={s.passage} />…</span>
                      </blockquote>
                    </article>
                  ))}
                </div>
              )}

              {r.data.asset && (
                <div className="grid gap-2">
                  <div className="t-eyebrow">Current readings · {r.data.asset.tag}</div>
                  {r.data.telemetry.length ? (
                    <ul className="grid gap-2">
                      {r.data.telemetry.map((m) => {
                        const showValue = m.freshness === 'live' || m.freshness === 'delayed';
                        return (
                          <li key={m.tag} className="rounded-2xl bg-bg-2 px-4 py-3">
                            <div className="flex items-baseline justify-between gap-3">
                              <span className="text-sm">{m.label} <span className="text-xs text-muted">· {m.tag}</span></span>
                              <span className="num">{showValue ? fmtValue(m.value) : '—'} <span className="text-xs text-muted">{m.unit}</span></span>
                            </div>
                            <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                              <FreshnessBadge freshness={m.freshness} ts={m.observedAt} />
                              <span className="text-[11.5px] text-muted num">{m.observedAt ? `observed ${fmtDateTime(m.observedAt, { second: '2-digit' })}` : 'no data'}{m.source === 'simulator' ? ' · synthetic' : ''}</span>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  ) : <p className="text-sm text-muted">No sensors on this asset.</p>}
                </div>
              )}

              {r.data.glossary.length > 0 && (
                <div className="grid gap-2">
                  <div className="t-eyebrow">Glossary</div>
                  <dl className="grid gap-2">
                    {r.data.glossary.map((g) => (
                      <div key={g.term} className="rounded-2xl bg-bg-2 px-4 py-3">
                        <dt className="text-sm font-medium">{g.term} <span className="text-xs font-normal text-muted">({g.unit})</span></dt>
                        <dd className="mt-1 text-sm text-text-2">{g.explanation}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </aside>
  );
}
