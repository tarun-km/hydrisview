import type { Metadata, Viewport } from 'next';
import { Outfit } from 'next/font/google';
import { Providers } from './providers';
import './globals.css';

const outfit = Outfit({ subsets: ['latin'], weight: ['300', '400', '500', '600'], variable: '--font-outfit', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.PUBLIC_APP_URL ?? 'http://localhost:3000'),
  title: { default: 'Hydris Field Glasses — operational intelligence for wastewater teams', template: '%s · Hydris' },
  description: 'Hydris puts live plant context, guided inspections and approved procedures in the field of view of wastewater operators, connected to a secure multi-tenant operations console.',
  openGraph: { type: 'website', siteName: 'Hydris Field Glasses' },
};

export const viewport: Viewport = { themeColor: '#0a0a0a', colorScheme: 'dark' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={outfit.variable}>
      <body>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-full focus:bg-lime focus:px-4 focus:py-2 focus:text-lime-ink">Skip to content</a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
