'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { AuthFrame } from '@/console/AuthFrame';
import { Button, Input, PasswordInput } from '@/ui';
import { errorMessage, publicPost } from '@/lib/api';

function ResetForm() {
  const token = useSearchParams().get('token') ?? '';
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mismatch = pw2.length > 0 && pw !== pw2;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await publicPost('/auth/password-reset/complete', { token, password: pw });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  if (!token) return <AuthFrame title="Invalid link"><p className="text-text-2">This reset link is incomplete. Request a new one.</p><Link className="btn btn-secondary mt-6" href="/forgot-password">Request new link</Link></AuthFrame>;
  return (
    <AuthFrame title="Choose a new password" subtitle="At least 12 characters. All your other sessions will be signed out.">
      {done ? (
        <div className="card grid gap-3"><p className="t-card">Password updated</p><Link href="/login" className="btn btn-primary">Sign in</Link></div>
      ) : (
        <form onSubmit={submit} className="grid gap-4">
          <PasswordInput label="New password" autoComplete="new-password" minLength={12} required value={pw} onChange={(e) => setPw(e.target.value)} hint="12+ characters" />
          <PasswordInput label="Repeat password" autoComplete="new-password" required value={pw2} onChange={(e) => setPw2(e.target.value)} error={mismatch ? 'Passwords do not match' : null} />
          {error && <p role="alert" className="field-error">{error}</p>}
          <Button type="submit" variant="primary" size="lg" busy={busy} disabled={pw.length < 12 || pw !== pw2}>Update password</Button>
        </form>
      )}
    </AuthFrame>
  );
}

export default function ResetPassword() {
  return <Suspense><ResetForm /></Suspense>;
}
