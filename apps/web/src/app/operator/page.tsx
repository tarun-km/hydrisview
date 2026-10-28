'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toDataURL } from 'qrcode';
import { Download, Glasses, LogOut, ScanLine, Smartphone } from 'lucide-react';
import { ThemedLogo } from '@/console/ThemedLogo';
import { ThemeToggle } from '@/ui/theme';
import { Button, Chip, LoadingBlock } from '@/ui';
import { getAccessToken, publicGet, refreshSession, setAccessToken } from '@/lib/api';
import { openStream } from '@/lib/realtime';
import type { AuthConfig } from '@/lib/auth-flow';
import { useSessionCtx } from '@/lib/session';

/**
 * Operator home on the web. Field Operators never get the console (the API refuses console
 * endpoints for them); this page explains the Hydris Field app, links the download (Play listing
 * or APK while the listing is pending), shows a QR code to open it on the phone, and links the
 * web glasses app.
 */
export default function OperatorHome() {
  const { state, signOut } = useSessionCtx();
  const router = useRouter();
  const [cfg, setCfg] = useState<AuthConfig | null>(null);
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    if (state.status === 'anon') router.replace('/login?next=/operator');
  }, [state.status, router]);
  useEffect(() => {
    publicGet<AuthConfig>('/auth/config').then(setCfg).catch(() => setCfg(null));
  }, []);
  // Suspension / removal signs this page out within seconds (account.ended over SSE).
  const authed = state.status === 'authed';
  useEffect(() => {
    if (!authed) return;
    return openStream({
      getToken: getAccessToken,
      refresh: async () => !!(await refreshSession()),
      onStatus: () => {},
      onEvent: (e) => {
        if (e.type === 'account.ended') {
          setAccessToken(null);
          window.location.assign(`/login?ended=${encodeURIComponent(String(e.data.code ?? 'account_suspended'))}`);
        }
      },
    });
  }, [authed]);
  const downloadUrl = cfg ? (cfg.androidApkUrl ?? cfg.androidAppUrl) : null;
  useEffect(() => {
    if (!downloadUrl) return;
    void toDataURL(downloadUrl, { margin: 1, width: 360, errorCorrectionLevel: 'M' }).then(setQr).catch(() => setQr(null));
  }, [downloadUrl]);

  if (state.status !== 'authed') return <main className="grid min-h-dvh place-items-center p-6"><div className="w-full max-w-md"><LoadingBlock rows={3} /></div></main>;
  const s = state.session;
  const first = s.user.name.split(' ')[0];
  const appLink = `hydrisfield://login?email=${encodeURIComponent(s.user.email)}`;

  return (
    <main id="main" className="min-h-dvh bg-bg">
      <header className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-5 sm:px-6">
        <Link href="/" aria-label="Hydris AI home" className="rounded-full"><ThemedLogo /></Link>
        <div className="flex items-center gap-2">
          <ThemeToggle size="sm" />
          <Button variant="ghost" size="sm" icon={<LogOut size={15} aria-hidden />} onClick={() => void signOut().then(() => router.replace('/login'))}>Sign out</Button>
        </div>
      </header>
      <div className="mx-auto grid max-w-5xl gap-6 px-4 pb-16 sm:px-6">
        <section className="card grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone="lime">{s.role === 'admin' ? 'Administrator' : 'Field Operator'}</Chip>
            {s.org && <Chip tone="outline">{s.org.name}</Chip>}
            {s.org?.isDemo && <Chip tone="synthetic">Demo</Chip>}
          </div>
          <h1 className="t-page">Welcome, {first}</h1>
          <p className="max-w-2xl text-text-2">Your work happens in the field: on the <b className="text-text">Hydris Field</b> Android app and on your smart glasses. Inspections, maintenance tasks, alarms, scans and the assistant are all there. Sign in to the app with this same email and password.</p>
          {s.profile && (s.profile.employeeId || s.profile.shiftLabel) && (
            <p className="text-sm text-muted num">{[s.profile.employeeId && `Employee ${s.profile.employeeId}`, s.profile.shiftLabel].filter(Boolean).join(' · ')}</p>
          )}
        </section>

        <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
          <section className="card grid content-start gap-4" aria-labelledby="get-app">
            <h2 id="get-app" className="t-section flex items-center gap-2"><Smartphone size={20} aria-hidden />Get the Hydris Field app</h2>
            <ol className="grid gap-2 text-text-2">
              <li>1. On your Android phone, open the download link (or scan the QR code).</li>
              <li>2. Install Hydris Field and open it.</li>
              <li>3. {s.org?.isDemo ? <>In the demo, tap <b className="text-text">Try as Field Operator</b> in the app.</> : <>Sign in with <b className="text-text">{s.user.email}</b>, or ask for an emailed sign-in link.</>}</li>
              <li>4. Connect your glasses from the Glasses tab.</li>
            </ol>
            <div className="flex flex-wrap gap-2">
              {cfg && <a className="btn btn-primary" href={cfg.androidAppUrl} target="_blank" rel="noreferrer"><Download size={16} aria-hidden />Get it on Google Play</a>}
              {cfg?.androidApkUrl && <a className="btn btn-secondary" href={cfg.androidApkUrl}>Download the APK</a>}
              <a className="btn btn-ghost" href={appLink}>Open in the app</a>
            </div>
            <p className="text-xs text-muted">
              The Play Store listing is being prepared. Until it is live, your administrator shares the Hydris Field APK (Android 10 or later): allow installs from that source when Android asks. &ldquo;Open in the app&rdquo; works on a phone that already has Hydris Field installed.
            </p>
          </section>
          <section className="card grid place-items-center gap-3 text-center" aria-label="QR code for the app download">
            {qr ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qr} alt="QR code that opens the Hydris Field download on your phone" width={220} height={220} className="rounded-[18px] bg-white p-2" />
            ) : <div className="h-[220px] w-[220px] rounded-[18px] bg-surface-2" aria-hidden />}
            <p className="text-sm text-text-2">Scan with your phone camera to download Hydris Field.</p>
          </section>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Link href="/glasses" className="card flex items-start gap-3 hover:border-line-2">
            <Glasses size={22} aria-hidden className="mt-0.5 flex-none" />
            <span><span className="t-card block">Glasses app on the web</span><span className="text-sm text-text-2">Open the glasses experience in this browser (simulator and browser-based glasses).</span></span>
          </Link>
          <Link href="/pair" className="card flex items-start gap-3 hover:border-line-2">
            <ScanLine size={22} aria-hidden className="mt-0.5 flex-none" />
            <span><span className="t-card block">Pair glasses with a code</span><span className="text-sm text-text-2">Enter the code shown on your glasses to connect them to your account.</span></span>
          </Link>
        </div>
        {s.role === 'admin' && <p className="text-sm text-text-2">You are an administrator: <Link className="underline" href="/console">open the console</Link>.</p>}
      </div>
    </main>
  );
}
