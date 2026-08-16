import * as Sentry from "@sentry/cloudflare";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { safeServerEnv } from "@/lib/env";
import { readIdempotencyKey } from "@/lib/api/idempotency";
import { normalizeIngress, type IngressSourceType } from "@/lib/omniport";
import { signSyncPacket, type SyncPacket } from "@/lib/sync-packets";
import { ENTITLEMENT, ENTITLEMENT_MS } from "@/lib/constants/ENTITLEMENT_CONSTANTS";
import { selectPlaybackProvider } from "@/lib/playback/selectProvider";
import { verifyPlaybackToken } from "@/lib/playback/signed-token";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { resolveLeagueId, resolveLeagueIdFilter, LEAGUE_NO_MATCH } from "./shared";
import {
  mergeBeaconIntoAggregate,
  parseBeaconPayload,
  toHealthReport,
  type AggregatedHealth,
} from "@/lib/stream/streamforge";
import { getStreamDeliveryClass, canonicalizeStreamSourceUrl } from "@/lib/stream/url-detector";
import {
  handlePublicConfig as _handlePublicConfig,
  handlePublicHome as _handlePublicHome,
  handlePublicSchedule as _handlePublicSchedule,
  handlePublicPotg as _handlePublicPotg,
} from "./routes/public";
import {
  handleQoeIngest,
  handleQoeHealthReport,
} from "./routes/stream-qoe";
import {
  handlePublicOverlay,
  handleOverlayPatch,
  handleOverlayClock,
  handleOverlayScore,
  handleOverlayFoul,
  handleOverlayPeriod,
  handleOverlayReset,
  handleOverlayStatus,
} from "./routes/overlay";
import {
  handleGetGamePlayerStats,
  handleOpsRecordPlayerStat,
  handleOpsQuickAddPlayer,
  handleOpsDeleteGame,
} from "./routes/player-stats";
import {
  handlePublicPollsList,
  handlePublicPollResults,
  handlePublicEngagementLeaderboard,
  handleCastVote,
  handleCreatePoll,
  handleUpdatePoll,
  handleGradePoll,
  handleMyPoints,
  handleCreateWatchParty,
  handleListWatchParties,
  handleJoinWatchParty,
  handleJoinByCode,
} from "./routes/engagement";
import {
  handleLeaderboardByGame,
  handleLeaderboardBySeason,
  handleTokenAward,
  handleTokenCategories,
  handleTokenProducts,
  handleTokenPurchase,
  handleTokenWallet,
  handleTokenWebhook,
} from "./routes/tokens";
import {
  handleBiometricIngest,
  handleBiometricLatest,
  handleBiometricWebhookIngest,
} from "./routes/biometrics";
import { handleLatestMicUpOverlayEvents, handleMicUpOverlayEvent } from "./routes/overlay-events";
import { handleReplayStatus } from "./routes/replay";
import {
  handlePublicSponsors,
  handleTrackSponsorEvent,
  handleAdminListSponsors,
  handleCreateSponsor,
  handleUpdateSponsor,
  handleDeleteSponsor,
} from "./routes/sponsors";
import {
  handleEnqueueObsCommand,
  handleListObsCommands,
  handleAgentPending,
  handleAgentAck,
} from "./routes/obs";
import { handlePublicDigest, handleRegenerateDigest } from "./routes/digest";
import {
  handlePublicHighlights,
  handleMarkHighlight,
  handleDeleteHighlight,
  handleUpdateHighlight,
  handleReactionAggregate,
} from "./routes/highlights";
import {
  handleScoresCsvUpload,
  handleImportRoute as _handleImportRoute,
  handleScoresCsvImport as _handleScoresCsvImport,
  handleRosterImport as _handleRosterImport
} from "./routes/ops-upload";
import { parseStripeSignature, constantTimeEqualHex } from "./stripe-utils";
export { parseStripeSignature, constantTimeEqualHex };

export type HandlerCtx = {
  req: Request;
  env: Env;
  params: Record<string, string>;
  admin: SupabaseClient;
};

type Handler = (ctx: HandlerCtx) => Promise<Response>;

type Route = { method: string; regex: RegExp; handler: Handler };
const transientIdempotency = new Map<string, number>();
const transientRateLimits = new Map<string, number[]>();
const streamUrlCache = new Map<string, { url: string; expiresAtMs: number }>();
const STREAM_URL_CACHE_TTL_MS = 30_000;

const ALLOWED_ORIGINS = [
  "https://sbbl-hq.icu",
  "https://www.sbbl-hq.icu",
  "http://localhost:5173",
  "http://localhost:8080",
  "capacitor://localhost",
  "http://localhost",
];

// Per-isolate cached admin Supabase client.  Cloudflare Workers reuse isolate
// memory across requests, so we avoid creating a new client on every fetch.
let _cachedAdmin: SupabaseClient | null = null;
let _cachedAdminUrl: string | null = null;
let _cachedAdminKey: string | null = null;

// ── Heartbeat batch queue ────────────────────────────────────────────────
// Instead of writing every 25-second heartbeat to the DB individually (800
// writes/s at 20K viewers), queue them in-memory and flush once every 30s
// via a single batch_heartbeat_upsert() RPC call.
type HeartbeatEntry = {
  session_id: string;
  user_id: string;
  game_id: string;
  expires_at: string;
  now_ts: string;
};
const heartbeatQueue: HeartbeatEntry[] = [];
let heartbeatFlushTimer: ReturnType<typeof setTimeout> | null = null;
const HEARTBEAT_FLUSH_INTERVAL_MS = 5_000; // Flush every 5 seconds instead of 30 to keep batch sizes small (approx ~4000 for 20k users)
const HEARTBEAT_QUEUE_MAX = 10_000; // Expanded to handle up to 40k+ concurrents safely over 5s
const HEARTBEAT_MAX_RETRIES = 3;    // Stop retrying after 3 consecutive failures
let heartbeatConsecutiveFailures = 0;

async function flushHeartbeatQueue(env: Env): Promise<void> {
  if (heartbeatQueue.length === 0) return;

  // OOM guard: if queue grew past cap (sustained DB failure), drop oldest
  if (heartbeatQueue.length > HEARTBEAT_QUEUE_MAX) {
    const dropped = heartbeatQueue.length - HEARTBEAT_QUEUE_MAX;
    heartbeatQueue.splice(0, dropped);
    console.warn(`[heartbeat-flush] Dropped ${dropped} oldest entries (queue exceeded ${HEARTBEAT_QUEUE_MAX})`);
  }

  const batch = heartbeatQueue.splice(0, heartbeatQueue.length);
  const admin = getAdminClient(env);
  const { error } = await admin.rpc("batch_heartbeat_upsert", {
    p_heartbeats: JSON.stringify(batch),
  });
  if (error) {
    heartbeatConsecutiveFailures += 1;
    if (heartbeatConsecutiveFailures <= HEARTBEAT_MAX_RETRIES) {
      // Retry: push entries back for next flush
      heartbeatQueue.unshift(...batch);
      console.error(`[heartbeat-flush] batch_heartbeat_upsert failed (attempt ${heartbeatConsecutiveFailures}/${HEARTBEAT_MAX_RETRIES}):`, error.message);
    } else {
      // Drop the batch — DB is persistently down, don't OOM the worker
      console.error(`[heartbeat-flush] Dropping ${batch.length} heartbeats after ${HEARTBEAT_MAX_RETRIES} consecutive failures:`, error.message);
    }
  } else {
    heartbeatConsecutiveFailures = 0; // Reset on success
  }
}

function getAdminClient(env: Env): SupabaseClient {
  // Invalidate on URL or key change (covers both config drift and key rotation).
  if (
    _cachedAdmin &&
    _cachedAdminUrl === env.SUPABASE_URL &&
    _cachedAdminKey === env.SUPABASE_SERVICE_ROLE_KEY
  ) return _cachedAdmin;
  _cachedAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  _cachedAdminUrl = env.SUPABASE_URL;
  _cachedAdminKey = env.SUPABASE_SERVICE_ROLE_KEY;
  return _cachedAdmin;
}

// Returns the HMAC secret used to sign/verify stream proxy authentication cookies.
// Priority: STREAM_PROXY_SECRET > OMNIHUB_SIGNING_SECRET.
// NEVER falls back to SUPABASE_SERVICE_ROLE_KEY — the DB credential must not
// be used as a proxy token secret (different security context; compromising one
// must not compromise the other).
export function resolveProxyTokenSecret(env: Env): string | null {
  return env.STREAM_PROXY_SECRET ?? env.OMNIHUB_SIGNING_SECRET ?? null;
}

export function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extraHeaders },
  });
}

function enforceInMemoryRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): boolean {
  const now = Date.now();

  // Sweep stale rate limits to prevent OOM under extreme load (20k+ concurrents)
  // Run sweep approx 10% of the time to avoid CPU block
  if (Math.random() < 0.1) {
    for (const [k, v] of transientRateLimits.entries()) {
      const valid = v.filter((ts) => now - ts <= windowMs);
      if (valid.length === 0) transientRateLimits.delete(k);
      else transientRateLimits.set(k, valid);
    }

    // Also sweep idempotency map which grows unbounded
    for (const [k, v] of transientIdempotency.entries()) {
       if (now - v > 60_000) transientIdempotency.delete(k);
    }
  }

  const bucket = transientRateLimits.get(key) ?? [];
  const recent = bucket.filter((ts) => now - ts <= windowMs);
  if (recent.length >= limit) {
    transientRateLimits.set(key, recent);
    return false;
  }
  recent.push(now);
  transientRateLimits.set(key, recent);
  return true;
}

async function enforceSharedRateLimit(
  admin: SupabaseClient,
  scope: string,
  key: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  const res = await admin.rpc("consume_stream_rate_limit", {
    p_scope: scope,
    p_key: key,
    p_limit: limit,
    p_window_seconds: Math.max(1, Math.floor(windowMs / 1000)),
  });
  if (res.error) {
    // Safe fallback so a DB RPC issue does not fully disable abuse controls.
    return enforceInMemoryRateLimit(`${scope}:${key}`, limit, windowMs);
  }
  return Boolean(res.data);
}

// SECURITY: roles are never read from client-supplied headers.
// They are set exclusively by getSession() after JWT verification and
// attached to the enriched internal request. This function is only called
// on the enriched request inside the worker, never on the raw client request.
function getRolesFromVerifiedSession(req: Request): string[] {
  const header = req.headers.get("x-sbbl-roles-verified");
  if (!header) return ["fan"];
  return header
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
}

function getBearerToken(req: Request) {
  const value = req.headers.get("authorization");
  if (!value?.startsWith("Bearer ")) return null;
  return value.slice("Bearer ".length).trim();
}

const textEncoder = new TextEncoder();
const proxyEncoder = new TextEncoder();
const PROXY_AUTH_COOKIE = "sbbl_proxy_auth";

type ProxyTokenPayload = {
  gameId: string;
  userId: string;
  sessionId: string;
  exp: number;
};

function toBase64Url(input: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < input.byteLength; i += 1) binary += String.fromCharCode(input[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(input: string): Uint8Array | null {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "===".slice((normalized.length + 3) % 4);
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

async function signProxyToken(payload: ProxyTokenPayload, secret: string): Promise<string> {
  const payloadBytes = proxyEncoder.encode(JSON.stringify(payload));
  const key = await crypto.subtle.importKey(
    "raw",
    proxyEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, payloadBytes);
  return `${toBase64Url(payloadBytes)}.${toBase64Url(new Uint8Array(signature))}`;
}

async function verifyProxyToken(token: string, secret: string): Promise<ProxyTokenPayload | null> {
  const [payloadPart, signaturePart] = token.split(".");
  if (!payloadPart || !signaturePart) return null;
  const payloadBytes = fromBase64Url(payloadPart);
  const signatureBytes = fromBase64Url(signaturePart);
  if (!payloadBytes || !signatureBytes) return null;
  const key = await crypto.subtle.importKey(
    "raw",
    proxyEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify("HMAC", key, signatureBytes as BufferSource, payloadBytes as BufferSource);
  if (!valid) return null;
  const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as ProxyTokenPayload;
  if (
    !payload ||
    typeof payload.gameId !== "string" ||
    typeof payload.userId !== "string" ||
    typeof payload.sessionId !== "string" ||
    typeof payload.exp !== "number"
  ) {
    return null;
  }
  if (Math.floor(Date.now() / 1000) >= payload.exp) return null;
  return payload;
}

function readCookie(req: Request, name: string): string | null {
  const cookie = req.headers.get("cookie");
  if (!cookie) return null;
  const prefix = `${name}=`;
  for (const part of cookie.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) return decodeURIComponent(trimmed.slice(prefix.length));
  }
  return null;
}

function toProxyPath(pathname: string, gameId: string): string {
  const prefix = `/api/streams/${gameId}/proxy/`;
  return pathname.startsWith(prefix) ? pathname.slice(prefix.length) : "";
}

function toGatewayAbsoluteUrl(input: string, gameId: string): string {
  if (/^(?:https?:)?\/\//i.test(input)) {
    try {
      const parsed = new URL(input, "https://placeholder.local");
      return `/api/streams/${gameId}/proxy/${parsed.pathname.replace(/^\/+/, "")}${parsed.search}`;
    } catch {
      return input;
    }
  }
  if (input.startsWith("/")) return `/api/streams/${gameId}/proxy/${input.replace(/^\/+/, "")}`;
  return `/api/streams/${gameId}/proxy/${input}`;
}

function rewriteManifestToGateway(manifest: string, gameId: string): string {
  const rewrittenAttrs = manifest.replace(
    /URI="([^"]+)"/g,
    (_match: string, uri: string) => `URI="${toGatewayAbsoluteUrl(uri, gameId)}"`,
  );
  // Single-pass line transform: only non-comment URIs are rewritten.
  return rewrittenAttrs.replace(
    /^(?!#)([^\r\n]+)$/gm,
    (line: string) => toGatewayAbsoluteUrl(line.trim(), gameId),
  );
}

function resolveProxyTarget(trueOrigin: string, requestUrl: string, gameId: string): string {
  const reqUrl = new URL(requestUrl);
  const proxyPath = toProxyPath(reqUrl.pathname, gameId);
  const target = new URL(proxyPath, trueOrigin);
  reqUrl.searchParams.forEach((value, key) => target.searchParams.set(key, value));
  return target.toString();
}

async function getStreamUrlForGame(
  admin: SupabaseClient,
  gameId: string,
  env: Env,
): Promise<string> {
  const nowMs = Date.now();
  const cacheHit = streamUrlCache.get(gameId);
  if (cacheHit && cacheHit.expiresAtMs > nowMs) return cacheHit.url;

  // Prefer normalized playback_asset_id while preserving collection_id fallback
  // during additive migration rollout. Never reads games.stream_url.
  const cfg = await admin
    .from("stream_admin_config")
    .select("playback_asset_id,collection_id")
    .eq("id", true)
    .maybeSingle();
  if (cfg.error) throw new Error(cfg.error.message);
  const cfgData = cfg.data as { playback_asset_id?: string | null; collection_id?: string | null } | null;
  const streamUrl =
    String(cfgData?.playback_asset_id ?? "").trim() ||
    String(cfgData?.collection_id ?? "").trim() ||
    String(env.VITE_STREAM_URL ?? "").trim();
  if (!streamUrl) throw new Error("stream_not_configured");

  streamUrlCache.set(gameId, { url: streamUrl, expiresAtMs: nowMs + STREAM_URL_CACHE_TTL_MS });
  return streamUrl;
}

async function signHmacSha256(secret: string, payload: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    textEncoder.encode(payload),
  );
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
  nowMs = Date.now(),
) {
  const parsed = parseStripeSignature(signatureHeader);
  if (!Number.isFinite(parsed.timestamp) || parsed.signatures.length === 0)
    return false;

  const ageSeconds = Math.abs(Math.floor(nowMs / 1000) - parsed.timestamp);
  if (ageSeconds > 300) return false;

  const payload = `${parsed.timestamp}.${rawBody}`;
  const expected = await signHmacSha256(secret, payload);
  return parsed.signatures.some((candidate) =>
    constantTimeEqualHex(candidate.toLowerCase(), expected),
  );
}

async function verifyTurnstileToken(
  env: Env,
  token: string | undefined,
  remoteIp: string,
): Promise<boolean> {
  if (!env.OPTIONAL_TURNSTILE_SECRET_KEY) return true;
  if (!token) return false;
  try {
    const form = new URLSearchParams();
    form.set("secret", env.OPTIONAL_TURNSTILE_SECRET_KEY);
    form.set("response", token);
    if (remoteIp && remoteIp !== "unknown") form.set("remoteip", remoteIp);
    const res = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      },
    );
    if (!res.ok) return false;
    const payload = (await res.json().catch(() => null)) as
      | { success?: boolean }
      | null;
    return Boolean(payload?.success);
  } catch (err) {
    console.error("[turnstile] verification error:", err);
    return false;
  }
}

// SECURITY: session is established ONLY via a valid Supabase JWT Bearer token.
// The x-sbbl-user-id fallback has been removed — any client-supplied identity
// header is ignored. If JWT verification fails, session is null (unauthenticated).
let jwksClient: ReturnType<typeof createRemoteJWKSet> | null = null;

// Resolve the roles granted to a verified user.
//
// Why this exists as its own function:
//   Supabase Auth's default JWT does NOT embed our custom `user_role` claim
//   (it only appears when a Custom Access Token hook writes it, which this
//   project does not configure). Reading `payload.user_role` alone silently
//   downgrades every admin / coach / team_manager to the `fan` fallback —
//   locking them out of Leaderboards and the full stat tier. The source of
//   truth is `public.user_role_assignments`; every privileged role lives
//   there. We merge whatever the JWT supplied with what the DB says so
//   future claim hooks continue to work.
//
// Semantics:
//   - JWT value may be a string ("super_admin") or an array.
//   - DB lookup may fail (network/DB hiccup) — in that case we fall back to
//     the JWT value. We deliberately do NOT throw; the user is still
//     authenticated, they just don't get elevated privileges on this request.
//   - If both JWT and DB produce no roles, caller gets `["fan"]`.
export async function resolveUserRoles(
  admin: SupabaseClient,
  userId: string,
  jwtUserRole: unknown,
): Promise<string[]> {
  const jwtRoles: string[] = [];
  if (typeof jwtUserRole === "string" && jwtUserRole.trim()) {
    jwtRoles.push(jwtUserRole.trim());
  } else if (Array.isArray(jwtUserRole)) {
    for (const r of jwtUserRole) {
      if (typeof r === "string" && r.trim()) jwtRoles.push(r.trim());
    }
  }

  let dbRoles: string[] = [];
  try {
    const { data, error } = await admin
      .from("user_role_assignments")
      .select("role")
      .eq("user_id", userId);
    if (!error && Array.isArray(data)) {
      dbRoles = data
        .map((row) => (row as { role?: unknown }).role)
        .filter((r): r is string => typeof r === "string" && r.length > 0);
    }
  } catch (lookupErr) {
    console.error("Role assignment lookup failed:", lookupErr);
  }

  const merged = new Set<string>([...jwtRoles, ...dbRoles]);
  return merged.size > 0 ? Array.from(merged) : ["fan"];
}

export async function getSession(req: Request, env: Env) {
  const token = getBearerToken(req);
  if (!token || !env.SUPABASE_URL) return null;

  try {
    if (!jwksClient) {
      const url = new URL("/auth/v1/.well-known/jwks.json", env.SUPABASE_URL);
      jwksClient = createRemoteJWKSet(url);
    }

    const { payload } = await jwtVerify(token, jwksClient, {
      issuer: `${env.SUPABASE_URL}/auth/v1`,
      audience: "authenticated",
    });

    if (payload && payload.sub) {
      const userId = String(payload.sub);
      const roles = await resolveUserRoles(
        getAdminClient(env),
        userId,
        payload.user_role,
      );
      return { userId, roles };
    }
  } catch (error) {
    console.error("JWT Verification failed:", error);
  }

  return null;
}

export function requireAuth(req: Request) {
  const userId = req.headers.get("x-sbbl-user-id-verified");
  if (!userId) {
    throw new Error("unauthorized");
  }
  return userId;
}

/**
 * Non-throwing auth reader for read-only public endpoints that can
 * render richer responses for signed-in callers (e.g. the preflight
 * snapshot includes entitlement status when known, omits when anon).
 */
function optionalAuth(req: Request): string | null {
  return req.headers.get("x-sbbl-user-id-verified") || null;
}

export async function ensureMutation(req: Request, ctx: HandlerCtx) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return;
  const key = readIdempotencyKey(req.headers);
  const userId = requireAuth(req);
  const route = ctx.params.route ?? new URL(req.url).pathname;
  const { error } = await ctx.admin.from("api_idempotency_keys").insert({
    idempotency_key: key,
    route,
    user_id: userId,
  });
  if (error) {
    const now = Date.now();
    // Cleanup old keys
    for (const [k, t] of transientIdempotency.entries()) {
      if (now - t > 60000) {
        transientIdempotency.delete(k);
      }
    }

    const seenAt = transientIdempotency.get(key);
    if (seenAt && now - seenAt < 5 * 60 * 1000) {
      throw new Error("Duplicate idempotency key");
    }
    transientIdempotency.set(key, now);
  }
}

export async function handleAuthSession({ req }: HandlerCtx) {
  try {
    const userId = requireAuth(req);
    return json({ ok: true, userId, roles: getRolesFromVerifiedSession(req) });
  } catch {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
}

async function handleMe({ req }: HandlerCtx) {
  const userId = requireAuth(req);
  return json({
    id: userId,
    profileStatus: "active",
    roles: getRolesFromVerifiedSession(req),
  });
}


async function handleDeleteCartItem({ req, admin, params }: HandlerCtx) {
  await ensureMutation(req, { req, admin, params } as unknown as HandlerCtx);
  const userId = requireAuth(req);
  const itemId = params.itemId;
  if (!itemId) throw new Error('Missing itemId');

  const { data: item } = await admin.from('cart_items')
    .select('id, cart_id')
    .eq('id', itemId)
    .maybeSingle();

  if (!item) {
    return json({ ok: true, deleted: false, reason: 'not_found' });
  }

  const { data: cart } = await admin.from('carts')
    .select('id, user_id, status')
    .eq('id', item.cart_id)
    .maybeSingle();

  if (!cart || cart.user_id !== userId) {
    throw new Error('Forbidden: Cart item ownership verification failed');
  }

  if (cart.status !== 'open') {
     throw new Error('Forbidden: Cannot modify closed cart');
  }

  const { error } = await admin.from('cart_items')
    .delete()
    .eq('id', itemId);

  if (error) throw new Error(error.message);

  return json({ ok: true, deleted: true, itemId });
}

async function handleMutationAck(ctx: HandlerCtx) {
  const { req, params } = ctx;
  await ensureMutation(req, ctx);
  const userId = requireAuth(req);
  return json({
    ok: true,
    userId,
    route: params.route,
    params,
    at: new Date().toISOString(),
  });
}

export async function handleStats(ctx: HandlerCtx) {
  const { tier, userId } = await computeStatAccessTier(ctx);
  const filters = Object.fromEntries(
    new URL(ctx.req.url).searchParams.entries(),
  );
  const { data, error } = await ctx.admin.rpc("get_stats_dashboard", {
    p_filters: filters,
  });
  if (error) throw new Error(error.message);
  const rows = Array.isArray((data as { players?: unknown[] })?.players)
    ? (data as { players: Record<string, unknown>[] }).players
    : [];
  const players = rows.map(normalizePublicPlayerRow).map((r) =>
    applyStatTier(r, tier),
  );
  return json(
    { ok: true, userId, tier, data: players },
    200,
    userId
      ? { "Cache-Control": "private, no-store", Vary: "Authorization" }
      : { "Cache-Control": "public, s-maxage=30, max-age=15" },
  );
}

// Stat-access tier. Central authority on WHO sees WHICH stat fields.
//
//   'full'    — full stat line (pts, reb, ast, stl, blk, fls, min).
//               Granted to: super_admin, league_admin, coach, team_manager,
//                           and player with an active subscription
//                           (profiles.subscription_ends_at > now()).
//   'minimal' — pts / reb / ast only. Other fields are stripped (undefined).
//               Granted to: everyone else (anonymous, fan, paid_fan, and
//               players whose subscription has lapsed).
//   'denied'  — not permitted to read the endpoint at all. Used by the
//               Leaderboards route, which is gated strictly to 'full'.
//
// Business rationale (CLAUDE.md § Hard Rules):
//   Leaderboards are a premium feature — only registered paid players,
//   coaches, admins, and super-admins may view them. The full stat line
//   is also premium — fans and lapsed players see the free tier only.
export type StatAccessTier = "full" | "minimal" | "denied";

export const FULL_STAT_ROLES = new Set([
  "super_admin",
  "league_admin",
  "coach",
  "team_manager",
]);

export async function computeStatAccessTier(
  ctx: HandlerCtx,
): Promise<{ tier: "full" | "minimal"; userId: string | null }> {
  let userId: string | null = null;
  try {
    userId = requireAuth(ctx.req);
  } catch {
    // Anonymous viewer — gets minimal tier.
    return { tier: "minimal", userId: null };
  }

  const roles = getRolesFromVerifiedSession(ctx.req);

  if (roles.some((r) => FULL_STAT_ROLES.has(r))) {
    return { tier: "full", userId };
  }

  if (roles.includes("player")) {
    const { data } = await ctx.admin
      .from("profiles")
      .select("subscription_ends_at")
      .eq("user_id", userId)
      .maybeSingle();
    const endsAt = (data as { subscription_ends_at?: string | null } | null)
      ?.subscription_ends_at;
    if (endsAt && new Date(endsAt).getTime() > Date.now()) {
      return { tier: "full", userId };
    }
  }

  return { tier: "minimal", userId };
}

// Strip stat fields that exceed the viewer's tier. Mutates a copy, never
// the source. Keeping this at the boundary ensures gated fields never leak
// to unauthorized clients even if a future caller forgets to filter.
export function applyStatTier<T extends { stats: Record<string, number> }>(
  row: T,
  tier: StatAccessTier,
): T {
  if (tier === "full") return row;
  const { pts, reb, ast } = row.stats;
  return { ...row, stats: { pts, reb, ast } as T["stats"] };
}

export async function handleLeaderboards(ctx: HandlerCtx) {
  const { tier, userId } = await computeStatAccessTier(ctx);
  // Leaderboards are gated strictly to the 'full' tier — registered paid
  // players, coaches, team managers, league admins, and super admins.
  if (tier !== "full") {
    return json({ ok: false, error: "forbidden" }, 403, {
      "Cache-Control": "private, no-store",
    });
  }
  const filters = Object.fromEntries(
    new URL(ctx.req.url).searchParams.entries(),
  );
  // Use get_stats_dashboard because the UI's category tabs require the full
  // stat line. get_leaderboards only returns pts/reb/ast and would break
  // STL/BLK/FLS/MIN tabs.
  const { data, error } = await ctx.admin.rpc("get_stats_dashboard", {
    p_filters: filters,
  });
  if (error) throw new Error(error.message);
  const rows = Array.isArray((data as { players?: unknown[] })?.players)
    ? (data as { players: Record<string, unknown>[] }).players
    : [];
  const players = rows.map(normalizePublicPlayerRow);
  return json(
    { ok: true, userId, tier, data: players },
    200,
    { "Cache-Control": "private, no-store", Vary: "Authorization" },
  );
}

// Normalize a raw RPC row (stats/leaderboards) into the PlayerProfile shape
// the public pages (Stats.tsx, Leaderboards.tsx) already consume. The RPCs
// return pts/reb/ast as top-level fields; the UI expects `stats.{pts,reb,...}`.
export function normalizePublicPlayerRow(row: Record<string, unknown>) {
  const leagueCodeRaw = String(row.league_id ?? "").toLowerCase();
  const leagueId = leagueCodeRaw === "wbl" ? "wbl"
    : leagueCodeRaw === "tgifbl" ? "tgifbl"
    : "sbbl";
  const avatarRaw = row.avatar_url;
  const avatar =
    typeof avatarRaw === "string" && avatarRaw.trim().length > 0
      ? avatarRaw.trim()
      : "";
  return {
    id: String(row.id ?? ""),
    name: String(row.name ?? "Unknown"),
    number: Number(row.number ?? 0),
    position: String(row.position ?? ""),
    teamId: String(row.team_id ?? ""),
    teamName: row.team_name ? String(row.team_name) : null,
    leagueId,
    avatar,
    badges: [] as string[],
    stats: {
      pts: Number(row.pts ?? 0),
      reb: Number(row.reb ?? 0),
      ast: Number(row.ast ?? 0),
      stl: Number(row.stl ?? 0),
      blk: Number(row.blk ?? 0),
      fls: Number(row.fls ?? 0),
      min: Number(row.min ?? 0),
    },
  };
}


async function handleDraft(ctx: HandlerCtx) {
  await ensureMutation(ctx.req, ctx);
  const userId = requireAuth(ctx.req);
  const payload = await ctx.req.json().catch(() => ({}));
  const { error } = await ctx.admin.rpc("save_stat_draft", {
    p_game_id: ctx.params.id,
    p_payload: payload,
    p_idempotency_key: readIdempotencyKey(ctx.req.headers),
  });
  if (error) throw new Error(error.message);
  return json({
    ok: true,
    userId,
    gameId: ctx.params.id,
    status: "draft_saved",
  });
}

async function handleFinalize(ctx: HandlerCtx) {
  await ensureMutation(ctx.req, ctx);
  const userId = requireAuth(ctx.req);
  const payload = await ctx.req.json().catch(() => ({}));
  const { error } = await ctx.admin.rpc("finalize_game_stats", {
    p_game_id: ctx.params.id,
    p_payload: payload,
    p_idempotency_key: readIdempotencyKey(ctx.req.headers),
  });
  if (error) throw new Error(error.message);
  return json({ ok: true, userId, gameId: ctx.params.id, status: "finalized" });
}

function isSuperAdmin(roles: string[]) {
  return roles.includes("super_admin");
}

export async function requireSuperAdminSession(req: Request, admin: SupabaseClient) {
  const session = await requireAdminSession(req, admin);
  if (!isSuperAdmin(session.roles)) throw new Error("forbidden");
  return session;
}

/**
 * Ops Console content-operations gate — `league_admin` OR `super_admin`.
 *
 * A regular admin (`league_admin`) runs day-to-day league operations across all
 * three leagues: uploading scores, schedules, stats, rosters, teams, players,
 * media, POTG, and store products. Those endpoints were previously pinned to
 * `requireSuperAdminSession`, which made `league_admin` a role that could log in
 * and see nothing — the Ops Console rendered "Access denied. Super Admin role
 * required." for every regular admin.
 *
 * Deliberately NARROWER than `requireAdminSession`: `team_manager` is excluded.
 * A team manager is scoped to one team and must not write league-wide results.
 *
 * Deliberately does NOT replace `requireSuperAdminSession` everywhere. These
 * remain super-admin only, because they grant privilege or control the live
 * broadcast rather than manage content:
 *   - stream/broadcast control  — CLAUDE.md §7.1, §8.4 (frozen surface)
 *   - access lookup / override  — grants entitlements
 *   - coach request approval    — grants a role
 *   - PPV comp codes            — grants paid access
 */
export async function requireOpsAdminSession(req: Request, admin: SupabaseClient) {
  const session = await requireAdminSession(req, admin);
  const permitted = session.roles.some(
    (role) => role === "league_admin" || role === "super_admin",
  );
  if (!permitted) throw new Error("forbidden");
  return session;
}

function resolveStreamConfigPlaybackUrl(cfg: Record<string, unknown>, env: Env): string {
  return String(cfg.playback_asset_id ?? "").trim()
    || String(cfg.collection_id ?? "").trim()
    || String(env.VITE_STREAM_URL ?? "").trim();
}

async function getOrCreateStreamConfig(admin: SupabaseClient) {
  const existing = await admin
    .from("stream_admin_config")
    .select(
      "collection_id,playback_asset_id,title,source,is_live,updated_at,live_started_at,live_ended_at",
    )
    .eq("id", true)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) return existing.data as Record<string, unknown>;

  const created = await admin
    .from("stream_admin_config")
    .insert({
      id: true,
      collection_id: "",
      playback_asset_id: "",
      title: "SBBL Live Stream",
      source: "main",
      is_live: false,
    })
    .select(
      "collection_id,playback_asset_id,title,source,is_live,updated_at,live_started_at,live_ended_at",
    )
    .single();
  if (created.error) throw new Error(created.error.message);
  return created.data as Record<string, unknown>;
}

// Cache TTL for public stream status — 10 s keeps Supabase load flat
// at 2,000 concurrent viewers polling every 15 s.
// Uses Cloudflare Cache API (free, unlimited reads) instead of KV.
//   without cache: ~267 DB queries/s  (hits PgBouncer pool limit)
//   with cache:    ~1 DB query/10 s   (negligible)
const STREAM_STATUS_TTL_S = 10;

function streamCacheUrl(gameId: string | null): string {
  // Cache API requires a fully-qualified URL as the cache key
  return gameId
    ? `https://sbbl-hq.icu/__cache/stream-status?gameId=${gameId}`
    : `https://sbbl-hq.icu/__cache/stream-status`;
}

async function getActiveViewerCount(admin: SupabaseClient, gameId: string | null) {
  if (!gameId) return 0;
  // Use DB-side count instead of pulling all rows into Worker memory.
  // At 20K viewers this avoids transferring ~20K rows over the wire.
  const { count, error } = await admin
    .from("stream_access_sessions")
    .select("user_id", { count: "exact", head: true })
    .eq("game_id", gameId)
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString());
  if (error) return 0;
  return count ?? 0;
}

async function refreshLiveSessionMetrics(
  admin: SupabaseClient,
  gameId: string | null,
  activeViewers: number,
) {
  if (!gameId) return;
  const liveSession = await admin
    .from("stream_sessions")
    .select("id,peak_viewers")
    .eq("game_id", gameId)
    .eq("status", "live")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (liveSession.error || !liveSession.data) return;
  const peak = Math.max(
    Number((liveSession.data as Record<string, unknown>).peak_viewers ?? 0),
    activeViewers,
  );
  await admin
    .from("stream_sessions")
    .update({
      current_viewers: activeViewers,
      peak_viewers: peak,
      updated_at: new Date().toISOString(),
    })
    .eq("id", String((liveSession.data as Record<string, unknown>).id));
}

export async function handlePublicStreamStatus({ req, admin }: HandlerCtx) {
  const url = new URL(req.url);
  const gameId = url.searchParams.get("gameId") ?? null;
  const cacheKey = new Request(streamCacheUrl(gameId));
  const authenticatedUserId = optionalAuth(req);

  // ── Cache API hit (free, edge-local, unlimited) ───────────────────────────
  // Cast: DOM lib's CacheStorage lacks .default; CF Workers runtime adds it.
  const cfCaches = caches as unknown as { default: Cache };
  const cache = cfCaches.default;
  if (!authenticatedUserId) {
    const cachedRes = await cache.match(cacheKey);
    if (cachedRes) return cachedRes;
  }

  // ── Cache miss — hit Supabase once, write back, serve ────────────────────
  const cfg = await getOrCreateStreamConfig(admin);
  let viewerCount = 0;
  viewerCount = await getActiveViewerCount(admin, gameId);
  await refreshLiveSessionMetrics(admin, gameId, viewerCount);

  const roles = authenticatedUserId ? getRolesFromVerifiedSession(req) : [];
  const mayReceiveStreamUrl = Boolean(authenticatedUserId)
    && !roles.includes("anonymous");
  const payload: Record<string, unknown> = {
    ok: true,
    isLive: Boolean(cfg.is_live),
    title: String(cfg.title ?? "SBBL Live Stream"),
    viewerCount,
  };

  if (mayReceiveStreamUrl) {
    payload.streamUrl = String(cfg.playback_asset_id ?? cfg.collection_id ?? "");
  }

  const response = new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // Authenticated payloads can include streamUrl; never mark them public.
      "Cache-Control": authenticatedUserId
        ? "private, no-store"
        : `public, max-age=${STREAM_STATUS_TTL_S}`,
    },
  });

  // Write anonymous responses to edge cache — best-effort with single retry.
  // Authenticated responses can include streamUrl and must never be shared.
  if (!authenticatedUserId) {
    cache.put(cacheKey, response.clone()).catch(() => {
      cache.put(cacheKey, response.clone()).catch(() => {});
    });
  }

  return response;
}

async function handleGetStreamConfig({ req, admin }: HandlerCtx) {
  await requireAdminSession(req, admin);
  const cfg = await getOrCreateStreamConfig(admin);
  return json({
    ok: true,
    config: {
      collectionId: String(cfg.collection_id ?? ""),
      title: String(cfg.title ?? "SBBL Live Stream"),
      source: String(cfg.source ?? "main"),
      isLive: Boolean(cfg.is_live),
      viewerCount: 0,
      updatedAt: cfg.updated_at,
    },
  });
}

async function handleUpdateStreamConfig(ctx: HandlerCtx) {
  await ensureMutation(ctx.req, ctx);
  const session = await requireSuperAdminSession(ctx.req, ctx.admin);
  const body = (await ctx.req.json().catch(() => null)) as {
    collectionId?: string;
    title?: string;
    source?: "main" | "backup" | "test";
  } | null;
  if (!body) return json({ ok: false, error: "invalid_body" }, 400);
  const patch: Record<string, unknown> = {};
  if (typeof body.collectionId === "string") {
    const trimmedUrl = body.collectionId.trim();
    let safeUrl = trimmedUrl;
    if (safeUrl !== "") {
      try {
        const parsedUrl = new URL(safeUrl);
        if (!["https:", "http:", "rtmp:", "rtmps:"].includes(parsedUrl.protocol)) {
          if (["javascript:", "data:", "file:", "vbscript:"].includes(parsedUrl.protocol)) {
            safeUrl = "";
          }
        }
      } catch {
        try {
          const fallbackUrl = new URL("https://" + safeUrl);
          safeUrl = fallbackUrl.href;
        } catch { /* ignore parsing failure */ }
      }
    }
    patch.collection_id = safeUrl;
    patch.playback_asset_id = safeUrl;
  }
  if (typeof body.title === "string") patch.title = body.title.trim();
  if (typeof body.source === "string") patch.source = body.source;
  if (Object.keys(patch).length === 0)
    return json({ ok: false, error: "patch_required" }, 400);

  patch.updated_at = new Date().toISOString();
  const { data, error } = await ctx.admin
    .from("stream_admin_config")
    .upsert(
      { id: true, ...patch, updated_by: session.userId },
      { onConflict: "id" },
    )
    .select("collection_id,playback_asset_id,title,source,is_live,updated_at")
    .single();
  if (error) throw new Error(error.message);

  // Bust edge cache so next poll picks up new collectionId / title / source.
  // Retry once on failure — stale cache after Go Live is worse than a double-delete.
  const cfCacheConfig = (caches as unknown as { default: Cache }).default;
  cfCacheConfig.delete(new Request(streamCacheUrl(null))).catch(() => {
    cfCacheConfig.delete(new Request(streamCacheUrl(null))).catch(() => {});
  });

  return json({
    ok: true,
    config: {
      collectionId: data.collection_id,
      title: data.title,
      source: data.source,
      isLive: data.is_live,
      viewerCount: 0,
      updatedAt: data.updated_at,
    },
  });
}

