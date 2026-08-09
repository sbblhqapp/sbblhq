<!-- Version: v1.7.1 | Date: 2026-08-09 | Status: Current -->
# Stream Gating

**Version:** v1.7.1
**Previous:** v1.7.0 (2026-04-19)
**Last Updated:** 2026-08-09

## Entitlement Windows (canonical)

These values are defined in `src/lib/constants/ENTITLEMENT_CONSTANTS.ts`
and are the SINGLE SOURCE OF TRUTH. Any other doc, code path, or test
that references a different number is a bug.

| Constant | Value | Meaning |
|----------|-------|---------|
| `VIEWING_SESSION_MAX_SECONDS` | 21600 (6 h) | Hard cap on one playback session. Heartbeats clamp at `max_expires_at`. Independent of entitlement. |
| `ENTITLEMENT_VALIDITY_HOURS` | 48 | Purchase-to-first-playback validity for a Stripe-paid PPV entitlement. |
| `MANUAL_COMP_VALIDITY_HOURS` | 48 | Default validity for a super-admin comp / manual grant (clamped to `[1, 168]`). |
| `REPLAY_EMBARGO_DAYS` | 7 | Minimum embargo before a finished game becomes available for replay. |
| `REPLAY_RAW_PRICE_CAD` | $1.50 | CAD price for the raw (unedited) replay. |
| `REPLAY_EDITED_PRICE_CAD` | $5.00 | CAD price for the edited / premium replay. |
| `REPLAY_RAW_VALIDITY_HOURS` | 72 | Validity from `replay_monetization_enabled_at` for raw replay. |
| `REPLAY_EDITED_VALIDITY_DAYS` | 30 | Validity from `replay_monetization_enabled_at` for edited replay. |

Semantic rule: **entitlement validity > session cap**. A buyer can wait up
to 48 hours to start the stream (tolerating game delays, chargeback-safe).
Once they start, the session is independently capped at 6 hours.

## Changelog (v1.7.0)

- **Universal stream player landed** on `/live`. Any URL the detector
  recognizes (Twitch, YouTube, Vimeo, Facebook, Kick, Rumble, Dailymotion,
  HLS including presigned, DASH, WHEP, MP4/m4v/mov/webm/ogg/ogv, and new
  `local` sources) plays with the minimum friction legally possible —
  paste, Go Live, done.
- **`crossOrigin` is now origin-aware**. External CDNs no longer need to
  emit `Access-Control-Allow-Credentials: true`; they just need
  `Access-Control-Allow-Origin: *` (the default). `sbbl_proxy_auth`
  still attaches for our own `*.sbbl-hq.icu` surface.
- **Twitch embed `parent` allow-list widened** to cover `sbbl-hq.icu`,
  `www.sbbl-hq.icu`, and `localhost` in addition to the current host.
- **Browser WHIP ingest** — new `useWhipIngest` hook plus Caddyfile
  `/whip/*` route, enabling admins to publish a local highlight clip or
  their webcam directly from the browser without a separate OBS.
  MediaMTX fans the feed out over the existing WHEP egress, so every
  fan already gated by this doc (PPV, invite, role) sees it unchanged.
- **Blob URL hygiene**: `AdminStreamOverlay` revokes object URLs on
  reselect and unmount so repeated admin workflows cannot pin large
  video buffers in memory.

## Changelog (v1.6.0)

- **Entitlement validity raised 6h → 48h.** PPV purchases now remain
  redeemable for 48 hours from Stripe confirmation. Prevents the
  chargeback-worthy failure mode where a 7 pm purchase and a delayed
  tipoff left the buyer locked out. Session cap is unchanged at 6 h.
- **Comp grant default 24h → 48h.** Super-admin generated comp codes
  now default to a 48-hour redemption window; per-call override range
  `[1, 168]` unchanged.
