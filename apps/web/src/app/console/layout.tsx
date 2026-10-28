'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useSessionCtx } from '@/lib/session';
import { ConsoleShell } from '@/console/Shell';
import { ThemedLogo } from '@/console/ThemedLogo';

/** Console gate: nothing renders and no data is requested until the backend confirms the session. */
export default function ConsoleLayout({ children }: { children: ReactNode }) {
  const { state } = useSessionCtx();
  const router = useRouter();
  const pathname = usePathname();
  const noOrg = state.status === 'authed' && !state.session.org;
  const platformAdmin = state.status === 'authed' && state.session.user.isPlatformAdmin;
  const mustRedirectToPlatform = noOrg && platformAdmin && !pathname.startsWith('/console/platform');
  // Field Operators never get the console (the API refuses console endpoints for them too).
  const operatorOnly = state.status === 'authed' && !!state.session.org && !state.session.permissions.includes('console.access');

  useEffect(() => {
    if (state.status === 'anon') router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [state.status, router, pathname]);
  // Navigation is a side effect — never call router.replace during render.
  useEffect(() => {
    if (mustRedirectToPlatform) router.replace('/console/platform');
  }, [mustRedirectToPlatform, router]);
  useEffect(() => {
    if (operatorOnly) router.replace('/operator');
  }, [operatorOnly, router]);

  if (state.status !== 'authed' || mustRedirectToPlatform || operatorOnly) {
    return (
      <div className="grid min-h-dvh place-items-center" role="status" aria-label="Checking session">
        <div className="grid place-items-center gap-5">
          <span className="pulse-dot"><ThemedLogo /></span>
          <span className="h-[3px] w-28 overflow-hidden rounded-full bg-surface-2"><span className="skeleton block h-full w-full rounded-full" /></span>
        </div>
      </div>
    );
  }
  if (noOrg && !platformAdmin) {
    return (
      <div className="grid min-h-dvh place-items-center p-6 text-center">
        <div className="card max-w-md">
          <p className="t-section">No active organization</p>
          <p className="mt-2 text-text-2">Your membership is inactive. Contact your organization administrator to be re-invited.</p>
          <a href="/login" className="btn btn-secondary mt-6">Back to sign in</a>
        </div>
      </div>
    );
  }
  return <ConsoleShell>{children}</ConsoleShell>;
}
