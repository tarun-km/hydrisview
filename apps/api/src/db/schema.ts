/**
 * Relational domain model. Every tenant-owned table carries `org_id`; row-level
 * security policies (see migrations/*rls*) restrict each request transaction to the
 * caller's organization. Times are stored as timestamptz (UTC).
 */
import {
  ALARM_CONDITIONS,
  ALARM_SEVERITIES,
  ALARM_STATES,
  ASSET_STATUSES,
  ASSET_TYPES,
  CRITICALITIES,
  DEVICE_RECORD_STATUSES,
  DOCUMENT_KINDS,
  DOCUMENT_STATUSES,
  FACILITY_KINDS,
  INSPECTION_STATUSES,
  MAINTENANCE_KINDS,
  MAINTENANCE_PRIORITIES,
  MAINTENANCE_STATUSES,
  MEASURANDS,
  MEMBERSHIP_STATUSES,
  PAIRING_STATUSES,
  PROCESS_AREA_KINDS,
  ROLES,
  SENSOR_QUALITIES,
  TELEMETRY_SOURCES,
  type InspectionStep,
  type StepValue,
} from '@hydris/domain';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => ts('created_at').notNull().defaultNow();
const updatedAt = () => ts('updated_at').notNull().defaultNow();
const pk = () => uuid('id').primaryKey().defaultRandom();
const orgRef = () => uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' });

// ---------------- enums ----------------
export const roleEnum = pgEnum('role', ROLES);
export const membershipStatusEnum = pgEnum('membership_status', MEMBERSHIP_STATUSES);
export const facilityKindEnum = pgEnum('facility_kind', FACILITY_KINDS);
export const processAreaKindEnum = pgEnum('process_area_kind', PROCESS_AREA_KINDS);
export const assetTypeEnum = pgEnum('asset_type', ASSET_TYPES);
export const assetStatusEnum = pgEnum('asset_status', ASSET_STATUSES);
export const criticalityEnum = pgEnum('criticality', CRITICALITIES);
export const measurandEnum = pgEnum('measurand', MEASURANDS);
export const methodEnum = pgEnum('measurement_method', ['continuous', 'lab', 'manual']);
export const qualityEnum = pgEnum('sensor_quality', SENSOR_QUALITIES);
export const telemetrySourceEnum = pgEnum('telemetry_source', TELEMETRY_SOURCES);
export const alarmSeverityEnum = pgEnum('alarm_severity', ALARM_SEVERITIES);
export const alarmConditionEnum = pgEnum('alarm_condition', ALARM_CONDITIONS);
export const alarmStateEnum = pgEnum('alarm_state', ALARM_STATES);
export const inspectionStatusEnum = pgEnum('inspection_status', INSPECTION_STATUSES);
export const maintenanceStatusEnum = pgEnum('maintenance_status', MAINTENANCE_STATUSES);
export const maintenancePriorityEnum = pgEnum('maintenance_priority', MAINTENANCE_PRIORITIES);
export const maintenanceKindEnum = pgEnum('maintenance_kind', MAINTENANCE_KINDS);
export const deviceStatusEnum = pgEnum('device_status', DEVICE_RECORD_STATUSES);
export const pairingStatusEnum = pgEnum('pairing_status', PAIRING_STATUSES);
export const documentKindEnum = pgEnum('document_kind', DOCUMENT_KINDS);
export const documentStatusEnum = pgEnum('document_status', DOCUMENT_STATUSES);

// ---------------- identity & tenancy ----------------

