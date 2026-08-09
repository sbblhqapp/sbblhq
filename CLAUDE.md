# Claude / Agent Operating Guide â SBBL-HQ

Welcome. This document is the **single source of truth** for agents
working in this repo. Read it in full before your first edit.
<!-- Version: v1.8.0 | Date: 2026-07-20 | Status: Current -->

## How to update this guide

After any verified, merged workflow that reveals a permanent constraint,
hard-won invariant, or new incident pattern:

1. Add the rule to the numbered section it belongs to (new section needs owner approval).
2. Add an entry to **Incident history** with date, root cause, and file refs.
3. Update **Last verified** at the bottom to today's UTC date.
4. Commit the CLAUDE.md change in the **same PR** as the work it documents.

**Never defer CLAUDE.md updates.** Stale guides reproduce the exact incidents
this document was written to prevent.


## ð¨ HARD RULES â Do not break these

### 1. No mock data in production pages

**NEVER** import from `src/data/mock.ts`, `src/data/schedules.ts`, or
`src/data/teams.ts` anywhere under `src/pages/**`, `src/components/**`,
`src/hooks/**`, `src/contexts/**`, `src/worker/**`, or `src/lib/**`.

Those files are test fixtures. Importing them from production code has
repeatedly caused live-data outages to be invisible to users (the UI
silently renders fake players, scores, and products instead of failing).

**Use instead:** the `/api/public/*` worker endpoints. See
[`docs/protocols/no-mock-in-production.md`](docs/protocols/no-mock-in-production.md)
for the canonical endpoint table.

This rule is enforced by:

- **ESLint** `no-restricted-imports` (see `eslint.config.js`) â lint runs
  with `--max-warnings 0` in CI.
- **vitest** guard test (`src/test/no-mock-in-production.test.ts`).
- **CI** (`.github/workflows/ci.yml`) â both gates block merge.

If you see a test failure pointing at those files, **do not disable the
test**. Fix the import.

If you need league identity metadata (codes, names, colors, logos), use
`LEAGUE_REGISTRY` from `src/lib/leagues.ts`. It is the canonical source.

### 2. No `|| mockX` / `?? mockX` fallbacks

Do not write:

```ts
// â BANNED â silently hides pipeline outages.
const players = apiData && apiData.length > 0 ? apiData : mockPlayers;
const potg = apiPotg ?? playersOfTheGame;
```

Do write:

```ts
// â CORRECT â empty state is visible.
const players = Array.isArray(apiData) ? apiData : [];
```

Render an explicit empty-state UI when the array is empty. Never
substitute fixtures.

### 3. Public pages â public endpoints

If a page is anonymous-accessible (Stats, Leaderboards, Scores,
Schedules, Home, AppHome, Store, Teams), it must call a public worker
endpoint (`/api/public/*` or `/api/teams` / `/api/scores`). Endpoints
under `/api/stats`, `/api/leaderboards`, `/api/auth/*` etc. require auth
(`requireAuth(req)` in the worker) and **will 401 for anonymous users**,
silently killing the data flow.

Before wiring a page to a new endpoint, grep the worker for
`requireAuth(req)` in the handler. If present and the page is public,
use or add a `/api/public/*` variant instead.

### 4. Stream Independence Contract â streams are not games

**NEVER** couple `streams`, `stream_assignments`, or
`stream_entitlements` to a NOT-NULL `game_id`. Streams are first-class
addressable media resources; a game MAY have zero, one, or many streams
via `stream_assignments`. Entitlements gate `stream_id`; `game_id` is a
nullable legacy column retained for backward compatibility only.

Forbidden patterns (CI will block):

```sql
-- â BANNED â cements the coupling we removed.
ALTER TABLE streams ADD COLUMN game_id uuid NOT NULL;
ALTER TABLE stream_entitlements ALTER COLUMN game_id SET NOT NULL;
ALTER TABLE stream_assignments ALTER COLUMN game_id SET NOT NULL;
```

```ts
// â BANNED â reading games.stream_url from worker/frontend paths.
const url = game.stream_url;
```

Do instead:

```ts
// â CORRECT â resolve via stream_assignments / streams.
const { data } = await admin
  .from("stream_assignments")
  .select("streams(stream_url, source_platform)")
  .eq("game_id", gameId)
  .eq("is_active", true)
  .maybeSingle();
```

Before modifying any stream/ppv/entitlement code, **read**
[`docs/architecture/STREAM_INDEPENDENCE_CONTRACT.md`](docs/architecture/STREAM_INDEPENDENCE_CONTRACT.md).

This rule is enforced by:

- **CI AST gate** (`.github/workflows/stream-contract-gate.yml`) â pglast
  parser scans migration diffs for forbidden `NOT NULL` on `game_id`.
- **Armageddon test battery** (`src/test/armageddon-stream-invariants.test.ts`).
- **Vitest chaos battery** (`src/test/stream-chaos-battery.test.ts`).
- **Sentry alert** on `stream.access.v2` error rate > 0.1%.

### 5. Media Publications — Pin Before Archive, Two-Phase Cleanup

Pinned media CANNOT be archived (worker returns 409). Unpin before archiving.
Stale cleanup is two-phase: preview → confirm (type ARCHIVE) → execute.
The execute phase re-validates server-side (never trusts client-sent IDs).
Bulk archive uses bulk_archive_media_publications() RPC for true transactional atomicity.
updated_at is maintained by a BEFORE UPDATE trigger on media_publications.
Default media ordering is newest-first (created_at DESC), not sort_order ASC.
Already-archived IDs passed to bulk archive are silently skipped and not returned;
the response ids array contains only IDs that were actually transitioned.
### 6. Live Player Invariants — do not regress v1.4.0

The live-stream player (`src/components/LiveStreamPlayer.tsx`) is the
**single most regression-prone surface in the app**. v1.4.0 hardened it
after a five-incident cascade. The invariants below MUST hold:

#### 6.1 — Layout: never combine `absolute` with `relative` on the player wrapper

The Gate-2 wrapper must be:

```tsx
// CORRECT
<div className="absolute inset-0 flex flex-col z-0">
```

```tsx
// BANNED — Tailwind emits position:relative last; the wrapper drops
// out of its absolute-positioned ancestor, the iframe collapses to
// min-height, and the controls bar floats mid-canvas above empty space.
<div className="absolute inset-0 flex flex-col relative z-0">
```

`z-0` alone gives an absolute element its own stacking context.

#### 6.2 — Timers: every `setTimeout` / `setInterval` must be cleared on unmount

