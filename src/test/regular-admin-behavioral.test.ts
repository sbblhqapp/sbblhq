/**
 * Regular-admin (league_admin) permission model — BEHAVIORAL verification.
 *
 * `src/test/regular-admin-permissions.test.ts` proves the gate wiring exists
 * (source-level string assertions). This file proves the gates actually WORK:
 * every case here invokes the real handler with a real Request object against
 * a mock Supabase client and asserts on the real thrown error / real HTTP
 * status / real response body / real row counts. No string matching.
 */
import { describe, expect, it } from 'vitest';
import {
  requireOpsAdminSession,
  handleOpsRevenue,
  handleSuperAdminCompCode,
  handleSuperAdminCompCodeList,
  handleOpsBatchProducts,
  handleOpsPatchTeams,
  handleOpsPatchProducts,
  handleOpsDeleteTeams,
  handleOpsDeleteProducts,
  LEAGUE_ADMIN_COMP_CODE_DAILY_LIMIT,
  COMP_CODE_LIMIT_WINDOW_HOURS,
  type HandlerCtx,
} from '@/worker/index';
import { createAdmin, testEnv, type Row, type TestState } from './broadcast-test-utils';

const LEAGUE_ADMIN_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const SUPER_ADMIN_ID = 'bbbbbbbb-0000-4000-8000-000000000002';
const TEAM_MANAGER_ID = 'cccccccc-0000-4000-8000-000000000003';
const FAN_ID = 'dddddddd-0000-4000-8000-000000000004';
const GAME_ID = 'eeeeeeee-0000-4000-8000-000000000005';
const TEAM_ID = 'ffffffff-0000-4000-8000-000000000006';
const PRODUCT_ID = '11111111-0000-4000-8000-000000000007';

function baseRoles(): Row[] {
  return [
    { user_id: LEAGUE_ADMIN_ID, role: 'league_admin' },
    { user_id: SUPER_ADMIN_ID, role: 'super_admin' },
    { user_id: TEAM_MANAGER_ID, role: 'team_manager' },
    { user_id: FAN_ID, role: 'fan' },
  ];
}

function mkCtx(opts: {
  url: string;
  method?: string;
  body?: unknown;
  userId?: string;
  params?: Record<string, string>;
  admin: ReturnType<typeof createAdmin>;
  idempotencyKey?: string;
}): HandlerCtx {
  const headers: Record<string, string> = {
    'x-idempotency-key': opts.idempotencyKey ?? `idem-${crypto.randomUUID()}`,
  };
  if (opts.userId) headers['x-sbbl-user-id-verified'] = opts.userId;
  const init: RequestInit = { method: opts.method ?? 'GET', headers };
  if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body);
    (init.headers as Record<string, string>)['content-type'] = 'application/json';
  }
  return {
    req: new Request(opts.url, init),
    admin: opts.admin,
    params: opts.params ?? {},
    env: testEnv,
  } as unknown as HandlerCtx;
}

describe('BEHAVIORAL: requireOpsAdminSession real role gate', () => {
  it('resolves for league_admin', async () => {
    const admin = createAdmin({ user_role_assignments: baseRoles() });
    const req = new Request('https://local/x', { headers: { 'x-sbbl-user-id-verified': LEAGUE_ADMIN_ID } });
    const session = await requireOpsAdminSession(req, admin);
    expect(session.userId).toBe(LEAGUE_ADMIN_ID);
    expect(session.roles).toContain('league_admin');
  });

  it('resolves for super_admin', async () => {
    const admin = createAdmin({ user_role_assignments: baseRoles() });
    const req = new Request('https://local/x', { headers: { 'x-sbbl-user-id-verified': SUPER_ADMIN_ID } });
    await expect(requireOpsAdminSession(req, admin)).resolves.toBeTruthy();
  });

  it('THROWS for team_manager (real error, not a string match)', async () => {
    const admin = createAdmin({ user_role_assignments: baseRoles() });
    const req = new Request('https://local/x', { headers: { 'x-sbbl-user-id-verified': TEAM_MANAGER_ID } });
    await expect(requireOpsAdminSession(req, admin)).rejects.toThrow('forbidden');
  });

  it('THROWS for fan', async () => {
    const admin = createAdmin({ user_role_assignments: baseRoles() });
    const req = new Request('https://local/x', { headers: { 'x-sbbl-user-id-verified': FAN_ID } });
    await expect(requireOpsAdminSession(req, admin)).rejects.toThrow('forbidden');
  });

  it('THROWS for unauthenticated', async () => {
    const admin = createAdmin({ user_role_assignments: baseRoles() });
    const req = new Request('https://local/x');
    await expect(requireOpsAdminSession(req, admin)).rejects.toThrow('unauthorized');
  });
});

