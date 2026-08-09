# Correction: Ops Console Manual Forms Must Never Require a Raw UUID

- **Date:** 2026-08-09
- **Scope:** Project-wide (`src/pages/Ops.tsx`, `src/worker/index.ts`, `src/worker/routes/ops-upload.ts`, tests, `CLAUDE.md`)
- **Affected Pages:** `src/pages/Ops.tsx`, `src/lib/api/ops.ts`, `src/worker/index.ts`, `src/worker/routes/ops-upload.ts`, `src/worker/shared.ts`, `src/test/ops-console-uuid-free.test.tsx`, `src/test/worker-league-code-import-fix.test.ts`, `src/test/broadcast-test-utils.ts`, `CLAUDE.md`, `CHANGELOG.md`
- **Promotion Decision:** Owner-defined UX contract — core directive (`CLAUDE.md` rule 13)

## Original Assumption vs. Corrected State

- **Original Assumption:** An Ops Console operator can be asked to paste a
  League/Season/Division/Team/Player/Event/Schedule-slot ID, since it's an
  internal admin tool.
- **Corrected State (owner-defined):** Regular admins do not have database
  access. Every Manual Ops create/delete/suspend/merge form must resolve
  identifiers automatically — no `<input placeholder="… (UUID) *">` may ever
  reach a `league_admin`. League fields submit the `LEAGUE_REGISTRY` slug
  (same pattern already proven by the POTG form); Season/Division/Team/
  Player/Event/Schedule fields are `<select>`s backed by `/ops/bootstrap`
  references and `/ops/list/*` endpoints.

## A Second, Independently-Discovered Bug (not the trigger, found during the audit)

While wiring the League `<select>` to resolve server-side, the audit found
`handleImportRoute`'s `players`/`schedules`/`events` `INGEST_CONFIGS` entries
**silently ignored** the `leagueMap` argument passed to `resolvePayload` and
wrote `row.league_id` straight through unresolved — a live violation of the
rule-10 league-resolution contract
([[2026-07-21-league-resolution-consolidation]]) that predates this session.
`schedules` additionally had `league_id: z.string().uuid()` (strict), so a
typed code 422'd before ever reaching resolution.

Separately, the `fetchLeagueMap` helper backing `teams`/`scores` did a
**case-sensitive** `.in("code", uniqueCodes)` match against codes stored
**uppercase** in the DB — a typed lowercase code (`"wbl"`) never matched, so
the raw string fell into a `league_id` uuid column (`22P02` in real
Postgres). Same failure class and same root pattern as the 2026-07-21
`/ops/media` incident — this time on the write path instead of the read
path, and caught by a proactive audit rather than a production 500.

## Resolution

- `fetchLeagueMap` rebuilt on the canonical `resolveLeagueId` (rule 10)
  instead of a second, drifted lookup.
- All four `INGEST_CONFIGS` entries now consistently consume `leagueMap`.
- New `POST /ops/players/find-or-create` reuses `resolvePotgPlayer` — the
  same name-based find-or-create already proven by Roster Import / POTG
  ingest — replacing the raw `user_id` Create Player field, which had no
  search endpoint to find an existing account with.
- New `GET /ops/list/schedules`; `GET /ops/list/players` now joins
  `profiles.display_name` + `teams.name`.

## Verification Discipline

Same mutation-testing standard as
[[2026-08-09-regular-admin-permission-model]]: deliberately broke
`leagueUuidForSlug`, the `createPlayerMutation` contract, and reverted
`fetchLeagueMap` to its old broken form — each produced a distinct,
correctly-scoped test failure, then was restored byte-for-byte before the
full suite reran green. CI caught one genuine test race (an assertion
checking async-loaded data right after a synchronous heading render) that
the local run did not — fixed and reran 3x clean before merge. 1470/1470
tests pass; +30 tests across 2 new files.

## Related

- [[2026-08-09-repo-migration-sbblhqapp]]
- [[2026-08-09-regular-admin-permission-model]]
- [[2026-07-21-league-resolution-consolidation]]
