import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function stripJsonc(src: string): string {
  // Strip // line comments and /* block comments while preserving strings.
  let out = '';
  let i = 0;
  const n = src.length;
  let inString = false;
  let stringQuote = '';
  while (i < n) {
    const ch = src[i];
    const next = src[i + 1];
    if (inString) {
      out += ch;
      if (ch === '\\' && i + 1 < n) {
        out += src[i + 1];
        i += 2;
        continue;
      }
      if (ch === stringQuote) inString = false;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      stringQuote = ch;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < n && src[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  // Remove trailing commas before ] or }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

type WranglerConfig = {
  name?: string;
  main?: string;
  assets?: { run_worker_first?: boolean | string[] };
  vars?: Record<string, string>;
};

// ── wrangler.jsonc (dev / reference config) ───────────────────────────────────
describe('wrangler.jsonc configuration contract', () => {
  const raw = readFileSync(resolve(__dirname, '../../wrangler.jsonc'), 'utf8');
  const config = JSON.parse(stripJsonc(raw)) as WranglerConfig;

  it('keeps the pinned worker name so custom domains + secrets stay bound', () => {
    expect(config.name).toBe('sbbl-hq-worker');
  });

  it('enables Google OAuth capability flag', () => {
    expect(config.vars?.GOOGLE_OAUTH_ENABLED).toBe('true');
  });

  // Regression guard: a previous commit set run_worker_first to a path allowlist
  // (["/api/*", "/auth/*", "/webhooks/*", "/ops/*"]). That routed SPA HTML
  // requests directly to the ASSETS binding, bypassing the Worker's
  // addSecurityHeaders() wrapper. The browser then received zero security
  // headers on /live and Twitch embed autoplay silently broke. Keep this `true`.
  it('runs the Worker first for ALL routes so security headers reach SPA HTML', () => {
    expect(config.assets?.run_worker_first).toBe(true);
  });
});

// ── wrangler.deploy.jsonc (CI production deploy config) ───────────────────────
// THIS IS THE FILE THAT ACTUALLY SHIPS TO CLOUDFLARE.
// Regression guard: deploy.yml uses --config wrangler.deploy.jsonc. If this
// file's run_worker_first regresses to a path array, the Worker is bypassed for
// SPA routes (e.g. /live), stripping all security headers AND causing a
// {"ok":false,"error":"not_found"} 404 for the root URL (total site outage).
describe('wrangler.deploy.jsonc configuration contract (CI production deploy)', () => {
  const raw = readFileSync(resolve(__dirname, '../../wrangler.deploy.jsonc'), 'utf8');
  const config = JSON.parse(stripJsonc(raw)) as WranglerConfig;

  it('keeps the pinned worker name so custom domains + secrets stay bound', () => {
    expect(config.name).toBe('sbbl-hq-worker');
  });

  it('uses validation-contract-wrapper as entrypoint (rate limits + idempotency)', () => {
    expect(config.main).toBe('src/worker/validation-contract-wrapper.ts');
  });

  it('enables Google OAuth capability flag in deploy config', () => {
    expect(config.vars?.GOOGLE_OAUTH_ENABLED).toBe('true');
  });

  it('runs the Worker first for ALL routes so security headers reach SPA HTML', () => {
    expect(config.assets?.run_worker_first).toBe(true);
  });
});

describe('Vite port and Worker CORS alignment (Foresight Guardrail)', () => {
  const viteConfigRaw = readFileSync(resolve(__dirname, '../../vite.config.ts'), 'utf8');
  const portMatch = viteConfigRaw.match(/port:\s*(\d+)/);
  const vitePort = portMatch ? portMatch[1] : '5173';

  it('verifies src/worker/index.ts whitelists the current Vite port', () => {
    const workerRaw = readFileSync(resolve(__dirname, '../worker/index.ts'), 'utf8');
    expect(workerRaw).toContain(`http://localhost:${vitePort}`);
  });

  it('verifies src/api-proxy-worker/index.ts whitelists the current Vite port', () => {
    const proxyRaw = readFileSync(resolve(__dirname, '../api-proxy-worker/index.ts'), 'utf8');
    expect(proxyRaw).toContain(`http://localhost:${vitePort}`);
  });
});
