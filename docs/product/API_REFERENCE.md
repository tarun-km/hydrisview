# API Reference

Base path: `/api`. In local dev the API serves on :4000 and Next proxies to it. On Vercel it runs in-process via `apps/web/src/app/api/[...path]/route.ts`. Bodies are JSON and are validated with zod. A failed validation returns `400 {error, message, details}`.

**Auth column legend:** `public` = no token. `user` = user access JWT. `device` = paired-glasses JWT. `any` = user or device. `refresh-cookie` = `hg_refresh`. `gateway` = `Bearer hgw_…`. Permission names come from `packages/domain/src/roles.ts`. Devices are additionally capped by `DEVICE_PERMISSIONS` (`core/principal.ts`). Records outside the caller's site scope return **404**, not 403.

Rate limits are per IP and per minute unless noted (relaxed in tests).

## Health
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/health` | public | `{ok:true, time}` |

## Auth (`modules/auth.ts`)
| Method | Path | Auth / limit | Request → Response |
|---|---|---|---|
| POST | `/auth/demo` | public, 20 (demo mode only) | `{name}` → session (creates a named guest) |
| POST | `/auth/login` | public, 10 | `{email, password}` → `{accessToken, user, memberships, org, role, permissions, siteScope}` + refresh cookie, or `{mfaRequired, mfaToken}` |
| POST | `/auth/mfa/verify` | public, 10 | `{mfaToken, code}` → session |
| POST | `/auth/refresh` | refresh-cookie, 60 | → rotated session. `401 session_revoked` on reuse |
| POST | `/auth/logout` | cookie | Revokes the refresh family |
| GET | `/auth/me` | user | Session view |
| POST | `/auth/switch-org` | user | `{orgId}` → new session for that org |
| POST | `/auth/change-password` | user | `{currentPassword, newPassword}` |
| POST | `/auth/password-reset/request` | public, 5 | `{email}` → always ok. Mail goes to `mail_outbox` |
| POST | `/auth/password-reset/complete` | public, 10 | `{token, password}` |
| GET | `/auth/invitations/:token` | public, 30 | Invitation preview |
| POST | `/auth/invitations/accept` | public, 10 | `{token, name?, password}` → session |
| POST | `/auth/mfa/setup` | user | → TOTP secret / otpauth URI |
| POST | `/auth/mfa/enable` | user | `{code}` |
| POST | `/auth/mfa/disable` | user | `{password, code}` |
| GET | `/auth/sessions` | user | Active sessions |
| DELETE | `/auth/sessions/:id` | user | Revoke one session |

## Platform and organization (`modules/org.ts`)
| Method | Path | Auth / permission | Notes |
|---|---|---|---|
| GET | `/platform/organizations` | platform admin | List orgs |
| POST | `/platform/organizations` | platform admin | Create org + first admin |
| POST | `/platform/organizations/:id/status` | platform admin | `{status: active\|suspended}` |
| GET | `/org` | user | Current org |
| PATCH | `/org` | `org.manage` | `{name?, region?, timezone?}` |
| GET | `/members`, `/members/:userId` | `member.read` | Members, sites, devices |
| POST | `/invitations` | `member.manage` | `{email, name?, role, allSites, siteIds}` (no escalation) |
| DELETE | `/invitations/:id` | `member.manage` | Revoke |
| PATCH | `/members/:userId` | `member.manage` | Role, status, site scope |
| GET | `/notifications` | any | Own notifications |
| POST | `/notifications/read` | any | Mark read |
| GET | `/audit` | `audit.read` | Audit trail (filters) |

## Plant (`modules/plant.ts`)
| Method | Path | Permission |
|---|---|---|
| GET | `/sites`, `/sites/:id` | site scope |
| POST | `/sites` · PATCH `/sites/:id` · POST `/sites/:id/archive` | `site.manage` |
| POST | `/facilities` · PATCH `/facilities/:id` | `site.manage` |
| POST | `/process-areas` · PATCH `/process-areas/:id` | `site.manage` |
| GET | `/assets`, `/assets/:id` | site scope (`asset.read`) |
| POST | `/assets` · PATCH `/assets/:id` | `asset.manage` (PATCH also archive/restore) |
| DELETE | `/assets/:id` | `asset.manage` |
| GET | `/sensors` | site scope |
| GET | `/sensors/:id` | `telemetry.read` |
| POST | `/sensors` · PATCH `/sensors/:id` | `sensor.manage` |
| POST | `/gateways` | `gateway.manage` → returns the plaintext `hgw_` key once |
| POST | `/gateways/:id/revoke` | `gateway.manage` |
| GET | `/documents`, `/documents/:id` | `document.read` |
| POST | `/documents` · PATCH `/documents/:id` | `document.manage` |
| POST | `/attachments` | any (multipart, owner checked) |
| GET | `/attachments/:id` | any (authorized stream, no public URLs) |
| GET | `/history/:entityType/:entityId` | scoped |
| GET | `/hierarchy` | scoped tree site → facility → area → asset |

## Telemetry (`modules/telemetry.ts`)
| Method | Path | Auth / permission | Request → Response |
|---|---|---|---|
| POST | `/ingest/v1/readings` | gateway, 1200/min | `{readings:[{sensor, ts (ISO+offset), value, unit?, quality?, messageId?}] ≤500}` → `{accepted, duplicates, alarmsRaised, rejected:[{index, reason}]}` |
| POST | `/telemetry/manual` | user (manual/lab entry) | Reading with source manual/lab |
| GET | `/telemetry/sensors/:id/history` | `telemetry.read` | Bucketed series |
| GET | `/telemetry/sensors/:id/export.csv` | `report.export` | CSV |
| GET | `/telemetry/sensors/:id/readings` | `telemetry.read` | Raw readings with provenance and corrections |
| POST | `/telemetry/readings/:readingId/corrections` | `sensor.manage` | `{action: correct\|invalidate, correctedValue?, reason}` (append-only) |

## Alarms (`modules/alarms.ts`)
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/alarms` | `alarm.read` | Filters: state, severity, site, … |
| GET | `/alarms/:id` | `alarm.read` | With history |
| POST | `/alarms/:id/:action` | per `ALARM_TRANSITIONS` | action ∈ acknowledge, investigate, resolve (note required), close |
| POST | `/alarms/:id/assign` | `alarm.assign` | `{userId\|null, note?}` |
| POST | `/alarms/:id/notes` | `alarm.acknowledge` | `{note}` |
| GET | `/alarm-rules` | `alarm.read` | `?sensorId&siteId` |
| POST / PATCH / DELETE | `/alarm-rules`, `/alarm-rules/:id` | `alarm_rule.manage` | |

