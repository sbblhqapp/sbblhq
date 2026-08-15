<!-- Version: v1.0.0 | Date: 2026-08-15 | Status: Current -->
# Live Scoring, Courtside Controls & Player Stats Engine

**Document:** `docs/features/LIVE_SCORING_AND_PLAYER_STATS_v1.0.0.md`  
**Author:** APEX Business Systems Ltd. | SBBL HQ  
**System Surfaces:** `/ops` (Live Tabulation), `/ops/scoreboard/:gameId`, `/scorekeeper/:gameId`, `/overlay/:gameId`  

---

## 1. Executive Summary

The Live Scoring, Courtside Controls & Player Stats Engine is the centralized real-time tabulation architecture for SBBL HQ across all three basketball leagues (WBL, TGIF, and SBBL Spring Edition).

It provides:
1. **⚡ 1-Click Match Setup & Courtside Launcher:** Pre-game setup executed on the spot without multi-step navigation hops or raw UUID lookup.
2. **Unified Courtside Controls (`<CourtsideQuickControls />`):** Standardized, touch-optimized courtside buttons for point increments (`+1, +2, +3`), clock management (`START / STOP, ±10s, SET`), fouls (`+1 FL`), possession toggle, and quarter advancement.
3. **1-Tap Player Stat Attribution (`<PlayerStatsTracker />`):** Direct attribution of individual box score stats (`+1 FT, +2 FG, +3 3PT, REB, AST, STL, BLK, FLS`) with automatic team score and standings synchronization.
4. **Real-Time Standings Projection:** Database function `public.fn_live_standings_preview` dynamically calculating hypothetical in-game standings shifts without requiring batch end-of-night processing.
5. **OBS Broadcast Overlay Integration:** Chromeless, high-FPS scorebug for livestreaming rigs on `/overlay/:gameId`.

---

## 2. Component Architecture

```
                                  ┌──────────────────────────┐
                                  │   Supabase PostgreSQL    │
                                  │  - games / overlays      │
                                  │  - game_player_stats     │
                                  │  - fn_live_standings     │
                                  └─────────────┬────────────┘
                                                │
                          ┌─────────────────────┴─────────────────────┐
                          ▼                                           ▼
            ┌───────────────────────────┐               ┌───────────────────────────┐
            │   Cloudflare Worker API   │               │   Supabase Realtime Pub   │
            │  - /ops/overlay/:id/*     │               │  - postgres_changes:games │
            │  - /games/:id/player-stats│               │  - postgres_changes:stats │
            └─────────────┬─────────────┘               └─────────────┬─────────────┘
                          │                                           │
       ┌──────────────────┴───────────────────────────────────────────┴──────────────────┐
       ▼                                           ▼                                     ▼
┌──────────────────────────────┐    ┌──────────────────────────────┐    ┌──────────────────────────────┐
│       /ops (Admin Tab)       │    │     /scorekeeper/:gameId     │    │       /overlay/:gameId       │
│  - 1-Click Game Launcher     │    │  - Mobile Touch Console      │    │  - OBS Chromeless Scorebug   │
│  - Active Games Switcher     │    │  - Courtside Quick Controls  │    │  - High-Contrast Typography  │
│  - <LiveScoreboard />        │    │  - <PlayerStatsTracker />    │    │  - Real-Time Score Updates   │
└──────────────────────────────┘    └──────────────────────────────┘    └──────────────────────────────┘
```

---

## 3. Data Synchronization & Attribution Model

### 3.1 Point Attribution
When an operator taps `+2 FG` on player **#11 David Lee**:
1. `POST /api/public/games/:gameId/player-stats` fires with `{ playerId: '...', stat: 'pts', delta: 2, syncTeamScore: true }`.
2. The player's individual points increase from `0` to `2`.
3. The team's score increments atomically by `+2`.
4. `<LiveScoreboard />` receives the mutation response and pulses the score change banner via Framer Motion.
5. Realtime broadcasts trigger `/overlay/:gameId` and update the live OBS stream overlay in `< 100ms`.

### 3.2 Courtside Walk-on Management
If an unregistered player joins a game courtside:
1. Operator clicks `+ Quick Add Player`.
2. Enters Name (e.g. `Jordan Blake`) and Jersey `#` (e.g. `99`).
3. Player is created and immediately mounted to the active courtside roster without interrupting live scoring.

---

## 4. Quality & Ergonomics Standards

- **Touch Targets:** Minimum 44px on mobile viewports for courtside touchscreens.
- **Fail-Closed Runtime Safety:** Safe optional chaining across reference catalogs (`bootstrapQuery.data?.references?.leagues`) and null-safe OBS overlay rendering.
- **Visual Design:** High-contrast Dark Gold palette (`#0A0A0A`, `#161616`, `#C9A84C`, `#F5F5F0`) engineered for glare resistance in gymnasium lighting.
