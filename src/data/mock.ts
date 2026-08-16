import { League, PlayerProfile, Team, Game, Product, MediaAsset, ReviewItem, Invoice, PlayerOfTheGame } from '@/types';

import player1 from '@/assets/player-1.svg';
import player2 from '@/assets/player-2.svg';
import player3 from '@/assets/player-3.svg';
import storeJersey from '@/assets/store-jersey.svg';
import storeHoodie from '@/assets/store-hoodie.svg';
import storeCap from '@/assets/store-cap.svg';
import storeTee from '@/assets/store-tee.svg';
import storeAccessories from '@/assets/store-accessories.svg';

// Marketing assets — real photos & event graphics
// Drop image files at these paths and they will auto-render throughout the app
const potgTataRamon = '/assets/potg/wbl-tata-ramon.jpg';
const potgMichaelRamos = '/assets/potg/wbl-michael-ramos.jpg';
const potgHaroldCasio = '/assets/potg/wbl-harold-casio.jpg';
const potgJtBalangui = '/assets/potg/wbl-jt-balangui.jpg';
const event1v1Sbbl = '/assets/events/1v1-fred-vs-karl.jpg';
const potgDarylGamiao = '/assets/potg/wbl-daryl-gamiao.jpg';
const potgRjayCuntapay = '/assets/potg/wbl-rjay-cuntapay.jpg';
const potgGilbertBacera = '/assets/potg/wbl-gilbert-bacera.jpg';
const eventSbblSeason11 = '/assets/events/sbbl-season-11.jpg';
// Apr 4 POTG batch — 8 new player of the game cards
const potgRexManalo = '/assets/potg/wbl-rex-aldous-manalo.jpg';
const potgAngeloFrez = '/assets/potg/wbl-angelo-frez.jpg';
const potgShawnCox = '/assets/potg/wbl-shawn-cox.jpg';
const potgJayceeMasilungan = '/assets/potg/wbl-jaycee-masilungan.jpg';
const potgRrFabiana = '/assets/potg/wbl-rr-fabiana.jpg';
const potgTeejayReymundo = '/assets/potg/wbl-teejay-reymundo.jpg';
const potgRobertOcampo = '/assets/potg/wbl-robert-ocampo.jpg';

export const leagues: League[] = [
  { id: 'sbbl', name: "Sunday's Best Basketball League", shortName: 'SBBL', fee: 45, accentVar: '--sbbl', description: 'The flagship Sunday league with multiple Panalay divisions, strict review rules, and all-star media day events.' },
  { id: 'wbl', name: 'Weekend Basketball League', shortName: 'WBL', fee: 49, accentVar: '--wbl', description: 'Weekend warriors compete at La Liga Sports Complex with best-of-3 finals and live broadcast coverage.' },
  { id: 'tgifbl', name: "Thank God It's Friday Basketball League", shortName: 'TGIFBL', fee: 49, accentVar: '--tgifbl', description: 'Friday night basketball at Tat Stadium featuring player-of-the-week awards and multiple division groups.' },
];

