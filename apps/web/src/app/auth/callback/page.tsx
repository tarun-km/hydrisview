'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { AuthFrame } from '@/console/AuthFrame';
import { Button, LoadingBlock, PasswordInput } from '@/ui';
import { errorMessage, publicPost, type SessionView } from '@/lib/api';
import { landingFor, parseFragment } from '@/lib/auth-flow';
import { useSessionCtx } from '@/lib/session';

/**
 * Landing page for emailed auth links (configure it in Supabase as a redirect URL):
 * - Supabase: `#access_token=…&type=signup|invite|recovery|magiclink` (also `?flow=` from our redirect_to).
 *   Invite and recovery ask for a new password first; the API sets it at Supabase and starts a Hydris session.
 * - Built-in magic link: `?magic=<token>`.
 * Afterwards: administrators go to the console (or its setup wizard), operators to the operator home.
 */
function Callback() {
  const params = useSearchParams();
  const router = useRouter();
  const { adopt } = useSessionCtx();
  const [frag, setFrag] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const once = useRef(false);

  const flow = frag?.type ?? params.get('flow') ?? '';
  const needsPassword = flow === 'invite' || flow === 'recovery';

  const finish = (s: SessionView) => {
    adopt(s);
    router.replace(landingFor(s, null));
  };

  useEffect(() => {
    if (once.current) return;
    once.current = true;
    const f = parseFragment(window.location.hash);
    const magic = params.get('magic');
    const flowParam = params.get('flow');
    // Never leave tokens in the address bar or browser history.
    window.history.replaceState(null, '', window.location.pathname + (flowParam ? `?flow=${encodeURIComponent(flowParam)}` : ''));
    setFrag(f);
    if (f.error || f.error_description) { setError(f.error_description?.replace(/\+/g, ' ') ?? 'This link is invalid or has expired.'); return; }
    if (magic) {
      publicPost<SessionView>('/auth/callback/exchange', { magicToken: magic }).then(finish).catch((e) => setError(errorMessage(e)));
      return;
    }
    if (!f.access_token) { setError('This link is incomplete or has already been used.'); return; }
    const type = f.type ?? params.get('flow') ?? '';
    if (type !== 'invite' && type !== 'recovery') {
      publicPost<SessionView>('/auth/callback/exchange', { accessToken: f.access_token }).then(finish).catch((e) => setError(errorMessage(e)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!frag?.access_token) return;
    setBusy(true);
    setError(null);
    try {
      finish(await publicPost<SessionView>('/auth/callback/exchange', { accessToken: frag.access_token, password: pw }));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  if (error && !(needsPassword && frag?.access_token)) {
    return (
      <AuthFrame title="Link not valid">
        <p className="text-text-2">{error}</p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Link href="/login" className="btn btn-secondary">Back to sign in</Link>
          <Link href="/forgot-password" className="btn btn-ghost">Reset password</Link>
        </div>
      </AuthFrame>
    );
  }
  if (frag && needsPassword && frag.access_token) {
    return (
      <AuthFrame title={flow === 'invite' ? 'Set your password' : 'Choose a new password'} subtitle={flow === 'invite' ? 'Welcome to Hydris. Choose a password for your account; you will use it in the Hydris Field app too.' : 'At least 12 characters. Other sessions will be signed out.'}>
        <form onSubmit={submit} className="grid gap-4">
          <PasswordInput label="New password" autoComplete="new-password" minLength={12} required value={pw} onChange={(e) => setPw(e.target.value)} hint="12+ characters" />
          <PasswordInput label="Repeat password" autoComplete="new-password" required value={pw2} onChange={(e) => setPw2(e.target.value)} error={pw2 && pw !== pw2 ? 'Passwords do not match' : null} />
          {error && <p role="alert" className="field-error">{error}</p>}
          <Button type="submit" variant="primary" size="lg" busy={busy} disabled={pw.length < 12 || pw !== pw2}>Continue</Button>
        </form>
      </AuthFrame>
    );
  }
  return <AuthFrame title="Signing you in"><LoadingBlock rows={2} /></AuthFrame>;
}

export default function AuthCallbackPage() {
  return <Suspense><Callback /></Suspense>;
}
