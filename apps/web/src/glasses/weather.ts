'use client';

import { useEffect, useState } from 'react';

/**
 * Site weather for the HUD: outdoor temperature, condition, sunrise/sunset and air quality.
 * Source: Open-Meteo (no key; only the fixed site coordinates are sent). Sun times fall back to a
 * local solar calculation, so the daylight arc still works offline.
 * Coordinates: NEXT_PUBLIC_SITE_LAT / NEXT_PUBLIC_SITE_LON, else the default plant location below.
 */
const LAT = Number(process.env.NEXT_PUBLIC_SITE_LAT ?? 19.076);
const LON = Number(process.env.NEXT_PUBLIC_SITE_LON ?? 72.877);
const REFRESH_MS = 15 * 60_000;

export interface SiteWeather {
  temp: number | null;
  condition: string;
  sunrise: Date;
  sunset: Date;
  aqi: number | null;
  aqiLabel: string;
}

const CONDITIONS: [number, string][] = [[0, 'Clear'], [1, 'Mostly clear'], [2, 'Partly cloudy'], [3, 'Overcast'], [48, 'Fog'], [57, 'Drizzle'], [67, 'Rain'], [77, 'Snow'], [82, 'Showers'], [86, 'Snow showers'], [99, 'Thunderstorm']];
const condition = (code: number | null) => (code === null ? '—' : CONDITIONS.find(([c]) => code <= c)?.[1] ?? '—');
const aqiLabel = (v: number | null) => (v === null ? '—' : v <= 20 ? 'Good' : v <= 40 ? 'Fair' : v <= 60 ? 'Moderate' : v <= 80 ? 'Poor' : 'Very poor');

/** NOAA-style sunrise/sunset for a date at LAT/LON (accurate to a couple of minutes). */
export function solarTimes(day = new Date(), lat = LAT, lon = LON): { sunrise: Date; sunset: Date } {
  const rad = Math.PI / 180;
  const start = Date.UTC(day.getUTCFullYear(), 0, 0);
  const n = Math.floor((day.getTime() - start) / 86_400_000);
  const g = (2 * Math.PI / 365) * (n - 1);
  const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const ha = Math.acos(Math.min(1, Math.max(-1, Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(decl)) - Math.tan(lat * rad) * Math.tan(decl)))) / rad;
  const midnight = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
  const at = (min: number) => new Date(midnight + min * 60_000);
  return { sunrise: at(720 - 4 * (lon + ha) - eqt), sunset: at(720 - 4 * (lon - ha) - eqt) };
}

let cache: { at: number; value: SiteWeather } | null = null;

async function load(): Promise<SiteWeather> {
  const sun = solarTimes();
  const q = `latitude=${LAT}&longitude=${LON}&timezone=auto`;
  const [fc, aq] = await Promise.allSettled([
    fetch(`https://api.open-meteo.com/v1/forecast?${q}&current=temperature_2m,weather_code&daily=sunrise,sunset&forecast_days=1&timeformat=unixtime`).then((r) => (r.ok ? r.json() : Promise.reject(r.status))),
    fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?${q}&current=european_aqi`).then((r) => (r.ok ? r.json() : Promise.reject(r.status))),
  ]);
  const f = fc.status === 'fulfilled' ? fc.value : null;
  const aqi = aq.status === 'fulfilled' ? (aq.value?.current?.european_aqi ?? null) : null;
  return {
    temp: f?.current?.temperature_2m ?? null,
    condition: condition(f?.current?.weather_code ?? null),
    sunrise: f?.daily?.sunrise?.[0] ? new Date(f.daily.sunrise[0] * 1000) : sun.sunrise,
    sunset: f?.daily?.sunset?.[0] ? new Date(f.daily.sunset[0] * 1000) : sun.sunset,
    aqi,
    aqiLabel: aqiLabel(aqi),
  };
}

export function useSiteWeather(): SiteWeather {
  const [w, setW] = useState<SiteWeather>(() => cache?.value ?? { temp: null, condition: '—', ...solarTimes(), aqi: null, aqiLabel: '—' });
  useEffect(() => {
    let alive = true;
    const run = () => {
      if (cache && Date.now() - cache.at < REFRESH_MS) { setW(cache.value); return; }
      load().then((value) => { cache = { at: Date.now(), value }; if (alive) setW(value); }).catch(() => {});
    };
    run();
    const t = setInterval(run, REFRESH_MS);
    return () => { alive = false; clearInterval(t); };
  }, []);
  return w;
}
