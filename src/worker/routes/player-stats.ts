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
  display_name?: string | null;
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
          id, jersey_number, position, team_id, display_name,
          profile:profile_id ( full_name, display_name, avatar_url )
        )
      `)
      .eq("game_id", gameId),
    homeTeamId
      ? ctx.admin
          .from("players")
          .select(`
            id, jersey_number, position, team_id, display_name,
            profile:profile_id ( full_name, display_name, avatar_url )
          `)
          .eq("team_id", homeTeamId)
      : Promise.resolve({ data: [] }),
    awayTeamId
      ? ctx.admin
          .from("players")
          .select(`
            id, jersey_number, position, team_id, display_name,
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
    const name = p.display_name || profile.display_name || profile.full_name || `Player #${p.jersey_number ?? '?'}`;
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

  const awayPlayersMap = new Map<string, PlayerStatEntry>();
  const homePlayersMap = new Map<string, PlayerStatEntry>();

  // Add players from team roster definitions
  for (const p of (awayTeamPlayers ?? []) as RawPlayerWithProfile[]) {
    awayPlayersMap.set(p.id, parsePlayer(p, awayTeamId));
  }
  for (const p of (homeTeamPlayers ?? []) as RawPlayerWithProfile[]) {
    homePlayersMap.set(p.id, parsePlayer(p, homeTeamId));
  }

  // Add or override with players explicitly in game_rosters
  for (const r of (rosterRows ?? []) as unknown as RawRosterRow[]) {
    if (!r.player) continue;
    const parsed = parsePlayer(r.player, r.team_id);
    if (r.team_id === awayTeamId || (!homeTeamId && !r.team_id)) {
      awayPlayersMap.set(r.player_id, parsed);
    } else {
      homePlayersMap.set(r.player_id, parsed);
    }
  }

  const rawGame = game as Record<string, unknown>;
  const homeTeamName = (rawGame.home_team as { name?: string } | undefined)?.name || (rawGame.participant2_label as string | undefined) || "Home";
  const awayTeamName = (rawGame.away_team as { name?: string } | undefined)?.name || (rawGame.participant1_label as string | undefined) || "Away";

  return json(
    {
      ok: true,
      gameId,
      home: {
        teamId: homeTeamId,
        teamName: homeTeamName,
        players: Array.from(homePlayersMap.values()),
      },
      away: {
        teamId: awayTeamId,
        teamName: awayTeamName,
        players: Array.from(awayPlayersMap.values()),
      },
    },
    200
  );
}

