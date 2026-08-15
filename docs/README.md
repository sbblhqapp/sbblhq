<!-- Version: v2.8.0 | Date: 2026-08-15 | Status: Current -->
# SBBL HQ — Documentation Hub

**Version:** v2.8.0
**Last Updated:** 2026-08-15
**Maintainer:** APEX Business Systems Ltd. — Engineering Lead

> Single source of truth for all SBBL HQ engineering, operational, and product documentation.
> All documents follow semantic versioning (`vMAJOR.MINOR.PATCH`) with UTC date stamps.

---

## Directory Structure

```
docs/
├── README.md                        ← This file — master index
├── architecture/                    ← System design, codebase map, data pipeline, store contracts
├── security/                        ← RLS, auth model, content policies
├── operations/                      ← Runbooks, external bindings, monitoring
├── deployment/                      ← Deploy procedures per platform
├── features/                        ← Feature-level technical specs
├── quality/                         ← Audits, gate reports, workflow reviews
├── onboarding/                      ← New engineer setup
├── protocols/                       ← Debugging & incident response
├── status/                          ← Point-in-time production snapshots
├── agents/                          ← APEX agent specifications
└── internal/                        ← Proprietary APEX frameworks
```

---

## Architecture

| Document | Version | Description |
|---|---|---|
| [ARCHITECTURE](./architecture/ARCHITECTURE_v1.2.0.md) | v1.2.0 | Full stack overview — Vite + React + Supabase + Cloudflare + Stripe + Sentry |
| [DB SCHEMA](./architecture/DB_SCHEMA_v1.2.0.md) | v1.2.0 | Core schema + 28 migrations — tables, indexes, matviews, RLS helpers |
| [API REFERENCE](./architecture/API_REFERENCE_v1.2.0.md) | v1.2.0 | Worker API endpoints, JWT-only auth, idempotency, full route inventory |
| [COMPLETE CODEBASE MAP](./architecture/COMPLETE_CODEBASE_MAP_v1.0.0.md) | v1.1.1 | Full directory structure, route inventory, schema summary, ops console |
| [CANONICAL DATA PIPELINE](./architecture/CANONICAL_DATA_PIPELINE_v1.0.0.md) | v1.0.0 | Authoritative upload → ingest → parse → store → render flow map |
| [STORE ARCHITECTURE](./architecture/STORE_ARCHITECTURE_v1.0.0.md) | v1.0.0 | Edge-native commerce engine — canonical schema and purchase flows |
| [STORE API CONTRACTS](./architecture/STORE_API_CONTRACTS_v1.0.0.md) | v1.0.0 | `/api/public/products`, `/api/store/checkout`, `/api/store/quotes` contracts |

---

## Security

| Document | Version | Description |
|---|---|---|
| [SECURITY MODEL](./security/SECURITY_MODEL_v1.2.0.md) | v1.3.0 | Auth, RLS hardening, Turnstile, Stripe webhook security, OmniBridge trust boundary, defensive patterns |
| [RLS MATRIX](./security/RLS_MATRIX_v1.2.0.md) | v1.2.0 | Row-Level Security access matrix — all table domains + helper functions |
| [HEADSHOT POLICY](./security/HEADSHOT_POLICY_v1.1.0.md) | v1.1.0 | Image moderation outcomes and routing rules |

---

## Operations