describe('BEHAVIORAL: live-PPV revenue stays super-admin only', () => {
  function revenueState(): TestState {
    return {
      user_role_assignments: baseRoles(),
      orders: [],
      ppv_invites: [],
      stream_sessions: [],
    };
  }

  it('league_admin is REJECTED — real handler call, real thrown error', async () => {
    const ctx = mkCtx({ url: 'https://local/ops/revenue', userId: LEAGUE_ADMIN_ID, admin: createAdmin(revenueState()) });
    await expect(handleOpsRevenue(ctx)).rejects.toThrow('forbidden');
  });

  it('super_admin succeeds with a real 200 + real computed totals', async () => {
    const state = revenueState();
    state.orders = [
      // Column is `orders.total`. This fixture previously said `total_amount`,
      // a column that has never existed on public.orders — so the test passed
      // against a shape production could not produce, and the real handler's
      // 42703 went unnoticed. Fixtures must mirror the live schema.
      { id: 'o1', total: 4.19, status: 'paid', metadata: { purchase_type: 'ppv' } },
      { id: 'o2', total: 25.0, status: 'paid', metadata: { purchase_type: 'store' } },
    ];
    state.ppv_invites = [{ id: 'i1' }, { id: 'i2' }, { id: 'i3' }];
    const ctx = mkCtx({ url: 'https://local/ops/revenue', userId: SUPER_ADMIN_ID, admin: createAdmin(state) });
    const res = await handleOpsRevenue(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; totalPpvRevenue: number; totalPpvOrders: number; totalInviteRedemptions: number };
    expect(body.ok).toBe(true);
    // Only the metadata.purchase_type === 'ppv' order counts — proves real filtering ran.
    expect(body.totalPpvOrders).toBe(1);
    expect(body.totalPpvRevenue).toBeCloseTo(4.19, 2);
    expect(body.totalInviteRedemptions).toBe(3);
  });
});

