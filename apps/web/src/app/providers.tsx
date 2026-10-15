'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as RTooltip from '@radix-ui/react-tooltip';
import { useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { ApiError } from '@/lib/api';
import { SessionProvider } from '@/lib/session';
import { ToastProvider } from '@/ui/overlay';
import { ThemeSync } from '@/ui/theme';

export function Providers({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [qc] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10_000,
            refetchOnWindowFocus: true,
            retry: (n, e) => !(e instanceof ApiError && [401, 403, 404].includes(e.status)) && n < 2,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={qc}>
      <ThemeSync pathname={pathname} />
      <RTooltip.Provider>
        <ToastProvider>
          <SessionProvider>{children}</SessionProvider>
        </ToastProvider>
      </RTooltip.Provider>
    </QueryClientProvider>
  );
}