Both the **6-hour session-cap timer** and the **3-second auto-retry timer**
previously leaked closures for up to six hours after navigation. Every
new timer in the player MUST:

1. Capture the handle in a ref (component-scope) or local var (effect-scope).
2. Clear it in the effect cleanup (`return () => { ... }`).
3. Clear it before scheduling a replacement (no overlapping timers).

Pattern reference: `hardCapTimerId` and `autoRetryTimerRef` in `LiveStreamPlayer.tsx`.

#### 6.3 — Unembeddable URLs must bail before ReactPlayer mounts

Provider types that cannot play through ReactPlayer under our locked-down CSP
MUST short-circuit in `StreamPlayer` before ReactPlayer mounts:

| Type | Handling |
|---|---|
| `rtmp` | Advisory panel — browsers cannot decode RTMP. |
| `facebook` | **`plugins/video.php` iframe** — no FB SDK; `frame-src` allows `facebook.com`; `connect.facebook.net` remains blocked in `script-src`. |
| `kick`, `instagram`, `x-spaces` | Advisory panel — no public embed surface compatible with our CSP. |

Forbidden:

```ts
// BANNED — lets ReactPlayer mount, FB SDK trips CSP, FilePlayer
// fall-through reports "no supported sources" with no admin hint.
<ReactPlayer url={facebookUrl} />
```

Required:

```ts
// CORRECT — short-circuit before mount; Facebook rendered via sandboxed iframe.
if (isFacebook) return <FacebookIframeEmbed url={url} />;
```

#### 6.4 — `react-player` must be lazy-loaded

```ts
// CORRECT — each provider is a separate dynamic chunk; FB code
// never executes unless an FB URL is rendered (it isn't, per 5.3).
import ReactPlayer from 'react-player/lazy';
```

The bare `react-player` import is **lint-blocked** by
`no-restricted-imports` in `eslint.config.js`. Do not bypass.

### 7. Broadcast & Paywall System — single oracle, server-side gating

The broadcast/paywall system was hardened in PR #461 (and audited in PR
#462). Two latent bugs from #461 were fixed in migration
`20260504100000_hotfix_broadcast_paywall_audit.sql`. **Read both before
editing any of: `get_active_broadcast`, `redeem_ppv_invite`,
`create_stream_entitlement`, `can_user_view_stream`, `PaywallGate`,
`Live.tsx` broadcast query, or any `ppv_invites`/`stream_entitlements`
schema.**

#### 7.1 — `get_active_broadcast()` is the SINGLE access oracle

Non-admin clients MUST resolve broadcast state via the
`get_active_broadcast()` RPC. It returns:

```ts
{
  is_live:          boolean,
  stream_url:       string | null,  // null unless user may watch
  title:            string | null,
  active_game_id:   string | null,
  live_started_at:  string | null,
  requires_payment: boolean,        // show paywall (registered, no access)
  is_subscribed:    boolean,
  has_entitlement:  boolean,
  user_registered:  boolean,
}
```

**Forbidden:**

```ts
// BANNED — bypasses server-side stream_url gating; lets unpermitted
// users see the URL in dev tools and download the broadcast.
const { data } = await supabase
  .from('stream_admin_config')
  .select('collection_id')
  .single();
const url = data.collection_id;
```

**Required:**

```ts
// CORRECT — server decides whether to send the URL.
const { data: broadcast } = await supabase.rpc('get_active_broadcast');
if (broadcast.stream_url) play(broadcast.stream_url);
else if (broadcast.requires_payment) showPaywallGate();
```

Super-admin is the only role that may read `stream_admin_config.collection_id`
directly (via `fetchAdminStreamConfig`) for the broadcast control panel.

#### 7.2 — `can_user_view_stream` argument order: `(text, uuid)`

The published signature (per migration `20260402120000_ppv_invites_relax_game_id.sql`)
is `(p_game_id text, p_user_id uuid)`. **Multiple overloads exist** (the
older `(uuid, uuid)` from core_schema is still in the catalog).

Always use **named arguments** when calling from PL/pgSQL:

```sql
-- CORRECT
public.can_user_view_stream(
  p_game_id => v_game_id::text,
  p_user_id => v_user_id
);

-- BANNED — positional args silently bind to the wrong overload or
-- raise "function does not exist" at runtime (only when active_game_id
-- is set, which CI never exercises).
public.can_user_view_stream(v_user_id, v_game_id);
```

This was bug #1 of the post-merge audit.

#### 7.3 — `ppv_invites.game_id` is TEXT — never cast unconditionally

Per migration `20260402120000_ppv_invites_relax_game_id.sql`, the column
is `text` and may legitimately hold the literal string `'broadcast'` for
open-broadcast comp codes (admin generates them with no game bound).
`stream_entitlements.game_id` is still `uuid`.

**Forbidden:**

```sql
-- BANNED — throws invalid_text_representation for 'broadcast'.
SELECT public.create_stream_entitlement(
  v_invite.game_id::uuid,  -- explodes
  ...
);
```

**Required pattern** (used in `redeem_ppv_invite`):

```sql
DECLARE
  v_game_uuid       uuid;
  v_is_uuid_game_id boolean := false;
BEGIN
  v_game_uuid := v_invite.game_id::uuid;
  v_is_uuid_game_id := true;
EXCEPTION WHEN others THEN
  v_is_uuid_game_id := false;
END;

IF v_is_uuid_game_id THEN
  -- game-bound flow: create entitlement
ELSE
  -- open-broadcast flow: mark consumed, no entitlement row
END IF;
```

This was bug #2 of the post-merge audit.

#### 7.4 — `entitlement_status = 'active'` (never `'purchased'`)

`can_user_view_stream` filters on `status = 'active'`. The original
`create_stream_entitlement` inserted `'purchased'` — every PPV purchase
was silently rejected. Fixed in migration `20260504000200`. If you add a
new path that creates an entitlement, insert `'active'`.

The `'purchased'` value still exists in the enum for historical rows;
do **not** drop it (would require backfill + downtime).

#### 7.5 — Fan onboarding never sets `bio` or `avatar_url`

Use `complete_fan_onboarding(p_display_name, p_full_name, p_preferred_league)`
RPC. The function deliberately omits `bio` and `avatar_url` from its
INSERT/UPDATE. The `Onboarding.tsx` page hides those form fields when
`isFan === true`. Players and coaches still use `saveOnboarding()` which
collects bio + avatar.

