'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import * as RPopover from '@radix-ui/react-popover';
import * as RMenu from '@radix-ui/react-dropdown-menu';
import clsx from 'clsx';
import {
  Activity, BarChart3, Bell, Boxes, Building2, ClipboardCheck, FileText, Glasses, LayoutGrid, LogOut, MonitorSmartphone, Route, ScrollText, Search,
  Settings, ShieldCheck, Siren, UserRound, Users, Wrench,
} from 'lucide-react';
import { ROLE_LABELS, type Permission } from '@hydris/domain';
import { getAccessToken, refreshSession } from '@/lib/api';
import { useSession, useSessionCtx } from '@/lib/session';
import { openStream, type StreamStatus } from '@/lib/realtime';
import { invalidatePaths, useApi } from '@/lib/query';
import { ago } from '@/lib/format';
import { Avatar, IconButton, Tooltip } from '@/ui';
import { useToast } from '@/ui/overlay';
import { Logo } from '@/site/Logo';
import { CommandPalette } from './CommandPalette';

interface NavItem { href: string; label: string; icon: ReactNode; perm?: Permission; group: string }
const NAV: NavItem[] = [
  { href: '/console', label: 'Overview', icon: <LayoutGrid size={19} />, group: 'Operate' },
  { href: '/console/alarms', label: 'Alarms & events', icon: <Siren size={19} />, perm: 'alarm.read', group: 'Operate' },
  { href: '/console/telemetry', label: 'Sensor monitoring', icon: <Activity size={19} />, perm: 'telemetry.read', group: 'Operate' },
  { href: '/console/map', label: 'Plant map & rounds', icon: <Route size={19} />, perm: 'site.read', group: 'Operate' },
  { href: '/console/inspections', label: 'Inspections', icon: <ClipboardCheck size={19} />, perm: 'inspection.read', group: 'Work' },
  { href: '/console/maintenance', label: 'Maintenance', icon: <Wrench size={19} />, perm: 'maintenance.read', group: 'Work' },
  { href: '/console/documents', label: 'Documents & SOPs', icon: <FileText size={19} />, perm: 'document.read', group: 'Work' },
  { href: '/console/sites', label: 'Sites & facilities', icon: <Building2 size={19} />, perm: 'site.read', group: 'Plant' },
  { href: '/console/assets', label: 'Assets & equipment', icon: <Boxes size={19} />, perm: 'asset.read', group: 'Plant' },
  { href: '/console/devices', label: 'Field glasses', icon: <Glasses size={19} />, perm: 'device.read', group: 'People & devices' },
  { href: '/console/operators', label: 'Operators', icon: <Users size={19} />, perm: 'member.read', group: 'People & devices' },
  { href: '/console/reports', label: 'Reports & analytics', icon: <BarChart3 size={19} />, perm: 'report.read', group: 'Insight' },
  { href: '/console/audit', label: 'Audit log', icon: <ScrollText size={19} />, perm: 'audit.read', group: 'Insight' },
  { href: '/console/settings', label: 'Organization settings', icon: <Settings size={19} />, perm: 'org.manage', group: 'Admin' },
];

const EVENT_PATHS: Record<string, string[]> = {
  'alarm.created': ['/alarms', '/overview', '/assets', '/sites', '/device/context'],
  'alarm.updated': ['/alarms', '/overview', '/assets'],
  'telemetry.reading': ['/sensors', '/overview', '/assets/', '/hierarchy', '/telemetry'],
  'inspection.updated': ['/inspections', '/overview', '/members'],
  'maintenance.updated': ['/maintenance', '/overview', '/assets/'],
  'device.updated': ['/devices', '/overview'],
  'device.paired': ['/devices', '/overview'],
  'asset.updated': ['/assets', '/hierarchy', '/overview', '/sites'],
  'notification.created': ['/notifications'],
  'simulation.step': ['/simulation'],
};

