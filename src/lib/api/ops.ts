import { apiFetch } from '@/lib/api/client';
import { createIdempotencyKey, IDEMPOTENCY_HEADER } from '@/lib/api/idempotency';

export type ImportJob = {
  id: string;
  job_type: string;
  status: string;
  total_rows: number;
  inserted_rows: number;
  failed_rows: number;
  created_at: string;
  error_summary: string | null;
};

export type LeagueRef = { id: string; name: string; code: string };
export type SeasonRef = { id: string; name: string; league_id: string };
export type DivisionRef = { id: string; name: string; season_id: string };
export type VenueRef = { id: string; name: string };

export async function fetchOpsBootstrap() {
  return apiFetch<{
    ok: boolean;
    user: { userId: string; email: string | null };
    roles: string[];
    references: {
      leagues: LeagueRef[];
      seasons: SeasonRef[];
      divisions: DivisionRef[];
      venues: VenueRef[];
    };
    importHistory: ImportJob[];
  }>('/ops/bootstrap');
}

export type IngressFailure = {
  correlation_id: string;
  error_reason: string;
  source_type: string;
  status: string;
  created_at: string;
};

export type PipelineMetric = { value: number; warn: number; critical: number; status: 'ok' | 'warn' | 'critical' };
export type PipelineHealth = {
  ok: boolean;
  overall: 'ok' | 'warn' | 'critical';
  metrics: Record<string, PipelineMetric>;
  alerts: string[];
  checked_at: string;
};

export async function fetchPipelineHealth() {
  return apiFetch<PipelineHealth>('/ops/pipeline/health');
}

export async function mergePlayerIdentities(sourcePlayerId: string, targetPlayerId: string) {
  return apiFetch<{ ok: boolean; statsReassigned: number; conflictsSkipped: number; message: string }>('/ops/players/merge', {
    method: 'POST',
    headers: { [IDEMPOTENCY_HEADER]: createIdempotencyKey(`merge-${sourcePlayerId}-${targetPlayerId}`) },
    body: JSON.stringify({ sourcePlayerId, targetPlayerId }),
  });
}

export async function fetchImportHistory() {
  return apiFetch<{ ok: boolean; jobs: ImportJob[]; ingress_failures?: IngressFailure[] }>('/ops/imports/history');
}

export async function uploadCsv(params: {
  kind: 'teams' | 'players' | 'schedules' | 'events' | 'scores';
  csvText?: string;
  rows?: Array<Record<string, string>>;
  format?: string;
  idempotencyKey?: string;
}) {
  const idKey = params.idempotencyKey ?? createIdempotencyKey(`upload-csv-${params.kind}`);
  return apiFetch<{
    ok: boolean;
    inserted: number;
    failed: number;
    errors?: Array<{ row: number; field?: string; code: string; message: string }>;
  }>('/api/ops/upload/csv', {
    method: 'POST',
    headers: { [IDEMPOTENCY_HEADER]: idKey },
    body: JSON.stringify(params),
  });
}

export async function parseEventImage(imageBase64: string, mimeType: string) {
  return apiFetch<{
    ok: boolean;
    data: { title: string; location: string; date: string; leagueId: string };
  }>('/ops/event/parse', {
    method: 'POST',
    body: JSON.stringify({ imageBase64, mimeType }),
  });
}

export async function parsePotgImage(imageBase64: string, mimeType: string) {
  return apiFetch<{
    ok: boolean;
    data: { playerName: string; team: string; pts: number; rebs: number; assts: number; gameResult: string };
  }>('/ops/potg/parse', {
    method: 'POST',
    body: JSON.stringify({ imageBase64, mimeType }),
  });
}

export type ParsedRosterPlayer = { name: string; jerseyNumber: number | null; position: string | null };

export async function parseRosterImage(imageBase64: string, mimeType: string) {
  return apiFetch<{
    ok: boolean;
    data: { teamName: string; players: ParsedRosterPlayer[] };
  }>('/ops/roster/parse-image', {
    method: 'POST',
    body: JSON.stringify({ imageBase64, mimeType }),
  });
}

