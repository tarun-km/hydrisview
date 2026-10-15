'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, Check, Glasses, KeyRound, ShieldCheck, UserRoundCheck, X } from 'lucide-react';
import { ROLE_LABELS, formatPairingCode, isValidPairingCode, type Role } from '@hydris/domain';
import { api, errorMessage, post } from '@/lib/api';
import { useSessionCtx } from '@/lib/session';
import { Button, Input, Select } from '@/ui';
import { ThemedLogo } from '@/console/ThemedLogo';
import { ThemeToggle } from '@/ui/theme';

interface Lookup {
  challenge: { code: string; device: { kind: string; model?: string; appVersion?: string; display?: { width: number; height: number }; name?: string }; requestedAt: string; expiresAt: string };
  organization: string; sites: { id: string; name: string; code: string }[]; assignees: { id: string; name: string; role: Role }[];
  canAssignOthers: boolean; existingDevice: { id: string; name: string; status: string } | null;
}

/** Companion approval: an authenticated person confirms the code shown on the glasses. */
function PairFlow() {
  const { state } = useSessionCtx();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [code, setCode] = useState(params.get('code') ?? '');
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [siteId, setSiteId] = useState('');
  const [assignee, setAssignee] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<'approved' | 'denied' | null>(null);

  useEffect(() => {
    if (state.status === 'anon') router.replace(`/login?next=${encodeURIComponent(`${pathname}?code=${encodeURIComponent(code)}`)}`);
  }, [state.status, router, pathname, code]);

  const find = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const l = await api<Lookup>(`/pairing/lookup?code=${encodeURIComponent(code)}`);
      setLookup(l);
      setSiteId(l.sites[0]?.id ?? '');
      setAssignee(state.status === 'authed' ? state.session.user.id : '');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (state.status === 'authed' && isValidPairingCode(code) && !lookup && params.get('code')) void find();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status]);

  const approve = async () => {
    setBusy(true);
    setError(null);
    try {
      await post('/pairing/approve', { code, siteId, assigneeUserId: assignee || undefined, deviceName: name.trim() || undefined });
      setDone('approved');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const deny = async () => {
    setBusy(true);
    try {
      await post('/pairing/deny', { code });
      setDone('denied');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (state.status !== 'authed') return <div className="grid min-h-dvh place-items-center"><span className="pulse-dot"><ThemedLogo /></span></div>;

  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-[540px] flex-col px-5 py-6 sm:py-8">
      <div className="mb-8 flex items-center justify-between sm:mb-12">
        <Link href="/console" aria-label="Hydris console"><ThemedLogo /></Link>
        <div className="flex items-center gap-2">
          <ThemeToggle compact size="sm" />
          <Link href="/console/devices" className="btn btn-ghost btn-sm"><ArrowLeft size={15} aria-hidden />Field glasses</Link>
        </div>
      </div>
      <ol aria-label="Pairing steps" className="mb-8 grid grid-cols-3 gap-2">
        {['Enter code', 'Confirm device', 'Connected'].map((label, i) => {
          const step = done ? 2 : lookup ? 1 : 0;
          const state = i < step ? 'done' : i === step ? 'current' : 'todo';
          return (
            <li key={label} aria-current={state === 'current' ? 'step' : undefined} className="grid gap-2">
              <span className={`h-1 rounded-full transition-colors duration-500 ${state === 'todo' ? 'bg-surface-3' : 'bg-lime'}`} aria-hidden />
              <span className={`text-xs ${state === 'todo' ? 'text-muted' : 'text-text'}`}><span className="num text-muted">0{i + 1}</span> {label}</span>
            </li>
          );
        })}
      </ol>
      {done ? (
        <div className="card grid gap-4 text-center fade-in">
          <span className={`pop-in mx-auto grid h-16 w-16 place-items-center rounded-full ${done === 'approved' ? 'bg-lime text-lime-ink shadow-[0_0_0_10px_rgb(25_84_241/0.1)]' : 'bg-surface-3'}`}>{done === 'approved' ? <Check size={28} /> : <X size={28} />}</span>
          <h1 className="t-section">{done === 'approved' ? 'Approved' : 'Pairing denied'}</h1>
          <p className="text-text-2">{done === 'approved' ? 'The glasses will finish connecting within a few seconds and load the assigned context.' : 'The code can no longer be used. Generate a new one on the glasses if needed.'}</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <Link href="/console/devices" className="btn btn-primary">Go to Field glasses</Link>
            <button type="button" className="btn btn-secondary" onClick={() => { setDone(null); setLookup(null); setCode(''); setName(''); }}>Pair another</button>
          </div>
        </div>
      ) : !lookup ? (
        <form onSubmit={find} className="grid gap-5">
          <div>
            <p className="t-eyebrow mb-2">Pair field glasses</p>
            <h1 className="t-page">Enter the code shown on the glasses</h1>
          </div>
          <Input label="Pairing code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="XXXX-XXXX" autoComplete="off" autoCapitalize="characters" spellCheck={false}
            className="num h-16 text-center text-[28px] tracking-[0.2em]" hint="8 characters. Letters and digits only; dashes are optional." maxLength={9} autoFocus />
          {error && <p role="alert" className="field-error">{error}</p>}
          <Button type="submit" variant="primary" size="lg" busy={busy} disabled={!isValidPairingCode(code)}>Continue</Button>
          <section aria-labelledby="how" className="card card-tight mt-4 bg-bg-2">
            <h2 id="how" className="t-eyebrow mb-3">How pairing works</h2>
            <ul className="grid gap-3 text-sm text-text-2">
              <li className="flex gap-3"><span className="grid h-8 w-8 flex-none place-items-center rounded-full bg-surface-2 text-text"><Glasses size={15} aria-hidden /></span><span>Open the Hydris app on the glasses (or the browser simulator). It shows an 8-character code.</span></li>
              <li className="flex gap-3"><span className="grid h-8 w-8 flex-none place-items-center rounded-full bg-surface-2 text-text"><KeyRound size={15} aria-hidden /></span><span>Enter that code here. Codes expire after a few minutes and work once.</span></li>
              <li className="flex gap-3"><span className="grid h-8 w-8 flex-none place-items-center rounded-full bg-surface-2 text-text"><UserRoundCheck size={15} aria-hidden /></span><span>Choose the site and operator. The glasses receive their own revocable credential, never your password.</span></li>
            </ul>
          </section>
        </form>
      ) : (
        <div className="grid gap-5 fade-in">
          <div>
            <p className="t-eyebrow mb-2">Confirm pairing</p>
            <h1 className="t-page">Is this your device?</h1>
          </div>
          <div className="card card-paper flex items-center gap-4">
            <span className="grid h-14 w-14 flex-none place-items-center rounded-full bg-ink text-lime"><Glasses size={26} /></span>
            <div className="min-w-0">
              <div className="t-card">{lookup.challenge.device.model ?? (lookup.challenge.device.kind === 'simulator' ? 'Browser simulator' : 'Field glasses')}</div>
              <div className="text-sm text-ink-2">Code <b className="num">{formatPairingCode(lookup.challenge.code)}</b> · requested {new Date(lookup.challenge.requestedAt).toLocaleTimeString()}{lookup.challenge.device.display ? ` · ${lookup.challenge.device.display.width}×${lookup.challenge.device.display.height}` : ''}</div>
            </div>
          </div>
          <p className="flex gap-2 rounded-2xl border border-[rgb(245_184_61/0.35)] bg-[rgb(245_184_61/0.07)] p-4 text-sm text-medium-text">
            <ShieldCheck size={18} className="mt-0.5 flex-none" /> Only approve if the same code is showing on glasses you are holding. Never approve a code someone sent you.
          </p>
          {lookup.existingDevice && <p className="text-sm text-text-2">These glasses were previously registered as <b>{lookup.existingDevice.name}</b> ({lookup.existingDevice.status}). Approving re-pairs them and ends older sessions.</p>}
          <div className="grid gap-4">
            <div className="field"><span className="field-label">Organization</span><div className="input flex items-center">{lookup.organization}</div></div>
            <Select label="Site" value={siteId} onChange={(e) => setSiteId(e.target.value)} options={lookup.sites.map((s) => ({ value: s.id, label: `${s.name} (${s.code})` }))} />
            <Select label="Assign to operator" value={assignee} onChange={(e) => setAssignee(e.target.value)} disabled={!lookup.canAssignOthers}
              options={lookup.assignees.map((a) => ({ value: a.id, label: `${a.name} — ${ROLE_LABELS[a.role]}` }))} hint={lookup.canAssignOthers ? undefined : 'You can pair glasses to yourself. Managers can assign other operators.'} />
            <Input label="Device name (optional)" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. ETP-01 glasses 2" maxLength={60} />
          </div>
          {error && <p role="alert" className="field-error">{error}</p>}
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <Button variant="primary" size="lg" busy={busy} disabled={!siteId} onClick={approve}>Approve and assign</Button>
            <Button variant="danger" size="lg" disabled={busy} onClick={deny}>Deny</Button>
          </div>
          <p className="text-xs text-muted">The glasses never receive your password. They get their own device credential, which an administrator can revoke at any time.</p>
        </div>
      )}
    </main>
  );
}

export default function PairPage() {
  return <Suspense><PairFlow /></Suspense>;
}
