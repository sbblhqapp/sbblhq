# Current Status

- date: 2026-08-15
- omni_recall_status: active
- historical_backfill_status: pending_external_exports
- correction_ledger_status: active — 8 records (see wiki/corrections/README.md)
- source_index_status: active
- canonical_blueprint_status: active

## Repo State (verified 2026-08-15)

- **Canonical remote:** `https://github.com/sbblhqapp/sbblhq` (migrated
  2026-08-09 from the archived `apexbusiness-systems/sbbl-hq`; see
  `docs/ops/REPO_MIGRATION_2026-08-09.md` and correction
  [[2026-08-09-repo-migration-sbblhqapp]]).
- **Deployed:** Cloudflare Worker `sbbl-hq-worker`, zone `sbbl-hq.icu`.
  Latest deploy verified live 2026-08-15 (PR #11 merge, all 11 CI checks passed,
  `/ops/health` returned `ok:true`).
- **Latest merged work (2026-08-15):**
  1. LiveScoreboard mounting across `/scorekeeper/:gameId` and dedicated
     `/ops/scoreboard/:gameId` full-screen monitor — PR #7.
  2. Read-only SQL projection `public.fn_live_standings_preview` & public Worker
     route `GET /api/public/live-standings/:leagueId/:seasonId` — PR #7.
  3. ⚡ 1-Click Game Setup & Launch panel on `/ops` Live Tabulation — PR #11.
  4. Unified `<LiveScoreboard />`, `<CourtsideQuickControls />`, and
     `<PlayerStatsTracker />` with 1-tap player attribution (`+1 FT, +2 FG, +3 3PT,
     REB, AST, STL, BLK, FLS`) synchronized directly with team scoring,
     scoreboard pulse animations, and projected standings — PR #11.
  5. Fail-closed cold-state optional chaining on references (`bootstrapQuery.data?.references?.leagues`)
     and missing game payload guards on OBS Overlay (`/overlay/:gameId`) — PR #11.


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
