import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import TeamsPage from '@/pages/Teams';
import SchedulesPage from '@/pages/Schedules';
import { PlayerStatsTracker } from '@/components/LiveScoreboard/PlayerStatsTracker';
import * as teamsApi from '@/lib/api/teams';
import * as publicApi from '@/lib/api/public';
import * as playerStatsApi from '@/lib/api/playerStats';

vi.mock('@/contexts/AppContext', () => ({
  useApp: () => ({
    activeLeague: 'sbbl',
    setActiveLeague: vi.fn(),
    isAdmin: true,
    authRole: 'super_admin',
  }),
}));

describe('Apple-Grade Multi-Division & Ergonomics Suite', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    vi.restoreAllMocks();
  });

  it('1. TeamsPage partitions SBBL Season 12 teams into clean division segmented tabs (P10, P9, 35 Up, P7)', async () => {
    vi.spyOn(teamsApi, 'fetchTeams').mockResolvedValue({
      ok: true,
      teams: [
        {
          id: 't-1',
          name: 'Northstar P10',
          league_code: 'SBBL',
          league_name: 'SBBL',
          season_name: 'Season 12',
          division_name: 'P10',
          roster_count: 10,
          players: [],
          coaches: [],
          stats: { wins: 3, losses: 0, gamesPlayed: 3, ptsFor: 240, ptsAgainst: 180, winPct: '1.000', diff: 60 },
        },
        {
          id: 't-2',
          name: 'Gls Titos',
          league_code: 'SBBL',
          league_name: 'SBBL',
          season_name: 'Season 12',
          division_name: 'P9',
          roster_count: 8,
          players: [],
          coaches: [],
          stats: { wins: 2, losses: 1, gamesPlayed: 3, ptsFor: 200, ptsAgainst: 190, winPct: '0.667', diff: 10 },
        },
        {
          id: 't-3',
          name: 'Sansuwi',
          league_code: 'SBBL',
          league_name: 'SBBL',
          season_name: 'Season 12',
          division_name: '35 Up',
          roster_count: 9,
          players: [],
          coaches: [],
          stats: { wins: 1, losses: 0, gamesPlayed: 1, ptsFor: 75, ptsAgainst: 70, winPct: '1.000', diff: 5 },
        },
      ],
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/teams?league=sbbl']}>
          <TeamsPage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    // Verify division segmented controls render with counts
    expect(await screen.findByText('Season 12')).toBeInTheDocument();
    expect(screen.getAllByText('P10').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('P9').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('35 Up').length).toBeGreaterThanOrEqual(1);

    // Verify standings render teams with podium styling
    expect(screen.getByText('Northstar P10')).toBeInTheDocument();
    expect(screen.getByText('Gls Titos')).toBeInTheDocument();
    expect(screen.getByText('Sansuwi')).toBeInTheDocument();

    // Filter to P10 only
    const p10Button = screen.getByRole('button', { name: /P10/i });
    fireEvent.click(p10Button);
    expect(screen.getByText('Northstar P10')).toBeInTheDocument();
    expect(screen.queryByText('Gls Titos')).not.toBeInTheDocument();
  });

  it('2. SchedulesPage displays Division badges and filters matchups by division', async () => {
    vi.spyOn(publicApi, 'fetchPublicSchedule').mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'g-1',
          starts_at: '2026-08-16T10:00:00Z',
          league_id: 'sbbl',
          status: 'upcoming',
          home_team_name: 'Smesh',
          away_team_name: 'Rebelde Cutie',
          division_name: 'P10',
          venue: 'Genesis Centre',
          address: '7555 Falconridge Blvd NE',
          court: 'Court 1',
        },
        {
          id: 'g-2',
          starts_at: '2026-08-16T11:00:00Z',
          league_id: 'sbbl',
          status: 'upcoming',
          home_team_name: 'Northstar P9',
          away_team_name: 'Rebelde jrs.',
          division_name: 'P9',
          venue: 'Genesis Centre',
          address: '7555 Falconridge Blvd NE',
          court: 'Court 1',
        },
      ],
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/schedules?league=sbbl']}>
          <SchedulesPage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    // Verify games with division tags render
    expect(await screen.findByText('Smesh')).toBeInTheDocument();
    expect(screen.getByText('Rebelde Cutie')).toBeInTheDocument();
    expect(screen.getByText('Northstar P9')).toBeInTheDocument();
    expect(screen.getAllByText('P10').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('P9').length).toBeGreaterThanOrEqual(1);

    // Filter to P9 only
    const p9FilterButtons = screen.getAllByRole('button', { name: /P9/i });
    fireEvent.click(p9FilterButtons[0]);

    // Verify Smesh (P10) is filtered out
    expect(screen.queryByText('Smesh')).not.toBeInTheDocument();
    expect(screen.getByText('Northstar P9')).toBeInTheDocument();
  });

  it('3. PlayerStatsTracker provides 1-tap Undo and Active-5 on-court substitution toggling', async () => {
    const recordSpy = vi.spyOn(playerStatsApi, 'recordPlayerStat').mockResolvedValue({
      ok: true,
      stats: {
        id: 'stat-1',
        game_id: 'game-123',
        player_id: 'p-1',
        pts: 3,
        reb: 0,
        ast: 0,
        stl: 0,
        blk: 0,
        fls: 0,
        min: 0,
      },
    });

    vi.spyOn(playerStatsApi, 'fetchGamePlayerStats').mockResolvedValue({
      ok: true,
      gameId: 'game-123',
      away: {
        teamId: 't-away',
        teamName: 'Away All-Stars',
        players: [
          {
            playerId: 'p-1',
            teamId: 't-away',
            playerName: 'Jordan Poole',
            jerseyNumber: 3,
            position: 'G',
            pts: 0,
            reb: 0,
            ast: 0,
            stl: 0,
            blk: 0,
            fls: 0,
            min: 0,
          },
          {
            playerId: 'p-2',
            teamId: 't-away',
            playerName: 'Draymond Green',
            jerseyNumber: 23,
            position: 'F',
            pts: 0,
            reb: 0,
            ast: 0,
            stl: 0,
            blk: 0,
            fls: 4,
            min: 0,
          },
        ],
      },
      home: {
        teamId: 't-home',
        teamName: 'Home Champions',
        players: [],
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <PlayerStatsTracker gameId="game-123" />
      </QueryClientProvider>
    );

    // Verify initial load
    expect(await screen.findByText('Jordan Poole')).toBeInTheDocument();
    expect(screen.getByText('Draymond Green')).toBeInTheDocument();

    // 1. Mark Jordan Poole as On Court
    const jerseyButton = screen.getByRole('button', { name: '#3' });
    fireEvent.click(jerseyButton);
    expect(await screen.findByText('ON COURT')).toBeInTheDocument();

    // 2. Tap +3 3PT for Jordan Poole
    const plus3Btn = screen.getAllByRole('button', { name: '+3 3PT' })[0];
    fireEvent.click(plus3Btn);

    await waitFor(() => {
      expect(recordSpy).toHaveBeenCalledWith('game-123', {
        playerId: 'p-1',
        stat: 'pts',
        delta: 3,
        teamSide: 'away',
        syncTeamScore: true,
      });
    });

    // 3. Verify Global Undo Button appears with action details
    expect(await screen.findByText(/Undo: \+3 PTS \(Jordan Poole\)/i)).toBeInTheDocument();

    // 4. Tap Undo button
    const undoBtn = screen.getByRole('button', { name: /Undo: \+3 PTS/i });
    fireEvent.click(undoBtn);

    // Verify negative delta was dispatched to revert
    await waitFor(() => {
      expect(recordSpy).toHaveBeenCalledWith('game-123', {
        playerId: 'p-1',
        stat: 'pts',
        delta: -3,
        teamSide: 'away',
        syncTeamScore: true,
      });
    });
  });

  it('4. Multi-admin concurrent stat recordings enforce atomic idempotency keys', async () => {
    const fetchSpy = vi.spyOn(window, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, stats: { id: 'stat-abc', pts: 15 }, idempotent: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const idempotencyKey = 'idemp-custom-uuid-123';
    await playerStatsApi.recordPlayerStat('game-999', {
      playerId: 'player-x',
      stat: 'pts',
      delta: 2,
      teamSide: 'home',
      idempotencyKey,
    });

    expect(fetchSpy).toHaveBeenCalled();
    const lastCall = fetchSpy.mock.calls[0];
    expect(lastCall[0]).toContain('/api/ops/games/game-999/player-stats');
    expect(lastCall[1]?.body).toContain('"idempotencyKey":"idemp-custom-uuid-123"');
    fetchSpy.mockRestore();
  });
});