describe('BEHAVIORAL: comp-code rolling 24h cap — real counting, real 429', () => {
  function stateWithInvites(existing: Row[]): TestState {
    return { user_role_assignments: baseRoles(), ppv_invites: existing };
  }

  it('league_admin generates a code when under the cap (0 existing → succeeds)', async () => {
    const ctx = mkCtx({
      url: 'https://local/ops/streams/comp-code',
      method: 'POST',
      userId: LEAGUE_ADMIN_ID,
      body: { gameId: GAME_ID },
      admin: createAdmin(stateWithInvites([])),
    });
    const res = await handleSuperAdminCompCode(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; code: string; gameId: string };
    expect(body.ok).toBe(true);
    expect(body.gameId).toBe(GAME_ID);
    expect(typeof body.code).toBe('string');
  });

  it(`blocks the ${LEAGUE_ADMIN_COMP_CODE_DAILY_LIMIT + 1}th code with a real 429 once ${LEAGUE_ADMIN_COMP_CODE_DAILY_LIMIT} exist in the window`, async () => {
    const now = Date.now();
    const recentCodes: Row[] = Array.from({ length: LEAGUE_ADMIN_COMP_CODE_DAILY_LIMIT }, (_, i) => ({
      id: `recent-${i}`,
      generated_by: LEAGUE_ADMIN_ID,
      is_comp: true,
      game_id: GAME_ID,
      created_at: new Date(now - i * 60_000).toISOString(), // minutes apart, all inside 24h
    }));
    const admin = createAdmin(stateWithInvites(recentCodes));

    const ctx = mkCtx({
      url: 'https://local/ops/streams/comp-code',
      method: 'POST',
      userId: LEAGUE_ADMIN_ID,
      body: { gameId: GAME_ID },
      admin,
    });
    const res = await handleSuperAdminCompCode(ctx);
    expect(res.status).toBe(429);
    const body = (await res.json()) as { ok: boolean; error: string; limit: number; used: number };
    expect(body.ok).toBe(false);
    expect(body.error).toBe('comp_code_daily_limit_reached');
    expect(body.limit).toBe(LEAGUE_ADMIN_COMP_CODE_DAILY_LIMIT);
    expect(body.used).toBe(LEAGUE_ADMIN_COMP_CODE_DAILY_LIMIT);
  });

  it('is NON-COMPOUNDING: codes older than the rolling window do not count toward the cap', async () => {
    const now = Date.now();
    const staleCodes: Row[] = Array.from({ length: 20 }, (_, i) => ({
      id: `stale-${i}`,
      generated_by: LEAGUE_ADMIN_ID,
      is_comp: true,
      game_id: GAME_ID,
      // Well outside the window — an "unused day" must NOT bank extra allowance.
      created_at: new Date(now - (COMP_CODE_LIMIT_WINDOW_HOURS + 5) * 60 * 60 * 1000).toISOString(),
    }));
    const ctx = mkCtx({
      url: 'https://local/ops/streams/comp-code',
      method: 'POST',
      userId: LEAGUE_ADMIN_ID,
      body: { gameId: GAME_ID },
      admin: createAdmin(stateWithInvites(staleCodes)),
    });
    const res = await handleSuperAdminCompCode(ctx);
    // 20 stale codes present, but none inside the window — must still succeed.
    expect(res.status).toBe(200);
  });

  it('a code sitting exactly at the boundary still counts (inclusive gte)', async () => {
    const now = Date.now();
    const boundaryCodes: Row[] = Array.from({ length: LEAGUE_ADMIN_COMP_CODE_DAILY_LIMIT }, (_, i) => ({
      id: `boundary-${i}`,
      generated_by: LEAGUE_ADMIN_ID,
      is_comp: true,
      game_id: GAME_ID,
      created_at: new Date(now - COMP_CODE_LIMIT_WINDOW_HOURS * 60 * 60 * 1000 + 2000).toISOString(),
    }));
    const ctx = mkCtx({
      url: 'https://local/ops/streams/comp-code',
      method: 'POST',
      userId: LEAGUE_ADMIN_ID,
      body: { gameId: GAME_ID },
      admin: createAdmin(stateWithInvites(boundaryCodes)),
    });
    const res = await handleSuperAdminCompCode(ctx);
    expect(res.status).toBe(429);
  });

  it("another admin's codes do not count against this admin's cap", async () => {
    const now = Date.now();
    const otherAdminId = 'aaaaaaaa-9999-4999-8999-999999999999';
    const someoneElsesCodes: Row[] = Array.from({ length: LEAGUE_ADMIN_COMP_CODE_DAILY_LIMIT }, (_, i) => ({
      id: `other-${i}`,
      generated_by: otherAdminId,
      is_comp: true,
      game_id: GAME_ID,
      created_at: new Date(now - i * 60_000).toISOString(),
    }));
    const ctx = mkCtx({
      url: 'https://local/ops/streams/comp-code',
      method: 'POST',
      userId: LEAGUE_ADMIN_ID,
      body: { gameId: GAME_ID },
      admin: createAdmin(stateWithInvites(someoneElsesCodes)),
    });
    const res = await handleSuperAdminCompCode(ctx);
    expect(res.status).toBe(200);
  });

  it('super_admin is UNCAPPED — succeeds even with 50 codes already in the window', async () => {
    const now = Date.now();
    const manyCodes: Row[] = Array.from({ length: 50 }, (_, i) => ({
      id: `super-${i}`,
      generated_by: SUPER_ADMIN_ID,
      is_comp: true,
      game_id: GAME_ID,
      created_at: new Date(now - i * 1000).toISOString(),
    }));
    const ctx = mkCtx({
      url: 'https://local/ops/streams/comp-code',
      method: 'POST',
      userId: SUPER_ADMIN_ID,
      body: { gameId: GAME_ID },
      admin: createAdmin(stateWithInvites(manyCodes)),
    });
    const res = await handleSuperAdminCompCode(ctx);
    expect(res.status).toBe(200);
  });

  it('team_manager cannot generate comp codes at all', async () => {
    const ctx = mkCtx({
      url: 'https://local/ops/streams/comp-code',
      method: 'POST',
      userId: TEAM_MANAGER_ID,
      body: { gameId: GAME_ID },
      admin: createAdmin(stateWithInvites([])),
    });
    await expect(handleSuperAdminCompCode(ctx)).rejects.toThrow('forbidden');
  });
});

