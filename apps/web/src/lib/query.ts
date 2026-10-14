'use client';

import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { api } from './api';
import { useToast } from '@/ui/overlay';
import { errorMessage } from './api';

/** GET an API path; the path itself is the cache key so realtime events can invalidate by prefix. */
export function useApi<T>(path: string | null, opts: Omit<UseQueryOptions<T>, 'queryKey' | 'queryFn'> = {}) {
  return useQuery<T>({ queryKey: ['api', path], queryFn: () => api<T>(path!), enabled: !!path && (opts.enabled ?? true), ...opts });
}

/** Mutation that refreshes affected views and reports outcome via toast. */
export function useAction<TVars, TRes = unknown>(fn: (v: TVars) => Promise<TRes>, opts: { invalidate?: string[]; success?: string | ((r: TRes) => string); onSuccess?: (r: TRes) => void } = {}) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      invalidatePaths(qc, opts.invalidate ?? []);
      if (opts.success) toast({ title: typeof opts.success === 'function' ? opts.success(r) : opts.success, tone: 'ok' });
      opts.onSuccess?.(r);
    },
    onError: (e) => toast({ title: 'Action failed', body: errorMessage(e), tone: 'critical' }),
  });
}

export function invalidatePaths(qc: ReturnType<typeof useQueryClient>, prefixes: string[]) {
  if (!prefixes.length) return;
  void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'api' && typeof q.queryKey[1] === 'string' && prefixes.some((p) => (q.queryKey[1] as string).startsWith(p)) });
}
