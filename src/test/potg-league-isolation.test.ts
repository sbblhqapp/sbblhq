import { describe, it, expect } from 'vitest';
import { mapPotgPublicationRows } from '@/lib/potg';
import { normalizeLeagueId } from '@/lib/leagues';

describe('POTG League Isolation & Publication Mapping', () => {
  const mockPublicationRows = [
    {
      id: 'potg-tgif-1',
      title: 'Joseph Alberto',
      surface: 'potg',
      league_id: '15dec6d4-ea7d-4d78-a0cf-2fb3f70e2903',
      league_code: 'TGIFBL',
      status: 'published',
      render_payload: {
        playerName: 'Joseph Alberto',
        team: 'Pangasinan Ballers',
        pts: 17,
        rebs: 8,
        assts: 5,
        thumbnail: 'https://example.com/joseph.jpg',
      },
    },
    {
      id: 'potg-tgif-2',
      title: 'Jaime Phillips',
      surface: 'potg',
      league_id: '15dec6d4-ea7d-4d78-a0cf-2fb3f70e2903',
      status: 'published',
      render_payload: {
        playerName: 'Jaime Phillips',
        team: 'DBC',
        pts: 20,
        rebs: 11,
        assts: 7,
        thumbnail: 'https://example.com/jaime.jpg',
      },
    },
    {
      id: 'potg-sbbl-1',
      title: 'Kobe Bryant',
      surface: 'potg',
      league_id: '72ba2e09-302d-4bf4-8ebc-f895fb896b5f',
      league_code: 'SBBL',
      status: 'published',
      render_payload: {
        playerName: 'Kobe Bryant',
        team: 'Northstar P10',
        pts: 35,
        rebs: 6,
        assts: 5,
        thumbnail: 'https://example.com/kobe.jpg',
      },
    },
    {
      id: 'potg-wbl-1',
      title: 'Daryl Gamiao',
      surface: 'potg',
      league_id: 'cb773203-03b4-4f75-8eff-a1b46ad7f9df',
      league_code: 'WBL',
      status: 'published',
      render_payload: {
        playerName: 'Daryl Gamiao',
        team: 'WBL All-Stars',
        pts: 22,
        rebs: 5,
        assts: 4,
        thumbnail: 'https://example.com/daryl.jpg',
      },
    },
  ];

  it('1. correctly maps TGIF database UUID and TGIFBL code to tgifbl leagueId', () => {
    const mapped = mapPotgPublicationRows(mockPublicationRows);
    const tgifPotgs = mapped.filter((p) => p.leagueId === 'tgifbl');

    expect(tgifPotgs).toHaveLength(2);
    expect(tgifPotgs.map((p) => p.playerName)).toEqual(['Joseph Alberto', 'Jaime Phillips']);
  });

  it('2. prevents TGIF POTGs from leaking into SBBL league page', () => {
    const mapped = mapPotgPublicationRows(mockPublicationRows);
    const sbblResolvedLeague = normalizeLeagueId('sbbl');
    const sbblPotgs = mapped.filter((p) => p.leagueId === sbblResolvedLeague);

    expect(sbblPotgs).toHaveLength(1);
    expect(sbblPotgs[0].playerName).toBe('Kobe Bryant');
    expect(sbblPotgs.some((p) => p.playerName === 'Joseph Alberto')).toBe(false);
    expect(sbblPotgs.some((p) => p.playerName === 'Jaime Phillips')).toBe(false);
  });

  it('3. isolates WBL POTGs accurately', () => {
    const mapped = mapPotgPublicationRows(mockPublicationRows);
    const wblResolvedLeague = normalizeLeagueId('wbl');
    const wblPotgs = mapped.filter((p) => p.leagueId === wblResolvedLeague);

    expect(wblPotgs).toHaveLength(1);
    expect(wblPotgs[0].playerName).toBe('Daryl Gamiao');
  });

  it('4. normalizes URL slugs (tgif -> tgifbl, sbbl -> sbbl, wbl -> wbl)', () => {
    expect(normalizeLeagueId('tgif')).toBe('tgifbl');
    expect(normalizeLeagueId('tgifbl')).toBe('tgifbl');
    expect(normalizeLeagueId('TGIFBL')).toBe('tgifbl');
    expect(normalizeLeagueId('15dec6d4-ea7d-4d78-a0cf-2fb3f70e2903')).toBe('tgifbl');

    expect(normalizeLeagueId('sbbl')).toBe('sbbl');
    expect(normalizeLeagueId('SBBL')).toBe('sbbl');
    expect(normalizeLeagueId('72ba2e09-302d-4bf4-8ebc-f895fb896b5f')).toBe('sbbl');

    expect(normalizeLeagueId('wbl')).toBe('wbl');
    expect(normalizeLeagueId('WBL')).toBe('wbl');
    expect(normalizeLeagueId('cb773203-03b4-4f75-8eff-a1b46ad7f9df')).toBe('wbl');
  });
});
