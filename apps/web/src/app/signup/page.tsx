'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { MailCheck } from 'lucide-react';
import { AuthFrame } from '@/console/AuthFrame';
import { Button, Input, PasswordInput } from '@/ui';
import { errorMessage, publicGet, publicPost } from '@/lib/api';
import type { AuthConfig } from '@/lib/auth-flow';

/**
 * Administrator self sign-up. Only work emails at ADMIN_SIGNUP_DOMAINS may register (the API
 * enforces it). Each sign-up creates a new organization; colleagues join it by invitation.
 */
export default function SignupPage() {
  const [cfg, setCfg] = useState<AuthConfig | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [orgName, setOrgName] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  useEffect(() => {
    publicGet<AuthConfig>('/auth/config').then(setCfg).catch(() => setCfg(null));
  }, []);
  const domains = cfg?.adminSignupDomains ?? ['hydris.ai'];
  const domainList = domains.map((d) => `@${d}`).join(', ');
  const domainOk = !email.includes('@') || domains.includes(email.trim().toLowerCase().split('@').pop() ?? '');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await publicPost('/auth/signup', { name: name.trim(), email: email.trim(), password: pw, orgName: orgName.trim() });
      setSentTo(email.trim());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (!sentTo) return;
    await publicPost('/auth/verify-email/resend', { email: sentTo }).catch(() => {});
  };

  if (sentTo) {
    return (
      <AuthFrame title="Check your inbox" subtitle={<>We sent a confirmation link to <b className="text-text">{sentTo}</b>.</>}>
        <div className="card grid gap-4">
          <MailCheck size={28} aria-hidden className="text-ok-text" />
          <p className="text-text-2">Open the link to confirm your email. You will land in the console setup, where you add your first site and invite your Field Operators.</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => void resend()}>Resend the link</Button>
            <Link href="/login" className="btn btn-ghost">Back to sign in</Link>
          </div>
        </div>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame title="Create an administrator account" subtitle={<>For organization administrators with a work email at {domainList}. Field Operators are invited by their administrator.</>}>
      <form onSubmit={submit} className="grid gap-4" noValidate>
        <Input label="Your name" autoComplete="name" required autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        <Input label="Work email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)}
          error={!domainOk ? `Use your work email (${domainList}).` : null} hint={domainOk ? `Only ${domainList} addresses can create administrator accounts.` : undefined} />
        <Input label="Organization name" required value={orgName} onChange={(e) => setOrgName(e.target.value)} maxLength={120} placeholder="e.g. Riverbend Water Works" />
        <PasswordInput label="Password" autoComplete="new-password" required minLength={12} value={pw} onChange={(e) => setPw(e.target.value)} hint="12+ characters" />
        {error && <p role="alert" className="field-error">{error}</p>}
        <Button type="submit" variant="primary" size="lg" busy={busy} disabled={!domainOk || name.trim().length < 2 || orgName.trim().length < 2 || pw.length < 12 || !email.includes('@')}>Create account</Button>
        <p className="text-xs text-muted">Signing up creates a new organization with you as its administrator. To join an existing organization, ask one of its administrators to invite you.</p>
        <div className="flex items-center justify-between text-sm">
          <Link href="/login" className="text-text-2 underline-offset-4 hover:underline">I already have an account</Link>
          <Link href="/" className="text-muted hover:text-text">Back to website</Link>
        </div>
      </form>
    </AuthFrame>
  );
}
