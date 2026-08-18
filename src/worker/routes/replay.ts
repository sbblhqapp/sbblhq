/**
 * WS7 — Replay availability + session branch.
 *
 * GET /api/streams/:gameId/replay/status
 *   Public read. Returns availability + embargo + price + entitlement.
 *   Never leaks a playback URL; callers use POST /api/streams/:gameId/session
 *   with playbackMode='replay' to start a session.
 *
 * Semantics (see docs/features/STREAM_GATING_v1.6.0.md):
 *   - `replay_mode == 'none'`: permanently unavailable.
 *   - `replay_monetization_enabled_at` in the future OR null:
 *     `embargoed`; response carries `embargoEndsAt`.
 *   - embargo cleared + no replay entitlement on file:
 *     `available_for_purchase`; response carries `price` + `tier`.
 *   - embargo cleared + entitled: `entitled`.
 */
import type { HandlerCtx } from '../shared';
import { json } from '../shared';
import { ENTITLEMENT } from '@/lib/constants/ENTITLEMENT_CONSTANTS';

function optionalAuth(req: Request): string | null {
  return req.headers.get('x-sbbl-user-id-verified') || null;
}

export async function handleReplayStatus(ctx: HandlerCtx): Promise<Response> {
  const gameId = ctx.params.gameId;
  if (!gameId) return json({ ok: false, error: 'game_id_required' }, 400);

  const gRes = await ctx.admin
    .from('games')
    // `games` has no `ended_at` column (42703). It was selected but never read
    // — the only effect was making `data` null, so every replay-status request
    // answered 404 "game_not_found" for games that exist.
    .select('id, replay_mode, replay_monetization_enabled_at, replay_quality_tier, replay_price')
    .eq('id', gameId)
    .maybeSingle();
  const game = gRes.data as {
    id: string;
    replay_mode: 'none' | 'raw' | 'edited';
    replay_monetization_enabled_at: string | null;
    replay_quality_tier: 'raw' | 'edited' | null;
    replay_price: number | null;
  } | null;
  if (!game) return json({ ok: false, error: 'game_not_found' }, 404);

  const tier = (game.replay_quality_tier ?? 'raw') as 'raw' | 'edited';
  // Price precedence: per-game override > canonical tier default.
  const canonicalPrice =
    tier === 'edited' ? ENTITLEMENT.REPLAY_EDITED_PRICE_CAD : ENTITLEMENT.REPLAY_RAW_PRICE_CAD;
  const price = game.replay_price != null ? Number(game.replay_price) : canonicalPrice;
  const now = Date.now();

  if (game.replay_mode === 'none') {
    return json({
      ok: true,
      status: 'unavailable',
      tier,
      price: null,
      embargoEndsAt: null,
      entitled: false,
    });
  }

  const embargoEndsAt = game.replay_monetization_enabled_at;
  const embargoed = !embargoEndsAt || new Date(embargoEndsAt).getTime() > now;
  if (embargoed) {
    return json({
      ok: true,
      status: 'embargoed',
      tier,
      price,
      embargoEndsAt: embargoEndsAt ?? null,
      entitled: false,
    });
  }

  const userId = optionalAuth(ctx.req);
  let entitled = false;
  if (userId) {
    const eRes = await ctx.admin
      .from('stream_entitlements')
      .select('status, expires_at, replay_tier')
      .eq('game_id', gameId)
      .eq('user_id', userId)
      .in('replay_tier', ['raw', 'edited'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const ent = eRes.data as {
      status: string | null;
      expires_at: string | null;
      replay_tier: 'raw' | 'edited' | null;
    } | null;
    if (
      ent &&
      ent.status === 'active' &&
      (!ent.expires_at || new Date(ent.expires_at).getTime() > now)
    ) {
      entitled = true;
    }
  }

  return json({
    ok: true,
    status: entitled ? 'entitled' : 'available_for_purchase',
    tier,
    price,
    embargoEndsAt,
    entitled,
  });
}
