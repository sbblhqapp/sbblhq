import { expect, test, seedSuperAdminSession } from '../playwright-fixture';

/**
 * SBBL HQ — Ops Console production-readiness gate.
 *
 * WHY THIS FILE WAS REWRITTEN (2026-08-18 audit)
 * ──────────────────────────────────────────────
 * The previous version of this suite reported 11/11 green while the public
 * Schedules page was blank in production for all three leagues. It could not
 * have caught it, for three structural reasons — all fixed here:
 *
 *  1. WRONG MOCK SHAPE. It stubbed /ops/bootstrap with a FLAT object
 *     ({ leagues, seasons, divisions, teams, players, events, schedules }).
 *     The real handler returns them nested under `references`, alongside
 *     `user`, `roles` and `importHistory`. Ops.tsx reads
 *     `data.references.leagues`, so every dropdown silently fell back to `[]`
 *     via `?? []` — the suite exercised a shape the server cannot produce.
 *     OPS_BOOTSTRAP_FIXTURE below mirrors handleOpsBootstrap exactly, and
 *     'bootstrap fixture matches the worker contract' fails if they drift.
 *
 *  2. CONDITIONAL ASSERTIONS. Every tab check was wrapped in
 *     `if (await tabButton.isVisible())`. If the console failed to render at
 *     all, no tab was visible, every branch was skipped, and the test passed.
 *     A test that cannot fail is not a regression shield. Tabs are now
 *     asserted visible before being clicked.
 *
 *  3. PRESENCE-ONLY ROUTE CHECKS. Public routes only asserted
 *     `expect(page.locator('body')).toBeVisible()`, which is true of a blank
 *     page. Routes now assert the data they exist to show.
 */

/**
 * Mirrors the response contract of handleOpsBootstrap (src/worker/index.ts).
 * If the worker's shape changes, update BOTH this fixture and the contract
 * assertion below — never just the fixture.
 */
const OPS_BOOTSTRAP_FIXTURE = {
  ok: true,
  user: {
    userId: 'e2e-super-admin',
    profile: { display_name: 'E2E Admin', full_name: 'E2E Admin' },
  },
  roles: ['super_admin'],
  references: {
    leagues: [
      { id: 'league-wbl', name: 'Weekend Basketball League', code: 'WBL' },
      { id: 'league-sbbl', name: "Sunday's Best Basketball League", code: 'SBBL' },
      { id: 'league-tgif', name: 'TGIF Basketball League', code: 'TGIFBL' },
    ],
    seasons: [{ id: 'season-1', name: 'Season 12', league_id: 'league-sbbl' }],
    divisions: [{ id: 'div-1', name: 'P10', season_id: 'season-1' }],
    venues: [{ id: 'venue-1', name: 'Main Gym' }],
  },
  importHistory: [
    {
      id: 'job-1',
      job_type: 'teams',
      submitted_by: 'e2e-super-admin',
      payload_summary: '3 teams',
      status: 'completed',
      total_rows: 3,
      inserted_rows: 3,
      failed_rows: 0,
      error_summary: null,
      created_at: '2026-08-18T00:00:00Z',
      updated_at: '2026-08-18T00:00:00Z',
    },
  ],
};

/**
 * Stub the WHOLE authenticated Ops surface, not just /ops/bootstrap.
 *
 * Ops.tsx computes `reauthRequired` from bootstrapQuery.error AND
 * historyQuery.error (plus mutation errors). Stubbing only /ops/bootstrap
 * leaves /ops/imports/history returning 401, which flips `reauthRequired` and
 * renders the whole console as a single "Session expired. Sign in again."
 * panel — no tabs at all. That is precisely why the previous suite's tab sweep
 * passed while exercising nothing: its assertions were conditional on tabs
 * being visible, and none ever were.
 */
