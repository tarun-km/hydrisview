'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowUpRight, Menu, X } from 'lucide-react';
import { Logo } from './Logo';
import { SITE_NAV, isActive } from './nav';

export function SiteHeader() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Close the drawer on navigation.
  useEffect(() => setOpen(false), [pathname]);

  return (
    <header className="site-header sticky top-0 z-40" data-scrolled={scrolled || undefined}>
      <div className="site-container flex h-[76px] items-center justify-between gap-4 lg:h-[88px]">
        <Link href="/" aria-label="Hydris Field Glasses home" className="rounded-full">
          <Logo />
        </Link>

        <nav aria-label="Primary" className="hidden lg:block">
          <div className="capsule site-nav bg-surface/80 backdrop-blur">
            {SITE_NAV.map((n) => (
              <Link key={n.href} href={n.href} aria-current={isActive(pathname, n.href) ? 'page' : undefined}>
                {n.label}
              </Link>
            ))}
          </div>
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          <Link href="/login" className="btn btn-ghost">Sign in</Link>
          <Link href="/contact?type=demo" className="btn btn-primary">
            Request a demo <ArrowUpRight size={16} strokeWidth={2} aria-hidden />
          </Link>
        </div>

        <Dialog.Root open={open} onOpenChange={setOpen}>
          <div className="lg:hidden">
            <Dialog.Trigger asChild>
              <button type="button" className="icon-btn" aria-label="Open menu">
                <Menu size={20} aria-hidden />
              </button>
            </Dialog.Trigger>
          </div>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm fade-in lg:hidden" />
            <Dialog.Content
              className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[420px] flex-col bg-bg-2 p-4 shadow-[var(--shadow-3)] fade-in sm:p-6 lg:hidden"
              aria-describedby={undefined}
            >
              <div className="flex h-[60px] items-center justify-between">
                <Dialog.Title className="sr-only">Site menu</Dialog.Title>
                <Logo />
                <Dialog.Close asChild>
                  <button type="button" className="icon-btn" aria-label="Close menu">
                    <X size={20} aria-hidden />
                  </button>
                </Dialog.Close>
              </div>
              <nav aria-label="Primary mobile" className="mt-8 grid gap-1">
                <Link href="/" aria-current={pathname === '/' ? 'page' : undefined} className="flex items-center justify-between rounded-2xl px-4 py-4 text-[26px] tracking-[-0.03em] text-text-2 hover:bg-surface aria-[current=page]:text-text">
                  Home
                </Link>
                {SITE_NAV.map((n) => {
                  const active = isActive(pathname, n.href);
                  return (
                    <Link key={n.href} href={n.href} aria-current={active ? 'page' : undefined}
                      className="flex items-center justify-between rounded-2xl px-4 py-4 text-[26px] tracking-[-0.03em] text-text-2 hover:bg-surface aria-[current=page]:text-text">
                      {n.label}
                      {active && <span className="dot bg-lime" aria-hidden />}
                    </Link>
                  );
                })}
              </nav>
              <div className="mt-auto grid gap-2 pt-8">
                <Link href="/contact?type=demo" className="btn btn-primary btn-lg w-full">Request a demo <ArrowUpRight size={16} aria-hidden /></Link>
                <Link href="/login" className="btn btn-secondary btn-lg w-full">Sign in to the console</Link>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </div>
    </header>
  );
}
