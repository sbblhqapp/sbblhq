import type { LeagueId } from '@/types';

export type LeagueIdentity = {
  id: LeagueId;
  code: string;
  slug: string;
  name: string;
  shortName: string;
  logo: string;
  logoAlt: string;
  accentClass: string;
  badgeClass: string;
  order: number;
};

export const LEAGUE_SEASON_NUMBERS: Record<LeagueId, number> = {
  sbbl: 12,
  wbl: 3,
  tgifbl: 1,
};

/**
 * Canonical league identity registry.
 * This is the ONLY source of league branding in the app.
 * All components must derive league identity from this array.
 */
export const LEAGUE_REGISTRY: LeagueIdentity[] = [
  {
    id: 'wbl',
    code: 'WBL',
    slug: 'wbl',
    name: 'Weekend Basketball League',
    shortName: 'WBL',
    logo: '/assets/leagues/wbl.png',
    logoAlt: 'WBL league logo',
    accentClass: 'text-wbl',
    badgeClass: 'league-badge-wbl',
    order: 1,
  },
  {
    id: 'sbbl',
    code: 'SBBL',
    slug: 'sbbl',
    name: "Sunday's Best Basketball League",
    shortName: 'SBBL',
    logo: '/assets/leagues/sbbl.png',
    logoAlt: 'SBBL league logo',
    accentClass: 'text-sbbl',
    badgeClass: 'league-badge-sbbl',
    order: 2,
  },
  {
    id: 'tgifbl',
    code: 'TGIFBL',
    slug: 'tgif',
    name: "Thank God It's Friday Basketball League",
    shortName: 'TGIF',
    logo: '/assets/leagues/tgif.png',
    logoAlt: 'TGIF league logo',
    accentClass: 'text-tgifbl',
    badgeClass: 'league-badge-tgifbl',
    order: 3,
  },
];

/** Backwards-compatible alias */
export const LEAGUE_CONFIGS = LEAGUE_REGISTRY;

export function getLeagueConfig(id: LeagueId): LeagueIdentity {
  return LEAGUE_REGISTRY.find((l) => l.id === id) ?? LEAGUE_REGISTRY.find((l) => l.id === 'sbbl')!;
}

export function leagueIdFromCode(code: string): LeagueId {
  const upper = code.toUpperCase();
  const match = LEAGUE_REGISTRY.find((l) => l.code === upper);
  return match?.id ?? 'sbbl';
}

export function leagueCodeFromId(id: LeagueId): string {
  return getLeagueConfig(id).code;
}

export function getLeagueSeasonLabel(id: LeagueId): string {
  return `Season ${LEAGUE_SEASON_NUMBERS[id]}`;
}

const LEAGUE_STORAGE_KEY = 'sbblhq.activeLeague';

export function persistLeague(id: LeagueId): void {
  try { localStorage.setItem(LEAGUE_STORAGE_KEY, id); } catch { /* noop */ }
}

export function loadPersistedLeague(): LeagueId | null {
  try {
    const stored = localStorage.getItem(LEAGUE_STORAGE_KEY);
    if (stored && LEAGUE_REGISTRY.some((l) => l.id === stored)) return stored as LeagueId;
  } catch { /* noop */ }
  return null;
}