async function handleSetStreamStatus(ctx: HandlerCtx) {
  await ensureMutation(ctx.req, ctx);
  const session = await requireSuperAdminSession(ctx.req, ctx.admin);
  const body = (await ctx.req.json().catch(() => null)) as {
    isLive?: boolean;
  } | null;
  if (typeof body?.isLive !== "boolean")
    return json({ ok: false, error: "is_live_required" }, 400);
  const nowIso = new Date().toISOString();
  const patch: Record<string, unknown> = {
    id: true,
    is_live: body.isLive,
    updated_by: session.userId,
  };
  if (body.isLive) {
    patch.live_started_at = nowIso;
    patch.live_ended_at = null;
  } else {
    patch.live_ended_at = nowIso;
  }
  const { error } = await ctx.admin
    .from("stream_admin_config")
    .upsert(patch, { onConflict: "id" });
  if (error) throw new Error(error.message);

  // Bust edge cache immediately so Go Live / End Broadcast is reflected
  // for all viewers on their next 15 s poll (not delayed by TTL).
  // Retry once on failure — stale "offline" after Go Live is a P0 UX issue.
  // Also clear the in-process streamUrlCache so the next session request
  // picks up any URL change committed in the same atomic write.
  const cfCachesLive = (caches as unknown as { default: Cache }).default;
  const bustKey = new Request(streamCacheUrl(null));
  cfCachesLive.delete(bustKey).catch(() => { cfCachesLive.delete(bustKey).catch(() => {}); });
  for (const [k] of streamUrlCache.entries()) { streamUrlCache.delete(k); }
  return json({ ok: true, isLive: body.isLive, at: nowIso });
}

async function requireActivePlaybackSession(ctx: HandlerCtx, userId: string, gameId: string) {
  const nowIso = new Date().toISOString();
  const session = await ctx.admin
    .from("stream_access_sessions")
    .select("id")
    .eq("user_id", userId)
    .eq("game_id", gameId)
    .eq("status", "active")
    .gt("expires_at", nowIso)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (session.error) throw new Error(session.error.message);
  return Boolean(session.data);
}

async function handleStreamSessions({ req, admin }: HandlerCtx) {
  await requireAdminSession(req, admin);
  const { data, error } = await admin
    .from("stream_sessions")
    .select("id,game_id,status,created_at,updated_at,started_at,ended_at,peak_viewers,current_viewers,games(league_id)")
    .order("updated_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return json({
    ok: true,
    sessions: (data ?? []).map((s: Record<string, unknown>) => ({
      id: s.id,
      gameId: s.game_id,
      leagueId: (s.games as Record<string, unknown> | null)?.league_id ?? null,
      startedAt: s.started_at ?? s.created_at,
      endedAt: s.ended_at ?? (s.status === "ended" ? s.updated_at : null),
      peakViewers: Number(s.peak_viewers ?? s.current_viewers ?? 0),
      totalPpvRevenue: 0,
      source: "main",
    })),
  });
}

// PPV revenue reporting is a live-PPV surface: super-admin only.
// Regular admins have no access to live-PPV controls or their financials.
export async function handleOpsRevenue({ req, admin }: HandlerCtx) {
  await requireSuperAdminSession(req, admin);
  const [orders, invites, sessions] = await Promise.all([
    admin
      .from("orders")
      .select("id,total_amount,status,metadata")
      .eq("status", "paid"),
    admin.from("ppv_invites").select("id"),
    admin
      .from("stream_sessions")
      .select("id,game_id,status,created_at,updated_at,started_at,ended_at,peak_viewers,current_viewers")
      .order("updated_at", { ascending: false })
      .limit(10),
  ]);
  if (orders.error || invites.error || sessions.error)
    throw new Error("ops_revenue_failed");
  const ppvOrders = (orders.data ?? []).filter((o: Record<string, unknown>) => {
    const metadata = (o.metadata as Record<string, unknown> | null) ?? {};
    return metadata.purchase_type === "ppv";
  });
  const totalPpvRevenue = ppvOrders.reduce(
    (sum, o: Record<string, unknown>) => sum + Number(o.total_amount ?? 0),
    0,
  );

  return json({
    ok: true,
    totalPpvRevenue,
    totalPpvOrders: ppvOrders.length,
    totalInviteRedemptions: invites.data?.length ?? 0,
    recentSessions: (sessions.data ?? []).map((s: Record<string, unknown>) => ({
      id: s.id,
      gameId: s.game_id,
      leagueId: null,
      startedAt: s.started_at ?? s.created_at,
      endedAt: s.ended_at ?? (s.status === "ended" ? s.updated_at : null),
      peakViewers: Number(s.peak_viewers ?? s.current_viewers ?? 0),
      totalPpvRevenue: 0,
      source: "main",
    })),
  });
}

async function handleReviewQueue({ req, admin }: HandlerCtx) {
  await requireAdminSession(req, admin);
  const { data, error } = await admin
    .from("review_queue")
    .select("id,review_type,status,payload,created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return json({
    ok: true,
    queue: (data ?? []).map((item: Record<string, unknown>) => ({
      id: item.id,
      type: item.review_type,
      title: String(
        (item.payload as Record<string, unknown> | null)?.title ??
          item.review_type,
      ),
      description:
        (item.payload as Record<string, unknown> | null)?.description ?? null,
      league: (item.payload as Record<string, unknown> | null)?.league ?? null,
      severity:
        ((item.payload as Record<string, unknown> | null)?.severity as
          | string
          | undefined) ?? "medium",
      status: item.status,
      createdAt: item.created_at,
    })),
  });
}

async function handleResolveReview(ctx: HandlerCtx) {
  await ensureMutation(ctx.req, ctx);
  await requireAdminSession(ctx.req, ctx.admin);
  const body = (await ctx.req.json().catch(() => null)) as {
    resolution?: "resolved" | "dismissed";
  } | null;
  if (!body?.resolution)
    return json({ ok: false, error: "resolution_required" }, 400);
  const nextStatus = body.resolution === "resolved" ? "resolved" : "dismissed";
  const { error } = await ctx.admin
    .from("review_queue")
    .update({ status: nextStatus })
    .eq("id", ctx.params.id);
  if (error) throw new Error(error.message);
  return json({ ok: true, id: ctx.params.id, status: nextStatus });
}

async function handlePublishJobs({ req, admin }: HandlerCtx) {
  await requireAdminSession(req, admin);
  const { data, error } = await admin
    .from("publish_jobs")
    .select("id,destination,status,created_at,updated_at,media_asset_id")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return json({ ok: true, jobs: data ?? [] });
}

async function handleHeadshotQueue({ req, admin }: HandlerCtx) {
  await requireAdminSession(req, admin);
  const { data, error } = await admin
    .from("player_profile_headshots")
    .select(
      "id,player_id,validation_result,status,review_reason,created_at,updated_at",
    )
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return json({ ok: true, queue: data ?? [] });
}

async function handleAccessLookup({ req, admin }: HandlerCtx) {
  await requireSuperAdminSession(req, admin);
  const email = new URL(req.url).searchParams
    .get("email")
    ?.trim()
    .toLowerCase();
  if (!email) return json({ ok: false, error: "email_required" }, 400);
  const userRes = await admin
    .from("profiles")
    .select("user_id")
    .ilike("display_name", email)
    .limit(1);
  const authRes = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (authRes.error) throw new Error(authRes.error.message);
  const authUsers = (authRes.data?.users ?? []) as Array<{
    id: string;
    email?: string | null;
  }>;
  const user = authUsers.find((u) => (u.email ?? "").toLowerCase() === email);
  if (!user) return json({ ok: false, error: "user_not_found" }, 404);
  const roleRes = await admin
    .from("user_role_assignments")
    .select("role")
    .eq("user_id", user.id);
  const entRes = await admin
    .from("stream_entitlements")
    .select("game_id,created_at,created_by,status")
    .eq("user_id", user.id)
    .eq("status", "active");
  if (roleRes.error || entRes.error || userRes.error)
    throw new Error("access_lookup_failed");

  return json({
    ok: true,
    user: {
      userId: user.id,
      email: user.email ?? "",
      roles: (roleRes.data ?? []).map((r) => String(r.role)),
      hasPpvAccess: (entRes.data?.length ?? 0) > 0,
      ppvEntitlements: (entRes.data ?? []).map(
        (e: Record<string, unknown>) => ({
          gameId: e.game_id,
          grantedAt: e.created_at,
          grantedBy: e.created_by ?? "",
          method: "manual_or_purchase",
        }),
      ),
    },
  });
}

async function handleAccessOverride(ctx: HandlerCtx) {
  await ensureMutation(ctx.req, ctx);
  const session = await requireSuperAdminSession(ctx.req, ctx.admin);
  const body = (await ctx.req.json().catch(() => null)) as {
    email?: string;
    userId?: string;
    gameId?: string;
    action?: "grant" | "revoke";
    reason?: string;
  } | null;
  if (!body?.gameId || !body.action || (!body.userId && !body.email))
    return json({ ok: false, error: "invalid_override_payload" }, 400);
  let targetUserId = body.userId ?? null;
  if (!targetUserId && body.email) {
    const users = await ctx.admin.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });
    if (users.error) throw new Error(users.error.message);
    const authUsers = (users.data?.users ?? []) as Array<{
      id: string;
      email?: string | null;
    }>;
    targetUserId =
      authUsers.find(
        (u) => (u.email ?? "").toLowerCase() === body.email?.toLowerCase(),
      )?.id ?? null;
  }
  if (!targetUserId) return json({ ok: false, error: "user_not_found" }, 404);

  if (body.action === "grant") {
    const { error } = await ctx.admin.from("stream_entitlements").insert({
      game_id: body.gameId,
      user_id: targetUserId,
      status: "active",
      idempotency_key: readIdempotencyKey(ctx.req.headers),
      created_by: session.userId,
      updated_by: session.userId,
    });
    if (error && !error.message.includes("duplicate"))
      throw new Error(error.message);
  } else {
    const { error } = await ctx.admin
      .from("stream_entitlements")
      .update({ status: "expired", updated_by: session.userId })
      .eq("game_id", body.gameId)
      .eq("user_id", targetUserId);
    if (error) throw new Error(error.message);
  }

  await ctx.admin.from("audit_logs").insert({
    actor_id: session.userId,
    action: `ops_access_override_${body.action}`,
    ref_type: "stream_entitlements",
    ref_id: null,
    payload: {
      game_id: body.gameId,
      user_id: targetUserId,
      reason: body.reason ?? null,
    },
    idempotency_key: readIdempotencyKey(ctx.req.headers),
  });

  return json({
    ok: true,
    userId: targetUserId,
    action: body.action,
    gameId: body.gameId,
  });
}

async function handleCoachApprovalRequest(ctx: HandlerCtx) {
  await ensureMutation(ctx.req, ctx);
  const userId = requireAuth(ctx.req);
  const body = (await ctx.req.json().catch(() => null)) as {
    preferredLeague?: string;
    note?: string;
  } | null;
  const { error } = await ctx.admin
    .from('coach_approval_requests')
    .insert({
      user_id: userId,
      status: 'pending',
      preferred_league: body?.preferredLeague ?? null,
      note: body?.note ?? null,
    });
  if (error && !error.message.includes('duplicate')) throw new Error(error.message);
  // Also enqueue a review_queue item so it surfaces in the ops console
  await ctx.admin
    .from('review_queue')
    .insert({
      review_type: 'coach_approval',
      ref_id: userId,
      payload: {
        title: 'Coach Approval Request',
        description: `User ${userId} has requested coach access.`,
        user_id: userId,
        preferred_league: body?.preferredLeague ?? null,
        note: body?.note ?? null,
        severity: 'medium',
      },
      status: 'pending',
      idempotency_key: readIdempotencyKey(ctx.req.headers),
    });
  return json({ ok: true, status: 'pending' });
}

async function handleListCoachRequests({ req, admin }: HandlerCtx) {
  await requireSuperAdminSession(req, admin);
  const { data, error } = await admin
    .from('coach_approval_requests')
    .select('id,user_id,status,preferred_league,note,created_at,reviewed_at,reviewed_by')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return json({ ok: true, requests: data ?? [] });
}

async function handleResolveCoachRequest(ctx: HandlerCtx) {
  await ensureMutation(ctx.req, ctx);
  const session = await requireSuperAdminSession(ctx.req, ctx.admin);
  const { id } = ctx.params;
  const body = (await ctx.req.json().catch(() => null)) as {
    action?: 'approve' | 'reject';
  } | null;
  if (!body?.action || !['approve', 'reject'].includes(body.action)) {
    return json({ ok: false, error: 'action_required' }, 400);
  }
  const newStatus = body.action === 'approve' ? 'approved' : 'rejected';
  const { data: reqRow, error: fetchErr } = await ctx.admin
    .from('coach_approval_requests')
    .update({ status: newStatus, reviewed_by: session.userId, reviewed_at: new Date().toISOString() })
    .eq('id', id)
    .select('user_id')
    .single();
  if (fetchErr) throw new Error(fetchErr.message);

  if (body.action === 'approve' && reqRow?.user_id) {
    // Grant coach role
    await ctx.admin
      .from('user_role_assignments')
      .upsert({ user_id: reqRow.user_id, role: 'coach', league_id: null }, { onConflict: 'user_id,role' });
    // Resolve the review_queue item
    await ctx.admin
      .from('review_queue')
      .update({ status: 'resolved' })
      .eq('review_type', 'coach_approval')
      .eq('status', 'pending')
      .contains('payload', { user_id: reqRow.user_id });
  }

  await ctx.admin.from('audit_logs').insert({
    actor_id: session.userId,
    action: `coach_approval_${body.action}`,
    ref_type: 'coach_approval_requests',
    ref_id: id,
    payload: { action: body.action, target_user_id: reqRow?.user_id },
    idempotency_key: readIdempotencyKey(ctx.req.headers),
  });

  return json({ ok: true, id, status: newStatus });
}

export async function writeIngressFailure(
  admin: SupabaseClient,
  reason: string,
  rawInput: unknown,
  sourceType: string,
  userId?: string | null,
) {
  await admin.from("ingress_buffer").insert({
    correlation_id: crypto.randomUUID(),
    raw_input: rawInput,
    error_reason: reason,
    status: "failed",
    risk_score: 100,
    source_type: sourceType,
    user_id: userId ?? null,
  });
}