describe('BEHAVIORAL: comp-code listing scope', () => {
  function listState(): TestState {
    const now = Date.now();
    return {
      user_role_assignments: baseRoles(),
      ppv_invites: [
        { id: 'mine-1', code: 'CODE-MINE-1', generated_by: LEAGUE_ADMIN_ID, is_comp: true, game_id: GAME_ID, created_at: new Date(now - 1000).toISOString(), used_by: null, used_at: null, expires_at: new Date(now + 1000).toISOString(), note: null },
        { id: 'theirs-1', code: 'CODE-THEIRS-1', generated_by: SUPER_ADMIN_ID, is_comp: true, game_id: GAME_ID, created_at: new Date(now - 2000).toISOString(), used_by: null, used_at: null, expires_at: new Date(now + 1000).toISOString(), note: null },
      ],
    };
  }

  it('league_admin sees ONLY their own codes (real filtered response)', async () => {
    const ctx = mkCtx({ url: 'https://local/ops/streams/comp-code', userId: LEAGUE_ADMIN_ID, admin: createAdmin(listState()) });
    const res = await handleSuperAdminCompCodeList(ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; scope: string; codes: Array<{ code: string }> };
    expect(body.scope).toBe('own');
    expect(body.codes).toHaveLength(1);
    expect(body.codes[0].code).toBe('CODE-MINE-1');
  });

  it('super_admin sees ALL codes (real unfiltered response)', async () => {
    const ctx = mkCtx({ url: 'https://local/ops/streams/comp-code', userId: SUPER_ADMIN_ID, admin: createAdmin(listState()) });
    const res = await handleSuperAdminCompCodeList(ctx);
    const body = (await res.json()) as { ok: boolean; scope: string; codes: Array<{ code: string }> };
    expect(body.scope).toBe('all');
    expect(body.codes).toHaveLength(2);
  });
});

