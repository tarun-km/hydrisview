import type { Metadata, Viewport } from 'next';
import { Outfit } from 'next/font/google';
import { Providers } from './providers';
import { THEME_COLORS, themeInitScript } from '@/ui/theme-script';
import './globals.css';

const outfit = Outfit({ subsets: ['latin'], weight: ['300', '400', '500', '600'], variable: '--font-outfit', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.PUBLIC_APP_URL ?? 'http://localhost:3000'),
  title: { default: 'Hydris Field Glasses — operational intelligence for wastewater teams', template: '%s · Hydris' },
  description: 'Hydris puts live plant context, guided inspections and approved procedures in the field of view of wastewater operators, connected to a secure multi-tenant operations console.',
  openGraph: { type: 'website', siteName: 'Hydris Field Glasses' },
};

export const viewport: Viewport = {
  // Media-matched defaults for no-JS; the inline theme script and ThemeSync overwrite both with the resolved theme.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: THEME_COLORS.light },
    { media: '(prefers-color-scheme: dark)', color: THEME_COLORS.dark },
  ],
  colorScheme: 'dark light',
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={outfit.variable} data-theme="dark" suppressHydrationWarning>
      <head>
        {/* Blocking: sets data-theme from localStorage / prefers-color-scheme before first paint (no flash). */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body suppressHydrationWarning>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-full focus:bg-lime focus:px-4 focus:py-2 focus:text-lime-ink">Skip to content</a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
