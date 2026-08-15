/**
 * Game Player Stats Routes
 *
 * Public
 * ──────
 * GET  /api/public/games/:gameId/player-stats   → Fetch game rosters & individual stats
 *
 * Authenticated (admin / league / ops)
 * ────────────────────────────────────
 * POST /api/ops/games/:gameId/player-stats      → Increment/set player stat & sync team score
 * POST /api/ops/games/:gameId/quick-player      → Add player directly to game roster
 */

import type { HandlerCtx } from "../shared";
import { json } from "../shared";

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

async function requireStatsAdmin(ctx: HandlerCtx): Promise<string> {
  const userId = ctx.req.headers.get("x-sbbl-user-id-verified");
  if (!userId) throw new Error("unauthorized");
  const { data, error } = await ctx.admin
    .from("user_role_assignments")
    .select("role")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  const roles = (data ?? []).map((row) => String(row.role));
  if (
    !roles.some((r) =>
      ["super_admin", "league_admin", "team_manager", "media_operator"].includes(r),
    )
  ) {
    throw new Error("forbidden");
  }
  return userId;
}

export interface PlayerStatEntry {
  playerId: string;
  playerName: string;
  jerseyNumber: number | null;
  position?: string | null;
  avatarUrl?: string | null;
  teamId: string | null;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  fls: number;
  min: number;
}

interface RawPlayerWithProfile {
  id: string;
  jersey_number?: number | null;
  position?: string | null;
  team_id?: string | null;
  profile?: {
    full_name?: string | null;
    display_name?: string | null;
    avatar_url?: string | null;
  } | null;
}

interface RawRosterRow {
  player_id: string;
  team_id: string | null;
  active: boolean;
  player?: RawPlayerWithProfile | null;
}

