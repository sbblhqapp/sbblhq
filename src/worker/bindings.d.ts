interface Env {
  SENTRY_DSN?: string;
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  RESEND_API_KEY: string;
  OMNIHUB_SYNC_URL?: string;
  OMNIHUB_SIGNING_SECRET?: string;
  OMNIHUB_VERIFY_KEY?: string;
  OPTIONAL_SOCIAL_API_KEYS?: string;
  OPTIONAL_TURNSTILE_SECRET_KEY?: string;
  GROQ_API_KEY?: string;
  // Optional override for the Groq vision model used by the /ops image-parse
  // routes. Next Groq model retirement becomes a wrangler var change instead
  // of a code deploy. Code default: "qwen/qwen3.6-27b".
  GROQ_VISION_MODEL?: string;
  ENABLE_STREAM_VALIDATION?: string;
  VITE_STREAM_URL?: string;
  OBS_AGENT_TOKEN?: string;

  // ── Auth capability flags ──────────────────────────────────────────────
  // Whether Google OAuth is currently a working sign-in path. Must be
  // explicitly set to "true" in worker vars (or wrangler.jsonc) to enable
  // the Google sign-in button in the frontend. Defaults to false so a
  // misconfigured Google Cloud OAuth client (e.g. `org_internal`) cannot
  // silently break the UX. The legacy FEATURE_GOOGLE_OAUTH alias is read
  // for back-compat with older deploy configs.
  GOOGLE_OAUTH_ENABLED?: string;
  FEATURE_GOOGLE_OAUTH?: string;

  // ── Phase 1+2 feature flags (default off; opt-in per deploy). ──────────
  // Enables playback provider abstraction + signed playback token minting
  // on the session endpoint (WS2). When false, the legacy embed path is
  // returned unchanged.
  FEATURE_SIGNED_PLAYBACK_ENABLED?: string;
  // Gates the non-CF-Stream HLS provider implementation (WS2). Requires
  // FEATURE_SIGNED_PLAYBACK_ENABLED to have any effect.
  FEATURE_NATIVE_HLS_PROVIDER?: string;
  // Renders the pre-playback preflight screen on /live (WS3).
  FEATURE_SHOW_VIEWER_PREFLIGHT?: string;
  // Exposes the fan token wallet + award flow (WS4).
  FEATURE_FAN_TOKEN_SYSTEM?: string;
  // Shows the per-player biometric overlay on 1v1/2v2 games (WS5).
  FEATURE_BIOMETRIC_OVERLAY?: string;
  // Activates the Mic Up Series branded intro sting + overlays (WS6).
  FEATURE_MIC_UP_SERIES?: string;

  // HMAC-SHA256 signing secret for native-HLS playback tokens. Required
  // when FEATURE_NATIVE_HLS_PROVIDER is enabled. Wrangler secret, never
  // inlined in config.
  PLAYBACK_TOKEN_SECRET?: string;

  // HMAC-SHA256 signing secret for HLS stream proxy authentication cookies.
  // Falls back to OMNIHUB_SIGNING_SECRET if unset. Must NOT fall back to
  // SUPABASE_SERVICE_ROLE_KEY — set this explicitly for any deployment that
  // serves streams via the proxy delivery class.
  STREAM_PROXY_SECRET?: string;

  // Per-user award rate limit (awards per minute) when the fan-token
  // feature is on. Defaults to 30 in code if unset.
  FAN_TOKEN_AWARD_RATE_PER_MIN?: string;

  // WS5 — biometric ingest rate limit per player per minute (default 60).
  BIOMETRIC_INGEST_RATE_PER_MIN?: string;
  BIOMETRIC_WEBHOOK_SECRET?: string;

  ASSETS: { fetch: (req: Request) => Promise<Response> };
}

interface ScheduledEvent {
  cron: string;
  type: string;
  scheduledTime: number;
  noRetry(): void;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

