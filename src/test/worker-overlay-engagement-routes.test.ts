/**
 * Static verification that the overlay / engagement / sponsor / digest / OBS
 * routes are wired into the Worker route table AND that their handlers are
 * exported from the per-route modules.
 *
 * We do static verification (not live HTTP calls) because these routes all
 * touch Supabase; integration coverage lives in `src/test/migration-smoke`
 * and the real DB smoke-test executed via Supabase MCP during deployment.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const workerSource = readFileSync(resolve(__dirname, '../worker/index.ts'), 'utf-8');
const overlaySource = readFileSync(resolve(__dirname, '../worker/routes/overlay.ts'), 'utf-8');
const engagementSource = readFileSync(resolve(__dirname, '../worker/routes/engagement.ts'), 'utf-8');
const sponsorsSource = readFileSync(resolve(__dirname, '../worker/routes/sponsors.ts'), 'utf-8');
const digestSource = readFileSync(resolve(__dirname, '../worker/routes/digest.ts'), 'utf-8');
const obsSource = readFileSync(resolve(__dirname, '../worker/routes/obs.ts'), 'utf-8');

describe('overlay routes', () => {
  it('registers GET /api/public/overlay/:gameId', () => {
    expect(workerSource).toContain('"/api/public/overlay/:gameId"');
    expect(workerSource).toContain('handlePublicOverlay');
  });

  it('registers every admin overlay mutation (clock, score, foul, period, reset)', () => {
    for (const path of [
      '/api/ops/overlay/:gameId/state',
      '/api/ops/overlay/:gameId/clock',
      '/api/ops/overlay/:gameId/score',
      '/api/ops/overlay/:gameId/foul',
      '/api/ops/overlay/:gameId/period',
      '/api/ops/overlay/:gameId/reset',
    ]) {
      expect(workerSource).toContain(`"${path}"`);
    }
  });

  it('overlay handlers exist in routes/overlay.ts', () => {
    expect(overlaySource).toMatch(/export async function handlePublicOverlay/);
    expect(overlaySource).toMatch(/export async function handleOverlayPatch/);
    expect(overlaySource).toMatch(/export async function handleOverlayClock/);
    expect(overlaySource).toMatch(/export async function handleOverlayScore/);
    expect(overlaySource).toMatch(/export async function handleOverlayFoul/);
    expect(overlaySource).toMatch(/export async function handleOverlayPeriod/);
    expect(overlaySource).toMatch(/export async function handleOverlayReset/);
  });

  it('overlay admin gate accepts media_operator + league/team admins + super_admin', () => {
    // Must match the enum values in the live Supabase schema.
    expect(overlaySource).toContain('"super_admin"');
    expect(overlaySource).toContain('"league_admin"');
    expect(overlaySource).toContain('"team_manager"');
    expect(overlaySource).toContain('"media_operator"');
    expect(overlaySource).not.toContain('"ops_admin"');
  });

  it('public overlay response has real-time edge cache-control (live state)', () => {
    expect(overlaySource).toContain('public, max-age=1');
  });
});

describe('engagement routes', () => {
  it('registers public reads + authenticated writes + admin create/grade', () => {
    for (const path of [
      '/api/public/engagement/polls',
      '/api/public/engagement/polls/:id/results',
      '/api/public/engagement/leaderboard',
      '/api/engagement/polls/:id/vote',
      '/api/engagement/me/points',
      '/api/engagement/watch-parties',
      '/api/engagement/watch-parties/:id/join',
      '/api/engagement/watch-parties/join-by-code',
      '/api/ops/engagement/polls',
      '/api/ops/engagement/polls/:id',
      '/api/ops/engagement/polls/:id/grade',
    ]) {
      expect(workerSource).toContain(`"${path}"`);
    }
  });

  it('engagement handlers are exported', () => {
    for (const fn of [
      'handlePublicPollsList',
      'handlePublicPollResults',
      'handlePublicEngagementLeaderboard',
      'handleCastVote',
      'handleCreatePoll',
      'handleGradePoll',
      'handleMyPoints',
      'handleCreateWatchParty',
      'handleListWatchParties',
      'handleJoinByCode',
    ]) {
      expect(engagementSource).toMatch(new RegExp(`export async function ${fn}`));
    }
  });

  it('cast-vote rejects duplicate votes via unique constraint error surface', () => {
    expect(engagementSource).toContain('"already_voted"');
  });
});

describe('sponsor routes', () => {
  it('registers public sponsor read + track + admin CRUD', () => {
    for (const path of [
      '/api/public/sponsors',
      '/api/public/sponsors/:id/track',
      '/api/ops/sponsors',
      '/api/ops/sponsors/:id',
      '/api/ops/sponsors/:id/delete',
    ]) {
      expect(workerSource).toContain(`"${path}"`);
    }
  });

  it('sponsor public read is edge-cached for 30 s', () => {
    expect(sponsorsSource).toMatch(/s-maxage=30/);
  });
});

describe('OBS control routes', () => {
  it('registers queue + agent endpoints', () => {
    for (const path of [
      '/api/ops/obs/commands',
      '/api/ops/obs/commands/pending',
      '/api/ops/obs/commands/:id/ack',
    ]) {
      expect(workerSource).toContain(`"${path}"`);
    }
  });

  it('agent path is protected by OBS_AGENT_TOKEN', () => {
    expect(obsSource).toContain('OBS_AGENT_TOKEN');
    expect(obsSource).toMatch(/Bearer/);
  });
});

describe('AI weekly digest routes', () => {
  it('registers public digest + admin regenerate', () => {
    expect(workerSource).toContain('"/api/public/digest"');
    expect(workerSource).toContain('"/api/ops/digest/:leagueCode/regenerate"');
  });

  it('digest falls back to deterministic template when GROQ_API_KEY missing', () => {
    expect(digestSource).toMatch(/let model = ["']fallback["']/);
    expect(digestSource).toContain('renderFallbackDigest');
  });

  it('digest upserts on (league_id, week_start)', () => {
    expect(digestSource).toContain('onConflict: "league_id,week_start"');
  });
});
