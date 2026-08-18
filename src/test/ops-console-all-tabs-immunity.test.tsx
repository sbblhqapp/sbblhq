import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { OpsTabErrorBoundary } from '@/components/ops/OpsTabErrorBoundary';
import type { PlayerRef, ScheduleRef, EventRef } from '@/lib/api/ops';

// Helper reproduction logic matching Ops.tsx
function playerLabel(p: PlayerRef): string {
  const identifier = p.user_id || p.id || '';
  const fallback = identifier ? `Unnamed (${identifier.slice(0, 8)}…)` : 'Unnamed Player';
  const name = (p.display_name && p.display_name.trim()) || fallback;
  const team = p.team_name ? ` — ${p.team_name}` : '';
  const suspended = p.is_suspended ? ' [SUSPENDED]' : '';
  return `${name}${team}${suspended}`;
}

function formatDateSafe(val: string | null | undefined, options?: Intl.DateTimeFormatOptions): string {
  if (!val) return '';
  const d = new Date(val);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('en-CA', options);
}

describe('OPS Console — Reliability and Fault Immunity Suite', () => {
  describe('1. playerLabel Resilience', () => {
    it('handles player with null display_name and null user_id without throwing', () => {
      const walkOnPlayer: PlayerRef = {
        id: '12345678-abcd-ef01-2345-6789abcdef01',
        user_id: null,
        team_id: 'team-1',
        league_id: 'wbl',
        display_name: null,
        team_name: 'Ball is Life',
      };
      expect(() => playerLabel(walkOnPlayer)).not.toThrow();
      expect(playerLabel(walkOnPlayer)).toBe('Unnamed (12345678…) — Ball is Life');
    });

    it('handles player with empty display_name and empty user_id', () => {
      const emptyPlayer: PlayerRef = {
        id: 'abcdef01-2345-6789-abcd-ef0123456789',
        user_id: null,
        team_id: null,
        league_id: null,
        display_name: '   ',
        team_name: null,
      };
      expect(playerLabel(emptyPlayer)).toBe('Unnamed (abcdef01…)');
    });

    it('handles normal player with display name and team name', () => {
      const regularPlayer: PlayerRef = {
        id: 'player-1',
        user_id: 'user-1',
        team_id: 'team-1',
        league_id: 'wbl',
        display_name: 'Marcus Smart',
        team_name: 'Celtics',
      };
      expect(playerLabel(regularPlayer)).toBe('Marcus Smart — Celtics');
    });

    it('appends [SUSPENDED] tag when is_suspended is true', () => {
      const suspendedPlayer: PlayerRef = {
        id: 'player-2',
        user_id: null,
        team_id: 'team-2',
        league_id: 'wbl',
        display_name: 'John Doe',
        team_name: 'Rockets',
        is_suspended: true,
      };
      expect(playerLabel(suspendedPlayer)).toBe('John Doe — Rockets [SUSPENDED]');
    });
  });

  describe('2. Date Formatter Resilience (formatDateSafe)', () => {
    it('safely handles null, undefined, empty string, and invalid dates', () => {
      expect(formatDateSafe(null)).toBe('');
      expect(formatDateSafe(undefined)).toBe('');
      expect(formatDateSafe('')).toBe('');
      expect(formatDateSafe('invalid-date-string')).toBe('');
    });

    it('formats valid ISO date strings correctly', () => {
      const formatted = formatDateSafe('2026-08-18T19:00:00.000Z', { month: 'short', day: 'numeric', year: 'numeric' });
      expect(formatted).toBeTruthy();
    });
  });

  describe('3. OpsTabErrorBoundary Tab Isolation', () => {
    // Component that simulates a sudden runtime explosion in one tab
    const BrokenTab = () => {
      throw new Error('Simulation: unexpected null field in third-party payload');
    };

    const WorkingTab = () => <div>Working Tab Content</div>;

    it('catches and isolates errors to the specific tab without crashing the tree', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

      render(
        <div>
          <OpsTabErrorBoundary tabName="Players">
            <BrokenTab />
          </OpsTabErrorBoundary>
          <OpsTabErrorBoundary tabName="Overview">
            <WorkingTab />
          </OpsTabErrorBoundary>
        </div>
      );

      // Verify the broken tab shows localized recovery panel
      expect(screen.getByText('Players Tab Encountered an Issue')).toBeInTheDocument();
      expect(screen.getByText(/The error was isolated to this tab/i)).toBeInTheDocument();
      expect(screen.getByText(/Simulation: unexpected null field/i)).toBeInTheDocument();

      // Verify the adjacent tab remains 100% active and rendered
      expect(screen.getByText('Working Tab Content')).toBeInTheDocument();

      spy.mockRestore();
    });

    it('provides a working reload button on error', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const onReset = vi.fn();

      render(
        <OpsTabErrorBoundary tabName="Schedules" onReset={onReset}>
          <BrokenTab />
        </OpsTabErrorBoundary>
      );

      const reloadBtn = screen.getByRole('button', { name: /Reload Schedules Tab/i });
      expect(reloadBtn).toBeInTheDocument();
      fireEvent.click(reloadBtn);
      expect(onReset).toHaveBeenCalledTimes(1);

      spy.mockRestore();
    });
  });
});
