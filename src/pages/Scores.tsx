import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApp } from '@/contexts/AppContext';
import { useAuth } from '@/hooks/use-auth';
import { LEAGUE_REGISTRY, getLeagueConfig } from '@/lib/leagues';
import { LeagueBadge } from '@/components/ui/LeagueBadge';
import type { LeagueId, ScoreCategory, ScoreEntry } from '@/types';
import { useState, useMemo, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Trophy, Users, Star, Calendar, Trash2, AlertTriangle, Loader2 } from 'lucide-react';
import { fetchScores, deleteGame } from '@/lib/api/scores';
import { toast } from 'sonner';
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

// ── Category config ────────────────────────────────────────────────────────
const CATEGORIES: Array<{ id: ScoreCategory | 'all'; label: string; icon: typeof Trophy }> = [
  { id: 'all',           label: 'All',            icon: Trophy },
  { id: 'league',        label: 'League',         icon: Trophy },
  { id: '1v1',           label: '1-on-1',         icon: Users  },
  { id: 'special_event', label: 'Special Events', icon: Star   },
];

const STATUS_FILTERS = [
  { id: 'all',      label: 'All'      },
  { id: 'recent',   label: 'Recent'   },
  { id: 'upcoming', label: 'Upcoming' },
] as const;

// ── Helpers ────────────────────────────────────────────────────────────────
function statusLabel(status: string): string {
  if (status === 'live')     return 'Live';
  if (status === 'final')    return 'Final';
  if (status === 'upcoming' || status === 'scheduled') return 'Upcoming';
  if (status === 'postponed') return 'Postponed';
  return status;
}

function statusColor(status: string): string {
  if (status === 'live')      return 'text-red-400 bg-red-500/15';
  if (status === 'final')     return 'text-green-400 bg-green-500/10';
  if (status === 'postponed') return 'text-yellow-400 bg-yellow-500/10';
  return 'text-muted-foreground bg-secondary';
}

function winnerSide(entry: ScoreEntry): 'home' | 'away' | null {
  if (entry.status !== 'final') return null;
  if (entry.homeScore == null || entry.awayScore == null) return null;
  if (entry.homeScore > entry.awayScore) return 'home';
  if (entry.awayScore > entry.homeScore) return 'away';
  return null;
}

