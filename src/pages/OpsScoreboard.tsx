/**
 * /ops/scoreboard/:gameId — Dedicated League Admin Live Tabulation Scoreboard Monitor
 *
 * Admin-only route. Displays real-time game scores and live projected standings shifts
 * with direct links to courtside scorekeeper and overlay control.
 */
import React, { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Activity, Radio, ArrowLeft, ExternalLink, Shield } from 'lucide-react';
import { LiveScoreboard } from '@/components/LiveScoreboard/LiveScoreboard';
import { fetchOverlay, type OverlayPayload } from '@/lib/api/overlay';
import { fetchScores } from '@/lib/api/scores';
import { LEAGUE_REGISTRY } from '@/lib/leagues';
import type { LeagueId } from '@/types';

export default function OpsScoreboardPage() {
  const { gameId: paramGameId } = useParams<{ gameId?: string }>();
  const navigate = useNavigate();
  const [selectedLeague, setSelectedLeague] = useState<LeagueId>('wbl');

  // Fetch recent/active games for selection dropdown
  const gamesQuery = useQuery({
    queryKey: ['ops', 'scoreboard-games', selectedLeague],
    queryFn: () => fetchScores({ league: selectedLeague }),
    staleTime: 10_000,
  });

  const gamesList = gamesQuery.data?.games ?? [];
  const activeGameId = paramGameId || (gamesList.length > 0 ? gamesList[0].id : null);

  // Fetch overlay details for the selected game
  const overlayQuery = useQuery<OverlayPayload>({
    queryKey: ['overlay', activeGameId],
    queryFn: () => fetchOverlay(activeGameId!),
    enabled: !!activeGameId,
    refetchInterval: 3000,
  });

  const game = overlayQuery.data?.game;
  const overlay = overlayQuery.data?.overlay ?? null;

  return (
    <div className="container py-6 max-w-4xl font-['Space_Grotesk'] text-[#F5F5F0]">
      {/* ── Admin Header ──────────────────────────────────────────────────────── */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-[#222222] pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Link
              to="/ops"
              className="inline-flex items-center gap-1 text-xs text-[#8A8A8A] hover:text-[#F5F5F0] transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Ops Console
            </Link>
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-[#F5F5F0] flex items-center gap-2">
            <Shield className="h-6 w-6 text-[#C9A84C]" />
            Live Tabulation Scoreboard
            <span className="rounded-full bg-[#C9A84C]/20 px-2.5 py-0.5 text-[11px] font-bold text-[#C9A84C]">
              LEAGUE ADMIN
            </span>
          </h1>
          <p className="text-xs text-[#8A8A8A] mt-0.5">
            Real-time score monitor with dynamic live projected standings calculation.
          </p>
        </div>

        {/* Action Links */}
        {activeGameId && (
          <div className="flex items-center gap-2">
            <Link
              to={`/scorekeeper/${activeGameId}`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#C9A84C] px-3 py-1.5 text-xs font-bold text-[#0A0A0A] hover:bg-[#E8C76A] transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Courtside Scorekeeper
            </Link>
            <Link
              to={`/overlay-control/${activeGameId}`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#1F1F1F] border border-[#333333] px-3 py-1.5 text-xs font-bold text-[#F5F5F0] hover:bg-[#2A2A2A] transition-colors"
            >
              <Radio className="h-3.5 w-3.5 text-[#C9A84C]" />
              Overlay Control
            </Link>
          </div>
        )}
      </div>

      {/* ── League & Game Selector ────────────────────────────────────────────── */}
      <div className="mb-6 rounded-xl border border-[#222222] bg-[#111111] p-4 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-[#8A8A8A] uppercase tracking-wider">League:</span>
          <div className="flex gap-1">
            {LEAGUE_REGISTRY.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => {
                  setSelectedLeague(l.id);
                  if (paramGameId) navigate('/ops/scoreboard');
                }}
                className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${
                  selectedLeague === l.id
                    ? 'bg-[#C9A84C] text-[#0A0A0A]'
                    : 'bg-[#1A1A1A] text-[#8A8A8A] hover:text-[#F5F5F0]'
                }`}
              >
                {l.name}
              </button>
            ))}
          </div>
        </div>

        {/* Game Selector */}
        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
          <span className="text-xs font-semibold text-[#8A8A8A] uppercase tracking-wider">Game:</span>
          <select
            value={activeGameId ?? ''}
            onChange={(e) => navigate(`/ops/scoreboard/${e.target.value}`)}
            className="flex-1 rounded-md border border-[#262626] bg-[#181818] px-3 py-1.5 text-xs font-medium text-[#F5F5F0] focus:border-[#C9A84C] focus:outline-none"
          >
            {gamesQuery.isLoading ? (
              <option>Loading games...</option>
            ) : gamesList.length > 0 ? (
              gamesList.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.awayLabel} vs {g.homeLabel} ({g.status.toUpperCase()})
                </option>
              ))
            ) : (
              <option value="">No games found for {selectedLeague.toUpperCase()}</option>
            )}
          </select>
        </div>
      </div>

      {/* ── Live Scoreboard Component ─────────────────────────────────────────── */}
      {activeGameId ? (
        <LiveScoreboard
          gameId={activeGameId}
          homeTeamName={game?.home_team?.name ?? gamesList.find((g) => g.id === activeGameId)?.homeLabel ?? 'Home'}
          awayTeamName={game?.away_team?.name ?? gamesList.find((g) => g.id === activeGameId)?.awayLabel ?? 'Away'}
          homeTeamLogo={game?.home_team?.logo_url ?? null}
          awayTeamLogo={game?.away_team?.logo_url ?? null}
          initialScore={overlay}
          className="shadow-2xl"
        />
      ) : (
        <div className="rounded-xl border border-[#222222] bg-[#111111] p-8 text-center text-[#8A8A8A]">
          <Activity className="h-10 w-10 mx-auto mb-3 text-[#8A8A8A]" />
          <h3 className="text-base font-bold text-[#F5F5F0]">No Game Selected</h3>
          <p className="text-xs mt-1">Select a game from the dropdown above to view live tabulation.</p>
        </div>
      )}
    </div>
  );
}