export const users = pgTable(
  'users',
  {
    id: pk(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    passwordHash: text('password_hash'),
    isPlatformAdmin: boolean('is_platform_admin').notNull().default(false),
    status: text('status').$type<'active' | 'disabled'>().notNull().default('active'),
    emailVerifiedAt: ts('email_verified_at'),
    mfaSecretEnc: text('mfa_secret_enc'),
    mfaEnabled: boolean('mfa_enabled').notNull().default(false),
    failedLogins: integer('failed_logins').notNull().default(0),
    lockedUntil: ts('locked_until'),
    lastLoginAt: ts('last_login_at'),
    defaultOrgId: uuid('default_org_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('users_email_lower_uq').on(sql`lower(${t.email})`)],
);

export const organizations = pgTable(
  'organizations',
  {
    id: pk(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    /** Demo tenants may receive synthetic simulator telemetry; customer tenants never do. */
    isDemo: boolean('is_demo').notNull().default(false),
    region: text('region'),
    timezone: text('timezone').notNull().default('UTC'),
    status: text('status').$type<'active' | 'suspended'>().notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('organizations_slug_uq').on(t.slug)],
);

export const memberships = pgTable(
  'memberships',
  {
    id: pk(),
    orgId: orgRef(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: roleEnum('role').notNull(),
    status: membershipStatusEnum('status').notNull().default('active'),
    /** When false, access is limited to sites listed in membership_sites. */
    allSites: boolean('all_sites').notNull().default(true),
    title: text('title'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deactivatedAt: ts('deactivated_at'),
  },
  (t) => [uniqueIndex('memberships_org_user_uq').on(t.orgId, t.userId), index('memberships_user_idx').on(t.userId)],
);

export const membershipSites = pgTable(
  'membership_sites',
  {
    membershipId: uuid('membership_id').notNull().references(() => memberships.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
    orgId: orgRef(),
  },
  (t) => [primaryKey({ columns: [t.membershipId, t.siteId] })],
);

export const invitations = pgTable(
  'invitations',
  {
    id: pk(),
    orgId: orgRef(),
    email: text('email').notNull(),
    name: text('name'),
    role: roleEnum('role').notNull(),
    siteIds: jsonb('site_ids').$type<string[]>().notNull().default([]),
    allSites: boolean('all_sites').notNull().default(true),
    tokenHash: text('token_hash').notNull(),
    expiresAt: ts('expires_at').notNull(),
    acceptedAt: ts('accepted_at'),
    revokedAt: ts('revoked_at'),
    invitedBy: uuid('invited_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('invitations_token_uq').on(t.tokenHash), index('invitations_org_idx').on(t.orgId)],
);

/** User refresh sessions (rotating tokens, family-based reuse detection). */
export const authSessions = pgTable(
  'auth_sessions',
  {
    id: pk(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
    familyId: uuid('family_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    rotatedAt: ts('rotated_at'),
    userAgent: text('user_agent'),
    ip: text('ip'),
    createdAt: createdAt(),
    lastUsedAt: ts('last_used_at'),
  },
  (t) => [uniqueIndex('auth_sessions_token_uq').on(t.tokenHash), index('auth_sessions_user_idx').on(t.userId), index('auth_sessions_family_idx').on(t.familyId)],
);

/** Single-use tokens for password reset and email verification. */
export const authTokens = pgTable(
  'auth_tokens',
  {
    id: pk(),
    purpose: text('purpose').$type<'password_reset' | 'email_verify'>().notNull(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: ts('expires_at').notNull(),
    usedAt: ts('used_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('auth_tokens_token_uq').on(t.tokenHash)],
);

/** Development/test mail transport: messages are recorded here instead of being sent. */
export const mailOutbox = pgTable('mail_outbox', {
  id: pk(),
  to: text('to').notNull(),
  subject: text('subject').notNull(),
  bodyText: text('body_text').notNull(),
  createdAt: createdAt(),
  sentAt: ts('sent_at'),
});

// ---------------- plant hierarchy ----------------

export const sites = pgTable(
  'sites',
  {
    id: pk(),
    orgId: orgRef(),
    name: text('name').notNull(),
    code: text('code').notNull(),
    address: text('address'),
    city: text('city'),
    country: text('country'),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    timezone: text('timezone').notNull().default('UTC'),
    /** Plant layout canvas in metres used by the map / inspection-route planner. */
    layoutWidthM: doublePrecision('layout_width_m').notNull().default(100),
    layoutHeightM: doublePrecision('layout_height_m').notNull().default(80),
    archivedAt: ts('archived_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('sites_org_code_uq').on(t.orgId, t.code), index('sites_org_idx').on(t.orgId)],
);

export const facilities = pgTable(
  'facilities',
  {
    id: pk(),
    orgId: orgRef(),
    siteId: uuid('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    code: text('code').notNull(),
    kind: facilityKindEnum('kind').notNull(),
    capacityM3PerDay: doublePrecision('capacity_m3_per_day'),
    description: text('description'),
    archivedAt: ts('archived_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('facilities_site_code_uq').on(t.siteId, t.code), index('facilities_org_idx').on(t.orgId)],
);

export const processAreas = pgTable(
  'process_areas',
  {
    id: pk(),
    orgId: orgRef(),
    siteId: uuid('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
    facilityId: uuid('facility_id').notNull().references(() => facilities.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    code: text('code').notNull(),
    kind: processAreaKindEnum('kind').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    /** Polygon on the site layout, metres: [[x,y],...] */
    polygon: jsonb('polygon').$type<[number, number][] | null>(),
    archivedAt: ts('archived_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('process_areas_facility_code_uq').on(t.facilityId, t.code), index('process_areas_org_idx').on(t.orgId)],
);

export const assets = pgTable(
  'assets',
  {
    id: pk(),
    orgId: orgRef(),
    siteId: uuid('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
    facilityId: uuid('facility_id').notNull().references(() => facilities.id, { onDelete: 'cascade' }),
    processAreaId: uuid('process_area_id').references(() => processAreas.id, { onDelete: 'set null' }),
    tag: text('tag').notNull(),
    name: text('name').notNull(),
    type: assetTypeEnum('type').notNull(),
    manufacturer: text('manufacturer'),
    model: text('model'),
    serialNumber: text('serial_number'),
    installedOn: text('installed_on'),
    criticality: criticalityEnum('criticality').notNull().default('medium'),
    status: assetStatusEnum('status').notNull().default('operational'),
    specs: jsonb('specs').$type<Record<string, string | number>>().notNull().default({}),
    notes: text('notes'),
    positionX: doublePrecision('position_x'),
    positionY: doublePrecision('position_y'),
    archivedAt: ts('archived_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('assets_org_tag_uq').on(t.orgId, t.tag),
    index('assets_site_idx').on(t.orgId, t.siteId),
    index('assets_area_idx').on(t.processAreaId),
  ],
);

export const gateways = pgTable(
  'gateways',
  {
    id: pk(),
    orgId: orgRef(),
    siteId: uuid('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    protocol: text('protocol').$type<'https' | 'mqtt' | 'opcua'>().notNull().default('https'),
    keyPrefix: text('key_prefix').notNull(),
    keyHash: text('key_hash').notNull(),
    status: text('status').$type<'active' | 'revoked'>().notNull().default('active'),
    lastSeenAt: ts('last_seen_at'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
    revokedAt: ts('revoked_at'),
  },
  (t) => [uniqueIndex('gateways_key_uq').on(t.keyHash), index('gateways_org_idx').on(t.orgId)],
);

export const sensors = pgTable(
  'sensors',
  {
    id: pk(),
    orgId: orgRef(),
    siteId: uuid('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id').references(() => assets.id, { onDelete: 'cascade' }),
    processAreaId: uuid('process_area_id').references(() => processAreas.id, { onDelete: 'set null' }),
    gatewayId: uuid('gateway_id').references(() => gateways.id, { onDelete: 'set null' }),
    tag: text('tag').notNull(),
    name: text('name').notNull(),
    measurand: measurandEnum('measurand').notNull(),
    unit: text('unit').notNull(),
    method: methodEnum('method').notNull().default('continuous'),
    expectedIntervalS: integer('expected_interval_s').notNull().default(60),
    sourceRef: text('source_ref'),
    lastValue: doublePrecision('last_value'),
    lastTs: ts('last_ts'),
    lastQuality: qualityEnum('last_quality'),
    lastSource: telemetrySourceEnum('last_source'),
    lastReceivedAt: ts('last_received_at'),
    enabled: boolean('enabled').notNull().default(true),
    archivedAt: ts('archived_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('sensors_org_tag_uq').on(t.orgId, t.tag),
    index('sensors_asset_idx').on(t.assetId),
    index('sensors_site_idx').on(t.orgId, t.siteId),
  ],
);

export const telemetryReadings = pgTable(
  'telemetry_readings',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    orgId: orgRef(),
    sensorId: uuid('sensor_id').notNull().references(() => sensors.id, { onDelete: 'cascade' }),
    ts: ts('ts').notNull(),
    value: doublePrecision('value').notNull(),
    quality: qualityEnum('quality').notNull().default('good'),
    source: telemetrySourceEnum('source').notNull(),
    synthetic: boolean('synthetic').notNull().default(false),
    messageId: text('message_id'),
    receivedAt: ts('received_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('telemetry_sensor_ts_uq').on(t.sensorId, t.ts),
    index('telemetry_sensor_ts_idx').on(t.sensorId, t.ts.desc()),
    index('telemetry_org_ts_idx').on(t.orgId, t.ts),
    check('telemetry_synthetic_source_ck', sql`${t.synthetic} = (${t.source} = 'simulator')`),
  ],
);

// ---------------- alarms ----------------

export const alarmRules = pgTable(
  'alarm_rules',
  {
    id: pk(),
    orgId: orgRef(),
    siteId: uuid('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
    sensorId: uuid('sensor_id').notNull().references(() => sensors.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    condition: alarmConditionEnum('condition').notNull(),
    threshold: doublePrecision('threshold'),
    deadband: doublePrecision('deadband').notNull().default(0),
    onDelayS: integer('on_delay_s').notNull().default(0),
    severity: alarmSeverityEnum('severity').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    recommendedAction: text('recommended_action'),
    procedureDocumentId: uuid('procedure_document_id').references(() => documents.id, { onDelete: 'set null' }),
    /** Evaluation state: when the current breach started (for on-delay). */
    breachSince: ts('breach_since'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('alarm_rules_sensor_idx').on(t.sensorId),
    check('alarm_rules_threshold_ck', sql`(${t.condition} = 'stale') OR (${t.threshold} IS NOT NULL)`),
  ],
);

export const alarmEvents = pgTable(
  'alarm_events',
  {
    id: pk(),
    orgId: orgRef(),
    siteId: uuid('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id').references(() => assets.id, { onDelete: 'set null' }),
    sensorId: uuid('sensor_id').references(() => sensors.id, { onDelete: 'set null' }),
    ruleId: uuid('rule_id').references(() => alarmRules.id, { onDelete: 'set null' }),
    severity: alarmSeverityEnum('severity').notNull(),
    condition: alarmConditionEnum('condition').notNull(),
    state: alarmStateEnum('state').notNull().default('active'),
    title: text('title').notNull(),
    description: text('description'),
    recommendedAction: text('recommended_action'),
    triggerValue: doublePrecision('trigger_value'),
    threshold: doublePrecision('threshold'),
    unit: text('unit'),
    peakValue: doublePrecision('peak_value'),
    triggeredAt: ts('triggered_at').notNull(),
    /** When the measured condition returned to normal. Independent of the human lifecycle. */
    clearedAt: ts('cleared_at'),
    assignedTo: uuid('assigned_to').references(() => users.id),
    acknowledgedBy: uuid('acknowledged_by').references(() => users.id),
    acknowledgedAt: ts('acknowledged_at'),
    resolvedBy: uuid('resolved_by').references(() => users.id),
    resolvedAt: ts('resolved_at'),
    resolutionNote: text('resolution_note'),
    closedBy: uuid('closed_by').references(() => users.id),
    closedAt: ts('closed_at'),
    synthetic: boolean('synthetic').notNull().default(false),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('alarm_events_org_state_idx').on(t.orgId, t.state, t.triggeredAt),
    index('alarm_events_rule_idx').on(t.ruleId, t.state),
    index('alarm_events_asset_idx').on(t.assetId),
  ],
);

export const alarmEventHistory = pgTable(
  'alarm_event_history',
  {
    id: pk(),
    orgId: orgRef(),
    alarmId: uuid('alarm_id').notNull().references(() => alarmEvents.id, { onDelete: 'cascade' }),
    action: text('action').notNull(),
    fromState: alarmStateEnum('from_state'),
    toState: alarmStateEnum('to_state'),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    actorDeviceId: uuid('actor_device_id'),
    note: text('note'),
    at: ts('at').notNull().defaultNow(),
  },
  (t) => [index('alarm_history_alarm_idx').on(t.alarmId, t.at)],
);

// ---------------- documents ----------------

export const documents = pgTable(
  'documents',
  {
    id: pk(),
    orgId: orgRef(),
    siteId: uuid('site_id').references(() => sites.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id').references(() => assets.id, { onDelete: 'set null' }),
    assetType: assetTypeEnum('asset_type'),
    title: text('title').notNull(),
    kind: documentKindEnum('kind').notNull(),
    body: text('body').notNull(),
    version: integer('version').notNull().default(1),
    status: documentStatusEnum('status').notNull().default('draft'),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    approvedBy: uuid('approved_by').references(() => users.id),
    approvedAt: ts('approved_at'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('documents_org_idx').on(t.orgId, t.status), index('documents_asset_idx').on(t.assetId)],
);

// ---------------- inspections ----------------

export const inspectionTemplates = pgTable(
  'inspection_templates',
  {
    id: pk(),
    orgId: orgRef(),
    key: text('key'),
    name: text('name').notNull(),
    description: text('description'),
    assetType: assetTypeEnum('asset_type'),
    version: integer('version').notNull().default(1),
    steps: jsonb('steps').$type<InspectionStep[]>().notNull(),
    safetyNotices: jsonb('safety_notices').$type<string[]>().notNull().default([]),
    estimatedMinutes: integer('estimated_minutes'),
    status: text('status').$type<'draft' | 'published' | 'archived'>().notNull().default('published'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('inspection_templates_org_idx').on(t.orgId)],
);

/** Ordered inspection round through assets on a site (map / route planner). */
export const inspectionRoutes = pgTable(
  'inspection_routes',
  {
    id: pk(),
    orgId: orgRef(),
    siteId: uuid('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    assetIds: jsonb('asset_ids').$type<string[]>().notNull().default([]),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('inspection_routes_site_idx').on(t.orgId, t.siteId)],
);

export const inspections = pgTable(
  'inspections',
  {
    id: pk(),
    orgId: orgRef(),
    siteId: uuid('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id').references(() => assets.id, { onDelete: 'set null' }),
    templateId: uuid('template_id').references(() => inspectionTemplates.id, { onDelete: 'set null' }),
    templateVersion: integer('template_version'),
    routeId: uuid('route_id').references(() => inspectionRoutes.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    /** Snapshot of template steps at assignment time so later template edits do not alter history. */
    steps: jsonb('steps').$type<InspectionStep[]>().notNull(),
    safetyNotices: jsonb('safety_notices').$type<string[]>().notNull().default([]),
    status: inspectionStatusEnum('status').notNull().default('scheduled'),
    priority: text('priority').$type<'normal' | 'high'>().notNull().default('normal'),
    assignedTo: uuid('assigned_to').references(() => users.id),
    assignedBy: uuid('assigned_by').references(() => users.id),
    dueAt: ts('due_at'),
    startedAt: ts('started_at'),
    pausedAt: ts('paused_at'),
    submittedAt: ts('submitted_at'),
    submittedVia: text('submitted_via').$type<'console' | 'glasses'>(),
    submittedDeviceId: uuid('submitted_device_id'),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    reviewedAt: ts('reviewed_at'),
    reviewNote: text('review_note'),
    /** Incremented on every state change; clients send it to detect conflicting offline edits. */
    revision: integer('revision').notNull().default(1),
    synthetic: boolean('synthetic').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('inspections_org_status_idx').on(t.orgId, t.status),
    index('inspections_assignee_idx').on(t.assignedTo, t.status),
    index('inspections_asset_idx').on(t.assetId),
  ],
);

export const inspectionResponses = pgTable(
  'inspection_responses',
  {
    id: pk(),
    orgId: orgRef(),
    inspectionId: uuid('inspection_id').notNull().references(() => inspections.id, { onDelete: 'cascade' }),
    stepId: text('step_id').notNull(),
    value: jsonb('value').$type<StepValue>().notNull(),
    outcome: text('outcome').$type<'ok' | 'abnormal' | 'na'>().notNull(),
    note: text('note'),
    recordedAt: ts('recorded_at').notNull(),
    receivedAt: ts('received_at').notNull().defaultNow(),
    recordedBy: uuid('recorded_by').references(() => users.id),
    deviceId: uuid('device_id'),
    /** Client-generated idempotency key so offline replays never duplicate a response. */
    clientOpId: text('client_op_id').notNull(),
  },
  (t) => [
    uniqueIndex('inspection_responses_op_uq').on(t.inspectionId, t.clientOpId),
    index('inspection_responses_step_idx').on(t.inspectionId, t.stepId, t.recordedAt),
  ],
);

export const attachments = pgTable(
  'attachments',
  {
    id: pk(),
    orgId: orgRef(),
    ownerType: text('owner_type').$type<'inspection' | 'maintenance' | 'asset' | 'document' | 'alarm'>().notNull(),
    ownerId: uuid('owner_id').notNull(),
    filename: text('filename').notNull(),
    mime: text('mime').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: text('sha256').notNull(),
    storageKey: text('storage_key').notNull(),
    uploadedBy: uuid('uploaded_by').references(() => users.id),
    deviceId: uuid('device_id'),
    createdAt: createdAt(),
  },
  (t) => [index('attachments_owner_idx').on(t.ownerType, t.ownerId)],
);

// ---------------- maintenance ----------------

export const maintenanceTasks = pgTable(
  'maintenance_tasks',
  {
    id: pk(),
    orgId: orgRef(),
    siteId: uuid('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id').references(() => assets.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    description: text('description'),
    kind: maintenanceKindEnum('kind').notNull().default('corrective'),
    priority: maintenancePriorityEnum('priority').notNull().default('medium'),
    status: maintenanceStatusEnum('status').notNull().default('open'),
    assignedTo: uuid('assigned_to').references(() => users.id),
    requestedBy: uuid('requested_by').references(() => users.id),
    sourceInspectionId: uuid('source_inspection_id').references(() => inspections.id, { onDelete: 'set null' }),
    sourceAlarmId: uuid('source_alarm_id').references(() => alarmEvents.id, { onDelete: 'set null' }),
    checklist: jsonb('checklist').$type<{ id: string; label: string; done: boolean; doneAt?: string | null; doneBy?: string | null }[]>().notNull().default([]),
    dueAt: ts('due_at'),
    startedAt: ts('started_at'),
    completedAt: ts('completed_at'),
    completionNote: text('completion_note'),
    synthetic: boolean('synthetic').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('maintenance_org_status_idx').on(t.orgId, t.status),
    index('maintenance_assignee_idx').on(t.assignedTo, t.status),
    index('maintenance_asset_idx').on(t.assetId),
  ],
);

export const maintenanceActivity = pgTable(
  'maintenance_activity',
  {
    id: pk(),
    orgId: orgRef(),
    taskId: uuid('task_id').notNull().references(() => maintenanceTasks.id, { onDelete: 'cascade' }),
    action: text('action').notNull(),
    note: text('note'),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    at: ts('at').notNull().defaultNow(),
  },
  (t) => [index('maintenance_activity_task_idx').on(t.taskId, t.at)],
);

// ---------------- devices & pairing ----------------

export const devices = pgTable(
  'devices',
  {
    id: pk(),
    orgId: orgRef(),
    siteId: uuid('site_id').references(() => sites.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    kind: text('kind').$type<'hardware' | 'simulator'>().notNull(),
    model: text('model'),
    /** Install identifier generated on the device; stable across re-pairing on the same install. */
    hardwareId: text('hardware_id').notNull(),
    firmwareVersion: text('firmware_version'),
    appVersion: text('app_version'),
    displayInfo: jsonb('display_info').$type<{ width: number; height: number } | null>(),
    status: deviceStatusEnum('status').notNull().default('active'),
    /** Bumped on revoke / reassignment / suspension to invalidate outstanding device tokens. */
    sessionVersion: integer('session_version').notNull().default(1),
    pairedAt: ts('paired_at').notNull().defaultNow(),
    pairedBy: uuid('paired_by').references(() => users.id),
    lastSeenAt: ts('last_seen_at'),
    lastIp: text('last_ip'),
    suspendedAt: ts('suspended_at'),
    revokedAt: ts('revoked_at'),
    revokedBy: uuid('revoked_by').references(() => users.id),
    revokeReason: text('revoke_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('devices_org_idx').on(t.orgId, t.status), index('devices_hw_idx').on(t.hardwareId)],
);

export const deviceAssignments = pgTable(
  'device_assignments',
  {
    id: pk(),
    orgId: orgRef(),
    deviceId: uuid('device_id').notNull().references(() => devices.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    assignedBy: uuid('assigned_by').references(() => users.id),
    assignedAt: ts('assigned_at').notNull().defaultNow(),
    unassignedAt: ts('unassigned_at'),
    reason: text('reason'),
  },
  (t) => [
    index('device_assignments_device_idx').on(t.deviceId, t.assignedAt),
    uniqueIndex('device_assignments_active_uq').on(t.deviceId).where(sql`${t.unassignedAt} IS NULL`),
  ],
);

/** Pre-tenant table: accessed only from system context with explicit checks. */
export const pairingChallenges = pgTable(
  'pairing_challenges',
  {
    id: pk(),
    codeHash: text('code_hash').notNull(),
    pollSecretHash: text('poll_secret_hash').notNull(),
    hardwareId: text('hardware_id').notNull(),
    deviceInfo: jsonb('device_info').$type<{ kind: 'hardware' | 'simulator'; model?: string; appVersion?: string; firmwareVersion?: string; display?: { width: number; height: number }; name?: string }>().notNull(),
    status: pairingStatusEnum('status').notNull().default('pending'),
    expiresAt: ts('expires_at').notNull(),
    lastPolledAt: ts('last_polled_at'),
    approvedBy: uuid('approved_by').references(() => users.id),
    approvedAt: ts('approved_at'),
    orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id').references(() => sites.id, { onDelete: 'set null' }),
    assigneeUserId: uuid('assignee_user_id').references(() => users.id),
    deviceId: uuid('device_id').references(() => devices.id, { onDelete: 'set null' }),
    completedAt: ts('completed_at'),
    requesterIp: text('requester_ip'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('pairing_code_active_uq').on(t.codeHash).where(sql`${t.status} IN ('pending','approved')`), index('pairing_expires_idx').on(t.expiresAt)],
);

export const deviceSessions = pgTable(
  'device_sessions',
  {
    id: pk(),
    orgId: orgRef(),
    deviceId: uuid('device_id').notNull().references(() => devices.id, { onDelete: 'cascade' }),
    familyId: uuid('family_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    sessionVersion: integer('session_version').notNull(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    rotatedAt: ts('rotated_at'),
    createdAt: createdAt(),
    lastUsedAt: ts('last_used_at'),
  },
  (t) => [uniqueIndex('device_sessions_token_uq').on(t.tokenHash), index('device_sessions_device_idx').on(t.deviceId)],
);

// ---------------- notifications, audit, inquiries, simulation ----------------

export const notifications = pgTable(
  'notifications',
  {
    id: pk(),
    orgId: orgRef(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    severity: text('severity').$type<'info' | 'success' | 'warning' | 'critical'>().notNull().default('info'),
    title: text('title').notNull(),
    body: text('body'),
    link: text('link'),
    entityType: text('entity_type'),
    entityId: uuid('entity_id'),
    readAt: ts('read_at'),
    createdAt: createdAt(),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.readAt, t.createdAt)],
);

/** Append-only audit trail. The application role has no UPDATE/DELETE grant on this table. */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: pk(),
    orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
    actorUserId: uuid('actor_user_id'),
    actorDeviceId: uuid('actor_device_id'),
    actorLabel: text('actor_label'),
    action: text('action').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    summary: text('summary'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    ip: text('ip'),
    at: ts('at').notNull().defaultNow(),
  },
  (t) => [index('audit_org_at_idx').on(t.orgId, t.at), index('audit_entity_idx').on(t.entityType, t.entityId)],
);

/** Public website enquiries (platform-owned, not tenant data). */
export const inquiries = pgTable('inquiries', {
  id: pk(),
  kind: text('kind').$type<'contact' | 'demo'>().notNull(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  company: text('company'),
  jobTitle: text('job_title'),
  phone: text('phone'),
  siteCount: text('site_count'),
  message: text('message'),
  consent: boolean('consent').notNull(),
  consentVersion: text('consent_version').notNull(),
  ipHash: text('ip_hash'),
  userAgent: text('user_agent'),
  status: text('status').$type<'new' | 'contacted' | 'closed' | 'spam'>().notNull().default('new'),
  createdAt: createdAt(),
});

export const simulationRuns = pgTable(
  'simulation_runs',
  {
    id: pk(),
    orgId: orgRef(),
    siteId: uuid('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
    scenarioKey: text('scenario_key').notNull(),
    status: text('status').$type<'running' | 'stopped' | 'completed'>().notNull().default('running'),
    step: integer('step').notNull().default(0),
    startedBy: uuid('started_by').references(() => users.id),
    startedAt: ts('started_at').notNull().defaultNow(),
    stoppedAt: ts('stopped_at'),
  },
  (t) => [index('simulation_runs_org_idx').on(t.orgId, t.status)],
);

// ---------------- measurement corrections (provenance-preserving) ----------------

/**
 * Corrections never overwrite telemetry_readings: the original row is kept and a
 * correction record supersedes its value for display/aggregation, with who/why/when.
 */
export const telemetryCorrections = pgTable(
  'telemetry_corrections',
  {
    id: pk(),
    orgId: orgRef(),
    sensorId: uuid('sensor_id').notNull().references(() => sensors.id, { onDelete: 'cascade' }),
    readingId: bigint('reading_id', { mode: 'number' }).notNull().references(() => telemetryReadings.id, { onDelete: 'cascade' }),
    originalValue: doublePrecision('original_value').notNull(),
    correctedValue: doublePrecision('corrected_value'),
    /** 'correct' replaces the value; 'invalidate' marks the reading as excluded. */
    action: text('action').$type<'correct' | 'invalidate'>().notNull(),
    reason: text('reason').notNull(),
    correctedBy: uuid('corrected_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('telemetry_corrections_reading_idx').on(t.readingId, t.createdAt), index('telemetry_corrections_sensor_idx').on(t.sensorId)],
);

// ---------------- glasses UI profiles ----------------

export const uiProfiles = pgTable(
  'ui_profiles',
  {
    id: pk(),
    orgId: orgRef(),
    name: text('name').notNull(),
    description: text('description'),
    createdBy: uuid('created_by').references(() => users.id),
    archivedAt: ts('archived_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('ui_profiles_org_idx').on(t.orgId)],
);

export const uiProfileVersions = pgTable(
  'ui_profile_versions',
  {
    id: pk(),
    orgId: orgRef(),
    profileId: uuid('profile_id').notNull().references(() => uiProfiles.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    config: jsonb('config').$type<Record<string, unknown>>().notNull(),
    status: text('status').$type<'draft' | 'published' | 'superseded'>().notNull().default('draft'),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
    publishedBy: uuid('published_by').references(() => users.id),
    publishedAt: ts('published_at'),
  },
  (t) => [uniqueIndex('ui_profile_versions_uq').on(t.profileId, t.version), index('ui_profile_versions_status_idx').on(t.profileId, t.status)],
);

/** Assignment precedence (most specific wins): device > user > role > org. */
export const uiProfileAssignments = pgTable(
  'ui_profile_assignments',
  {
    id: pk(),
    orgId: orgRef(),
    profileId: uuid('profile_id').notNull().references(() => uiProfiles.id, { onDelete: 'cascade' }),
    scope: text('scope').$type<'org' | 'role' | 'user' | 'device'>().notNull(),
    role: roleEnum('role'),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id').references(() => devices.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('ui_assign_org_uq').on(t.orgId).where(sql`${t.scope} = 'org'`),
    uniqueIndex('ui_assign_role_uq').on(t.orgId, t.role).where(sql`${t.scope} = 'role'`),
    uniqueIndex('ui_assign_user_uq').on(t.orgId, t.userId).where(sql`${t.scope} = 'user'`),
    uniqueIndex('ui_assign_device_uq').on(t.orgId, t.deviceId).where(sql`${t.scope} = 'device'`),
  ],
);
