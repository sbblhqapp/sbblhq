/**
 * Interactive engagement routes — polls, predictions, trivia,
 * gamification, watch parties.
 *
 *  Public reads
 *  ────────────
 *  GET  /api/public/engagement/polls?gameId=…     → list open/locked polls
 *  GET  /api/public/engagement/polls/:id/results  → aggregate vote counts
 *  GET  /api/public/engagement/leaderboard        → top point-earners
 *
 *  Authenticated
 *  ─────────────
 *  POST /api/engagement/polls/:id/vote            → cast a vote (once per user)
 *  GET  /api/engagement/me/points                 → my points + history
 *  POST /api/engagement/watch-parties             → create a watch party
 *  GET  /api/engagement/watch-parties?gameId=…    → list open parties for a game
 *  POST /api/engagement/watch-parties/:id/join    → join by id
 *  POST /api/engagement/watch-parties/join-by-code → join via invite code
 *
 *  Admin
 *  ─────
 *  POST /api/ops/engagement/polls                 → create a poll
 *  POST /api/ops/engagement/polls/:id             → update a poll (status, grade)
 *  POST /api/ops/engagement/polls/:id/grade       → grade + award points
 */

import type { HandlerCtx } from "../shared";
import { json, CACHE_HEADERS } from "../shared";

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function requireAuth(req: Request): string {
  const userId = req.headers.get("x-sbbl-user-id-verified");
  if (!userId) throw new Error("unauthorized");
  return userId;
}