export async function importRoster(params: {
  leagueId: string;
  seasonId: string;
  teamName: string;
  players: Array<{ name: string; jerseyNumber?: number | string | null; position?: string | null }>;
}) {
  return apiFetch<{
    ok: boolean;
    teamId: string;
    inserted: number;
    skipped: number;
    failed: number;
    warnings: string[];
    errors: string[];
  }>('/ops/roster/import', {
    method: 'POST',
    headers: { [IDEMPOTENCY_HEADER]: createIdempotencyKey(`roster-import-${params.leagueId}-${params.teamName}`) },
    body: JSON.stringify(params),
  });
}

export async function fetchOpsList(entity: 'teams' | 'players' | 'products' | 'events' | 'schedules') {
  return apiFetch<{ ok: boolean; data: unknown[] }>(`/ops/list/${entity}`);
}

export type TeamRef = { id: string; name: string; league_id: string | null; status?: string };
export type PlayerRef = {
  id: string;
  user_id: string;
  team_id: string | null;
  league_id: string | null;
  display_name: string | null;
  team_name: string | null;
  is_suspended?: boolean;
};
export type EventRef = { id: string; title: string; league_id: string | null; starts_at: string | null };
export type ScheduleRef = {
  id: string;
  league_id: string;
  season_id: string;
  starts_at: string;
  status?: string;
  league_code: string | null;
  league_name: string | null;
};

/**
 * Find-or-create a player by display name — replaces the old raw "User ID
 * (UUID)" Create Player contract, which had no search endpoint to find an
 * existing account with. Reuses the same name-based provisioning logic
 * already proven by Roster Import / POTG ingest.
 */
export async function findOrCreatePlayer(params: {
  name: string;
  leagueId: string;
  teamId?: string;
  jerseyNumber?: string;
  position?: string;
}) {
  return apiFetch<{
    ok: boolean;
    playerId: string;
    userId: string;
    provisioned: boolean;
    warnings: string[];
    player: Record<string, unknown>;
  }>('/ops/players/find-or-create', {
    method: 'POST',
    headers: { [IDEMPOTENCY_HEADER]: createIdempotencyKey(`player-find-or-create-${params.name}-${params.leagueId}`) },
    body: JSON.stringify(params),
  });
}

// ── Media Editor (Admin) ──────────────────────────────────────────────────
// Super-admin CRUD over media_publications (covers drafts + archived rows
// that the public /api/public/media feed intentionally hides).

export type MediaPublicationStatus = 'draft' | 'scheduled' | 'published' | 'archived';

export type OpsMediaPublication = {
  id: string;
  mediaAssetId: string;
  surface: string;
  title: string;
  subtitle: string | null;
  status: MediaPublicationStatus;
  publishedAt: string | null;
  scheduledAt: string | null;
  sortAt: string | null;
  sortOrder: number | null;
  leagueId: string | null;
  leagueCode: string | null;
  leagueName: string | null;
  type: string;
  thumbnail: string;
  createdAt: string | null;
  /** ISO timestamp when pinned, null = not pinned */
  pinnedAt: string | null;
  /** Parser flagged this publication for manual review */
  needsReview: boolean;
  /** Parser confidence score 0-1, null if not parsed */
  confidence: number | null;
  /** Fields the parser was uncertain about */
  uncertainFields: string[] | null;
  updatedAt: string | null;
};

export type OpsMediaListFilters = {
  status?: MediaPublicationStatus | 'all';
  surface?: string | 'all';
  leagueId?: string;
  limit?: number;
  /** Server-side search: ILIKE on title + subtitle */
  q?: string;
  /** Filter by pinned status: true = pinned only, false/undefined = all */
  pinned?: boolean;
  /** Sort order: 'newest' (default) or 'sort_order' */
  orderBy?: 'newest' | 'sort_order';
};

