# Hydris Field Glasses: Product Documentation Suite

> Status: written 2026-10-22 against `main` @ `3ac2d1d`. The repo's code is the source of truth. Anything marked **Planned** is not in the repository yet.

## Index

| # | Document | What it covers |
|---|---|---|
| 1 | [PRD.md](PRD.md) | Vision, personas, jobs-to-be-done, functional requirements (FR-xxx), non-functional requirements, KPIs, release plan, risks |
| 2 | [ARCHITECTURE.md](ARCHITECTURE.md) | System context and container diagrams, data flows (telemetry, alarms, pairing, audit scan, voice, SSE), tenancy/RLS, the token model, topologies |
| 3 | [DATA_MODEL.md](DATA_MODEL.md) | Every table and enum in `apps/api/src/db/schema.ts`, ER diagram, RLS policies, retention |
| 4 | [API_REFERENCE.md](API_REFERENCE.md) | Every HTTP endpoint grouped by module, with auth, permission and request/response shape |
| 5 | [MOBILE_APP_SPEC.md](MOBILE_APP_SPEC.md) | The native Android app **Hydris Field** (`apps/android`, in progress): screens, design tokens, DAT integration, offline mode, security, testing |
| 6 | [GLASSES_INTEGRATION.md](GLASSES_INTEGRATION.md) | Capability matrix per device, the web↔native bridge contract, DAT setup, limits, and the Meta AI app dependency |
| 7 | [DEPLOYMENT.md](DEPLOYMENT.md) | Vercel, container, Android distribution, environments, env vars, CI/CD, observability, cost, India data residency |
| 8 | [SECURITY_PRIVACY.md](SECURITY_PRIVACY.md) | STRIDE threat model, controls in code, data classification, bystander privacy, retention, incident response |
| 9 | [QA_TEST_PLAN.md](QA_TEST_PLAN.md) | Existing automated tests, hardware test matrix, acceptance criteria per FR |
| 10 | [ROADMAP.md](ROADMAP.md) | Phased, quarter-level plan with milestones and dependencies |

## Product overview (one page)

**Hydris Field Glasses** is a hands-free operations platform for wastewater and industrial water plants: ETPs, STPs, WTPs and CETPs. Operators walking a plant see live measurements, alarms, inspection steps and SOPs on smart glasses or on their phone. They can ask questions out loud ("Hey Hydris, what's the outlet pH?") and scan paper audit records into verified, searchable PDFs. Supervisors and managers run the same data from a secure web console.

**Surfaces**

| Surface | Where | Status |
|---|---|---|
| Public website | `apps/web/src/app/(site)` (`/`, `/product`, `/technology`, `/operations`, `/demo`, `/contact`, `/privacy`) | Built |
| Operator console | `apps/web/src/app/console/**` (overview, sites, assets, telemetry, alarms, inspections, maintenance, documents, audit docs, devices, glasses profiles, operators, reports, audit, settings, platform) | Built |
| Glasses HUD web app and phone layout | `apps/web/src/app/glasses`, `apps/web/src/glasses/*` (`/glasses`, `/simulator`, `/pair`) | Built. Phone layout added in `3ac2d1d` |
| Android WebView companion (DAT bridge) | `apps/glasses-bridge-android` (DAT 1.0.1) | Compiles. **Not yet run on physical glasses** |
| Native Android app "Hydris Field" | `apps/android` (Kotlin, Compose) | **In progress / Planned.** The directory does not exist on `main` yet |
| API | `apps/api` (Fastify modular monolith, Drizzle, Postgres with RLS, SSE) | Built |

**Core capabilities (built):** multi-tenant organizations with six roles and 38 permissions (`packages/domain/src/roles.ts`), MFA, invitations, password reset and session revocation, site, facility, process-area and asset hierarchy, sensors and HTTPS gateway ingestion, alarm rules with deadband and on-delay plus the five-state alarm lifecycle, inspection templates, routes and execution with offline-idempotent sync from glasses, maintenance work orders, grounded SOP retrieval (`/assist`), glasses pairing (an RFC 8628-style device flow), remotely managed glasses UI profiles, realtime SSE, reports and CSV export, an append-only audit trail, audit-document scanning (dual-pass on-device OCR, optional Claude vision, four-eyes verification, searchable PDF), the "Hey Hydris" voice assistant (`/assistant/ask`), and a zero-config demo mode.

**Design principle: read-only for the plant.** Hydris never writes to PLCs, SCADA or equipment. The `/assist` response states it outright: "Hydris does not control equipment."

**The Meta AI app dependency.** Ray-Ban and Oakley Meta glasses reach third-party apps only through Meta's Wearables Device Access Toolkit (DAT). Glasses are paired to the phone in the **Meta AI app**. App registration and the camera permission grant also go through the Meta AI app, which keeps the glasses firmware current. So the Hydris Android app **cannot fully replace the Meta AI app**. Operators use Hydris day to day, and the Meta AI app has to stay installed in the background. Details and sources are in [GLASSES_INTEGRATION.md](GLASSES_INTEGRATION.md#meta-ai-app-dependency).
