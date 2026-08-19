import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PLAYWRIGHT_PORT ?? 4173);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;

export default defineConfig({
  testMatch: /.*\.spec\.ts$/,
  testIgnore: [
    '**/potg-vision-test.spec.ts',
    '**/check_iframe.spec.ts',
    '**/login-check.spec.ts',
    '**/task5.spec.ts',
    '**/test_checkout.spec.ts',
    '**/live-data-visual-proof.spec.ts',
    '**/node_modules/**',
  ],
  timeout: 30_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${port}`,
    env: {
      VITE_E2E_BYPASS_ADMIN: 'true',
    },
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // WebKit + mobile-safari run ONLY csp-invariant.spec.ts. They exist as a
    // cross-browser regression shield for the /live CSP fix (e3cce5c) and the
    // canonical home/league routes — not as a general-purpose Safari coverage
    // tier. Other specs (broadcast-overlay, ops-media-*, store, viewer-preflight,
    // stream-validation, build-chaos, ops-auth-ingest-harmony) have selectors
    // and timing assumptions tuned for Chromium and have never been validated
    // against Safari. Adding them here surfaces 15+ unrelated cross-browser
    // bugs that are out-of-scope for this CSP regression shield. Expand
    // testMatch deliberately, one spec at a time, only after the spec is
    // verified to be cross-browser-clean.
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      testMatch: /csp-invariant\.spec\.ts$/,
    },
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 14'] },
      testMatch: /csp-invariant\.spec\.ts$/,
    },
  ],
});