export async function fetchOpsMediaList(filters: OpsMediaListFilters = {}) {
  const params = new URLSearchParams();
  if (filters.status && filters.status !== 'all') params.set('status', filters.status);
  if (filters.surface && filters.surface !== 'all') params.set('surface', filters.surface);
  if (filters.leagueId) params.set('leagueId', filters.leagueId);
  if (filters.limit) params.set('limit', String(filters.limit));
  if (filters.q) params.set('q', filters.q);
  if (filters.pinned !== undefined) params.set('pinned', String(filters.pinned));
  if (filters.orderBy) params.set('orderBy', filters.orderBy);
  const qs = params.toString();
  const suffix = qs.length > 0 ? `?${qs}` : '';
  return apiFetch<{ ok: boolean; data: OpsMediaPublication[] }>(`/ops/list/media${suffix}`);
}

export async function patchOpsMediaPublication(
  id: string,
  payload: {
    title?: string;
    subtitle?: string | null;
    status?: MediaPublicationStatus;
    leagueId?: string | null;
    sortAt?: string;
    /** null to unpin, ISO timestamp to pin */
    pinnedAt?: string | null;
  },
) {
  return apiFetch<{ ok: boolean; data: Record<string, unknown> }>(
    `/ops/media/publications/${id}`,
    {
      method: 'PATCH',
      headers: { [IDEMPOTENCY_HEADER]: createIdempotencyKey(`ops-media-patch-${id}`) },
      body: JSON.stringify(payload),
    },
  );
}

export async function deleteOpsMediaPublication(id: string) {
  return apiFetch<{ ok: boolean; data: Record<string, unknown> }>(
    `/ops/media/publications/${id}`,
    {
      method: 'DELETE',
      headers: { [IDEMPOTENCY_HEADER]: createIdempotencyKey(`ops-media-delete-${id}`) },
    },
  );
}

export async function updateOpsMediaPublicationOrder(items: Array<{ id: string; sortOrder: number }>) {
  return apiFetch<{ ok: boolean; updated: number }>('/ops/media/publications/order', {
    method: 'POST',
    headers: { [IDEMPOTENCY_HEADER]: createIdempotencyKey('ops-media-order-save') },
    body: JSON.stringify({ items }),
  });
}

// ── Media Intelligence Overhaul — new API wrappers ────────────────────────

/** Restore an archived publication back to draft. Idempotent for non-archived. */
export async function restoreMediaPublication(id: string) {
  return apiFetch<{ ok: boolean; data: Record<string, unknown> }>(
    `/ops/media/publications/${id}/restore`,
    {
      method: 'POST',
      headers: { [IDEMPOTENCY_HEADER]: createIdempotencyKey(`ops-media-restore-${id}`) },
      body: JSON.stringify({}),
    },
  );
}

export type StaleCleanupPreviewResponse = {
  ok: boolean;
  totalAffected: number;
  publications: Array<OpsMediaPublication & { daysSincePublish: number }>;
  excludedPinned: number;
  excludedRecentlyEdited: number;
};

/** Preview which publications would be affected by stale cleanup. */
export async function previewStaleCleanup(params?: { olderThanDays?: number }) {
  return apiFetch<StaleCleanupPreviewResponse>(
    '/ops/media/stale-cleanup-preview',
    {
      method: 'POST',
      headers: { [IDEMPOTENCY_HEADER]: createIdempotencyKey('ops-stale-preview') },
      body: JSON.stringify(params ?? {}),
    },
  );
}

export type StaleCleanupExecuteResponse = {
  ok: boolean;
  archived: number;
  ids: string[];
};

/** Execute stale cleanup — archives all matching publications. Re-validates server-side. */
export async function executeStaleCleanup(params?: { olderThanDays?: number }) {
  return apiFetch<StaleCleanupExecuteResponse>(
    '/ops/media/stale-cleanup-execute',
    {
      method: 'POST',
      headers: { [IDEMPOTENCY_HEADER]: createIdempotencyKey('ops-stale-execute') },
      body: JSON.stringify(params ?? {}),
    },
  );
}

