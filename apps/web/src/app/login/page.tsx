'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { AuthFrame } from '@/console/AuthFrame';
import { Button, Input } from '@/ui';
import { errorMessage } from '@/lib/api';
import { useSessionCtx } from '@/lib/session';

function LoginForm() {
  const { state, signIn, verifyMfa } = useSessionCtx();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next');
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/console';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (state.status === 'authed') router.replace(safeNext);
  }, [state.status, router, safeNext]);

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
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame title={mfaToken ? 'Two-step verification' : 'Sign in'} subtitle={mfaToken ? 'Enter the 6-digit code from your authenticator app.' : 'Access is provisioned by your organization administrator.'}>
      <form onSubmit={submit} className="grid gap-4" noValidate>
        {!mfaToken ? (
          <>
            <Input label="Work email" type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
            <Input label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </>
        ) : (
          <Input label="Authentication code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} className="num text-center text-2xl tracking-[0.4em]" />
        )}
        {error && <p role="alert" className="field-error">{error}</p>}
        <Button type="submit" variant="primary" size="lg" busy={busy} disabled={mfaToken ? code.length !== 6 : !email || !password}>
          {mfaToken ? 'Verify and continue' : 'Sign in'}
        </Button>
        <div className="flex items-center justify-between text-sm">
          <Link href="/forgot-password" className="text-text-2 underline-offset-4 hover:underline">Forgot password?</Link>
          <Link href="/" className="text-muted hover:text-text">Back to website</Link>
        </div>
      </form>
    </AuthFrame>
  );
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}
