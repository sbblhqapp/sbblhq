# Correction: Ops Console Is a `league_admin` Surface, Not `super_admin`-Only

- **Date:** 2026-08-09
- **Scope:** Project-wide (Cloudflare Worker auth gates, `src/pages/Ops.tsx`, tests, `CLAUDE.md`)
- **Affected Pages:** `src/worker/index.ts`, `src/worker/routes/ops-upload.ts`, `src/pages/Ops.tsx`, `src/test/regular-admin-permissions.test.ts`, `src/test/regular-admin-behavioral.test.ts`, `src/test/ops-auth-gating.test.tsx`, `CLAUDE.md`, `CHANGELOG.md`
- **Promotion Decision:** Owner-defined permission matrix — core directive (`CLAUDE.md` rule 12)

## Original Assumption vs. Corrected State

- **Original Assumption:** Ops Console entry and every content-management
  handler gated on `roles.includes('super_admin')`. `league_admin` existed as
  a role in the enum but had no console surface that admitted it.
- **Corrected State (owner-defined, not inferred):** A `league_admin` runs
  day-to-day content operations for all three leagues — scores, schedules,
  stats, players, teams, media, POTG, roster imports. New
  `requireOpsAdminSession` gate admits `league_admin` + `super_admin` only —
  deliberately narrower than `requireAdminSession`, which also admits
  `team_manager` (scoped to one team, must never post league-wide results).

## The Trigger

The operator (`statssbbl@gmail.com`) was granted `league_admin` specifically
to operate the console, then reported it as unusable — "Access denied. Super
Admin role required." on every tab. The role existed in the data model with
no corresponding capability in the UI or the 29 worker handlers gating on
`super_admin`.

## What Regular Admins Explicitly Do NOT Get (owner-specified, verbatim)

- **No access to live-PPV controls**: stream config, go-live, access
  lookup/override, PPV revenue — stay `requireSuperAdminSession`. Broadcast
  surfaces are untouched per the pre-existing hard freeze (`CLAUDE.md`
  §7.1/§8.4) — this correction did not relax that freeze.
- **PPV comp codes: allowed, capped at 5 per rolling 24 hours,
  non-compounding.** Rolling window (not calendar-day) is the point — an
  unused day must never bank extra allowance. Over-cap returns `429
  comp_code_daily_limit_reached`. Regular admins list only their own codes.
- **Excluded from store media upload and product edit.** Enforced on the
  *shared* CRUD path (`requireTableWriteSession` escalates for
  `STORE_ONLY_TABLES`), not just the dedicated product-creation handler —
  otherwise `products` would inherit `league_admin` access through the
  generic patch/delete helper. Store tab hidden from the UI entirely for
  non-super-admins.

## Resolution & Verification Discipline

- Contract pinned by 57 tests across two files: 32 source-level assertions
  (`regular-admin-permissions.test.ts`) + 25 behavioral tests
  (`regular-admin-behavioral.test.ts`) that invoke real handlers against a
  mock Supabase client and assert on real HTTP status/response body/row
  mutations — not string matching.
- **Mutation-verified, not just green.** For each of the 4 rules, the
  implementation was deliberately broken, the suite was confirmed to fail
  with exactly the tests exercising that rule (and no others), then the
  exact pre-mutation diff was restored (verified via `git diff`) before
  rerunning the full suite. This is the discipline expected for any future
  permission-model change on this surface — "tests are green" alone is not
  sufficient evidence.
- Live re-verification after deploy: `statssbbl@gmail.com` confirmed signed
  in as `league_admin` with the Ops Console tabs (minus Store Media)
  rendering.

## Related

- [[2026-08-09-repo-migration-sbblhqapp]]
- [[2026-08-09-ops-console-uuid-elimination]]