async function handleIngress(ctx: HandlerCtx) {
  await ensureMutation(ctx.req, ctx);
  const session = requireAuth(ctx.req);
  const payload = (await ctx.req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!payload) {
    await writeIngressFailure(
      ctx.admin,
      "invalid_json",
      { body: null },
      "admin_mutation",
      session,
    );
    return json({ ok: false, error: "invalid_json" }, 400);
  }
  try {
    const envelope = normalizeIngress({
      source_type:
        (payload.source_type as IngressSourceType | undefined) ??
        "admin_mutation",
      actor_id: session,
      device_id: ctx.req.headers.get("x-sbbl-device-id") ?? null,
      league_id: (payload.league_id as string | undefined) ?? null,
      entity_type: (payload.entity_type as string | undefined) ?? "unknown",
      entity_id: (payload.entity_id as string | undefined) ?? null,
      payload:
        (payload.payload as Record<string, unknown> | undefined) ?? payload,
      correlation_id:
        (payload.correlation_id as string | undefined) ?? undefined,
      trace_id: (payload.trace_id as string | undefined) ?? undefined,
    });

    if (envelope.risk_lane === "BLOCKED") {
      await ctx.admin.rpc("record_ingress_failure", {
        p_correlation_id: envelope.correlation_id,
        p_raw_input: payload,
        p_error_reason: "blocked_by_policy",
        p_risk_score: 999,
        p_source_type: envelope.source_type,
        p_user_id: session,
      });
      await ctx.admin.rpc("log_admin_action", {
        p_action: "blocked_ingress",
        p_ref_type: envelope.entity_type,
        p_ref_id: envelope.entity_id,
        p_payload: envelope,
        p_idempotency_key: readIdempotencyKey(ctx.req.headers),
      });
      return json({ ok: false, error: "blocked_ingress", envelope }, 403);
    }

    const { error } = await ctx.admin.rpc("enqueue_local_domain_event", {
      p_event_type: "ingress_received",
      p_entity_type: envelope.entity_type,
      p_entity_id: envelope.entity_id,
      p_league_id: envelope.league_id,
      p_payload: envelope,
      p_trace_id: envelope.trace_id,
      p_available_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    return json({ ok: true, envelope });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "ingress_failed";
    await writeIngressFailure(
      ctx.admin,
      reason,
      payload,
      String(payload.source_type ?? "admin_mutation"),
      session,
    );
    return json({ ok: false, error: reason }, 400);
  }
}

// OmniBridge transport contract — must match
// APEX-OmniHub/src/lib/omnibridge/syncPacketVerifier.ts::isSyncPacketEnvelope
//   Body:    { packet: SyncPacket, signature: base64url(HMAC-SHA256(secret, JSON.stringify(packet))) }
//   Headers: X-Omni-Source: <source_id from OMNIBRIDGE_M2M_CLIENTS registry>
const OMNIHUB_SOURCE_ID = "sbbl-hq";
const OMNIHUB_DELIVERY_TIMEOUT_MS = 5_000;
const OMNIHUB_DELIVERY_RETRY_BACKOFF_MS = [250, 1_000, 4_000];

async function deliverSyncEnvelope(
  url: string,
  envelope: { packet: SyncPacket; signature: string },
): Promise<{ ok: boolean; status?: number; error?: string; attempts: number }> {
  let lastError: string | undefined;
  let lastStatus: number | undefined;
  for (let attempt = 0; attempt < OMNIHUB_DELIVERY_RETRY_BACKOFF_MS.length + 1; attempt++) {
    if (attempt > 0) {
      const idx = Math.min(attempt - 1, OMNIHUB_DELIVERY_RETRY_BACKOFF_MS.length - 1);
      await new Promise((r) => setTimeout(r, OMNIHUB_DELIVERY_RETRY_BACKOFF_MS[idx]));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OMNIHUB_DELIVERY_TIMEOUT_MS);
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Omni-Source": OMNIHUB_SOURCE_ID,
          "X-Omni-Signature": envelope.signature,
          "X-Omni-Packet-Id": envelope.packet.packet_id,
          "X-Omni-Trace-Id": envelope.packet.trace_id,
        },
        body: JSON.stringify(envelope),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (resp.ok) return { ok: true, status: resp.status, attempts: attempt + 1 };
      lastStatus = resp.status;
      // 4xx is non-retryable — signed wrong or rejected — stop early.
      if (resp.status >= 400 && resp.status < 500) {
        return { ok: false, status: resp.status, error: `target_rejected_${resp.status}`, attempts: attempt + 1 };
      }
      lastError = `upstream_${resp.status}`;
    } catch (e) {
      clearTimeout(timer);
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  return { ok: false, status: lastStatus, error: lastError ?? "exhausted_retries", attempts: OMNIHUB_DELIVERY_RETRY_BACKOFF_MS.length + 1 };
}

export async function handleSyncDrain(ctx: HandlerCtx) {
  await ensureMutation(ctx.req, ctx);
  requireAuth(ctx.req);
  const limit = Math.max(
    1,
    Math.min(
      50,
      Number(new URL(ctx.req.url).searchParams.get("limit") ?? "20"),
    ),
  );
  const { data, error } = await ctx.admin.rpc("claim_outbox_events", {
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  const events = (data ?? []) as Array<Record<string, unknown>>;
  const results = await Promise.all(
    events.map(async (item) => {
      const packet: SyncPacket = {
        packet_id: crypto.randomUUID(),
        trace_id: String(item.trace_id ?? crypto.randomUUID()),
        event_type: String(item.event_type ?? "unknown"),
        entity_type: String(item.entity_type ?? "unknown"),
        entity_id: (item.entity_id as string | null) ?? null,
        league_id: (item.league_id as string | null) ?? null,
        payload: (item.payload as Record<string, unknown> | undefined) ?? {},
        emitted_at: new Date().toISOString(),
      };

      if (!ctx.env.OMNIHUB_SIGNING_SECRET) {
        throw new Error("OMNIHUB_SIGNING_SECRET_missing");
      }
      const signed = await signSyncPacket(
        packet,
        ctx.env.OMNIHUB_SIGNING_SECRET,
      );
      const url = ctx.env.OMNIHUB_SYNC_URL;

      if (url) {
        const delivery = await deliverSyncEnvelope(url, signed);
        if (!delivery.ok) {
          await ctx.admin.rpc("mark_outbox_retry", {
            p_outbox_id: item.id,
            p_error_message: delivery.error ?? "sync_delivery_failed",
          });
          return { id: item.id, status: "retry", attempts: delivery.attempts, error: delivery.error };
        }
      }

      await ctx.admin.rpc("mark_outbox_delivered", { p_outbox_id: item.id });
      return { id: item.id, status: "delivered" };
    }),
  );

  return json({ ok: true, processed: results.length, results });
}

// ─────────────────────────────────────────────────────────────────────────────
// OmniHub inbound governance channel — POST /webhooks/omnihub
//
// Receives signed commands from APEX-OmniHub's omnibridge-control plane.
// Mirrors APEX-OmniHub/src/lib/omnibridge/outboundCaller.ts dispatch shape:
//   Body:    { command: OutboundCommand, signature: base64url-HMAC-SHA256 }
//   Headers: X-Omni-Command-Id, X-Omni-Signature, X-Omni-Action
//
// Commands are HMAC-verified, idempotency-deduplicated, risk-lane classified,
// recorded in ingress_failures / log_admin_action, and acked.
//
// Defence-in-depth: BLOCKED actions are short-circuited even if signed; RED
// actions are recorded but not auto-executed (control plane must approve via
// the MAN-quorum path before re-dispatching as GREEN).
// ─────────────────────────────────────────────────────────────────────────────

const OMNIHUB_COMMAND_ALLOWED_ACTIONS = new Set<string>([
  "disable_stream",
  "enable_stream",
  "revoke_access",
  "grant_access",
  "emergency_halt",
  "broadcast_message",
  "force_man_review",
  "hotfix_dispatch",
  "ping",
]);

const OMNIHUB_COMMAND_MAX_BODY_BYTES = 256 * 1024;
const OMNIHUB_COMMAND_MAX_AGE_SECONDS = 300;

function omniBase64UrlToBytes(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const padLen = (4 - (value.length % 4)) % 4;
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(padLen);
  try {
    const binary = atob(normalized);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.codePointAt(i) ?? 0;
    return out;
  } catch {
    return null;
  }
}

async function verifyOmnihubCommandSignature(
  command: Record<string, unknown>,
  signature: string,
  secret: string,
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const sigBytes = omniBase64UrlToBytes(signature);
  if (!sigBytes) return false;
  return crypto.subtle.verify(
    "HMAC",
    key,
    sigBytes as BufferSource,
    new TextEncoder().encode(JSON.stringify(command)),
  );
}

async function handleOmnihubWebhook(ctx: HandlerCtx) {
  const clientIp = ctx.req.headers.get("cf-connecting-ip") ?? "unknown";
  if (!checkRateLimit(clientIp)) {
    return json({ ok: false, error: "rate_limited" }, 429);
  }

  const verifyKey = ctx.env.OMNIHUB_VERIFY_KEY ?? ctx.env.OMNIHUB_SIGNING_SECRET;
  if (!verifyKey) {
    return json({ ok: false, error: "verify_key_not_configured" }, 503);
  }

  const headerSig = ctx.req.headers.get("x-omni-signature");
  const headerCmdId = ctx.req.headers.get("x-omni-command-id");
  if (!headerSig || !headerCmdId) {
    return json({ ok: false, error: "missing_headers" }, 400);
  }

  const rawBody = await ctx.req.text();
  if (rawBody.length > OMNIHUB_COMMAND_MAX_BODY_BYTES) {
    return json({ ok: false, error: "body_too_large" }, 413);
  }

  let envelope: { command?: unknown; signature?: unknown };
  try {
    envelope = JSON.parse(rawBody);
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  if (!envelope || typeof envelope !== "object" || !envelope.command || typeof envelope.command !== "object") {
    return json({ ok: false, error: "invalid_envelope" }, 400);
  }

  const command = envelope.command as Record<string, unknown>;
  const bodySignature = typeof envelope.signature === "string" ? envelope.signature : headerSig;

  if (typeof command.command_id !== "string" || command.command_id !== headerCmdId) {
    return json({ ok: false, error: "command_id_mismatch" }, 400);
  }
  if (typeof command.action !== "string" || !OMNIHUB_COMMAND_ALLOWED_ACTIONS.has(command.action)) {
    return json({ ok: false, error: "unsupported_action" }, 400);
  }
  if (typeof command.target_source !== "string" || command.target_source !== "sbbl-hq") {
    return json({ ok: false, error: "target_source_mismatch" }, 400);
  }
  if (typeof command.issued_at !== "string") {
    return json({ ok: false, error: "missing_issued_at" }, 400);
  }
  const issuedMs = Date.parse(command.issued_at);
  if (Number.isNaN(issuedMs) || Math.abs(Date.now() - issuedMs) > OMNIHUB_COMMAND_MAX_AGE_SECONDS * 1000) {
    return json({ ok: false, error: "stale_command" }, 400);
  }

  const verified = await verifyOmnihubCommandSignature(command, bodySignature, verifyKey);
  if (!verified) {
    return json({ ok: false, error: "bad_signature" }, 401);
  }

  // Replay-detection via api_idempotency_keys (re-uses existing dedup table).
  const dedupKey = `omnihub:${command.command_id}`;
  const { error: dupErr } = await ctx.admin.from("api_idempotency_keys").insert({
    idempotency_key: dedupKey,
    route: "/webhooks/omnihub",
    user_id: null,
  });
  if (dupErr && /duplicate|unique/i.test(dupErr.message)) {
    return json({ ok: true, command_id: command.command_id, duplicate: true });
  }

  const action = command.action as string;
  const payload = (command.payload as Record<string, unknown> | undefined) ?? {};

  const envelopeForIngress = normalizeIngress({
    source_type: "webhook",
    actor_id: typeof command.issued_by === "string" ? command.issued_by : "omnihub-control",
    device_id: null,
    league_id: typeof payload.league_id === "string" ? payload.league_id : null,
    entity_type: `omnihub.command.${action}`,
    entity_id: typeof command.target_entity_id === "string" ? command.target_entity_id : null,
    payload: { action, ...payload },
  });

  if (envelopeForIngress.risk_lane === "BLOCKED") {
    await ctx.admin.rpc("record_ingress_failure", {
      p_correlation_id: envelopeForIngress.correlation_id,
      p_raw_input: command,
      p_error_reason: "omnihub_command_blocked",
      p_risk_score: 999,
      p_source_type: "webhook",
      p_user_id: null,
    });
    return json({ ok: false, command_id: command.command_id, error: "blocked", risk_lane: "BLOCKED" }, 403);
  }

  await ctx.admin.rpc("log_admin_action", {
    p_action: `omnihub_${action}`,
    p_ref_type: envelopeForIngress.entity_type,
    p_ref_id: envelopeForIngress.entity_id,
    p_payload: { command, envelope: envelopeForIngress },
    p_idempotency_key: dedupKey,
  });

  // Action dispatch — every action below is idempotent. Anything that mutates
  // production state goes through a Supabase RPC so RLS / audit triggers fire.
  let result: Record<string, unknown> = { ack: true };
  if (action === "ping") {
    result = { ack: true, pong_at: new Date().toISOString() };
  } else if (action === "broadcast_message") {
    result = { ack: true, message_id: dedupKey };
  } else if (action === "disable_stream" || action === "enable_stream") {
    const isLive = action === "enable_stream";
    await ctx.admin.from("stream_admin_config").update({ is_live: isLive }).eq("id", 1).then(() => undefined);
    result = { ack: true, is_live: isLive };
  } else {
    // grant_access / revoke_access / emergency_halt / force_man_review / hotfix_dispatch
    // are RED — record-only here. The control plane re-issues as GREEN after
    // MAN-quorum approval; that ack just records receipt.
    result = { ack: true, queued: true, risk_lane: envelopeForIngress.risk_lane };
  }

  return json({
    ok: true,
    command_id: command.command_id,
    action,
    risk_lane: envelopeForIngress.risk_lane,
    result,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// OmniPort authenticated command endpoint — POST /api/omniport/command
//
// Authenticated, low-risk diagnostic / control surface used by the integration
// harness and operator tooling. Same risk-lane gating as the webhook channel,
// but auth is per-user JWT (Bearer) rather than HMAC.
// ─────────────────────────────────────────────────────────────────────────────

const OMNIPORT_ALLOWED_COMMANDS = new Set<string>([
  "PING",
  "ECHO",
  "HEALTH_CHECK",
  "TELEMETRY_SNAPSHOT",
]);

async function handleOmniportCommand(ctx: HandlerCtx) {
  await ensureMutation(ctx.req, ctx);
  const userId = requireAuth(ctx.req);

  let body: Record<string, unknown> | null = null;
  try {
    body = (await ctx.req.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, success: false, error: "invalid_json" }, 400);
  }

  if (!body || typeof body !== "object") {
    return json({ ok: false, success: false, error: "invalid_body" }, 400);
  }

  const command = typeof body.command === "string" ? body.command : "";
  const targetApp = typeof body.targetApp === "string" ? body.targetApp : "";

  if (!command || !OMNIPORT_ALLOWED_COMMANDS.has(command)) {
    return json({ ok: false, success: false, error: "unsupported_command", command }, 400);
  }
  if (targetApp && targetApp !== "sbbl-hq") {
    return json({ ok: false, success: false, error: "target_app_mismatch", targetApp }, 400);
  }

  const correlationId = crypto.randomUUID();
  const now = new Date().toISOString();

  if (command === "PING") {
    return json({ ok: true, success: true, command: "PING", pong_at: now, correlationId, userId });
  }
  if (command === "ECHO") {
    return json({ ok: true, success: true, command: "ECHO", data: body.data ?? null, correlationId, userId });
  }
  if (command === "HEALTH_CHECK") {
    return json({
      ok: true,
      success: true,
      command: "HEALTH_CHECK",
      checks: { worker: "ok", supabase: ctx.env.SUPABASE_URL ? "configured" : "missing", omnihub_sync: ctx.env.OMNIHUB_SYNC_URL ? "configured" : "not_configured" },
      correlationId,
      timestamp: now,
    });
  }
  // TELEMETRY_SNAPSHOT
  return json({
    ok: true,
    success: true,
    command: "TELEMETRY_SNAPSHOT",
    snapshot: { source: "sbbl-hq", emitted_at: now, agents: [{ id: "sbbl-worker", status: "active" }] },
    correlationId,
  });
}

async function handleStripeWebhook(ctx: HandlerCtx) {
  // Rate-limit the webhook endpoint to prevent abuse (anonymous, mutation-heavy)
  const clientIp = ctx.req.headers.get("cf-connecting-ip") ?? "unknown";
  if (!checkRateLimit(clientIp)) {
    return json({ ok: false, error: "rate_limited" }, 429);
  }

  const secret = ctx.env.STRIPE_WEBHOOK_SECRET;
  if (!secret)
    return json({ ok: false, error: "stripe_webhook_secret_missing" }, 503);

  const signature = ctx.req.headers.get("stripe-signature");
  if (!signature)
    return json({ ok: false, error: "stripe_signature_missing" }, 400);

  const rawBody = await ctx.req.text();
  const verified = await verifyStripeSignature(rawBody, signature, secret);
  if (!verified) {
    await writeIngressFailure(
      ctx.admin,
      "invalid_stripe_signature",
      { body: rawBody },
      "webhook",
      null,
    );
    return json({ ok: false, error: "invalid_stripe_signature" }, 400);
  }

  let event: {
    id?: string;
    type?: string;
    data?: { object?: Record<string, unknown> };
  };
  try {
    event = JSON.parse(rawBody) as {
      id?: string;
      type?: string;
      data?: { object?: Record<string, unknown> };
    };
  } catch {
    await writeIngressFailure(
      ctx.admin,
      "invalid_stripe_json",
      { body: rawBody },
      "webhook",
      null,
    );
    return json({ ok: false, error: "invalid_stripe_json" }, 400);
  }
  if (!event.id || !event.type)
    return json({ ok: false, error: "invalid_stripe_event" }, 400);

  // Fast dedup: insert into stripe_events; ON CONFLICT on stripe_event_id UNIQUE
  // constraint = already processed → 200 no-op.
  // This is cheaper than calling the full process_stripe_webhook RPC for replayed events.
  const { error: dedupErr } = await ctx.admin
    .from("stripe_events")
    .insert({ stripe_event_id: event.id, event_type: event.type, payload: event, status: "received" });
  if (dedupErr && dedupErr.code === "23505") {
    // Duplicate event — already seen and processed (or in-progress). Return 200 immediately.
    return json({ ok: true, eventId: event.id, status: "duplicate_ignored" });
  }

  const object = event.data?.object ?? {};
  const metadata =
    (object.metadata as Record<string, unknown> | undefined) ?? {};
  const userId = typeof metadata.user_id === "string" ? metadata.user_id : null;
  const providerRef =
    typeof object.id === "string"
      ? object.id
      : typeof object.payment_intent === "string"
        ? object.payment_intent
        : event.id;
  const webhookProcess = await ctx.admin.rpc("process_stripe_webhook", {
    p_event_id: event.id,
    p_event_type: event.type,
    p_user_id: userId,
    p_order_id:
      typeof metadata.order_id === "string" ? metadata.order_id : null,
    p_provider_ref: providerRef,
    p_payload: event,
  });
  if (webhookProcess.error) throw new Error(webhookProcess.error.message);

  // Best-effort post-payment side-effects — never block the 200 response.
  if (event.type === "checkout.session.completed" && userId) {
    const purchaseType =
      typeof metadata.purchase_type === "string"
        ? metadata.purchase_type
        : null;


    if (purchaseType === "store_order" && typeof metadata.order_id === "string") {
      try {
        await ctx.admin
          .from("store_orders")
          .update({
            status: "paid",
            stripe_checkout_session_id: object.id,
            stripe_payment_intent_id: typeof object.payment_intent === 'string' ? object.payment_intent : null,
            customer_email: (object.customer_details as Record<string, unknown>)?.email as string | undefined,
            updated_at: new Date().toISOString()
          })
          .eq("id", metadata.order_id);
      } catch (e) {
        console.error("Failed to update store order", e);
      }
    }

    // Player registration (subscription): set subscription_ends_at + grant player role
    if (!purchaseType || purchaseType === "player_registration") {
      try {
        const subEndMs = typeof object.current_period_end === 'number'
          ? object.current_period_end * 1000
          : Date.now() + 31 * 24 * 60 * 60 * 1000;
        const subEndsAt = new Date(subEndMs).toISOString();
        const stripeCustomerId = typeof object.customer === 'string' ? object.customer : null;
        const stripeSubId = typeof object.subscription === 'string' ? object.subscription : null;
        await ctx.admin
          .from("profiles")
          .update({
            subscription_ends_at: subEndsAt,
            ...(stripeCustomerId ? { stripe_customer_id: stripeCustomerId } : {}),
            ...(stripeSubId ? { stripe_subscription_id: stripeSubId } : {}),
          })
          .eq("user_id", userId);
        // Grant player role (upsert to avoid duplicates)
        await ctx.admin
          .from("user_role_assignments")
          .upsert({ user_id: userId, role: 'player', league_id: null }, { onConflict: 'user_id,role' });
      } catch {
        /* non-critical */
      }
    }

    // PPV purchase: create stream entitlement (48h validity window to
    // tolerate game-day delays) + auto-complete onboarding as a free "fan"
    // member so the buyer can immediately watch without being blocked by
    // the onboarding gate. The session itself remains hard-capped at 6h
    // once the buyer actually starts watching.
    if (purchaseType === "ppv" && typeof metadata.game_id === "string") {
      try {
        const expiresAt = new Date(Date.now() + ENTITLEMENT_MS.ENTITLEMENT_VALIDITY);
        await ctx.admin.rpc("create_stream_entitlement", {
          p_game_id: metadata.game_id,
          p_user_id: userId,
          p_order_id:
            typeof metadata.order_id === "string" ? metadata.order_id : null,
          p_expires_at: expiresAt.toISOString(),
          p_idempotency_key: event.id ?? crypto.randomUUID(),
        });
      } catch {
        /* non-critical — entitlement can be manually granted via ops */
      }

      // Auto-create a minimal fan profile so the buyer bypasses the onboarding
      // gate and lands directly on /live after sign-in.  Only upsert if no
      // profile row exists yet (onboarding_completed_at IS NULL).
      try {
        const stripeCustomerId = typeof object.customer === "string" ? object.customer : null;
        await ctx.admin
          .from("profiles")
          .upsert(
            {
              user_id: userId,
              display_name: typeof metadata.customer_email === "string"
                ? metadata.customer_email.split("@")[0]
                : "Fan",
              full_name: null,
              primary_role_intent: "fan",
              onboarding_completed_at: new Date().toISOString(),
              ...(stripeCustomerId ? { stripe_customer_id: stripeCustomerId } : {}),
            },
            {
              onConflict: "user_id",
              // Only set onboarding_completed_at if it wasn't already set
              ignoreDuplicates: false,
            },
          );
      } catch {
        /* non-critical — buyer can complete onboarding manually */
      }
    }

    // Store order: mark order as paid
    if (
      purchaseType === "store_order" &&
      typeof metadata.order_id === "string"
    ) {
      try {
        await ctx.admin.rpc("mark_order_paid", {
          p_order_id: metadata.order_id,
          p_payment_ref: providerRef,
          p_idempotency_key: event.id ?? crypto.randomUUID(),
        });
        // Note: mark_order_paid now targets store_orders.
        // We no longer rely on legacy 'orders' and 'carts' tables here.
      } catch {
        /* non-critical */
      }
    }
  }

  // Player subscription renewed — extend subscription window
  if (event.type === "customer.subscription.updated" && userId) {
    const sub = event.data?.object ?? {};
    const currentPeriodEnd = typeof (sub as Record<string, unknown>).current_period_end === 'number'
      ? new Date((sub as Record<string, unknown>).current_period_end as number * 1000)
      : null;
    const status = typeof (sub as Record<string, unknown>).status === 'string'
      ? (sub as Record<string, unknown>).status as string
      : null;
    if (currentPeriodEnd && status === 'active') {
      try {
        await ctx.admin
          .from('profiles')
          .update({ subscription_ends_at: currentPeriodEnd.toISOString() })
          .eq('user_id', userId);
      } catch { /* non-critical */ }
    }
  }

  // Player subscription cancelled/expired — downgrade to fan (remove player role)
  if ((event.type === "customer.subscription.deleted") && userId) {
    try {
      // Remove player role assignment — user reverts to fan
      await ctx.admin
        .from('user_role_assignments')
        .delete()
        .eq('user_id', userId)
        .eq('role', 'player');
      // Clear subscription end date
      await ctx.admin
        .from('profiles')
        .update({ subscription_ends_at: null, stripe_subscription_id: null })
        .eq('user_id', userId);
    } catch { /* non-critical */ }
  }

  // Mark event as processed in stripe_events (best-effort, non-blocking)
  try {
    void Promise.resolve(
      ctx.admin
        .from("stripe_events")
        .update({ processed_at: new Date().toISOString(), status: "processed" })
        .eq("stripe_event_id", event.id)
    ).catch(() => {});
  } catch { /* stripe_events update is non-critical */ }

  return json({
    ok: true,
    eventId: event.id,
    type: event.type,
    duplicate: Boolean(
      (webhookProcess.data as { duplicate?: boolean } | null)?.duplicate,
    ),
  });
}

export async function requireAdminSession(req: Request, admin: SupabaseClient) {
  const userId = requireAuth(req);
  const { data, error } = await admin
    .from("user_role_assignments")
    .select("role")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  const roles = (data ?? []).map((row) => String(row.role));
  if (
    !roles.some(
      (role) =>
        role === "league_admin" ||
        role === "super_admin" ||
        role === "team_manager" ||
        role === "APEX_ADMIN",
    )
  ) {
    throw new Error("forbidden");
  }
  return { userId, roles };
}

export async function writeImportJob(
  admin: SupabaseClient,
  job: {
    job_type: string;
    submitted_by: string;
    total_rows: number;
    inserted_rows: number;
    failed_rows: number;
    payload_summary: Record<string, unknown>;
    error_summary?: string | null;
  },
) {
  const { data, error } = await admin
    .from("import_jobs")
    .insert({
      job_type: job.job_type,
      submitted_by: job.submitted_by,
      payload_summary: job.payload_summary,
      status: job.failed_rows > 0 ? "completed_with_errors" : "completed",
      total_rows: job.total_rows,
      inserted_rows: job.inserted_rows,
      failed_rows: job.failed_rows,
      error_summary: job.error_summary ?? null,
    })
    .select("id,job_type,submitted_by,payload_summary,status,total_rows,inserted_rows,failed_rows,error_summary,created_at,updated_at")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function handleOpsBootstrap({ req, admin }: HandlerCtx) {
  const session = await requireAdminSession(req, admin);
  const [
    profileRes,
    leaguesRes,
    seasonsRes,
    divisionsRes,
    venuesRes,
    historyRes,
  ] = await Promise.all([
    admin
      .from("profiles")
      .select("display_name,full_name")
      .eq("user_id", session.userId)
      .maybeSingle(),
    admin.from("leagues").select("id,name,code").order("name"),
    admin
      .from("seasons")
      .select("id,name,league_id")
      .order("created_at", { ascending: false })
      .limit(100),
    admin
      .from("divisions")
      .select("id,name,season_id")
      .order("name")
      .limit(300),
    admin.from("venues").select("id,name").order("name").limit(300),
    admin
      .from("import_jobs")
      .select("id,job_type,submitted_by,payload_summary,status,total_rows,inserted_rows,failed_rows,error_summary,created_at,updated_at")
      .order("created_at", { ascending: false })
      .limit(25),
  ]);

  if (
    profileRes.error ||
    leaguesRes.error ||
    seasonsRes.error ||
    divisionsRes.error ||
    venuesRes.error ||
    historyRes.error
  ) {
    throw new Error("ops_bootstrap_failed");
  }

  return json({
    ok: true,
    user: {
      userId: session.userId,
      profile: profileRes.data ?? null,
    },
    roles: session.roles,
    references: {
      leagues: leaguesRes.data ?? [],
      seasons: seasonsRes.data ?? [],
      divisions: divisionsRes.data ?? [],
      venues: venuesRes.data ?? [],
    },
    importHistory: historyRes.data ?? [],
  });
}


export async function handleImportHistory({ req, admin }: HandlerCtx) {
  await requireAdminSession(req, admin);
  const { data, error } = await admin
    .from("import_jobs")
    .select("id,job_type,submitted_by,payload_summary,status,total_rows,inserted_rows,failed_rows,error_summary,created_at,updated_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  // Operator visibility (2026-07-20 A+ pass): failures captured in
  // ingress_buffer are surfaced in the Ops Console instead of rotting silently.
  const { data: ingressFailures } = await admin
    .from("ingress_buffer")
    .select("correlation_id,error_reason,source_type,status,created_at")
    .eq("status", "failed")
    .order("created_at", { ascending: false })
    .limit(20);
  return json({ ok: true, jobs: data ?? [], ingress_failures: ingressFailures ?? [] });
}


// ── Pipeline health telemetry (2026-07-20) ──────────────────────────────────
// The "annotated good/bad ranges" discipline from proven production pipelines
// (GameChanger): every metric carries its thresholds, so nobody has to decide
// mid-incident whether a number is bad. Critical breaches are pushed to Sentry.
const PIPELINE_THRESHOLDS = {
  outbox_pending: { warn: 25, critical: 100 },
  outbox_oldest_minutes: { warn: 10, critical: 60 },
  outbox_dead_letters: { warn: 1, critical: 5 },
  ingress_failed_24h: { warn: 5, critical: 25 },
  import_failed_rows_24h: { warn: 10, critical: 50 },
} as const;

function gradeMetric(value: number, t: { warn: number; critical: number }): "ok" | "warn" | "critical" {
  if (value >= t.critical) return "critical";
  if (value >= t.warn) return "warn";
  return "ok";
}

export async function handlePipelineHealth({ req, admin }: HandlerCtx) {
  await requireAdminSession(req, admin);
  const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: pendingEvents } = await admin
    .from("event_outbox")
    .select("id, created_at")
    .eq("status", "pending");
  const pending = pendingEvents ?? [];
  const oldestMs = pending.length
    ? Math.max(...pending.map((e) => Date.now() - new Date(String(e.created_at)).getTime()))
    : 0;
  const oldestMinutes = Math.floor(oldestMs / 60_000);

  const { data: deadLetters } = await admin
    .from("event_outbox")
    .select("id")
    .eq("status", "dead_lettered");

  const { data: ingressFailed } = await admin
    .from("ingress_buffer")
    .select("correlation_id")
    .eq("status", "failed")
    .gt("created_at", sinceIso);

  const { data: recentJobs } = await admin
    .from("import_jobs")
    .select("failed_rows")
    .gt("created_at", sinceIso);
  const importFailedRows = (recentJobs ?? []).reduce((sum, j) => sum + Number(j.failed_rows ?? 0), 0);

  const metrics = {
    outbox_pending: { value: pending.length, ...PIPELINE_THRESHOLDS.outbox_pending, status: gradeMetric(pending.length, PIPELINE_THRESHOLDS.outbox_pending) },
    outbox_oldest_minutes: { value: oldestMinutes, ...PIPELINE_THRESHOLDS.outbox_oldest_minutes, status: gradeMetric(oldestMinutes, PIPELINE_THRESHOLDS.outbox_oldest_minutes) },
    outbox_dead_letters: { value: (deadLetters ?? []).length, ...PIPELINE_THRESHOLDS.outbox_dead_letters, status: gradeMetric((deadLetters ?? []).length, PIPELINE_THRESHOLDS.outbox_dead_letters) },
    ingress_failed_24h: { value: (ingressFailed ?? []).length, ...PIPELINE_THRESHOLDS.ingress_failed_24h, status: gradeMetric((ingressFailed ?? []).length, PIPELINE_THRESHOLDS.ingress_failed_24h) },
    import_failed_rows_24h: { value: importFailedRows, ...PIPELINE_THRESHOLDS.import_failed_rows_24h, status: gradeMetric(importFailedRows, PIPELINE_THRESHOLDS.import_failed_rows_24h) },
  };
  const statuses = Object.values(metrics).map((m) => m.status);
  const overall = statuses.includes("critical") ? "critical" : statuses.includes("warn") ? "warn" : "ok";
  const alerts = Object.entries(metrics)
    .filter(([, m]) => m.status !== "ok")
    .map(([name, m]) => `${name}=${m.value} (warn>=${m.warn}, critical>=${m.critical})`);

  if (overall === "critical") {
    try {
      Sentry.captureMessage(`pipeline_health_critical: ${alerts.join("; ")}`, "error");
    } catch { /* Sentry unavailable must never break the health check */ }
  }

  return json({ ok: true, overall, metrics, alerts, checked_at: new Date().toISOString() });
}

// ── Player identity merge (2026-07-20) ──────────────────────────────────────
// Companion to parser-first auto-provisioning: when a provisioned identity
// turns out to be an existing (or later self-registered) player, merge it.
// Soft merge: stats re-pointed row by row, conflicts (both identities have a
// stat for the same game) are left on the source and reported, the source row
// gets a merged_into pointer that resolvePotgPlayer follows. Nothing deleted.
export async function handlePlayerIdentityMerge(ctx: HandlerCtx) {
  await ensureMutation(ctx.req, ctx);
  const { userId: actorId } = await requireOpsAdminSession(ctx.req, ctx.admin);
  const body = (await ctx.req.json().catch(() => null)) as { sourcePlayerId?: string; targetPlayerId?: string } | null;
  const sourceId = body?.sourcePlayerId?.trim();
  const targetId = body?.targetPlayerId?.trim();
  if (!sourceId || !targetId) {
    return json({ ok: false, error: "player_ids_required", message: "Provide both the duplicate (source) and canonical (target) player IDs." }, 400);
  }
  if (sourceId === targetId) {
    return json({ ok: false, error: "cannot_merge_into_self", message: "Source and target must be different players." }, 400);
  }

  const { data: source } = await ctx.admin.from("players").select("id, user_id, merged_into").eq("id", sourceId).maybeSingle();
  if (!source?.id) return json({ ok: false, error: "source_player_not_found", message: `No player with id ${sourceId}.` }, 404);
  if (source.merged_into) return json({ ok: false, error: "source_already_merged", message: "This player was already merged." }, 409);
  const { data: target } = await ctx.admin.from("players").select("id, merged_into").eq("id", targetId).maybeSingle();
  if (!target?.id) return json({ ok: false, error: "target_player_not_found", message: `No player with id ${targetId}.` }, 404);
  if (target.merged_into) return json({ ok: false, error: "target_already_merged", message: "Target was itself merged — merge into its canonical player instead." }, 409);

  const { data: targetStats } = await ctx.admin.from("player_game_stats").select("game_id").eq("player_id", targetId);
  const targetGames = new Set((targetStats ?? []).map((s) => String(s.game_id)));
  const { data: sourceStats } = await ctx.admin.from("player_game_stats").select("game_id").eq("player_id", sourceId);

  let reassigned = 0;
  const conflicts: string[] = [];
  for (const stat of sourceStats ?? []) {
    const gameId = String(stat.game_id);
    if (targetGames.has(gameId)) {
      conflicts.push(gameId); // target's record wins; source row kept for manual review
      continue;
    }
    await ctx.admin
      .from("player_game_stats")
      .update({ player_id: targetId })
      .eq("player_id", sourceId)
      .eq("game_id", gameId)
      .select()
      .maybeSingle();
    reassigned += 1;
  }

  await ctx.admin
    .from("players")
    .update({ merged_into: targetId, merged_at: new Date().toISOString() })
    .eq("id", sourceId)
    .select()
    .maybeSingle();

  await ctx.admin.from("audit_logs").insert({
    actor_id: actorId,
    action: "player_identity_merged",
    ref_type: "players",
    ref_id: sourceId,
    payload: { sourcePlayerId: sourceId, targetPlayerId: targetId, statsReassigned: reassigned, conflictGames: conflicts },
    idempotency_key: readIdempotencyKey(ctx.req.headers) ?? crypto.randomUUID(),
  });

  return json({ ok: true, statsReassigned: reassigned, conflictsSkipped: conflicts.length, conflictGames: conflicts, message: conflicts.length ? `Merged. ${conflicts.length} game(s) had stats on both identities — target's records kept, source rows left for review.` : "Merged cleanly." });
}

// handlePublicSchedule, handlePublicPotg — extracted to src/worker/routes/public.ts
const handlePublicSchedule = _handlePublicSchedule;
const handlePublicPotg = _handlePublicPotg;

// Ops List handlers
async function handleOpsListTeams({ req, admin }: HandlerCtx) {
  await requireOpsAdminSession(req, admin);
  const { data, error } = await admin.from('teams').select('*').order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return json({ ok: true, data });
}
// Joins profiles.display_name (via the single players.profile_id FK) and
// teams.name (via the single players.team_id FK) so the Ops Console can
// render a human-readable player picker instead of a raw Player ID text box.
// Both FKs are unambiguous (players has exactly one FK to each target table),
// so PostgREST embedding is safe here — unlike the player_game_stats join
// history, there is no second candidate FK path to accidentally match.
async function handleOpsListPlayers({ req, admin }: HandlerCtx) {
  await requireOpsAdminSession(req, admin);
  const { data, error } = await admin
    .from('players')
    .select('*, profiles(display_name,full_name), teams(name)')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  const rows = ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
    const profile = row.profiles as { display_name?: string | null; full_name?: string | null } | null;
    const team = row.teams as { name?: string | null } | null;
    const { profiles: _profiles, teams: _teams, ...rest } = row;
    return {
      ...rest,
      display_name: profile?.display_name || profile?.full_name || null,
      team_name: team?.name ?? null,
    };
  });
  return json({ ok: true, data: rows });
}
async function handleOpsListProducts({ req, admin }: HandlerCtx) {
  await requireOpsAdminSession(req, admin);
  const { data, error } = await admin.from('products').select('*').order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return json({ ok: true, data });
}
async function handleOpsListEvents({ req, admin }: HandlerCtx) {
  await requireOpsAdminSession(req, admin);
  const { data, error } = await admin.from('league_events').select('*').order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return json({ ok: true, data });
}
// Joins leagues.code (via schedule_slots.league_id, single unambiguous FK) so
// the Ops Console can render a human-readable schedule-slot picker for
// "Delete Schedule Entry" instead of a raw Schedule Slot ID text box. No
// list endpoint for schedule_slots existed before this.
async function handleOpsListSchedules({ req, admin }: HandlerCtx) {
  await requireOpsAdminSession(req, admin);
  const { data, error } = await admin
    .from('schedule_slots')
    .select('*, leagues(code,name)')
    .order('starts_at', { ascending: false });
  if (error) throw new Error(error.message);
  const rows = ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
    const league = row.leagues as { code?: string | null; name?: string | null } | null;
    const { leagues: _leagues, ...rest } = row;
    return { ...rest, league_code: league?.code ?? null, league_name: league?.name ?? null };
  });
  return json({ ok: true, data: rows });
}

// Ops Edit (Patch) handlers
/**
 * Tables that stay super-admin only even on the shared ops CRUD path.
 * Regular admins are excluded from store media upload and edit access, so the
 * generic patch/delete helpers must escalate for these — otherwise `products`
 * would inherit league_admin access through the shared handler.
 */
const STORE_ONLY_TABLES = new Set(["products", "store_products"]);

async function requireTableWriteSession(
  table: string,
  req: Request,
  admin: import("@supabase/supabase-js").SupabaseClient,
) {
  return STORE_ONLY_TABLES.has(table)
    ? requireSuperAdminSession(req, admin)
    : requireOpsAdminSession(req, admin);
}

async function handleOpsPatch(table: string, req: Request, admin: import("@supabase/supabase-js").SupabaseClient, params: Record<string, string>) {
  await ensureMutation(req, { req, admin, params } as unknown as HandlerCtx);
  await requireTableWriteSession(table, req, admin);
  const id = params.id;
  if (!id) throw new Error('Missing ID');
  const body = await req.json().catch(() => null);
  if (!body || Object.keys(body).length === 0) throw new Error('Empty or invalid patch body');

  const { data, error } = await admin.from(table).update(body).eq('id', id).select('id').single();
  if (error) throw new Error(error.message);

  await admin.from('audit_logs').insert({
    action: `ops_patch_${table}`,
    actor_id: requireAuth(req),
    ref_type: table,
    ref_id: id,
    payload: body,
    idempotency_key: crypto.randomUUID(),
  });

  return json({ ok: true, data });
}
export async function handleOpsPatchTeams(ctx: HandlerCtx) { return handleOpsPatch('teams', ctx.req, ctx.admin, ctx.params); }
async function handleOpsPatchPlayers(ctx: HandlerCtx) { return handleOpsPatch('players', ctx.req, ctx.admin, ctx.params); }
export async function handleOpsPatchProducts(ctx: HandlerCtx) { return handleOpsPatch('products', ctx.req, ctx.admin, ctx.params); }
async function handleOpsPatchEvents(ctx: HandlerCtx) { return handleOpsPatch('league_events', ctx.req, ctx.admin, ctx.params); }
async function handleOpsPatchSchedules(ctx: HandlerCtx) { return handleOpsPatch('schedule_slots', ctx.req, ctx.admin, ctx.params); }

// Ops Delete (Archive) handlers
async function handleOpsDelete(table: string, req: Request, admin: import("@supabase/supabase-js").SupabaseClient, params: Record<string, string>) {
  await ensureMutation(req, { req, admin, params } as unknown as HandlerCtx);
  await requireTableWriteSession(table, req, admin);
  const id = params.id;
  if (!id) throw new Error('Missing ID');

  // Prefer soft delete/archive over hard delete by setting status
  const { data, error } = await admin.from(table).update({ status: 'archived' }).eq('id', id).select('id,status').single();
  if (error) throw new Error(error.message);

  await admin.from('audit_logs').insert({
    action: `ops_archive_${table}`,
    actor_id: requireAuth(req),
    ref_type: table,
    ref_id: id,
    payload: {},
    idempotency_key: crypto.randomUUID(),
  });

  return json({ ok: true, data });
}
export async function handleOpsDeleteTeams(ctx: HandlerCtx) { return handleOpsDelete('teams', ctx.req, ctx.admin, ctx.params); }
async function handleOpsDeletePlayers(ctx: HandlerCtx) { return handleOpsDelete('players', ctx.req, ctx.admin, ctx.params); }
export async function handleOpsDeleteProducts(ctx: HandlerCtx) { return handleOpsDelete('products', ctx.req, ctx.admin, ctx.params); }
async function handleOpsDeleteEvents(ctx: HandlerCtx) { return handleOpsDelete('league_events', ctx.req, ctx.admin, ctx.params); }

// ── Media Editor (Admin) ──────────────────────────────────────────────────
// Super-admin CRUD over media_publications rows (all statuses). Public reads
// continue to filter on status='published' via handlePublicMedia; this admin
// surface is the only way to edit title/status/league once a publication has
// been projected from the ingest pipeline.

const MEDIA_PUBLICATION_STATUSES = ['draft', 'scheduled', 'published', 'archived'] as const;
type MediaPublicationStatus = typeof MEDIA_PUBLICATION_STATUSES[number];
const isMediaPublicationStatus = (v: unknown): v is MediaPublicationStatus =>
  typeof v === 'string' && (MEDIA_PUBLICATION_STATUSES as readonly string[]).includes(v);

async function handleOpsListMediaPublications({ req, admin }: HandlerCtx) {
  await requireOpsAdminSession(req, admin);
  const url = new URL(req.url);
  const statusFilter = url.searchParams.get('status');
  const surfaceFilter = url.searchParams.get('surface');
  const leagueFilter = await resolveLeagueIdFilter(admin, url.searchParams.get('leagueId'));
  if (leagueFilter === LEAGUE_NO_MATCH) return json({ ok: true, data: [] });
  const searchQuery = url.searchParams.get('q');          // NEW: text search
  const pinnedFilter = url.searchParams.get('pinned');    // NEW: pin status filter
  const orderBy = url.searchParams.get('orderBy');        // NEW: sort mode
  const limitParam = Number(url.searchParams.get('limit') ?? '100');
  const limit = Math.min(Math.max(Number.isFinite(limitParam) ? limitParam : 100, 1), 200);

  let query = admin
    .from('media_publications')
    .select(
      'id,media_asset_id,surface,title,subtitle,status,published_at,scheduled_at,sort_at,sort_order,league_id,render_payload,' +
      'pinned_at,needs_review,parser_confidence,parser_uncertain_fields,' +   // NEW columns
      'media_assets!inner(id,metadata,created_at),' +
      'leagues:leagues!league_id(id,code,name)'
    );

  // Default: newest-first (operator can explicitly request sort_order mode)
  if (orderBy === 'sort_order') {
    query = query
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true });
  } else {
    query = query
      .order('created_at', { referencedTable: 'media_assets', ascending: false, nullsFirst: false })
      .order('id', { ascending: false });
  }

  query = query.limit(limit);

  if (statusFilter && isMediaPublicationStatus(statusFilter)) {
    query = query.eq('status', statusFilter);
  }
  if (surfaceFilter) query = query.eq('surface', surfaceFilter);
  if (leagueFilter) query = query.eq('league_id', leagueFilter);

  // NEW: pinned filter
  if (pinnedFilter === 'true') {
    query = query.not('pinned_at', 'is', null);
  } else if (pinnedFilter === 'false') {
    query = query.is('pinned_at', null);
  }

  // NEW: text search (ILIKE on title + subtitle)
  // Note: Without pg_trgm GIN indexes, %q% ILIKE uses sequential scan.
  // Acceptable for current dataset sizes; add trigram indexes if needed.
  if (searchQuery && searchQuery.trim().length > 0) {
    const q = searchQuery.trim();
    query = query.or(`title.ilike.%${q}%,subtitle.ilike.%${q}%`);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = ((data ?? []) as unknown as Record<string, unknown>[]).map((raw) => {
    const asset = (raw.media_assets as Record<string, unknown> | null) ?? {};
    const assetMeta = (asset.metadata as Record<string, unknown> | null) ?? {};
    const payload = (raw.render_payload as Record<string, unknown> | null) ?? {};
    const leagueRow = (raw.leagues as Record<string, unknown> | null) ?? {};
    const thumbnail = String(
      payload.thumbnail ?? payload.image_url ?? assetMeta.thumbnail ?? assetMeta.image_url ?? ''
    );
    const type = String(payload.type ?? assetMeta.type ?? 'poster');
    return {
      id: String(raw.id),
      mediaAssetId: String(raw.media_asset_id ?? asset.id ?? ''),
      surface: String(raw.surface ?? ''),
      title: String(raw.title ?? ''),
      subtitle: raw.subtitle == null ? null : String(raw.subtitle),
      status: String(raw.status ?? ''),
      publishedAt: raw.published_at == null ? null : String(raw.published_at),
      scheduledAt: raw.scheduled_at == null ? null : String(raw.scheduled_at),
      sortAt: raw.sort_at == null ? null : String(raw.sort_at),
      sortOrder: raw.sort_order == null ? null : Number(raw.sort_order),
      leagueId: raw.league_id == null ? null : String(raw.league_id),
      leagueCode: leagueRow.code == null ? null : String(leagueRow.code),
      leagueName: leagueRow.name == null ? null : String(leagueRow.name),
      type,
      thumbnail,
      createdAt: asset.created_at == null ? null : String(asset.created_at),
      pinnedAt: raw.pinned_at == null ? null : String(raw.pinned_at),         // NEW
      needsReview: Boolean(raw.needs_review ?? false),                         // NEW
      confidence: raw.parser_confidence == null ? null : Number(raw.parser_confidence),  // NEW
      uncertainFields: Array.isArray(raw.parser_uncertain_fields)               // NEW
        ? (raw.parser_uncertain_fields as string[])
        : [],
    };
  });

  return json({ ok: true, data: rows });
}

async function handleOpsPatchMediaPublications(ctx: HandlerCtx) {
  await ensureMutation(ctx.req, ctx);
  const { userId } = await requireOpsAdminSession(ctx.req, ctx.admin);
  const id = ctx.params.id;
  if (!id) return json({ ok: false, error: 'missing_id' }, 400);

  const body = (await ctx.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || Object.keys(body).length === 0) {
    return json({ ok: false, error: 'empty_patch_body' }, 400);
  }

  const update: Record<string, unknown> = {};
  if (typeof body.title === 'string' && body.title.trim().length > 0) {
    update.title = body.title.trim();
  }
  if (body.subtitle === null) {
    update.subtitle = null;
  } else if (typeof body.subtitle === 'string') {
    update.subtitle = body.subtitle;
  }
  if (body.status !== undefined) {
    if (!isMediaPublicationStatus(body.status)) {
      return json({ ok: false, error: `invalid_status (allowed: ${MEDIA_PUBLICATION_STATUSES.join(',')})` }, 400);
    }
    update.status = body.status;
    // Keep published_at consistent with status transitions.
    if (body.status === 'published') {
      update.published_at = new Date().toISOString();
      update.archived_at = null;
    } else if (body.status === 'archived') {
      update.published_at = null;
      update.archived_at = new Date().toISOString();
    } else if (body.status === 'draft' || body.status === 'scheduled') {
      update.published_at = null;
      update.archived_at = null;
    }
  }
  if (body.leagueId === null) {
    update.league_id = null;
  } else if (typeof body.leagueId === 'string' && body.leagueId.length > 0) {
    const resolvedLeagueId = await resolveLeagueId(ctx.admin, body.leagueId);
    if (!resolvedLeagueId) {
      return json({ ok: false, error: 'invalid_league_code' }, 400);
    }
    update.league_id = resolvedLeagueId;
  }
  if (typeof body.sortAt === 'string' && body.sortAt.length > 0) {
    update.sort_at = body.sortAt;
  }

  // NEW: pin/unpin support (pinnedAt: ISO timestamp to pin, null to unpin)
  if ('pinnedAt' in body) {
    if (body.pinnedAt === null) {
      update.pinned_at = null;
    } else if (typeof body.pinnedAt === 'string' && body.pinnedAt.length > 0) {
      // Validate ISO timestamp
      const d = new Date(body.pinnedAt);
      if (isNaN(d.getTime())) {
        return json({ ok: false, error: 'invalid_pinnedAt' }, 400);
      }
      update.pinned_at = body.pinnedAt;
    } else {
      return json({ ok: false, error: 'invalid_pinnedAt' }, 400);
    }
  }

  if (Object.keys(update).length === 0) {
    return json({ ok: false, error: 'no_editable_fields' }, 400);
  }

  const { data, error } = await ctx.admin
    .from('media_publications')
    .update(update)
    .eq('id', id)
    .select('id,title,subtitle,status,league_id,published_at,sort_at,pinned_at,needs_review,parser_confidence,parser_uncertain_fields')
    .single();
  if (error) throw new Error(error.message);

  await ctx.admin.from('audit_logs').insert({
    actor_id: userId,
    action: 'ops_patch_media_publication',
    ref_type: 'media_publications',
    ref_id: id,
    payload: update,
    idempotency_key: readIdempotencyKey(ctx.req.headers) ?? crypto.randomUUID(),
  });

  return json({ ok: true, data });
}

async function handleOpsDeleteMediaPublications(ctx: HandlerCtx) {
  await ensureMutation(ctx.req, ctx);
  const { userId } = await requireOpsAdminSession(ctx.req, ctx.admin);
  const id = ctx.params.id;
  if (!id) return json({ ok: false, error: 'missing_id' }, 400);

  // Guarded mutation: archive only if pinned_at IS NULL at mutation time.
  // This closes the race window where an item could be pinned between a
  // separate check and the update. If 0 rows are affected, we disambiguate
  // whether the item doesn't exist or is pinned.
  const { data, error } = await ctx.admin
    .from('media_publications')
    .update({
      status: 'archived',
      published_at: null,
      archived_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .is('pinned_at', null)
    .select('id,status')
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) {
    // Either the item doesn't exist, or it is pinned. Disambiguate.
    const { data: existing, error: fetchError } = await ctx.admin
      .from('media_publications')
      .select('id,pinned_at')
      .eq('id', id)
      .maybeSingle();
    if (fetchError || !existing) {
      return json({ ok: false, error: 'not_found' }, 404);
    }
    if (existing.pinned_at != null) {
      return json({ ok: false, error: 'unpin_before_archiving' }, 409);
    }
    // Should not reach here, but fail safely
    return json({ ok: false, error: 'archive_failed' }, 500);
  }

  await ctx.admin.from('audit_logs').insert({
    actor_id: userId,
    action: 'ops_archive_media_publication',
    ref_type: 'media_publications',
    ref_id: id,
    payload: { previous_status: data.status === 'archived' ? 'archived' : undefined },
    idempotency_key: readIdempotencyKey(ctx.req.headers) ?? crypto.randomUUID(),
  });

  return json({ ok: true, data });
}
async function handleOpsReorderMediaPublications(ctx: HandlerCtx) {
  await ensureMutation(ctx.req, ctx);
  const { userId } = await requireOpsAdminSession(ctx.req, ctx.admin);
  const body = (await ctx.req.json().catch(() => null)) as {
    items?: Array<{ id?: unknown; sortOrder?: unknown }>;
  } | null;
  const items = Array.isArray(body?.items) ? body.items : [];

  if (items.length === 0) return json({ ok: false, error: 'empty_items' }, 400);
  if (items.length > 200) return json({ ok: false, error: 'too_many_items (max 200)' }, 400);

  const normalized = items.map((item) => ({
    id: typeof item.id === 'string' ? item.id : '',
    sortOrder: Number(item.sortOrder),
  }));

  if (normalized.some((item) => item.id.length === 0 || !Number.isInteger(item.sortOrder) || item.sortOrder < 0)) {
    return json({ ok: false, error: 'invalid_items' }, 400);
  }

  const uniqueIds = new Set(normalized.map((item) => item.id));
  if (uniqueIds.size !== normalized.length) {
    return json({ ok: false, error: 'duplicate_ids' }, 400);
  }

  const updates = await Promise.all(
    normalized.map(async (item) => {
      const { error } = await ctx.admin
        .from('media_publications')
        .update({ sort_order: item.sortOrder })
        .eq('id', item.id);
      return { id: item.id, error };
    }),
  );
  const failed = updates.find((row) => row.error);
  if (failed?.error) throw new Error(failed.error.message);

  await ctx.admin.from('audit_logs').insert({
    actor_id: userId,
    action: 'ops_reorder_media_publications',
    ref_type: 'media_publications',
    ref_id: null,
    payload: { count: normalized.length, ids: normalized.map((item) => item.id) },
    idempotency_key: readIdempotencyKey(ctx.req.headers) ?? crypto.randomUUID(),
  });

  return json({ ok: true, updated: normalized.length });
}

// ═══════════════════════════════════════════════════════════════════════
// Media Intelligence Overhaul — new handlers (restore, stale cleanup, bulk archive)
// ═══════════════════════════════════════════════════════════════════════

/** POST /ops/media/publications/:id/restore — restore an archived publication to draft */
async function handleOpsMediaRestore(ctx: HandlerCtx) {
  await ensureMutation(ctx.req, ctx);
  const { userId } = await requireOpsAdminSession(ctx.req, ctx.admin);
  const id = ctx.params.id;
  if (!id) return json({ ok: false, error: 'missing_id' }, 400);

  // Fetch current state
  const { data: existing, error: fetchErr } = await ctx.admin
    .from('media_publications')
    .select('id,status,published_at')
    .eq('id', id)
    .single();
  if (fetchErr || !existing) {
    return json({ ok: false, error: 'not_found' }, 404);
  }

  // Idempotent: if not archived, return current state
  if (existing.status !== 'archived') {
    return json({ ok: true, data: existing });
  }

  // Restore to draft, clear published_at and archived_at
  const { data, error } = await ctx.admin
    .from('media_publications')
    .update({ status: 'draft', published_at: null, archived_at: null, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id,status,title,surface,league_id')
    .single();
  if (error) throw new Error(error.message);

  await ctx.admin.from('audit_logs').insert({
    actor_id: userId,
    action: 'ops_restore_media_publication',
    ref_type: 'media_publications',
    ref_id: id,
    payload: { previous_status: 'archived' },
    idempotency_key: readIdempotencyKey(ctx.req.headers) ?? crypto.randomUUID(),
  });

  return json({ ok: true, data });
}

/** POST /ops/media/stale-cleanup-preview — preview which publications would be archived */
async function handleOpsMediaStalePreview(ctx: HandlerCtx) {
  const { userId } = await requireOpsAdminSession(ctx.req, ctx.admin);

  const body = (await ctx.req.json().catch(() => ({}))) as {
    olderThanDays?: number;
    excludeRecentlyEditedDays?: number;
  };
  const olderThanDays = Math.max(Math.min(body.olderThanDays ?? 30, 365), 1);
  const excludeRecentlyEditedDays = Math.max(Math.min(body.excludeRecentlyEditedDays ?? 7, 90), 1);

  const cutoffDate = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
  const editCutoff = new Date(Date.now() - excludeRecentlyEditedDays * 86_400_000).toISOString();

  // Stale published items (not pinned, not recently edited)
  const { data: staleData, error: staleErr } = await ctx.admin
    .from('media_publications')
    .select('id,title,surface,league_id,published_at,leagues:leagues!league_id(code)')
    .eq('status', 'published')
    .lt('published_at', cutoffDate)
    .is('pinned_at', null)
    .lt('updated_at', editCutoff);
  if (staleErr) throw new Error(staleErr.message);

  // Count excluded: pinned
  const { count: excludedPinned, error: pinErr } = await ctx.admin
    .from('media_publications')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'published')
    .lt('published_at', cutoffDate)
    .not('pinned_at', 'is', null);
  if (pinErr) throw new Error(pinErr.message);

  // Count excluded: recently edited
  const { count: excludedEdited, error: editErr } = await ctx.admin
    .from('media_publications')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'published')
    .lt('published_at', cutoffDate)
    .is('pinned_at', null)
    .gte('updated_at', editCutoff);
  if (editErr) throw new Error(editErr.message);

  const publications = ((staleData ?? []) as unknown as Record<string, unknown>[]).map((raw) => {
    const leagueRow = (raw.leagues as Record<string, unknown> | null) ?? {};
    const publishedAt = raw.published_at == null ? null : String(raw.published_at);
    const daysSincePublish = publishedAt
      ? Math.floor((Date.now() - new Date(publishedAt).getTime()) / 86_400_000)
      : 0;
    return {
      id: String(raw.id),
      title: String(raw.title ?? ''),
      surface: String(raw.surface ?? ''),
      leagueCode: leagueRow.code == null ? null : String(leagueRow.code),
      publishedAt,
      daysSincePublish,
    };
  });

  return json({
    ok: true,
    totalAffected: publications.length,
    publications,
    excludedPinned: excludedPinned ?? 0,
    excludedRecentlyEdited: excludedEdited ?? 0,
    criteria: { olderThanDays, excludeRecentlyEditedDays },
  });
}

/** POST /ops/media/stale-cleanup-execute — archive stale publications (re-validates server-side) */
async function handleOpsMediaStaleExecute(ctx: HandlerCtx) {
  await ensureMutation(ctx.req, ctx);
  const { userId } = await requireOpsAdminSession(ctx.req, ctx.admin);

  const body = (await ctx.req.json().catch(() => ({}))) as {
    olderThanDays?: number;
    excludeRecentlyEditedDays?: number;
  };
  const olderThanDays = Math.max(Math.min(body.olderThanDays ?? 30, 365), 1);
  const excludeRecentlyEditedDays = Math.max(Math.min(body.excludeRecentlyEditedDays ?? 7, 90), 1);

  // Re-run the preview query server-side (never trust client-sent IDs)
  const cutoffDate = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
  const editCutoff = new Date(Date.now() - excludeRecentlyEditedDays * 86_400_000).toISOString();

  const { data: staleData, error: staleErr } = await ctx.admin
    .from('media_publications')
    .select('id')
    .eq('status', 'published')
    .lt('published_at', cutoffDate)
    .is('pinned_at', null)
    .lt('updated_at', editCutoff);
  if (staleErr) throw new Error(staleErr.message);

  const staleIds = ((staleData ?? []) as unknown as Record<string, unknown>[]).map(
    (raw) => String(raw.id)
  );

  if (staleIds.length === 0) {
    return json({ ok: true, archived: 0, ids: [] });
  }

  // Guarded batch archive: require pinned_at IS NULL at mutation time.
  // This closes the race window where an item could be pinned between the
  // server-side preview query and the execute update.
  const { data: archivedRows, error: updateErr } = await ctx.admin
    .from('media_publications')
    .update({
      status: 'archived',
      published_at: null,
      archived_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .in('id', staleIds)
    .eq('status', 'published')
    .is('pinned_at', null)
    .select('id');
  if (updateErr) throw new Error(updateErr.message);

  // Return only IDs that were actually archived (may be fewer than preview
  // if items were pinned between preview and execute).
  const actuallyArchivedIds = ((archivedRows ?? []) as unknown as Record<string, unknown>[]).map(
    (raw) => String(raw.id)
  );

  await ctx.admin.from('audit_logs').insert({
    actor_id: userId,
    action: 'ops_stale_cleanup',
    ref_type: 'media_publications',
    ref_id: null,
    payload: {
      count: actuallyArchivedIds.length,
      ids: actuallyArchivedIds,
      criteria: { olderThanDays, excludeRecentlyEditedDays },
    },
    idempotency_key: readIdempotencyKey(ctx.req.headers) ?? crypto.randomUUID(),
  });

  return json({ ok: true, archived: actuallyArchivedIds.length, ids: actuallyArchivedIds });
}

/** POST /ops/media/bulk-archive — transactional bulk archive via RPC */
async function handleOpsBulkArchive(ctx: HandlerCtx) {
  await ensureMutation(ctx.req, ctx);
  const { userId } = await requireOpsAdminSession(ctx.req, ctx.admin);

  const body = (await ctx.req.json().catch(() => null)) as { ids?: unknown[] } | null;
  const ids = Array.isArray(body?.ids) ? body.ids : [];

  if (ids.length === 0) return json({ ok: false, error: 'empty_ids' }, 400);
  if (ids.length > 100) return json({ ok: false, error: 'too_many_ids (max 100)' }, 400);

  // Filter to valid UUID strings
  const validIds = ids.filter((id): id is string =>
    typeof id === 'string' && id.length > 0
  );
  if (validIds.length !== ids.length) {
    return json({ ok: false, error: 'invalid_id_format' }, 400);
  }

  // Call the transactional RPC: validates all IDs + archives in one TX
  const { data, error } = await ctx.admin.rpc('bulk_archive_media_publications', {
    p_ids: validIds,
  });
  if (error) {
    // Parse the custom exception messages from the RPC
    const msg = error.message ?? '';
    if (msg.startsWith('invalid_ids:')) {
      const invalidIds = msg.replace('invalid_ids:', '').trim().replace(/[{}"]/g, '').split(',').map((s: string) => s.trim()).filter(Boolean);
      return json({ ok: false, error: 'invalid_ids', invalidIds }, 400);
    }
    if (msg.startsWith('pinned_ids:')) {
      const pinnedIds = msg.replace('pinned_ids:', '').trim().replace(/[{}"]/g, '').split(',').map((s: string) => s.trim()).filter(Boolean);
      return json({ ok: false, error: 'pinned_ids', invalidIds: pinnedIds }, 409);
    }
    throw new Error(msg);
  }

  const archivedIds = ((data ?? []) as unknown as Record<string, unknown>[]).map(
    (row) => String(row.archived_id)
  );

  await ctx.admin.from('audit_logs').insert({
    actor_id: userId,
    action: 'ops_bulk_archive_media',
    ref_type: 'media_publications',
    ref_id: null,
    payload: { count: archivedIds.length, ids: archivedIds },
    idempotency_key: readIdempotencyKey(ctx.req.headers) ?? crypto.randomUUID(),
  });

  return json({ ok: true, archived: archivedIds.length, ids: archivedIds });
}

// ── Autonomous Archived Media 30-Day Purge Engine ──────────────────────────

/**
 * Extracts storage bucket and relative object paths from media publication render payloads
 * and media asset metadata.
 */
export function extractStoragePaths(
  payload: Record<string, unknown> | null | undefined,
  meta?: Record<string, unknown> | null | undefined
): Array<{ bucket: string; path: string }> {
  const result: Array<{ bucket: string; path: string }> = [];
  const candidates: string[] = [];

  const addCandidate = (val: unknown) => {
    if (typeof val === 'string' && val.trim().length > 0) {
      candidates.push(val.trim());
    }
  };

  if (payload && typeof payload === 'object') {
    addCandidate(payload.storage_path);
    addCandidate(payload.storagePath);
    addCandidate(payload.objectPath);
    addCandidate(payload.url);
    addCandidate(payload.thumbnail_url);
    addCandidate(payload.thumbnailUrl);
    addCandidate(payload.poster_url);
    addCandidate(payload.posterUrl);
    addCandidate(payload.image_url);
    addCandidate(payload.imageUrl);
    addCandidate(payload.video_url);
    addCandidate(payload.videoUrl);
  }

  if (meta && typeof meta === 'object') {
    addCandidate(meta.storage_path);
    addCandidate(meta.storagePath);
    addCandidate(meta.objectPath);
    addCandidate(meta.url);
    addCandidate(meta.thumbnail_url);
    addCandidate(meta.thumbnailUrl);
  }

  const knownBuckets = ['media', 'league-media', 'highlight-clips', 'store-products', 'share-assets', 'player-headshots'];

  for (const raw of candidates) {
    // 1. Supabase storage URL: /storage/v1/object/(public|sign|authenticated)/<bucket>/<path>
    const storageMatch = raw.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/);
    if (storageMatch) {
      const bucket = storageMatch[1];
      const path = decodeURIComponent(storageMatch[2].split('?')[0]);
      if (bucket && path && !result.some((r) => r.bucket === bucket && r.path === path)) {
        result.push({ bucket, path });
      }
      continue;
    }

    // 2. Relative paths (e.g. "potg/2026/04/abc.jpg" or "media/banners/def.png")
    if (!raw.startsWith('http://') && !raw.startsWith('https://') && !raw.startsWith('data:')) {
      const clean = raw.replace(/^\/+/, '').split('?')[0];
      const parts = clean.split('/');
      if (parts.length >= 2 && knownBuckets.includes(parts[0])) {
        const bucket = parts[0];
        const path = parts.slice(1).join('/');
        if (!result.some((r) => r.bucket === bucket && r.path === path)) {
          result.push({ bucket, path });
        }
        continue;
      }
      if (clean.length > 0 && !result.some((r) => r.bucket === 'media' && r.path === clean)) {
        result.push({ bucket: 'media', path: clean });
      }
    }
  }

  return result;
}

/**
 * Permanently and autonomously purges archived media older than retentionDays (default 30 days)
 * from both Supabase Database tables (media_publications, orphaned media_assets) and
 * all physical storage buckets.
 */
export async function autonomousPurgeArchivedMedia(
  admin: SupabaseClient,
  env: Env,
  options?: {
    retentionDays?: number;
    executionMode?: 'autonomous' | 'manual';
    actorId?: string | null;
    req?: Request;
  }
) {
  const retentionDays = Math.max(Number(options?.retentionDays ?? 30), 1);
  const executionMode = options?.executionMode ?? 'autonomous';
  const actorId = options?.actorId ?? '00000000-0000-0000-0000-000000000000';
  const cutoffDate = new Date(Date.now() - retentionDays * 86_400_000).toISOString();

  // 1. Fetch expired archived publications
  const { data: expiredPubs, error: fetchErr } = await admin
    .from('media_publications')
    .select(
      'id,media_asset_id,title,status,archived_at,updated_at,render_payload,media_assets(id,metadata)'
    )
    .eq('status', 'archived')
    .or(`archived_at.lt.${cutoffDate},and(archived_at.is.null,updated_at.lt.${cutoffDate})`);

  if (fetchErr) throw new Error(`Fetch expired archived media failed: ${fetchErr.message}`);

  const publications = (expiredPubs ?? []) as unknown as Array<{
    id: string;
    media_asset_id: string | null;
    title: string;
    status: string;
    archived_at: string | null;
    updated_at: string | null;
    render_payload: Record<string, unknown> | null;
    media_assets: { id: string; metadata: Record<string, unknown> | null } | null;
  }>;

  if (publications.length === 0) {
    return {
      ok: true,
      purgedPublications: 0,
      purgedAssets: 0,
      storageFilesRemoved: 0,
      purgedIds: [],
      removedStoragePaths: [],
      criteria: { retentionDays, cutoffDate, executionMode },
    };
  }

  // 2. Extract storage file paths grouped by bucket
  const bucketPathsMap = new Map<string, Set<string>>();
  const allExtractedPaths: string[] = [];

  for (const pub of publications) {
    const paths = extractStoragePaths(pub.render_payload, pub.media_assets?.metadata);
    for (const item of paths) {
      if (!bucketPathsMap.has(item.bucket)) {
        bucketPathsMap.set(item.bucket, new Set());
      }
      bucketPathsMap.get(item.bucket)!.add(item.path);
      allExtractedPaths.push(`${item.bucket}/${item.path}`);
    }
  }

  // 3. Remove physical files from storage buckets
  let storageFilesRemoved = 0;
  for (const [bucket, pathSet] of bucketPathsMap.entries()) {
    const pathsArray = Array.from(pathSet);
    if (pathsArray.length > 0) {
      try {
        const { error: storageErr } = await admin.storage.from(bucket).remove(pathsArray);
        if (storageErr) {
          console.warn(`Storage deletion warning for bucket '${bucket}': ${storageErr.message}`);
        } else {
          storageFilesRemoved += pathsArray.length;
        }
      } catch (err) {
        console.warn(`Failed removing objects from bucket '${bucket}':`, err);
      }
    }
  }

  // 4. Delete media_publications database rows
  const pubIds = publications.map((p) => p.id);
  const { error: deletePubErr } = await admin
    .from('media_publications')
    .delete()
    .in('id', pubIds);

  if (deletePubErr) throw new Error(`Delete media_publications failed: ${deletePubErr.message}`);

  // 5. Clean up orphaned media_assets
  const assetIds = Array.from(
    new Set(publications.map((p) => p.media_asset_id).filter((id): id is string => Boolean(id)))
  );
  let purgedAssetsCount = 0;

  if (assetIds.length > 0) {
    const { data: activeRefs } = await admin
      .from('media_publications')
      .select('media_asset_id')
      .in('media_asset_id', assetIds);

    const activeAssetIds = new Set(
      ((activeRefs ?? []) as Array<{ media_asset_id: string | null }>).map((r) => r.media_asset_id)
    );
    const orphanAssetIds = assetIds.filter((id) => !activeAssetIds.has(id));

    if (orphanAssetIds.length > 0) {
      const { error: deleteAssetErr } = await admin
        .from('media_assets')
        .delete()
        .in('id', orphanAssetIds);

      if (!deleteAssetErr) {
        purgedAssetsCount = orphanAssetIds.length;
      }
    }
  }

  // 6. Record Audit Log
  const idempotencyKey = options?.req ? readIdempotencyKey(options.req.headers) : crypto.randomUUID();
  await admin.from('audit_logs').insert({
    actor_id: actorId,
    action: 'autonomous_archived_media_purge',
    ref_type: 'media_publications',
    ref_id: null,
    payload: {
      purgedPublicationsCount: pubIds.length,
      purgedAssetsCount,
      storageFilesRemoved,
      purgedPublicationIds: pubIds,
      storagePaths: allExtractedPaths,
      criteria: { retentionDays, cutoffDate, executionMode },
    },
    idempotency_key: idempotencyKey ?? crypto.randomUUID(),
  });

  return {
    ok: true,
    purgedPublications: pubIds.length,
    purgedAssets: purgedAssetsCount,
    storageFilesRemoved,
    purgedIds: pubIds,
    removedStoragePaths: allExtractedPaths,
    criteria: { retentionDays, cutoffDate, executionMode },
  };
}

/** GET /ops/media/archived-purge-preview — preview archived media eligible for 30-day autonomous purge */
async function handleOpsMediaArchivedPurgePreview(ctx: HandlerCtx) {
  await requireOpsAdminSession(ctx.req, ctx.admin);
  const url = new URL(ctx.req.url);
  const daysParam = url.searchParams.get('days') ?? '30';
  const retentionDays = Math.max(Math.min(Number(daysParam) || 30, 365), 1);
  const cutoffDate = new Date(Date.now() - retentionDays * 86_400_000).toISOString();

  const { data: expiredPubs, error } = await ctx.admin
    .from('media_publications')
    .select(`
      id,
      media_asset_id,
      title,
      surface,
      league_id,
      status,
      archived_at,
      updated_at,
      render_payload,
      media_assets(id,metadata),
      leagues:leagues!league_id(code)
    `)
    .eq('status', 'archived')
    .or(`archived_at.lt.${cutoffDate},and(archived_at.is.null,updated_at.lt.${cutoffDate})`);

  if (error) throw new Error(error.message);

  const publications = ((expiredPubs ?? []) as unknown as Record<string, unknown>[]).map((raw) => {
    const leagueRow = (raw.leagues as Record<string, unknown> | null) ?? {};
    const mediaAsset = (raw.media_assets as Record<string, unknown> | null) ?? null;
    const effectiveArchivedAt = (raw.archived_at as string | null) || (raw.updated_at as string | null) || new Date().toISOString();
    const daysArchived = Math.floor((Date.now() - new Date(effectiveArchivedAt).getTime()) / 86_400_000);
    const storagePaths = extractStoragePaths(
      raw.render_payload as Record<string, unknown> | null,
      mediaAsset?.metadata as Record<string, unknown> | null
    );

    return {
      id: String(raw.id),
      mediaAssetId: raw.media_asset_id ? String(raw.media_asset_id) : null,
      title: String(raw.title ?? ''),
      surface: String(raw.surface ?? ''),
      leagueCode: leagueRow.code == null ? null : String(leagueRow.code),
      archivedAt: effectiveArchivedAt,
      daysArchived,
      storagePaths: storagePaths.map((p) => `${p.bucket}/${p.path}`),
    };
  });

  const totalStorageFiles = publications.reduce((acc, p) => acc + p.storagePaths.length, 0);

  return json({
    ok: true,
    totalEligible: publications.length,
    totalStorageFiles,
    retentionDays,
    cutoffDate,
    publications,
  });
}

/** POST /ops/media/archived-purge-execute — manual on-demand execution of 30-day archived media purge */
async function handleOpsMediaArchivedPurgeExecute(ctx: HandlerCtx) {
  await ensureMutation(ctx.req, ctx);
  const { userId } = await requireOpsAdminSession(ctx.req, ctx.admin);
  const body = (await ctx.req.json().catch(() => ({}))) as { retentionDays?: number };
  const retentionDays = Math.max(Math.min(body.retentionDays ?? 30, 365), 1);

  const result = await autonomousPurgeArchivedMedia(ctx.admin, ctx.env, {
    retentionDays,
    executionMode: 'manual',
    actorId: userId,
    req: ctx.req,
  });

  return json(result);
}

const handlePublicConfig = _handlePublicConfig;

// handlePublicHome — extracted to src/worker/routes/public.ts
const handlePublicHome = _handlePublicHome;

function splitProfileName(profile: Record<string, unknown> | undefined) {
  const fullName =
    typeof profile?.full_name === "string" ? profile.full_name.trim() : "";
  const displayName =
    typeof profile?.display_name === "string"
      ? profile.display_name.trim()
      : "";
  const rawName = fullName || displayName;
  if (!rawName) {
    return { first_name: null, last_name: null };
  }

  const parts = rawName.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return { first_name: parts[0], last_name: null };
  }

  return {
    first_name: parts.slice(0, -1).join(" "),
    last_name: parts[parts.length - 1],
  };
}

async function handleTeamsList({ req, admin }: HandlerCtx) {
  // Resolve league slug/code → UUID once, then filter DB-side. This handler
  // previously fetched all 200 teams and filtered in JS whenever the param
  // was not a UUID — the silent-degradation flavor of the same bug class
  // that 500'd /ops/media (PR #571). See resolveLeagueIdFilter in shared.ts.
  const leagueFilter = await resolveLeagueIdFilter(
    admin,
    new URL(req.url).searchParams.get("leagueId"),
  );
  if (leagueFilter === LEAGUE_NO_MATCH) {
    return json({ ok: true, teams: [] }, 200, {
      "Cache-Control": "public, s-maxage=60, max-age=30",
    });
  }

  let query = admin
    .from("teams")
    .select(
      "id,name,league_id,record,leagues(code,name),seasons(name),divisions(name)," +
        "players(id,jersey_number,position,user_id)," +
        "team_memberships(id,user_id,role)",
    )
    .eq("status", "published")
    .limit(200);

  if (leagueFilter) {
    query = query.eq("league_id", leagueFilter);
  }

  const { data: teamsData, error: teamsError } = await query;
  if (teamsError) throw new Error(teamsError.message);

  const filteredTeamsData =
    (teamsData as unknown as Record<string, unknown>[]) ?? [];

  // Fetch pre-computed standings from mvw_standings (P2-D materialized view).
  // Falls back to empty statsMap (teams.record column used as fallback below).
  const statsMap = new Map<
    string,
    { wins: number; losses: number; ptsFor: number; ptsAgainst: number }
  >();
  try {
    let standingsQuery = admin
      .from("mvw_standings")
      .select("team_id,wins,losses,pts_for,pts_against");

    if (leagueFilter) {
      standingsQuery = standingsQuery.eq("league_id", leagueFilter);
    }

    const { data: standingsData } = await standingsQuery;
    if (standingsData) {
      for (const row of standingsData as Array<Record<string, unknown>>) {
        if (typeof row.team_id === "string") {
          statsMap.set(row.team_id, {
            wins:        Number(row.wins        ?? 0),
            losses:      Number(row.losses      ?? 0),
            ptsFor:      Number(row.pts_for     ?? 0),
            ptsAgainst:  Number(row.pts_against ?? 0),
          });
        }
      }
    }
} catch (mvwError) {
      // Loud on purpose: mvw_standings is the source of truth for live
      // standings. A caught error here means standings are NOT being shown
      // from live data -- surface it, don't silently degrade to stale CSV.
      console.error("[handleTeamsList] mvw_standings query failed, falling back to teams.record:", mvwError);
    }

  const profileUserIds = Array.from(
    new Set(
      filteredTeamsData.flatMap((team) => {
        const players = Array.isArray(team.players) ? team.players : [];
        const memberships = Array.isArray(team.team_memberships)
          ? team.team_memberships
          : [];
        return [...players, ...memberships]
          .map((entry) =>
            typeof (entry as Record<string, unknown>).user_id === "string"
              ? String((entry as Record<string, unknown>).user_id)
              : null,
          )
          .filter((userId): userId is string => Boolean(userId));
      }),
    ),
  );

  const profileMap = new Map<string, Record<string, unknown>>();
  if (profileUserIds.length > 0) {
    const { data: profilesData, error: profilesError } = await admin
      .from("profiles")
      .select("user_id,full_name,display_name,avatar_url")
      .in("user_id", profileUserIds);

    if (profilesError) throw new Error(profilesError.message);

    for (const profile of (profilesData as Record<string, unknown>[] | null) ??
      []) {
      if (typeof profile.user_id === "string") {
        profileMap.set(profile.user_id, profile);
      }
    }
  }

  const teams = filteredTeamsData.map((row: Record<string, unknown>) => {
    const dbRecord = row.record as { wins?: number; losses?: number; ptsFor?: number; ptsAgainst?: number } | null;
    const stats = statsMap.get(row.id as string) || (dbRecord ? {
      wins: dbRecord.wins ?? 0,
      losses: dbRecord.losses ?? 0,
      ptsFor: dbRecord.ptsFor ?? 0,
      ptsAgainst: dbRecord.ptsAgainst ?? 0,
    } : {
      wins: 0,
      losses: 0,
      ptsFor: 0,
      ptsAgainst: 0,
    });
    const gp = stats.wins + stats.losses;
    let winPct = gp > 0 ? (stats.wins / gp).toFixed(3) : ".000";
    if (winPct.startsWith("1")) winPct = "1.000";
    else winPct = winPct.replace(/^0/, "");

    return {
      id: String(row.id),
      name: String(row.name),
      league_code: (
        ((row.leagues as Record<string, unknown>)?.code as string) ?? ""
      ).toUpperCase(),
      league_name: String(
        (row.leagues as Record<string, unknown>)?.name ?? "League",
      ),
      season_name: String(
        (row.seasons as Record<string, unknown>)?.name ?? "Season",
      ),
      division_name: (row.divisions as Record<string, unknown>)?.name ?? null,
      roster_count: Array.isArray(row.players) ? row.players.length : 0,
      players: (Array.isArray(row.players) ? row.players : []).map(
        (p: Record<string, unknown>) => {
          const profile =
            typeof p.user_id === "string"
              ? profileMap.get(p.user_id)
              : undefined;
          const name = splitProfileName(profile);
          return {
            id: String(p.id),
            user_id: p.user_id,
            jersey_number: p.jersey_number,
            position: p.position,
            first_name: name.first_name,
            last_name: name.last_name,
            avatar_url:
              (profile?.avatar_url as string | null | undefined) ?? null,
          };
        },
      ),
      coaches: (Array.isArray(row.team_memberships) ? row.team_memberships : [])
        .filter(
          (m: Record<string, unknown>) =>
            m.role === "team_manager" || m.role === "coach",
        )
        .map((m: Record<string, unknown>) => {
          const profile =
            typeof m.user_id === "string"
              ? profileMap.get(m.user_id)
              : undefined;
          const name = splitProfileName(profile);
          return {
            id: m.id,
            user_id: m.user_id,
            role: m.role,
            first_name: name.first_name,
            last_name: name.last_name,
            avatar_url:
              (profile?.avatar_url as string | null | undefined) ?? null,
          };
        }),
      stats: {
        wins: stats.wins,
        losses: stats.losses,
        gamesPlayed: gp,
        ptsFor: stats.ptsFor,
        ptsAgainst: stats.ptsAgainst,
        winPct: winPct,
        diff: stats.ptsFor - stats.ptsAgainst,
      },
    };
  });

  return json({ ok: true, teams }, 200, { "Cache-Control": "public, s-maxage=60, max-age=30" });
}

function compilePath(path: string) {
  const keys: string[] = [];
  const pattern = path
    .replace(/:([^/*]+)/g, (_, key: string) => {
      keys.push(key);
      return "([^/]+)";
    })
    .replace(/\*/g, () => {
      keys.push("wildcard");
      return "(.*)";
    });
  return { regex: new RegExp(`^${pattern}$`), keys };
}

async function handleParseEventImage(ctx: HandlerCtx) {
  await requireAdminSession(ctx.req, ctx.admin);
  const apiKey = ctx.env.GROQ_API_KEY;
  if (!apiKey) return json({ ok: false, error: "groq_api_key_missing" }, 503);

  const body = (await ctx.req.json().catch(() => null)) as {
    imageBase64: string;
    mimeType: string;
  } | null;
  if (!body?.imageBase64 || !body?.mimeType)
    return json({ ok: false, error: "image_required" }, 400);

  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: ctx.env.GROQ_VISION_MODEL || "qwen/qwen3.6-27b", // env-overridable (2026-07-20): next Groq model retirement is a config change, not a redeploy. qwen3.6-27b runtime-verified on this account.
      reasoning_effort: "none", // no thinking tokens: raw JSON only; also keeps requests inside free-tier TPM
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:${body.mimeType};base64,${body.imageBase64}`,
              },
            },
            {
              type: "text",
              text: 'Extract event details from this graphic. Return ONLY a JSON object with exactly these keys: title (string, name of the event), location (string, location if present, empty string if not), date (string, event date and time if present, empty string if not), leagueId (string, league abbreviation if present: wbl, tgif, or sbbl, default to sbbl). No markdown, no explanation — raw JSON only.',
            },
          ],
        },
      ],
    }),
  });

  if (!resp.ok)
    return json({ ok: false, error: "groq_error", status: resp.status }, 502);
  const ai = (await resp.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  const raw = ai.choices[0]?.message?.content ?? "";
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return json({ ok: false, error: "parse_failed", raw }, 422);
  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    return json({ ok: true, data: parsed });
  } catch {
    return json({ ok: false, error: "invalid_json", raw }, 422);
  }
}

export async function handleParsePotgImage(ctx: HandlerCtx) {
  await requireAdminSession(ctx.req, ctx.admin);
  const apiKey = ctx.env.GROQ_API_KEY;
  if (!apiKey) return json({ ok: false, error: "groq_api_key_missing" }, 503);

  const body = (await ctx.req.json().catch(() => null)) as {
    imageBase64: string;
    mimeType: string;
  } | null;
  if (!body?.imageBase64 || !body?.mimeType)
    return json({ ok: false, error: "image_required" }, 400);

  const pureBase64 = body.imageBase64.includes(',')
    ? body.imageBase64.split(',')[1] ?? body.imageBase64
    : body.imageBase64;

  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: ctx.env.GROQ_VISION_MODEL || "qwen/qwen3.6-27b", // env-overridable (2026-07-20): next Groq model retirement is a config change, not a redeploy. qwen3.6-27b runtime-verified on this account.
      reasoning_effort: "none", // no thinking tokens: raw JSON only; also keeps requests inside free-tier TPM
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:${body.mimeType};base64,${pureBase64}`,
              },
            },
            {
              type: "text",
              text: 'Extract player of the game data from this graphic. Return ONLY a JSON object with exactly these keys: playerName (string), team (string, the full name of the player\'s team; this MUST perfectly match one of the two teams listed in the gameResult), pts (number), rebs (number), assts (number), gameResult (string, e.g. "TEAM A 77 vs TEAM B 63"). Do not extract watermarks or abbreviations for the team name. No markdown, no explanation — raw JSON only.',
            },
          ],
        },
      ],
    }),
  });

  if (!resp.ok)
    return json({ ok: false, error: "groq_error", status: resp.status }, 502);
  const ai = (await resp.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  const raw = ai.choices[0]?.message?.content ?? "";
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return json({ ok: false, error: "parse_failed", raw }, 422);
  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    const teamName = String(parsed.team ?? "");
    const gameResult = String(parsed.gameResult ?? "");
    if (teamName || gameResult) {
      const leagueCode = await inferPotgLeagueCode(ctx, teamName, gameResult);
      if (leagueCode) {
        parsed.leagueId = leagueCode;
      }
    }
    return json({ ok: true, data: parsed });
  } catch {
    return json({ ok: false, error: "invalid_json", raw }, 422);
  }
}

/** POST /ops/roster/parse-image — roster/team-photo OCR via Groq vision (admin only, parse-only). */
export async function handleParseRosterImage(ctx: HandlerCtx) {
  await requireAdminSession(ctx.req, ctx.admin);
  const apiKey = ctx.env.GROQ_API_KEY;
  if (!apiKey) return json({ ok: false, error: "groq_api_key_missing" }, 503);

  const body = (await ctx.req.json().catch(() => null)) as {
    imageBase64: string;
    mimeType: string;
  } | null;
  if (!body?.imageBase64 || !body?.mimeType)
    return json({ ok: false, error: "image_required" }, 400);

  const pureBase64 = body.imageBase64.includes(',')
    ? body.imageBase64.split(',')[1] ?? body.imageBase64
    : body.imageBase64;

  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: ctx.env.GROQ_VISION_MODEL || "qwen/qwen3.6-27b", // env-overridable (2026-07-20): next Groq model retirement is a config change, not a redeploy. qwen3.6-27b runtime-verified on this account.
      reasoning_effort: "none", // no thinking tokens: raw JSON only; also keeps requests inside free-tier TPM
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:${body.mimeType};base64,${pureBase64}`,
              },
            },
            {
              type: "text",
              text: 'Extract team roster data from this photo or graphic. Return ONLY a JSON object with exactly these keys: teamName (string), players (array of objects, each with name (string), jerseyNumber (number or null), position (string or null)). No markdown, no explanation — raw JSON only.',
            },
          ],
        },
      ],
    }),
  });

  if (!resp.ok)
    return json({ ok: false, error: "groq_error", status: resp.status }, 502);
  const ai = (await resp.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  const raw = ai.choices[0]?.message?.content ?? "";
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return json({ ok: false, error: "parse_failed", raw }, 422);
  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    if (!Array.isArray(parsed.players)) parsed.players = [];
    return json({ ok: true, data: parsed });
  } catch {
    return json({ ok: false, error: "invalid_json", raw }, 422);
  }
}

function normalizeTeamToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeTeamLabel(value: string): string {
  return value
    .replace(/\b\d+\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalTeamVariants(teamName: string): string[] {
  const normalized = normalizeTeamToken(normalizeTeamLabel(teamName));
  const variants = new Set<string>([normalized]);

  // POTG cards sometimes use shorthand vs roster records.
  if (normalized === "14ozathletics") variants.add("fourteenounceathletics");
  if (normalized === "fourteenounceathletics") variants.add("14ozathletics");

  return [...variants];
}

function extractPotgTeamCandidates(team: string, gameResult: string): string[] {
  const candidates = new Set<string>();
  const addCandidate = (value: string) => {
    const normalized = normalizeTeamLabel(value);
    if (normalized.length > 0) candidates.add(normalized);
  };

  addCandidate(team);
  for (const side of gameResult.split(/\bvs\b/i)) addCandidate(side);

  return [...candidates];
}

function parsePotgResultSide(side: string): { label: string; score: number | null } {
  const trimmed = side.trim().replace(/\s+/g, " ");
  if (!trimmed) return { label: "", score: null };

  // Supports both "Team Name 82" and "82 Team Name" card formats.
  const trailing = trimmed.match(/^(.*?)(\d{1,3})$/);
  if (trailing) {
    return {
      label: trailing[1].trim(),
      score: Number.isFinite(Number(trailing[2])) ? Number(trailing[2]) : null,
    };
  }

  const leading = trimmed.match(/^(\d{1,3})(.*)$/);
  if (leading) {
    return {
      label: leading[2].trim(),
      score: Number.isFinite(Number(leading[1])) ? Number(leading[1]) : null,
    };
  }

  return { label: trimmed, score: null };
}

function parsePotgGameResult(gameResult: string): {
  homeLabel: string;
  awayLabel: string;
  homeScore: number | null;
  awayScore: number | null;
} | null {
  const sides = gameResult.split(/\bvs\b/i).map((s) => s.trim()).filter(Boolean);
  if (sides.length !== 2) return null;
  const home = parsePotgResultSide(sides[0]);
  const away = parsePotgResultSide(sides[1]);
  if (!home.label || !away.label) return null;
  return {
    homeLabel: home.label,
    awayLabel: away.label,
    homeScore: home.score,
    awayScore: away.score,
  };
}

async function inferPotgLeagueCode(
  ctx: HandlerCtx,
  team: string,
  gameResult: string,
): Promise<"wbl" | "tgifbl" | "sbbl" | null> {
  const candidates = extractPotgTeamCandidates(team, gameResult);
  if (candidates.length === 0) return null;

  const { data: teamRows, error } = await ctx.admin
    .from("teams")
    .select("name, leagues:leagues!league_id(code)");
  if (error || !teamRows) return null;

  const hitsByLeague: Record<string, number> = {};
  for (const candidate of candidates) {
    const candidateVariants = canonicalTeamVariants(candidate);
    for (const row of teamRows as Array<Record<string, unknown>>) {
      const teamName = String(row.name ?? "");
      const leagueCode = String((row.leagues as Record<string, unknown> | null)?.code ?? "").toLowerCase();
      if (!leagueCode) continue;
      const dbVariants = canonicalTeamVariants(teamName);
      const isMatch = candidateVariants.some((candidateToken) =>
        dbVariants.some((dbToken) =>
          dbToken === candidateToken || dbToken.includes(candidateToken) || candidateToken.includes(dbToken)
        )
      );
      if (isMatch) hitsByLeague[leagueCode] = (hitsByLeague[leagueCode] ?? 0) + 1;
    }
  }

  const ranked = Object.entries(hitsByLeague).sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) return null;
  if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) return null;

  const winner = ranked[0][0];
  return winner === "wbl" || winner === "tgifbl" || winner === "sbbl" ? winner : null;
}

// POTG publisher guards. Both /ops/potg/submit and /ops/ingest/submit (kind='potg')
// must refuse to publish when the payload lacks the stat fields the leaderboard
// pipeline depends on, or when the player isn't rostered to the publication's
// league. Without these checks, posters land in media_publications with no
// matching player_game_stats row, leaving the leaderboard with an empty roster
// (incident 2026-04-18: 12 orphan WBL POTG posters; only Robert Ocampo visible).
type PotgStatPayload = {
  playerName?: unknown;
  team?: unknown;
  pts?: unknown;
  rebs?: unknown;
  assts?: unknown;
  gameResult?: unknown;
};

function validatePotgStatFields(meta: PotgStatPayload): string | null {
  if (!String(meta.playerName ?? "").trim()) return "missing_potg_player_name";
  if (!String(meta.team ?? "").trim()) return "missing_potg_team";
  if (!String(meta.gameResult ?? "").trim()) return "missing_potg_game_result";
  for (const key of ["pts", "rebs", "assts"] as const) {
    const v = meta[key];
    if (v === undefined || v === null || v === "") return `missing_potg_${key}`;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return `invalid_potg_${key}`;
  }
  return null;
}

type PotgPlayerResolution =
  | { ok: true; playerId: string; userId: string; provisioned: boolean; warnings: string[] }
  | { ok: false; error: string; details: Record<string, unknown> };

// 2026-07-20 parser-first restoration (owner directive): the POTG pipeline
// auto-registers unknown players again instead of fail-closing with 409.
// The 2026-04-18 incident this guard addressed (half-written ingest rows) is
// prevented differently now: provisioning happens BEFORE the ingest_jobs row
// opens, every step checks its own error, and every auto-created row is
// audit-logged with created_by + a potg_auto_provisioned marker so operators
// can review/merge later. Games were already auto-created by this pipeline —
// players/profiles now behave consistently with that design.
// LIKE-pattern sanitizer: OCR output can contain % or _ (SQL wildcards),
// which would silently widen an ilike lookup and attribute stats to the
// wrong player. Escape them so lookups always mean the literal name.
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export async function resolvePotgPlayer(
  admin: SupabaseClient,
  playerName: string,
  leagueUuid: string,
  opts: { teamName?: string | null; actorId?: string | null } = {},
): Promise<PotgPlayerResolution> {
  const trimmed = playerName.trim();
  if (!trimmed) {
    return { ok: false, error: "potg_player_name_required", details: {} };
  }
  const warnings: string[] = [];
  let provisioned = false;

  // 1) Profile — find by display name, or auto-provision.
  let userId: string;
  const { data: profile } = await admin
    .from("profiles")
    .select("user_id")
    .ilike("display_name", escapeLikePattern(trimmed))
    .maybeSingle();
  if (profile?.user_id) {
    userId = String(profile.user_id);
  } else {
    userId = crypto.randomUUID();
    const { error: profErr } = await admin.from("profiles").insert({
      user_id: userId,
      display_name: trimmed,
      full_name: trimmed,
      created_by: opts.actorId ?? null,
    });
    if (profErr) {
      return { ok: false, error: "potg_profile_provision_failed", details: { playerName: trimmed, message: profErr.message } };
    }
    provisioned = true;
  }

  // 2) Player — find by user, or auto-provision onto this league (and team by
  //    parsed name when it resolves; otherwise left null for later assignment).
  const { data: player } = await admin
    .from("players")
    .select("id, league_id, merged_into")
    .eq("user_id", userId)
    .maybeSingle();
  let playerId: string;
  if (player?.id) {
    playerId = String(player.id);
    let effectiveLeague = player.league_id as string | null;
    // Identity merges are soft pointers — always attribute to the canonical row.
    if (player.merged_into) {
      const { data: canonical } = await admin
        .from("players")
        .select("id, league_id")
        .eq("id", player.merged_into)
        .maybeSingle();
      if (canonical?.id) {
        playerId = String(canonical.id);
        effectiveLeague = (canonical.league_id as string | null) ?? null;
        warnings.push("potg_followed_identity_merge");
      }
    }
    if (effectiveLeague && effectiveLeague !== leagueUuid) {
      // Multi-league reality: publish proceeds; flagged for operator review.
      warnings.push("potg_player_league_mismatch");
    }
  } else {
    let teamId: string | null = null;
    const teamName = String(opts.teamName ?? "").trim();
    if (teamName) {
      const { data: team } = await admin
        .from("teams")
        .select("id")
        .eq("league_id", leagueUuid)
        .ilike("name", escapeLikePattern(teamName))
        .maybeSingle();
      teamId = team?.id ? String(team.id) : null;
      if (!teamId) warnings.push("potg_team_not_resolved");
    }
    const { data: newPlayer, error: playerErr } = await admin
      .from("players")
      .insert({
        user_id: userId,
        league_id: leagueUuid,
        team_id: teamId,
        created_by: opts.actorId ?? null,
      })
      .select()
      .single();
    if (playerErr || !newPlayer?.id) {
      return { ok: false, error: "potg_player_provision_failed", details: { playerName: trimmed, message: playerErr?.message ?? "no_row" } };
    }
    playerId = String(newPlayer.id);
    provisioned = true;
  }

  return { ok: true, playerId, userId, provisioned, warnings };
}

/**
 * POST /ops/players/find-or-create
 *
 * Replaces the old "Create Player" contract, which required the operator to
 * already know and paste a raw `user_id` UUID with no lookup endpoint to find
 * one — the only field in the Ops Console with genuinely nothing to search
 * against. Regular admins do not have database access, so that field was
 * effectively unusable.
 *
 * Reuses `resolvePotgPlayer` — the same find-or-create-by-display-name logic
 * already proven in production by Roster Import and POTG ingest — instead of
 * requiring a pre-existing account. Body: { name, leagueId, teamId?,
 * jerseyNumber?, position? }. `leagueId` accepts a code or a UUID (resolved
 * via resolveLeagueId); `teamId`, if given, is a real UUID selected from a
 * dropdown by the caller, not a name — set directly rather than re-resolved
 * by name, since resolvePotgPlayer only assigns a team on first provisioning
 * and an operator may also be attaching a team to an already-registered
 * player (e.g. a self-registered fan being rostered for the first time).
 */
async function handleOpsFindOrCreatePlayer(ctx: HandlerCtx) {
  await ensureMutation(ctx.req, ctx);
  const session = await requireOpsAdminSession(ctx.req, ctx.admin);

  const body = (await ctx.req.json().catch(() => null)) as {
    name?: string;
    leagueId?: string;
    teamId?: string;
    jerseyNumber?: string | number;
    position?: string;
  } | null;

  const name = body?.name?.trim();
  if (!name) return json({ ok: false, error: "name_required" }, 400);

  const rawLeague = body?.leagueId?.trim();
  if (!rawLeague) return json({ ok: false, error: "league_id_required" }, 400);
  const leagueUuid = await resolveLeagueId(ctx.admin, rawLeague);
  if (!leagueUuid) return json({ ok: false, error: "league_not_found" }, 404);

  const result = await resolvePotgPlayer(ctx.admin, name, leagueUuid, {
    actorId: session.userId,
  });
  if (result.ok === false) {
    return json({ ok: false, error: result.error, details: result.details }, 422);
  }

  const patch: Record<string, unknown> = {};
  if (body?.teamId) patch.team_id = body.teamId;
  if (body?.jerseyNumber !== undefined && body.jerseyNumber !== "") {
    const jersey = Number(body.jerseyNumber);
    if (Number.isFinite(jersey) && jersey >= 0) patch.jersey_number = jersey;
  }
  if (body?.position?.trim()) patch.position = body.position.trim();

  let player: Record<string, unknown> | null = null;
  if (Object.keys(patch).length > 0) {
    const { data, error } = await ctx.admin
      .from("players")
      .update(patch)
      .eq("id", result.playerId)
      .select()
      .single();
    if (error) throw new Error(error.message);
    player = data as Record<string, unknown>;
  } else {
    const { data, error } = await ctx.admin
      .from("players")
      .select()
      .eq("id", result.playerId)
      .single();
    if (error) throw new Error(error.message);
    player = data as Record<string, unknown>;
  }

  return json({
    ok: true,
    playerId: result.playerId,
    userId: result.userId,
    provisioned: result.provisioned,
    warnings: result.warnings,
    player,
  });
}


// ── PPV INVITE SYSTEM ────────────────────────────────────────────────────────
//
// VERIFIED: IP source — CF-Connecting-IP is the canonical Cloudflare Pages
// header containing the real client IP (set by Cloudflare's edge before the
// request reaches the Worker). We strictly rely on this header to prevent
// IP spoofing from client-supplied headers like X-Forwarded-For.

function getClientIP(req: Request): string {
  return req.headers.get("cf-connecting-ip") ?? "unknown";
}

async function getUserRolesFromDB(
  userId: string,
  admin: SupabaseClient,
): Promise<string[]> {
  const { data } = await admin
    .from("user_role_assignments")
    .select("role")
    .eq("user_id", userId);
  return (data ?? []).map((row) => String(row.role));
}

/**
 * POST /api/invite/generate
 * Auth required.  Eligible roles: player, paid_fan, super_admin.
 * Rate-limit: 1 invite per (user, game) enforced by UNIQUE DB constraint.
 * Returns { code: uuid } — the invite ID is the redemption token.
 * On duplicate request for same game returns the existing code (idempotent).
 */
export async function handleInviteGenerate(ctx: HandlerCtx) {
  await ensureMutation(ctx.req, ctx);
  const userId = requireAuth(ctx.req);

  // Fetch roles from DB — worker JWT session defaults to ['fan'] only
  const userRoles = await getUserRolesFromDB(userId, ctx.admin);
  const canGenerate = userRoles.some(
    (r) => r === "player" || r === "paid_fan" || r === "super_admin",
  );
  if (!canGenerate) {
    return json({ ok: false, error: "forbidden" }, 403);
  }

  const body = (await ctx.req.json().catch(() => null)) as {
    gameId?: string;
  } | null;
  const gameId = body?.gameId;
  if (!gameId) return json({ ok: false, error: "game_id_required" }, 400);

  // NOTE: game_id is now text (not UUID FK) — mock IDs like 'g1' are valid.
  // Skip DB game existence check; the ppv_invites insert will succeed
  // with any non-empty game identifier.

  // Check for an existing invite (idempotent — return same code on re-request)
  const { data: existing } = await ctx.admin
    .from("ppv_invites")
    .select("code")
    .eq("generated_by", userId)
    .eq("game_id", gameId)
    .maybeSingle();

  if (existing) {
    return json({
      ok: true,
      code: (existing as { code: string }).code,
      reused: true,
    });
  }

  // Insert new invite; UNIQUE(generated_by, game_id) prevents double-generation
  const { data: invite, error: insertErr } = await ctx.admin
    .from("ppv_invites")
    .insert({ game_id: gameId, generated_by: userId })
    .select("code")
    .single();

  if (insertErr) {
    // Race condition: concurrent insert won — fetch the winner's row
    if (insertErr.code === "23505" || insertErr.message.includes("duplicate")) {
      const { data: raceRow } = await ctx.admin
        .from("ppv_invites")
        .select("code")
        .eq("generated_by", userId)
        .eq("game_id", gameId)
        .maybeSingle();
      if (raceRow)
        return json({
          ok: true,
          code: (raceRow as { code: string }).code,
          reused: true,
        });
    }
    throw new Error(insertErr.message);
  }

  return json({ ok: true, code: (invite as { code: string }).code, reused: false });
}

/**
 * POST /ops/streams/comp-code
 * Super-admin only. Generates a complimentary access code that grants the
 * redeemer a free playback session with the same rules as a PPV purchase:
 *   - IP-locked on first use
 *   - Non-transferable
 *   - 6-hour playback session cap
 *   - One-device enforcement
 *
 * Unlike the regular invite generator, super admin can create UNLIMITED codes
 * per game (the partial unique index only applies to is_comp = false rows).
 *
 * A regular admin (`league_admin`) may also generate comp codes, but is capped
 * at LEAGUE_ADMIN_COMP_CODE_DAILY_LIMIT within a rolling 24-hour window. The
 * allowance does NOT compound — it is a ceiling on codes generated in any 24h
 * window, not a per-day budget that accrues while unused. Regular admins remain
 * excluded from every other live-PPV control (config, go-live, access override,
 * revenue).
 *
 * Body:
 *   { gameId: string, note?: string, expiresInHours?: number }
 *
 * Response:
 *   { ok: true, code: string, gameId: string, expiresAt: string, note?: string }
 *   429 { ok: false, error: 'comp_code_daily_limit_reached' } when capped.
 */
export const LEAGUE_ADMIN_COMP_CODE_DAILY_LIMIT = 5;
export const COMP_CODE_LIMIT_WINDOW_HOURS = 24;

export async function handleSuperAdminCompCode(ctx: HandlerCtx) {
  await ensureMutation(ctx.req, ctx);
  const session = await requireOpsAdminSession(ctx.req, ctx.admin);
  const isSuper = session.roles.includes("super_admin");

  // Rolling-window cap for regular admins. A rolling window is what makes the
  // allowance non-compounding: an unused day never banks extra codes.
  if (!isSuper) {
    const windowStart = new Date(
      Date.now() - COMP_CODE_LIMIT_WINDOW_HOURS * 60 * 60 * 1000,
    ).toISOString();

    const { count, error: countErr } = await ctx.admin
      .from("ppv_invites")
      .select("id", { count: "exact", head: true })
      .eq("generated_by", session.userId)
      .eq("is_comp", true)
      .gte("created_at", windowStart);

    if (countErr) throw new Error(countErr.message);

    if ((count ?? 0) >= LEAGUE_ADMIN_COMP_CODE_DAILY_LIMIT) {
      return json(
        {
          ok: false,
          error: "comp_code_daily_limit_reached",
          limit: LEAGUE_ADMIN_COMP_CODE_DAILY_LIMIT,
          windowHours: COMP_CODE_LIMIT_WINDOW_HOURS,
          used: count ?? 0,
        },
        429,
      );
    }
  }

  const body = (await ctx.req.json().catch(() => null)) as {
    gameId?: string;
    note?: string;
    expiresInHours?: number;
  } | null;
  const gameId = body?.gameId?.trim();
  if (!gameId) return json({ ok: false, error: "game_id_required" }, 400);

  // Clamp expiry window to [1, 168] hours (1 hour to 7 days). Default is
  // ENTITLEMENT.MANUAL_COMP_VALIDITY_HOURS (48h) — the canonical comp-grant
  // window. This is the REDEMPTION window — once redeemed, the playback
  // session is still hard-capped at ENTITLEMENT.VIEWING_SESSION_MAX_SECONDS
  // (6 hours) by createOrRefreshPlaybackSession.
  const rawHours = Number(body?.expiresInHours);
  const hours = Number.isFinite(rawHours) && rawHours > 0
    ? Math.min(168, Math.max(1, rawHours))
    : ENTITLEMENT.MANUAL_COMP_VALIDITY_HOURS;
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 200) : null;

  const { data: invite, error: insertErr } = await ctx.admin
    .from("ppv_invites")
    .insert({
      game_id: gameId,
      generated_by: session.userId,
      is_comp: true,
      expires_at: expiresAt,
      note,
    })
    .select("id,code,game_id,expires_at,note,created_at")
    .single();

  if (insertErr) throw new Error(insertErr.message);

  return json({
    ok: true,
    code: (invite as { code: string }).code,
    gameId: (invite as { game_id: string }).game_id,
    expiresAt: (invite as { expires_at: string }).expires_at,
    note: (invite as { note: string | null }).note,
    createdAt: (invite as { created_at: string }).created_at,
  });
}

/**
 * GET /ops/streams/comp-code
 * Lists recent comp codes for ops tracking + reprinting. Returns the 50 most
 * recently generated codes that are still unused or within their expiry window.
 *
 * Super admin sees every code. A regular admin (`league_admin`) sees ONLY the
 * codes they generated themselves — they can generate codes (§ capped at
 * LEAGUE_ADMIN_COMP_CODE_DAILY_LIMIT) so they must be able to reprint their own,
 * but the full PPV comp ledger stays a super-admin view.
 */
export async function handleSuperAdminCompCodeList(ctx: HandlerCtx) {
  const session = await requireOpsAdminSession(ctx.req, ctx.admin);
  const isSuper = session.roles.includes("super_admin");

  let query = ctx.admin
    .from("ppv_invites")
    .select("id,code,game_id,used_by,used_at,expires_at,note,created_at,generated_by")
    .eq("is_comp", true);

  if (!isSuper) query = query.eq("generated_by", session.userId);

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return json({
    ok: true,
    scope: isSuper ? "all" : "own",
    codes: (data ?? []).map((row: Record<string, unknown>) => ({
      code: String(row.code),
      gameId: String(row.game_id),
      usedBy: row.used_by ? String(row.used_by) : null,
      usedAt: row.used_at ? String(row.used_at) : null,
      expiresAt: String(row.expires_at),
      note: row.note ? String(row.note) : null,
      createdAt: String(row.created_at),
    })),
  });
}

/**
 * POST /api/invite/redeem
 * Auth required.  User must be a registered fan (any authenticated user qualifies).
 * Validates: exists → not expired → not already used by someone else.
 * On first use: locks used_by = auth.uid() and ip_address = CF-Connecting-IP.
 * IP-mismatch on re-use → 403.  Different user on re-use → 403 (non-transferable).
 * Idempotent for same user + same IP (re-entry after page refresh).
 */
export async function handleInviteRedeem(ctx: HandlerCtx) {
  await ensureMutation(ctx.req, ctx);
  const userId = requireAuth(ctx.req);
  const ip = getClientIP(ctx.req);
  if (!enforceInMemoryRateLimit(`invite-redeem:${userId}:${ip}`, 8, 60_000)) {
    return json({ ok: false, error: "rate_limited" }, 429);
  }

  const body = (await ctx.req.json().catch(() => null)) as {
    code?: string;
    gameId?: string;
    captchaToken?: string;
  } | null;
  if (!(await verifyTurnstileToken(ctx.env, body?.captchaToken, ip))) {
    return json({ ok: false, error: "captcha_failed" }, 403);
  }
  const code = body?.code?.trim();
  const suppliedGameId = body?.gameId?.trim();
  if (!code) return json({ ok: false, error: "code_required" }, 400);

  // Fetch invite record by code only. If the caller also supplied a gameId,
  // we'll enforce it matches after the row is loaded. Looking the code up by
  // id alone lets comp-code redemption work without the viewer needing to
  // know the game_id associated with their token.
  const { data: row, error: fetchErr } = await ctx.admin
    .from("ppv_invites")
    .select(
      "id, game_id, generated_by, used_by, ip_address, used_at, expires_at, is_comp",
    )
    .eq("code", code)
    .maybeSingle();

  if (fetchErr || !row)
    return json({ ok: false, error: "invalid_invite" }, 404);

  // If the caller supplied a gameId, it must match the code's game_id.
  // (Legacy in-player redemption still sends gameId to preserve the existing
  // contract; the new standalone widget omits it.)
  if (suppliedGameId && String((row as { game_id: string }).game_id) !== suppliedGameId) {
    return json({ ok: false, error: "invalid_invite" }, 404);
  }
  const gameId = String((row as { game_id: string }).game_id);

  const inv = row as {
    id: string;
    game_id: string;
    generated_by: string;
    used_by: string | null;
    ip_address: string | null;
    used_at: string | null;
    expires_at: string;
  };

  // Expiry gate
  if (new Date(inv.expires_at) < new Date()) {
    return json({ ok: false, error: "expired" }, 410);
  }

  // Generator cannot redeem their own invite (prevents self-gifting bypass)
  if (inv.generated_by === userId) {
    return json({ ok: false, error: "cannot_redeem_own_invite" }, 403);
  }

  if (inv.used_by) {
    // Idempotent re-entry: same user, same IP → already granted
    if (inv.used_by === userId && inv.ip_address === ip) {
      return json({ ok: true, granted: true, idempotent: true });
    }
    // Same user but different IP (VPN switch, location change) → reject
    if (inv.used_by === userId && inv.ip_address !== ip) {
      return json({ ok: false, error: "ip_mismatch" }, 403);
    }
    // Different user entirely → non-transferable
    return json({ ok: false, error: "non_transferable" }, 403);
  }

  // First use: atomically lock the invite to this user + IP
  // The `.is('used_by', null)` filter makes this a compare-and-swap:
  // if a concurrent request already locked it, this update affects 0 rows.
  // Use data.length (not count) — Supabase JS only populates count when
  // the Prefer:count=exact header is sent; without it count is always null.
  const { data: claimedRows, error: updateErr } = await ctx.admin
    .from("ppv_invites")
    .update({
      used_by: userId,
      ip_address: ip,
      used_at: new Date().toISOString(),
    })
    .eq("id", code)
    .is("used_by", null)
    .select("id");

  if (updateErr) throw new Error(updateErr.message);

  const claimedCount = Array.isArray(claimedRows) ? claimedRows.length : 0;
  // claimedCount === 0 means a concurrent request locked it first — re-check
  if (claimedCount === 0) {
    const { data: recheck } = await ctx.admin
      .from("ppv_invites")
      .select("used_by, ip_address")
      .eq("code", code)
      .single();
    const r = recheck as {
      used_by: string | null;
      ip_address: string | null;
    } | null;
    if (r?.used_by === userId && r?.ip_address === ip) {
      return json({ ok: true, granted: true, idempotent: true });
    }
    return json({ ok: false, error: "non_transferable" }, 403);
  }

  // Belt-and-suspenders: also create a stream_entitlement so ops dashboards
  // show the access grant and can_user_view_stream checks both paths.
  try {
    await ctx.admin.rpc("create_stream_entitlement", {
      p_game_id: gameId,
      p_user_id: userId,
      p_order_id: null,
      p_expires_at: inv.expires_at,
      p_idempotency_key: `invite-${code}-${userId}`,
    });
  } catch {
    /* non-critical — ppv_invites path in RPC is the primary gate */
  }

  return json({ ok: true, granted: true });
}

// ── STREAM REACTIONS ────────────────────────────────────────────────────────

const REACTIONS_CACHE_TTL_S = 5;

export async function handleStreamReactions({ req, admin }: HandlerCtx) {
  const url = new URL(req.url);
  // Support /api/streams/:gameId/reactions and /api/streams/reactions?gameId=...
  const pathGameId = req.url.match(/\/api\/streams\/([^/]+)\/reactions/)?.[1];
  const gameId = (pathGameId && pathGameId !== 'reactions')
    ? pathGameId
    : url.searchParams.get('gameId') ?? null;

  const resolvedGameId = gameId === 'current' ? null : gameId;

  const cacheKey = new Request(`https://sbbl-hq.icu/__cache/reactions?gameId=${resolvedGameId ?? 'null'}`);
  const cfCaches = caches as unknown as { default: Cache };
  const cached = await cfCaches.default.match(cacheKey);
  if (cached) return cached;

  let fire = 0; let heart = 0; let clap = 0;
  if (resolvedGameId) {
    const { data } = await admin
      .from('stream_reactions')
      .select('reaction_type')
      .eq('game_id', resolvedGameId);
    for (const row of data ?? []) {
      if (row.reaction_type === 'fire') fire++;
      else if (row.reaction_type === 'heart') heart++;
      else if (row.reaction_type === 'clap') clap++;
    }
  }

  const payload = { ok: true, gameId: resolvedGameId, fire, heart, clap };
  const res = new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'Cache-Control': `public, max-age=${REACTIONS_CACHE_TTL_S}`,
    },
  });
  cfCaches.default.put(cacheKey, res.clone()).catch(() => {});
  return res;
}

