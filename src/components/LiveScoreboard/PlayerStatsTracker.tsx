/**
 * PlayerStatsTracker Component
 *
 * Courtside player stat recording and live boxscore tabulation console.
 * Enables 1-tap stat recording for individual players with real-time sync
 * to team score, scoreboard pulse, and live projected standings.
 */
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Users,
  UserPlus,
  Trophy,
  Flame,
  Shield,
  Activity,
  Plus,
  Minus,
  Table,
  CheckCircle2,
} from 'lucide-react';
import {
  fetchGamePlayerStats,
  recordPlayerStat,
  quickAddGamePlayer,
  type GamePlayerStat,
  type StatType,
} from '@/lib/api/playerStats';

export interface PlayerStatsTrackerProps {
  gameId: string;
  onStatChange?: () => void;
  className?: string;
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

  // Fetch live player game stats
  const statsQuery = useQuery({
    queryKey: ['game-player-stats', gameId],
    queryFn: () => fetchGamePlayerStats(gameId),
    refetchInterval: 3000,
    enabled: !!gameId,
  });

  const homeData = statsQuery.data?.home;
  const awayData = statsQuery.data?.away;

  // Stat Recording Mutation
  const recordStatMutation = useMutation({
    mutationFn: async (vars: {
      playerId: string;
      stat: StatType;
      delta: number;
      teamSide: 'home' | 'away';
      playerName: string;
    }) => {
      return recordPlayerStat(gameId, {
        playerId: vars.playerId,
        stat: vars.stat,
        delta: vars.delta,
        teamSide: vars.teamSide,
        syncTeamScore: vars.stat === 'pts' || vars.stat === 'fls',
      });
    },
    onSuccess: (_, vars) => {
      const statLabel = vars.stat.toUpperCase();
      const prefix = vars.delta > 0 ? `+${vars.delta}` : `${vars.delta}`;
      toast.success(`${vars.playerName}: ${prefix} ${statLabel}`);
      queryClient.invalidateQueries({ queryKey: ['game-player-stats', gameId] });
      queryClient.invalidateQueries({ queryKey: ['overlay', gameId] });
      queryClient.invalidateQueries({ queryKey: ['live-standings'] });
      if (onStatChange) onStatChange();
    },
    onError: (err) => {
      toast.error(`Stat recording failed: ${(err as Error).message}`);
    },
  });

  // Quick Add Player Mutation
  const addPlayerMutation = useMutation({
    mutationFn: async () => {
      if (!newPlayerName.trim()) throw new Error('Player name is required');
      const side = activeSide === 'boxscore' ? 'away' : activeSide;
      return quickAddGamePlayer(gameId, {
        name: newPlayerName.trim(),
        jerseyNumber: newPlayerJersey || undefined,
        teamSide: side,
      });
    },
    onSuccess: (res) => {
      toast.success(`Added ${res.player.name} to roster`);
      setNewPlayerName('');
      setNewPlayerJersey('');
      setShowAddPlayer(false);
      queryClient.invalidateQueries({ queryKey: ['game-player-stats', gameId] });
    },
    onError: (err) => {
      toast.error((err as Error).message);
    },
  });

  const currentPlayers =
    activeSide === 'away' ? awayData?.players ?? [] : activeSide === 'home' ? homeData?.players ?? [] : [];

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

