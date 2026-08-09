<!-- Version: v1.1.1 | Date: 2026-08-09 | Status: Current -->
# SBBL HQ — Complete Codebase Map

**Version:** v1.1.1
**Last Updated:** 2026-08-09
**Owner:** APEX Business Systems Ltd. — Engineering Lead

## Overview
SBBL HQ is a three-league basketball super app built by APEX Business Systems Ltd. (Edmonton, Alberta). It serves as a unified platform for the WBL (Weekend Basketball League), TGIF (Thank God It's Friday Basketball League), and SBBL (Sunday's Best Basketball League) — covering live game streaming, schedules, stats, scores, media, a merch store, and full admin operations.

Live at: sbbl-hq.icu

Tech Stack
Layer	Technology
Frontend	React 18 + TypeScript + Vite 5 (SWC)
Styling	Tailwind CSS 3 (dark-first, #C9A84C gold accent)
UI Components	shadcn/ui (Radix primitives + CVA + lucide-react icons)
State	React Context (Auth/App/Bag) + TanStack Query v5
Offline	RxDB + IndexedDB + PWA (VitePWA/Workbox)
Database	Supabase (PostgreSQL + Realtime + Auth + Storage)
Backend/API	Cloudflare Workers (single Worker: sbbl-hq-worker)
Payments	Stripe (webhooks, PPV purchases, player subscriptions)
Email	Resend
Bot Protection	Cloudflare Turnstile
Monitoring	Sentry (frontend + worker)
Mobile	Capacitor 8 (iOS + Android native shells)
CI/CD	GitHub Actions → Cloudflare Workers deploy
Load Testing	k6
E2E Testing	Playwright
Unit Testing	Vitest + Testing Library
Directory Structure
sbbl-hq/
├── src/                        # 208 TS/TSX files — the main application
│   ├── main.tsx                # Entry point: Sentry init, PWA registration, Capacitor init
│   ├── App.tsx                 # 169 lines — Router, providers, lazy-loaded routes
│   ├── instrument.ts           # Sentry browser SDK initialization
│   ├── index.css               # Tailwind base + custom dark theme
│   ├── pages/                  # 20 page components (7,122 lines total)
│   ├── components/             # UI components (shared, layout, auth, live, marketing, ops, scores)
│   ├── contexts/               # 3 React Contexts (Auth, App, Bag)
│   ├── hooks/                  # 7 custom hooks
│   ├── lib/                    # Shared utilities, API clients, auth, stream engine
│   ├── data/                   # Static mock/seed data (schedules, teams, products)
│   ├── types/                  # TypeScript type definitions
│   ├── worker/                 # Cloudflare Worker backend (6,549-line monolith + routes)
│   ├── test/                   # 60+ unit/integration test files (7,625+ lines)
│   └── assets/                 # SVGs, MP3 (theme music)
├── supabase/                   # Database layer
│   ├── migrations/             # 50 SQL migrations (4,313 lines)
│   ├── functions/              # Edge Functions (stripe-webhook)
│   ├── config.toml             # Supabase local dev config
│   └── seed.sql                # Seed data
├── ops/                        # Operations infrastructure
│   ├── event-hardening-2026-04/  # Self-host failover (Docker, Caddy, PgBouncer)
│   ├── validation/             # Stream validation pipeline
│   ├── cloudflare/             # Rate limit rules documentation
│   └── audits/                 # Build audits
├── docs/                       # 40+ documentation files
│   ├── architecture/           # Architecture, DB Schema, API Reference
│   ├── security/               # Security Model, RLS Matrix
│   ├── operations/             # Runbooks, External Bindings
│   ├── features/               # Stream Gating, Stats Pipeline, Pipeline Map
│   ├── deployment/             # Cloudflare Deploy, Supabase Setup, PWA/Capacitor
│   └── quality/                # Release Gate Audits, evidence
├── e2e/                        # 6 Playwright E2E specs
├── tests/k6/                   # 5 k6 load test scripts
├── public/                     # Static assets, icons, images
├── .github/workflows/          # 15 CI/CD workflow files
├── .agents/                    # AI agent configurations (omnidev-v2, apex-memory)
├── skills/                     # Annotated skill definitions
└── [config files]              # vite, tailwind, tsconfig, wrangler, eslint, playwright, etc.

Frontend Architecture
Provider Hierarchy (App.tsx)
QueryClientProvider (TanStack Query — 30s stale, 5min GC, no refetch-on-focus)
  └─ TooltipProvider
      └─ AuthProvider (JWT session, profile, roles from Supabase)
          └─ SplashScreen (loading gate)
              └─ BagProvider (shopping bag — isolated from app state)
                  └─ AppProvider (active league, subscription status, auth role)
                      └─ BrowserRouter
                          └─ AppShell (Header, BagDrawer, Routes)

Routing (20 Routes)
Path	Component	Auth	Description
/	AppHome	Public	League hub / landing page
/league/:leagueId	Home	Public	League-specific home (teams, games, standings)
/live	Live	Public	Live streaming + PPV + chat + admin controls
/schedules	Schedules	Public	Upcoming game schedules
/store	Store	Public	Merch store with bag/checkout
/profiles	Profiles	Public	Player profiles
/stats	Stats	Public	Player/team statistics
/leaderboards	Leaderboards	Public	League leaderboards
/media	Media	Public	POTG cards, highlights, posters
/scores	Scores	Public	Game scores (league, 1v1, special events)
/teams	Teams	Public	Team listings with league filter
/login	Login	Public	Email/password auth with Turnstile
/register	→ /login?mode=signup	Redirect	
/onboarding	Onboarding	RequireAuth	Profile setup wizard
/billing	Billing	RequireAuth	Payment history
/settings	Settings	RequireAuth	User settings
/ops	Ops	RequireAdmin	Admin console (10 tabs for super_admin; 9 for league_admin — Store Media tab hidden, see CLAUDE.md rule 12)
/support	Support	Public	Support/contact
/privacy	PrivacyPolicy	Public	
/terms	TermsOfService	Public	
All pages are lazy-loaded via React.lazy() for code splitting.

State Management (3 Contexts)
AuthContext (src/contexts/AuthContext.tsx, 171 lines)

Manages: session, user, profile, roles, loading, isSignedIn, isAdmin, needsOnboarding
Boots by fetching /api/public-config for runtime Supabase creds, then supabase.auth.getSession()
Fetches profile + roles from profiles and user_role_assignments tables
Listens to onAuthStateChange for SIGNED_IN/SIGNED_OUT events
Gates loading state during sign-in so downstream redirects wait for profile
AppContext (src/contexts/AppContext.tsx, 108 lines)

Manages: activeLeague, authRole, subscription status
Persists league selection to localStorage
Reads subscription_ends_at from Supabase (never localStorage — prevents DevTools bypass)
BagContext (src/contexts/BagContext.tsx, 53 lines)

Isolated shopping bag state to prevent cascade re-renders
Consumers: Header badge, BagDrawer, Store page, Live page (featured merch)
Custom Hooks (7)
Hook	Purpose
use-auth.ts	Re-exports useAuth() from AuthContext
use-turnstile.ts	Cloudflare Turnstile CAPTCHA integration
useLiveAccess.ts	PPV entitlement check for live stream access
use-install-prompt.ts	PWA install prompt handler
use-mobile.tsx	Mobile viewport detection
use-toast.ts	Toast notification hook
use-streamforge.ts	StreamForge QoE telemetry hook
Key Components
Component	Description
LiveStreamPlayer	Main video player (YouTube embed, WHEP/WebRTC, Facebook via plugins/video.php iframe, direct URL)
WhepPlayer	WebRTC WHEP player (Eyevinn library)
LiveGate	PPV paywall enforcement around live content
RouteGuards	RequireAuth + RequireAdmin HOCs
Header	App header with nav, league selector, bag badge
BagDrawer	Shopping bag slide-out drawer
ScoreCard	Game score display card
PotgCard	Player of the Game highlight card
SplashScreen	Loading screen during auth boot
OfflineBanner	Offline indicator
CASLNudge	Canadian Anti-Spam Law marketing consent
AppErrorBoundary	Global React error boundary (Sentry integration)
OpsSupportModals	Admin support modals
Backend Architecture (Cloudflare Worker)
Entry Flow
Request → validation-contract-wrapper.ts (idempotency, rate limits, JWT guard, route rewrites)
        → index.ts (6,549 lines — main Worker with 70+ route handlers)
        → routes/public.ts (extracted public handlers)
        → routes/stream-qoe.ts (QoE beacon ingest)

Worker Bindings (src/worker/bindings.d.ts)
interface Env {
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
  STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
  RESEND_API_KEY,
  OMNIHUB_SYNC_URL, OMNIHUB_SIGNING_SECRET, OMNIHUB_VERIFY_KEY,
  GROQ_API_KEY,                    // AI scoreboard OCR
  OPTIONAL_TURNSTILE_SECRET_KEY,
  ENABLE_STREAM_VALIDATION,
  VITE_STREAM_URL,
  ASSETS                           // Cloudflare static asset binding
}

Complete API Route Map (70+ endpoints)
Public (no auth):

Method	Path	Handler
GET	/api/public-config	Runtime config (Supabase URL, publishable key)
GET	/api/public/home	League home data (teams, games, seasons)
GET	/api/public/schedule	Upcoming schedule slots
GET	/api/public/potg	Published POTG media
GET	/api/public/products	Store products catalog
GET	/api/public/media	Published media assets
GET	/api/public/media/posters	Poster media assets
GET	/api/streams/status	Live stream status + viewer count (edge-cached 10s)
GET	/api/streams/reactions	Stream reactions
GET	/api/streams/:gameId/reactions	Per-game reactions
GET	/api/streams/:gameId/viewer-count	Per-game viewer count
POST	/api/streams/:gameId/qoe	QoE beacon ingest (fire-and-forget)
GET	/api/teams	Teams list
Auth Required:

Method	Path	Handler
GET	/auth/session	Session summary
GET	/api/profile/me	Current user profile
POST	/api/profile/onboarding	Save onboarding data
POST	/api/profile/headshot	Upload headshot
GET	/api/stats	Stats dashboard (RPC)
GET	/api/leaderboards	Leaderboards (RPC)
POST	/api/invite/generate	Generate PPV invite code
POST	/api/invite/redeem	Redeem invite/comp code
POST	/api/streams/:gameId/purchase	PPV purchase (Stripe)
GET	/api/streams/:gameId/access	Check stream access
POST	/api/streams/:gameId/session	Create playback session
POST	/api/streams/:gameId/session/heartbeat	Keep session alive
POST	/api/streams/:gameId/session/end	End playback session
GET	/api/streams/:gameId/comments	Fetch live chat
POST	/api/streams/:gameId/comments	Post live chat message
POST	/api/streams/:gameId/react	Send stream reaction
GET	/api/streams/:gameId/proxy/*	Authenticated HLS proxy
GET	/api/cart	Get shopping cart
POST	/api/cart/items	Add to cart
DELETE	/api/cart/items/:itemId	Remove from cart
POST	/api/orders	Create order
POST	/api/orders/:id/pay	Pay order (Stripe)
GET	/api/billing/history	Payment history
POST	/api/player/checkout	Player subscription checkout
POST	/api/store/checkout	Direct store checkout
POST	/api/store/quotes	Custom jersey quote request
POST	/api/coach/request	Coach approval request
**Verified against `src/worker/index.ts` / `src/worker/routes/ops-upload.ts` 2026-08-09.** The
"Admin (league_admin+)" vs. "Super Admin only" split changed materially on that date — see
`CLAUDE.md` rule 12 and
[`omni-recall/wiki/corrections/2026-08-09-regular-admin-permission-model.md`](../../omni-recall/wiki/corrections/2026-08-09-regular-admin-permission-model.md).
Two route names below (`/ops/store/media`, `/ops/potg/submit`) never existed under those paths in
the current codebase and have been corrected to their real endpoints.

Admin (league_admin+) — gated by `requireOpsAdminSession` (or the broader `requireAdminSession`,
which also admits `team_manager`/`coach`/`media_operator`, for the AI-parse endpoints):

Method	Path	Handler
GET	/ops/bootstrap	Admin data bootstrap
GET	/ops/streams/config	Stream configuration
GET	/ops/streams/sessions	Broadcast session history
GET	/ops/review	Review queue
GET	/ops/revenue	Revenue dashboard
GET	/ops/publish-jobs	Publish job queue
GET	/ops/headshots	Headshot review queue
GET	/ops/health	Worker health check
GET	/ops/metrics-lite	Lightweight metrics
POST	/ops/imports/teams, /players, /schedules, /events	CSV + manual-form imports (`handleImportRoute`)
POST	/ops/scores/game	Manual score entry (`handleScoreGameUpsert`)
POST	/ops/scores/import	Scores CSV import (`handleScoresCsvImport`)
POST	/ops/scores/parse-image	AI scoreboard image parsing (Groq Vision) — `requireAdminSession`
POST	/ops/event/parse	AI event image parsing (Groq Vision) — `requireAdminSession`
POST	/ops/potg/parse	AI POTG image parsing (Groq Vision) — `requireAdminSession`
POST	/ops/players/find-or-create	Find-or-create player by name (`handleOpsFindOrCreatePlayer`, added 2026-08-09)
POST	/ops/review/:id/resolve	Resolve review item — `requireAdminSession`
POST	/ops/streams/comp-code	Generate comp code — league_admin capped at 5/rolling-24h (non-compounding), super_admin uncapped; see rule 12.3
GET	/ops/streams/comp-code	List comp codes — league_admin sees only their own; super_admin sees all

Super Admin only (unchanged by the 2026-08-09 permission-model update — live-PPV controls, store
media, and role/access grants stay `requireSuperAdminSession`):

Method	Path	Handler
POST	/ops/streams/config	Update stream config
POST	/ops/streams/status	Go live / end broadcast
POST	/ops/streams/go-live	Atomic go-live (config + status)
GET	/ops/access/lookup	User access lookup by email
POST	/ops/access/override	Grant/revoke PPV access
POST	/ops/coach/:id/resolve	Approve/reject coach requests
POST	/ops/products/batch	Batch-create store products (`handleOpsBatchProducts`) — the doc previously listed a nonexistent `/ops/store/media`
PATCH, DELETE	/ops/products/:id	Store product edit/archive — escalated via `requireTableWriteSession`'s `STORE_ONLY_TABLES`, even on the shared CRUD path
POST	/webhooks/stripe	Stripe webhook handler (HMAC-SHA256 verified — not role-gated)
POST	/webhooks/omnihub	`handleOmnihubWebhook` — OmniHub inbound command receiver (HMAC-SHA256 verified; 9-action allowlist; idempotency; risk-lane reclassification; audit — not role-gated)
POST	/api/omniport/command	`handleOmniportCommand` — JWT-authenticated OmniHub operator diagnostic (PING, ECHO, HEALTH_CHECK, TELEMETRY_SNAPSHOT — not role-gated)
POST	/sync/drain	`handleSyncDrain` — outbound sync drain; sends `{ packet, signature }` envelope via `deliverSyncEnvelope()` with X-Omni-* headers (not role-gated)

Note: `POST /ops/potg/submit` does not exist as a route. POTG submission goes through
`POST /ops/ingest/submit` with `kind: 'potg'` (`handleIngestSubmit`), which is `requireAdminSession`-gated.

### OmniBridge Code Surfaces (PR #502 — added 2026-05-11)

| Function | File | Description |
|---|---|---|
| `handleOmnihubWebhook` | `src/worker/index.ts` | `POST /webhooks/omnihub` — HMAC-verified inbound OmniHub command receiver. Enforces: clock-skew check (±300s), `target_source === "sbbl-hq"` pin, risk-lane reclassification (BLOCKED payloads rejected even if signed), 9-action allowlist, idempotency dedup via `api_idempotency_keys`, full audit via `log_admin_action` RPC. |
| `handleOmniportCommand` | `src/worker/index.ts` | `POST /api/omniport/command` — JWT-authenticated diagnostic surface for OmniHub operator sessions. Commands: `PING`, `ECHO`, `HEALTH_CHECK`, `TELEMETRY_SNAPSHOT`. Any other command → `400 unsupported_command`. |
| `handleSyncDrain` (modified) | `src/worker/index.ts` | `POST /sync/drain` — now sends canonical `{ packet, signature }` envelope with required headers `X-Omni-Source`, `X-Omni-Signature`, `X-Omni-Packet-Id`, `X-Omni-Trace-Id`. Fixes silent 400 rejection on OmniHub side. |
| `deliverSyncEnvelope` | `src/worker/index.ts` | Hardened outbound delivery with 4-attempt exponential backoff (0 / 250ms / 1s / 4s delays), 5-second per-attempt timeout, and 4xx fast-fail (non-retryable target rejection). |

**Integration tests:** `src/worker/tests/omnihub-bridge.integration.test.ts` — 14 tests covering all new/changed surfaces.

**Required Cloudflare secrets:** `OMNIHUB_SIGNING_SECRET` (sign outbound), `OMNIHUB_SYNC_URL` (delivery target), `OMNIHUB_VERIFY_KEY` (verify inbound; falls back to `OMNIHUB_SIGNING_SECRET` in dev/staging).

Security Model
JWT Verification: Supabase JWKS-based verification via jose library
Role Hierarchy: fan(1) → player(2) → coach/team_manager/media_operator/store_operator(3) → league_admin(4) → super_admin(5)
Rate Limiting: In-memory sliding window + DB-backed shared rate limits (consume_stream_rate_limit RPC)
Idempotency: All mutations require x-idempotency-key header; DB + in-memory dedup
Stripe Webhook: Constant-time HMAC-SHA256 signature verification with 5-minute timestamp window
Turnstile: Server-side CAPTCHA verification for login/registration
Security Headers: CSP, X-Frame-Options (DENY), HSTS, Referrer-Policy, Permissions-Policy
Body Size Guard: 5MB request body limit
Proxy Auth: HMAC-signed cookies for HLS stream proxy authentication
Database Schema (50 migrations, 4,313 lines)
Core Tables
Table	Purpose
profiles	User profiles (display_name, avatar, onboarding status)
user_role_assignments	User-role mapping (multi-role per user)
leagues	League definitions (SBBL, WBL, TGIFBL)
seasons	Seasons per league
divisions	Divisions per season
teams	Teams per season/division
players	Player records (jersey, position, team)
team_memberships	Player-team assignments
games	Game records with scores, status, stream_url
game_rosters	Per-game active rosters
schedule_slots	Scheduled time slots
venues / courts	Physical locations
Stats Pipeline
Table	Purpose
stat_categories	Stat type definitions
stat_line_submissions	Draft/submitted stat sheets
player_game_stats	Finalized per-player stats (pts, reb, ast, stl, blk, fls, min)
team_game_stats	Team-level aggregate stats
leaderboard_snapshots	Materialized leaderboard data
standings_mv	Materialized view for standings
Streaming
Table	Purpose
stream_admin_config	Singleton config (URL, title, is_live)
stream_sessions	Broadcast sessions (peak/current viewers)
stream_sources	Stream source URLs per game
stream_entitlements	PPV purchase/invite grants
stream_access_sessions	Active viewer sessions (heartbeat-tracked)
stream_watermark_events	DRM watermark telemetry
stream_reactions	Live reactions
stream_comments	Live chat messages
stream_presence	Real-time viewer presence
stream_rate_limits	DB-backed rate limit counters
validation_runs	Stream validation test runs
Commerce
Table	Purpose
products	Merch catalog
product_variants	SKU/size/color variants
carts / cart_items	Shopping carts
orders / order_items	Completed orders
ppv_invites	PPV invite codes (1 per paid fan per game)
comp_codes	Super-admin complimentary access codes
Content
Table	Purpose
media_publications	POTG cards, posters, highlights (with sort_order)
ingest_submissions	Content ingest pipeline
publish_jobs	Multi-destination publishing queue
review_queue	Admin review items
Security
Table	Purpose
audit_logs	All admin actions logged
api_idempotency_keys	DB-backed dedup for mutations
devices	User device registry
player_registration_submissions	Player registration queue
coach_approval_requests	Coach role requests
player_profile_headshots	Headshot validation queue
admin_email_grants	Email-based admin grants
Key RPCs
batch_heartbeat_upsert — Batch viewer heartbeat writes (20K scale)
consume_stream_rate_limit — DB-backed rate limiting
get_stats_dashboard / get_leaderboards — Aggregated stat queries
save_stat_draft / finalize_game_stats — Stat submission pipeline
has_any_role — RLS helper for role checking
StreamForge Engine (src/lib/stream/streamforge.ts, 863 lines)
A proprietary, zero-dependency, pure-function broadcast intelligence engine:

QoE Telemetry State Machine — Ring-buffered event tracking (mount, play, pause, waiting, playing, error, ended, heartbeat)
Health Score — 0-100 score with penalty breakdown (startup, rebuffer, error, network)
Adaptive Quality Selection — Network-aware tier selection (audio-only → low → sd → hd → fhd)
Circuit Breaker — Per-path failure tracking (closed → open → half-open)
Multi-Path Failover — Primary → mirror → fallback stream selection
Predictive Rebuffer Detection — Buffer-ahead + network analysis pre-emption
Warm Reconnect Logic — Cooldown-gated reconnection (no tight loops)
Edge Aggregation — Zero-DB beacon aggregation via Cloudflare Cache API
CI/CD Pipeline
Main CI Workflow (.github/workflows/ci.yml)
5 parallel/sequential jobs on push to main/staging and all PRs:

Lint & Typecheck — ESLint (zero-warning policy) + TSC (both app and node configs)
Unit & Integration Tests — Vitest with coverage (60+ test files)
Build & Bundle Check — Production build + chunk size regression guards:
react-vendor ≤ 185KB, supabase-vendor ≤ 215KB, ui-vendor ≤ 700KB
charts-vendor ≤ 280KB, rxdb-vendor ≤ 600KB, media-vendor ≤ 360KB
Lighthouse LCP Budget — LCP ≤ 1.8s (warning gate)
Playwright E2E — 6 spec files covering critical paths
Deploy Workflow (.github/workflows/deploy.yml)
On push to main:

Build with env vars
wrangler deploy to Cloudflare Workers
Sync all secrets via wrangler versions secret put
Post-deploy health gate (8 retries, 15s intervals)
Test Coverage
60+ unit/integration tests in src/test/
6 E2E specs in e2e/
5 k6 load tests in tests/k6/ (auth spike, checkout burst, live page, webhook stress)
Stream validation pipeline in ops/validation/
Ops Console (Ops.tsx, 2,088 lines as of 2026-08-09)
Admin panel with 10 tabs for super_admin; 9 for league_admin (Store Media
hidden — see CLAUDE.md rule 12). As of 2026-08-09, Teams/Players/Schedules/
Events/Roster-Import forms resolve League/Season/Division/Team/Player/Event/
Schedule identifiers via `<select>` pickers instead of raw UUID text fields
— see CLAUDE.md rule 13.

Overview — Bootstrap data, system health
Scores — Manual score entry, CSV import, AI scoreboard image parsing (Groq Vision)
Teams — Team CRUD, CSV import (league_admin+)
Players — Player management incl. name-based find-or-create, CSV import (league_admin+)
Schedules — Schedule management, CSV import (league_admin+)
Events — Event creation, AI image parsing (league_admin+)
Store Media — Product image upload (super_admin only)
POTG Parser — AI-powered Player of the Game card extraction from scoreboard photos
Media Library — Media publication management with drag ordering
Import History — CSV import audit log
Pricing Model
Item	Price	Notes
PPV single-game	$3.99 CAD	48-hour entitlement validity, 6-hour session cap, IP-locked, one-device
Player subscription	$6.99 CAD/month	Recurring via Stripe
Alberta GST	5%	Federal only, no PST
Player store discount	10%	Active subscribers only
Key Architectural Decisions
Single Cloudflare Worker — Both API backend and static asset serving in one Worker; run_worker_first routes API/auth/webhook/ops paths to the worker before SPA fallback
Edge caching — Stream status + QoE aggregates use Cloudflare Cache API (zero-cost, zero-DB) with short TTLs
Heartbeat batching — 20K-viewer scale: heartbeats queued in-memory, flushed every 30s via batch_heartbeat_upsert RPC
Runtime config fallback — Frontend fetches /api/public-config at boot; falls back to Vite build-time env vars
PWA with NetworkFirst navigation — Ensures fresh CSP headers for YouTube iframe API; cache-first for static assets
Manual vendor chunks — 9 named chunks for optimal caching (react, query, supabase, ui, charts, rxdb, media, utils, forms)
Authenticated HLS proxy — Stream URLs proxied through worker with HMAC-signed cookies; manifest URIs rewritten to gateway paths
Idempotency everywhere — All mutations require idempotency keys; DB + in-memory dedup prevents duplicate writes
