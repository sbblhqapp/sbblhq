# Correction: SBBL Spring Edition POTG Tabulation & Player Display Name Coalescing

- **Date:** 2026-08-27
- **Scope:** Project-wide & Global (Database Schema, Live Stats, Tabulation RPCs, Standings View)
- **Affected Pages:** `supabase/migrations/20260827000000_fix_player_display_name_coalesce.sql`, `src/pages/Leaderboards.tsx`, `src/pages/Stats.tsx`, `src/pages/Teams.tsx`, `src/pages/Scores.tsx`
- **Promotion Decision:** Core Directive & User-Pattern Rule

## Original Assumptions vs. Corrected State

### 1. SBBL Spring Edition POTG Tabulation & Match Finalization
- **Original Assumption:** Preliminary scheduled slots on August 16 remained unfinalized with null scores in the database.
- **Corrected State:** Five verified Player of the Game (POTG) matches were parsed from official scorecards and tabulated into `public.games`, `public.player_game_stats`, and `public.import_jobs`:
  1. **GLS Titos (53) vs Young Bucks (51)** — POTG: **Nae De Vera** (16 PTS, 8 REB, 4 AST)
  2. **SPG Jrs. (61) vs Slam Drunks (41)** — POTG: **Patrick De Jesus** (25 PTS, 4 REB, 6 AST)
  3. **Swishers (47) vs Tita Hunters (38)** — POTG: **Jamie Saddalan** (12 PTS, 7 REB, 5 AST)
  4. **Almighty (67) vs Rawstar (58)** — POTG: **Carlo Galve** (#15, 18 PTS, 3 REB, 5 AST)
  5. **PTB Jrs. (59) vs Rebelde Jrs. (58)** — POTG: **Jordan Fangonilo** (#17, 22 PTS, 6 REB, 5 AST)

### 2. Team Entity Creation & Division Assignment
- **Corrected State:** Created `Swishers` team (`683301c0-2e1a-465a-8241-b3de554eee6f`) under SBBL Spring Edition (`72ba2e09-302d-4bf4-8ebc-f895fb896b5f`), season `4a0ca57f-8072-41c5-9d33-cef8db214de3`, and division `9abbc728-cca7-46b9-8dcd-78ae2bd4c331` (P10) with published status.

### 3. Display Name Coalescing in Leaderboards & Stats RPCs
- **Original Assumption:** `get_stats_dashboard` and `get_leaderboards` joined on `profiles pr` via `user_id`, causing roster players without an active auth profile to render as `"Unknown"`.
- **Corrected State:** Added dated migration `20260827000000_fix_player_display_name_coalesce.sql` updating both RPCs to coalesce `p.display_name` first:
  ```sql
  COALESCE(p.display_name, pr.display_name, pr.full_name, 'Unknown') AS name
  ```
  This guarantees that all players without an assigned Supabase Auth `user_id` correctly display their full player name across leaderboards and statistics dashboards.

### 4. Standings & Materialized View Refresh
- **Corrected State:** Updated `teams.record` JSON across all 10 teams and refreshed `mvw_standings` concurrently. Standings properly rank teams by Win %, Total Wins, and Point Differential.
