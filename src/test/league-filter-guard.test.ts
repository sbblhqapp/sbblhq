// Source-level guard for the league-resolution consolidation (PR #571).
//
// Before 2026-07-21 the league slug→UUID lookup was hand-rolled independently
// at 8 worker call sites. The copies drifted: one crashed /ops/list/media with
// a Postgres 22P02 → 500 (the incident), one silently degraded /api/teams to
// fetch-all-then-JS-filter, two silently nulled league_id on ingest writes.
// PR #567 had already fixed this exact bug class once — in a single handler —
// proving that point fixes do not stick. The only durable fix is a single
// implementation: resolveLeagueId / resolveLeagueIdFilter in
// src/worker/shared.ts.
//
// This guard fails the build if anyone hand-rolls a 9th copy. If it fired on
// your branch: import the helpers from src/worker/shared.ts instead of
// querying leagues yourself. Do NOT widen the allowlist.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const WORKER_ROOT = join(__dirname, '..', 'worker');

function workerSourceFiles(dir: string = WORKER_ROOT): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === 'tests' ? [] : workerSourceFiles(full);
    }
    return /\.(ts|tsx)$/.test(entry) && !/\.d\.ts$/.test(entry) ? [full] : [];
  });
}

describe('league-resolution single source of truth', () => {
  const files = workerSourceFiles().map((path) => ({
    path,
    rel: path.slice(WORKER_ROOT.length + 1),
    src: readFileSync(path, 'utf8'),
  }));

  it('only shared.ts may query leagues by code with ilike', () => {
    const offenders = files.filter(
      (f) => f.rel !== 'shared.ts' && /\.ilike\(\s*["']code["']/.test(f.src),
    );
    expect(
      offenders.map((f) => f.rel),
      'Hand-rolled league code lookup found — use resolveLeagueId/resolveLeagueIdFilter from src/worker/shared.ts',
    ).toEqual([]);
  });

  it('shared.ts contains exactly one code lookup (the canonical resolver)', () => {
    const shared = files.find((f) => f.rel === 'shared.ts');
    expect(shared).toBeDefined();
    expect(shared!.src.match(/\.ilike\(\s*["']code["']/g)).toHaveLength(1);
    expect(shared!.src).toContain('export async function resolveLeagueId');
    expect(shared!.src).toContain('export async function resolveLeagueIdFilter');
    expect(shared!.src).toContain('export const LEAGUE_NO_MATCH');
  });

  // 2026-08-10 addition: the guard above only catches a hand-rolled DUPLICATE
  // lookup. It did not catch handlePublicSchedule (src/worker/routes/public.ts),
  // which had NO lookup at all — the frontend's league slug was piped straight
  // into `.eq('league_id', leagueId)`, throwing Postgres 22P02 for every league
  // in production (found 2026-08-09, unrelated to any change in this session;
  // the handler predates the 2026-07-21 consolidation and was simply missed).
  //
  // This is a coarser, file-level check: any worker file that filters on
  // `league_id` must call resolveLeagueId or resolveLeagueIdFilter *somewhere*
  // in that same file. It cannot prove the specific `.eq('league_id', X)` call
  // uses a resolved value — that needs real dataflow analysis this guard
  // doesn't attempt — but a file filtering by league_id with ZERO calls to
  // either resolver is exactly the shape of this incident, and the check has
  // zero false positives against the current codebase (every file that filters
  // on league_id already calls one of the resolvers, verified when this guard
  // was added).
  it('every worker file that filters on league_id also calls a resolver in that file', () => {
    const LEAGUE_ID_EQ = /\.eq\(\s*["']league_id["']/;
    const RESOLVER_CALL = /resolveLeagueId(Filter)?\(/;

    const offenders = files.filter(
      (f) =>
        f.rel !== 'shared.ts' &&
        LEAGUE_ID_EQ.test(f.src) &&
        !RESOLVER_CALL.test(f.src),
    );
    expect(
      offenders.map((f) => f.rel),
      'File filters on league_id but never calls resolveLeagueId/resolveLeagueIdFilter — ' +
        'the value reaching .eq(\'league_id\', ...) is likely an unresolved slug, which throws ' +
        'Postgres 22P02 for every non-UUID league value (the 2026-08-09 handlePublicSchedule incident). ' +
        'Import and use the resolver from src/worker/shared.ts before filtering.',
    ).toEqual([]);
  });
});