export const teams: Team[] = [
  // SBBL Season 12 Teams
  // Division P10 (20 teams)
  { id: 'sbbl-p10-1', name: 'Northstar P10', leagueId: 'sbbl', division: 'P10', record: { wins: 0, losses: 0 } },
  { id: 'sbbl-p10-2', name: 'Riverside', leagueId: 'sbbl', division: 'P10', record: { wins: 0, losses: 0 } },
  { id: 'sbbl-p10-3', name: 'Smesh', leagueId: 'sbbl', division: 'P10', record: { wins: 0, losses: 0 } },
  { id: 'sbbl-p10-4', name: 'Rebelde Cutie', leagueId: 'sbbl', division: 'P10', record: { wins: 0, losses: 0 } },
  { id: 'sbbl-p10-5', name: 'JS Elite', leagueId: 'sbbl', division: 'P10', record: { wins: 0, losses: 0 } },
  { id: 'sbbl-p10-6', name: 'Kanto Terrors', leagueId: 'sbbl', division: 'P10', record: { wins: 0, losses: 0 } },
  { id: 'sbbl-p10-7', name: 'Legendary Dream Giver', leagueId: 'sbbl', division: 'P10', record: { wins: 0, losses: 0 } },
  { id: 'sbbl-p10-8', name: 'North York Valors', leagueId: 'sbbl', division: 'P10', record: { wins: 0, losses: 0 } },
  { id: 'sbbl-p10-9', name: 'Northside', leagueId: 'sbbl', division: 'P10', record: { wins: 0, losses: 0 } },
  { id: 'sbbl-p10-10', name: 'Forest Hill', leagueId: 'sbbl', division: 'P10', record: { wins: 0, losses: 0 } },
  { id: 'sbbl-p10-11', name: 'Macao Imperial Tea', leagueId: 'sbbl', division: 'P10', record: { wins: 0, losses: 0 } },
  { id: 'sbbl-p10-12', name: 'Brewers OG', leagueId: 'sbbl', division: 'P10', record: { wins: 0, losses: 0 } },
  { id: 'sbbl-p10-13', name: 'Panday', leagueId: 'sbbl', division: 'P10', record: { wins: 0, losses: 0 } },
  { id: 'sbbl-p10-14', name: 'Downtown', leagueId: 'sbbl', division: 'P10', record: { wins: 0, losses: 0 } },
  { id: 'sbbl-p10-15', name: 'Lakehurst Boys', leagueId: 'sbbl', division: 'P10', record: { wins: 0, losses: 0 } },
  { id: 'sbbl-p10-16', name: 'Strikers', leagueId: 'sbbl', division: 'P10', record: { wins: 0, losses: 0 } },
  { id: 'sbbl-p10-17', name: 'Airside Ballers', leagueId: 'sbbl', division: 'P10', record: { wins: 0, losses: 0 } },
  { id: 'sbbl-p10-18', name: 'Tita Hunters', leagueId: 'sbbl', division: 'P10', record: { wins: 0, losses: 0 } },
  { id: 'sbbl-p10-19', name: 'SPG Workmates', leagueId: 'sbbl', division: 'P10', record: { wins: 0, losses: 0 } },
  { id: 'sbbl-p10-20', name: '421 Bois', leagueId: 'sbbl', division: 'P10', record: { wins: 0, losses: 0 } },

  // Division P9 (12 teams)
  { id: 'sbbl-p9-1', name: 'Northstar P9', leagueId: 'sbbl', division: 'P9', record: { wins: 0, losses: 0 } },
  { id: 'sbbl-p9-2', name: 'Rebelde Jrs.', leagueId: 'sbbl', division: 'P9', record: { wins: 0, losses: 0 } },
  { id: 'sbbl-p9-3', name: 'GLS Titos', leagueId: 'sbbl', division: 'P9', record: { wins: 0, losses: 0 } },
  { id: 'sbbl-p9-4', name: 'Rawstar', leagueId: 'sbbl', division: 'P9', record: { wins: 0, losses: 0 } },
  { id: 'sbbl-p9-5', name: 'Slam Drunks', leagueId: 'sbbl', division: 'P9', record: { wins: 0, losses: 0 } },
  { id: 'sbbl-p9-6', name: 'Almighty', leagueId: 'sbbl', division: 'P9', record: { wins: 0, losses: 0 } },
  { id: 'sbbl-p9-7', name: 'PTB Jrs.', leagueId: 'sbbl', division: 'P9', record: { wins: 0, losses: 0 } },
  { id: 'sbbl-p9-8', name: 'Young Bucks', leagueId: 'sbbl', division: 'P9', record: { wins: 0, losses: 0 } },
  { id: 'sbbl-p9-9', name: 'Droas Jrs.', leagueId: 'sbbl', division: 'P9', record: { wins: 0, losses: 0 } },
  { id: 'sbbl-p9-10', name: 'Brotherhood', leagueId: 'sbbl', division: 'P9', record: { wins: 0, losses: 0 } },
  { id: 'sbbl-p9-11', name: 'SPG Jrs.', leagueId: 'sbbl', division: 'P9', record: { wins: 0, losses: 0 } },
  { id: 'sbbl-p9-12', name: 'Kapwa', leagueId: 'sbbl', division: 'P9', record: { wins: 0, losses: 0 } },

  // Division 35 Up (2 teams)
  { id: 'sbbl-35-1', name: 'Sansuwi', leagueId: 'sbbl', division: '35 Up', record: { wins: 0, losses: 0 } },
  { id: 'sbbl-35-2', name: 'Toronto Raps', leagueId: 'sbbl', division: '35 Up', record: { wins: 0, losses: 0 } },

  // Division P7 (2 teams)
  { id: 'sbbl-p7-1', name: 'Stingers', leagueId: 'sbbl', division: 'P7', record: { wins: 0, losses: 0 } },
  { id: 'sbbl-p7-2', name: 'Team Romansa', leagueId: 'sbbl', division: 'P7', record: { wins: 0, losses: 0 } },

  // TGIF Basketball League
  { id: 't6', name: 'Solid North', leagueId: 'tgifbl', division: 'Group 1', record: { wins: 3, losses: 1 } },
  { id: 't7', name: 'OSY x LCL', leagueId: 'tgifbl', division: 'Group 1', record: { wins: 2, losses: 2 } },
  { id: 't13', name: 'Batang Riles x Tri J', leagueId: 'tgifbl', division: 'Group 2', record: { wins: 1, losses: 2 } },
  { id: 't14', name: 'J Elite', leagueId: 'tgifbl', division: 'Group 1', record: { wins: 0, losses: 3 } },
  { id: 't15', name: 'YG', leagueId: 'tgifbl', division: 'Group 2', record: { wins: 2, losses: 1 } },
  { id: 't16', name: 'Conceited Fantasy', leagueId: 'tgifbl', division: 'Group 1', record: { wins: 2, losses: 2 } },
  { id: 't17', name: 'C&F', leagueId: 'tgifbl', division: 'Group 2', record: { wins: 2, losses: 2 } },
  { id: 't18', name: 'City Above Elite', leagueId: 'tgifbl', division: 'Group 1', record: { wins: 0, losses: 3 } },
  { id: 't19', name: 'Over Under', leagueId: 'tgifbl', division: 'Group 1', record: { wins: 2, losses: 1 } },
  { id: 't20', name: 'Full Time Ballers', leagueId: 'tgifbl', division: 'Group 2', record: { wins: 3, losses: 1 } },
  { id: 't21', name: 'DBRKDZ', leagueId: 'tgifbl', division: 'Group 3', record: { wins: 3, losses: 0 } },
  { id: 't22', name: 'BLBG', leagueId: 'tgifbl', division: 'Group 3', record: { wins: 1, losses: 2 } },
  { id: 't23', name: 'Mantiku', leagueId: 'tgifbl', division: 'Group 3', record: { wins: 1, losses: 2 } },
  { id: 't24', name: 'Fourteen Ounce', leagueId: 'tgifbl', division: 'Group 1', record: { wins: 3, losses: 0 } },
  { id: 't25', name: 'Ball is Life', leagueId: 'tgifbl', division: 'Group 3', record: { wins: 3, losses: 2 } },
  { id: 't26', name: 'JC Trans Jrs', leagueId: 'tgifbl', division: 'Group 3', record: { wins: 0, losses: 3 } },
  { id: 't27', name: 'Banayad Hoopers', leagueId: 'tgifbl', division: 'Group 2', record: { wins: 0, losses: 3 } },

  // Weekend Basketball League (WBL)
  { id: 't9', name: 'OSY', leagueId: 'wbl', division: 'Main', record: { wins: 4, losses: 1 } },
  { id: 't28', name: 'Rebelde Jrs', leagueId: 'wbl', division: 'Main', record: { wins: 3, losses: 3 } },
  { id: 't29', name: 'Solid North', leagueId: 'wbl', division: 'Main', record: { wins: 4, losses: 2 } },
  { id: 't4', name: 'Crosslinx Warriors', leagueId: 'wbl', division: 'Main', record: { wins: 9, losses: 1 } },
  { id: 't11', name: 'Rebelde', leagueId: 'wbl', division: 'Main', record: { wins: 4, losses: 1 } },
  { id: 't30', name: 'Downtown', leagueId: 'wbl', division: 'Main', record: { wins: 5, losses: 2 } },
  { id: 't5', name: 'La Liga Elite', leagueId: 'wbl', division: 'Main', record: { wins: 5, losses: 5 } },
  { id: 't31', name: 'Blacksmith', leagueId: 'wbl', division: 'Main', record: { wins: 2, losses: 4 } },
  { id: 't12', name: 'Splash', leagueId: 'wbl', division: 'Main', record: { wins: 3, losses: 2 } },
  { id: 't32', name: 'SPG', leagueId: 'wbl', division: 'Main', record: { wins: 4, losses: 2 } },
  { id: 't33', name: 'Harina x Wild Dogs', leagueId: 'wbl', division: 'Main', record: { wins: 1, losses: 5 } },
  { id: 't34', name: 'NSD', leagueId: 'wbl', division: 'Main', record: { wins: 6, losses: 1 } },
  { id: 't35', name: '4Lifers', leagueId: 'wbl', division: 'Main', record: { wins: 2, losses: 5 } },
  { id: 't36', name: 'Serviteurs', leagueId: 'wbl', division: 'Main', record: { wins: 1, losses: 4 } },
  { id: 't37', name: 'Batang Kanto', leagueId: 'wbl', division: 'Main', record: { wins: 0, losses: 6 } },
  { id: 't38', name: 'Disciples', leagueId: 'wbl', division: 'Main', record: { wins: 3, losses: 3 } },
  { id: 't10', name: 'Ball is Life', leagueId: 'wbl', division: 'Main', record: { wins: 3, losses: 2 } }
];