export type BulkArchiveResponse = {
  ok: boolean;
  archived: number;
  ids: string[];
};

export type BulkArchiveErrorResponse = {
  ok: false;
  error: string;
  invalidIds?: string[];
};

/** Bulk archive multiple publications atomically via Postgres RPC. */
export async function bulkArchiveMedia(ids: string[]) {
  return apiFetch<BulkArchiveResponse>(
    '/ops/media/bulk-archive',
    {
      method: 'POST',
      headers: { [IDEMPOTENCY_HEADER]: createIdempotencyKey('ops-media-bulk-archive') },
      body: JSON.stringify({ ids }),
    },
  );
}

export type ArchivedMediaPurgePreviewResponse = {
  ok: boolean;
  totalEligible: number;
  totalStorageFiles: number;
  retentionDays: number;
  cutoffDate: string;
  publications: Array<{
    id: string;
    mediaAssetId: string | null;
    title: string;
    surface: string;
    leagueCode: string | null;
    archivedAt: string;
    daysArchived: number;
    storagePaths: string[];
  }>;
};

export type ArchivedMediaPurgeExecuteResponse = {
  ok: boolean;
  purgedPublications: number;
  purgedAssets: number;
  storageFilesRemoved: number;
  purgedIds: string[];
  removedStoragePaths: string[];
  criteria: { retentionDays: number; cutoffDate: string; executionMode: string };
};

/** Preview archived media eligible for autonomous/manual 30-day purge */
export async function previewArchivedMediaPurge(days = 30) {
  return apiFetch<ArchivedMediaPurgePreviewResponse>(
    `/ops/media/archived-purge-preview?days=${days}`
  );
}

/** Execute manual on-demand purge of archived media older than 30 days */
export async function executeArchivedMediaPurge(days = 30) {
  return apiFetch<ArchivedMediaPurgeExecuteResponse>(
    '/ops/media/archived-purge-execute',
    {
      method: 'POST',
      headers: { [IDEMPOTENCY_HEADER]: createIdempotencyKey('ops-archived-purge-execute') },
      body: JSON.stringify({ retentionDays: days }),
    },
  );
}

/** Toggle pin on a publication. null = unpin, ISO timestamp = pin. */
export async function toggleMediaPin(id: string, pinned: boolean) {
  return patchOpsMediaPublication(id, {
    pinnedAt: pinned ? new Date().toISOString() : null,
  });
}

export async function patchOpsEntity(entity: 'teams' | 'players' | 'products' | 'events' | 'schedules', id: string, payload: Record<string, unknown>) {
  return apiFetch<{ ok: boolean; data: unknown }>(`/ops/${entity}/${id}`, {
    method: 'PATCH',
    headers: { [IDEMPOTENCY_HEADER]: createIdempotencyKey(`ops-patch-${entity}-${id}`) },
    body: JSON.stringify(payload),
  });
}

export async function deleteOpsEntity(entity: 'teams' | 'players' | 'products' | 'events', id: string) {
  return apiFetch<{ ok: boolean; data: unknown }>(`/ops/${entity}/${id}`, {
    method: 'DELETE',
    headers: { [IDEMPOTENCY_HEADER]: createIdempotencyKey(`ops-delete-${entity}-${id}`) },
  });
}

