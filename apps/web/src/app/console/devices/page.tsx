'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Glasses, MapPin, MonitorSmartphone, Plus, Radio } from 'lucide-react';
import { useApi } from '@/lib/query';
import { useCan } from '@/lib/session';
import { ago } from '@/lib/format';
import { Avatar, ButtonLink, Capsule, EmptyState, KpiCard, PageHeader, QueryView, Skeleton, cx } from '@/ui';
import { DeviceKindChip, DeviceStateChip, GlassesArt } from '@/console/admin/glasses';
import { LiveBadge, useFleetLive, type LiveView } from '@/console/admin/live';
import { NoAccess, type DeviceRow } from '@/console/admin/parts';
import { Donut, type Datum } from '@/ui/charts';

type Filter = 'all' | 'connected' | 'disconnected' | 'assigned' | 'suspended' | 'revoked';
const FILTERS: { value: Filter; label: string; test: (d: DeviceRow) => boolean }[] = [
  { value: 'all', label: 'All', test: () => true },
  { value: 'connected', label: 'Connected', test: (d) => d.state === 'connected' },
  { value: 'disconnected', label: 'Disconnected', test: (d) => d.state === 'disconnected' },
  // Any active device with an operator, connected or not.
  { value: 'assigned', label: 'Assigned', test: (d) => d.status === 'active' && !!d.assignee },
  { value: 'suspended', label: 'Suspended', test: (d) => d.state === 'suspended' },
  { value: 'revoked', label: 'Revoked', test: (d) => d.state === 'revoked' },
];

export default function DevicesPage() {
  const can = useCan();
  const allowed = can('device.read');
  const q = useApi<{ devices: DeviceRow[] }>(allowed ? '/devices' : null, { refetchInterval: 20_000 });
  const [filter, setFilter] = useState<Filter>('all');
  const live = useFleetLive(allowed);

  const counts = useMemo(() => {
    const out = {} as Record<Filter, number>;
    for (const f of FILTERS) out[f.value] = q.data?.devices.filter(f.test).length ?? 0;
    return out;
  }, [q.data]);

  return (
    <>
      <PageHeader
        eyebrow="People & devices"
        title="Field glasses"
        subtitle="Every pair of glasses paired to this organization, who wears it, and whether it is reachable right now."
        actions={<>
          <ButtonLink href="/simulator" icon={<MonitorSmartphone size={16} aria-hidden />}>Open simulator</ButtonLink>
          {can('device.pair') && <ButtonLink href="/pair" variant="primary" icon={<Plus size={16} aria-hidden />}>Pair new glasses</ButtonLink>}
        </>}
      />
      {!allowed ? <NoAccess what="field glasses" /> : (
        <QueryView q={q} loading={<FleetSkeleton />}>
          {({ devices }) => {
            const active = devices.filter((d) => d.status !== 'revoked');
            const shown = devices.filter(FILTERS.find((f) => f.value === filter)!.test);
            return (
              <div className="grid gap-5 fade-in">
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <FleetRing devices={active} />
                  <KpiCard tone="dark" label="Assigned to an operator" value={counts.assigned} sub={`${active.filter((d) => d.status === 'active' && !d.assignee).length} active without an operator`} />
                  <KpiCard tone="dark" label="Suspended" value={counts.suspended} accent={counts.suspended ? 'high' : undefined} sub="Signed out until reactivated" />
                  <KpiCard tone="dark" label="Simulators" value={active.filter((d) => d.kind === 'simulator').length} sub={`${active.filter((d) => d.kind === 'hardware').length} hardware devices`} />
                </div>

                <Capsule label="Filter glasses by state" value={filter} onChange={setFilter} options={FILTERS.map((f) => ({ value: f.value, label: f.label, count: counts[f.value] }))} />

                {!devices.length ? (
                  <EmptyState icon={<Glasses size={20} aria-hidden />} title="No glasses paired yet"
                    body="Start the Hydris app on the glasses (or open the browser simulator), then enter the code it shows on the pairing page."
                    action={can('device.pair') ? <ButtonLink href="/pair" variant="primary" icon={<Plus size={16} aria-hidden />}>Pair new glasses</ButtonLink> : undefined} />
                ) : !shown.length ? (
                  <EmptyState title="No glasses in this state" body="Choose another filter to see the rest of the fleet." />
                ) : (
                  <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {shown.map((d) => <li key={d.id}><DeviceCard d={d} live={live.get(d.id)} /></li>)}
                  </ul>
                )}
              </div>
            );
          }}
        </QueryView>
      )}
    </>
  );
}

