-- Migration: 20260827000000_fix_player_display_name_coalesce.sql
-- Description: Coalesce players.display_name before profiles name in get_stats_dashboard
-- and get_leaderboards RPCs so unlinked roster players (and newly added POTG players)
-- display their actual names rather than 'Unknown'.

CREATE OR REPLACE FUNCTION public.get_stats_dashboard(
  p_filters jsonb DEFAULT NULL::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_league_id uuid;
BEGIN
  IF p_filters IS NOT NULL AND p_filters ? 'league' THEN
    SELECT id INTO v_league_id FROM public.leagues
    WHERE code ILIKE (p_filters->>'league') LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'players', COALESCE((
      SELECT jsonb_agg(row_to_json(s) ORDER BY (row_to_json(s)->>'pts')::numeric DESC NULLS LAST)
      FROM (
        SELECT
          p.id                              AS id,
          COALESCE(p.display_name, pr.display_name, pr.full_name, 'Unknown') AS name,
          p.jersey_number                   AS number,
          p.position,
          p.team_id,
          t.name                            AS team_name,
          l.code                            AS league_id,
          pr.avatar_url                     AS avatar_url,
          COALESCE(ROUND(AVG(pgs.pts)::numeric, 1), 0) AS pts,
          COALESCE(ROUND(AVG(pgs.reb)::numeric, 1), 0) AS reb,
          COALESCE(ROUND(AVG(pgs.ast)::numeric, 1), 0) AS ast,
          COALESCE(ROUND(AVG(pgs.stl)::numeric, 1), 0) AS stl,
          COALESCE(ROUND(AVG(pgs.blk)::numeric, 1), 0) AS blk,
          COALESCE(ROUND(AVG(pgs.fls)::numeric, 1), 0) AS fls,
          COALESCE(ROUND(AVG(pgs.min)::numeric, 1), 0) AS min,
          COUNT(pgs.id)                                AS games
        FROM public.players p
        LEFT JOIN public.player_game_stats pgs ON pgs.player_id = p.id
        LEFT JOIN public.profiles pr ON pr.user_id = p.user_id
        LEFT JOIN public.teams    t  ON t.id = p.team_id
        LEFT JOIN public.leagues  l  ON l.id = p.league_id
        WHERE v_league_id IS NULL OR p.league_id = v_league_id
        GROUP BY p.id, p.display_name, pr.display_name, pr.full_name, p.jersey_number,
                 p.position, p.team_id, t.name, l.code, pr.avatar_url
      ) s
    ), '[]'::jsonb)
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_stats_dashboard(jsonb) TO authenticated, anon, service_role;

CREATE OR REPLACE FUNCTION public.get_leaderboards(
  p_filters jsonb DEFAULT NULL::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_league_id uuid;
BEGIN
  IF p_filters IS NOT NULL AND p_filters ? 'league' THEN
    SELECT id INTO v_league_id FROM public.leagues
    WHERE code ILIKE (p_filters->>'league') LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'leaders', COALESCE((
      SELECT jsonb_agg(row_to_json(s))
      FROM (
        SELECT
          p.id AS id,
          COALESCE(p.display_name, pr.display_name, pr.full_name, 'Unknown') AS name,
          p.jersey_number AS number,
          p.position,
          t.name AS team_name,
          l.code AS league_id,
          ROUND(AVG(pgs.pts)::numeric, 1) AS pts,
          ROUND(AVG(pgs.reb)::numeric, 1) AS reb,
          ROUND(AVG(pgs.ast)::numeric, 1) AS ast,
          RANK() OVER (ORDER BY AVG(pgs.pts) DESC) AS rank
        FROM public.player_game_stats pgs
        JOIN public.players p ON p.id = pgs.player_id
        LEFT JOIN public.profiles pr ON pr.user_id = p.user_id
        LEFT JOIN public.teams t ON t.id = p.team_id
        LEFT JOIN public.leagues l ON l.id = p.league_id
        WHERE (v_league_id IS NULL OR p.league_id = v_league_id)
        GROUP BY p.id, p.display_name, pr.display_name, pr.full_name, p.jersey_number, p.position, t.name, l.code
        ORDER BY AVG(pgs.pts) DESC
        LIMIT 50
      ) s
    ), '[]'::jsonb)
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_leaderboards(jsonb) TO authenticated, anon, service_role;
