'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { ROLE_LABELS, type Role } from '@hydris/domain';
import { AuthFrame } from '@/console/AuthFrame';
import { Button, ErrorState, Input, LoadingBlock, PasswordInput } from '@/ui';
import { errorMessage, publicGet, publicPost, type SessionView } from '@/lib/api';
import { useSessionCtx } from '@/lib/session';
import { landingFor } from '@/lib/auth-flow';

interface Preview { email: string; name: string | null; role: Role; orgName: string; existingAccount: boolean }

export default function AcceptInvitation() {
  const { token } = useParams<{ token: string }>();
  const { adopt } = useSessionCtx();
  const router = useRouter();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    publicGet<Preview>(`/auth/invitations/${token}`).then((p) => { setPreview(p); setName(p.name ?? ''); }).catch(setLoadError);
  }, [token]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const s = await publicPost<SessionView>('/auth/invitations/accept', { token, name: preview?.existingAccount ? undefined : name, password: pw });
      adopt(s);
      // Operators continue to the "Get the Hydris Field app" page; administrators to the console.
      router.replace(landingFor(s, null));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  if (loadError) return <AuthFrame title="Invitation unavailable"><ErrorState error={loadError} /></AuthFrame>;
  if (!preview) return <AuthFrame title="Invitation"><LoadingBlock rows={2} /></AuthFrame>;
  return (
    <AuthFrame title={`Join ${preview.orgName}`} subtitle={<>You were invited as <b className="text-text">{ROLE_LABELS[preview.role]}</b> with {preview.email}.{preview.role === 'operator' ? ' After setting your password you will get the Hydris Field app.' : ''}</>}>
      <form onSubmit={submit} className="grid gap-4">
        {!preview.existingAccount && <Input label="Full name" required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />}
        <PasswordInput label={preview.existingAccount ? 'Your existing Hydris password' : 'Create a password'} autoComplete={preview.existingAccount ? 'current-password' : 'new-password'} required value={pw} onChange={(e) => setPw(e.target.value)} hint={preview.existingAccount ? 'This email already has a Hydris account.' : '12+ characters'} />
        {error && <p role="alert" className="field-error">{error}</p>}
        <Button type="submit" variant="primary" size="lg" busy={busy} disabled={!pw || (!preview.existingAccount && name.trim().length < 2)}>Accept invitation</Button>
      </form>
    </AuthFrame>
  );
}
