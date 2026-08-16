import type { LeagueId } from '@/types';
import { getLeagueSeasonLabel } from '@/lib/leagues';

export type ScheduleGame = {
  time: string;
  home: string;
  away: string;
  court: string;
  division?: string;
};

export type ScheduleDay = {
  leagueId: LeagueId;
  leagueCode: string;
  season: string;
  week: number;
  date: string;           // ISO date: YYYY-MM-DD
  venue: string;
  address: string;
  courts: {
    name: string;
    games: ScheduleGame[];
  }[];
};

const SBBL_SEASON = getLeagueSeasonLabel('sbbl');
const TGIF_SEASON = getLeagueSeasonLabel('tgifbl');

/**
 * Static schedule data — sourced from official league graphics.
 * Will be replaced by Supabase-backed API when schedule pipeline ships.
 */
export const SCHEDULE_DATA: ScheduleDay[] = [
  // ── SBBL Season 12 (Aug 16, 2026) ──────────────────────────────────────────
  {
    leagueId: 'sbbl',
    leagueCode: 'SBBL',
    season: SBBL_SEASON,
    week: 1,
    date: '2026-08-16',
    venue: 'Crawford School Arena',
    address: '531 Finch Ave W',
    courts: [
      {
        name: 'Court 1',
        games: [
          { time: '9:00 AM', home: 'Northstar P10', away: 'Riverside', court: 'Court 1', division: 'P10' },
          { time: '10:00 AM', home: 'Smesh', away: 'Rebelde Cutie', court: 'Court 1', division: 'P10' },
          { time: '11:00 AM', home: 'Northstar P9', away: 'Rebelde Jrs.', court: 'Court 1', division: 'P9' },
          { time: '12:00 PM', home: 'JS Elite', away: 'Kanto Terrors', court: 'Court 1', division: 'P10' },
          { time: '1:00 PM', home: 'GLS Titos', away: 'Rawstar', court: 'Court 1', division: 'P9' },
          { time: '2:00 PM', home: 'Sansuwi', away: 'Toronto Raps', court: 'Court 1', division: '35 Up' },
          { time: '3:00 PM', home: 'Legendary Dream Giver', away: 'North York Valors', court: 'Court 1', division: 'P10' },
          { time: '4:00 PM', home: 'Slam Drunks', away: 'Almighty', court: 'Court 1', division: 'P9' },
          { time: '5:00 PM', home: 'Northside', away: 'Forest Hill', court: 'Court 1', division: 'P10' },
          { time: '6:00 PM', home: 'PTB Jrs.', away: 'Young Bucks', court: 'Court 1', division: 'P9' },
          { time: '7:00 PM', home: 'Macao Imperial Tea', away: 'Brewers OG', court: 'Court 1', division: 'P10' },
        ],
      },
      {
        name: 'Court 2',
        games: [
          { time: '12:00 PM', home: 'Droas Jrs.', away: 'Brotherhood', court: 'Court 2', division: 'P9' },
          { time: '1:00 PM', home: 'Panday', away: 'Downtown', court: 'Court 2', division: 'P10' },
          { time: '2:00 PM', home: 'Lakehurst Boys', away: 'Strikers', court: 'Court 2', division: 'P10' },
          { time: '3:00 PM', home: 'Airside Ballers', away: 'Tita Hunters', court: 'Court 2', division: 'P10' },
          { time: '4:00 PM', home: 'SPG Workmates', away: '421 Bois', court: 'Court 2', division: 'P10' },
          { time: '5:00 PM', home: 'SPG Jrs.', away: 'Kapwa', court: 'Court 2', division: 'P9' },
          { time: '6:00 PM', home: 'Stingers', away: 'Team Romansa', court: 'Court 2', division: 'P7' },
        ],
      },
    ],
  },
  // ── TGIFBL ────────────────────────────────────────────────────────────────
  {
    leagueId: 'tgifbl',
    leagueCode: 'TGIFBL',
    season: TGIF_SEASON,
    week: 5,
    date: '2026-03-27',
    venue: 'TAT Stadium',
    address: '4001 Crouse Rd',
    courts: [
      {
        name: 'Court 5',
        games: [
          { time: '7:00 PM', home: 'Solid North', away: 'OSY x LCL', court: 'Court 5' },
          { time: '8:00 PM', home: 'Batang Riles x Tri J', away: 'J Elite', court: 'Court 5' },
          { time: '9:00 PM', home: 'YG', away: 'Conceited Fantasy', court: 'Court 5' },
          { time: '10:00 PM', home: 'C&F', away: 'City Above Elite', court: 'Court 5' },
          { time: '11:00 PM', home: 'Over Under', away: 'City Above Elite', court: 'Court 5' },
        ],
      },
      {
        name: 'Court 4',
        games: [
          { time: '7:00 PM', home: 'Full Time Ballers', away: 'DBRKDZ', court: 'Court 4' },
          { time: '8:00 PM', home: 'BLBG', away: 'Mantiku', court: 'Court 4' },
          { time: '9:00 PM', home: 'Fourteen Ounce', away: 'Ball is Life', court: 'Court 4' },
          { time: '10:00 PM', home: 'JC Trans Jrs', away: 'Banayad Hoopers', court: 'Court 4' },
        ],
      },
    ],
  },
];

export function getSchedulesByLeague(leagueId: LeagueId): ScheduleDay[] {
  return SCHEDULE_DATA.filter((s) => s.leagueId === leagueId);
}