- **Canonical constants file (`ENTITLEMENT_CONSTANTS.ts`).** All
  entitlement literals across worker, tests, validation-policy, and
  subscription lib now derive from this single file. A vitest guard
  (`entitlement-constants.test.ts`) verifies downstream aliases stay
  in sync so future drift fails CI.
- **Playback provider abstraction (foundation).** New
  `IPlaybackProvider` interface + `LegacyEmbedProvider` passthrough
  (zero behavior change). Migration adds `stream_playback_providers`,
  `stream_playback_tokens`, and game columns for provider selection,
  replay monetization, event type, and Mic Up Series. All behavior
  gated behind `FEATURE_SIGNED_PLAYBACK_ENABLED` (default off).

## Changelog (v1.5.0 — retained for reference)

- **Super-admin comp access codes:** Super-admins can now generate unlimited complimentary access codes
  per game. Codes are stored in `ppv_invites` with `is_comp = TRUE`. A partial unique index
  (`WHERE is_comp = FALSE`) preserves the one-invite-per-generator-per-game constraint for standard
  invites while leaving comp codes unbounded.
- **Viewer redeem widget (`AccessCodeRedeem`):** All viewers are presented with a code-redemption UI
  on `/live`. Entering a valid comp code grants stream access identical to a standard PPV invite.
- **Facebook embed navigation lockdown:** A transparent `pointer-events: all` overlay is rendered over
  the ReactPlayer frame for all non-super-admin viewers when the stream source is a Facebook URL
  (`facebook.com` or `fb.watch`). This prevents embedded FB UI elements (feed scrolling, video
  suggestions, social controls) from being interacted with. Super-admins retain full interactivity.
- **Super-admin account bootstrap (migration):** `sbblhqapp@gmail.com` is granted `super_admin` status
  via an `admin_email_grants` migration — no credentials are hardcoded in application code.
- **`handleInviteRedeem` server-side game derivation:** The Worker now derives `game_id` from the
  invite record rather than requiring the client to supply it. Eliminates a class of cross-game
  redemption attacks.

---

## PPV Entitlement Flow (v1.6.0)

1. **Purchase:** User clicks Buy → `POST /api/streams/:gameId/purchase` → Stripe Checkout session.
2. **Webhook:** Stripe fires `checkout.session.completed` → Worker verifies HMAC-SHA256 → calls
   `create_stream_entitlement` RPC → **48-hour** entitlement validity window
   (`ENTITLEMENT.ENTITLEMENT_VALIDITY_HOURS`).
3. **Auto fan-profile:** Webhook auto-creates minimal fan profile if none exists (`onboarding_completed_at`
   set) so the buyer bypasses the onboarding gate on sign-in.
4. **Access check:** `can_user_view_stream(game_id, user_id)` RPC checks `stream_entitlements` and
   `ppv_invites`.
5. **Session creation:** `POST /api/streams/:gameId/session` creates `stream_access_sessions` row.
   - `expires_at = NOW() + 70s` (heartbeat window)
   - `max_expires_at = NOW() + 6h` (hard session ceiling — `ENTITLEMENT.VIEWING_SESSION_MAX_SECONDS`)
   - Any existing `status='active'` session for the same user + game is set to `status='displaced'`.
6. **Heartbeat:** Client sends `POST .../heartbeat` every 25s. Batch-flushed every 30s. Clamped at
   `max_expires_at`. After 3 consecutive failures → circuit breaker → "Connection lost".
7. **6hr cap client-side:** A `setTimeout` fires at `maxExpiresAt` on the client and halts playback
   with: *"Your 6-hour viewing session has ended. Purchase a new pass to continue."*
8. **Teardown:** `POST .../session/end` on component unmount.

Note: the 48-hour entitlement window and the 6-hour session cap are
independent. A buyer who sees the session-ended message still has an
active entitlement — they can start a fresh 6-hour session any time in
the 48-hour window without re-purchasing.

## Comp Code Flow (v1.6.0; access model updated 2026-08-09)