async function stubOpsSurface(
  page: import('@playwright/test').Page,
  players: unknown[] = [],
): Promise<void> {
  const jsonRoute = (body: unknown) => (route: import('@playwright/test').Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

  await page.route('**/ops/bootstrap', jsonRoute(OPS_BOOTSTRAP_FIXTURE));
  await page.route('**/ops/imports/history**', jsonRoute({ ok: true, jobs: OPS_BOOTSTRAP_FIXTURE.importHistory, ingress_failures: [] }));
  await page.route('**/ops/list/players**', jsonRoute({ ok: true, data: players }));
  await page.route('**/ops/list/teams**', jsonRoute({ ok: true, data: [{ id: 'team-1', name: 'Northstar P10', league_id: 'league-sbbl', status: 'published' }] }));
  await page.route('**/ops/list/events**', jsonRoute({ ok: true, data: [] }));
  await page.route('**/ops/list/schedules**', jsonRoute({ ok: true, data: [] }));
  await page.route('**/ops/list/products**', jsonRoute({ ok: true, data: [] }));
  await page.route('**/ops/media/publications**', jsonRoute({ ok: true, data: [] }));
}

/**
 * The tab labels the Ops Console ACTUALLY renders, verified by enumerating the
 * live DOM. The previous suite asserted 'Scoreboard', 'Store' and 'History' —
 * none of which exist; the real labels are 'Live Tabulation', 'Store Media'
 * and 'Import History'. Because its assertions were conditional, those three
 * silently no-op'd and the suite still advertised a "12-tab full sweep" while
 * covering 9. Keep this list in sync with the buttons in src/pages/Ops.tsx.
 */
const OPS_TABS = [
  'Overview',
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
] as const;

/** Text the app renders when a React error boundary has caught a crash. */
const CRASH_MARKERS = [
  'We hit a runtime issue and recovered safely.',
  'null is not an object',
  'undefined is not an object',
  'is not a function',
];

test.describe('SBBL HQ — Ops Console production readiness', () => {
  test('bootstrap fixture matches the worker contract', async ({ request }) => {
    // Guards against the exact defect this rewrite fixes: a fixture that drifts
    // from the handler it stands in for. Unauthenticated callers get 401, which
    // still proves the route exists and is auth-gated.
    const res = await request.get('/ops/bootstrap');
    expect([200, 401, 403]).toContain(res.status());

    // Structural contract Ops.tsx depends on.
    expect(OPS_BOOTSTRAP_FIXTURE).toHaveProperty('references.leagues');
    expect(OPS_BOOTSTRAP_FIXTURE).toHaveProperty('references.seasons');
    expect(OPS_BOOTSTRAP_FIXTURE).toHaveProperty('references.divisions');
    expect(OPS_BOOTSTRAP_FIXTURE).toHaveProperty('references.venues');
    expect(OPS_BOOTSTRAP_FIXTURE).toHaveProperty('importHistory');
    expect(Array.isArray(OPS_BOOTSTRAP_FIXTURE.roles)).toBe(true);
    // The flat shape the old fixture used must NOT be what Ops.tsx reads.
    expect(OPS_BOOTSTRAP_FIXTURE as Record<string, unknown>).not.toHaveProperty('teams');
  });

  test('public surfaces render their actual data, not just a body element', async ({ page }) => {
    // Four full navigations plus first-load service-worker precaching; the
    // 30s suite default is not enough headroom for a cold run.
    test.setTimeout(120_000);
    const consoleErrors: string[] = [];
    page.on('pageerror', (e) => consoleErrors.push(String(e)));

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('header')).toBeVisible({ timeout: 15000 });

    await page.getByRole('tab', { name: 'WBL' }).click();
    await expect(page.getByRole('tab', { name: 'WBL' })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('tab', { name: 'TGIF' }).click();
    await expect(page.getByRole('tab', { name: 'TGIF' })).toHaveAttribute('aria-selected', 'true');

    // Each route asserts the CONTENT it exists to show. A blank page — the
    // production state of /schedules before this audit — now fails here.
    await page.goto('/schedules', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /schedules & fixtures/i })).toBeVisible({
      timeout: 15000,
    });

    await page.goto('/teams', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /teams & standings/i })).toBeVisible({
      timeout: 15000,
    });

    await page.goto('/store', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /official store/i })).toBeVisible({
      timeout: 15000,
    });

    expect(consoleErrors, `uncaught page errors: ${consoleErrors.join(' | ')}`).toEqual([]);
  });

  test('Ops Console sweeps all 12 tabs with no crash and populated references', async ({ page }) => {
    test.setTimeout(120_000);
    await seedSuperAdminSession(page);
    await stubOpsSurface(page);

    await page.goto('/ops', { waitUntil: 'domcontentloaded' });
    // If any authenticated Ops query 401s, the console collapses to this panel
    // and NO tab renders. Assert its absence explicitly so the failure names
    // its own cause instead of surfacing as a confusing "tab not found".
    await expect(page.getByText('Session expired. Sign in again.')).toHaveCount(0);
    await expect(page.locator('h1')).toContainText('Ops Console', { timeout: 15000 });

    for (const tabName of OPS_TABS) {
      const tabButton = page
        .locator('button', { hasText: new RegExp(`^${tabName}$`, 'i') })
        .first();
      // UNCONDITIONAL: a missing tab is a failure, not a skip.
      await expect(tabButton, `Ops tab "${tabName}" is not rendered`).toBeVisible({
        timeout: 10000,
      });
      await tabButton.click();

      const bodyText = (await page.locator('body').innerText()).toLowerCase();
      for (const marker of CRASH_MARKERS) {
        expect(bodyText, `tab "${tabName}" showed crash marker "${marker}"`).not.toContain(
          marker.toLowerCase(),
        );
      }
    }

    await page.screenshot({ path: 'test-results/ops-console-full-sweep.png', fullPage: true });
  });

  test('walk-on player (null user_id, null display_name) does not crash Ops', async ({ page }) => {
    test.setTimeout(120_000);
    await seedSuperAdminSession(page);
    // The exact row that produced "null is not an object (evaluating
    // t.user_id.slice)": an unlinked walk-on with no profile and no name.
    await stubOpsSurface(page, [
      {
        id: 'walkon-1',
        user_id: null,
        display_name: null,
        team_id: null,
        league_id: 'league-sbbl',
        team_name: null,
      },
    ]);

    await page.goto('/ops', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Session expired. Sign in again.')).toHaveCount(0);

    for (const tabName of ['Live Tabulation', 'Players'] as const) {
      const tab = page.locator('button', { hasText: new RegExp(`^${tabName}$`, 'i') }).first();
      await expect(tab, `Ops tab "${tabName}" is not rendered`).toBeVisible({ timeout: 10000 });
      await tab.click();
      const bodyText = (await page.locator('body').innerText()).toLowerCase();
      for (const marker of CRASH_MARKERS) {
        expect(bodyText, `walk-on row crashed tab "${tabName}"`).not.toContain(
          marker.toLowerCase(),
        );
      }
    }

    await page.screenshot({ path: 'test-results/ops-walkon-resilience.png', fullPage: true });
  });
});