  return (
    <div
      data-testid="player-stats-tracker"
      className={`rounded-xl border border-[#222222] bg-[#111111] p-4 sm:p-6 text-[#F5F5F0] font-['Space_Grotesk'] ${className}`}
    >
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#222222] pb-3 mb-4">
        <div>
          <h3 className="text-sm sm:text-base font-bold text-[#F5F5F0] flex items-center gap-2">
            <Users className="h-4 w-4 text-[#C9A84C]" />
            Individual Player Stats & Box Score
          </h3>
          <p className="text-[11px] text-[#8A8A8A]">
            1-tap player stat attribution. Syncs directly with team score & standings.
          </p>
        </div>

        {/* View Switcher Tabs */}
        <div className="flex items-center gap-1 bg-[#181818] p-1 rounded-lg border border-[#262626]">
          <button
            type="button"
            onClick={() => setActiveSide('away')}
            className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${
              activeSide === 'away'
                ? 'bg-[#C9A84C] text-[#0A0A0A] shadow-md'
                : 'text-[#8A8A8A] hover:text-[#F5F5F0]'
            }`}
          >
            {awayData?.teamName ?? 'Away'} ({awayTotals.pts} PTS)
          </button>
          <button
            type="button"
            onClick={() => setActiveSide('home')}
            className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${
              activeSide === 'home'
                ? 'bg-[#C9A84C] text-[#0A0A0A] shadow-md'
                : 'text-[#8A8A8A] hover:text-[#F5F5F0]'
            }`}
          >
            {homeData?.teamName ?? 'Home'} ({homeTotals.pts} PTS)
          </button>
          <button
            type="button"
            onClick={() => setActiveSide('boxscore')}
            className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all flex items-center gap-1 ${
              activeSide === 'boxscore'
                ? 'bg-[#C9A84C] text-[#0A0A0A] shadow-md'
                : 'text-[#8A8A8A] hover:text-[#F5F5F0]'
            }`}
          >
            <Table className="h-3 w-3" />
            Box Score
          </button>
        </div>
      </div>

      {/* ── Quick Add Player Bar ──────────────────────────────────────────────── */}
      {activeSide !== 'boxscore' && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          {!showAddPlayer ? (
            <button
              type="button"
              onClick={() => setShowAddPlayer(true)}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-[#C9A84C] hover:text-[#E8C76A] transition-colors"
            >
              <UserPlus className="h-3.5 w-3.5" />
              + Quick Add Player to {activeSide === 'away' ? awayData?.teamName : homeData?.teamName} Roster
            </button>
          ) : (
            <div className="w-full flex flex-wrap items-center gap-2 bg-[#161616] p-3 rounded-lg border border-[#2A2A2A] animate-in fade-in">
              <input
                type="number"
                placeholder="#"
                value={newPlayerJersey}
                onChange={(e) => setNewPlayerJersey(e.target.value)}
                className="w-14 rounded-md border border-[#333] bg-[#1F1F1F] px-2 py-1 text-xs font-bold text-center text-[#F5F5F0] focus:border-[#C9A84C] focus:outline-none"
              />
              <input
                type="text"
                placeholder="Player Name (e.g. Marcus Smart)"
                value={newPlayerName}
                onChange={(e) => setNewPlayerName(e.target.value)}
                className="flex-1 min-w-[150px] rounded-md border border-[#333] bg-[#1F1F1F] px-3 py-1 text-xs font-medium text-[#F5F5F0] focus:border-[#C9A84C] focus:outline-none"
              />
              <button
                type="button"
                disabled={addPlayerMutation.isPending}
                onClick={() => addPlayerMutation.mutate()}
                className="rounded-md bg-[#C9A84C] px-3 py-1 text-xs font-bold text-[#0A0A0A] hover:bg-[#E8C76A]"
              >
                Add Player
              </button>
              <button
                type="button"
                onClick={() => setShowAddPlayer(false)}
                className="rounded-md bg-[#222] px-2.5 py-1 text-xs text-[#8A8A8A] hover:text-[#F5F5F0]"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Active Team Player Roster Stat Cards ──────────────────────────────── */}
      {activeSide !== 'boxscore' ? (
        <div className="space-y-3">
          {currentPlayers.length === 0 ? (
            <div className="rounded-lg border border-[#222222] bg-[#141414] p-8 text-center text-[#8A8A8A]">
              <Users className="h-8 w-8 mx-auto mb-2 text-[#8A8A8A]" />
              <p className="text-xs font-semibold">No players on roster yet.</p>
              <button
                type="button"
                onClick={() => setShowAddPlayer(true)}
                className="mt-3 inline-flex items-center gap-1 rounded-md bg-[#C9A84C] px-3 py-1.5 text-xs font-bold text-[#0A0A0A]"
              >
                <UserPlus className="h-3.5 w-3.5" />
                Add First Player
              </button>
            </div>
          ) : (
            currentPlayers.map((player) => {
              const foulWarning = player.fls >= 5 ? 'text-[#E63946] font-extrabold' : player.fls === 4 ? 'text-[#F4A261] font-bold' : '';
              return (
                <div
                  key={player.playerId}
                  className="rounded-lg border border-[#222222] bg-[#141414] p-3 sm:p-4 hover:border-[#333333] transition-colors"
                >
                  {/* Player Header & Stat Summary */}
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#1F1F1F] text-xs font-bold text-[#C9A84C] border border-[#2E2E2E]">
                        {player.jerseyNumber !== null ? `#${player.jerseyNumber}` : '—'}
                      </span>
                      <div>
                        <div className="text-sm font-bold text-[#F5F5F0]">
                          {player.playerName}
                        </div>
                        {player.position && (
                          <div className="text-[10px] text-[#8A8A8A] uppercase font-semibold">
                            {player.position}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Live Stat Badges */}
                    <div className="flex items-center gap-2 text-xs">
                      <span className="rounded bg-[#C9A84C]/15 px-2 py-0.5 font-bold text-[#C9A84C] border border-[#C9A84C]/30">
                        {player.pts} <span className="text-[10px] opacity-80">PTS</span>
                      </span>
                      <span className="rounded bg-[#1F1F1F] px-1.5 py-0.5 font-semibold text-[#D1D1D1]">
                        {player.reb} <span className="text-[10px] text-[#8A8A8A]">REB</span>
                      </span>
                      <span className="rounded bg-[#1F1F1F] px-1.5 py-0.5 font-semibold text-[#D1D1D1]">
                        {player.ast} <span className="text-[10px] text-[#8A8A8A]">AST</span>
                      </span>
                      <span className="rounded bg-[#1F1F1F] px-1.5 py-0.5 font-semibold text-[#D1D1D1]">
                        {player.stl} <span className="text-[10px] text-[#8A8A8A]">STL</span>
                      </span>
                      <span className="rounded bg-[#1F1F1F] px-1.5 py-0.5 font-semibold text-[#D1D1D1]">
                        {player.blk} <span className="text-[10px] text-[#8A8A8A]">BLK</span>
                      </span>
                      <span className={`rounded bg-[#1F1F1F] px-1.5 py-0.5 text-xs ${foulWarning || 'text-[#8A8A8A]'}`}>
                        {player.fls} <span className="text-[10px]">FLS</span>
                      </span>
                    </div>
                  </div>

                  {/* 1-Tap Stat Attribution Buttons */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-[#1C1C1C]">
                    {/* Scoring Buttons (Syncs Team Score) */}
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          recordStatMutation.mutate({
                            playerId: player.playerId,
                            stat: 'pts',
                            delta: 1,
                            teamSide: activeSide,
                            playerName: player.playerName,
                          })
                        }
                        className="rounded bg-[#C9A84C] hover:bg-[#E8C76A] px-2.5 py-1 text-xs font-bold text-[#0A0A0A] active:scale-95 transition-all shadow-sm"
                      >
                        +1 FT
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          recordStatMutation.mutate({
                            playerId: player.playerId,
                            stat: 'pts',
                            delta: 2,
                            teamSide: activeSide,
                            playerName: player.playerName,
                          })
                        }
                        className="rounded bg-[#C9A84C] hover:bg-[#E8C76A] px-2.5 py-1 text-xs font-bold text-[#0A0A0A] active:scale-95 transition-all shadow-sm"
                      >
                        +2 FG
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          recordStatMutation.mutate({
                            playerId: player.playerId,
                            stat: 'pts',
                            delta: 3,
                            teamSide: activeSide,
                            playerName: player.playerName,
                          })
                        }
                        className="rounded bg-[#C9A84C] hover:bg-[#E8C76A] px-2.5 py-1 text-xs font-bold text-[#0A0A0A] active:scale-95 transition-all shadow-sm"
                      >
                        +3 3PT
                      </button>
                    </div>

