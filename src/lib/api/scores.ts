import { apiFetch } from '@/lib/api/client';
import { createIdempotencyKey, IDEMPOTENCY_HEADER } from '@/lib/api/idempotency';
import type { ScoreEntry, ScoreCategory, LeagueId } from '@/types';

export interface ScoresResponse {
  ok: boolean;
  games: ScoreEntry[];
}

export interface ScoreUpsertPayload {
  gameId?: string;
  category: ScoreCategory;
  leagueId?: string;
  seasonId?: string;
  homeTeamId?: string;
  awayTeamId?: string;
  participant1Label?: string;
  participant2Label?: string;
  homeScore?: number;
  awayScore?: number;
  status: string;
  gameDate?: string;
  eventName?: string;
  notes?: string;
}

/** Fetch all scores, optionally filtered by league/category/status */
export async function fetchScores(params?: {
  league?: LeagueId | 'all';
  category?: ScoreCategory | 'all';
  status?: 'recent' | 'upcoming' | 'all';
}) {
  const qs = new URLSearchParams();
  if (params?.league && params.league !== 'all') qs.set('league', params.league);
  if (params?.category && params.category !== 'all') qs.set('category', params.category);
  if (params?.status && params.status !== 'all') qs.set('status', params.status);
  const query = qs.toString();
  return apiFetch<ScoresResponse>(`/api/scores${query ? `?${query}` : ''}`);
}

/** Create or update a single game score (super admin only) */
export async function submitScoreManual(payload: ScoreUpsertPayload) {
  return apiFetch<{ ok: boolean; gameId: string }>('/ops/scores/game', {
    method: 'POST',
    headers: { [IDEMPOTENCY_HEADER]: createIdempotencyKey(`ops-score-${payload.gameId ?? 'new'}-${Date.now()}`) },
    body: JSON.stringify(payload),
  });
}

/** Bulk-import scores from parsed CSV rows (super admin only) */
export async function submitScoresCsvImport(rows: Record<string, string>[]) {
  return apiFetch<{ ok: boolean; inserted: number; failed: number; errors: string[] }>('/ops/scores/import', {
    method: 'POST',
    headers: { [IDEMPOTENCY_HEADER]: createIdempotencyKey('ops-scores-csv') },
    body: JSON.stringify({ rows }),
  });
}

/** Parse a scoreboard image and extract score fields (super admin only) */
export async function parseScoreboardImage(imageBase64: string, mimeType: string) {
  return apiFetch<{
    ok: boolean;
    data: {
      homeLabel?: string;
      awayLabel?: string;
      homeScore?: number;
      awayScore?: number;
      gameDate?: string;
      eventName?: string;
      status?: string;
    };
  }>('/ops/scores/parse-image', {
    method: 'POST',
    body: JSON.stringify({ imageBase64, mimeType }),
  });
}

/** Delete a game and its live score data (super_admin / league_admin / scorekeeper) */
export async function deleteGame(gameId: string) {
  return apiFetch<{ ok: boolean; deletedGameId: string }>(`/api/ops/games/${encodeURIComponent(gameId)}`, {
    method: 'DELETE',
  });
}

