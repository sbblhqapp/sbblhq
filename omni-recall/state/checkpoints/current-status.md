# Current Status

- date: 2026-08-09
- omni_recall_status: active
- historical_backfill_status: pending_external_exports
- correction_ledger_status: active — 7 records (see wiki/corrections/README.md)
- source_index_status: active
- canonical_blueprint_status: active

## Repo State (verified 2026-08-09)

- **Canonical remote:** `https://github.com/sbblhqapp/sbblhq` (migrated
  2026-08-09 from the archived `apexbusiness-systems/sbbl-hq`; see
  `docs/ops/REPO_MIGRATION_2026-08-09.md` and correction
  [[2026-08-09-repo-migration-sbblhqapp]]).
- **Deployed:** Cloudflare Worker `sbbl-hq-worker`, zone `sbbl-hq.icu`.
  Latest deploy verified live 2026-08-09 (PR #2 merge, `deploy.yml` run
  success, `/ops/health` returned `ok:true`).
- **Latest merged work (this session, 2026-08-09):**
  1. Repo migration + `statssbbl@gmail.com` granted regular admin
     (`league_admin`, not `super_admin`) — PR #1.
  2. Regular-admin (`league_admin`) permission model for the Ops Console,
     mutation-tested — PR #1.
  3. Ops Console UUID elimination + a live rule-10 league-code-resolution
     bug fix in `handleImportRoute` — PR #2.

## Known backfill gap

Correction records in `wiki/corrections/` run from 2026-07-18 through
2026-07-22, then resume with this session's entries dated 2026-08-09.
Commits between those dates (POTG/Groq-vision hardening, player-identity
merge, pipeline health telemetry, `player_game_stats` FK join fix, admin
grant for `rondalesteve@gmail.com`, etc. — see `git log` on `main`) were
routine fixes already covered by `CHANGELOG.md` and were not promoted to
individual correction records. Per the ingestion rules, this gap is marked
pending rather than backfilled speculatively — do not treat the correction
ledger as a complete session-by-session history; treat `git log` /
`CHANGELOG.md` as authoritative for that period.