| Document | Version | Description |
|---|---|---|
| [OPERATIONS RUNBOOK](./operations/OPERATIONS_RUNBOOK_v1.6.0.md) | v1.7.0 | Env setup, deployments, DB ops, CI/CD, emergency procedures, livestream ops, WHIP broadcast, OmniBridge ops |
| [SUPABASE MONITORING RUNBOOK](./operations/SUPABASE_MONITORING_RUNBOOK_v1.0.0.md) | v1.0.0 | Supabase cost/health metrics, escalation, emergency cost controls |
| [EXTERNAL BINDINGS](./operations/EXTERNAL_BINDINGS_v1.0.0.md) | v1.0.0 | Third-party secrets and service configuration checklist |
| [SELFHOST HARDENING RUNBOOK](../sbbl-hq-selfhost/docs/runbooks/selfhost-hardening.md) | v1.0.0 | Self-hosted Supabase Docker stack ops — Kong, Auth, DB, restart procedures |
| [SECRET ROTATION RUNBOOK](../sbbl-hq-selfhost/docs/runbooks/supabase-clean-secret-rotation.md) | v1.0.0 | Safe rotation of all self-hosted Supabase secrets without downtime |
| [OAUTH HOTFIX RUNBOOK](./ops/OAUTH_HOTFIX_RUNBOOK.md) | v1.0.0 | Google OAuth enablement and troubleshooting |
| [REPLAY MONETIZATION RUNBOOK](./ops/REPLAY_MONETIZATION_RUNBOOK.md) | v1.0.0 | Post-event replay monetization activation |
| [WS2–WS7 RELEASE CHECKLIST](./ops/WS_RELEASE_CHECKLIST.md) | v1.0.0 | Feature-flag activation order and rollback for workstream releases |
| [REPO MIGRATION 2026-08-09](./ops/REPO_MIGRATION_2026-08-09.md) | — | Canonical remote moved `apexbusiness-systems/sbbl-hq` → `sbblhqapp/sbblhq`; what moved, what didn't, secret re-provisioning, operator-script fixes |

---

## Deployment

| Document | Version | Description |
|---|---|---|
| [SUPABASE SETUP](./deployment/SUPABASE_SETUP_v1.1.0.md) | v1.1.0 | Project link, migrations, storage, type generation |
| [DEPLOY CLOUDFLARE](./deployment/DEPLOY_CLOUDFLARE_v1.2.0.md) | v1.2.0 | Cloudflare Workers — local, staging, production, PWA, Sentry, rollback |
| [PWA + CAPACITOR SETUP](./deployment/PWA_CAPACITOR_SETUP_v1.1.0.md) | v1.1.0 | Service worker config, iOS/Android native build |

---

## Features

| Document | Version | Description |
|---|---|---|
| [LIVE SCORING & PLAYER STATS](./features/LIVE_SCORING_AND_PLAYER_STATS_v1.0.0.md) | v1.0.0 | 1-Click Game Launch, courtside scoring controls, 1-tap player attribution, and live standings projection |
| [STATS PIPELINE](./features/STATS_PIPELINE_v1.2.0.md) | v1.2.0 | 4-stage stat submission + materialized standings + react-window virtualization |
| [BROADCAST OVERLAY & ENGAGEMENT](./features/BROADCAST_OVERLAY_ENGAGEMENT_v1.0.0.md) | v1.0.0 | Chromeless OBS overlay, polls/predictions/trivia, watch parties, sponsor rotation, AI weekly digest, OBS remote control |
| [STREAM GATING](./features/STREAM_GATING_v1.7.0.md) | v1.7.1 | PPV entitlement, comp codes, universal URL detection, WHIP browser ingest, origin-aware CORS |
| [PIPELINE MAP](./features/PIPELINE_MAP_v1.3.0.md) | v1.3.0 | Super-Admin Ops Console data upload pipeline flowchart |

---

## Quality

