# Incident Correction Log: Courtside Ops Scoring Repair & Decoupled Roster Model

**Date:** 2026-08-16  
**Status:** RESOLVED & VERIFIED GREEN  
**Author:** APEX AI Co-Founder Operating System  
**PR:** #14 (`fix/courtside-scoring-and-live-tabulation`)  

---

## 1. Problem Statement & Root Cause

1. **Database Not-Null Violation on Quick Add Player**:
   - `handleOpsQuickAddPlayer` previously attempted to insert a `public.profiles` row without satisfying database constraints or required foreign keys.
2. **Cross-Identity Collision & Accidental Auto-Merging**:
   - Fuzzy name matching without team scoping risked collapsing two real players on different rosters into one record, cross-contaminating box scores.
3. **Modal Suppression & Trapped Finalized State**:
   - Native `window.confirm()` dialogs were susceptible to browser rate-limiting and auto-suppression, leading to unresponsive clicks without error feedback.
   - Operators had no safe mechanism to correct scores once marked final.

---

## 2. Surgical Engineering Fixes

1. **Decoupled Roster Architecture**:
   - Added migration `20260816000000_decouple_roster_players.sql` to make `players.profile_id` and `players.user_id` nullable, drop unique user constraints, and add `display_name text`.
   - `handleOpsQuickAddPlayer` creates isolated player entries directly on `public.players` without touching `public.profiles`.
2. **Zero Cross-Identity Merging**:
   - Eliminated fuzzy name lookups. Every player registration on a team creates a dedicated, isolated record.
3. **`review_pending` Reopen Lifecycle**:
   - Added `review_pending` status handling to `handleOverlayStatus` and `CourtsideQuickControls.tsx`.
   - Displayed persistent `"Under Correction — not yet official"` banner while corrections are underway.
   - Replaced native dialogs with Radix `<Dialog>` modals from `@/components/ui/dialog`.
4. **Live Tabulation Scoreboard**:
   - Connected `LiveScoreboard` to `overlay_game_state` Realtime updates and `fn_live_standings_preview`.

---

## 3. Verification Evidence

- `npm run config:contracts` → PASSED (exit 0)
- `npm run secrets:contracts` → PASSED (exit 0)
- `npm run docs:drift` → PASSED (exit 0)
- `npm run lint` → PASSED (exit 0, zero warnings)
- `npm run typecheck` → PASSED (exit 0, zero errors)
- `npm test` → 1492 passed across 141 test files (exit 0)
- `npx playwright test e2e/live-scoring-tabulation-repaired.spec.ts` → 2 passed (exit 0)
- `npm run build` → Compiled production bundle in ~23.8s (exit 0)
