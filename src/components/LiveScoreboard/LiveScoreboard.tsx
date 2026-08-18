/**
 * LiveScoreboard Component
 *
 * Real-time tabulation scoreboard for SBBL HQ.
 * Connects to live game overlay state and projects real-time standings shifts.
 *
 * Invariants:
 *   - Dark-Gold brand tokens (#0A0A0A, #111111, #C9A84C, #F5F5F0)
 *   - Handles all 5 states: Loading, Error, Empty, Connected, Reconnecting
 *   - "LIVE PROJECTED" badge prominently displayed whenever live adjustments are active
 *   - 60fps Framer Motion score pulse and rank-movement transitions
 *   - WCAG 2.2 AA accessible, responsive 320px+
 */
import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Clock,
  Radio,
  RefreshCw,
  TrendingUp,
  Minus,
} from 'lucide-react';
import {
  useLiveScoreboardRealtime,
  type ProjectedStanding,
  type ConnectionStatus,
} from '@/hooks/useLiveScoreboardRealtime';
import type { OverlayState } from '@/lib/api/overlay';

export interface LiveScoreboardProps {
  gameId: string | null;
  leagueId?: string | null;
  seasonId?: string | null;
  homeTeamName?: string;
  awayTeamName?: string;
  homeTeamLogo?: string | null;
  awayTeamLogo?: string | null;
  initialScore?: OverlayState | null;
  initialStandings?: ProjectedStanding[];
  className?: string;
}

export function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mm = Math.floor(safe / 60);
  const ss = safe % 60;
  if (safe < 60) {
    const tenths = Math.max(0, Math.min(9, Math.round((seconds - safe) * 10)));
    return `${ss}.${tenths}`;
  }
  return `${mm.toString().padStart(2, '0')}:${ss.toString().padStart(2, '0')}`;
}

export interface LiveScoreboardViewProps {
  gameId: string | null;
  homeTeamName?: string;
  awayTeamName?: string;
  homeTeamLogo?: string | null;
  awayTeamLogo?: string | null;
  liveScore: OverlayState | null;
  liveStandings: ProjectedStanding[];
  connectionStatus: ConnectionStatus;
  isLoading: boolean;
  error: string | null;
  onRefresh?: () => void;
  className?: string;
}

