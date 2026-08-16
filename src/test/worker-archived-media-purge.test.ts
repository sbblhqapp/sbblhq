import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { extractStoragePaths, autonomousPurgeArchivedMedia } from '@/worker/index';

describe('extractStoragePaths', () => {
  it('extracts storage paths from public storage URLs', () => {
    const payload = {
      url: 'https://ezanilxygnpucwkwpsoc.supabase.co/storage/v1/object/public/media/potg/2026/04/potg-1.jpg',
      thumbnail_url: 'https://ezanilxygnpucwkwpsoc.supabase.co/storage/v1/object/public/media/thumbnails/thumb-1.webp',
    };
    const meta = {
      storage_path: 'potg/2026/04/potg-1-original.png',
    };

    const paths = extractStoragePaths(payload, meta);
    expect(paths).toEqual([
      { bucket: 'media', path: 'potg/2026/04/potg-1.jpg' },
      { bucket: 'media', path: 'thumbnails/thumb-1.webp' },
      { bucket: 'media', path: 'potg/2026/04/potg-1-original.png' },
    ]);
  });

  it('extracts storage paths with explicit buckets', () => {
    const payload = {
      poster_url: 'https://ezanilxygnpucwkwpsoc.supabase.co/storage/v1/object/public/league-media/banners/season-poster.jpg',
    };
    const paths = extractStoragePaths(payload);
    expect(paths).toEqual([
      { bucket: 'league-media', path: 'banners/season-poster.jpg' },
    ]);
  });

  it('ignores non-storage external URLs and empty values', () => {
    const payload = {
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      video_url: 'https://vimeo.com/123456789',
      image_url: '',
    };
    const paths = extractStoragePaths(payload);
    expect(paths).toEqual([]);
  });
});

type MockPublication = {
  id: string;
  media_asset_id: string | null;
  title: string;
  status: string;
  archived_at: string | null;
  updated_at: string | null;
  render_payload: Record<string, unknown> | null;
  media_assets: { id: string; metadata: Record<string, unknown> } | null;
};

type MockAsset = {
  id: string;
  metadata: Record<string, unknown>;
};

type AuditLogRow = {
  actor_id: string;
  action: string;
  ref_type: string;
  ref_id: string | null;
  payload: Record<string, unknown>;
  idempotency_key: string;
};