async function requireEngagementAdmin(ctx: HandlerCtx): Promise<string> {
  const userId = requireAuth(ctx.req);
  const { data } = await ctx.admin
    .from("user_role_assignments")
    .select("role")
    .eq("user_id", userId);
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

type PollOption = { id: string; label: string };

function normalizeOptions(raw: unknown): PollOption[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((o, i) => {
      if (typeof o === "string") {
        return { id: `opt_${i + 1}`, label: o.slice(0, 120) };
      }
      if (typeof o === "object" && o !== null) {
        const rec = o as { id?: unknown; label?: unknown };
        return {
          id: String(rec.id ?? `opt_${i + 1}`).slice(0, 32),
          label: String(rec.label ?? "").slice(0, 120),
        };
      }
      return null;
    })
    .filter((v): v is PollOption => v !== null && v.label.length > 0)
    .slice(0, 8);
}

// ── Public reads ──────────────────────────────────────────────────────────

export async function handlePublicPollsList({ req, admin }: HandlerCtx) {
  const url = new URL(req.url);
  const gameId = url.searchParams.get("gameId");
  let q = admin
    .from("engagement_polls")
    .select("id,game_id,kind,question,options,status,points_award,closes_at,created_at")
    .in("status", ["open", "locked", "closed"])
    .order("created_at", { ascending: false })
    .limit(50);
  if (gameId && isUuid(gameId)) q = q.eq("game_id", gameId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return json({ ok: true, data }, 200, CACHE_HEADERS.REALTIME);
}

export async function handlePublicPollResults({ admin, params }: HandlerCtx) {
  const pollId = params.id ?? "";
  if (!isUuid(pollId)) return json({ ok: false, error: "invalid_id" }, 400);

  const { data: poll, error: pollErr } = await admin
    .from("engagement_polls")
    .select("id,question,options,status,correct_option_id,kind,points_award")
    .eq("id", pollId)
    .maybeSingle();
  if (pollErr) throw new Error(pollErr.message);
  if (!poll) return json({ ok: false, error: "not_found" }, 404);

  const { data: talliesData, error: talliesErr } = await admin.rpc("get_poll_tallies", {
    p_poll_id: pollId,
  });
  if (talliesErr) throw new Error(talliesErr.message);

  const tallies: Record<string, number> = {};
  let total = 0;
  for (const row of (talliesData ?? []) as Array<{ option_id: string; vote_count: number }>) {
    const id = String(row.option_id);
    const count = Number(row.vote_count);
    tallies[id] = count;
    total += count;
  }

  return json({
    ok: true,
    poll,
    total_votes: total,
    tallies,
  }, 200, CACHE_HEADERS.REALTIME);
}

export async function handlePublicEngagementLeaderboard({ admin }: HandlerCtx) {
  const { data, error } = await admin.rpc("get_gamification_leaderboard", {
    p_limit: 25,
  });
  if (error) throw new Error(error.message);
  return json({ ok: true, data }, 200, CACHE_HEADERS.FREQUENT);
}

// ── Authenticated: vote ───────────────────────────────────────────────────

export async function handleCastVote({ req, admin, params }: HandlerCtx) {
  const userId = requireAuth(req);
  const pollId = params.id ?? "";
  if (!isUuid(pollId)) return json({ ok: false, error: "invalid_id" }, 400);

  let body: { option_id?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }
  const optionId = (body.option_id ?? "").toString().slice(0, 32);
  if (!optionId) return json({ ok: false, error: "missing_option" }, 400);

  const { data: poll } = await admin
    .from("engagement_polls")
    .select("id,status,options,correct_option_id,points_award")
    .eq("id", pollId)
    .maybeSingle();
  if (!poll) return json({ ok: false, error: "not_found" }, 404);
  if ((poll as { status: string }).status !== "open") {
    return json({ ok: false, error: "poll_not_open" }, 409);
  }
  const options = normalizeOptions((poll as { options: unknown }).options);
  if (!options.some((o) => o.id === optionId)) {
    return json({ ok: false, error: "invalid_option_for_poll" }, 400);
  }

  const { error } = await admin
    .from("engagement_poll_votes")
    .insert({
      poll_id: pollId,
      user_id: userId,
      option_id: optionId,
    });
  if (error) {
    if (error.message.toLowerCase().includes("duplicate")) {
      return json({ ok: false, error: "already_voted" }, 409);
    }
    throw new Error(error.message);
  }
  return json({ ok: true });
}

// ── Admin: create a poll ──────────────────────────────────────────────────
export async function handleCreatePoll(ctx: HandlerCtx) {
  const userId = await requireEngagementAdmin(ctx);
  let body: {
    game_id?: string;
    kind?: string;
    question?: string;
    options?: unknown;
    correct_option_id?: string;
    points_award?: number;
    closes_at?: string;
    status?: string;
  };
  try {
    body = (await ctx.req.json()) as typeof body;
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }
  const question = (body.question ?? "").toString().slice(0, 240).trim();
  const options = normalizeOptions(body.options);
  if (!question || options.length < 2) {
    return json({ ok: false, error: "invalid_question_or_options" }, 400);
  }
  const kind = ["poll", "prediction", "trivia"].includes(String(body.kind))
    ? String(body.kind)
    : "poll";
  const status = ["draft", "open"].includes(String(body.status))
    ? String(body.status)
    : "open";

  const { data, error } = await ctx.admin
    .from("engagement_polls")
    .insert({
      game_id: body.game_id && isUuid(body.game_id) ? body.game_id : null,
      kind,
      question,
      options,
      correct_option_id: body.correct_option_id
        ? String(body.correct_option_id).slice(0, 32)
        : null,
      points_award:
        typeof body.points_award === "number"
          ? Math.max(0, Math.floor(body.points_award))
          : 10,
      closes_at: body.closes_at ?? null,
      status,
      created_by: userId,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return json({ ok: true, poll: data });
}

// ── Admin: update a poll (status + grade) ────────────────────────────────
export async function handleUpdatePoll(ctx: HandlerCtx) {
  await requireEngagementAdmin(ctx);
  const pollId = ctx.params.id ?? "";
  if (!isUuid(pollId)) return json({ ok: false, error: "invalid_id" }, 400);

  let body: {
    status?: string;
    correct_option_id?: string;
    points_award?: number;
    closes_at?: string;
  };
  try {
    body = (await ctx.req.json()) as typeof body;
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (body.status && ["draft", "open", "locked", "closed"].includes(body.status)) {
    patch.status = body.status;
  }
  if (body.correct_option_id != null) {
    patch.correct_option_id = String(body.correct_option_id).slice(0, 32);
  }
  if (typeof body.points_award === "number") {
    patch.points_award = Math.max(0, Math.floor(body.points_award));
  }
  if (body.closes_at != null) patch.closes_at = body.closes_at;

  const { data, error } = await ctx.admin
    .from("engagement_polls")
    .update(patch)
    .eq("id", pollId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return json({ ok: true, poll: data });
}

// ── Admin: grade + award points for correct voters ────────────────────────
export async function handleGradePoll(ctx: HandlerCtx) {
  await requireEngagementAdmin(ctx);
  const pollId = ctx.params.id ?? "";
  if (!isUuid(pollId)) return json({ ok: false, error: "invalid_id" }, 400);

  const { data: poll } = await ctx.admin
    .from("engagement_polls")
    .select("id,correct_option_id,points_award,status,game_id")
    .eq("id", pollId)
    .maybeSingle();
  if (!poll) return json({ ok: false, error: "not_found" }, 404);
  const p = poll as {
    id: string;
    correct_option_id: string | null;
    points_award: number;
    status: string;
    game_id: string | null;
  };
  if (!p.correct_option_id) {
    return json({ ok: false, error: "missing_correct_option" }, 400);
  }

  const { data: votes } = await ctx.admin
    .from("engagement_poll_votes")
    .select("id,user_id,option_id,points_earned")
    .eq("poll_id", pollId);

  let awarded = 0;
  for (const v of votes ?? []) {
    const vote = v as {
      id: string;
      user_id: string;
      option_id: string;
      points_earned: number;
    };
    const correct = vote.option_id === p.correct_option_id;
    const alreadyAwarded = vote.points_earned > 0;
    await ctx.admin
      .from("engagement_poll_votes")
      .update({
        correct,
        points_earned: correct && !alreadyAwarded ? p.points_award : vote.points_earned,
      })
      .eq("id", vote.id);
    if (correct && !alreadyAwarded) {
      await ctx.admin.from("gamification_points").insert({
        user_id: vote.user_id,
        reason: `poll_correct:${p.id}`,
        game_id: p.game_id,
        poll_id: p.id,
        points: p.points_award,
      });
      awarded++;
    }
  }

  await ctx.admin
    .from("engagement_polls")
    .update({ status: "closed", updated_at: new Date().toISOString() })
    .eq("id", pollId);

  return json({ ok: true, awarded });
}

// ── Authenticated: my points ──────────────────────────────────────────────
export async function handleMyPoints({ req, admin }: HandlerCtx) {
  const userId = requireAuth(req);
  const { data: total } = await admin
    .from("gamification_points")
    .select("points")
    .eq("user_id", userId);
  const sum = (total ?? []).reduce(
    (acc, row) => acc + Number((row as { points: number }).points ?? 0),
    0,
  );
  const { data: history } = await admin
    .from("gamification_points")
    .select("id,reason,points,game_id,poll_id,created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);
  return json({ ok: true, total: sum, history: history ?? [] });
}

// ── Watch parties ─────────────────────────────────────────────────────────
export function makeJoinCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < 6; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

export async function handleCreateWatchParty(ctx: HandlerCtx) {
  const userId = requireAuth(ctx.req);
  let body: { game_id?: string; name?: string; max_members?: number };
  try {
    body = (await ctx.req.json()) as typeof body;
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }
  if (!body.game_id || !isUuid(body.game_id)) {
    return json({ ok: false, error: "invalid_game_id" }, 400);
  }
  const name = (body.name ?? "Watch Party").toString().slice(0, 80).trim();
  const max = Math.max(
    2,
    Math.min(500, Math.floor(Number(body.max_members ?? 25))),
  );

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = makeJoinCode();
    const { data, error } = await ctx.admin
      .from("watch_parties")
      .insert({
        game_id: body.game_id,
        host_user_id: userId,
        name,
        join_code: code,
        max_members: max,
      })
      .select("*")
      .single();
    if (!error) {
      await ctx.admin.from("watch_party_members").insert({
        watch_party_id: (data as { id: string }).id,
        user_id: userId,
      });
      return json({ ok: true, party: data });
    }
    if (!error.message.toLowerCase().includes("duplicate")) {
      throw new Error(error.message);
    }
  }
  return json({ ok: false, error: "join_code_collision" }, 500);
}

export async function handleListWatchParties({ req, admin }: HandlerCtx) {
  const url = new URL(req.url);
  const gameId = url.searchParams.get("gameId");
  let q = admin
    .from("watch_parties")
    .select("id,name,game_id,host_user_id,max_members,status,created_at")
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(50);
  if (gameId && isUuid(gameId)) q = q.eq("game_id", gameId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return json({ ok: true, data });
}

export async function handleJoinWatchParty(ctx: HandlerCtx) {
  const userId = requireAuth(ctx.req);
  const partyId = ctx.params.id ?? "";
  if (!isUuid(partyId)) return json({ ok: false, error: "invalid_id" }, 400);

  const { data: party } = await ctx.admin
    .from("watch_parties")
    .select("id,max_members,status")
    .eq("id", partyId)
    .maybeSingle();
  if (!party) return json({ ok: false, error: "not_found" }, 404);
  if ((party as { status: string }).status !== "open") {
    return json({ ok: false, error: "closed" }, 409);
  }

  const { count } = await ctx.admin
    .from("watch_party_members")
    .select("id", { count: "exact", head: true })
    .eq("watch_party_id", partyId);
  if ((count ?? 0) >= (party as { max_members: number }).max_members) {
    return json({ ok: false, error: "party_full" }, 409);
  }

  const { error } = await ctx.admin.from("watch_party_members").insert({
    watch_party_id: partyId,
    user_id: userId,
  });
  if (error && !error.message.toLowerCase().includes("duplicate")) {
    throw new Error(error.message);
  }
  return json({ ok: true });
}

export async function handleJoinByCode(ctx: HandlerCtx) {
  const userId = requireAuth(ctx.req);
  let body: { code?: string };
  try {
    body = (await ctx.req.json()) as typeof body;
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }
  const code = (body.code ?? "").toString().trim().toUpperCase().slice(0, 8);
  if (!code) return json({ ok: false, error: "invalid_code" }, 400);

  const { data: party } = await ctx.admin
    .from("watch_parties")
    .select("id,status,max_members")
    .eq("join_code", code)
    .maybeSingle();
  if (!party) return json({ ok: false, error: "not_found" }, 404);

  const p = party as { id: string; status: string; max_members: number };
  if (p.status !== "open") return json({ ok: false, error: "closed" }, 409);

  const { count } = await ctx.admin
    .from("watch_party_members")
    .select("id", { count: "exact", head: true })
    .eq("watch_party_id", p.id);
  if ((count ?? 0) >= p.max_members) {
    return json({ ok: false, error: "party_full" }, 409);
  }

  const { error } = await ctx.admin.from("watch_party_members").insert({
    watch_party_id: p.id,
    user_id: userId,
  });
  if (error && !error.message.toLowerCase().includes("duplicate")) {
    throw new Error(error.message);
  }
  return json({ ok: true, party_id: p.id });
}
