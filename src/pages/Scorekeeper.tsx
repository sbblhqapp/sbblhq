/**
 * /scorekeeper/:gameId — Unified Courtside Scoring Console
 *
 * Admin-only. Mobile-optimized, thumb-first courtside control surface
 * unifying Live Scoreboard, Courtside Quick Controls, and Player Stats Tracking.
 */
import React from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Shield, ArrowLeft, Radio } from 'lucide-react';
import { fetchOverlay, type OverlayPayload } from '@/lib/api/overlay';
import { LiveScoreboard } from '@/components/LiveScoreboard/LiveScoreboard';
import { CourtsideQuickControls } from '@/components/LiveScoreboard/CourtsideQuickControls';
import { PlayerStatsTracker } from '@/components/LiveScoreboard/PlayerStatsTracker';

export default function ScorekeeperPage() {
  const { gameId } = useParams<{ gameId: string }>();

  const query = useQuery<OverlayPayload>({
    queryKey: ['scorekeeper', gameId],
    queryFn: () => fetchOverlay(gameId!),
    refetchInterval: 2000,
    refetchIntervalInBackground: false,
    enabled: !!gameId,
    retry: false,
  });

  const overlay = query.data?.overlay ?? null;
  const game = query.data?.game;

  // ── Early returns ──────────────────────────────────────────────────────────
  if (!gameId) {
    return (
      <div className="container py-6 max-w-2xl font-['Space_Grotesk'] text-[#F5F5F0]">
        <div className="rounded-xl border border-[#222222] bg-[#111111] p-6 text-center">
          Missing gameId in URL.
        </div>
      </div>
    );
  }

  if (query.isLoading) {
    return (
      <div className="container py-6 max-w-2xl font-['Space_Grotesk'] text-[#F5F5F0]">
        <div className="rounded-xl border border-[#222222] bg-[#111111] p-6 text-center">
          Loading courtside console…
        </div>
      </div>
    );
  }

  if (query.isError || !game) {
    return (
      <div className="container py-6 max-w-2xl font-['Space_Grotesk'] text-[#F5F5F0]">
        <div className="rounded-xl border border-[#222222] bg-[#111111] p-6 text-center space-y-3">
          <div className="font-bold text-lg text-[#F5F5F0]">Game Not Found</div>
          <p className="text-xs text-[#8A8A8A]">
            No game matches ID <code className="text-[#C9A84C]">{gameId}</code>.
          </p>
          <Link
            to="/ops/scoreboard"
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#C9A84C] px-4 py-2 text-xs font-bold text-[#0A0A0A]"
          >
            Go to Scoreboard Launcher →
          </Link>
        </div>
      </div>
    );
  }

  const leagueCode = game.leagues?.code ?? '';
  const awayName = game.away_team?.name ?? game.participant2_label ?? 'Away';
  const homeName = game.home_team?.name ?? game.participant1_label ?? 'Home';

  return (
    <div className="container py-4 max-w-3xl font-['Space_Grotesk'] text-[#F5F5F0] space-y-5">
      {/* ── Top Header ──────────────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#222222] pb-3">
        <div>
          <Link
            to="/ops/scoreboard"
            className="inline-flex items-center gap-1 text-xs text-[#8A8A8A] hover:text-[#F5F5F0] transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Scoreboard Command Center
          </Link>
          <h1 className="mt-1 text-xl font-bold tracking-tight text-[#F5F5F0] flex items-center gap-2">
            <Shield className="h-5 w-5 text-[#C9A84C]" />
            {leagueCode ? `${leagueCode.toUpperCase()} · ` : ''}
            {awayName} @ {homeName}
            <span className="rounded-full bg-[#C9A84C]/20 px-2 py-0.5 text-[10px] font-bold text-[#C9A84C]">
              COURTSIDE
            </span>
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <Link
            to={`/overlay-control/${gameId}`}
            className="inline-flex items-center gap-1 rounded-lg bg-[#1F1F1F] border border-[#333333] px-3 py-1.5 text-xs font-bold text-[#F5F5F0] hover:bg-[#2A2A2A] transition-colors"
          >
            <Radio className="h-3.5 w-3.5 text-[#C9A84C]" />
            Overlay Room
          </Link>
        </div>
      </header>

      {/* ── 1. Live Tabulation Scoreboard & Projected Standings ─────────────── */}
      <section aria-label="Live Tabulation Scoreboard">
        <LiveScoreboard
          gameId={gameId}
          homeTeamName={homeName}
          awayTeamName={awayName}
          homeTeamLogo={game.home_team?.logo_url ?? null}
          awayTeamLogo={game.away_team?.logo_url ?? null}
          initialScore={overlay}
          className="shadow-2xl"
        />
      </section>

      {/* ── 2. Unified Courtside Scoring & Clock Controls ───────────────────── */}
      <section aria-label="Courtside Scoring Controls">
        <CourtsideQuickControls
          gameId={gameId}
          homeTeamName={homeName}
          awayTeamName={awayName}
          overlayState={overlay}
          onMutationSuccess={() => {
            query.refetch();
          }}
        />
      </section>

      {/* ── 3. Individual Player Stats & Live Box Score ─────────────────────── */}
      <section aria-label="Individual Player Stats">
        <PlayerStatsTracker
          gameId={gameId}
          onStatChange={() => {
            query.refetch();
          }}
        />
      </section>
    </div>
  );
}
