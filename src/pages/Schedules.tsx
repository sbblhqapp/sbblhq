import { useApp } from '@/contexts/AppContext';
import { LEAGUE_REGISTRY, getLeagueConfig, getLeagueSeasonLabel } from '@/lib/leagues';
import { LeagueBadge } from '@/components/ui/LeagueBadge';
import type { LeagueId } from '@/types';
import { Calendar, MapPin, Clock, Sparkles, Layers, Shield } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { fetchPublicSchedule } from '@/lib/api/public';
import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

type ScheduleGame = {
  time: string;
  home: string;
  away: string;
  division?: string | null;
  status?: string;
};

type ScheduleCourt = {
  name: string;
  games: ScheduleGame[];
};

type PublicScheduleRow = {
  starts_at?: unknown;
  start_time?: unknown;
  league_id?: unknown;
  week?: unknown;
  venue?: unknown;
  address?: unknown;
  court?: unknown;
  court_name?: unknown;
  home_team_name?: unknown;
  home_team?: unknown;
  home_team_id?: unknown;
  away_team_name?: unknown;
  away_team?: unknown;
  away_team_id?: unknown;
  division_name?: unknown;
  status?: unknown;
};

type ScheduleDay = {
  leagueId: LeagueId;
  season: string;
  week: string;
  date: string;
  venue: string;
  address: string;
  courts: ScheduleCourt[];
};