export function ConsoleShell({ children }: { children: ReactNode }) {
  const session = useSession();
  const { signOut, switchOrg } = useSessionCtx();
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState<StreamStatus>('connecting');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const pending = useRef(new Set<string>());

  const items = useMemo(() => NAV.filter((n) => !n.perm || session.permissions.includes(n.perm)), [session.permissions]);
  const isActive = (href: string) => (href === '/console' ? pathname === '/console' : pathname.startsWith(href));

  // Realtime: invalidate affected views (batched) and surface critical alarms immediately.
  useEffect(() => {
    const flush = setInterval(() => {
      if (!pending.current.size) return;
      invalidatePaths(qc, [...pending.current]);
      pending.current.clear();
    }, 1500);
    const stop = openStream({
      getToken: getAccessToken,
      refresh: async () => !!(await refreshSession()),
      onStatus: setStatus,
      onEvent: (e) => {
        for (const p of EVENT_PATHS[e.type] ?? []) pending.current.add(p);
        if (e.type === 'alarm.created' && (e.data.severity === 'critical' || e.data.severity === 'high')) {
          toast({ title: `${String(e.data.severity).toUpperCase()} · ${String(e.data.title)}`, body: e.data.synthetic ? 'Synthetic (simulator)' : String(e.data.description ?? ''), tone: 'critical' });
        }
        if (e.type === 'pairing.completed') toast({ title: 'Glasses paired', tone: 'ok' });
      },
    });
    return () => {
      stop();
      clearInterval(flush);
    };
  }, [qc, toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const groups = [...new Set(items.map((i) => i.group))];
  const current = items.find((i) => isActive(i.href));

  return (
    <div className="min-h-dvh bg-bg">
      {/* Left rail — vertical capsule of circular actions (Usechannel rail / EHR side scroller) */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[84px] flex-col items-center gap-4 py-5 md:flex" aria-label="Console navigation">
        <Link href="/console" aria-label="Hydris console home" className="mb-1"><Logo compact /></Link>
        <nav className="flex min-h-0 flex-1 flex-col items-center gap-3 overflow-y-auto scrollbar-none rounded-full border border-line bg-surface px-2 py-3">
          {groups.map((g, gi) => (
            <div key={g} className="flex flex-col items-center gap-1.5">
              {gi > 0 && <span className="my-1 h-px w-6 bg-line-2" aria-hidden />}
              {items.filter((i) => i.group === g).map((i) => (
                <Tooltip key={i.href} label={i.label}>
                  <Link href={i.href} aria-label={i.label} aria-current={isActive(i.href) ? 'page' : undefined}
                    className={clsx('grid h-11 w-11 place-items-center rounded-full transition-colors', isActive(i.href) ? 'bg-lime text-lime-ink' : 'text-text-2 hover:bg-surface-3 hover:text-text')}>
                    {i.icon}
                  </Link>
                </Tooltip>
              ))}
            </div>
          ))}
        </nav>
        <Tooltip label="Glasses simulator">
          <Link href="/simulator" aria-label="Open glasses simulator" className="icon-btn"><MonitorSmartphone size={18} /></Link>
        </Tooltip>
      </aside>

      <div className="md:pl-[84px]">
        {/* Top context bar */}
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-bg/85 px-4 py-3 backdrop-blur md:px-8">
          <Link href="/console" className="md:hidden" aria-label="Hydris home"><Logo compact /></Link>
          <OrgSwitcher />
          <button onClick={() => setPaletteOpen(true)} className="ml-auto flex h-11 min-w-0 flex-1 items-center gap-3 rounded-full border border-line bg-surface px-4 text-left text-sm text-muted transition-colors hover:border-line-2 sm:max-w-[380px]" aria-label="Search assets, sensors, documents and people">
            <Search size={16} aria-hidden /> <span className="truncate">Search assets, sensors, SOPs…</span>
            <kbd className="ml-auto hidden rounded-md border border-line-2 px-1.5 text-[11px] sm:inline">Ctrl K</kbd>
          </button>
          <LiveStatus status={status} />
          <Notifications />
          <RMenu.Root>
            <RMenu.Trigger asChild>
              <button className="rounded-full focus-visible:outline-2" aria-label="Account menu"><Avatar name={session.user.name} size={44} tone="cobalt" /></button>
            </RMenu.Trigger>
            <RMenu.Portal>
              <RMenu.Content align="end" sideOffset={8} className="z-50 min-w-[240px] rounded-[var(--radius-lg)] border border-line-2 bg-surface p-2 shadow-[var(--shadow-3)] fade-in">
                <div className="px-3 py-2">
                  <div className="text-sm font-medium">{session.user.name}</div>
                  <div className="text-xs text-muted">{session.role ? ROLE_LABELS[session.role] : ''} · {session.org?.name}</div>
                </div>
                <RMenu.Separator className="my-1 h-px bg-line" />
                <MenuLink href="/console/account" icon={<UserRound size={15} />}>Account & security</MenuLink>
                {session.user.isPlatformAdmin && <MenuLink href="/console/platform" icon={<ShieldCheck size={15} />}>Platform administration</MenuLink>}
                {session.memberships.length > 1 && session.memberships.filter((m) => m.orgId !== session.org?.id).map((m) => (
                  <RMenu.Item key={m.orgId} onSelect={() => void switchOrg(m.orgId).then(() => router.push('/console'))} className="flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm outline-none data-[highlighted]:bg-surface-2">
                    <Building2 size={15} /> Switch to {m.orgName}
                  </RMenu.Item>
                ))}
                <RMenu.Item onSelect={() => void signOut().then(() => router.replace('/login'))} className="flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm text-[#ff8a80] outline-none data-[highlighted]:bg-surface-2">
                  <LogOut size={15} /> Sign out
                </RMenu.Item>
              </RMenu.Content>
            </RMenu.Portal>
          </RMenu.Root>
        </header>

        {session.org?.isDemo && (
          <div className="border-b border-dashed border-[rgb(216_255_101/0.35)] bg-[rgb(216_255_101/0.05)] px-4 py-2 text-center text-[12.5px] text-lime md:px-8">
            Demo organization — telemetry and events marked <b>Synthetic</b> are generated by the Hydris simulator, not real plant measurements.
          </div>
        )}

        <main id="main" className="mx-auto max-w-[1440px] px-4 pb-28 pt-8 md:px-8 md:pb-12">
          <span className="sr-only" aria-live="polite">{current?.label}</span>
          {children}
        </main>

        {/* Mobile bottom navigation */}
        <nav className="fixed inset-x-3 bottom-3 z-30 flex gap-1 overflow-x-auto scrollbar-none rounded-full border border-line bg-surface/95 p-1.5 backdrop-blur md:hidden" aria-label="Console navigation">
          {items.map((i) => (
            <Link key={i.href} href={i.href} aria-label={i.label} aria-current={isActive(i.href) ? 'page' : undefined}
              className={clsx('grid h-11 w-11 flex-none place-items-center rounded-full', isActive(i.href) ? 'bg-lime text-lime-ink' : 'text-text-2')}>{i.icon}</Link>
          ))}
        </nav>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} nav={items} />
    </div>
  );
}

function MenuLink({ href, icon, children }: { href: string; icon: ReactNode; children: ReactNode }) {
  return (
    <RMenu.Item asChild>
      <Link href={href} className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm outline-none data-[highlighted]:bg-surface-2">{icon}{children}</Link>
    </RMenu.Item>
  );
}

function OrgSwitcher() {
  const s = useSession();
  return (
    <div className="hidden items-center gap-3 lg:flex">
      <span className="text-[15px] font-medium">{s.org?.name}</span>
      {s.org?.isDemo && <span className="chip chip-synthetic">Demo tenant</span>}
    </div>
  );
}

function LiveStatus({ status }: { status: StreamStatus }) {
  const map: Record<StreamStatus, [string, string]> = {
    connecting: ['Connecting', 'var(--color-muted)'], live: ['Live', 'var(--color-ok)'], reconnecting: ['Reconnecting', 'var(--color-medium)'],
    offline: ['Offline', 'var(--color-high)'], ended: ['Session ended', 'var(--color-critical)'],
  };
  const [text, color] = map[status];
  return (
    <span className="hidden h-11 items-center gap-2 rounded-full border border-line bg-surface px-4 text-[13px] text-text-2 sm:inline-flex" role="status" title="Realtime connection to the Hydris event stream">
      <span className={clsx('dot', status === 'live' && 'pulse-dot')} style={{ background: color }} aria-hidden /> {text}
    </span>
  );
}

interface Notification { id: string; title: string; body: string | null; link: string | null; severity: string; readAt: string | null; createdAt: string }
function Notifications() {
  const q = useApi<{ notifications: Notification[]; unread: number }>('/notifications', { refetchInterval: 60_000 });
  const qc = useQueryClient();
  const router = useRouter();
  const markAll = async () => {
    const { post } = await import('@/lib/api');
    await post('/notifications/read', {});
    invalidatePaths(qc, ['/notifications']);
  };
  return (
    <RPopover.Root onOpenChange={(o) => { if (!o && q.data?.unread) void markAll(); }}>
      <RPopover.Trigger asChild>
        <IconButton label="Notifications" badge={q.data?.unread}><Bell size={18} /></IconButton>
      </RPopover.Trigger>
      <RPopover.Portal>
        <RPopover.Content align="end" sideOffset={8} className="z-50 w-[min(380px,calc(100vw-24px))] rounded-[var(--radius-xl)] border border-line-2 bg-surface p-2 shadow-[var(--shadow-3)] fade-in">
          <div className="flex items-center justify-between px-3 py-2"><span className="t-card">Notifications</span><span className="text-xs text-muted">{q.data?.unread ?? 0} unread</span></div>
          <div className="max-h-[420px] overflow-y-auto">
            {!q.data?.notifications.length && <p className="px-3 py-6 text-center text-sm text-muted">You are all caught up.</p>}
            {q.data?.notifications.map((n) => (
              <button key={n.id} onClick={() => n.link && router.push(n.link)} className="flex w-full gap-3 rounded-2xl px-3 py-2.5 text-left hover:bg-surface-2">
                <span className="mt-1.5 dot" style={{ background: n.severity === 'critical' ? 'var(--color-critical)' : n.severity === 'warning' ? 'var(--color-high)' : n.severity === 'success' ? 'var(--color-ok)' : 'var(--color-cobalt)', opacity: n.readAt ? 0.35 : 1 }} aria-hidden />
                <span className="min-w-0">
                  <span className={clsx('block text-sm', n.readAt ? 'text-text-2' : 'font-medium')}>{n.title}</span>
                  {n.body && <span className="block truncate text-xs text-muted">{n.body}</span>}
                  <span className="block text-[11px] text-muted">{ago(n.createdAt)}</span>
                </span>
              </button>
            ))}
          </div>
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  );
}
