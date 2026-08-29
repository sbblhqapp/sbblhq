<!-- Version: v1.9.8 | Date: 2026-08-28 | Status: Current -->
# SBBL HQ

Three-league basketball super app by APEX Business Systems Ltd., Edmonton, Alberta

**Leagues:** WBL (Weekend Basketball League) · TGIF League · SBBL Spring Edition

**Live at:** [sbbl-hq.icu](https://sbbl-hq.icu)

---

## Stack

- **Frontend:** Vite + React + TypeScript (strict mode enabled; see `tsconfig.app.json`)
- **Live Scoring & Tabulation:** 1-Click Game Launch, `<LiveScoreboard />`, `<CourtsideQuickControls />`, `<PlayerStatsTracker />`, real-time OBS broadcast scorebug (`/overlay/:gameId`), and live projected standings preview (`public.fn_live_standings_preview`)
- **Monetization & Invariants:** Canonical 2-tier monetization ($3.99 CAD per PPV livestream, $6.99 CAD per Player Premium Season Pass, $0 Free roster player and fan accounts)
- **Performance & Web Vitals:** Cumulative Layout Shift (CLS) zero-shift target (<0.01), layout-reserved skeleton containers
- **Styling:** Tailwind CSS (dark-first, `#C9A84C` gold accent, mobile-first responsive architecture)
- **Database:** Supabase (PostgreSQL + Realtime + Auth + Storage)
- **Hosting:** Cloudflare Workers (Scheduled Crons, Edge API Gateway) — NOT Vercel
- **Payments:** Stripe (Webhook signature verification + Alberta 5% GST calculation)
- **CI/CD:** GitHub Actions → Cloudflare deploy

---

## 🧠 OMNI-RECALL — AGENTS READ THIS FIRST

This repository uses the APEX **Omni-Recall** continuity framework to store durable project knowledge, operator preferences, corrections, and system directives.

> [!IMPORTANT]
> **Before performing any development or operations work in this repository, agents MUST read the Omni-Recall entry point starting at [start-here.md](file:///c:/Users/sinyo/sbbl-hq/sbbl-hq/omni-recall/start-here.md).**

---

## ⚠️ ENV VARS — AGENTS READ THIS FIRST

2 separate systems. Mixing them breaks auth.

### Build-time (Vite — browser bundle)
Set in `.env` locally. Set as GitHub Actions Secrets in CI.

```
VITE_SUPABASE_URL=https://SBBL_SUPABASE_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...   ← anon JWT from self-hosted Supabase gateway/Kong public URL
```

> Both `VITE_SUPABASE_PUBLISHABLE_KEY` and `VITE_SUPABASE_ANON_KEY` are supported.
> The code prefers `VITE_SUPABASE_PUBLISHABLE_KEY` and falls back to `VITE_SUPABASE_ANON_KEY`.
> Either works — they resolve to the same Supabase anon/publishable key.

### Worker runtime (Cloudflare - never browser)
Set in `.dev.vars` locally. Set via `wrangler secret put` in production.

```
SUPABASE_SERVICE_ROLE_KEY=...
STRIPE_SECRET_KEY=...
STRIPE_WEBHOOK_SECRET=...
RESEND_API_KEY=...
```

---

## Quick Start

```bash
npm install
cp .env.example .env        # fill in VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
cp .dev.vars.example .dev.vars  # fill in service keys
npm run dev
```

## Quality Gates (must all pass before merge)

```bash
npm run lint        # zero warnings
npm run typecheck   # zero errors
npm run test        # ≥80% coverage
npm run build       # zero errors
npx playwright test # smoke suite passes
```

## Deploy

```bash
npm run cf:deploy           # production
npm run cf:deploy:staging   # staging
```

## Docs

All documentation lives in [`docs/`](docs/README.md). Key entry points:

| Category | Document |
|---|---|
| Architecture | [Architecture Overview](docs/architecture/ARCHITECTURE_v1.2.0.md) · [DB Schema](docs/architecture/DB_SCHEMA_v1.2.0.md) · [API Reference](docs/architecture/API_REFERENCE_v1.2.0.md) · [Codebase Map](docs/architecture/COMPLETE_CODEBASE_MAP_v1.0.0.md) · [Canonical Data Pipeline](docs/architecture/CANONICAL_DATA_PIPELINE_v1.0.0.md) |
| Security | [Security Model](docs/security/SECURITY_MODEL_v1.2.0.md) · [RLS Matrix](docs/security/RLS_MATRIX_v1.2.0.md) |
| Operations | [Operations Runbook](docs/operations/OPERATIONS_RUNBOOK_v1.6.0.md) · [Supabase Monitoring](docs/operations/SUPABASE_MONITORING_RUNBOOK_v1.0.0.md) · [External Bindings](docs/operations/EXTERNAL_BINDINGS_v1.0.0.md) |
| Deployment | [Supabase Setup](docs/deployment/SUPABASE_SETUP_v1.1.0.md) · [Cloudflare Deploy](docs/deployment/DEPLOY_CLOUDFLARE_v1.2.0.md) · [PWA + Capacitor](docs/deployment/PWA_CAPACITOR_SETUP_v1.1.0.md) |
| Features | [Live Scoring & Stats](docs/features/LIVE_SCORING_AND_PLAYER_STATS_v1.0.0.md) · [Stream Gating](docs/features/STREAM_GATING_v1.7.0.md) · [Stats Pipeline](docs/features/STATS_PIPELINE_v1.2.0.md) · [Pipeline Map](docs/features/PIPELINE_MAP_v1.3.0.md) · [Broadcast Overlay & Engagement](docs/features/BROADCAST_OVERLAY_ENGAGEMENT_v1.0.0.md) |
| Onboarding | [Developer Onboarding](docs/onboarding/DEVELOPER_ONBOARDING_v1.0.0.md) |
| Quality | [Release Gate 2026-04-11](docs/quality/RELEASE_GATE_AUDIT_2026-04-11_v1.4.0.md) · [Livestream Integrity Audit](docs/quality/LIVESTREAM_INGEST_BROADCAST_SYSTEM_INTEGRITY_AUDIT_2026-04-09_v1.0.0.md) |

---

## License

Proprietary — APEX Business Systems Ltd., Edmonton, Alberta, Canada © 2026. All rights reserved.