export const LiveScoreboardView: React.FC<LiveScoreboardViewProps> = ({
  gameId,
  homeTeamName = 'Home',
  awayTeamName = 'Away',
  homeTeamLogo = null,
  awayTeamLogo = null,
  liveScore,
  liveStandings,
  connectionStatus,
  isLoading,
  error,
  onRefresh,
  className = '',
}) => {
  const [standingsExpanded, setStandingsExpanded] = useState<boolean>(false);

  const isLiveAdjusted = useMemo(
    () => liveStandings.some((s) => s.is_live_adjusted),
    [liveStandings]
  );

  // ── 1. Empty State ────────────────────────────────────────────────────────
  if (!gameId) {
    return (
      <div
        data-testid="live-scoreboard-empty"
        className={`rounded-xl border border-[#222222] bg-[#111111] p-6 text-center text-[#F5F5F0] font-['Space_Grotesk'] ${className}`}
      >
        <div className="flex flex-col items-center justify-center gap-2">
          <Activity className="h-8 w-8 text-[#8A8A8A]" />
          <h3 className="text-base font-semibold tracking-wide text-[#F5F5F0]">
            No Live Game Selected
          </h3>
          <p className="text-xs text-[#8A8A8A]">
            Select an active game from the schedule to monitor real-time scores and projected standings.
          </p>
        </div>
      </div>
    );
  }

  // ── 2. Loading State ──────────────────────────────────────────────────────
  if (isLoading && !liveScore) {
    return (
      <div
        data-testid="live-scoreboard-loading"
        className={`rounded-xl border border-[#222222] bg-[#111111] p-6 text-center text-[#F5F5F0] font-['Space_Grotesk'] ${className}`}
      >
        <div className="flex flex-col items-center justify-center gap-3">
          <RefreshCw className="h-6 w-6 animate-spin text-[#C9A84C]" />
          <p className="text-sm font-medium text-[#8A8A8A]">
            Connecting to live scoreboard stream...
          </p>
        </div>
      </div>
    );
  }

  // ── 3. Error State ────────────────────────────────────────────────────────
  if (error && !liveScore) {
    return (
      <div
        data-testid="live-scoreboard-error"
        className={`rounded-xl border border-[#E63946]/40 bg-[#111111] p-6 text-center text-[#F5F5F0] font-['Space_Grotesk'] ${className}`}
      >
        <div className="flex flex-col items-center justify-center gap-3">
          <AlertCircle className="h-8 w-8 text-[#E63946]" />
          <h3 className="text-sm font-semibold text-[#E63946]">Scoreboard Stream Error</h3>
          <p className="text-xs text-[#8A8A8A]">{error}</p>
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              className="mt-2 inline-flex items-center gap-2 rounded-lg bg-[#C9A84C] px-3 py-1.5 text-xs font-semibold text-[#0A0A0A] transition-colors hover:bg-[#E8C76A]"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Retry Connection
            </button>
          )}
        </div>
      </div>
    );
  }

  const homeScore = liveScore?.home_score ?? 0;
  const awayScore = liveScore?.away_score ?? 0;
  const periodLabel = liveScore?.period_label ?? 'Q1';
  const clockSeconds = liveScore?.clock_seconds ?? 600;
  const clockRunning = liveScore?.clock_running ?? false;
  const possession = liveScore?.possession ?? 'none';

  return (
    <div
      data-testid="live-scoreboard"
      className={`rounded-xl border border-[#222222] bg-[#111111] p-4 sm:p-6 text-[#F5F5F0] shadow-2xl font-['Space_Grotesk'] ${className}`}
    >
      {/* ── Status Banner (Connected / Reconnecting) ────────────────────────── */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-[#222222] pb-3">
        <div className="flex items-center gap-2">
          {connectionStatus === 'connected' ? (
            <span
              data-testid="status-connected"
              className="inline-flex items-center gap-1.5 rounded-full bg-[#2DC653]/15 px-2.5 py-0.5 text-xs font-semibold text-[#2DC653]"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-[#2DC653] animate-pulse" />
              LIVE REALTIME
            </span>
          ) : (
            <span
              data-testid="status-reconnecting"
              className="inline-flex items-center gap-1.5 rounded-full bg-[#C9A84C]/15 px-2.5 py-0.5 text-xs font-semibold text-[#C9A84C]"
            >
              <RefreshCw className="h-3 w-3 animate-spin text-[#C9A84C]" />
              RECONNECTING
            </span>
          )}

          <div className="flex items-center gap-1.5 text-xs font-medium text-[#8A8A8A]">
            <Radio className="h-3.5 w-3.5 text-[#C9A84C]" />
            <span>{periodLabel}</span>
          </div>
        </div>

        {/* Clock display */}
        <div className="flex items-center gap-1.5 font-mono text-sm sm:text-base font-bold text-[#F5F5F0]">
          <Clock className={`h-4 w-4 ${clockRunning ? 'text-[#2DC653] animate-pulse' : 'text-[#8A8A8A]'}`} />
          <span>{formatClock(clockSeconds)}</span>
        </div>
      </div>

      {/* ── Matchup Scores ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 sm:gap-8 items-center justify-center my-4">
        {/* Home Team */}
        <div className="flex flex-col items-center text-center">
          <div className="relative mb-2 flex h-14 w-14 sm:h-16 sm:w-16 items-center justify-center rounded-full bg-[#1A1A1A] border border-[#2A2A2A]">
            {homeTeamLogo ? (
              <img src={homeTeamLogo} alt={homeTeamName} className="h-10 w-10 sm:h-12 sm:w-12 object-contain" />
            ) : (
              <span className="text-base sm:text-lg font-bold text-[#C9A84C]">{(homeTeamName || 'HOM').slice(0, 3).toUpperCase()}</span>
            )}
            {possession === 'home' && (
              <span className="absolute -bottom-1 -right-1 rounded-full bg-[#C9A84C] px-1.5 py-0.5 text-[9px] font-bold text-[#0A0A0A]">
                POSS
              </span>
            )}
          </div>
          <span className="text-xs sm:text-sm font-semibold text-[#F5F5F0] truncate max-w-[120px] sm:max-w-[160px]">
            {homeTeamName}
          </span>
          <div className="mt-1 flex items-center gap-1.5 text-[10px] text-[#8A8A8A]">
            <span>Fouls: {liveScore?.home_fouls ?? 0}</span>
            {liveScore?.bonus_home && (
              <span className="rounded bg-[#C9A84C]/20 px-1 py-0.2 text-[9px] font-bold text-[#C9A84C]">BONUS</span>
            )}
          </div>
          <motion.div
            key={homeScore}
            initial={{ scale: 1.2, color: '#E8C76A' }}
            animate={{ scale: 1, color: '#F5F5F0' }}
            transition={{ duration: 0.3 }}
            className="mt-2 text-3xl sm:text-5xl font-black font-mono tracking-tight"
          >
            {homeScore}
          </motion.div>
        </div>

        {/* Away Team */}
        <div className="flex flex-col items-center text-center">
          <div className="relative mb-2 flex h-14 w-14 sm:h-16 sm:w-16 items-center justify-center rounded-full bg-[#1A1A1A] border border-[#2A2A2A]">
            {awayTeamLogo ? (
              <img src={awayTeamLogo} alt={awayTeamName} className="h-10 w-10 sm:h-12 sm:w-12 object-contain" />
            ) : (
              <span className="text-base sm:text-lg font-bold text-[#C9A84C]">{(awayTeamName || 'AWY').slice(0, 3).toUpperCase()}</span>
            )}
            {possession === 'away' && (
              <span className="absolute -bottom-1 -right-1 rounded-full bg-[#C9A84C] px-1.5 py-0.5 text-[9px] font-bold text-[#0A0A0A]">
                POSS
              </span>
            )}
          </div>
          <span className="text-xs sm:text-sm font-semibold text-[#F5F5F0] truncate max-w-[120px] sm:max-w-[160px]">
            {awayTeamName}
          </span>
          <div className="mt-1 flex items-center gap-1.5 text-[10px] text-[#8A8A8A]">
            <span>Fouls: {liveScore?.away_fouls ?? 0}</span>
            {liveScore?.bonus_away && (
              <span className="rounded bg-[#C9A84C]/20 px-1 py-0.2 text-[9px] font-bold text-[#C9A84C]">BONUS</span>
            )}
          </div>
          <motion.div
            key={awayScore}
            initial={{ scale: 1.2, color: '#E8C76A' }}
            animate={{ scale: 1, color: '#F5F5F0' }}
            transition={{ duration: 0.3 }}
            className="mt-2 text-3xl sm:text-5xl font-black font-mono tracking-tight"
          >
            {awayScore}
          </motion.div>
        </div>
      </div>

      {/* Last Event Ticker */}
      {liveScore?.last_event_text && (
        <div className="mt-2 rounded-lg bg-[#181818] px-3 py-1.5 text-center text-xs text-[#8A8A8A] border border-[#262626]">
          <span className="text-[#C9A84C] font-semibold">PLAY: </span>
          {liveScore.last_event_text}
        </div>
      )}

      {/* ── Standings Movement Section ──────────────────────────────────────── */}
      <div className="mt-6 border-t border-[#222222] pt-4">
        <button
          type="button"
          onClick={() => setStandingsExpanded((prev) => !prev)}
          className="flex w-full items-center justify-between rounded-lg bg-[#161616] p-3 text-left transition-colors hover:bg-[#1C1C1C] border border-[#262626]"
        >
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-[#C9A84C]" />
            <span className="text-xs sm:text-sm font-bold tracking-wide text-[#F5F5F0]">
              LIVE TABULATION STANDINGS
            </span>
            {isLiveAdjusted && (
              <span
                data-testid="live-projected-badge-ticker"
                className="rounded-full bg-[#C9A84C]/20 px-2 py-0.5 text-[10px] font-bold tracking-wider text-[#C9A84C]"
              >
                LIVE PROJECTED
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 text-xs font-semibold text-[#8A8A8A]">
            <span>{standingsExpanded ? 'Collapse' : 'Expand'}</span>
            {standingsExpanded ? (
              <ChevronUp className="h-4 w-4 text-[#8A8A8A]" />
            ) : (
              <ChevronDown className="h-4 w-4 text-[#8A8A8A]" />
            )}
          </div>
        </button>

        {/* Collapsed Movement Preview */}
        {!standingsExpanded && isLiveAdjusted && (
          <div className="mt-2 flex items-center gap-2 px-1 text-xs text-[#8A8A8A]">
            <TrendingUp className="h-3.5 w-3.5 text-[#2DC653]" />
            <span>Standings movement actively calculating from in-game score.</span>
          </div>
        )}

        {/* Expanded Projected Standings Table */}
        <AnimatePresence>
          {standingsExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="overflow-hidden"
            >
              <div className="mt-3 overflow-x-auto rounded-lg border border-[#262626] bg-[#0E0E0E] p-3">
                {isLiveAdjusted && (
                  <div
                    data-testid="live-projected-badge"
                    className="mb-3 flex items-center justify-between rounded-md bg-[#C9A84C]/10 px-2.5 py-1.5 border border-[#C9A84C]/30"
                  >
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-[#C9A84C] animate-ping" />
                      <span className="text-xs font-bold text-[#C9A84C]">LIVE PROJECTED STANDINGS</span>
                    </div>
                    <span className="text-[10px] text-[#8A8A8A]">
                      Reconciles to official record on game-final
                    </span>
                  </div>
                )}

                {liveStandings.length === 0 ? (
                  <div className="py-4 text-center text-xs text-[#8A8A8A]">
                    No season standings data loaded.
                  </div>
                ) : (
                  <table className="w-full text-left text-xs text-[#F5F5F0]">
                    <thead>
                      <tr className="border-b border-[#222222] text-[#8A8A8A]">
                        <th className="pb-2 font-medium">Team ID</th>
                        <th className="pb-2 text-center font-medium">W</th>
                        <th className="pb-2 text-center font-medium">L</th>
                        <th className="pb-2 text-center font-medium">PF</th>
                        <th className="pb-2 text-center font-medium">PA</th>
                        <th className="pb-2 text-right font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1A1A1A]">
                      {liveStandings.map((team) => (
                        <tr key={team.team_id} className="transition-colors hover:bg-[#141414]">
                          <td className="py-2.5 font-mono text-[11px] text-[#F5F5F0] truncate max-w-[100px]">
                            {(team.team_id || '').slice(0, 8)}...
                          </td>
                          <td className="py-2.5 text-center font-bold text-[#2DC653]">{team.wins}</td>
                          <td className="py-2.5 text-center font-bold text-[#E63946]">{team.losses}</td>
                          <td className="py-2.5 text-center font-mono text-[#8A8A8A]">{team.pts_for}</td>
                          <td className="py-2.5 text-center font-mono text-[#8A8A8A]">{team.pts_against}</td>
                          <td className="py-2.5 text-right">
                            {team.is_live_adjusted ? (
                              <span className="inline-flex items-center gap-1 rounded bg-[#C9A84C]/20 px-1.5 py-0.5 text-[9px] font-bold text-[#C9A84C]">
                                <TrendingUp className="h-2.5 w-2.5" />
                                LIVE
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[9px] text-[#8A8A8A]">
                                <Minus className="h-2.5 w-2.5" />
                                FINAL
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export const LiveScoreboard: React.FC<LiveScoreboardProps> = ({
  gameId,
  leagueId,
  seasonId,
  homeTeamName = 'Home',
  awayTeamName = 'Away',
  homeTeamLogo = null,
  awayTeamLogo = null,
  initialScore = null,
  initialStandings = [],
  className = '',
}) => {
  const {
    liveScore,
    liveStandings,
    connectionStatus,
    isLoading,
    error,
    refreshStandings,
  } = useLiveScoreboardRealtime({
    gameId,
    leagueId,
    seasonId,
    initialScore,
    initialStandings,
  });

  return (
    <LiveScoreboardView
      gameId={gameId}
      homeTeamName={homeTeamName}
      awayTeamName={awayTeamName}
      homeTeamLogo={homeTeamLogo}
      awayTeamLogo={awayTeamLogo}
      liveScore={liveScore}
      liveStandings={liveStandings}
      connectionStatus={connectionStatus}
      isLoading={isLoading}
      error={error}
      onRefresh={refreshStandings}
      className={className}
    />
  );
};

export default LiveScoreboard;
