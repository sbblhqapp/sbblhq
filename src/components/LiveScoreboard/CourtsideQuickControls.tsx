/**
 * CourtsideQuickControls Component
 *
 * Integrated scoring, clock, foul, and period control panel for League Admins.
 * Allows instant live score tabulation without navigating across separate screens.
 * Uses robust Radix Dialog modals (no native window.confirm) for destructive/critical lifecycle actions.
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
  Clock,
  Radio,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
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

  // Dialog States (No window.confirm!)
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [finalizeDialogOpen, setFinalizeDialogOpen] = useState(false);
  const [reopenDialogOpen, setReopenDialogOpen] = useState(false);

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
  const isFinal = periodLabel === 'FINAL';
  const isUnderCorrection = periodLabel === 'CORR';

  return (
    <div
      data-testid="courtside-quick-controls"
      className={`rounded-xl border border-[#222222] bg-[#111111] p-4 sm:p-6 text-[#F5F5F0] font-['Space_Grotesk'] ${className}`}
    >
      <div className="flex items-center justify-between border-b border-[#222222] pb-3 mb-4">
        <div className="flex items-center gap-2">
          <Radio className="h-4 w-4 text-[#C9A84C]" />
          <h3 className="text-sm sm:text-base font-bold text-[#F5F5F0]">
            Courtside Scoring & Game Controls
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {isUnderCorrection && (
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#F4A261] bg-[#F4A261]/15 border border-[#F4A261]/30 px-2 py-0.5 rounded-full animate-pulse">
              <AlertTriangle className="h-3 w-3" />
              Under Correction — not yet official
            </span>
          )}
          {isFinal && !isUnderCorrection && (
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#2DC653] bg-[#2DC653]/15 border border-[#2DC653]/30 px-2 py-0.5 rounded-full">
              <CheckCircle2 className="h-3 w-3" />
              Official Final
            </span>
          )}
          {!isFinal && !isUnderCorrection && (
            <span className="text-[11px] font-semibold text-[#8A8A8A]">
              Tabulates instantly to live standings
            </span>
          )}
        </div>
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
              disabled={isFinal && !isUnderCorrection}
              onClick={() => runAction(() => patchOverlay(gameId, { possession: 'away' }), `${awayTeamName} Possession`)}
              className={`px-2 py-0.5 text-[10px] font-bold rounded-md transition-colors disabled:opacity-40 ${
                possession === 'away' ? 'bg-[#C9A84C] text-[#0A0A0A]' : 'bg-[#1F1F1F] text-[#8A8A8A] hover:text-[#F5F5F0]'
              }`}
            >
              POSSESSION {possession === 'away' && '✓'}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 mb-3">
            <button
              type="button"
              disabled={isFinal && !isUnderCorrection}
              onClick={() => runAction(() => adjustScore(gameId, 'away', { delta: 1 }), `+1 ${awayTeamName}`)}
              className="flex-1 rounded-md bg-[#1F1F1F] hover:bg-[#2A2A2A] border border-[#2A2A2A] py-2 text-xs font-bold text-[#F5F5F0] transition-colors disabled:opacity-40"
            >
              +1 FT
            </button>
            <button
              type="button"
              disabled={isFinal && !isUnderCorrection}
              onClick={() => runAction(() => adjustScore(gameId, 'away', { delta: 2 }), `+2 ${awayTeamName}`)}
              className="flex-1 rounded-md bg-[#1F1F1F] hover:bg-[#2A2A2A] border border-[#2A2A2A] py-2 text-xs font-bold text-[#C9A84C] transition-colors disabled:opacity-40"
            >
              +2 FG
            </button>
            <button
              type="button"
              disabled={isFinal && !isUnderCorrection}
              onClick={() => runAction(() => adjustScore(gameId, 'away', { delta: 3 }), `+3 ${awayTeamName}`)}
              className="flex-1 rounded-md bg-[#1F1F1F] hover:bg-[#2A2A2A] border border-[#2A2A2A] py-2 text-xs font-bold text-[#C9A84C] transition-colors disabled:opacity-40"
            >
              +3 3PT
            </button>
            <button
              type="button"
              disabled={isFinal && !isUnderCorrection}
              onClick={() => runAction(() => adjustScore(gameId, 'away', { delta: -1 }), `-1 ${awayTeamName}`)}
              className="rounded-md bg-[#1F1F1F] hover:bg-[#2A2A2A] border border-[#2A2A2A] px-2.5 py-2 text-xs font-bold text-[#8A8A8A] hover:text-[#E63946] transition-colors disabled:opacity-40"
            >
              -1
            </button>
          </div>

          <div className="flex items-center justify-between text-xs pt-2 border-t border-[#1F1F1F]">
            <span className="text-[#8A8A8A] font-semibold">Team Fouls:</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={isFinal && !isUnderCorrection}
                onClick={() => runAction(() => adjustFoul(gameId, 'away', { delta: 1 }), `+1 Foul ${awayTeamName}`)}
                className="rounded bg-[#1F1F1F] hover:bg-[#2A2A2A] px-2 py-1 font-bold text-[#F4A261] disabled:opacity-40"
              >
                +1 Foul
              </button>
              <button
                type="button"
                disabled={isFinal && !isUnderCorrection}
                onClick={() => runAction(() => adjustFoul(gameId, 'away', { delta: -1 }), `-1 Foul ${awayTeamName}`)}
                className="rounded bg-[#1F1F1F] hover:bg-[#2A2A2A] px-1.5 py-1 text-[#8A8A8A] hover:text-[#E63946] disabled:opacity-40"
              >
                -1
              </button>
            </div>
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
              disabled={isFinal && !isUnderCorrection}
              onClick={() => runAction(() => patchOverlay(gameId, { possession: 'home' }), `${homeTeamName} Possession`)}
              className={`px-2 py-0.5 text-[10px] font-bold rounded-md transition-colors disabled:opacity-40 ${
                possession === 'home' ? 'bg-[#C9A84C] text-[#0A0A0A]' : 'bg-[#1F1F1F] text-[#8A8A8A] hover:text-[#F5F5F0]'
              }`}
            >
              POSSESSION {possession === 'home' && '✓'}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 mb-3">
            <button
              type="button"
              disabled={isFinal && !isUnderCorrection}
              onClick={() => runAction(() => adjustScore(gameId, 'home', { delta: 1 }), `+1 ${homeTeamName}`)}
              className="flex-1 rounded-md bg-[#1F1F1F] hover:bg-[#2A2A2A] border border-[#2A2A2A] py-2 text-xs font-bold text-[#F5F5F0] transition-colors disabled:opacity-40"
            >
              +1 FT
            </button>
            <button
              type="button"
              disabled={isFinal && !isUnderCorrection}
              onClick={() => runAction(() => adjustScore(gameId, 'home', { delta: 2 }), `+2 ${homeTeamName}`)}
              className="flex-1 rounded-md bg-[#1F1F1F] hover:bg-[#2A2A2A] border border-[#2A2A2A] py-2 text-xs font-bold text-[#C9A84C] transition-colors disabled:opacity-40"
            >
              +2 FG
            </button>
            <button
              type="button"
              disabled={isFinal && !isUnderCorrection}
              onClick={() => runAction(() => adjustScore(gameId, 'home', { delta: 3 }), `+3 ${homeTeamName}`)}
              className="flex-1 rounded-md bg-[#1F1F1F] hover:bg-[#2A2A2A] border border-[#2A2A2A] py-2 text-xs font-bold text-[#C9A84C] transition-colors disabled:opacity-40"
            >
              +3 3PT
            </button>
            <button
              type="button"
              disabled={isFinal && !isUnderCorrection}
              onClick={() => runAction(() => adjustScore(gameId, 'home', { delta: -1 }), `-1 ${homeTeamName}`)}
              className="rounded-md bg-[#1F1F1F] hover:bg-[#2A2A2A] border border-[#2A2A2A] px-2.5 py-2 text-xs font-bold text-[#8A8A8A] hover:text-[#E63946] transition-colors disabled:opacity-40"
            >
              -1
            </button>
          </div>

          <div className="flex items-center justify-between text-xs pt-2 border-t border-[#1F1F1F]">
            <span className="text-[#8A8A8A] font-semibold">Team Fouls:</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={isFinal && !isUnderCorrection}
                onClick={() => runAction(() => adjustFoul(gameId, 'home', { delta: 1 }), `+1 Foul ${homeTeamName}`)}
                className="rounded bg-[#1F1F1F] hover:bg-[#2A2A2A] px-2 py-1 font-bold text-[#F4A261] disabled:opacity-40"
              >
                +1 Foul
              </button>
              <button
                type="button"
                disabled={isFinal && !isUnderCorrection}
                onClick={() => runAction(() => adjustFoul(gameId, 'home', { delta: -1 }), `-1 Foul ${homeTeamName}`)}
                className="rounded bg-[#1F1F1F] hover:bg-[#2A2A2A] px-1.5 py-1 text-[#8A8A8A] hover:text-[#E63946] disabled:opacity-40"
              >
                -1
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Clock & Period Controls ───────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-3 rounded-lg bg-[#141414] border border-[#222222] mb-4">
        {/* Clock Controls */}
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-[#C9A84C]" />
          <span className="text-xs font-bold text-[#F5F5F0]">Clock:</span>

          <button
            type="button"
            disabled={isFinal && !isUnderCorrection}
            onClick={() =>
              runAction(
                () => controlClock(gameId, clockRunning ? 'stop' : 'start'),
                clockRunning ? 'Clock Paused' : 'Clock Started'
              )
            }
            className={`inline-flex items-center gap-1 rounded px-3 py-1.5 text-xs font-bold transition-all disabled:opacity-40 ${
              clockRunning
                ? 'bg-[#E63946] text-white hover:bg-[#C92A37]'
                : 'bg-[#2DC653] text-[#0A0A0A] hover:bg-[#25A244]'
            }`}
          >
            {clockRunning ? <Square className="h-3 w-3" /> : <Play className="h-3 w-3" />}
            {clockRunning ? 'Stop' : 'Start'}
          </button>

          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={isFinal && !isUnderCorrection}
              onClick={() =>
                runAction(
                  () => controlClock(gameId, 'set', Math.max(0, (overlayState?.clock_seconds ?? 600) + 10)),
                  '+10s'
                )
              }
              className="rounded bg-[#1F1F1F] hover:bg-[#2A2A2A] px-2 py-1.5 text-xs font-semibold text-[#8A8A8A] hover:text-[#F5F5F0] disabled:opacity-40"
            >
              +10s
            </button>
            <button
              type="button"
              disabled={isFinal && !isUnderCorrection}
              onClick={() =>
                runAction(
                  () => controlClock(gameId, 'set', Math.max(0, (overlayState?.clock_seconds ?? 600) - 10)),
                  '-10s'
                )
              }
              className="rounded bg-[#1F1F1F] hover:bg-[#2A2A2A] px-2 py-1.5 text-xs font-semibold text-[#8A8A8A] hover:text-[#F5F5F0] disabled:opacity-40"
            >
              -10s
            </button>
            <button
              type="button"
              disabled={isFinal && !isUnderCorrection}
              onClick={() => runAction(() => controlClock(gameId, 'set', 600), 'Reset 10:00')}
              className="rounded bg-[#1F1F1F] hover:bg-[#2A2A2A] px-2 py-1.5 text-[11px] font-semibold text-[#8A8A8A] hover:text-[#F5F5F0] disabled:opacity-40"
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
            disabled={isFinal && !isUnderCorrection}
            onClick={() => runAction(() => advancePeriod(gameId, 'next'), 'Next Period')}
            className="inline-flex items-center gap-1 rounded bg-[#1F1F1F] hover:bg-[#2A2A2A] px-2.5 py-1.5 text-xs font-bold text-[#F5F5F0] disabled:opacity-40"
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
          onClick={() => setResetDialogOpen(true)}
          className="inline-flex items-center gap-1 text-xs text-[#8A8A8A] hover:text-[#E63946] transition-colors"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset Board
        </button>

        <div className="flex items-center gap-2">
          {isFinal && !isUnderCorrection && (
            <button
              type="button"
              onClick={() => setReopenDialogOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#1F1F1F] border border-[#F4A261]/40 px-3 py-1.5 text-xs font-bold text-[#F4A261] hover:bg-[#F4A261]/10 transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5 text-[#F4A261]" />
              Reopen Game
            </button>
          )}

          {(!isFinal || isUnderCorrection) && (
            <button
              type="button"
              onClick={() => setFinalizeDialogOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#1F1F1F] border border-[#2DC653]/40 px-3 py-1.5 text-xs font-bold text-[#2DC653] hover:bg-[#2DC653]/20 transition-colors"
            >
              <CheckCircle2 className="h-4 w-4 text-[#2DC653]" />
              Finalize Game & Reconcile Standings
            </button>
          )}
        </div>
      </div>

      {/* ── Radix Dialogs (Zero window.confirm, No suppression risk) ───────────── */}
      {/* 1. Reset Board Dialog */}
      <Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <DialogContent className="border-[#333333] bg-[#141414] text-[#F5F5F0] max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[#F5F5F0] flex items-center gap-2">
              <RotateCcw className="h-5 w-5 text-[#E63946]" /> Reset Game Overlay
            </DialogTitle>
            <DialogDescription className="text-[#8A8A8A] text-xs">
              This will reset the active scorebug clock, scores, fouls, and possession to initial state for this match.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <button
              type="button"
              onClick={() => setResetDialogOpen(false)}
              className="rounded-md border border-[#333333] bg-[#1F1F1F] px-3 py-1.5 text-xs font-medium text-[#F5F5F0] hover:bg-[#2A2A2A]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                setResetDialogOpen(false);
                runAction(() => resetOverlay(gameId), 'Scoreboard Reset');
              }}
              className="rounded-md bg-[#E63946] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#C92A37]"
            >
              Confirm Reset
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 2. Finalize Game Dialog */}
      <Dialog open={finalizeDialogOpen} onOpenChange={setFinalizeDialogOpen}>
        <DialogContent className="border-[#333333] bg-[#141414] text-[#F5F5F0] max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[#F5F5F0] flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-[#2DC653]" /> Finalize Game & Reconcile Standings
            </DialogTitle>
            <DialogDescription className="text-[#8A8A8A] text-xs">
              Mark this game as FINAL. The period will lock to FINAL, clock will stop, and the database will execute official season standings recalculation.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <button
              type="button"
              onClick={() => setFinalizeDialogOpen(false)}
              className="rounded-md border border-[#333333] bg-[#1F1F1F] px-3 py-1.5 text-xs font-medium text-[#F5F5F0] hover:bg-[#2A2A2A]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                setFinalizeDialogOpen(false);
                runAction(() => updateGameStatus(gameId, 'final'), 'Game Finalized — Standings Reconciled');
              }}
              className="rounded-md bg-[#2DC653] px-3.5 py-1.5 text-xs font-bold text-[#0A0A0A] hover:bg-[#25A244]"
            >
              Confirm Finalize
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 3. Reopen Game Dialog */}
      <Dialog open={reopenDialogOpen} onOpenChange={setReopenDialogOpen}>
        <DialogContent className="border-[#333333] bg-[#141414] text-[#F5F5F0] max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[#F5F5F0] flex items-center gap-2">
              <RefreshCw className="h-5 w-5 text-[#F4A261]" /> Reopen Game for Correction
            </DialogTitle>
            <DialogDescription className="text-[#8A8A8A] text-xs">
              Transitions the match to <strong>review_pending</strong> (Under Correction). Roster and scoring controls will be unlocked so you can correct stats, and re-finalizing will refresh standings.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <button
              type="button"
              onClick={() => setReopenDialogOpen(false)}
              className="rounded-md border border-[#333333] bg-[#1F1F1F] px-3 py-1.5 text-xs font-medium text-[#F5F5F0] hover:bg-[#2A2A2A]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                setReopenDialogOpen(false);
                runAction(() => updateGameStatus(gameId, 'review_pending'), 'Game Reopened for Correction');
              }}
              className="rounded-md bg-[#F4A261] px-3.5 py-1.5 text-xs font-bold text-[#0A0A0A] hover:bg-[#E7944D]"
            >
              Unlock & Reopen
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