describe('Autonomous 30-Day Archived Media Purge Engine', () => {
  let mockPublications: MockPublication[] = [];
  let mockAssets: MockAsset[] = [];
  let deletedPublicationIds: string[] = [];
  let deletedAssetIds: string[] = [];
  let storageRemovedCalls: Array<{ bucket: string; paths: string[] }> = [];
  let auditLogs: AuditLogRow[] = [];

  const createMockAdmin = () => ({
    from: (table: string) => {
      if (table === 'media_publications') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn((_col: string, val: string) => ({
              or: vi.fn((_orClause: string) => {
                // Filter matching status = val and simulated expired filter
                const now = Date.now();
                const cutoff = now - 30 * 86_400_000;
                const matched = mockPublications.filter((p) => {
                  if (p.status !== val) return false;
                  const effectiveDate = new Date(p.archived_at || p.updated_at || '').getTime();
                  return effectiveDate < cutoff;
                });
                return Promise.resolve({ data: matched, error: null });
              }),
            })),
            in: vi.fn((_col: string, ids: (string | null)[]) => {
              const matched = mockPublications
                .filter((p) => ids.includes(p.media_asset_id))
                .map((p) => ({ media_asset_id: p.media_asset_id }));
              return Promise.resolve({ data: matched, error: null });
            }),
          })),
          delete: vi.fn(() => ({
            in: vi.fn((_col: string, ids: string[]) => {
              deletedPublicationIds.push(...ids);
              mockPublications = mockPublications.filter((p) => !ids.includes(p.id));
              return Promise.resolve({ error: null });
            }),
          })),
        };
      }

      if (table === 'media_assets') {
        return {
          delete: vi.fn(() => ({
            in: vi.fn((_col: string, ids: string[]) => {
              deletedAssetIds.push(...ids);
              mockAssets = mockAssets.filter((a) => !ids.includes(a.id));
              return Promise.resolve({ error: null });
            }),
          })),
        };
      }

      if (table === 'audit_logs') {
        return {
          insert: vi.fn((row: AuditLogRow) => {
            auditLogs.push(row);
            return Promise.resolve({ error: null });
          }),
        };
      }

      return {
        select: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ data: [], error: null })) })),
        insert: vi.fn(() => Promise.resolve({ error: null })),
        delete: vi.fn(() => Promise.resolve({ error: null })),
      };
    },
    storage: {
      from: (bucket: string) => ({
        remove: vi.fn((paths: string[]) => {
          storageRemovedCalls.push({ bucket, paths });
          return Promise.resolve({ error: null });
        }),
      }),
    },
  });

  const dummyEnv = {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
  } as unknown as Env;

  beforeEach(() => {
    deletedPublicationIds = [];
    deletedAssetIds = [];
    storageRemovedCalls = [];
    auditLogs = [];

    const now = Date.now();
    const thirtyFiveDaysAgo = new Date(now - 35 * 86_400_000).toISOString();
    const tenDaysAgo = new Date(now - 10 * 86_400_000).toISOString();

    mockPublications = [
      // 1. Expired archived item (> 30 days) -> SHOULD BE PURGED
      {
        id: 'pub-expired-1',
        media_asset_id: 'asset-1',
        title: 'Old Archived Poster',
        status: 'archived',
        archived_at: thirtyFiveDaysAgo,
        updated_at: thirtyFiveDaysAgo,
        render_payload: { url: 'https://example.supabase.co/storage/v1/object/public/media/potg/old-1.jpg' },
        media_assets: { id: 'asset-1', metadata: { storage_path: 'potg/old-1-raw.png' } },
      },
      // 2. Recent archived item (< 30 days) -> MUST BE PRESERVED
      {
        id: 'pub-recent-archived',
        media_asset_id: 'asset-2',
        title: 'Recent Archived Highlight',
        status: 'archived',
        archived_at: tenDaysAgo,
        updated_at: tenDaysAgo,
        render_payload: { url: 'https://example.supabase.co/storage/v1/object/public/media/clips/recent.mp4' },
        media_assets: { id: 'asset-2', metadata: {} },
      },
      // 3. Published active item (> 30 days old) -> MUST BE IMMUNE & PRESERVED
      {
        id: 'pub-active-published',
        media_asset_id: 'asset-3',
        title: 'Active Championship Poster',
        status: 'published',
        archived_at: null,
        updated_at: thirtyFiveDaysAgo,
        render_payload: { url: 'https://example.supabase.co/storage/v1/object/public/media/potg/champ.jpg' },
        media_assets: { id: 'asset-3', metadata: {} },
      },
    ];

    mockAssets = [
      { id: 'asset-1', metadata: { storage_path: 'potg/old-1-raw.png' } },
      { id: 'asset-2', metadata: {} },
      { id: 'asset-3', metadata: {} },
    ];
  });

  it('purges only archived publications older than 30 days, removes physical storage files, and deletes orphan assets', async () => {
    const admin = createMockAdmin();

    const result = await autonomousPurgeArchivedMedia(admin as unknown as SupabaseClient, dummyEnv, {
      retentionDays: 30,
      executionMode: 'autonomous',
    });

    expect(result.ok).toBe(true);
    expect(result.purgedPublications).toBe(1);
    expect(result.purgedIds).toContain('pub-expired-1');

    // Verify physical storage files were removed
    expect(storageRemovedCalls.length).toBeGreaterThan(0);
    const mediaBucketRemoval = storageRemovedCalls.find((c) => c.bucket === 'media');
    expect(mediaBucketRemoval).toBeDefined();
    expect(mediaBucketRemoval?.paths).toContain('potg/old-1.jpg');
    expect(mediaBucketRemoval?.paths).toContain('potg/old-1-raw.png');

    // Verify DB rows deleted
    expect(deletedPublicationIds).toEqual(['pub-expired-1']);
    expect(deletedAssetIds).toEqual(['asset-1']);

    // Verify recent archived and active published are completely intact
    expect(deletedPublicationIds).not.toContain('pub-recent-archived');
    expect(deletedPublicationIds).not.toContain('pub-active-published');

    // Verify audit log entry was created
    expect(auditLogs.length).toBe(1);
    expect(auditLogs[0].action).toBe('autonomous_archived_media_purge');
    expect(auditLogs[0].payload.purgedPublicationsCount).toBe(1);
  });

  it('returns zero purges gracefully when no items are expired', async () => {
    const admin = createMockAdmin();
    // Set all items to recent
    mockPublications.forEach((p) => {
      p.archived_at = new Date().toISOString();
    });

    const result = await autonomousPurgeArchivedMedia(admin as unknown as SupabaseClient, dummyEnv, {
      retentionDays: 30,
      executionMode: 'autonomous',
    });

    expect(result.ok).toBe(true);
    expect(result.purgedPublications).toBe(0);
    expect(result.storageFilesRemoved).toBe(0);
    expect(deletedPublicationIds.length).toBe(0);
  });
});
