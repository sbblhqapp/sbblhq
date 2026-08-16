import { apiFetch } from '@/lib/api/client';

export type OverlayState = {
  game_id: string;
  period: number;
  period_label: string;
  clock_seconds: number;
  live_clock_seconds?: number;
  clock_running: boolean;
  clock_last_started_at: string | null;
  home_score: number;
  away_score: number;
  home_fouls: number;
  away_fouls: number;
  home_timeouts_left: number;
  away_timeouts_left: number;
  possession: 'home' | 'away' | 'none';
  bonus_home: boolean;
  bonus_away: boolean;
  shot_clock_seconds: number | null;
  last_event_text: string | null;
  last_event_at: string | null;
  overlay_theme: string;
  show_sponsor_bug: boolean;
  show_lower_third: boolean;
  lower_third_text: string | null;
  lower_third_subtext: string | null;
};

export type OverlaySponsor = {
  id: string;
  name: string;
  tagline: string | null;
  logo_url: string | null;
  click_url: string | null;
  background_color: string | null;
  text_color: string | null;
};

export type OverlayGameMeta = {
  id: string;
  status: string;
  category: string;
  event_name: string | null;
  participant1_label: string | null;
  participant2_label: string | null;
  home_score: number | null;
  away_score: number | null;
  leagues: { code: string; name: string } | null;
  home_team: { id: string; name: string; logo_url?: string | null } | null;
  away_team: { id: string; name: string; logo_url?: string | null } | null;
};

export type OverlayPayload = {
  ok: boolean;
  game: OverlayGameMeta;
  overlay: OverlayState | null;
  sponsor: OverlaySponsor | null;
  theme: string | null;
};

export async function fetchOverlay(gameId: string, theme?: string): Promise<OverlayPayload> {
  const params = theme ? `?theme=${encodeURIComponent(theme)}` : '';
  return apiFetch<OverlayPayload>(`/api/public/overlay/${gameId}${params}`);
}

// ── Admin mutations ──────────────────────────────────────────────────
export async function patchOverlay(gameId: string, patch: Partial<OverlayState>) {
  return apiFetch<{ ok: boolean; overlay: OverlayState }>(
    `/api/ops/overlay/${gameId}/state`,
    { method: 'POST', body: JSON.stringify(patch) },
  );
}

export async function controlClock(
  gameId: string,
  action: 'start' | 'stop' | 'set',
  seconds?: number,
) {
  return apiFetch<{ ok: boolean; overlay: OverlayState }>(
    `/api/ops/overlay/${gameId}/clock`,
    { method: 'POST', body: JSON.stringify({ action, seconds }) },
  );
}

export async function updateGameStatus(gameId: string, status: string) {
  return apiFetch<{ ok: boolean; game: OverlayGameMeta }>(
    `/api/ops/overlay/${gameId}/status`,
    { method: 'POST', body: JSON.stringify({ status }) },
  );
}

export async function adjustScore(
  gameId: string,
  side: 'home' | 'away',
  opts: { delta?: number; set?: number; event?: string; idempotencyKey?: string },
) {
  const idempotencyKey =
    opts.idempotencyKey ||
    (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : undefined);

  return apiFetch<{ ok: boolean; overlay: OverlayState }>(
    `/api/ops/overlay/${gameId}/score`,
    {
      method: 'POST',
      headers: idempotencyKey ? { 'x-idempotency-key': idempotencyKey } : {},
      body: JSON.stringify({ side, ...opts, idempotencyKey }),
    },
  );
}

export async function adjustFoul(
  gameId: string,
  side: 'home' | 'away',
  opts: { delta?: number; reset?: boolean; idempotencyKey?: string },
) {
  const idempotencyKey =
    opts.idempotencyKey ||
    (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : undefined);

  return apiFetch<{ ok: boolean; overlay: OverlayState }>(
    `/api/ops/overlay/${gameId}/foul`,
    {
      method: 'POST',
      headers: idempotencyKey ? { 'x-idempotency-key': idempotencyKey } : {},
      body: JSON.stringify({ side, ...opts, idempotencyKey }),
    },
  );
}

export async function advancePeriod(
  gameId: string,
  action: 'next' | 'set',
  period?: number,
) {
  return apiFetch<{ ok: boolean; overlay: OverlayState }>(
    `/api/ops/overlay/${gameId}/period`,
    { method: 'POST', body: JSON.stringify({ action, period }) },
  );
}

export async function resetOverlay(gameId: string) {
  return apiFetch<{ ok: boolean; overlay: OverlayState }>(
    `/api/ops/overlay/${gameId}/reset`,
    { method: 'POST', body: '{}' },
  );
}

export async function postBiometrics(
  gameId: string,
  payload: {
    playerId: string;
    heartRateBpm?: number;
    staminaPct?: number;
    fatigueLevel?: 'fresh' | 'moderate' | 'tired' | 'gassed';
  }
) {
  return apiFetch<{ ok: boolean; id: string }>(
    `/api/streams/${gameId}/biometrics`,
    { method: 'POST', body: JSON.stringify(payload) }
  );
}

export async function postOverlayEvent(
  gameId: string,
  payload: {
    eventType: string;
    payload?: Record<string, unknown>;
  }
) {
  return apiFetch<{ ok: boolean; id: string }>(
    `/api/streams/${gameId}/overlay/event`,
    { method: 'POST', body: JSON.stringify(payload) }
  );
}
