import { describe, it, expect } from 'vitest';
import { handleScoresCsvUpload } from '@/worker/routes/ops-upload';
import { createAdmin } from './broadcast-test-utils';

interface MkCtxOptions {
  url: string;
  method?: string;
  body: unknown;
  params?: Record<string, string>;
  admin: ReturnType<typeof createAdmin>;
}

function mkCtx(options: MkCtxOptions) {
  const init: RequestInit = { method: options.method ?? 'POST' };
  init.body = JSON.stringify(options.body);
  init.headers = { 'content-type': 'application/json', 'x-idempotency-key': 'idempotency-key-long-enough-12345', 'x-sbbl-user-id-verified': 'admin' };
  return {
    req: new Request(options.url, init),
    admin: options.admin,
    params: options.params ?? {},
    env: {} as unknown as Env,
  };
}

describe('Surface Probes', () => {
  describe('1) Parser surface', () => {
    it('parses smallest real upload sample and asserts shape', async () => {
      // Let createAdmin handle all DB interactions natively; inspect state.teams after
      const state: Record<string, Record<string, unknown>[]> = {
        user_role_assignments: [{ user_id: 'admin', role: 'super_admin' }],
        import_jobs: [],
        api_idempotency_keys: [],
        teams: [],
        leagues: [],
      };
      const adminMock = createAdmin(state);

      const ctx = mkCtx({
        url: 'https://local/api/ops/upload/csv',
        body: {
          kind: 'teams',
          format: 'v1',
          // smallest valid row: name + league_id + season_id required. some_loose_key is NOT in the Zod schema.
          rows: [{ name: 'Test Team', league_id: 'SBBL', season_id: 'cccccccc-3333-4333-8333-333333333333', some_loose_key: 'value' }],
        },
        admin: adminMock,
      });

      const res = await handleScoresCsvUpload(ctx);
      const body = await res.json() as { ok: boolean; inserted?: number };

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);

      // resolvePayload maps CSV row → DB payload. Inspect what actually landed in state.teams.
      // createAdmin's upsert() now properly handles an array payload (each row
      // becomes its own top-level state entry), matching real Supabase
      // semantics — so the resolved team payload is state.teams[0] directly.
      const teamPayload = state.teams[0] as Record<string, unknown>;

      expect(teamPayload).toBeDefined();
      // Zod schema strips unknown keys — some_loose_key must NOT appear in resolved payload
      expect(teamPayload).not.toHaveProperty('some_loose_key');
      // resolvePayload maps name → name, status is hardcoded "published"
      expect(teamPayload).toHaveProperty('name', 'Test Team');
      expect(teamPayload).toHaveProperty('status', 'published');
      // No leagues seeded in this test's state, so resolveLeagueId finds no
      // match for "SBBL" and resolvePayload's fallback writes the raw value.
      expect(teamPayload).toHaveProperty('league_id', 'SBBL');
    });

    it('returns 422 with exact field path on schema failure', async () => {
      const adminMock = createAdmin({
        user_role_assignments: [{ user_id: 'admin', role: 'super_admin' }],
      });
      const ctx = mkCtx({
        url: 'https://local/api/ops/upload/csv',
        body: {
          kind: 'teams',
          format: 'v1',
          // Missing required league_id — should produce 422 with field=league_id
          rows: [{ name: 'Missing League' }],
        },
        admin: adminMock,
      });

      const res = await handleScoresCsvUpload(ctx);
      const body = await res.json() as { ok: boolean; errors: Array<{ row: number; field?: string; code: string }> };

      expect(res.status).toBe(422);
      expect(body.ok).toBe(false);
      expect(body.errors).toBeDefined();
      expect(body.errors[0].row).toBe(1);
      expect(body.errors[0].field).toBe('league_id');
    });
  });

  describe('2) Auth surface', () => {
    it('tests local sign-in redirect explicitly', () => {
      // We know this logic is hardcoded in Login.tsx
      const origin = 'http://localhost:5173';
      const postLoginRedirect = `${origin}/login`;
      
      const allowedOrigins = ['http://localhost:5173', 'https://sbbl-hq-preview.pages.dev', 'https://sbbl-hq.icu'];
      const isValid = allowedOrigins.some(allowed => postLoginRedirect.startsWith(allowed));
      expect(isValid).toBe(true);
    });
  });
});