| Document | Version | Description |
|---|---|---|
| [RELEASE GATE AUDIT 2026-05-16](./qa/RELEASE_GATE_AUDIT_2026-05-16.md) | — | Static gates PASS (typecheck/lint/vitest); Playwright gate PASS post-deps-install |
| [BROADCAST PAYWALL QA AUDIT 2026-05-08](./qa/BROADCAST_PAYWALL_QA_AUDIT_2026-05-08.md) | — | Full broadcast/paywall audit — 2399 tests pass; executable evidence required for VERIFIED status |
| [RELEASE GATE AUDIT 2026-04-11](./quality/RELEASE_GATE_AUDIT_2026-04-11_v1.4.0.md) | v1.4.0 | Comp codes + 20K chaos battery — historical gate decision: GO (superseded; re-run current gates) |
| [RELEASE GATE AUDIT 2026-04-09](./quality/RELEASE_GATE_AUDIT_2026-04-09_v1.3.0.md) | v1.3.0 | Final RC gate run — lint/typecheck/tests/build all PASS; historical gate decision: GO (superseded; re-run current gates) |
| [LIVESTREAM INTEGRITY AUDIT 2026-04-09](./quality/LIVESTREAM_INGEST_BROADCAST_SYSTEM_INTEGRITY_AUDIT_2026-04-09_v1.0.0.md) | v1.0.0 | 20K-oriented livestream/ingest/broadcast integrity audit (Rev B) |
| [INGRESS/RENDER QA MATRIX 2026-04-07](./quality/INGRESS_RENDER_QA_MATRIX_2026-04-07_v1.3.0.md) | v1.3.0 | Endpoint-by-endpoint QA matrix — ingress, parsers, render, auto-resize |
| [PRODUCTION ENV VERIFICATION 2026-04-15](./quality/PRODUCTION_ENV_VERIFICATION_2026-04-15_v1.0.0.md) | v1.0.0 | Livestream/broadcast production evidence — local gates PASS, prod blockers logged |
| [MEDIA PUBLICATIONS SORT_ORDER MIGRATION 2026-04-16](./quality/MEDIA_PUBLICATIONS_SORT_ORDER_MIGRATION_2026-04-16_v1.0.0.md) | v1.0.0 | Owner-ordering schema change execution on hosted Supabase |
| [STABILIZATION PASS 2026-04-04](./quality/STABILIZATION_PASS_2026-04-04_v1.0.0.md) | v1.0.0 | Multi-phase pre-launch stabilization summary |
| [BUILD AUDIT 2026-03-28](./quality/BUILD_AUDIT_2026-03-28_v1.0.0.md) | v1.0.0 | End-to-end build audit — historical baseline |

---

## Onboarding

| Document | Version | Description |
|---|---|---|
| [DEVELOPER ONBOARDING](./onboarding/DEVELOPER_ONBOARDING_v1.0.0.md) | v1.0.1 | New engineer setup — env, tools, first deploy |

---

## Protocols

| Document | Version | Description |
|---|---|---|
| [DEBUGGING PROTOCOL](./protocols/DEBUGGING_PROTOCOL_v1.0.0.md) | v1.0.0 | Systematic debugging methodology for SBBL HQ |
| [EMERGENCY RESPONSE PROTOCOL](./protocols/EMERGENCY_RESPONSE_PROTOCOL_v1.0.0.md) | v1.0.0 | Incident response — escalation, rollback, comms |

---

## Production Status Snapshots

| Document | Version | Description |
|---|---|---|
| [PRODUCTION STATUS 2026-03-28](./status/PRODUCTION_STATUS_2026-03-28_v1.0.0.md) | v1.0.0 | Point-in-time readiness snapshot |
| [LIVESTREAM HARDENING 2026-04-05](./status/LIVESTREAM_HARDENING_2026-04-05_v1.0.0.md) | v1.0.0 | Livestream pipeline hardening — 20K stress validated, zero errors |
| [LOAD TESTING 20K AUDIT 2026-04-05](./status/LOAD_TESTING_20k_AUDIT_2026-04-05_v1.0.0.md) | v1.0.0 | 20K concurrent user load test — bottleneck identification and fixes |

---

## APEX Agents

| Document | Version | Description |
|---|---|---|
| [APEX DATA ARCHITECT AGENT](./agents/APEX_DATA_ARCHITECT_AGENT_2026-04-11_v1.0.0.md) | v1.0.0 | Data architect execution profile |
| [APEX FRONTEND AGENT](./agents/APEX_FRONTEND_AGENT_2026-04-11_v1.0.0.md) | v1.0.0 | Frontend engineering execution profile |
| [APEX MASTER DEBUG AGENT](./agents/APEX_MASTER_DEBUG_AGENT_2026-04-11_v1.0.0.md) | v1.0.0 | Predictive debugging intelligence agent |
| [APEX OMNITEST AGENT](./agents/APEX_OMNITEST_AGENT_2026-04-11_v1.0.0.md) | v1.0.0 | Universal test orchestration agent |
| [APEX POWER AGENT](./agents/APEX_POWER_AGENT_2026-04-11_v1.0.0.md) | v1.0.0 | Universal execution meta-skill agent |
| [APEX QA AGENT](./agents/APEX_QA_AGENT_2026-04-11_v1.0.0.md) | v1.0.0 | Quality assurance execution profile |
| [OMNIDEV V2 AGENT](./agents/OMNIDEV_V2_AGENT_2026-04-11_v1.0.0.md) | v1.0.0 | Omnidev v2 full-stack execution profile |

