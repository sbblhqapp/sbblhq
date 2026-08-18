/**
 * In-memory sliding-window rate limiter shared by the Worker entrypoint wrapper.
 *
 * WHY THIS LIVES IN ITS OWN MODULE (do not move it back into the entrypoint):
 * workerd treats every named export of the entrypoint module
 * (`main` in wrangler.jsonc → src/worker/validation-contract-wrapper.ts) as a
 * candidate Worker entrypoint. A non-callable export — a `number`, a `Map` —
 * fails module registration with:
 *
 *   Incorrect type for map entry 'RUNTIME_RATE_LIMIT_MAX':
 *   the provided value is not of type 'function or ExportedHandler'.
 *
 * which aborts `wrangler dev` before the server binds a port. Because the
 * bundled production deploy tolerated it, this broke local development only —
 * and a Worker nobody can run locally is a Worker whose live-database
 * behaviour is never exercised before deploy. Keep non-handler values here.
 */

// Sliding-window buckets keyed by rate-limit token.
export const runtimeRateLimit = new Map<string, number[]>();

// OOM guard: evict the oldest entries when the map exceeds this size.
export const RUNTIME_RATE_LIMIT_MAX = 50_000;

export function enforceInMemoryRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  maxEntries = RUNTIME_RATE_LIMIT_MAX,
): boolean {
  const now = Date.now();
  const bucket = runtimeRateLimit.get(key) ?? [];
  const next = bucket.filter((ts) => now - ts < windowMs);
  if (next.length >= limit) {
    runtimeRateLimit.set(key, next);
    return false;
  }
  next.push(now);
  if (runtimeRateLimit.size >= maxEntries) {
    // Batch evict the oldest 500 entries to avoid calling
    // keys().next() on every request once the limit is reached.
    const iterator = runtimeRateLimit.keys();
    for (let i = 0; i < 500; i++) {
      const { value, done } = iterator.next();
      if (done) break;
      runtimeRateLimit.delete(value);
    }
  }
  runtimeRateLimit.set(key, next);
  return true;
}
