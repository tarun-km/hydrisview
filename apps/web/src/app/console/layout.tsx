'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useSessionCtx } from '@/lib/session';
import { ConsoleShell } from '@/console/Shell';
import { Logo } from '@/site/Logo';

/** Console gate: nothing renders and no data is requested until the backend confirms the session. */
export default function ConsoleLayout({ children }: { children: ReactNode }) {
  const { state } = useSessionCtx();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (state.status === 'anon') router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [state.status, router, pathname]);

  if (state.status !== 'authed') {
    return <div className="grid min-h-dvh place-items-center" role="status" aria-label="Checking session"><span className="pulse-dot"><Logo /></span></div>;
  }
  if (!state.session.org) {
    if (state.session.user.isPlatformAdmin && !pathname.startsWith('/console/platform')) router.replace('/console/platform');
    else if (!state.session.user.isPlatformAdmin) {
      return <div className="grid min-h-dvh place-items-center p-6 text-center"><div><p className="t-section">No active organization</p><p className="mt-2 text-text-2">Your membership is inactive. Contact your administrator.</p></div></div>;
    }
  }
  return <ConsoleShell>{children}</ConsoleShell>;
}
