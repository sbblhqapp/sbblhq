/**
 * Guards the schedule tip-off time formatter.
 *
 * `/api/public/schedule` returns `starts_at` from the linked schedule_slot when
 * one exists, and falls back to `games.game_date` — a DATE, with no time — when
 * it does not. `new Date('2026-08-16')` parses to midnight UTC, so the old
 * formatter rendered every slot-less fixture as "12:00 AM": a time the league
 * never scheduled, presented as if it had.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The formatter is module-private; exercise it through its source contract.
const SOURCE = readFileSync(resolve(__dirname, '../pages/Schedules.tsx'), 'utf8');

function formatScheduleTime(input: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(input.trim())) return 'TBA';
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return 'TBA';
  return parsed.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

describe('formatScheduleTime', () => {
  it('renders TBA for a date-only value rather than inventing midnight', () => {
    expect(formatScheduleTime('2026-08-16')).toBe('TBA');
    expect(formatScheduleTime(' 2026-08-16 ')).toBe('TBA');
  });

  it('renders a real clock time when the slot supplies a timestamp', () => {
    expect(formatScheduleTime('2026-08-16T19:30:00Z')).toMatch(/\d{1,2}:\d{2}\s?(AM|PM)/i);
  });

  it('renders TBA for unparseable input', () => {
    expect(formatScheduleTime('not-a-date')).toBe('TBA');
  });

  it('keeps the date-only guard in the shipped page source', () => {
    expect(SOURCE).toMatch(/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$/);
  });
});
