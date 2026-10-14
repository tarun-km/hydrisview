/**
 * Measurement catalogue for wastewater operations. Each measurand has one canonical
 * storage unit; ingestion normalizes accepted alternative units into it.
 *
 * `method` captures provenance: continuous online instruments vs. laboratory or
 * manual determinations. Lab parameters (COD, BOD, TSS) are never presented as
 * live streams unless an online analyzer is actually integrated.
 */

export type MeasurementMethod = 'continuous' | 'lab' | 'manual';

export interface UnitConversion {
  unit: string;
  /** Convert a value in this unit to the canonical unit. */
  toCanonical: (v: number) => number;
}

export interface MeasurandDef {
  key: Measurand;
  label: string;
  unit: string;
  decimals: number;
  defaultMethod: MeasurementMethod;
  /** Physically plausible range in canonical units; values outside are rejected as invalid. */
  validRange: [number, number];
  /** Typical healthy operating band for orientation (not an alarm threshold). */
  typicalRange: [number, number] | null;
  alternativeUnits: UnitConversion[];
  /** Short operator-facing explanation used by the assistance panel. */
  explanation: string;
}

export const MEASURANDS = [
  'ph',
  'temperature',
  'dissolved_oxygen',
  'turbidity',
  'conductivity',
  'flow_rate',
  'tank_level',
  'pressure',
  'motor_current',
  'vibration',
  'runtime_hours',
  'tss',
  'cod',
  'bod',
  'ammonia',
  'residual_chlorine',
] as const;
export type Measurand = (typeof MEASURANDS)[number];

const id = (v: number) => v;