1. **Generate:** Admin opens the Admin Stream Overlay → Comp Code tab → enters optional note and
   selects expiry → clicks Generate → `POST /ops/streams/comp-code`.
   - **API access (as of 2026-08-09):** `league_admin` or `super_admin` — gated by
     `requireOpsAdminSession`, not `super_admin`-only. A regular admin is capped at
     **5 codes per rolling 24 hours** (non-compounding); `super_admin` is uncapped.
     Over-cap returns `429 comp_code_daily_limit_reached`. See `CLAUDE.md` rule 12.3.
   - **⚠️ Known UI gap:** the only shipped entry point for this endpoint — the Admin
     Stream Overlay on `/live` (`src/pages/Live.tsx`) — is still rendered
     `{isSuperAdmin && (...)}`. The backend accepts `league_admin` today, but no UI
     surface currently lets a regular admin reach it. A regular admin can call the
     endpoint directly (e.g. via the Ops Console once a picker is added, or via a
     direct API call) but cannot yet do so through any button in the app. Tracked as
     a follow-up; not implemented as part of the 2026-08-09 permission-model change.
2. **Worker:** Inserts a `ppv_invites` row with `is_comp = TRUE`, `note`, and `expires_at` (default
   48h — `ENTITLEMENT.MANUAL_COMP_VALIDITY_HOURS`; clamped to `[1, 168]`). No uniqueness constraint
   is applied across multiple comp codes for the same game.
3. **Share:** The generated UUID code is displayed in a copy-to-clipboard card. The admin shares
   it with the intended viewer via any channel.
4. **Redeem:** Viewer navigates to `/live` → sees the `AccessCodeRedeem` widget → enters code →
   `POST /ops/streams/invite/redeem` → Worker validates TTL, marks `status = 'used'`, returns
   `game_id` → client triggers access flow.
5. **Access check:** `can_user_view_stream` includes `ppv_invites` with `is_comp = TRUE` in its scan.
6. **Session creation:** Identical to standard PPV invite flow.

## Player Membership Flow

- **Price:** $7.00 CAD/month (recurring Stripe subscription)
- **Access:** Free livestream access on one device at a time
- **Session cap:** Same 6-hour hard ceiling per session start
- **Cancellation:** `customer.subscription.deleted` webhook removes `player` role and clears
  `subscription_ends_at`

## Invite-Based Access

- `ppv_invites` table: `id` (UUID) serves as the invite code.
- **Standard invites:** One invite per generator per game — enforced by partial unique index
  `UNIQUE(generated_by, game_id) WHERE is_comp = FALSE`.
- **Comp codes (`is_comp = TRUE`):** Unlimited per super-admin per game. Partial index does not apply.
- IP-locked on redemption. Single-use. TTL configurable (default 48h, clamped `[1, 168]`).
- Eligible generators for standard invites: `hasPremiumPlayerAccess || isPaidFan || isSuperAdmin`
- Comp code generation: `isSuperAdmin` only.

## Facebook Embed Security

Facebook URLs are rendered via the official `plugins/video.php` sandboxed iframe.
ReactPlayer **never** mounts for Facebook URLs — the `isFacebook` branch in
`StreamPlayer` (LiveStreamPlayer.tsx) short-circuits before ReactPlayer initializes,
preventing `connect.facebook.net/sdk.js` from ever being requested.

| CSP directive | Value | Reason |
|---|---|---|
| `frame-src` | `https://www.facebook.com` | allows the iframe |
| `script-src` | *(absent)* | FB SDK never loads |
| `connect-src` | *(absent)* | no FB network calls |

Detection: `urlType === 'facebook'` via `url-detector.ts` (`detectStreamUrlType`).

## Session Status Lifecycle

```
active → displaced  (new session created for same user+game on another device)
active → ended      (session/end called, or 6-hour cap reached in batch flush)
active → active     (heartbeat extends expires_at, clamped at max_expires_at)
```

## Playback Provider Abstraction (foundation, behind flag)

