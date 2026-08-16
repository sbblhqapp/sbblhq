-- ============================================================================
-- Migration: 20260816160000_disk_io_optimization_covering_indexes.sql
-- Description: Adds covering indexes on high-frequency foreign keys & filter columns
--              to eliminate sequential table scans (Seq Scan) and reduce Disk IOPS.
-- ============================================================================

-- 1. Games index for status & schedule filtering (scores, schedule, home page)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_games_league_status_sched
  ON public.games (league_id, status, scheduled_at ASC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_games_status_sched
  ON public.games (status, scheduled_at ASC);

-- 2. Game Rosters & Player Stats covering indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_game_rosters_game_team
  ON public.game_rosters (game_id, team_id, active);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_player_game_stats_game_player
  ON public.player_game_stats (game_id, player_id);

-- 3. Highlight Clips & Engagement Polls lookup indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_highlight_clips_game_occurred
  ON public.highlight_clips (game_id, occurred_at DESC)
  WHERE game_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_engagement_polls_game_status
  ON public.engagement_polls (game_id, status, created_at DESC);

-- 4. Store products active catalog index
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_store_products_active_catalog
  ON public.store_products (active, _deleted, name ASC)
  WHERE active = true AND _deleted = false;

-- 5. Sponsor slots active rotation index
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sponsor_slots_active_rotation
  ON public.sponsor_slots (active, weight DESC)
  WHERE active = true;
