import { expect, test, seedSuperAdminSession } from '../playwright-fixture';

test.describe('SBBL HQ — Full CTO Admin-to-User Ops Console & Pipeline Verification', () => {
  // Deterministic Mock Data Fixtures
  const mockLeagues = [
    { id: 'wbl', name: 'WBL', code: 'WBL', shortName: 'WBL' },
    { id: 'tgif', name: 'TGIF', code: 'TGIF', shortName: 'TGIF' },
    { id: 'sbbl', name: 'SBBL', code: 'SBBL', shortName: 'SBBL' },
  ];

  const mockSeasons = [
    { id: 'season-12', name: 'Season 12', league_id: 'wbl', status: 'active' },
  ];

  const mockDivisions = [
    { id: 'div-alpha', name: 'Division Alpha', season_id: 'season-12' },
  ];

  const mockTeams = [
    {
      id: 'team-gold',
      name: 'Gold Dynasty',
      league_id: 'wbl',
      league_code: 'WBL',
      league_name: 'WBL',
      season_id: 'season-12',
      season_name: 'Season 12',
      division_id: 'div-alpha',
      division_name: 'Division Alpha',
      roster_count: 5,
      players: [
        { id: 'p-1', user_id: 'u-1', display_name: 'Marcus Smart', jersey_number: 23, position: 'G', first_name: 'Marcus', last_name: 'Smart', avatar_url: null },
        { id: 'p-2', user_id: null, display_name: 'Walk-on Sniper', jersey_number: 11, position: 'F', first_name: null, last_name: null, avatar_url: null },
      ],
      coaches: [],
      stats: { wins: 8, losses: 1, gamesPlayed: 9, ptsFor: 810, ptsAgainst: 720, winPct: '0.889', diff: 90 },
    },
    {
      id: 'team-north',
      name: 'Northside Elite',
      league_id: 'wbl',
      league_code: 'WBL',
      league_name: 'WBL',
      season_id: 'season-12',
      season_name: 'Season 12',
      division_id: 'div-alpha',
      division_name: 'Division Alpha',
      roster_count: 5,
      players: [
        { id: 'p-3', user_id: 'u-3', display_name: 'Kobe Walker', jersey_number: 8, position: 'G', first_name: 'Kobe', last_name: 'Walker', avatar_url: null },
      ],
      coaches: [],
      stats: { wins: 6, losses: 3, gamesPlayed: 9, ptsFor: 750, ptsAgainst: 730, winPct: '0.667', diff: 20 },
    },
  ];

  const mockScores = [
    {
      id: 'game-101',
      category: 'league',
      leagueId: 'wbl',
      leagueCode: 'WBL',
      seasonId: 'season-12',
      homeTeamId: 'team-gold',
      awayTeamId: 'team-north',
      homeLabel: 'Gold Dynasty',
      awayLabel: 'Northside Elite',
      homeScore: 88,
      awayScore: 82,
      status: 'final',
      gameDate: '2026-08-18T19:00:00Z',
      eventName: 'WBL Championship Primetime',
      notes: 'Overtime thriller',
    },
    {
      id: 'game-102',
      category: 'league',
      leagueId: 'wbl',
      leagueCode: 'WBL',
      seasonId: 'season-12',
      homeTeamId: 'team-gold',
      awayTeamId: 'team-north',
      homeLabel: 'Gold Dynasty',
      awayLabel: 'Northside Elite',
      homeScore: 0,
      awayScore: 0,
      status: 'scheduled',
      gameDate: '2026-08-25T19:00:00Z',
      eventName: 'WBL Semifinals',
      notes: '',
    },
  ];

  const mockSchedules = [
    {
      id: 'sched-101',
      league_id: 'wbl',
      league_code: 'WBL',
      season_id: 'season-12',
      week: 'Week 8',
      starts_at: '2026-08-25T19:00:00Z',
      venue: 'Saville Community Sports Centre',
      address: '11610 65 Ave NW, Edmonton, AB',
      court: 'Court 1',
      court_name: 'Court 1',
      home_team_name: 'Gold Dynasty',
      away_team_name: 'Northside Elite',
      division_name: 'Division Alpha',
      status: 'scheduled',
    },
  ];

  const mockEvents = [
    {
      id: 'evt-1',
      title: 'SBBL All-Star Gala & 3-Point Contest',
      starts_at: '2026-08-28T18:00:00Z',
      ends_at: '2026-08-28T22:00:00Z',
      location: 'Saville Centre Court 1',
      description: 'Annual showcase and awards night.',
    },
  ];

  const mockStoreProducts = [
    {
      id: 'prod-1',
      name: 'SBBL S12 Championship Jersey',
      description: 'Official custom sublimated tournament jersey',
      price: 65,
      category: 'jerseys',
      currency: 'cad',
      status: 'active',
      image: '/assets/store/jersey-mockup.png',
      league_id: 'sbbl',
    },
  ];

  const mockMedia = [
    {
      id: 'media-1',
      title: 'Week 4 Top 10 Plays',
      category: 'highlights',
      media_type: 'video',
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      thumbnail_url: '/assets/media/thumb1.jpg',
      created_at: '2026-08-17T12:00:00Z',
    },
  ];

  async function setupGlobalMocks(page: any) {
    // Pipeline Health Probe
    await page.route('**/ops/pipeline/health', (route: any) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          overall: 'ok',
          metrics: {
            cache_hit_rate: { value: 98, warn: 80, critical: 50, status: 'ok' },
            stream_latency_ms: { value: 45, warn: 200, critical: 500, status: 'ok' },
            db_conn_pool: { value: 12, warn: 70, critical: 90, status: 'ok' },
          },
          alerts: [],
          checked_at: new Date().toISOString(),
        }),
      })
    );

    // Ops Bootstrap
    await page.route('**/ops/bootstrap', (route: any) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          user: { userId: '00000000-0000-4000-8000-000000000001', email: 'ops-super-admin@test.local' },
          roles: ['super_admin'],
          references: {
            leagues: mockLeagues,
            seasons: mockSeasons,
            divisions: mockDivisions,
            venues: [{ id: 'v-1', name: 'Saville Centre' }],
          },
          importHistory: [],
        }),
      })
    );

    // Ops Entity List (/ops/list/*)
    await page.route('**/ops/list/*', (route: any) => {
      const url = route.request().url();
      if (url.includes('/players')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            data: [
              { id: 'p-1', user_id: 'u-1', display_name: 'Marcus Smart', jersey_number: 23, team_id: 'team-gold', league_id: 'wbl', team_name: 'Gold Dynasty' },
              { id: 'p-2', user_id: null, display_name: 'Walk-on Sniper', jersey_number: 11, team_id: 'team-gold', league_id: 'wbl', team_name: 'Gold Dynasty' },
              { id: 'p-3', user_id: 'u-3', display_name: 'Kobe Walker', jersey_number: 8, team_id: 'team-north', league_id: 'wbl', team_name: 'Northside Elite' },
            ],
          }),
        });
      }
      if (url.includes('/teams')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            data: [
              { id: 'team-gold', name: 'Gold Dynasty', league_id: 'wbl' },
              { id: 'team-north', name: 'Northside Elite', league_id: 'wbl' },
            ],
          }),
        });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: [] }) });
    });

    // Public & API Endpoints
    await page.route('**/api/scores*', (route: any) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, games: mockScores }),
      })
    );

    await page.route('**/api/teams*', (route: any) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, teams: mockTeams }),
      })
    );

    await page.route('**/api/public/schedule*', (route: any) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, data: mockSchedules }),
      })
    );

    await page.route('**/api/public/home*', (route: any) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          league: { id: 'wbl', name: 'WBL', code: 'WBL' },
          season: { id: 'season-12', name: 'Season 12', status: 'active' },
          teams: mockTeams,
          totalTeams: 2,
          totalRostered: 3,
          liveGames: [],
          upcomingGames: [mockScores[1]],
          recentGames: [mockScores[0]],
          totalGames: 2,
          leagues: mockLeagues,
        }),
      })
    );

    await page.route('**/api/public/potg*', (route: any) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, data: [] }),
      })
    );

    await page.route('**/api/store/products*', (route: any) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, products: mockStoreProducts }),
      })
    );

    await page.route('**/api/media*', (route: any) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, media: mockMedia }),
      })
    );
  }

  test('1. Admin Ops Console: Exhaustive 12-Tab Deep Validation & State Integrity', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await seedSuperAdminSession(page);
    await setupGlobalMocks(page);

    // 1. Visit /ops
    await page.goto('/ops', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('h1')).toContainText('Ops Console', { timeout: 15000 });

    const opsNav = page.locator('nav[aria-label="Ops sections"]');
    await expect(opsNav).toBeVisible({ timeout: 10000 });

    const tabsToTest = [
      'Scores',
      'Live Tabulation',
      'Teams',
      'Players',
      'Schedules',
      'Events',
      'Store Media',
      'POTG Parser',
      'Roster Import',
      'Media Library',
      'Import History',
      'Overview',
    ];

    for (const tabName of tabsToTest) {
      const tabButton = opsNav.locator('button', { hasText: new RegExp(`^${tabName}$`, 'i') }).first();
      await expect(tabButton).toBeVisible({ timeout: 5000 });
      await tabButton.click();
      // Assert boundary protection - zero unhandled crashes on any tab
      await expect(page.locator('body')).not.toContainText('We hit a runtime issue and recovered safely.');
      await expect(page.locator('body')).not.toContainText('null is not an object');
      await expect(page.locator('body')).not.toContainText('undefined is not an object');
    }

    // Specific verification on Players Tab (walk-on safety & select option attached)
    await opsNav.locator('button', { hasText: /^Players$/i }).first().click();
    await expect(page.getByRole('heading', { name: 'Players', exact: true })).toBeVisible();
    await expect(page.locator('select option', { hasText: 'Marcus Smart' }).first()).toBeAttached();
    await expect(page.locator('select option', { hasText: 'Walk-on Sniper' }).first()).toBeAttached();

    // Specific verification on Teams Tab
    await opsNav.locator('button', { hasText: /^Teams$/i }).first().click();
    await expect(page.getByRole('heading', { name: 'Teams', exact: true })).toBeVisible();
    await expect(page.locator('select option', { hasText: 'Gold Dynasty' }).first()).toBeAttached();
    await expect(page.locator('select option', { hasText: 'Northside Elite' }).first()).toBeAttached();

    // Capture visual evidence of Ops Console
    await page.screenshot({ path: 'test-results/admin-ops-full-12-tabs.png', fullPage: true });

    // Assert zero critical console errors
    const criticalErrors = consoleErrors.filter(
      (e) => !e.includes('favicon') && !e.includes('manifest.json') && !e.includes('Download the React DevTools') && !e.includes('[supabase] Config mismatch detected')
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test('2. Public User Side: Verify Seeded Data Renders Perfectly across Public Routes', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await setupGlobalMocks(page);

    // ── 2A. Public Schedules Route (/schedules) ───────────────────────────
    await page.goto('/schedules?league=wbl', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('header')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('body')).toContainText('Gold Dynasty');
    await expect(page.locator('body')).toContainText('Northside Elite');
    await expect(page.locator('body')).toContainText('Court 1');
    await page.screenshot({ path: 'test-results/user-public-schedules.png', fullPage: true });

    // ── 2B. Public Scores Route (/scores) ──────────────────────────────────
    await page.goto('/scores?league=wbl', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('body')).toContainText('Gold Dynasty');
    await expect(page.locator('body')).toContainText('Northside Elite');
    await expect(page.locator('body')).toContainText('88');
    await expect(page.locator('body')).toContainText('82');
    await page.screenshot({ path: 'test-results/user-public-scores.png', fullPage: true });

    // ── 2C. Public Teams Route (/teams) ────────────────────────────────────
    await page.goto('/teams?league=wbl', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('body')).toContainText('Gold Dynasty');
    await expect(page.locator('body')).toContainText('Northside Elite');
    // Verify standings math rendering (8W 1L 89%)
    await expect(page.locator('body')).toContainText('8W');
    await expect(page.locator('body')).toContainText('1L');
    await expect(page.locator('body')).toContainText('89%');
    await page.screenshot({ path: 'test-results/user-public-teams.png', fullPage: true });

    // ── 2D. App Home Route (/) ─────────────────────────────────────────────
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('header')).toBeVisible();
    await expect(page.locator('header').getByRole('tab', { name: 'SBBL' })).toBeVisible();
    await expect(page.locator('header').getByRole('tab', { name: 'WBL' })).toBeVisible();
    await expect(page.locator('header').getByRole('tab', { name: 'TGIF' })).toBeVisible();
    await page.screenshot({ path: 'test-results/user-public-home.png', fullPage: true });

    // Assert zero critical console errors
    const criticalErrors = consoleErrors.filter(
      (e) => !e.includes('favicon') && !e.includes('manifest.json') && !e.includes('Download the React DevTools') && !e.includes('[supabase] Config mismatch detected')
    );
    expect(criticalErrors).toHaveLength(0);
  });
});
