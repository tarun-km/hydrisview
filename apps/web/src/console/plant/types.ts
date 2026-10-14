import type { AlarmSeverity, AssetStatus, AssetType, Criticality, FacilityKind, Freshness, Measurand, ProcessAreaKind } from '@hydris/domain';

/** Wire shapes returned by apps/api/src/modules/plant.ts and inspections.ts (dates arrive as ISO strings). */

export interface Site {
  id: string;
  name: string;
  code: string;
  address: string | null;
  city: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
  timezone: string;
  layoutWidthM: number;
  layoutHeightM: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SiteListItem extends Site {
  facilities: number;
  assets: number;
  openAlarms: number;
  criticalAlarms: number;
}

export interface Facility {
  id: string;
  siteId: string;
  name: string;
  code: string;
  kind: FacilityKind;
  capacityM3PerDay: number | null;
  description: string | null;
  archivedAt: string | null;
}

export interface ProcessArea {
  id: string;
  siteId: string;
  facilityId: string;
  name: string;
  code: string;
  kind: ProcessAreaKind;
  sortOrder: number;
  polygon: [number, number][] | null;
  archivedAt: string | null;
}

export interface AssetSummary {
  id: string;
  siteId: string;
  facilityId: string;
  processAreaId: string | null;
  tag: string;
  name: string;
  type: AssetType;
  manufacturer: string | null;
  model: string | null;
  serialNumber: string | null;
  installedOn: string | null;
  criticality: Criticality;
  status: AssetStatus;
  specs: Record<string, string | number>;
  notes: string | null;
  positionX: number | null;
  positionY: number | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  areaName: string | null;
  facilityName: string;
  siteName: string;
  openAlarms: number;
  worstSeverity: AlarmSeverity | null;
  sensorCount: number;
  openTasks: number;
}

export interface Gateway {
  id: string;
  name: string;
  protocol: 'https' | 'mqtt' | 'opcua';
  keyPrefix: string;
  status: 'active' | 'revoked';
  lastSeenAt: string | null;
  createdAt: string;
}

export interface SiteDetail {
  site: Site;
  facilities: Facility[];
  processAreas: ProcessArea[];
  assets: AssetSummary[];
  gateways: Gateway[];
}

export interface Sensor {
  id: string;
  siteId: string;
  assetId: string | null;
  tag: string;
  name: string;
  measurand: Measurand;
  unit: string;
  method: 'continuous' | 'lab' | 'manual';
  expectedIntervalS: number;
  sourceRef: string | null;
  lastValue: number | null;
  lastTs: string | null;
  lastSource: 'gateway' | 'manual' | 'lab' | 'simulator' | null;
  enabled: boolean;
  freshness: Freshness;
}

export interface SensorListItem extends Sensor {
  assetTag: string | null;
  assetName: string | null;
  openAlarms: number;
  rules: number;
}

export interface AlarmRow {
  id: string;
  title: string;
  severity: AlarmSeverity;
  state: string;
  triggeredAt: string;
  clearedAt: string | null;
  synthetic: boolean;
}

export interface MaintenanceRow {
  id: string;
  title: string;
  kind: string;
  priority: string;
  status: string;
  dueAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface InspectionRow {
  id: string;
  title: string;
  status: string;
  dueAt: string | null;
  submittedAt: string | null;
  assignedTo: string | null;
}

export interface DocumentRow {
  id: string;
  title: string;
  kind: string;
  status: string;
  version: number;
}

export interface Attachment {
  id: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  createdAt: string;
}

export interface AssetDetail {
  asset: AssetSummary;
  sensors: Sensor[];
  alarms: AlarmRow[];
  maintenance: MaintenanceRow[];
  inspections: InspectionRow[];
  documents: DocumentRow[];
  attachments: Attachment[];
}

export interface InspectionRoute {
  id: string;
  siteId: string;
  name: string;
  description: string | null;
  assetIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface InspectionTemplate {
  id: string;
  name: string;
  assetType: AssetType | null;
  estimatedMinutes: number | null;
  status: 'draft' | 'published' | 'archived';
  version: number;
}

export interface Member {
  userId: string;
  name: string;
  email: string;
  role: string;
  status: 'invited' | 'active' | 'deactivated';
  allSites: boolean;
  siteIds: string[];
  openInspections: number;
}
