# QA and Test Plan

Commands: `npm test` (domain + API, PGlite), `npm run typecheck`, `npx playwright test` (needs a running dev stack), `npm run build`. **No CI pipeline yet** (see DEPLOYMENT.md §6).

## 1. Existing automated tests
### `packages/domain/test`
| File | Covers |
|---|---|
| `domain.test.ts` | Permission matrix least privilege, no role escalation, unit normalization, freshness, deadband hysteresis, on-delay, alarm lifecycle (ack ≠ resolve), inspection/maintenance state machines, step outcome/progress, device state derivation, pairing code format, deterministic scenarios |
| `auditdoc.test.ts` | Key/value → typed fields with units, table detection, dual-pass cross-check (numeric mismatch), decimal vs thousands separators, re-joined table columns, range checks incl. agreed-but-implausible values, suggested fixes |
| `uiprofile.test.ts` | Precedence device > user > role > org with fall-through, normalization (required screens), measurement filter/order, diff summary |
| `voice.test.ts` | Wake-phrase variants (`WAKE_RE`), measurand detection |

### `apps/api/test`
| File | Covers |
|---|---|
| `platform.test.ts` | Anonymous rejection; login, refresh rotation, reuse detection, logout; RLS without WHERE clauses; tenant isolation + invitation onboarding; RBAC incl. escalation attempts; gateway ingestion (normalization, idempotency, validation, alarms); alarm lifecycle; pairing → inspection on glasses → console review → revocation; expired/denied pairing; deactivated members; password reset; simulation (demo only); public inquiry spam/consent; overview/reports scoping and export |
| `realtime-db.test.ts` | DB-mode persistence and per-principal filtering, `realtime_events` invisible in tenant context, cron pruning report |
| `ui-profiles.test.ts` | Edit/read permissions, built-in default, publish versioning + SSE to devices + rollback, precedence via `/ui-profiles-effective`, assignment validation and cross-tenant isolation |
| `console-edit.test.ts` | Reading provenance, append-only corrections, cross-tenant 404s, asset/sensor archive/restore, templates/tasks/rules/documents editing with history |
| `audit-docs.test.ts` | Capture → review → verify → independent approval → PDF; self-approval only in demo; viewers cannot capture; vision vs OCR box cross-check |
| `demo-mode.test.ts` | Demo defaults, owner login, deterministic seeding, content present, cross-instance tokens, devices rebuilt from claims, lazy ticker, named guests, cross-instance pairing and audit scans, voice assistant answers for user and glasses |

### `tests/e2e/journeys.spec.ts` (Playwright)
Anonymous redirect, sign-in/overview/logout invalidation, glasses pairing by code + guided inspection + revocation, operator blocked from admin pages.

### Gaps
No tests yet for: `docdetect.ts` and `ocr.ts` (browser), `GuidedCapture`, `VoiceAssistant` UI, the Android bridge, `/assistant/ask` with the Claude engine (mock needed), maintenance actions end to end, MFA flow e2e, accessibility (axe), load.

## 2. Manual hardware matrix
| # | Device | Phone | Path | Cases |
|---|---|---|---|---|
| H1 | Ray-Ban Meta Gen 2 | Pixel 8 (Android 15/16) | Native app + DAT | Registration via Meta AI, camera permission, preview fps, guided capture auto-shot, capture button, 6-page scan, OCR quality on handwritten log, speech wake word in plant noise (≥85 dB), TTS audibility, BT reconnect after walking out of range, battery over 4 h |
| H2 | Ray-Ban Meta Gen 1 | Samsung A-series (mid-range) | Native + DAT | Same as H1, performance budget on mid-range |
| H3 | Oakley Meta HSTN/Vanguard | Pixel | Native + DAT | Camera FOV differences, inputs |
| H4 | Meta Ray-Ban Display | Pixel | DAT + (Planned) web app HUD | Display rendering, Neural Band inputs |
| H5 | none | Rugged phone (Samsung XCover / Zebra TC) | CameraX + SpeechRecognizer | Gloves, sunlight, offline round |
| H6 | none | Any | Bridge WebView (`glasses-bridge-android`) | Bridge contract parity with native |
| H7 | Browser simulator | Desktop Chrome | `/simulator` | Regression of HUD and pairing |
Environment conditions: outdoor sunlight, a dim pump house, rain (IPX4), loud blowers, no network (airplane mode) mid-round, a weak 2G/3G-class network.

## 3. Acceptance criteria per FR (selection; every FR in PRD.md has a test owner)
| FR | Acceptance criteria | Test |
|---|---|---|
| FR-001 | 5 bad passwords lock the account for 15 min; correct password then fails until expiry | API (`platform.test.ts` extend) |
| FR-003 | Replaying a rotated refresh token after 30 s revokes the family; the access token stops working on the next call | `platform.test.ts` |
| FR-008 | A query without an org filter in tenant context returns only own-org rows | `platform.test.ts` |
| FR-022 | Same (sensor, ts) twice → `duplicates:1`; unknown tag → `rejected[{reason:'unknown_sensor'}]`; breach raises an alarm after on-delay | `platform.test.ts` |
| FR-031 | Resolve from `active` is rejected; resolve without a note is rejected | domain + API |
| FR-041 | Responses queued offline replay after reconnect with no duplicates | e2e + manual H5 |
| FR-050 | Code expires at 300 s; second approval → `already_used`; poll faster than 2 s → `slow_down` | `platform.test.ts` |
| FR-052 | Revoked device gets 401 `device_revoked` on refresh, and the SSE gets `session.ended` within 30 s | API + manual |
| FR-054 | Publishing a profile updates assigned glasses live; rollback restores the previous config | `ui-profiles.test.ts` |
| FR-060 | On H1/H5, an A4 sheet at 30–60 cm auto-captures within 5 s when steady; the output is 1240×1754 | manual |
| FR-061/062 | Sample sheet: ≥ 95 % printed fields agree across passes; a dropped decimal is flagged by the range check | `auditdoc.test.ts` + manual |
| FR-064/065 | Verify blocked while items are pending or flagged; the same user cannot approve in non-demo orgs | `audit-docs.test.ts` |
| FR-066 | PDF text is selectable/searchable and contains the verification trail | `audit-docs.test.ts` + manual |
| FR-071/072 | "Hey Hydris, what's the pH at the outlet?" returns a value with a timestamp from the user's sites; an unknown question returns "can't answer", never a number | `demo-mode.test.ts` + manual H1 |
| FR-080 | DB mode: an event reaches a connected client ≤ 2 s; reconnection with Last-Event-ID loses no events | `realtime-db.test.ts` + manual |
| FR-083 | Fresh Vercel deploy without env vars → login `tarun@hydris.ai` works; demo badge visible | `demo-mode.test.ts` |
| FR-057 | Native app registers glasses; device appears in `/console/devices` with model and assignee; revoke from console signs the app out of device mode | manual H1 (**Planned**) |

## 4. Non-functional tests
- Load: k6 against `/ingest/v1/readings` (1,200 req/min/gateway) and 500 concurrent SSE clients (container mode).
- Security: OWASP ZAP baseline; tenant-fuzz (random UUIDs across orgs → 404); dependency audit; Android MobSF scan.
- Accessibility: axe on console pages; TalkBack on the Android app; text scale 1.3.

## 5. Exit criteria for pilot
All automated suites green in CI, H1 + H5 matrix passed, zero open P1/P2 defects, and a pen-test of auth, pairing and tenancy with no high findings.
