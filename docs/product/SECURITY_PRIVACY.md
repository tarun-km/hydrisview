# Security and Privacy

## 1. Scope and principles
- **Read-only to the plant.** No endpoint writes to PLC, SCADA or DCS. Hydris records, alerts and guides. `/assist` responses carry the notice "Hydris does not control equipment." This rules out safety-instrumented-function interference and keeps Hydris outside IEC 62443 control zones (ingestion is outbound HTTPS from the gateway only).
- Defence in depth: RBAC in the API, site scoping, and Postgres RLS at the database boundary.

## 2. Data classification
| Class | Examples | Storage | Handling |
|---|---|---|---|
| Restricted | Password hashes, MFA secrets (AES with `DATA_KEY`), refresh / device / gateway tokens (sha256 only), invitation and reset tokens (hashed) | Postgres | Never logged. Raw tokens shown once |
| Confidential, regulated | Discharge and telemetry data, alarm history, inspection records, audit document images and extractions | Postgres, Blob | Tenant RLS. Append-only trails |
| Confidential, personal (PII) | User names and emails, IPs (`auth_sessions`, `audit_events`), device last IP, voice transcripts (`/assistant/ask` request text; not persisted server-side), inquiries (IP stored as hash) | Postgres | DPDP/GDPR rights. Minimize |
| Sensitive imagery | Camera images of documents that may contain signatures, names and bystanders | `audit_document_pages`, `attachments` | Captured only on intent. Access via authorized routes. Never public URLs |
| Third-party processing | Page images and questions sent to Anthropic when `ANTHROPIC_API_KEY` is set | Anthropic API | Disclose in the DPA. Per-org opt-out (**Planned**) |

## 3. STRIDE threat model
| Threat | Example | Controls in code | Gaps / Planned |
|---|---|---|---|
| **S**poofing | Stolen password; replayed refresh token; fake glasses | argon2id password hashing (`core/crypto.ts`), lockout 5/15 min, TOTP MFA, refresh rotation with family revocation on reuse (`/auth/refresh`), device flow with poll secret and single-use code, gateway keys hashed | SSO/SAML (**Planned**). Device attestation (Play Integrity) for the native app |
| **T**ampering | Edit telemetry or audit values after the fact | Append-only `audit_events`, `telemetry_corrections`, `audit_document_events` (DB grants). Corrections keep the original. Optimistic `revision` locks. DB check that synthetic ⇔ simulator | Hash-chaining or WORM export of audit logs |
| **R**epudiation | "I didn't approve that" | Every state change audited with actor user/device and IP. Verifier ≠ approver (four-eyes) | Part 11-style e-signature: re-auth + meaning + manifestation (**Planned**) |
| **I**nformation disclosure | Cross-tenant leak; enumeration | RLS FORCE on all tenant tables, `hydris_app` without BYPASSRLS, out-of-scope → 404, SSE bearer in header (not URL), private Blob, rate limits on pairing lookup | Field-level encryption of document images |
| **D**enial of service | Pairing / login brute force; large uploads | `@fastify/rate-limit` per route, body limits (audit 8 MB, ≤6 pages, ≤900 KB/page), ingestion ≤500 readings | WAF / Vercel Firewall rules |
| **E**levation of privilege | Supervisor invites an org admin; device calls admin API | `assignableRoles` never escalates. `DEVICE_PERMISSIONS` ceiling. Verify/approve and UI profile edits require a user principal | |

## 4. Specific controls
- **Sessions:** 15-min access JWT. The refresh-family check on every request means logout takes effect immediately. SSE revalidates every 30 s.
- **Devices:** suspend, revoke or reassign bumps `session_version`, which invalidates outstanding tokens. A revoked device cannot refresh. Glasses owned by another org cannot be re-paired until revoked there.
- **Demo mode:** public secrets and synthetic data only, flagged `is_demo`. A warning is logged. It must never host real plant data.
- **Web glasses runtime:** the device refresh token lives in `localStorage` (`glasses/link.ts`, `SecureStore` adapter). The native app must use Keystore.
- **Email:** not wired yet. Reset and invite links sit in `mail_outbox` (sensitive; purge after send).

## 5. Bystander and worker privacy (smart-glasses camera)
- Capture happens only on explicit intent: the scan screen, the capture button, or a tap. There is no background or continuous recording, and no video is stored.
- The preview stream exists only while the scan screen is open. Frames stay on the phone; only the final page photo is uploaded.
- Meta glasses show a capture LED that cannot be disabled by apps (vendor firmware).
- Guided capture warps the photo to the page quad, which discards most of the background.
- Voice: the wake phrase is matched on the transcript locally. Only the question text after "Hey Hydris" is sent to the API. Audio is never uploaded.
- Site policy pack: signage, camera-free zones (configurable per site, **Planned**), and works-council or union consultation where required.

## 6. Compliance mapping
| Framework | Relevance | Status |
|---|---|---|
| CPCB OCEMS / State PCB consent conditions (India) | Continuous monitoring records, retrievability | Provenance, freshness, no silent edits. Data export (`/reports`, CSV) |
| US EPA NPDES DMR (if US customers) | Discharge monitoring report records retained ≥ 3 years ([40 CFR 122.41(j)](https://www.ecfr.gov/current/title-40/chapter-I/subchapter-D/part-122/subpart-C/section-122.41)) | Retention policy (**Planned** config) |
| 21 CFR Part 11 concepts ([eCFR Part 11](https://www.ecfr.gov/current/title-21/chapter-I/subchapter-A/part-11)) | Audit trails, record integrity, e-signatures | Audit trail + four-eyes built. E-signature manifestation and re-auth **Planned**. Hydris is not validated for FDA-regulated GxP use |
| ISO/IEC 27001:2022 / SOC 2 | Customer due diligence | Controls largely in code. ISMS, policies and audits **Planned** (SOC 2 Type I target at GA) |
| GDPR | EU users | Lawful basis (contract/legitimate interest), DPA, subprocessors (Vercel, Neon, Anthropic, Meta for glasses connectivity), rights handling |
| India DPDP Act 2023 + DPDP Rules 2025 | Hydris is India-based; Indian users | Notice and consent for website inquiries (`consent_version`). Data principal rights. Breach notification to the Data Protection Board and affected principals |

## 7. Retention
See [DATA_MODEL.md §5](DATA_MODEL.md#5-retention-current-vs-recommended). Principle: operational records follow the customer's regulatory retention period. Personal data that is not part of a record (sessions, inquiries, mail) is purged on short timers.

## 8. Incident response
1. **Detect:** alerts on `auth.refresh_reuse_detected`, `device.refresh_reuse_detected`, login failure spikes, and 5xx rates.
2. **Triage** (≤1 h): severity, affected tenants (`audit_events`).
3. **Contain:** revoke sessions (`/auth/sessions`), revoke devices or gateways, rotate `JWT_SECRET` (logs out everyone), suspend the org (`/platform/organizations/:id/status`).
4. **Eradicate and recover:** patch, restore from PITR if needed.
5. **Notify:** customers within 24 h. The DPDP Board and data principals per the DPDP Rules. GDPR supervisory authority within 72 h. CERT-In within 6 h for reportable incidents (CERT-In Directions, April 2022).
6. **Post-mortem** within 5 business days.
