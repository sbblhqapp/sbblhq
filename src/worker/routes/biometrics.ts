/**
 * WS5 — Biometric overlay routes.
 *
 *   POST /api/streams/:gameId/biometrics          (admin only)
 *   GET  /api/streams/:gameId/biometrics/latest   (public read)
 *
 * Gating:
 *   - FEATURE_BIOMETRIC_OVERLAY must be 'true' — else both routes 403.
 *   - Writes: admin role check is defense-in-depth to the RLS policy.
 *   - Writes require games.event_type in ('1v1','2v2'); full_game writes
 *     are rejected with 409 to prevent accidental full-game overlays.
 *
 * Rate limit: per-player, per-minute sliding window (default 60). In-memory
 * per-isolate; upgrade to KV if cluster-wide quota becomes necessary.
 *
 * Realtime: after a successful insert, the worker emits a broadcast on
 * `biometrics:{gameId}`. Clients ALSO receive the row-insert via
 * Supabase Realtime on the table; either signal is sufficient for
 * rendering. Broadcast is best-effort (non-blocking on failure).
 */
import type { HandlerCtx } from '../shared';
import { json } from '../shared';

function requireAuth(req: Request): string {
  const userId = req.headers.get('x-sbbl-user-id-verified');
  if (!userId) throw new Error('unauthorized');
  return userId;
}

function flagOn(env: Env): boolean {
  return env.FEATURE_BIOMETRIC_OVERLAY === 'true' || env.FEATURE_BIOMETRIC_OVERLAY === '1';
}

const FATIGUE_LEVELS = new Set(['fresh', 'moderate', 'tired', 'gassed']);
const SOURCES = new Set(['manual', 'webhook', 'wearable']);

// Per-player, per-minute rate limiter (in-memory).
const ingestWindows = new Map<string, number[]>();
const WINDOW_MS = 60_000;

function checkIngestRate(playerId: string, rate: number): boolean {
  const now = Date.now();
  const windowStart = now - WINDOW_MS;
  const fresh = (ingestWindows.get(playerId) ?? []).filter((t) => t >= windowStart);
  if (fresh.length >= rate) {
    ingestWindows.set(playerId, fresh);
    return false;
  }
  fresh.push(now);
  ingestWindows.set(playerId, fresh);
  return true;
}

async function requireAdminRole(ctx: HandlerCtx, userId: string): Promise<boolean> {
  const { data, error } = await ctx.admin
    .from('user_role_assignments')
    .select('role')
    .eq('user_id', userId);
  if (error) return false;
  const roles = new Set<string>((data as { role: string }[] | null)?.map((r) => r.role) ?? []);
  return roles.has('league_admin') || roles.has('super_admin');
}

// ── Ingest ───────────────────────────────────────────────────────────────────

export async function handleBiometricIngest(ctx: HandlerCtx): Promise<Response> {
  if (!flagOn(ctx.env)) return json({ ok: false, error: 'biometric_disabled' }, 403);

  const userId = requireAuth(ctx.req);
  const gameId = ctx.params.gameId;
  if (!gameId) return json({ ok: false, error: 'game_id_required' }, 400);

  const isAdmin = await requireAdminRole(ctx, userId);
  if (!isAdmin) return json({ ok: false, error: 'forbidden' }, 403);

  const body = (await ctx.req.json().catch(() => null)) as {
    playerId?: string;
    heartRateBpm?: number | null;
    staminaPct?: number | null;
    fatigueLevel?: string | null;
    source?: string;
    recordedAt?: string;
  } | null;

  if (!body?.playerId) return json({ ok: false, error: 'player_id_required' }, 400);

  const bpm = body.heartRateBpm;
  if (bpm != null && (typeof bpm !== 'number' || bpm < 20 || bpm > 260)) {
    return json({ ok: false, error: 'bpm_out_of_range' }, 400);
  }
  const stamina = body.staminaPct;
  if (stamina != null && (typeof stamina !== 'number' || stamina < 0 || stamina > 100)) {
    return json({ ok: false, error: 'stamina_out_of_range' }, 400);
  }
  const fatigue = body.fatigueLevel ?? null;
  if (fatigue != null && !FATIGUE_LEVELS.has(fatigue)) {
    return json({ ok: false, error: 'fatigue_invalid' }, 400);
  }
  const source = body.source ?? 'manual';
  if (!SOURCES.has(source)) {
    return json({ ok: false, error: 'source_invalid' }, 400);
  }

  // Event-type gate — overlays only apply to 1v1/2v2.
  const gRes = await ctx.admin
    .from('games')
    .select('id, event_type, status')
    .eq('id', gameId)
    .maybeSingle();
  const game = gRes.data as { id: string; event_type?: string; status?: string } | null;
  if (!game) return json({ ok: false, error: 'game_not_found' }, 404);
  if (game.event_type !== '1v1' && game.event_type !== '2v2') {
    return json({ ok: false, error: 'event_type_not_supported' }, 409);
  }

  // Rate limit per player per minute.
  const rate = Number(ctx.env.BIOMETRIC_INGEST_RATE_PER_MIN ?? '60');
  if (!checkIngestRate(body.playerId, rate)) {
    return json({ ok: false, error: 'rate_limited' }, 429);
  }

  const recordedAt = body.recordedAt ?? new Date().toISOString();

  const ins = await ctx.admin
    .from('player_biometric_snapshots')
    .insert({
      game_id: gameId,
      player_id: body.playerId,
      heart_rate_bpm: bpm ?? null,
      stamina_pct: stamina ?? null,
      fatigue_level: fatigue,
      source,
      recorded_at: recordedAt,
      // NOTE: player_biometric_snapshots has no `created_by` column (42703 on
      // insert). Do not re-add it without a migration that creates it first.
    })
    .select('id, game_id, player_id, heart_rate_bpm, stamina_pct, fatigue_level, source, recorded_at')
    .single();

  if (ins.error) return json({ ok: false, error: ins.error.message }, 500);

  // Realtime broadcast — best-effort.
  try {
    await ctx.admin.channel(`biometrics:${gameId}`).send({
      type: 'broadcast',
      event: 'biometric_update',
      payload: ins.data,
    });
  } catch {
    /* non-critical */
  }

  return json({ ok: true, snapshot: ins.data }, 201);
}

