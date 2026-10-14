'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, FileText, ImageIcon, Paperclip } from 'lucide-react';
import { api, download, getAccessToken, refreshSession } from '@/lib/api';
import { Button, IconButton } from '@/ui';
import { describeError, type Attachment } from './shared';

export const ACCEPTED_FILES = 'image/jpeg,image/png,image/webp,application/pdf,text/plain';
export const ACCEPTED_IMAGES = 'image/jpeg,image/png,image/webp';
const MAX_BYTES = 10 * 1024 * 1024;

export type OwnerType = 'inspection' | 'maintenance' | 'asset' | 'alarm';

/** Multipart upload. Owner fields are appended before the file so the server sees them with the stream. */
export async function uploadAttachment(ownerType: OwnerType, ownerId: string, file: File) {
  if (file.size > MAX_BYTES) throw new Error('File is larger than 10 MB');
  const fd = new FormData();
  fd.append('ownerType', ownerType);
  fd.append('ownerId', ownerId);
  fd.append('file', file, file.name);
  const r = await api<{ attachment: Attachment & { sizeBytes: number } }>('/attachments', { method: 'POST', body: fd });
  return r.attachment;
}

/** Authenticated blob fetch (tokens never go into URLs), returned as an object URL. */
async function fetchBlobUrl(id: string) {
  const go = () => fetch(`/api/attachments/${id}`, { headers: getAccessToken() ? { authorization: `Bearer ${getAccessToken()}` } : {}, credentials: 'same-origin' });
  let res = await go();
  if (res.status === 401 && (await refreshSession())) res = await go();
  if (!res.ok) throw new Error(`Could not load attachment (${res.status})`);
  return URL.createObjectURL(await res.blob());
}

export function useAttachmentUrl(id: string | null) {
  const [state, setState] = useState<{ url: string | null; error: string | null }>({ url: null, error: null });
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    let made: string | null = null;
    fetchBlobUrl(id).then(
      (u) => {
        made = u;
        if (cancelled) URL.revokeObjectURL(u);
        else setState({ url: u, error: null });
      },
      (e: unknown) => !cancelled && setState({ url: null, error: describeError(e) }),
    );
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [id]);
  return state;
}

export function AttachmentThumb({ id, alt, size = 96 }: { id: string; alt: string; size?: number }) {
  const { url, error } = useAttachmentUrl(id);
  if (error) return <span className="grid place-items-center rounded-xl bg-bg-2 text-xs text-muted" style={{ width: size, height: size }} title={error}><ImageIcon size={18} aria-hidden /></span>;
  if (!url) return <span className="skeleton block rounded-xl" style={{ width: size, height: size }} aria-hidden />;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-line-2 hover:border-lime" aria-label={`Open ${alt} in a new tab`}>
      <img src={url} alt={alt} style={{ width: size, height: size }} className="object-cover" />
    </a>
  );
}

export function AttachmentList({ items, emptyText = 'No files attached.' }: { items: Attachment[]; emptyText?: string }) {
  if (!items.length) return <p className="text-sm text-muted">{emptyText}</p>;
  return (
    <ul className="grid gap-2">
      {items.map((a) => (
        <li key={a.id} className="flex items-center gap-3 rounded-2xl bg-bg-2 px-3 py-2">
          {a.mime.startsWith('image/') ? <AttachmentThumb id={a.id} alt={a.filename} size={44} /> : (
            <span className="grid h-11 w-11 flex-none place-items-center rounded-xl bg-surface-2 text-text-2"><FileText size={18} aria-hidden /></span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm">{a.filename}</span>
            <span className="text-xs text-muted">{a.mime}</span>
          </span>
          <IconButton label={`Download ${a.filename}`} size="sm" onClick={() => void download(`/attachments/${a.id}`, a.filename)}><Download size={15} /></IconButton>
        </li>
      ))}
    </ul>
  );
}

/** File picker button that uploads immediately and reports the result. */
export function UploadButton({ ownerType, ownerId, accept = ACCEPTED_FILES, label = 'Attach file', onUploaded, size = 'sm' }: {
  ownerType: OwnerType; ownerId: string; accept?: string; label?: string; onUploaded: (a: Attachment) => void | Promise<void>; size?: 'sm' | 'md';
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="grid gap-1.5">
      <input ref={ref} type="file" accept={accept} className="sr-only" tabIndex={-1} aria-hidden onChange={async (e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (!f) return;
        setBusy(true);
        setErr(null);
        try {
          const a = await uploadAttachment(ownerType, ownerId, f);
          await onUploaded(a);
        } catch (x) {
          setErr(describeError(x));
        } finally {
          setBusy(false);
        }
      }} />
      <Button size={size} variant="secondary" busy={busy} icon={accept === ACCEPTED_IMAGES ? <ImageIcon size={15} /> : <Paperclip size={15} />} onClick={() => ref.current?.click()}>
        {busy ? 'Uploading…' : label}
      </Button>
      {err && <span role="alert" className="field-error">{err}</span>}
    </div>
  );
}