If you add a fan-side form anywhere, **never** prompt for bio or avatar.
Do **not** call `saveOnboarding()` from a fan code path — it would write
empty strings or null overrides into player-only columns.

#### 7.6 — Admin `Go Live` MUST sync stream_sessions + stream_sources

The admin overlay's `handleGoLive()` writes `stream_admin_config` first
(unchanged), THEN calls `admin_sync_broadcast_to_sessions()` so the
viewer-facing tables have rows. Removing the second call recreates
bug A4/A5 (stream_sessions / stream_sources empty → viewer queries
return empty even after RLS fixes).

The sync call is intentionally non-fatal (try/catch) so a transient
sync failure cannot roll back the primary go-live action.

#### 7.7 — Paywall fallback game must honor server-granted access

`fallbackBroadcastGame` in `Live.tsx` activates when the camera-only
broadcast is live but no real game row exists. It MUST honor BOTH:

1. The legacy `hasBroadcastFallbackAccess` (privileged role check), AND
2. `broadcast?.stream_url != null` (server has granted access via
   `get_active_broadcast`).

Without #2, registered fans whose access was just granted server-side
see "No Active Broadcast" because `useLiveAccess` returns `'paywall'`
for broadcasts with no `active_game_id`. This was bug #3 of the audit.

#### 7.8 — `?intent=fan` must survive sign-in round-trips

The fan paywall flow depends on `?intent=fan` reaching `/onboarding` so
the form hides bio/avatar. Three round-trip points must preserve it:

| Surface | Where preserved |
|---|---|
| Anon paywall click → onboarding | `PaywallGate.onWatchClick` → `/onboarding?intent=fan&redirect=/live` |
| Onboarding (unauthenticated) → login | `Onboarding.tsx` Navigate URL embeds `intent` + `redirect` |
| Login (post-signin) → onboarding | `Login.tsx` `useEffect` reads `intentParam` and forwards |
| Google OAuth callback → app | `Login.tsx` `redirectTo` carries `intent` + `redirect` back to `/login` |

This was bug #4 of the audit (Google OAuth path was missed in PR #461).

#### 7.9 — Worker endpoints MUST mirror the DB oracle for open broadcasts (M-01)

**Root cause (M-01 audit, 2026-05-06):** `get_active_broadcast()` correctly
grants registered fans access to an open (camera-only) broadcast and returns
`stream_url`. But two worker endpoints independently denied those same fans,
producing a blank player screen with no error — the worst kind of silent
failure.

**`handleStreamAccess` (`GET /api/streams/broadcast/access`)**

For `gameId === 'broadcast'` do **not** call `can_user_view_stream`. That
function looks for `stream_entitlements` / `ppv_invites` rows, which do not
exist for registration-based open broadcasts.

```ts
// BANNED — silently returns { hasAccess: false } for all registered fans
// on open broadcasts because no entitlement row exists.
const result = await can_user_view_stream('broadcast', userId);
return { hasAccess: result };

// CORRECT — mirrors the DB oracle: any registered fan may watch.
if (gameId === 'broadcast') {
  const { data: cfg } = await admin.from('stream_admin_config').select('is_live').single();
  if (!cfg?.is_live) return { hasAccess: false };
  const { data: profile } = await admin.from('profiles')
    .select('onboarding_completed_at').eq('id', userId).single();
  return { hasAccess: profile?.onboarding_completed_at != null };
}
```

**`handlePlaybackSession` (`POST /api/streams/broadcast/session`)**

For `gameId === null` (the broadcast alias path), the privileged-role check
(`roles.includes('player') || roles.includes('paid_fan')`) is insufficient —
it excludes all regular registered fans.

```ts
// BANNED — hasAccess remains false for regular registered fans.
const hasAccess = hasPrivilegedRole;

// CORRECT — also grant access to registered fans (mirrors DB oracle).
const { data: profile } = await admin.from('profiles')
  .select('onboarding_completed_at').eq('id', userId).single();
const isRegisteredFan = profile?.onboarding_completed_at != null;
const hasAccess = hasPrivilegedRole || isRegisteredFan;
```

**Known tech debt (S1 — LOW):** `useLiveAccess.ts` reads `stream_admin_config`
directly at line 39 to obtain `active_game_id`. Per rule 6.1 this should come
from `get_active_broadcast()`, which already returns `active_game_id`. The hook
is chrome-only (guarded by `Live.tsx:1458`) so it is low risk, but it is a
tracked contract violation.

**Regression tests:** `src/test/worker-stream-hardening.test.ts` — 5 tests
covering the broadcast alias access paths for both handlers.

### Enforcement (all run in CI on every PR)

- **Source-level regression tests**:
  `src/test/live-stream-player-regressions.test.ts` (11 assertions,
  one per invariant above; mutation-tested).
- **Worker broadcast access tests**:
  `src/test/worker-stream-hardening.test.ts` (5 assertions for the open
  broadcast / `gameId === 'broadcast'` paths in `handleStreamAccess` and
  `handlePlaybackSession`).
- **Pipeline simulation**: `npm run simulate:broadcast` walks 19
  representative URLs through the full ingest pipeline. Add a scenario
  to `scripts/simulate-broadcast.ts` whenever you add a new provider
  type or a new branch in `StreamPlayer`.
- **ESLint** (`no-restricted-imports`): blocks bare `react-player`.
- **Vitest**: `src/test/live-page-*.test.tsx` covers each access-gate path.
- **Stream independence AST gate**: `.github/workflows/stream-contract-gate.yml`
  blocks any migration that adds `NOT NULL` to `game_id` on streams /
  stream_assignments / stream_entitlements.

If a regression test fails on your branch, **read the failing assertion**.
Each one maps to a real production incident from v1.3.x. Disabling the
test is never the right answer.

## §8 OmniBridge — APEX-OmniHub Integration (DO NOT DRIFT)

This section documents the bidirectional sync bridge between SBBL-HQ and
APEX-OmniHub, merged in PR #502. All rules below are permanent. Agents
MUST read this section before touching any code in or adjacent to
`handleOmnihubWebhook`, `handleOmniportCommand`, `deliverSyncEnvelope`,
or `handleSyncDrain`.

### 9.1 — New endpoints (PR #502)

#### `POST /webhooks/omnihub` — `handleOmnihubWebhook`

Inbound command receiver from the APEX-OmniHub control plane.

**Authentication:** HMAC-SHA256 via `OMNIHUB_VERIFY_KEY` (falls back to
`OMNIHUB_SIGNING_SECRET` in dev/staging when `OMNIHUB_VERIFY_KEY` is
absent). Clock-skew window: ±300 seconds.

