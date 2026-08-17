import { describe, expect, it, vi } from 'vitest';
import {
  handlePublicLeagues,
  handlePublicTeamsByLeague,
  handlePublicUnclaimedPlayers,
} from '@/worker/routes/teams';
import { handlePlayerClaimOrJoinTeam } from '@/worker/routes/player-claim';
import type { HandlerCtx } from '@/worker/shared';
import type { SupabaseClient } from '@supabase/supabase-js';

type MockEnv = Env;

describe('Player Claim and Teams API routes', () => {
  it('handlePublicLeagues returns leagues list', async () => {
    const mockAdmin = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({
            data: [
              { id: 'l1', name: "Sunday's Best Basketball League", code: 'sbbl' },
              { id: 'l2', name: 'Weekend Basketball League', code: 'wbl' },
            ],
            error: null,
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    const res = await handlePublicLeagues({
      req: new Request('https://sbbl-hq.icu/api/public/leagues'),
      admin: mockAdmin,
      env: {} as MockEnv,
      params: {},
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: { id: string; name: string; code: string }[] };
    expect(body.ok).toBe(true);
    expect(body.data).toHaveLength(2);
    expect(body.data[0].code).toBe('sbbl');
  });

  it('handlePublicTeamsByLeague returns teams with division mapping', async () => {
    const mockAdmin = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          ilike: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'league-uuid-1' }, error: null }),
          }),
          order: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 't1',
                  name: 'Team Northstars',
                  division_id: 'd1',
                  divisions: { id: 'd1', name: 'Open Division' },
                },
              ],
              error: null,
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    const res = await handlePublicTeamsByLeague({
      req: new Request('https://sbbl-hq.icu/api/public/teams-by-league?league_id=sbbl'),
      admin: mockAdmin,
      env: {} as MockEnv,
      params: {},
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: { id: string; name: string; division_name: string }[] };
    expect(body.ok).toBe(true);
    expect(body.data[0].name).toBe('Team Northstars');
    expect(body.data[0].division_name).toBe('Open Division');
  });

  it('handlePublicUnclaimedPlayers returns only unclaimed roster players', async () => {
    const mockAdmin = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            is: vi.fn().mockReturnValue({
              is: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  order: vi.fn().mockResolvedValue({
                    data: [
                      { id: 'p1', display_name: 'John Doe', jersey_number: 23 },
                      { id: 'p2', display_name: 'Jane Smith', jersey_number: 7 },
                    ],
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    const res = await handlePublicUnclaimedPlayers({
      req: new Request('https://sbbl-hq.icu/api/public/unclaimed-players?team_id=t1'),
      admin: mockAdmin,
      env: {} as MockEnv,
      params: {},
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: { id: string; display_name: string }[] };
    expect(body.ok).toBe(true);
    expect(body.data).toHaveLength(2);
    expect(body.data[0].display_name).toBe('John Doe');
  });

  it('handlePlayerClaimOrJoinTeam in claim mode updates user_id with race safety', async () => {
    const mockAdmin = {
      from: vi.fn((table: string) => {
        if (table === 'leagues') {
          return {
            select: vi.fn().mockReturnValue({
              ilike: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'league-uuid-1' }, error: null }),
              }),
            }),
          };
        }
        if (table === 'api_idempotency_keys') {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        if (table === 'profiles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'prof-1' }, error: null }),
              }),
            }),
          };
        }
        if (table === 'players') {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  is: vi.fn().mockReturnValue({
                    is: vi.fn().mockReturnValue({
                      select: vi.fn().mockReturnValue({
                        maybeSingle: vi.fn().mockResolvedValue({
                          data: {
                            id: 'player-1',
                            display_name: 'John Doe',
                            jersey_number: 23,
                            user_id: 'user-123',
                            team_id: 'team-1',
                          },
                          error: null,
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        return {};
      }),
    } as unknown as SupabaseClient;

    const req = new Request('https://sbbl-hq.icu/api/player/claim-or-join-team', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-sbbl-user-id-verified': 'user-123',
        'x-idempotency-key': 'idemp-claim-player-12345',
      },
      body: JSON.stringify({
        teamId: 'team-1',
        leagueId: 'sbbl',
        mode: 'claim',
        existingPlayerId: 'player-1',
        displayName: 'John Doe',
        jerseyNumber: 23,
      }),
    });

    const res = await handlePlayerClaimOrJoinTeam({
      req,
      admin: mockAdmin,
      env: {} as MockEnv,
      params: {},
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: { player: { user_id: string }; mode: string } };
    expect(body.ok).toBe(true);
    expect(body.data.mode).toBe('claim');
    expect(body.data.player.user_id).toBe('user-123');
  });

  it('handlePlayerClaimOrJoinTeam returns 409 already_claimed when another user claims first', async () => {
    const mockAdmin = {
      from: vi.fn((table: string) => {
        if (table === 'leagues') {
          return {
            select: vi.fn().mockReturnValue({
              ilike: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'league-uuid-1' }, error: null }),
              }),
            }),
          };
        }
        if (table === 'api_idempotency_keys') {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        if (table === 'profiles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'prof-1' }, error: null }),
              }),
            }),
          };
        }
        if (table === 'players') {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  is: vi.fn().mockReturnValue({
                    is: vi.fn().mockReturnValue({
                      select: vi.fn().mockReturnValue({
                        // Null means affected rows was 0 because user_id IS NULL condition failed (already claimed)
                        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                      }),
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        return {};
      }),
    } as unknown as SupabaseClient;

    const req = new Request('https://sbbl-hq.icu/api/player/claim-or-join-team', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-sbbl-user-id-verified': 'user-456',
        'x-idempotency-key': 'idemp-claim-player-67890',
      },
      body: JSON.stringify({
        teamId: 'team-1',
        leagueId: 'sbbl',
        mode: 'claim',
        existingPlayerId: 'player-1',
        displayName: 'John Doe',
      }),
    });

    const res = await handlePlayerClaimOrJoinTeam({
      req,
      admin: mockAdmin,
      env: {} as MockEnv,
      params: {},
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe('already_claimed');
  });

  it('handlePlayerClaimOrJoinTeam in new mode inserts fresh row with no fuzzy merge', async () => {
    const mockInsert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'new-player-id',
            display_name: 'Brand New Player',
            jersey_number: 99,
            user_id: 'user-789',
            team_id: 'team-1',
            league_id: 'league-uuid-1',
          },
          error: null,
        }),
      }),
    });

    const mockAdmin = {
      from: vi.fn((table: string) => {
        if (table === 'leagues') {
          return {
            select: vi.fn().mockReturnValue({
              ilike: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'league-uuid-1' }, error: null }),
              }),
            }),
          };
        }
        if (table === 'api_idempotency_keys') {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        if (table === 'profiles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'prof-1' }, error: null }),
              }),
            }),
          };
        }
        if (table === 'players') {
          return {
            insert: mockInsert,
          };
        }
        return {};
      }),
    } as unknown as SupabaseClient;

    const req = new Request('https://sbbl-hq.icu/api/player/claim-or-join-team', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-sbbl-user-id-verified': 'user-789',
        'x-idempotency-key': 'idemp-claim-player-99999',
      },
      body: JSON.stringify({
        teamId: 'team-1',
        leagueId: 'sbbl',
        mode: 'new',
        displayName: 'Brand New Player',
        jerseyNumber: 99,
      }),
    });

    const res = await handlePlayerClaimOrJoinTeam({
      req,
      admin: mockAdmin,
      env: {} as MockEnv,
      params: {},
    });

    expect(res.status).toBe(201);
    expect(mockInsert).toHaveBeenCalledWith({
      user_id: 'user-789',
      profile_id: 'prof-1',
      team_id: 'team-1',
      league_id: 'league-uuid-1',
      display_name: 'Brand New Player',
      jersey_number: 99,
    });
  });
});
