'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowUpRight, CheckCircle2, Loader2 } from 'lucide-react';
import { ApiError, publicPost } from '@/lib/api';

type Kind = 'demo' | 'contact';
type Fields = { name: string; email: string; company: string; jobTitle: string; phone: string; siteCount: string; message: string; consent: boolean; website: string };
type Errors = Partial<Record<keyof Fields, string>>;

const EMPTY: Fields = { name: '', email: '', company: '', jobTitle: '', phone: '', siteCount: '', message: '', consent: false, website: '' };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const SITE_COUNTS = [
  { value: '1', label: '1 site' },
  { value: '2-5', label: '2–5 sites' },
  { value: '6-20', label: '6–20 sites' },
  { value: '20+', label: 'More than 20' },
];

function validate(f: Fields, kind: Kind): Errors {
  const e: Errors = {};
  if (f.name.trim().length < 2) e.name = 'Enter your full name.';
  if (!f.email.trim()) e.email = 'Enter your work email.';
  else if (!EMAIL.test(f.email.trim())) e.email = 'Enter a valid email address, like name@company.com.';
  if (kind === 'demo' && !f.company.trim()) e.company = 'Enter your organisation so we can prepare the demo.';
  if (kind === 'demo' && !f.siteCount) e.siteCount = 'Choose how many sites you operate.';
  if (f.phone && !/^[0-9+()\-\s.]*$/.test(f.phone)) e.phone = 'Use digits and + ( ) - only.';
  if (kind === 'contact' && f.message.trim().length < 10) e.message = 'Tell us a little more (at least 10 characters).';
  if (f.message.length > 4000) e.message = 'Keep the message under 4,000 characters.';
  if (!f.consent) e.consent = 'Please confirm we may use these details to reply to you.';
  return e;
}