function formatScheduleTime(input: string): string {
  // A date-only value ("2026-08-16") carries NO tip-off time: it comes from
  // games.game_date when the game has no linked schedule_slot. Rendering it as
  // "12:00 AM" invents a time the league never set and reads as a bug. Show
  // TBA — the same honest placeholder already used for venue and court.
  if (/^\d{4}-\d{2}-\d{2}$/.test(input.trim())) return 'TBA';
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return 'TBA';
  return parsed.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

const SchedulesPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const paramLeague = searchParams.get('league') as LeagueId | 'all' | null;
  const paramDivision = searchParams.get('division');
  const { activeLeague, setActiveLeague } = useApp();

  const isValidParam = paramLeague && (paramLeague === 'all' || LEAGUE_REGISTRY.some((l) => l.id === paramLeague));

  const [leagueFilter, setLeagueFilter] = useState<LeagueId | 'all'>(
    isValidParam
      ? (paramLeague as LeagueId | 'all')
      : (activeLeague || 'all')
  );

  const [divisionFilter, setDivisionFilter] = useState<string | 'all'>(
    paramDivision || 'all'
  );

  const { data: liveDataRes, isLoading, isError } = useQuery({
    queryKey: ['public-schedule', leagueFilter],
    queryFn: () => fetchPublicSchedule(leagueFilter),
    staleTime: 1000 * 60 * 5,
  });

  const liveSchedules = useMemo(() => (liveDataRes?.data || []) as PublicScheduleRow[], [liveDataRes?.data]);

  const handleLeagueFilterChange = (val: LeagueId | 'all') => {
    setLeagueFilter(val);
    setDivisionFilter('all');
    if (val !== 'all') setActiveLeague(val);
    setSearchParams({ league: val }, { replace: true });
  };

  const handleDivisionFilterChange = (div: string | 'all') => {
    setDivisionFilter(div);
    const newParams: Record<string, string> = { league: leagueFilter };
    if (div !== 'all') newParams.division = div;
    setSearchParams(newParams, { replace: true });
  };

  useEffect(() => {
    if (isValidParam) {
      setLeagueFilter(paramLeague as LeagueId | 'all');
    } else if (activeLeague) {
      setLeagueFilter(activeLeague);
    }
  }, [activeLeague, paramLeague, isValidParam]);

  // Extract available divisions from schedule games
  const availableDivisions = useMemo(() => {
    const set = new Set<string>();
    for (const row of liveSchedules) {
      if (typeof row.division_name === 'string' && row.division_name.trim().length > 0) {
        set.add(row.division_name.trim());
      }
    }
    return Array.from(set).sort();
  }, [liveSchedules]);

  // Group by league and date, then court
  const mappedLiveSchedules: ScheduleDay[] = useMemo(() => {
    if (!liveSchedules || liveSchedules.length === 0) return [];

    const groupedLive = liveSchedules.reduce<Record<string, Omit<ScheduleDay, 'courts'> & { courts: Record<string, ScheduleGame[]> }>>((acc, curr) => {
      const startsAt = typeof curr.starts_at === 'string' ? curr.starts_at : curr.start_time;
      if (typeof startsAt !== 'string' || startsAt.length === 0) return acc;
      const gameDate = startsAt.split('T')[0];
      const rawLeagueId = typeof curr.league_id === 'string' ? curr.league_id : 'sbbl';
      const key = `${rawLeagueId}-${gameDate}`;
      const divName = typeof curr.division_name === 'string' ? curr.division_name : null;

      // If division filter is active, skip non-matching games
      if (divisionFilter !== 'all' && divName !== divisionFilter) {
        return acc;
      }

      if (!acc[key]) {
        const leagueId = LEAGUE_REGISTRY.some((l) => l.id === rawLeagueId)
          ? (rawLeagueId as LeagueId)
          : 'sbbl';
        acc[key] = {
          leagueId,
          season: getLeagueSeasonLabel(leagueId),
          week: String(curr.week || '1'),
          date: gameDate,
          venue: typeof curr.venue === 'string' && curr.venue ? curr.venue : 'TBA',
          address: typeof curr.address === 'string' && curr.address ? curr.address : 'TBA',
          courts: {}
        };
      }
      const courtName = typeof curr.court === 'string' && curr.court
        ? curr.court
        : typeof curr.court_name === 'string' && curr.court_name
          ? curr.court_name
          : 'Main Court';
      if (!acc[key].courts[courtName]) acc[key].courts[courtName] = [];
      const label = (value: unknown) => (typeof value === 'string' && value.trim() ? value : null);
      acc[key].courts[courtName].push({
        time: formatScheduleTime(startsAt),
        home: label(curr.home_team_name) || label(curr.home_team) || label(curr.home_team_id) || 'TBA',
        away: label(curr.away_team_name) || label(curr.away_team) || label(curr.away_team_id) || 'TBA',
        division: divName,
        status: typeof curr.status === 'string' ? curr.status : 'upcoming',
      });
      return acc;
    }, {});

    return Object.values(groupedLive)
      .map((g) => ({
        ...g,
        courts: Object.entries(g.courts)
          .map(([name, games]) => ({ name, games }))
          .filter((c) => c.games.length > 0),
      }))
      .filter((day) => day.courts.length > 0);
  }, [liveSchedules, divisionFilter]);

  const displayData = mappedLiveSchedules;

  return (
    <div className="min-h-screen">
      <div className="container py-8 md:py-12 max-w-7xl">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-display text-3xl md:text-4xl font-bold tracking-tight text-foreground">
                Schedules & Fixtures
              </h1>
              {leagueFilter === 'sbbl' && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-bold uppercase tracking-wider border border-primary/20">
                  <Sparkles className="w-3 h-3" /> Season 12
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-1">Official league fixtures, division matchups, and court assignments.</p>
          </div>
          <div className="flex items-center gap-2 p-2 rounded-xl bg-card border border-border/40 text-muted-foreground text-xs font-medium">
            <Calendar className="w-4 h-4 text-primary" />
            <span>Opening Day: Aug 16, 2026</span>
          </div>
        </div>

        {/* Primary League Filter */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="flex gap-1.5 p-1 bg-secondary/80 rounded-xl border border-border/40 w-fit">
            <button
              onClick={() => handleLeagueFilterChange('all')}
              className={`px-3.5 py-1.5 text-xs font-bold uppercase tracking-wider rounded-lg transition-all min-h-[34px] ${
                leagueFilter === 'all'
                  ? 'bg-card text-foreground shadow-sm border border-border/60'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              All Leagues
            </button>
            {LEAGUE_REGISTRY.map((l) => (
              <button
                key={l.id}
                onClick={() => handleLeagueFilterChange(l.id)}
                className={`px-3.5 py-1.5 text-xs font-bold uppercase tracking-wider rounded-lg transition-all min-h-[34px] ${
                  leagueFilter === l.id
                    ? 'bg-card text-foreground shadow-sm border border-border/60'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {l.shortName}
              </button>
            ))}
          </div>
        </div>

        {/* Apple-Grade Segmented Division Filter (When available) */}
        {availableDivisions.length > 0 && (
          <div className="mb-6 flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none animate-in fade-in">
            <div className="flex items-center gap-1.5 p-1 bg-card/60 backdrop-blur-md rounded-xl border border-border/50">
              <span className="flex items-center gap-1 px-2.5 text-xs font-bold text-muted-foreground uppercase tracking-wider">
                <Layers className="w-3.5 h-3.5 text-primary" /> Division:
              </span>
              <button
                onClick={() => handleDivisionFilterChange('all')}
                className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${
                  divisionFilter === 'all'
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
                }`}
              >
                All Divisions
              </button>
              {availableDivisions.map((div) => (
                <button
                  key={div}
                  onClick={() => handleDivisionFilterChange(div)}
                  className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${
                    divisionFilter === div
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
                  }`}
                >
                  {div}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Loading Skeletons */}
        {isLoading && (
          <div className="space-y-4">
            {[1, 2].map((i) => (
              <div key={i} className="panel p-6 animate-pulse rounded-xl border border-border/30">
                <div className="h-5 w-48 bg-muted rounded mb-4" />
                <div className="space-y-2">
                  <div className="h-10 bg-muted/40 rounded" />
                  <div className="h-10 bg-muted/40 rounded" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Error State */}
        {isError && (
          <div className="panel p-8 text-center border-destructive/30 rounded-xl">
            <Calendar className="w-8 h-8 text-destructive/60 mx-auto mb-3" />
            <h2 className="font-display text-lg font-bold">Unable to load schedules</h2>
            <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
              Please refresh or try again after the live schedule service recovers.
            </p>
          </div>
        )}

        {/* Empty State */}
        {displayData.length === 0 && !isLoading && !isError && (
          <div className="panel p-12 text-center rounded-xl max-w-lg mx-auto border-border/40">
            <Calendar className="w-10 h-10 text-primary/40 mx-auto mb-3" />
            <h2 className="font-display text-lg font-bold">No games scheduled</h2>
            <p className="text-sm text-muted-foreground mt-1">
              No fixtures found for the selected division or league filter.
            </p>
          </div>
        )}

        {/* Schedule Day Cards */}
        <div className="space-y-8">
          {displayData.map((day) => (
            <ScheduleDayCard key={`${day.leagueId}-${day.date}`} day={day} />
          ))}
        </div>
      </div>
    </div>
  );
};

function ScheduleDayCard({ day }: { day: ScheduleDay }) {
  const league = getLeagueConfig(day.leagueId);
  const dateObj = new Date(day.date + 'T00:00:00');
  const formattedDate = dateObj.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div className="panel p-0 overflow-hidden rounded-2xl border border-border/50 bg-card shadow-sm">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border/60 bg-gradient-to-r from-card via-card/80 to-transparent">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3.5">
            <img
              src={league.logo}
              alt={league.logoAlt}
              width={36}
              height={36}
              className="flex-shrink-0 rounded-lg shadow-sm"
              style={{ aspectRatio: '1/1' }}
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
            <div>
              <div className="flex items-center gap-2">
                <LeagueBadge leagueId={day.leagueId} size="sm" />
                <span className="text-xs font-bold text-muted-foreground">{day.season} &middot; Week {day.week}</span>
              </div>
              <p className="font-display text-lg font-bold mt-0.5 text-foreground">{formattedDate}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium bg-secondary/50 px-3 py-1.5 rounded-lg w-fit border border-border/30">
            <MapPin className="w-3.5 h-3.5 text-primary flex-shrink-0" />
            <span>{day.venue}{day.address && day.address !== 'TBA' ? `, ${day.address}` : ''}</span>
          </div>
        </div>
      </div>

      {/* Courts */}
      <div className="divide-y divide-border/40">
        {day.courts.map((court) => (
          <div key={court.name} className="px-6 py-5">
            <div className="flex items-center gap-2 mb-3.5">
              <Shield className="w-3.5 h-3.5 text-primary" />
              <h3 className="font-display text-xs font-bold uppercase tracking-wider text-primary">
                {court.name}
              </h3>
              <span className="text-xs text-muted-foreground font-medium">
                ({court.games.length} Match{court.games.length === 1 ? '' : 'es'})
              </span>
            </div>

            <div className="grid gap-2 sm:grid-cols-1 lg:grid-cols-2">
              {court.games.map((game, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between gap-3 p-3 rounded-xl bg-secondary/30 hover:bg-secondary/60 border border-border/30 transition-all"
                >
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="flex items-center gap-1 text-xs font-bold tabular-nums text-foreground bg-card px-2.5 py-1 rounded-lg border border-border/50">
                      <Clock className="w-3 h-3 text-primary" />
                      {game.time}
                    </span>
                    {game.division && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-primary/10 text-primary border border-primary/20">
                        {game.division}
                      </span>
                    )}
                  </div>

                  <div className="flex-1 flex items-center justify-end gap-2 min-w-0 text-right">
                    <span className="text-xs sm:text-sm font-bold text-foreground truncate max-w-[110px] sm:max-w-[140px]">
                      {game.home}
                    </span>
                    <span className="text-[10px] font-extrabold text-primary px-1.5 py-0.5 rounded bg-primary/10 flex-shrink-0">
                      VS
                    </span>
                    <span className="text-xs sm:text-sm font-bold text-foreground truncate max-w-[110px] sm:max-w-[140px]">
                      {game.away}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default SchedulesPage;
