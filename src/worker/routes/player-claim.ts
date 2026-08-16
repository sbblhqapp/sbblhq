/**
 * Self-service player claim and team joining route.
 * Bridges courtside walk-on players with user accounts safely without silent merging.
 */
import type { HandlerCtx } from '../shared';
import { json, resolveLeagueId } from '../shared';

function requireAuth(req: Request): string {
  const userId = req.headers.get('x-sbbl-user-id-verified');
  if (!userId) {
    throw new Error('unauthorized');
  }
  return userId;
}

type ClaimOrJoinBody = {
  teamId: string;
  leagueId: string;
  mode: 'claim' | 'new';
  existingPlayerId?: string;
  displayName: string;
  jerseyNumber?: number | string | null;
};

export async function handlePlayerClaimOrJoinTeam(ctx: HandlerCtx) {
  const { req, admin } = ctx;
  const userId = requireAuth(req);

  let body: ClaimOrJoinBody;
  try {
    body = (await req.json()) as ClaimOrJoinBody;
  } catch {
    return json({ ok: false, error: 'Invalid JSON request body' }, 400);
  }

  const { teamId, leagueId, mode, existingPlayerId, displayName } = body;

  if (!teamId || typeof teamId !== 'string') {
    return json({ ok: false, error: 'teamId is required' }, 400);
  }
  if (!leagueId || typeof leagueId !== 'string') {
    return json({ ok: false, error: 'leagueId is required' }, 400);
  }
  if (!displayName || typeof displayName !== 'string' || !displayName.trim()) {
    return json({ ok: false, error: 'displayName is required' }, 400);
  }
  if (mode !== 'claim' && mode !== 'new') {
    return json({ ok: false, error: 'mode must be "claim" or "new"' }, 400);
  }

  const resolvedLeagueId = await resolveLeagueId(admin, leagueId);
  if (!resolvedLeagueId) {
    return json({ ok: false, error: 'Invalid league' }, 400);
  }

  // Lookup the caller's profile id if one exists
  const { data: profile } = await admin
    .from('profiles')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();
  const profileId = profile?.id ? String(profile.id) : null;

  const jersey = body.jerseyNumber !== undefined && body.jerseyNumber !== null && body.jerseyNumber !== ''
    ? Number(body.jerseyNumber)
    : null;

  if (mode === 'claim') {
    if (!existingPlayerId) {
      return json({ ok: false, error: 'existingPlayerId is required for claim mode' }, 400);
    }

    // Atomic race-safe UPDATE: user_id IS NULL in the WHERE clause ensures
    // only one caller can claim an unclaimed player record.
    const { data: updated, error: updateErr } = await admin
      .from('players')
      .update({
        user_id: userId,
        profile_id: profileId,
      })
      .eq('id', existingPlayerId)
      .eq('team_id', teamId)
      .is('user_id', null)
      .select('id, display_name, jersey_number, team_id, league_id, user_id')
      .maybeSingle();

    if (updateErr) {
      return json({ ok: false, error: updateErr.message }, 500);
    }

    if (!updated) {
      return json({ ok: false, error: 'already_claimed' }, 409);
    }

    return json({ ok: true, data: { player: updated, mode: 'claim' } }, 200);
  }

  // mode === 'new': plain insert with zero fuzzy name matching (Iron Law 12)
  const { data: inserted, error: insertErr } = await admin
    .from('players')
    .insert({
      user_id: userId,
      profile_id: profileId,
      team_id: teamId,
      league_id: resolvedLeagueId,
      display_name: displayName.trim(),
      jersey_number: jersey,
    })
    .select('id, display_name, jersey_number, team_id, league_id, user_id')
    .single();

  if (insertErr) {
    return json({ ok: false, error: insertErr.message }, 500);
  }

  return json({ ok: true, data: { player: inserted, mode: 'new' } }, 201);
}
