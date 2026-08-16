import { FormEvent, useState, useMemo } from 'react';
import { Navigate, useNavigate, useLocation } from 'react-router-dom';
import { saveOnboarding } from '@/lib/api/auth';
import { useAuth } from '@/hooks/use-auth';
import { getSupabaseClient } from '@/lib/supabase/client';
import { LEAGUE_REGISTRY } from '@/lib/leagues';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import { UserCheck, UserPlus, Check, ChevronDown } from 'lucide-react';

type RoleIntent = 'fan' | 'player' | 'coach';

const ROLE_OPTIONS: { value: RoleIntent; label: string; description: string }[] = [
  {
    value: 'fan',
    label: 'Fan',
    description: 'Follow games, watch streams, and engage with the league.',
  },
  {
    value: 'player',
    label: 'Player',
    description: 'Register as a player. Includes stats, leaderboard, player profile, highlight downloads, and a 10% store discount.',
  },
  {
    value: 'coach',
    label: 'Coach — Free, pending approval',
    description: 'Request coach access. A league admin will review and approve your request.',
  },
];

type LeagueOption = {
  id: string;
  name: string;
  code: string;
};

type TeamOption = {
  id: string;
  name: string;
  division_id: string | null;
  division_name: string | null;
};

type UnclaimedPlayer = {
  id: string;
  display_name: string;
  jersey_number: number | null;
};

