import type { ReactNode } from 'react';
import { SiteHeader } from '@/site/SiteHeader';
import { SiteFooter } from '@/site/SiteFooter';
import { RevealObserver } from '@/site/Reveal';
import '@/site/site.css';

export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <div className="hx relative min-h-screen overflow-x-clip bg-bg">
      <noscript>
        <style>{'.reveal{opacity:1!important;transform:none!important}'}</style>
      </noscript>
      <SiteHeader />
      <main id="main" tabIndex={-1} className="outline-none">
        {children}
      </main>
      <SiteFooter />
      <RevealObserver />
    </div>
  );
}