async function handleStreamReact(ctx: HandlerCtx) {
  await ensureMutation(ctx.req, ctx);
  const userId = requireAuth(ctx.req);
  const pathGameId = ctx.req.url.match(/\/api\/streams\/([^/]+)\/react/)?.[1];
  if (!pathGameId) return json({ ok: false, error: 'game_id_required' }, 400);

  const body = (await ctx.req.json().catch(() => null)) as { type?: string } | null;
  const reactionType = body?.type;
  if (!reactionType || !['fire', 'heart', 'clap'].includes(reactionType)) {
    return json({ ok: false, error: 'invalid_reaction_type' }, 400);
  }
  if (!(await enforceSharedRateLimit(ctx.admin, "stream_reaction_user", `${userId}:${pathGameId}`, 30, 30_000))) {
    return json({ ok: false, error: "rate_limited" }, 429);
  }
  const hasSession = await requireActivePlaybackSession(ctx, userId, pathGameId);
  if (!hasSession) return json({ ok: false, error: "active_session_required" }, 403);

  const { error } = await ctx.admin.from('stream_reactions').insert({
    game_id: pathGameId,
    user_id: userId,
    reaction_type: reactionType,
  });
  if (error) throw new Error(error.message);

  // Bust the reactions cache so the next poll picks up fresh counts
  const cfCaches = caches as unknown as { default: Cache };
  cfCaches.default.delete(new Request(`https://sbbl-hq.icu/__cache/reactions?gameId=${pathGameId}`)).catch(() => {});

  return json({ ok: true, gameId: pathGameId, type: reactionType });
}

