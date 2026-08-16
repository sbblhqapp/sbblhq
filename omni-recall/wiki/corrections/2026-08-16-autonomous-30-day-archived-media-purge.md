# Omni-Recall Durable Record: Autonomous 30-Day Archived Media Database & Storage Purge Engine

**Date Recorded:** 2026-08-16  
**Scope:** Cloudflare Worker Cron, Supabase Database, Supabase Storage (`media`, `league-media`), Ops Media Console  
**Classification:** Core System Lifecycle & Storage Optimization Engine  
**Authoritative Remote:** `https://github.com/sbbl-hq/sbbl-hq.git` (`sbblhqapp/sbblhq`)  

---

## 1. Context & Business Need
The SBBL HQ media library ingests high-resolution images, POTG cards, videos, tournament graphics, and store apparel assets across three leagues (WBL, SBBL, TGIF). Previously, archiving media records left physical files in storage buckets (`media`, `league-media`) and orphaned records in PostgreSQL indefinitely unless manually deleted one-by-one.

To achieve production-grade autonomy and storage hygiene without risk to active content, an autonomous purge engine was designed, implemented, and verified.

---

## 2. Architectural Blueprint & Implementation

### 2.1 Database Lifecycle (`supabase/migrations/20260815000000_autonomous_archived_media_purge.sql`)
1. **`archived_at TIMESTAMPTZ DEFAULT NULL`**:
   - Column added to `media_publications` with partial index `idx_media_publications_archived_purge` on `(archived_at, status) WHERE status = 'archived'`.
2. **Trigger `trg_media_publications_archived_at`**:
   - Stamps `NEW.archived_at = now()` whenever `status -> 'archived'`.
   - Clears `NEW.archived_at = NULL` whenever restored/reposted to `'draft'`, `'published'`, or `'scheduled'`.
3. **RPC `purge_expired_archived_media_records(p_retention_days INT)`**:
   - Transactionally cleans up expired publications and orphaned `media_assets`.

### 2.2 Autonomous Worker Cron & Storage Engine (`src/worker/index.ts`)
1. **`extractStoragePaths(render_payload, metadata)`**:
   - Recursively resolves Supabase public/signed URLs and relative paths into `{ bucket, path }` objects across all known buckets (`media`, `league-media`, `highlight-clips`, `store-products`, `share-assets`, `player-headshots`).
   - Ignores external streaming links (YouTube, Vimeo, Twitch).
2. **`autonomousPurgeArchivedMedia(admin, env, options)`**:
   - Queries archived media where `archived_at < NOW() - 30 days`.
   - Removes physical objects via `admin.storage.from(bucket).remove(paths)`.
   - Deletes expired `media_publications` rows and orphaned `media_assets`.
   - Writes immutable entry to `audit_logs` table (`action: 'autonomous_archived_media_purge'`).
3. **Worker Scheduled Handler**:
   - `scheduled(event, env, ctx)` handler exported on worker and `validation-contract-wrapper.ts`.
   - Runs daily at `03:00 UTC` via `"triggers": { "crons": ["0 3 * * *"] }` in `wrangler.jsonc` & `wrangler.deploy.jsonc`.

### 2.3 Ops Admin Endpoints & Mobile-First UI
1. **`GET /ops/media/archived-purge-preview`**: Returns scan of expired items and referenced storage files.
2. **`POST /ops/media/archived-purge-execute`**: Allows on-demand manual maintenance runs with customizable retention window (14, 30, 60, 90 days).
3. **`MediaArchivedPurgeModal.tsx` & `MediaLibraryTab.tsx`**:
   - High-contrast dark gold and red design.
   - 100% responsive and touch-optimized for mobile viewports (390px+).
   - Real-time preview metrics, item scroll lists, policy badges, and instant deletion feedback.

---

## 3. Strict Immunity & Never-Delete Rules
- **NEVER** delete media with status `'published'`, `'draft'`, or `'scheduled'`, regardless of age.
- **NEVER** delete media archived `< 30 days` ago.
- **NEVER** delete media that has been unarchived or reposted (`archived_at = null`).
- **NEVER** delete physical storage objects that are still referenced by other active rows.

---

## 4. Verification Evidence Bundle
- **Vitest Unit Suite**: `src/test/worker-archived-media-purge.test.ts` (5/5 PASS in 10ms)
- **Full Vitest Battery**: 141 test files, 1493 tests passing (100% green)
- **Playwright E2E**: `e2e/media-archived-purge.spec.ts` (2 tests, desktop + mobile 390x844 PASS in 16.2s)
- **Visual Artifacts Captured**:
  - Desktop Modal Preview: `media-purge-modal-preview.png`
  - Desktop Purge Success: `media-purge-modal-success.png`
  - Mobile Viewport Library: `media-library-mobile-view.png`
  - Mobile Viewport Modal: `media-purge-modal-mobile.png`
