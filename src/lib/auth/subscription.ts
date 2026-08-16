import { AppRole } from '@/lib/auth/roles';
import { ENTITLEMENT } from '@/lib/constants/ENTITLEMENT_CONSTANTS';

/** Player premium membership: $6.99 CAD / season pass (before tax) */
export const PLAYER_REGISTRATION_PRICE_CAD = 6.99;
export const PLAYER_SEASON_PRICE_CAD = 6.99;

/**
 * Alberta applies only federal GST (5%). No PST.
 * All prices are quoted before tax; GST is collected by Stripe at checkout.
 */
export const ALBERTA_GST_RATE = 0.05;

/** Returns the total price including Alberta GST, rounded to 2 decimal places. */
export function priceWithTax(baseCAD: number): number {
  return Math.round(baseCAD * (1 + ALBERTA_GST_RATE) * 100) / 100;
}

/**
 * PPV single-stream access: $3.99 CAD.
 * Entitlement is valid for 48 hours from purchase (tolerates game delays,
 * avoids chargebacks when tipoff slips). Once the buyer actually starts
 * watching, the session is independently hard-capped at 6 hours.
 */
export const PPV_PRICE_CAD = 3.99;
export const PPV_ACCESS_HOURS = ENTITLEMENT.ENTITLEMENT_VALIDITY_HOURS;
export const PPV_SESSION_CAP_HOURS = ENTITLEMENT.VIEWING_SESSION_MAX_SECONDS / 3600;

export function isPlayerSubscriptionActive(subscriptionEndsAt: string | null, now = new Date()): boolean {
  if (!subscriptionEndsAt) return false;
  const expiresAt = new Date(subscriptionEndsAt);
  return !Number.isNaN(expiresAt.getTime()) && expiresAt > now;
}

export function hasPremiumPlayerAccess(role: AppRole, subscriptionEndsAt: string | null, now = new Date()) {
  if (role === 'league_admin' || role === 'super_admin') return true;
  if (role !== 'player') return false;
  return isPlayerSubscriptionActive(subscriptionEndsAt, now);
}

export function shouldShowMinimalStats(role: AppRole, subscriptionEndsAt: string | null, now = new Date()) {
  return !hasPremiumPlayerAccess(role, subscriptionEndsAt, now);
}

/** 10% discount for active player premium members on store items */
export const PLAYER_STORE_DISCOUNT_PERCENT = 10;