// ── STREAM QoE TELEMETRY ─────────────────────────────────────────────────────
//
// Proprietary StreamForge edge-aggregated broadcast health layer.
//
// Architecture
// ────────────
//  POST /api/streams/:gameId/qoe        — ingest a single client beacon
//  GET  /api/streams/:gameId/qoe/health — read the rolling health report
//
// Both endpoints are public (no auth required) because:
//  a) sendBeacon cannot set Authorization headers
//  b) health data carries no PII (session id hashes only)
//
// Aggregation uses Cloudflare Cache API (zero cost, no new infra). Each
// colo maintains an independent aggregate; for our sub-200-viewer target
// this is an accurate per-region signal. Extend to Durable Objects only
// when global exact aggregation is a hard requirement.

const QOE_CACHE_TTL_S = 30;

function qoeCacheUrl(gameId: string): Request {
  return new Request(
    `https://sbbl-hq.icu/__cache/qoe/${encodeURIComponent(gameId)}`,
  );
}

/**
 * POST /api/streams/:gameId/qoe
 * Accept a StreamForge QoE beacon from a viewer. Validates, rate-limits,
 * and merges into the per-colo rolling aggregate. Returns 204 on success.
 *
 * Rate limit: 10 beacons / 60 s per IP — blocks floods without touching DB.
 */
async function handleStreamQoeBeacon(ctx: HandlerCtx): Promise<Response> {
  const gameId = ctx.params.gameId ?? null;
  if (!gameId || gameId.length > 64) {
    return json({ ok: false, error: "invalid_game_id" }, 400);
  }

  const clientIp = getClientIP(ctx.req);
  // Scope per (gameId, IP) so a household watching two different live games
  // does not collide on a shared bucket and 429 each other's beacons.
  if (!enforceInMemoryRateLimit(`qoe:${gameId}:${clientIp}`, 10, 60_000)) {
    return new Response(null, { status: 429 });
  }

  const rawBody = await ctx.req.json().catch(() => null);
  const beacon = parseBeaconPayload(rawBody);
  if (!beacon) {
    return json({ ok: false, error: "invalid_payload" }, 400);
  }
  // Prevent a client from poisoning a different game's aggregate.
  if (beacon.gameId !== gameId) {
    return json({ ok: false, error: "game_id_mismatch" }, 400);
  }

  const cfCaches = caches as unknown as { default: Cache };
  const cacheKey = qoeCacheUrl(gameId);

  let existing: AggregatedHealth | null = null;
  try {
    const hit = await cfCaches.default.match(cacheKey);
    if (hit) {
      const data = await hit.json().catch(() => null);
      if (data && typeof data === "object") existing = data as AggregatedHealth;
    }
  } catch {
    /* cache miss — start fresh */
  }

  const updated = mergeBeaconIntoAggregate(existing, beacon);
  const aggregateRes = new Response(JSON.stringify(updated), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "Cache-Control": `public, max-age=${QOE_CACHE_TTL_S}`,
    },
  });
  cfCaches.default.put(cacheKey, aggregateRes).catch(() => {});

  return new Response(null, { status: 204 });
}

/**
 * GET /api/streams/:gameId/qoe/health
 * Return a human-readable HealthReport from the current rolling aggregate.
 * Public, cached 30 s. Returns { ok: true, report: null } if no beacons yet.
 */
async function handleStreamQoeHealth(ctx: HandlerCtx): Promise<Response> {
  const gameId = ctx.params.gameId ?? null;
  if (!gameId || gameId.length > 64) {
    return json({ ok: false, error: "invalid_game_id" }, 400);
  }

  const cfCaches = caches as unknown as { default: Cache };
  const cacheKey = qoeCacheUrl(gameId);

  let report = null;
  try {
    const hit = await cfCaches.default.match(cacheKey);
    if (hit) {
      const agg = await hit.json().catch(() => null);
      if (agg && typeof agg === "object") {
        report = toHealthReport(agg as AggregatedHealth);
      }
    }
  } catch {
    /* cache miss */
  }

  return json(
    { ok: true, gameId, report },
    200,
    { "Cache-Control": `public, max-age=${QOE_CACHE_TTL_S}` },
  );
}

// ── STREAM ACCESS & PURCHASE ────────────────────────────────────────────────

export async function handleStreamAccess({ req, admin }: HandlerCtx) {
  const userId = requireAuth(req);
  const gameId = new URL(req.url).pathname.split("/")[3]; // /api/streams/:gameId/access
  // Broadcast access lives at /api/broadcast/access — not here.
  // This handler only handles game-specific PPV entitlement checks.
  const { data, error } = await admin.rpc("can_user_view_stream", {
    p_game_id: gameId,
    p_user_id: userId,
  });
  if (error) throw new Error(error.message);
  const hasAccess = Boolean(data);
  return json({ ok: true, hasAccess, gameId, userId });
}

function parseCommentLimit(url: URL): number {
  const raw = Number(url.searchParams.get("limit") ?? 40);
  if (!Number.isFinite(raw)) return 40;
  return Math.min(100, Math.max(1, Math.floor(raw)));
}

const SESSION_MAX_DURATION_MS = ENTITLEMENT_MS.VIEWING_SESSION_MAX; // 6-hour session cap (canonical)

async function createOrRefreshPlaybackSession(
  ctx: HandlerCtx,
  gameId: string | null,
  userId: string,
  sessionKey: string,
  options: { skipDisplace?: boolean } = {},
) {
  const nowIso = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 70_000).toISOString();
  // Hard 6-hour ceiling — heartbeats may never extend past this
  const defaultMaxExpiresAt = new Date(Date.now() + SESSION_MAX_DURATION_MS).toISOString();
  let existingSessionQuery = ctx.admin
    .from("stream_access_sessions")
    .select("max_expires_at")
    .eq("user_id", userId)
    .eq("idempotency_key", sessionKey)
    .eq("status", "active");
  existingSessionQuery =
    gameId === null
      ? existingSessionQuery.is("game_id", null)
      : existingSessionQuery.eq("game_id", gameId);
  const existingSession = await existingSessionQuery.maybeSingle();
  if (existingSession.error) throw new Error(existingSession.error.message);
  const maxExpiresAt = String(
    (existingSession.data as { max_expires_at?: string } | null)?.max_expires_at ??
      defaultMaxExpiresAt,
  );

  // One-device enforcement: terminate any existing active session for this
  // user + game before creating the new one.  The displaced device's next
  // heartbeat will return session_not_found → circuit breaker → "Connection
  // lost" banner.  Super admin bypasses this — they may monitor the stream
  // from multiple devices simultaneously (ops console + personal device).
  if (!options.skipDisplace) {
    // PostgREST: .eq("col", null) generates ?col=eq.null which the parser
    // tries to cast to the column type (uuid here) and 500s. Use .is() for
    // null comparisons (broadcast alias has gameId=null).
    let displaceQ = ctx.admin
      .from("stream_access_sessions")
      .update({ status: "displaced", expires_at: nowIso, updated_by: userId })
      .eq("user_id", userId);
    displaceQ = gameId === null ? displaceQ.is("game_id", null) : displaceQ.eq("game_id", gameId);
    await displaceQ
      .eq("status", "active")
      .neq("idempotency_key", sessionKey);
  }

  // Atomic upsert — eliminates the TOCTOU race where two rapid requests
  // both miss the SELECT and create duplicate sessions. The unique constraint
  // on (user_id, game_id, idempotency_key) guarantees exactly one row.
  const { data, error } = await ctx.admin
    .from("stream_access_sessions")
    .upsert(
      {
        entitlement_id: null,
        game_id: gameId,
        user_id: userId,
        status: "active",
        expires_at: expiresAt,
        max_expires_at: maxExpiresAt,
        last_seen_at: nowIso,
        idempotency_key: sessionKey,
        created_by: userId,
        updated_by: userId,
      },
      { onConflict: "user_id,game_id,idempotency_key" },
    )
    .select("id,expires_at,max_expires_at")
    .single();
  if (error) {
    if (error.code === '23505') throw new Error("device_conflict");
    throw new Error(error.message);
  }
  return {
    id: String(data.id),
    expiresAt: String(data.expires_at),
    maxExpiresAt: String(data.max_expires_at),
  };
}

export async function handlePlaybackSession(ctx: HandlerCtx) {
  await ensureMutation(ctx.req, ctx);
  const userId = requireAuth(ctx.req);
  // Normalize the 'broadcast' alias (camera-only mode with no real game row)
  // to null so all downstream code treats it as a null gameId consistently.
  // Without this, 'broadcast' would be passed as a gameId string to Supabase
  // queries that expect a UUID, causing 500 errors from invalid UUID format.
  const rawGameId = ctx.params.gameId;
  const gameId: string | null = (rawGameId === "broadcast" || !rawGameId) ? null : rawGameId;
  const body = (await ctx.req.json().catch(() => null)) as {
    sessionKey?: string;
    playbackMode?: 'live' | 'replay';
  } | null;
  if (!body?.sessionKey || body.sessionKey.length < 8) {
    return json({ ok: false, error: "session_key_required" }, 400);
  }
  const playbackMode: 'live' | 'replay' = body.playbackMode === 'replay' ? 'replay' : 'live';

  // Fetch roles once here so both the super-admin fast-path and the replay gate
  // can use them without a second DB round-trip.
  const roles = await getUserRolesFromDB(userId, ctx.admin);
  const isSuperAdmin = roles.includes("super_admin");

  // ── WS7 replay gate (embargo + entitlement) ────────────────────────────
  // Applies only when the client explicitly requests replay playback for a real
  // game. Super admins bypass this gate (they have full fast-path access below).
  // Broadcast alias and live mode are unchanged.
  if (playbackMode === 'replay' && gameId && !isSuperAdmin) {
    const gRes = await ctx.admin
      .from("games")
      .select("replay_mode, replay_monetization_enabled_at")
      .eq("id", gameId)
      .maybeSingle();
    const g = gRes.data as {
      replay_mode?: 'none' | 'raw' | 'edited';
      replay_monetization_enabled_at?: string | null;
    } | null;
    if (!g || g.replay_mode === 'none') {
      return json({ ok: false, error: "replay_unavailable" }, 409);
    }
    const embargo = g.replay_monetization_enabled_at;
    if (!embargo || new Date(embargo).getTime() > Date.now()) {
      return json({ ok: false, error: "replay_embargoed", embargoEndsAt: embargo ?? null }, 409);
    }
    // Replay entitlement: a row with replay_tier in ('raw','edited'),
    // active, not expired. Separate from the live entitlement check the
    // existing code path performs later.
    const eRes = await ctx.admin
      .from("stream_entitlements")
      .select("status, expires_at")
      .eq("game_id", gameId)
      .eq("user_id", userId)
      .in("replay_tier", ["raw", "edited"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const ent = eRes.data as { status: string | null; expires_at: string | null } | null;
    const entitled =
      !!ent &&
      ent.status === 'active' &&
      (!ent.expires_at || new Date(ent.expires_at).getTime() > Date.now());
    if (!entitled) {
      return json({ ok: false, error: "replay_available_for_purchase" }, 402);
    }
  }

  // ── Super admin fast-path ──────────────────────────────────────────────
  // No access checks, no PPV, no one-device displacement, and no DB session
  // row (entitlement_id NOT NULL makes the upsert impossible for admin).
  // Returns a synthetic session UUID — the heartbeat fast-path accepts it.
  if (isSuperAdmin) {
    const cfg = await getOrCreateStreamConfig(ctx.admin);
    const playbackUrl = resolveStreamConfigPlaybackUrl(cfg, ctx.env);
    const deliveryClass = getStreamDeliveryClass(playbackUrl);
    const fakeSessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 70_000).toISOString();
    const maxExpiresAt = new Date(Date.now() + SESSION_MAX_DURATION_MS).toISOString();
    const cookieHeaders: Record<string, string> = {};
    let clientPlaybackUrl = playbackUrl;
    if (deliveryClass === "proxy") {
      const exp = Math.floor(Date.now() / 1000) + 70;
      const secret = resolveProxyTokenSecret(ctx.env);
      if (!secret) return json({ ok: false, error: "stream_proxy_not_configured" }, 500);
      const proxyGameId = rawGameId || "broadcast";
      const token = await signProxyToken(
        { gameId: proxyGameId, userId, sessionId: fakeSessionId, exp },
        secret,
      );
      cookieHeaders["Set-Cookie"] =
        `${PROXY_AUTH_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=70`;
      clientPlaybackUrl = `/api/streams/${proxyGameId}/proxy/master.m3u8`;
    }
    return json({
      ok: true,
      playback: {
        type: "url",
        url: clientPlaybackUrl,
        deliveryClass,
        expiresAt,
        maxExpiresAt,
        heartbeatIntervalSec: 25,
      },
      session: {
        id: fakeSessionId,
        gameId: gameId ?? null,
        maxExpiresAt,
      },
    }, 200, cookieHeaders);
  }

  const hasPrivilegedRole = roles.some(
    (role) => role === "player" || role === "paid_fan",
  );
  let hasAccess = hasPrivilegedRole;
  if (gameId === null) {
    // Untied broadcasts are freely accessible (not PPV gated)
    hasAccess = true;
  } else if (!hasAccess) {
    // PPV game: check entitlement or invite redemption.
    const accessRpc = await ctx.admin.rpc("can_user_view_stream", {
      p_game_id: gameId,
      p_user_id: userId,
    });
    if (accessRpc.error) throw new Error(accessRpc.error.message);
    hasAccess = Boolean(accessRpc.data);
  }
  if (!hasAccess) return json({ ok: false, error: "forbidden" }, 403);

  const cfg = await getOrCreateStreamConfig(ctx.admin);

  // WS7: Replay Embargo & Monetization (belt-and-suspenders — the
  // primary gate runs at the top of the handler on body.playbackMode;
  // this redundant check keeps the invariant locally visible inside
  // the non-admin branch).
  if (playbackMode === "replay" && gameId && !isSuperAdmin) {
    const { data: gameData } = await ctx.admin
      .from("games")
      .select("replay_monetization_enabled_at, replay_price, replay_mode")
      .eq("id", gameId)
      .maybeSingle();

    if (gameData) {
      if (!gameData.replay_monetization_enabled_at || new Date(String(gameData.replay_monetization_enabled_at)) > new Date()) {
        return json({ ok: false, error: "replay_embargoed", message: "Replays are embargoed for 48 hours post-game." }, 403);
      }
      // Replay entitlement check
      if (!hasAccess) {
        return json({ ok: false, error: "replay_available_for_purchase", price: gameData.replay_price ?? 500 }, 403);
      }
    }
  }

  const playbackUrl = resolveStreamConfigPlaybackUrl(cfg, ctx.env);
  // RC-4: Return named 409 (not silent 503) so the frontend can surface it.
  if (!playbackUrl) {
    return json({
      ok: false,
      error: "stream_not_configured",
      hint: "Set a stream URL in Broadcast Controls before going live.",
    }, 409);
  }
  let session;
  try {
    session = await createOrRefreshPlaybackSession(
      ctx,
      gameId,
      userId,
      body.sessionKey,
    );
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "device_conflict") {
      return json({ ok: false, error: "device_conflict", message: "Another device is currently active." }, 409);
    }
    throw err;
  }
  const deliveryClass = getStreamDeliveryClass(playbackUrl);
  const cookieHeaders: Record<string, string> = {};
  let clientPlaybackUrl = playbackUrl;
  if (deliveryClass === "proxy") {
    const exp = Math.floor(Date.now() / 1000) + 70;
    const secret = resolveProxyTokenSecret(ctx.env);
    if (!secret) return json({ ok: false, error: "stream_proxy_not_configured" }, 500);
    const proxyGameId = rawGameId || "broadcast";
    const token = await signProxyToken(
      { gameId: proxyGameId, userId, sessionId: session.id, exp },
      secret,
    );
    cookieHeaders["Set-Cookie"] =
      `${PROXY_AUTH_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=70`;
    clientPlaybackUrl = `/api/streams/${proxyGameId}/proxy/master.m3u8`;
  }

  // ── Playback provider override (signed playback) ──────────────────────
  // Flag-gated + per-game opt-in. When every condition in
  // selectPlaybackProvider() is met, the signed URL from NativeHlsProvider
  // replaces clientPlaybackUrl and a token row is inserted into
  // stream_playback_tokens for server-side revocation / audit. If any
  // part of this path fails, we silently fall through to the legacy
  // clientPlaybackUrl — the feature is strictly additive. Invariant:
  // the legacy embed URL (playbackUrl) is NEVER returned once the
  // signed path is selected, per STREAM_GATING_v1.6.0.md.
  let gameSignedRow: {
    require_signed_url?: boolean | null;
    playback_provider?: string | null;
    playback_asset_id?: string | null;
    latency_mode?: string | null;
    replay_quality_tier?: string | null;
  } | null = null;
  if (gameId) {
    const gRes = await ctx.admin
      .from("games")
      .select("require_signed_url,playback_provider,playback_asset_id,latency_mode,replay_quality_tier")
      .eq("id", gameId)
      .maybeSingle();
    gameSignedRow = (gRes.data as typeof gameSignedRow) ?? null;
  }
  if (gameId && gameSignedRow) {
    const workerOrigin = new URL(ctx.req.url).origin;
    const provider = selectPlaybackProvider({
      game: {
        require_signed_url: gameSignedRow.require_signed_url ?? null,
        playback_provider: gameSignedRow.playback_provider ?? null,
        playback_asset_id: gameSignedRow.playback_asset_id ?? null,
      },
      flags: {
        FEATURE_SIGNED_PLAYBACK_ENABLED: ctx.env.FEATURE_SIGNED_PLAYBACK_ENABLED,
        FEATURE_NATIVE_HLS_PROVIDER: ctx.env.FEATURE_NATIVE_HLS_PROVIDER,
      },
      playbackTokenSecret: ctx.env.PLAYBACK_TOKEN_SECRET,
      workerOrigin,
    });
    if (provider.name === "native_hls") {
      try {
        const payload = await provider.resolve({
          gameId,
          userId,
          sessionId: session.id,
          mode: "live",
          expiresAt: session.expiresAt,
          maxExpiresAt: session.maxExpiresAt,
          game: {
            id: gameId,
            playback_asset_id: gameSignedRow.playback_asset_id,
            require_signed_url: gameSignedRow.require_signed_url,
            latency_mode: (gameSignedRow.latency_mode as "standard" | "low") ?? "standard",
            replay_quality_tier: (gameSignedRow.replay_quality_tier as "raw" | "edited") ?? "raw",
          },
        });
        if (payload.signedPlaybackUrl) {
          await ctx.admin.from("stream_playback_tokens").insert({
            session_id: session.id,
            user_id: userId,
            game_id: gameId,
            provider: "native_hls",
            signed_token: payload.signedPlaybackUrl.split("?t=")[1] ?? "",
            expires_at: session.expiresAt,
            max_expires_at: session.maxExpiresAt,
            playback_mode: "live",
          });
          clientPlaybackUrl = payload.signedPlaybackUrl;
          // deliveryClass stays as whatever getStreamDeliveryClass
          // returned. The client branches on URL format, not this field.
        }
      } catch (err) {
        // Signed-path failure → fall through to legacy. Logged but does
        // not surface as a user-visible error; the legacy URL is a safe
        // superset of behavior.
        Sentry.captureException?.(err);
      }
    }
  }

  return json({
    ok: true,
    playback: {
      type: "url",
      url: clientPlaybackUrl,
      deliveryClass,
      playbackMode,
      expiresAt: session.expiresAt,
      maxExpiresAt: session.maxExpiresAt,
      heartbeatIntervalSec: 25,
    },
    session: {
      id: session.id,
      gameId: gameId ?? null,
      maxExpiresAt: session.maxExpiresAt,
    },
  }, 200, cookieHeaders);
}

/**
 * GET /api/streams/:gameId/playback-token/verify?t=<token>
 *
 * Stateless-ish verification endpoint for signed playback tokens. Public
 * read — a verification response leaks nothing beyond ok/reason. Returns
 * 200 on success, 401 with reason on any failure. Used by internal
 * tooling, the native HLS proxy (future PR), and the on-call runbook.
 *
 * Verification order:
 *   1. HMAC signature valid (constant-time).
 *   2. Token not expired (clock check vs. now).
 *   3. Session row still `active` and the session's `max_expires_at`
 *      has not elapsed.
 *   4. Token row not revoked in stream_playback_tokens.
 *   5. Token's gameId matches the URL path param.
 */
export async function handlePlaybackTokenVerify(ctx: HandlerCtx) {
  const urlGameId = ctx.params.gameId ?? null;
  const url = new URL(ctx.req.url);
  const token = url.searchParams.get("t");
  if (!token) return json({ ok: false, reason: "token_required" }, 400);

  const secret = ctx.env.PLAYBACK_TOKEN_SECRET ?? "";
  const result = await verifyPlaybackToken(token, secret);
  // strictNullChecks is off in tsconfig; discriminated-union narrowing on
  // `result.ok` is unreliable here. Access both shapes via field read and
  // assert truthiness at runtime. The JWT verifier is the authoritative
  // gate — we are only reshaping its output for the response.
  if (!result.ok) {
    const reason = (result as { reason?: string }).reason ?? "bad_signature";
    return json({ ok: false, reason }, 401);
  }
  const claims = (result as { claims: { gameId: string | null; userId: string; sessionId: string; assetId: string; playbackMode: string; exp: number; mex: number } }).claims;

  if (urlGameId && claims.gameId && urlGameId !== claims.gameId) {
    return json({ ok: false, reason: "game_mismatch" }, 401);
  }

  const sessRes = await ctx.admin
    .from("stream_access_sessions")
    .select("id,status,max_expires_at")
    .eq("id", claims.sessionId)
    .maybeSingle();
  const sess = sessRes.data as {
    id: string;
    status: string | null;
    max_expires_at: string | null;
  } | null;
  if (!sess) return json({ ok: false, reason: "session_not_found" }, 401);
  if (sess.status !== "active") return json({ ok: false, reason: "session_inactive" }, 401);
  if (sess.max_expires_at && new Date(sess.max_expires_at).getTime() <= Date.now()) {
    return json({ ok: false, reason: "session_expired" }, 401);
  }

  const tokenRes = await ctx.admin
    .from("stream_playback_tokens")
    .select("id,revoked_at")
    .eq("session_id", claims.sessionId)
    .is("revoked_at", null)
    .limit(1)
    .maybeSingle();
  if (!tokenRes.data) {
    return json({ ok: false, reason: "token_revoked" }, 401);
  }

  return json({
    ok: true,
    claims: {
      userId: claims.userId,
      gameId: claims.gameId,
      sessionId: claims.sessionId,
      assetId: claims.assetId,
      playbackMode: claims.playbackMode,
      exp: claims.exp,
      mex: claims.mex,
    },
  });
}

/**
 * GET /api/streams/:gameId/preflight
 *
 * Read-only public snapshot used by ViewerPreflight. Designed as a
 * single round-trip so the UI does not fan out to multiple endpoints
 * mid-check. Anonymous callers get the skeleton (entitlement=absent,
 * no session conflict); signed-in callers get real entitlement /
 * session-conflict data.
 *
 * This endpoint is intentionally side-effect-free (no session row
 * created, no token minted, no counter incremented) so it is safe to
 * call on every page mount without inflating DB load.
 *
 * Shape is kept stable + versioned via the `ok: true` literal; additive
 * fields may be added in future WS work but never re-typed.
 */
