import { expect, seedSuperAdminSession, test } from '../playwright-fixture';

const ARTIFACT_DIR = 'C:/Users/sinyo/.gemini/antigravity/brain/1c08c1bc-fd03-40b7-8821-f36090c50ba5';

test.describe('Ops Media Library Autonomous 30-Day Purge UI Flow', () => {
  test('renders 30-day purge controls, previews expired media, and executes physical purge', async ({
    page,
  }) => {
    await seedSuperAdminSession(page);

    // Mock public-config to ensure clean bootstrap
    await page.route('**/api/public-config', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, appName: 'SBBL HQ', defaultLeague: 'SBBL' }),
      });
    });

    // Mock Ops Bootstrap
    await page.route('**/ops/bootstrap', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          user: { userId: 'ops-admin-user', email: 'admin@sbbl-hq.icu' },
          roles: ['super_admin'],
          references: {
            leagues: [{ id: 'l-sbbl', code: 'SBBL', name: "Sunday's Best Basketball League" }],
            seasons: [],
            divisions: [],
          },
          importHistory: [],
        }),
      });
    });

    // Mock Media List
    await page.route('**/ops/list/media*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: [
            {
              id: 'pub-archived-old',
              title: 'Championship 2025 Highlights',
              surface: 'media_feed',
              status: 'archived',
              published_at: null,
              archived_at: '2026-06-01T00:00:00Z',
              render_payload: { url: 'https://example.supabase.co/storage/v1/object/public/media/potg/champ.jpg' },
              media_assets: { id: 'asset-1', metadata: {} },
            },
          ],
        }),
      });
    });

    // Mock Purge Preview GET
    await page.route('**/ops/media/archived-purge-preview*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          totalEligible: 3,
          totalStorageFiles: 5,
          retentionDays: 30,
          cutoffDate: '2026-07-16T00:00:00Z',
          publications: [
            {
              id: 'pub-archived-1',
              title: 'Old Tournament Promo Graphic',
              surface: 'event',
              leagueCode: 'SBBL',
              archivedAt: '2026-06-10T12:00:00Z',
              daysArchived: 66,
              storagePaths: ['media/events/promo.png', 'media/thumbnails/promo-thumb.jpg'],
            },
            {
              id: 'pub-archived-2',
              title: 'Week 2 POTG Card - David Lee',
              surface: 'potg',
              leagueCode: 'SBBL',
              archivedAt: '2026-07-01T12:00:00Z',
              daysArchived: 45,
              storagePaths: ['media/potg/david-lee.jpg'],
            },
            {
              id: 'pub-archived-3',
              title: 'Warmup Drill Video Clip',
              surface: 'media_feed',
              leagueCode: 'WBL',
              archivedAt: '2026-07-10T12:00:00Z',
              daysArchived: 36,
              storagePaths: ['media/clips/warmup.mp4', 'media/thumbnails/warmup-thumb.jpg'],
            },
          ],
        }),
      });
    });

    // Mock Purge Execute POST
    await page.route('**/ops/media/archived-purge-execute', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          purgedPublications: 3,
          purgedAssets: 3,
          storageFilesRemoved: 5,
          purgedIds: ['pub-archived-1', 'pub-archived-2', 'pub-archived-3'],
          removedStoragePaths: [
            'media/events/promo.png',
            'media/thumbnails/promo-thumb.jpg',
            'media/potg/david-lee.jpg',
            'media/clips/warmup.mp4',
            'media/thumbnails/warmup-thumb.jpg',
          ],
          criteria: { retentionDays: 30, executionMode: 'manual' },
        }),
      });
    });

    // Navigate to Ops Console
    await page.goto('/ops', { waitUntil: 'domcontentloaded' });

    // Open Media Library Tab from Ops sections navigation
    const mediaNavBtn = page
      .getByRole('navigation', { name: 'Ops sections' })
      .getByRole('button', { name: 'Media Library', exact: true });
    await expect(mediaNavBtn).toBeVisible({ timeout: 10_000 });
    await mediaNavBtn.click();

    // Verify 30-Day Purge button is visible
    const purgeTriggerBtn = page.getByRole('button', { name: /30-Day Purge/i });
    await expect(purgeTriggerBtn).toBeVisible({ timeout: 10_000 });

    // Click 30-Day Purge button
    await purgeTriggerBtn.click();

    // Verify Modal Header & Policy Details
    await expect(page.getByText('Autonomous 30-Day Archived Media Purge')).toBeVisible();
    await expect(page.getByText('Autonomous Cloudflare Cron & Storage Purge Policy')).toBeVisible();
    await expect(page.getByText('Published/Draft: Immune')).toBeVisible();

    // Verify Preview numbers
    await expect(page.getByText('3 items')).toBeVisible();
    await expect(page.getByText('5 files')).toBeVisible();
    await expect(page.getByText('Old Tournament Promo Graphic')).toBeVisible();

    // Capture Purge Preview Screenshot
    await page.screenshot({ path: `${ARTIFACT_DIR}/media-purge-modal-preview.png`, fullPage: true });

    // Execute Manual Purge
    const purgeNowBtn = page.getByRole('button', { name: /Purge 3 Expired/i });
    await expect(purgeNowBtn).toBeVisible();
    await purgeNowBtn.click();

    // Verify Success Message
    await expect(
      page.getByText('Successfully purged 3 expired publications and 5 storage objects.')
    ).toBeVisible({ timeout: 5000 });

    // Capture Post-Purge Success Screenshot
    await page.screenshot({ path: `${ARTIFACT_DIR}/media-purge-modal-success.png`, fullPage: true });
  });

  test('mobile viewport (390x844) renders ergonomic, responsive touch-first purge UI', async ({
    page,
  }) => {
    // Set mobile viewport (iPhone 14/15)
    await page.setViewportSize({ width: 390, height: 844 });
    await seedSuperAdminSession(page);

    await page.route('**/api/public-config', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, appName: 'SBBL HQ', defaultLeague: 'SBBL' }),
      });
    });

    await page.route('**/ops/bootstrap', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          user: { userId: 'ops-admin-user', email: 'admin@sbbl-hq.icu' },
          roles: ['super_admin'],
          references: { leagues: [], seasons: [], divisions: [] },
          importHistory: [],
        }),
      });
    });

    await page.route('**/ops/list/media*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: [
            {
              id: 'pub-archived-mobile',
              title: 'Mobile Stream Replay Clip',
              surface: 'media_feed',
              status: 'archived',
              published_at: null,
              archived_at: '2026-06-15T00:00:00Z',
              render_payload: { url: 'https://example.supabase.co/storage/v1/object/public/media/potg/mobile.jpg' },
              media_assets: { id: 'asset-m', metadata: {} },
            },
          ],
        }),
      });
    });

    await page.route('**/ops/media/archived-purge-preview*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          totalEligible: 2,
          totalStorageFiles: 4,
          retentionDays: 30,
          cutoffDate: '2026-07-16T00:00:00Z',
          publications: [
            {
              id: 'pub-m-1',
              title: 'TGIF Championship Highlights',
              surface: 'media_feed',
              leagueCode: 'TGIF',
              archivedAt: '2026-06-20T12:00:00Z',
              daysArchived: 56,
              storagePaths: ['media/clips/tgif-finals.mp4', 'media/thumbnails/tgif.jpg'],
            },
            {
              id: 'pub-m-2',
              title: 'Week 5 POTG Highlight Reel',
              surface: 'potg',
              leagueCode: 'SBBL',
              archivedAt: '2026-07-02T12:00:00Z',
              daysArchived: 44,
              storagePaths: ['media/potg/week5.jpg', 'media/thumbnails/week5-thumb.jpg'],
            },
          ],
        }),
      });
    });

    // Navigate on mobile
    await page.goto('/ops', { waitUntil: 'domcontentloaded' });

    // Open Media Library tab
    const mediaNavBtn = page
      .getByRole('navigation', { name: 'Ops sections' })
      .getByRole('button', { name: 'Media Library', exact: true });
    await expect(mediaNavBtn).toBeVisible({ timeout: 10_000 });
    await mediaNavBtn.click();

    // Verify 30-Day Purge button is touch-accessible
    const purgeBtn = page.getByRole('button', { name: /30-Day Purge/i });
    await expect(purgeBtn).toBeVisible();

    // Capture Mobile Media Library Tab
    await page.screenshot({ path: `${ARTIFACT_DIR}/media-library-mobile-view.png`, fullPage: false });

    // Open Purge Modal
    await purgeBtn.click();

    // Verify Modal on Mobile
    await expect(page.getByText('Autonomous 30-Day Archived Media Purge')).toBeVisible();
    await expect(page.getByText('2 items')).toBeVisible();
    await expect(page.getByText('4 files')).toBeVisible();

    // Capture Mobile Purge Modal Screenshot
    await page.screenshot({ path: `${ARTIFACT_DIR}/media-purge-modal-mobile.png`, fullPage: false });
  });
});
