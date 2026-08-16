-- =============================================================================
-- Migration: SBBL Season 12 Teams, Divisions, and Match Schedule (2026-08-16)
-- =============================================================================

-- 1. Ensure SBBL Season 12 row exists and is published
INSERT INTO public.seasons (league_id, name, status)
SELECT id, 'Season 12', 'published'
FROM public.leagues
WHERE code = 'SBBL'
ON CONFLICT (league_id, name) DO UPDATE SET status = 'published';

-- 2. Ensure Divisions exist for SBBL Season 12
WITH sbbl_ctx AS (
  SELECT l.id AS league_id, s.id AS season_id
  FROM public.leagues l
  JOIN public.seasons s ON s.league_id = l.id AND s.name = 'Season 12'
  WHERE l.code = 'SBBL'
)
INSERT INTO public.divisions (league_id, season_id, name)
SELECT c.league_id, c.season_id, d.name
FROM sbbl_ctx c
CROSS JOIN (VALUES
  ('P10'),
  ('P9'),
  ('35 Up'),
  ('P7')
) AS d(name)
ON CONFLICT (season_id, name) DO NOTHING;

-- 3. Archive/Unpublish old legacy SBBL teams from previous seasons
UPDATE public.teams
SET status = 'archived'
WHERE league_id = (SELECT id FROM public.leagues WHERE code = 'SBBL')
  AND season_id != (
    SELECT s.id
    FROM public.seasons s
    JOIN public.leagues l ON l.id = s.league_id AND l.code = 'SBBL'
    WHERE s.name = 'Season 12'
  );

-- 4. Insert all 36 current SBBL Season 12 teams with divisions and initial records
WITH sbbl_ctx AS (
  SELECT l.id AS league_id, s.id AS season_id
  FROM public.leagues l
  JOIN public.seasons s ON s.league_id = l.id AND s.name = 'Season 12'
  WHERE l.code = 'SBBL'
),
div_map AS (
  SELECT id AS division_id, name AS div_name, season_id
  FROM public.divisions
),
team_list(name, division_name) AS (VALUES
  -- Division P10 (20 teams)
  ('Northstar P10', 'P10'),
  ('Riverside', 'P10'),
  ('Smesh', 'P10'),
  ('Rebelde Cutie', 'P10'),
  ('JS Elite', 'P10'),
  ('Kanto Terrors', 'P10'),
  ('Legendary Dream Giver', 'P10'),
  ('North York Valors', 'P10'),
  ('Northside', 'P10'),
  ('Forest Hill', 'P10'),
  ('Macao Imperial Tea', 'P10'),
  ('Brewers OG', 'P10'),
  ('Panday', 'P10'),
  ('Downtown', 'P10'),
  ('Lakehurst Boys', 'P10'),
  ('Strikers', 'P10'),
  ('Airside Ballers', 'P10'),
  ('Tita Hunters', 'P10'),
  ('SPG Workmates', 'P10'),
  ('421 Bois', 'P10'),

  -- Division P9 (12 teams)
  ('Northstar P9', 'P9'),
  ('Rebelde Jrs.', 'P9'),
  ('GLS Titos', 'P9'),
  ('Rawstar', 'P9'),
  ('Slam Drunks', 'P9'),
  ('Almighty', 'P9'),
  ('PTB Jrs.', 'P9'),
  ('Young Bucks', 'P9'),
  ('Droas Jrs.', 'P9'),
  ('Brotherhood', 'P9'),
  ('SPG Jrs.', 'P9'),
  ('Kapwa', 'P9'),

  -- Division 35 Up (2 teams)
  ('Sansuwi', '35 Up'),
  ('Toronto Raps', '35 Up'),

  -- Division P7 (2 teams)
  ('Stingers', 'P7'),
  ('Team Romansa', 'P7')
)
INSERT INTO public.teams (league_id, season_id, division_id, name, status, record)
SELECT
  c.league_id,
  c.season_id,
  d.division_id,
  t.name,
  'published',
  '{"wins":0,"losses":0,"ptsFor":0,"ptsAgainst":0}'::jsonb