// ── Admin Delete Game Button ───────────────────────────────────────────────
function DeleteGameButton({ entry }: { readonly entry: ScoreEntry }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: () => deleteGame(entry.id),
    onSuccess: async (res) => {
      if (res.ok) {
        toast.success(`Match "${entry.awayLabel} vs ${entry.homeLabel}" deleted.`);
        setOpen(false);
        await queryClient.invalidateQueries({ queryKey: ['scores'] });
        await queryClient.invalidateQueries({ queryKey: ['ops', 'scoreboard-games'] });
        await queryClient.invalidateQueries({ queryKey: ['overlay'] });
      } else {
        toast.error('Failed to delete game');
      }
    },
    onError: (err) => {
      toast.error((err as Error).message || 'Failed to delete game');
    },
  });

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <button
          type="button"
          aria-label={`Delete game ${entry.awayLabel} vs ${entry.homeLabel}`}
          className="inline-flex items-center justify-center p-1 text-muted-foreground/60 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
          title="Delete Match & Scores"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent className="bg-[#141414] border border-[#2A2A2A] text-[#F5F5F0]">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-base font-bold text-red-400 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-500" />
            Delete Match & Live Scores
          </AlertDialogTitle>
          <AlertDialogDescription className="text-xs text-[#8A8A8A] leading-relaxed">
            Are you sure you want to permanently remove <span className="font-semibold text-[#F5F5F0]">{entry.awayLabel} vs {entry.homeLabel}</span>?
            <br className="my-1" />
            This action deletes the match record, scorebug clock state, and any recorded individual box scores.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="mt-4 gap-2">
          <AlertDialogCancel className="bg-[#222] border-0 text-[#8A8A8A] hover:text-[#F5F5F0] hover:bg-[#2A2A2A] text-xs">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={deleteMutation.isPending}
            onClick={(e) => {
              e.preventDefault();
              deleteMutation.mutate();
            }}
            className="bg-red-600 hover:bg-red-700 text-white font-bold text-xs"
          >
            {deleteMutation.isPending ? (
              <span className="flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" /> Deleting...
              </span>
            ) : (
              'Delete Game'
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ── Game card ──────────────────────────────────────────────────────────────
function ScoreCard({ entry }: { readonly entry: ScoreEntry }) {
  const winner = winnerSide(entry);
  const hasScore = entry.homeScore != null && entry.awayScore != null;
  const leagueId = entry.leagueId;
  const { isAdmin } = useApp();
  const { roles } = useAuth();
  const isScoreAdmin = isAdmin || roles.some((r) => ['super_admin', 'league_admin', 'scorekeeper', 'team_manager'].includes(r));

  return (
    <div className="panel p-0 overflow-hidden flex flex-col">
      {/* Card header */}
      <div className="px-4 pt-3 pb-2 border-b border-border/40 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {entry.category === 'league' && leagueId && (
            <LeagueBadge leagueId={leagueId} size="sm" />
          )}
          {entry.category === '1v1' && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-purple-500/15 text-purple-400 text-[10px] font-bold uppercase tracking-wider">
              <Users className="w-2.5 h-2.5" /> 1v1
            </span>
          )}
          {entry.category === 'special_event' && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-amber-500/15 text-amber-400 text-[10px] font-bold uppercase tracking-wider">
              <Star className="w-2.5 h-2.5" /> Event
            </span>
          )}
          {entry.eventName ? (
            <span className="text-[10px] text-muted-foreground truncate">{entry.eventName}</span>
          ) : entry.seasonName ? (
            <span className="text-[10px] text-muted-foreground truncate">{entry.seasonName}</span>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`flex-shrink-0 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-sm ${statusColor(entry.status)}`}>
            {statusLabel(entry.status)}
            {entry.status === 'live' && <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse align-middle" />}
          </span>
          {isScoreAdmin && <DeleteGameButton entry={entry} />}
        </div>
      </div>

      {/* Score body */}
      <div className="px-4 py-3 flex-1 space-y-2">
        {/* Away row */}
        <div className="flex items-center justify-between gap-2">
          <span className={`font-display font-bold text-sm truncate ${winner === 'away' ? 'text-foreground font-extrabold' : 'text-muted-foreground'}`}>
            {entry.awayLabel}
          </span>
          <span className={`stat-numeral text-xl flex-shrink-0 w-8 text-right ${hasScore ? (winner === 'away' ? 'text-foreground font-bold' : 'text-muted-foreground') : 'text-muted-foreground/40'}`}>
            {hasScore ? entry.awayScore : '—'}
          </span>
        </div>
        {/* Home row */}
        <div className="flex items-center justify-between gap-2">
          <span className={`font-display font-bold text-sm truncate ${winner === 'home' ? 'text-foreground font-extrabold' : 'text-muted-foreground'}`}>
            {entry.homeLabel}
          </span>
          <span className={`stat-numeral text-xl flex-shrink-0 w-8 text-right ${hasScore ? (winner === 'home' ? 'text-foreground font-bold' : 'text-muted-foreground') : 'text-muted-foreground/40'}`}>
            {hasScore ? entry.homeScore : '—'}
          </span>
        </div>
      </div>

      {/* Card footer */}
      {(entry.gameDate || entry.notes) && (
        <div className="px-4 pb-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/30 pt-2">
          {entry.gameDate && (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Calendar className="w-3 h-3" />
              {new Date(entry.gameDate).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}
            </span>
          )}
          {entry.notes && (
            <span className="text-[10px] text-muted-foreground/70 italic truncate w-full">{entry.notes}</span>
          )}
        </div>
      )}
      <Link
        to={`/scorekeeper/${entry.id}`}
        className="px-4 py-2 bg-secondary text-foreground text-center text-xs font-bold uppercase hover:bg-primary hover:text-primary-foreground transition-colors border-t border-border/40"
      >
        Open Scorekeeper
      </Link>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────
const ScoresPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { activeLeague, setActiveLeague } = useApp();

  const paramLeague   = searchParams.get('league')   as LeagueId | 'all' | null;
  const paramCategory = searchParams.get('category') as ScoreCategory | 'all' | null;

  const isValidLeague = paramLeague && (paramLeague === 'all' || LEAGUE_REGISTRY.some((l) => l.id === paramLeague));
  const isValidCat    = paramCategory && CATEGORIES.some((c) => c.id === paramCategory);

  const [category,     setCategory]     = useState<ScoreCategory | 'all'>(isValidCat    ? paramCategory! : 'all');
  const [leagueFilter, setLeagueFilter] = useState<LeagueId | 'all'>(isValidLeague ? paramLeague! : activeLeague || 'all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'recent' | 'upcoming'>('all');

  useEffect(() => {
    if (isValidCat)    setCategory(paramCategory! as ScoreCategory | 'all');
    if (isValidLeague) setLeagueFilter(paramLeague! as LeagueId | 'all');
    else if (activeLeague) setLeagueFilter(activeLeague);
  }, [activeLeague, paramCategory, paramLeague, isValidCat, isValidLeague]);

  const updateFilters = (cat: ScoreCategory | 'all', league: LeagueId | 'all') => {
    const sp: Record<string, string> = { category: cat };
    if (league !== 'all') sp.league = league;
    setSearchParams(sp, { replace: true });
  };

  const handleCategoryChange = (val: ScoreCategory | 'all') => {
    setCategory(val);
    updateFilters(val, leagueFilter);
  };

  const handleLeagueChange = (val: LeagueId | 'all') => {
    setLeagueFilter(val);
    if (val !== 'all') setActiveLeague(val);
    updateFilters(category, val);
  };

  const scoresQuery = useQuery({
    queryKey: ['scores', category, leagueFilter, statusFilter],
    queryFn: () => fetchScores({
      category: category === 'all' ? undefined : category,
      league:   leagueFilter === 'all' ? undefined : leagueFilter,
      status:   statusFilter === 'all' ? undefined : statusFilter,
    }),
    staleTime: 60_000,
  });

  const games = useMemo<ScoreEntry[]>(() => {
    const apiGames = scoresQuery.data?.games;
    if (Array.isArray(apiGames)) return apiGames;
    return [];
  }, [scoresQuery.data?.games]);

  // Group by category when viewing "All"
  const grouped = useMemo(() => {
    if (category !== 'all') return { [category]: games } as Record<string, ScoreEntry[]>;
    return games.reduce<Record<string, ScoreEntry[]>>((acc, g) => {
      (acc[g.category] ??= []).push(g);
      return acc;
    }, {});
  }, [games, category]);

  const hasGames = games.length > 0;

  const sectionLabel: Record<string, string> = {
    league:        'League Games',
    '1v1':         '1-on-1',
    special_event: 'Special Events',
  };

  return (
    <div className="container py-8 max-w-7xl">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-1">Scores</h1>
        <p className="text-muted-foreground text-sm">League games, 1-on-1 matchups, and special events.</p>
      </div>

      {/* ── Filter bar ───────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3 mb-6">
        {/* Category */}
        <div className="flex bg-secondary p-1 rounded-sm">
          {CATEGORIES.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => handleCategoryChange(id as ScoreCategory | 'all')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider rounded-sm transition-colors ${
                category === id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="w-3 h-3" />
              {label}
            </button>
          ))}
        </div>

        {/* League filter — shown when category includes league games */}
        {(category === 'all' || category === 'league') && (
          <div className="flex bg-secondary p-1 rounded-sm">
            <button
              onClick={() => handleLeagueChange('all')}
              className={`px-3 py-1.5 text-xs font-semibold uppercase tracking-wider rounded-sm transition-colors ${
                leagueFilter === 'all' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              All
            </button>
            {LEAGUE_REGISTRY.map((l) => (
              <button
                key={l.id}
                onClick={() => handleLeagueChange(l.id)}
                className={`px-3 py-1.5 text-xs font-semibold uppercase tracking-wider rounded-sm transition-colors ${
                  leagueFilter === l.id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {l.shortName}
              </button>
            ))}
          </div>
        )}

        {/* Status filter */}
        <div className="flex bg-secondary p-1 rounded-sm ml-auto">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s.id}
              onClick={() => setStatusFilter(s.id)}
              className={`px-3 py-1.5 text-xs font-semibold uppercase tracking-wider rounded-sm transition-colors ${
                statusFilter === s.id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Loading ──────────────────────────────────────────────────── */}
      {scoresQuery.isLoading && (
        <div className="py-20 text-center">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-muted-foreground">Loading scores…</p>
        </div>
      )}

      {/* ── Empty state ──────────────────────────────────────────────── */}
      {!scoresQuery.isLoading && !hasGames && (
        <div className="panel p-12 text-center">
          <Trophy className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
          <p className="text-lg font-semibold mb-1">No scores found</p>
          <p className="text-sm text-muted-foreground">
            {category !== 'all'
              ? `No ${sectionLabel[category] ?? category} results match the current filters.`
              : leagueFilter !== 'all'
              ? `No results for ${getLeagueConfig(leagueFilter as LeagueId)?.name ?? leagueFilter} yet.`
              : 'Check back after games have been played.'}
          </p>
        </div>
      )}

      {/* ── Game grid ────────────────────────────────────────────────── */}
      {!scoresQuery.isLoading && hasGames && (
        <div className="space-y-8">
          {(Object.entries(grouped) as [string, ScoreEntry[]][]).map(([cat, entries]) => (
            <section key={cat}>
              {/* Section header only shown in "All" view */}
              {category === 'all' && (
                <div className="flex items-center gap-3 mb-4">
                  <h2 className="font-display font-bold text-base uppercase tracking-wider text-foreground">
                    {sectionLabel[cat] ?? cat}
                  </h2>
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-xs text-muted-foreground">{entries.length} game{entries.length !== 1 ? 's' : ''}</span>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {entries.map((entry) => (
                  <ScoreCard key={entry.id} entry={entry} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
};

export default ScoresPage;
