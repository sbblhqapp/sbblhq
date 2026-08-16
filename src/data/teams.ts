import type { LeagueId } from '@/types';
import { getLeagueSeasonLabel } from '@/lib/leagues';

export type StaticTeam = {
  name: string;
  leagueId: LeagueId;
  leagueCode: string;
  season: string;
  division?: string;
};

const SBBL_SEASON = getLeagueSeasonLabel('sbbl');
const TGIF_SEASON = getLeagueSeasonLabel('tgifbl');
const WBL_SEASON = getLeagueSeasonLabel('wbl');

/**
 * Static team roster sourced from official league schedule graphics.
 * Will be replaced by Supabase teams table when data pipeline ships.
 */
export const STATIC_TEAMS: StaticTeam[] = [
  // ── SBBL (Sunday's Best Basketball League) — Season 12 ──
  // Division P10 (20 teams)
  { name: 'Northstar P10', leagueId: 'sbbl', leagueCode: 'SBBL', season: SBBL_SEASON, division: 'P10' },
  { name: 'Riverside', leagueId: 'sbbl', leagueCode: 'SBBL', season: SBBL_SEASON, division: 'P10' },
  { name: 'Smesh', leagueId: 'sbbl', leagueCode: 'SBBL', season: SBBL_SEASON, division: 'P10' },
  { name: 'Rebelde Cutie', leagueId: 'sbbl', leagueCode: 'SBBL', season: SBBL_SEASON, division: 'P10' },
  { name: 'JS Elite', leagueId: 'sbbl', leagueCode: 'SBBL', season: SBBL_SEASON, division: 'P10' },
  { name: 'Kanto Terrors', leagueId: 'sbbl', leagueCode: 'SBBL', season: SBBL_SEASON, division: 'P10' },
  { name: 'Legendary Dream Giver', leagueId: 'sbbl', leagueCode: 'SBBL', season: SBBL_SEASON, division: 'P10' },
  { name: 'North York Valors', leagueId: 'sbbl', leagueCode: 'SBBL', season: SBBL_SEASON, division: 'P10' },
  { name: 'Northside', leagueId: 'sbbl', leagueCode: 'SBBL', season: SBBL_SEASON, division: 'P10' },
  { name: 'Forest Hill', leagueId: 'sbbl', leagueCode: 'SBBL', season: SBBL_SEASON, division: 'P10' },
  { name: 'Macao Imperial Tea', leagueId: 'sbbl', leagueCode: 'SBBL', season: SBBL_SEASON, division: 'P10' },
  { name: 'Brewers OG', leagueId: 'sbbl', leagueCode: 'SBBL', season: SBBL_SEASON, division: 'P10' },
  { name: 'Panday', leagueId: 'sbbl', leagueCode: 'SBBL', season: SBBL_SEASON, division: 'P10' },
  { name: 'Downtown', leagueId: 'sbbl', leagueCode: 'SBBL', season: SBBL_SEASON, division: 'P10' },
  { name: 'Lakehurst Boys', leagueId: 'sbbl', leagueCode: 'SBBL', season: SBBL_SEASON, division: 'P10' },
  { name: 'Strikers', leagueId: 'sbbl', leagueCode: 'SBBL', season: SBBL_SEASON, division: 'P10' },
  { name: 'Airside Ballers', leagueId: 'sbbl', leagueCode: 'SBBL', season: SBBL_SEASON, division: 'P10' },
  { name: 'Tita Hunters', leagueId: 'sbbl', leagueCode: 'SBBL', season: SBBL_SEASON, division: 'P10' },
  { name: 'SPG Workmates', leagueId: 'sbbl', leagueCode: 'SBBL', season: SBBL_SEASON, division: 'P10' },
  { name: '421 Bois', leagueId: 'sbbl', leagueCode: 'SBBL', season: SBBL_SEASON, division: 'P10' },

  // Division P9 (12 teams)
  { name: 'Northstar P9', leagueId: 'sbbl', leagueCode: 'SBBL', season: SBBL_SEASON, division: 'P9' },
  { name: 'Rebelde Jrs.', leagueId: 'sbbl', leagueCode: 'SBBL', season: SBBL_SEASON, division: 'P9' },
  { name: 'GLS Titos', leagueId: 'sbbl', leagueCode: 'SBBL', season: SBBL_SEASON, division: 'P9' },
  { name: 'Rawstar', leagueId: 'sbbl', leagueCode: 'SBBL', season: SBBL_SEASON, division: 'P9' },
  { name: 'Slam Drunks', leagueId: 'sbbl', leagueCode: 'SBBL', season: SBBL_SEASON, division: 'P9' },
  { name: 'Almighty', leagueId: 'sbbl', leagueCode: 'SBBL', season: SBBL_SEASON, division: 'P9' },
  { name: 'PTB Jrs.', leagueId: 'sbbl', leagueCode: 'SBBL', season: SBBL_SEASON, division: 'P9' },
  { name: 'Young Bucks', leagueId: 'sbbl', leagueCode: 'SBBL', season: SBBL_SEASON, division: 'P9' },
  { name: 'Droas Jrs.', leagueId: 'sbbl', leagueCode: 'SBBL', season: SBBL_SEASON, division: 'P9' },
  { name: 'Brotherhood', leagueId: 'sbbl', leagueCode: 'SBBL', season: SBBL_SEASON, division: 'P9' },
  { name: 'SPG Jrs.', leagueId: 'sbbl', leagueCode: 'SBBL', season: SBBL_SEASON, division: 'P9' },
  { name: 'Kapwa', leagueId: 'sbbl', leagueCode: 'SBBL', season: SBBL_SEASON, division: 'P9' },

  // Division 35 Up (2 teams)
  { name: 'Sansuwi', leagueId: 'sbbl', leagueCode: 'SBBL', season: SBBL_SEASON, division: '35 Up' },
  { name: 'Toronto Raps', leagueId: 'sbbl', leagueCode: 'SBBL', season: SBBL_SEASON, division: '35 Up' },

  // Division P7 (2 teams)
  { name: 'Stingers', leagueId: 'sbbl', leagueCode: 'SBBL', season: SBBL_SEASON, division: 'P7' },
  { name: 'Team Romansa', leagueId: 'sbbl', leagueCode: 'SBBL', season: SBBL_SEASON, division: 'P7' },

  // ── TGIF Basketball League — Season 1 ──
  { name: 'Solid North', leagueId: 'tgifbl', leagueCode: 'TGIFBL', season: TGIF_SEASON },
  { name: 'OSY x LCL', leagueId: 'tgifbl', leagueCode: 'TGIFBL', season: TGIF_SEASON },
  { name: 'Batang Riles x Tri J', leagueId: 'tgifbl', leagueCode: 'TGIFBL', season: TGIF_SEASON },
  { name: 'J Elite', leagueId: 'tgifbl', leagueCode: 'TGIFBL', season: TGIF_SEASON },
  { name: 'YG', leagueId: 'tgifbl', leagueCode: 'TGIFBL', season: TGIF_SEASON },
  { name: 'Conceited Fantasy', leagueId: 'tgifbl', leagueCode: 'TGIFBL', season: TGIF_SEASON },
  { name: 'C&F', leagueId: 'tgifbl', leagueCode: 'TGIFBL', season: TGIF_SEASON },
  { name: 'City Above Elite', leagueId: 'tgifbl', leagueCode: 'TGIFBL', season: TGIF_SEASON },
  { name: 'Over Under', leagueId: 'tgifbl', leagueCode: 'TGIFBL', season: TGIF_SEASON },
  { name: 'Full Time Ballers', leagueId: 'tgifbl', leagueCode: 'TGIFBL', season: TGIF_SEASON },
  { name: 'DBRKDZ', leagueId: 'tgifbl', leagueCode: 'TGIFBL', season: TGIF_SEASON },
  { name: 'BLBG', leagueId: 'tgifbl', leagueCode: 'TGIFBL', season: TGIF_SEASON },
  { name: 'Mantiku', leagueId: 'tgifbl', leagueCode: 'TGIFBL', season: TGIF_SEASON },
  { name: 'Fourteen Ounce', leagueId: 'tgifbl', leagueCode: 'TGIFBL', season: TGIF_SEASON },
  { name: 'Ball is Life', leagueId: 'tgifbl', leagueCode: 'TGIFBL', season: TGIF_SEASON },
  { name: 'JC Trans Jrs', leagueId: 'tgifbl', leagueCode: 'TGIFBL', season: TGIF_SEASON },
  { name: 'Banayad Hoopers', leagueId: 'tgifbl', leagueCode: 'TGIFBL', season: TGIF_SEASON },

  // ── Weekend Basketball League — Season 3 ──
  { name: 'OSY', leagueId: 'wbl', leagueCode: 'WBL', season: WBL_SEASON },
  { name: 'Rebelde Jrs', leagueId: 'wbl', leagueCode: 'WBL', season: WBL_SEASON },
  { name: 'Solid North', leagueId: 'wbl', leagueCode: 'WBL', season: WBL_SEASON },
  { name: 'Crosslinx Warriors', leagueId: 'wbl', leagueCode: 'WBL', season: WBL_SEASON },
  { name: 'Rebelde', leagueId: 'wbl', leagueCode: 'WBL', season: WBL_SEASON },
  { name: 'Downtown', leagueId: 'wbl', leagueCode: 'WBL', season: WBL_SEASON },
  { name: 'La Liga Elite', leagueId: 'wbl', leagueCode: 'WBL', season: WBL_SEASON },
  { name: 'Blacksmith', leagueId: 'wbl', leagueCode: 'WBL', season: WBL_SEASON },
  { name: 'Splash', leagueId: 'wbl', leagueCode: 'WBL', season: WBL_SEASON },
  { name: 'SPG', leagueId: 'wbl', leagueCode: 'WBL', season: WBL_SEASON },
  { name: 'Harina x Wild Dogs', leagueId: 'wbl', leagueCode: 'WBL', season: WBL_SEASON },
  { name: 'NSD', leagueId: 'wbl', leagueCode: 'WBL', season: WBL_SEASON },
  { name: '4Lifers', leagueId: 'wbl', leagueCode: 'WBL', season: WBL_SEASON },
  { name: 'Serviteurs', leagueId: 'wbl', leagueCode: 'WBL', season: WBL_SEASON },
  { name: 'Batang Kanto', leagueId: 'wbl', leagueCode: 'WBL', season: WBL_SEASON },
  { name: 'Disciples', leagueId: 'wbl', leagueCode: 'WBL', season: WBL_SEASON },
  { name: 'Ball is Life', leagueId: 'wbl', leagueCode: 'WBL', season: WBL_SEASON },
];

export function getTeamsByLeague(leagueId: LeagueId): StaticTeam[] {
  return STATIC_TEAMS.filter((t) => t.leagueId === leagueId);
}

export function getAllTeams(): StaticTeam[] {
  return STATIC_TEAMS;
}
