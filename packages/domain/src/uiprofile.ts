import { ASSET_TYPES, type AssetType } from './catalog';
import { MEASURANDS, type Measurand } from './measurands';
import { ROLES, type Role } from './roles';

/**
 * Glasses UI profiles: a versioned, centrally managed description of what a pair of
 * glasses may show and do. The server enforces the same config it hands to the device.
 *
 * Assignment precedence (most specific wins): device > user > role > org > built-in default.
 * Merge rule: the most specific assignment whose profile has a published version wins
 * ENTIRELY. Configs are never partially merged across levels.
 */

export const UI_PROFILE_SCHEMA_VERSION = 1 as const;

export const UI_SCREENS = ['home', 'alerts', 'inspections', 'tasks', 'map', 'measurements', 'assets', 'sops', 'ai', 'notifications', 'status'] as const;
export type UiScreen = (typeof UI_SCREENS)[number];
export const UI_SCREEN_LABELS: Record<UiScreen, string> = {
  home: 'Home', alerts: 'Alerts', inspections: 'Inspections', tasks: 'Maintenance tasks', map: 'Plant map', measurements: 'Live measurements',
  assets: 'Assets', sops: 'SOP library', ai: 'Hydris AI', notifications: 'Notifications', status: 'Device & session',
};
/** Screens that can never be disabled (navigation root and device/session information). */
export const UI_REQUIRED_SCREENS: ReadonlySet<UiScreen> = new Set(['home', 'status']);

export const UI_WIDGETS = ['next_inspection', 'alarm_summary', 'measurements_glance', 'task_progress'] as const;
export type UiWidget = (typeof UI_WIDGETS)[number];
export const UI_WIDGET_LABELS: Record<UiWidget, string> = {
  next_inspection: 'Next inspection card', alarm_summary: 'Critical alarm badge', measurements_glance: 'Measurements at a glance', task_progress: 'Checklist progress',
};

export const UI_ACTIONS = ['acknowledge_alarm', 'record_inspection', 'submit_inspection', 'toggle_checklist', 'ask_ai', 'view_sops', 'view_map', 'mark_notifications_read'] as const;
export type UiAction = (typeof UI_ACTIONS)[number];
export const UI_ACTION_LABELS: Record<UiAction, string> = {
  acknowledge_alarm: 'Acknowledge alarms', record_inspection: 'Record inspection steps', submit_inspection: 'Submit inspections', toggle_checklist: 'Tick maintenance checklists',
  ask_ai: 'Ask Hydris AI', view_sops: 'Open approved SOPs', view_map: 'View plant map', mark_notifications_read: 'Mark notifications read',
};

export const UI_TEXT_SCALES = [0.9, 1, 1.15, 1.3] as const;

export interface UiProfileConfig {
  schemaVersion: typeof UI_PROFILE_SCHEMA_VERSION;
  /** Ordered list; order drives the home menu. */
  screens: { id: UiScreen; enabled: boolean }[];
  /** Ordered list of home widgets. */
  widgets: { id: UiWidget; visible: boolean }[];
  measurements: {
    /** null = every measurand is shown; otherwise an allow-list. */
    allow: Measurand[] | null;
    /** Display order of measurands per asset type (unlisted measurands follow in default order). */
    orderByAssetType: Partial<Record<AssetType, Measurand[]>>;
  };
  actions: Record<UiAction, boolean>;
  layout: { density: 'compact' | 'comfortable'; textScale: number; handedness: 'left' | 'right' };
}

export const DEFAULT_UI_PROFILE_CONFIG: UiProfileConfig = Object.freeze({
  schemaVersion: UI_PROFILE_SCHEMA_VERSION,
  screens: UI_SCREENS.map((id) => ({ id, enabled: true })),
  widgets: UI_WIDGETS.map((id) => ({ id, visible: true })),
  measurements: { allow: null, orderByAssetType: {} },
  actions: Object.fromEntries(UI_ACTIONS.map((a) => [a, true])) as Record<UiAction, boolean>,
  layout: { density: 'comfortable', textScale: 1, handedness: 'right' },
}) as UiProfileConfig;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Normalize any (possibly partial or older) config into a complete, valid one: unknown ids are
 * dropped, missing ids are appended in default order, required screens are forced on.
 */