// ── manualOpsAction — routes to real schema-correct endpoints ─────────────
// The scaffold /ops/manual/:kind/:action route has been deleted from the worker
// (it had schema drift: products.publish_status, products.inventory_qty, etc.).
// This function keeps the same call signature for Ops.tsx but routes each
// action to the correct real backend path.
export async function manualOpsAction(
  kind: 'team' | 'player' | 'schedule' | 'event' | 'store',
  action: 'create' | 'delete' | 'suspend' | 'batch_create',
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  const idem = (tag: string) => ({ [IDEMPOTENCY_HEADER]: createIdempotencyKey(tag) });

  // ── Teams ──────────────────────────────────────────────────────────────
  if (kind === 'team') {
    if (action === 'create') {
      return apiFetch('/ops/imports/teams', {
        method: 'POST', ...idem('manual-team-create'),
        body: JSON.stringify({ rows: [{ name: payload.name, leagueId: payload.leagueId, seasonId: payload.seasonId, division: payload.division }] }),
      });
    }
    if (action === 'delete') {
      return apiFetch(`/ops/teams/${payload.id}`, { method: 'DELETE', ...idem(`manual-team-delete-${payload.id}`) });
    }
  }

  // ── Players ────────────────────────────────────────────────────────────
  if (kind === 'player') {
    if (action === 'create') {
      return apiFetch('/ops/imports/players', {
        method: 'POST', ...idem('manual-player-create'),
        body: JSON.stringify({ rows: [{ userId: payload.userId, teamId: payload.teamId, leagueId: payload.leagueId, jerseyNumber: payload.jerseyNumber, position: payload.position }] }),
      });
    }
    if (action === 'suspend') {
      return apiFetch(`/ops/players/${payload.id}`, {
        method: 'PATCH', ...idem(`manual-player-suspend-${payload.id}`),
        body: JSON.stringify({ is_suspended: true }),
      });
    }
    if (action === 'delete') {
      return apiFetch(`/ops/players/${payload.id}`, { method: 'DELETE', ...idem(`manual-player-delete-${payload.id}`) });
    }
  }

  // ── Schedules ──────────────────────────────────────────────────────────
  if (kind === 'schedule') {
    if (action === 'create') {
      return apiFetch('/ops/imports/schedules', {
        method: 'POST', ...idem('manual-schedule-create'),
        body: JSON.stringify({ rows: [{ leagueId: payload.leagueId, seasonId: payload.seasonId, startsAt: payload.startsAt, endsAt: payload.endsAt }] }),
      });
    }
    if (action === 'delete') {
      return apiFetch(`/ops/schedules/${payload.id}`, { method: 'DELETE', ...idem(`manual-schedule-delete-${payload.id}`) });
    }
  }

  // ── Events ─────────────────────────────────────────────────────────────
  if (kind === 'event') {
    if (action === 'create') {
      return apiFetch('/ops/imports/events', {
        method: 'POST', ...idem('manual-event-create'),
        body: JSON.stringify({ rows: [{ title: payload.title, location: payload.location, date: payload.date, leagueId: payload.leagueId }] }),
      });
    }
    if (action === 'delete') {
      return apiFetch(`/ops/events/${payload.id}`, { method: 'DELETE', ...idem(`manual-event-delete-${payload.id}`) });
    }
  }

  // ── Store ──────────────────────────────────────────────────────────────
  if (kind === 'store') {
    if (action === 'batch_create') {
      return apiFetch('/ops/products/batch', {
        method: 'POST', ...idem('manual-store-batch'),
        body: JSON.stringify({ items: payload.items }),
      });
    }
    if (action === 'suspend') {
      return apiFetch(`/ops/products/${payload.id}`, {
        method: 'PATCH', ...idem(`manual-store-suspend-${payload.id}`),
        body: JSON.stringify({ status: 'archived' }),
      });
    }
    if (action === 'delete') {
      return apiFetch(`/ops/products/${payload.id}`, { method: 'DELETE', ...idem(`manual-store-delete-${payload.id}`) });
    }
  }

  return { ok: false, error: `no_route_for_${kind}_${action}` };
}

// ── Generic media publish ─────────────────────────────────────────────────
// Writes media_assets + media_publications for any surface without creating a
// store product. Used by the Events tab (surface='event') and ad-hoc uploads.
export async function publishMedia(payload: {
  title: string;
  surface: 'potg' | 'event' | 'store' | 'media_feed';
  leagueId?: string | null;
  date?: string;
  imageUrl: string;
  publishStatus?: 'draft' | 'published';
}) {
  return apiFetch<{ ok: boolean; mediaAssetId: string; publicationId: string }>(
    '/ops/media/publish',
    {
      method: 'POST',
      headers: { [IDEMPOTENCY_HEADER]: createIdempotencyKey(`ops-media-publish-${payload.surface}-${payload.title}`) },
      body: JSON.stringify(payload),
    }
  );
}

