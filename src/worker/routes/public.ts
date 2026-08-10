/**
 * Public API route handlers — no auth required.
 *
 * Extracted from src/worker/index.ts to reduce monolith size.
 * The main Worker index.ts still references these via the route table.
 */
import type { HandlerCtx } from "../shared";
import { json, resolveLeagueIdFilter, LEAGUE_NO_MATCH } from "../shared";

export async function handlePublicConfig({ env }: HandlerCtx) {
  // Capability flag: tells the UI whether Google OAuth is a working sign-in
  // path. Defaults to false so the button cannot falsely advertise the
  // provider when Google Cloud has the OAuth client in `org_internal` state.
  // The operator opts in by setting GOOGLE_OAUTH_ENABLED ("true") in worker
  // vars (see docs/ops/OAUTH_HOTFIX_RUNBOOK.md). The legacy alias
  // FEATURE_GOOGLE_OAUTH is read for back-compat with older wrangler configs.
  const googleEnabledRaw =
    env.GOOGLE_OAUTH_ENABLED ?? env.FEATURE_GOOGLE_OAUTH ?? "false";
  const googleOAuthEnabled =
    String(googleEnabledRaw).trim().toLowerCase() === "true";

  return json({
    ok: true,
    appName: "SBBL HQ",
    defaultLeague: "SBBL",
    supabaseUrl: env.SUPABASE_URL ?? null,
    supabasePublishableKey: env.SUPABASE_PUBLISHABLE_KEY ?? null,
    googleOAuthEnabled,
  });
}

export async function handlePublicSchedule({ req, admin }: HandlerCtx) {
  const url = new URL(req.url);
  // CLAUDE.md rule 10: the frontend sends a LEAGUE_REGISTRY slug ('sbbl',
  // 'wbl', 'tgifbl'), never a raw league_id UUID. Passing that slug straight
  // into .eq('league_id', ...) throws Postgres 22P02 (this exact endpoint,
  // for all three leagues, was broken in production 2026-08-09 until this
  // fix — the public Schedules page showed "Unable to load schedules" for
  // every league). Must resolve through resolveLeagueIdFilter.
  const leagueFilter = await resolveLeagueIdFilter(
    admin,
    url.searchParams.get("leagueId"),
  );
  if (leagueFilter === LEAGUE_NO_MATCH) {
    return json({ ok: true, data: [] });
  }
  let q = admin.from("schedule_slots").select("*").eq("status", "upcoming");
  if (leagueFilter) {
    q = q.eq("league_id", leagueFilter);
  }
  const { data, error } = await q.order("starts_at", { ascending: true });
  if (error) throw new Error(error.message);
  return new Response(JSON.stringify({ ok: true, data }), {
    headers: {
      "content-type": "application/json",
      "cache-control": "public, s-maxage=60, max-age=30",
    },
  });
}

export async function handlePublicPotg({ admin }: HandlerCtx) {
  const { data, error } = await admin
    .from("media_publications")
    .select("id,title,surface,league_id,status,render_payload,published_at,created_at")
    .eq("surface", "potg")
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);
  return new Response(JSON.stringify({ ok: true, data }), {
    headers: {
      "content-type": "application/json",
      "cache-control": "public, s-maxage=30, max-age=15",
    },
  });
}

