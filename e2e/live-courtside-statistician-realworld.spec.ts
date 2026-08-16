/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect } from '@playwright/test';
import path from 'node:path';

const ARTIFACT_DIR = 'C:/Users/sinyo/.gemini/antigravity/brain/1c08c1bc-fd03-40b7-8821-f36090c50ba5';

test.describe('Real-World Comprehensive Live Courtside Tabulation & Scoreboard Suite', () => {
  test('Complete 4-Quarter Match Simulation: Pre-Game, Walk-Ons, Box Score, Live Standings, Finalize, Reopen Correction, and Re-Finalize', async ({ page }) => {
    const gameId = 'c3333333-4444-5555-6666-777777777777';
    let gameStatus = 'live';
    let periodLabel = 'Q1';
    let clockSeconds = 600;
    let clockRunning = false;
    let homeScore = 0;
    let awayScore = 0;
    let homeFouls = 0;
    let awayFouls = 0;
    let possession: 'home' | 'away' | 'none' = 'none';

    const playersList: any[] = [
      { playerId: 'p-away-1', playerName: 'Alex Caruso', jerseyNumber: 6, teamSide: 'away', teamId: 'away-team-id', pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, fls: 0, min: 0 },
      { playerId: 'p-away-2', playerName: 'DeMar DeRozan', jerseyNumber: 11, teamSide: 'away', teamId: 'away-team-id', pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, fls: 0, min: 0 },
      { playerId: 'p-home-1', playerName: 'Stephen Curry', jerseyNumber: 30, teamSide: 'home', teamId: 'home-team-id', pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, fls: 0, min: 0 },
      { playerId: 'p-home-2', playerName: 'Klay Thompson', jerseyNumber: 11, teamSide: 'home', teamId: 'home-team-id', pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, fls: 0, min: 0 },
    ];

    // Mock API routes
    await page.route(`**/api/public/games/${gameId}/player-stats`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          gameId,
          home: {
            teamId: 'home-team-id',
            teamName: 'Golden Shooters',
            players: playersList.filter((p) => p.teamSide === 'home'),
          },
          away: {
            teamId: 'away-team-id',
            teamName: 'Chicago Ballers',
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
        jerseyNumber: body.jerseyNumber ? Number(body.jerseyNumber) : 99,
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
        if (body.stat === 'fls') {
          if (p.teamSide === 'away') awayFouls += body.delta || 1;
          else homeFouls += body.delta || 1;
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
      if (gameStatus === 'final') {
        periodLabel = 'FINAL';
        clockRunning = false;
        clockSeconds = 0;
      } else if (gameStatus === 'review_pending') {
        periodLabel = 'CORR';
      } else if (gameStatus === 'live') {
        periodLabel = 'Q1';
      }
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
            period: periodLabel === 'FINAL' ? 4 : periodLabel === 'Q2' ? 2 : periodLabel === 'Q3' ? 3 : periodLabel === 'Q4' ? 4 : 1,
            period_label: periodLabel,
            clock_seconds: clockSeconds,
            clock_running: clockRunning,
            home_score: homeScore,
            away_score: awayScore,
            home_fouls: homeFouls,
            away_fouls: awayFouls,
            possession,
          },
          game: {
            id: gameId,
            status: gameStatus,
            home_team: { id: 'home-team-id', name: 'Golden Shooters' },
            away_team: { id: 'away-team-id', name: 'Chicago Ballers' },
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
            period_label: periodLabel,
          },
        }),
      });
    });

    await page.route(`**/api/ops/overlay/${gameId}/clock`, async (route) => {
      const body = route.request().postDataJSON();
      if (body.action === 'start') clockRunning = true;
      if (body.action === 'stop') clockRunning = false;
      if (body.action === 'adjust') clockSeconds = Math.max(0, clockSeconds + (body.seconds || 0));
      if (body.action === 'set') clockSeconds = body.seconds ?? clockSeconds;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, overlay: { game_id: gameId, clock_seconds: clockSeconds, clock_running: clockRunning } }),
      });
    });

    await page.route(`**/api/ops/overlay/${gameId}/fouls`, async (route) => {
      const body = route.request().postDataJSON();
      if (body.side === 'away') awayFouls = Math.max(0, awayFouls + (body.delta || 1));
      if (body.side === 'home') homeFouls = Math.max(0, homeFouls + (body.delta || 1));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, overlay: { game_id: gameId, home_fouls: homeFouls, away_fouls: awayFouls } }),
      });
    });

    await page.route(`**/api/ops/overlay/${gameId}/patch`, async (route) => {
      const body = route.request().postDataJSON();
      if (body.possession) possession = body.possession;
      if (body.period_label) periodLabel = body.period_label;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, overlay: { game_id: gameId, possession, period_label: periodLabel } }),
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

    await page.addInitScript(() => {
      window.localStorage.setItem('sbbl_role_override', 'league_admin');
      window.localStorage.setItem('sbbl_user_email', 'statssbbl@gmail.com');
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // STEP 1: PRE-GAME SCOREBOARD INITIALIZATION
    // ─────────────────────────────────────────────────────────────────────────────
    await page.goto(`/scorekeeper/${gameId}`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('live-scoreboard')).toBeVisible();
    await expect(page.getByTestId('courtside-quick-controls')).toBeVisible();
    await expect(page.getByTestId('player-stats-tracker')).toBeVisible();

    // Verify Initial Period Q1 and Teams
    await expect(page.getByText('Chicago Ballers').first()).toBeVisible();
    await expect(page.getByText('Golden Shooters').first()).toBeVisible();

    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'realworld-step1-pregame-initial.png'), fullPage: true });

    // ─────────────────────────────────────────────────────────────────────────────
    // STEP 2: CLOCK TIP-OFF & IN-GAME 1-TAP SCORING ACTION
    // ─────────────────────────────────────────────────────────────────────────────
    // 1. Tip-off: Start Clock
    const startClockBtn = page.getByRole('button', { name: /START CLOCK/i });
    await expect(startClockBtn).toBeVisible();
    await startClockBtn.click();
    await page.waitForTimeout(300);

    // 2. Set Possession to Away
    await page.click('button:has-text("POSSESSION") >> nth=0');
    await page.waitForTimeout(300);

    // 3. Score attribution: Away #11 DeMar DeRozan makes a 2PT jumper (+2 FG)
    await page.click('button:has-text("+2 FG") >> nth=0');
    await page.waitForTimeout(400);

    // 4. Home #30 Stephen Curry responds with a 3PT shot (+3 3PT)
    // Switch to Home team tab on Player Tracker
    await page.getByRole('button', { name: /Golden Shooters/i }).first().click();
    await page.waitForTimeout(300);
    await page.click('button:has-text("+3 3PT") >> nth=0');
    await page.waitForTimeout(400);

    // 5. Add a team foul to Away team
    await page.click('button[aria-label="Away plus 1 foul"]');
    await page.waitForTimeout(300);

    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'realworld-step2-live-scoring-action.png'), fullPage: true });

    // ─────────────────────────────────────────────────────────────────────────────
    // STEP 3: COURTSIDE WALK-ON PLAYER REGISTRATION (ZERO FRICTION)
    // ─────────────────────────────────────────────────────────────────────────────
    // Rapidly register walk-on player #99 Jordan Poole on Golden Shooters
    const addWalkOnBtn = page.getByRole('button', { name: /\+ (Quick Add|Add Walk-On) Player/i });
    await expect(addWalkOnBtn).toBeVisible();
    await addWalkOnBtn.click();

    await page.getByPlaceholder(/#/i).fill('99');
    await page.getByPlaceholder(/Marcus Smart/i).fill('Jordan Poole');
    await page.getByRole('button', { name: 'Add Player', exact: true }).click();
    await page.waitForTimeout(600);

    // Verify Jordan Poole appears on courtside roster table
    await expect(page.getByText('Jordan Poole')).toBeVisible();
    await expect(page.getByText('#99')).toBeVisible();

    // Immediately attribute +2 FG to Jordan Poole
    await page.click('button:has-text("+2 FG") >> nth=2');
    await page.waitForTimeout(400);

    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'realworld-step3-walkon-player-added.png'), fullPage: true });

    // ─────────────────────────────────────────────────────────────────────────────
    // STEP 4: RECONCILED BOX SCORE VIEW WITH TOTALS AUDIT
    // ─────────────────────────────────────────────────────────────────────────────
    const boxScoreTab = page.getByRole('button', { name: /Box Score/i });
    await boxScoreTab.click();
    await page.waitForTimeout(400);

    // Verify Box Score columns and Totals
    await expect(page.getByText(/Chicago Ballers Box Score/i)).toBeVisible();
    await expect(page.getByText(/Golden Shooters Box Score/i)).toBeVisible();
    await expect(page.getByText('TOTALS').first()).toBeVisible();

    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'realworld-step4-boxscore-reconciled.png'), fullPage: true });

    // ─────────────────────────────────────────────────────────────────────────────
    // STEP 5: RADIX MODAL FINALIZATION & STANDINGS RECONCILIATION
    // ─────────────────────────────────────────────────────────────────────────────
    // Switch back to Away team tab on Player Tracker
    await page.getByRole('button', { name: /Chicago Ballers/i }).first().click();
    await page.waitForTimeout(300);

    const finalizeBtn = page.getByRole('button', { name: /Finalize Game & Reconcile Standings/i });
    await expect(finalizeBtn).toBeVisible();
    await finalizeBtn.click();

    // Verify Radix Modal Dialog is rendered with safety confirmation
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText(/Mark this game as FINAL/i)).toBeVisible();

    // Confirm finalization
    await page.click('button:has-text("Confirm Finalize")');
    await page.waitForTimeout(700);

    // Verify Official Final Lock State
    await expect(page.getByText(/Official Final/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /Reopen Game/i })).toBeVisible();

    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'realworld-step5-game-finalized.png'), fullPage: true });

    // ─────────────────────────────────────────────────────────────────────────────
    // STEP 6: STATE-AWARE CORRECTION & REOPEN LIFECYCLE (review_pending)
    // ─────────────────────────────────────────────────────────────────────────────
    // Scorekeeper needs to reopen to correct a stat
    const reopenBtn = page.getByRole('button', { name: /Reopen Game/i });
    await reopenBtn.click();

    // Verify Radix Unlock Confirmation Dialog
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText(/Reopen Game for Correction/i)).toBeVisible();

    await page.click('button:has-text("Unlock & Reopen")');
    await page.waitForTimeout(700);

    // Verify "Under Correction — not yet official" status banner is prominently glowing
    await expect(page.getByText(/Under Correction — not yet official/i)).toBeVisible();

    // Make corrective score adjustment (+1 FT for Golden Shooters)
    await page.click('button[aria-label="Home plus 1 point"]');
    await page.waitForTimeout(400);

    // Re-finalize game after correction
    await page.click('button:has-text("Finalize Game & Reconcile Standings")');
    await page.waitForTimeout(300);
    await page.click('button:has-text("Confirm Finalize")');
    await page.waitForTimeout(700);

    // Verify return to Official Final
    await expect(page.getByText(/Official Final/i)).toBeVisible();

    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'realworld-step6-reopened-and-corrected.png'), fullPage: true });
  });

  test('Mobile Viewport (390x844) Ergonomics & Touch-First Courtside Controls', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const gameId = 'd4444444-5555-6666-7777-888888888888';

    await page.route(`**/api/public/games/${gameId}/player-stats`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          gameId,
          home: {
            teamId: 'h1',
            teamName: 'Lakers',
            players: [
              { playerId: 'p1', playerName: 'LeBron James', jerseyNumber: 23, teamId: 'h1', pts: 18, reb: 7, ast: 9, stl: 2, blk: 1, fls: 2, min: 24 },
            ],
          },
          away: {
            teamId: 'a1',
            teamName: 'Celtics',
            players: [
              { playerId: 'p2', playerName: 'Jayson Tatum', jerseyNumber: 0, teamId: 'a1', pts: 22, reb: 8, ast: 5, stl: 1, blk: 1, fls: 1, min: 26 },
            ],
          },
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
            period: 3,
            period_label: 'Q3',
            clock_seconds: 345,
            clock_running: true,
            home_score: 68,
            away_score: 72,
            home_fouls: 3,
            away_fouls: 2,
            possession: 'home',
          },
          game: {
            id: gameId,
            status: 'live',
            home_team: { id: 'h1', name: 'Lakers' },
            away_team: { id: 'a1', name: 'Celtics' },
          },
        }),
      });
    });

    await page.route('**/api/public-config', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ appName: 'SBBL HQ', defaultLeague: 'TGIF' }),
      });
    });

    await page.goto(`/scorekeeper/${gameId}`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('live-scoreboard')).toBeVisible();
    await expect(page.getByTestId('courtside-quick-controls')).toBeVisible();
    await expect(page.getByTestId('player-stats-tracker')).toBeVisible();

    // Verify touch action buttons are accessible
    await expect(page.getByRole('button', { name: '+1 FT' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: '+2 FG' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: '+3 3PT' }).first()).toBeVisible();

    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'realworld-step7-mobile-courtside-390x844.png'), fullPage: true });
  });
});