## Inspections (`modules/inspections.ts`)
| Method | Path | Permission |
|---|---|---|
| GET | `/inspection-templates`, `/inspection-templates/:id` | `inspection.read` |
| POST / PUT | `/inspection-templates`, `/inspection-templates/:id` | `inspection.manage` (PUT creates a new version) |
| POST | `/inspection-templates/:id/status` | `inspection.manage` `{status: draft\|published\|archived}` |
| GET / POST / PUT | `/inspection-routes`, `/inspection-routes/:id` | read / `inspection.manage` |
| POST | `/inspection-routes/:id/dispatch` | `inspection.manage` `{assignedTo, dueAt?, fallbackTemplateId}` |
| GET | `/inspections`, `/inspections/:id` | `inspection.read` (operators see their own) |
| POST | `/inspections` | `inspection.manage` |
| PATCH | `/inspections/:id` | `inspection.manage` `{assignedTo?, dueAt?, priority?}` |
| POST | `/inspections/:id/responses` | `inspection.execute`. Batch of `{clientOpId, stepId, value, note?, recordedAt}`, idempotent |
| POST | `/inspections/:id/:action` | start/pause/submit → `inspection.execute`. approve/reject → `inspection.review`. cancel → `inspection.manage` |

## Maintenance (`modules/maintenance.ts`)
| Method | Path | Permission |
|---|---|---|
| GET | `/maintenance`, `/maintenance/:id` | `maintenance.read` |
| POST | `/maintenance` | `maintenance.request` |
| PATCH | `/maintenance/:id` | `maintenance.manage` |
| POST | `/maintenance/:id/checklist/:itemId` | executor/manager `{done}` |
| POST | `/maintenance/:id/notes` | `maintenance.read` `{note}` |
| POST | `/maintenance/:id/:action` | start, hold, complete, cancel, reopen (`MAINTENANCE_TRANSITIONS`). Execute vs manage checked per action |

## Devices and pairing (`modules/devices.ts`)
| Method | Path | Auth / limit | Request → Response |
|---|---|---|---|
| POST | `/pairing/challenges` | public, 10 | `{hardwareId (16–80 [A-Za-z0-9_-]), device:{kind, model?, name?, appVersion?, firmwareVersion?, display?}}` → `201 {challengeId, userCode, pollSecret, expiresAt, pollIntervalS, verificationUri, verificationUriComplete}` |
| POST | `/pairing/challenges/:id/poll` | public, 40 | `{pollSecret}` → `pending\|slow_down\|expired\|denied\|cancelled\|completed{device, accessToken, refreshToken}` |
| POST | `/pairing/challenges/:id/cancel` | public, 20 | `{pollSecret}` |
| GET | `/pairing/lookup?code=` | user `device.pair`, 10 | Device info, sites, assignees, existing device |
| POST | `/pairing/approve` | user `device.pair`, 10 | `{code, siteId, assigneeUserId?, deviceName?}`. Assigning others needs `device.manage` |
| POST | `/pairing/deny` | user `device.pair` | `{code}` |
| POST | `/device/refresh` | public, 30 | `{refreshToken: hgd_…}` → `{accessToken, refreshToken}`. Errors: `device_revoked`, `device_suspended`, `device_unassigned`, `device_session_invalid/expired` |
| POST | `/device/logout` | device | 204 |
| GET | `/device/context` | device | Operator, site, work, alarms, measurements, effective UI profile |
| GET | `/devices`, `/devices/:id` | `device.read` | |
| PATCH | `/devices/:id` | `device.manage` | Name, site |
| POST | `/devices/:id/assign` | `device.manage` | Reassign operator (bumps session) |
| POST | `/devices/:id/suspend` \| `reactivate` \| `revoke` | `device.manage` | `{reason?}` |

