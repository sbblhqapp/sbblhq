// Regression shield (2026-07-20 live-hardening): the POTG/event/scoreboard
// parse routes must (a) call Groq with reasoning disabled — hidden-format
// reasoning consumed the entire completion budget on qwen and returned empty
// content ("parse_failed" in prod) — and (b) parse plain-JSON replies.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleParsePotgImage } from '@/worker/index';
import { createAdmin } from './broadcast-test-utils';

const ADMIN_ID = 'bbbbbbbb-2222-4222-8222-222222222222';

function mkCtx(env: Record<string, string>) {
  return {
    req: new Request('https://local/ops/potg/parse', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-idempotency-key': 'idempotency-key-long-enough-12345',
        'x-sbbl-user-id-verified': ADMIN_ID,
      },
      body: JSON.stringify({ imageBase64: 'aGVsbG8=', mimeType: 'image/png' }),
    }),
    admin: createAdmin({ user_role_assignments: [{ user_id: ADMIN_ID, role: 'super_admin' }] }),
    params: {},
    env: env as unknown as Env,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('Groq vision request contract', () => {
  it('sends reasoning_effort:none with the env-overridable model and parses raw JSON', async () => {
    let sentBody: Record<string, unknown> | null = null;
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
      sentBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"playerName":"Jaime Phillips","team":"MANTIKU","pts":20}' } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));

    const res = await handleParsePotgImage(mkCtx({ GROQ_API_KEY: 'test-key' }));
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; data: Record<string, unknown> };
    expect(body.ok).toBe(true);
    expect(body.data.playerName).toBe('Jaime Phillips');

    expect(sentBody?.model).toBe('qwen/qwen3.6-27b');
    expect(sentBody?.reasoning_effort).toBe('none');
    expect(sentBody?.reasoning_format).toBeUndefined();
  });

  it('honors GROQ_VISION_MODEL env override', async () => {
    let sentBody: Record<string, unknown> | null = null;
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
      sentBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }), { status: 200 });
    }));
    await handleParsePotgImage(mkCtx({ GROQ_API_KEY: 'test-key', GROQ_VISION_MODEL: 'future/model-x' }));
    expect(sentBody?.model).toBe('future/model-x');
  });
});

describe('rxdb module is env-independent', () => {
  it('imports without VITE_SUPABASE_* env and exposes initDB (no replication)', async () => {
    const mod = await import('@/lib/rxdb');
    expect(typeof mod.initDB).toBe('function');
  }, 15000);
});
