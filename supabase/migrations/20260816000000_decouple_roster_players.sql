-- Migration: Decouple Roster Players from Profiles and Auth Accounts
-- Matches confirmed competitor pattern (GameChanger/iScore, 24M+ games scored)
-- Roster players are standalone entities; user accounts are optional.

ALTER TABLE public.players ALTER COLUMN profile_id DROP NOT NULL;
ALTER TABLE public.players ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.players DROP CONSTRAINT IF EXISTS players_user_id_key;
ALTER TABLE public.players ADD COLUMN IF NOT EXISTS display_name text;

CREATE INDEX IF NOT EXISTS idx_players_team_id ON public.players(team_id);
