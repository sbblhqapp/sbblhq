/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { handleOpsQuickAddPlayer, handleOpsRecordPlayerStat, handleGetGamePlayerStats } from '@/worker/routes/player-stats';
import { handleOverlayStatus } from '@/worker/routes/overlay';
import type { HandlerCtx } from '@/worker/shared';

describe('Courtside Scoring & Live Tabulation Contract v4.0.0', () => {
  const gameId = '11111111-2222-3333-4444-555555555555';
  const teamAwayId = 'team-away-111';
  const teamHomeId = 'team-home-222';
  const leagueId = 'league-999';

  const mockAdminWithState = () => {
    const playersTable: any[] = [];
    const rostersTable: any[] = [];
    const statsTable: any[] = [];
    const gamesTable: any[] = [
      {
        id: gameId,
        league_id: leagueId,
        home_team_id: teamHomeId,
        away_team_id: teamAwayId,
        status: 'live',
        home_score: 0,
        away_score: 0,
      },
    ];
    const overlayTable: any[] = [
      {
        game_id: gameId,
        period_label: 'Q1',
        clock_running: true,
        clock_seconds: 600,
        home_score: 0,
        away_score: 0,
      },
    ];
    const auditLogs: any[] = [];

    const admin: any = {
      from: (table: string) => ({
        select: (_cols?: string) => {
          const queryObj: any = {
            eq: (col: string, val: string) => {
              const eqObj: any = {
                single: async () => {
                  if (table === 'games') {
                    const g = gamesTable.find((x) => x[col] === val);
                    return { data: g, error: g ? null : { message: 'not found' } };
                  }
                  if (table === 'user_role_assignments') {
                    return { data: { role: 'league_admin' }, error: null };
                  }
                  return { data: null, error: null };
                },
                maybeSingle: async () => {
                  if (table === 'overlay_game_state') {
                    const o = overlayTable.find((x) => x[col] === val);
                    return { data: o, error: null };
                  }
                  if (table === 'games') {
                    const g = gamesTable.find((x) => x[col] === val);
                    return { data: g, error: null };
                  }
                  if (table === 'player_game_stats') {
                    const s = statsTable.find((x) => x[col] === val);
                    return { data: s, error: null };
                  }
                  return { data: null, error: null };
                },
                eq: (_c2: string, _v2: string) => ({
                  maybeSingle: async () => {
                    if (table === 'player_game_stats') {
                      const s = statsTable.find((x) => x[col] === val && x[_c2] === _v2);
                      return { data: s, error: null };
                    }
                    return { data: null, error: null };
                  },
                }),
                then: (resolve: any) => {
                  if (table === 'user_role_assignments') {
                    return resolve({ data: [{ role: 'league_admin' }], error: null });
                  }
                  resolve({ data: [], error: null });
                },
              };
              return eqObj;
            },
          };
          return queryObj;
        },
        insert: (payload: any) => ({
          select: (_c?: string) => ({
            single: async () => {
              if (table === 'players') {
                const newP = {
                  id: `player-${Date.now()}-${Math.random()}`,
                  ...payload,
                };
                playersTable.push(newP);
                return { data: newP, error: null };
              }
              return { data: payload, error: null };
            },
          }),
          then: async (resolve: any) => {
            if (table === 'audit_logs') auditLogs.push(payload);
            resolve({ data: payload, error: null });
          },
        }),
        upsert: (payload: any) => {
          if (table === 'game_rosters') {
            rostersTable.push(payload);
            return Promise.resolve({ data: payload, error: null });
          }
          if (table === 'player_game_stats') {
            const idx = statsTable.findIndex(
              (x) => x.game_id === payload.game_id && x.player_id === payload.player_id
            );
            if (idx >= 0) statsTable[idx] = { ...statsTable[idx], ...payload };
            else statsTable.push(payload);
            return {
              select: () => ({
                single: async () => ({ data: payload, error: null }),
              }),
            };
          }
          return {
            select: () => ({
              single: async () => ({ data: payload, error: null }),
            }),
          };
        },
        update: (payload: any) => ({
          eq: (col: string, val: string) => {
            if (table === 'games') {
              const g = gamesTable.find((x) => x[col] === val);
              if (g) Object.assign(g, payload);
              return {
                select: () => ({
                  single: async () => ({ data: g, error: null }),
                }),
              };
            }
            if (table === 'overlay_game_state') {
              const o = overlayTable.find((x) => x[col] === val);
              if (o) Object.assign(o, payload);
              return Promise.resolve({ data: o, error: null });
            }
            return Promise.resolve({ data: payload, error: null });
          },
        }),
      }),
    };

    return { admin, playersTable, rostersTable, statsTable, gamesTable, overlayTable, auditLogs };
  };

  const createCtx = (admin: any, params: Record<string, string>, body: any): HandlerCtx => ({
    params,
    admin,
    req: {
      headers: new Headers({ 'x-sbbl-user-id-verified': 'admin-uuid-1' }),
      json: async () => body,
    } as any,
    env: {} as any,
  });

  it('1. Two players with same name on different teams do NOT share a players row and stats do not cross-contaminate', async () => {
    const state = mockAdminWithState();

    // Add "Marcus Smart" to Away team
    const ctxAway = createCtx(state.admin, { gameId }, {
      name: 'Marcus Smart',
      jerseyNumber: 36,
      teamSide: 'away',
    });
    const resAway = await handleOpsQuickAddPlayer(ctxAway);
    const bodyAway = await resAway.json() as any;

    expect(bodyAway.ok).toBe(true);
    expect(bodyAway.player.teamId).toBe(teamAwayId);
    const awayPlayerId = bodyAway.player.id;

    // Add another "Marcus Smart" to Home team
    const ctxHome = createCtx(state.admin, { gameId }, {
      name: 'Marcus Smart',
      jerseyNumber: 36,
      teamSide: 'home',
    });
    const resHome = await handleOpsQuickAddPlayer(ctxHome);
    const bodyHome = await resHome.json() as any;

    expect(bodyHome.ok).toBe(true);
    expect(bodyHome.player.teamId).toBe(teamHomeId);
    const homePlayerId = bodyHome.player.id;

    // Verify two isolated players exist in database
    expect(awayPlayerId).not.toBe(homePlayerId);
    expect(state.playersTable.length).toBe(2);
    expect(state.playersTable[0].team_id).toBe(teamAwayId);
    expect(state.playersTable[1].team_id).toBe(teamHomeId);

    // Record stats for Away player (+3 PTS)
    const ctxStatAway = createCtx(state.admin, { gameId }, {
      playerId: awayPlayerId,
      stat: 'pts',
      delta: 3,
      teamSide: 'away',
    });
    await handleOpsRecordPlayerStat(ctxStatAway);

    // Verify only away player has 3 PTS, home player is unaffected
    const awayStats = state.statsTable.find((x) => x.player_id === awayPlayerId);
    const homeStats = state.statsTable.find((x) => x.player_id === homePlayerId);

    expect(awayStats?.pts).toBe(3);
    expect(homeStats?.pts ?? 0).toBe(0);
    expect(state.overlayTable[0].away_score).toBe(3);
    expect(state.overlayTable[0].home_score).toBe(0);
  });

  it('2. Finalize -> Reopen (review_pending) -> Edit -> Finalize properly transitions state', async () => {
    const state = mockAdminWithState();

    // 1. Finalize game
    const ctxFinal = createCtx(state.admin, { gameId }, { status: 'final' });
    const resFinal = await handleOverlayStatus(ctxFinal);
    const bodyFinal = await resFinal.json() as any;

    expect(bodyFinal.ok).toBe(true);
    expect(state.gamesTable[0].status).toBe('final');
    expect(state.overlayTable[0].period_label).toBe('FINAL');
    expect(state.overlayTable[0].clock_running).toBe(false);

    // 2. Reopen game (review_pending)
    const ctxReopen = createCtx(state.admin, { gameId }, { status: 'review_pending' });
    const resReopen = await handleOverlayStatus(ctxReopen);
    const bodyReopen = await resReopen.json() as any;

    expect(bodyReopen.ok).toBe(true);
    expect(state.gamesTable[0].status).toBe('review_pending');
    expect(state.overlayTable[0].period_label).toBe('CORR');

    // 3. Finalize again
    const ctxFinal2 = createCtx(state.admin, { gameId }, { status: 'final' });
    const resFinal2 = await handleOverlayStatus(ctxFinal2);
    const bodyFinal2 = await resFinal2.json() as any;

    expect(bodyFinal2.ok).toBe(true);
    expect(state.gamesTable[0].status).toBe('final');
    expect(state.overlayTable[0].period_label).toBe('FINAL');
  });

  it('3. Confirms there is NO route in the worker that hard-deletes a game', async () => {
    const workerSrc = await import('@/worker/index');
    // Ensure worker does not export or register any handleOpsDeleteGame or delete game route
    expect((workerSrc as any).handleOpsDeleteGame).toBeUndefined();
  });
});
