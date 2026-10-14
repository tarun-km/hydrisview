'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { AuthFrame } from '@/console/AuthFrame';
import { Button, Input } from '@/ui';
import { errorMessage, publicPost } from '@/lib/api';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await publicPost('/auth/password-reset/request', { email: email.trim() });
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthFrame title="Reset password" subtitle="We will email a link that is valid for 30 minutes.">
      {sent ? (
        <div className="card grid gap-3">
          <p className="t-card">Check your inbox</p>
          <p className="text-sm text-text-2">If an account exists for {email}, a reset link is on its way. For security we show the same message either way.</p>
          <Link href="/login" className="btn btn-secondary mt-2">Back to sign in</Link>
        </div>
      ) : (
        <form onSubmit={submit} className="grid gap-4">
          <Input label="Work email" type="email" autoComplete="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
          {error && <p role="alert" className="field-error">{error}</p>}
          <Button type="submit" variant="primary" size="lg" busy={busy} disabled={!email}>Send reset link</Button>
          <Link href="/login" className="text-sm text-text-2">Back to sign in</Link>
        </form>
      )}
    </AuthFrame>
  );
}
