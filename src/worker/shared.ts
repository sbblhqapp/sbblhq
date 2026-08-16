import type { SupabaseClient } from "@supabase/supabase-js";

export type HandlerCtx = {
  req: Request;
  env: Env;
  params: Record<string, string>;
  admin: SupabaseClient;
};

export type Handler = (ctx: HandlerCtx) => Promise<Response>;

/**
 * Cloudflare Edge Caching Header Presets:
 * Slashes database Disk IO by caching responses at the Cloudflare edge.
 * - STATIC: For immutable or rarely changing assets (leagues, config, products, media).
 * - FREQUENT: For moderately changing data (teams, schedule, digest, sponsors, unclaimed players).
 * - REALTIME: For dynamic live-game read data (scores, live standings, overlay state, player game stats).
 * - PRIVATE_NO_CACHE: For authenticated or mutation endpoints.
 */
export const CACHE_HEADERS = {
  STATIC: {
    "cache-control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
  },
  FREQUENT: {
    "cache-control": "public, max-age=15, s-maxage=60, stale-while-revalidate=120",
  },
  REALTIME: {
    "cache-control": "public, max-age=1, s-maxage=3, stale-while-revalidate=10",
  },
  PRIVATE_NO_CACHE: {
    "cache-control": "private, no-cache, no-store, must-revalidate",
  },
};

export function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

// ─── League identity resolution — SINGLE SOURCE OF TRUTH ─────────────────────
// Frontends send app-level league slugs/codes (e.g. "tgifbl" from
// LEAGUE_REGISTRY in src/lib/leagues.ts), NOT the leagues.id UUID that every
// league_id FK column stores. Passing that slug straight into
// `.eq('league_id', slug)` makes Postgres throw 22P02 "invalid input syntax
// for type uuid" → 500 (2026-07-21 /ops/media incident, PR #571). Before this
// consolidation the same slug→UUID lookup was hand-rolled independently at 8
// call sites, each with its own drift. Do NOT add another copy — import these
// helpers (enforced by src/test/league-filter-guard.test.ts).

export const LEAGUE_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve a raw league identifier (UUID, league code, or league name) to the
 * leagues.id UUID. Returns null when no league matches. UUIDs pass through
 * without a lookup (parity with every pre-consolidation call site). The name
 * fallback preserves the legacy /api/teams behavior of matching code OR name.
 */
export async function resolveLeagueId(
  admin: SupabaseClient,
  raw: string,
): Promise<string | null> {
  if (LEAGUE_UUID_RE.test(raw)) return raw;
  const byCode = await admin
    .from("leagues")
    .select("id")
    .ilike("code", raw)
    .maybeSingle();
  if (byCode.error) throw new Error(byCode.error.message);
  if (byCode.data?.id) return String(byCode.data.id);
  const byName = await admin
    .from("leagues")
    .select("id")
    .ilike("name", raw)
    .maybeSingle();
  if (byName.error) throw new Error(byName.error.message);
  return byName.data?.id ? String(byName.data.id) : null;
}

/**
 * List/filter variant. Distinguishes "no filter requested" (null) from
 * "filter given but no such league" (LEAGUE_NO_MATCH). Callers MUST return
 * zero rows on LEAGUE_NO_MATCH — never crash, never silently drop the filter
 * and show everything.
 */
export const LEAGUE_NO_MATCH = Symbol("league_no_match");

export async function resolveLeagueIdFilter(
  admin: SupabaseClient,
  raw: string | null,
): Promise<string | null | typeof LEAGUE_NO_MATCH> {
  if (!raw) return null;
  return (await resolveLeagueId(admin, raw)) ?? LEAGUE_NO_MATCH;
}
