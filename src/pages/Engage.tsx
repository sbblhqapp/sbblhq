/**
 * /engage — interactive fan engagement.
 *
 * Polls, predictions, trivia, watch-party lobby, gamification leaderboard,
 * and personal points ledger. Public-friendly reads; voting + watch party
 * joins require auth.
 */

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Sparkles, Trophy, Users, Medal } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import {
  fetchPolls,
  fetchPollResults,
  fetchEngagementLeaderboard,
  fetchMyPoints,
  castVote,
  createWatchParty,
  listWatchParties,
  joinWatchParty,
  joinWatchPartyByCode,
  type Poll,
} from '@/lib/api/engagement';

const TABS = [
  { id: 'polls', label: 'Polls & Trivia', icon: Sparkles },
  { id: 'watch-party', label: 'Watch Parties', icon: Users },
  { id: 'leaderboard', label: 'Leaderboard', icon: Trophy },
] as const;

export default function EngagePage() {
  const [params, setParams] = useSearchParams();
  const gameId = params.get('gameId') ?? undefined;
  const initialTab = (params.get('tab') as (typeof TABS)[number]['id']) ?? 'polls';
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>(initialTab);
  const { session } = useAuth();
  const isAuthed = !!session;

  const changeTab = (next: (typeof TABS)[number]['id']) => {
    setTab(next);
    const sp: Record<string, string> = {};
    if (gameId) sp.gameId = gameId;
    sp.tab = next;
    setParams(sp, { replace: true });
  };

  return (
    <div className="container py-8 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-1">Engage</h1>
        <p className="text-muted-foreground text-sm">
          Pick-em, trivia, watch parties, and the fan leaderboard.
          {!isAuthed && ' Sign in to cast your vote and earn points.'}
        </p>
      </div>

      <div className="flex bg-secondary p-1 rounded-sm mb-6 w-fit">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => changeTab(id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider rounded-sm ${
              tab === id
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className="w-3 h-3" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'polls' && <PollsPanel gameId={gameId} isAuthed={isAuthed} />}
      {tab === 'watch-party' && (
        <WatchPartyPanel gameId={gameId} isAuthed={isAuthed} />
      )}
      {tab === 'leaderboard' && (
        <LeaderboardPanel isAuthed={isAuthed} />
      )}
    </div>
  );
}

function PollsPanel({ gameId, isAuthed }: { gameId?: string; isAuthed: boolean }) {
  const qc = useQueryClient();
  const pollsQuery = useQuery({
    queryKey: ['engage-polls', gameId ?? 'all'],
    queryFn: () => fetchPolls(gameId),
    staleTime: 15_000,
  });
  const list = pollsQuery.data?.data ?? [];

  if (pollsQuery.isLoading) return <div className="panel p-8 text-center text-sm text-muted-foreground">Loading polls…</div>;
  if (list.length === 0) {
    return (
      <div className="panel p-12 text-center">
        <Sparkles className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
        <p className="text-lg font-semibold mb-1">No active polls</p>
        <p className="text-sm text-muted-foreground">
          New polls appear here when operators open them for live games.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {list.map((poll) => (
        <PollCard
          key={poll.id}
          poll={poll}
          isAuthed={isAuthed}
          onVoted={() =>
            qc.invalidateQueries({ queryKey: ['poll-results', poll.id] })
          }
        />
      ))}
    </div>
  );
}

function PollCard({
  poll,
  isAuthed,
  onVoted,
}: {
  poll: Poll;
  isAuthed: boolean;
  onVoted: () => void;
}) {
  const results = useQuery({
    queryKey: ['poll-results', poll.id],
    queryFn: () => fetchPollResults(poll.id),
    refetchInterval: 4000,
    refetchIntervalInBackground: false,
  });
  const [voting, setVoting] = useState(false);
  const total = results.data?.total_votes ?? 0;
  const isOpen = poll.status === 'open';

  const optionBar = useMemo(() => {
    const tallies = results.data?.tallies ?? {};
    return poll.options.map((o) => {
      const count = tallies[o.id] ?? 0;
      const pct = total > 0 ? Math.round((count / total) * 100) : 0;
      return { ...o, count, pct };
    });
  }, [poll.options, results.data?.tallies, total]);

  const handleVote = async (optionId: string) => {
    if (!isAuthed) {
      toast.error('Sign in to vote.');
      return;
    }
    setVoting(true);
    try {
      await castVote(poll.id, optionId);
      toast.success('Vote cast');
      onVoted();
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === 'already_voted') toast.error('You already voted on this poll');
      else toast.error(msg);
    } finally {
      setVoting(false);
    }
  };

  return (
    <div className="panel p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wider font-bold text-primary">
          {poll.kind}
        </span>
        <span
          className={`text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded-sm ${
            isOpen ? 'bg-green-500/15 text-green-400' : 'bg-secondary text-muted-foreground'
          }`}
        >
          {poll.status}
        </span>
      </div>
      <h3 className="font-bold text-base">{poll.question}</h3>
      <div className="flex flex-col gap-2">
        {optionBar.map((o) => (
          <button
            key={o.id}
            disabled={!isOpen || voting}
            onClick={() => handleVote(o.id)}
            className="relative text-left p-3 border border-border rounded-sm hover:bg-secondary disabled:opacity-70"
          >
            <div
              className="absolute inset-0 bg-primary/10 rounded-sm transition-all"
              style={{ width: `${o.pct}%` }}
            />
            <div className="relative flex justify-between gap-2 text-sm">
              <span>{o.label}</span>
              <span className="text-muted-foreground">
                {o.pct}% · {o.count}
              </span>
            </div>
          </button>
        ))}
      </div>
      <div className="text-[11px] text-muted-foreground flex items-center justify-between">
        <span>{total} votes</span>
        <span>+{poll.points_award} pts if correct</span>
      </div>
    </div>
  );
}

function WatchPartyPanel({
  gameId,
  isAuthed,
}: {
  gameId?: string;
  isAuthed: boolean;
}) {
  const qc = useQueryClient();
  const listQuery = useQuery({
    queryKey: ['watch-parties', gameId ?? 'all'],
    queryFn: () => listWatchParties(gameId),
    staleTime: 5_000,
    enabled: isAuthed,
  });

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('Friday Night Hoops');
  const [code, setCode] = useState('');

  if (!isAuthed) {
    return (
      <div className="panel p-12 text-center">
        <Users className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
        <p className="text-lg font-semibold mb-1">Sign in to host or join</p>
        <p className="text-sm text-muted-foreground">
          Watch parties keep your crew in sync during a live game.
        </p>
      </div>
    );
  }

  const handleCreate = async () => {
    if (!gameId) {
      toast.error('Open a watch party from a live game (?gameId=…).');
      return;
    }
    setCreating(true);
    try {
      const res = await createWatchParty(gameId, name || 'Watch Party', 25);
      toast.success(`Created. Invite code: ${res.party.join_code}`);
      qc.invalidateQueries({ queryKey: ['watch-parties'] });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const handleJoinCode = async () => {
    const c = code.trim().toUpperCase();
    if (!c) return;
    try {
      await joinWatchPartyByCode(c);
      toast.success('Joined');
      qc.invalidateQueries({ queryKey: ['watch-parties'] });
      setCode('');
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="panel p-4">
        <h3 className="font-bold text-sm mb-2">Host a watch party</h3>
        <div className="flex gap-2 flex-wrap">
          <input
            className="flex-1 min-w-[220px] px-3 py-2 bg-background border border-border rounded-sm text-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            onClick={handleCreate}
            disabled={creating}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-sm text-sm font-bold disabled:opacity-70"
          >
            {creating ? 'Creating…' : 'Create'}
          </button>
        </div>
        {!gameId && (
          <p className="text-[11px] text-muted-foreground mt-2">
            Tip: pass <code>?gameId=…</code> from the Live page to pre-select
            a game.
          </p>
        )}
      </div>
      <div className="panel p-4">
        <h3 className="font-bold text-sm mb-2">Join by code</h3>
        <div className="flex gap-2">
          <input
            className="flex-1 px-3 py-2 bg-background border border-border rounded-sm text-sm font-mono tracking-widest uppercase"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="ABC123"
            maxLength={8}
          />
          <button
            onClick={handleJoinCode}
            className="px-4 py-2 border border-border rounded-sm text-sm"
          >
            Join
          </button>
        </div>
      </div>
      <div className="panel p-4">
        <h3 className="font-bold text-sm mb-2">Open parties</h3>
        {listQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (listQuery.data?.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No open parties. Host one above.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {(listQuery.data?.data ?? []).map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between py-2 gap-2"
              >
                <div>
                  <div className="font-semibold text-sm">{p.name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    Max {p.max_members} · created{' '}
                    {new Date(p.created_at).toLocaleString()}
                  </div>
                </div>
                <button
                  className="px-3 py-1 border border-border rounded-sm text-xs"
                  onClick={async () => {
                    try {
                      await joinWatchParty(p.id);
                      toast.success('Joined');
                    } catch (err) {
                      toast.error((err as Error).message);
                    }
                  }}
                >
                  Join
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function LeaderboardPanel({ isAuthed }: { isAuthed: boolean }) {
  const lbQuery = useQuery({
    queryKey: ['engage-leaderboard'],
    queryFn: fetchEngagementLeaderboard,
    staleTime: 30_000,
  });
  const myQuery = useQuery({
    queryKey: ['engage-me'],
    queryFn: fetchMyPoints,
    enabled: isAuthed,
    staleTime: 15_000,
  });

  const rows = lbQuery.data?.data ?? [];

  return (
    <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-4">
      <div className="panel p-4">
        <h3 className="font-bold text-sm mb-3 flex items-center gap-2">
          <Medal className="w-4 h-4" /> Top fans
        </h3>
        {lbQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No points awarded yet. Vote on a poll to get on the board.
          </p>
        ) : (
          <ol className="space-y-2">
            {rows.map((r, i) => (
              <li
                key={r.user_id}
                className="flex items-center justify-between gap-2"
              >
                <span className="flex items-center gap-3">
                  <span className="stat-numeral text-lg w-6 text-right text-muted-foreground">
                    {i + 1}
                  </span>
                  <span className="font-semibold">{r.display_name}</span>
                </span>
                <span className="stat-numeral text-lg">{r.total_points}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
      <div className="panel p-4">
        <h3 className="font-bold text-sm mb-3">Your points</h3>
        {!isAuthed ? (
          <p className="text-sm text-muted-foreground">Sign in to see yours.</p>
        ) : myQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="stat-numeral text-5xl mb-2">
              {myQuery.data?.total ?? 0}
            </div>
            <p className="text-xs text-muted-foreground">
              {myQuery.data?.history?.length ?? 0} awards to date
            </p>
            <ul className="mt-3 space-y-1 max-h-48 overflow-y-auto text-xs">
              {(myQuery.data?.history ?? []).slice(0, 10).map((h) => (
                <li
                  key={h.id}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="truncate">{h.reason}</span>
                  <span className="stat-numeral">+{h.points}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

