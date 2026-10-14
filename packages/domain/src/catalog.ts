/** Enumerations for the plant hierarchy and records. */

export const FACILITY_KINDS = ['etp', 'stp', 'wtp', 'cetp', 'other'] as const;
export type FacilityKind = (typeof FACILITY_KINDS)[number];
export const FACILITY_KIND_LABELS: Record<FacilityKind, string> = {
  etp: 'Effluent treatment plant',
  stp: 'Sewage treatment plant',
  wtp: 'Water treatment plant',
  cetp: 'Common effluent treatment plant',
  other: 'Other',
};

export const PROCESS_AREA_KINDS = [
  'intake',
  'screening',
  'equalization',
  'primary_treatment',
  'aeration',
  'clarification',
  'filtration',
  'disinfection',
  'sludge_handling',
  'chemical_dosing',
  'discharge',
  'utilities',
  'other',
] as const;
export type ProcessAreaKind = (typeof PROCESS_AREA_KINDS)[number];
export const PROCESS_AREA_KIND_LABELS: Record<ProcessAreaKind, string> = {
  intake: 'Intake',
  screening: 'Screening',
  equalization: 'Equalization',
  primary_treatment: 'Primary treatment',
  aeration: 'Aeration',
  clarification: 'Clarification',
  filtration: 'Filtration',
  disinfection: 'Disinfection',
  sludge_handling: 'Sludge handling',
  chemical_dosing: 'Chemical dosing',
  discharge: 'Discharge',
  utilities: 'Utilities',
  other: 'Other',
};

export const ASSET_TYPES = [
  'pump',
  'blower',
  'tank',
  'valve',
  'mixer',
  'clarifier',
  'filter',
  'dosing_pump',
  'analyzer',
  'motor',
  'screen',
  'diffuser',
  'uv_unit',
  'other',
] as const;
export type AssetType = (typeof ASSET_TYPES)[number];
export const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  pump: 'Pump',
  blower: 'Blower',
  tank: 'Tank',
  valve: 'Valve',
  mixer: 'Mixer',
  clarifier: 'Clarifier',
  filter: 'Filter',
  dosing_pump: 'Dosing pump',
  analyzer: 'Analyzer',
  motor: 'Motor',
  screen: 'Screen',
  diffuser: 'Diffuser grid',
  uv_unit: 'UV unit',
  other: 'Other',
};

/** Operational state of an asset as recorded by people or derived from telemetry. */
export const ASSET_STATUSES = ['operational', 'degraded', 'down', 'maintenance', 'standby', 'decommissioned'] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];
export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  operational: 'Operational',
  degraded: 'Degraded',
  down: 'Down',
  maintenance: 'In maintenance',
  standby: 'Standby',
  decommissioned: 'Decommissioned',
};

export const CRITICALITIES = ['low', 'medium', 'high'] as const;
export type Criticality = (typeof CRITICALITIES)[number];

export const SENSOR_QUALITIES = ['good', 'uncertain', 'bad'] as const;
export type SensorQuality = (typeof SENSOR_QUALITIES)[number];

/** Provenance of a telemetry reading. `simulator` readings are synthetic and only allowed in demo organizations. */
export const TELEMETRY_SOURCES = ['gateway', 'manual', 'lab', 'simulator'] as const;
export type TelemetrySource = (typeof TELEMETRY_SOURCES)[number];

export const DOCUMENT_KINDS = ['sop', 'manual', 'datasheet', 'safety', 'troubleshooting', 'other'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  sop: 'Standard operating procedure',
  manual: 'Equipment manual',
  datasheet: 'Datasheet',
  safety: 'Safety notice',
  troubleshooting: 'Troubleshooting guide',
  other: 'Other',
};

export const DOCUMENT_STATUSES = ['draft', 'approved', 'archived'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const MEMBERSHIP_STATUSES = ['invited', 'active', 'deactivated'] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];