As of v1.6.0, `/api/streams/:gameId/session` accepts a pluggable
provider via `src/lib/playback/IPlaybackProvider.ts`. Two providers
are defined:

| Name | Default | Behavior |
|------|---------|----------|
| `legacy_embed` | **Yes** | Returns `embedUrl` from `games.source_url`. Zero behavior change. |
| `native_hls` | No | Mints a signed playback token (PR 2). Never emits a raw third-party URL. |

Selection is driven by `games.playback_provider` + `games.require_signed_url`.
Signed-path behavior is additionally gated by the worker env flag
`FEATURE_SIGNED_PLAYBACK_ENABLED`. With the flag off, `native_hls` is
never selected regardless of game configuration.

## CSP Directives (stream-relevant)

```
frame-src:  https://www.facebook.com https://www.youtube.com https://www.youtube-nocookie.com
            https://player.twitch.tv https://embed.twitch.tv https://player.vimeo.com
            https://challenges.cloudflare.com https://js.stripe.com
media-src:  'self' blob: https://*.googlevideo.com https://*.ytimg.com
            https://*.twitch.tv https://*.twitchsvc.net
```

## Database Schema (ppv_invites)

| Column       | Type        | Notes                                                         |
|--------------|-------------|---------------------------------------------------------------|
| id           | uuid PK     | Serves as the invite / comp code                              |
| game_id      | uuid        | FK → games                                                    |
| generated_by | uuid        | FK → auth.users                                               |
| status       | text        | pending / used / expired                                      |
| expires_at   | timestamptz | TTL; 48h default (v1.6.0)                                     |
| **is_comp**  | boolean     | **TRUE = comp code (unlimited); FALSE = standard (constrained)** |
| **note**     | text        | **Optional memo from super-admin at generation time**         |
| created_at   | timestamptz |                                                               |

## Database Schema (stream_access_sessions)

| Column          | Type        | Notes                                           |
|-----------------|-------------|------------------------------------------------|
| id              | uuid PK     |                                                 |
| user_id         | uuid        | FK → auth.users                                |
| game_id         | uuid        | FK → games                                     |
| idempotency_key | text        | UNIQUE(user_id, game_id, idempotency_key)       |
| status          | text        | active / ended / displaced                      |
| expires_at      | timestamptz | Heartbeat rolling window                        |
| max_expires_at  | timestamptz | Hard 6hr session ceiling — never extended       |
| last_seen_at    | timestamptz | Last heartbeat timestamp                        |
| created_at      | timestamptz |                                                 |
| updated_at      | timestamptz |                                                 |

## Database Schema (stream_playback_tokens — v1.6.0 addition)

| Column          | Type        | Notes                                                 |
|-----------------|-------------|-------------------------------------------------------|
| id              | uuid PK     |                                                       |
| session_id      | uuid        | FK → stream_access_sessions                           |
| user_id         | uuid        | FK → auth.users                                       |
| game_id         | uuid NULL   | **Nullable** — Stream Independence Contract           |
| provider        | text        | `legacy_embed` \| `native_hls`                        |
| signed_token    | text        | HMAC-SHA256 JWT (native_hls only)                     |
| expires_at      | timestamptz | Matches session expiry                                |
| max_expires_at  | timestamptz | Matches session hard cap                              |
| playback_mode   | text        | `live` \| `replay`                                    |
| revoked_at      | timestamptz | Non-null = token invalidated                          |

## Worker Routes (v1.5.0 additions, retained)

| Method | Path                      | Auth       | Handler                       |
|--------|---------------------------|------------|-------------------------------|
| POST   | `/ops/streams/comp-code`  | super_admin | `handleSuperAdminCompCode`   |
| GET    | `/ops/streams/comp-code`  | super_admin | `handleSuperAdminCompCodeList` |
| POST   | `/ops/streams/invite/redeem` | authenticated | `handleInviteRedeem` (game_id server-derived) |