export async function handlePublicHome({ req, admin }: HandlerCtx) {
  const url = new URL(req.url);
  const leagueCode = (url.searchParams.get("league") ?? "SBBL").toUpperCase();

  const [leaguesRes, teamsRes, gamesRes, seasonsRes] = await Promise.all([
    admin.from("leagues").select("id,name,code").order("name"),
    admin
      .from("teams")
      .select(
        "id,name,leagues(name,code),seasons(name),divisions(name),players(id)",
      )
      .eq("status", "published")
      .limit(200),
    admin
      .from("games")
      .select(
        "id,home_team_id,away_team_id,status,home_score,away_score,scheduled_at,venue_id,venues(name),courts(name),season_id,seasons(league_id,leagues(code))",
      )
      .in("status", ["live", "upcoming", "final"])
      .order("scheduled_at", { ascending: true })
      .limit(50),
    admin
      .from("seasons")
      .select("id,name,league_id,leagues(code),status")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const leagues = (leaguesRes.data ?? []) as Array<{
    id: string;
    name: string;
    code: string;
  }>;
  const activeLeague =
    leagues.find((l) => l.code?.toUpperCase() === leagueCode) ??
    leagues[0] ??
    null;
  const activeLeagueId = activeLeague?.id ?? null;

  const allTeams = (teamsRes.data ?? []).map(
    (row: Record<string, unknown>) => ({
      id: String(row.id),
      name: String(row.name),
      league_code: (
        (row.leagues as { code?: string } | null)?.code ?? ""
      ).toUpperCase(),
      league_name: String(
        (row.leagues as { name?: string } | null)?.name ?? "",
      ),
      season_name: String(
        (row.seasons as { name?: string } | null)?.name ?? "",
      ),
      division_name: (row.divisions as { name?: string } | null)?.name ?? null,
      roster_count: Array.isArray(row.players) ? row.players.length : 0,
    }),
  );
  const leagueTeams = activeLeagueId
    ? allTeams.filter((t) => t.league_code === leagueCode)
    : allTeams;

  const allGames = (gamesRes.data ?? []).map(
    (row: Record<string, unknown>) => {
      const seasons = row.seasons as {
        league_id?: string;
        leagues?: { code?: string };
      } | null;
      return {
        id: String(row.id),
        home_team_id: row.home_team_id as string | null,
        away_team_id: row.away_team_id as string | null,
        status: String(row.status ?? "upcoming"),
        home_score: row.home_score as number | null,
        away_score: row.away_score as number | null,
        scheduled_at: row.scheduled_at as string | null,
        venue: (row.venues as { name?: string } | null)?.name ?? null,
        court: (row.courts as { name?: string } | null)?.name ?? null,
        league_code: (seasons?.leagues?.code ?? "").toUpperCase(),
      };
    },
  );
  const leagueGames = allGames.filter((g) => g.league_code === leagueCode);

  const teamMap = new Map(allTeams.map((t) => [t.id, t]));
  const enrichGame = (g: (typeof leagueGames)[0]) => ({
    ...g,
    home_team: teamMap.get(g.home_team_id ?? "") ?? null,
    away_team: teamMap.get(g.away_team_id ?? "") ?? null,
  });

  const liveGames = leagueGames
    .filter((g) => g.status === "live")
    .map(enrichGame);
  const upcomingGames = leagueGames
    .filter((g) => g.status === "upcoming")
    .slice(0, 5)
    .map(enrichGame);
  const recentGames = leagueGames
    .filter((g) => g.status === "final")
    .slice(0, 5)
    .map(enrichGame);

  // FAST PATH: If we resolved activeLeagueId, match by ID directly (O(1) comparison vs string allocations)
  const activeSeason = (seasonsRes.data ?? []).find((s: Record<string, unknown>) =>
    activeLeagueId
      ? s.league_id === activeLeagueId
      : ((s.leagues as { code?: string } | null)?.code ?? "").toUpperCase() ===
        leagueCode,
  ) as { id: string; name: string; status: string } | undefined;

  return new Response(
    JSON.stringify({
      ok: true,
      league: activeLeague,
      season: activeSeason
        ? {
            id: activeSeason.id,
            name: activeSeason.name,
            status: activeSeason.status,
          }
        : null,
      teams: leagueTeams,
      totalTeams: leagueTeams.length,
      totalRostered: leagueTeams.reduce((sum, t) => sum + t.roster_count, 0),
      liveGames,
      upcomingGames,
      recentGames,
      totalGames: leagueGames.length,
      leagues: leagues.map((l) => ({ id: l.id, name: l.name, code: l.code })),
    }),
    {
      headers: {
        "content-type": "application/json",
        "cache-control": "public, s-maxage=30, max-age=15",
      },
    },
  );
}