export const MEASURAND_DEFS: Record<Measurand, MeasurandDef> = {
  ph: {
    key: 'ph', label: 'pH', unit: 'pH', decimals: 2, defaultMethod: 'continuous',
    validRange: [0, 14], typicalRange: [6.5, 8.5], alternativeUnits: [],
    explanation: 'Acidity/alkalinity of the water on a 0-14 scale. Biological treatment typically works best near neutral (6.5-8.5); sudden swings often indicate an upstream discharge or dosing problem.',
  },
  temperature: {
    key: 'temperature', label: 'Temperature', unit: '°C', decimals: 1, defaultMethod: 'continuous',
    validRange: [-20, 120], typicalRange: [10, 35],
    alternativeUnits: [{ unit: '°F', toCanonical: (f) => ((f - 32) * 5) / 9 }, { unit: 'K', toCanonical: (k) => k - 273.15 }],
    explanation: 'Process water temperature. Affects biological activity, oxygen solubility and discharge compliance.',
  },
  dissolved_oxygen: {
    key: 'dissolved_oxygen', label: 'Dissolved oxygen', unit: 'mg/L', decimals: 2, defaultMethod: 'continuous',
    validRange: [0, 25], typicalRange: [1.5, 3],
    alternativeUnits: [{ unit: 'ppm', toCanonical: id }],
    explanation: 'Oxygen available to microorganisms in aeration. Too low starves the biology; too high wastes blower energy.',
  },
  turbidity: {
    key: 'turbidity', label: 'Turbidity', unit: 'NTU', decimals: 1, defaultMethod: 'continuous',
    validRange: [0, 4000], typicalRange: [0, 10],
    alternativeUnits: [{ unit: 'FNU', toCanonical: id }],
    explanation: 'Cloudiness from suspended particles. Rising effluent turbidity can indicate clarifier carry-over or filter breakthrough.',
  },
  conductivity: {
    key: 'conductivity', label: 'Conductivity', unit: 'µS/cm', decimals: 0, defaultMethod: 'continuous',
    validRange: [0, 200000], typicalRange: [200, 3000],
    alternativeUnits: [{ unit: 'mS/cm', toCanonical: (v) => v * 1000 }, { unit: 'uS/cm', toCanonical: id }],
    explanation: 'Dissolved ionic content. Step changes usually mean a change in influent composition or a chemical spill.',
  },
  flow_rate: {
    key: 'flow_rate', label: 'Flow rate', unit: 'm³/h', decimals: 1, defaultMethod: 'continuous',
    validRange: [0, 100000], typicalRange: null,
    alternativeUnits: [
      { unit: 'L/s', toCanonical: (v) => v * 3.6 },
      { unit: 'm³/d', toCanonical: (v) => v / 24 },
      { unit: 'm3/h', toCanonical: id },
    ],
    explanation: 'Volumetric flow through the line or stage. Compare against design capacity and the downstream stage limits.',
  },
  tank_level: {
    key: 'tank_level', label: 'Tank level', unit: '%', decimals: 1, defaultMethod: 'continuous',
    validRange: [0, 100], typicalRange: [20, 80], alternativeUnits: [],
    explanation: 'Fill level as a percentage of usable tank height. High levels risk overflow; low levels risk pump dry-running.',
  },
  pressure: {
    key: 'pressure', label: 'Pressure', unit: 'bar', decimals: 2, defaultMethod: 'continuous',
    validRange: [-1, 100], typicalRange: null,
    alternativeUnits: [{ unit: 'kPa', toCanonical: (v) => v / 100 }, { unit: 'psi', toCanonical: (v) => v * 0.0689476 }],
    explanation: 'Line or discharge pressure. Rising pressure can indicate blockage; falling pressure can indicate a leak or pump wear.',
  },
  motor_current: {
    key: 'motor_current', label: 'Motor current', unit: 'A', decimals: 1, defaultMethod: 'continuous',
    validRange: [0, 2000], typicalRange: null, alternativeUnits: [],
    explanation: 'Electrical current drawn by the motor. Above nameplate rating suggests overload or mechanical binding; very low suggests dry-running or a broken coupling.',
  },
  vibration: {
    key: 'vibration', label: 'Vibration', unit: 'mm/s', decimals: 2, defaultMethod: 'continuous',
    validRange: [0, 100], typicalRange: [0, 4.5], alternativeUnits: [],
    explanation: 'RMS vibration velocity. Sustained values above the configured threshold commonly indicate misalignment, imbalance, cavitation or bearing wear.',
  },
  runtime_hours: {
    key: 'runtime_hours', label: 'Runtime', unit: 'h', decimals: 0, defaultMethod: 'continuous',
    validRange: [0, 1_000_000], typicalRange: null, alternativeUnits: [],
    explanation: 'Accumulated operating hours, used to schedule preventive maintenance.',
  },
  tss: {
    key: 'tss', label: 'Total suspended solids', unit: 'mg/L', decimals: 0, defaultMethod: 'lab',
    validRange: [0, 50000], typicalRange: null, alternativeUnits: [],
    explanation: 'Mass of suspended solids per litre, normally determined in the laboratory from a grab or composite sample.',
  },
  cod: {
    key: 'cod', label: 'Chemical oxygen demand', unit: 'mg/L', decimals: 0, defaultMethod: 'lab',
    validRange: [0, 100000], typicalRange: null, alternativeUnits: [],
    explanation: 'Oxygen equivalent of oxidizable matter. A laboratory determination unless an online analyzer is installed.',
  },
  bod: {
    key: 'bod', label: 'Biochemical oxygen demand (BOD5)', unit: 'mg/L', decimals: 0, defaultMethod: 'lab',
    validRange: [0, 50000], typicalRange: null, alternativeUnits: [],
    explanation: 'Five-day biological oxygen demand - a laboratory result available days after sampling, never a live reading.',
  },
  ammonia: {
    key: 'ammonia', label: 'Ammonia (NH₄-N)', unit: 'mg/L', decimals: 2, defaultMethod: 'continuous',
    validRange: [0, 2000], typicalRange: [0, 5], alternativeUnits: [],
    explanation: 'Ammonium nitrogen. Rising effluent ammonia indicates incomplete nitrification.',
  },
  residual_chlorine: {
    key: 'residual_chlorine', label: 'Residual chlorine', unit: 'mg/L', decimals: 2, defaultMethod: 'continuous',
    validRange: [0, 20], typicalRange: [0.2, 1], alternativeUnits: [],
    explanation: 'Free chlorine remaining after disinfection contact time.',
  },
};

export const isMeasurand = (v: unknown): v is Measurand =>
  typeof v === 'string' && (MEASURANDS as readonly string[]).includes(v);

export type NormalizeResult =
  | { ok: true; value: number; unit: string }
  | { ok: false; reason: 'unknown_unit' | 'out_of_range' | 'not_finite' };

/** Convert a raw value+unit into the measurand's canonical unit and validate plausibility. */
export function normalizeMeasurement(measurand: Measurand, value: number, unit: string | undefined): NormalizeResult {
  if (!Number.isFinite(value)) return { ok: false, reason: 'not_finite' };
  const def = MEASURAND_DEFS[measurand];
  let canonical = value;
  if (unit !== undefined && unit !== def.unit) {
    const conv = def.alternativeUnits.find((u) => u.unit === unit);
    if (!conv) return { ok: false, reason: 'unknown_unit' };
    canonical = conv.toCanonical(value);
  }
  const [lo, hi] = def.validRange;
  if (canonical < lo || canonical > hi) return { ok: false, reason: 'out_of_range' };
  return { ok: true, value: canonical, unit: def.unit };
}

export function formatMeasurement(measurand: Measurand, value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const def = MEASURAND_DEFS[measurand];
  return value.toLocaleString('en-US', { minimumFractionDigits: def.decimals, maximumFractionDigits: def.decimals });
}
