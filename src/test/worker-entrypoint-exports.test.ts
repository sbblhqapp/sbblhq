/**
 * Guard: the wrangler `main` entrypoint must export ONLY Worker handlers.
 *
 * workerd registers every named export of the entrypoint module as a candidate
 * entrypoint and refuses to start when one is not callable:
 *
 *   service core:user:sbbl-hq-worker: Uncaught TypeError: Incorrect type for
 *   map entry 'RUNTIME_RATE_LIMIT_MAX': the provided value is not of type
 *   'function or ExportedHandler'.
 *
 * That is a hard failure of `wrangler dev` — the local server never binds a
 * port. It shipped unnoticed because the production bundle tolerated it, so
 * the only casualty was local development. That casualty matters: a Worker
 * nobody can run locally is a Worker whose queries are never executed against
 * a real database until they are already in production, which is how the
 * 42703 schema-drift class of incident keeps reaching users.
 *
 * If this test fails, do NOT delete the offending export — move it into a
 * sibling module (e.g. src/worker/rate-limit.ts) and import it here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ENTRYPOINT = 'src/worker/validation-contract-wrapper.ts';

describe('worker entrypoint exports', () => {
  const source = readFileSync(resolve(process.cwd(), ENTRYPOINT), 'utf8');

  it('declares no exported const/let/var (workerd rejects non-handler exports)', () => {
    const offenders = [...source.matchAll(/^export\s+(?:const|let|var)\s+([A-Za-z0-9_$]+)/gm)].map(
      (m) => m[1],
    );
    expect(
      offenders,
      `${ENTRYPOINT} exports non-handler value(s): ${offenders.join(', ')}. ` +
        'Move them to a sibling module — workerd fails to start otherwise.',
    ).toEqual([]);
  });

  it('exports a default Worker handler', () => {
    expect(/^export\s+default\s*\{/m.test(source)).toBe(true);
  });

  it('keeps the rate limiter state out of the entrypoint module', async () => {
    const mod = await import('../worker/rate-limit');
    expect(mod.runtimeRateLimit).toBeInstanceOf(Map);
    expect(typeof mod.RUNTIME_RATE_LIMIT_MAX).toBe('number');
    expect(typeof mod.enforceInMemoryRateLimit).toBe('function');
  });
});
