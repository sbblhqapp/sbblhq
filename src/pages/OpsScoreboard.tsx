/**
 * /ops/scoreboard/:gameId — Unified League Admin Live Tabulation & Scoring Center
 *
 * Streamlined 1-click game launcher, live tabulation scoreboard, and integrated
 * courtside scoring controls in a single unified surface.
 */
import React, { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Activity,
  Radio,
  ArrowLeft,
  ExternalLink,
  Shield,
  PlusCircle,
  Zap,
  ChevronDown,
  ChevronUp,
  Trash2,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import { LiveScoreboard } from '@/components/LiveScoreboard/LiveScoreboard';
import { CourtsideQuickControls } from '@/components/LiveScoreboard/CourtsideQuickControls';
import { PlayerStatsTracker } from '@/components/LiveScoreboard/PlayerStatsTracker';
import { fetchOverlay, type OverlayPayload } from '@/lib/api/overlay';
import { fetchScores, submitScoreManual, deleteGame } from '@/lib/api/scores';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { LEAGUE_REGISTRY } from '@/lib/leagues';
import type { LeagueId, ScoreCategory } from '@/types';

export default function OpsScoreboardPage() {
  const { gameId: paramGameId } = useParams<{ gameId?: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [selectedLeague, setSelectedLeague] = useState<LeagueId>('wbl');
  const [showCreateGame, setShowCreateGame] = useState<boolean>(!paramGameId);
  const [showDeleteDialog, setShowDeleteDialog] = useState<boolean>(false);

  // Quick Game Creation Form State
  const [newGameForm, setNewGameForm] = useState({
    leagueId: 'wbl' as LeagueId,
    category: 'league' as ScoreCategory,
    homeTeam: '',
    awayTeam: '',
    status: 'live',
  });

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
    refetchInterval: 2500,
    refetchIntervalInBackground: false,
  });

  const game = overlayQuery.data?.game;
  const overlay = overlayQuery.data?.overlay ?? null;

  // Delete Game Mutation
  const deleteGameMutation = useMutation({
    mutationFn: async (gameIdToDelete: string) => {
      return deleteGame(gameIdToDelete);
    },
    onSuccess: async (res) => {
      if (res.ok) {
        toast.success('Match and live scoreboard data deleted successfully.');
        setShowDeleteDialog(false);
        await queryClient.invalidateQueries({ queryKey: ['ops', 'scoreboard-games'] });
        await queryClient.invalidateQueries({ queryKey: ['scores'] });
        await queryClient.invalidateQueries({ queryKey: ['overlay'] });
        navigate('/ops/scoreboard');
      } else {
        toast.error('Failed to delete game');
      }
    },
    onError: (err) => {
      toast.error((err as Error).message || 'Failed to delete game');
    },
  });

  // 1-Click Game Launch Mutation
  const createGameMutation = useMutation({
    mutationFn: async () => {
      if (!newGameForm.homeTeam.trim() || !newGameForm.awayTeam.trim()) {
        throw new Error('Please provide both Home and Away team names');
      }
      return submitScoreManual({
        category: newGameForm.category,
        leagueId: newGameForm.leagueId,
        participant1Label: newGameForm.homeTeam.trim(),
        participant2Label: newGameForm.awayTeam.trim(),
        status: newGameForm.status,
        gameDate: new Date().toISOString(),
      });
    },
    onSuccess: async (res) => {
      if (res.ok && res.gameId) {
        toast.success(`Game launched! Game ID: ${res.gameId.slice(0, 8)}...`);
        setShowCreateGame(false);
        setNewGameForm({
          leagueId: selectedLeague,
          category: 'league',
          homeTeam: '',
          awayTeam: '',
          status: 'live',
        });
        await queryClient.invalidateQueries({ queryKey: ['ops', 'scoreboard-games'] });
        await queryClient.invalidateQueries({ queryKey: ['scores'] });
        navigate(`/ops/scoreboard/${res.gameId}`);
      } else {
        toast.error('Failed to create game');
      }
    },
    onError: (err) => {
      toast.error((err as Error).message);
    },
  });

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
            Live Tabulation & Scoring Center
            <span className="rounded-full bg-[#C9A84C]/20 px-2.5 py-0.5 text-[11px] font-bold text-[#C9A84C]">
              LEAGUE ADMIN
            </span>
          </h1>
          <p className="text-xs text-[#8A8A8A] mt-0.5">
            Instant 1-click game creation, real-time score tabulation, and live projected standings.
          </p>
        </div>

        {/* Action Links */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowCreateGame((prev) => !prev)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#C9A84C] px-3.5 py-2 text-xs font-bold text-[#0A0A0A] hover:bg-[#E8C76A] transition-colors shadow-md"
          >
            <Zap className="h-4 w-4 fill-current" />
            {showCreateGame ? 'Hide Game Launcher' : '⚡ Launch New Game'}
          </button>

          {activeGameId && (
            <Link
              to={`/overlay-control/${activeGameId}`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#1F1F1F] border border-[#333333] px-3 py-2 text-xs font-bold text-[#F5F5F0] hover:bg-[#2A2A2A] transition-colors"
            >
              <Radio className="h-3.5 w-3.5 text-[#C9A84C]" />
              Overlay Room
            </Link>
          )}
        </div>
      </div>

      {/* ── 1-Click Game Launch Form (Collapsible / Prominent) ─────────────────── */}
      {showCreateGame && (
        <div className="mb-6 rounded-xl border border-[#C9A84C]/40 bg-[#141414] p-5 shadow-2xl animate-in fade-in duration-200">
          <div className="flex items-center justify-between border-b border-[#262626] pb-3 mb-4">
            <h2 className="text-sm sm:text-base font-bold text-[#F5F5F0] flex items-center gap-2">
              <Zap className="h-4 w-4 text-[#C9A84C]" />
              ⚡ Instant 1-Click Game & Scoreboard Launch
            </h2>
            <span className="text-[11px] text-[#8A8A8A]">
              Creates game & auto-attaches live scoreboard immediately
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            {/* League Selection */}
            <div>
              <label className="text-[10px] uppercase font-bold text-[#8A8A8A] block mb-1">League</label>
              <select
                value={newGameForm.leagueId}
                onChange={(e) => setNewGameForm((f) => ({ ...f, leagueId: e.target.value as LeagueId }))}
                className="w-full rounded-md border border-[#2A2A2A] bg-[#1A1A1A] px-3 py-2 text-xs font-semibold text-[#F5F5F0] focus:border-[#C9A84C] focus:outline-none"
              >
                {LEAGUE_REGISTRY.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </div>

            {/* Category */}
            <div>
              <label className="text-[10px] uppercase font-bold text-[#8A8A8A] block mb-1">Category</label>
              <select
                value={newGameForm.category}
                onChange={(e) => setNewGameForm((f) => ({ ...f, category: e.target.value as ScoreCategory }))}
                className="w-full rounded-md border border-[#2A2A2A] bg-[#1A1A1A] px-3 py-2 text-xs font-semibold text-[#F5F5F0] focus:border-[#C9A84C] focus:outline-none"
              >
                <option value="league">League Match</option>
                <option value="1v1">1-on-1 Showcase</option>
                <option value="special_event">Special Event / Tournament</option>
              </select>
            </div>

            {/* Away Team */}
            <div>
              <label className="text-[10px] uppercase font-bold text-[#8A8A8A] block mb-1">Away Team Name</label>
              <input
                type="text"
                placeholder="e.g. Ballers / Team A"
                value={newGameForm.awayTeam}
                onChange={(e) => setNewGameForm((f) => ({ ...f, awayTeam: e.target.value }))}
                className="w-full rounded-md border border-[#2A2A2A] bg-[#1A1A1A] px-3 py-2 text-xs font-semibold text-[#F5F5F0] placeholder-[#555] focus:border-[#C9A84C] focus:outline-none"
              />
            </div>

            {/* Home Team */}
            <div>
              <label className="text-[10px] uppercase font-bold text-[#8A8A8A] block mb-1">Home Team Name</label>
              <input
                type="text"
                placeholder="e.g. Shooters / Team B"
                value={newGameForm.homeTeam}
                onChange={(e) => setNewGameForm((f) => ({ ...f, homeTeam: e.target.value }))}
                className="w-full rounded-md border border-[#2A2A2A] bg-[#1A1A1A] px-3 py-2 text-xs font-semibold text-[#F5F5F0] placeholder-[#555] focus:border-[#C9A84C] focus:outline-none"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowCreateGame(false)}
              className="rounded-lg bg-[#222222] px-3 py-2 text-xs font-semibold text-[#8A8A8A] hover:text-[#F5F5F0]"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={createGameMutation.isPending}
              onClick={() => createGameMutation.mutate()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#C9A84C] px-5 py-2 text-xs font-bold text-[#0A0A0A] hover:bg-[#E8C76A] transition-colors shadow-lg"
            >
              <Zap className="h-4 w-4 fill-current" />
              {createGameMutation.isPending ? 'Launching Game...' : '🚀 Launch Game & Start Scoring'}
            </button>
          </div>
        </div>
      )}

      {/* ── League & Existing Game Selector ────────────────────────────────────── */}
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
          <span className="text-xs font-semibold text-[#8A8A8A] uppercase tracking-wider">Active Game:</span>
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

          {activeGameId && (
            <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
              <AlertDialogTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md bg-red-950/40 border border-red-800/40 px-2.5 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-900/50 hover:text-red-200 transition-colors shrink-0"
                  title="Delete Selected Match & Scores"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete Match
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent className="bg-[#141414] border border-[#2A2A2A] text-[#F5F5F0]">
                <AlertDialogHeader>
                  <AlertDialogTitle className="text-base font-bold text-red-400 flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-red-500" />
                    Delete Match & Live Scores
                  </AlertDialogTitle>
                  <AlertDialogDescription className="text-xs text-[#8A8A8A] leading-relaxed">
                    Are you sure you want to permanently delete this game?
                    <br className="my-1" />
                    This action will purge the game record, overlay scorebug state, and any recorded player statistics.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter className="mt-4 gap-2">
                  <AlertDialogCancel className="bg-[#222] border-0 text-[#8A8A8A] hover:text-[#F5F5F0] hover:bg-[#2A2A2A] text-xs">
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    disabled={deleteGameMutation.isPending}
                    onClick={(e) => {
                      e.preventDefault();
                      if (activeGameId) deleteGameMutation.mutate(activeGameId);
                    }}
                    className="bg-red-600 hover:bg-red-700 text-white font-bold text-xs"
                  >
                    {deleteGameMutation.isPending ? (
                      <span className="flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" /> Deleting...
                      </span>
                    ) : (
                      'Confirm Delete'
                    )}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      {/* ── Live Scoreboard Display ───────────────────────────────────────────── */}
      {activeGameId ? (
        <div className="space-y-6">
          <LiveScoreboard
            gameId={activeGameId}
            homeTeamName={game?.home_team?.name ?? gamesList.find((g) => g.id === activeGameId)?.homeLabel ?? 'Home'}
            awayTeamName={game?.away_team?.name ?? gamesList.find((g) => g.id === activeGameId)?.awayLabel ?? 'Away'}
            homeTeamLogo={game?.home_team?.logo_url ?? null}
            awayTeamLogo={game?.away_team?.logo_url ?? null}
            initialScore={overlay}
            className="shadow-2xl"
          />

          {/* ── Integrated Courtside Quick Scoring Controls ───────────────────── */}
          <CourtsideQuickControls
            gameId={activeGameId}
            homeTeamName={game?.home_team?.name ?? gamesList.find((g) => g.id === activeGameId)?.homeLabel ?? 'Home'}
            awayTeamName={game?.away_team?.name ?? gamesList.find((g) => g.id === activeGameId)?.awayLabel ?? 'Away'}
            overlayState={overlay}
            onMutationSuccess={() => {
              overlayQuery.refetch();
            }}
          />

          {/* ── Individual Player Stats & Live Box Score ─────────────────────── */}
          <PlayerStatsTracker
            gameId={activeGameId}
            onStatChange={() => {
              overlayQuery.refetch();
            }}
          />
        </div>
      ) : (
        <div className="rounded-xl border border-[#222222] bg-[#111111] p-10 text-center text-[#8A8A8A]">
          <Activity className="h-10 w-10 mx-auto mb-3 text-[#8A8A8A]" />
          <h3 className="text-base font-bold text-[#F5F5F0]">No Game Selected</h3>
          <p className="text-xs mt-1 mb-4">Select an active game from the dropdown or launch a brand new game below.</p>
          <button
            type="button"
            onClick={() => setShowCreateGame(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#C9A84C] px-4 py-2 text-xs font-bold text-[#0A0A0A] hover:bg-[#E8C76A] transition-colors"
          >
            <Zap className="h-4 w-4 fill-current" />
            Launch New Game & Scoreboard
          </button>
        </div>
      )}
    </div>
  );
}