---

## Internal Frameworks

| Document | Version | Description |
|---|---|---|
| [APEX DEBUG FRAMEWORK](./internal/APEX_DEBUG_FRAMEWORK_v1.0.0.md) | v1.0.0 | Proprietary APEX omniscient debugging intelligence |
| [APEX POWER FRAMEWORK](./internal/APEX_POWER_FRAMEWORK_v1.0.0.md) | v1.0.0 | Proprietary APEX universal execution meta-skill |
| [SBBL AGENT](./internal/SBBL_AGENT_v1.0.0.md) | v1.0.0 | Session skill profile for SBBL HQ execution contexts |

---

## Self-hosted Supabase

| Document | Description |
|---|---|
| [ACTIVE SELFHOST ROOT](../sbbl-hq-selfhost/sbbl-hq-selfhost/ACTIVE_SELFHOST_ROOT.md) | Active Docker Compose root — run all Docker commands from here |
| [WARNING NOT ACTIVE ROOT](../sbbl-hq-selfhost/WARNING_NOT_ACTIVE_SELFHOST_ROOT.md) | Outer directory guard — do NOT run Docker commands here |
| [SELFHOST HARDENING RUNBOOK](../sbbl-hq-selfhost/docs/runbooks/selfhost-hardening.md) | Kong, Auth, DB, restart procedures |
| [SECRET ROTATION RUNBOOK](../sbbl-hq-selfhost/docs/runbooks/supabase-clean-secret-rotation.md) | Safe secret rotation without downtime |

---

## Policy (Root-Level)

These policy documents live at the repo root and are linked here for discoverability.

| Document | Version | Description |
|---|---|---|
| [ONE_DEVICE_POLICY](../ONE_DEVICE_POLICY.md) | v1.0.0 | Single-device playback enforcement rules |
| [PAYWALL_ENFORCEMENT_POLICY](../PAYWALL_ENFORCEMENT_POLICY.md) | v1.0.0 | Server-authoritative access enforcement rules |
| [RESUME_POLICY](../RESUME_POLICY.md) | v1.0.0 | Session resume + heartbeat reclaim rules |
| [STREAM_TEST_STRATEGY](../STREAM_TEST_STRATEGY.md) | v1.1.0 | Pre-live validation test strategy, 20K stress, chaos battery |
| [CHANGELOG](../CHANGELOG.md) | — | High-level release changelog |

---

## Documentation Governance

| Rule | Policy |
|---|---|
| **Versioning** | Semantic versioning — `vMAJOR.MINOR.PATCH`. Bump MINOR for content additions, PATCH for corrections, MAJOR for structural rewrites. |
| **Dating** | UTC calendar dates `YYYY-MM-DD` in all filenames and front-matter. |
| **Front-matter** | Every document opens with `<!-- Version: vX.Y.Z \| Date: YYYY-MM-DD \| Status: Current -->` |
| **Ownership** | Engineering lead: runbooks, protocols, architecture. Release manager: quality reports, status snapshots. Product: feature specs. |
| **Review cadence** | Architecture/security: per schema migration. Runbooks: monthly or post-incident. Quality audits: per release candidate. Onboarding: quarterly. |
| **Deprecation** | Superseded feature specs are deleted once their successor is promoted to `Current`. Quality audits, release gates, and point-in-time status snapshots are retained as historical record. |

## Definition of "Release-Ready" State

- `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build` all pass with zero errors.
- All RLS policies active on every `public` schema table — verified by `rls_audit` log.
- PWA service worker generated — 47+ precached entries.
- Sentry DSN configured and error tracking confirmed active.
- Stripe webhook idempotency table seeded and endpoint verified.
- All environment variables from `EXTERNAL_BINDINGS` checklist confirmed set in production.