// GET /api/public/games/:gameId/player-stats
export async function handleGetGamePlayerStats(ctx: HandlerCtx) {
  const { gameId } = ctx.params;
  if (!gameId || !isUuid(gameId)) {
    return json({ ok: false, error: "invalid_game_id" }, 400);
  }

  // 1. Fetch game details
  const { data: game, error: gameErr } = await ctx.admin
    .from("games")
    .select(`
      id, league_id, home_team_id, away_team_id,
      participant1_label, participant2_label,
      home_team:home_team_id ( id, name, logo_url ),
      away_team:away_team_id ( id, name, logo_url )
    `)
    .eq("id", gameId)
    .maybeSingle();

  if (gameErr || !game) {
    return json({ ok: false, error: "game_not_found" }, 404);
  }

  const homeTeamId = (game as { home_team_id?: string | null }).home_team_id ?? null;
  const awayTeamId = (game as { away_team_id?: string | null }).away_team_id ?? null;

  // 2. Fetch game rosters and players
  const [{ data: rosterRows }, { data: homeTeamPlayers }, { data: awayTeamPlayers }, { data: statsRows }] = await Promise.all([
    ctx.admin
      .from("game_rosters")
      .select(`
        player_id, team_id, active,
        player:player_id (
          id, jersey_number, position, team_id,
          profile:profile_id ( full_name, display_name, avatar_url )
        )
      `)
      .eq("game_id", gameId),
    homeTeamId
      ? ctx.admin
          .from("players")
          .select(`
            id, jersey_number, position, team_id,
            profile:profile_id ( full_name, display_name, avatar_url )
          `)
          .eq("team_id", homeTeamId)
      : Promise.resolve({ data: [] }),
    awayTeamId
      ? ctx.admin
          .from("players")
          .select(`
            id, jersey_number, position, team_id,
            profile:profile_id ( full_name, display_name, avatar_url )
          `)
          .eq("team_id", awayTeamId)
      : Promise.resolve({ data: [] }),
    ctx.admin
      .from("player_game_stats")
      .select("*")
      .eq("game_id", gameId),
  ]);

  const statsMap = new Map<string, Record<string, number>>();
  for (const s of (statsRows ?? []) as Array<Record<string, unknown>>) {
    statsMap.set(String(s.player_id), s as Record<string, number>);
  }

  const parsePlayer = (
    p: RawPlayerWithProfile,
    teamId: string | null
  ): PlayerStatEntry => {
    const stats = statsMap.get(p.id) ?? {};
    const profile = p.profile ?? {};
    const name = profile.display_name || profile.full_name || `Player #${p.jersey_number ?? '?'}`;
    return {
      playerId: p.id,
      playerName: name,
      jerseyNumber: p.jersey_number ?? null,
      position: p.position ?? null,
      avatarUrl: profile.avatar_url ?? null,
      teamId,
      pts: Number(stats.pts ?? 0),
      reb: Number(stats.reb ?? 0),
      ast: Number(stats.ast ?? 0),
      stl: Number(stats.stl ?? 0),
      blk: Number(stats.blk ?? 0),
      fls: Number(stats.fls ?? 0),
      min: Number(stats.min ?? 0),
    };
  };

  const homePlayersMap = new Map<string, PlayerStatEntry>();
  const awayPlayersMap = new Map<string, PlayerStatEntry>();

  // Add default team players
  for (const p of (homeTeamPlayers ?? []) as unknown as RawPlayerWithProfile[]) {
    homePlayersMap.set(p.id, parsePlayer(p, homeTeamId));
  }
  for (const p of (awayTeamPlayers ?? []) as unknown as RawPlayerWithProfile[]) {
    awayPlayersMap.set(p.id, parsePlayer(p, awayTeamId));
  }

  // Overlay game rosters
  for (const r of (rosterRows ?? []) as unknown as RawRosterRow[]) {
    if (!r.player) continue;
    const isHome = r.team_id === homeTeamId;
    const entry = parsePlayer(r.player, r.team_id);
    if (isHome) {
      homePlayersMap.set(r.player_id, entry);
    } else {
      awayPlayersMap.set(r.player_id, entry);
    }
  }

  // Include any player with stats in this game even if not in roster
  for (const s of (statsRows ?? []) as Array<Record<string, unknown>>) {
    const pId = String(s.player_id);
    if (!homePlayersMap.has(pId) && !awayPlayersMap.has(pId)) {
      homePlayersMap.set(pId, {
        playerId: pId,
        playerName: `Player (${pId.slice(0, 6)})`,
        jerseyNumber: null,
        teamId: homeTeamId,
        pts: Number(s.pts ?? 0),
        reb: Number(s.reb ?? 0),
        ast: Number(s.ast ?? 0),
        stl: Number(s.stl ?? 0),
        blk: Number(s.blk ?? 0),
        fls: Number(s.fls ?? 0),
        min: Number(s.min ?? 0),
      });
    }
  }

  const homeList = Array.from(homePlayersMap.values()).sort(
    (a, b) => (a.jerseyNumber ?? 999) - (b.jerseyNumber ?? 999)
  );
  const awayList = Array.from(awayPlayersMap.values()).sort(
    (a, b) => (a.jerseyNumber ?? 999) - (b.jerseyNumber ?? 999)
  );

  const homeTeamRaw = (game as Record<string, unknown>).home_team;
  const homeTeamObj = Array.isArray(homeTeamRaw) ? (homeTeamRaw[0] as Record<string, unknown> | undefined) : (homeTeamRaw as Record<string, unknown> | null);
  const homeTeamName = (homeTeamObj?.name as string | undefined) ?? (game as Record<string, unknown>).participant1_label as string | undefined ?? "Home";

  const awayTeamRaw = (game as Record<string, unknown>).away_team;
  const awayTeamObj = Array.isArray(awayTeamRaw) ? (awayTeamRaw[0] as Record<string, unknown> | undefined) : (awayTeamRaw as Record<string, unknown> | null);
  const awayTeamName = (awayTeamObj?.name as string | undefined) ?? (game as Record<string, unknown>).participant2_label as string | undefined ?? "Away";

  return json(
    {
      ok: true,
      gameId,
      home: {
        teamId: homeTeamId,
        teamName: homeTeamName,
        players: homeList,
      },
      away: {
        teamId: awayTeamId,
        teamName: awayTeamName,
        players: awayList,
      },
    },
    200
  );
}

