# Product Requirements: Hydris Field Glasses

Owner: Hydris AI product · Version 1.0 (2026-10-22) · Status labels: **Built** (on `main`), **Partial**, **Planned**

## 1. Vision
Every operator in a water or wastewater plant gets the live state of the plant, the next task and the right procedure in their line of sight, hands free. Every reading, check and paper record they touch becomes a trustworthy digital record.

## 2. Problem
- Rounds in ETPs, STPs and CETPs are still done on paper. Readings are written on clipboards, typed in later, and they drift from the instrument values.
- Alarms reach a control room, not the person standing next to the pump. Acknowledgement and resolution get conflated.
- Regulators expect continuous discharge monitoring and retrievable records. India's CPCB requires online continuous effluent monitoring (OCEMS) for 17 categories of highly polluting industries and CETPs ([CPCB OCEMS guidelines](https://cpcb.nic.in/online-monitoring/)). Audit evidence often lives in paper logbooks that nobody can search.
- Phones are impractical with gloves on, at a ladder or a sampling point. Glasses free the hands, but there is no industrial software for them.

## 3. Personas

| Persona | Role in code (`packages/domain/src/roles.ts`) | Primary surface | Key needs |
|---|---|---|---|
| Field operator | `field_operator` | Glasses + mobile app | Next task, live values, acknowledge alarms, record readings, scan paper logs, ask questions out loud |
| Supervisor | `supervisor` | Console + mobile | Dispatch rounds, review inspections, triage alarms, verify scanned documents |
| Maintenance engineer | `maintenance_engineer` | Mobile + glasses | Work orders, checklists, investigate and resolve alarms, SOPs at the asset |
| Plant / factory manager | `factory_manager` | Console | KPIs, reports, rules, approval of audit documents, devices, members |
| Org admin | `org_admin` | Console | Members, invitations, sites, UI profiles, all permissions |
| Platform admin | `users.is_platform_admin` | Console `/console/platform` | Create and suspend organizations (`/platform/organizations`) |
| Auditor / regulator | `viewer` (read-only + `report.read`) | Console, PDF exports | Tamper-evident trail, approved documents, exports |

## 4. Jobs to be done
1. *When I start my round,* I want my assigned inspections in order, so I don't miss an asset.
2. *When I stand at an asset,* I want its live readings and freshness, so I can trust what I record.
3. *When an alarm fires near me,* I want to acknowledge it and see the recommended action and SOP, so the right person is accountable.
4. *When I fill a paper log or receive a lab sheet,* I want to capture it once and have it verified, so the record is searchable and defensible.
5. *When I need information but my hands are busy,* I want to ask by voice and get a short spoken answer grounded in our data.
6. *As a manager,* I want to control what each role sees on glasses without redeploying an app.
7. *As an admin,* I want to pair, reassign, suspend or revoke a pair of glasses in seconds.

## 5. Scope by surface

| Surface | In scope | Out of scope |
|---|---|---|
| Website | Marketing pages, live glasses demo (`/glasses?demo=1`), contact/demo form (`POST /public/inquiries`) | Self-serve signup |
| Console | Full administration and operations (all modules) | Equipment control |
| Glasses HUD (web) | Home, alerts, inspections, tasks, map, measurements, assets, SOPs, AI, scan, notifications, status (`UI_SCREENS`) | Native display rendering on Meta Ray-Ban Display (Planned) |
| Mobile app (Android native) | Login, dashboard, alarms, inspections, maintenance, live charts, audit scan, voice, glasses connection and registration, realtime (**Planned / in progress**) | iOS (Planned later) |
| Companion bridge | WebView + DAT camera/speech/inputs bridge (`apps/glasses-bridge-android`) (**Partial**, not hardware-verified) | Superseded by native app at GA |

## 6. Functional requirements

### Identity and tenancy
| ID | Requirement | Status | Evidence |
|---|---|---|---|
| FR-001 | Email and password login with lockout after 5 failures for 15 min | Built | `modules/auth.ts`, `TTL` in `config.ts` |
| FR-002 | TOTP MFA (setup, enable, disable, verify step-up) with secret encrypted by `DATA_KEY` | Built | `/auth/mfa/*` |
| FR-003 | Refresh-token rotation with family revocation on reuse (30 s multi-tab grace) | Built | `/auth/refresh` |
| FR-004 | Invitations (7-day token) and role assignment without escalation (`assignableRoles`) | Built | `/invitations`, `/auth/invitations/accept` |
| FR-005 | Password reset (30-min single-use token) | Built. **Email transport not wired** (`mail_outbox`) | `/auth/password-reset/*` |
| FR-006 | Multi-org membership and org switch | Built | `/auth/switch-org` |
| FR-007 | Site-scoped permissions for non-admin roles | Built | `membership_sites`, `siteScope()` |
| FR-008 | DB-enforced tenant isolation (RLS) | Built | `drizzle/0001_rls.sql` |
| FR-009 | Session listing and revocation | Built | `/auth/sessions` |
| FR-010 | Platform organization management | Built | `/platform/organizations` |