export function normalizeUiProfileConfig(input: unknown): UiProfileConfig {
  const c = isObj(input) ? input : {};
  const screensIn = Array.isArray(c.screens) ? c.screens : [];
  const seenS = new Set<UiScreen>();
  const screens: UiProfileConfig['screens'] = [];
  for (const s of screensIn) {
    if (!isObj(s) || !(UI_SCREENS as readonly string[]).includes(s.id as string) || seenS.has(s.id as UiScreen)) continue;
    const id = s.id as UiScreen;
    seenS.add(id);
    screens.push({ id, enabled: UI_REQUIRED_SCREENS.has(id) ? true : s.enabled !== false });
  }
  for (const id of UI_SCREENS) if (!seenS.has(id)) screens.push({ id, enabled: true });

  const widgetsIn = Array.isArray(c.widgets) ? c.widgets : [];
  const seenW = new Set<UiWidget>();
  const widgets: UiProfileConfig['widgets'] = [];
  for (const w of widgetsIn) {
    if (!isObj(w) || !(UI_WIDGETS as readonly string[]).includes(w.id as string) || seenW.has(w.id as UiWidget)) continue;
    seenW.add(w.id as UiWidget);
    widgets.push({ id: w.id as UiWidget, visible: w.visible !== false });
  }
  for (const id of UI_WIDGETS) if (!seenW.has(id)) widgets.push({ id, visible: true });

  const m = isObj(c.measurements) ? c.measurements : {};
  const validM = (v: unknown): v is Measurand => (MEASURANDS as readonly string[]).includes(v as string);
  const allow = Array.isArray(m.allow) ? [...new Set(m.allow.filter(validM))] : null;
  const orderByAssetType: UiProfileConfig['measurements']['orderByAssetType'] = {};
  if (isObj(m.orderByAssetType)) {
    for (const [k, v] of Object.entries(m.orderByAssetType)) {
      if ((ASSET_TYPES as readonly string[]).includes(k) && Array.isArray(v)) orderByAssetType[k as AssetType] = [...new Set(v.filter(validM))];
    }
  }

  const a = isObj(c.actions) ? c.actions : {};
  const actions = Object.fromEntries(UI_ACTIONS.map((k) => [k, a[k] !== false])) as Record<UiAction, boolean>;

  const l = isObj(c.layout) ? c.layout : {};
  const ts = typeof l.textScale === 'number' && Number.isFinite(l.textScale) ? Math.min(1.4, Math.max(0.85, l.textScale)) : 1;
  return {
    schemaVersion: UI_PROFILE_SCHEMA_VERSION,
    screens, widgets, measurements: { allow, orderByAssetType }, actions,
    layout: { density: l.density === 'compact' ? 'compact' : 'comfortable', textScale: ts, handedness: l.handedness === 'left' ? 'left' : 'right' },
  };
}

export const screenEnabled = (c: UiProfileConfig, s: UiScreen) => UI_REQUIRED_SCREENS.has(s) || !!c.screens.find((x) => x.id === s)?.enabled;
export const actionAllowed = (c: UiProfileConfig, a: UiAction) => c.actions[a] === true;
export const measurandAllowed = (c: UiProfileConfig, m: string) => c.measurements.allow === null || (c.measurements.allow as string[]).includes(m);
export const enabledScreens = (c: UiProfileConfig) => c.screens.filter((s) => s.enabled || UI_REQUIRED_SCREENS.has(s.id)).map((s) => s.id);

/** Sort key for a measurand on an asset type: configured order first, then the canonical order. */
export function measurandRank(c: UiProfileConfig, assetType: string | null | undefined, m: string): number {
  const order = assetType ? (c.measurements.orderByAssetType as Record<string, string[] | undefined>)[assetType] : undefined;
  const i = order?.indexOf(m) ?? -1;
  if (i >= 0) return i;
  const j = (MEASURANDS as readonly string[]).indexOf(m);
  return 100 + (j < 0 ? 99 : j);
}