FROM sbbl_ctx c
CROSS JOIN team_list t
JOIN div_map d ON d.season_id = c.season_id AND d.div_name = t.division_name
ON CONFLICT (season_id, name) DO UPDATE
  SET division_id = EXCLUDED.division_id,
      status = 'published',
      record = EXCLUDED.record;

-- 5. Seed the 18 upcoming games for August 16, 2026 (SBBL Season 12)
WITH sbbl_ctx AS (
  SELECT l.id AS league_id, s.id AS season_id
  FROM public.leagues l
  JOIN public.seasons s ON s.league_id = l.id AND s.name = 'Season 12'
  WHERE l.code = 'SBBL'
)
INSERT INTO public.games (
  league_id, season_id, home_team_id, away_team_id,
  status, category, game_date, notes, published
)
SELECT
  c.league_id, c.season_id, ht.id, at.id,
  'upcoming', 'league', g.gd::date, g.notes, true
FROM sbbl_ctx c
CROSS JOIN (VALUES
  -- Court 1 Games
  ('Northstar P10', 'Riverside', '2026-08-16', 'Court 1 | 9:00 AM - 10:00 AM | (P10)'),
  ('Smesh', 'Rebelde Cutie', '2026-08-16', 'Court 1 | 10:00 AM - 11:00 AM | (P10)'),
  ('Northstar P9', 'Rebelde Jrs.', '2026-08-16', 'Court 1 | 11:00 AM - 12:00 PM | (P9)'),
  ('JS Elite', 'Kanto Terrors', '2026-08-16', 'Court 1 | 12:00 PM - 1:00 PM | (P10)'),
  ('GLS Titos', 'Rawstar', '2026-08-16', 'Court 1 | 1:00 PM - 2:00 PM | (P9)'),
  ('Sansuwi', 'Toronto Raps', '2026-08-16', 'Court 1 | 2:00 PM - 3:00 PM | (35 Up)'),
  ('Legendary Dream Giver', 'North York Valors', '2026-08-16', 'Court 1 | 3:00 PM - 4:00 PM | (P10)'),
  ('Slam Drunks', 'Almighty', '2026-08-16', 'Court 1 | 4:00 PM - 5:00 PM | (P9)'),
  ('Northside', 'Forest Hill', '2026-08-16', 'Court 1 | 5:00 PM - 6:00 PM | (P10)'),
  ('PTB Jrs.', 'Young Bucks', '2026-08-16', 'Court 1 | 6:00 PM - 7:00 PM | (P9)'),
  ('Macao Imperial Tea', 'Brewers OG', '2026-08-16', 'Court 1 | 7:00 PM - 8:00 PM | (P10)'),

  -- Court 2 Games
  ('Droas Jrs.', 'Brotherhood', '2026-08-16', 'Court 2 | 12:00 PM - 1:00 PM | (P9)'),
  ('Panday', 'Downtown', '2026-08-16', 'Court 2 | 1:00 PM - 2:00 PM | (P10)'),
  ('Lakehurst Boys', 'Strikers', '2026-08-16', 'Court 2 | 2:00 PM - 3:00 PM | (P10)'),
  ('Airside Ballers', 'Tita Hunters', '2026-08-16', 'Court 2 | 3:00 PM - 4:00 PM | (P10)'),
  ('SPG Workmates', '421 Bois', '2026-08-16', 'Court 2 | 4:00 PM - 5:00 PM | (P10)'),
  ('SPG Jrs.', 'Kapwa', '2026-08-16', 'Court 2 | 5:00 PM - 6:00 PM | (P9)'),
  ('Stingers', 'Team Romansa', '2026-08-16', 'Court 2 | 6:00 PM - 7:00 PM | (P7)')
) AS g(hn, an, gd, notes)
JOIN public.teams ht ON ht.name = g.hn AND ht.league_id = c.league_id AND ht.season_id = c.season_id
JOIN public.teams at ON at.name = g.an AND at.league_id = c.league_id AND at.season_id = c.season_id;
