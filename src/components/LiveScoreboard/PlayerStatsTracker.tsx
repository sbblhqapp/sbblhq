/**
 * PlayerStatsTracker Component
 *
 * Real-time individual player box score and statistical tabulation component.
 * Allows 1-tap live recording of points, rebounds, assists, steals, blocks, and fouls.
 * Decoupled standalone player model (GameChanger / iScore 24M+ games architecture).
 */
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Users,
  Plus,
  Minus,
  Table as TableIcon,
  Shield,
  Activity,
  UserPlus,
  Sparkles,
} from 'lucide-react';
import {
  fetchGamePlayerStats,
  recordPlayerStat,
  quickAddGamePlayer,
  type GamePlayerStat,
  type PlayerStatType,
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
  const [newPlayerTeamSide, setNewPlayerTeamSide] = useState<'away' | 'home'>('away');

  // Query stats
  const statsQuery = useQuery({
    queryKey: ['game-player-stats', gameId],
    queryFn: () => fetchGamePlayerStats(gameId),
    enabled: Boolean(gameId),
    refetchInterval: 5000,
  });

  const awayData = statsQuery.data?.away;
  const homeData = statsQuery.data?.home;

  // Stat Recording Mutation
  const statMutation = useMutation({
    mutationFn: async (vars: {
      playerId: string;
      playerName: string;
      stat: PlayerStatType;
      delta: number;
      teamSide?: 'home' | 'away';
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
      const side = activeSide === 'boxscore' ? newPlayerTeamSide : activeSide;
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
      {/* ── Header & Team Selector Tabs ───────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#222222] pb-3 mb-4">
        <div>
          <h3 className="text-sm sm:text-base font-bold text-[#F5F5F0] flex items-center gap-2">
            <Activity className="h-4 w-4 text-[#C9A84C]" />
            Individual Player Stats & Box Score
          </h3>
          <p className="text-[11px] text-[#8A8A8A]">
            1-tap tabulates to player profiles and real-time box scores.
          </p>
        </div>

        {/* Tab Controls */}
        <div className="flex items-center gap-1 bg-[#181818] p-1 rounded-lg border border-[#262626]">
          <button
            type="button"
            onClick={() => {
              setActiveSide('away');
              setNewPlayerTeamSide('away');
            }}
            className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${
              activeSide === 'away'
                ? 'bg-[#C9A84C] text-[#0A0A0A]'
                : 'text-[#8A8A8A] hover:text-[#F5F5F0]'
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
            className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${
              activeSide === 'home'
                ? 'bg-[#C9A84C] text-[#0A0A0A]'
                : 'text-[#8A8A8A] hover:text-[#F5F5F0]'
            }`}
          >
            {homeData?.teamName || 'Home'} ({homeTotals.pts} PTS)
          </button>
          <button
            type="button"
            onClick={() => setActiveSide('boxscore')}
            className={`flex items-center gap-1 px-3 py-1 text-xs font-bold rounded-md transition-colors ${
              activeSide === 'boxscore'
                ? 'bg-[#C9A84C] text-[#0A0A0A]'
                : 'text-[#8A8A8A] hover:text-[#F5F5F0]'
            }`}
          >
            <TableIcon className="h-3 w-3" />
            Box Score
          </button>
        </div>
      </div>

      {/* ── Single Add Player Form Section ────────────────────────────────────── */}
      <div className="mb-4">
        {!showAddPlayer ? (
          <button
            type="button"
            onClick={() => setShowAddPlayer(true)}
            className="w-full py-2 border border-dashed border-[#333333] hover:border-[#C9A84C] rounded-lg text-xs font-bold text-[#8A8A8A] hover:text-[#C9A84C] bg-[#141414] hover:bg-[#1A1A1A] transition-all flex items-center justify-center gap-1.5"
          >
            <UserPlus className="h-3.5 w-3.5" />
            + Add Walk-On Player {activeSide !== 'boxscore' ? `to ${activeSide === 'away' ? awayData?.teamName || 'Away' : homeData?.teamName || 'Home'}` : ''}
          </button>
        ) : (
          <div className="w-full flex flex-wrap items-center gap-2 bg-[#161616] p-3 rounded-lg border border-[#2A2A2A] animate-in fade-in">
            {activeSide === 'boxscore' && (
              <select
                value={newPlayerTeamSide}
                onChange={(e) => setNewPlayerTeamSide(e.target.value as 'away' | 'home')}
                className="rounded-md border border-[#333] bg-[#1F1F1F] px-2 py-1 text-xs font-bold text-[#C9A84C] focus:border-[#C9A84C] focus:outline-none"
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
              className="rounded-md bg-[#C9A84C] px-3 py-1 text-xs font-bold text-[#0A0A0A] hover:bg-[#E8C76A] disabled:opacity-50"
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
              className="rounded-md bg-[#222] px-2.5 py-1 text-xs text-[#8A8A8A] hover:text-[#F5F5F0]"
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
            <div className="rounded-lg border border-[#222222] bg-[#141414] p-8 text-center text-[#8A8A8A]">
              <Users className="h-8 w-8 mx-auto mb-2 text-[#8A8A8A]" />
              <p className="text-xs font-semibold">No players on this roster yet.</p>
              <p className="text-[11px] text-[#666666] mt-1">Use the Add Walk-On Player form above to register players for this match.</p>
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
                    <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold">
                      <span className="px-2 py-0.5 rounded bg-[#1F1F1F] text-[#C9A84C] font-bold border border-[#2E2E2E]">
                        {player.pts} PTS
                      </span>
                      <span className="px-2 py-0.5 rounded bg-[#1A1A1A] text-[#F5F5F0]">
                        {player.reb} REB
                      </span>
                      <span className="px-2 py-0.5 rounded bg-[#1A1A1A] text-[#F5F5F0]">
                        {player.ast} AST
                      </span>
                      <span className="px-2 py-0.5 rounded bg-[#1A1A1A] text-[#8A8A8A]">
                        {player.stl} STL
                      </span>
                      <span className="px-2 py-0.5 rounded bg-[#1A1A1A] text-[#8A8A8A]">
                        {player.blk} BLK
                      </span>
                      <span className={`px-2 py-0.5 rounded bg-[#1A1A1A] text-[#8A8A8A] ${foulWarning}`}>
                        {player.fls} FL{player.fls >= 5 && ' (FOULED OUT)'}
                      </span>
                    </div>
                  </div>

                  {/* 1-Tap Action Buttons Grid */}
                  <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5 pt-2 border-t border-[#1C1C1C]">
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
                      className="rounded bg-[#1F1F1F] hover:bg-[#2A2A2A] p-1.5 text-center text-xs font-bold text-[#F5F5F0] transition-colors"
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
                      className="rounded bg-[#1F1F1F] hover:bg-[#2A2A2A] p-1.5 text-center text-xs font-bold text-[#C9A84C] transition-colors"
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
                      className="rounded bg-[#1F1F1F] hover:bg-[#2A2A2A] p-1.5 text-center text-xs font-bold text-[#C9A84C] transition-colors"
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
                      className="rounded bg-[#1F1F1F] hover:bg-[#2A2A2A] p-1.5 text-center text-xs font-bold text-[#F5F5F0] transition-colors"
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
                      className="rounded bg-[#1F1F1F] hover:bg-[#2A2A2A] p-1.5 text-center text-xs font-bold text-[#F5F5F0] transition-colors"
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
                      className="rounded bg-[#1F1F1F] hover:bg-[#2A2A2A] p-1.5 text-center text-xs font-bold text-[#8A8A8A] hover:text-[#F5F5F0] transition-colors"
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
                      className="rounded bg-[#1F1F1F] hover:bg-[#2A2A2A] p-1.5 text-center text-xs font-bold text-[#8A8A8A] hover:text-[#F5F5F0] transition-colors"
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
                      className="rounded bg-[#1F1F1F] hover:bg-[#2A2A2A] p-1.5 text-center text-xs font-bold text-[#F4A261] transition-colors"
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
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-wider text-[#C9A84C]">
                {awayData?.teamName || 'Away'} Box Score
              </h4>
              <span className="text-xs font-bold text-[#F5F5F0]">{awayTotals.pts} PTS</span>
            </div>
            <div className="overflow-x-auto rounded-lg border border-[#222222]">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#181818] text-[#8A8A8A] font-semibold border-b border-[#222222]">
                  <tr>
                    <th className="p-2 pl-3">#</th>
                    <th className="p-2">Player</th>
                    <th className="p-2 text-center text-[#C9A84C]">PTS</th>
                    <th className="p-2 text-center">REB</th>
                    <th className="p-2 text-center">AST</th>
                    <th className="p-2 text-center">STL</th>
                    <th className="p-2 text-center">BLK</th>
                    <th className="p-2 text-center">FLS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1C1C1C] bg-[#141414]">
                  {(awayData?.players ?? []).map((p) => (
                    <tr key={p.playerId} className="hover:bg-[#1A1A1A]">
                      <td className="p-2 pl-3 font-bold text-[#8A8A8A]">{p.jerseyNumber ?? '—'}</td>
                      <td className="p-2 font-semibold text-[#F5F5F0]">{p.playerName}</td>
                      <td className="p-2 text-center font-bold text-[#C9A84C]">{p.pts}</td>
                      <td className="p-2 text-center text-[#8A8A8A]">{p.reb}</td>
                      <td className="p-2 text-center text-[#8A8A8A]">{p.ast}</td>
                      <td className="p-2 text-center text-[#8A8A8A]">{p.stl}</td>
                      <td className="p-2 text-center text-[#8A8A8A]">{p.blk}</td>
                      <td className="p-2 text-center text-[#8A8A8A]">{p.fls}</td>
                    </tr>
                  ))}
                  <tr className="bg-[#181818] font-bold text-[#F5F5F0]">
                    <td colSpan={2} className="p-2 pl-3 text-[#8A8A8A]">TOTALS</td>
                    <td className="p-2 text-center text-[#C9A84C]">{awayTotals.pts}</td>
                    <td className="p-2 text-center">{awayTotals.reb}</td>
                    <td className="p-2 text-center">{awayTotals.ast}</td>
                    <td className="p-2 text-center">{awayTotals.stl}</td>
                    <td className="p-2 text-center">{awayTotals.blk}</td>
                    <td className="p-2 text-center">{awayTotals.fls}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Home Team Box Score */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-wider text-[#C9A84C]">
                {homeData?.teamName || 'Home'} Box Score
              </h4>
              <span className="text-xs font-bold text-[#F5F5F0]">{homeTotals.pts} PTS</span>
            </div>
            <div className="overflow-x-auto rounded-lg border border-[#222222]">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#181818] text-[#8A8A8A] font-semibold border-b border-[#222222]">
                  <tr>
                    <th className="p-2 pl-3">#</th>
                    <th className="p-2">Player</th>
                    <th className="p-2 text-center text-[#C9A84C]">PTS</th>
                    <th className="p-2 text-center">REB</th>
                    <th className="p-2 text-center">AST</th>
                    <th className="p-2 text-center">STL</th>
                    <th className="p-2 text-center">BLK</th>
                    <th className="p-2 text-center">FLS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1C1C1C] bg-[#141414]">
                  {(homeData?.players ?? []).map((p) => (
                    <tr key={p.playerId} className="hover:bg-[#1A1A1A]">
                      <td className="p-2 pl-3 font-bold text-[#8A8A8A]">{p.jerseyNumber ?? '—'}</td>
                      <td className="p-2 font-semibold text-[#F5F5F0]">{p.playerName}</td>
                      <td className="p-2 text-center font-bold text-[#C9A84C]">{p.pts}</td>
                      <td className="p-2 text-center text-[#8A8A8A]">{p.reb}</td>
                      <td className="p-2 text-center text-[#8A8A8A]">{p.ast}</td>
                      <td className="p-2 text-center text-[#8A8A8A]">{p.stl}</td>
                      <td className="p-2 text-center text-[#8A8A8A]">{p.blk}</td>
                      <td className="p-2 text-center text-[#8A8A8A]">{p.fls}</td>
                    </tr>
                  ))}
                  <tr className="bg-[#181818] font-bold text-[#F5F5F0]">
                    <td colSpan={2} className="p-2 pl-3 text-[#8A8A8A]">TOTALS</td>
                    <td className="p-2 text-center text-[#C9A84C]">{homeTotals.pts}</td>
                    <td className="p-2 text-center">{homeTotals.reb}</td>
                    <td className="p-2 text-center">{homeTotals.ast}</td>
                    <td className="p-2 text-center">{homeTotals.stl}</td>
                    <td className="p-2 text-center">{homeTotals.blk}</td>
                    <td className="p-2 text-center">{homeTotals.fls}</td>
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