/** Filter + order a list of sensors/measurements for display under a profile. */
export function applyMeasurementProfile<T extends { measurand: string; assetType?: string | null }>(c: UiProfileConfig, rows: T[], assetType?: string | null): T[] {
  return rows.filter((r) => measurandAllowed(c, r.measurand))
    .map((r, i) => ({ r, i, k: measurandRank(c, r.assetType ?? assetType, r.measurand) }))
    .sort((a, b) => a.k - b.k || a.i - b.i).map((x) => x.r);
}

// ---------------- precedence ----------------
export type UiAssignmentScope = 'device' | 'user' | 'role' | 'org';
export const UI_SCOPE_PRECEDENCE: readonly UiAssignmentScope[] = ['device', 'user', 'role', 'org'];

export interface UiAssignmentRef { scope: UiAssignmentScope; profileId: string; role?: Role | null; userId?: string | null; deviceId?: string | null }
export interface UiSubject { deviceId?: string | null; userId?: string | null; role?: Role | null }

/**
 * Pick the winning assignment for a subject. `usable(profileId)` lets the caller skip profiles
 * that have no published version (or are archived) so resolution falls through to the next level.
 * Returns null when the built-in default applies.
 */
export function resolveUiAssignment<A extends UiAssignmentRef>(assignments: A[], subject: UiSubject, usable: (profileId: string) => boolean = () => true): A | null {
  for (const scope of UI_SCOPE_PRECEDENCE) {
    const hit = assignments.find((a) => a.scope === scope && usable(a.profileId) && (
      scope === 'org' ? true
        : scope === 'role' ? !!subject.role && a.role === subject.role
          : scope === 'user' ? !!subject.userId && a.userId === subject.userId
            : !!subject.deviceId && a.deviceId === subject.deviceId));
    if (hit) return hit;
  }
  return null;
}

/** Human-readable change list between two configs (version history diff summary). */
export function diffUiProfileConfigs(prevIn: unknown, nextIn: unknown): string[] {
  const a = normalizeUiProfileConfig(prevIn);
  const b = normalizeUiProfileConfig(nextIn);
  const out: string[] = [];
  for (const s of UI_SCREENS) {
    const x = screenEnabled(a, s), y = screenEnabled(b, s);
    if (x !== y) out.push(`${y ? 'Enabled' : 'Disabled'} screen: ${UI_SCREEN_LABELS[s]}`);
  }
  if (a.screens.map((s) => s.id).join() !== b.screens.map((s) => s.id).join()) out.push('Reordered screens');
  for (const w of UI_WIDGETS) {
    const x = a.widgets.find((i) => i.id === w)!.visible, y = b.widgets.find((i) => i.id === w)!.visible;
    if (x !== y) out.push(`${y ? 'Showed' : 'Hid'} widget: ${UI_WIDGET_LABELS[w]}`);
  }
  if (a.widgets.map((s) => s.id).join() !== b.widgets.map((s) => s.id).join()) out.push('Reordered home widgets');
  for (const k of UI_ACTIONS) if (a.actions[k] !== b.actions[k]) out.push(`${b.actions[k] ? 'Allowed' : 'Blocked'} action: ${UI_ACTION_LABELS[k]}`);
  const al = a.measurements.allow?.slice().sort().join() ?? '*', bl = b.measurements.allow?.slice().sort().join() ?? '*';
  if (al !== bl) out.push(b.measurements.allow === null ? 'All measurements shown' : `Measurement allow-list: ${b.measurements.allow.length} measurand(s)`);
  if (JSON.stringify(a.measurements.orderByAssetType) !== JSON.stringify(b.measurements.orderByAssetType)) out.push('Changed measurement order per asset type');
  if (a.layout.density !== b.layout.density) out.push(`Density: ${b.layout.density}`);
  if (a.layout.textScale !== b.layout.textScale) out.push(`Text scale: ${Math.round(b.layout.textScale * 100)} %`);
  if (a.layout.handedness !== b.layout.handedness) out.push(`Handedness: ${b.layout.handedness}`);
  return out;
}

export const UI_ASSIGNABLE_ROLES: readonly Role[] = ROLES;
