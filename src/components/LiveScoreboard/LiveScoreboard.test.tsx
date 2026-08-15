import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { LiveScoreboardView, formatClock } from './LiveScoreboard';
import { dbRowToOverlayState } from '@/hooks/useLiveScoreboardRealtime';
import type { OverlayState } from '@/lib/api/overlay';

describe('LiveScoreboard Component & View States', () => {
  it('formats clock seconds into MM:SS and SS.T correctly', () => {
    expect(formatClock(600)).toBe('10:00');
    expect(formatClock(125)).toBe('02:05');
    expect(formatClock(59.4)).toBe('59.4');
    expect(formatClock(0)).toBe('0.0');
  });

  it('renders the Empty state when gameId is null', () => {
    render(
      <LiveScoreboardView
        gameId={null}
        liveScore={null}
        liveStandings={[]}
        connectionStatus="disconnected"
        isLoading={false}
        error={null}
      />
    );
    expect(screen.getByTestId('live-scoreboard-empty')).toBeInTheDocument();
    expect(screen.getByText('No Live Game Selected')).toBeInTheDocument();
  });

  it('renders the Loading state when loading with no cached score', () => {
    render(
      <LiveScoreboardView
        gameId="game-1"
        liveScore={null}
        liveStandings={[]}
        connectionStatus="connecting"
        isLoading={true}
        error={null}
      />
    );
    expect(screen.getByTestId('live-scoreboard-loading')).toBeInTheDocument();
    expect(screen.getByText(/Connecting to live scoreboard stream/i)).toBeInTheDocument();
  });

  it('renders the Error state with retry action', () => {
    const onRefresh = vi.fn();
    render(
      <LiveScoreboardView
        gameId="game-1"
        liveScore={null}
        liveStandings={[]}
        connectionStatus="error"
        isLoading={false}
        error="Realtime connection dropped"
        onRefresh={onRefresh}
      />
    );
    expect(screen.getByTestId('live-scoreboard-error')).toBeInTheDocument();
    expect(screen.getByText('Realtime connection dropped')).toBeInTheDocument();
    
    const retryBtn = screen.getByRole('button', { name: /Retry Connection/i });
    fireEvent.click(retryBtn);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('renders the Reconnecting state badge when connection drops', () => {
    const mockScore: OverlayState = {
      game_id: 'game-1',
      period: 3,
      period_label: 'Q3',
      clock_seconds: 300,
      clock_running: false,
      clock_last_started_at: null,
      home_score: 65,
      away_score: 62,
      home_fouls: 2,
      away_fouls: 4,
      home_timeouts_left: 3,
      away_timeouts_left: 3,
      possession: 'home',
      bonus_home: false,
      bonus_away: false,
      shot_clock_seconds: 24,
      last_event_text: 'Foul committed by #12',
      last_event_at: null,
      overlay_theme: 'default',
      show_sponsor_bug: true,
      show_lower_third: false,
      lower_third_text: null,
      lower_third_subtext: null,
    };

    render(
      <LiveScoreboardView
        gameId="game-1"
        liveScore={mockScore}
        liveStandings={[]}
        connectionStatus="reconnecting"
        isLoading={false}
        error={null}
      />
    );
    expect(screen.getByTestId('status-reconnecting')).toBeInTheDocument();
    expect(screen.getByText('RECONNECTING')).toBeInTheDocument();
  });

  it('renders live scores, period, clock, and possession in connected state', () => {
    const mockScore: OverlayState = {
      game_id: 'game-1',
      period: 2,
      period_label: 'Q2',
      clock_seconds: 420,
      clock_running: true,
      clock_last_started_at: null,
      home_score: 54,
      away_score: 48,
      home_fouls: 3,
      away_fouls: 5,
      home_timeouts_left: 3,
      away_timeouts_left: 2,
      possession: 'home',
      bonus_home: false,
      bonus_away: true,
      shot_clock_seconds: 14,
      last_event_text: '3PT Jump Shot by #7',
      last_event_at: null,
      overlay_theme: 'default',
      show_sponsor_bug: true,
      show_lower_third: false,
      lower_third_text: null,
      lower_third_subtext: null,
    };

    render(
      <LiveScoreboardView
        gameId="game-1"
        homeTeamName="Shooters"
        awayTeamName="Ballers"
        liveScore={mockScore}
        liveStandings={[]}
        connectionStatus="connected"
        isLoading={false}
        error={null}
      />
    );

    expect(screen.getByTestId('live-scoreboard')).toBeInTheDocument();
    expect(screen.getByText('54')).toBeInTheDocument();
    expect(screen.getByText('48')).toBeInTheDocument();
    expect(screen.getByText('Q2')).toBeInTheDocument();
    expect(screen.getByText('07:00')).toBeInTheDocument();
    expect(screen.getByText('Shooters')).toBeInTheDocument();
    expect(screen.getByText('Ballers')).toBeInTheDocument();
    expect(screen.getByText(/3PT Jump Shot by #7/)).toBeInTheDocument();
    expect(screen.getByTestId('status-connected')).toBeInTheDocument();
  });

  it('shows the "LIVE PROJECTED" badge when live adjustments are active and expands standings', () => {
    const mockStandings = [
      {
        team_id: 'aaaa1111-1111-1111-1111-111111111111',
        wins: 8,
        losses: 2,
        pts_for: 850,
        pts_against: 790,
        is_live_adjusted: true,
      },
      {
        team_id: 'bbbb2222-2222-2222-2222-222222222222',
        wins: 6,
        losses: 4,
        pts_for: 780,
        pts_against: 810,
        is_live_adjusted: false,
      },
    ];

    render(
      <LiveScoreboardView
        gameId="game-1"
        liveScore={null}
        liveStandings={mockStandings}
        connectionStatus="connected"
        isLoading={false}
        error={null}
      />
    );

    // Ticker shows the badge
    expect(screen.getByTestId('live-projected-badge-ticker')).toBeInTheDocument();

    // Click to expand standings
    const expandBtn = screen.getByRole('button', { name: /LIVE TABULATION STANDINGS/i });
    fireEvent.click(expandBtn);

    expect(screen.getByTestId('live-projected-badge')).toBeInTheDocument();
    expect(screen.getByText('LIVE PROJECTED STANDINGS')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
  });

  it('transforms raw DB row into typed OverlayState accurately', () => {
    const rawRow = {
      game_id: 'game-uuid-123',
      period: 3,
      period_label: 'Q3',
      clock_seconds: 300,
      clock_running: true,
      home_score: 72,
      away_score: 68,
      home_fouls: 4,
      away_fouls: 6,
      possession: 'away',
      bonus_home: false,
      bonus_away: true,
    };

    const transformed = dbRowToOverlayState(rawRow);
    expect(transformed.game_id).toBe('game-uuid-123');
    expect(transformed.period).toBe(3);
    expect(transformed.period_label).toBe('Q3');
    expect(transformed.clock_seconds).toBe(300);
    expect(transformed.home_score).toBe(72);
    expect(transformed.away_score).toBe(68);
    expect(transformed.possession).toBe('away');
    expect(transformed.bonus_away).toBe(true);
    expect(transformed.show_sponsor_bug).toBe(true);
  });
});
