<!-- Version: v1.5.0 | Date: 2026-08-16 | Status: Production -->
# SBBL HQ Pipeline Map (Internal Architecture)

## 1) Trust Boundary and Env Systems
- **Frontend (Vite / Browser bundle)**: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` or `VITE_SUPABASE_PUBLISHABLE_KEY`
- **Worker Runtime (Cloudflare secrets)**: `SUPABASE_SERVICE_ROLE_KEY` via `wrangler secret put`
- **Worker Public Vars (Non-secret)**: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`

### Core Invariants:
- Browser never receives or references service-role secrets.
- Worker admin writes always use `env.SUPABASE_SERVICE_ROLE_KEY`.
- Roster player data is decoupled from user authentication profiles (`public.players` does not require synthetic `auth.users` rows).

---

## 2) Ingress Entry Points

### 2.1 Bulk Ingress & Imports
- `/ops/imports/teams` — CSV bulk team roster importing with division assignment
- `/ops/imports/players` — CSV player roster importing
- `/ops/imports/schedules` — CSV match schedule and court slot importing
- `/ops/imports/events` — League tournament and exhibition events
- `/ops/scores/import` — Historic game score backfills
- `/ops/scores/game` — Single match score creation

### 2.2 Courtside Ops Live Scoring & Live Tabulation
- `GET /api/public/games/:gameId/player-stats` — Live player box score and roster listing
- `POST /api/ops/games/:gameId/quick-player` — Courtside walk-on player insertion directly into `public.players`
- `POST /api/ops/games/:gameId/player-stats` — 1-tap real-time player points, rebounds, assists, fouls tabulation
- `POST /api/ops/overlay/:gameId/score` — Scorebug delta increments (`+1 FT`, `+2 FG`, `+3 3PT`, `-1`)
- `POST /api/ops/overlay/:gameId/clock` — Clock management (`start`, `stop`, `adjust`, `set`)
- `POST /api/ops/overlay/:gameId/fouls` — Team foul tracking with penalty threshold triggers
- `POST /api/ops/overlay/:gameId/patch` — Possession toggles and period advancements (`Q1`..`Q4`, `OT`)
- `POST /api/ops/overlay/:gameId/status` — State lifecycle transitions (`live`, `final`, `review_pending`)

### 2.3 Media & Vision Ingress
- `/ops/potg/parse` — Vision extraction of Player of the Game graphic metadata
- `/ops/scores/parse-image` — Vision extraction of scorebug graphics
- `/ops/store/media` — Retail product asset upload
- `/ops/potg/submit` — Direct POTG card creation
- **Canonical Ingest State Machine:**
  - `/ops/ingest/presign` — Pre-signed Cloudflare R2 upload authorization
  - `/ops/ingest/submit` — Ingest job initialization
  - `/ops/ingest/:jobId` — Ingest processing status
  - `/ops/ingest/:jobId/approve` — Editorial approval
  - `/ops/ingest/:jobId/reject` — Asset rejection
  - `/ops/ingest/:jobId/replay` — Ingest replay

### 2.4 Autonomous Media Retention & Purge
- `GET /api/ops/media/purge-preview` — Scans for archived media $\ge 30\text{ days}$ old without reposting
- `POST /api/ops/media/purge-execute` — Autonomous deletion from database and R2 storage
- Database RPC `fn_purge_archived_media_30d()` running via scheduled background cron

---

## 3) Parse, Normalization & Business Logic Layer

### 3.1 Client-Side Image Prep
- `resizeImageToFit(...)` — Strict boundary constraints
- `inferTargetDimensions(...)` — Aspect ratio preserving normalization

### 3.2 Courtside Scoring State Machine
```
[Upcoming / Scheduled]
       │
       ▼ (Tip-off: clock start, 1-tap stat attribution)
    [Live] ───────────────► In-game projected standings: fn_live_standings_preview()
       │
       ▼ (Radix Dialog confirmation: "Confirm Finalize")
    [Final] ──────────────► Statement-level trigger refreshes public.mvw_standings
       │
       ▼ (Radix Dialog unlock: "Reopen for Correction")
 [Review Pending] ────────► "Under Correction — not yet official" banner; locks standings update
       │
       ▼ (Correction finalized)
    [Final] ──────────────► Re-calculates and locks official standings
```

