-- Migration: Partial index for fast lookup of unclaimed roster players
-- Speeds up GET /api/public/unclaimed-players?team_id=...
-- Note: CONCURRENTLY cannot run inside a transaction block.

DROP INDEX IF EXISTS idx_players_unclaimed_by_team;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_players_unclaimed_by_team
  ON public.players (team_id, jersey_number, display_name)
  WHERE user_id IS NULL AND merged_into IS NULL;
