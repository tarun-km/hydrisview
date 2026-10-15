'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toDataURL } from 'qrcode';
import { KeyRound, LogOut, Monitor, ShieldCheck, ShieldOff } from 'lucide-react';
import { ROLE_LABELS } from '@hydris/domain';
import { del, errorMessage, post, type SessionView } from '@/lib/api';
import { invalidatePaths, useAction, useApi } from '@/lib/query';
import { useSession, useSessionCtx } from '@/lib/session';
import { ago, fmtDateTime } from '@/lib/format';
import { Avatar, Button, Card, Chip, IconButton, Input, PageHeader, QueryView } from '@/ui';
import { ConfirmDialog, useToast } from '@/ui/overlay';
import { CopyField, describeAgent } from '@/console/admin/parts';

export default function AccountPage() {
  const s = useSession();
  return (
    <>
      <PageHeader eyebrow="Your account" title="Account & security" subtitle="Your sign-in details, two-factor authentication and the places you are signed in." />
      <div className="grid gap-4">
        <section className="card flex flex-wrap items-center gap-5" aria-label="Profile">
          <Avatar name={s.user.name} size={72} tone="lime" />
          <div className="min-w-0 flex-1">
            <div className="t-section break-words">{s.user.name}</div>
            <div className="mt-0.5 break-all text-text-2">{s.user.email}</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {s.role && <Chip>{ROLE_LABELS[s.role]}</Chip>}
              {s.org && <Chip tone="outline">{s.org.name}</Chip>}
              {s.user.isPlatformAdmin && <Chip tone="cobalt">Platform administrator</Chip>}
              {s.user.mfaEnabled ? <Chip tone="ok"><ShieldCheck size={13} aria-hidden />Two-factor on</Chip> : <Chip tone="medium"><ShieldOff size={13} aria-hidden />Two-factor off</Chip>}
            </div>
          </div>
          {s.memberships.length > 1 && <p className="w-full text-xs text-muted sm:w-auto">Member of {s.memberships.length} organizations. Switch from the account menu.</p>}
        </section>
        <div className="grid gap-4 lg:grid-cols-2">
          <PasswordCard />
          <MfaCard />
        </div>
        <SessionsCard />
      </div>
    </>
  );
}

function PasswordCard() {
  const { adopt } = useSessionCtx();
  const qc = useQueryClient();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);
  const act = useAction((v: { currentPassword: string; newPassword: string }) => post<SessionView>('/auth/change-password', v), {
    success: 'Password changed. Your other sessions were signed out.',
    onSuccess: (session) => {
      adopt(session);
      invalidatePaths(qc, ['/auth/sessions']);
      setCurrent(''); setNext(''); setConfirm(''); setTouched(false);
    },
  });
  const tooShort = next.length > 0 && next.length < 12;
  const mismatch = confirm.length > 0 && next !== confirm;
  return (
    <Card title={<h2 className="t-card flex items-center gap-2"><KeyRound size={17} aria-hidden />Password</h2>}>
      <form className="grid gap-4" onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (!current || !next || next !== confirm) return;
        act.mutate({ currentPassword: current, newPassword: next });
      }}>
        <Input label="Current password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} error={touched && !current ? 'Enter your current password' : null} />
        <Input label="New password" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)}
          hint="At least 12 characters. A passphrase of several words works well." error={tooShort ? 'Use at least 12 characters' : null} />
        <Input label="Confirm new password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={mismatch ? 'Passwords do not match' : null} />
        <p className="text-xs text-muted">Changing your password signs you out everywhere else. This browser stays signed in.</p>
        <div className="flex justify-end"><Button type="submit" variant="primary" busy={act.isPending} disabled={!current || !next || next !== confirm}>Change password</Button></div>
      </form>
    </Card>
  );
}

