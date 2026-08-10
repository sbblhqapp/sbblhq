import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { handlePublicSchedule } from '@/worker/routes/public';
import { createAdmin, testEnv, type TestState } from './broadcast-test-utils';

// Static verification that routes are registered in the Worker route table.
const workerSource = readFileSync(resolve(__dirname, '../worker/index.ts'), 'utf-8');
const publicRouteSource = readFileSync(resolve(__dirname, '../worker/routes/public.ts'), 'utf-8');

describe('public API route registration', () => {
  it('registers GET /api/public/home', () => {
    expect(workerSource).toContain('"/api/public/home"');
    expect(workerSource).toContain('handler: handlePublicHome');
  });

  it('registers GET /api/public/schedule', () => {
    expect(workerSource).toContain('"/api/public/schedule"');
    expect(workerSource).toContain('handler: handlePublicSchedule');
  });

  it('registers GET /api/public/potg', () => {
    expect(workerSource).toContain('"/api/public/potg"');
    expect(workerSource).toContain('handler: handlePublicPotg');
  });

  it('handlePublicSchedule handler is defined in routes/public.ts', () => {
    expect(publicRouteSource).toMatch(/export async function handlePublicSchedule/);
  });

  it('handlePublicPotg handler is defined in routes/public.ts', () => {
    expect(publicRouteSource).toMatch(/export async function handlePublicPotg/);
  });
});

// ── BEHAVIORAL: handlePublicSchedule real league-slug resolution ────────────
//
// Root cause (production incident, 2026-08-09): the frontend sends a
// LEAGUE_REGISTRY slug ('sbbl', 'wbl', 'tgifbl') as ?leagueId=, but the
// handler passed it straight into `.eq('league_id', leagueId)` — a uuid
// column. Real Postgres threw 22P02 for EVERY league; the public Schedules
// page showed "Unable to load schedules" site-wide. These tests invoke the
// real handler against a mock Supabase client and assert on the real HTTP
// status and response body — not source text.
const LEAGUE_SBBL_UUID = 'aaaaaaaa-0000-4000-8000-000000000001';
const LEAGUE_WBL_UUID = 'aaaaaaaa-0000-4000-8000-000000000002';

function scheduleState(): TestState {
  return {
    leagues: [
      { id: LEAGUE_SBBL_UUID, code: 'SBBL', name: 'SBBL Spring Edition' },
      { id: LEAGUE_WBL_UUID, code: 'WBL', name: 'Weekend Basketball League' },
    ],
    schedule_slots: [
      { id: 'slot-sbbl-1', league_id: LEAGUE_SBBL_UUID, status: 'upcoming', starts_at: '2026-09-01T00:00:00Z' },
      { id: 'slot-wbl-1', league_id: LEAGUE_WBL_UUID, status: 'upcoming', starts_at: '2026-09-02T00:00:00Z' },
      { id: 'slot-sbbl-2-final', league_id: LEAGUE_SBBL_UUID, status: 'final', starts_at: '2026-08-01T00:00:00Z' },
    ],
  };
}

function mkCtx(url: string, admin: ReturnType<typeof createAdmin>) {
  return { req: new Request(url), admin, params: {}, env: testEnv };
}

describe('BEHAVIORAL: handlePublicSchedule resolves league slugs, never passes them raw', () => {
  it('a lowercase league slug ("sbbl") returns 200 with only that league\'s upcoming slots — not a 500', async () => {
    const admin = createAdmin(scheduleState());
    const res = await handlePublicSchedule(mkCtx('https://local/api/public/schedule?leagueId=sbbl', admin));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: Array<{ id: string; league_id: string }> };
    expect(body.ok).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe('slot-sbbl-1');
  });

  it('an uppercase league code ("TGIFBL") — the DB storage case — also resolves', async () => {
    const state = scheduleState();
    state.leagues.push({ id: 'league-tgifbl', code: 'TGIFBL', name: 'TGIF League' });
    state.schedule_slots.push({ id: 'slot-tgifbl-1', league_id: 'league-tgifbl', status: 'upcoming', starts_at: '2026-09-03T00:00:00Z' });
    const admin = createAdmin(state);

    const res = await handlePublicSchedule(mkCtx('https://local/api/public/schedule?leagueId=tgifbl', admin));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: Array<{ id: string }> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe('slot-tgifbl-1');
  });

  it('an already-real UUID still passes through unchanged', async () => {
    const admin = createAdmin(scheduleState());
    const res = await handlePublicSchedule(mkCtx(`https://local/api/public/schedule?leagueId=${LEAGUE_WBL_UUID}`, admin));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: Array<{ id: string }> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe('slot-wbl-1');
  });

  it('no leagueId param returns every upcoming slot across all leagues', async () => {
    const admin = createAdmin(scheduleState());
    const res = await handlePublicSchedule(mkCtx('https://local/api/public/schedule', admin));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: unknown[] };
    expect(body.data).toHaveLength(2); // both upcoming slots, final excluded by status filter
  });

  it('an unknown league slug returns 200 with an empty array — never a 500, never unfiltered results', async () => {
    const admin = createAdmin(scheduleState());
    const res = await handlePublicSchedule(mkCtx('https://local/api/public/schedule?leagueId=not-a-real-league', admin));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: unknown[] };
    expect(body.ok).toBe(true);
    expect(body.data).toEqual([]);
  });

  it('only "upcoming" status slots are ever returned, regardless of league filter', async () => {
    const admin = createAdmin(scheduleState());
    const res = await handlePublicSchedule(mkCtx('https://local/api/public/schedule', admin));
    const body = (await res.json()) as { data: Array<{ id: string }> };
    expect(body.data.map((s) => s.id)).not.toContain('slot-sbbl-2-final');
  });
});