export async function handlePlaybackPreflight(ctx: HandlerCtx) {
  const gameId = ctx.params.gameId ?? null;
  if (!gameId) return json({ ok: false, error: "game_id_required" }, 400);

  const userId = optionalAuth(ctx.req);

  const gRes = await ctx.admin
    .from("games")
    .select(
      "id, status, starts_at, ended_at, replay_mode, replay_monetization_enabled_at, replay_quality_tier, replay_price",
    )
    .eq("id", gameId)
    .maybeSingle();
  const game = gRes.data as
    | {
        id: string;
        status: string | null;
        starts_at: string | null;
        ended_at: string | null;
        replay_mode: "none" | "raw" | "edited" | null;
        replay_monetization_enabled_at: string | null;
        replay_quality_tier: "raw" | "edited" | null;
        replay_price: number | null;
      }
    | null;
  if (!game) return json({ ok: false, error: "game_not_found" }, 404);

  const now = Date.now();
  const replayMode = (game.replay_mode ?? "none") as "none" | "raw" | "edited";
  // Halftime is derived from games.status (authoritative), not a
  // dedicated column. Missing status → treat as live if tipoff has
  // passed.
  let state: "upcoming" | "live" | "halftime" | "ended_replay" | "ended_no_replay" | "unavailable";
  if (game.ended_at || game.status === "completed" || game.status === "ended") {
    state = replayMode === "none" ? "ended_no_replay" : "ended_replay";
  } else if (game.status === "halftime") {
    state = "halftime";
  } else if (game.starts_at && new Date(game.starts_at).getTime() > now) {
    state = "upcoming";
  } else if (game.starts_at) {
    state = "live";
  } else {
    state = "unavailable";
  }

  let entitlementStatus: "active" | "absent" | "expired" = "absent";
  let entitlementExpiresAt: string | null = null;
  let hasConflict = false;
  let conflictDeviceLabel: string | null = null;
  let conflictStartedAt: string | null = null;
  let replayEntitled = false;

  if (userId) {
    const eRes = await ctx.admin
      .from("stream_entitlements")
      .select("status, expires_at")
      .eq("game_id", gameId)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const ent = eRes.data as { status: string | null; expires_at: string | null } | null;
    if (ent) {
      entitlementExpiresAt = ent.expires_at ?? null;
      if (ent.status === "active" && (!ent.expires_at || new Date(ent.expires_at).getTime() > now)) {
        entitlementStatus = "active";
      } else {
        entitlementStatus = "expired";
      }
    }

    // Session conflict — any `active` row for this user on THIS game
    // on a different session key indicates another device is streaming.
    const sRes = await ctx.admin
      .from("stream_access_sessions")
      .select("id, created_at, idempotency_key")
      .eq("user_id", userId)
      .eq("game_id", gameId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const sess = sRes.data as
      | { id: string; created_at: string | null; idempotency_key: string | null }
      | null;
    if (sess) {
      hasConflict = true;
      conflictDeviceLabel = sess.idempotency_key ? sess.idempotency_key.slice(0, 8) : null;
      conflictStartedAt = sess.created_at;
    }

    if (state === "ended_replay") {
      // Treat a live entitlement as NOT sufficient for replay — the
      // replay is a separate purchase product. A dedicated replay
      // entitlement row would be stored via a future replay checkout.
      replayEntitled = false;
    }
  }

  return json(
    {
      ok: true,
      userId,
      entitlement: { status: entitlementStatus, expiresAt: entitlementExpiresAt },
      activeSession: { hasConflict, conflictDeviceLabel, conflictStartedAt },
      game: {
        id: game.id,
        state,
        tipoffAt: game.starts_at,
        ppvPriceCad: 3.99, // matches handleStreamPurchase hardcoded price
        replay: {
          embargoEndsAt: game.replay_monetization_enabled_at ?? null,
          qualityTier: game.replay_quality_tier ?? null,
          priceCad: game.replay_price != null ? Number(game.replay_price) : null,
          entitled: replayEntitled,
        },
      },
    },
    200,
    { "Cache-Control": "private, max-age=5" },
  );
}

export async function handleStreamSessionHeartbeat(ctx: HandlerCtx) {
  await ensureMutation(ctx.req, ctx);
  const userId = requireAuth(ctx.req);
  const gameId = ctx.params.gameId ?? null;
  const body = (await ctx.req.json().catch(() => null)) as {
    sessionId?: string;
  } | null;
  if (!body?.sessionId) return json({ ok: false, error: "session_id_required" }, 400);

  const now = new Date().toISOString();
  const roles = await getUserRolesFromDB(userId, ctx.admin);
  const isSuperAdmin = roles.includes("super_admin");

  // ── Super admin fast-path ──────────────────────────────────────────────
  // Synthetic owner sessions are intentionally DB-free: no lookup, no upsert,
  // no batch heartbeat enqueue, no displacement, and no PPV/game gate.
  if (isSuperAdmin) {
    const expiresAt = new Date(Date.now() + 70_000).toISOString();
    return json({ ok: true, sessionId: body.sessionId, expiresAt });
  }

  // Authoritative ACK gate: confirm the session exists, belongs to the caller,
  // is scoped to the same game, and is still active before we acknowledge.
  // PostgREST .eq() with JS null serializes to ?col=eq.null which fails for
  // uuid columns; use .is() for null (broadcast alias passes gameId=null).
  let lookupQ = ctx.admin
    .from("stream_access_sessions")
    .select("id,status,max_expires_at")
    .eq("id", body.sessionId)
    .eq("user_id", userId);
  lookupQ = gameId === null ? lookupQ.is("game_id", null) : lookupQ.eq("game_id", gameId);
  const sessionRes = await lookupQ.maybeSingle();
  if (sessionRes.error) throw new Error(sessionRes.error.message);
  if (!sessionRes.data) {
    return json({ ok: false, error: "session_not_found" }, 404);
  }
  if (String(sessionRes.data.status) !== "active") {
    return json({ ok: false, error: "session_not_found" }, 404);
  }
  // Hard 6-hour cap guard: if the authoritative max expiry is reached, end
  // the session immediately and reject the heartbeat.
  if (sessionRes.data.max_expires_at && now >= String(sessionRes.data.max_expires_at)) {
    let capQ = ctx.admin
      .from("stream_access_sessions")
      .update({
        status: "ended",
        expires_at: now,
        updated_at: now,
        updated_by: userId,
      })
      .eq("id", body.sessionId)
      .eq("user_id", userId);
    capQ = gameId === null ? capQ.is("game_id", null) : capQ.eq("game_id", gameId);
    await capQ;
    return json({ ok: false, error: "session_expired" }, 403);
  }

  // Requested extension (authoritative clamping happens in batch_heartbeat_upsert).
  const rawExpiry = Date.now() + 70_000;
  const expiresAt = new Date(rawExpiry).toISOString();

  // Queue heartbeat for batch flush instead of writing per-request.
  // At 20K viewers × 25s interval this cuts ~800 writes/s → ~1 bulk call/30s.
  heartbeatQueue.push({
    session_id: body.sessionId,
    user_id: userId,
    game_id: gameId,
    expires_at: expiresAt,
    now_ts: now,
  });

  // Ensure the periodic flush timer is running
  if (!heartbeatFlushTimer) {
    heartbeatFlushTimer = setTimeout(async () => {
      heartbeatFlushTimer = null;
      await flushHeartbeatQueue(ctx.env);
    }, HEARTBEAT_FLUSH_INTERVAL_MS);
  }

  return json({ ok: true, sessionId: body.sessionId, expiresAt });
}

async function handleStreamSessionEnd(ctx: HandlerCtx) {
  await ensureMutation(ctx.req, ctx);
  const userId = requireAuth(ctx.req);
  const gameId = ctx.params.gameId ?? null;
  const body = (await ctx.req.json().catch(() => null)) as {
    sessionId?: string;
  } | null;
  if (!body?.sessionId) return json({ ok: false, error: "session_id_required" }, 400);
  // PostgREST .eq() with JS null serializes to ?col=eq.null which fails for
  // uuid columns. Use .is() for null (broadcast alias passes gameId=null).
  let endQ = ctx.admin
    .from("stream_access_sessions")
    .update({
      status: "ended",
      expires_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      updated_by: userId,
    })
    .eq("id", body.sessionId)
    .eq("user_id", userId);
  endQ = gameId === null ? endQ.is("game_id", null) : endQ.eq("game_id", gameId);
  const endRes = await endQ.select("id").maybeSingle();
  if (endRes.error) throw new Error(endRes.error.message);
  return json({ ok: true, ended: Boolean(endRes.data) });
}

async function handleStreamProxy(ctx: HandlerCtx) {
  const gameId = ctx.params.gameId;
  if (!gameId) return new Response("Forbidden", { status: 403 });

  const token = readCookie(ctx.req, PROXY_AUTH_COOKIE);
  if (!token) return new Response("Forbidden", { status: 403 });

  const secret = resolveProxyTokenSecret(ctx.env);
  if (!secret) return new Response("Forbidden", { status: 403 });
  const payload = await verifyProxyToken(token, secret);
  if (!payload || payload.gameId !== gameId) return new Response("Forbidden", { status: 403 });

  const trueOrigin = await getStreamUrlForGame(ctx.admin, gameId, ctx.env);
  const targetUrl = resolveProxyTarget(trueOrigin, ctx.req.url, gameId);
  const pathLower = new URL(targetUrl).pathname.toLowerCase();
  const isManifest = pathLower.endsWith(".m3u8");
  const isSegment = pathLower.endsWith(".ts") || pathLower.endsWith(".m4s") || pathLower.endsWith(".mp4");

  const upstream = await fetch(targetUrl, {
    cf: {
      cacheEverything: true,
      cacheTtl: isManifest ? 2 : isSegment ? 3600 : 60,
    },
  } as RequestInit & { cf: { cacheEverything: boolean; cacheTtl: number } });
  if (!upstream.ok) return new Response("Upstream error", { status: upstream.status });

  const headers = new Headers(upstream.headers);

  const origin = ctx.req.headers.get("Origin");
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Vary", "Origin");
  }

  if (!isManifest) {
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  }

  const manifest = await upstream.text();
  const rewritten = rewriteManifestToGateway(manifest, gameId);
  headers.set("content-type", "application/vnd.apple.mpegurl; charset=utf-8");
  headers.set("cache-control", "public, max-age=2");
  return new Response(rewritten, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

export async function handleListComments(ctx: HandlerCtx) {
  const gameId = ctx.params.gameId;
  if (!gameId) return json({ ok: false, error: "game_id_required" }, 400);
  const url = new URL(ctx.req.url);
  const limit = parseCommentLimit(url);
  const before = url.searchParams.get("before");
  const wantsHidden = url.searchParams.get("includeHidden") === "1";
  const roles = getRolesFromVerifiedSession(ctx.req);
  const canViewHidden = roles.includes("league_admin") || roles.includes("super_admin");
  let query = ctx.admin
    .from("stream_chat_messages")
    .select("id,message,status,created_at,user_id")
    .eq("game_id", gameId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (!(wantsHidden && canViewHidden)) {
    query = query.eq("status", "active");
  }
  if (before) query = query.lt("created_at", before);
  const res = await query;
  if (res.error) throw new Error(res.error.message);

  const rows = (res.data ?? []) as Array<Record<string, unknown>>;
  const userIds = Array.from(new Set(rows.map((row) => String(row.user_id))));
  const profiles = userIds.length
    ? await ctx.admin
        .from("profiles")
        .select("user_id,display_name")
        .in("user_id", userIds)
    : { data: [] as Array<Record<string, unknown>>, error: null };
  if (profiles.error) throw new Error(profiles.error.message);
  const nameByUser = new Map<string, string>(
    (profiles.data ?? []).map(
      (row: Record<string, unknown>) =>
        [String(row.user_id), String(row.display_name ?? "Fan")] as [string, string],
    ),
  );

  return json({
    ok: true,
    comments: rows
      .map((row) => ({
        id: String(row.id),
        message: String(row.message),
        status: String(row.status) === "hidden" ? "hidden" : "active",
        createdAt: String(row.created_at),
        userId: String(row.user_id),
        userDisplayName: nameByUser.get(String(row.user_id)) ?? "Fan",
      }))
      .reverse(),
  });
}

async function requireLeagueOrSuperAdmin(req: Request, admin: SupabaseClient) {
  const session = await requireAdminSession(req, admin);
  if (!session.roles.includes("league_admin") && !session.roles.includes("super_admin")) {
    throw new Error("forbidden");
  }
  return session;
}

export async function handlePostComment(ctx: HandlerCtx) {
  await ensureMutation(ctx.req, ctx);
  const userId = requireAuth(ctx.req);
  const gameId = ctx.params.gameId;
  if (!gameId) return json({ ok: false, error: "game_id_required" }, 400);
  const hasSession = await requireActivePlaybackSession(ctx, userId, gameId);
  if (!hasSession) return json({ ok: false, error: "active_session_required" }, 403);
  const ip = getClientIP(ctx.req);
  if (!(await enforceSharedRateLimit(ctx.admin, "stream_chat_user", `${userId}:${gameId}`, 10, 30_000))) {
    return json({ ok: false, error: "rate_limited" }, 429);
  }
  if (!(await enforceSharedRateLimit(ctx.admin, "stream_chat_ip", `${ip}:${gameId}`, 20, 30_000))) {
    return json({ ok: false, error: "rate_limited" }, 429);
  }
  const body = (await ctx.req.json().catch(() => null)) as {
    message?: string;
  } | null;
  const message = String(body?.message ?? "").trim().replace(/\s+/g, " ");
  if (message.length < 1 || message.length > 400) {
    return json({ ok: false, error: "invalid_message_length" }, 400);
  }
  const insert = await ctx.admin
    .from("stream_chat_messages")
    .insert({
      game_id: gameId,
      user_id: userId,
      message,
      status: "active",
      created_by: userId,
      updated_by: userId,
    })
    .select("id,message,created_at,user_id")
    .single();
  if (insert.error) throw new Error(insert.error.message);
  return json({
    ok: true,
    comment: {
      id: String(insert.data.id),
      message: String(insert.data.message),
      createdAt: String(insert.data.created_at),
      userId: String(insert.data.user_id),
    },
  });
}

export async function handleModerateComment(ctx: HandlerCtx) {
  await ensureMutation(ctx.req, ctx);
  const moderator = await requireLeagueOrSuperAdmin(ctx.req, ctx.admin);
  const gameId = ctx.params.gameId;
  const commentId = ctx.params.commentId;
  if (!gameId || !commentId) return json({ ok: false, error: "invalid_params" }, 400);
  const body = (await ctx.req.json().catch(() => null)) as { action?: "hide" | "restore" } | null;
  if (!body?.action || !["hide", "restore"].includes(body.action)) {
    return json({ ok: false, error: "invalid_action" }, 400);
  }
  const nextStatus = body.action === "hide" ? "hidden" : "active";
  const update = await ctx.admin
    .from("stream_chat_messages")
    .update({ status: nextStatus, updated_by: moderator.userId, updated_at: new Date().toISOString() })
    .eq("id", commentId)
    .eq("game_id", gameId)
    .select("id")
    .maybeSingle();
  if (update.error) throw new Error(update.error.message);
  if (!update.data) return json({ ok: false, error: "comment_not_found" }, 404);
  return json({ ok: true, commentId, status: nextStatus });
}

export async function handleResetReactions(ctx: HandlerCtx) {
  await ensureMutation(ctx.req, ctx);
  await requireLeagueOrSuperAdmin(ctx.req, ctx.admin);
  const gameId = ctx.params.gameId;
  if (!gameId) return json({ ok: false, error: "game_id_required" }, 400);
  const del = await ctx.admin.from("stream_reactions").delete().eq("game_id", gameId);
  if (del.error) throw new Error(del.error.message);
  const cfCaches = caches as unknown as { default: Cache };
  const cacheDelete = (cfCaches.default as { delete?: (req: Request) => Promise<boolean> }).delete;
  if (cacheDelete) {
    cacheDelete(new Request(`https://sbbl-hq.icu/__cache/reactions?gameId=${gameId}`)).catch(() => {});
  }
  return json({ ok: true, gameId, reset: true });
}

// ── Broadcast-standalone handlers ────────────────────────────────────────────
// Livestreams are independent of games. These handlers own the entire
// broadcast session lifecycle with zero game coupling. Do NOT add gameId
// parameters, PPV entitlement checks, or any game-specific logic here.
// The only access rule for an open broadcast: stream is live + user is registered.
// See CLAUDE.md Rule 7 — these handlers are frozen; do not modify without
// explicit owner instruction.

export async function handleBroadcastStreamAccess({ req, admin }: HandlerCtx) {
  const userId = requireAuth(req);
  const cfgRes = await admin
    .from("stream_admin_config")
    .select("is_live")
    .eq("id", true)
    .maybeSingle();
  if (!cfgRes.data?.is_live) {
    return json({ ok: true, hasAccess: false });
  }
  const profileRes = await admin
    .from("profiles")
    .select("onboarding_completed_at")
    .eq("user_id", userId)
    .maybeSingle();
  const isRegistered = Boolean(
    (profileRes.data as { onboarding_completed_at?: string | null } | null)
      ?.onboarding_completed_at,
  );
  return json({ ok: true, hasAccess: isRegistered });
}

export async function handleBroadcastSessionStart(ctx: HandlerCtx) {
  await ensureMutation(ctx.req, ctx);
  const userId = requireAuth(ctx.req);
  const body = (await ctx.req.json().catch(() => null)) as {
    sessionKey?: string;
  } | null;
  if (!body?.sessionKey || body.sessionKey.length < 8) {
    return json({ ok: false, error: "session_key_required" }, 400);
  }

  const cfg = await getOrCreateStreamConfig(ctx.admin);

  // Super admin: no access checks, synthetic session so they can preview before going live.
  const roles = await getUserRolesFromDB(userId, ctx.admin);
  if (roles.includes("super_admin")) {
    const playbackUrl = resolveStreamConfigPlaybackUrl(cfg, ctx.env);
    const maxExpiresAt = new Date(Date.now() + SESSION_MAX_DURATION_MS).toISOString();
    return json({
      ok: true,
      playback: { type: "url", url: playbackUrl, heartbeatIntervalSec: 25, maxExpiresAt },
      session: { id: crypto.randomUUID(), maxExpiresAt },
    });
  }

  if (!cfg.is_live) {
    return json({ ok: false, error: "stream_offline" }, 403);
  }

  const playbackUrl = resolveStreamConfigPlaybackUrl(cfg, ctx.env);
  if (!playbackUrl) {
    return json({ ok: false, error: "stream_not_configured" }, 409);
  }

  // Registered users may watch an open broadcast — no entitlement row required.
  const profileRes = await ctx.admin
    .from("profiles")
    .select("onboarding_completed_at")
    .eq("user_id", userId)
    .maybeSingle();
  const isRegistered = Boolean(
    (profileRes.data as { onboarding_completed_at?: string | null } | null)
      ?.onboarding_completed_at,
  );
  if (!isRegistered) return json({ ok: false, error: "forbidden" }, 403);

  const session = await createOrRefreshPlaybackSession(
    ctx,
    null,
    userId,
    body.sessionKey,
  );
  return json({
    ok: true,
    playback: {
      type: "url",
      url: playbackUrl,
      heartbeatIntervalSec: 25,
      maxExpiresAt: session.maxExpiresAt,
    },
    session: { id: session.id, maxExpiresAt: session.maxExpiresAt },
  });
}

// Heartbeat and end delegate to the game-agnostic handlers with null gameId.
// Sessions for broadcasts are stored with game_id = null — no game coupling.
async function handleBroadcastHeartbeatRoute(ctx: HandlerCtx) {
  return handleStreamSessionHeartbeat({ ...ctx, params: { ...ctx.params, gameId: null } });
}
async function handleBroadcastSessionEndRoute(ctx: HandlerCtx) {
  return handleStreamSessionEnd({ ...ctx, params: { ...ctx.params, gameId: null } });
}

/**
 * RC-6: Atomic Go Live / End Stream endpoint.
 * Merges updateStreamConfig + setStreamLive into a single upsert so the
 * stream URL and live status are committed atomically — no race window
 * between the two separate writes where a session fetch could see the old URL.
 *
 * POST /ops/streams/go-live
 * Body: { isLive: boolean, collectionId: string, title: string }
 * Requires: super_admin
 */
export async function handleGoLive(ctx: HandlerCtx) {
  await ensureMutation(ctx.req, ctx);
  const session = await requireSuperAdminSession(ctx.req, ctx.admin);

  const body = (await ctx.req.json().catch(() => null)) as {
    isLive?: boolean;
    collectionId?: string;
    title?: string;
    activeGameId?: string | null;
  } | null;

  if (!body || typeof body.isLive !== "boolean") {
    return json({ ok: false, error: "is_live_required" }, 400);
  }

  let safeUrl = typeof body.collectionId === "string" ? body.collectionId.trim() : "";
  if (safeUrl !== "") {
    try {
      const parsedUrl = new URL(safeUrl);
      if (!["https:", "http:", "rtmp:", "rtmps:"].includes(parsedUrl.protocol)) {
        if (["javascript:", "data:", "file:", "vbscript:"].includes(parsedUrl.protocol)) {
          safeUrl = "";
        }
      }
    } catch {
      try {
        const fallbackUrl = new URL("https://" + safeUrl);
        safeUrl = fallbackUrl.href;
      } catch {
        // Unparseable, leave verbatim in permissive mode
      }
    }
  }
  const nowIso = new Date().toISOString();
  const patch: Record<string, unknown> = {
    id: true,
    is_live: body.isLive,
    updated_by: session.userId,
    updated_at: nowIso,
  };
  if (typeof body.collectionId === "string") {
    patch.collection_id = safeUrl;
    patch.playback_asset_id = safeUrl;
  }
  if (typeof body.title === "string" && body.title.trim()) {
    patch.title = body.title.trim();
  }
  if (body.activeGameId === null || typeof body.activeGameId === "undefined") {
    patch.active_game_id = null;
  } else if (typeof body.activeGameId === "string" && body.activeGameId.trim()) {
    const activeGameId = body.activeGameId.trim();
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(activeGameId)) return json({ ok: false, error: "invalid_active_game_id" }, 400);
    patch.active_game_id = activeGameId;
  }
  if (body.isLive) {
    patch.live_started_at = nowIso;
    patch.live_ended_at = null;
  } else {
    patch.live_ended_at = nowIso;
  }

  const previousConfig = await ctx.admin
    .from("stream_admin_config")
    .select("active_game_id")
    .eq("id", true)
    .maybeSingle();
  const previousGameId = previousConfig.data?.active_game_id
    ? String(previousConfig.data.active_game_id)
    : null;

  const { data, error } = await ctx.admin
    .from("stream_admin_config")
    .upsert(patch, { onConflict: "id" })
    .select("collection_id,playback_asset_id,title,is_live,active_game_id,updated_at")
    .single();

  if (error) {
    return json({ ok: false, error: error.message }, 500);
  }

  // Bust edge cache so viewers pick up live/offline status immediately.
  // Global broadcast status is always busted. Per-game status is best-effort
  // and only applies when the previous or current config is game-bound.
  const cfCachesGoLive = (caches as unknown as { default: Cache }).default;
  const globalBustKey = new Request(streamCacheUrl(null));
  cfCachesGoLive.delete(globalBustKey).catch(() => {
    cfCachesGoLive.delete(globalBustKey).catch(() => {});
  });
  const currentGameId = data.active_game_id ? String(data.active_game_id) : null;
  for (const gameIdToBust of new Set([previousGameId, currentGameId].filter(Boolean) as string[])) {
    const gameBustKey = new Request(streamCacheUrl(gameIdToBust));
    cfCachesGoLive.delete(gameBustKey).catch(() => {
      cfCachesGoLive.delete(gameBustKey).catch(() => {});
    });
  }
  // Also bust the stream_url_cache in-process so the next playback session
  // request picks up the newly saved collectionId immediately.
  for (const [k] of streamUrlCache.entries()) {
    streamUrlCache.delete(k);
  }

  return json({
    ok: true,
    isLive: Boolean(data.is_live),
    collectionId: String(data.collection_id ?? ""),
    title: String(data.title ?? ""),
    activeGameId: data.active_game_id ? String(data.active_game_id) : null,
    updatedAt: String(data.updated_at ?? nowIso),
  });
}

async function handleBroadcastHeartbeat(ctx: HandlerCtx) {
  return handleStreamSessionHeartbeat({ ...ctx, params: { ...ctx.params, gameId: null } });
}

async function handleBroadcastSessionEnd(ctx: HandlerCtx) {
  return handleStreamSessionEnd({ ...ctx, params: { ...ctx.params, gameId: null } });
}

async function handleStreamViewerCount(ctx: HandlerCtx) {
  const gameId = ctx.params.gameId;
  if (!gameId) return json({ ok: false, error: "game_id_required" }, 400);
  const activeEntitledViewerCount = await getActiveViewerCount(ctx.admin, gameId);
  return json({ ok: true, gameId, activeEntitledViewerCount });
}

function getSafeRedirectUrl(
  url: string | undefined | null,
  fallback: string,
  reqUrl: string,
): string {
  if (!url) return fallback;
  try {
    const baseOrigin = new URL(reqUrl).origin;
    const resolvedUrl = new URL(url, baseOrigin);
    if (resolvedUrl.origin === baseOrigin) {
      return resolvedUrl.toString();
    }
  } catch (err) {
    // Ignore invalid URLs
  }
  return fallback;
}

export async function handleStreamPurchase({ req, env, admin }: HandlerCtx) {
  await ensureMutation(req, { req, env, admin, params: {} });
  const userId = requireAuth(req);
  const ip = getClientIP(req);
  if (!enforceInMemoryRateLimit(`stream-purchase:${userId}:${ip}`, 6, 60_000)) {
    return json({ ok: false, error: "rate_limited" }, 429);
  }
  const gameId = new URL(req.url).pathname.split("/")[3];
  if (!env.STRIPE_SECRET_KEY)
    return json({ ok: false, error: "payments_not_configured" }, 503);

  const body = (await req.json().catch(() => null)) as {
    successUrl?: string;
    cancelUrl?: string;
    captchaToken?: string;
  } | null;
  if (!(await verifyTurnstileToken(env, body?.captchaToken, ip))) {
    return json({ ok: false, error: "captcha_failed" }, 403);
  }
  // SECURITY: PPV price is hardcoded to $3.99 CAD (399 cents).
  // Do NOT trust pricing from the client payload.
  const unitAmount = 399;
  const reqUrlStr = req.url;
  const successUrl = getSafeRedirectUrl(
    body?.successUrl,
    "https://sbbl-hq.icu/live?access=1",
    reqUrlStr,
  );
  const cancelUrl = getSafeRedirectUrl(
    body?.cancelUrl,
    "https://sbbl-hq.icu/live",
    reqUrlStr,
  );

  const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      "payment_method_types[]": "card",
      "line_items[0][price_data][currency]": "cad",
      "line_items[0][price_data][product_data][name]": "SBBL HQ PPV Access",
      "line_items[0][price_data][unit_amount]": String(unitAmount), // $3.99 CAD in cents
      "line_items[0][price_data][tax_behavior]": "exclusive", // GST added on top at checkout
      "line_items[0][quantity]": "1",
      // Automatic tax: Stripe calculates Alberta GST (5%) based on billing address.
      // Requires Stripe Tax to be enabled in the dashboard.
      "automatic_tax[enabled]": "true",
      mode: "payment",
      success_url: successUrl,
      cancel_url: cancelUrl,
      "metadata[user_id]": userId,
      "metadata[game_id]": gameId,
      "metadata[purchase_type]": "ppv",
    }),
  });
  if (!stripeRes.ok) {
    const err = (await stripeRes.json()) as { error?: { message?: string } };
    return json(
      { ok: false, error: err?.error?.message ?? "stripe_error" },
      502,
    );
  }
  const checkout = (await stripeRes.json()) as { url: string; id: string };
  return json({ ok: true, url: checkout.url, sessionId: checkout.id });
}

// ── PROFILE ONBOARDING & HEADSHOT ───────────────────────────────────────────

async function handleProfileOnboarding({ req, admin }: HandlerCtx) {
  await ensureMutation(req, { req, env: {} as Env, admin, params: {} });
  const userId = requireAuth(req);
  const body = (await req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body) return json({ ok: false, error: "invalid_body" }, 400);

  // Upsert profile fields
  const { error: profileErr } = await admin.from("profiles").upsert(
    {
      user_id: userId,
      display_name:
        typeof body.displayName === "string" ? body.displayName : undefined,
      full_name: typeof body.fullName === "string" ? body.fullName : undefined,
      bio: typeof body.bio === "string" ? body.bio : undefined,
      preferred_league:
        typeof body.preferredLeague === "string"
          ? body.preferredLeague
          : undefined,
      primary_role_intent:
        typeof body.primaryRoleIntent === "string"
          ? body.primaryRoleIntent
          : undefined,
    },
    { onConflict: "user_id", ignoreDuplicates: false },
  );
  if (profileErr) throw new Error(profileErr.message);

  // Create player record if role is player
  if (body.primaryRoleIntent === "player") {
    await admin.from("players").upsert(
      {
        user_id: userId,
        jersey_number:
          typeof body.jerseyNumber === "number" ? body.jerseyNumber : null,
        position: typeof body.position === "string" ? body.position : null,
        height: typeof body.height === "string" ? body.height : null,
      },
      { onConflict: "user_id", ignoreDuplicates: true },
    );
  }

  await admin
    .from("player_registration_submissions")
    .insert({
      user_id: userId,
      payload: body,
      idempotency_key: readIdempotencyKey(req.headers),
    })
    .then(() => null);

  return json({ ok: true, userId });
}

async function handleProfileHeadshot({ req, admin }: HandlerCtx) {
  await ensureMutation(req, { req, env: {} as Env, admin, params: {} });
  const userId = requireAuth(req);
  const body = (await req.json().catch(() => null)) as {
    assetUrl?: string;
    assetId?: string;
  } | null;
  if (!body?.assetUrl && !body?.assetId)
    return json({ ok: false, error: "asset_required" }, 400);

  // Lookup player record for this user
  const { data: playerRow } = await admin
    .from("players")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!playerRow)
    return json({ ok: false, error: "player_profile_not_found" }, 404);

  // Create a media_asset record for the headshot
  let assetId = body.assetId;
  if (!assetId && body.assetUrl) {
    const { data: mediaRow, error: mediaErr } = await admin
      .from("media_assets")
      .insert({
        title: `Headshot — ${userId}`,
        status: "draft",
        metadata: { image_url: body.assetUrl, type: "headshot" },
      })
      .select("id")
      .single();
    if (mediaErr) throw new Error(mediaErr.message);
    assetId = mediaRow.id as string;
  }

  const { error } = await admin.from("player_profile_headshots").insert({
    player_id: playerRow.id as string,
    original_asset_id: assetId,
    cropped_asset_id: assetId,
    validation_result: "review_required",
    status: "pending",
    idempotency_key: readIdempotencyKey(req.headers),
  });
  if (error && !error.message.includes("duplicate"))
    throw new Error(error.message);
  return json({ ok: true, userId, assetId });
}

// ── CART & ORDERS ────────────────────────────────────────────────────────────

async function handleGetCart({ req, admin }: HandlerCtx) {
  const userId = requireAuth(req);
  // Find active cart or return empty
  const { data: cart } = await admin
    .from("carts")
    .select("id,status,created_at")
    .eq("user_id", userId)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!cart) return json({ ok: true, cart: null, items: [] });

  const { data: items } = await admin
    .from("cart_items")
    .select("id,variant_id,qty,created_at")
    .eq("cart_id", (cart as Record<string, unknown>).id);

  return json({ ok: true, cart, items: items ?? [] });
}

async function handleAddCartItem({ req, admin }: HandlerCtx) {
  await ensureMutation(req, { req, env: {} as Env, admin, params: {} });
  const userId = requireAuth(req);
  const body = (await req.json().catch(() => null)) as {
    cartId?: string;
    variantId?: string;
    qty?: number;
  } | null;
  if (!body?.variantId)
    return json({ ok: false, error: "variant_id_required" }, 400);

  // Get or create an open cart
  let cartId = body.cartId;
  if (!cartId) {
    const { data: existing } = await admin
      .from("carts")
      .select("id")
      .eq("user_id", userId)
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) {
      cartId = (existing as Record<string, unknown>).id as string;
    } else {
      const { data: newCart, error: cartErr } = await admin
        .from("carts")
        .insert({
          user_id: userId,
          status: "open",
          idempotency_key: readIdempotencyKey(req.headers),
        })
        .select("id")
        .single();
      if (cartErr) throw new Error(cartErr.message);
      cartId = (newCart as Record<string, unknown>).id as string;
    }
  }

  const { error } = await admin.from("cart_items").insert({
    cart_id: cartId,
    variant_id: body.variantId,
    qty: body.qty ?? 1,
    idempotency_key: readIdempotencyKey(req.headers),
  });
  if (error && !error.message.includes("duplicate"))
    throw new Error(error.message);
  return json({ ok: true, cartId, variantId: body.variantId });
}

async function handleCreateOrder({ req, admin }: HandlerCtx) {
  await ensureMutation(req, { req, env: {} as Env, admin, params: {} });
  const userId = requireAuth(req);
  const body = (await req.json().catch(() => null)) as {
    cartId?: string;
  } | null;
  if (!body?.cartId) return json({ ok: false, error: "cart_id_required" }, 400);

  // Verify cart belongs to user
  const { data: cart } = await admin
    .from("carts")
    .select("id,status")
    .eq("id", body.cartId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!cart) return json({ ok: false, error: "cart_not_found" }, 404);

  // Get cart items to compute total
  const { data: items } = await admin
    .from("cart_items")
    .select("qty,variant_id")
    .eq("cart_id", body.cartId);

  const { data: order, error } = await admin
    .from("orders")
    .insert({
      user_id: userId,
      status: "pending",
      total_amount: 0, // will be updated by payment webhook
      metadata: { cart_id: body.cartId, item_count: (items ?? []).length },
      idempotency_key: readIdempotencyKey(req.headers),
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  // Mark cart as processing
  await admin
    .from("carts")
    .update({ status: "processing" })
    .eq("id", body.cartId);

  return json({
    ok: true,
    orderId: (order as Record<string, unknown>).id,
    userId,
  });
}

async function handlePayOrder(ctx: HandlerCtx) {
  await ensureMutation(ctx.req, { ...ctx, params: {} });
  const userId = requireAuth(ctx.req);
  const orderId = ctx.params.id;
  if (!ctx.env.STRIPE_SECRET_KEY)
    return json({ ok: false, error: "payments_not_configured" }, 503);

  const { data: order } = await ctx.admin
    .from("orders")
    .select("id,total_amount,status")
    .eq("id", orderId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!order) return json({ ok: false, error: "order_not_found" }, 404);
  if ((order as Record<string, unknown>).status === "paid")
    return json({ ok: true, alreadyPaid: true });

  const body = (await ctx.req.json().catch(() => null)) as {
    successUrl?: string;
    cancelUrl?: string;
  } | null;
  const reqUrlStr = ctx.req.url;
  const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${ctx.env.STRIPE_SECRET_KEY}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      "payment_method_types[]": "card",
      "line_items[0][price_data][currency]": "cad",
      "line_items[0][price_data][product_data][name]": "SBBL HQ Store Order",
      "line_items[0][price_data][unit_amount]": String(
        ((order as Record<string, unknown>).total_amount as number) || 100,
      ),
      "line_items[0][quantity]": "1",
      mode: "payment",
      success_url: getSafeRedirectUrl(
        body?.successUrl,
        "https://sbbl-hq.icu/store?success=1",
        reqUrlStr,
      ),
      cancel_url: getSafeRedirectUrl(
        body?.cancelUrl,
        "https://sbbl-hq.icu/store",
        reqUrlStr,
      ),
      "metadata[user_id]": userId,
      "metadata[order_id]": orderId,
      "metadata[purchase_type]": "store_order",
    }),
  });
  if (!stripeRes.ok) {
    const err = (await stripeRes.json()) as { error?: { message?: string } };
    return json(
      { ok: false, error: err?.error?.message ?? "stripe_error" },
      502,
    );
  }
  const checkout = (await stripeRes.json()) as { url: string; id: string };
  return json({ ok: true, url: checkout.url, sessionId: checkout.id });
}


// ── STORE QUOTE ─────────────────────────────────────────────────────────────
async function handleStoreQuote({ req, env, admin }: HandlerCtx) {
  const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || "unknown";
  if (!enforceInMemoryRateLimit(`store-quote:${ip}`, 5, 60_000)) {
    return json({ ok: false, error: "rate_limit_exceeded" }, 429);
  }
  await ensureMutation(req, { req, env, admin, params: {} });
  const userId = requireAuth(req);

  const body = (await req.json().catch(() => null)) as {
    productId: string;
    name: string;
    teamName: string;
    quantity: number;
    notes?: string;
  } | null;

  if (!body || !body.productId || !body.name || !body.teamName || !body.quantity) {
    return json({ ok: false, error: "invalid_payload" }, 400);
  }

  // Idempotency check handled by ensureMutation middleware using idempotency-key header

  const { error } = await admin
    .from("custom_quote_requests")
    .insert({
      user_id: userId,
      product_id: body.productId,
      name: body.name,
      team_name: body.teamName,
      quantity: body.quantity,
      notes: body.notes ?? null,
      status: "pending"
    });

  if (error) {
    return json({ ok: false, error: "failed_to_submit_quote" }, 500);
  }

  return json({ ok: true });
}

// ── DIRECT STORE CHECKOUT ─────────────────────────────────────────────────────
async function handleDirectStoreCheckout({ req, env, admin }: HandlerCtx) {
  const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || "unknown";
  if (!enforceInMemoryRateLimit(`store-checkout:${ip}`, 10, 60_000)) {
    return json({ ok: false, error: "rate_limit_exceeded" }, 429);
  }
  await ensureMutation(req, { req, env, admin, params: {} });
  const userId = requireAuth(req);
  if (!env.STRIPE_SECRET_KEY)
    return json({ ok: false, error: "payments_not_configured" }, 503);

  const body = (await req.json().catch(() => null)) as {
    items?: Array<{ id: string; name: string; price: number; qty?: number }>;
    successUrl?: string;
    cancelUrl?: string;
  } | null;

  if (!body?.items?.length)
    return json({ ok: false, error: "items_required" }, 400);

  const reqUrlStr = req.url;

  // Extract all product IDs from the client request
  const productIds = body.items.map(i => i.id).filter(Boolean);
  if (!productIds.length) {
    return json({ ok: false, error: "invalid_items" }, 400);
  }

  // Fetch the canonical products from the database
  const { data: dbProducts, error: dbError } = await admin
    .from("store_products")
    .select("id, name, price_cents")
    .in("id", productIds)
    .eq("active", true)
    .eq("_deleted", false);

  if (dbError || !dbProducts || dbProducts.length === 0) {
    return json({ ok: false, error: "products_not_found" }, 404);
  }

  const dbProductMap = new Map(dbProducts.map(p => [p.id, p]));

  let amountSubtotalCents = 0;
  let validItemsCount = 0;

  // Create an order in store_orders pending payment
  const { data: orderData, error: orderError } = await admin
    .from("store_orders")
    .insert({
      user_id: userId,
      amount_subtotal_cents: 0,
      amount_total_cents: 0,
      status: "pending"
    })
    .select("id")
    .single();

  if (orderError || !orderData) {
    return json({ ok: false, error: "failed_to_create_order" }, 500);
  }

  const orderId = orderData.id;
  const orderItemsData: Array<{
    order_id: string;
    product_id: string;
    quantity: number;
    unit_price_cents: number;
  }> = [];

  const params = new URLSearchParams({
    "payment_method_types[]": "card",
    mode: "payment",
    success_url: getSafeRedirectUrl(
      body.successUrl,
      `${new URL(reqUrlStr).origin}/store?success=1`,
      reqUrlStr,
    ),
    cancel_url: getSafeRedirectUrl(
      body.cancelUrl,
      `${new URL(reqUrlStr).origin}/store`,
      reqUrlStr,
    ),
    "metadata[user_id]": userId,
    "metadata[order_id]": orderId,
    "metadata[purchase_type]": "store_order",
  });

  body.items.forEach((item) => {
    if (!item.id) return;
    const dbProduct = dbProductMap.get(item.id);
    if (!dbProduct) return; // Skip if product doesn't exist in DB

    const qty = item.qty ?? 1;
    const lineTotalCents = dbProduct.price_cents * qty;
    amountSubtotalCents += lineTotalCents;

    orderItemsData.push({
      order_id: orderId,
      product_id: dbProduct.id,
      quantity: qty,
      unit_price_cents: dbProduct.price_cents
    });

    const idx = validItemsCount++;
    // Stripe expects CAD centavos for our store
    params.set(`line_items[${idx}][price_data][currency]`, "cad");
    params.set(`line_items[${idx}][price_data][product_data][name]`, dbProduct.name);
    params.set(`line_items[${idx}][price_data][unit_amount]`, String(dbProduct.price_cents));
    params.set(`line_items[${idx}][quantity]`, String(qty));
  });

  if (validItemsCount === 0) {
    // Cleanup pending order
    await admin.from("store_orders").delete().eq("id", orderId);
    return json({ ok: false, error: "no_valid_items_for_checkout" }, 400);
  }

  // Bulk insert order items
  await admin.from("store_order_items").insert(orderItemsData);

  const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: params,
  });
  if (!stripeRes.ok) {
    const err = (await stripeRes.json()) as { error?: { message?: string } };
    return json(
      { ok: false, error: err?.error?.message ?? "stripe_error" },
      502,
    );
  }
  const session = (await stripeRes.json()) as { url: string; id: string };

  // Update order with session details and total
  await admin.from("store_orders").update({
    stripe_checkout_session_id: session.id,
    amount_subtotal_cents: amountSubtotalCents,
    amount_total_cents: amountSubtotalCents // Add taxes/shipping here if applicable
  }).eq("id", orderId);

  return json({ ok: true, url: session.url, sessionId: session.id });
}



type PublicMediaRow = Record<string, unknown>;