// POST /api/ops/games/:gameId/player-stats
export async function handleOpsRecordPlayerStat(ctx: HandlerCtx) {
  await requireStatsAdmin(ctx);
  const { gameId } = ctx.params;
  if (!gameId || !isUuid(gameId)) {
    return json({ ok: false, error: "invalid_game_id" }, 400);
  }

  const body = (await ctx.req.json().catch(() => null)) as {
    playerId: string;
    stat: "pts" | "reb" | "ast" | "stl" | "blk" | "fls" | "min";
    delta?: number;
    set?: number;
    teamSide?: "home" | "away";
    syncTeamScore?: boolean;
  } | null;

  if (!body?.playerId || !body.stat) {
    return json({ ok: false, error: "missing_player_or_stat" }, 400);
  }

  const statField = body.stat;
  const delta = body.delta ?? 1;

  // 1. Fetch current player game stat row
  const { data: existing } = await ctx.admin
    .from("player_game_stats")
    .select("*")
    .eq("game_id", gameId)
    .eq("player_id", body.playerId)
    .maybeSingle();

  const currentVal = existing ? Number(existing[statField] ?? 0) : 0;
  const nextVal = body.set !== undefined ? Math.max(0, body.set) : Math.max(0, currentVal + delta);

  // 2. Upsert player_game_stats
  const payload: Record<string, unknown> = {
    game_id: gameId,
    player_id: body.playerId,
    [statField]: nextVal,
    updated_at: new Date().toISOString(),
  };

  const { data: savedStat, error: statErr } = await ctx.admin
    .from("player_game_stats")
    .upsert(payload, { onConflict: "game_id,player_id" })
    .select()
    .single();

  if (statErr) {
    return json({ ok: false, error: statErr.message }, 500);
  }

  // 3. Sync Team Score / Foul if requested
  if (body.teamSide && body.syncTeamScore !== false) {
    if (statField === "pts" && delta !== 0) {
      // Adjust overlay score
      const { data: overlay } = await ctx.admin
        .from("overlay_game_state")
        .select("home_score, away_score")
        .eq("game_id", gameId)
        .maybeSingle();

      if (overlay) {
        const sideScoreField = body.teamSide === "home" ? "home_score" : "away_score";
        const newScore = Math.max(0, (overlay[sideScoreField] ?? 0) + delta);
        await ctx.admin
          .from("overlay_game_state")
          .update({ [sideScoreField]: newScore })
          .eq("game_id", gameId);
        await ctx.admin
          .from("games")
          .update({ [sideScoreField]: newScore })
          .eq("id", gameId);
      }
    } else if (statField === "fls" && delta !== 0) {
      const { data: overlay } = await ctx.admin
        .from("overlay_game_state")
        .select("home_fouls, away_fouls")
        .eq("game_id", gameId)
        .maybeSingle();

      if (overlay) {
        const sideFoulField = body.teamSide === "home" ? "home_fouls" : "away_fouls";
        const newFouls = Math.max(0, (overlay[sideFoulField] ?? 0) + delta);
        await ctx.admin
          .from("overlay_game_state")
          .update({ [sideFoulField]: newFouls })
          .eq("game_id", gameId);
      }
    }
  }

  return json({ ok: true, stats: savedStat }, 200);
}

// POST /api/ops/games/:gameId/quick-player
export async function handleOpsQuickAddPlayer(ctx: HandlerCtx) {
  await requireStatsAdmin(ctx);
  const { gameId } = ctx.params;
  if (!gameId || !isUuid(gameId)) {
    return json({ ok: false, error: "invalid_game_id" }, 400);
  }

  const body = (await ctx.req.json().catch(() => null)) as {
    name: string;
    jerseyNumber?: number | string;
    teamSide: "home" | "away";
  } | null;

  if (!body?.name?.trim()) {
    return json({ ok: false, error: "name_required" }, 400);
  }

  // 1. Get game to determine team_id and league_id
  const { data: game } = await ctx.admin
    .from("games")
    .select("league_id, home_team_id, away_team_id")
    .eq("id", gameId)
    .single();

  if (!game) return json({ ok: false, error: "game_not_found" }, 404);

  const teamId = body.teamSide === "home" ? game.home_team_id : game.away_team_id;
  const leagueId = game.league_id;
  const jersey = body.jerseyNumber !== undefined && body.jerseyNumber !== "" ? Number(body.jerseyNumber) : null;

  // 2. Create Profile & Player row
  const { data: profile, error: profErr } = await ctx.admin
    .from("profiles")
    .insert({
      full_name: body.name.trim(),
      display_name: body.name.trim(),
    })
    .select("id")
    .single();

  if (profErr) return json({ ok: false, error: profErr.message }, 500);

  const { data: player, error: playerErr } = await ctx.admin
    .from("players")
    .insert({
      user_id: profile.id,
      profile_id: profile.id,
      team_id: teamId,
      league_id: leagueId,
      jersey_number: jersey,
    })
    .select("id, jersey_number")
    .single();

  if (playerErr) return json({ ok: false, error: playerErr.message }, 500);

  // 3. Link to game_rosters
  await ctx.admin.from("game_rosters").upsert({
    game_id: gameId,
    team_id: teamId,
    player_id: player.id,
    active: true,
  }, { onConflict: "game_id,player_id" });

  return json(
    {
      ok: true,
      player: {
        id: player.id,
        name: body.name.trim(),
        jerseyNumber: player.jersey_number,
        teamId,
      },
    },
    200
  );
}
