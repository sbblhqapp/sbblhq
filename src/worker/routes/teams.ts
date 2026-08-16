/**
 * Public Team, League, and Unclaimed Player routes for onboarding and self-service registration.
 */
import type { HandlerCtx } from '../shared';
import { json, resolveLeagueIdFilter, LEAGUE_NO_MATCH } from '../shared';

export async function handlePublicLeagues({ admin }: HandlerCtx) {
  const { data, error } = await admin
    .from('leagues')
    .select('id, name, code')
    .order('name', { ascending: true });

  if (error) {
    return json({ ok: false, error: error.message }, 500);
  }

  return json({ ok: true, data: data ?? [] }, 200);
}

export async function handlePublicTeamsByLeague({ req, admin }: HandlerCtx) {
  const url = new URL(req.url);
  const leagueIdParam = url.searchParams.get('league_id') || url.searchParams.get('leagueId');

  if (!leagueIdParam) {
    return json({ ok: false, error: 'league_id is required' }, 400);
  }

  const leagueFilter = await resolveLeagueIdFilter(admin, leagueIdParam);
  if (leagueFilter === LEAGUE_NO_MATCH) {
    return json({ ok: true, data: [] }, 200);
  }

  let query = admin
    .from('teams')
    .select('id, name, division_id, divisions:division_id(id, name), status')
    .order('name', { ascending: true });

  if (leagueFilter) {
    query = query.eq('league_id', leagueFilter);
  }

  const { data, error } = await query;
  if (error) {
    return json({ ok: false, error: error.message }, 500);
  }

  const mapped = (data ?? []).map((t: Record<string, unknown>) => {
    const div = t.divisions as { id?: string; name?: string } | null;
    return {
      id: String(t.id),
      name: String(t.name),
      division_id: t.division_id ? String(t.division_id) : (div?.id ? String(div.id) : null),
      division_name: div?.name ? String(div.name) : null,
    };
  });

  return json({ ok: true, data: mapped }, 200);
}

export async function handlePublicUnclaimedPlayers({ req, admin }: HandlerCtx) {
  const url = new URL(req.url);
  const teamId = url.searchParams.get('team_id') || url.searchParams.get('teamId');

  if (!teamId) {
    return json({ ok: false, error: 'team_id is required' }, 400);
  }

  const { data, error } = await admin
    .from('players')
    .select('id, display_name, jersey_number')
    .eq('team_id', teamId)
    .is('user_id', null)
    .is('merged_into', null)
    .order('jersey_number', { ascending: true, nullsFirst: false })
    .order('display_name', { ascending: true });

  if (error) {
    return json({ ok: false, error: error.message }, 500);
  }

  const mapped = (data ?? []).map((p: Record<string, unknown>) => ({
    id: String(p.id),
    display_name: String(p.display_name ?? 'Player'),
    jersey_number: p.jersey_number !== null && p.jersey_number !== undefined ? Number(p.jersey_number) : null,
  }));

  return json({ ok: true, data: mapped }, 200);
}
