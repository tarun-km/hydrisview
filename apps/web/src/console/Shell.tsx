'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import * as RPopover from '@radix-ui/react-popover';
import * as RMenu from '@radix-ui/react-dropdown-menu';
import * as RDialog from '@radix-ui/react-dialog';
import clsx from 'clsx';
import {
  SlidersHorizontal, Activity, BarChart3, Bell, Boxes, Building2, Check, ClipboardCheck, FileText, Glasses, LayoutGrid, LogOut, Menu, Monitor, MonitorSmartphone, Moon, Route, ScrollText, Search,
  Settings, ShieldCheck, Siren, Sun, UserRound, Users, Wrench, X, ScanLine,
} from 'lucide-react';
import { ROLE_LABELS, type Permission } from '@hydris/domain';
import { getAccessToken, refreshSession } from '@/lib/api';
import { useSession, useSessionCtx } from '@/lib/session';
import { openStream, type StreamStatus } from '@/lib/realtime';
import { invalidatePaths, useApi } from '@/lib/query';
import { ago } from '@/lib/format';
import { Avatar, IconButton, Tooltip } from '@/ui';
import { useToast } from '@/ui/overlay';
import { ThemeToggle, useTheme, type ThemeMode } from '@/ui/theme';
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
  { href: '/console/audit-docs', label: 'Audit documents', icon: <ScanLine size={19} />, perm: 'auditdoc.read', group: 'Work' },
  { href: '/console/sites', label: 'Sites & facilities', icon: <Building2 size={19} />, perm: 'site.read', group: 'Plant' },
  { href: '/console/assets', label: 'Assets & equipment', icon: <Boxes size={19} />, perm: 'asset.read', group: 'Plant' },
  { href: '/console/devices', label: 'Field glasses', icon: <Glasses size={19} />, perm: 'device.read', group: 'People & devices' },
  { href: '/console/glasses-profiles', label: 'Glasses UI profiles', icon: <SlidersHorizontal size={19} />, perm: 'device.manage', group: 'People & devices' },
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
  const [mac, setMac] = useState(false);
  useEffect(() => setMac(/Mac|iPhone|iPad/.test(navigator.platform)), []);
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
        <Link href="/console" aria-label="Hydris console home" className="mb-1 grid h-12 w-12 place-items-center rounded-full bg-brand shadow-[0_8px_24px_rgb(23_70_228/0.35)] transition-transform hover:scale-105"><Logo compact size={24} /></Link>
        <nav className="flex min-h-0 flex-1 flex-col items-center gap-3 overflow-y-auto scrollbar-none rounded-full border border-line bg-surface px-2 py-3 shadow-[var(--sheen)]">
          {groups.map((g, gi) => (
            <div key={g} className="flex flex-col items-center gap-1.5">
              {gi > 0 && <span className="my-1 h-px w-6 bg-line-2" aria-hidden />}
              {items.filter((i) => i.group === g).map((i) => (
                <Tooltip key={i.href} label={i.label}>
                  <Link href={i.href} aria-label={i.label} aria-current={isActive(i.href) ? 'page' : undefined}
                    className={clsx('relative grid h-11 w-11 place-items-center rounded-full transition-[background,color,transform] duration-150 active:scale-90', isActive(i.href) ? 'bg-lime text-lime-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.45)]' : 'text-text-2 hover:bg-surface-3 hover:text-text')}>
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
          <Link href="/console" className="grid h-11 w-11 flex-none place-items-center rounded-full bg-brand md:hidden" aria-label="Hydris home"><Logo compact size={22} /></Link>
          <OrgSwitcher />
          <button onClick={() => setPaletteOpen(true)} className="ml-auto flex h-11 min-w-0 flex-1 items-center gap-3 rounded-full border border-line bg-surface px-4 text-left text-sm text-muted shadow-[var(--sheen)] transition-colors hover:border-line-2 hover:text-text-2 sm:max-w-[380px]" aria-label="Search assets, sensors, documents and people">
            <Search size={16} aria-hidden /> <span className="truncate">Search assets, sensors, SOPs…</span>
            <kbd className="ml-auto hidden rounded-md border border-line-2 bg-surface-2 px-1.5 py-0.5 text-[11px] text-text-2 sm:inline">{mac ? '⌘' : 'Ctrl'} K</kbd>
          </button>
          <LiveStatus status={status} />
          <ThemeToggle compact className="hidden sm:inline-grid" />
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
                <ThemeMenuGroup />
                <RMenu.Separator className="my-1 h-px bg-line" />
                <MenuLink href="/console/account" icon={<UserRound size={15} />}>Account & security</MenuLink>
                {session.user.isPlatformAdmin && <MenuLink href="/console/platform" icon={<ShieldCheck size={15} />}>Platform administration</MenuLink>}
                {session.memberships.length > 1 && session.memberships.filter((m) => m.orgId !== session.org?.id).map((m) => (
                  <RMenu.Item key={m.orgId} onSelect={() => void switchOrg(m.orgId).then(() => router.push('/console'))} className="flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm outline-none data-[highlighted]:bg-surface-2">
                    <Building2 size={15} /> Switch to {m.orgName}
                  </RMenu.Item>
                ))}
                <RMenu.Item onSelect={() => void signOut().then(() => router.replace('/login'))} className="flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm text-critical-text outline-none data-[highlighted]:bg-surface-2">
                  <LogOut size={15} /> Sign out
                </RMenu.Item>
              </RMenu.Content>
            </RMenu.Portal>
          </RMenu.Root>
        </header>

        {session.org?.isDemo && (
          <div className="flex items-center justify-center gap-2 border-b border-dashed border-[rgb(25_84_241/0.3)] bg-[rgb(25_84_241/0.045)] px-4 py-2 text-center text-[12.5px] leading-snug text-lime md:px-8">
            <span className="dot flex-none bg-lime" aria-hidden />
            <span className="sm:hidden">Demo tenant — <b>Synthetic</b> data comes from the simulator.</span>
            <span className="hidden sm:inline">Demo organization — telemetry and events marked <b>Synthetic</b> are generated by the Hydris simulator, not real plant measurements.</span>
          </div>
        )}

        <main id="main" className="mx-auto max-w-[1440px] px-4 pb-28 pt-8 md:px-8 md:pb-12">
          <span className="sr-only" aria-live="polite">{current?.label}</span>
          <div key={pathname} className="page-enter">{children}</div>
        </main>

        {/* Mobile tab bar: four primary destinations + a "More" sheet (no hidden horizontal scroller) */}
        <MobileNav items={items} isActive={isActive} />
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} nav={items} />
    </div>
  );
}

const PRIMARY_MOBILE = ['/console', '/console/alarms', '/console/telemetry', '/console/inspections'];
const SHORT: Record<string, string> = { '/console': 'Overview', '/console/alarms': 'Alarms', '/console/telemetry': 'Sensors', '/console/inspections': 'Inspections' };

function MobileNav({ items, isActive }: { items: NavItem[]; isActive: (href: string) => boolean }) {
  const [open, setOpen] = useState(false);
  const primary = items.filter((i) => PRIMARY_MOBILE.includes(i.href));
  const rest = items.filter((i) => !PRIMARY_MOBILE.includes(i.href));
  const moreActive = rest.some((i) => isActive(i.href));
  const groups = [...new Set(rest.map((i) => i.group))];
  const tab = 'flex h-12 flex-col items-center justify-center gap-1 rounded-full text-[10.5px] font-medium transition-[background,color,transform] active:scale-95';
  return (
    <>
      <nav className="fixed inset-x-3 bottom-3 z-30 grid auto-cols-fr grid-flow-col gap-1 rounded-full border border-line-2 bg-surface/90 p-1.5 shadow-[var(--shadow-3),var(--sheen)] backdrop-blur-xl md:hidden" aria-label="Console navigation">
        {primary.map((i) => (
          <Link key={i.href} href={i.href} aria-current={isActive(i.href) ? 'page' : undefined} className={clsx(tab, isActive(i.href) ? 'bg-lime text-lime-ink' : 'text-text-2')}>
            {i.icon}<span className="leading-none">{SHORT[i.href] ?? i.label}</span>
          </Link>
        ))}
        {rest.length > 0 && (
          <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open} className={clsx(tab, moreActive ? 'bg-surface-3 text-text' : 'text-text-2')}>
            <Menu size={19} aria-hidden /><span className="leading-none">More</span>
          </button>
        )}
      </nav>
      <RDialog.Root open={open} onOpenChange={setOpen}>
        <RDialog.Portal>
          <RDialog.Overlay className="fixed inset-0 z-40 bg-scrim backdrop-blur-[3px] fade-in md:hidden" />
          <RDialog.Content className="sheet-up fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-y-auto rounded-t-[28px] border border-line-2 bg-surface px-4 pb-[max(20px,env(safe-area-inset-bottom))] pt-3 shadow-[var(--shadow-3)] md:hidden">
            <span aria-hidden className="mx-auto mb-3 block h-1 w-10 rounded-full bg-line-2" />
            <div className="mb-1 flex items-center justify-between px-2">
              <RDialog.Title className="t-section">All modules</RDialog.Title>
              <RDialog.Close className="icon-btn icon-btn-sm icon-btn-ghost" aria-label="Close menu"><X size={16} /></RDialog.Close>
            </div>
            <RDialog.Description className="sr-only">Navigate to any console module</RDialog.Description>
            {groups.map((g) => (
              <div key={g} className="mt-3">
                <div className="t-eyebrow px-2 pb-1.5">{g}</div>
                <ul className="grid grid-cols-2 gap-2">
                  {rest.filter((i) => i.group === g).map((i) => (
                    <li key={i.href}>
                      <Link href={i.href} onClick={() => setOpen(false)} aria-current={isActive(i.href) ? 'page' : undefined}
                        className={clsx('flex min-h-[52px] items-center gap-3 rounded-2xl border px-3 py-2.5 text-[13.5px] transition-colors', isActive(i.href) ? 'border-transparent bg-lime text-lime-ink' : 'border-line bg-bg-2 text-text-2 active:bg-surface-2')}>
                        <span className="flex-none">{i.icon}</span><span className="leading-tight">{i.label}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <Link href="/simulator" onClick={() => setOpen(false)} className="btn btn-secondary mt-5 w-full"><MonitorSmartphone size={16} aria-hidden />Open glasses simulator</Link>
          </RDialog.Content>
        </RDialog.Portal>
      </RDialog.Root>
    </>
  );
}

const THEME_ITEMS: { value: ThemeMode; label: string; icon: ReactNode }[] = [
  { value: 'system', label: 'System', icon: <Monitor size={15} aria-hidden /> },
  { value: 'light', label: 'Light', icon: <Sun size={15} aria-hidden /> },
  { value: 'dark', label: 'Dark', icon: <Moon size={15} aria-hidden /> },
];
/** Theme choice inside the account menu: a proper menu radio group (arrow keys + Enter, announced as checked). */
function ThemeMenuGroup() {
  const { mode, resolved, setMode } = useTheme();
  return (
    <RMenu.Group>
      <RMenu.Label className="flex items-center justify-between px-3 pb-1 pt-1.5 text-[11.5px] uppercase tracking-[0.12em] text-muted">
        Appearance{mode === 'system' && <span className="normal-case tracking-normal">now {resolved}</span>}
      </RMenu.Label>
      <RMenu.RadioGroup value={mode} onValueChange={(v) => setMode(v as ThemeMode)} className="grid grid-cols-3 gap-1 px-1 pb-1">
        {THEME_ITEMS.map((t) => (
          <RMenu.RadioItem key={t.value} value={t.value} onSelect={(e) => e.preventDefault()}
            className="relative flex cursor-pointer flex-col items-center gap-1 rounded-xl px-2 py-2 text-[12px] text-text-2 outline-none transition-colors data-[highlighted]:bg-surface-2 data-[state=checked]:bg-pill data-[state=checked]:text-pill-ink">
            {t.icon}{t.label}
            <RMenu.ItemIndicator className="sr-only"><Check size={12} /> selected</RMenu.ItemIndicator>
          </RMenu.RadioItem>
        ))}
      </RMenu.RadioGroup>
    </RMenu.Group>
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