function MfaCard() {
  const s = useSession();
  const { reload } = useSessionCtx();
  const toast = useToast();
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [disabling, setDisabling] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!setup) { setQr(null); return; }
    let live = true;
    toDataURL(setup.otpauthUrl, { margin: 1, width: 220, errorCorrectionLevel: 'M', color: { dark: '#081116', light: '#E9E9E7' } })
      .then((u) => { if (live) setQr(u); })
      .catch(() => { if (live) setQr(null); });
    return () => { live = false; };
  }, [setup]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setErr(null);
    try { await fn(); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };
  const begin = () => run(async () => { setSetup(await post<{ secret: string; otpauthUrl: string }>('/auth/mfa/setup')); setCode(''); });
  const enable = () => run(async () => {
    await post('/auth/mfa/enable', { code: code.trim() });
    setSetup(null); setCode('');
    await reload();
    toast({ title: 'Two-factor authentication is on', body: 'You will be asked for a code at every sign-in.', tone: 'ok' });
  });
  const disable = () => run(async () => {
    await post('/auth/mfa/disable', { password, code: code.trim() });
    setDisabling(false); setPassword(''); setCode('');
    await reload();
    toast({ title: 'Two-factor authentication is off', tone: 'ok' });
  });
  const codeOk = /^\d{6}$/.test(code.trim());
  const codeInput = (
    <Input label="6-digit code from your authenticator app" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6}
      value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} className="num max-w-[220px] tracking-[0.3em]" />
  );

  return (
    <Card title={<h2 className="t-card flex items-center gap-2"><ShieldCheck size={17} aria-hidden />Two-factor authentication</h2>}
      action={s.user.mfaEnabled ? <Chip tone="ok">On</Chip> : <Chip tone="outline">Off</Chip>}>
      {s.user.mfaEnabled ? (
        disabling ? (
          <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (password && codeOk) void disable(); }}>
            <p className="text-sm text-text-2">Confirm with your password and a current code. Without two-factor, a stolen password is enough to sign in as you.</p>
            <Input label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            {codeInput}
            {err && <p role="alert" className="field-error">{err}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => { setDisabling(false); setErr(null); setCode(''); setPassword(''); }}>Cancel</Button>
              <Button type="submit" variant="danger-solid" busy={busy} disabled={!password || !codeOk}>Turn off two-factor</Button>
            </div>
          </form>
        ) : (
          <div className="grid gap-4">
            <p className="text-sm text-text-2">Sign-in requires your password and a time-based code from your authenticator app.</p>
            <div><Button variant="danger" onClick={() => setDisabling(true)}>Turn off</Button></div>
          </div>
        )
      ) : setup ? (
        <form className="grid gap-5" onSubmit={(e) => { e.preventDefault(); if (codeOk) void enable(); }}>
          <ol className="grid gap-1 text-sm text-text-2 [counter-reset:step]">
            <li>1. Scan the code with an authenticator app (1Password, Google Authenticator, Microsoft Authenticator…).</li>
            <li>2. Enter the 6-digit code it shows to finish.</li>
          </ol>
          <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-start">
            <div className="grid h-[220px] w-[220px] place-items-center overflow-hidden rounded-2xl bg-paper">
              {qr ? <img src={qr} width={220} height={220} alt="QR code for adding Hydris to an authenticator app" /> : <span className="text-xs text-ink-2">Generating code…</span>}
            </div>
            <div className="grid min-w-0 gap-3">
              <CopyField label="Or enter this key manually" value={setup.secret.replace(/(.{4})/g, '$1 ').trim()} mono />
              <details className="text-xs text-muted">
                <summary className="cursor-pointer">Show setup URL</summary>
                <p className="mt-2 break-all font-mono">{setup.otpauthUrl}</p>
              </details>
            </div>
          </div>
          {codeInput}
          {err && <p role="alert" className="field-error">{err}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => { setSetup(null); setErr(null); }}>Cancel</Button>
            <Button type="submit" variant="primary" busy={busy} disabled={!codeOk}>Verify and turn on</Button>
          </div>
        </form>
      ) : (
        <div className="grid gap-4">
          <p className="text-sm text-text-2">Protect your account with a second step at sign-in. Strongly recommended for administrators and anyone who can approve work or pair glasses.</p>
          {err && <p role="alert" className="field-error">{err}</p>}
          <div><Button variant="primary" busy={busy} onClick={() => void begin()}>Set up two-factor</Button></div>
        </div>
      )}
    </Card>
  );
}

interface AuthSession { id: string; userAgent: string | null; ip: string | null; createdAt: string; current: boolean }

function SessionsCard() {
  const q = useApi<{ sessions: AuthSession[] }>('/auth/sessions');
  const qc = useQueryClient();
  const { signOut } = useSessionCtx();
  const [target, setTarget] = useState<AuthSession | null>(null);
  return (
    <Card title={<h2 className="t-card flex items-center gap-2"><Monitor size={17} aria-hidden />Where you are signed in</h2>}
      action={q.data ? <span className="t-label num">{q.data.sessions.length} active</span> : undefined}>
      <QueryView q={q}>
        {({ sessions }) => sessions.length ? (
          <ul className="grid gap-2">
            {sessions.map((x) => (
              <li key={x.id} className="card-inset flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2 text-sm">{describeAgent(x.userAgent)}{x.current && <Chip tone="lime">This browser</Chip>}</span>
                  <span className="block text-xs text-muted num">Signed in {fmtDateTime(x.createdAt)} ({ago(x.createdAt)}){x.ip ? ` · ${x.ip}` : ''}</span>
                </span>
                {x.current
                  ? <Button size="sm" variant="ghost" icon={<LogOut size={14} aria-hidden />} onClick={() => void signOut()}>Sign out</Button>
                  : <IconButton label="Sign out this session" size="sm" tone="ghost" onClick={() => setTarget(x)}><LogOut size={15} aria-hidden /></IconButton>}
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted">No active sessions.</p>}
      </QueryView>
      <p className="mt-4 text-xs text-muted">Field glasses use their own device sessions, managed from Field glasses.</p>
      <ConfirmDialog open={!!target} onOpenChange={(v) => !v && setTarget(null)} title="Sign out this session?"
        body={<>{describeAgent(target?.userAgent)} signed in {target ? fmtDateTime(target.createdAt) : ''} will be signed out on its next request.</>}
        confirmLabel="Sign out session" destructive
        onConfirm={async () => { await del(`/auth/sessions/${target!.id}`); invalidatePaths(qc, ['/auth/sessions']); }} />
    </Card>
  );
}