export function ContactForm({ initialKind = 'demo' }: { initialKind?: Kind }) {
  const [kind, setKind] = useState<Kind>(initialKind);
  const [f, setF] = useState<Fields>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [state, setState] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [serverError, setServerError] = useState('');
  const startedAt = useRef<number | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const successRef = useRef<HTMLDivElement>(null);

  // Set in an effect (not during render) so server and client markup match.
  useEffect(() => { startedAt.current = Date.now(); }, []);
  useEffect(() => { if (state === 'success') successRef.current?.focus(); }, [state]);

  const set = <K extends keyof Fields>(k: K, v: Fields[K]) => {
    setF((p) => ({ ...p, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    const e = validate(f, kind);
    setErrors(e);
    const first = (Object.keys(e) as (keyof Fields)[])[0];
    if (first) {
      formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
      return;
    }
    setState('submitting');
    setServerError('');
    const opt = (s: string) => (s.trim() ? s.trim() : undefined);
    try {
      await publicPost('/public/inquiries', {
        kind, name: f.name.trim(), email: f.email.trim(), company: opt(f.company), jobTitle: opt(f.jobTitle), phone: opt(f.phone),
        siteCount: f.siteCount || undefined, message: opt(f.message), consent: true, website: f.website, startedAt: startedAt.current ?? undefined,
      });
      setState('success');
    } catch (err) {
      setState('error');
      if (err instanceof ApiError && err.status === 429) setServerError('Too many requests from your network. Please wait a few minutes and try again.');
      else if (err instanceof ApiError && err.code === 'too_fast') setServerError(err.message);
      else if (err instanceof ApiError && err.status === 400) setServerError('Some details could not be accepted. Please check the form and try again.');
      else setServerError(err instanceof Error && err.message ? `We could not send your message: ${err.message}` : 'We could not send your message. Please try again.');
    }
  }

  if (state === 'success')
    return (
      <div ref={successRef} tabIndex={-1} role="status" className="rounded-[28px] bg-lime p-8 text-lime-ink outline-none sm:p-10">
        <CheckCircle2 size={36} strokeWidth={1.6} aria-hidden />
        <h2 className="t-page mt-6">{kind === 'demo' ? 'Demo request received.' : 'Message received.'}</h2>
        <p className="mt-4 max-w-md text-[16px] leading-relaxed text-lime-ink/90">
          Thank you, {f.name.split(' ')[0]}. A member of the Hydris team will reply to {f.email} within two working days. We only use these details to respond to you.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/demo" className="btn btn-ink">Try the live demo meanwhile <ArrowUpRight size={16} aria-hidden /></Link>
          <button type="button" className="btn btn-outline-ink" onClick={() => { setF(EMPTY); setState('idle'); startedAt.current = Date.now(); }}>Send another</button>
        </div>
      </div>
    );

  const busy = state === 'submitting';
  return (
    <div>
      <div role="tablist" aria-label="Enquiry type" className="capsule capsule-lime">
        {(['demo', 'contact'] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={kind === k} aria-controls="enquiry-form" onClick={() => { setKind(k); setErrors({}); }}>
            {k === 'demo' ? 'Request a demo' : 'General enquiry'}
          </button>
        ))}
      </div>

      <form id="enquiry-form" ref={formRef} role="tabpanel" noValidate onSubmit={onSubmit} aria-describedby="form-required-note" className="relative mt-8 grid gap-5 sm:grid-cols-2">
        <p id="form-required-note" className="text-[13px] text-muted sm:col-span-2">Fields marked <span aria-hidden>*</span><span className="sr-only">with an asterisk</span> are required.</p>

        <TextField name="name" label="Full name" required autoComplete="name" value={f.name} error={errors.name} onChange={(v) => set('name', v)} />
        <TextField name="email" label="Work email" type="email" required autoComplete="email" value={f.email} error={errors.email} onChange={(v) => set('email', v)} />
        <TextField name="company" label="Organisation" required={kind === 'demo'} autoComplete="organization" value={f.company} error={errors.company} onChange={(v) => set('company', v)} />
        <TextField name="jobTitle" label="Role" autoComplete="organization-title" value={f.jobTitle} error={errors.jobTitle} onChange={(v) => set('jobTitle', v)} hint="e.g. Plant manager, O&M lead" />
        <TextField name="phone" label="Phone" type="tel" autoComplete="tel" value={f.phone} error={errors.phone} onChange={(v) => set('phone', v)} hint="Optional" />
        <FieldShell name="siteCount" label="Sites you operate" required={kind === 'demo'} error={errors.siteCount}>
          {(id, describedBy) => (
            <select id={id} name="siteCount" className="select" value={f.siteCount} onChange={(e) => set('siteCount', e.target.value)}
              aria-invalid={!!errors.siteCount || undefined} aria-describedby={describedBy} aria-required={kind === 'demo' || undefined}>
              <option value="">Select…</option>
              {SITE_COUNTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          )}
        </FieldShell>
        <div className="sm:col-span-2">
          <FieldShell name="message" label={kind === 'demo' ? 'What should we focus on?' : 'Message'} required={kind === 'contact'} error={errors.message}
            hint={kind === 'demo' ? 'Optional — plant type (ETP/STP/WTP), how data reaches SCADA today, rounds you want to improve.' : undefined}>
            {(id, describedBy) => (
              <textarea id={id} name="message" rows={5} className="textarea" value={f.message} maxLength={4000} onChange={(e) => set('message', e.target.value)}
                aria-invalid={!!errors.message || undefined} aria-describedby={describedBy} aria-required={kind === 'contact' || undefined} />
            )}
          </FieldShell>
        </div>

        {/* Honeypot: hidden from people and assistive tech; bots that fill it are rejected by the API. */}
        <div className="hp-field" aria-hidden="true">
          <label htmlFor="website">Website</label>
          <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => set('website', e.target.value)} />
        </div>

        <div className="sm:col-span-2">
          <div className="flex items-start gap-3">
            <input id="consent" name="consent" type="checkbox" checked={f.consent} onChange={(e) => set('consent', e.target.checked)}
              aria-invalid={!!errors.consent || undefined} aria-describedby={errors.consent ? 'consent-error' : undefined}
              className="mt-0.5 h-5 w-5 flex-none cursor-pointer accent-[#1746e4]" />
            <label htmlFor="consent" className="cursor-pointer text-[14px] leading-relaxed text-text-2">
              I agree that Hydris may store these details and contact me about this enquiry, as described in the{' '}
              <Link href="/privacy" className="text-text underline underline-offset-4 hover:text-[var(--hx-accent-text)]">privacy notice</Link>. <span aria-hidden>*</span>
            </label>
          </div>
          {errors.consent && <p id="consent-error" className="field-error mt-2">{errors.consent}</p>}
        </div>

        {state === 'error' && serverError && (
          <div role="alert" className="rounded-[18px] border border-[rgb(255_90_78/0.4)] bg-[rgb(255_90_78/0.08)] p-4 text-[14px] text-[var(--hx-alert-text)] sm:col-span-2">{serverError}</div>
        )}

        <div className="flex flex-wrap items-center gap-4 sm:col-span-2">
          <button type="submit" className="btn btn-primary btn-lg" disabled={busy} aria-busy={busy || undefined}>
            {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
            {busy ? 'Sending…' : kind === 'demo' ? 'Request a demo' : 'Send message'}
            {!busy && <ArrowUpRight size={16} aria-hidden />}
          </button>
          <span className="text-[13px] text-muted">We reply within two working days. No marketing without your separate consent.</span>
        </div>
      </form>
    </div>
  );
}

function FieldShell({ name, label, required, error, hint, children }: { name: string; label: string; required?: boolean; error?: string; hint?: string; children: (id: string, describedBy: string | undefined) => ReactNode }) {
  const uid = useId();
  const id = `${name}-${uid}`;
  const errId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = error ? errId : hint ? hintId : undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}{required && <span aria-hidden> *</span>}</label>
      {children(id, describedBy)}
      {error ? <span id={errId} className="field-error">{error}</span> : hint ? <span id={hintId} className="field-hint">{hint}</span> : null}
    </div>
  );
}

function TextField({ name, label, value, onChange, error, required, type = 'text', autoComplete, hint }: { name: string; label: string; value: string; onChange: (v: string) => void; error?: string; required?: boolean; type?: string; autoComplete?: string; hint?: string }) {
  return (
    <FieldShell name={name} label={label} required={required} error={error} hint={hint}>
      {(id, describedBy) => (
        <input id={id} name={name} type={type} autoComplete={autoComplete} value={value} onChange={(e) => onChange(e.target.value)}
          className={clsx('input')} aria-invalid={!!error || undefined} aria-describedby={describedBy} aria-required={required || undefined} />
      )}
    </FieldShell>
  );
}