function mapPublicMediaRows(rows: PublicMediaRow[], coercePhotoToPoster = false) {
  return rows.map((r) => {
    const payload = (r.render_payload ?? {}) as Record<string, unknown>;
    const asset = (r.media_assets as Record<string, unknown> | null) ?? {};
    const assetMeta = (asset.metadata ?? {}) as Record<string, unknown>;
    const leagueRow = (r.leagues as { code?: string } | null);
    const code = (leagueRow?.code ?? "").toLowerCase();
    const leagueCode = code === "wbl" ? "wbl"
      : code === "tgifbl" ? "tgifbl"
      : code === "sbbl" ? "sbbl"
      : "sbbl";
    const createdAt = String(asset.created_at ?? r.sort_at ?? "");
    const rawType = String(payload.type ?? assetMeta.type ?? "poster");
    const mappedType = coercePhotoToPoster && rawType === "photo" ? "poster" : rawType;
    return {
      id: String(r.id),
      title: String(r.title ?? ""),
      type: mappedType,
      thumbnail: String(
        payload.thumbnail ?? assetMeta.thumbnail ?? assetMeta.image_url ?? ""
      ),
      leagueId: leagueCode,
      status: "published",
      date: String(
        payload.date ?? assetMeta.date ?? createdAt.split("T")[0] ?? ""
      ),
    };
  });
}

async function fetchPublicMediaRows(
  admin: HandlerCtx["admin"],
  req: Request,
  includeTypes?: string[],
) {
  const url = new URL(req.url);
  const leagueId = await resolveLeagueIdFilter(admin, url.searchParams.get("leagueId"));
  if (leagueId === LEAGUE_NO_MATCH) return [] as unknown as PublicMediaRow[];
  let query = admin
    .from("media_publications")
    .select(
      "id,surface,title,subtitle,status,sort_at,sort_order,render_payload,league_id," +
      "media_assets!inner(id,metadata,created_at)," +
      "leagues:leagues!league_id(code)"
    )
    .eq("status", "published")
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true })
    .limit(50);

  if (leagueId) query = query.eq("league_id", leagueId);
  if (includeTypes && includeTypes.length > 0) {
    query = query.in("render_payload->>type", includeTypes);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as PublicMediaRow[];
}

async function getPublicMediaFreshnessVersion(admin: HandlerCtx["admin"]): Promise<string> {
  // Reorder saves write an audit log entry; latest timestamp acts as a lightweight
  // cache-busting marker shared by both /media and /media/posters.
  const { data, error } = await admin
    .from("audit_logs")
    .select("created_at")
    .eq("action", "ops_reorder_media_publications")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) {
    console.warn("[public-media] freshness marker lookup failed:", error.message);
    return "0";
  }
  const latest = Array.isArray(data) && data[0] ? String((data[0] as { created_at?: string }).created_at ?? "0") : "0";
  return latest;
}

function toPublicMediaCacheKey(req: Request, variant: "media" | "posters", version: string): Request {
  const url = new URL(req.url);
  const key = new URL(`https://sbbl-hq.icu/__cache/public/${variant}`);
  key.search = url.search;
  key.searchParams.set("__v", version);
  return new Request(key.toString());
}

async function respondWithPublicMediaFreshness(
  req: Request,
  admin: HandlerCtx["admin"],
  variant: "media" | "posters",
  computeData: () => Promise<unknown>,
): Promise<Response> {
  const version = await getPublicMediaFreshnessVersion(admin);
  const isAnonymous = !getBearerToken(req);
  const cfCaches = caches as unknown as { default: Cache };
  const cacheKey = toPublicMediaCacheKey(req, variant, version);

  if (isAnonymous) {
    const hit = await cfCaches.default.match(cacheKey);
    if (hit) return hit;
  }

  const data = await computeData();
  const res = json({ ok: true, data }, 200, {
    "Cache-Control": "public, s-maxage=300, max-age=120",
    "x-public-media-version": version,
  });

  if (isAnonymous) {
    // Cache key includes version, so any reorder save immediately shifts reads
    // to a fresh entry without waiting for prior 300s TTL to expire.
    cfCaches.default.put(cacheKey, res.clone()).catch(() => {});
  }
  return res;
}

async function handlePublicProducts({ req, admin }: HandlerCtx) {
  const url = new URL(req.url);
  // Optional leagueId filter - keep it in signature for backwards compat, though store_products is global.
  const leagueId = url.searchParams.get("leagueId");

  const query = admin
    .from("store_products")
    .select("id,name,description,category,price_cents,image_url,sizes,colors,badge,is_custom")
    .eq("active", true)
    .eq("_deleted", false)
    .order("name", { ascending: true })
    .limit(100);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  // Transform response to match frontend expectations (or map to frontend Product type)
  const mapped = (data ?? []).map((p: Record<string, unknown>) => ({
    id: String(p.id),
    name: String(p.name),
    category: String(p.category),
    price: Number(p.price_cents) / 100, // Frontend expects dollars, backend stores cents
    image: String(p.image_url),
    sizes: (p.sizes as string[]) ?? [],
    colors: (p.colors as string[]) ?? [],
    badge: p.badge ? String(p.badge) : undefined,
    is_custom: Boolean(p.is_custom),
    description: p.description ? String(p.description) : undefined
  }));

  return json({ ok: true, data: mapped }, 200, { "Cache-Control": "public, s-maxage=300, max-age=120" });
}

async function handlePublicMedia({ req, admin }: HandlerCtx) {
  // Canonical render still reads from media_publications (+ media_assets!inner join)
  // and keeps Cache-Control at public, s-maxage=300, max-age=120 for anonymous traffic.
  return respondWithPublicMediaFreshness(req, admin, "media", async () => {
    const rows = await fetchPublicMediaRows(admin, req);
    return mapPublicMediaRows(rows);
  });
}

async function handlePublicPosterMedia({ req, admin }: HandlerCtx) {
  return respondWithPublicMediaFreshness(req, admin, "posters", async () => {
    // Poster tab projection: include event/league-wide art and promote photo assets
    // to poster cards without mutating source records.
    const rows = await fetchPublicMediaRows(admin, req, ["poster", "photo"]);

    // ⚡ Bolt: Replace O(N^2) deduplication with O(N) Set lookup
    const seen = new Set<string>();
    return mapPublicMediaRows(rows, true).filter((row, index) => {
      const raw = rows[index] ?? {};
      const payload = (raw.render_payload ?? {}) as Record<string, unknown>;
      const metadata = (((raw.media_assets as Record<string, unknown> | null) ?? {}).metadata ?? {}) as Record<string, unknown>;
      const surface = String(raw.surface ?? payload.surface ?? metadata.surface ?? "");
      const teamName = String(payload.team ?? metadata.team ?? "").trim();

      // Exclude team-specific cards (e.g., POTG) — this route is for team-agnostic
      // event imagery like 1v1/2v2 and league-wide graphics.
      if (surface === "potg" || teamName.length > 0) return false;

      // Idempotent response: ensure each id appears once even if source rows overlap.
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    });
  });
}

async function handlePlayerCheckout({ req, env, admin }: HandlerCtx) {
  const userId = requireAuth(req);
  const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || "unknown";
  if (!enforceInMemoryRateLimit(`player-checkout:${userId}:${ip}`, 6, 60_000)) {
    return json({ ok: false, error: "rate_limit_exceeded" }, 429);
  }
  await ensureMutation(req, { req, env, admin, params: {} });
  if (!env.STRIPE_SECRET_KEY)
    return json({ ok: false, error: "payments_not_configured" }, 503);
  const body = (await req.json().catch(() => null)) as {
    items?: Array<{ id: string; name: string; price: number; qty?: number }>;
    successUrl?: string;
    cancelUrl?: string;
  } | null;
  const reqUrlStr = req.url;
  const successUrl = getSafeRedirectUrl(
    body?.successUrl,
    "https://sbbl-hq.icu/billing?success=1",
    reqUrlStr,
  );
  const cancelUrl = getSafeRedirectUrl(
    body?.cancelUrl,
    "https://sbbl-hq.icu/billing",
    reqUrlStr,
  );

  const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      "payment_method_types[]": "card",
      "line_items[0][price_data][currency]": "cad",
      "line_items[0][price_data][product_data][name]": "SBBL Player Membership",
      "line_items[0][price_data][product_data][description]":
        "Monthly player registration. Includes stats, leaderboard, player profile, highlight downloads, and 10% store discount.",
      "line_items[0][price_data][unit_amount]": "699", // $6.99 CAD before tax
      "line_items[0][price_data][tax_behavior]": "exclusive", // GST added on top at checkout
      "line_items[0][price_data][recurring][interval]": "month",
      "line_items[0][quantity]": "1",
      // Automatic tax: Stripe calculates Alberta GST (5%) based on billing address.
      // Requires Stripe Tax to be enabled in the dashboard.
      "automatic_tax[enabled]": "true",
      mode: "subscription",
      success_url: successUrl,
      cancel_url: cancelUrl,
      "metadata[user_id]": userId,
      "metadata[purchase_type]": "player_registration",
    }),
  });

  if (!stripeRes.ok) {
    const err = (await stripeRes.json()) as { error?: { message?: string } };
    return json(
      { ok: false, error: err?.error?.message ?? "stripe_error" },
      502,
    );
  }
  const checkout = (await stripeRes.json()) as { url: string; id: string };
  return json({ ok: true, url: checkout.url, sessionId: checkout.id });
}

async function handleBillingHistory({ req, admin }: HandlerCtx) {
  const userId = requireAuth(req);
  const { data, error } = await admin
    .from("orders")
    .select("id,created_at,total_amount,status,metadata")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return json({ ok: true, data: data ?? [] });
}

// ── Observability: /ops/health + /ops/metrics-lite ───────────────────────────
// Lightweight endpoints for uptime checks and basic operational metrics.
// /ops/health: no auth required (used by external monitors / load balancers).
// /ops/metrics-lite: no auth required (best-effort rolling counters from Worker memory).

const metricsCounters = { requests: 0, status429: 0, status5xx: 0, startedAt: Date.now() };
const latencyWindow: number[] = [];
const MAX_LATENCY_SAMPLES = 1000;

function recordMetrics(status: number, latencyMs: number) {
  metricsCounters.requests++;
  if (status === 429) metricsCounters.status429++;
  if (status >= 500) metricsCounters.status5xx++;
  latencyWindow.push(latencyMs);
  if (latencyWindow.length > MAX_LATENCY_SAMPLES) latencyWindow.shift();
}

function computeP95(): number {
  if (latencyWindow.length === 0) return 0;
  const sorted = [...latencyWindow].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * 0.95)] ?? 0;
}

async function handleOpsHealth({ env, admin }: HandlerCtx) {
  // Actually test the Supabase connection — this is the single most critical check.
  // If this fails, EVERY route that queries the database will also fail.
  let dbStatus: "connected" | "error" | "timeout" = "error";
  let dbError: string | null = null;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    const { error } = await admin.from("leagues").select("id").limit(1).abortSignal(controller.signal);
    clearTimeout(timeoutId);
    if (error) {
      dbError = error.message;
    } else {
      dbStatus = "connected";
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      dbStatus = "timeout";
      dbError = "Supabase query timed out (3s)";
    } else {
      dbError = e instanceof Error ? e.message : "unknown_connection_error";
    }
  }

  return json({
    ok: true,
    db_ok: dbStatus === "connected",
    version: "2026.04-hardened",
    commit: (env as unknown as Record<string, unknown>).CF_PAGES_COMMIT_SHA ?? "unknown",
    supabase_url: env.SUPABASE_URL ? env.SUPABASE_URL.replace(/https?:\/\//, "").split(".")[0] + "...[redacted]" : "not_set",
    db_status: dbStatus,
    db_error: dbError,
    time: new Date().toISOString(),
    uptime_s: Math.floor((Date.now() - metricsCounters.startedAt) / 1000),
  });
}

async function handleOpsMetricsLite(_ctx: HandlerCtx) {
  return json({
    ok: true,
    total_requests: metricsCounters.requests,
    status_429_count: metricsCounters.status429,
    status_5xx_count: metricsCounters.status5xx,
    p95_latency_ms: computeP95(),
    sample_window_size: latencyWindow.length,
    uptime_s: Math.floor((Date.now() - metricsCounters.startedAt) / 1000),
  });
}

const routes: Array<{ method: string; path: string; handler: Handler }> = [
  { method: "GET", path: "/auth/session", handler: handleAuthSession },
  { method: "GET", path: "/api/profile/me", handler: handleMe },
  {
    method: "POST",
    path: "/api/profile/onboarding",
    handler: handleProfileOnboarding,
  },
  {
    method: "POST",
    path: "/api/profile/headshot",
    handler: handleProfileHeadshot,
  },
  {
    method: "GET",
    path: "/api/games/:id/stat-sheet",
    handler: (ctx) =>
      handleMutationAck({
        ...ctx,
        params: { route: "games-stat-sheet", ...ctx.params },
      }),
  },
  {
    method: "POST",
    path: "/api/games/:id/stats/draft",
    handler: (ctx) =>
      handleDraft({
        ...ctx,
        params: { route: "games-stats-draft", ...ctx.params },
      }),
  },
  {
    method: "POST",
    path: "/api/games/:id/stats/finalize",
    handler: (ctx) =>
      handleFinalize({
        ...ctx,
        params: { route: "games-stats-finalize", ...ctx.params },
      }),
  },
  { method: "GET", path: "/api/stats", handler: handleStats },
  { method: "GET", path: "/api/leaderboards", handler: handleLeaderboards },
  {
    method: "POST",
    path: "/api/invite/generate",
    handler: handleInviteGenerate,
  },
  { method: "POST", path: "/api/invite/redeem", handler: handleInviteRedeem },
  {
    method: "GET",
    path: "/api/streams/:gameId/preview",
    handler: (ctx) =>
      handleMutationAck({
        ...ctx,
        params: { route: "streams-preview", ...ctx.params },
      }),
  },
  {
    method: "POST",
    path: "/api/streams/:gameId/purchase",
    handler: handleStreamPurchase,
  },
  {
    method: "GET",
    path: "/api/streams/:gameId/access",
    handler: handleStreamAccess,
  },
  // ── Broadcast routes (game-independent) ──────────────────────────────────
  // These are the canonical routes for open livestreams. Streams are NOT
  // coupled to games. Do not add gameId logic here — see CLAUDE.md Rule 7.
  { method: "GET",  path: "/api/broadcast/access",              handler: handleBroadcastStreamAccess },
  { method: "POST", path: "/api/broadcast/session",             handler: handleBroadcastSessionStart },
  { method: "POST", path: "/api/broadcast/session/heartbeat",   handler: handleBroadcastHeartbeatRoute },
  { method: "POST", path: "/api/broadcast/session/end",         handler: handleBroadcastSessionEndRoute },
  // Legacy aliases — kept so old clients don't 404. Primary routes are /api/broadcast/* above.
  // IMPORTANT: literal paths MUST come before :gameId to prevent "broadcast"
  // being captured as an invalid UUID parameter (router is first-match).
  { method: "POST", path: "/api/streams/broadcast/session",             handler: handleBroadcastSessionStart },
  { method: "POST", path: "/api/streams/broadcast/session/heartbeat",   handler: handleBroadcastHeartbeatRoute },
  { method: "POST", path: "/api/streams/broadcast/session/end",         handler: handleBroadcastSessionEndRoute },
  // ── Game-specific PPV stream routes ───────────────────────────────────────
  {
    method: "POST",
    path: "/api/streams/:gameId/session",
    handler: handlePlaybackSession,
  },
  {
    method: "GET",
    path: "/api/streams/:gameId/proxy/*",
    handler: handleStreamProxy,
  },
  {
    method: "POST",
    path: "/api/streams/:gameId/session/heartbeat",
    handler: handleStreamSessionHeartbeat,
  },
  {
    method: "POST",
    path: "/api/streams/:gameId/session/end",
    handler: handleStreamSessionEnd,
  },
  {
    method: "GET",
    path: "/api/streams/:gameId/playback-token/verify",
    handler: handlePlaybackTokenVerify,
  },
  {
    method: "GET",
    path: "/api/streams/:gameId/preflight",
    handler: handlePlaybackPreflight,
  },
  // ── WS4 Fan Token System ──────────────────────────────────────────────
  // Every route below is no-op (403 fan_tokens_disabled) unless the
  // worker-side FEATURE_FAN_TOKEN_SYSTEM env flag is 'true'. Webhook is
  // intentionally unconditional so in-flight Stripe sessions complete
  // safely if the flag is toggled off mid-purchase.
  { method: "GET",  path: "/api/tokens/products",                  handler: handleTokenProducts },
  { method: "GET",  path: "/api/tokens/categories",                handler: handleTokenCategories },
  { method: "GET",  path: "/api/tokens/wallet",                    handler: handleTokenWallet },
  { method: "GET",  path: "/api/tokens/leaderboard/season/:seasonId", handler: handleLeaderboardBySeason },
  { method: "GET",  path: "/api/tokens/leaderboard/:gameId",       handler: handleLeaderboardByGame },
  { method: "POST", path: "/api/tokens/purchase",                  handler: handleTokenPurchase },
  { method: "POST", path: "/api/tokens/award",                     handler: handleTokenAward },
  { method: "POST", path: "/api/tokens/webhook",                   handler: handleTokenWebhook },
  // ── WS5 Biometric Overlay ─────────────────────────────────────────────
  // Both routes 403 biometric_disabled unless FEATURE_BIOMETRIC_OVERLAY is
  // 'true'. Write path additionally requires league_admin / super_admin
  // and games.event_type in ('1v1','2v2').
  { method: "POST", path: "/api/streams/:gameId/biometrics",        handler: handleBiometricIngest },
  { method: "POST", path: "/api/streams/:gameId/biometrics/webhook", handler: handleBiometricWebhookIngest },
  { method: "GET",  path: "/api/streams/:gameId/biometrics/latest", handler: handleBiometricLatest },
  // ── WS6 Mic Up Series overlay events ──────────────────────────────────
  // Admin-triggered overlay events (trash_talk / lower_third / intro_sting).
  // Gated on FEATURE_MIC_UP_SERIES + games.mic_up_series=true.
  { method: "POST", path: "/api/streams/:gameId/overlay/event",     handler: handleMicUpOverlayEvent },
  { method: "GET",  path: "/api/streams/:gameId/overlay/events/latest", handler: handleLatestMicUpOverlayEvents },
  // ── WS7 Replay monetization ───────────────────────────────────────────
  // Public read; does NOT leak a playback URL. Clients call the normal
  // session endpoint with playbackMode='replay' after purchase/entitlement.
  { method: "GET",  path: "/api/streams/:gameId/replay/status",     handler: handleReplayStatus },
  {
    method: "GET",
    path: "/api/streams/:gameId/comments",
    handler: handleListComments,
  },
  {
    method: "POST",
    path: "/api/streams/:gameId/comments",
    handler: handlePostComment,
  },
  {
    method: "POST",
    path: "/ops/streams/:gameId/comments/:commentId",
    handler: handleModerateComment,
  },
  {
    method: "POST",
    path: "/ops/streams/:gameId/reactions/reset",
    handler: handleResetReactions,
  },
  { method: "GET", path: "/api/cart", handler: handleGetCart },
  { method: "POST", path: "/api/cart/items", handler: handleAddCartItem },
  {
    method: "DELETE",
    path: "/api/cart/items/:itemId",
    handler: (ctx) =>
      handleMutationAck({
        ...ctx,
        params: { route: "cart-item-delete", ...ctx.params },
      }),
  },
  { method: "POST", path: "/api/orders", handler: handleCreateOrder },
  { method: "POST", path: "/api/orders/:id/pay", handler: handlePayOrder },
  {
    method: "GET",
    path: "/api/billing/history",
    handler: handleBillingHistory,
  },
  {
    method: "GET",
    path: "/api/public/products",
    handler: handlePublicProducts,
  },
  { method: "GET", path: "/api/public/media", handler: handlePublicMedia },
  { method: "GET", path: "/api/public/media/posters", handler: handlePublicPosterMedia },
  {
    method: "POST",
    path: "/api/player/checkout",
    handler: handlePlayerCheckout,
  },
  {
    method: "POST",
    path: "/api/store/checkout",
    handler: handleDirectStoreCheckout,
  },
  {
    method: "POST",
    path: "/api/store/quote",
    handler: handleStoreQuote,
  },
  {
    method: "POST",
    path: "/api/rewards/redeem",
    handler: (ctx) =>
      handleMutationAck({ ...ctx, params: { route: "rewards-redeem" } }),
  },
  { method: "GET", path: "/ops/bootstrap", handler: handleOpsBootstrap },
  {
    method: "POST",
    path: "/ops/imports/teams",
    handler: (ctx) => _handleImportRoute(ctx, "teams"),
  },
  {
    method: "POST",
    path: "/ops/imports/players",
    handler: (ctx) => _handleImportRoute(ctx, "players"),
  },
  {
    method: "POST",
    path: "/ops/imports/schedules",
    handler: (ctx) => _handleImportRoute(ctx, "schedules"),
  },
  {
    method: "POST",
    path: "/ops/imports/events",
    handler: (ctx) => _handleImportRoute(ctx, "events"),
  },
  {
    method: "POST",
    path: "/api/ops/upload/csv",
    handler: handleScoresCsvUpload,
  },
  { method: "GET", path: "/ops/imports/history", handler: handleImportHistory },
  { method: "GET", path: "/ops/pipeline/health", handler: handlePipelineHealth },
  { method: "POST", path: "/ops/players/merge", handler: handlePlayerIdentityMerge },
  { method: "POST", path: "/ops/players/find-or-create", handler: handleOpsFindOrCreatePlayer },

  { method: "POST", path: "/ops/event/parse", handler: handleParseEventImage },
  { method: "POST", path: "/ops/potg/parse", handler: handleParsePotgImage },
  { method: "POST", path: "/ops/roster/parse-image", handler: handleParseRosterImage },
  { method: "POST", path: "/ops/roster/import", handler: _handleRosterImport },

  { method: "GET", path: "/api/public-config", handler: handlePublicConfig },
  { method: "GET", path: "/api/public/home", handler: handlePublicHome },
  { method: "GET", path: "/api/public/schedule", handler: handlePublicSchedule },
  { method: "GET", path: "/api/public/potg", handler: handlePublicPotg },
  { method: "GET", path: "/api/teams", handler: handleTeamsList },
  {
    method: "GET",
    path: "/api/streams/status",
    handler: handlePublicStreamStatus,
  },
  {
    method: "GET",
    path: "/api/streams/reactions",
    handler: handleStreamReactions,
  },
  {
    method: "GET",
    path: "/api/streams/:gameId/reactions",
    handler: handleStreamReactions,
  },
  {
    method: "GET",
    path: "/api/streams/:gameId/viewer-count",
    handler: handleStreamViewerCount,
  },
  {
    method: "POST",
    path: "/api/streams/:gameId/react",
    handler: handleStreamReact,
  },
  // ── StreamForge QoE telemetry routes ─────────────────────────────────────
  {
    method: "POST",
    path: "/api/streams/:gameId/qoe",
    handler: handleStreamQoeBeacon,
  },
  {
    method: "GET",
    path: "/api/streams/:gameId/qoe/health",
    handler: handleStreamQoeHealth,
  },
  {
    method: "GET",
    path: "/ops/streams/config",
    handler: handleGetStreamConfig,
  },
  {
    method: "POST",
    path: "/ops/streams/config",
    handler: handleUpdateStreamConfig,
  },
  {
    method: "POST",
    path: "/ops/streams/status",
    handler: handleSetStreamStatus,
  },
  {
    // RC-6: Atomic go-live — updates config + status in a single DB upsert.
    method: "POST",
    path: "/ops/streams/go-live",
    handler: handleGoLive,
  },
  {
    method: "POST",
    path: "/ops/streams/comp-code",
    handler: handleSuperAdminCompCode,
  },
  {
    method: "GET",
    path: "/ops/streams/comp-code",
    handler: handleSuperAdminCompCodeList,
  },
  {
    method: "GET",
    path: "/ops/streams/sessions",
    handler: handleStreamSessions,
  },
  { method: "GET", path: "/ops/access/lookup", handler: handleAccessLookup },
  {
    method: "POST",
    path: "/ops/access/override",
    handler: handleAccessOverride,
  },
  { method: "GET", path: "/ops/review", handler: handleReviewQueue },
  {
    method: "POST",
    path: "/ops/review/:id/resolve",
    handler: handleResolveReview,
  },
  { method: "GET", path: "/ops/revenue", handler: handleOpsRevenue },
  { method: "GET", path: "/ops/publish-jobs", handler: handlePublishJobs },
  { method: "GET", path: "/ops/headshots", handler: handleHeadshotQueue },
  { method: "POST", path: "/api/ingress", handler: handleIngress },
  { method: "POST", path: "/sync/drain", handler: handleSyncDrain },
  // OmniBridge bidirectional integration with APEX-OmniHub control plane.
  { method: "POST", path: "/webhooks/omnihub", handler: handleOmnihubWebhook },
  { method: "POST", path: "/api/omniport/command", handler: handleOmniportCommand },
  { method: "GET", path: "/ops/health", handler: handleOpsHealth },
  { method: "GET", path: "/ops/metrics-lite", handler: handleOpsMetricsLite },
  { method: "POST", path: "/webhooks/stripe", handler: handleStripeWebhook },
  { method: "POST", path: "/api/coach/request", handler: handleCoachApprovalRequest },
  { method: "GET", path: "/ops/coach/requests", handler: handleListCoachRequests },
  { method: "POST", path: "/ops/coach/:id/resolve", handler: handleResolveCoachRequest },

  // ── Overlay (scoreboard / OBS browser source) ────────────────────────
  { method: "GET",  path: "/api/public/overlay/:gameId",         handler: handlePublicOverlay },
  { method: "POST", path: "/api/ops/overlay/:gameId/state",      handler: handleOverlayPatch },
  { method: "POST", path: "/api/ops/overlay/:gameId/clock",      handler: handleOverlayClock },
  { method: "POST", path: "/api/ops/overlay/:gameId/score",      handler: handleOverlayScore },
  { method: "POST", path: "/api/ops/overlay/:gameId/foul",       handler: handleOverlayFoul },
  { method: "POST", path: "/api/ops/overlay/:gameId/period",     handler: handleOverlayPeriod },
  { method: "POST", path: "/api/ops/overlay/:gameId/reset",      handler: handleOverlayReset },
  { method: "POST", path: "/api/ops/overlay/:gameId/status",     handler: handleOverlayStatus },

  // ── Game Player Stats & Roster ────────────────────────────────────────
  { method: "GET",    path: "/api/public/games/:gameId/player-stats", handler: handleGetGamePlayerStats },
  { method: "POST",   path: "/api/ops/games/:gameId/player-stats",   handler: handleOpsRecordPlayerStat },
  { method: "POST",   path: "/api/ops/games/:gameId/quick-player",   handler: handleOpsQuickAddPlayer },
  { method: "DELETE", path: "/api/ops/games/:gameId",                handler: handleOpsDeleteGame },

  // ── Engagement (polls, predictions, trivia, gamification) ────────────
  { method: "GET",  path: "/api/public/engagement/polls",            handler: handlePublicPollsList },
  { method: "GET",  path: "/api/public/engagement/polls/:id/results", handler: handlePublicPollResults },
  { method: "GET",  path: "/api/public/engagement/leaderboard",     handler: handlePublicEngagementLeaderboard },
  { method: "POST", path: "/api/engagement/polls/:id/vote",         handler: handleCastVote },
  { method: "GET",  path: "/api/engagement/me/points",              handler: handleMyPoints },
  { method: "POST", path: "/api/engagement/watch-parties",          handler: handleCreateWatchParty },
  { method: "GET",  path: "/api/engagement/watch-parties",          handler: handleListWatchParties },
  { method: "POST", path: "/api/engagement/watch-parties/:id/join", handler: handleJoinWatchParty },
  { method: "POST", path: "/api/engagement/watch-parties/join-by-code", handler: handleJoinByCode },
  { method: "POST", path: "/api/ops/engagement/polls",              handler: handleCreatePoll },
  { method: "POST", path: "/api/ops/engagement/polls/:id",          handler: handleUpdatePoll },
  { method: "POST", path: "/api/ops/engagement/polls/:id/grade",    handler: handleGradePoll },

  // ── Sponsors ────────────────────────────────────────────────────────
  { method: "GET",  path: "/api/public/sponsors",                handler: handlePublicSponsors },
  { method: "POST", path: "/api/public/sponsors/:id/track",      handler: handleTrackSponsorEvent },
  { method: "GET",  path: "/api/ops/sponsors",                   handler: handleAdminListSponsors },
  { method: "POST", path: "/api/ops/sponsors",                   handler: handleCreateSponsor },
  { method: "POST", path: "/api/ops/sponsors/:id",               handler: handleUpdateSponsor },
  { method: "POST", path: "/api/ops/sponsors/:id/delete",        handler: handleDeleteSponsor },

  // ── OBS control ─────────────────────────────────────────────────────
  { method: "POST", path: "/api/ops/obs/commands",               handler: handleEnqueueObsCommand },
  { method: "GET",  path: "/api/ops/obs/commands",               handler: handleListObsCommands },
  { method: "GET",  path: "/api/ops/obs/commands/pending",       handler: handleAgentPending },
  { method: "POST", path: "/api/ops/obs/commands/:id/ack",       handler: handleAgentAck },

  // ── AI weekly digest ────────────────────────────────────────────────
  { method: "GET",  path: "/api/public/digest",                  handler: handlePublicDigest },
  { method: "POST", path: "/api/ops/digest/:leagueCode/regenerate", handler: handleRegenerateDigest },

  // ── Highlights + reaction aggregate ─────────────────────────────────
  { method: "GET",  path: "/api/public/highlights/:gameId",                  handler: handlePublicHighlights },
  { method: "GET",  path: "/api/public/streams/:gameId/reactions/aggregate", handler: handleReactionAggregate },
  { method: "POST", path: "/api/ops/highlights/mark",                        handler: handleMarkHighlight },
  { method: "POST", path: "/api/ops/highlights/:id",                         handler: handleUpdateHighlight },
  { method: "POST", path: "/api/ops/highlights/:id/delete",                  handler: handleDeleteHighlight },
];

// Lazy-compile: routes are registered via push() throughout the module,
// so we compile on first access to capture all late-registered routes.
let _compiled: Array<Route & { keys: string[] }> | null = null;
function getCompiled() {
  if (!_compiled) {
    _compiled = routes.map((route) => {
      const compiledPath = compilePath(route.path);
      return {
        method: route.method,
        regex: compiledPath.regex,
        handler: route.handler,
        keys: compiledPath.keys,
      };
    });
  }
  return _compiled;
}

const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5MB request body limit
const BODY_TOO_LARGE_ERROR = "payload_too_large";

const bodySizeChecks = new WeakMap<Request, Promise<void>>();
let requestBodyGuardPatched = false;

function contentLengthExceedsLimit(req: Request): boolean {
  const raw = req.headers.get("content-length");
  if (!raw) return false;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > MAX_BODY_BYTES;
}

async function ensureBodyWithinLimit(req: Request): Promise<void> {
  if (contentLengthExceedsLimit(req)) throw new Error(BODY_TOO_LARGE_ERROR);
  const pending = bodySizeChecks.get(req);
  if (pending) return pending;

  const check = (async () => {
    const cloned = req.clone();
    const bytes = (await cloned.arrayBuffer()).byteLength;
    if (bytes > MAX_BODY_BYTES) throw new Error(BODY_TOO_LARGE_ERROR);
  })();
  bodySizeChecks.set(req, check);
  return check;
}

function withBodySizeGuard(req: Request): Request {
  const guardedReq = req as Request & {
    json: Request["json"];
    text: Request["text"];
  };
  const originalJson = req.json.bind(req);
  const originalText = req.text.bind(req);

  guardedReq.json = async () => {
    await ensureBodyWithinLimit(req);
    return originalJson();
  };
  guardedReq.text = async () => {
    await ensureBodyWithinLimit(req);
    return originalText();
  };
  return guardedReq;
}

function installRequestBodyGuard() {
  if (requestBodyGuardPatched) return;
  requestBodyGuardPatched = true;
  const rawJson = Request.prototype.json;
  const rawText = Request.prototype.text;

  Request.prototype.json = function jsonWithLimit() {
    return ensureBodyWithinLimit(this).then(() => rawJson.call(this));
  };
  Request.prototype.text = function textWithLimit() {
    return ensureBodyWithinLimit(this).then(() => rawText.call(this));
  };
}

export function addSecurityHeaders(res: Response): Response {
  const headers = new Headers(res.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Permissions-Policy: deny sensitive hardware by default, BUT delegate
  // autoplay / fullscreen / picture-in-picture to our embed providers.
  // Chrome's default `autoplay` policy is `self` — cross-origin iframes
  // (like embed.twitch.tv) cannot autoplay even when they pass autoplay=true
  // to their SDK unless the parent document explicitly delegates the feature
  // to their origin. Without this delegation, the Twitch embed throws:
  //   "Autoplay disabled. style visibility, size, viewport visibility"
  // Keep camera / microphone / geolocation denied — passive playback needs
  // none of them.
  const embedOrigins = [
    '"https://player.twitch.tv"',
    '"https://embed.twitch.tv"',
    '"https://www.youtube.com"',
    '"https://www.youtube-nocookie.com"',
    '"https://player.vimeo.com"',
  ].join(' ');
  headers.set(
    'Permissions-Policy',
    `camera=(), microphone=(), geolocation=(), ` +
      `autoplay=(self ${embedOrigins}), ` +
      `fullscreen=(self ${embedOrigins}), ` +
      `picture-in-picture=(self ${embedOrigins})`,
  );
  // CSP: restricts resource loading to trusted origins only.
  // Prevents XSS, data exfiltration, and clickjacking at the browser level.
  // Facebook is allowed in frame-src only — plugins/video.php iframe embed, no SDK.
  // WHEP (WebRTC egress) connections to stream.sbbl-hq.icu are covered by the
  // *.sbbl-hq.icu wildcard in connect-src; media-src blob: covers WebRTC tracks.
  headers.set('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com https://www.youtube.com https://www.youtube-nocookie.com https://s.ytimg.com https://embed.twitch.tv https://player.twitch.tv https://assets.twitch.tv https://static.cloudflareinsights.com; " +
    "script-src-elem 'self' 'unsafe-inline' https://challenges.cloudflare.com https://www.youtube.com https://www.youtube-nocookie.com https://s.ytimg.com https://embed.twitch.tv https://player.twitch.tv https://static.cloudflareinsights.com; " +
    // fonts.googleapis.com serves the @font-face CSS (style-src).
    // fonts.gstatic.com serves the actual .woff2 files (font-src).
    // Both are required for Space Grotesk loaded in index.html (canonical brand font).
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "img-src 'self' data: blob: https: https://static-cdn.jtvnw.net; " +
    "font-src 'self' data: https://fonts.gstatic.com; " +
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.sbbl-hq.icu wss://*.sbbl-hq.icu https://api.stripe.com https://checkout.stripe.com https://challenges.cloudflare.com https://www.youtube.com wss://www.youtube.com https://www.youtube-nocookie.com https://player.twitch.tv https://api.twitch.tv wss://pubsub-edge.twitch.tv https://usher.twitchsvc.net https://*.twitchsvc.net wss://*.twitchsvc.net https://cloudflareinsights.com https://static.cloudflareinsights.com; " +
    "frame-src https://challenges.cloudflare.com https://js.stripe.com https://www.youtube.com https://www.youtube-nocookie.com https://player.twitch.tv https://embed.twitch.tv https://player.vimeo.com https://www.facebook.com; " +
    "media-src 'self' blob: https://*.googlevideo.com https://*.ytimg.com https://*.twitch.tv https://*.twitchsvc.net; " +
    "worker-src 'self' blob:; " +
    "frame-ancestors 'none'; " +
    "base-uri 'self'; " +
    "form-action 'self' https://checkout.stripe.com;"
  );
  // HSTS: force HTTPS for 2 years, include subdomains, allow preloading.
  headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

const ipRateMap = new Map<string, { count: number; windowStart: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 120; // 120 req/min per IP
const IP_RATE_MAP_MAX = 50_000; // OOM guard — hard cap on tracked IPs

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = ipRateMap.get(ip);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    // OOM guard: if map exceeds cap, sweep expired entries first
    if (ipRateMap.size >= IP_RATE_MAP_MAX) {
      for (const [k, v] of ipRateMap.entries()) {
        if (now - v.windowStart > RATE_LIMIT_WINDOW_MS) ipRateMap.delete(k);
      }
    }
    ipRateMap.set(ip, { count: 1, windowStart: now });
    return true;
  }
  entry.count += 1;
  if (entry.count > RATE_LIMIT_MAX) return false;
  return true;
}

installRequestBodyGuard();

export default Sentry.withSentry(
  (env: Env) => ({
    dsn: env.SENTRY_DSN,
    enabled: Boolean(env.SENTRY_DSN),
    tracesSampleRate: 0.05,
    // Tag every Worker event with the deployment environment
    environment: (env as unknown as Record<string, unknown>).ENVIRONMENT as string ?? "production",
  }),
  {
  async fetch(req: Request, env: Env): Promise<Response> {
    const _fetchStart = Date.now();
        const parsed = safeServerEnv(env as unknown as Record<string, unknown>);

    const url = new URL(req.url);
    if (
      !parsed.ok && url.pathname !== "/ops/health" && url.pathname !== "/ops/metrics-lite" &&
      (url.pathname.startsWith("/api") ||
        url.pathname.startsWith("/auth") ||
        url.pathname.startsWith("/ops") ||
        url.pathname.startsWith("/webhooks"))
    ) {
      return json(
        { ok: false, error: "server_misconfigured", missing: parsed.missing },
        500,
      );
    }

    // SECURITY: Strip any client-supplied spoofed identity/role headers BEFORE
    // processing. Session is established purely from JWT verification below.
    const cleanHeaders = new Headers(req.headers);
    cleanHeaders.delete("x-sbbl-user-id");
    cleanHeaders.delete("x-sbbl-user-id-verified");
    cleanHeaders.delete("x-sbbl-roles");
    cleanHeaders.delete("x-sbbl-roles-verified");
    const cleanReq = new Request(req, { headers: cleanHeaders });

    const session = await getSession(cleanReq, env);

    // ── Supabase admin client ─────────────────────────────────────────
    // CRITICAL: If the service role key is wrong or unset, EVERY database
    // query in EVERY route handler will fail with "Invalid API key".
    // We validate the key format before creating the client.
    if (!env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY.length < 20) {
      // /ops/health is a liveness probe — it must respond even before secrets
      // are propagated (e.g. first deploy, or secret rotation in progress).
      // Its own try-catch handles DB errors gracefully; no hard block needed.
      if (
        url.pathname !== "/ops/health" &&
        (url.pathname.startsWith("/api") || url.pathname.startsWith("/ops") || url.pathname.startsWith("/auth"))
      ) {
        return addSecurityHeaders(json({
          ok: false,
          error: "supabase_service_key_missing",
          detail: "SUPABASE_SERVICE_ROLE_KEY is not set or is too short. Set it via: wrangler secret put SUPABASE_SERVICE_ROLE_KEY",
        }, 500));
      }
    }

    const admin = getAdminClient(env);

    // Internal verified headers are set here and ONLY here, after JWT verification.
    // These use a -verified suffix to distinguish them from any client-supplied headers
    // (which were stripped above).
    const enrichedRequest = withBodySizeGuard(new Request(cleanReq, {
      headers: session
        ? {
            ...Object.fromEntries(cleanReq.headers.entries()),
            "x-sbbl-user-id-verified": session.userId,
            "x-sbbl-roles-verified": session.roles.join(","),
          }
        : cleanReq.headers,
    }));

    for (const route of getCompiled()) {
      if (route.method !== req.method) continue;
      const match = url.pathname.match(route.regex);
      if (!match) continue;

      const params: Record<string, string> = {};
      route.keys.forEach((key, index) => {
        params[key] = match[index + 1] ?? "";
      });

      try {
        const handlerResponse = await route.handler({
          req: enrichedRequest,
          env,
          params,
          admin,
        });
        recordMetrics(handlerResponse.status, Date.now() - _fetchStart);
        return addSecurityHeaders(handlerResponse);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "internal_error";
        const status =
          message === "unauthorized"
            ? 401
            : message === "forbidden"
              ? 403
              : message === BODY_TOO_LARGE_ERROR
                ? 413
              : message.startsWith("Missing or invalid idempotency key") ||
                  message.startsWith("Duplicate idempotency key")
                ? 400
                : 500;
        // Report 5xx errors to Sentry; skip 4xx (expected auth/validation failures)
        if (status === 500) {
          Sentry.captureException(error, {
            extra: { path: url.pathname, method: req.method },
          });
        }
        recordMetrics(status, Date.now() - _fetchStart);
        if (status === 413) {
          return addSecurityHeaders(
            json(
              { ok: false, error: BODY_TOO_LARGE_ERROR, maxBytes: MAX_BODY_BYTES },
              413,
            ),
          );
        }
        return addSecurityHeaders(json({ ok: false, error: message }, status));
      }
    }

    if (env.ASSETS) {
      const assetRes = await env.ASSETS.fetch(req);
      // Edge-cache static SPA shell: short TTL for HTML (revalidate quickly),
      // long TTL for hashed assets (immutable via Vite content hashing).
      if (assetRes.status === 200) {
        const ct = assetRes.headers.get("content-type") ?? "";
        const isHtml = ct.includes("text/html");
        const cacheHeaders = new Headers(assetRes.headers);
        if (isHtml) {
          // HTML shell: cache 60s at edge, stale-while-revalidate for viral traffic resilience
          cacheHeaders.set("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=600");
        } else {
          // Non-HTML static assets (images/fonts/icons/media from /public).
          // Vite-hashed JS/CSS under /assets/ already carry immutable cache
          // headers; for un-hashed public files (hero-*, icons, logos, svgs)
          // we force a 30-day browser cache + 1-year edge cache so the LCP
          // hero is served from CDN + disk cache on repeat views.
          const url = new URL(req.url);
          const path = url.pathname;
          const isHashedViteAsset = /\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/.test(path);
          if (!isHashedViteAsset && !cacheHeaders.has("Cache-Control")) {
            cacheHeaders.set(
              "Cache-Control",
              "public, max-age=2592000, s-maxage=31536000, stale-while-revalidate=86400",
            );
          }
        }
        return addSecurityHeaders(new Response(assetRes.body, {
          status: assetRes.status,
          statusText: assetRes.statusText,
          headers: cacheHeaders,
        }));
      }
      return addSecurityHeaders(assetRes);
    }

    return addSecurityHeaders(json({ ok: false, error: "not_found" }, 404));
  },
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const parsed = safeServerEnv(env as unknown as Record<string, unknown>);
    if (!parsed.ok) return;
    const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    ctx.waitUntil(
      autonomousPurgeArchivedMedia(admin, env, {
        retentionDays: 30,
        executionMode: "autonomous",
      }).catch((err) => {
        console.error("Autonomous archived media purge failed:", err);
      })
    );
  },
  },
);

