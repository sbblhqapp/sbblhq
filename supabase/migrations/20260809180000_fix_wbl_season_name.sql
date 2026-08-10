-- ─────────────────────────────────────────────────────────────────────────────
-- Correct WBL's season row name: "Season 3" → "Season 2".
--
-- WBL has exactly one row in `seasons` (id 3baf922e-8f3d-475d-84a1-422b6915e945),
-- seeded 2026-04-04 alongside SBBL's and TGIFBL's single "Season 1" rows. WBL's
-- was mislabeled "Season 3" at seed time; the league is actually in its 2nd
-- season. Confirmed with the operator before applying (2026-08-09).
--
-- Content-only fix: renames the existing row, does not insert/delete rows or
-- touch any FK (teams.season_id, schedule_slots.season_id, etc. are untouched
-- since they reference the row by id, not name).
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE public.seasons
SET name = 'Season 2'
WHERE id = '3baf922e-8f3d-475d-84a1-422b6915e945'
  AND league_id = (SELECT id FROM public.leagues WHERE code = 'WBL')
  AND name = 'Season 3';
