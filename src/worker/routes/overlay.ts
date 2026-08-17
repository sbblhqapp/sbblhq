/**
 * Scoreboard overlay routes.
 *
 *  Public
 *  ──────
 *  GET  /api/public/overlay/:gameId             → live overlay state (OBS source)
 *
 *  Authenticated (admin / league / ops)
 *  ────────────────────────────────────
 *  POST /api/ops/overlay/:gameId/state          → merge patch of overlay fields
 *  POST /api/ops/overlay/:gameId/clock          → start | stop | set clock
 *  POST /api/ops/overlay/:gameId/score          → +1 / +2 / +3 home|away, or set
 *  POST /api/ops/overlay/:gameId/foul           → +1 foul home|away, or reset
 *  POST /api/ops/overlay/:gameId/period         → next period / set period
 *  POST /api/ops/overlay/:gameId/reset          → full reset to defaults
 *
 * All overlay state mutations also sync game.home_score / game.away_score so
 * the Scores page stays authoritative; this is intentional — a single
 * source of truth for scoreboard numbers keeps /overlay/:gameId and
 * /scores consistent.
 */

import type { HandlerCtx } from "../shared";
import { json } from "../shared";

const OVERLAY_SELECT = "id, game_id, home_score, away_score, period_label, clock_seconds, clock_running, clock_last_started_at, foul_home, foul_away, timeout_home, timeout_away, possession, status_label, is_halftime, is_overtime, is_final, created_at, updated_at";

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

