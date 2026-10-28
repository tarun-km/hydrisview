'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { AuthFrame } from '@/console/AuthFrame';
import { LoadingBlock } from '@/ui';
import { errorMessage, publicPost, type SessionView } from '@/lib/api';
import { landingFor } from '@/lib/auth-flow';
import { useSessionCtx } from '@/lib/session';

/** Built-in provider: email confirmation link for administrator sign-up. */
function Verify() {
  const token = useSearchParams().get('token') ?? '';
  const { adopt } = useSessionCtx();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const once = useRef(false);
  useEffect(() => {
    if (once.current) return;
    once.current = true;
    if (!token) { setError('This link is incomplete.'); return; }
    publicPost<SessionView>('/auth/verify-email', { token })
      .then((s) => { adopt(s); router.replace(landingFor(s, null)); })
      .catch((e) => setError(errorMessage(e)));
  }, [token, adopt, router]);
  if (error) {
    return (
      <AuthFrame title="Link not valid">
        <p className="text-text-2">{error} Sign in to request a new confirmation email, or sign up again.</p>
        <Link href="/login" className="btn btn-secondary mt-6">Back to sign in</Link>
      </AuthFrame>
    );
  }
  return <AuthFrame title="Confirming your email"><LoadingBlock rows={2} /></AuthFrame>;
}

export default function VerifyPage() {
  return <Suspense><Verify /></Suspense>;
}
