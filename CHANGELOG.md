<!-- Version: v1.9.6 | Date: 2026-08-19 | Status: Current -->
# CHANGELOG

All notable changes to SBBL HQ are documented in this file.
Versioning follows [semantic versioning](https://semver.org) with UTC date stamps.

---

## [1.9.6] - 2026-08-19

### Added & Fixed — P10 Division Ingestion, Schema Guard Closure & CI Streamlining

- **P10 Division Ingestion & Verification (`1ca72d56-16fa-4012-9cd1-857ebb185d84`):** Logged official final score (Riverside / OVRBRK 64 – Northstar P10 61) and ingested 20 player stat lines into production Supabase DB. Verified population across Scores, Schedules, Stats, Leaderboards, and Teams tabs.
- **Contract Schema Guard Closure:** Closed `orders.metadata` exemption in `src/test/worker-schema-contract.test.ts` following live production migration `20260818150000_orders_add_metadata.sql`.
- **AppHome League Derivation:** Updated `handlePublicHome` in `src/worker/routes/public.ts` to derive `league_code` directly from `games.league_id`, ensuring games with `season_id IS NULL` render properly.
- **CI Workflow Consolidation:** Streamlined duplicate workflow triggers to eliminate GitHub Actions queue congestion, reducing PR check runtime from 30m+ down to 3-4 minutes.
- **Tests:** Added `src/test/p10-division-scores.test.ts` to ensure point summation and game invariant contracts.

---

## [1.9.5] - 2026-08-16

### Added — SBBL Season 12 Key Art Surfaces

- **Season showcase registry (`src/lib/seasonShowcase.ts`):** Single source for season key art, keyed by `LeagueId` with an `active` flag. Retiring a season's art is a one-line data change; consumers render `null` when no active entry exists.
- **`SeasonShowcaseBanner`:** Art-directed banner at the top of `/league/:leagueId`. 12:5 crop from `md` up, 1:1 below, WebP with JPEG fallback. Aspect ratio is reserved at both breakpoints, so the banner contributes zero CLS.
- **`SeasonFeatureCard`:** Portrait Season 12 card beside the `/` hero headline as a secondary highlight (150–232px by breakpoint), linking to `/league/sbbl`. Carries `fetchPriority="low"` so it never competes with the hero background for LCP.
- **Assets (`public/assets/season/`):** Season 12 key art derived from the official Season 12 poster — league mark, season, and tip-off date only, all promotional copy removed. WebP 173–215 KB per surface.
- **Scope:** SBBL only. WBL and TGIF resolve to `null` and render nothing; no existing markup was modified beyond the two mount points.
- **Tests:** `src/test/season-showcase.test.tsx` covers registry resolution, per-league gating, alt text, asset wiring, and LCP priority.

---

## [1.9.4] - 2026-08-16

### Fixed — Courtside Ops Scoring Repair & Decoupled Roster Architecture (Contract v4.0.0)

- **Decoupled Roster Player Model:** Migration `20260816000000_decouple_roster_players.sql` decouples `public.players` from `public.profiles` and `auth.users`, matching industry-standard sports architectures (GameChanger/iScore 24M+ games). Roster players are standalone entities; user accounts are optional.
- **Zero Cross-Identity Merging:** Eliminated fuzzy cross-team display name matching. Adding a player always provisions an isolated player row on the target team, eliminating identity collisions and stats cross-contamination.
- **State-Aware Correction & Reopen Lifecycle:** Supported `review_pending` status transition with `"Under Correction — not yet official"` warning banner. Game score and stats can be corrected without destructive data wipes; subsequent finalization recalculates official `mvw_standings`.
- **Radix Dialog Modal Protection:** Replaced browser-native `window.confirm()` alerts with accessible Radix `<Dialog>` modals to prevent browser suppression risks during high-tempo live scoring.
- **Streamlined Add-Player UX:** Single clear Add Walk-On Player form affordance with explicit Team selection on Box Score view, eliminating duplicate buttons.

---

## [1.9.3] - 2026-08-15

---

## [1.9.3] - 2026-08-15

### Added — Unified Courtside Game Tabulation & Live Scoring Engine

- Real-time 1-tap scoring, courtside walk-on additions, synchronized broadcast overlays, and historical tabulation.


## [1.9.2] - 2026-08-09

### Changed — Ops Console: no more raw UUIDs in any regular-admin form

- **Every Manual Ops form now resolves identifiers automatically.** Create/
  Delete Team, Create Player, Suspend/Delete/Merge Player, Create/Delete
  Schedule Slot, Create/Delete Event, and the Roster Import League/Season
  fields no longer ask the operator to paste a League/Season/Division/Team/
  Player/Event/Schedule-slot UUID. League fields are a `<select>` sourced from
  `LEAGUE_REGISTRY` (same pattern the POTG form already used); Season/
  Division/Team/Player/Event/Schedule fields are `<select>`s backed by
  `/ops/bootstrap` references and new/existing `/ops/list/*` endpoints.
- **Create Player no longer requires a pre-existing account.** New `POST
  /ops/players/find-or-create` reuses `resolvePotgPlayer` — the same
  find-or-create-by-name logic already proven by Roster Import and POTG
  ingest — so the form now just takes a name.
- **`GET /ops/list/players`** now joins `profiles.display_name` and
  `teams.name` (via the single unambiguous FK each) so the picker shows a
  human name instead of a raw ID.
- **New `GET /ops/list/schedules`** — no list endpoint existed for
  `schedule_slots` before this; Delete Schedule Entry had nothing to pick
  from.

### Fixed — league codes silently failed to resolve on 3 of 4 import types

- **`players`/`schedules`/`events` import configs ignored the `leagueMap`
  argument** passed to `resolvePayload` and wrote `row.league_id` straight
  through unresolved — a live violation of the rule-10 league-resolution
  contract that predates this audit. `schedules` additionally had
  `league_id: z.string().uuid()` (strict), so a typed code 422'd before ever
  reaching resolution.
- **`fetchLeagueMap` did a case-sensitive exact match** (`.in("code",
  uniqueCodes)`) against codes stored uppercase in the DB — a typed lowercase
  code (`"wbl"`) never matched, so the raw string fell into a `league_id` uuid
  column (`22P02` in a real Postgres). Same failure class as the 2026-07-21
  `/ops/media` incident, this time on the write path. Rebuilt on the
  canonical `resolveLeagueId` (rule 10) instead of a second, drifted lookup.
- All four `INGEST_CONFIGS` entries (`teams`, `players`, `schedules`,
  `events`) now consistently resolve `league_id` through the fixed
  `fetchLeagueMap`.

### Added — test coverage, mutation-verified

- `src/test/ops-console-uuid-free.test.tsx` (9 tests) — real DOM render of
  `OpsPage`, proves League→Season filtering actually resolves against mocked
  reference data (not just that a dropdown exists), and that Create Player
  calls `findOrCreatePlayer` with a name, never the old
  `manualOpsAction('player','create',{userId})` contract.
- `src/test/worker-league-code-import-fix.test.ts` (7 tests) — real
  `handleImportRoute` calls against a mock Supabase client, asserting the
  actual resolved `league_id` that lands in the row.
- Both suites were mutation-tested: each of the 4 rules this changeset
  enforces (Ops-admin gate, comp-code cap, store-table escalation, league-slug
  resolution) was deliberately broken, confirmed to produce a distinct
  correctly-scoped test failure, then reverted — not just "tests are green."
- `src/test/broadcast-test-utils.ts`'s mock Supabase client gained array
  support for `.insert()`/`.upsert()` (matching real Supabase semantics,
  needed to exercise the bulk-row `handleImportRoute` path). This corrected a
  latent bug in `src/test/surface-probes.test.ts`, which had encoded the
  mock's old broken array-spread behavior as an expected value; updated to
  assert against the real resolved payload.

---

## [1.9.1] - 2026-08-09

### Changed — Repository migration to `sbblhqapp/sbblhq`

- **Canonical remote moved** from `apexbusiness-systems/sbbl-hq` to
  `sbblhqapp/sbblhq`. Git history was imported; pull requests and issues were
  **not**, so pre-migration PR permalinks intentionally still resolve against the
  archived repo (rewriting them would 404). Local `origin` repointed, old remote
  retained as `legacy-origin`. Full runbook:
  `docs/ops/REPO_MIGRATION_2026-08-09.md`.
- **17 GitHub Actions secrets re-provisioned** on the new repo. A GitHub import
  carries no secrets, and `.github/workflows/deploy.yml` hard-fails without
  `SUPABASE_SERVICE_ROLE_KEY`. `OMNIHUB_SIGNING_SECRET` and `OMNIHUB_VERIFY_KEY`
  remain outstanding — deploys are unaffected (optional secrets are skipped when
  empty and the live Worker retains its values), but there is no GitHub-side
  source of truth to restore from if the Worker is recreated.
- **Cloudflare intentionally untouched.** The Worker `sbbl-hq-worker`, account,
  zone `sbbl-hq.icu`, and both custom domains are not keyed to the GitHub
  repository; `wrangler.jsonc` required no change. Verified live via the
  Cloudflare API during migration.
- `scripts/archive/deploy_cad_pr.js` now defaults to the new slug and accepts a
  `GH_REPO` override.

### Fixed — Operator scripts were silently inert

- **Markdown-escaped credentials were never parsed** (`scripts/lib/sbbl-env.ts`,
  new). The operator ENV file is Markdown, so underscores arrive escaped
  (`SUPABASE\_URL=`, `sbp\_badb…`). All four scripts in `scripts/` matched on the
  unescaped form, so every one exited "Failed to parse credentials" before doing
  any work. `scripts/push-via-link.ts` additionally matched `SUPABASE_TOKEN=`, a
  key that does not exist in the file. All four now share one loader.
- **Ambient environment could retarget the wrong database.** `SBBL_ENV_FILE`, when
  set, now outranks `process.env`. Previously an unrelated `SUPABASE_URL` exported
  in the shell silently redirected the admin-grant script to a different Supabase
  project; it failed safely only because that project lacks the target table.
- `scripts/deploy-migration.ts` no longer inlines an account-specific role grant
  (a duplicate of `grant-regular-admin.ts` that had already drifted); it is now a
  general migration pusher that exits non-zero when every host fails, instead of
  reporting success unconditionally.

### Changed — Ops Console is now a `league_admin` surface (owner-defined matrix)

- **Regular admins can operate the Ops Console.** Entry was gated on
  `roles.includes('super_admin')` in `src/pages/Ops.tsx`, and 29 worker handlers
  used `requireSuperAdminSession`. A `league_admin` could sign in and see only
  "Access denied. Super Admin role required." Scores, schedules, stats, players,
  teams, media, POTG, roster, and every CSV/image import path now run through the
  new `requireOpsAdminSession` gate for all three leagues.
- **`requireOpsAdminSession` is deliberately narrower than `requireAdminSession`**
  — it admits `league_admin` + `super_admin` only. `team_manager` is scoped to a
  single team and must never post league-wide results.
- **Live-PPV controls remain super-admin only**: stream config, go-live, access
  lookup/override, and PPV revenue. Broadcast surfaces are untouched per the hard
  freeze in `CLAUDE.md` §7.1/§8.4.
- **Regular admins may generate PPV comp codes, capped at 5 per rolling 24 hours**
  (non-compounding; over-cap returns `429 comp_code_daily_limit_reached`). Super
  admin stays uncapped. Regular admins can list only their own codes.
- **Store media upload and product edit are excluded from `league_admin`.** The
  shared CRUD helpers now dispatch through `requireTableWriteSession`, which
  escalates to super-admin for `STORE_ONLY_TABLES`; the Store tab is hidden from
  non-super-admins.
- Contract pinned by `src/test/regular-admin-permissions.test.ts` (32 assertions)
  and documented as hard rule **12** in `CLAUDE.md`.

### Fixed — stats join guard false-failed on every Windows checkout

- `src/test/stats-dashboard-join-fix.test.ts` stripped SQL comments by splitting
  on `'\n'`, leaving a trailing `'\r'` under `core.autocrlf=true`. `/--.*$/` can
  never match there (`.` does not consume a line terminator and `$` without `m`
  anchors only at end of input), so the comment survived and the guard flagged
  the *documentation* of the old join in `20260731060000` as a live violation.
  Green in Linux CI, red on every Windows machine. Now splits on `/\r?\n/`.

### Added — Regular admin grant for `statssbbl@gmail.com`

- `supabase/migrations/20260809120000_grant_statssbbl_league_admin.sql` grants
  `league_admin` (regular admin, **not** super admin) and explicitly revokes any
  pre-existing `super_admin` assignment. Idempotent; applied and verified live.
- `scripts/grant-regular-admin.ts` and `scripts/verify-deployment.ts` now take the
  target email as an argument (`ADMIN_EMAIL` env or argv) instead of hardcoding
  one account. `verify-deployment.ts` exits non-zero if `super_admin` survives.

---

## [1.9.0] - 2026-07-22

### Fixed — Web Vitals Cumulative Layout Shift (CLS) & Layout Stabilization

- **Ops Console Overview Layout Shift Elimination** (`src/pages/Ops.tsx`):
  Separated dynamic `pipelineHealthQuery` metrics from core system stat counters into isolated layout containers with dedicated skeleton loading placeholders and minimum heights (`min-h-[480px]`). Preserved container layout shells across auth loading and role denial states (`min-h-[calc(100vh-8rem)]`) to eliminate cumulative layout shifts on `/ops` (restoring Cloudflare Web Analytics performance to 100% Good).
- **Google OAuth Provider Layout Shift Elimination** (`src/pages/Login.tsx`):
  Enclosed conditional Google OAuth sign-in controls within a reserved layout height wrapper (`min-h-[76px] flex flex-col justify-center`). Eliminates form reflow and vertical displacement of submit buttons during async runtime configuration resolution.
- **Teams & Standings Skeleton Refinement** (`src/pages/Teams.tsx`):
  Replaced plain-text loading fallbacks with structural multi-card skeleton containers matching standings panel dimensions (`min-h-[480px]`), preventing layout shifts during query execution on `/teams`.
- **Router Suspense Layout Reservation** (`src/App.tsx`):
  Upgraded `<RouteFallback />` to enforce full page container height (`min-h-[calc(100vh-8rem)]`), ensuring smooth lazy-route transitions across all application pages.

### Updated — Repository Documentation Alignment

- **README & Omni-Recall Sync** (`README.md`, `omni-recall/`):
  Updated version metadata (v1.3.0 / 2026-07-22), added zero-shift Web Vitals CLS performance targets, added Omni-Recall wiki correction ledger entry (`2026-07-22-web-analytics-cls-optimization.md`), and updated corrections index.

## [1.8.1] - 2026-07-21

### Fixed — Ops Media League Filter 500 & League Resolution Consolidation

- **League Slug→UUID Resolution — Single Source of Truth** (`src/worker/shared.ts`, `src/worker/index.ts`, `src/worker/routes/digest.ts`):
  Fixed the `/ops/list/media` 500 (Postgres `22P02` "invalid input syntax for type uuid") triggered by every league filter chip in the ops console. Frontends send `LEAGUE_REGISTRY` slugs (`wbl`/`sbbl`/`tgifbl`), but `league_id` columns are uuid FKs to `leagues.id`; the handler passed the slug straight into `.eq('league_id', slug)`. The same lookup was hand-rolled independently at 8 worker call sites — with drifted variants that silently degraded `GET /api/teams` (fetch-all-then-JS-filter) and silently nulled `league_id` on ingest writes. All 8 sites now call the shared `resolveLeagueId` / `resolveLeagueIdFilter` helpers exported from `src/worker/shared.ts`; unknown-league filters return the `LEAGUE_NO_MATCH` sentinel → explicit zero rows (visible empty state), never a crash or a silently-dropped filter.
- **Consolidated call sites** (`src/worker/index.ts`): `handleOpsListMediaPublications`, `fetchPublicMediaRows`, `handleOpsPatchMediaPublications`, `handleTeamsList` (now filters DB-side by resolved UUID, including `mvw_standings`), POTG ingest validation, ingest publish, and game/event create. (`src/worker/routes/digest.ts`): weekly-digest facts, digest upsert, and public digest lookups.
- **Regression + guard tests** (`src/test/worker-league-filter-regression.test.ts`, `src/test/league-filter-guard.test.ts`):
  10 regression tests pin the incident's exact failure modes; a source-level guard fails CI if any worker file outside `shared.ts` hand-rolls a `.ilike('code', …)` league lookup again (this bug class was already point-fixed once in PR #567 and recurred).

## [1.8.0] - 2026-07-20

### Fixed — Vision Model Upgrade and E2E Stabilization

- **Vision Model Upgrade** (`src/worker/index.ts`):
  Migrated the ingestion pipeline to use `qwen/qwen3.6-27b`, which is the active vision model on Groq (replacing the deprecated `llama-3.2-90b-vision-preview` that returned 502s).
- **POTG Auto-Categorization & Payload Hardening** (`src/worker/index.ts`, `src/pages/Ops.tsx`):
  Eliminated the 502 `groq_error` by passing pure base64 via `arrayBuffer() + btoa()` and defensively stripping `data:` URIs in the worker. Fixed `handleParsePotgImage` to dynamically categorize leagues (e.g., TGIFBL) via `inferPotgLeagueCode`.
- **Backend UUID Type Safety** (`src/worker/index.ts`, `src/components/OpsMediaLibrary/MediaMetadataSheet.tsx`):
  Fixed `PATCH /ops/media/publications/:id` to correctly inspect string payloads and resolve UUIDs from the DB. Sync component state utilizing `leagueCode` instead of the raw database UUID.
- **E2E Auth State Reset Resolution** (`src/contexts/AuthContext.tsx`):
  Introduced `lastUserIdRef` to detect same-user background token refreshes and bypass redundant `loading` state updates, preventing active page unmounting and transient state resets during test runs.
- **E2E Ingestion Stability** (`e2e/ops-media-tabs.spec.ts` and `e2e/ops-auth-ingest-harmony.spec.ts`):
  Switched file upload triggers to Playwright's native `filechooser` event listeners to prevent failures under parallel load.
- **Playwright CI Exclusions** (`playwright.config.ts`):
  Configured `testIgnore` to ignore live-production diagnostic tests (`potg-vision-test.spec.ts` and `check_iframe.spec.ts`) from CI execution to ensure a deterministic build gate.

### Changed — Universal PPV Pricing Update

- **Universal Live Stream Pricing** (`src/worker/index.ts`, `src/lib/auth/subscription.ts`, `src/components/LiveStreamPlayer.tsx`, etc.):
  Updated live stream pricing universally to $3.99 CAD ($3.99 per view).
- **Stripe & Preflight Alignment**:
  Updated the Stripe payment gateway `unitAmount` to 399 cents, preflight price `ppvPriceCad` config properties, pricing displays on all paywall pages, and corrected the unit test assertions to reflect $3.99 base price + 5% Alberta GST = $4.19 total.

## [1.7.0] - 2026-07-18

### Fixed — Chrome login block, CORS whitelisting, and CI guardrails

- **CORS Local Whitelisting** (`src/worker/index.ts` and `src/api-proxy-worker/index.ts`):
  Added `http://localhost:8080` to `ALLOWED_ORIGINS` to fix Google Chrome blocking OPTIONS preflight requests for local development.
- **Wrangler Configuration Guardrail**:
  Reverted `SUPABASE_PUBLISHABLE_KEY` in `wrangler.jsonc` to the placeholder to pass build-time security tests. Introduced a local `.dev.vars` file for secure local development credentials.

### Added — Supabase Cloud migration & Secure CSV Ingestion

- **Supabase Cloud Migration** (PR #552):
  Worker configuration migrated to Supabase Cloud, missing database migrations executed, and `v_ingest_reconciliation` view secured.
- **Secure CSV Upload Pipeline** (PR #553):
  Introduced typed ParseResult contract, modularized CSV route handlers, integrated RxDB local queueing in hooks, and resolved all 8 ESLint `no-explicit-any` typescript-strict violations.
- **Playwright Upgrade**:
  Upgraded Playwright to v1.60.0 to fix install hangs on Node 24.
- **Bun lock synchronization**:
  Synchronized `bun.lock` to fix Cloudflare frozen lockfile build errors.

## [1.6.0] - 2026-05-21

### Added — Self-hosted Supabase hardening & Kong CORS fixes

- **Self-hosted Supabase Docker Compose** (`sbbl-hq-selfhost/sbbl-hq-selfhost/`):
  Full production Docker Compose stack for self-hosted Supabase added in PR #513.
  Nested active root pattern established (`sbbl-hq-selfhost/sbbl-hq-selfhost/`)
  with `WARNING_NOT_ACTIVE_SELFHOST_ROOT.md` guard on the outer directory.

- **Secret rotation runbook** (`sbbl-hq-selfhost/docs/runbooks/supabase-clean-secret-rotation.md`):
  End-to-end runbook for rotating all Supabase self-hosted secrets safely without
  downtime. Added in feat(selfhost) — commit `47f46b1`.

- **Auth flow security audit** (`security: audit and harden self-hosted Supabase auth flow`):
  Four high-severity npm vulnerabilities patched. Kong auth routes hardened against
  header-injection. Auth flow tests added (`src/worker/tests/auth-audit.*.ts`).

- **Import History regex filter**: Regex-enabled search filter added to the Import
  History tab in the ops console (commit `ef98420`).

- **Cloudflare security insights remediation** (`ops/cloudflare/SECURITY_INSIGHTS_REMEDIATION.md`):
  Rate-limit rules and security insight remediations applied (commit `59ccea0`).

### Changed — Kong CORS (multiple fixes)

- **`fix(kong): add explicit CORS config to all auth routes`** (`e142674`):
  First pass — explicit CORS plugin blocks added to all auth services in kong.yml.
- **`fix(kong): allow x-supabase-api-version (+ Prefer, Range) in CORS preflight`** (`57d1891`):
  Added missing PostgREST headers to CORS allowlist.
- **`fix(kong): expand CORS allowed-headers in active nested kong.yml`** (PR #535, `8f9d76b`):
  Definitive fix — all 6 stale CORS header blocks in the nested active kong.yml
  expanded to full 20-header allowlist. Added `Accept-Profile`, `Cache-Control`,
  `Content-Profile`, `If-Match`, `If-Modified-Since`, `If-None-Match`, `Prefer`,
  `Range`, `X-Requested-With`, `x-supabase-api-version`, `x-upsert`.
- **`chore(selfhost): zero-tech-debt hardening pass`** (`eca9074`):
  Kong service hardened; duplicate YAML entrypoint key fixed; `.gitattributes`
  added to enforce LF line endings on shell scripts.
- **`fix(ci): split selfhost-auth-smoke into static + live jobs`** (`3a99987`):
  Selfhost auth smoke test split into static (always-pass) and live (environment-gated)
  jobs so CI does not fail in environments without a live Supabase host.

### Changed — Media intelligence overhaul (PRs #508, #520)

- Touch-first command center for ops media management.
- Media Library extracted into dedicated component & hook (PR #505).
- Publication lookups optimized (Bolt performance improvement).
- Pin-during-archive race window closed (commit `9557e4b`).

### Fixed
- Nested selfhost root drift repaired — outer `volumes/` completed to match active
  root (`f90b8ac`). Previously the outer directory was missing several volume dirs,
  causing confusion when navigating the repo.
- `.gitattributes` extended to cover Elixir scripts (`43b75d0`, `187b88c`).

---

## [1.5.0] - 2026-05-11

### Added — OmniBridge Integration (APEX-OmniHub bidirectional sync)

- **`POST /webhooks/omnihub`** (`handleOmnihubWebhook`) — new inbound command
  receiver from APEX-OmniHub control plane. Enforces:
  - HMAC-SHA256 signature verification via `OMNIHUB_VERIFY_KEY` (falls back to
    `OMNIHUB_SIGNING_SECRET` for shared-secret dev/staging).
  - 9-action allowlist: `disable_stream`, `enable_stream`, `revoke_access`,
    `grant_access`, `emergency_halt`, `broadcast_message`, `force_man_review`,
    `hotfix_dispatch`, `ping`.
  - `target_source === "sbbl-hq"` pin.
  - Clock-skew check (±300 seconds).
  - Idempotency dedup via `api_idempotency_keys` table.
  - Risk-lane re-classification — BLOCKED payloads (DROP TABLE, ALTER ROLE,
    DISABLE RLS, TRUNCATE, GRANT ALL PRIVILEGES) rejected regardless of signature.
  - Full audit trail via `log_admin_action` RPC.

- **`POST /api/omniport/command`** (`handleOmniportCommand`) — JWT-authenticated
  diagnostic surface for OmniHub operator sessions. Supported commands:
  `PING`, `ECHO`, `HEALTH_CHECK`, `TELEMETRY_SNAPSHOT`.

- **`deliverSyncEnvelope()`** — hardened outbound telemetry delivery with 4-attempt
  exponential backoff (0 / 250ms / 1s / 4s), 5-second per-attempt timeout, and
  4xx fast-fail (non-retryable target rejection).

### Changed
- **`handleSyncDrain()`** — now sends canonical `{ packet, signature }` envelope
  with required headers `X-Omni-Source`, `X-Omni-Signature`, `X-Omni-Packet-Id`,
  `X-Omni-Trace-Id` (fixes silent 400 rejection on OmniHub side).
- **`wrangler.jsonc`** — documented `OMNIHUB_VERIFY_KEY` with fallback semantics.

### Tests
- `src/worker/tests/omnihub-bridge.integration.test.ts` — 14 new integration tests
  covering all new/changed surfaces (header presence, signature failure, target
  mismatch, clock-skew, valid ping, BLOCKED payload, replay dedup, 401 unauth,
  PING, unsupported command, HEALTH_CHECK, sync drain envelope, 5xx retry, 4xx fast-fail).

---

## 2026-05-04 — v1.4.1 — Facebook Live playback via iframe embed

- **Facebook URLs now play** via the official `plugins/video.php` sandboxed iframe.
  Paste a `facebook.com/…/videos/…` or `fb.watch` URL into Broadcast Controls and
  it renders immediately — no SDK, no CSP violation, no advisory.
- **CSP** (`src/worker/index.ts`): `https://www.facebook.com` added to `frame-src`
  only. `connect.facebook.net` remains absent from `script-src` permanently.
- **Invariant preserved**: `isFacebook` early-return in `LiveStreamPlayer.tsx`
  is unchanged — ReactPlayer never sees a Facebook URL.
- **Tests updated**: `live-stream-player-regressions.test.ts` now asserts
  `plugins/video.php` iframe + `encodeURIComponent(url)`; `worker-ops-health.test.ts`
  asserts FB SDK blocked + `frame-src` allows `facebook.com`.

---

## 2026-04-29 — v1.4.0 — Live Player Hardening (BASELINE REFERENCE BUILD)

> **This is the canonical baseline build for the live-stream player.**
> Onboarding agents and devs MUST read this entry, the Live Player
> Invariants section in `CLAUDE.md`, and the runbook at
> `ops/runbooks/universal-ingest.md` before touching anything in
> `src/components/LiveStreamPlayer.tsx` or `src/lib/stream/`.

Closes a five-incident cascade caused by stale/invisible regressions in
the broadcast surface: a half-rendered player container, two orphaned
timers leaking the heartbeat closure for up to six hours, and a
silent CSP-trip on Facebook URLs that surfaced as a generic
"no supported sources" error with no admin-actionable hint.

### What landed

- **Layout fix** (`820949e`). Removed the conflicting
  `absolute inset-0 flex flex-col relative z-0` Tailwind classes on the
  Gate-2 wrapper of `LiveStreamPlayer.tsx`. Tailwind emitted
  `position: relative` last, collapsing the wrapper out of its absolute
  ancestor and rendering the iframe at min-height while the controls
  bar floated mid-canvas above empty black space.
- **Timer hygiene** (`fd4bf71`). The 6-hour session-cap `setTimeout` and
  the 3-second auto-retry `setTimeout` were started without retaining
  their handles. The cap timer pinned the heartbeat closure for up to
  six hours after navigation; the retry timer could call `setPlaying`
  on a torn-down `ReactPlayer`. Both now stored and cleared on unmount.
- **Unembeddable-URL bail** (`0cacfb1`). `StreamPlayer` now short-circuits
  before `ReactPlayer` mounts for `facebook | kick | instagram | x-spaces`
  URLs, mirroring the existing RTMP advisory pattern. ReactPlayer never
  attempts the `connect.facebook.net/sdk.js` load (intentionally blocked
  by CSP since `89d9696`), so the silent `FilePlayer` fall-through into
  "no supported sources" is gone.
- **Regression guards** (`de7c49f`). Added
  `src/test/live-stream-player-regressions.test.ts` — 11 cheap,
  deterministic source-level assertions that lock in every fix above.
  Mutation-tested by re-introducing each bug locally and confirming the
  relevant assertion failed before reverting.
- **Pipeline simulation** (`scripts/simulate-broadcast.ts`). New
  `npm run simulate:broadcast` walks every supported provider type
  (HLS / DASH / MP4 / YouTube / Twitch / Vimeo / WHEP / RTMP / Facebook /
  Kick / Instagram / X-Spaces / blob: / garbage) through the full
  ingest → playback pipeline (`canonicalizeStreamSourceUrl` →
  `detectStreamUrlType` → `toPlayableUrl` → `getStreamDeliveryClass` →
  `StreamPlayer` outcome) and asserts each scenario produces the right
  result. **19 / 19 scenarios pass** at v1.4.0; the script exits non-zero
  on any mismatch and is the canonical baseline reference.

### Validation gates green at release

| Gate | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` (max-warnings 0) | clean |
| `npm test` | 97 files, 1001 passed / 7 skipped / 0 failed in ~30s |
| `npm run build` | clean (PWA 81 entries / 1.7 MiB) |
| `npm run simulate:broadcast` | 19 / 19 scenarios pass |

### Required reading before changing the player

1. The **Live Player Invariants** HARD RULE in `CLAUDE.md` §1.5.
2. `src/test/live-stream-player-regressions.test.ts` — every assertion
   maps to a real production incident.
3. `ops/runbooks/universal-ingest.md` — the validation checklist.

---

## 2026-04-19 — v1.3.0 — Universal Stream Player, WHIP Ingest, Zero-Friction Broadcast

Closes the "paste any link → plays instantly; drop any local highlight → broadcast
it seamlessly" mandate and turns the admin console into a production-grade
broadcast cockpit.

- **Universal URL detector.** `src/lib/stream/url-detector.ts` now covers
  Twitch, YouTube, Vimeo, Facebook, Kick, Rumble, Dailymotion, X Spaces,
  Instagram Live, HLS (presigned/query-suffixed), DASH, WHEP, RTMP,
  direct MP4/m4v/mov/webm/ogg/ogv (including presigned S3/R2 variants),
  plus new `local` class for `blob:` / `data:video` / `file:` sources.
- **Origin-aware `crossOrigin` on the player.** `LiveStreamPlayer.tsx`
  sends credentialed CORS only to our own `*.sbbl-hq.icu` proxy endpoints
  (so the `sbbl_proxy_auth` cookie reaches hls.js) and anonymous CORS to
  every public CDN. `blob:`/`data:`/`file:` sources omit the attribute
  entirely. Fixes the silent CORS rejection that blocked league-highlight
  MP4s behind public buckets.
- **Twitch parent allow-list widened** to the union of the document host,
  `sbbl-hq.icu`, `www.sbbl-hq.icu`, and `localhost`. Prevents Twitch
  from refusing preview domains or the `www.` variant.
- **Browser-native WHIP ingest.** New `useWhipIngest` hook
  (`src/hooks/use-whip-ingest.ts`) publishes any `MediaStream` to a
  WHIP endpoint with sendonly transceivers, SDP offer/answer handshake,
  Location-header-driven cleanup, optional bearer token, and
  deterministic ICE gather (MediaMTX doesn't trickle). Covered by 6
  vitest cases with a fake `RTCPeerConnection`.
- **AdminStreamOverlay broadcast controls.** `/live` gear menu now has
  `Load Local File`, `Broadcast File` (via `HTMLVideoElement.captureStream()`),
  `Broadcast Camera` (via `navigator.mediaDevices.getUserMedia`), and
  `Stop Broadcast` with a live WHIP status chip. Blob URLs are revoked
  on reselect and on unmount to keep memory flat across admin sessions.
- **Caddyfile `/whip/*` proxy.** `ops/Caddyfile` mirrors the existing
  WHEP listener on MediaMTX port 8889 (WebRTC mux — ingest and egress
  share the same port). Adds OPTIONS preflight + policy headers.
- **Duplicate `containerReady` declaration removed** (TS2451 blocker on
  `LiveStreamPlayer.tsx`). Also collapses the duplicate tap-to-unmute
  overlay that rendered twice.
- **Playwright expect timeout raised** to 15 s in `playwright.config.ts`
  so Vite dev cold-compile on CI stops producing flaky `toBeVisible`
  failures on `/live`. Matches the convention already in
  `critical-paths.spec.ts` and `broadcast-overlay-flow.spec.ts`.
- **Eslint `.claude` ignore.** Subagent worktrees' `dev-dist/workbox-*.js`
  outputs no longer pollute lint reports.

Validation gates on 2026-04-19: typecheck clean · lint 0/0 · vitest
857 passed / 7 skipped / 0 failed · production build 61 s. PR #398 CI:
Unit & Integration Tests, Lint & Typecheck, e2e, Auth + Ingest + Render
Harmony, Full Build Chaos Battery, Build & Bundle Check, Supabase
Preview, and Workers Builds: sbbl-hq-worker — all green.

Full capability matrix + root-cause fix log in
[`ops/validation/STREAM_PLAYER_UNIVERSAL_E2E_2026-04-19.md`](ops/validation/STREAM_PLAYER_UNIVERSAL_E2E_2026-04-19.md).

## 2026-04-17 — v1.2.0 — Broadcast overlay, engagement, sponsors, AI digest, OBS control

Closes every gap called out in the investor-readiness research memo:

- **Scoreboard overlay** — new chromeless `/overlay/:gameId` route
  serves OBS as a 1920×1080 transparent browser source. Renders score,
  clock (ticks at 10 Hz between 1 s polls), period, fouls, timeouts,
  possession indicator, bonus flags, lower third, and sponsor bug.
- **Overlay control** — admin-only `/overlay-control/:gameId` console
  drives every scoreboard field: +1/+2/+3 scoring, -1 correction,
  start/stop/set clock, period advance, fouls, timeouts, possession,
  lower-third announce/hide, one-click reset, OBS command buttons.
- **Interactive engagement** — `/engage` page with three tabs: Polls &
  Trivia, Watch Parties, Leaderboard. Anonymous fans see results;
  signed-in fans cast votes (one per poll), earn gamification points
  when graded, and host/join watch parties via 6-char invite codes.
- **Sponsor overlay system** — `sponsor_slots` table + admin CRUD +
  public rotation (15 s deterministic slot) + impression/click
  tracking via `sponsor_impressions`.
- **AI weekly digest** — new `/digest` page backed by
  `ai_weekly_digest` cache keyed on `(league_id, week_start)`. Worker
  collects real facts from `games` + `player_game_stats`, calls Groq
  `llama-3.3-70b-versatile` when `GROQ_API_KEY` is set, falls back to
  a deterministic template otherwise. Per-league tabs (SBBL / WBL /
  TGIFBL).
- **OBS remote control** — queue-based bridge: web ops enqueues
  commands, on-site `obs-agent` pulls + acks via Bearer
  `OBS_AGENT_TOKEN`. Supports stream/record start/stop, scene switch,
  source visibility, filter toggle, text update, browser refresh.
- **Gamification leaderboard RPC** — `get_gamification_leaderboard`
  aggregates points per user with display name join.
- **Auto-overlay trigger** — `trg_ensure_overlay_state` creates an
  overlay row on every new `games` insert so the OBS source never
  404s on a fresh game.
- **Route registration tests** — 15 new assertions in
  `worker-overlay-engagement-routes.test.ts` guard the route table.

All new tables RLS-enabled with policies scoped to the live `app_role`
enum (`super_admin`, `league_admin`, `team_manager`, `media_operator`).

Migration `supabase/migrations/20260417100000_overlay_engagement_sponsor_digest.sql`
applied to project `ezanilxygnpucwkwpsoc` on 2026-04-17 — 10 tables
created, 17 existing games backfilled with overlay state rows, 1 RPC
and 1 trigger installed. Full validation evidence in
[`docs/features/BROADCAST_OVERLAY_ENGAGEMENT_v1.0.0.md`](docs/features/BROADCAST_OVERLAY_ENGAGEMENT_v1.0.0.md).

Gates on 2026-04-17: typecheck clean · lint 0/0 · vitest 745 passed ·
production build OK (4 new chunks).

## 2026-04-16 — v1.1.0 — Documentation Audit & Consolidation

- Audited every document in the repository root and under `docs/`.
- Removed superseded specs: `docs/features/STREAM_GATING_v1.4.0.md` (replaced by v1.5.0) and `docs/quality/LIVESTREAM_WORKFLOW_AUDIT_2026-04-04.md` (replaced by the 2026-04-09 integrity audit).
- Renamed unversioned architecture docs under `docs/architecture/` with standard `_vX.Y.Z.md` suffix:
  - `CANONICAL_DATA_PIPELINE` → `architecture/CANONICAL_DATA_PIPELINE_v1.0.0.md`
  - `COMPLETE_CODEBASE_MAP.md` → `architecture/COMPLETE_CODEBASE_MAP_v1.0.0.md`
  - `api_contracts.md` → `architecture/STORE_API_CONTRACTS_v1.0.0.md`
  - `store_architecture.md` → `architecture/STORE_ARCHITECTURE_v1.0.0.md`
- Renamed quality docs to include version suffix and added standard front-matter:
  - `LIVESTREAM_INGEST_BROADCAST_SYSTEM_INTEGRITY_AUDIT_2026-04-09.md` → `_v1.0.0.md`
  - `MEDIA_PUBLICATIONS_SORT_ORDER_MIGRATION_2026-04-16.md` → `_v1.0.0.md`
  - `PRODUCTION_ENV_VERIFICATION_2026-04-15.md` → `_v1.0.0.md`
- Added `<!-- Version | Date | Status -->` front-matter to all docs previously missing it.
- Rewrote `README.md` doc links — every target now points at an existing file at its current version.
- Rewrote `docs/README.md` master index — reflects actual on-disk file set, adds Agents section, links root-level policy docs (ONE_DEVICE, PAYWALL, RESUME, STREAM_TEST_STRATEGY).

## 2026-04-16 — v1.0-store-canonicalization-hardening

- Standardized the database schema on `store_products`, `store_orders`, and `custom_quote_requests`.
- Implemented robust server-side webhook syncing for store orders.
- Removed mock data paths from UI and properly fetched via Edge Workers.
- Enforced strict IDEMPOTENCY KEY propagation.
- Canonicalized internal API data maps.