// POST /api/ops/games/:gameId/player-stats
export async function handleOpsRecordPlayerStat(ctx: HandlerCtx) {
  const actorId = await requireStatsAdmin(ctx);
  const { gameId } = ctx.params;
  if (!gameId || !isUuid(gameId)) {
    return json({ ok: false, error: "invalid_game_id" }, 400);
  }

  const body = (await ctx.req.json().catch(() => null)) as {
    playerId: string;
    stat: "pts" | "reb" | "ast" | "stl" | "blk" | "fls" | "min";
    delta?: number;
    value?: number;
    teamSide?: "home" | "away";
    idempotencyKey?: string;
  } | null;

  if (!body?.playerId || !body.stat) {
    return json({ ok: false, error: "missing_fields" }, 400);
  }

  const validStats = ["pts", "reb", "ast", "stl", "blk", "fls", "min"];
  if (!validStats.includes(body.stat)) {
    return json({ ok: false, error: "invalid_stat_type" }, 400);
  }

  const idempotencyKey =
    ctx.req.headers.get("x-idempotency-key") ||
    body.idempotencyKey ||
    null;

  // Resolve team side
  let side = body.teamSide;
  if (!side) {
    const { data: player } = await ctx.admin
      .from("players")
      .select("team_id")
      .eq("id", body.playerId)
      .maybeSingle();

    const { data: game } = await ctx.admin
      .from("games")
      .select("home_team_id, away_team_id")
      .eq("id", gameId)
      .maybeSingle();

    if (player && game) {
      side = player.team_id === game.home_team_id ? "home" : "away";
    }
  }

  const delta = body.delta !== undefined ? Number(body.delta) : 1;

  // 1. Try atomic idempotent database RPC
  if (body.value === undefined) {
    const { data: rpcRes, error: rpcErr } = await ctx.admin.rpc(
      "fn_atomic_record_player_stat",
      {
        p_game_id: gameId,
        p_player_id: body.playerId,
        p_stat: body.stat,
        p_delta: delta,
        p_team_side: side ?? "away",
        p_idempotency_key: idempotencyKey,
        p_actor_id: actorId,
      },
    );

    if (!rpcErr && rpcRes && typeof rpcRes === "object" && "stats" in rpcRes) {
      return json({ ok: true, stats: (rpcRes as { stats: unknown }).stats }, 200);
    }
  }

  // 2. Fallback / direct value set path
  const { data: currentStats } = await ctx.admin
    .from("player_game_stats")
    .select("*")
    .eq("game_id", gameId)
    .eq("player_id", body.playerId)
    .maybeSingle();

  const currentVal = Number(currentStats?.[body.stat] ?? 0);
  const newVal = body.value !== undefined ? Math.max(0, Number(body.value)) : Math.max(0, currentVal + delta);

  const updatePayload: Record<string, unknown> = {
    game_id: gameId,
    player_id: body.playerId,
    [body.stat]: newVal,
    updated_at: new Date().toISOString(),
  };

  const { data: updatedStats, error: upsertErr } = await ctx.admin
    .from("player_game_stats")
    .upsert(updatePayload, { onConflict: "game_id,player_id" })
    .select("*")
    .single();

  if (upsertErr) {
    return json({ ok: false, error: upsertErr.message }, 500);
  }

  if (body.stat === "pts" && delta !== 0 && side) {
    const { data: overlay } = await ctx.admin
      .from("overlay_game_state")
      .select("home_score, away_score")
      .eq("game_id", gameId)
      .maybeSingle();

    if (overlay) {
      const scoreCol = side === "home" ? "home_score" : "away_score";
      const currentScore = Number(overlay[scoreCol] ?? 0);
      const newScore = Math.max(0, currentScore + delta);

      await ctx.admin
        .from("overlay_game_state")
        .update({ [scoreCol]: newScore, updated_at: new Date().toISOString() })
        .eq("game_id", gameId);
    }
  }

  // Record audit log
  await ctx.admin.from("audit_logs").insert({
    actor_id: actorId,
    action: "record_player_stat",
    ref_type: "player_game_stats",
    ref_id: `${gameId}:${body.playerId}`,
    payload: {
      gameId,
      playerId: body.playerId,
      stat: body.stat,
      delta,
      newVal,
    },
    idempotency_key: idempotencyKey || crypto.randomUUID(),
  });

  return json({ ok: true, stats: updatedStats }, 200);
}

