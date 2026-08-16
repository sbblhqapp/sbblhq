-- Autonomous Archived Media Purge Engine: 30-Day Retention Lifecycle
-- Migration: 20260815000000
-- Closes: permanent storage leaks, orphaned database records, manual maintenance overhead

-- ============================================================
-- 1. archived_at column & backfill
-- ============================================================
ALTER TABLE media_publications
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ DEFAULT NULL;

-- Backfill existing archived rows using updated_at
UPDATE media_publications
  SET archived_at = COALESCE(updated_at, sort_at, now())
  WHERE status = 'archived' AND archived_at IS NULL;

-- ============================================================
-- 2. Trigger to manage archived_at on status transitions
--    - When status -> 'archived': stamp archived_at = now()
--    - When status -> 'published', 'draft', 'scheduled': reset archived_at = NULL (timer cancelled)
-- ============================================================
CREATE OR REPLACE FUNCTION media_publications_set_archived_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'archived' THEN
    IF OLD.status IS NULL OR OLD.status != 'archived' OR NEW.archived_at IS NULL THEN
      NEW.archived_at = COALESCE(NEW.archived_at, now());
    END IF;
  ELSE
    NEW.archived_at = NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_media_publications_archived_at ON media_publications;
CREATE TRIGGER trg_media_publications_archived_at
  BEFORE INSERT OR UPDATE ON media_publications
  FOR EACH ROW
  EXECUTE FUNCTION media_publications_set_archived_at();

-- ============================================================
-- 3. Partial index for lightning-fast purge queries
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_media_publications_archived_purge
  ON media_publications (archived_at, status)
  WHERE status = 'archived';

-- ============================================================
-- 4. Purge RPC: Atomic deletion of expired publications & orphan assets
--    Returns purged publication IDs, asset IDs, and referenced storage paths
-- ============================================================
CREATE OR REPLACE FUNCTION purge_expired_archived_media_records(p_retention_days INT DEFAULT 30)
RETURNS TABLE(
  purged_publication_id UUID,
  purged_media_asset_id UUID,
  storage_path TEXT,
  archived_at TIMESTAMPTZ
) AS $$
DECLARE
  v_cutoff TIMESTAMPTZ;
BEGIN
  v_cutoff := now() - (p_retention_days || ' days')::INTERVAL;

  -- Create temporary table to hold items to purge
  CREATE TEMP TABLE temp_expired_media ON COMMIT DROP AS
  SELECT 
    mp.id AS pub_id,
    mp.media_asset_id AS asset_id,
    mp.archived_at AS arc_at,
    COALESCE(
      mp.render_payload->>'storage_path',
      mp.render_payload->>'objectPath',
      mp.render_payload->>'url',
      ma.metadata->>'storage_path',
      ma.metadata->>'objectPath',
      ma.metadata->>'url'
    ) AS s_path
  FROM media_publications mp
  LEFT JOIN media_assets ma ON ma.id = mp.media_asset_id
  WHERE mp.status = 'archived'
    AND mp.archived_at IS NOT NULL
    AND mp.archived_at < v_cutoff;

  -- Delete from media_publications (returns purged records)
  RETURN QUERY
  DELETE FROM media_publications mp
  USING temp_expired_media t
  WHERE mp.id = t.pub_id
  RETURNING mp.id, mp.media_asset_id, t.s_path, mp.archived_at;

  -- Clean up orphaned media_assets that have no other publications or active clips
  DELETE FROM media_assets ma
  WHERE ma.id IN (SELECT asset_id FROM temp_expired_media WHERE asset_id IS NOT NULL)
    AND NOT EXISTS (
      SELECT 1 FROM media_publications remaining_mp
      WHERE remaining_mp.media_asset_id = ma.id
    );

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execution to service role
GRANT EXECUTE ON FUNCTION purge_expired_archived_media_records(INT) TO service_role;
