# Courtside Ops Scoring Repair & Live Tabulation Scoreboard (v4.0.0)

**Platform:** SBBL HQ — Super Basketball League Operations & Public Broadcast  
**Engine:** Cloudflare Workers + Self-Hosted PostgreSQL / Supabase Realtime  
**Authoritative Standards:** Contract v4.0.0 (Research-grounded, GameChanger / iScore 24M+ games architecture)  

---

## 1. Overview & Architecture

SBBL HQ's courtside scoring system provides league operators and scorekeepers with high-velocity, real-time match tabulation that synchronizes courtside scoring with live broadcast overlays, individual box scores, and projected standings.

```
┌────────────────────────────────────────┐
│  Courtside Scoring Console (/ops)      │
│  - 1-Tap Scoring (+1 FT, +2 FG, +3 3PT)│
│  - Clock, Fouls & Period Advance       │
│  - Radix Modal Lifecycle Gates         │
└──────────────────┬─────────────────────┘
                   │
                   ▼
┌────────────────────────────────────────┐     Realtime Subscription
│  Cloudflare Worker API Gateway         │ ────────────────────────────┐
│  - POST /api/ops/games/:gameId/quick-pl│                             │
│  - POST /api/ops/games/:gameId/player-s│                             ▼
│  - POST /api/ops/overlay/:gameId/status│               ┌───────────────────────────┐
└──────────────────┬─────────────────────┘               │  Live Tabulation Scorebug │
                   │                                     │  - Instant Clock & Scores │
                   ▼                                     │  - Projected Standings    │
┌────────────────────────────────────────┐               │  - Official Final Lock    │
│  PostgreSQL Data Tier                  │               └───────────────────────────┘
│  - public.players (decoupled)          │
│  - public.game_rosters                 │
│  - public.player_game_stats            │
│  - public.mvw_standings (materialized) │
└────────────────────────────────────────┘
```

---

## 2. Decoupled Roster Model (Zero Synthetic Auth Profiles)

In compliance with proven industry patterns (GameChanger, iScore), roster players are standalone sports entities that do not require authenticated user accounts (`auth.users` / `public.profiles`).

- **Migration `20260816000000_decouple_roster_players.sql`:**
  - `ALTER TABLE public.players ALTER COLUMN profile_id DROP NOT NULL;`
  - `ALTER TABLE public.players ALTER COLUMN user_id DROP NOT NULL;`
  - `ALTER TABLE public.players DROP CONSTRAINT IF EXISTS players_user_id_key;`
  - `ALTER TABLE public.players ADD COLUMN IF NOT EXISTS display_name text;`
- **Zero Cross-Identity Collisions:**
  - Quick-adding a player creates an isolated `players` record directly linked to `team_id` and `league_id`.
  - Zero auto-merging across teams; duplicate names on opposing teams maintain isolated stats.

---

## 3. Game Lifecycle & Correction Protocol

| Status Transition | Trigger & Action | Period Display | Standings Effect |
| :--- | :--- | :--- | :--- |
| **`upcoming` → `live`** | Operator taps *Start Match* | `Q1` | Overlay live scores active; `fn_live_standings_preview` projects outcome |
| **`live` → `final`** | Operator confirms *Finalize Game* modal | `FINAL` | Clock stops (0.0s); official `mvw_standings` refresh trigger fires |
| **`final` → `review_pending`** | Operator confirms *Reopen Game* modal | `CORR` | Controls unlocked; shows `"Under Correction — not yet official"` banner |
| **`review_pending` → `final`** | Operator confirms *Finalize Game* modal | `FINAL` | Corrected scores locked; official `mvw_standings` refreshed with new totals |

---

## 4. Verification Proof

- **TypeScript Typecheck:** Strict compilation passed with 0 errors (`npm run typecheck`).
- **ESLint Validation:** Zero warnings policy enforced across all files (`npm run lint`).
- **Vitest Suites:** 1492 unit & integration tests passing (`npm test`).
- **Playwright E2E:** 100% passing across Desktop and Mobile Viewport (390x844).
- **Production Build:** Vite production bundle compiled in ~23.8s (`npm run build`).
