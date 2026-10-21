/**
 * "Hey Hydris" voice: wake-phrase detection and utterance understanding shared by the glasses
 * client (wake word, demo answers) and the API assistant.
 */
import { MEASURANDS, type Measurand } from './measurands';

/** Wake phrase, tolerant of common speech-recognition spellings ("hydras", "hi dris"). */
export const WAKE_RE = /\b(?:hey|hi|hay|ok|okay|a)[\s,]+(?:hydris|hydras|hydrus|hydrous|high\s?dris|hi\s?dris|hydra|idris)\b/i;

/** Text after the wake phrase, or null when the phrase is absent. */
export function afterWake(text: string): string | null {
  const m = WAKE_RE.exec(text);
  if (!m) return null;
  return text.slice(m.index + m[0].length).replace(/^[\s,.!?]+/, '').trim();
}

const SYNONYMS: Record<Measurand, string[]> = {
  ph: ['ph', 'p h', 'acidity', 'alkalinity'],
  temperature: ['temperature', 'temp', 'how hot', 'how warm'],
  dissolved_oxygen: ['dissolved oxygen', 'oxygen', ' do ', 'd.o.'],
  turbidity: ['turbidity', 'cloudiness', 'ntu'],
  conductivity: ['conductivity', 'tds', 'salinity'],
  flow_rate: ['flow rate', 'flow', 'throughput'],
  tank_level: ['tank level', 'level', 'how full'],
  pressure: ['pressure'],
  motor_current: ['motor current', 'current draw', 'amps', 'amperage'],
  vibration: ['vibration', 'vibrating'],
  runtime_hours: ['runtime', 'run hours', 'running hours'],
  tss: ['tss', 'suspended solids', 'total suspended solids'],
  cod: ['cod', 'chemical oxygen demand'],
  bod: ['bod', 'biochemical oxygen demand', 'biological oxygen demand'],
  ammonia: ['ammonia', 'nh3', 'ammonium'],
  residual_chlorine: ['chlorine', 'residual chlorine', 'free chlorine'],
};

export function normalizeUtterance(text: string): string {
  return ` ${text.toLowerCase().replace(/[’']/g, "'").replace(/^\s*(hey|hi|ok|okay)?[\s,]*(hydris|hydras|hydrus|high dris|hi dris)[\s,.!?]*/i, '').replace(/[?!.,]/g, ' ').replace(/\s+/g, ' ').trim()} `;
}

export function detectMeasurand(text: string): Measurand | null {
  const t = normalizeUtterance(text);
  // Longest synonym first so "dissolved oxygen" beats "oxygen", "residual chlorine" beats "chlorine".
  const all = MEASURANDS.flatMap((m) => SYNONYMS[m].map((s) => ({ m, s }))).sort((a, b) => b.s.length - a.s.length);
  for (const { m, s } of all) if (t.includes(s.startsWith(' ') ? s : ` ${s} `) || t.includes(` ${s}`)) return m;
  return null;
}