export const players: PlayerProfile[] = [
  { id: 'p1', name: 'Marcus Rivera', number: 23, position: 'SF', teamId: 't1', leagueId: 'sbbl', avatar: player1, badges: ['MVP', 'All-Star', '3PT King'], stats: { pts: 28.4, reb: 7.2, ast: 5.1, stl: 2.3, blk: 0.8, fls: 2.1, min: 34.5 } },
  { id: 'p2', name: 'Jaylen Torres', number: 11, position: 'PG', teamId: 't2', leagueId: 'sbbl', avatar: player2, badges: ['Assist Leader', 'Floor General'], stats: { pts: 18.7, reb: 3.4, ast: 9.8, stl: 1.9, blk: 0.2, fls: 1.8, min: 32.1 } },
  { id: 'p3', name: 'Andre Santiago', number: 34, position: 'C', teamId: 't4', leagueId: 'wbl', avatar: player3, badges: ['Defensive Anchor', 'Rebound Machine'], stats: { pts: 14.2, reb: 12.6, ast: 2.1, stl: 0.8, blk: 3.4, fls: 3.2, min: 30.8 } },
  { id: 'p4', name: 'Carlos Mendez', number: 7, position: 'SG', teamId: 't6', leagueId: 'tgifbl', avatar: player1, badges: ['Clutch Performer'], stats: { pts: 22.1, reb: 4.5, ast: 4.2, stl: 1.5, blk: 0.5, fls: 2.4, min: 31.2 } },
  { id: 'p5', name: 'Darius Reyes', number: 5, position: 'PF', teamId: 't1', leagueId: 'sbbl', avatar: player2, badges: ['Rising Star'], stats: { pts: 16.8, reb: 8.9, ast: 2.8, stl: 1.1, blk: 1.7, fls: 2.9, min: 29.4 } },
  { id: 'p6', name: 'Rico Bautista', number: 15, position: 'SF', teamId: 't5', leagueId: 'wbl', avatar: player3, badges: ['6th Man'], stats: { pts: 15.3, reb: 5.1, ast: 3.7, stl: 2.0, blk: 0.6, fls: 1.5, min: 26.7 } },
  { id: 'p7', name: 'Tata Ramon', number: 8, position: 'SG', teamId: 't9', leagueId: 'wbl', avatar: potgTataRamon, badges: ['Player of the Game', 'Scorer'], stats: { pts: 22, reb: 5, ast: 6, stl: 1.5, blk: 0.5, fls: 2, min: 32 } },
  { id: 'p8', name: 'Michael Ramos', number: 3, position: 'SF', teamId: 't10', leagueId: 'wbl', avatar: potgMichaelRamos, badges: ['Player of the Game', 'All-Star'], stats: { pts: 24, reb: 7, ast: 6, stl: 1.8, blk: 0.8, fls: 1.5, min: 34 } },
  { id: 'p9', name: 'Harold Casio', number: 25, position: 'PF', teamId: 't11', leagueId: 'wbl', avatar: potgHaroldCasio, badges: ['Player of the Game', 'Rebounder'], stats: { pts: 20, reb: 7, ast: 5, stl: 1.2, blk: 1, fls: 2.5, min: 31 } },
  { id: 'p10', name: 'JT Balangui', number: 10, position: 'PG', teamId: 't12', leagueId: 'wbl', avatar: potgJtBalangui, badges: ['Player of the Game', 'Floor General'], stats: { pts: 20, reb: 6, ast: 6, stl: 2, blk: 0.4, fls: 1.8, min: 30 } },
];

