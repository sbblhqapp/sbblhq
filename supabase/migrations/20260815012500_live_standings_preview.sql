-- Read-only. Overlays currently-live overlay_game_state rows onto the final
-- mvw_standings snapshot to produce a "what-if-this-game-ended-now" projection.
-- Writes to neither table. Safe to drop with zero data loss (it's a pure function).

CREATE OR REPLACE FUNCTION public.fn_live_standings_preview(p_league_id uuid, p_season_id uuid)
RETURNS TABLE (
  team_id uuid,
  wins int,
  losses int,
  pts_for int,
  pts_against int,
  is_live_adjusted boolean
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH live_games AS (
    SELECT g.id, g.home_team_id, g.away_team_id,
           ogs.home_score, ogs.away_score
    FROM public.games g
    JOIN public.overlay_game_state ogs ON ogs.game_id = g.id
    WHERE g.league_id = p_league_id
      AND g.season_id = p_season_id
      AND g.status IN ('live', 'in_progress')
  )
  SELECT
    s.team_id,
    (s.wins + COALESCE(SUM(CASE WHEN lg.home_team_id = s.team_id AND lg.home_score > lg.away_score THEN 1
                                WHEN lg.away_team_id = s.team_id AND lg.away_score > lg.home_score THEN 1
                                ELSE 0 END), 0))::int AS wins,
    (s.losses + COALESCE(SUM(CASE WHEN lg.home_team_id = s.team_id AND lg.home_score < lg.away_score THEN 1
                                  WHEN lg.away_team_id = s.team_id AND lg.away_score < lg.home_score THEN 1
                                  ELSE 0 END), 0))::int AS losses,
    (s.pts_for + COALESCE(SUM(CASE WHEN lg.home_team_id = s.team_id THEN lg.home_score
                                   WHEN lg.away_team_id = s.team_id THEN lg.away_score
                                   ELSE 0 END), 0))::int AS pts_for,
    (s.pts_against + COALESCE(SUM(CASE WHEN lg.home_team_id = s.team_id THEN lg.away_score
                                       WHEN lg.away_team_id = s.team_id THEN lg.home_score
                                       ELSE 0 END), 0))::int AS pts_against,
    (COUNT(lg.id) > 0) AS is_live_adjusted
  FROM public.mvw_standings s
  LEFT JOIN live_games lg ON lg.home_team_id = s.team_id OR lg.away_team_id = s.team_id
  WHERE s.league_id = p_league_id AND s.season_id = p_season_id
  GROUP BY s.team_id, s.wins, s.losses, s.pts_for, s.pts_against;
$$;

GRANT EXECUTE ON FUNCTION public.fn_live_standings_preview(uuid, uuid) TO anon, authenticated, service_role;
