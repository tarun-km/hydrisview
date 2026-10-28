'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { HardHat, ShieldCheck } from 'lucide-react';
import type { Role } from '@hydris/domain';
import { AuthFrame } from '@/console/AuthFrame';
import { Button, Input, PasswordInput } from '@/ui';
import { ApiError, errorMessage, publicGet, publicPost, type SessionView } from '@/lib/api';
import { useSessionCtx } from '@/lib/session';
import { ENDED_MESSAGES, landingFor, type AuthConfig } from '@/lib/auth-flow';

function LoginForm() {
  const { state, signIn, verifyMfa, adopt } = useSessionCtx();
  const [demoType, setDemoType] = useState<Role | null>(null);
  const [demoName, setDemoName] = useState('');
  const [cfg, setCfg] = useState<AuthConfig | null>(null);
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next');
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : null;
  const ended = params.get('ended');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(ended ? (ENDED_MESSAGES[ended] ?? null) : null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    publicGet<AuthConfig>('/auth/config').then(setCfg).catch(() => setCfg(null));
  }, []);
  useEffect(() => {
    if (state.status === 'authed') router.replace(landingFor(state.session, safeNext));
  }, [state, router, safeNext]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mfaToken) await verifyMfa(mfaToken, code.trim());
      else {
        const r = await signIn(email.trim(), password);
        if (r.mfaToken) setMfaToken(r.mfaToken);
      }
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'email_not_verified' ? `${err.message} ` : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const magic = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError('Enter your work email first.'); return; }
    setBusy(true);
    setError(null);
    try {
      await publicPost('/auth/magic-link', { email: email.trim(), client: 'web' });
      setNotice(`If ${email.trim()} has a Hydris account, a sign-in link is on its way. It works once, for 15 minutes.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const demoSignIn = async (e: FormEvent) => {
    e.preventDefault();
    if (demoName.trim().length < 2 || !demoType) return;
    setBusy(true);
    setError(null);
    try {
      adopt(await publicPost<SessionView>('/auth/demo', { name: demoName.trim(), type: demoType }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const demoAvailable = cfg?.demo ?? false;
  return (
    <AuthFrame title={mfaToken ? 'Two-step verification' : 'Sign in'} subtitle={mfaToken ? 'Enter the 6-digit code from your authenticator app.' : 'Administrators use the console. Field Operators are invited by their administrator and use the Hydris Field app.'}>
      {notice && <p role="status" className="mb-4 rounded-[16px] border border-line bg-surface-2 px-4 py-3 text-sm text-text-2">{notice}</p>}
      <form onSubmit={submit} className="grid gap-4" noValidate>
        {!mfaToken ? (
          <>
            <Input label="Work email" type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
            <PasswordInput label="Password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </>
        ) : (
          <Input label="Authentication code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} className="num text-center text-2xl tracking-[0.4em]" />
        )}
        {error && <p role="alert" className="field-error">{error}</p>}
        <Button type="submit" variant="primary" size="lg" busy={busy} disabled={mfaToken ? code.length !== 6 : !email || !password}>
          {mfaToken ? 'Verify and continue' : 'Sign in'}
        </Button>
        {!mfaToken && (
          <Button type="button" variant="ghost" onClick={() => void magic()} disabled={busy}>Email me a sign-in link instead</Button>
        )}
        {!mfaToken && demoAvailable && !demoType && (
          <div className="grid gap-2 rounded-[20px] border border-line p-3">
            <p className="t-label px-1">Explore the demo plant</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button type="button" variant="secondary" icon={<ShieldCheck size={16} aria-hidden />} onClick={() => setDemoType('admin')}>Try as Administrator</Button>
              <Button type="button" variant="secondary" icon={<HardHat size={16} aria-hidden />} onClick={() => setDemoType('operator')}>Try as Field Operator</Button>
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <Link href="/forgot-password" className="text-text-2 underline-offset-4 hover:underline">Forgot password?</Link>
          <Link href="/signup" className="text-text-2 underline-offset-4 hover:underline">Create an administrator account</Link>
          <Link href="/" className="text-muted hover:text-text">Back to website</Link>
        </div>
      </form>
      {!mfaToken && demoType && (
        <form onSubmit={demoSignIn} className="mt-4 grid gap-3 rounded-[20px] border border-line p-4" noValidate>
          <p className="text-sm text-text-2">
            {demoType === 'admin'
              ? 'You get a personal Administrator account in the shared demo plant: the full console with synthetic data, and glasses if you pair them.'
              : 'You get a personal Field Operator account in the shared demo plant: your own inspections and tasks, the glasses app and the operator home. No console.'}
          </p>
          <Input label="Your name" autoComplete="name" autoFocus required maxLength={40} value={demoName} onChange={(e) => setDemoName(e.target.value)} />
          <div className="grid grid-cols-2 gap-3">
            <Button type="button" variant="secondary" onClick={() => setDemoType(null)}>Cancel</Button>
            <Button type="submit" variant="primary" busy={busy} disabled={demoName.trim().length < 2}>{demoType === 'admin' ? 'Start as Administrator' : 'Start as Field Operator'}</Button>
          </div>
        </form>
      )}
    </AuthFrame>
  );
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}
