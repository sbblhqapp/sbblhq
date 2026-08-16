-- Migration: Partial index for fast lookup of unclaimed roster players
-- Speeds up GET /api/public/unclaimed-players?team_id=...

CREATE INDEX IF NOT EXISTS idx_players_unclaimed_by_team
  ON public.players (team_id)
  WHERE user_id IS NULL;
