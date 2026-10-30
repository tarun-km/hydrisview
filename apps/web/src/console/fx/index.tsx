import './glass.css';

export { DotMatrix } from './DotMatrix';
export { BarTicks, Bumps, DotGrid, LiveWave, Ring, SunArc } from './charts';
export { GlassTile, Ticker, bento, rise, useClock } from './motion';
export { KpiTile } from './KpiTile';
export { PlantPulse } from './PlantPulse';
export { WeatherTile } from './WeatherTile';

/** Slow, blurred colour field behind the console glass (pure CSS; frozen under reduced motion). */
export function ColourField() {
  return <div className="cg-field" aria-hidden><i /><i /><i /><i /></div>;
}
