import { test, expect } from '@playwright/test';

test.describe('Live Tabulation & Courtside Scoring Repaired E2E', () => {
  test('end-to-end courtside game scoring, player walk-on addition, finalize game, and reopen review_pending', async ({ page }) => {
    const gameId = 'a1111111-2222-3333-4444-555555555555';
    let gameStatus = 'live';
    let homeScore = 0;
    let awayScore = 0;
    let playersList: any[] = [];

    // Mock API routes for deterministic E2E flow
    await page.route(`**/api/public/games/${gameId}/player-stats`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          gameId,
          home: {
            teamId: 'home-team-id',
            teamName: 'Shooters',
            players: playersList.filter((p) => p.teamSide === 'home'),
          },
          away: {
            teamId: 'away-team-id',
            teamName: 'Ballers',
            players: playersList.filter((p) => p.teamSide === 'away'),
          },
        }),
      });
    });

    await page.route(`**/api/ops/games/${gameId}/quick-player`, async (route) => {
      const body = route.request().postDataJSON();
      const newPlayer = {
        playerId: `player-${Date.now()}`,
        playerName: body.name,
        jerseyNumber: body.jerseyNumber ? Number(body.jerseyNumber) : 23,
        teamSide: body.teamSide,
        teamId: `${body.teamSide}-team-id`,
        pts: 0,
        reb: 0,
        ast: 0,
        stl: 0,
        blk: 0,
        fls: 0,
        min: 0,
      };
      playersList.push(newPlayer);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, player: newPlayer }),
      });
    });

    await page.route(`**/api/ops/games/${gameId}/player-stats`, async (route) => {
      const body = route.request().postDataJSON();
      const p = playersList.find((x) => x.playerId === body.playerId);
      if (p) {
        p[body.stat] = (p[body.stat] || 0) + (body.delta || 1);
        if (body.stat === 'pts') {
          if (p.teamSide === 'away') awayScore += body.delta || 1;
          else homeScore += body.delta || 1;
        }
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, stats: p }),
      });
    });

    await page.route(`**/api/ops/overlay/${gameId}/status`, async (route) => {
      const body = route.request().postDataJSON();
      gameStatus = body.status;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, game: { id: gameId, status: gameStatus } }),
      });
    });

    await page.route(`**/api/public/overlay/${gameId}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          overlay: {
            game_id: gameId,
            period: gameStatus === 'final' ? 4 : 1,
            period_label: gameStatus === 'final' ? 'FINAL' : gameStatus === 'review_pending' ? 'CORR' : 'Q1',
            clock_seconds: gameStatus === 'final' ? 0 : 600,
            clock_running: false,
            home_score: homeScore,
            away_score: awayScore,
            home_fouls: 0,
            away_fouls: 0,
            possession: 'none',
          },
          game: {
            id: gameId,
            status: gameStatus,
            home_team: { id: 'home-team-id', name: 'Shooters' },
            away_team: { id: 'away-team-id', name: 'Ballers' },
          },
        }),
      });
    });

    await page.route(`**/api/ops/overlay/${gameId}/score`, async (route) => {
      const body = route.request().postDataJSON();
      if (body.side === 'away') awayScore += body.delta || 1;
      if (body.side === 'home') homeScore += body.delta || 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          overlay: {
            game_id: gameId,
            home_score: homeScore,
            away_score: awayScore,
            period_label: gameStatus === 'final' ? 'FINAL' : 'Q1',
          },
        }),
      });
    });

    await page.route('**/api/public-config', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          appName: 'SBBL HQ',
          defaultLeague: 'TGIF',
        }),
      });
    });

    // Mock admin session in localStorage
    await page.addInitScript(() => {
      window.localStorage.setItem('sbbl_role_override', 'league_admin');
      window.localStorage.setItem('sbbl_user_email', 'statssbbl@gmail.com');
    });

    // 1. Navigate to Scorekeeper Page
    await page.goto(`/scorekeeper/${gameId}`);
    await page.waitForLoadState('networkidle');

    // Verify Courtside Header and Scoreboard rendered
    await expect(page.getByTestId('live-scoreboard')).toBeVisible();
    await expect(page.getByTestId('courtside-quick-controls')).toBeVisible();
    await expect(page.getByTestId('player-stats-tracker')).toBeVisible();

    // 2. Add Player Walk-on (Marcus Smart #36)
    await page.click('text=+ Add Walk-On Player');
    await page.fill('input[placeholder="#"]', '36');
    await page.fill('input[placeholder*="Marcus Smart"]', 'Marcus Smart');
    await page.click('button:has-text("Add Player")');

    // Verify Player card appeared with #36 and Marcus Smart
    await expect(page.getByText('Marcus Smart')).toBeVisible();
    await expect(page.getByText('#36')).toBeVisible();

    // 3. Record Points for Marcus Smart (+3 3PT)
    await page.click('button:has-text("+3 3PT")');
    await page.waitForTimeout(500);

    // 4. Finalize Game & Reconcile Standings via Dialog Modal
    await page.click('button:has-text("Finalize Game & Reconcile Standings")');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.click('button:has-text("Confirm Finalize")');
    await page.waitForTimeout(600);

    // Verify Official Final status is visible and controls locked
    await expect(page.getByText(/Official Final/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /Reopen Game/i })).toBeVisible();

    // 5. Reopen Game for Correction (transitions to review_pending)
    await page.click('button:has-text("Reopen Game")');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.click('button:has-text("Unlock & Reopen")');
    await page.waitForTimeout(600);

    // Verify "Under Correction — not yet official" banner is active
    await expect(page.getByText(/Under Correction/i)).toBeVisible();

    // 6. Switch to Box Score Tab
    await page.click('button:has-text("Box Score")');
    await expect(page.getByText(/Ballers Box Score/i)).toBeVisible();
    await expect(page.getByText(/Shooters Box Score/i)).toBeVisible();
  });

  test('mobile viewport 390x844 courtside scoring and player management', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const gameId = 'b2222222-3333-4444-5555-666666666666';

    await page.route(`**/api/public/games/${gameId}/player-stats`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          gameId,
          home: { teamId: 'h1', teamName: 'Shooters', players: [] },
          away: { teamId: 'a1', teamName: 'Ballers', players: [] },
        }),
      });
    });

    await page.route(`**/api/public/overlay/${gameId}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          overlay: {
            game_id: gameId,
            period: 1,
            period_label: 'Q1',
            clock_seconds: 600,
            clock_running: false,
            home_score: 18,
            away_score: 22,
          },
          game: {
            id: gameId,
            status: 'live',
            home_team: { id: 'h1', name: 'Shooters' },
            away_team: { id: 'a1', name: 'Ballers' },
          },
        }),
      });
    });

    await page.goto(`/scorekeeper/${gameId}`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('live-scoreboard')).toBeVisible();
    await expect(page.getByTestId('courtside-quick-controls')).toBeVisible();
  });
});