                    <div className="h-4 w-px bg-[#262626] mx-0.5" />

                    {/* Rebound, Assist, Steal, Block */}
                    <div className="flex items-center gap-1 flex-wrap">
                      <button
                        type="button"
                        onClick={() =>
                          recordStatMutation.mutate({
                            playerId: player.playerId,
                            stat: 'reb',
                            delta: 1,
                            teamSide: activeSide,
                            playerName: player.playerName,
                          })
                        }
                        className="rounded bg-[#1F1F1F] hover:bg-[#2A2A2A] px-2 py-1 text-xs font-semibold text-[#F5F5F0]"
                      >
                        +1 REB
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          recordStatMutation.mutate({
                            playerId: player.playerId,
                            stat: 'ast',
                            delta: 1,
                            teamSide: activeSide,
                            playerName: player.playerName,
                          })
                        }
                        className="rounded bg-[#1F1F1F] hover:bg-[#2A2A2A] px-2 py-1 text-xs font-semibold text-[#F5F5F0]"
                      >
                        +1 AST
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          recordStatMutation.mutate({
                            playerId: player.playerId,
                            stat: 'stl',
                            delta: 1,
                            teamSide: activeSide,
                            playerName: player.playerName,
                          })
                        }
                        className="rounded bg-[#1F1F1F] hover:bg-[#2A2A2A] px-2 py-1 text-xs font-semibold text-[#F5F5F0]"
                      >
                        +1 STL
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          recordStatMutation.mutate({
                            playerId: player.playerId,
                            stat: 'blk',
                            delta: 1,
                            teamSide: activeSide,
                            playerName: player.playerName,
                          })
                        }
                        className="rounded bg-[#1F1F1F] hover:bg-[#2A2A2A] px-2 py-1 text-xs font-semibold text-[#F5F5F0]"
                      >
                        +1 BLK
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          recordStatMutation.mutate({
                            playerId: player.playerId,
                            stat: 'fls',
                            delta: 1,
                            teamSide: activeSide,
                            playerName: player.playerName,
                          })
                        }
                        className="rounded bg-[#1F1F1F] hover:bg-[#2A2A2A] px-2 py-1 text-xs font-semibold text-[#F4A261]"
                      >
                        +1 FL
                      </button>
                    </div>

                    <div className="h-4 w-px bg-[#262626] mx-0.5 ml-auto" />

                    {/* Correction */}
                    <button
                      type="button"
                      onClick={() =>
                        recordStatMutation.mutate({
                          playerId: player.playerId,
                          stat: 'pts',
                          delta: -1,
                          teamSide: activeSide,
                          playerName: player.playerName,
                        })
                      }
                      className="rounded bg-[#1A1A1A] hover:bg-[#222222] px-1.5 py-1 text-[11px] font-medium text-[#E63946]"
                    >
                      -1 PT
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      ) : (
        /* ── Full Live Box Score View ─────────────────────────────────────────── */
        <div className="space-y-6">
          {/* Away Team Box Score Table */}
          <div>
            <h4 className="text-xs font-bold text-[#C9A84C] uppercase tracking-wider mb-2 flex items-center justify-between">
              <span>{awayData?.teamName ?? 'Away'} Box Score</span>
              <span>Total PTS: {awayTotals.pts}</span>
            </h4>
            <div className="overflow-x-auto rounded-lg border border-[#222222]">
              <table className="w-full text-left text-xs font-medium">
                <thead className="bg-[#181818] text-[10px] uppercase font-bold text-[#8A8A8A] border-b border-[#222222]">
                  <tr>
                    <th className="py-2 px-3">#</th>
                    <th className="py-2 px-3">Player</th>
                    <th className="py-2 px-2 text-center text-[#C9A84C]">PTS</th>
                    <th className="py-2 px-2 text-center">REB</th>
                    <th className="py-2 px-2 text-center">AST</th>
                    <th className="py-2 px-2 text-center">STL</th>
                    <th className="py-2 px-2 text-center">BLK</th>
                    <th className="py-2 px-2 text-center">FLS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1F1F1F] bg-[#141414]">
                  {(awayData?.players ?? []).map((p) => (
                    <tr key={p.playerId} className="hover:bg-[#1A1A1A]">
                      <td className="py-2 px-3 text-[#C9A84C] font-bold">{p.jerseyNumber !== null ? `#${p.jerseyNumber}` : '—'}</td>
                      <td className="py-2 px-3 text-[#F5F5F0] font-semibold">{p.playerName}</td>
                      <td className="py-2 px-2 text-center font-bold text-[#C9A84C]">{p.pts}</td>
                      <td className="py-2 px-2 text-center text-[#D1D1D1]">{p.reb}</td>
                      <td className="py-2 px-2 text-center text-[#D1D1D1]">{p.ast}</td>
                      <td className="py-2 px-2 text-center text-[#D1D1D1]">{p.stl}</td>
                      <td className="py-2 px-2 text-center text-[#D1D1D1]">{p.blk}</td>
                      <td className="py-2 px-2 text-center text-[#8A8A8A]">{p.fls}</td>
                    </tr>
                  ))}
                  <tr className="bg-[#181818] font-bold border-t border-[#262626]">
                    <td className="py-2 px-3" colSpan={2}>TOTALS</td>
                    <td className="py-2 px-2 text-center text-[#C9A84C]">{awayTotals.pts}</td>
                    <td className="py-2 px-2 text-center">{awayTotals.reb}</td>
                    <td className="py-2 px-2 text-center">{awayTotals.ast}</td>
                    <td className="py-2 px-2 text-center">{awayTotals.stl}</td>
                    <td className="py-2 px-2 text-center">{awayTotals.blk}</td>
                    <td className="py-2 px-2 text-center">{awayTotals.fls}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Home Team Box Score Table */}
          <div>
            <h4 className="text-xs font-bold text-[#C9A84C] uppercase tracking-wider mb-2 flex items-center justify-between">
              <span>{homeData?.teamName ?? 'Home'} Box Score</span>
              <span>Total PTS: {homeTotals.pts}</span>
            </h4>
            <div className="overflow-x-auto rounded-lg border border-[#222222]">
              <table className="w-full text-left text-xs font-medium">
                <thead className="bg-[#181818] text-[10px] uppercase font-bold text-[#8A8A8A] border-b border-[#222222]">
                  <tr>
                    <th className="py-2 px-3">#</th>
                    <th className="py-2 px-3">Player</th>
                    <th className="py-2 px-2 text-center text-[#C9A84C]">PTS</th>
                    <th className="py-2 px-2 text-center">REB</th>
                    <th className="py-2 px-2 text-center">AST</th>
                    <th className="py-2 px-2 text-center">STL</th>
                    <th className="py-2 px-2 text-center">BLK</th>
                    <th className="py-2 px-2 text-center">FLS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1F1F1F] bg-[#141414]">
                  {(homeData?.players ?? []).map((p) => (
                    <tr key={p.playerId} className="hover:bg-[#1A1A1A]">
                      <td className="py-2 px-3 text-[#C9A84C] font-bold">{p.jerseyNumber !== null ? `#${p.jerseyNumber}` : '—'}</td>
                      <td className="py-2 px-3 text-[#F5F5F0] font-semibold">{p.playerName}</td>
                      <td className="py-2 px-2 text-center font-bold text-[#C9A84C]">{p.pts}</td>
                      <td className="py-2 px-2 text-center text-[#D1D1D1]">{p.reb}</td>
                      <td className="py-2 px-2 text-center text-[#D1D1D1]">{p.ast}</td>
                      <td className="py-2 px-2 text-center text-[#D1D1D1]">{p.stl}</td>
                      <td className="py-2 px-2 text-center text-[#D1D1D1]">{p.blk}</td>
                      <td className="py-2 px-2 text-center text-[#8A8A8A]">{p.fls}</td>
                    </tr>
                  ))}
                  <tr className="bg-[#181818] font-bold border-t border-[#262626]">
                    <td className="py-2 px-3" colSpan={2}>TOTALS</td>
                    <td className="py-2 px-2 text-center text-[#C9A84C]">{homeTotals.pts}</td>
                    <td className="py-2 px-2 text-center">{homeTotals.reb}</td>
                    <td className="py-2 px-2 text-center">{homeTotals.ast}</td>
                    <td className="py-2 px-2 text-center">{homeTotals.stl}</td>
                    <td className="py-2 px-2 text-center">{homeTotals.blk}</td>
                    <td className="py-2 px-2 text-center">{homeTotals.fls}</td>
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