// POST /api/ops/games/:gameId/quick-player
export async function handleOpsQuickAddPlayer(ctx: HandlerCtx) {
  await requireStatsAdmin(ctx);
  const { gameId } = ctx.params;
  if (!gameId || !isUuid(gameId)) {
    return json({ ok: false, error: "invalid_game_id" }, 400);
  }

  const body = await ctx.req.json().catch(() => null) as {
    name: string;
    jerseyNumber?: number | string;
    teamSide: "home" | "away";
  } | null;

  const trimmedName = body?.name?.trim() ?? "";
  if (!trimmedName) {
    return json({ ok: false, error: "name_required" }, 400);
  }

  // 1. Get game to determine team_id and league_id
  const { data: game, error: gameErr } = await ctx.admin
    .from("games")
    .select("league_id, home_team_id, away_team_id")
    .eq("id", gameId)
    .single();

  if (gameErr || !game) return json({ ok: false, error: "game_not_found" }, 404);

  const teamId = body?.teamSide === "home" ? game.home_team_id : game.away_team_id;
  const leagueId = game.league_id;
  const jersey = body?.jerseyNumber !== undefined && body?.jerseyNumber !== "" ? Number(body.jerseyNumber) : null;

  // 2. Direct insert into public.players (no profiles row, zero fake auth IDs)
  // Decoupled architecture matching GameChanger / iScore (24M+ games)
  // Iron Law 12: Zero auto-merging by fuzzy name match. Every add creates an isolated player row.
  const { data: player, error: playerErr } = await ctx.admin
    .from("players")
    .insert({
      user_id: null,
      profile_id: null,
      display_name: trimmedName,
      team_id: teamId,
      league_id: leagueId,
      jersey_number: jersey,
    })
    .select("id, jersey_number, display_name")
    .single();

  if (playerErr) return json({ ok: false, error: playerErr.message }, 500);

  // 3. Link to game_rosters
  const { error: rosterErr } = await ctx.admin.from("game_rosters").upsert({
    game_id: gameId,
    team_id: teamId,
    player_id: player.id,
    active: true,
  }, { onConflict: "game_id,player_id" });

  if (rosterErr) return json({ ok: false, error: rosterErr.message }, 500);

  return json(
    {
      ok: true,
      player: {
        id: player.id,
        name: player.display_name || trimmedName,
        jerseyNumber: player.jersey_number,
        teamId,
      },
    },
    200
  );
}

/**
 * DELETE /api/ops/games/:gameId
 *
 * Removes a game, its associated overlay_game_state, player_game_stats, and game_rosters.
 * If the game was in 'final' status, triggers a statement-level standings refresh.
 */
export async function handleOpsDeleteGame(ctx: HandlerCtx): Promise<Response> {
  let adminId: string;
  try {
    adminId = await requireStatsAdmin(ctx);
  } catch (err) {
    const msg = (err as Error).message;
    return json({ ok: false, error: msg }, msg === "unauthorized" ? 401 : 403);
  }

  const gameId = ctx.params?.gameId;
  if (!gameId || !isUuid(gameId)) {
    return json({ ok: false, error: "invalid_game_id" }, 400);
  }

  // 1. Fetch game details to audit-log and know status
  const { data: game, error: fetchErr } = await ctx.admin
    .from("games")
    .select("id, status, league_id, season_id, participant1_label, participant2_label")
    .eq("id", gameId)
    .maybeSingle();

  if (fetchErr) return json({ ok: false, error: fetchErr.message }, 500);
  if (!game) return json({ ok: false, error: "game_not_found" }, 404);

  // 2. Cascade delete child records
  await ctx.admin.from("player_game_stats").delete().eq("game_id", gameId);
  await ctx.admin.from("game_rosters").delete().eq("game_id", gameId);
  await ctx.admin.from("overlay_game_state").delete().eq("game_id", gameId);

  // 3. Delete the game row
  const { error: delErr } = await ctx.admin.from("games").delete().eq("id", gameId);
  if (delErr) return json({ ok: false, error: delErr.message }, 500);

  // 4. Audit log
  try {
    await ctx.admin.rpc("log_admin_action", {
      p_action: "GAME_DELETED",
      p_target_type: "game",
      p_target_id: gameId,
      p_details: {
        deletedBy: adminId,
        priorStatus: game.status,
        leagueId: game.league_id,
        seasonId: game.season_id,
        participant1Label: game.participant1_label,
        participant2Label: game.participant2_label,
      },
    });
  } catch {
    // Non-fatal
  }

  // 5. If final, refresh standings
  if (game.status === "final") {
    try {
      await ctx.admin.rpc("fn_refresh_standings_trigger_stmt");
    } catch {
      // Non-fatal
    }
  }

  return json({ ok: true, deletedGameId: gameId });
}

