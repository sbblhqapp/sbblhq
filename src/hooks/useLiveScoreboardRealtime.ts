/**
 * Realtime subscription hook for the Live Tabulation Scoreboard.
 *
 * Sourced from `overlay_game_state` (live per-game scores and clock) and
 * `fn_live_standings_preview` (live projected standings).
 *
 * Invariants:
 *   - Follows the exact subscribe/unsubscribe/cleanup pattern of useTokenLeaderboardRealtime.
 *   - Realtime table changes on `overlay_game_state` update `liveScore` immediately (<100ms).
 *   - Live projected standings re-fetching is debounced (3s) to respect the <5s SLA
 *     without hammering the database on every clock tick.
 *   - Channel is cleaned up and unmounted on gameId change or unmount.
 *   - Safe no-op when gameId is null.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { OverlayState } from '@/lib/api/overlay';

export interface ProjectedStanding {
  team_id: string;
  wins: number;
  losses: number;
  pts_for: number;
  pts_against: number;
  is_live_adjusted: boolean;
}

export type ConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error'
  | 'disconnected';

export interface UseLiveScoreboardOptions {
  gameId: string | null;
  leagueId?: string | null;
  seasonId?: string | null;
  initialScore?: OverlayState | null;
  initialStandings?: ProjectedStanding[];
}

export interface UseLiveScoreboardResult {
  liveScore: OverlayState | null;
  liveStandings: ProjectedStanding[];
  connectionStatus: ConnectionStatus;
  isLoading: boolean;
  error: string | null;
  refreshStandings: () => Promise<void>;
}

export function dbRowToOverlayState(row: Record<string, unknown>): OverlayState {
  return {
    game_id: String(row.game_id ?? ''),
    period: Number(row.period ?? 1),
    period_label: String(row.period_label ?? 'Q1'),
    clock_seconds: Number(row.clock_seconds ?? 600),
    live_clock_seconds: typeof row.live_clock_seconds === 'number' ? row.live_clock_seconds : undefined,
    clock_running: Boolean(row.clock_running),
    clock_last_started_at: row.clock_last_started_at ? String(row.clock_last_started_at) : null,
    home_score: Number(row.home_score ?? 0),
    away_score: Number(row.away_score ?? 0),
    home_fouls: Number(row.home_fouls ?? 0),
    away_fouls: Number(row.away_fouls ?? 0),
    home_timeouts_left: Number(row.home_timeouts_left ?? 4),
    away_timeouts_left: Number(row.away_timeouts_left ?? 4),
    possession: (['home', 'away', 'none'].includes(String(row.possession))
      ? row.possession
      : 'none') as OverlayState['possession'],
    bonus_home: Boolean(row.bonus_home),
    bonus_away: Boolean(row.bonus_away),
    shot_clock_seconds: typeof row.shot_clock_seconds === 'number' ? row.shot_clock_seconds : null,
    last_event_text: row.last_event_text ? String(row.last_event_text) : null,
    last_event_at: row.last_event_at ? String(row.last_event_at) : null,
    overlay_theme: String(row.overlay_theme ?? 'default'),
    show_sponsor_bug: row.show_sponsor_bug !== false,
    show_lower_third: Boolean(row.show_lower_third),
    lower_third_text: row.lower_third_text ? String(row.lower_third_text) : null,
    lower_third_subtext: row.lower_third_subtext ? String(row.lower_third_subtext) : null,
  };
}

export function useLiveScoreboardRealtime({
  gameId,
  leagueId,
  seasonId,
  initialScore = null,
  initialStandings = [],
}: UseLiveScoreboardOptions): UseLiveScoreboardResult {
  const [liveScore, setLiveScore] = useState<OverlayState | null>(initialScore);
  const [liveStandings, setLiveStandings] = useState<ProjectedStanding[]>(initialStandings);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(
    gameId ? 'connecting' : 'disconnected'
  );
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const scoreRef = useRef<OverlayState | null>(initialScore);
  scoreRef.current = liveScore;

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchStandings = useCallback(async () => {
    if (!leagueId || !seasonId) return;
    try {
      const supabase = getSupabaseClient();
      if (supabase) {
        const { data, error: rpcErr } = await supabase.rpc('fn_live_standings_preview', {
          p_league_id: leagueId,
          p_season_id: seasonId,
        });
        if (!rpcErr && Array.isArray(data)) {
          setLiveStandings(data as ProjectedStanding[]);
          return;
        }
      }

      // Fallback to public worker route
      const res = await fetch(`/api/public/live-standings/${leagueId}/${seasonId}`);
      if (res.ok) {
        const json = await res.json();
        if (json.ok && Array.isArray(json.data)) {
          setLiveStandings(json.data);
        }
      }
    } catch (err) {
      console.warn('[useLiveScoreboardRealtime] Standings preview fetch failed:', err);
    }
  }, [leagueId, seasonId]);

  const scheduleStandingsRefresh = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      fetchStandings();
    }, 3000);
  }, [fetchStandings]);

  useEffect(() => {
    setLiveScore(initialScore);
    scoreRef.current = initialScore;
  }, [initialScore]);

  useEffect(() => {
    setLiveStandings(initialStandings);
  }, [initialStandings]);

  useEffect(() => {
    if (leagueId && seasonId) {
      setIsLoading(true);
      fetchStandings().finally(() => setIsLoading(false));
    }
  }, [leagueId, seasonId, fetchStandings]);

  useEffect(() => {
    if (!gameId) {
      setConnectionStatus('disconnected');
      return;
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
      setConnectionStatus('error');
      setError('Supabase client unavailable');
      return;
    }

    setConnectionStatus('connecting');

    const channel = supabase
      .channel(`live-scoreboard:${gameId}`)
      .on(
        'postgres_changes' as never,
        {
          event: '*',
          schema: 'public',
          table: 'overlay_game_state',
          filter: `game_id=eq.${gameId}`,
        } as never,
        (payload: { new?: Record<string, unknown>; eventType?: string }) => {
          if (!payload.new) return;
          const nextState = dbRowToOverlayState(payload.new);
          scoreRef.current = nextState;
          setLiveScore(nextState);
          // Trigger debounced standings refresh when live state updates
          scheduleStandingsRefresh();
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setConnectionStatus('connected');
          setError(null);
        } else if (status === 'TIMED_OUT' || status === 'CHANNEL_ERROR') {
          setConnectionStatus('reconnecting');
        } else if (status === 'CLOSED') {
          setConnectionStatus('disconnected');
        }
      });

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      supabase.removeChannel(channel);
    };
  }, [gameId, scheduleStandingsRefresh]);

  return {
    liveScore,
    liveStandings,
    connectionStatus,
    isLoading,
    error,
    refreshStandings: fetchStandings,
  };
}
