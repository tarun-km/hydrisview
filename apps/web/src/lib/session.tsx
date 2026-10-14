'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Permission } from '@hydris/domain';
import { ApiError, post, refreshSession, setAccessToken, setSessionLostHandler, type SessionView } from './api';

type State = { status: 'loading' } | { status: 'anon' } | { status: 'authed'; session: SessionView };

interface SessionCtx {
  state: State;
  signIn: (email: string, password: string) => Promise<{ mfaToken?: string }>;
  verifyMfa: (mfaToken: string, code: string) => Promise<void>;
  adopt: (s: SessionView) => void;
  signOut: () => Promise<void>;
  switchOrg: (orgId: string) => Promise<void>;
  reload: () => Promise<void>;
}

const Ctx = createContext<SessionCtx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const qc = useQueryClient();

  const adopt = useCallback((s: SessionView) => {
    if (s.accessToken) setAccessToken(s.accessToken);
    setState({ status: 'authed', session: s });
  }, []);

  const reload = useCallback(async () => {
    const s = await refreshSession();
    setState(s ? { status: 'authed', session: s } : { status: 'anon' });
  }, []);

  useEffect(() => {
    setSessionLostHandler(() => {
      setAccessToken(null);
      qc.clear();
      setState({ status: 'anon' });
    });
    void reload();
  }, [qc, reload]);

  const signIn = useCallback(async (email: string, password: string) => {
    const r = await post<SessionView & { mfaRequired?: boolean; mfaToken?: string }>('/auth/login', { email, password });
    if (r.mfaRequired) return { mfaToken: r.mfaToken };
    adopt(r);
    return {};
  }, [adopt]);

  const verifyMfa = useCallback(async (mfaToken: string, code: string) => {
    adopt(await post<SessionView>('/auth/mfa/verify', { mfaToken, code }));
  }, [adopt]);

  const signOut = useCallback(async () => {
    await post('/auth/logout').catch(() => {});
    setAccessToken(null);
    qc.clear();
    setState({ status: 'anon' });
  }, [qc]);

  const switchOrg = useCallback(async (orgId: string) => {
    const s = await post<SessionView>('/auth/switch-org', { orgId });
    qc.clear();
    adopt(s);
  }, [adopt, qc]);

  const value = useMemo(() => ({ state, signIn, verifyMfa, adopt, signOut, switchOrg, reload }), [state, signIn, verifyMfa, adopt, signOut, switchOrg, reload]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSessionCtx() {
  const c = useContext(Ctx);
  if (!c) throw new Error('SessionProvider missing');
  return c;
}

export function useSession(): SessionView {
  const { state } = useSessionCtx();
  if (state.status !== 'authed') throw new ApiError(401, 'unauthenticated', 'Not signed in');
  return state.session;
}

export function useCan() {
  const s = useSession();
  return useCallback((perm: Permission) => s.permissions.includes(perm), [s.permissions]);
}
