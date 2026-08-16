/**
 * PlayerStatsTracker Component
 *
 * Real-time individual player box score and statistical tabulation component.
 * Features:
 * - 0ms Optimistic local updates with automatic error rollback
 * - Global 1-Tap Undo Action Bar for rapid correction
 * - Active 5 "On Floor" filter & sub-in/sub-out manager
 * - Automatic Foul-Out flags (5 fouls) & Team Bonus flags (5 team fouls)
 * - Mobile tactile haptic vibration confirmation
 */
import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { getSupabaseClient } from '@/lib/supabase/client';
import {
  Users,
  Table as TableIcon,
  Activity,
  UserPlus,
  RotateCcw,
  Sparkles,
  Shirt,
  Radio,
} from 'lucide-react';
import {
  fetchGamePlayerStats,
  recordPlayerStat,
  quickAddGamePlayer,
  type GamePlayerStat,
  type PlayerStatType,
  type GamePlayerStatsResponse,
} from '@/lib/api/playerStats';

export interface PlayerStatsTrackerProps {
  gameId: string;
  onStatChange?: () => void;
  className?: string;
}

interface ActionHistoryEvent {
  id: string;
  playerId: string;
  playerName: string;
  stat: PlayerStatType;
  delta: number;
  teamSide: 'home' | 'away';
  timestamp: number;
}