### Plant model and telemetry
| ID | Requirement | Status |
|---|---|---|
| FR-020 | Site → facility → process area → asset hierarchy, map positions, archive/restore | Built |
| FR-021 | Sensors for 16 measurands with unit normalization (`measurands.ts`) | Built |
| FR-022 | HTTPS gateway ingestion `POST /ingest/v1/readings` (API key `hgw_…`, ≤500 readings, idempotent on sensor+ts) | Built |
| FR-023 | Manual and lab entry with provenance | Built |
| FR-024 | Append-only telemetry corrections (correct/invalidate) | Built |
| FR-025 | History, raw readings, CSV export | Built |
| FR-026 | Freshness states live/delayed/stale/no_data; missing data never shown as a value | Built |
| FR-027 | MQTT / OPC UA ingestion adapters | **Planned** (enum exists: `gateways.protocol`) |
| FR-028 | Read-only SCADA/historian connectors | **Planned** |

### Alarms
| ID | Requirement | Status |
|---|---|---|
| FR-030 | Threshold rules: high_high/high/low/low_low/stale, deadband, on-delay | Built |
| FR-031 | Lifecycle active → acknowledged → investigating → resolved → closed. An alarm cannot be resolved straight from `active`, and a resolution note is required | Built |
| FR-032 | Assignment, notes, history, recommended action and linked SOP | Built |
| FR-033 | Realtime push to console, glasses and mobile | Built (SSE). Mobile **Planned** |
| FR-034 | Push notifications (FCM) to phones | **Planned** |

### Inspections and maintenance
| ID | Requirement | Status |
|---|---|---|
| FR-040 | Versioned templates (check/reading/choice/text/photo steps) and routes with dispatch | Built |
| FR-041 | Execution on glasses with offline queue and idempotent replay (`client_op_id`) | Built |
| FR-042 | Submit → review → approve/reject | Built |
| FR-043 | Maintenance tasks with checklist, activity, and alarm/inspection follow-ups | Built |

### Devices and glasses
| ID | Requirement | Status |
|---|---|---|
| FR-050 | Device pairing: 8-char code, QR, 5-min TTL, 3 s polling, approve with site and assignee | Built |
| FR-051 | Device tokens (15-min access, 30-day rotating refresh `hgd_…`, session version) | Built |
| FR-052 | Suspend, reactivate, revoke, reassign; revocation effective on next request / SSE revalidation (≤30 s) | Built |
| FR-053 | Device permission ceiling (`DEVICE_PERMISSIONS`) | Built |
| FR-054 | UI profiles: draft/publish/rollback, precedence device > user > role > org, live push | Built |
| FR-055 | Ray-Ban Meta camera via DAT bridge | Partial (not hardware-verified) |
| FR-056 | Glasses capture button starts/takes a scan | Partial |
| FR-057 | Native mobile app registers glasses as a Hydris device using the pairing endpoints | **Planned** |

### Audit document scanning
| ID | Requirement | Status |
|---|---|---|
| FR-060 | Guided A4 capture with live page detection, auto-capture and perspective correction (`docdetect.ts`) | Built (web) |
| FR-061 | Dual-pass on-device OCR (`ocr:original`, `ocr:enhanced`) | Built (Tesseract.js) |
| FR-062 | Structuring into typed fields, tables, figures, plus plausibility checks | Built (`auditdoc.ts`) |
| FR-063 | Optional vision engine (Claude) cross-checked against OCR inside each box | Built (needs `ANTHROPIC_API_KEY`) |
| FR-064 | Field review: confirm/correct/flag, original value kept; verify requires zero pending/flagged | Built |
| FR-065 | Independent approval (four-eyes; self-approval only in demo tenants, recorded) | Built |
| FR-066 | PDF with verification trail, searchable original, reconstructed page | Built |
| FR-067 | Up to 6 pages, ≤900 KB/page | Built (limits) |
| FR-068 | Electronic signature with re-authentication and signature meaning (Part 11-style) | **Planned** |

### Assistance and voice
| ID | Requirement | Status |
|---|---|---|
| FR-070 | Grounded SOP retrieval with safety notice | Built (`/assist`) |
| FR-071 | "Hey Hydris" wake phrase (`WAKE_RE`) and spoken short answers | Built (web) |
| FR-072 | `/assistant/ask` answers only from tenant data via scoped tools; rules fallback that never guesses | Built |
| FR-073 | Multi-language voice (Hindi, Tamil, …) | **Planned** |

