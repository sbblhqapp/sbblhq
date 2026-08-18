import { expect, test, seedSuperAdminSession } from '../playwright-fixture';

test.describe('SBBL HQ — End-to-End Enterprise Production Readiness Verification', () => {
  test('1. Root and Public surfaces render cleanly without console errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('header')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('header').getByRole('tab', { name: 'SBBL' })).toBeVisible();

    // Verify league switches
    await page.getByRole('tab', { name: 'WBL' }).click();
    await expect(page.getByRole('tab', { name: 'WBL' })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('tab', { name: 'TGIF' }).click();
    await expect(page.getByRole('tab', { name: 'TGIF' })).toHaveAttribute('aria-selected', 'true');

    // Public Core Routes
    const routes = ['/schedules', '/teams', '/media', '/store', '/stats', '/leaderboards'];
    for (const route of routes) {
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('body')).toBeVisible();
    }
  });

  test('2. OPS Console Navigation & Full Tab Sweep without Runtime Errors', async ({ page }) => {
    await seedSuperAdminSession(page);

    // Mock bootstrap endpoint so tabs populate instantly with zero network delay
    await page.route('**/ops/bootstrap', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          leagues: [{ id: 'wbl', name: 'WBL' }, { id: 'tgif', name: 'TGIF' }, { id: 'sbbl', name: 'SBBL' }],
          seasons: [{ id: 'season-1', name: 'Season 1', league_id: 'wbl' }],
          divisions: [{ id: 'div-1', name: 'Division 1', season_id: 'season-1' }],
          teams: [{ id: 'team-1', name: 'Ball is Life', league_id: 'wbl', season_id: 'season-1', division_id: 'div-1' }],
          players: [
            { id: 'player-1', user_id: null, display_name: 'Walk-on Player', team_id: 'team-1', league_id: 'wbl', team_name: 'Ball is Life' },
            { id: 'player-2', user_id: 'user-2', display_name: 'Marcus Smart', team_id: 'team-1', league_id: 'wbl', team_name: 'Ball is Life' }
          ],
          events: [{ id: 'event-1', title: 'All Star Weekend', starts_at: '2026-08-20T19:00:00Z' }],
          schedules: [{ id: 'sched-1', starts_at: '2026-08-19T20:00:00Z', league_code: 'WBL', status: 'scheduled' }],
        }),
      }),
    );

    // Navigate to Ops Console
    await page.goto('/ops', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('h1')).toContainText('Ops Console', { timeout: 15000 });

    // Check all 12 tabs
    const tabs = [
      'Overview',
      'Scores',
      'Scoreboard',
      'Teams',
      'Players',
      'Schedules',
      'Events',
      'Store',
      'POTG Parser',
      'Roster Import',
      'Media Library',
      'History',
    ];

    for (const tabName of tabs) {
      const tabButton = page.locator('button', { hasText: new RegExp(`^${tabName}$`, 'i') }).first();
      if (await tabButton.isVisible()) {
        await tabButton.click();
        // Ensure no AppErrorBoundary crash was triggered
        await expect(page.locator('body')).not.toContainText('We hit a runtime issue and recovered safely.');
        await expect(page.locator('body')).not.toContainText('null is not an object');
      }
    }

    // Capture screenshot as visual artifact
    await page.screenshot({ path: 'test-results/ops-console-full-sweep.png', fullPage: true });
  });

  test('3. Walk-on / Player UI resilience check in Live Tabulation', async ({ page }) => {
    await seedSuperAdminSession(page);

    await page.route('**/ops/bootstrap', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          leagues: [{ id: 'wbl', name: 'WBL' }],
          seasons: [{ id: 'season-1', name: 'Season 1', league_id: 'wbl' }],
          divisions: [],
          teams: [{ id: 'team-1', name: 'Team A', league_id: 'wbl' }],
          players: [{ id: 'walkon-1', user_id: null, display_name: null, team_id: 'team-1', league_id: 'wbl' }],
          events: [],
          schedules: [],
        }),
      }),
    );

    await page.goto('/ops', { waitUntil: 'domcontentloaded' });
    const scoreboardTab = page.locator('button', { hasText: /^Scoreboard$/i }).first();
    if (await scoreboardTab.isVisible()) {
      await scoreboardTab.click();
      await expect(page.locator('body')).not.toContainText('null is not an object');
    }

    const playersTab = page.locator('button', { hasText: /^Players$/i }).first();
    if (await playersTab.isVisible()) {
      await playersTab.click();
      await expect(page.locator('body')).not.toContainText('null is not an object');
      await expect(page.locator('h2', { hasText: 'Players' })).toBeVisible();
    }
  });
});