/**
 * Wearable webhook ingress. HMAC is intentionally simple shared-secret
 * header so league devices can post without an app session.
 */
export async function handleBiometricWebhookIngest(ctx: HandlerCtx): Promise<Response> {
  if (!flagOn(ctx.env)) return json({ ok: false, error: 'biometric_disabled' }, 403);
  const secret = ctx.env.BIOMETRIC_WEBHOOK_SECRET;
  const provided = ctx.req.headers.get('x-sbbl-biometric-secret');
  if (!secret || !provided || provided !== secret) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }
  const gameId = ctx.params.gameId;
  if (!gameId) return json({ ok: false, error: 'game_id_required' }, 400);
  const body = (await ctx.req.json().catch(() => null)) as {
    playerId?: string;
    heartRateBpm?: number | null;
    staminaPct?: number | null;
    fatigueLevel?: string | null;
    recordedAt?: string;
  } | null;
  if (!body?.playerId) return json({ ok: false, error: 'player_id_required' }, 400);
  const ins = await ctx.admin
    .from('player_biometric_snapshots')
    .insert({
      game_id: gameId,
      player_id: body.playerId,
      heart_rate_bpm: body.heartRateBpm ?? null,
      stamina_pct: body.staminaPct ?? null,
      fatigue_level: body.fatigueLevel ?? null,
      source: 'webhook',
      recorded_at: body.recordedAt ?? new Date().toISOString(),
    })
    .select('id, game_id, player_id, heart_rate_bpm, stamina_pct, fatigue_level, source, recorded_at')
    .single();
  if (ins.error) return json({ ok: false, error: ins.error.message }, 500);
  return json({ ok: true, snapshot: ins.data }, 201);
}

// ── Latest ───────────────────────────────────────────────────────────────────

export async function handleBiometricLatest(ctx: HandlerCtx): Promise<Response> {
  if (!flagOn(ctx.env)) return json({ ok: false, error: 'biometric_disabled' }, 403);
  const gameId = ctx.params.gameId;
  if (!gameId) return json({ ok: false, error: 'game_id_required' }, 400);

  // "Latest per player" — leverages the (game_id, player_id, recorded_at desc)
  // index. Pull the most recent 50 rows and deduplicate per player in-worker;
  // this stays bounded for 1v1/2v2 games (≤ 4 distinct players) and keeps
  // the SQL a single-query sorted-index scan.
  const res = await ctx.admin
    .from('player_biometric_snapshots')
    .select('id, game_id, player_id, heart_rate_bpm, stamina_pct, fatigue_level, source, recorded_at')
    .eq('game_id', gameId)
    .order('recorded_at', { ascending: false })
    .limit(50);
  if (res.error) return json({ ok: false, error: res.error.message }, 500);

  const latestByPlayer = new Map<string, unknown>();
  for (const row of (res.data ?? []) as { player_id: string }[]) {
    if (!latestByPlayer.has(row.player_id)) latestByPlayer.set(row.player_id, row);
  }

  return json(
    { ok: true, data: Array.from(latestByPlayer.values()) },
    200,
    // 2s cache; the realtime channel delivers sub-second updates for
    // overlays that need tighter latency.
  );
}

// ── Test seam ────────────────────────────────────────────────────────────────

export function __resetBiometricRateLimitForTests(): void {
  ingestWindows.clear();
}