### Platform
| ID | Requirement | Status |
|---|---|---|
| FR-080 | Realtime SSE with Last-Event-ID replay; memory or DB mode | Built |
| FR-081 | Reports (inspections, alarms, maintenance, devices, operators) in JSON/CSV | Built |
| FR-082 | Append-only audit trail | Built |
| FR-083 | Demo mode: zero-config synthetic tenant, named guests, cross-instance pairing | Built |
| FR-084 | Deterministic simulation scenarios (demo tenants only) | Built |
| FR-085 | Notifications in-app | Built |
| FR-086 | Email delivery (SMTP/SES) | **Planned** |

## 7. Non-functional requirements

| Area | Requirement |
|---|---|
| Latency | API p95 < 300 ms for reads in-region. Realtime alarm delivery ≤ 2 s (memory mode is near instant; DB mode polls every 1.5 s). Voice answer ≤ 3 s rules engine, ≤ 8 s LLM engine. OCR ≤ 15 s/page on a mid-range phone |
| Offline | Inspection responses queue locally and replay idempotently. Last context and read SOPs are cached (`glasses/data.ts`). Mobile app: Room-backed outbox (**Planned**) |
| Security | RLS, RBAC, short-lived JWTs, hashed tokens, rate limits, append-only audit (see SECURITY_PRIVACY.md) |
| Privacy | Camera only on explicit intent (button, voice or tap). No continuous recording. Images stored only for audit docs and attachments |
| Accessibility | Glasses text scales 0.9–1.3 (`UI_TEXT_SCALES`). WCAG 2.2 AA on console and mobile. Voice as an alternative input |
| Battery | Camera streaming only while the scan screen is open. Preview at ~8 fps. Speech session restarted only while the assistant is enabled. Target: a 4-h shift on Ray-Ban Meta Gen 2 with ≤ 20 scans |
| Availability | 99.5 % pilot, 99.9 % GA |
| Data | Telemetry provenance (source, synthetic flag enforced by DB check constraint) |

## 8. Success metrics (KPIs)
- Round completion on time ≥ 95 %. Median time per inspection down 30 % vs paper.
- Median alarm acknowledgement time < 5 min. Acknowledged-but-unresolved backlog visible.
- Audit scans: ≥ 90 % of fields machine-agreed. Reviewer edits < 5 % of fields. Approval cycle < 24 h.
- Voice: ≥ 85 % of questions answered with facts (not "can't answer"). Zero hallucinated numbers (every number in `facts`).
- Weekly active operators / licensed operators ≥ 70 %.
- Security: zero cross-tenant data incidents. Device revocation effective ≤ 30 s.

## 9. Release plan
| Phase | Content |
|---|---|
| MVP (done) | API, console, web glasses HUD and simulator, pairing, demo mode, audit scan, voice |
| Pilot (Q4 2026 – Q1 2027) | Native Android app, DAT hardware validation on Ray-Ban Meta Gen 2, email transport, CI, 1–2 Indian plants |
| GA (Q2 2027) | Play/MDM distribution after Meta publishing opens, FCM push, Room offline, SOC 2 Type I readiness |
| Advanced (H2 2027+) | MQTT/OPC UA ingestion, AI vision anomaly detection, digital-twin map, multi-language voice, native Meta Ray-Ban Display HUD, predictive maintenance, LIMS integration, read-only SCADA, e-signature compliance |

See [ROADMAP.md](ROADMAP.md).

## 10. Risks and mitigations
| Risk | Impact | Mitigation |
|---|---|---|
| Meta DAT publishing gated: public distribution of DAT apps was limited to select partners during preview, and 1.0 submissions are "soon" ([FAQ](https://developers.meta.com/wearables/faq)) | Cannot ship glasses features via Play at scale | Pilot via Developer Center release channels and Developer Mode. Phone-camera path works without DAT. Apply early |
| Dependency on the Meta AI app (pairing, registration, permissions, firmware) | Support burden, version drift | Onboarding checklist, version check screen, document as a prerequisite |
| Bridge not tested on hardware | Scan and voice may fail on device | Hardware test matrix (QA_TEST_PLAN.md) before pilot |
| Device refresh token in WebView `localStorage` | Token theft on a rooted device | Native app keeps it in Keystore-backed storage |
| Email not wired | Invites and resets don't reach users | Wire SES/Resend before pilot |
| LLM/vision availability and cost | Degraded answers | Deterministic rules fallback already implemented |
| Regulatory e-records expectations | Pilot rejection | Planned e-signature (FR-068), audit trail already append-only |
| Glasses availability in India / supported countries for DAT | Rollout blocked | Confirm country list with Meta; phone-only mode |

## 11. Open questions
1. Is India among Meta's "AI glasses supported countries" for full DAT capabilities (Developer Center access)? It needs written confirmation from Meta.
2. When do DAT 1.0 store submissions open, and what review does an enterprise (unlisted) app need?
3. Will customers accept glasses cameras inside plants (security zones, bystander policy)?
4. Which regulators accept a Hydris-generated PDF as the primary record versus a scanned copy?
5. Is a separate iOS app needed for pilot customers?
6. LLM data residency: is Claude via a region-pinned provider required for Indian customers?
