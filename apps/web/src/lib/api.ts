'use client';

import type { Permission, Role } from '@hydris/domain';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export interface SessionView {
  accessToken?: string;
  user: { id: string; name: string; email: string; isPlatformAdmin: boolean; mfaEnabled: boolean; emailVerified?: boolean };
  memberships: { orgId: string; orgName: string; role: Role; isDemo: boolean; allSites: boolean }[];
  org: { id: string; name: string; isDemo: boolean; setupCompleted?: boolean } | null;
  role: Role | null;
  /** 'admin' (console + glasses) or 'operator' (Hydris Field app + glasses). */
  accountType?: Role | null;
  profile?: { title: string | null; employeeId: string | null; phone: string | null; shiftLabel: string | null } | null;
  /** Where to land after sign-in: /console, /console/setup or /operator. */
  home?: string;
  permissions: Permission[];
  siteScope: 'all' | string[];
}

/**
 * Access tokens live only in memory. The refresh token is an httpOnly, SameSite=Strict
 * cookie scoped to /api/auth, so page scripts can never read it.
 */
let accessToken: string | null = null;
let onSessionLost: () => void = () => {};
export const setSessionLostHandler = (fn: () => void) => (onSessionLost = fn);
export const getAccessToken = () => accessToken;
export const setAccessToken = (t: string | null) => (accessToken = t);

async function raw(path: string, init: RequestInit & { json?: unknown } = {}, auth = true) {
  const headers = new Headers(init.headers);
  if (init.json !== undefined) headers.set('content-type', 'application/json');
  if (auth && accessToken) headers.set('authorization', `Bearer ${accessToken}`);
  return fetch(`/api${path}`, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body, credentials: 'same-origin' });
}

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const type = res.headers.get('content-type') ?? '';
  const data = type.includes('json') ? await res.json().catch(() => ({})) : await res.text();
  if (!res.ok) {
    const e = (data as { error?: { code?: string; message?: string; details?: unknown } }).error;
    throw new ApiError(res.status, e?.code ?? 'request_failed', e?.message ?? `Request failed (${res.status})`, e?.details);
  }
  return data as T;
}

let refreshing: Promise<SessionView | null> | null = null;
/** Single-flight refresh; resolves null when there is no valid session. */
export function refreshSession(): Promise<SessionView | null> {
  refreshing ??= (async () => {
    try {
      const res = await raw('/auth/refresh', { method: 'POST' }, false);
      if (!res.ok) {
        accessToken = null;
        return null;
      }
      const s = (await res.json()) as SessionView;
      accessToken = s.accessToken ?? null;
      return s;
    } catch {
      return null;
    } finally {
      setTimeout(() => (refreshing = null), 0);
    }
  })();
  return refreshing;
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  let res = await raw(path, init);
  if (res.status === 401 && !path.startsWith('/auth/login')) {
    const s = await refreshSession();
    if (!s) {
      onSessionLost();
      throw new ApiError(401, 'unauthenticated', 'Your session has ended. Please sign in again.');
    }
    res = await raw(path, init);
  }
  return parse<T>(res);
}

export const post = <T>(path: string, json?: unknown) => api<T>(path, { method: 'POST', json: json ?? {} });
export const patch = <T>(path: string, json: unknown) => api<T>(path, { method: 'PATCH', json });
export const put = <T>(path: string, json: unknown) => api<T>(path, { method: 'PUT', json });
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' });

export async function publicPost<T>(path: string, json: unknown): Promise<T> {
  return parse<T>(await raw(path, { method: 'POST', json }, false));
}
export async function publicGet<T>(path: string): Promise<T> {
  return parse<T>(await raw(path, {}, false));
}

/** Authenticated binary fetch (images, PDFs) without putting tokens in URLs. */
export async function apiBlob(path: string): Promise<Blob> {
  let res = await raw(path);
  if (res.status === 401 && (await refreshSession())) res = await raw(path);
  if (!res.ok) await parse(res);
  return res.blob();
}

/** Authenticated file download (CSV exports) without putting tokens in URLs. */
export async function download(path: string, filename: string) {
  const blob = await apiBlob(path);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const errorMessage = (e: unknown) => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Something went wrong');
