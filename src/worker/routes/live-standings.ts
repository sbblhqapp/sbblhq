/**
 * Public Live Standings Route
 *
 * GET /api/public/live-standings/:leagueId/:seasonId
 *
 * Calls fn_live_standings_preview via Supabase RPC to produce a
 * "what-if-this-game-ended-now" projected standings calculation.
 * Public endpoint — no auth required (Iron Law 2).
 */
import type { HandlerCtx } from "../shared";
import { json, resolveLeagueId, LEAGUE_UUID_RE } from "../shared";

export interface ProjectedStanding {
  team_id: string;
  wins: number;
  losses: number;
  pts_for: number;
  pts_against: number;
  is_live_adjusted: boolean;
}

export async function handlePublicLiveStandings({ params, admin }: HandlerCtx) {
  const rawLeagueId = params.leagueId ?? "";
  const seasonId = params.seasonId ?? "";

  if (!rawLeagueId || !seasonId) {
    return json({ ok: false, error: "missing_required_params" }, 400);
  }

  // Resolve league ID (handles slugs like 'sbbl', 'wbl', 'tgifbl' or raw UUIDs)
  const leagueId = await resolveLeagueId(admin, rawLeagueId);
  if (!leagueId) {
    return json({ ok: true, data: [] });
  }

  // Validate seasonId UUID format
  if (!LEAGUE_UUID_RE.test(seasonId)) {
    return json({ ok: false, error: "invalid_season_id" }, 400);
  }

  const { data, error } = await admin.rpc("fn_live_standings_preview", {
    p_league_id: leagueId,
    p_season_id: seasonId,
  });

  if (error) {
    return json({ ok: false, error: error.message }, 500);
  }

  return new Response(JSON.stringify({ ok: true, data: data ?? [] }), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, s-maxage=5, max-age=3",
    },
  });
}