async function requireOverlayAdmin(ctx: HandlerCtx): Promise<string> {
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

async function ensureOverlayRow(ctx: HandlerCtx, gameId: string) {
  const { data: existing } = await ctx.admin
    .from("overlay_game_state")
    .select(OVERLAY_SELECT)
    .eq("game_id", gameId)
    .maybeSingle();
  if (existing) return existing;
  const { data, error } = await ctx.admin
    .from("overlay_game_state")
    .insert({ game_id: gameId })
    .select(OVERLAY_SELECT)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

function periodLabel(period: number): string {
  if (period <= 4) return `Q${period}`;
  const ot = period - 4;
  return ot === 1 ? "OT" : `${ot}OT`;
}

// ──────────────────────────────────────────────────────────────────────────
// Public: GET /api/public/overlay/:gameId
// Returns the current overlay state + game metadata + active sponsor.
// Cache-Control: none (overlays must reflect live state instantly).
// ──────────────────────────────────────────────────────────────────────────
export async function handlePublicOverlay({ req, admin, params }: HandlerCtx) {
  const gameId = params.gameId ?? "";
  if (!gameId || !isUuid(gameId)) {
    return json({ ok: false, error: "invalid_game_id" }, 400);
  }

  // Load overlay state (create on demand if missing) + game + teams.
  const [{ data: gameRow }, overlayRow] = await Promise.all([
    admin
      .from("games")
      .select(
        `
          id, status, category, event_name, participant1_label, participant2_label,
          home_score, away_score, home_team_id, away_team_id, league_id,
          leagues(code,name),
          home_team:home_team_id ( id, name, logo_url ),
          away_team:away_team_id ( id, name, logo_url )
        `,
      )
      .eq("id", gameId)
      .maybeSingle(),
    (async () => {
      const { data } = await admin
        .from("overlay_game_state")
        .select(OVERLAY_SELECT)
        .eq("game_id", gameId)
        .maybeSingle();
      if (data) return data;
      const { data: inserted, error } = await admin
        .from("overlay_game_state")
        .insert({ game_id: gameId })
        .select(OVERLAY_SELECT)
        .single();
      if (error) return null;
      return inserted;
    })(),
  ]);

  const safeOverlayData = overlayRow ? (({ updated_by, ...rest }) => rest)(overlayRow as Record<string, unknown>) : null;

  if (!gameRow) {
    return json({ ok: false, error: "game_not_found" }, 404);
  }

  const leagueId = (gameRow as { league_id?: string | null }).league_id ?? null;
  let sponsor: {
    id: string;
    name: string;
    tagline: string | null;
    logo_url: string | null;
    click_url: string | null;
    background_color: string | null;
    text_color: string | null;
  } | null = null;

  const now = new Date().toISOString();
  const sponsorQuery = admin
    .from("sponsor_slots")
    .select(
      "id,name,tagline,logo_url,click_url,background_color,text_color,weight,league_id,starts_at,ends_at",
    )
    .eq("active", true)
    .or(`starts_at.is.null,starts_at.lte.${now}`)
    .or(`ends_at.is.null,ends_at.gte.${now}`);
  const { data: sponsorRows } = leagueId && isUuid(leagueId)
    ? await sponsorQuery.or(`league_id.eq.${leagueId},league_id.is.null`)
    : await sponsorQuery;

  if (Array.isArray(sponsorRows) && sponsorRows.length > 0) {
    // Deterministic rotation based on seconds / 15 so overlay rotates
    // every 15 s across viewers without Needing server-side state.
    const slot = Math.floor(Date.now() / 15_000) % sponsorRows.length;
    const chosen = sponsorRows[slot];
    sponsor = {
      id: String(chosen.id),
      name: String(chosen.name ?? ""),
      tagline: (chosen.tagline as string | null) ?? null,
      logo_url: (chosen.logo_url as string | null) ?? null,
      click_url: (chosen.click_url as string | null) ?? null,
      background_color: (chosen.background_color as string | null) ?? null,
      text_color: (chosen.text_color as string | null) ?? null,
    };
  }

  const overlay = safeOverlayData
    ? {
        ...safeOverlayData,
        // When clock is running, project live remaining seconds so
        // the overlay animates smoothly even when DB writes are batched.
        live_clock_seconds: (() => {
          const o = safeOverlayData as Record<string, unknown>;
          if (!o.clock_running || !o.clock_last_started_at) {
            return Number(o.clock_seconds ?? 0);
          }
          const startedMs = new Date(
            String(o.clock_last_started_at),
          ).getTime();
          const elapsed = Math.max(
            0,
            Math.floor((Date.now() - startedMs) / 1000),
          );
          return Math.max(0, Number(o.clock_seconds ?? 0) - elapsed);
        })(),
      }
    : null;

  const url = new URL(req.url);
  const theme = url.searchParams.get("theme");

  return new Response(
    JSON.stringify({ ok: true, game: gameRow, overlay, sponsor, theme }),
    {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=1, s-maxage=1, stale-while-revalidate=2",
      },
    },
  );
}

// ──────────────────────────────────────────────────────────────────────────
// POST /api/ops/overlay/:gameId/state
// Body: partial overlay fields to merge.
// ──────────────────────────────────────────────────────────────────────────
const ALLOWED_STATE_FIELDS = new Set([
  "period",
  "period_label",
  "clock_seconds",
  "clock_running",
  "clock_last_started_at",
  "home_score",
  "away_score",
  "home_fouls",
  "away_fouls",
  "home_timeouts_left",
  "away_timeouts_left",
  "possession",
  "bonus_home",
  "bonus_away",
  "shot_clock_seconds",
  "last_event_text",
  "last_event_at",
  "overlay_theme",
  "show_sponsor_bug",
  "show_lower_third",
  "lower_third_text",
  "lower_third_subtext",
]);

export async function handleOverlayPatch(ctx: HandlerCtx) {
  const userId = await requireOverlayAdmin(ctx);
  const gameId = ctx.params.gameId ?? "";
  if (!gameId || !isUuid(gameId)) {
    return json({ ok: false, error: "invalid_game_id" }, 400);
  }
  await ensureOverlayRow(ctx, gameId);

  let body: Record<string, unknown>;
  try {
    body = (await ctx.req.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    updated_by: userId,
  };
  for (const [key, value] of Object.entries(body)) {
    if (ALLOWED_STATE_FIELDS.has(key)) {
      patch[key] = value;
    }
  }

  const { data, error } = await ctx.admin
    .from("overlay_game_state")
    .update(patch)
    .eq("game_id", gameId)
    .select(OVERLAY_SELECT)
    .single();
  if (error) throw new Error(error.message);

  // Mirror scores to games table so Scores page stays in sync.
  if ("home_score" in patch || "away_score" in patch) {
    await ctx.admin
      .from("games")
      .update({
        home_score:
          "home_score" in patch
            ? Number(patch.home_score)
            : (data as { home_score: number }).home_score,
        away_score:
          "away_score" in patch
            ? Number(patch.away_score)
            : (data as { away_score: number }).away_score,
      })
      .eq("id", gameId);
  }

  return json({ ok: true, overlay: data });
}

// ──────────────────────────────────────────────────────────────────────────
// Clock control
// body: { action: 'start' | 'stop' | 'set', seconds?: number }
// ──────────────────────────────────────────────────────────────────────────
export async function handleOverlayClock(ctx: HandlerCtx) {
  await requireOverlayAdmin(ctx);
  const gameId = ctx.params.gameId ?? "";
  if (!gameId || !isUuid(gameId)) {
    return json({ ok: false, error: "invalid_game_id" }, 400);
  }
  const row = await ensureOverlayRow(ctx, gameId);
  const current = row as Record<string, unknown>;

  let body: { action?: string; seconds?: number };
  try {
    body = (await ctx.req.json()) as typeof body;
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  switch (body.action) {
    case "start":
      patch.clock_running = true;
      patch.clock_last_started_at = new Date().toISOString();
      break;
    case "stop": {
      // Project remaining seconds before stopping so DB has truth.
      if (current.clock_running && current.clock_last_started_at) {
        const startedMs = new Date(
          String(current.clock_last_started_at),
        ).getTime();
        const elapsed = Math.max(
          0,
          Math.floor((Date.now() - startedMs) / 1000),
        );
        patch.clock_seconds = Math.max(
          0,
          Number(current.clock_seconds ?? 0) - elapsed,
        );
      }
      patch.clock_running = false;
      patch.clock_last_started_at = null;
      break;
    }
    case "set":
      if (typeof body.seconds !== "number" || body.seconds < 0) {
        return json({ ok: false, error: "invalid_seconds" }, 400);
      }
      patch.clock_seconds = Math.floor(body.seconds);
      patch.clock_running = false;
      patch.clock_last_started_at = null;
      break;
    default:
      return json({ ok: false, error: "invalid_action" }, 400);
  }

  const { data, error } = await ctx.admin
    .from("overlay_game_state")
    .update(patch)
    .eq("game_id", gameId)
    .select(OVERLAY_SELECT)
    .single();
  if (error) throw new Error(error.message);
  return json({ ok: true, overlay: data });
}

// ──────────────────────────────────────────────────────────────────────────
// Score control
// body: { side: 'home' | 'away', delta?: 1|2|3|-1, set?: number, event?: string }
// ──────────────────────────────────────────────────────────────────────────
export async function handleOverlayScore(ctx: HandlerCtx) {
  const userId = await requireOverlayAdmin(ctx);
  const gameId = ctx.params.gameId ?? "";
  if (!gameId || !isUuid(gameId)) {
    return json({ ok: false, error: "invalid_game_id" }, 400);
  }
  const row = await ensureOverlayRow(ctx, gameId);
  const current = row as Record<string, unknown>;

  let body: {
    side?: "home" | "away";
    delta?: number;
    set?: number;
    event?: string;
    idempotencyKey?: string;
  };
  try {
    body = (await ctx.req.json()) as typeof body;
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  if (body.side !== "home" && body.side !== "away") {
    return json({ ok: false, error: "invalid_side" }, 400);
  }

  const idempotencyKey =
    ctx.req.headers.get("x-idempotency-key") ||
    body.idempotencyKey ||
    null;

  // 1. Try atomic idempotent database RPC for deltas
  if (typeof body.delta === "number" && [-3, -2, -1, 1, 2, 3].includes(body.delta)) {
    const { data: rpcRes, error: rpcErr } = await ctx.admin.rpc(
      "fn_atomic_adjust_overlay_score",
      {
        p_game_id: gameId,
        p_team_side: body.side,
        p_delta: body.delta,
        p_event_text: body.event ? String(body.event).slice(0, 160) : null,
        p_idempotency_key: idempotencyKey,
        p_actor_id: userId,
      },
    );

    if (!rpcErr && rpcRes && typeof rpcRes === "object" && "overlay" in rpcRes) {
      return json({ ok: true, overlay: (rpcRes as { overlay: unknown }).overlay });
    }
  }

  // 2. Fallback / direct set path
  const col = body.side === "home" ? "home_score" : "away_score";
  const currentVal = Number(current[col] ?? 0);
  let newVal = currentVal;
  if (typeof body.set === "number") {
    newVal = Math.max(0, Math.floor(body.set));
  } else if (
    typeof body.delta === "number" &&
    [-3, -2, -1, 1, 2, 3].includes(body.delta)
  ) {
    newVal = Math.max(0, currentVal + body.delta);
  } else {
    return json({ ok: false, error: "invalid_delta_or_set" }, 400);
  }

  const patch: Record<string, unknown> = {
    [col]: newVal,
    updated_at: new Date().toISOString(),
    last_event_at: new Date().toISOString(),
  };
  if (body.event) patch.last_event_text = String(body.event).slice(0, 160);

  const { data, error } = await ctx.admin
    .from("overlay_game_state")
    .update(patch)
    .eq("game_id", gameId)
    .select(OVERLAY_SELECT)
    .single();
  if (error) throw new Error(error.message);

  // Mirror to games table.
  await ctx.admin
    .from("games")
    .update({ [col]: newVal })
    .eq("id", gameId);

  return json({ ok: true, overlay: data });
}

// ──────────────────────────────────────────────────────────────────────────
// Foul control
// body: { side: 'home' | 'away', delta?: 1|-1, reset?: boolean }
// ──────────────────────────────────────────────────────────────────────────
export async function handleOverlayFoul(ctx: HandlerCtx) {
  await requireOverlayAdmin(ctx);
  const gameId = ctx.params.gameId ?? "";
  if (!gameId || !isUuid(gameId)) {
    return json({ ok: false, error: "invalid_game_id" }, 400);
  }
  const row = await ensureOverlayRow(ctx, gameId);
  const current = row as Record<string, unknown>;

  let body: { side?: "home" | "away"; delta?: number; reset?: boolean };
  try {
    body = (await ctx.req.json()) as typeof body;
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  if (body.side !== "home" && body.side !== "away") {
    return json({ ok: false, error: "invalid_side" }, 400);
  }
  const col = body.side === "home" ? "home_fouls" : "away_fouls";
  const bonusCol = body.side === "home" ? "bonus_home" : "bonus_away";
  let newVal = Number(current[col] ?? 0);
  if (body.reset) {
    newVal = 0;
  } else if (body.delta === -1 || body.delta === 1) {
    newVal = Math.max(0, newVal + body.delta);
  } else {
    return json({ ok: false, error: "invalid_delta" }, 400);
  }

  const patch: Record<string, unknown> = {
    [col]: newVal,
    [bonusCol]: newVal >= 7,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await ctx.admin
    .from("overlay_game_state")
    .update(patch)
    .eq("game_id", gameId)
    .select(OVERLAY_SELECT)
    .single();
  if (error) throw new Error(error.message);
  return json({ ok: true, overlay: data });
}

// ──────────────────────────────────────────────────────────────────────────
// Period control
// body: { action: 'next' | 'set', period?: number }
// ──────────────────────────────────────────────────────────────────────────
export async function handleOverlayPeriod(ctx: HandlerCtx) {
  await requireOverlayAdmin(ctx);
  const gameId = ctx.params.gameId ?? "";
  if (!gameId || !isUuid(gameId)) {
    return json({ ok: false, error: "invalid_game_id" }, 400);
  }
  const row = await ensureOverlayRow(ctx, gameId);
  const current = row as Record<string, unknown>;

  let body: { action?: string; period?: number };
  try {
    body = (await ctx.req.json()) as typeof body;
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  let next = Number(current.period ?? 1);
  if (body.action === "next") {
    next = Math.min(10, next + 1);
  } else if (body.action === "set" && typeof body.period === "number") {
    next = Math.max(1, Math.min(10, Math.floor(body.period)));
  } else {
    return json({ ok: false, error: "invalid_action" }, 400);
  }

  const patch = {
    period: next,
    period_label: periodLabel(next),
    home_fouls: 0,
    away_fouls: 0,
    bonus_home: false,
    bonus_away: false,
    clock_running: false,
    clock_last_started_at: null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await ctx.admin
    .from("overlay_game_state")
    .update(patch)
    .eq("game_id", gameId)
    .select(OVERLAY_SELECT)
    .single();
  if (error) throw new Error(error.message);
  return json({ ok: true, overlay: data });
}

// ──────────────────────────────────────────────────────────────────────────
// Full reset
// ──────────────────────────────────────────────────────────────────────────
export async function handleOverlayReset(ctx: HandlerCtx) {
  await requireOverlayAdmin(ctx);
  const gameId = ctx.params.gameId ?? "";
  if (!gameId || !isUuid(gameId)) {
    return json({ ok: false, error: "invalid_game_id" }, 400);
  }
  await ensureOverlayRow(ctx, gameId);

  const patch = {
    period: 1,
    period_label: "Q1",
    clock_seconds: 600,
    clock_running: false,
    clock_last_started_at: null,
    home_score: 0,
    away_score: 0,
    home_fouls: 0,
    away_fouls: 0,
    home_timeouts_left: 4,
    away_timeouts_left: 4,
    possession: "none",
    bonus_home: false,
    bonus_away: false,
    shot_clock_seconds: null,
    last_event_text: null,
    last_event_at: null,
    show_lower_third: false,
    lower_third_text: null,
    lower_third_subtext: null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await ctx.admin
    .from("overlay_game_state")
    .update(patch)
    .eq("game_id", gameId)
    .select(OVERLAY_SELECT)
    .single();
  if (error) throw new Error(error.message);

  await ctx.admin
    .from("games")
    .update({ home_score: 0, away_score: 0 })
    .eq("id", gameId);

  return json({ ok: true, overlay: data });
}

// ──────────────────────────────────────────────────────────────────────────
// Game Status control
// body: { status: 'live' | 'final' | 'upcoming' }
// ──────────────────────────────────────────────────────────────────────────
export async function handleOverlayStatus(ctx: HandlerCtx) {
  await requireOverlayAdmin(ctx);
  const gameId = ctx.params.gameId ?? "";
  if (!gameId || !isUuid(gameId)) {
    return json({ ok: false, error: "invalid_game_id" }, 400);
  }

  let body: { status?: string };
  try {
    body = (await ctx.req.json()) as typeof body;
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  if (!body.status || !["upcoming", "live", "final", "postponed", "review_pending"].includes(body.status)) {
    return json({ ok: false, error: "invalid_status" }, 400);
  }

  // Ensure overlay row exists so client doesn't break
  await ensureOverlayRow(ctx, gameId);

  // Synchronize overlay period_label and clock on status change
  if (body.status === "final") {
    await ctx.admin
      .from("overlay_game_state")
      .update({
        period_label: "FINAL",
        clock_running: false,
        clock_seconds: 0,
        clock_last_started_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("game_id", gameId);
  } else if (body.status === "review_pending") {
    await ctx.admin
      .from("overlay_game_state")
      .update({
        period_label: "CORR",
        updated_at: new Date().toISOString(),
      })
      .eq("game_id", gameId);
  } else if (body.status === "live") {
    const { data: currentOgs } = await ctx.admin
      .from("overlay_game_state")
      .select("period_label")
      .eq("game_id", gameId)
      .maybeSingle();

    if (currentOgs?.period_label === "FINAL" || currentOgs?.period_label === "CORR") {
      await ctx.admin
        .from("overlay_game_state")
        .update({
          period_label: "Q4",
          updated_at: new Date().toISOString(),
        })
        .eq("game_id", gameId);
    }
  }

  const { data: game, error } = await ctx.admin
    .from("games")
    .update({ status: body.status })
    .eq("id", gameId)
    .select(
      "id,status,category,event_name,participant1_label,participant2_label,home_score,away_score,leagues(code,name),home_team:teams!home_team_id(id,name,logo_url),away_team:teams!away_team_id(id,name,logo_url)"
    )
    .single();

  if (error) throw new Error(error.message);

  return json({ ok: true, game });
}
