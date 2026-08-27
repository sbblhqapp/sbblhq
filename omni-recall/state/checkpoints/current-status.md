# Current Status

- date: 2026-08-27
- omni_recall_status: active
- historical_backfill_status: complete
- correction_ledger_status: active — 11 records (see wiki/corrections/README.md)
- source_index_status: active
- canonical_blueprint_status: active

## Repo State (verified 2026-08-27)

- **Canonical remote:** `https://github.com/sbblhqapp/sbblhq` (migrated
  2026-08-09 from the archived `apexbusiness-systems/sbbl-hq`; see
  `docs/ops/REPO_MIGRATION_2026-08-09.md` and correction
  [[2026-08-09-repo-migration-sbblhqapp]]).
- **Deployed:** Cloudflare Worker `sbbl-hq-worker`, zone `sbbl-hq.icu`.
- **Latest merged & delivered work:**
  1. **PR #115:** Enforce canonical platform monetization model ($3.99 CAD PPV & $6.99 CAD Season Pass) with 100% test coverage and zero operator tier drift.
  2. **SBBL Spring Edition POTG Tabulation & Stats Pipeline:** 5 Player of the Game matches finalized with full box scores, player awards, team standings updates, and RPC display name coalescing (`20260827000000_fix_player_display_name_coalesce.sql`).

## Known backfill gap

Correction records in `wiki/corrections/` run from 2026-07-18 through
2026-07-22, then resume with entries dated 2026-08-09 onwards.
Commits between those dates (POTG/Groq-vision hardening, player-identity
merge, pipeline health telemetry, `player_game_stats` FK join fix, admin
grant for `rondalesteve@gmail.com`, etc. — see `git log` on `main`) were
routine fixes already covered by `CHANGELOG.md` and were not promoted to
individual correction records. Per the ingestion rules, this gap is marked
pending rather than backfilled speculatively — do not treat the correction
ledger as a complete session-by-session history; treat `git log` /
`CHANGELOG.md` as authoritative for that period.
