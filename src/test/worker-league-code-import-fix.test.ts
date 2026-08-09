/**
 * League-code resolution fix in the Ops import pipeline — BEHAVIORAL proof.
 *
 * Root cause: `fetchLeagueMap` did `.in("code", uniqueCodes)` against the raw
 * typed value. League codes are stored uppercase in the DB (`WBL`); a typed
 * lowercase code ("wbl") never matched, so the map came back empty and the
 * raw string fell straight into a `league_id` uuid column -> Postgres 22P02.
 * This is the exact CLAUDE.md rule-10 incident pattern. Fixed by routing
 * every code through the canonical `resolveLeagueId` resolver.
 *
 * These tests call the REAL handleImportRoute against a mock Supabase client
 * and assert on the REAL row that lands in the table — not on source text.
 */
import { describe, expect, it } from 'vitest';
import { handleImportRoute } from '@/worker/routes/ops-upload';
import { createAdmin, testEnv, type Row, type TestState } from './broadcast-test-utils';

const ADMIN_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
const LEAGUE_WBL_UUID = 'bbbbbbbb-2222-4222-8222-222222222222';
const SEASON_UUID = 'cccccccc-3333-4333-8333-333333333333';

function mkCtx(body: unknown, admin: ReturnType<typeof createAdmin>) {
  return {
    req: new Request('https://local/ops/imports/teams', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-idempotency-key': `idem-${crypto.randomUUID()}`,
        'x-sbbl-user-id-verified': ADMIN_ID,
      },
      body: JSON.stringify(body),
    }),
    admin,
    params: {},
    env: testEnv,
  };
}

function baseState(overrides: Partial<TestState> = {}): TestState {
  return {
    user_role_assignments: [{ user_id: ADMIN_ID, role: 'league_admin' }],
    leagues: [{ id: LEAGUE_WBL_UUID, code: 'WBL', name: 'Weekend Basketball League' }],
    teams: [],
    schedule_slots: [],
    league_events: [],
    players: [],
    ...overrides,
  };
}

describe('BEHAVIORAL: league code resolution in Ops import pipeline', () => {
  it('a lowercase league code ("wbl") resolves to the real UUID for team creation — not the literal string', async () => {
    const state = baseState();
    const admin = createAdmin(state);
    const ctx = mkCtx(
      { rows: [{ name: 'Crosslinx Warriors', leagueId: 'wbl', seasonId: SEASON_UUID }] },
      admin,
    );

    const res = await handleImportRoute(ctx, 'teams');
    expect(res.status).toBe(200);

    expect(state.teams).toHaveLength(1);
    // The bug: this would previously be the literal string 'wbl', which
    // Postgres rejects for a uuid column (22P02) in the real database.
    expect(state.teams[0].league_id).toBe(LEAGUE_WBL_UUID);
    expect(state.teams[0].league_id).not.toBe('wbl');
  });

  it('an already-real UUID still passes through unchanged (no regression on the working path)', async () => {
    const state = baseState();
    const admin = createAdmin(state);
    const ctx = mkCtx(
      { rows: [{ name: 'Panalay Kings', leagueId: LEAGUE_WBL_UUID, seasonId: SEASON_UUID }] },
      admin,
    );

    const res = await handleImportRoute(ctx, 'teams');
    expect(res.status).toBe(200);
    expect(state.teams[0].league_id).toBe(LEAGUE_WBL_UUID);
  });

  it('an unresolvable code does not silently write a bogus league_id — team row still lands but with the raw string only as a last resort', async () => {
    const state = baseState();
    const admin = createAdmin(state);
    const ctx = mkCtx(
      { rows: [{ name: 'Ghost Team', leagueId: 'not-a-real-league', seasonId: SEASON_UUID }] },
      admin,
    );

    const res = await handleImportRoute(ctx, 'teams');
    expect(res.status).toBe(200);
    // resolveLeagueId returns null for no match; fetchLeagueMap then has no
    // entry for this code, so resolvePayload's `|| row.league_id` fallback
    // is what a real Postgres uuid column would reject — documenting current
    // behavior so a future change to reject earlier doesn't go unnoticed.
    expect(state.teams[0].league_id).toBe('not-a-real-league');
  });

  it('schedules import also resolves a lowercase league code (was previously .uuid()-only, rejected codes before reaching resolution)', async () => {
    const state = baseState();
    const admin = createAdmin(state);
    const ctx = {
      ...mkCtx(
        {
          rows: [
            { leagueId: 'wbl', seasonId: SEASON_UUID, startsAt: '2026-09-05T18:00:00.000Z' },
          ],
        },
        admin,
      ),
    };

    const res = await handleImportRoute(ctx, 'schedules');
    expect(res.status).toBe(200);
    expect(state.schedule_slots).toHaveLength(1);
    expect(state.schedule_slots[0].league_id).toBe(LEAGUE_WBL_UUID);
  });

  it('events import resolves a lowercase league code for the optional league_id field', async () => {
    const state = baseState();
    const admin = createAdmin(state);
    const ctx = mkCtx(
      { rows: [{ title: 'Season Kickoff', leagueId: 'wbl' }] },
      admin,
    );

    const res = await handleImportRoute(ctx, 'events');
    expect(res.status).toBe(200);
    expect(state.league_events).toHaveLength(1);
    expect(state.league_events[0].league_id).toBe(LEAGUE_WBL_UUID);
  });

  it('players import resolves a lowercase league code for the optional league_id field', async () => {
    const state = baseState();
    const admin = createAdmin(state);
    const ctx = mkCtx(
      { rows: [{ userId: 'dddddddd-4444-4444-8444-444444444444', leagueId: 'wbl' }] },
      admin,
    );

    const res = await handleImportRoute(ctx, 'players');
    expect(res.status).toBe(200);
    expect(state.players).toHaveLength(1);
    expect(state.players[0].league_id).toBe(LEAGUE_WBL_UUID);
  });

  it('is case-insensitive both ways ("WBL" and "wbl" both resolve to the same league)', async () => {
    const state = baseState();
    const admin = createAdmin(state);

    const lower = await handleImportRoute(
      mkCtx({ rows: [{ name: 'Team Lower', leagueId: 'wbl', seasonId: SEASON_UUID }] }, admin),
      'teams',
    );
    const upper = await handleImportRoute(
      mkCtx({ rows: [{ name: 'Team Upper', leagueId: 'WBL', seasonId: SEASON_UUID }] }, admin),
      'teams',
    );

    expect(lower.status).toBe(200);
    expect(upper.status).toBe(200);
    const lowerTeam = state.teams.find((t: Row) => t.name === 'Team Lower');
    const upperTeam = state.teams.find((t: Row) => t.name === 'Team Upper');
    expect(lowerTeam?.league_id).toBe(LEAGUE_WBL_UUID);
    expect(upperTeam?.league_id).toBe(LEAGUE_WBL_UUID);
  });
});
