import { describe, expect, it } from 'vitest';
import {
  getLeagueConfig,
  getLeagueSeasonLabel,
  LEAGUE_CONFIGS,
  LEAGUE_REGISTRY,
  LEAGUE_SEASON_NUMBERS,
  leagueCodeFromId,
  leagueIdFromCode,
} from '@/lib/leagues';

describe('canonical league model', () => {
  it('returns correct config for each league id', () => {
    expect(getLeagueConfig('sbbl').code).toBe('SBBL');
    expect(getLeagueConfig('wbl').code).toBe('WBL');
    expect(getLeagueConfig('tgifbl').code).toBe('TGIFBL');
  });

  it('maps league codes to ids', () => {
    expect(leagueIdFromCode('SBBL')).toBe('sbbl');
    expect(leagueIdFromCode('WBL')).toBe('wbl');
    expect(leagueIdFromCode('TGIFBL')).toBe('tgifbl');
    expect(leagueIdFromCode('sbbl')).toBe('sbbl');
  });

  it('falls back to sbbl for unknown codes', () => {
    expect(leagueIdFromCode('UNKNOWN')).toBe('sbbl');
  });

  it('maps league ids to codes', () => {
    expect(leagueCodeFromId('sbbl')).toBe('SBBL');
    expect(leagueCodeFromId('wbl')).toBe('WBL');
    expect(leagueCodeFromId('tgifbl')).toBe('TGIFBL');
  });

  it('has exactly 3 league configs', () => {
    expect(LEAGUE_CONFIGS).toHaveLength(3);
  });

  it('LEAGUE_REGISTRY is the same as LEAGUE_CONFIGS (backwards compat)', () => {
    expect(LEAGUE_REGISTRY).toBe(LEAGUE_CONFIGS);
  });

  it('every league has required identity fields', () => {
    for (const l of LEAGUE_REGISTRY) {
      expect(l.id).toBeTruthy();
      expect(l.code).toBeTruthy();
      expect(l.slug).toBeTruthy();
      expect(l.name).toBeTruthy();
      expect(l.shortName).toBeTruthy();
      expect(l.logo).toMatch(/^\/assets\/leagues\//);
      expect(l.logoAlt).toBeTruthy();
      expect(l.accentClass).toMatch(/^text-/);
      expect(l.badgeClass).toMatch(/^league-badge-/);
      expect(typeof l.order).toBe('number');
    }
  });

  it('order values are unique', () => {
    const orders = LEAGUE_REGISTRY.map((l) => l.order);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it('WBL is Weekend Basketball League', () => {
    expect(getLeagueConfig('wbl').name).toBe('Weekend Basketball League');
  });

  it('shortNames match expected display values', () => {
    expect(getLeagueConfig('wbl').shortName).toBe('WBL');
    expect(getLeagueConfig('sbbl').shortName).toBe('SBBL');
    expect(getLeagueConfig('tgifbl').shortName).toBe('TGIF');
  });

  it('tracks global season numbers by league', () => {
    expect(LEAGUE_SEASON_NUMBERS.sbbl).toBe(12);
    expect(LEAGUE_SEASON_NUMBERS.wbl).toBe(3);
    expect(LEAGUE_SEASON_NUMBERS.tgifbl).toBe(1);
  });

  it('builds season labels from the global season map', () => {
    expect(getLeagueSeasonLabel('sbbl')).toBe('Season 12');
    expect(getLeagueSeasonLabel('wbl')).toBe('Season 3');
    expect(getLeagueSeasonLabel('tgifbl')).toBe('Season 1');
  });
});
