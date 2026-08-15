/**
 * E2E: broadcast overlay flow.
 *
 * Verifies — under real Vite dev server + React Router + lazy-loaded chunks —
 * that the surfaces built in this PR actually mount and render:
 *   1. /overlay/:gameId — OBS chromeless scoreboard page
 *   2. /scorekeeper/:gameId — mobile stat-keeper (admin-only, bypass flag)
 *   3. /ops/scoreboard/:gameId — dedicated ops live scoreboard tab
 *   4. /overlay-control/:gameId — admin console with Highlights panel
 */

import { expect, seedSuperAdminSession, test } from '../playwright-fixture';

const GAME_ID = 'aaaaaaaa-1111-4111-8111-111111111111';

// Realistic worker payload for /api/public/overlay/:gameId
const OVERLAY_PAYLOAD = {
  ok: true,
  game: {
    id: GAME_ID,
    status: 'live',
    category: 'league',
    home_score: 42,
    away_score: 39,
    leagues: { code: 'SBBL', name: 'Summer Basketball League' },
    home_team: { id: 'h', name: 'Vipers', logo_url: null },
    away_team: { id: 'a', name: 'Wolves', logo_url: null },
    participant1_label: null,
    participant2_label: null,
    event_name: null,
  },
  overlay: {
    game_id: GAME_ID,
    period: 2,
    period_label: 'Q2',
    clock_seconds: 300,
    clock_running: false,
    clock_last_started_at: null,
    home_score: 42,
    away_score: 39,
    home_fouls: 3,
    away_fouls: 2,
    home_timeouts_left: 4,
    away_timeouts_left: 4,
    possession: 'home',
    bonus_home: false,
    bonus_away: false,
    shot_clock_seconds: null,
    last_event_text: null,
    last_event_at: null,
    overlay_theme: 'default',
    show_sponsor_bug: true,
    show_lower_third: false,
    lower_third_text: null,
    lower_third_subtext: null,
    live_clock_seconds: 300,
  },
  sponsor: null,
};

