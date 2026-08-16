# Corrections

Store durable correction records here.

Each correction should capture:
- date
- original wrong assumption
- corrected state
- scope: local, project-wide, global, or user-style
- affected pages
- promotion decision: page only, directive, or user-pattern rule

## Correction Index

- [[2026-07-18-cors-and-credentials-resolution.md]] — CORS local port whitelisting (8080) and local credentials separation via `.dev.vars`.
- [[2026-07-20-auth-loading-state-stabilization.md]] — Gating token refresh auth loading state resets, Playwright file upload stabilization, and ignoring live diagnostic tests in CI.
- [[2026-07-21-league-resolution-consolidation.md]] — League slug→UUID lookup consolidated into `resolveLeagueId`/`resolveLeagueIdFilter` (`src/worker/shared.ts`) after 8 drifted hand-rolled copies caused the `/ops/media` league-filter 500; CI guard blocks new copies.
- [[2026-07-22-web-analytics-cls-optimization.md]] — Web Analytics CLS elimination: reserved height containers and structural skeleton loaders across `/ops`, `/login`, `/teams`, and lazy route fallbacks.
- [[2026-08-09-repo-migration-sbblhqapp.md]] — Canonical remote migrated `apexbusiness-systems/sbbl-hq` → `sbblhqapp/sbblhq`; two latent script defects found and fixed (Markdown-escaped ENV parsing, ambient-env project retargeting).
- [[2026-08-09-regular-admin-permission-model.md]] — Ops Console is now a `league_admin` surface (owner-defined matrix: content ops yes, live-PPV no, comp codes capped at 5/rolling-24h, store excluded); mutation-tested.
- [[2026-08-09-ops-console-uuid-elimination.md]] — Every Manual Ops form resolves identifiers automatically instead of requiring a raw UUID; uncovered and fixed a live rule-10 league-code-resolution violation in `handleImportRoute`.
- [[2026-08-15-unified-live-scoring-tabulation-and-player-stats.md]] — Unified Courtside Game Tabulation & Player Stats Engine: Real-time 1-tap scoring, courtside walk-on additions, synchronized broadcast overlays, and historical tabulation.
- [[2026-08-16-autonomous-30-day-archived-media-purge.md]] — Autonomous 30-Day Archived Media Database & Storage Purge Engine: Daily Cloudflare Worker cron (03:00 UTC), physical bucket deletion (`media`, `league-media`), immunity protection, and mobile-optimized Ops UI.

