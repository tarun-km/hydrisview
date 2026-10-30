'use client';

import { useQuery } from '@tanstack/react-query';
import { CloudOff, CloudRain, Droplets, Sunrise, Sunset, Wind } from 'lucide-react';
import { useApi } from '@/lib/query';
import { useCan } from '@/lib/session';
import { DotMatrix } from './DotMatrix';
import { SunArc } from './charts';
import { GlassTile } from './motion';

interface SiteLite { id: string; name: string; city: string | null; lat: number | null; lng: number | null }
interface Weather {
  temp: number; code: number; humidity: number; wind: number; rainChance: number | null; offsetS: number;
  rise: number; set: number; riseText: string; setText: string; aqi: number | null;
}

/** Chennai (the demo plants) when no site has coordinates yet. */
const DEFAULT = { name: 'Chennai', lat: 13.0827, lng: 80.2707 };

const hhmm = (iso: string) => iso.slice(11, 16);
const hours = (iso: string) => Number(iso.slice(11, 13)) + Number(iso.slice(14, 16)) / 60;

async function loadWeather(lat: number, lng: number): Promise<Weather> {
  const base = `latitude=${lat.toFixed(3)}&longitude=${lng.toFixed(3)}&timezone=auto`;
  const [w, a] = await Promise.all([
    fetch(`https://api.open-meteo.com/v1/forecast?${base}&current=temperature_2m,weather_code,relative_humidity_2m,wind_speed_10m&daily=sunrise,sunset,precipitation_probability_max&forecast_days=1`).then((r) => { if (!r.ok) throw new Error('weather'); return r.json(); }),
    fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?${base}&current=european_aqi`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  return {
    temp: w.current.temperature_2m, code: w.current.weather_code, humidity: w.current.relative_humidity_2m, wind: w.current.wind_speed_10m,
    rainChance: w.daily.precipitation_probability_max?.[0] ?? null, offsetS: w.utc_offset_seconds,
    rise: hours(w.daily.sunrise[0]), set: hours(w.daily.sunset[0]), riseText: hhmm(w.daily.sunrise[0]), setText: hhmm(w.daily.sunset[0]),
    aqi: a?.current?.european_aqi ?? null,
  };
}

function condition(code: number): string {
  if (code === 0) return 'Clear';
  if (code <= 2) return 'Mostly clear';
  if (code === 3) return 'Overcast';
  if (code <= 48) return 'Fog';
  if (code <= 57) return 'Drizzle';
  if (code <= 67) return 'Rain';
  if (code <= 77) return 'Snow';
  if (code <= 82) return 'Showers';
  return 'Thunderstorm';
}
function airQuality(aqi: number | null): string {
  if (aqi === null) return '—';
  return aqi <= 20 ? 'Good' : aqi <= 40 ? 'Fair' : aqi <= 60 ? 'Moderate' : aqi <= 80 ? 'Poor' : 'Very poor';
}

/** Plant weather: dot-matrix temperature, live sun arc and air quality for the first site with coordinates (Open-Meteo, no key). */
export function WeatherTile({ className }: { className?: string }) {
  const can = useCan();
  const sites = useApi<{ sites: SiteLite[] }>(can('site.read') ? '/sites' : null, { staleTime: 10 * 60_000 });
  const site = sites.data?.sites.find((s) => s.lat !== null && s.lng !== null);
  const loc = site ? { name: site.city ?? site.name, lat: site.lat!, lng: site.lng! } : DEFAULT;
  const ready = !can('site.read') || !sites.isLoading;
  const q = useQuery({ queryKey: ['open-meteo', loc.lat, loc.lng], queryFn: () => loadWeather(loc.lat, loc.lng), enabled: ready, refetchInterval: 10 * 60_000, staleTime: 5 * 60_000, retry: 1 });
  const w = q.data;
  const now = w ? (((Date.now() / 1000 + w.offsetS) % 86400) + 86400) % 86400 / 3600 : 0;
  const wet = w && (w.code >= 51 || (w.rainChance ?? 0) >= 60);

  return (
    <GlassTile as="section" aria-labelledby="wx-title" className="flex flex-col overflow-hidden !p-5 sm:!p-6">
      <div className="flex items-start justify-between gap-3">
        <h2 id="wx-title" className="text-[15px] text-text-2">Plant weather</h2>
        {w && <span className="flex items-center gap-3 text-[12px] text-muted"><span className="inline-flex items-center gap-1"><Droplets size={13} aria-hidden />{Math.round(w.humidity)}%</span><span className="inline-flex items-center gap-1"><Wind size={13} aria-hidden />{Math.round(w.wind)} km/h</span></span>}
      </div>
      {w ? (
        <>
          <div className="mt-4 flex items-start justify-center gap-1.5 text-text">
            <DotMatrix value={Math.round(w.temp)} dot={6.5} gap={2.6} label={`${Math.round(w.temp)} degrees Celsius`} />
            <DotMatrix value="°" dot={4} gap={1.8} label="" dim={0} className="opacity-70" />
          </div>
          <div className="mt-3 text-center">
            <div className="text-[15px] font-medium">{condition(w.code)}</div>
            <div className="text-[13px] text-muted">{loc.name}</div>
          </div>
          <SunArc now={now} rise={w.rise} set={w.set} className="mt-2 h-auto w-full" />
          <dl className="mt-1 grid grid-cols-3 items-end text-center">
            <div><dd className="num text-[18px] font-light">{w.riseText}</dd><dt className="mt-0.5 inline-flex items-center gap-1 text-[12px] text-muted"><Sunrise size={13} aria-hidden />Sunrise</dt></div>
            <div><dd className="text-[18px] font-light">{airQuality(w.aqi)}</dd><dt className="mt-0.5 inline-flex items-center gap-1 text-[12px] text-muted"><Wind size={13} aria-hidden />Air quality</dt></div>
            <div><dd className="num text-[18px] font-light">{w.setText}</dd><dt className="mt-0.5 inline-flex items-center gap-1 text-[12px] text-muted"><Sunset size={13} aria-hidden />Sunset</dt></div>
          </dl>
          {wet && <p className="mt-4 flex items-center gap-2 rounded-2xl bg-[rgb(25_84_241/0.12)] px-3 py-2 text-[12.5px] text-text-2"><CloudRain size={14} className="flex-none text-lime" aria-hidden />Rain likely ({w.rainChance ?? '—'}%) · expect higher inflow at the headworks.</p>}
        </>
      ) : q.isError ? (
        <div className="grid flex-1 place-items-center gap-2 py-10 text-center text-sm text-muted">
          <CloudOff size={22} aria-hidden />Weather unavailable offline.
          <button type="button" className="link-quiet text-[13px]" onClick={() => void q.refetch()}>Try again</button>
        </div>
      ) : (
        <div className="grid flex-1 place-items-center py-10" role="status" aria-label="Loading weather"><span className="skeleton h-24 w-40 rounded-2xl" /></div>
      )}
    </GlassTile>
  );
}
