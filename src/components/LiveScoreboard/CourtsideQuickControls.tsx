/**
 * CourtsideQuickControls Component
 *
 * Integrated scoring and game clock control panel for League Admins.
 * Allows instant live score tabulation without navigating across separate screens.
 */
import React, { useState } from 'react';
import { toast } from 'sonner';
import {
  Play,
  Square,
  Plus,
  RotateCcw,
  FastForward,
  CheckCircle2,
  Volume2,
  Clock,
  Radio,
} from 'lucide-react';
import {
  adjustScore,
  adjustFoul,
  controlClock,
  advancePeriod,
  patchOverlay,
  updateGameStatus,
  resetOverlay,
  type OverlayState,
} from '@/lib/api/overlay';

export interface CourtsideQuickControlsProps {
  gameId: string;
  homeTeamName?: string;
  awayTeamName?: string;
  overlayState: OverlayState | null;
  onMutationSuccess?: () => void;
  className?: string;
}

export const CourtsideQuickControls: React.FC<CourtsideQuickControlsProps> = ({
  gameId,
  homeTeamName = 'Home',
  awayTeamName = 'Away',
  overlayState,
  onMutationSuccess,
  className = '',
}) => {
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  const runAction = async (actionFn: () => Promise<unknown>, label: string) => {
    setLoadingAction(label);
    try {
      await actionFn();
      toast.success(label);
      if (onMutationSuccess) onMutationSuccess();
    } catch (err) {
      toast.error(`${label} failed: ${(err as Error).message}`);
    } finally {
      setLoadingAction(null);
    }
  };

  const clockRunning = overlayState?.clock_running ?? false;
  const possession = overlayState?.possession ?? 'none';
  const periodLabel = overlayState?.period_label ?? 'Q1';

  return (
    <div
      data-testid="courtside-quick-controls"
      className={`rounded-xl border border-[#222222] bg-[#111111] p-4 sm:p-6 text-[#F5F5F0] font-['Space_Grotesk'] ${className}`}
    >
      <div className="flex items-center justify-between border-b border-[#222222] pb-3 mb-4">
        <h3 className="text-sm sm:text-base font-bold text-[#F5F5F0] flex items-center gap-2">
          <Radio className="h-4 w-4 text-[#C9A84C]" />
          Courtside Scoring & Game Controls
        </h3>
        <span className="text-[11px] font-semibold text-[#8A8A8A]">
          Tabulates instantly to live standings
        </span>
      </div>

      {/* ── Scoring Grid ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {/* Away Team Scoring */}
        <div className="rounded-lg border border-[#222222] bg-[#141414] p-3 sm:p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-[#8A8A8A]">
              Away · {awayTeamName}
            </span>
            <button
              type="button"
              onClick={() => runAction(() => patchOverlay(gameId, { possession: 'away' }), `${awayTeamName} Possession`)}
              className={`px-2 py-0.5 text-[10px] font-bold rounded-md transition-colors ${
                possession === 'away' ? 'bg-[#C9A84C] text-[#0A0A0A]' : 'bg-[#1F1F1F] text-[#8A8A8A] hover:text-[#F5F5F0]'
              }`}
            >
              POSSESSION {possession === 'away' && '✓'}
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2 mb-3">
            {[1, 2, 3].map((pts) => (
              <button
                key={`away-${pts}`}
                type="button"
                disabled={!!loadingAction}
                onClick={() =>
                  runAction(
                    () => adjustScore(gameId, 'away', { delta: pts, event: `${pts}PT by ${awayTeamName}` }),
                    `+${pts} ${awayTeamName}`
                  )
                }
                className="flex flex-col items-center justify-center py-2.5 rounded-lg bg-[#C9A84C] text-[#0A0A0A] font-bold text-base sm:text-lg hover:bg-[#E8C76A] active:scale-95 transition-all shadow-md"
              >
                +{pts}
                <span className="text-[9px] font-medium opacity-80">{pts === 1 ? 'FT' : pts === 2 ? 'FG' : '3PT'}</span>
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-[#1F1F1F]">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => runAction(() => adjustFoul(gameId, 'away', { delta: 1 }), `+1 Foul ${awayTeamName}`)}
                className="px-2 py-1 bg-[#222222] hover:bg-[#2A2A2A] text-xs font-semibold rounded text-[#F5F5F0]"
              >
                +1 Foul ({overlayState?.away_fouls ?? 0})
              </button>
              <button
                type="button"
                onClick={() => runAction(() => adjustFoul(gameId, 'away', { reset: true }), `Reset Fouls ${awayTeamName}`)}
                className="px-1.5 py-1 bg-[#1A1A1A] hover:bg-[#222222] text-[10px] text-[#8A8A8A] rounded"
              >
                Reset
              </button>
            </div>
            <button
              type="button"
              onClick={() => runAction(() => adjustScore(gameId, 'away', { delta: -1 }), `-1 ${awayTeamName}`)}
              className="px-2 py-1 bg-[#1F1F1F] hover:bg-[#2A2A2A] text-xs text-[#E63946] font-semibold rounded"
            >
              -1 Correction
            </button>
          </div>
        </div>

        {/* Home Team Scoring */}
        <div className="rounded-lg border border-[#222222] bg-[#141414] p-3 sm:p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-[#8A8A8A]">
              Home · {homeTeamName}
            </span>
            <button
              type="button"
              onClick={() => runAction(() => patchOverlay(gameId, { possession: 'home' }), `${homeTeamName} Possession`)}
              className={`px-2 py-0.5 text-[10px] font-bold rounded-md transition-colors ${
                possession === 'home' ? 'bg-[#C9A84C] text-[#0A0A0A]' : 'bg-[#1F1F1F] text-[#8A8A8A] hover:text-[#F5F5F0]'
              }`}
            >
              POSSESSION {possession === 'home' && '✓'}
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2 mb-3">
            {[1, 2, 3].map((pts) => (
              <button
                key={`home-${pts}`}
                type="button"
                disabled={!!loadingAction}
                onClick={() =>
                  runAction(
                    () => adjustScore(gameId, 'home', { delta: pts, event: `${pts}PT by ${homeTeamName}` }),
                    `+${pts} ${homeTeamName}`
                  )
                }
                className="flex flex-col items-center justify-center py-2.5 rounded-lg bg-[#C9A84C] text-[#0A0A0A] font-bold text-base sm:text-lg hover:bg-[#E8C76A] active:scale-95 transition-all shadow-md"
              >
                +{pts}
                <span className="text-[9px] font-medium opacity-80">{pts === 1 ? 'FT' : pts === 2 ? 'FG' : '3PT'}</span>
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-[#1F1F1F]">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => runAction(() => adjustFoul(gameId, 'home', { delta: 1 }), `+1 Foul ${homeTeamName}`)}
                className="px-2 py-1 bg-[#222222] hover:bg-[#2A2A2A] text-xs font-semibold rounded text-[#F5F5F0]"
              >
                +1 Foul ({overlayState?.home_fouls ?? 0})
              </button>
              <button
                type="button"
                onClick={() => runAction(() => adjustFoul(gameId, 'home', { reset: true }), `Reset Fouls ${homeTeamName}`)}
                className="px-1.5 py-1 bg-[#1A1A1A] hover:bg-[#222222] text-[10px] text-[#8A8A8A] rounded"
              >
                Reset
              </button>
            </div>
            <button
              type="button"
              onClick={() => runAction(() => adjustScore(gameId, 'home', { delta: -1 }), `-1 ${homeTeamName}`)}
              className="px-2 py-1 bg-[#1F1F1F] hover:bg-[#2A2A2A] text-xs text-[#E63946] font-semibold rounded"
            >
              -1 Correction
            </button>
          </div>
        </div>
      </div>

      {/* ── Clock & Period Control Bar ────────────────────────────────────────── */}
      <div className="rounded-lg border border-[#222222] bg-[#141414] p-3 sm:p-4 mb-4 flex flex-wrap items-center justify-between gap-3">
        {/* Clock Play/Pause */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() =>
              runAction(
                () => controlClock(gameId, clockRunning ? 'stop' : 'start'),
                clockRunning ? 'Clock Stopped' : 'Clock Started'
              )
            }
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs sm:text-sm font-bold transition-all shadow-md ${
              clockRunning
                ? 'bg-[#E63946] text-[#FFFFFF] hover:bg-[#D62828]'
                : 'bg-[#2DC653] text-[#0A0A0A] hover:bg-[#25A244]'
            }`}
          >
            {clockRunning ? <Square className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current" />}
            {clockRunning ? 'STOP CLOCK' : 'START CLOCK'}
          </button>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() =>
                runAction(
                  () => controlClock(gameId, 'set', Math.max(0, (overlayState?.clock_seconds ?? 600) + 10)),
                  '+10s'
                )
              }
              className="rounded bg-[#1F1F1F] hover:bg-[#2A2A2A] px-2 py-1.5 text-xs font-semibold text-[#8A8A8A] hover:text-[#F5F5F0]"
            >
              +10s
            </button>
            <button
              type="button"
              onClick={() =>
                runAction(
                  () => controlClock(gameId, 'set', Math.max(0, (overlayState?.clock_seconds ?? 600) - 10)),
                  '-10s'
                )
              }
              className="rounded bg-[#1F1F1F] hover:bg-[#2A2A2A] px-2 py-1.5 text-xs font-semibold text-[#8A8A8A] hover:text-[#F5F5F0]"
            >
              -10s
            </button>
            <button
              type="button"
              onClick={() => runAction(() => controlClock(gameId, 'set', 600), 'Reset 10:00')}
              className="rounded bg-[#1F1F1F] hover:bg-[#2A2A2A] px-2 py-1.5 text-[11px] font-semibold text-[#8A8A8A] hover:text-[#F5F5F0]"
            >
              10:00
            </button>
          </div>
        </div>

        {/* Period Advance */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-[#8A8A8A] font-semibold">Period:</span>
          <span className="text-xs font-bold text-[#C9A84C] bg-[#C9A84C]/15 px-2 py-0.5 rounded">
            {periodLabel}
          </span>
          <button
            type="button"
            onClick={() => runAction(() => advancePeriod(gameId, 'next'), 'Next Period')}
            className="inline-flex items-center gap-1 rounded bg-[#1F1F1F] hover:bg-[#2A2A2A] px-2.5 py-1.5 text-xs font-bold text-[#F5F5F0]"
          >
            <FastForward className="h-3.5 w-3.5 text-[#C9A84C]" />
            Advance Period
          </button>
        </div>
      </div>

      {/* ── Game Lifecycle Actions ────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#1F1F1F]">
        <button
          type="button"
          onClick={() => {
            if (window.confirm('Reset this game overlay back to default scores and period?')) {
              runAction(() => resetOverlay(gameId), 'Scoreboard Reset');
            }
          }}
          className="inline-flex items-center gap-1 text-xs text-[#8A8A8A] hover:text-[#E63946] transition-colors"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset Board
        </button>

        <button
          type="button"
          onClick={() => {
            if (window.confirm('Mark this game as FINAL? This will reconcile final scores to official season standings.')) {
              runAction(() => updateGameStatus(gameId, 'final'), 'Game Finalized — Standings Reconciled');
            }
          }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#1F1F1F] border border-[#2DC653]/40 px-3 py-1.5 text-xs font-bold text-[#2DC653] hover:bg-[#2DC653]/20 transition-colors"
        >
          <CheckCircle2 className="h-4 w-4 text-[#2DC653]" />
          Finalize Game & Reconcile Standings
        </button>
      </div>
    </div>
  );
};
