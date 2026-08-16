import { useQuery } from '@tanstack/react-query';
import { fetchTeams, type TeamCard } from '@/lib/api/teams';
import { useApp } from '@/contexts/AppContext';
import { LEAGUE_REGISTRY, getLeagueConfig } from '@/lib/leagues';
import { LeagueBadge } from '@/components/ui/LeagueBadge';
import type { LeagueId } from '@/types';
import { Users, Trophy, Briefcase, Activity, Sparkles, Layers } from 'lucide-react';
import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

type TabView = 'standings' | 'rosters' | 'stats';

const TeamsPage = () => {
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

  const [activeTab, setActiveTab] = useState<TabView>('standings');

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

  const teamsQuery = useQuery({
    queryKey: ['teams'],
    queryFn: () => fetchTeams(),
  });

  const leagueFilteredTeams = useMemo(() => {
    const apiTeams = teamsQuery.data?.teams;
    const list: TeamCard[] = Array.isArray(apiTeams) ? apiTeams : [];
    if (leagueFilter === 'all') return list;
    const code = getLeagueConfig(leagueFilter).code;
    return list.filter((t) => t.league_code.toLowerCase() === code.toLowerCase());
  }, [teamsQuery.data?.teams, leagueFilter]);

  // Extract all unique divisions available in the current league view
  const availableDivisions = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of leagueFilteredTeams) {
      const div = t.division_name?.trim();
      if (div) {
        map.set(div, (map.get(div) || 0) + 1);
      }
    }
    return Array.from(map.entries()).map(([name, count]) => ({ name, count }));
  }, [leagueFilteredTeams]);

  // Apply division filter if selected
  const filteredTeams = useMemo(() => {
    if (divisionFilter === 'all') return leagueFilteredTeams;
    return leagueFilteredTeams.filter((t) => t.division_name === divisionFilter);
  }, [leagueFilteredTeams, divisionFilter]);

  const standings = useMemo(() => {
    return [...filteredTeams].sort((a, b) => {
      const winPctA = Number.parseFloat(a.stats.winPct || '0');
      const winPctB = Number.parseFloat(b.stats.winPct || '0');
      if (winPctB !== winPctA) return winPctB - winPctA;
      if (b.stats.wins !== a.stats.wins) return b.stats.wins - a.stats.wins;
      return b.stats.diff - a.stats.diff;
    });
  }, [filteredTeams]);

  const statsLeaders = useMemo(() => {
    return [...filteredTeams]
      .filter((t) => t.stats && t.stats.gamesPlayed > 0)
      .sort((a, b) => b.stats.ptsFor - a.stats.ptsFor);
  }, [filteredTeams]);

  const defenseLeaders = useMemo(() => {
    return [...filteredTeams]
      .filter((t) => t.stats && t.stats.gamesPlayed > 0)
      .sort((a, b) => {
        const papgA = a.stats.ptsAgainst / a.stats.gamesPlayed;
        const papgB = b.stats.ptsAgainst / b.stats.gamesPlayed;
        return papgA - papgB;
      });
  }, [filteredTeams]);

  const handleAvatarError = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
    (e.target as HTMLImageElement).src = 'https://ui-avatars.com/api/?name=Player&background=random';
  };

  return (
    <div className="container py-8 max-w-7xl">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2">
          <h1 className="text-3xl font-bold font-display tracking-tight mb-1 text-foreground">
            Teams & Standings
          </h1>
          {leagueFilter === 'sbbl' && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-bold uppercase tracking-wider border border-primary/20">
              <Sparkles className="w-3 h-3" /> Season 12
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground">Official league rankings, division tiers, rosters, and statistics.</p>
      </div>

      {/* Primary League Filter & View Tabs */}
      <div className="flex flex-col md:flex-row gap-4 mb-4">
        <div className="flex items-center gap-1.5 p-1 bg-secondary/80 rounded-xl border border-border/40 flex-wrap w-fit">
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

        <div className="flex items-center gap-1.5 p-1 bg-secondary/80 rounded-xl border border-border/40 flex-wrap ml-auto">
          {[
            { id: 'standings', label: 'Standings', icon: Trophy },
            { id: 'rosters', label: 'Rosters', icon: Users },
            { id: 'stats', label: 'Stats', icon: Activity },
          ].map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as TabView)}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold uppercase tracking-wider rounded-lg transition-all min-h-[34px] ${
                  activeTab === tab.id
                    ? 'bg-card text-foreground shadow-sm border border-border/60'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Apple-Grade Segmented Division Bar (When divisions exist) */}
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
              All ({leagueFilteredTeams.length})
            </button>
            {availableDivisions.map((div) => (
              <button
                key={div.name}
                onClick={() => handleDivisionFilterChange(div.name)}
                className={`flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-lg transition-all ${
                  divisionFilter === div.name
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
                }`}
              >
                <span>{div.name}</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${divisionFilter === div.name ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                  {div.count}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Loading Skeletons */}
      {teamsQuery.isLoading && (
        <div className="space-y-2 max-w-4xl min-h-[480px]">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="panel p-3.5 flex items-center gap-4 animate-pulse rounded-xl border border-border/30">
              <div className="w-7 h-7 bg-muted/60 rounded-lg flex-shrink-0" />
              <div className="flex-1 space-y-2 min-w-0">
                <div className="h-4 w-48 bg-muted rounded" />
                <div className="h-3 w-28 bg-muted/40 rounded" />
              </div>
              <div className="w-24 h-4 bg-muted/50 rounded flex-shrink-0" />
            </div>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!teamsQuery.isLoading && filteredTeams.length === 0 && (
        <div className="panel p-12 text-center max-w-xl mx-auto border-border/40">
          <Trophy className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
          <h3 className="font-display text-lg font-bold">No teams found</h3>
          <p className="text-sm text-muted-foreground mt-1">
            No teams match the current league and division filters.
          </p>
        </div>
      )}

      {/* Standings View */}
      {!teamsQuery.isLoading && activeTab === 'standings' && filteredTeams.length > 0 && (
        <div className="space-y-2 max-w-4xl">
          {standings.map((team, index) => {
            const wins = team.stats?.wins ?? 0;
            const losses = team.stats?.losses ?? 0;
            const pct = Number.parseFloat(team.stats?.winPct ?? '0');
            const diff = team.stats?.diff ?? 0;
            const leagueLower = team.league_code.toLowerCase();
            const leagueId: LeagueId = LEAGUE_REGISTRY.some(l => l.id === leagueLower) ? (leagueLower as LeagueId) : 'sbbl';

            // Apple-grade podium badges
            const isFirst = index === 0;
            const isSecond = index === 1;
            const isThird = index === 2;

            return (
              <div
                key={team.id}
                className={`panel p-3.5 flex items-center gap-3.5 rounded-xl transition-all hover:border-primary/40 hover:bg-card/90 ${
                  isFirst
                    ? 'border-primary/40 bg-gradient-to-r from-primary/5 via-card to-card shadow-sm'
                    : isSecond
                    ? 'border-border/60 bg-card/80'
                    : isThird
                    ? 'border-border/50 bg-card/70'
                    : 'border-border/30 bg-card/50'
                }`}
              >
                {/* Rank indicator */}
                <div className="flex-shrink-0 w-7 text-center">
                  {isFirst ? (
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-amber-500/20 text-amber-400 font-extrabold text-xs border border-amber-500/30">
                      1
                    </span>
                  ) : isSecond ? (
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-slate-300/15 text-slate-300 font-bold text-xs border border-slate-300/20">
                      2
                    </span>
                  ) : isThird ? (
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-amber-700/20 text-amber-600 font-bold text-xs border border-amber-700/30">
                      3
                    </span>
                  ) : (
                    <span className="stat-numeral text-xs text-muted-foreground font-semibold">
                      {index + 1}
                    </span>
                  )}
                </div>

                {/* Team Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-display font-bold text-sm sm:text-base text-foreground truncate">{team.name}</p>
                    {team.division_name && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-primary/10 text-primary border border-primary/20 flex-shrink-0">
                        {team.division_name}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <LeagueBadge leagueId={leagueId} size="sm" />
                    {team.season_name && (
                      <span className="text-[10px] text-muted-foreground truncate">{team.season_name}</span>
                    )}
                  </div>
                </div>

                {/* Win% Progress Bar */}
                <div className="hidden sm:block w-24">
                  <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${pct * 100}%` }} />
                  </div>
                </div>

                {/* Record Figures */}
                <div className="flex items-center gap-3 flex-shrink-0 text-right">
                  <span className="stat-numeral text-xs sm:text-sm text-emerald-400 font-bold">{wins}W</span>
                  <span className="stat-numeral text-xs sm:text-sm text-rose-400 font-bold">{losses}L</span>
                  <span className={`stat-numeral text-xs sm:text-sm font-bold w-12 text-right ${diff > 0 ? 'text-emerald-400' : diff < 0 ? 'text-rose-400' : 'text-muted-foreground'}`}>
                    {(pct * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Rosters View */}
      {!teamsQuery.isLoading && activeTab === 'rosters' && filteredTeams.length > 0 && (
        <div className="space-y-6">
          {filteredTeams.map((team) => (
            <div key={team.id} className="rounded-xl border border-border/40 bg-card p-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <div className="flex items-center gap-2.5">
                  <h3 className="text-lg font-bold font-display">{team.name}</h3>
                  {team.division_name && (
                    <span className="px-2 py-0.5 rounded text-xs font-bold bg-primary/10 text-primary border border-primary/20">
                      {team.division_name}
                    </span>
                  )}
                  {leagueFilter === 'all' && (
                    <LeagueBadge leagueId={team.league_code.toLowerCase() as LeagueId} size="sm" />
                  )}
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground font-medium">
                  <div className="flex items-center gap-1.5">
                    <Users className="w-4 h-4 text-primary" />
                    {team.roster_count} Players
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Briefcase className="w-4 h-4 text-muted-foreground" />
                    {team.coaches?.length || 0} Staff
                  </div>
                </div>
              </div>

              {/* Staff */}
              {(team.coaches?.length || 0) > 0 && (
                <div className="mb-6">
                  <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5">Coaching Staff</h4>
                  <div className="grid gap-2.5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                    {team.coaches.map((coach) => (
                      <div key={coach.id} className="flex items-center gap-2.5 p-2 rounded-lg border border-border/30 bg-secondary/30">
                        {coach.avatar_url ? (
                          <img
                            src={coach.avatar_url}
                            alt="avatar"
                            className="w-9 h-9 rounded-full object-cover"
                            onError={handleAvatarError}
                          />
                        ) : (
                          <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center">
                            <Briefcase className="w-4 h-4 text-muted-foreground" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold truncate">
                            {coach.first_name || coach.last_name
                              ? `${coach.first_name || ''} ${coach.last_name || ''}`.trim()
                              : 'Coach'}
                          </div>
                          <div className="text-[11px] text-muted-foreground capitalize">
                            {coach.role === 'team_manager' ? 'Manager' : coach.role}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Roster */}
              <div>
                <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5">Active Roster</h4>
                {team.players && team.players.length > 0 ? (
                  <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                    {team.players.map((player) => (
                      <div key={player.id} className="flex items-center gap-2.5 p-2.5 rounded-lg border border-border/30 bg-secondary/20 hover:bg-secondary/40 transition-colors">
                        <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-secondary border border-border/50 flex items-center justify-center font-bold text-xs text-primary">
                          {player.jersey_number != null ? `#${player.jersey_number}` : '—'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold truncate">
                            {player.first_name || player.last_name
                              ? `${player.first_name || ''} ${player.last_name || ''}`.trim()
                              : 'Player'}
                          </div>
                          <div className="text-[11px] text-muted-foreground">{player.position || 'Player'}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground py-3 text-center border border-dashed border-border/30 rounded-lg">
                    No players registered on official roster.
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Stats View */}
      {!teamsQuery.isLoading && activeTab === 'stats' && filteredTeams.length > 0 && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-border/40 bg-card p-6 shadow-sm">
            <h3 className="text-base font-bold font-display mb-4 flex items-center gap-2">
              <Trophy className="w-4 h-4 text-amber-400" /> Highest Scoring Offense (PPG)
            </h3>
            <div className="space-y-2">
              {statsLeaders.slice(0, 10).map((team, index) => {
                const ppg =
                  team.stats.gamesPlayed > 0 ? (team.stats.ptsFor / team.stats.gamesPlayed).toFixed(1) : '0.0';
                return (
                  <div
                    key={team.id}
                    className="flex items-center gap-3 p-2.5 rounded-lg border border-border/30 hover:bg-muted/20 transition-colors"
                  >
                    <div className="flex-shrink-0 w-7 h-7 rounded-md bg-secondary flex items-center justify-center font-bold text-xs">
                      {index + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm truncate">{team.name}</div>
                      <div className="text-[11px] text-muted-foreground">{team.stats.gamesPlayed} GP &middot; {team.division_name || team.league_code}</div>
                    </div>
                    <div className="text-base font-bold font-display text-primary">{ppg}</div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border border-border/40 bg-card p-6 shadow-sm">
            <h3 className="text-base font-bold font-display mb-4 flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-400" /> Best Defense (PAPG)
            </h3>
            <div className="space-y-2">
              {defenseLeaders
                .slice(0, 10)
                .map((team, index) => {
                  const papg =
                    team.stats.gamesPlayed > 0 ? (team.stats.ptsAgainst / team.stats.gamesPlayed).toFixed(1) : '0.0';
                  return (
                    <div
                      key={team.id}
                      className="flex items-center gap-3 p-2.5 rounded-lg border border-border/30 hover:bg-muted/20 transition-colors"
                    >
                      <div className="flex-shrink-0 w-7 h-7 rounded-md bg-secondary flex items-center justify-center font-bold text-xs">
                        {index + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm truncate">{team.name}</div>
                        <div className="text-[11px] text-muted-foreground">{team.stats.gamesPlayed} GP &middot; {team.division_name || team.league_code}</div>
                      </div>
                      <div className="text-base font-bold font-display text-emerald-400">{papg}</div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TeamsPage;