## UI profiles (`modules/ui-profiles.ts`)
Read: user with role `org_admin` or `factory_manager`. Edit: `org_admin` only.

| Method | Path | Notes |
|---|---|---|
| GET / POST | `/ui-profiles` | Create `{name, description?, copyFromProfileId?}` |
| GET / PATCH | `/ui-profiles/:id` | |
| POST | `/ui-profiles/:id/archive` | |
| PUT / DELETE | `/ui-profiles/:id/draft` | `{config: UiProfileConfig, notes?}` |
| POST | `/ui-profiles/:id/publish` | New version. SSE `device.profile_changed` to affected devices |
| POST | `/ui-profiles/:id/rollback` | `{versionId, notes?}` |
| GET / POST | `/ui-profile-assignments` | `{profileId, scope: org\|role\|user\|device, role?, userId?, deviceId?}` |
| DELETE | `/ui-profile-assignments/:id` | |
| GET | `/ui-profiles-effective?deviceId&userId` | Resolved profile (device > user > role > org) |

## Audit documents (`modules/audit-docs.ts`)
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/audit-docs/capabilities` | any | `{vision, visionEngine, maxPages: 6, maxPageBytes: 921600}` |
| GET | `/audit-docs` · `/audit-docs/:id` | `auditdoc.read` | |
| GET | `/audit-docs/:id/pages/:pageNo` | `auditdoc.read` | Image |
| GET | `/audit-docs/:id/pdf` | `auditdoc.read` | Searchable PDF |
| POST | `/audit-docs` | `auditdoc.capture`, body ≤ 8 MB | `{title?, siteId?, assetId?, pages:[{mime, data(base64), width, height, readings[1..3], figures}]}` |
| POST | `/audit-docs/:id/enhance` | `auditdoc.capture` | Runs the vision engine |
| PATCH | `/audit-docs/:id/items/:itemId` | reviewer | Confirm / correct / flag a field or cell |
| POST | `/audit-docs/:id/confirm-agreed` | reviewer | Bulk-confirm machine-agreed values |
| POST | `/audit-docs/:id/verify` | `auditdoc.verify`, **user only** | Requires 0 pending, 0 flagged |
| POST | `/audit-docs/:id/approve` | `auditdoc.approve`, **user only** | `{decision: approve\|reject, note}`. Approver ≠ verifier (except demo tenants) |
| PATCH | `/audit-docs/:id` | capture/verify | Title, type, site, asset |

## Insights, assist, search, reports (`modules/insights.ts`)
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/overview` | scoped | KPI dashboard |
| GET | `/reports/:kind` | `report.read` (CSV: `report.export`) | kind ∈ inspections, alarms, maintenance, devices, operators. `?from&to&format=json\|csv` (default range 30 d) |
| GET | `/assist?q&assetId` | `document.read` | Ranked approved SOP passages, live telemetry of the asset, glossary, safety notice |
| GET | `/search?q` | scoped | Command palette |

## Voice assistant (`modules/voice-assistant.ts`)
| Method | Path | Auth / limit | Request → Response |
|---|---|---|---|
| POST | `/assistant/ask` | any, 60/min | `{text ≤500, history?: [{role, text}] ≤8}` → `{answer, facts:[{label, value, unit?, at?, source?, ref?}], intent?, engine: 'claude-opus-5-5'\|'hydris-rules'}` |

## Realtime (`modules/realtime.ts`, `apps/web/src/app/api/events/stream/route.ts`)
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/events/stream` | any (Bearer header) | SSE. `Last-Event-ID` replay. `ready`, domain events, `session.ended`, heartbeats |

## Simulation (`modules/simulation.ts`), demo tenants only
| Method | Path | Permission |
|---|---|---|
| GET | `/simulation` | scoped |
| POST | `/simulation/start` · `/simulation/stop` | `simulation.control` |

## Public and cron
| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/public/inquiries` | public, 5 / 10 min | Contact/demo form with consent |
| GET | `/api/cron` | `Authorization: Bearer CRON_SECRET` | Runs `runScheduledJobs` (Next route) |

## Error codes (selection)
`unauthorized`, `forbidden`, `not_found`, `invalid_code`, `already_used`, `device_owned_elsewhere`, `pairing_unavailable`, `device_revoked`, `device_suspended`, `device_unassigned`, `session_revoked`, `no_session`, `invalid_gateway_key`, `not_in_review`, `flagged_items`, `review_incomplete`, `not_verified`, `reason_required`, `stale` (optimistic lock), `realtime_misconfigured`.