async function stubBroadcastApis(page: import('@playwright/test').Page) {
  await seedSuperAdminSession(page);

  await page.route('**/api/public/overlay/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(OVERLAY_PAYLOAD),
    }),
  );
  await page.route('**/api/public/streams/*/reactions/aggregate*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: [
          { reaction_type: 'fire', count: 12 },
          { reaction_type: 'heart', count: 4 },
          { reaction_type: 'clap', count: 2 },
        ],
      }),
    }),
  );
  await page.route('**/api/public/highlights/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, data: [] }),
    }),
  );
  await page.route('**/api/public/sponsors*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, data: [] }),
    }),
  );
  await page.route(`**/api/public/games/${GAME_ID}/player-stats*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        gameId: GAME_ID,
        home: {
          teamId: 'h',
          teamName: 'Vipers',
          players: [
            { playerId: 'p-1', playerName: 'Marcus Vance', jerseyNumber: 23, position: 'SG', teamId: 'h', pts: 14, reb: 4, ast: 6, stl: 2, blk: 1, fls: 1, min: 24 },
            { playerId: 'p-2', playerName: 'Tyler Cross', jerseyNumber: 5, position: 'PG', teamId: 'h', pts: 9, reb: 2, ast: 4, stl: 1, blk: 0, fls: 2, min: 18 },
          ],
        },
        away: {
          teamId: 'a',
          teamName: 'Wolves',
          players: [
            { playerId: 'p-3', playerName: 'David Lee', jerseyNumber: 11, position: 'PG', teamId: 'a', pts: 18, reb: 3, ast: 7, stl: 3, blk: 0, fls: 2, min: 28 },
            { playerId: 'p-4', playerName: 'Sam Hayes', jerseyNumber: 34, position: 'C', teamId: 'a', pts: 12, reb: 8, ast: 1, stl: 0, blk: 2, fls: 3, min: 22 },
          ],
        },
      }),
    }),
  );
}

test.describe('broadcast overlay flow', () => {
  test('/overlay/:gameId renders the chromeless scorebug with live payload', async ({
    page,
  }) => {
    await stubBroadcastApis(page);

    await page.goto(`/overlay/${GAME_ID}`, { waitUntil: 'domcontentloaded' });

    // Chromeless bug root
    await expect(page.getByTestId('overlay-root')).toBeVisible({
      timeout: 10_000,
    });

    // Score numerals from the payload.
    await expect(page.locator('body')).toContainText('42');
    await expect(page.locator('body')).toContainText('39');

    // Period label.
    await expect(page.locator('body')).toContainText('Q2');

    // Invariant: chromeless routes must NOT render the main nav or top bar.
    await expect(page.locator('header')).toHaveCount(0);
    await expect(page.locator('nav')).toHaveCount(0);

    // Capture visual screenshot of the live broadcast scorebug
    await page.screenshot({ path: 'C:/Users/sinyo/.gemini/antigravity/brain/1c08c1bc-fd03-40b7-8821-f36090c50ba5/broadcast-scorebug-live.png', fullPage: true });
  });

  test('/overlay/:gameId returns a useful message when payload missing', async ({
    page,
  }) => {
    await seedSuperAdminSession(page);

    await page.route(`**/api/public/overlay/${GAME_ID}`, (route) =>
      route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'game_not_found' }),
      }),
    );
    await page.route('**/api/public/streams/*/reactions/aggregate*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, data: [] }),
      }),
    );

    await page.goto(`/overlay/${GAME_ID}`, { waitUntil: 'domcontentloaded' });

    // No crash, no header, some visible text so OBS doesn't get a black frame.
    await expect(page.locator('body')).toContainText(/Overlay unavailable|Missing/i, {
      timeout: 10_000,
    });
  });

  test('/scorekeeper/:gameId renders the mobile console with admin bypass and player stats', async ({
    page,
  }) => {
    await stubBroadcastApis(page);

    await page.goto(`/scorekeeper/${GAME_ID}`, { waitUntil: 'domcontentloaded' });

    // Header renders on non-chromeless routes.
    await expect(page.locator('header')).toBeVisible({ timeout: 10_000 });

    // Score numerals with stubbed values.
    await expect(page.locator('body')).toContainText('42');
    await expect(page.locator('body')).toContainText('39');

    // Large touch targets — the spec requires +1/+2/+3 per side.
    await expect(page.getByRole('button', { name: /Away plus 2 points/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Home plus 3 points/i })).toBeVisible();

    // Verify PlayerStatsTracker component mounts with player buttons
    await expect(page.getByTestId('player-stats-tracker')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('David Lee')).toBeVisible();
    await expect(page.getByText('Sam Hayes')).toBeVisible();

    // Switch to Home team roster tab
    await page.getByRole('button', { name: /Vipers/i }).click();
    await expect(page.getByText('Marcus Vance')).toBeVisible();

    // Capture visual screenshot of scorekeeper mobile console
    await page.screenshot({ path: 'C:/Users/sinyo/.gemini/antigravity/brain/1c08c1bc-fd03-40b7-8821-f36090c50ba5/scorekeeper-live-console.png', fullPage: true });
  });

  test('/ops/scoreboard/:gameId renders full admin Live Scoreboard and Courtside controls', async ({
    page,
  }) => {
    await stubBroadcastApis(page);

    await page.goto(`/ops/scoreboard/${GAME_ID}`, { waitUntil: 'domcontentloaded' });

    // Header and Courtside controls
    await expect(page.getByTestId('courtside-quick-controls')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('player-stats-tracker')).toBeVisible({ timeout: 10_000 });

    // Verify player list and box score rows
    await expect(page.getByText('David Lee')).toBeVisible();
    await expect(page.getByText('Sam Hayes')).toBeVisible();

    // Switch to Home team roster tab
    await page.getByRole('button', { name: /Vipers/i }).click();
    await expect(page.getByText('Marcus Vance')).toBeVisible();

    // Capture visual screenshot of ops scoreboard console
    await page.screenshot({ path: 'C:/Users/sinyo/.gemini/antigravity/brain/1c08c1bc-fd03-40b7-8821-f36090c50ba5/ops-scoreboard-live-tabulation.png', fullPage: true });
  });

  test('/overlay-control/:gameId includes Highlights section', async ({
    page,
  }) => {
    await stubBroadcastApis(page);

    await page.goto(`/overlay-control/${GAME_ID}`, {
      waitUntil: 'domcontentloaded',
    });

    // Core console header.
    await expect(page.getByRole('heading', { name: /Overlay Control/i })).toBeVisible(
      { timeout: 10_000 },
    );

    // New Highlights panel.
    await expect(page.getByRole('heading', { name: /Highlights/i })).toBeVisible();

    // Mark-highlight button from HighlightMarker component.
    await expect(page.getByRole('button', { name: /Mark Highlight/i })).toBeVisible();
  });
});