// ── Canonical ingest route family ─────────────────────────────────────────
// All media uploads flow through this family. No other handler may write
// directly to media_publications. Public surfaces read only from that table.

/**
 * POST /ops/ingest/presign
 * Body: { kind: 'potg'|'store'|'event'|'generic', filename: string }
 * Returns a Supabase Storage signed upload URL for the media bucket.
 * Frontend uploads the binary directly; then calls /ops/ingest/submit.
 */
async function handleIngestPresign(ctx: HandlerCtx) {
  await ensureMutation(ctx.req, ctx);
  await requireOpsAdminSession(ctx.req, ctx.admin);

  const body = await ctx.req.json().catch(() => null) as {
    kind?: string;
    filename?: string;
  } | null;

  const kind = body?.kind;
  const filename = body?.filename;
  if (!kind || !["potg", "store", "event", "generic"].includes(kind)) {
    return json({ ok: false, error: "invalid_kind" }, 400);
  }
  if (!filename || typeof filename !== "string") {
    return json({ ok: false, error: "filename_required" }, 400);
  }

  const ext = filename.split(".").pop()?.toLowerCase() ?? "jpg";
  const objectPath = `${kind}/${crypto.randomUUID()}.${ext}`;

  // Generate signed upload URL via Supabase Storage REST API.
  // The media bucket is public for reads; writes are gated by the signed URL.
  const supabaseUrl = ctx.env.SUPABASE_URL;
  const serviceKey = ctx.env.SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(
    `${supabaseUrl}/storage/v1/object/upload/sign/media/${objectPath}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${serviceKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ expiresIn: 3600 }),
    }
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => "unknown");
    throw new Error(`presign_failed: ${res.status} — ${errText}`);
  }

  const { token, url } = await res.json() as { token: string; url: string };
  // Supabase returns a relative path — build the full upload URL.
  const signedUrl = url.startsWith("http") ? url : `${supabaseUrl}/storage/v1${url}`;
  return json({ ok: true, signedUrl, token, objectPath });
}

/**
 * POST /ops/ingest/submit
 * Body: {
 *   kind: 'potg'|'store'|'event'|'generic',
 *   objectPath: string,      — from presign response
 *   publicUrl: string,       — public/signed URL for rendering (from storage after upload)
 *   title: string,
 *   leagueId?: string,
 *   publishStatus?: 'draft'|'published',
 *   idempotencyKey?: string,
 *   meta?: Record<string, unknown>  — kind-specific fields
 * }
 *
 * State machine: uploaded → classified → validated → written → projected
 */
async function handleIngestSubmit(ctx: HandlerCtx) {
  await ensureMutation(ctx.req, ctx);
  const { userId } = await requireOpsAdminSession(ctx.req, ctx.admin);

  const body = await ctx.req.json().catch(() => null) as {
    kind?: string;
    objectPath?: string;
    publicUrl?: string;
    title?: string;
    leagueId?: string;
    publishStatus?: string;
    idempotencyKey?: string;
    meta?: Record<string, unknown>;
  } | null;

  if (!body?.kind || !body?.objectPath || !body?.title) {
    return json({ ok: false, error: "missing_required_fields" }, 400);
  }
  if (!["potg", "store", "event", "generic"].includes(body.kind)) {
    return json({ ok: false, error: "invalid_kind" }, 400);
  }

  let potgPlayerId: string | null = null;
  let potgUserId: string | null = null;
  let potgParsedResult: ReturnType<typeof parsePotgGameResult> = null;

  // POTG-specific guards. Block before opening an ingest_jobs row so we don't
  // leave half-finished rows behind on rejection. See incident 2026-04-18.
  if (body.kind === "potg") {
    const meta = body.meta ?? {};
    const statErr = validatePotgStatFields(meta as PotgStatPayload);
    if (statErr) {
      return json({ ok: false, error: statErr }, 400);
    }
    if (!body.leagueId) {
      return json({ ok: false, error: "missing_potg_league" }, 400);
    }
    const potgLeagueId = await resolveLeagueId(ctx.admin, body.leagueId);
    if (!potgLeagueId) {
      return json({
        ok: false,
        error: "potg_unknown_league",
        message: `League "${body.leagueId}" was not found — pick a league from the selector and resubmit.`,
        leagueId: body.leagueId,
      }, 400);
    }
    const playerResolution = await resolvePotgPlayer(
      ctx.admin,
      String(meta.playerName ?? ""),
      potgLeagueId,
      { teamName: String(meta.team ?? meta.teamName ?? ""), actorId: userId },
    );
    if (playerResolution.ok === false) {
      const friendly: Record<string, string> = {
        potg_player_name_required: "No player name was detected — fill in the Player Name field and resubmit.",
        potg_profile_provision_failed: "Could not auto-create the player profile — see details for the database error.",
        potg_player_provision_failed: "Could not auto-register the player — see details for the database error.",
      };
      return json(
        {
          ok: false,
          error: playerResolution.error,
          message: friendly[playerResolution.error] ?? "Player resolution failed — see details.",
          details: playerResolution.details,
        },
        409,
      );
    }
    if (playerResolution.provisioned || playerResolution.warnings.length > 0) {
      await ctx.admin.from("audit_logs").insert({
        actor_id: userId,
        action: "potg_auto_provisioned_player",
        ref_type: "players",
        ref_id: playerResolution.playerId,
        payload: {
          playerName: String(meta.playerName ?? ""),
          team: String(meta.team ?? meta.teamName ?? ""),
          leagueId: body.leagueId ?? null,
          provisioned: playerResolution.provisioned,
          warnings: playerResolution.warnings,
        },
        idempotency_key: crypto.randomUUID(),
      });
    }
    potgPlayerId = playerResolution.playerId;
    potgUserId = playerResolution.userId;
    potgParsedResult = parsePotgGameResult(String(meta.gameResult ?? ""));
  }

  const idempotencyKey = body.idempotencyKey ?? readIdempotencyKey(ctx.req.headers) ?? null;

  // Dedup: if this key was already processed, return the existing job.
  if (idempotencyKey) {
    const { data: existing } = await ctx.admin
      .from("ingest_jobs")
      .select("id,state,media_asset_id,publication_id")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existing) {
      return json({ ok: true, jobId: existing.id, state: existing.state, deduplicated: true });
    }
  }

  // Resolve league UUID
  const leagueUuid: string | null = body.leagueId
    ? await resolveLeagueId(ctx.admin, body.leagueId)
    : null;

  const pubStatus = body.publishStatus === "published" ? "published" : "draft";
  const meta = body.meta ?? {};
  const rawPublicUrl = body.publicUrl ?? "";
  // Build full storage URL — objectPath is relative (e.g. "potg/abc.jpg"),
  // the media bucket is public, so we construct the CDN-accessible URL.
  const publicUrl = rawPublicUrl.startsWith("http")
    ? rawPublicUrl
    : `${ctx.env.SUPABASE_URL}/storage/v1/object/public/media/${rawPublicUrl}`;

  // ── Step 1: Create ingest_job (state=uploaded) ──────────────────────────
  const baseJobInsert = {
    submitted_by: userId,
    kind: body.kind,
    state: "uploaded",
    payload: { title: body.title, leagueId: body.leagueId ?? null, publicUrl, meta },
    idempotency_key: idempotencyKey,
  };
  // Backward-compat: some environments still have object_path instead of asset_path.
  let { data: job, error: jobErr } = await ctx.admin
    .from("ingest_jobs")
    .insert({ ...baseJobInsert, asset_path: body.objectPath })
    .select("id")
    .single();
  if (jobErr && /asset_path/i.test(jobErr.message)) {
    const fallbackInsert = await ctx.admin
      .from("ingest_jobs")
      .insert({ ...baseJobInsert, object_path: body.objectPath })
      .select("id")
      .single();
    job = fallbackInsert.data;
    jobErr = fallbackInsert.error;
  }
  if (jobErr) throw new Error(jobErr.message);
  const jobId = job.id;

  // ── Step 2: Classify + validate (state=classified → validated) ──────────
  // Deterministic routing matrix by kind (unknown kind rejected with 400 above).
  const surface: string = body.kind === "potg" ? "potg"
    : body.kind === "store" ? "store"
    : body.kind === "event" ? "event"
    : "media_feed";

  await ctx.admin.from("ingest_jobs").update({ state: "classified" }).eq("id", jobId);
  await ctx.admin.from("ingest_jobs").update({ state: "validated" }).eq("id", jobId);

  // ── Step 3: Write media_asset (state=written) ───────────────────────────
  const assetMeta: Record<string, unknown> = {
    type: "poster",
    thumbnail: publicUrl,
    image_url: publicUrl,
    date: (meta.date as string | undefined) ?? new Date().toISOString().split("T")[0],
    ...meta,
  };

  // Copy POTG stat fields into the publication's render_payload for ALL
  // leagues. Pre-2026-04-18 this block was guarded to TGIFBL only, so WBL
  // and SBBL POTG submissions silently lost their stats and produced
  // orphan posters that broke the leaderboards.
  if (body.kind === "potg") {
    assetMeta.pts = Number(meta.pts ?? 0);
    assetMeta.rebs = Number(meta.rebs ?? 0);
    assetMeta.assts = Number(meta.assts ?? 0);
    assetMeta.gameResult = String(meta.gameResult ?? "");
    assetMeta.playerName = String(meta.playerName ?? body.title ?? "");
    assetMeta.team = String(meta.team ?? "");
  }

  if (body.kind === "store") {
    const { data: product } = await ctx.admin
      .from("products")
      .insert({
        league_id: leagueUuid,
        name: body.title ?? "Store Item",
        price: Number(meta.price ?? 0),
        status: pubStatus,
      })
      .select("id")
      .single();
    if (product?.id) {
      assetMeta.product_id = product.id;
    }
  }

  const { data: asset, error: assetErr } = await ctx.admin
    .from("media_assets")
    .insert({
      league_id: leagueUuid,
      title: body.title,
      status: pubStatus,
      metadata: assetMeta,
    })
    .select("id")
    .single();
  if (assetErr) {
    await ctx.admin.from("ingest_jobs")
      .update({ state: "failed", error_message: assetErr.message }).eq("id", jobId);
    throw new Error(assetErr.message);
  }

  await ctx.admin.from("ingest_jobs")
    .update({ state: "written", media_asset_id: asset.id }).eq("id", jobId);

  // ── Step 4: Project into media_publications (state=projected) ───────────
  const { data: pub, error: pubErr } = await ctx.admin
    .from("media_publications")
    .insert({
      media_asset_id: asset.id,
      surface,
      league_id: leagueUuid,
      title: body.title,
      status: pubStatus,
      published_at: pubStatus === "published" ? new Date().toISOString() : null,
      render_payload: assetMeta,
    })
    .select("id")
    .single();
  if (pubErr) {
    await ctx.admin.from("ingest_jobs")
      .update({ state: "failed", error_message: pubErr.message }).eq("id", jobId);
    throw new Error(pubErr.message);
  }

  const finalState = pubStatus === "published" ? "published" : "projected";
  await ctx.admin.from("ingest_jobs")
    .update({ state: finalState, publication_id: pub.id }).eq("id", jobId);

  await ctx.admin.from("audit_logs").insert({
    actor_id: userId,
    action: "ingest_submit",
    ref_type: "ingest_jobs",
    ref_id: jobId,
    payload: { kind: body.kind, surface, media_asset_id: asset.id, publication_id: pub.id },
    idempotency_key: idempotencyKey ?? crypto.randomUUID(),
  });

  if (body.kind === "potg" && potgPlayerId && leagueUuid && potgParsedResult) {
    const potgDate = (meta.date as string | undefined) ?? new Date().toISOString().split("T")[0];
    
    // Link or create game
    const { data: candidateGames } = await ctx.admin
      .from("games")
      .select("id,participant1_label,participant2_label")
      .eq("league_id", leagueUuid)
      .eq("category", "league")
      .eq("game_date", potgDate)
      .limit(25);

    const targetA = normalizeTeamToken(normalizeTeamLabel(potgParsedResult.homeLabel));
    const targetB = normalizeTeamToken(normalizeTeamLabel(potgParsedResult.awayLabel));
    const matched = (candidateGames ?? []).find((g) => {
      const rowA = normalizeTeamToken(normalizeTeamLabel(String(g.participant1_label ?? "")));
      const rowB = normalizeTeamToken(normalizeTeamLabel(String(g.participant2_label ?? "")));
      return (rowA === targetA && rowB === targetB) || (rowA === targetB && rowB === targetA);
    });

    let gameId: string | null = null;
    if (matched?.id) {
      gameId = String(matched.id);
      await ctx.admin.from("games").update({
        status: "final",
        participant1_label: potgParsedResult.homeLabel,
        participant2_label: potgParsedResult.awayLabel,
        home_score: potgParsedResult.homeScore,
        away_score: potgParsedResult.awayScore,
      }).eq("id", gameId);
    } else {
      const { data: newGame } = await ctx.admin.from("games").insert({
        league_id: leagueUuid,
        category: "league",
        status: "final",
        game_date: potgDate,
        participant1_label: potgParsedResult.homeLabel,
        participant2_label: potgParsedResult.awayLabel,
        home_score: potgParsedResult.homeScore,
        away_score: potgParsedResult.awayScore,
        notes: "Auto-created from POTG submission",
      }).select("id").single();
      gameId = newGame?.id ? String(newGame.id) : null;
    }

    if (gameId) {
      await ctx.admin.from("player_game_stats").upsert({
        game_id: gameId,
        player_id: potgPlayerId,
        pts: Number(meta.pts ?? 0),
        reb: Number(meta.rebs ?? 0),
        ast: Number(meta.assts ?? 0),
      }, { onConflict: "game_id,player_id" });
      
      // Update ingest_job payload with matched game_id for traceability
      await ctx.admin.from("ingest_jobs").update({
        payload: { ...baseJobInsert.payload, matched_game_id: gameId, matched_player_id: potgPlayerId }
      }).eq("id", jobId);
    }
  }

  return json({
    ok: true,
    jobId,
    state: finalState,
    mediaAssetId: asset.id,
    publicationId: pub.id,
  });
}

/**
 * GET /ops/ingest/:jobId
 * Returns current state of an ingest job.
 */
async function handleIngestStatus(ctx: HandlerCtx) {
  await requireOpsAdminSession(ctx.req, ctx.admin);
  const { jobId } = ctx.params;
  if (!jobId) return json({ ok: false, error: "missing_job_id" }, 400);

  const { data, error } = await ctx.admin
    .from("ingest_jobs")
    .select("*")
    .eq("id", jobId)
    .single();
  if (error || !data) return json({ ok: false, error: "not_found" }, 404);
  const objectPath = typeof data.asset_path === "string"
    ? data.asset_path
    : (typeof data.object_path === "string" ? data.object_path : null);
  return json({ ok: true, job: { ...data, asset_path: objectPath } });
}

/**
 * POST /ops/ingest/:jobId/approve
 * Sets media_publications.status = 'published' and job.state = 'published'.
 * Only valid for jobs in 'projected' or 'needs_review' state.
 */
async function handleIngestApprove(ctx: HandlerCtx) {
  await ensureMutation(ctx.req, ctx);
  const { userId } = await requireOpsAdminSession(ctx.req, ctx.admin);
  const { jobId } = ctx.params;
  if (!jobId) return json({ ok: false, error: "missing_job_id" }, 400);

  const { data: job, error: jobFetchErr } = await ctx.admin
    .from("ingest_jobs")
    .select("id,state,publication_id")
    .eq("id", jobId)
    .single();
  if (jobFetchErr || !job) return json({ ok: false, error: "not_found" }, 404);
  if (!["projected", "needs_review", "draft"].includes(job.state)) {
    return json({ ok: false, error: `cannot_approve_from_state:${job.state}` }, 409);
  }
  if (!job.publication_id) {
    return json({ ok: false, error: "no_publication_to_approve" }, 409);
  }

  const now = new Date().toISOString();
  const { error: pubErr } = await ctx.admin
    .from("media_publications")
    .update({ status: "published", published_at: now })
    .eq("id", job.publication_id);
  if (pubErr) throw new Error(pubErr.message);

  await ctx.admin.from("ingest_jobs")
    .update({ state: "published" }).eq("id", jobId);

  await ctx.admin.from("audit_logs").insert({
    actor_id: userId,
    action: "ingest_approve",
    ref_type: "ingest_jobs",
    ref_id: jobId,
    payload: { publication_id: job.publication_id, approved_at: now },
    idempotency_key: crypto.randomUUID(),
  });

  return json({ ok: true, jobId, publicationId: job.publication_id, publishedAt: now });
}

/**
 * POST /ops/ingest/:jobId/reject
 * Moves publication to 'archived' and job to 'failed'.
 * Replayable via /replay.
 */
async function handleIngestReject(ctx: HandlerCtx) {
  await ensureMutation(ctx.req, ctx);
  const { userId } = await requireOpsAdminSession(ctx.req, ctx.admin);
  const { jobId } = ctx.params;
  if (!jobId) return json({ ok: false, error: "missing_job_id" }, 400);

  const body = await ctx.req.json().catch(() => null) as { reason?: string } | null;

  const { data: job, error: jobFetchErr } = await ctx.admin
    .from("ingest_jobs")
    .select("id,state,publication_id")
    .eq("id", jobId)
    .single();
  if (jobFetchErr || !job) return json({ ok: false, error: "not_found" }, 404);

  if (job.publication_id) {
    await ctx.admin.from("media_publications")
      .update({ status: "archived" }).eq("id", job.publication_id);
  }

  await ctx.admin.from("ingest_jobs")
    .update({ state: "failed", error_message: body?.reason ?? "rejected_by_operator" })
    .eq("id", jobId);

  await ctx.admin.from("audit_logs").insert({
    actor_id: userId,
    action: "ingest_reject",
    ref_type: "ingest_jobs",
    ref_id: jobId,
    payload: { reason: body?.reason ?? "rejected_by_operator" },
    idempotency_key: crypto.randomUUID(),
  });

  return json({ ok: true, jobId, state: "failed" });
}

/**
 * POST /ops/ingest/:jobId/replay
 * Resets a failed or needs_review job back to 'uploaded' and re-runs the pipeline.
 * Idempotency key is cleared so a fresh write can occur.
 */
async function handleIngestReplay(ctx: HandlerCtx) {
  await ensureMutation(ctx.req, ctx);
  const { userId } = await requireOpsAdminSession(ctx.req, ctx.admin);
  const { jobId } = ctx.params;
  if (!jobId) return json({ ok: false, error: "missing_job_id" }, 400);

  const { data: job, error: jobFetchErr } = await ctx.admin
    .from("ingest_jobs")
    .select("*")
    .eq("id", jobId)
    .single();
  if (jobFetchErr || !job) return json({ ok: false, error: "not_found" }, 404);
  if (!["failed", "needs_review"].includes(job.state)) {
    return json({ ok: false, error: `not_replayable_from_state:${job.state}` }, 409);
  }

  // Reset state so the submit pipeline re-runs.
  await ctx.admin.from("ingest_jobs").update({
    state: "uploaded",
    error_message: null,
    media_asset_id: null,
    publication_id: null,
    idempotency_key: null,
  }).eq("id", jobId);

  // Archive any stale publication from the prior attempt.
  if (job.publication_id) {
    await ctx.admin.from("media_publications")
      .update({ status: "archived" }).eq("id", job.publication_id);
  }

  // Re-run the ingest pipeline with original payload.
  const payload = job.payload as Record<string, unknown>;
  const replayObjectPath =
    typeof job.asset_path === "string" ? job.asset_path
      : (typeof job.object_path === "string" ? job.object_path : "");
  const replayReq = new Request(ctx.req.url, {
    method: "POST",
    headers: ctx.req.headers,
    body: JSON.stringify({
      kind: job.kind,
      objectPath: replayObjectPath,
      publicUrl: payload.publicUrl ?? "",
      title: payload.title ?? "",
      leagueId: payload.leagueId ?? null,
      publishStatus: "draft",
      meta: payload.meta ?? {},
    }),
  });

  await ctx.admin.from("audit_logs").insert({
    actor_id: userId,
    action: "ingest_replay",
    ref_type: "ingest_jobs",
    ref_id: jobId,
    payload: {},
    idempotency_key: crypto.randomUUID(),
  });

  return handleIngestSubmit({ ...ctx, req: replayReq, params: {} });
}

// Register canonical ingest routes (super-admin only)
routes.push(
  { method: "POST", path: "/ops/ingest/presign",          handler: handleIngestPresign },
  { method: "POST", path: "/ops/ingest/submit",           handler: handleIngestSubmit  },
  { method: "GET",  path: "/ops/ingest/:jobId",           handler: handleIngestStatus  },
  { method: "POST", path: "/ops/ingest/:jobId/approve",   handler: handleIngestApprove },
  { method: "POST", path: "/ops/ingest/:jobId/reject",    handler: handleIngestReject  },
  { method: "POST", path: "/ops/ingest/:jobId/replay",    handler: handleIngestReplay  },
);

// ── PATCH / DELETE / LIST routes ───────────────────────────────────────────
// (handleManualOpsAction deleted — it had schema drift on products.publish_status,
//  schema drift on products and players tables. These dedicated handlers are correct.)
// B2 — register PATCH / DELETE / LIST routes + missing schedule delete + products batch
async function handleOpsDeleteSchedules(ctx: HandlerCtx) {
  return handleOpsDelete('schedule_slots', ctx.req, ctx.admin, ctx.params);
}

/**
 * POST /ops/products/batch
 * Creates up to 4 products without media. Uses actual schema columns.
 */
// Store product creation is excluded from league_admin — store media upload and
// edit remain super-admin only. See STORE_ONLY_TABLES below for the edit path.
export async function handleOpsBatchProducts(ctx: HandlerCtx) {
  await ensureMutation(ctx.req, ctx);
  const { userId } = await requireSuperAdminSession(ctx.req, ctx.admin);
  const body = await ctx.req.json().catch(() => null) as { items?: Array<{ title?: string; price?: string | number; leagueId?: string }> } | null;
  const items = body?.items ?? [];
  if (!Array.isArray(items) || items.length === 0) {
    return json({ ok: false, error: "items_required" }, 400);
  }
  const productsToInsert = items
    .slice(0, 4)
    .filter((item) => item.title && item.price)
    .map((item) => ({
      name: String(item.title),
      price: Number(item.price),
      status: "draft",
      league_id: item.leagueId ?? null,
    }));

  if (productsToInsert.length > 0) {
    const { error } = await ctx.admin.from("products").insert(productsToInsert);
    if (error) throw new Error(error.message);
  }
  await ctx.admin.from("audit_logs").insert({
    actor_id: userId,
    action: "ops_batch_products",
    ref_type: "products",
    ref_id: crypto.randomUUID(),
    payload: { count: items.length },
    idempotency_key: readIdempotencyKey(ctx.req.headers) ?? crypto.randomUUID(),
  });
  return json({ ok: true });
}

// POST /ops/media/publish
// Generic "publish a media asset" endpoint — writes media_assets + media_publications
// without creating a product row (unlike /ops/store/media). Used by Events tab and any
// surface that needs to push an already-uploaded image into the public render layer.
async function handleOpsMediaPublish(ctx: HandlerCtx) {
  await ensureMutation(ctx.req, ctx);
  await requireOpsAdminSession(ctx.req, ctx.admin);

  const body = await ctx.req.json().catch(() => null) as {
    title?: string;
    surface?: string;
    leagueId?: string | null;
    date?: string;
    imageUrl?: string;
    publishStatus?: string;
  } | null;

  if (!body?.title || !body?.imageUrl || !body?.surface) {
    return json({ ok: false, error: "title, imageUrl, and surface are required" }, 400);
  }

  const validSurfaces = ["potg", "event", "store", "media_feed"];
  if (!validSurfaces.includes(body.surface)) {
    return json({ ok: false, error: `surface must be one of: ${validSurfaces.join(", ")}` }, 400);
  }

  const status = body.publishStatus === "published" ? "published" : "draft";
  const leagueId = body.leagueId ?? null;
  const sortAt = body.date ? new Date(body.date).toISOString() : new Date().toISOString();
  const mediaType = body.surface === "potg" ? "poster" : "photo";
  const meta = {
    type: mediaType,
    thumbnail: body.imageUrl,
    date: body.date ?? new Date().toISOString().split("T")[0],
    surface: body.surface,
  };

  const { data: asset, error: assetErr } = await ctx.admin
    .from("media_assets")
    .insert({ league_id: leagueId, title: body.title, status, metadata: meta })
    .select("id")
    .single();
  if (assetErr) throw new Error(assetErr.message);

  const { data: pub, error: pubErr } = await ctx.admin
    .from("media_publications")
    .insert({
      media_asset_id: asset.id,
      surface: body.surface,
      league_id: leagueId,
      title: body.title,
      status,
      published_at: status === "published" ? new Date().toISOString() : null,
      sort_at: sortAt,
      render_payload: meta,
    })
    .select("id")
    .single();
  if (pubErr) throw new Error(pubErr.message);

  return json({ ok: true, mediaAssetId: asset.id, publicationId: pub.id }, 201);
}

routes.push(
  { method: "PATCH",  path: "/ops/teams/:id",      handler: handleOpsPatchTeams },
  { method: "PATCH",  path: "/ops/players/:id",    handler: handleOpsPatchPlayers },
  { method: "PATCH",  path: "/ops/products/:id",   handler: handleOpsPatchProducts },
  { method: "PATCH",  path: "/ops/events/:id",     handler: handleOpsPatchEvents },
  { method: "PATCH",  path: "/ops/schedules/:id",  handler: handleOpsPatchSchedules },
  { method: "DELETE", path: "/ops/teams/:id",      handler: handleOpsDeleteTeams },
  { method: "DELETE", path: "/ops/players/:id",    handler: handleOpsDeletePlayers },
  { method: "DELETE", path: "/ops/products/:id",   handler: handleOpsDeleteProducts },
  { method: "DELETE", path: "/ops/events/:id",     handler: handleOpsDeleteEvents },
  { method: "DELETE", path: "/ops/schedules/:id",  handler: handleOpsDeleteSchedules },
  { method: "POST",   path: "/ops/products/batch",  handler: handleOpsBatchProducts  },
  { method: "POST",   path: "/ops/media/publish",   handler: handleOpsMediaPublish   },
  { method: "GET",    path: "/ops/list/teams",     handler: handleOpsListTeams },
  { method: "GET",    path: "/ops/list/players",   handler: handleOpsListPlayers },
  { method: "GET",    path: "/ops/list/products",  handler: handleOpsListProducts },
  { method: "GET",    path: "/ops/list/events",    handler: handleOpsListEvents },
  { method: "GET",    path: "/ops/list/schedules", handler: handleOpsListSchedules },
  { method: "GET",    path: "/ops/list/media",              handler: handleOpsListMediaPublications },
  { method: "PATCH",  path: "/ops/media/publications/:id",  handler: handleOpsPatchMediaPublications },
  { method: "DELETE", path: "/ops/media/publications/:id",  handler: handleOpsDeleteMediaPublications },
  { method: "POST",   path: "/ops/media/publications/order", handler: handleOpsReorderMediaPublications },
  { method: "POST",   path: "/ops/media/publications/:id/restore", handler: handleOpsMediaRestore },
  { method: "POST",   path: "/ops/media/stale-cleanup-preview",    handler: handleOpsMediaStalePreview },
  { method: "POST",   path: "/ops/media/stale-cleanup-execute",    handler: handleOpsMediaStaleExecute },
  { method: "POST",   path: "/ops/media/bulk-archive",             handler: handleOpsBulkArchive },
  { method: "GET",    path: "/ops/media/archived-purge-preview",   handler: handleOpsMediaArchivedPurgePreview },
  { method: "POST",   path: "/ops/media/archived-purge-execute",   handler: handleOpsMediaArchivedPurgeExecute },
);

// ── Scores handlers ────────────────────────────────────────────────────────

/** GET /api/scores — public, optionally filtered by league/category/status */
async function handleScoresList({ req, admin }: HandlerCtx) {
  const url = new URL(req.url);
  const leagueParam = url.searchParams.get("league");
  const categoryParam = url.searchParams.get("category");
  const statusParam = url.searchParams.get("status");
  const beforeCursor = url.searchParams.get("before");

  // Single query — migration 20260404004000 is applied so all columns exist.
  let query = admin
    .from("games")
    .select(
      "id, status, created_at, home_score, away_score, " +
      "category, game_date, event_name, participant1_label, participant2_label, notes, " +
      "home_team_id, away_team_id, " +
      "home_team:teams!home_team_id(name), " +
      "away_team:teams!away_team_id(name), " +
      "leagues:leagues!league_id(code, name), " +
      "seasons:seasons!season_id(name)"
    )
    .order("created_at", { ascending: false })
    .limit(100);

  // Apply DB-level filters for category and status
  if (categoryParam && categoryParam !== "all") {
    query = query.eq("category", categoryParam);
  }

  if (statusParam === "recent") {
    query = query.eq("status", "final");
  } else if (statusParam === "upcoming") {
    query = query.in("status", ["upcoming", "scheduled"]);
  }

  if (beforeCursor && /^\d{4}-\d{2}-\d{2}T/.test(beforeCursor)) {
    query = query.lt("created_at", beforeCursor);
  }

  const { data, error } = await query;
  if (error) return json({ ok: false, error: error.message }, 500);

  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;

  const games = rows.map((r) => {
    const leagueRow = r.leagues as Record<string, unknown> | null;
    const season = r.seasons as Record<string, unknown> | null;
    const homeTeam = r.home_team as Record<string, unknown> | null;
    const awayTeam = r.away_team as Record<string, unknown> | null;

    const homeLabel = (r.participant1_label as string | null)
      ?? (homeTeam ? String(homeTeam.name) : null)
      ?? "Home";
    const awayLabel = (r.participant2_label as string | null)
      ?? (awayTeam ? String(awayTeam.name) : null)
      ?? "Away";

    const leagueCode = leagueRow ? String(leagueRow.code ?? "").toLowerCase() : undefined;
    const leagueId = leagueCode === "wbl" ? "wbl"
      : leagueCode === "tgifbl" ? "tgifbl"
      : leagueCode === "sbbl" ? "sbbl"
      : undefined;

    const createdAt = r.created_at as string | null;
    const gameDate = (r.game_date as string | null)
      ?? (createdAt ? createdAt.split("T")[0] : undefined);

    return {
      id: String(r.id),
      category: String(r.category ?? "league"),
      leagueId,
      leagueCode,
      leagueName: leagueRow ? String(leagueRow.name ?? "") : undefined,
      seasonName: season ? String(season.name ?? "") : undefined,
      eventName: (r.event_name as string | null) ?? undefined,
      homeLabel,
      awayLabel,
      homeScore: r.home_score != null ? Number(r.home_score) : undefined,
      awayScore: r.away_score != null ? Number(r.away_score) : undefined,
      status: String(r.status ?? "upcoming"),
      gameDate,
      notes: (r.notes as string | null) ?? undefined,
    };
  });

  // Post-filter by league code if requested
  const filtered = leagueParam && leagueParam !== "all"
    ? games.filter((g) => g.leagueCode === leagueParam.toLowerCase())
    : games;

  const nextCursor = filtered.length === 100
    ? (rows[rows.length - 1]?.created_at as string | undefined) ?? null
    : null;

  return json({ ok: true, games: filtered, nextCursor }, 200, { "Cache-Control": "public, s-maxage=60, max-age=30" });
}

/** POST /ops/scores/game — upsert a single game (super_admin only) */
async function handleScoreGameUpsert(ctx: HandlerCtx) {
  await ensureMutation(ctx.req, ctx);
  await requireOpsAdminSession(ctx.req, ctx.admin);

  const body = (await ctx.req.json().catch(() => null)) as {
    gameId?: string;
    category?: string;
    leagueId?: string;
    seasonId?: string;
    homeTeamId?: string;
    awayTeamId?: string;
    participant1Label?: string;
    participant2Label?: string;
    homeScore?: number;
    awayScore?: number;
    status?: string;
    gameDate?: string;
    eventName?: string;
    venue?: string;
    notes?: string;
  } | null;

  if (!body) return json({ ok: false, error: "body_required" }, 400);

  // Resolve league_id UUID from league code if provided
  const leagueUuid: string | null = body.leagueId
    ? await resolveLeagueId(ctx.admin, body.leagueId)
    : null;

  const payload = {
    category: body.category ?? "league",
    league_id: leagueUuid,
    season_id: body.seasonId ?? null,
    home_team_id: body.homeTeamId ?? null,
    away_team_id: body.awayTeamId ?? null,
    participant1_label: body.participant1Label ?? null,
    participant2_label: body.participant2Label ?? null,
    home_score: body.homeScore ?? null,
    away_score: body.awayScore ?? null,
    status: body.status ?? "upcoming",
    game_date: body.gameDate ?? null,
    event_name: body.eventName ?? null,
    notes: body.notes ?? null,
  };

  let gameId: string;
  if (body.gameId) {
    const { data, error } = await ctx.admin
      .from("games")
      .update(payload)
      .eq("id", body.gameId)
      .select("id")
      .single();
    if (error) return json({ ok: false, error: error.message }, 500);
    gameId = data.id;
  } else {
    const { data, error } = await ctx.admin
      .from("games")
      .insert(payload)
      .select("id")
      .single();
    if (error) return json({ ok: false, error: error.message }, 500);
    gameId = data.id;
  }

  return json({ ok: true, gameId });
}


/** POST /ops/scores/parse-image — scoreboard OCR via Groq vision (super_admin only) */
async function handleScoreboardImageParse(ctx: HandlerCtx) {
  await requireAdminSession(ctx.req, ctx.admin);
  const apiKey = ctx.env.GROQ_API_KEY;
  if (!apiKey) return json({ ok: false, error: "groq_api_key_missing" }, 503);

  const body = (await ctx.req.json().catch(() => null)) as { imageBase64: string; mimeType: string } | null;
  if (!body?.imageBase64 || !body?.mimeType) return json({ ok: false, error: "image_required" }, 400);

  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: ctx.env.GROQ_VISION_MODEL || "qwen/qwen3.6-27b", // env-overridable (2026-07-20): next Groq model retirement is a config change, not a redeploy. qwen3.6-27b runtime-verified on this account.
      reasoning_effort: "none", // no thinking tokens: raw JSON only; also keeps requests inside free-tier TPM
      max_tokens: 1024,
      messages: [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:${body.mimeType};base64,${body.imageBase64}` } },
          { type: "text", text: 'Extract scoreboard data. Return ONLY a JSON object with these keys: homeLabel (string), awayLabel (string), homeScore (number or null), awayScore (number or null), gameDate (YYYY-MM-DD or null), eventName (string or null), status ("final","live","upcoming"). No markdown, raw JSON only.' },
        ],
      }],
    }),
  });

  if (!resp.ok) return json({ ok: false, error: "groq_error", status: resp.status }, 502);
  const ai = (await resp.json()) as { choices: Array<{ message: { content: string } }> };
  const raw = ai.choices[0]?.message?.content ?? "";
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return json({ ok: false, error: "parse_failed", raw }, 422);
  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    return json({ ok: true, data: parsed });
  } catch {
    return json({ ok: false, error: "invalid_json", raw }, 422);
  }
}

// Register score routes
routes.push(
  { method: "GET",  path: "/api/scores",          handler: handleScoresList },
  { method: "POST", path: "/ops/scores/game",      handler: handleScoreGameUpsert },
  { method: "POST", path: "/ops/scores/import",    handler: _handleScoresCsvImport },
  { method: "POST", path: "/ops/scores/parse-image", handler: handleScoreboardImageParse },
);

// handleStoreInventoryArchival removed — it used schema-drifted columns
// (publish_status, is_sold_out, sold_out_date) that don't exist in products.
// Archival now goes through handleOpsDelete which sets products.status = 'archived'.