const OnboardingPage = () => {
  const { user, isSignedIn, isAdmin, needsOnboarding, loading, refresh } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const urlParams = new URLSearchParams(location.search);
  const intentParam = urlParams.get('intent');
  const redirectTarget = urlParams.get('redirect') ?? '/live';

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coachSubmitted, setCoachSubmitted] = useState(false);

  const [form, setForm] = useState({
    displayName: '',
    fullName: '',
    primaryRoleIntent: (intentParam === 'fan' ? 'fan' : 'fan') as RoleIntent,
    preferredLeague: 'SBBL',
    bio: '',
    avatarFile: null as File | null,
  });

  // Phase 4 Player Self-Service Registration State
  const [selectedTeamId, setSelectedTeamId] = useState<string>('');
  const [claimMode, setClaimMode] = useState<'claim' | 'new'>('new');
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [jerseyNumber, setJerseyNumber] = useState<string>('');

  // 1. Sourced leagues from Worker API (backed by leagues table)
  const leaguesQuery = useQuery({
    queryKey: ['public-leagues'],
    queryFn: () => apiFetch<{ ok: boolean; data: LeagueOption[] }>('/api/public/leagues'),
    staleTime: 5 * 60_000,
  });

  const leaguesList = useMemo<LeagueOption[]>(() => {
    if (leaguesQuery.data?.data && leaguesQuery.data.data.length > 0) {
      return leaguesQuery.data.data;
    }
    return LEAGUE_REGISTRY.map((l) => ({ id: l.id, name: l.name, code: l.code }));
  }, [leaguesQuery.data]);

  // 2. Sourced teams by selected league
  const teamsQuery = useQuery({
    queryKey: ['public-teams-by-league', form.preferredLeague],
    queryFn: () =>
      apiFetch<{ ok: boolean; data: TeamOption[] }>(
        `/api/public/teams-by-league?league_id=${form.preferredLeague}`,
      ),
    enabled: form.primaryRoleIntent === 'player' && !!form.preferredLeague,
    staleTime: 2 * 60_000,
  });

  const teams = useMemo<TeamOption[]>(() => teamsQuery.data?.data ?? [], [teamsQuery.data]);

  // Group teams by division for structured presentation
  const teamsByDivision = useMemo(() => {
    const groups: Record<string, TeamOption[]> = {};
    for (const team of teams) {
      const div = team.division_name || 'All Teams';
      if (!groups[div]) groups[div] = [];
      groups[div].push(team);
    }
    return groups;
  }, [teams]);

  // 3. Sourced unclaimed players for the selected team
  const unclaimedQuery = useQuery({
    queryKey: ['public-unclaimed-players', selectedTeamId],
    queryFn: () =>
      apiFetch<{ ok: boolean; data: UnclaimedPlayer[] }>(
        `/api/public/unclaimed-players?team_id=${selectedTeamId}`,
      ),
    enabled: form.primaryRoleIntent === 'player' && !!selectedTeamId,
    staleTime: 30_000,
  });

  const unclaimedPlayers = useMemo<UnclaimedPlayer[]>(
    () => unclaimedQuery.data?.data ?? [],
    [unclaimedQuery.data],
  );

  if (loading) return <div className="container py-10 text-sm text-muted-foreground">Loading…</div>;

  if (!isSignedIn || !user) {
    const onboardingQs = new URLSearchParams();
    if (intentParam) onboardingQs.set('intent', intentParam);
    onboardingQs.set('redirect', redirectTarget);
    return <Navigate to={`/login?redirect=${encodeURIComponent(`/onboarding?${onboardingQs.toString()}`)}`} replace />;
  }

  if (!needsOnboarding) return <Navigate to={isAdmin ? '/ops' : redirectTarget} replace />;

  const isFan = form.primaryRoleIntent === 'fan';
  const isPlayer = form.primaryRoleIntent === 'player';

  if (coachSubmitted) {
    return (
      <div className="container max-w-lg py-16 text-center">
        <div className="panel p-8">
          <h1 className="font-display text-2xl text-primary mb-3">Coach Request Submitted</h1>
          <p className="text-muted-foreground text-sm">
            Your account is active. A league admin will review your coach request shortly.
            You will be notified once approved.
          </p>
          <button
            onClick={() => navigate('/')}
            className="mt-6 gold-bg px-6 py-2 rounded-sm font-semibold text-sm"
          >
            Continue to App
          </button>
        </div>
      </div>
    );
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();

    if (isFan) {
      if (!form.displayName.trim()) {
        setError('Display name is required.');
        return;
      }
    } else {
      if (!form.displayName.trim() || !form.fullName.trim()) {
        setError('Display name and full name are required.');
        return;
      }
      if (isPlayer) {
        if (!selectedTeamId) {
          setError('Please select your team.');
          return;
        }
        if (claimMode === 'claim' && !selectedPlayerId) {
          setError('Please select which player you are claiming, or choose to add yourself as a new player.');
          return;
        }
      }
    }

    try {
      setError(null);
      setSubmitting(true);

      if (isFan) {
        const supabase = getSupabaseClient();
        if (!supabase) throw new Error('Supabase client unavailable');

        const payload = {
          p_display_name: form.displayName.trim(),
          p_full_name: form.fullName.trim() || null,
          p_preferred_league: form.preferredLeague || null,
        };

        const { data, error: rpcError } = await supabase.rpc('complete_fan_onboarding', payload);

        if (rpcError) {
          const rpcMessage = rpcError.message.toLowerCase();
          const rpcCode = (rpcError as { code?: string }).code;
          const isMissingRpc =
            rpcCode === '42883' ||
            rpcMessage.includes('could not find the function') ||
            rpcMessage.includes('schema cache');
          if (isMissingRpc) {
            const { error: profileError } = await supabase.from('profiles').upsert(
              {
                user_id: user.id,
                display_name: payload.p_display_name,
                full_name: payload.p_full_name,
                preferred_league: payload.p_preferred_league,
                primary_role_intent: 'fan',
                onboarding_completed_at: new Date().toISOString(),
              },
              { onConflict: 'user_id' },
            );
            if (profileError) throw new Error(profileError.message);
          } else {
            throw new Error(rpcError.message);
          }
        } else {
          const result = data as { ok: boolean; error?: string } | null;
          if (!result?.ok) {
            throw new Error(result?.error ?? 'onboarding_failed');
          }
        }

        await refresh();
        navigate(isAdmin ? '/ops' : redirectTarget);
      } else {
        // Phase 4: If Player, first link to team / claim roster identity
        if (isPlayer) {
          try {
            await apiFetch<{ ok: boolean; data?: unknown }>('/api/player/claim-or-join-team', {
              method: 'POST',
              body: JSON.stringify({
                teamId: selectedTeamId,
                leagueId: form.preferredLeague,
                mode: claimMode,
                existingPlayerId: claimMode === 'claim' ? selectedPlayerId : undefined,
                displayName: form.displayName.trim(),
                jerseyNumber: jerseyNumber ? parseInt(jerseyNumber, 10) : undefined,
              }),
            });
          } catch (claimErr) {
            const claimMsg = claimErr instanceof Error ? claimErr.message : 'Player claim failed';
            if (claimMsg.includes('already_claimed')) {
              setError('Someone just claimed that player record — please pick another or add yourself as new.');
              setSubmitting(false);
              return;
            }
            throw claimErr;
          }
        }

        // Complete standard profile saveOnboarding()
        await saveOnboarding({
          userId: user.id,
          displayName: form.displayName,
          fullName: form.fullName,
          primaryRoleIntent: form.primaryRoleIntent,
          preferredLeague: form.preferredLeague,
          bio: form.bio,
          avatarFile: form.avatarFile,
        });
        await refresh();

        if (form.primaryRoleIntent === 'coach') {
          setCoachSubmitted(true);
        } else if (form.primaryRoleIntent === 'player') {
          navigate('/billing?checkout=1');
        } else {
          navigate(isAdmin ? '/ops' : redirectTarget);
        }
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Onboarding failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="container max-w-2xl py-10">
      <div className="panel p-6">
        <h1 className="font-display text-3xl text-primary mb-2">Welcome — let&apos;s set up your account</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Fill in your details to get started. You can update them later in Settings.
        </p>
        <form className="grid gap-4" onSubmit={onSubmit}>
          <div>
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Display name <span className="text-destructive">*</span>
            </label>
            <input
              className="mt-1 w-full bg-secondary border border-border rounded-sm px-3 py-2 text-sm"
              placeholder="How you appear in the app"
              value={form.displayName}
              onChange={(e) => setForm((p) => ({ ...p, displayName: e.target.value }))}
            />
          </div>

          <div>
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Full name{' '}
              {isFan ? (
                <span className="text-muted-foreground/60">(optional)</span>
              ) : (
                <span className="text-destructive">*</span>
              )}
            </label>
            <input
              className="mt-1 w-full bg-secondary border border-border rounded-sm px-3 py-2 text-sm"
              placeholder={isFan ? 'Your name (optional)' : 'Your legal name (for league records)'}
              value={form.fullName}
              onChange={(e) => setForm((p) => ({ ...p, fullName: e.target.value }))}
            />
          </div>

          {/* Role Intent Picker */}
          <div>
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2 block">
              I am joining as…
            </label>
            <div className="grid gap-2">
              {ROLE_OPTIONS.map((opt) => (
                <div
                  key={opt.value}
                  onClick={() => setForm((p) => ({ ...p, primaryRoleIntent: opt.value }))}
                  className={`p-3 rounded-sm border cursor-pointer transition-colors ${
                    form.primaryRoleIntent === opt.value
                      ? 'border-primary/60 bg-primary/5'
                      : 'border-border bg-secondary/50 hover:border-border/80'
                  }`}
                >
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="radio"
                      name="roleIntent"
                      value={opt.value}
                      checked={form.primaryRoleIntent === opt.value}
                      onChange={() => setForm((p) => ({ ...p, primaryRoleIntent: opt.value }))}
                      className="mt-0.5 accent-primary"
                    />
                    <div className="flex-1">
                      <div className="text-sm font-semibold">{opt.label}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{opt.description}</div>
                    </div>
                  </label>

                  {/* Section 3a.4: Decouple pricing display into expandable disclosure */}
                  {opt.value === 'player' && (
                    <details
                      className="mt-2.5 text-xs text-muted-foreground border-t border-border/40 pt-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <summary className="font-semibold text-primary hover:text-primary/80 cursor-pointer select-none flex items-center gap-1.5">
                        <ChevronDown className="w-3.5 h-3.5 inline" /> What&apos;s included ($6.99 CAD/month + GST)
                      </summary>
                      <ul className="list-disc list-inside mt-2 space-y-1 text-[11px] text-muted-foreground pl-1 leading-relaxed">
                        <li>Player profile & verified career box score stats across all games</li>
                        <li>Live box score recognition & season leaderboard rankings</li>
                        <li>High-definition highlight clip downloads & MVP awards eligibility</li>
                        <li>10% discount across the official SBBL merchandise store</li>
                        <li>Billed monthly. Cancel anytime directly in Settings.</li>
                      </ul>
                    </details>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* League Selector */}
          <div>
            <label
              htmlFor="league-select"
              className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
            >
              {isPlayer ? 'League' : 'Preferred league'}
            </label>
            <select
              id="league-select"
              className="mt-1 w-full bg-secondary border border-border rounded-sm px-3 py-2 text-sm"
              value={form.preferredLeague}
              onChange={(e) => {
                const newLeague = e.target.value;
                setForm((p) => ({ ...p, preferredLeague: newLeague }));
                setSelectedTeamId('');
                setSelectedPlayerId(null);
                setClaimMode('new');
              }}
            >
              {leaguesList.map((l) => (
                <option key={l.id} value={l.code}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>

          {/* Phase 4: Team Select & Player Claim Branch */}
          {isPlayer && (
            <div className="space-y-4 p-4 border border-border/80 rounded-sm bg-black/20">
              <div>
                <label
                  htmlFor="team-select"
                  className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
                >
                  Select Your Team <span className="text-destructive">*</span>
                </label>
                <select
                  id="team-select"
                  required
                  className="mt-1 w-full bg-secondary border border-border rounded-sm px-3 py-2 text-sm"
                  value={selectedTeamId}
                  onChange={(e) => {
                    setSelectedTeamId(e.target.value);
                    setSelectedPlayerId(null);
                    setClaimMode('new');
                  }}
                >
                  <option value="">-- Choose your team --</option>
                  {Object.entries(teamsByDivision).map(([division, divTeams]) => (
                    <optgroup key={division} label={division}>
                      {divTeams.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>

              {selectedTeamId && (
                <div>
                  <label
                    htmlFor="jersey-number"
                    className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
                  >
                    Jersey Number <span className="text-muted-foreground/60">(optional)</span>
                  </label>
                  <input
                    id="jersey-number"
                    type="number"
                    min={0}
                    max={99}
                    className="mt-1 w-full bg-secondary border border-border rounded-sm px-3 py-2 text-sm"
                    placeholder="e.g. 23"
                    value={jerseyNumber}
                    onChange={(e) => setJerseyNumber(e.target.value)}
                  />
                </div>
              )}

              {/* Roster Claim or Create Selector */}
              {selectedTeamId && (
                <div className="space-y-2 pt-2 border-t border-border/40">
                  {unclaimedQuery.isLoading ? (
                    <p className="text-xs text-muted-foreground animate-pulse py-2">
                      Loading team roster…
                    </p>
                  ) : unclaimedPlayers.length > 0 ? (
                    <>
                      <label className="text-xs font-semibold uppercase tracking-wider text-primary block">
                        Is one of these you?
                      </label>
                      <p className="text-xs text-muted-foreground">
                        A coach or scorekeeper previously recorded these roster players courtside.
                        Select your name to claim your stats, or choose to add yourself as a new player.
                      </p>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                        {unclaimedPlayers.map((p) => {
                          const isSelected = claimMode === 'claim' && selectedPlayerId === p.id;
                          return (
                            <div
                              key={p.id}
                              data-testid={`claim-player-${p.id}`}
                              onClick={() => {
                                setClaimMode('claim');
                                setSelectedPlayerId(p.id);
                                if (!form.displayName) {
                                  setForm((prev) => ({ ...prev, displayName: p.display_name }));
                                }
                                if (p.jersey_number !== null) {
                                  setJerseyNumber(String(p.jersey_number));
                                }
                              }}
                              className={`p-3 rounded-sm border cursor-pointer flex items-center justify-between transition-colors ${
                                isSelected
                                  ? 'border-primary bg-primary/10'
                                  : 'border-border bg-secondary/40 hover:border-primary/40'
                              }`}
                            >
                              <div className="flex items-center gap-2.5">
                                <UserCheck className={`w-4 h-4 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`} />
                                <div>
                                  <p className="text-xs font-bold">{p.display_name}</p>
                                  {p.jersey_number !== null && (
                                    <p className="text-[10px] text-muted-foreground">Jersey #{p.jersey_number}</p>
                                  )}
                                </div>
                              </div>
                              {isSelected && <Check className="w-4 h-4 text-primary" />}
                            </div>
                          );
                        })}

                        {/* Explicit Option to Add as New */}
                        <div
                          data-testid="add-as-new-player"
                          onClick={() => {
                            setClaimMode('new');
                            setSelectedPlayerId(null);
                          }}
                          className={`p-3 rounded-sm border cursor-pointer flex items-center justify-between transition-colors ${
                            claimMode === 'new'
                              ? 'border-primary bg-primary/10'
                              : 'border-border bg-secondary/40 hover:border-primary/40'
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            <UserPlus className={`w-4 h-4 ${claimMode === 'new' ? 'text-primary' : 'text-muted-foreground'}`} />
                            <div>
                              <p className="text-xs font-bold">None of these</p>
                              <p className="text-[10px] text-muted-foreground">Add me as a new player</p>
                            </div>
                          </div>
                          {claimMode === 'new' && <Check className="w-4 h-4 text-primary" />}
                        </div>
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground py-1">
                      No prior courtside records found for this team. You will be added as a new player.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Bio and Avatar: MUST NOT appear for fans — player/coach only */}
          {!isFan && (
            <>
              <div>
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Bio <span className="text-muted-foreground/60">(optional)</span>
                </label>
                <textarea
                  className="mt-1 w-full bg-secondary border border-border rounded-sm px-3 py-2 text-sm min-h-20 resize-y"
                  placeholder="Tell the league a bit about yourself…"
                  value={form.bio}
                  onChange={(e) => setForm((p) => ({ ...p, bio: e.target.value }))}
                />
              </div>

              <div>
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Profile photo <span className="text-muted-foreground/60">(optional)</span>
                </label>
                <input
                  type="file"
                  accept="image/*"
                  className="mt-1 text-sm"
                  onChange={(e) => setForm((p) => ({ ...p, avatarFile: e.target.files?.[0] ?? null }))}
                />
              </div>
            </>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="gold-bg px-4 py-3 rounded-sm font-display font-bold text-sm uppercase tracking-wider w-full disabled:opacity-70"
          >
            {submitting
              ? 'Saving…'
              : form.primaryRoleIntent === 'player'
              ? 'Continue to Player Registration →'
              : form.primaryRoleIntent === 'coach'
              ? 'Submit Coach Request →'
              : 'Finish Setup →'}
          </button>

          {form.primaryRoleIntent === 'player' && (
            <p className="text-xs text-muted-foreground text-center -mt-2">
              You&apos;ll be taken to checkout after saving your profile. $6.99 CAD/month + 5% GST. Cancel any time.
            </p>
          )}
        </form>
      </div>
    </div>
  );
};

export default OnboardingPage;