export const PlayerStatsTracker: React.FC<PlayerStatsTrackerProps> = ({
  gameId,
  onStatChange,
  className = '',
}) => {
  const queryClient = useQueryClient();
  const [activeSide, setActiveSide] = useState<'away' | 'home' | 'boxscore'>('away');
  const [showAddPlayer, setShowAddPlayer] = useState(false);
  const [newPlayerName, setNewPlayerName] = useState('');
  const [newPlayerJersey, setNewPlayerJersey] = useState('');
  const [newPlayerTeamSide, setNewPlayerTeamSide] = useState<'away' | 'home'>('away');

  // Active 5 "On Floor" tracking (persisted in local state per game)
  const [onFloorPlayerIds, setOnFloorPlayerIds] = useState<Record<string, boolean>>({});
  const [filterOnFloorOnly, setFilterOnFloorOnly] = useState(false);

  // Global Undo Action Ledger
  const [undoStack, setUndoStack] = useState<ActionHistoryEvent[]>([]);

  // Query stats
  const statsQuery = useQuery({
    queryKey: ['game-player-stats', gameId],
    queryFn: () => fetchGamePlayerStats(gameId),
    enabled: Boolean(gameId),
    refetchInterval: 5000,
  });

  // Real-time multi-admin aggregation: subscribe to player_game_stats and overlay_game_state
  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase || !gameId) return;

    const channel = supabase
      .channel(`rt-tabulation-${gameId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'player_game_stats',
          filter: `game_id=eq.${gameId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['game-player-stats', gameId] });
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'overlay_game_state',
          filter: `game_id=eq.${gameId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['overlay', gameId] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [gameId, queryClient]);

  const awayData = statsQuery.data?.away;
  const homeData = statsQuery.data?.home;

  // Toggle on-floor status
  const toggleOnFloor = (playerId: string) => {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate(8); } catch { /* ignore */ }
    }
    setOnFloorPlayerIds((prev) => ({
      ...prev,
      [playerId]: !prev[playerId],
    }));
  };

  // Stat Recording Mutation with 0ms Optimistic UI
  const statMutation = useMutation({
    mutationFn: async (vars: {
      playerId: string;
      playerName: string;
      stat: PlayerStatType;
      delta: number;
      teamSide?: 'home' | 'away';
      isUndo?: boolean;
    }) => {
      return recordPlayerStat(gameId, {
        playerId: vars.playerId,
        stat: vars.stat,
        delta: vars.delta,
        teamSide: vars.teamSide,
        syncTeamScore: vars.stat === 'pts' || vars.stat === 'fls',
      });
    },
    onMutate: async (vars) => {
      // 1. Tactile haptic feedback
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try { navigator.vibrate(10); } catch { /* ignore */ }
      }

      // 2. Cancel outgoing queries
      await queryClient.cancelQueries({ queryKey: ['game-player-stats', gameId] });
      const previousStats = queryClient.getQueryData<GamePlayerStatsResponse>(['game-player-stats', gameId]);

      // 3. Optimistically update local cache
      if (previousStats) {
        const applyDelta = (players: GamePlayerStat[]) =>
          players.map((p) => {
            if (p.playerId !== vars.playerId) return p;
            const currentVal = p[vars.stat] || 0;
            const nextVal = Math.max(0, currentVal + vars.delta);
            return { ...p, [vars.stat]: nextVal };
          });

        queryClient.setQueryData<GamePlayerStatsResponse>(['game-player-stats', gameId], {
          ...previousStats,
          away: previousStats.away
            ? { ...previousStats.away, players: applyDelta(previousStats.away.players) }
            : previousStats.away,
          home: previousStats.home
            ? { ...previousStats.home, players: applyDelta(previousStats.home.players) }
            : previousStats.home,
        });
      }

      return { previousStats };
    },
    onSuccess: (_, vars) => {
      const statLabel = vars.stat.toUpperCase();
      const prefix = vars.delta > 0 ? `+${vars.delta}` : `${vars.delta}`;
      
      if (!vars.isUndo) {
        toast.success(`${vars.playerName}: ${prefix} ${statLabel}`);
        // Push event to undo stack
        const teamSide = vars.teamSide || (activeSide === 'home' ? 'home' : 'away');
        setUndoStack((prev) => [
          {
            id: `${Date.now()}-${Math.random()}`,
            playerId: vars.playerId,
            playerName: vars.playerName,
            stat: vars.stat,
            delta: vars.delta,
            teamSide,
            timestamp: Date.now(),
          },
          ...prev.slice(0, 9),
        ]);
      } else {
        toast.info(`Undone: ${prefix} ${statLabel} for ${vars.playerName}`);
      }

      queryClient.invalidateQueries({ queryKey: ['game-player-stats', gameId] });
      queryClient.invalidateQueries({ queryKey: ['overlay', gameId] });
      queryClient.invalidateQueries({ queryKey: ['live-standings'] });
      if (onStatChange) onStatChange();
    },
    onError: (err, _vars, context) => {
      if (context?.previousStats) {
        queryClient.setQueryData(['game-player-stats', gameId], context.previousStats);
      }
      toast.error(`Stat recording failed: ${(err as Error).message}`);
    },
  });

  // Handle 1-Tap Global Undo
  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const [lastAction, ...rest] = undoStack;
    setUndoStack(rest);

    statMutation.mutate({
      playerId: lastAction.playerId,
      playerName: lastAction.playerName,
      stat: lastAction.stat,
      delta: -lastAction.delta,
      teamSide: lastAction.teamSide,
      isUndo: true,
    });
  };

  // Quick Add Player Mutation
  const addPlayerMutation = useMutation({
    mutationFn: async () => {
      if (!newPlayerName.trim()) throw new Error('Player name is required');
      const side = activeSide === 'boxscore' ? newPlayerTeamSide : activeSide;
      return quickAddGamePlayer(gameId, {
        name: newPlayerName.trim(),
        jerseyNumber: newPlayerJersey || undefined,
        teamSide: side,
      });
    },
    onSuccess: (res) => {
      toast.success(`Added ${res.player.name} to roster`);
      // Auto-set new player as on-floor
      setOnFloorPlayerIds((prev) => ({ ...prev, [res.player.id]: true }));
      setNewPlayerName('');
      setNewPlayerJersey('');
      setShowAddPlayer(false);
      queryClient.invalidateQueries({ queryKey: ['game-player-stats', gameId] });
    },
    onError: (err) => {
      toast.error((err as Error).message);
    },
  });

  const rawPlayers = useMemo(() => {
    return activeSide === 'away' ? awayData?.players ?? [] : activeSide === 'home' ? homeData?.players ?? [] : [];
  }, [activeSide, awayData?.players, homeData?.players]);

  const currentPlayers = useMemo(() => {
    if (!filterOnFloorOnly) return rawPlayers;
    return rawPlayers.filter((p) => onFloorPlayerIds[p.playerId]);
  }, [rawPlayers, filterOnFloorOnly, onFloorPlayerIds]);

  const onFloorCount = useMemo(() => {
    return rawPlayers.filter((p) => onFloorPlayerIds[p.playerId]).length;
  }, [rawPlayers, onFloorPlayerIds]);

  // Calculate Team Totals
  const calculateTotals = (players: GamePlayerStat[]) => {
    return players.reduce(
      (acc, p) => ({
        pts: acc.pts + p.pts,
        reb: acc.reb + p.reb,
        ast: acc.ast + p.ast,
        stl: acc.stl + p.stl,
        blk: acc.blk + p.blk,
        fls: acc.fls + p.fls,
      }),
      { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, fls: 0 }
    );
  };

  const awayTotals = calculateTotals(awayData?.players ?? []);
  const homeTotals = calculateTotals(homeData?.players ?? []);

  const currentTeamTotals = activeSide === 'away' ? awayTotals : homeTotals;
  const isBonusPenalty = currentTeamTotals.fls >= 5;

  return (
    <div
      data-testid="player-stats-tracker"
      className={`rounded-2xl border border-border/50 bg-card p-4 sm:p-6 text-foreground font-sans shadow-sm ${className}`}
    >
      {/* ── Header & Team Selector Tabs ───────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/40 pb-3.5 mb-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <Activity className="h-4 w-4 text-primary" />
            <h3 className="text-sm sm:text-base font-bold font-display text-foreground">
              Individual Player Stats & Box Score Tabulation
            </h3>
            {isBonusPenalty && (
              <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-rose-500/15 text-rose-400 border border-rose-500/30 animate-pulse">
                BONUS (PENALTY)
              </span>
            )}
            <span className="hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-bold">
              <Radio className="w-2.5 h-2.5 animate-pulse text-emerald-400" />
              Multi-Admin Sync Active
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            0ms instant scoring tabulation synced directly to live overlays and standings.
          </p>
        </div>

        {/* Tab Controls */}
        <div className="flex items-center gap-1.5 bg-secondary/80 p-1 rounded-xl border border-border/40">
          <button
            type="button"
            onClick={() => {
              setActiveSide('away');
              setNewPlayerTeamSide('away');
            }}
            className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all ${
              activeSide === 'away'
                ? 'bg-card text-foreground shadow-sm border border-border/60'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {awayData?.teamName || 'Away'} ({awayTotals.pts} PTS)
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveSide('home');
              setNewPlayerTeamSide('home');
            }}
            className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all ${
              activeSide === 'home'
                ? 'bg-card text-foreground shadow-sm border border-border/60'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {homeData?.teamName || 'Home'} ({homeTotals.pts} PTS)
          </button>
          <button
            type="button"
            onClick={() => setActiveSide('boxscore')}
            className={`flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
              activeSide === 'boxscore'
                ? 'bg-card text-foreground shadow-sm border border-border/60'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <TableIcon className="h-3.5 w-3.5" />
            Box Score
          </button>
        </div>
      </div>

      {/* ── Ergonomic Control Bar: Undo & On-Floor Filter ──────────────────────── */}
      {activeSide !== 'boxscore' && (
        <div className="flex flex-wrap items-center justify-between gap-2.5 mb-4 p-2 rounded-xl bg-secondary/30 border border-border/30">
          {/* Active 5 Filter Toggle */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setFilterOnFloorOnly((prev) => !prev)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                filterOnFloorOnly
                  ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                  : 'bg-card text-muted-foreground border-border/50 hover:text-foreground'
              }`}
            >
              <Shirt className="h-3.5 w-3.5" />
              <span>{filterOnFloorOnly ? 'Showing On Floor' : 'Filter On Floor'}</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${filterOnFloorOnly ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-secondary text-foreground'}`}>
                {onFloorCount} Active
              </span>
            </button>
            <span className="text-[11px] text-muted-foreground hidden sm:inline">
              Tap jersey icon on cards to sub in/out
            </span>
          </div>

          {/* Global 1-Tap Undo Pill */}
          {undoStack.length > 0 && (
            <button
              type="button"
              onClick={handleUndo}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 rounded-lg text-xs font-bold transition-all shadow-sm animate-in fade-in"
            >
              <RotateCcw className="h-3.5 w-3.5 text-amber-400" />
              <span>
                Undo: {undoStack[0].delta > 0 ? `+${undoStack[0].delta}` : undoStack[0].delta} {undoStack[0].stat.toUpperCase()} ({undoStack[0].playerName})
              </span>
            </button>
          )}
        </div>
      )}

      {/* ── Single Add Player Form Section ────────────────────────────────────── */}
      <div className="mb-4">
        {!showAddPlayer ? (
          <button
            type="button"
            onClick={() => setShowAddPlayer(true)}
            className="w-full py-2.5 border border-dashed border-border/60 hover:border-primary rounded-xl text-xs font-bold text-muted-foreground hover:text-primary bg-secondary/20 hover:bg-secondary/40 transition-all flex items-center justify-center gap-1.5"
          >
            <UserPlus className="h-3.5 w-3.5" />
            + Add Walk-On Player {activeSide !== 'boxscore' ? `to ${activeSide === 'away' ? awayData?.teamName || 'Away' : homeData?.teamName || 'Home'}` : ''}
          </button>
        ) : (
          <div className="w-full flex flex-wrap items-center gap-2 bg-secondary/40 p-3 rounded-xl border border-border/50 animate-in fade-in">
            {activeSide === 'boxscore' && (
              <select
                value={newPlayerTeamSide}
                onChange={(e) => setNewPlayerTeamSide(e.target.value as 'away' | 'home')}
                className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-bold text-primary focus:border-primary focus:outline-none"
              >
                <option value="away">Away: {awayData?.teamName || 'Away'}</option>
                <option value="home">Home: {homeData?.teamName || 'Home'}</option>
              </select>
            )}
            <input
              type="number"
              placeholder="#"
              value={newPlayerJersey}
              onChange={(e) => setNewPlayerJersey(e.target.value)}
              className="w-14 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-bold text-center text-foreground focus:border-primary focus:outline-none"
            />
            <input
              type="text"
              placeholder="Player Name (e.g. Marcus Smart)"
              value={newPlayerName}
              onChange={(e) => setNewPlayerName(e.target.value)}
              className="flex-1 min-w-[150px] rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground focus:border-primary focus:outline-none"
            />
            <button
              type="button"
              disabled={addPlayerMutation.isPending}
              onClick={() => addPlayerMutation.mutate()}
              className="rounded-lg bg-primary px-3.5 py-1.5 text-xs font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-all shadow-sm"
            >
              Add Player
            </button>
            <button
              type="button"
              onClick={() => {
                setShowAddPlayer(false);
                setNewPlayerName('');
                setNewPlayerJersey('');
              }}
              className="rounded-lg bg-secondary px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* ── Active Team Player Roster Stat Cards ──────────────────────────────── */}
      {activeSide !== 'boxscore' ? (
        <div className="space-y-3">
          {currentPlayers.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/40 bg-secondary/10 p-8 text-center text-muted-foreground">
              <Users className="h-8 w-8 mx-auto mb-2 text-muted-foreground/60" />
              <p className="text-xs font-bold">
                {filterOnFloorOnly ? 'No players marked as On Floor.' : 'No players on this roster yet.'}
              </p>
              <p className="text-[11px] text-muted-foreground/80 mt-1">
                {filterOnFloorOnly
                  ? 'Toggle off "Filter On Floor" or mark players on court below.'
                  : 'Use the Add Walk-On Player button above to register players.'}
              </p>
            </div>
          ) : (
            currentPlayers.map((player) => {
              const isFouledOut = player.fls >= 5;
              const isNearFoulOut = player.fls === 4;
              const isOnFloor = Boolean(onFloorPlayerIds[player.playerId]);

              return (
                <div
                  key={player.playerId}
                  className={`rounded-xl border p-3.5 sm:p-4 transition-all ${
                    isFouledOut
                      ? 'border-rose-500/40 bg-rose-500/5'
                      : isOnFloor
                      ? 'border-border/60 bg-card/90 shadow-sm'
                      : 'border-border/30 bg-card/40 opacity-80'
                  }`}
                >
                  {/* Player Header & Stat Summary */}
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2.5">
                      {/* On-Floor Substitution Toggle Button */}
                      <button
                        type="button"
                        onClick={() => toggleOnFloor(player.playerId)}
                        title={isOnFloor ? 'On Floor (Tap to Bench)' : 'On Bench (Tap to Sub In)'}
                        className={`flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold border transition-all ${
                          isOnFloor
                            ? 'bg-primary/15 text-primary border-primary/40 shadow-sm'
                            : 'bg-secondary text-muted-foreground border-border/40 hover:text-foreground'
                        }`}
                      >
                        {player.jerseyNumber !== null ? `#${player.jerseyNumber}` : '—'}
                      </button>

                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-bold text-foreground">
                            {player.playerName}
                          </span>
                          {isOnFloor && (
                            <span className="px-1.5 py-0.2 rounded text-[9px] font-extrabold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                              ON COURT
                            </span>
                          )}
                        </div>
                        {player.position && (
                          <div className="text-[10px] text-muted-foreground uppercase font-semibold">
                            {player.position}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Live Stat Badges */}
                    <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold">
                      <span className="px-2.5 py-1 rounded-lg bg-primary/10 text-primary font-bold border border-primary/20">
                        {player.pts} PTS
                      </span>
                      <span className="px-2 py-0.5 rounded-md bg-secondary text-foreground font-medium">
                        {player.reb} REB
                      </span>
                      <span className="px-2 py-0.5 rounded-md bg-secondary text-foreground font-medium">
                        {player.ast} AST
                      </span>
                      <span className="px-2 py-0.5 rounded-md bg-secondary text-muted-foreground">
                        {player.stl} STL
                      </span>
                      <span className="px-2 py-0.5 rounded-md bg-secondary text-muted-foreground">
                        {player.blk} BLK
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-md font-bold ${
                          isFouledOut
                            ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40 animate-pulse'
                            : isNearFoulOut
                            ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                            : 'bg-secondary text-muted-foreground'
                        }`}
                      >
                        {player.fls} FL{isFouledOut ? ' (FOULED OUT)' : ''}
                      </span>
                    </div>
                  </div>

                  {/* 1-Tap Action Buttons Grid (Optimistic 0ms) */}
                  <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5 pt-2.5 border-t border-border/30">
                    <button
                      type="button"
                      disabled={statMutation.isPending}
                      onClick={() =>
                        statMutation.mutate({
                          playerId: player.playerId,
                          playerName: player.playerName,
                          stat: 'pts',
                          delta: 1,
                          teamSide: activeSide,
                        })
                      }
                      className="rounded-lg bg-secondary hover:bg-secondary/80 p-2 text-center text-xs font-bold text-foreground transition-all active:scale-95"
                    >
                      +1 FT
                    </button>
                    <button
                      type="button"
                      disabled={statMutation.isPending}
                      onClick={() =>
                        statMutation.mutate({
                          playerId: player.playerId,
                          playerName: player.playerName,
                          stat: 'pts',
                          delta: 2,
                          teamSide: activeSide,
                        })
                      }
                      className="rounded-lg bg-primary/10 hover:bg-primary/20 p-2 text-center text-xs font-bold text-primary border border-primary/20 transition-all active:scale-95"
                    >
                      +2 FG
                    </button>
                    <button
                      type="button"
                      disabled={statMutation.isPending}
                      onClick={() =>
                        statMutation.mutate({
                          playerId: player.playerId,
                          playerName: player.playerName,
                          stat: 'pts',
                          delta: 3,
                          teamSide: activeSide,
                        })
                      }
                      className="rounded-lg bg-primary/15 hover:bg-primary/25 p-2 text-center text-xs font-bold text-primary border border-primary/30 transition-all active:scale-95"
                    >
                      +3 3PT
                    </button>
                    <button
                      type="button"
                      disabled={statMutation.isPending}
                      onClick={() =>
                        statMutation.mutate({
                          playerId: player.playerId,
                          playerName: player.playerName,
                          stat: 'reb',
                          delta: 1,
                          teamSide: activeSide,
                        })
                      }
                      className="rounded-lg bg-secondary hover:bg-secondary/80 p-2 text-center text-xs font-bold text-foreground transition-all active:scale-95"
                    >
                      +1 REB
                    </button>
                    <button
                      type="button"
                      disabled={statMutation.isPending}
                      onClick={() =>
                        statMutation.mutate({
                          playerId: player.playerId,
                          playerName: player.playerName,
                          stat: 'ast',
                          delta: 1,
                          teamSide: activeSide,
                        })
                      }
                      className="rounded-lg bg-secondary hover:bg-secondary/80 p-2 text-center text-xs font-bold text-foreground transition-all active:scale-95"
                    >
                      +1 AST
                    </button>
                    <button
                      type="button"
                      disabled={statMutation.isPending}
                      onClick={() =>
                        statMutation.mutate({
                          playerId: player.playerId,
                          playerName: player.playerName,
                          stat: 'stl',
                          delta: 1,
                          teamSide: activeSide,
                        })
                      }
                      className="rounded-lg bg-secondary hover:bg-secondary/80 p-2 text-center text-xs font-bold text-muted-foreground hover:text-foreground transition-all active:scale-95"
                    >
                      +1 STL
                    </button>
                    <button
                      type="button"
                      disabled={statMutation.isPending}
                      onClick={() =>
                        statMutation.mutate({
                          playerId: player.playerId,
                          playerName: player.playerName,
                          stat: 'blk',
                          delta: 1,
                          teamSide: activeSide,
                        })
                      }
                      className="rounded-lg bg-secondary hover:bg-secondary/80 p-2 text-center text-xs font-bold text-muted-foreground hover:text-foreground transition-all active:scale-95"
                    >
                      +1 BLK
                    </button>
                    <button
                      type="button"
                      disabled={statMutation.isPending}
                      onClick={() =>
                        statMutation.mutate({
                          playerId: player.playerId,
                          playerName: player.playerName,
                          stat: 'fls',
                          delta: 1,
                          teamSide: activeSide,
                        })
                      }
                      className="rounded-lg bg-amber-500/10 hover:bg-amber-500/20 p-2 text-center text-xs font-bold text-amber-400 border border-amber-500/20 transition-all active:scale-95"
                    >
                      +1 FL
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      ) : (
        /* ── Full Box Score Table View ────────────────────────────────────────── */
        <div className="space-y-6">
          {/* Away Team Box Score */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-wider text-primary">
                {awayData?.teamName || 'Away'} Box Score
              </h4>
              <span className="text-xs font-bold text-foreground">{awayTotals.pts} PTS &middot; {awayTotals.fls} FL</span>
            </div>
            <div className="overflow-x-auto rounded-xl border border-border/40 bg-card">
              <table className="w-full text-left text-xs">
                <thead className="bg-secondary/50 text-muted-foreground font-semibold border-b border-border/40">
                  <tr>
                    <th className="p-2.5 pl-3.5">#</th>
                    <th className="p-2.5">Player</th>
                    <th className="p-2.5 text-center text-primary font-bold">PTS</th>
                    <th className="p-2.5 text-center">REB</th>
                    <th className="p-2.5 text-center">AST</th>
                    <th className="p-2.5 text-center">STL</th>
                    <th className="p-2.5 text-center">BLK</th>
                    <th className="p-2.5 text-center">FLS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {(awayData?.players ?? []).map((p) => (
                    <tr key={p.playerId} className="hover:bg-secondary/30 transition-colors">
                      <td className="p-2.5 pl-3.5 font-bold text-muted-foreground">{p.jerseyNumber ?? '—'}</td>
                      <td className="p-2.5 font-semibold text-foreground">{p.playerName}</td>
                      <td className="p-2.5 text-center font-bold text-primary">{p.pts}</td>
                      <td className="p-2.5 text-center text-muted-foreground">{p.reb}</td>
                      <td className="p-2.5 text-center text-muted-foreground">{p.ast}</td>
                      <td className="p-2.5 text-center text-muted-foreground">{p.stl}</td>
                      <td className="p-2.5 text-center text-muted-foreground">{p.blk}</td>
                      <td className={`p-2.5 text-center font-bold ${p.fls >= 5 ? 'text-rose-400' : 'text-muted-foreground'}`}>{p.fls}</td>
                    </tr>
                  ))}
                  <tr className="bg-secondary/40 font-bold text-foreground">
                    <td colSpan={2} className="p-2.5 pl-3.5 text-muted-foreground">TOTALS</td>
                    <td className="p-2.5 text-center text-primary">{awayTotals.pts}</td>
                    <td className="p-2.5 text-center">{awayTotals.reb}</td>
                    <td className="p-2.5 text-center">{awayTotals.ast}</td>
                    <td className="p-2.5 text-center">{awayTotals.stl}</td>
                    <td className="p-2.5 text-center">{awayTotals.blk}</td>
                    <td className="p-2.5 text-center">{awayTotals.fls}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Home Team Box Score */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-wider text-primary">
                {homeData?.teamName || 'Home'} Box Score
              </h4>
              <span className="text-xs font-bold text-foreground">{homeTotals.pts} PTS &middot; {homeTotals.fls} FL</span>
            </div>
            <div className="overflow-x-auto rounded-xl border border-border/40 bg-card">
              <table className="w-full text-left text-xs">
                <thead className="bg-secondary/50 text-muted-foreground font-semibold border-b border-border/40">
                  <tr>
                    <th className="p-2.5 pl-3.5">#</th>
                    <th className="p-2.5">Player</th>
                    <th className="p-2.5 text-center text-primary font-bold">PTS</th>
                    <th className="p-2.5 text-center">REB</th>
                    <th className="p-2.5 text-center">AST</th>
                    <th className="p-2.5 text-center">STL</th>
                    <th className="p-2.5 text-center">BLK</th>
                    <th className="p-2.5 text-center">FLS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {(homeData?.players ?? []).map((p) => (
                    <tr key={p.playerId} className="hover:bg-secondary/30 transition-colors">
                      <td className="p-2.5 pl-3.5 font-bold text-muted-foreground">{p.jerseyNumber ?? '—'}</td>
                      <td className="p-2.5 font-semibold text-foreground">{p.playerName}</td>
                      <td className="p-2.5 text-center font-bold text-primary">{p.pts}</td>
                      <td className="p-2.5 text-center text-muted-foreground">{p.reb}</td>
                      <td className="p-2.5 text-center text-muted-foreground">{p.ast}</td>
                      <td className="p-2.5 text-center text-muted-foreground">{p.stl}</td>
                      <td className="p-2.5 text-center text-muted-foreground">{p.blk}</td>
                      <td className={`p-2.5 text-center font-bold ${p.fls >= 5 ? 'text-rose-400' : 'text-muted-foreground'}`}>{p.fls}</td>
                    </tr>
                  ))}
                  <tr className="bg-secondary/40 font-bold text-foreground">
                    <td colSpan={2} className="p-2.5 pl-3.5 text-muted-foreground">TOTALS</td>
                    <td className="p-2.5 text-center text-primary">{homeTotals.pts}</td>
                    <td className="p-2.5 text-center">{homeTotals.reb}</td>
                    <td className="p-2.5 text-center">{homeTotals.ast}</td>
                    <td className="p-2.5 text-center">{homeTotals.stl}</td>
                    <td className="p-2.5 text-center">{homeTotals.blk}</td>
                    <td className="p-2.5 text-center">{homeTotals.fls}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