// ── Canonical ingest API ──────────────────────────────────────────────────

export type IngestKind = 'potg' | 'store' | 'event' | 'generic';

export type IngestJob = {
  id: string;
  kind: IngestKind;
  state: string;
  confidence: number | null;
  asset_path: string;
  payload: Record<string, unknown>;
  parse_result: Record<string, unknown> | null;
  media_asset_id: string | null;
  publication_id: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

/** Step 1 — get a signed upload URL for the private media-ingest bucket. */
export async function ingestPresign(kind: IngestKind, filename: string) {
  return apiFetch<{ ok: boolean; signedUrl: string; token: string; objectPath: string }>(
    '/ops/ingest/presign',
    {
      method: 'POST',
      headers: { [IDEMPOTENCY_HEADER]: createIdempotencyKey(`ingest-presign-${kind}`) },
      body: JSON.stringify({ kind, filename }),
    }
  );
}

/** Step 2 — submit metadata after binary upload completes. */
export async function ingestSubmit(payload: {
  kind: IngestKind;
  objectPath: string;
  publicUrl: string;
  title: string;
  leagueId?: string | null;
  publishStatus?: 'draft' | 'published';
  idempotencyKey?: string;
  meta?: Record<string, unknown>;
}) {
  return apiFetch<{
    ok: boolean;
    jobId: string;
    state: string;
    mediaAssetId: string;
    publicationId: string;
    deduplicated?: boolean;
  }>('/ops/ingest/submit', {
    method: 'POST',
    headers: { [IDEMPOTENCY_HEADER]: payload.idempotencyKey ?? createIdempotencyKey(`ingest-submit-${payload.kind}`) },
    body: JSON.stringify(payload),
  });
}

/** Poll job status. */
export async function ingestStatus(jobId: string) {
  return apiFetch<{ ok: boolean; job: IngestJob }>(`/ops/ingest/${jobId}`);
}

/** Approve a projected/needs_review job → publishes to media_publications. */
export async function ingestApprove(jobId: string) {
  return apiFetch<{ ok: boolean; jobId: string; publicationId: string; publishedAt: string }>(
    `/ops/ingest/${jobId}/approve`,
    {
      method: 'POST',
      headers: { [IDEMPOTENCY_HEADER]: createIdempotencyKey(`ingest-approve-${jobId}`) },
      body: JSON.stringify({}),
    }
  );
}

/** Reject a job → archives publication, marks job failed. Replayable. */
export async function ingestReject(jobId: string, reason?: string) {
  return apiFetch<{ ok: boolean; jobId: string; state: string }>(
    `/ops/ingest/${jobId}/reject`,
    {
      method: 'POST',
      headers: { [IDEMPOTENCY_HEADER]: createIdempotencyKey(`ingest-reject-${jobId}`) },
      body: JSON.stringify({ reason }),
    }
  );
}

/** Replay a failed or needs_review job from scratch. */
export async function ingestReplay(jobId: string) {
  return apiFetch<{ ok: boolean; jobId: string; state: string }>(
    `/ops/ingest/${jobId}/replay`,
    {
      method: 'POST',
      headers: { [IDEMPOTENCY_HEADER]: createIdempotencyKey(`ingest-replay-${jobId}`) },
      body: JSON.stringify({}),
    }
  );
}

/** Delete a game and its live score data (super_admin / league_admin / scorekeeper) */
export async function deleteGame(gameId: string) {
  return apiFetch<{ ok: boolean; deletedGameId: string }>(`/api/ops/games/${encodeURIComponent(gameId)}`, {
    method: 'DELETE',
  });
}