describe('BEHAVIORAL: store media/product exclusion — real 403s and real writes', () => {
  function storeState(): TestState {
    return {
      user_role_assignments: baseRoles(),
      teams: [{ id: TEAM_ID, name: 'Old Team Name' }],
      products: [{ id: PRODUCT_ID, name: 'Old Product Name' }],
      audit_logs: [],
    };
  }

  it('league_admin CANNOT create store products (real 403, no row written)', async () => {
    const state = storeState();
    const admin = createAdmin(state);
    const ctx = mkCtx({
      url: 'https://local/ops/products/batch',
      method: 'POST',
      userId: LEAGUE_ADMIN_ID,
      body: { items: [{ title: 'Bootleg Jersey', price: '19.99', leagueId: 'wbl' }] },
      admin,
    });
    await expect(handleOpsBatchProducts(ctx)).rejects.toThrow('forbidden');
    // Prove it's not just a thrown error — no product row was actually created.
    expect(state.products).toHaveLength(1);
  });

  it('super_admin CAN create store products (real 200, real row written)', async () => {
    const state = storeState();
    const admin = createAdmin(state);
    const ctx = mkCtx({
      url: 'https://local/ops/products/batch',
      method: 'POST',
      userId: SUPER_ADMIN_ID,
      body: { items: [{ title: 'Official Jersey', price: '49.99', leagueId: 'wbl' }] },
      admin,
    });
    const res = await handleOpsBatchProducts(ctx);
    expect(res.status).toBe(200);
    expect(state.products.length).toBeGreaterThan(1);
  });

  it('league_admin CANNOT patch a product (real 403, name unchanged)', async () => {
    const state = storeState();
    const admin = createAdmin(state);
    const ctx = mkCtx({
      url: 'https://local/ops/products/x',
      method: 'PATCH',
      userId: LEAGUE_ADMIN_ID,
      params: { id: PRODUCT_ID },
      body: { name: 'Hacked Name' },
      admin,
    });
    await expect(handleOpsPatchProducts(ctx)).rejects.toThrow('forbidden');
    expect(state.products[0].name).toBe('Old Product Name');
  });

  it('super_admin CAN patch a product (real 200, row actually updated)', async () => {
    const state = storeState();
    const admin = createAdmin(state);
    const ctx = mkCtx({
      url: 'https://local/ops/products/x',
      method: 'PATCH',
      userId: SUPER_ADMIN_ID,
      params: { id: PRODUCT_ID },
      body: { name: 'Rebranded Product' },
      admin,
    });
    const res = await handleOpsPatchProducts(ctx);
    expect(res.status).toBe(200);
    expect(state.products[0].name).toBe('Rebranded Product');
  });

  it('league_admin CANNOT archive/delete a product (real 403, status unchanged)', async () => {
    const state = storeState();
    const admin = createAdmin(state);
    const ctx = mkCtx({
      url: 'https://local/ops/products/x',
      method: 'DELETE',
      userId: LEAGUE_ADMIN_ID,
      params: { id: PRODUCT_ID },
      admin,
    });
    await expect(handleOpsDeleteProducts(ctx)).rejects.toThrow('forbidden');
    expect(state.products[0].status).toBeUndefined();
  });

  it('super_admin CAN archive/delete a product (real 200, status actually set)', async () => {
    const state = storeState();
    const admin = createAdmin(state);
    const ctx = mkCtx({
      url: 'https://local/ops/products/x',
      method: 'DELETE',
      userId: SUPER_ADMIN_ID,
      params: { id: PRODUCT_ID },
      admin,
    });
    const res = await handleOpsDeleteProducts(ctx);
    expect(res.status).toBe(200);
    expect(state.products[0].status).toBe('archived');
  });
});

describe('BEHAVIORAL: content ops (non-store) — league_admin CAN write', () => {
  function teamsState(): TestState {
    return {
      user_role_assignments: baseRoles(),
      teams: [{ id: TEAM_ID, name: 'Old Team Name' }],
      audit_logs: [],
    };
  }

  it('league_admin CAN patch a team (real 200, row actually updated)', async () => {
    const state = teamsState();
    const admin = createAdmin(state);
    const ctx = mkCtx({
      url: 'https://local/ops/teams/x',
      method: 'PATCH',
      userId: LEAGUE_ADMIN_ID,
      params: { id: TEAM_ID },
      body: { name: 'Renamed Team' },
      admin,
    });
    const res = await handleOpsPatchTeams(ctx);
    expect(res.status).toBe(200);
    expect(state.teams[0].name).toBe('Renamed Team');
  });

  it('league_admin CAN archive a team (real 200, status actually set)', async () => {
    const state = teamsState();
    const admin = createAdmin(state);
    const ctx = mkCtx({
      url: 'https://local/ops/teams/x',
      method: 'DELETE',
      userId: LEAGUE_ADMIN_ID,
      params: { id: TEAM_ID },
      admin,
    });
    const res = await handleOpsDeleteTeams(ctx);
    expect(res.status).toBe(200);
    expect(state.teams[0].status).toBe('archived');
  });

  it('team_manager CANNOT patch a team (below the ops-admin bar, real 403)', async () => {
    const state = teamsState();
    const admin = createAdmin(state);
    const ctx = mkCtx({
      url: 'https://local/ops/teams/x',
      method: 'PATCH',
      userId: TEAM_MANAGER_ID,
      params: { id: TEAM_ID },
      body: { name: 'Should Not Apply' },
      admin,
    });
    await expect(handleOpsPatchTeams(ctx)).rejects.toThrow('forbidden');
    expect(state.teams[0].name).toBe('Old Team Name');
  });
});
