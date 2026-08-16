import { describe, expect, it } from 'vitest';
import {
  hasPremiumPlayerAccess,
  isPlayerSubscriptionActive,
  PLAYER_REGISTRATION_PRICE_CAD,
  PPV_PRICE_CAD,
  PPV_ACCESS_HOURS,
  PPV_SESSION_CAP_HOURS,
  PLAYER_STORE_DISCOUNT_PERCENT,
  shouldShowMinimalStats,
} from '@/lib/auth/subscription';

describe('player subscription access', () => {
  it('player registration is $6.99 CAD/season', () => {
    expect(PLAYER_REGISTRATION_PRICE_CAD).toBe(6.99);
  });

  it('PPV is $3.99 CAD with 48-hour entitlement window and 6-hour session cap', () => {
    expect(PPV_PRICE_CAD).toBe(3.99);
    expect(PPV_ACCESS_HOURS).toBe(48);
    expect(PPV_SESSION_CAP_HOURS).toBe(6);
  });

  it('player store discount is 10%', () => {
    expect(PLAYER_STORE_DISCOUNT_PERCENT).toBe(10);
  });

  it('validates active subscription window for players', () => {
    const now = new Date('2026-03-27T00:00:00.000Z');
    expect(isPlayerSubscriptionActive('2026-04-05T00:00:00.000Z', now)).toBe(true);
    expect(isPlayerSubscriptionActive('2026-03-01T00:00:00.000Z', now)).toBe(false);
    expect(isPlayerSubscriptionActive(null, now)).toBe(false);
    expect(isPlayerSubscriptionActive('not-a-date', now)).toBe(false);
    expect(isPlayerSubscriptionActive('', now)).toBe(false);
  });

  it('handles subscription boundary cases', () => {
    const now = new Date('2026-03-27T12:00:00.000Z');

    // Exactly now - should be inactive (strictly greater than)
    expect(isPlayerSubscriptionActive('2026-03-27T12:00:00.000Z', now)).toBe(false);

    // 1ms in the future - should be active
    expect(isPlayerSubscriptionActive('2026-03-27T12:00:00.001Z', now)).toBe(true);

    // 1ms in the past - should be inactive
    expect(isPlayerSubscriptionActive('2026-03-27T11:59:59.999Z', now)).toBe(false);
  });

  it('gates premium access correctly for each role', () => {
    const now = new Date('2026-03-27T00:00:00.000Z');
    const activeSub = '2026-04-05T00:00:00.000Z';
    const expiredSub = '2026-03-01T00:00:00.000Z';

    // active player subscriber
    expect(hasPremiumPlayerAccess('player', activeSub, now)).toBe(true);
    // expired player subscription
    expect(hasPremiumPlayerAccess('player', expiredSub, now)).toBe(false);
    // player with no subscription
    expect(hasPremiumPlayerAccess('player', null, now)).toBe(false);
    // admins always have premium access
    expect(hasPremiumPlayerAccess('league_admin', null, now)).toBe(true);
    expect(hasPremiumPlayerAccess('super_admin', null, now)).toBe(true);
    // fans never have premium
    expect(hasPremiumPlayerAccess('fan', activeSub, now)).toBe(false);
    // coach does not have premium player access
    expect(hasPremiumPlayerAccess('coach', activeSub, now)).toBe(false);
  });

  it('minimal stats is inverse of premium access', () => {
    const now = new Date('2026-03-27T00:00:00.000Z');
    expect(shouldShowMinimalStats('fan', null, now)).toBe(true);
    expect(shouldShowMinimalStats('player', '2026-04-05T00:00:00.000Z', now)).toBe(false);
  });
});