export const games: Game[] = [
  { id: 'g1', leagueId: 'sbbl', homeTeam: teams[0], awayTeam: teams[1], venue: 'Panalay Arena', court: 'Court 1', date: '2026-03-29', time: '14:00', status: 'live', score: { home: 67, away: 62 }, ppvPrice: 2.50 },
  { id: 'g2', leagueId: 'wbl', homeTeam: teams[3], awayTeam: teams[24], venue: 'La Liga Sports Complex', court: 'Main Court', date: '2026-03-28', time: '16:00', status: 'upcoming', ppvPrice: 2.50 },
  { id: 'g3', leagueId: 'tgifbl', homeTeam: teams[27], awayTeam: teams[4], venue: 'Tat Stadium', court: 'Court A', date: '2026-03-27', time: '19:00', status: 'final', score: { home: 88, away: 79 }, ppvPrice: 2.50 },
  { id: 'g4', leagueId: 'sbbl', homeTeam: teams[2], awayTeam: teams[5], venue: 'Panalay Arena', court: 'Court 2', date: '2026-03-30', time: '10:00', status: 'upcoming', ppvPrice: 2.50 },
  { id: 'g5', leagueId: 'wbl', homeTeam: teams[24], awayTeam: teams[3], venue: 'La Liga Sports Complex', court: 'Court 2', date: '2026-04-04', time: '15:00', status: 'upcoming', ppvPrice: 2.50 },
  { id: 'g6', leagueId: 'sbbl', homeTeam: teams[1], awayTeam: teams[2], venue: 'Panalay Arena', court: 'Court 1', date: '2026-03-22', time: '14:00', status: 'final', score: { home: 75, away: 71 }, ppvPrice: 2.50 },
];;

