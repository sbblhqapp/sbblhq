import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PlayerStatsTracker } from './PlayerStatsTracker';
import * as playerStatsApi from '@/lib/api/playerStats';

vi.mock('@/lib/api/playerStats', () => ({
  fetchGamePlayerStats: vi.fn(),
  recordPlayerStat: vi.fn(),
  quickAddGamePlayer: vi.fn(),
}));

describe('PlayerStatsTracker Component', () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  const mockStatsData: playerStatsApi.GamePlayerStatsResponse = {
    ok: true,
    gameId: '11111111-1111-1111-1111-111111111111',
    away: {
      teamId: 'team-away-1',
      teamName: 'Ballers',
      players: [
        {
          playerId: 'p1',
          playerName: 'Marcus Smart',
          jerseyNumber: 36,
          teamId: 'team-away-1',
          pts: 12,
          reb: 4,
          ast: 7,
          stl: 2,
          blk: 1,
          fls: 3,
          min: 18,
        },
      ],
    },
    home: {
      teamId: 'team-home-1',
      teamName: 'Shooters',
      players: [
        {
          playerId: 'p2',
          playerName: 'Steph Curry',
          jerseyNumber: 30,
          teamId: 'team-home-1',
          pts: 24,
          reb: 5,
          ast: 6,
          stl: 1,
          blk: 0,
          fls: 1,
          min: 22,
        },
      ],
    },
  };

  it('renders player stats tracker and displays team tabs', async () => {
    vi.mocked(playerStatsApi.fetchGamePlayerStats).mockResolvedValue(mockStatsData);

    render(
      <QueryClientProvider client={queryClient}>
        <PlayerStatsTracker gameId="11111111-1111-1111-1111-111111111111" />
      </QueryClientProvider>
    );

    expect(screen.getByTestId('player-stats-tracker')).toBeDefined();
    expect(screen.getByText(/Individual Player Stats & Box Score/i)).toBeDefined();
    expect(await screen.findByText(/Ballers \(12 PTS\)/i)).toBeDefined();
    expect(await screen.findByText(/Shooters \(24 PTS\)/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /Box Score/i })).toBeDefined();
  });

  it('renders player stat badges and 1-tap action buttons', async () => {
    vi.mocked(playerStatsApi.fetchGamePlayerStats).mockResolvedValue(mockStatsData);

    render(
      <QueryClientProvider client={queryClient}>
        <PlayerStatsTracker gameId="11111111-1111-1111-1111-111111111111" />
      </QueryClientProvider>
    );

    // Away player Marcus Smart
    expect(await screen.findByText('Marcus Smart')).toBeDefined();
    expect(screen.getByText('#36')).toBeDefined();

    // Check action buttons
    expect(screen.getByText('+1 FT')).toBeDefined();
    expect(screen.getByText('+2 FG')).toBeDefined();
    expect(screen.getByText('+3 3PT')).toBeDefined();
    expect(screen.getByText('+1 REB')).toBeDefined();
    expect(screen.getByText('+1 AST')).toBeDefined();
  });

  it('switches to box score view and renders table with team totals', async () => {
    vi.mocked(playerStatsApi.fetchGamePlayerStats).mockResolvedValue(mockStatsData);

    render(
      <QueryClientProvider client={queryClient}>
        <PlayerStatsTracker gameId="11111111-1111-1111-1111-111111111111" />
      </QueryClientProvider>
    );

    const boxscoreTab = screen.getByRole('button', { name: /Box Score/i });
    fireEvent.click(boxscoreTab);

    expect(await screen.findByText(/Ballers Box Score/i)).toBeDefined();
    expect(screen.getByText(/Shooters Box Score/i)).toBeDefined();
    expect(screen.getAllByText('TOTALS')).toHaveLength(2);
  });
});