**Envelope shape:**

```ts
{
  packet: SyncPacket,
  signature: base64url(HMAC-SHA256(secret, JSON.stringify(packet)))
}
```

Required inbound headers:
- `X-Omni-Source` — must equal `"sbbl-hq"` (`target_source` pin)
- `X-Omni-Signature` — base64url HMAC-SHA256 of the serialized packet
- `X-Omni-Packet-Id` — used as the idempotency key stored in `api_idempotency_keys`
- `X-Omni-Trace-Id` — propagated in logs and audit records

**9-action allowlist** (HARD RULE — no additions without repo owner approval):

```
disable_stream
enable_stream
revoke_access
grant_access
emergency_halt
broadcast_message
force_man_review
hotfix_dispatch
ping
```

Any action not on this list is rejected with `400 action_not_allowed`.

**Risk-lane re-classification:** Payloads whose content matches
BLOCKED-lane patterns (e.g., `DROP TABLE`, `ALTER ROLE`, `DISABLE RLS`,
`TRUNCATE`, `GRANT ALL PRIVILEGES`) are rejected even if the HMAC
signature is valid. This check runs BEFORE any action dispatch.

**Idempotency:** The `X-Omni-Packet-Id` value is stored in
`api_idempotency_keys` on first processing. Replayed packet IDs return
`200 already_processed` without re-executing the action.

**Audit:** Every accepted command is written via `log_admin_action` RPC.

#### `POST /api/omniport/command` — `handleOmniportCommand`

JWT-authenticated diagnostic surface for OmniHub operator sessions.

**Authentication:** Standard Supabase JWT (`requireAuth`). No HMAC.

**Supported commands:**

| Command | Description |
|---|---|
| `PING` | Liveness check — returns `{ ok: true, ts: <ISO timestamp> }` |
| `ECHO` | Returns the request payload verbatim |
| `HEALTH_CHECK` | Returns worker health snapshot |
| `TELEMETRY_SNAPSHOT` | Returns recent QoE/telemetry metrics |

Any other command returns `400 unsupported_command`.

### 9.2 — Outbound sync: `handleSyncDrain` + `deliverSyncEnvelope`

`handleSyncDrain` (`POST /sync/drain`) sends a canonical envelope to
`OMNIHUB_SYNC_URL`:

```ts
// Envelope shape
{ packet: SyncPacket, signature: base64url(HMAC-SHA256(OMNIHUB_SIGNING_SECRET, JSON.stringify(packet))) }

// Required outbound headers
X-Omni-Source:     "sbbl-hq"
X-Omni-Signature:  <base64url HMAC>
X-Omni-Packet-Id:  <packet.id>
X-Omni-Trace-Id:   <trace id>
```

`deliverSyncEnvelope()` implements a 4-attempt exponential-backoff
delivery loop:

| Attempt | Delay before retry |
|---|---|
| 1 (initial) | — |
| 2 | 250 ms |
| 3 | 1 s |
| 4 | 4 s |

Per-attempt timeout: 5 seconds. 4xx responses are treated as fast-fail
(non-retryable target rejection — do not retry on client errors).

### 9.3 — Required Cloudflare Worker secrets

| Secret | Purpose |
|---|---|
| `OMNIHUB_SIGNING_SECRET` | HMAC key used to sign outbound sync envelopes (required) |
| `OMNIHUB_SYNC_URL` | OmniHub endpoint to deliver outbound packets (required) |
| `OMNIHUB_VERIFY_KEY` | HMAC key used to verify inbound OmniHub commands (production) |

**Fallback rule:** When `OMNIHUB_VERIFY_KEY` is absent (dev/staging),
the worker falls back to `OMNIHUB_SIGNING_SECRET` as the verification
key. This allows a shared-secret dev/staging setup without requiring a
separate key pair.

### 9.4 — HARD RULES (enforce in every review)

- **NEVER** bypass the 9-action allowlist. If a new action is needed,
  add it explicitly to the allowlist with repo owner approval.
- **NEVER** skip the idempotency check. Every inbound OmniHub command
  must be checked against `api_idempotency_keys` before execution.
- **NEVER** skip the HMAC verify step. A missing or invalid
  `X-Omni-Signature` must always result in a `401` rejection, regardless
  of the command.
- **NEVER** process a BLOCKED-lane payload even if the signature is
  valid. Risk-lane rejection happens before action dispatch.
- **NEVER** remove or weaken the `target_source === "sbbl-hq"` pin.

### 9.5 — Integration tests

`src/worker/tests/omnihub-bridge.integration.test.ts` — 14 tests
covering all new/changed surfaces:

- Header presence validation
- Signature failure rejection
- Target mismatch (`target_source` pin)
- Clock-skew rejection (>300 s)
- Valid `ping` dispatch
- BLOCKED payload rejection
- Replay dedup (idempotency)
- 401 unauthenticated
- PING command
- Unsupported command
- HEALTH_CHECK
- Sync drain envelope shape
- 5xx retry (backoff triggered)
- 4xx fast-fail (no retry)

All 14 tests must pass before merging any change to OmniBridge surfaces.

---

### 8. Broadcast Stream Independence — HARD FREEZE, DO NOT TOUCH

**This is a hard owner rule. The broadcast stream is a standalone media
resource owned exclusively by the operator. It is NEVER tied to a game,
a PPV entitlement, or any other entity.**

The following invariants are permanent. No agent, PR, or migration may
violate them without explicit written approval from the repo owner:

#### 8.1 — `/api/broadcast/*` is frozen to agents

The route family `POST /api/broadcast/access`, `POST /api/broadcast/session`,
`POST /api/broadcast/session/heartbeat`, and `POST /api/broadcast/session/end`
are **off-limits for modification** unless the repo owner explicitly directs
a change. Do not:

- Add `game_id`, `gameId`, or any game parameter to these routes.
- Add PPV, entitlement, or invite-code logic to these routes.
- Rename or move these routes.
- Add authentication layers beyond the existing `requireAuth`.

#### 8.2 — Broadcast access = registration only

The only requirement to watch a broadcast is a completed SBBL HQ account
(`onboarding_completed_at IS NOT NULL`). There is no PPV, no game
entitlement, no `can_user_view_stream` call, and no `stream_entitlements`
row involved. This is intentional.

#### 8.3 — `LiveStreamPlayer` must route `game.id === 'broadcast'` to `/api/broadcast/*`

