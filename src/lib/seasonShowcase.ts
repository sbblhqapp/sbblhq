import type { LeagueId } from '@/types';

/**
 * Season showcase artwork registry.
 *
 * These are static brand assets (season key art), not league data — they are
 * intentionally declared here rather than fetched, so the banner renders on
 * first paint with no request and no layout shift.
 *
 * To retire a showcase at the end of a season, flip `active` to `false`.
 * That is the only change required; every consumer reads through
 * `getSeasonShowcase()` and renders nothing when there is no active entry.
 */
export type ShowcaseImage = {
  /** Preferred modern format. */
  webp: string;
  /** Universally-supported fallback. */
  jpg: string;
  width: number;
  height: number;
};

export type SeasonShowcase = {
  leagueId: LeagueId;
  /** Human label used for alt text, e.g. "Season 12". */
  seasonLabel: string;
  active: boolean;
  /** Wide key art for the league landing banner (desktop / >=768px). */
  bannerDesktop: ShowcaseImage;
  /** Square key art for the league landing banner (mobile / <768px). */
  bannerMobile: ShowcaseImage;
  /** Portrait key art used as a secondary highlight on the app home hero. */
  portrait: ShowcaseImage;
  /** Descriptive alt text. Never decorative — this art carries the tip-off date. */
  alt: string;
};

const SBBL_S12_BASE = '/assets/season/sbbl-s12';

export const SEASON_SHOWCASES: SeasonShowcase[] = [
  {
    leagueId: 'sbbl',
    seasonLabel: 'Season 12',
    active: true,
    bannerDesktop: {
      webp: `${SBBL_S12_BASE}-banner-desktop.webp`,
      jpg: `${SBBL_S12_BASE}-banner-desktop.jpg`,
      width: 2400,
      height: 1000,
    },
    bannerMobile: {
      webp: `${SBBL_S12_BASE}-banner-mobile.webp`,
      jpg: `${SBBL_S12_BASE}-banner-mobile.jpg`,
      width: 1200,
      height: 1200,
    },
    portrait: {
      webp: `${SBBL_S12_BASE}-feature-portrait.webp`,
      jpg: `${SBBL_S12_BASE}-feature-portrait.jpg`,
      width: 1080,
      height: 1440,
    },
    alt: 'SBBL Season 12 — tip off August 16, 2026',
  },
];

/** Returns the active showcase for a league, or `null` when there is none. */
export function getSeasonShowcase(leagueId: LeagueId | undefined | null): SeasonShowcase | null {
  if (!leagueId) return null;
  return SEASON_SHOWCASES.find((s) => s.leagueId === leagueId && s.active) ?? null;
}
