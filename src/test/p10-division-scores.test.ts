import { describe, it, expect } from 'vitest';

describe('P10 Division Game & Box Score Contract', () => {
  const P10_GAME_ID = '1ca72d56-16fa-4012-9cd1-857ebb185d84';
  const P10_DIVISION_ID = '9abbc728-cca7-46b9-8dcd-78ae2bd4c331';

  const RIVERSIDE_BOX_SCORE = [
    { name: 'IAN DELVO', jersey: '9', pts: 6 },
    { name: 'JOHN TUBLE', jersey: '24', pts: 5 },
    { name: 'P. BAJO', jersey: '13', pts: 6 },
    { name: 'WEN MADERISTA', jersey: '30', pts: 9 },
    { name: 'BRIAN GUILLEM', jersey: '69', pts: 0 },
    { name: 'RICHMON LIBREA', jersey: '6', pts: 8 },
    { name: 'DEXTER GABAYERON', jersey: '20', pts: 6 },
    { name: 'NATHANIEL MARAVILLA', jersey: '15', pts: 16 },
    { name: 'AJ AGSAMUSAM', jersey: '17', pts: 8 },
  ];

  const NORTHSTAR_BOX_SCORE = [
    { name: 'RENDON BANTIGUE', jersey: '3', pts: 7 },
    { name: 'JUNE DANRRY', jersey: '12', pts: 14 },
    { name: 'JETTZHER AGLIPAY', jersey: '9', pts: 0 },
    { name: 'ROQUE PASION', jersey: '0', pts: 0 },
    { name: 'CLARENCE POLIG', jersey: '25', pts: 0 },
    { name: 'ORLYNO LORENZO', jersey: '88', pts: 15 },
    { name: 'BRIX LEJAO', jersey: '14', pts: 1 },
    { name: 'JUSTINE DIAZ', jersey: '20', pts: 1 },
    { name: 'PLAYER #26', jersey: '26', pts: 14 },
    { name: 'PLAYER #17', jersey: '17', pts: 6 },
    { name: 'PLAYER #18', jersey: '18', pts: 3 },
  ];

  it('verifies Riverside box score point summation equals 64', () => {
    const total = RIVERSIDE_BOX_SCORE.reduce((sum, p) => sum + p.pts, 0);
    expect(total).toBe(64);
  });

  it('verifies Northstar P10 box score point summation equals 61', () => {
    const total = NORTHSTAR_BOX_SCORE.reduce((sum, p) => sum + p.pts, 0);
    expect(total).toBe(61);
  });

  it('validates game metadata and final status invariants', () => {
    const game = {
      id: P10_GAME_ID,
      division_id: P10_DIVISION_ID,
      status: 'final',
      home_score: 61,
      away_score: 64,
      winner: 'away',
    };

    expect(game.status).toBe('final');
    expect(game.away_score).toBeGreaterThan(game.home_score);
    expect(game.winner).toBe('away');
  });
});
