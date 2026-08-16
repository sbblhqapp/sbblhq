import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

/**
 * Data-pipeline guardrail (see docs/protocols/no-mock-in-production.md).
 *
 * Production UI code MUST read live data from the worker/Supabase pipeline —
 * never from hard-coded fixtures. The fixture files under src/data/mock.ts,
 * src/data/schedules.ts, and src/data/teams.ts exist ONLY for tests and
 * Storybook. Importing them from src/pages/** or src/components/** hides
 * data-pipeline regressions behind fake data and has caused repeated
 * production incidents where users saw stale mock leaderboards/stats.
 *
 * The blocklist below is enforced at lint time. Tests (src/test/** and
 * *.test.*) are allowed to import the fixtures — they are the intended
 * consumers. If you need a static reference list (leagues, routes), use
 * src/lib/leagues.ts (LEAGUE_REGISTRY) — the canonical source.
 */
const DATA_FIXTURE_PATTERNS = [
  {
    group: [
      "@/data/mock",
      "@/data/mock.*",
      "@/data/schedules",
      "@/data/teams",
      "**/data/mock",
      "**/data/mock.*",
      "**/data/schedules",
      "**/data/teams",
    ],
    message:
      "Fixture data from src/data/{mock,schedules,teams} is test-only. Production pages/components must fetch from the worker API (see docs/protocols/no-mock-in-production.md). Use LEAGUE_REGISTRY from '@/lib/leagues' for league identity constants.",
  },
];

export default tseslint.config(
  { ignores: ["dist", "dev-dist", "supabase-source", "supabase", "supabase-docker", ".claude", "coverage"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  // Hard ban on fixture imports from production code (pages, components,
  // hooks, contexts, and non-test lib files). Tests can still import fixtures.
  {
    files: [
      "src/pages/**/*.{ts,tsx}",
      "src/components/**/*.{ts,tsx}",
      "src/hooks/**/*.{ts,tsx}",
      "src/contexts/**/*.{ts,tsx}",
      "src/worker/**/*.{ts,tsx}",
      "src/lib/**/*.{ts,tsx}",
    ],
    ignores: [
      "**/*.test.{ts,tsx}",
      "**/*.spec.{ts,tsx}",
      "**/*.stories.{ts,tsx}",
      "src/test/**",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: DATA_FIXTURE_PATTERNS,
          paths: [
            {
              name: "react-player",
              message:
                "Use 'react-player/lazy' instead. The default 'react-player' import bundles every provider eagerly, including Facebook (which loads connect.facebook.net/sdk.js and storms the console under our CSP).",
            },
          ],
        },
      ],
    },
  },
  // Playwright test infrastructure uses a fixture API where the body of an
  // `extend({...})` callback calls `use(value)` to provide the fixture to the
  // test. The react-hooks/rules-of-hooks rule incorrectly flags these `use(`
  // calls as React Hook violations because the function name matches the
  // `useXxx` heuristic. Disable the rule on Playwright config + fixture +
  // spec files only — these never run in a React tree.
  {
    files: [
      "playwright.config.ts",
      "playwright-fixture.ts",
      "e2e/**/*.{ts,tsx}",
    ],
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },
);
