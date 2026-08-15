/**
 * /scorekeeper/:gameId — mobile-optimised live stat entry.
 *
 * Admin-only. Drives the same overlay state as /overlay-control/:gameId but
 * with a thumb-first UI for courtside operators holding a phone in one hand.
 * Pairs with the existing /api/ops/overlay/:gameId/* endpoints — no new API
 * surface required.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  fetchOverlay,
  patchOverlay,
  controlClock,
  adjustScore,
  adjustFoul,
  advancePeriod,
  updateGameStatus,
  type OverlayPayload,
} from '@/lib/api/overlay';
import { LiveScoreboard } from '@/components/LiveScoreboard/LiveScoreboard';
import { PlayerStatsTracker } from '@/components/LiveScoreboard/PlayerStatsTracker';

// ── Undo stack types ───────────────────────────────────────────────────────
type UndoEntry =
  | { kind: 'score'; side: 'home' | 'away'; delta: number }
  | { kind: 'foul-delta'; side: 'home' | 'away'; delta: number }
  | { kind: 'foul-reset'; side: 'home' | 'away'; previous: number }
  | { kind: 'possession'; previous: 'home' | 'away' | 'none' }
  | { kind: 'clock-set'; previous: number }
  | { kind: 'clock-start' }
  | { kind: 'clock-stop' }
  | { kind: 'period-advance'; previousPeriod: number };

const UNDO_MAX = 10;
const CLOCK_PRESETS: ReadonlyArray<number> = [600, 480, 300];

function fmt(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${ss.toString().padStart(2, '0')}`;
}

export default function ScorekeeperPage() {
  const { gameId } = useParams<{ gameId: string }>();
  const [nowMs, setNowMs] = useState<number>(Date.now());
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  const query = useQuery<OverlayPayload>({
    queryKey: ['scorekeeper', gameId],
    queryFn: () => fetchOverlay(gameId!),
    refetchInterval: 1500,
    enabled: !!gameId,
    retry: false,
  });

  const overlay = query.data?.overlay ?? null;
  const game = query.data?.game;

  // Project live remaining seconds while the clock is running — same formula
  // as OverlayControl so the two screens stay in lockstep.
  const liveSeconds = useMemo<number>(() => {
    if (!overlay) return 0;
    if (!overlay.clock_running || !overlay.clock_last_started_at) {
      return overlay.clock_seconds;
    }
    const elapsed =
      (nowMs - new Date(overlay.clock_last_started_at).getTime()) / 1000;
    return Math.max(0, overlay.clock_seconds - elapsed);
  }, [overlay, nowMs]);

  const pushUndo = useCallback((entry: UndoEntry) => {
    setUndoStack((prev) => {
      const next = [...prev, entry];
      if (next.length > UNDO_MAX) next.shift();
      return next;
    });
  }, []);

  const run = useCallback(
    async (
      promise: Promise<unknown>,
      label: string,
      opts?: { undo?: UndoEntry; silent?: boolean },
    ) => {
      try {
        await promise;
        await query.refetch();
        if (opts?.undo) pushUndo(opts.undo);
        if (!opts?.silent) toast.success(label);
      } catch (err) {
        toast.error(`${label} failed: ${(err as Error).message}`);
      }
    },
    [query, pushUndo],
  );

  // ── Early returns ────────────────────────────────────────────────────────
  if (!gameId) {
    return (
      <div className="container py-4 max-w-xl">
        <div className="panel p-4 text-center">Missing gameId in URL.</div>
      </div>
    );
  }

  if (query.isLoading) {
    return (
      <div className="container py-4 max-w-xl">
        <div className="panel p-4 text-center">Loading game…</div>
      </div>
    );
  }

  if (query.isError) {
    const msg = (query.error as Error | null)?.message ?? 'Unknown error';
    const isAuth = /401|unauthori[sz]ed|forbidden/i.test(msg);
    return (
      <div className="container py-4 max-w-xl">
        <div
          className="panel p-4 text-center space-y-2"
          role="alert"
          aria-live="polite"
        >
          <div className="font-bold text-lg">
            {isAuth ? 'Admin sign-in required' : 'Could not load game'}
          </div>
          <div className="text-sm text-muted-foreground">
            {isAuth
              ? 'The scorekeeper is admin-only. Sign in from the main site, then reopen this URL.'
              : msg}
          </div>
        </div>
      </div>
    );
  }

  if (!game) {
    // NEVER invent scores — render a clear not-found panel.
    return (
      <div className="container py-4 max-w-xl">
        <div className="panel p-4 text-center">
          <div className="font-bold text-lg">Game not found</div>
          <div className="text-sm text-muted-foreground">
            No game matches id <code>{gameId}</code>.
          </div>
        </div>
      </div>
    );
  }

  // ── Values ────────────────────────────────────────────────────────────────
  const leagueCode = game.leagues?.code ?? '';
  const awayName = game.away_team?.name ?? 'Away';
  const homeName = game.home_team?.name ?? 'Home';
  const awayScore = overlay?.away_score ?? 0;
  const homeScore = overlay?.home_score ?? 0;
  const awayFouls = overlay?.away_fouls ?? 0;
  const homeFouls = overlay?.home_fouls ?? 0;
  const awayBonus = overlay?.bonus_away ?? false;
  const homeBonus = overlay?.bonus_home ?? false;
  const periodLabel = overlay?.period_label ?? 'Q1';
  const currentPeriod = overlay?.period ?? 1;
  const possession = overlay?.possession ?? 'none';
  const clockRunning = overlay?.clock_running ?? false;

  // ── Action builders ───────────────────────────────────────────────────────
  const addScore = (side: 'home' | 'away', n: number) =>
    run(adjustScore(gameId, side, { delta: n }), `+${n} ${side}`, {
      undo: { kind: 'score', side, delta: n },
    });

  const addFoul = (side: 'home' | 'away') =>
    run(adjustFoul(gameId, side, { delta: 1 }), `${side} foul`, {
      undo: { kind: 'foul-delta', side, delta: 1 },
    });

  const resetFouls = (side: 'home' | 'away') => {
    const previous = side === 'home' ? homeFouls : awayFouls;
    return run(adjustFoul(gameId, side, { reset: true }), `${side} fouls reset`, {
      undo: { kind: 'foul-reset', side, previous },
    });
  };

  const setClock = (s: number) =>
    run(controlClock(gameId, 'set', s), `clock → ${fmt(s)}`, {
      undo: { kind: 'clock-set', previous: Math.floor(liveSeconds) },
    });

  const nudgeClock = (offset: number) => {
    const target = Math.max(0, Math.floor(liveSeconds) + offset);
    return run(controlClock(gameId, 'set', target), `${offset > 0 ? '+' : ''}${offset}s`, {
      undo: { kind: 'clock-set', previous: Math.floor(liveSeconds) },
    });
  };

  const setPossession = (side: 'home' | 'away') =>
    run(patchOverlay(gameId, { possession: side }), `${side} possession`, {
      undo: { kind: 'possession', previous: possession },
    });

  const nextPeriod = () =>
    run(advancePeriod(gameId, 'next'), 'next period', {
      undo: { kind: 'period-advance', previousPeriod: currentPeriod },
    });

  const setGameStatus = (status: string) => run(updateGameStatus(gameId, status), `mark game ${status}`);

  // ── Undo ──────────────────────────────────────────────────────────────────
  const canUndo = undoStack.length > 0;

  const undo = async () => {
    const last = undoStack[undoStack.length - 1];
    if (!last) return;
    setUndoStack((prev) => prev.slice(0, -1));
    try {
      switch (last.kind) {
        case 'score':
          await adjustScore(gameId, last.side, { delta: -last.delta });
          break;
        case 'foul-delta':
          await adjustFoul(gameId, last.side, { delta: -last.delta });
          break;
        case 'foul-reset':
          // Replay the previous foul count by incrementing from zero.
          if (last.previous > 0) {
            await adjustFoul(gameId, last.side, { delta: last.previous });
          }
          break;
        case 'possession':
          await patchOverlay(gameId, { possession: last.previous });
          break;
        case 'clock-set':
          await controlClock(gameId, 'set', last.previous);
          break;
        case 'clock-start':
          await controlClock(gameId, 'stop');
          break;
        case 'clock-stop':
          await controlClock(gameId, 'start');
          break;
        case 'period-advance':
          await advancePeriod(gameId, 'set', last.previousPeriod);
          break;
      }
      await query.refetch();
      toast.success('Undone');
    } catch (err) {
      toast.error(`Undo failed: ${(err as Error).message}`);
    }
  };

  return (
    <div className="container py-4 max-w-xl">
      {/* 1. Header ─────────────────────────────────────────────────────── */}
      <header className="mb-3 text-sm text-muted-foreground truncate">
        {leagueCode ? `${leagueCode} · ` : ''}
        {awayName} @ {homeName}
        <div className="mt-1 flex items-center gap-2">
          <span className={`px-2 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-widest ${
            game.status === 'live' ? 'bg-live text-white' :
            game.status === 'final' ? 'bg-muted text-muted-foreground' :
            'bg-secondary text-foreground'
          }`}>
            {game.status}
          </span>
        </div>
      </header>

      {/* ── Live Tabulation Scoreboard & Projected Standings ─────────────── */}
      <section className="mb-4" aria-label="Live Tabulation Scoreboard">
        <LiveScoreboard
          gameId={gameId}
          homeTeamName={homeName}
          awayTeamName={awayName}
          homeTeamLogo={game.home_team?.logo_url ?? null}
          awayTeamLogo={game.away_team?.logo_url ?? null}
          initialScore={overlay}
        />
      </section>

      {/* ── Individual Player Stats & Box Score Tracker ─────────────────── */}
      <section className="mb-4" aria-label="Individual Player Stats">
        <PlayerStatsTracker
          gameId={gameId}
          onStatChange={() => {
            query.refetch();
          }}
        />
      </section>

      {/* 2. Big score row ──────────────────────────────────────────────── */}
      <section
        className="panel p-3 mb-3 grid grid-cols-3 items-center gap-2"
        aria-label="Current score"
      >
        <div className="text-center">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground truncate">
            {awayName}
          </div>
          <div className="stat-numeral text-6xl leading-none" aria-live="polite">
            {awayScore}
          </div>
        </div>
        <div className="text-center">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            {periodLabel}
          </div>
          <div
            className={`stat-numeral text-5xl tabular-nums leading-none ${
              clockRunning ? 'text-green-500' : ''
            }`}
            aria-live="polite"
            aria-label={`Game clock ${fmt(liveSeconds)}${clockRunning ? ' running' : ' stopped'}`}
          >
            {fmt(liveSeconds)}
          </div>
        </div>
        <div className="text-center">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground truncate">
            {homeName}
          </div>
          <div className="stat-numeral text-6xl leading-none" aria-live="polite">
            {homeScore}
          </div>
        </div>
      </section>

      {/* 3. Away score buttons ─────────────────────────────────────────── */}
      <section className="mb-2" aria-label={`${awayName} scoring`}>
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
          Away · {awayName}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[1, 2, 3].map((n) => (
            <button
              key={`away-${n}`}
              type="button"
              aria-label={`Away plus ${n} ${n === 1 ? 'point' : 'points'}`}
              className="min-h-[56px] text-lg font-bold bg-primary text-primary-foreground rounded-sm active:opacity-80"
              onClick={() => addScore('away', n)}
            >
              +{n}
            </button>
          ))}
        </div>
      </section>

      {/* 4. Home score buttons ─────────────────────────────────────────── */}
      <section className="mb-3" aria-label={`${homeName} scoring`}>
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
          Home · {homeName}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[1, 2, 3].map((n) => (
            <button
              key={`home-${n}`}
              type="button"
              aria-label={`Home plus ${n} ${n === 1 ? 'point' : 'points'}`}
              className="min-h-[56px] text-lg font-bold bg-primary text-primary-foreground rounded-sm active:opacity-80"
              onClick={() => addScore('home', n)}
            >
              +{n}
            </button>
          ))}
        </div>
      </section>

      {/* 5. Undo ───────────────────────────────────────────────────────── */}
      <section className="mb-3">
        <button
          type="button"
          aria-label="Undo last change"
          disabled={!canUndo}
          onClick={undo}
          className="w-full min-h-[56px] text-lg font-bold border border-border rounded-sm hover:bg-secondary disabled:opacity-40 disabled:cursor-not-allowed"
        >
          ↶ Undo last change{canUndo ? ` (${undoStack.length})` : ''}
        </button>
      </section>

      {/* 6. Clock controls ─────────────────────────────────────────────── */}
      <section className="mb-3" aria-label="Clock controls">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
          Clock
        </div>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <button
            type="button"
            aria-label="Start clock"
            className="min-h-[56px] text-lg font-bold bg-green-600 text-white rounded-sm active:opacity-80"
            onClick={() =>
              run(controlClock(gameId, 'start'), 'clock start', {
                undo: { kind: 'clock-start' },
              })
            }
          >
            ▶ Start
          </button>
          <button
            type="button"
            aria-label="Stop clock"
            className="min-h-[56px] text-lg font-bold bg-red-600 text-white rounded-sm active:opacity-80"
            onClick={() =>
              run(controlClock(gameId, 'stop'), 'clock stop', {
                undo: { kind: 'clock-stop' },
              })
            }
          >
            ■ Stop
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <button
            type="button"
            aria-label="Add 10 seconds to clock"
            className="min-h-[56px] text-lg font-bold border border-border rounded-sm hover:bg-secondary"
            onClick={() => nudgeClock(10)}
          >
            +10s
          </button>
          <button
            type="button"
            aria-label="Subtract 10 seconds from clock"
            className="min-h-[56px] text-lg font-bold border border-border rounded-sm hover:bg-secondary"
            onClick={() => nudgeClock(-10)}
          >
            -10s
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {CLOCK_PRESETS.map((s) => (
            <button
              key={`preset-${s}`}
              type="button"
              aria-label={`Set clock to ${fmt(s)}`}
              className="min-h-[56px] text-lg font-bold border border-border rounded-sm hover:bg-secondary"
              onClick={() => setClock(s)}
            >
              {fmt(s)}
            </button>
          ))}
        </div>
      </section>

      {/* 7. Period ─────────────────────────────────────────────────────── */}
      <section className="mb-3" aria-label="Period">
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Period
            </div>
            <div className="text-lg font-bold">{periodLabel}</div>
          </div>
          <button
            type="button"
            aria-label="Advance to next period"
            className="min-h-[56px] text-lg font-bold px-4 border border-border rounded-sm hover:bg-secondary"
            onClick={nextPeriod}
          >
            Next Period →
          </button>
        </div>
      </section>

      {/* 8. Fouls ──────────────────────────────────────────────────────── */}
      <section className="mb-3" aria-label="Team fouls">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
          Fouls
        </div>
        <div className="grid grid-cols-3 gap-2 items-center text-center">
          <div>
            <div className="text-xs text-muted-foreground truncate">{awayName}</div>
            <div className="stat-numeral text-3xl">{awayFouls}</div>
          </div>
          <div className="text-xs">
            {(awayBonus || homeBonus) && (
              <div className="space-y-0.5">
                {awayBonus && (
                  <div className="px-2 py-0.5 bg-yellow-500 text-black font-bold rounded-sm">
                    AWAY BONUS
                  </div>
                )}
                {homeBonus && (
                  <div className="px-2 py-0.5 bg-yellow-500 text-black font-bold rounded-sm">
                    HOME BONUS
                  </div>
                )}
              </div>
            )}
            {!awayBonus && !homeBonus && (
              <span className="text-muted-foreground">no bonus</span>
            )}
          </div>
          <div>
            <div className="text-xs text-muted-foreground truncate">{homeName}</div>
            <div className="stat-numeral text-3xl">{homeFouls}</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 mt-2">
          <button
            type="button"
            aria-label={`Add foul to ${awayName}`}
            className="min-h-[56px] text-lg font-bold border border-border rounded-sm hover:bg-secondary"
            onClick={() => addFoul('away')}
          >
            +Foul Away
          </button>
          <button
            type="button"
            aria-label={`Add foul to ${homeName}`}
            className="min-h-[56px] text-lg font-bold border border-border rounded-sm hover:bg-secondary"
            onClick={() => addFoul('home')}
          >
            +Foul Home
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2 mt-2">
          <button
            type="button"
            aria-label={`Reset ${awayName} fouls`}
            className="min-h-[56px] text-lg font-bold border border-border rounded-sm hover:bg-secondary"
            onClick={() => resetFouls('away')}
          >
            Reset Away
          </button>
          <button
            type="button"
            aria-label={`Reset ${homeName} fouls`}
            className="min-h-[56px] text-lg font-bold border border-border rounded-sm hover:bg-secondary"
            onClick={() => resetFouls('home')}
          >
            Reset Home
          </button>
        </div>
      </section>
      {/* 10. Game Status ───────────────────────────────────────────────── */}
      <section className="mb-8" aria-label="Game Status">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
          Game Status
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            aria-label="Set game to Live"
            className="min-h-[56px] text-lg font-bold border border-border rounded-sm hover:bg-secondary text-live"
            onClick={() => setGameStatus('live')}
          >
            Mark Live
          </button>
          <button
            type="button"
            aria-label="Set game to Final"
            className="min-h-[56px] text-lg font-bold border border-border rounded-sm hover:bg-secondary"
            onClick={() => setGameStatus('final')}
          >
            Finalize Game
          </button>
        </div>
      </section>


      {/* 9. Possession ─────────────────────────────────────────────────── */}
      <section className="mb-3" aria-label="Possession">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
          Possession · {possession === 'none' ? '—' : possession}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            aria-label={`Set possession to ${awayName}`}
            aria-pressed={possession === 'away'}
            className={`min-h-[56px] text-lg font-bold rounded-sm ${
              possession === 'away'
                ? 'bg-primary text-primary-foreground'
                : 'border border-border hover:bg-secondary'
            }`}
            onClick={() => setPossession('away')}
          >
            Away Poss.
          </button>
          <button
            type="button"
            aria-label={`Set possession to ${homeName}`}
            aria-pressed={possession === 'home'}
            className={`min-h-[56px] text-lg font-bold rounded-sm ${
              possession === 'home'
                ? 'bg-primary text-primary-foreground'
                : 'border border-border hover:bg-secondary'
            }`}
            onClick={() => setPossession('home')}
          >
            Home Poss.
          </button>
        </div>
      </section>
    </div>
  );
}