export const products: Product[] = [
  {
    id: 'custom-oy-phoenix',
    name: 'OY Phoenix Custom Jersey',
    category: 'jerseys',
    price: 0,
    image: '/images/store/custom/oy-phoenix.jpg',
    sizes: ['YS', 'YXL', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL'],
    is_custom: true,
  },
  {
    id: 'custom-reborn',
    name: 'REBORN Custom Jersey',
    category: 'jerseys',
    price: 0,
    image: '/images/store/custom/reborn.jpg',
    sizes: ['YS', 'YXL', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL'],
    is_custom: true,
  },
  {
    id: 'custom-jrg',
    name: 'JRG Custom Jersey',
    category: 'jerseys',
    price: 0,
    image: '/images/store/custom/jrg.jpg',
    sizes: ['YS', 'YXL', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL'],
    is_custom: true,
  },
  {
    id: 'custom-pinoy-northstars',
    name: 'Pinoy Northstars Custom Jersey',
    category: 'jerseys',
    price: 0,
    image: '/images/store/custom/pinoy-northstars.jpg',
    sizes: ['YS', 'YXL', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL'],
    is_custom: true,
  },
  {
    id: 'custom-quadros',
    name: 'Quadros Custom Jersey',
    category: 'jerseys',
    price: 0,
    image: '/images/store/custom/quadros.jpg',
    sizes: ['YS', 'YXL', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL'],
    is_custom: true,
  },
  {
    id: 'custom-montanyosa',
    name: 'Montanyosa Custom Jersey',
    category: 'jerseys',
    price: 0,
    image: '/images/store/custom/montanyosa.jpg',
    sizes: ['YS', 'YXL', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL'],
    is_custom: true,
  },

  { id: 'prod1', name: 'SBBL HQ Official Jersey', category: 'jerseys', price: 45, image: storeJersey, sizes: ['S', 'M', 'L', 'XL', '2XL'], colors: ['Black/Gold', 'White/Gold'], sale: true },
  { id: 'prod2', name: 'APEX Hoodie', category: 'hoodies', price: 55, image: storeHoodie, sizes: ['S', 'M', 'L', 'XL'], colors: ['Black', 'Charcoal'], sale: true },
  { id: 'prod3', name: 'Championship Cap', category: 'caps', price: 25, image: storeCap, colors: ['Black/Gold', 'Black/Silver'] },
  { id: 'prod4', name: 'Court Culture Tee', category: 'tees', price: 29, image: storeTee, sizes: ['S', 'M', 'L', 'XL', '2XL'], colors: ['Black', 'Graphite'], sale: true },
  { id: 'prod5', name: 'Pro Gear Bundle', category: 'accessories', price: 35, image: storeAccessories, badge: 'Bundle Deal', sale: true },
  { id: 'prod6', name: 'MVP Rewards Jersey', category: 'rewards', price: 0, image: storeJersey, badge: 'Reward Item', sizes: ['M', 'L', 'XL'] },
];

export const mediaAssets: MediaAsset[] = [
  // SBBL marketing
  { id: 'm-sbbl-1v1', title: '1v1 Event — Fred vs Karl', type: 'poster', thumbnail: event1v1Sbbl, leagueId: 'sbbl', status: 'published', date: '2026-04-02' },
  // WBL Player of the Game cards
  { id: 'm-wbl-potg-michael', title: 'POTG — Michael Ramos (Ball is Life)', type: 'poster', thumbnail: potgMichaelRamos, leagueId: 'wbl', status: 'published', date: '2026-03-29' },
  { id: 'm-wbl-potg-tata', title: 'POTG — Tata Ramon (OSY Phoenix)', type: 'poster', thumbnail: potgTataRamon, leagueId: 'wbl', status: 'published', date: '2026-03-29' },
  { id: 'm-wbl-potg-harold', title: 'POTG — Harold Casio (Rebelde)', type: 'poster', thumbnail: potgHaroldCasio, leagueId: 'wbl', status: 'published', date: '2026-03-22' },
  { id: 'm-wbl-potg-jt', title: 'POTG — JT Balangui (Splash)', type: 'poster', thumbnail: potgJtBalangui, leagueId: 'wbl', status: 'published', date: '2026-03-22' },
  // New Event
  { id: 'm-sbbl-s11', title: 'SBBL Season 11 Spring Edition Tip Off', type: 'poster', thumbnail: eventSbblSeason11, leagueId: 'sbbl', status: 'published', date: '2026-04-12' },
  // New POTGs
  { id: 'm-wbl-potg-daryl', title: 'POTG — Daryl Gamiao (BRB)', type: 'poster', thumbnail: potgDarylGamiao, leagueId: 'wbl', status: 'published', date: '2026-04-01' },
  { id: 'm-wbl-potg-rjay', title: 'POTG — Rjay Cuntapay (SPG Cutie)', type: 'poster', thumbnail: potgRjayCuntapay, leagueId: 'wbl', status: 'published', date: '2026-04-01' },
  { id: 'm-wbl-potg-gilbert', title: 'POTG — Gilbert Bacera (Blacksmith)', type: 'poster', thumbnail: potgGilbertBacera, leagueId: 'wbl', status: 'published', date: '2026-04-01' },
  // Apr 4 POTG batch
  { id: 'm-wbl-potg-rex', title: 'POTG — Rex Aldous Manalo (Rebelde Jrs)', type: 'poster', thumbnail: potgRexManalo, leagueId: 'wbl', status: 'published', date: '2026-04-04' },
  { id: 'm-wbl-potg-angelo', title: 'POTG — Angelo Frez (Blacksmith)', type: 'poster', thumbnail: potgAngeloFrez, leagueId: 'wbl', status: 'published', date: '2026-04-04' },
  { id: 'm-wbl-potg-shawn', title: 'POTG — Shawn Cox (Serviteurs)', type: 'poster', thumbnail: potgShawnCox, leagueId: 'wbl', status: 'published', date: '2026-04-04' },
  { id: 'm-wbl-potg-jaycee', title: 'POTG — Jaycee Masilungan (Harina x Wild Dogs)', type: 'poster', thumbnail: potgJayceeMasilungan, leagueId: 'wbl', status: 'published', date: '2026-04-04' },
  { id: 'm-wbl-potg-rr', title: 'POTG — RR Fabiana (Rebelde)', type: 'poster', thumbnail: potgRrFabiana, leagueId: 'wbl', status: 'published', date: '2026-04-04' },
  { id: 'm-wbl-potg-teejay', title: 'POTG — Tee Jay Reymundo (Crosslinx Warriors)', type: 'poster', thumbnail: potgTeejayReymundo, leagueId: 'wbl', status: 'published', date: '2026-04-04' },
  { id: 'm-wbl-potg-robert', title: 'POTG — Robert Ocampo (4Lifers)', type: 'poster', thumbnail: potgRobertOcampo, leagueId: 'wbl', status: 'published', date: '2026-04-04' },
];

export const reviewItems: ReviewItem[] = [
  { id: 'r1', type: 'source_conflict', title: 'WBL Poster Source Conflict', description: 'Uploaded poster for WBL Game 5 uses unapproved sponsor imagery. Requires creative team review before publishing.', leagueId: 'wbl', severity: 'medium', status: 'pending' },
  { id: 'r2', type: 'rule_conflict', title: 'SBBL Rule Review Required', description: 'Updated overtime rules for Panalay Division A require league admin sign-off before next scheduled game.', leagueId: 'sbbl', severity: 'high', status: 'pending' },
  { id: 'r3', type: 'stream_issue', title: 'Stream Entitlement Sync Error', description: '3 viewers reported access issues after PPV purchase for SBBL Game G1. Entitlement records show mismatched session tokens.', leagueId: 'sbbl', severity: 'high', status: 'pending' },
  { id: 'r4', type: 'publish_review', title: 'Media Day Content Approval', description: 'All-Star Media Day reel pending final review before public release.', leagueId: 'sbbl', severity: 'low', status: 'pending' },
];

export const invoices: Invoice[] = [
  { id: 'inv1', description: 'SBBL Season Registration — Panalay Kings', amount: 45, date: '2026-01-15', status: 'paid', leagueId: 'sbbl' },
  { id: 'inv2', description: 'WBL Season Registration — Weekend Warriors', amount: 49, date: '2026-01-20', status: 'paid', leagueId: 'wbl' },
  { id: 'inv3', description: 'PPV Access — SBBL Game G1', amount: 2.5, date: '2026-03-29', status: 'paid', leagueId: 'sbbl' },
  { id: 'inv4', description: 'Store Order #1042 — APEX Hoodie', amount: 55, date: '2026-03-25', status: 'pending' },
  { id: 'inv5', description: 'TGIFBL Season Registration — Friday Flames', amount: 49, date: '2026-01-22', status: 'paid', leagueId: 'tgifbl' },
];


export const playersOfTheGame: PlayerOfTheGame[] = [
  { id: 'potg-wbl-1', leagueId: 'wbl', playerName: 'Michael Ramos', playerId: 'p8', team: 'Ball is Life', pts: 24, rebs: 7, assts: 6, gameResult: 'NSD 82 vs Ball is Life 84', date: '2026-03-29', image: potgMichaelRamos },
  { id: 'potg-wbl-2', leagueId: 'wbl', playerName: 'Tata Ramon', playerId: 'p7', team: 'OSY Phoenix', pts: 22, rebs: 5, assts: 6, gameResult: 'OSY 77 vs Solid North 63', date: '2026-03-29', image: potgTataRamon },
  { id: 'potg-wbl-3', leagueId: 'wbl', playerName: 'Harold Casio', playerId: 'p9', team: 'Rebelde', pts: 20, rebs: 7, assts: 5, gameResult: 'Harina x Wild Dogs 62 vs Rebelde 79', date: '2026-03-22', image: potgHaroldCasio },
  { id: 'potg-wbl-4', leagueId: 'wbl', playerName: 'JT Balangui', playerId: 'p10', team: 'Splash', pts: 20, rebs: 6, assts: 6, gameResult: 'Splash 60 vs Rebelde Jrs 51', date: '2026-03-22', image: potgJtBalangui },
  { id: 'potg-wbl-5', leagueId: 'wbl', playerName: 'Daryl Gamiao', team: 'BRB', pts: 15, rebs: 4, assts: 4, gameResult: 'BRB 61 VS SERVITEURS 54', date: '2026-04-01', image: potgDarylGamiao },
  { id: 'potg-wbl-6', leagueId: 'wbl', playerName: 'Rjay Cuntapay', team: 'SPG Cutie', pts: 14, rebs: 3, assts: 4, gameResult: 'BATANG KANTO 45 VS SPG CUTIE 69', date: '2026-04-01', image: potgRjayCuntapay },
  { id: 'potg-wbl-7', leagueId: 'wbl', playerName: 'Gilbert Bacera', team: 'Blacksmith', pts: 16, rebs: 4, assts: 5, gameResult: 'BLACKSMITH 63 VS DOWNTOWN 46', date: '2026-04-01', image: potgGilbertBacera },
  // Apr 4 POTG batch
  { id: 'potg-wbl-8', leagueId: 'wbl', playerName: 'Rex Aldous Manalo', team: 'Rebelde Jrs', pts: 24, rebs: 6, assts: 6, gameResult: 'OSY 80 VS REBELDE JRS 85', date: '2026-04-04', image: potgRexManalo },
  { id: 'potg-wbl-9', leagueId: 'wbl', playerName: 'Angelo Frez', team: 'Blacksmith', pts: 30, rebs: 6, assts: 7, gameResult: 'BLACKSMITH 84 VS LA LIGA ELITE 80', date: '2026-04-04', image: potgAngeloFrez },
  { id: 'potg-wbl-10', leagueId: 'wbl', playerName: 'Shawn Cox', team: 'Serviteurs', pts: 20, rebs: 7, assts: 6, gameResult: 'KANTO BOYS 43 VS SERVITEURS 62', date: '2026-04-04', image: potgShawnCox },
  { id: 'potg-wbl-11', leagueId: 'wbl', playerName: 'Jaycee Masilungan', team: 'Harina x Wild Dogs', pts: 22, rebs: 6, assts: 5, gameResult: 'LA LIGA ELITE 65 VS HARINA X WILD DOGS 95', date: '2026-04-04', image: potgJayceeMasilungan },
  { id: 'potg-wbl-12', leagueId: 'wbl', playerName: 'RR Fabiana', team: 'Rebelde', pts: 18, rebs: 3, assts: 4, gameResult: 'DOWNTOWN 62 VS REBELDE 67', date: '2026-04-04', image: potgRrFabiana },
  { id: 'potg-wbl-13', leagueId: 'wbl', playerName: 'Tee Jay Reymundo', team: 'Crosslinx Warriors', pts: 30, rebs: 4, assts: 4, gameResult: 'SOLID NORTH 56 VS CROSSLINX 63', date: '2026-04-04', image: potgTeejayReymundo },
  { id: 'potg-wbl-14', leagueId: 'wbl', playerName: 'Robert Ocampo', team: '4Lifers', pts: 22, rebs: 8, assts: 7, gameResult: 'NSD 65 VS 4LIFERS 71', date: '2026-04-04', image: potgRobertOcampo },
];
