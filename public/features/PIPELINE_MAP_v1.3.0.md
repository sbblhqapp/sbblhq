<!-- Version: v1.5.0 | Date: 2026-08-16 | Status: Public -->
# Ops Ingress and Rendering Pipeline

## Ingress Routes
- `/ops/imports/teams` — CSV bulk team roster importing with division assignment
- `/ops/imports/players` — CSV player roster importing
- `/ops/imports/schedules` — CSV match schedule and court slot importing
- `/ops/imports/events` — League tournament and exhibition events
- `/ops/potg/parse` — Vision extraction of Player of the Game graphic metadata
- `/ops/potg/submit` — Direct POTG card creation
- `/ops/store/media` — Retail product asset upload
- `/ops/scores/import` — Historic game score backfills
- `/ops/scores/game` — Single match score creation
- `/ops/scores/parse-image` — Vision extraction of scorebug graphics
- `/ops/ingest/presign` — Pre-signed Cloudflare R2 upload authorization
- `/ops/ingest/submit` — Ingest job initialization
- `/api/ops/games/:gameId/quick-player` — Courtside walk-on player insertion
- `/api/ops/games/:gameId/player-stats` — 1-tap individual player stat tabulation
- `/api/ops/overlay/:gameId/score` — Scorebug live increments (+1 FT, +2 FG, +3 3PT, -1)
- `/api/ops/overlay/:gameId/clock` — Clock management (start, stop, adjust, set)
- `/api/ops/overlay/:gameId/status` — State lifecycle transitions (live, final, review_pending)
- `/api/ops/media/purge-execute` — 30-day autonomous media retention purge

## Parser and Normalization
- POTG parser extracts player, team, and stat lines.
- Scoreboard parser extracts team labels, scores, and status.
- Courtside scoring engine tabulates 1-tap game statistics directly to player profiles and box scores.
- Image preparation enforces deterministic resize dimensions before persistence.

## Persistence and Projection
- Ingest writes are projected through publication layer records.
- Public pages render from publication-safe rows, not raw upload payloads.
- Standings are computed via `mvw_standings` and refreshed on official `final` game status.
- In-game live standings are projected via `fn_live_standings_preview()`.

## Active League & Season Architecture
- **SBBL**: Season 12 (Divisions: `P10`, `P9`, `35 Up`, `P7`)
- **WBL**: Season 2 (Division: `Main`)
- **TGIFBL**: Season 1 (Divisions: `Group 1`, `Group 2`, `Group 3`)

## Public Render Endpoints
- `/api/public/media` — Publication-ready media gallery
- `/api/public/potg` — Player of the Game cards
- `/api/public/schedule` — Multi-league court schedules and game times
- `/api/public/games/:gameId/player-stats` — Live player box score and roster listing
- `/api/scores` — Scores and match results
- `/api/teams` — Published team standings and rosters

## Fit/Resize Contract
- Portrait card target: `560x747`
- Landscape graphic target: `747x560`
- Store media target: `800x800`
- Grid containers render with `3:4` card constraints.

## Evidence
- `docs/quality/INGRESS_RENDER_QA_MATRIX_2026-04-07_v1.3.0.md`
- `docs/features/COURTSIDE_OPS_SCORING_AND_LIVE_TABULATION_v4.0.0.md`
- `e2e/live-courtside-statistician-realworld.spec.ts`