### 3.3 Worker Validation & Security
- Idempotency key enforcement on all mutations
- Role verification (`super_admin` / `league_admin` / `scorekeeper`)
- Constant-time HMAC-SHA256 signature verification for webhooks and telemetry

---

## 4) Persistence & Projection Layer

### 4.1 Canonical Tables & Views
- `public.leagues` — Canonical 3-league model (SBBL, WBL, TGIFBL)
- `public.seasons` — Active league seasons (SBBL: Season 12, WBL: Season 2, TGIFBL: Season 1)
- `public.divisions` — Division groupings (SBBL: `P10`, `P9`, `35 Up`, `P7`)
- `public.teams` — Team profiles with division mapping and published status
- `public.players` — Decoupled roster player identities
- `public.player_game_stats` — Match-level individual player statistics
- `public.games` — Official match records with scheduled time and court location
- `public.overlay_game_state` — Live broadcast scorebug clock and scoreboard sync
- `public.mvw_standings` — Materialized view for canonical season standings (refreshed on `final` game status)

### 4.2 Ingest State Machine Traceability
- `ingest_jobs` (`uploaded -> classified -> validated -> written -> projected/published` or `failed`)
- `audit_logs` — Immutable audit trail with actor IDs, payloads, and timestamps

---

## 5) Public Render Endpoints
- `GET /api/public/media` — Publication-ready media gallery
- `GET /api/public/potg` — Player of the Game cards
- `GET /api/public/schedule` — Multi-league court schedules and game times
- `GET /api/public-config` — Non-secret app configuration
- `GET /api/scores` — Scores and match results
- `GET /api/teams` — Published team standings and rosters

---

## 6) Graphic Container Fit and Resize Contract
- **Portrait POTG Target**: `560x747` (`cover`)
- **Landscape Graphic Target**: `747x560` (`cover`)
- **Store Media Target**: `800x800`
- **Grid Container Ratio**: Constrained `3:4` card ratio for uniform media feeds.

---

## 7) OmniBridge Layer (Bidirectional External Sync)

### 7.1 Inbound Command Path
```
OmniHub (external)
  → POST /webhooks/omnihub   (handleOmnihubWebhook)
      │
      ├─ HMAC-SHA256 signature verify (OMNIHUB_VERIFY_KEY)
      │   └─ invalid → 401
      ├─ Clock-skew check (±300 s)
      │   └─ outside window → 400
      ├─ Risk-lane classify (content-level blast-radius guard)
      │   └─ BLOCKED lane → 400
      ├─ Idempotency check (api_idempotency_keys on command_id)
      │   └─ duplicate → 200 already_processed
      ├─ Action allowlist check (9 permitted actions)
      │   └─ not on list → 400 action_not_allowed
      ├─ Action dispatch (disable_stream | enable_stream | revoke_access |
      │                   grant_access | emergency_halt | broadcast_message |
      │                   force_man_review | hotfix_dispatch | ping)
      └─ Audit log  →  log_admin_action RPC  →  audit_logs
```

### 7.2 Outbound Telemetry Path
```
omnibridge_outbox (pending records)
  → POST /sync/drain          (handleSyncDrain)
      │
      └─ deliverSyncEnvelope()
            │
            ├─ Build envelope: { packet: SyncPacket, signature: HMAC-SHA256(OMNIHUB_SIGNING_SECRET) }
            ├─ Set headers: X-Omni-Source, X-Omni-Signature, X-Omni-Packet-Id, X-Omni-Trace-Id
            ├─ Retry loop: 4 attempts, exponential backoff (250 ms → 1 s → 4 s)
            └─ OmniHub /api/omnibridge/sync  (OMNIHUB_SYNC_URL)
```

---

## 8) Verification & QA Artifacts
- `src/test/endpoint-ingress-render-checklist.test.ts`
- `src/test/env-system-separation-audit.test.ts`
- `src/test/worker-ingest-pipeline.test.ts`
- `src/test/worker-archived-media-purge.test.ts`
- `e2e/live-courtside-statistician-realworld.spec.ts`
- `docs/features/COURTSIDE_OPS_SCORING_AND_LIVE_TABULATION_v4.0.0.md`
- `docs/quality/INGRESS_RENDER_QA_MATRIX_2026-04-07_v1.3.0.md`
