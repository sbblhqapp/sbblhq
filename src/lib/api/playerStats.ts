import { apiFetch } from '@/lib/api/client';

export interface GamePlayerStat {
  playerId: string;
  playerName: string;
  jerseyNumber: number | null;
  position?: string | null;
  avatarUrl?: string | null;
  teamId: string | null;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  fls: number;
  min: number;
}

export interface GamePlayerStatsResponse {
  ok: boolean;
  gameId: string;
  home: {
    teamId: string | null;
    teamName: string;
    players: GamePlayerStat[];
  };
  away: {
    teamId: string | null;
    teamName: string;
    players: GamePlayerStat[];
  };
}

export type StatType = 'pts' | 'reb' | 'ast' | 'stl' | 'blk' | 'fls' | 'min';
export type PlayerStatType = StatType;

/** Fetch player roster and game stats for both teams */
export async function fetchGamePlayerStats(gameId: string): Promise<GamePlayerStatsResponse> {
  return apiFetch<GamePlayerStatsResponse>(`/api/public/games/${gameId}/player-stats`);
}

/** Record or adjust a player stat courtside with atomic idempotency */
export async function recordPlayerStat(
  gameId: string,
  payload: {
    playerId: string;
    stat: StatType;
    delta?: number;
    set?: number;
    teamSide?: 'home' | 'away';
    syncTeamScore?: boolean;
    idempotencyKey?: string;
  }
) {
  const idempotencyKey =
    payload.idempotencyKey ||
    (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : undefined);

  return apiFetch<{ ok: boolean; stats: unknown; idempotent?: boolean }>(
    `/api/ops/games/${gameId}/player-stats`,
    {
      method: 'POST',
      headers: idempotencyKey ? { 'x-idempotency-key': idempotencyKey } : {},
      body: JSON.stringify({ ...payload, idempotencyKey }),
    }
  );
}

/** Quick-add an ad-hoc player to a team's game roster */
export async function quickAddGamePlayer(
  gameId: string,
  payload: {
    name: string;
    jerseyNumber?: number | string;
    teamSide: 'home' | 'away';
  }
) {
  return apiFetch<{
    ok: boolean;
    player: { id: string; name: string; jerseyNumber: number | null; teamId: string | null };
  }>(`/api/ops/games/${gameId}/quick-player`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
