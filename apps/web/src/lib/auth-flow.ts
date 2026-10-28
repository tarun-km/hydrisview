import type { SessionView } from './api';

/** Public auth configuration from GET /api/auth/config (no secrets). */
export interface AuthConfig {
  provider: 'supabase' | 'builtin';
  demo: boolean;
  adminSignupDomains: string[];
  magicLink: boolean;
  androidAppUrl: string;
  androidApkUrl: string | null;
  appScheme: string;
}

/** Where a session should land. Operators never go to the console (the API enforces it too). */
export function landingFor(s: SessionView, next: string | null): string {
  const home = s.home ?? (s.role === 'operator' ? '/operator' : '/console');
  if (s.role === 'operator') {
    return next && (next.startsWith('/operator') || next.startsWith('/glasses') || next.startsWith('/pair')) ? next : home;
  }
  return next && !next.startsWith('/operator') ? next : home;
}

/** Parse the URL fragment Supabase appends to redirect links (#access_token=…&type=…). */
export function parseFragment(hash: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(hash.replace(/^#/, ''))) out[k] = v;
  return out;
}

export const ENDED_MESSAGES: Record<string, string> = {
  account_suspended: 'Your account was suspended by your administrator. You have been signed out everywhere.',
  account_removed: 'Your access to this organization was removed. You have been signed out everywhere.',
};