When `game.id === 'broadcast'`, all session API calls in `LiveStreamPlayer.tsx`
MUST target the canonical broadcast endpoints:

```ts
// CORRECT
const endpoint = game.id === 'broadcast'
  ? '/api/broadcast/session'
  : `/api/streams/${game.id}/session`;
```

Do NOT route the broadcast alias through `/api/streams/broadcast/*`. The
legacy alias routes exist only for backward compatibility and are not
guaranteed to remain.

#### 8.4 — No further modifications without owner approval

If you are an agent reading this: **stop**. Do not plan, propose, or
implement any change to the broadcast stream system unless the operator
has explicitly asked for it in this session. Adding "improvements",
"additional access control", or "game-binding features" to the broadcast
path will break live events and is not authorized.

### 10. League identifiers — resolve slugs through the shared resolver

Frontends send app-level league slugs (`wbl` / `sbbl` / `tgifbl`, the
`LEAGUE_REGISTRY` ids), but every `league_id` column is a uuid FK to
`leagues.id`. Passing a slug straight into a `league_id` filter makes
Postgres throw `22P02 invalid input syntax for type uuid` → 500
(2026-07-21 `/ops/media` incident, PR #571).

**Forbidden** (CI guard `src/test/league-filter-guard.test.ts` blocks the
lookup variant; the raw-slug variant is the incident itself):

```ts
// ❌ BANNED — raw client value into a uuid column.
query.eq('league_id', url.searchParams.get('leagueId'));

// ❌ BANNED — hand-rolled lookup; 8 drifted copies caused this incident.
const { data } = await admin.from('leagues').select('id').ilike('code', slug).maybeSingle();
```

**Required** — import from `src/worker/shared.ts`:

```ts
// Write paths (body.leagueId): UUID pass-through, else code → name lookup.
const leagueUuid = await resolveLeagueId(admin, raw);        // null = unknown

// List/filter paths (?leagueId=): null = no filter requested.
const filter = await resolveLeagueIdFilter(admin, raw);
if (filter === LEAGUE_NO_MATCH) return json({ ok: true, data: [] }); // zero rows, visibly
if (filter) query = query.eq('league_id', filter);
```

Never drop the filter and return unfiltered rows, and never silently null
a `league_id` you failed to resolve — both are the silent-degradation
pattern rule 1/2 exists to prevent.

### 11. Canonical remote + operator credential loading

**Canonical remote (since 2026-08-09): `https://github.com/sbblhqapp/sbblhq`.**
The former `apexbusiness-systems/sbbl-hq` is an **archive**. Full context:
[`docs/ops/REPO_MIGRATION_2026-08-09.md`](docs/ops/REPO_MIGRATION_2026-08-09.md).

#### 11.1 — Pre-migration PR/issue permalinks stay pointed at the archive

The import carried git history only. Pull requests and issues were **not**
migrated (the new repo has zero PRs). Do not "modernize" historical PR links —
rewriting `…/apexbusiness-systems/sbbl-hq/pull/439` to the new slug produces a
404. New links use the new slug; historical ones stay.

#### 11.2 — A repo migration is never a reason to touch Cloudflare

The Worker (`sbbl-hq-worker`), account, zone (`sbbl-hq.icu`), and custom domains
are not keyed to the GitHub repository. `wrangler.jsonc` required **no** change.
The Worker name rule at the top of `wrangler.jsonc` still stands absolutely.

What a migration *does* invalidate: **GitHub Actions secrets are never carried by
an import.** A fresh repo has zero, and `deploy.yml` hard-fails on a missing
`SUPABASE_SERVICE_ROLE_KEY`. Re-provision before expecting a green deploy.

#### 11.3 — All `scripts/` credential loading goes through `scripts/lib/sbbl-env.ts`

Do not hand-roll `fs.readFileSync(envPath)` + a regex in a new script. Two
non-obvious behaviours in the shared loader are load-bearing:

```ts
// CORRECT
import { loadSbblCredentials, resolveTargetEmail } from './lib/sbbl-env';
const creds = loadSbblCredentials();
```

```ts
// ❌ BANNED — the operator ENV file is Markdown, so underscores arrive
// backslash-escaped (`SUPABASE\_URL=`, `sk\_live\_…`). This regex never
// matches, and the script exits "Failed to parse credentials" having done
// nothing. All four scripts/ entrypoints shipped broken this way.
const url = envContent.match(/SUPABASE_URL=(https:\/\/[^\s]+)/);
```

`SBBL_ENV_FILE`, when set, **outranks ambient `process.env`**. An explicitly
named credential file is a deliberate operator choice and must beat whatever is
exported in the shell — see the 2026-08-09 incident below.

#### 11.4 — Regular admin means `league_admin`, and the grant must revoke `super_admin`

Use `scripts/grant-regular-admin.ts` (email via argv or `ADMIN_EMAIL`). A
"regular admin" grant is not complete until any existing `super_admin` row in
`user_role_assignments` is deleted — upserting `admin_email_grants` alone leaves
a previously-escalated account escalated. `scripts/verify-deployment.ts` exits
non-zero if `super_admin` survives, and is the check to run after any grant.

### 12. Regular-admin (`league_admin`) permission model — OWNER-DEFINED

**This matrix is an owner rule. Do not widen or narrow it without approval.**
Enforced by `src/test/regular-admin-permissions.test.ts`.

The Ops Console is a **`league_admin` surface, not a `super_admin` one**. It was
previously gated on `roles.includes('super_admin')` end-to-end, which made
`league_admin` a role that could sign in and see only "Access denied".

| Surface | `league_admin` | Gate |
|---|---|---|
| Scores, schedules, stats, players, teams | ✅ | `requireOpsAdminSession` |
| CSV / roster / image imports, POTG | ✅ | `requireOpsAdminSession` |
| Media library + generic media publish | ✅ | `requireOpsAdminSession` |
| **Store media upload & product edit** | ❌ | `requireSuperAdminSession` |
| **Live-PPV controls** (stream config, go-live, access override, PPV revenue) | ❌ | `requireSuperAdminSession` |
| PPV comp codes | ⚠️ **max 5 / rolling 24h** | `requireOpsAdminSession` + cap |
| Coach-request approval, role grants | ❌ | `requireSuperAdminSession` |

#### 12.1 — `requireOpsAdminSession` is narrower than `requireAdminSession`

```ts
// ✅ CORRECT — content ops. Admits league_admin + super_admin ONLY.
const session = await requireOpsAdminSession(ctx.req, ctx.admin);
```

```ts
// ❌ BANNED on league-wide writes — requireAdminSession also admits
// `team_manager`, who is scoped to a single team and must never rewrite
// another team's roster or post league-wide results.
await requireAdminSession(ctx.req, ctx.admin);
```

#### 12.2 — Store tables escalate on the SHARED CRUD path

`handleOpsPatch` / `handleOpsDelete` are generic over a table name. They must go
through `requireTableWriteSession`, which escalates to super-admin for
`STORE_ONLY_TABLES`. Calling `requireOpsAdminSession` directly in those helpers
silently re-opens store editing to every regular admin.

#### 12.3 — The comp-code cap is a ROLLING window, and that is the point

5 codes per **rolling 24 hours**, counted as `ppv_invites` rows where
`generated_by = caller AND is_comp = true AND created_at >= now() - 24h`.

A rolling window is what makes the allowance **non-compounding** — an unused day
never banks extra codes. Do not "simplify" this to a calendar-day counter or a
stored per-day balance; both let an admin accumulate well past 5. Over-cap
requests return `429 comp_code_daily_limit_reached`. Super admin is uncapped.

Regular admins may list only the comp codes they generated themselves; the full
comp ledger stays a super-admin view.

### 13. Ops Console — no raw UUIDs, ever, in a form a regular admin can reach

**Owner rule (2026-08-09).** Every Manual Ops create/delete/suspend/merge form
must resolve identifiers automatically. An operator without database access
must never be asked to paste a League/Season/Division/Team/Player/Event/
Schedule-slot ID.

```tsx
// ❌ BANNED — the exact pattern this rule replaced.
<input placeholder="League ID (UUID) *" value={form.leagueId}
  onChange={e => setForm(f => ({ ...f, leagueId: e.target.value }))} />
```

```tsx
// ✅ CORRECT — League submits the LEAGUE_REGISTRY slug (same pattern the
// POTG form already used); Season/Division/Team/Player/Event/Schedule use
// the components in src/pages/Ops.tsx (LeagueSelect, SeasonSelect,
// DivisionSelect, TeamSelect, PlayerSelect, EventSelect, ScheduleSelect),
// backed by /ops/bootstrap `references` and the /ops/list/* endpoints.
<LeagueSelect value={form.leagueId} onChange={(slug) => setForm(f => ({ ...f, leagueId: slug }))} />
```

#### 13.1 — League fields send a SLUG, never a UUID picked by the frontend

`leagueId` submitted by every Ops form is the `LEAGUE_REGISTRY` slug
(`'wbl'`/`'sbbl'`/`'tgifbl'`), resolved server-side via `resolveLeagueId`
(rule 10). Season/Team dropdowns need the league's real UUID only to
client-side FILTER their own options (`leagueUuidForSlug` in `Ops.tsx`) — that
UUID is derived, never typed or displayed.

#### 13.2 — `handleImportRoute`'s `INGEST_CONFIGS` must resolve `league_id` through `fetchLeagueMap`, not pass it through raw

Every `resolvePayload` in `INGEST_CONFIGS` (teams/players/schedules/events)
must consume the `leagueMap` argument. Before 2026-08-09, `players`/
`schedules`/`events` silently ignored it and passed `row.league_id` straight
through — a live rule-10 violation nobody caught until this audit. See
`fetchLeagueMap`'s doc comment in `src/worker/routes/ops-upload.ts` for the
original bug (case-sensitive `.in("code", …)` against uppercase-stored codes).

#### 13.3 — Create Player has no UUID to require

`POST /ops/players/find-or-create` (`handleOpsFindOrCreatePlayer`) reuses
`resolvePotgPlayer` — the same name-based find-or-create already proven by
Roster Import and POTG ingest. There is no "search for an existing user"
endpoint and none should be added for this form; find-or-create by display
name is the contract. Do not resurrect a raw `user_id` field on Create Player.

**Enforcement:** `src/test/ops-console-uuid-free.test.tsx` (real DOM render,
proves League→Season filtering actually resolves and Create Player never
calls the old `manualOpsAction('player','create',{userId})` contract) and
`src/test/worker-league-code-import-fix.test.ts` (real handler calls proving
`fetchLeagueMap` resolves case-insensitively). Both suites are mutation-tested
— see the incident entry below for the exact regressions each one catches.

## Architecture at a glance

```
React (src/)
  âââ src/pages/**             â page-level components; fetch via react-query
  âââ src/components/**        â shared UI; never fetch directly
  âââ src/lib/api/**           â thin API client wrappers
  âââ src/lib/leagues.ts       â LEAGUE_REGISTRY (canonical branding)

Cloudflare Worker (src/worker/index.ts, src/worker/routes/*)
  âââ requireAuth(req)          â throws on missing x-sbbl-user-id-verified
  âââ admin = getAdminClient()  â Supabase service-role
  âââ route table at bottom     â append new routes here

Supabase
  âââ tables                    â players, teams, games, leagues, seasons,
  â                               player_game_stats, store_products,
  â                               media_publications, â¦
  âââ RPCs                      â get_stats_dashboard, get_leaderboards,
  â                               mark_order_paid, finalize_game_stats, â¦
  âââ migrations                â supabase/migrations/*.sql (date-prefixed)
```

Data flow for any page:

1. Page calls `useQuery(apiFetch('/api/public/X'))`.
2. Worker handler runs Supabase query (service role â RLS-free).
3. Handler returns `{ ok, data }` with edge cache headers.
4. Page renders the array. Empty = visible empty state.

## Skills & Commands

This project includes 7 APEX skills and 1 project context profile in
`.claude/skills/`. Each skill has YAML frontmatter with `name`,
`description`, and `triggers` for auto-discovery. See
[`.claude/README.md`](.claude/README.md) for the full skill map.

**Available slash commands:**
- `/project:apex-power` — Activate APEX-POWER-20X execution protocol
- `/project:debug` — Activate 8-phase debug protocol
- `/project:qa-gate` — Run zero-trust QA verification matrix

**Skill hierarchy:**
```
apex-power (meta-skill) → omnidev-v2 | apex-master-debug | apex-frontend
                        → apex-omnitest | apex-memory | apex-qa
sbbl-agent (project context) → domain awareness for all skills
```

## Common tasks

### Add a new public data surface

1. **Worker**: add a handler in `src/worker/index.ts` (no `requireAuth`);
   register in the route table; set `Cache-Control` to
   `public, s-maxage=30, max-age=15` (or similar).
2. **API client**: add the wrapper in `src/lib/api/public.ts`.
3. **Page**: fetch via `useQuery`; no fallback; render empty state.
4. **Docs**: add the endpoint to
   `docs/protocols/no-mock-in-production.md`.

### Modify a Supabase RPC

1. Add a new dated migration under `supabase/migrations/` (NEVER edit
   an existing one â they are immutable once merged).
2. Update the worker handler if the response shape changes.
3. Update the frontend type and its consumers.

## Validation gates (all required green)

```
npm run typecheck   # strict TS across app + node configs
npm run lint        # ESLint with zero-warning policy
npm test            # vitest unit+integration suite
npm run build       # production build (vite)
```

CI runs all of these. Do not merge red.

## Incident history (relevant to this guide)

- **2026-08-09** — Ops Console UUID-elimination + a live rule-10 violation
  found in the audit. The Manual Ops forms (Teams/Players/Schedules/Events)
  required regular admins to paste raw League/Season/Division/Team/Player/
  Event/Schedule-slot UUIDs with no way to look one up — the operator-reported
  trigger was `statssbbl@gmail.com` unable to use the console at all. Audit
  also found `handleImportRoute`'s `players`/`schedules`/`events` configs
  silently ignored the `leagueMap` argument passed to `resolvePayload` and
  wrote `row.league_id` straight through — meaning a typed league code (or,
  for `schedules`, ANY non-UUID value, since `scheduleRowSchema.league_id` was
  `.uuid()`-strict) either 422'd or landed unresolved. Separately, the existing
  `fetchLeagueMap` helper backing `teams`/`scores` did `.in("code",
  uniqueCodes)` — case-sensitive exact match against uppercase-stored codes —
  so a typed lowercase code (`"wbl"`) never matched and the raw string fell
  into a `uuid` column (would 22P02 in production; masked in dev because the
  fallback silently accepted the unresolved string). This is the same failure
  class as the 2026-07-21 league-filter incident, just on the write path
  instead of the read path. Root-caused this time by a proactive audit, not a
  production 500. Fix: `fetchLeagueMap` rebuilt on the canonical
  `resolveLeagueId`; all four `INGEST_CONFIGS` entries now actually consume
  `leagueMap`; `scheduleRowSchema`/`eventRowSchema`/`playerRowSchema.league_id`
  loosened from `.uuid()` to accept a code; new `POST
  /ops/players/find-or-create` (reuses `resolvePotgPlayer`) replaces the raw
  `user_id` Create Player field; new `GET /ops/list/schedules` and joined
  display names on `GET /ops/list/players` back the new pickers. See rule
  **13**. Verified via mutation testing: 4 separate deliberate breaks (gate
  role check, comp-code cap comparison, `STORE_ONLY_TABLES`, and here
  `leagueUuidForSlug`/`fetchLeagueMap`) each produced a distinct, correctly-
  scoped test failure before being reverted — not just "tests are green."

- **2026-08-09** — Repo migration to `sbblhqapp/sbblhq` + near-miss write to the
  wrong Supabase project. Two latent defects surfaced while migrating the remote
  and granting `statssbbl@gmail.com` regular admin. (1) **Every script in
  `scripts/` was inert.** All four parsed the operator ENV file with regexes like
  `/SUPABASE_URL=…/`, but that file is Markdown — underscores arrive escaped
  (`SUPABASE\_URL=`, `sbp\_badb…`), so no pattern ever matched and each script
  exited "Failed to parse credentials" before doing any work.
  `scripts/push-via-link.ts` additionally matched `SUPABASE_TOKEN=`, a key that
  does not exist in the file at all. (2) **Ambient env silently retargeted the
  database.** The first grant run resolved to an unrelated Supabase project
  instead of the SBBL one, because a stray `SUPABASE_URL` exported in the shell
  outranked the explicitly-supplied ENV file. It failed safely only by luck —
  that project has no `admin_email_grants` table. Fix: single loader
  `scripts/lib/sbbl-env.ts` (Markdown de-escaping + `SBBL_ENV_FILE` outranks
  `process.env`), all four scripts migrated, target email parameterized. Also
  re-provisioned 17 Actions secrets, which a GitHub import never carries.
  See rule **11** and
  [`docs/ops/REPO_MIGRATION_2026-08-09.md`](docs/ops/REPO_MIGRATION_2026-08-09.md).

- **2026-07-21** — League-resolution consolidation (PR #571): every league
  filter chip on `/ops/media` returned 500. Root cause: `handleOpsListMediaPublications`
  passed the frontend league slug (`tgifbl`) straight into `.eq('league_id', slug)`
  on a uuid column → Postgres `22P02`. Audit found the slug→UUID lookup hand-rolled
  at **8** worker call sites with drifted behavior: `GET /api/teams` silently degraded
  to fetch-all-then-JS-filter; POTG/ingest/game-create write paths silently nulled
  `league_id`; PR #567 had already point-fixed the same class once in the PATCH
  handler, proving point fixes don't stick. Fix: single `resolveLeagueId` /
  `resolveLeagueIdFilter` (+ `LEAGUE_NO_MATCH` sentinel) in `src/worker/shared.ts`,
  all 8 sites migrated (`src/worker/index.ts`, `src/worker/routes/digest.ts`).
  See rule **10**, `src/test/worker-league-filter-regression.test.ts`, and the
  CI guard `src/test/league-filter-guard.test.ts`.

- **2026-07-20** — PPV Pricing Update: Stream purchase and preflight pricing changed from $4.99 CAD to $3.99 CAD universally. Changed stripe unit amount, constant values, JSX rendering, and updated test suite assertions (handling $3.99 + 5% GST = $4.19 total).

- **2026-07-20** — Transient loading/reset in E2E: Background Supabase token refreshes triggered `onAuthStateChange` with `SIGNED_IN`, setting `loading = true` unconditionally and unmounting route guards. This destroyed E2E inputs and caused flaky failures under load. Fix: introduced `lastUserIdRef` in `AuthContext.tsx` to detect same-user token refreshes and bypass the loading state trigger. Also, updated file upload specs to wait for native `filechooser` events, and ignored diagnostic production tests in `playwright.config.ts`.

- **2026-07-18** — CORS-01: Google Chrome login CORS block. Vite dev server port was configured to 8080, but workers whitelisted only 5173. Chrome blocked preflight OPTIONS requests, preventing login. Fix: whitelisted localhost:8080 in both main worker and api-proxy-worker.

- **2026-07-17** — K-03: ESLint strict errors block CI in CSV upload. CSV upload pipeline had multiple strict typescript-strict rule violations. Fix: resolved all 8 lint errors, modularized CSV route handler, and established ParseResult type safety.

- **2026-07-17** — K-02: Broken login due to config placeholder. Reverting the publishable key in wrangler.jsonc to pass CI security guardrails broke local development because the client fetched the placeholder. Fix: reverted key in wrangler.jsonc to pass CI, and separated credentials into local git-ignored .dev.vars.

- **2026-05-21** — K-01: Kong CORS browser login failure. Six stale CORS header
  allowlists in the active nested Kong config
  (`sbbl-hq-selfhost/sbbl-hq-selfhost/volumes/api/kong.yml`) were missing
  `Accept-Profile`, `Cache-Control`, `Content-Profile`, `If-Match`,
  `If-Modified-Since`, `If-None-Match`, `Prefer`, `Range`, `X-Requested-With`,
  `x-supabase-api-version`, and `x-upsert`. Browser preflight OPTIONS requests
  for login/signup returned 400/forbidden, blocking all auth flows. Root cause:
  the outer `kong.yml` received CORS updates but the nested active config was
  not synced. Fix: patched all 6 blocks in PR #535. See §9 and
  `sbbl-hq-selfhost/sbbl-hq-selfhost/ACTIVE_SELFHOST_ROOT.md`.

- **2026-05-16** — S-01: Self-hosted Supabase auth audit. Four high-severity
  npm vulnerabilities patched; auth flow hardened against header-injection;
  CORS preflight added explicitly to all auth routes in Kong. Secret rotation
  runbook added at
  `sbbl-hq-selfhost/docs/runbooks/supabase-clean-secret-rotation.md`.

- **2026-05-06** — M-01: Open broadcast fan-view gap. Registered fans who
  passed the `get_active_broadcast()` oracle (which correctly returned
  `stream_url`) still saw a blank player because two worker endpoints
  independently denied them: `handleStreamAccess` called
  `can_user_view_stream('broadcast', userId)` (no entitlement rows exist for
  registration-based open broadcasts → always `false`); `handlePlaybackSession`
  gated on `hasPrivilegedRole` (player/paid_fan only). Both handlers were fixed
  to mirror the oracle — grant access to any user whose
  `profiles.onboarding_completed_at IS NOT NULL`. See rule **6.9** and
  `src/test/worker-stream-hardening.test.ts`.


- **2026-04-16** â Live data regression. Store/Leaderboards/Scores/
  Stats/Live silently showed mock data because
  `/api/stats` + `/api/leaderboards` required auth but the public pages
  called them anonymously, and every page had a `|| mockX` fallback.
  Fix: made `/api/stats` tier-aware (anonymous callers get limited data,
  no 401); added explicit login-gate UI in Leaderboards for unauthenticated
  visitors; purged all mock fallbacks from production pages; installed ESLint
  + vitest guardrails (this guide). See
  [`docs/protocols/no-mock-in-production.md`](docs/protocols/no-mock-in-production.md)
  for details.

---

## §9 Self-hosted Supabase & Kong — Hard Rules

The production Supabase stack runs in a **nested** Docker Compose root.
This nesting is intentional and permanent. All Docker operations **must**
target the correct inner directory.

### 9.1 — Active Docker Compose root

| Path | Role |
|---|---|
| `sbbl-hq-selfhost/sbbl-hq-selfhost/` | **ACTIVE** — run all Docker commands here |
| `sbbl-hq-selfhost/` | **OUTER** — retained for git history only; never run Docker here |

Verify before any Docker operation:

```powershell
docker inspect supabase-kong --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}'
# Expected: ...sbbl-hq-selfhost/sbbl-hq-selfhost
```

### 9.2 — Active Kong config path

```
sbbl-hq-selfhost/sbbl-hq-selfhost/volumes/api/kong.yml   ← ACTIVE (patch this)
sbbl-hq-selfhost/volumes/api/kong.yml                     ← OUTER (do NOT copy over active)
```

The outer `kong.yml` has diverged structurally (it is missing `auth-v1-open-health`
and other services). **Never** copy it wholesale over the active config.

### 9.3 — Kong CORS header allowlist (6 auth service blocks)

All six explicit `headers:` lists in the active `kong.yml` must contain the full set.
Missing any header causes browser preflight failures on login/signup.

Required headers (all six services: `auth-v1-open`, `auth-v1-open-callback`,
`auth-v1-open-authorize`, `auth-v1-open-jwks`, `auth-v1-open-health`, `auth-v1`):

```yaml
headers:
  - Accept
  - Accept-Profile
  - Accept-Version
  - Authorization
  - Cache-Control
  - Content-Length
  - Content-MD5
  - Content-Profile
  - Content-Type
  - Date
  - If-Match
  - If-Modified-Since
  - If-None-Match
  - Prefer
  - Range
  - X-Requested-With
  - apikey
  - x-client-info
  - x-supabase-api-version
  - x-upsert
```

`x-supabase-api-version` is required — GoTrue returns 400 without it.
`Prefer` and `Range` are required by PostgREST clients.

### 9.4 — After any Kong config change, recreate Kong only

```powershell
Push-Location $ActiveRoot
docker compose up -d --force-recreate kong
Start-Sleep -Seconds 15
docker compose ps kong
docker compose logs --tail=100 kong
Pop-Location
```

Never `docker compose down` (destroys DB data).
Never `up` the full stack to apply a Kong-only config change.

### 9.5 — Patch protocol for CORS changes

1. Discover `$ActiveRoot` from Docker labels (§9.1) — never hardcode.
2. Backup active kong.yml before mutation: `Copy-Item $KongPath "$KongPath.bak-cors-<stamp>"`.
3. Verify exactly N stale blocks before patching; abort if count is unexpected.
4. Verify 0 stale blocks remain after patching.
5. Recreate Kong (§9.4).
6. Validate preflight: OPTIONS → 200/204, `access-control-allow-origin: https://sbbl-hq.icu`.
7. Validate POST to `/auth/v1/token` reaches GoTrue (expect 400 not 0/5xx).

Enforcement: `sbbl-hq-selfhost/sbbl-hq-selfhost/ACTIVE_SELFHOST_ROOT.md`
and `sbbl-hq-selfhost/WARNING_NOT_ACTIVE_SELFHOST_ROOT.md`.

---

Last verified: 2026-08-09
