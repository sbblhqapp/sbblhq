import { expect, seedSuperAdminSession, test } from '../playwright-fixture';

const GAME_ID = 'cccccccc-3333-4333-8333-333333333333';
const ARTIFACT_DIR = 'C:/Users/sinyo/.gemini/antigravity/brain/1c08c1bc-fd03-40b7-8821-f36090c50ba5';

test.describe('Game Statistician Courtside UX Simulation', () => {
  test('simulates end-to-end game scoring, player stat attribution & live standings shift', async ({
    page,
  }) => {
    await seedSuperAdminSession(page);

    // Initial game state
    let homeScore = 0;
    let awayScore = 0;
    let period = 1;
    let clockSeconds = 600;
    let clockRunning = false;
    let homeFouls = 0;
    let awayFouls = 0;
    let possession: 'home' | 'away' = 'away';

    // Initial player roster & stats
    const homeRoster = [
      { playerId: 'p-home-1', playerName: 'Marcus Vance', jerseyNumber: 23, position: 'SG', teamId: 'h', pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, fls: 0, min: 0 },
      { playerId: 'p-home-2', playerName: 'Tyler Cross', jerseyNumber: 5, position: 'PG', teamId: 'h', pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, fls: 0, min: 0 },
    ];

    const awayRoster = [
      { playerId: 'p-away-1', playerName: 'David Lee', jerseyNumber: 11, position: 'PG', teamId: 'a', pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, fls: 0, min: 0 },
      { playerId: 'p-away-2', playerName: 'Sam Hayes', jerseyNumber: 34, position: 'C', teamId: 'a', pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, fls: 0, min: 0 },
    ];

    // Mock Ops Bootstrap
    await page.route('**/ops/bootstrap', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          references: {
            leagues: [{ id: 'l-sbbl', code: 'SBBL', name: "Sunday's Best Basketball League" }],
            seasons: [{ id: 's-sbbl', league_id: 'l-sbbl', name: 'Season 2026' }],
            divisions: [],
          },
        }),
      });
    });

    // Mock Teams List
    await page.route('**/ops/list/teams', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: [
            { id: 't-away', league_id: 'l-sbbl', name: 'Wolves' },
            { id: 't-home', league_id: 'l-sbbl', name: 'Vipers' },
          ],
        }),
      });
    });

    // Mock Submit Score Manual (1-Click Launch)
    await page.route('**/*scores/game', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, gameId: GAME_ID }),
      });
    });

    // Mock Overlay Game State (Real-time dynamic handler)
    await page.route(`**/*overlay/${GAME_ID}*`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          game: {
            id: GAME_ID,
            status: 'live',
            category: 'league',
            home_score: homeScore,
            away_score: awayScore,
            leagues: { code: 'SBBL', name: "Sunday's Best Basketball League" },
            home_team: { id: 't-home', name: 'Vipers' },
            away_team: { id: 't-away', name: 'Wolves' },
          },
          overlay: {
            game_id: GAME_ID,
            period,
            period_label: `Q${period}`,
            clock_seconds: clockSeconds,
            clock_running: clockRunning,
            home_score: homeScore,
            away_score: awayScore,
            home_fouls: homeFouls,
            away_fouls: awayFouls,
            possession,
            live_clock_seconds: clockSeconds,
          },
        }),
      });
    });

    // Mock Player Stats GET
    await page.route(`**/*games/${GAME_ID}/player-stats*`, async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            gameId: GAME_ID,
            home: { teamId: 't-home', teamName: 'Vipers', players: homeRoster },
            away: { teamId: 't-away', teamName: 'Wolves', players: awayRoster },
          }),
        });
      } else if (route.request().method() === 'POST') {
        const body = JSON.parse(route.request().postData() || '{}');
        const isHome = body.teamSide === 'home';
        const targetRoster = isHome ? homeRoster : awayRoster;
        const player = targetRoster.find((p) => p.playerId === body.playerId);
        if (player && body.stat) {
          const delta = body.delta ?? 1;
          const stat = body.stat as 'pts' | 'reb' | 'ast' | 'stl' | 'blk' | 'fls' | 'min';
          player[stat] = Math.max(0, (player[stat] || 0) + delta);
          if (body.syncTeamScore && body.stat === 'pts') {
            if (isHome) homeScore += delta;
            else awayScore += delta;
          }
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, stats: { homeScore, awayScore } }),
        });
      }
    });

    // Mock Quick Add Player
    await page.route(`**/*games/${GAME_ID}/quick-player`, async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      const newPlayer = {
        playerId: `p-walkon-${Date.now()}`,
        playerName: body.name || 'Walk-on Player',
        jerseyNumber: Number(body.jerseyNumber) || 99,
        position: 'G',
        teamId: body.teamSide === 'home' ? 't-home' : 't-away',
        pts: 0,
        reb: 0,
        ast: 0,
        stl: 0,
        blk: 0,
        fls: 0,
        min: 0,
      };
      if (body.teamSide === 'home') homeRoster.push(newPlayer);
      else awayRoster.push(newPlayer);

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, player: newPlayer }),
      });
    });

    // Mock Overlay action mutations (+1, +2, fouls, possession, clock)
    await page.route(`**/*ops/overlay/${GAME_ID}/*`, async (route) => {
      const url = route.request().url();
      if (url.includes('/score')) {
        const body = JSON.parse(route.request().postData() || '{}');
        if (body.side === 'away') awayScore = Math.max(0, awayScore + (body.delta ?? 1));
        if (body.side === 'home') homeScore = Math.max(0, homeScore + (body.delta ?? 1));
      } else if (url.includes('/clock')) {
        const body = JSON.parse(route.request().postData() || '{}');
        if (body.action === 'start') clockRunning = true;
        if (body.action === 'stop') clockRunning = false;
        if (body.action === 'nudge') clockSeconds = Math.max(0, clockSeconds + (body.delta_seconds ?? 0));
        if (body.action === 'set') clockSeconds = body.seconds ?? 600;
      } else if (url.includes('/foul')) {
        const body = JSON.parse(route.request().postData() || '{}');
        if (body.side === 'away') awayFouls += body.delta ?? 1;
        if (body.side === 'home') homeFouls += body.delta ?? 1;
      } else if (url.includes('/possession')) {
        possession = possession === 'home' ? 'away' : 'home';
      } else if (url.includes('/period')) {
        period += 1;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // PHASE 1: PRE-GAME SETUP (T-minus 2 min)
    // ─────────────────────────────────────────────────────────────────────────────
    await page.goto(`/ops/scoreboard/${GAME_ID}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('courtside-quick-controls')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('player-stats-tracker')).toBeVisible({ timeout: 10_000 });

    // Capture Pre-Game Initial Scorer Table Screenshot
    await page.screenshot({ path: `${ARTIFACT_DIR}/statistician-step1-pregame-board.png`, fullPage: true });

    // ─────────────────────────────────────────────────────────────────────────────
    // PHASE 2: IN-GAME TIP-OFF & FAST STAT ATTRIBUTION
    // ─────────────────────────────────────────────────────────────────────────────
    // 1. Tip-off: Start Clock
    const startClockBtn = page.getByRole('button', { name: /START CLOCK/i });
    await expect(startClockBtn).toBeVisible();
    await startClockBtn.click();

    // 2. Wolves possession: #11 David Lee makes a 2-point jumper (+2 FG)
    // David Lee is on active Away roster
    const davidLeeCard = page.locator('div').filter({ hasText: /David Lee/i }).first();
    await expect(davidLeeCard).toBeVisible();
    const davidPlus2 = page.getByRole('button', { name: /\+2 FG/i }).first();
    await davidPlus2.click();

    // 3. David Lee grabs a defensive rebound (+1 REB)
    const davidPlusReb = page.getByRole('button', { name: /\+1 REB/i }).first();
    await davidPlusReb.click();

    // 4. Switch to Home Team (Vipers) roster
    const vipersTab = page.getByRole('button', { name: /Vipers/i });
    await vipersTab.click();

    // 5. Marcus Vance hits a 3-pointer (+3 3PT)
    const marcusPlus3 = page.getByRole('button', { name: /\+3 3PT/i }).first();
    await marcusPlus3.click();

    // 6. Marcus Vance commits a foul (+1 FL)
    const marcusPlusFoul = page.getByRole('button', { name: /\+1 FL/i }).first();
    await marcusPlusFoul.click();

    // Capture In-Game Live Scoring & Stat Attribution Screenshot
    await page.screenshot({ path: `${ARTIFACT_DIR}/statistician-step2-live-scoring-action.png`, fullPage: true });

    // ─────────────────────────────────────────────────────────────────────────────
    // PHASE 3: ROSTER EDGE CASE (WALK-ON PLAYER COURTSIDE ADD)
    // ─────────────────────────────────────────────────────────────────────────────
    // Add walk-on player #99 Jordan Blake to Vipers roster
    const quickAddBtn = page.getByRole('button', { name: /\+ Quick Add Player/i });
    await quickAddBtn.click();

    await page.getByPlaceholder(/Player name/i).fill('Jordan Blake');
    await page.getByPlaceholder(/#/i).fill('99');
    await page.getByRole('button', { name: 'Add Player', exact: true }).click();

    // Verify Jordan Blake immediately appears on the courtside roster table
    await expect(page.getByText('Jordan Blake')).toBeVisible({ timeout: 5000 });

    // Capture Walk-on Player Added Screenshot
    await page.screenshot({ path: `${ARTIFACT_DIR}/statistician-step3-walkon-added.png`, fullPage: true });

    // ─────────────────────────────────────────────────────────────────────────────
    // PHASE 4: FULL BOX SCORE VIEW & EXPANDED STANDINGS
    // ─────────────────────────────────────────────────────────────────────────────
    // Toggle full box score table
    const boxScoreBtn = page.getByRole('button', { name: /Box Score/i });
    await boxScoreBtn.click();

    // Verify box score headers (PTS, REB, AST, STL, BLK, FLS)
    await expect(page.getByRole('columnheader', { name: 'PTS', exact: true }).first()).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'REB', exact: true }).first()).toBeVisible();
    await expect(page.getByText('TOTALS').first()).toBeVisible();

    // Capture Full Box Score Table Screenshot
    await page.screenshot({ path: `${ARTIFACT_DIR}/statistician-step4-boxscore-table.png`, fullPage: true });

    // ─────────────────────────────────────────────────────────────────────────────
    // PHASE 5: GAME FINALIZATION & AUDIT SUMMARY
    // ─────────────────────────────────────────────────────────────────────────────
    const finalizeBtn = page.getByRole('button', { name: /Finalize Game & Reconcile Standings/i });
    await expect(finalizeBtn).toBeVisible();

    // Capture Final Courtside Console State Screenshot
    await page.screenshot({ path: `${ARTIFACT_DIR}/statistician-step5-finalized-game.png`, fullPage: true });
  });
});