function DeviceCard({ d, live }: { d: DeviceRow; live?: LiveView }) {
  const off = d.state === 'revoked' || d.state === 'suspended';
  const streaming = !off && !!live?.live;
  return (
    <Link href={`/console/devices/${d.id}`} className="card group relative flex h-full flex-col gap-4 overflow-hidden transition-colors hover:border-line-2 hover:bg-surface-2/60">
      <div className="flex items-center justify-between gap-2">
        <DeviceKindChip kind={d.kind} />
        <DeviceStateChip state={d.state} />
      </div>
      <div className={cx('relative', off && 'opacity-60 grayscale')}>
        {streaming && live?.view ? (
          // Live thumbnail of what the wearer sees right now.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={live.view} alt={`Live glasses screen: ${live.title ?? ''}`} className="mx-auto h-28 w-28 rounded-[18px] border border-line bg-black object-contain" />
        ) : (
          <GlassesArt state={d.state} className="mx-auto h-28 w-full max-w-[300px] transition-transform duration-500 group-hover:scale-[1.03]" />
        )}
        {streaming && <LiveBadge live className="absolute right-0 top-0" />}
      </div>
      <div className="min-w-0">
        <div className="truncate text-[26px] leading-tight tracking-[-0.03em]">{d.name}</div>
        <div className="t-label mt-1 truncate">{d.model ?? (d.kind === 'simulator' ? 'Hydris browser simulator' : 'Model not reported')}</div>
      </div>
      <div className="mt-auto grid gap-2.5 border-t border-line pt-4 text-sm">
        <div className="flex items-center gap-2.5">
          {d.assignee ? <Avatar name={d.assignee.name ?? '?'} size={28} tone="cobalt" /> : <span className="grid h-7 w-7 place-items-center rounded-full border border-dashed border-line-2 text-muted" aria-hidden>–</span>}
          <span className="min-w-0 flex-1 truncate">{d.assignee?.name ? <><span className="text-text-2">Worn by </span>{d.assignee.name}</> : <span className="text-muted">No operator assigned</span>}</span>
        </div>
        {streaming && live?.title && <div className="truncate text-[13px] text-text-2" title={live.title}>Looking at <span className="text-text">{live.title}</span></div>}
        <div className="flex items-center justify-between gap-3 text-[13px] text-text-2">
          <span className="flex min-w-0 items-center gap-1.5"><MapPin size={14} className="flex-none text-muted" aria-hidden /><span className="truncate">{d.siteName ?? 'No site'}</span></span>
          <span className="flex flex-none items-center gap-1.5 num" title={d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : 'Never connected'}>
            <Radio size={14} className={d.state === 'connected' ? 'text-lime' : 'text-muted'} aria-hidden />
            {d.streamOpen ? 'live now' : d.lastSeenAt ? `seen ${ago(d.lastSeenAt)}` : 'never seen'}
          </span>
        </div>
      </div>
    </Link>
  );
}

/** Connected vs total ring (paper island), broken down by live state. */
function FleetRing({ devices }: { devices: DeviceRow[] }) {
  const n = (s: string) => devices.filter((d) => d.state === s).length;
  const data: Datum[] = [
    { key: 'connected', label: 'Connected', value: n('connected'), color: 'var(--color-signal)' },
    { key: 'disconnected', label: 'Disconnected', value: n('disconnected'), color: 'var(--color-medium)' },
    { key: 'suspended', label: 'Suspended', value: n('suspended'), color: 'var(--color-high)' },
    { key: 'other', label: 'Not yet paired', value: devices.length - n('connected') - n('disconnected') - n('suspended'), color: 'var(--color-ink-2)' },
  ].filter((d) => d.value > 0 || d.key === 'connected');
  return (
    <section className="card card-paper flex min-h-[148px] flex-col justify-between gap-3 p-5 sm:p-6" aria-labelledby="fleet-ring">
      <span id="fleet-ring" className="text-[13.5px] leading-snug opacity-75">Connected now</span>
      <Donut data={data} size={104} thickness={10} legend={false} table center={<>{n('connected')}<span className="text-[0.5em] opacity-50">/{devices.length}</span></>}
        ariaLabel={`${n('connected')} of ${devices.length} field glasses connected now`} empty="None paired" />
      <span className="text-[12.5px] leading-snug opacity-70">Open stream or seen in the last 90 s</span>
    </section>
  );
}

function FleetSkeleton() {
  return (
    <div className="grid gap-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[148px] rounded-[24px]" />)}</div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[340px] rounded-[24px]" />)}</div>
    </div>
  );
}
