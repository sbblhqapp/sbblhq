import { z } from 'zod';
import { parseCsv } from '@/lib/parseCsv';
import { classifyRiskLane } from '@/lib/omniport';
import {
  json,
  requireOpsAdminSession,
  requireAdminSession,
  ensureMutation,
  writeImportJob,
  writeIngressFailure,
  resolvePotgPlayer,
  type HandlerCtx
} from '../index';
import { resolveLeagueId } from '../shared';
import type { SupabaseClient } from '@supabase/supabase-js';

// ── ZOD SCHEMAS ──────────────────────────────────────────────────────────────
const teamRowSchema = z.object({
  name: z.string().min(1, "Team name is required"),
  league_id: z.string().min(1, "League ID/Code is required"),
  season_id: z.string().uuid("Season ID is required"),
  division_id: z.string().optional().nullable(),
  wins: z.string().regex(/^\d+$/, "Wins must be a non-negative integer").optional().nullable(),
  losses: z.string().regex(/^\d+$/, "Losses must be a non-negative integer").optional().nullable(),
  pts_for: z.string().regex(/^\d+$/, "Points for must be a non-negative integer").optional().nullable(),
  pts_against: z.string().regex(/^\d+$/, "Points against must be a non-negative integer").optional().nullable(),
});

const playerRowSchema = z.object({
  user_id: z.string().uuid("User ID must be a valid UUID"),
  team_id: z.string().uuid("Team ID must be a valid UUID").optional().nullable(),
  league_id: z.string().min(1, "League ID/Code").optional().nullable(),
  jersey_number: z.string().regex(/^\d+$/, "Jersey number must be a non-negative integer").optional().nullable(),
  position: z.string().optional().nullable(),
});

const scheduleRowSchema = z.object({
  league_id: z.string().min(1, "League ID/Code is required"),
  season_id: z.string().uuid("Season ID must be a valid UUID"),
  starts_at: z.string().refine(val => !isNaN(Date.parse(val)), "Starts at must be a valid ISO date"),
  ends_at: z.string().refine(val => !isNaN(Date.parse(val)), "Ends at must be a valid ISO date").optional().nullable(),
  venue_id: z.string().uuid("Venue ID must be a valid UUID").optional().nullable(),
  court_id: z.string().uuid("Court ID must be a valid UUID").optional().nullable(),
  status: z.string().optional().nullable(),
});

const eventRowSchema = z.object({
  title: z.string().min(1, "Title is required"),
  league_id: z.string().min(1, "League ID/Code").optional().nullable(),
  season_id: z.string().uuid("Season ID must be a valid UUID").optional().nullable(),
  venue_id: z.string().uuid("Venue ID must be a valid UUID").optional().nullable(),
  starts_at: z.string().refine(val => !isNaN(Date.parse(val)), "Starts at must be a valid ISO date").optional().nullable(),
});

const scoreRowSchema = z.object({
  home_label: z.string().min(1, "Home label is required"),
  away_label: z.string().min(1, "Away label is required"),
  home_score: z.string().regex(/^\d+$/, "Home score must be a non-negative integer").optional().nullable(),
  away_score: z.string().regex(/^\d+$/, "Away score must be a non-negative integer").optional().nullable(),
  category: z.string().optional().nullable(),
  league_id: z.string().min(1, "League ID/Code is required").optional().nullable(),
  season_id: z.string().uuid("Season ID must be a valid UUID").optional().nullable(),
  status: z.string().optional().nullable(),
  game_date: z.string().optional().nullable(),
  event_name: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

// ── CONFIGURATION MAP ────────────────────────────────────────────────────────
interface IngestConfig {
  schema: z.ZodSchema;
  table: string;
  onConflict?: string;
  resolvePayload: (row: Record<string, string>, leagueMap: Map<string, string>) => Record<string, unknown>;
  resolveFallbackPayload?: (row: Record<string, string>, leagueMap: Map<string, string>) => Record<string, unknown>;
}

const INGEST_CONFIGS: Record<string, IngestConfig> = {
  teams: {
    schema: teamRowSchema,
    table: "teams",
    onConflict: "season_id,name",
    resolvePayload: (row, leagueMap) => ({
      league_id: leagueMap.get(row.league_id.toLowerCase()) || row.league_id,
      season_id: row.season_id || null,
      division_id: row.division_id || null,
      name: row.name,
      status: "published",
      record: row.wins != null ? {
        wins: Number(row.wins),
        losses: Number(row.losses ?? 0),
        ptsFor: Number(row.pts_for ?? 0),
        ptsAgainst: Number(row.pts_against ?? 0),
      } : undefined,
    }),
    resolveFallbackPayload: (row, leagueMap) => ({
      league_id: leagueMap.get(row.league_id.toLowerCase()) || row.league_id,
      season_id: row.season_id || null,
      division_id: row.division_id || null,
      name: row.name,
      status: "published",
      record: row.wins != null ? {
        wins: Number(row.wins),
        losses: Number(row.losses ?? 0),
        ptsFor: Number(row.pts_for ?? 0),
        ptsAgainst: Number(row.pts_against ?? 0),
      } : undefined,
    })
  },
  players: {
    schema: playerRowSchema,
    table: "players",
    onConflict: "user_id",
    resolvePayload: (row, leagueMap) => ({
      user_id: row.user_id,
      team_id: row.team_id || null,
      league_id: row.league_id ? (leagueMap.get(row.league_id.toLowerCase()) || row.league_id) : null,
      jersey_number: row.jersey_number ? Number(row.jersey_number) : null,
      position: row.position || null,
    })
  },
  schedules: {
    schema: scheduleRowSchema,
    table: "schedule_slots",
    resolvePayload: (row, leagueMap) => ({
      league_id: leagueMap.get(row.league_id.toLowerCase()) || row.league_id,
      season_id: row.season_id,
      venue_id: row.venue_id || null,
      court_id: row.court_id || null,
      starts_at: row.starts_at,
      ends_at: row.ends_at || null,
      status: row.status || "upcoming",
    })
  },
  events: {
    schema: eventRowSchema,
    table: "league_events",
    resolvePayload: (row, leagueMap) => ({
      league_id: row.league_id ? (leagueMap.get(row.league_id.toLowerCase()) || row.league_id) : null,
      season_id: row.season_id || null,
      venue_id: row.venue_id || null,
      title: row.title,
      starts_at: row.starts_at || null,
      metadata: row,
    })
  },
  scores: {
    schema: scoreRowSchema,
    table: "games",
    resolvePayload: (row, leagueMap) => {
      const leagueUuid = row.league_id ? leagueMap.get(row.league_id.toLowerCase()) || null : null;
      return {
        category: row.category || "league",
        league_id: leagueUuid,
        participant1_label: row.home_label || null,
        participant2_label: row.away_label || null,
        home_score: row.home_score !== "" && row.home_score != null ? Number(row.home_score) : null,
        away_score: row.away_score !== "" && row.away_score != null ? Number(row.away_score) : null,
        status: row.status || "final",
        game_date: row.game_date || null,
        event_name: row.event_name || null,
        notes: row.notes || null,
      };
    }
  }
};

// ── HELPERS ──────────────────────────────────────────────────────────────────
/**
 * Builds a lowercased-code -> league UUID map for the ops import pipeline.
 *
 * Previously did a hand-rolled `.in("code", uniqueCodes)` exact-match lookup.
 * League codes are stored uppercase in the DB (`WBL`); a typed lowercase code
 * ("wbl") never matched, so the map came back empty and the raw string fell
 * straight into a `uuid` column downstream -> Postgres `22P02`. This is the
 * exact CLAUDE.md rule-10 incident pattern. Fixed by routing every code
 * through the single canonical `resolveLeagueId` resolver (handles UUID
 * passthrough, case-insensitive code match, and name match) instead of a
 * second, drifted lookup.
 */
async function fetchLeagueMap(supabase: SupabaseClient, rows: Record<string, string>[]): Promise<Map<string, string>> {
  const leagueMap = new Map<string, string>();
  const uniqueCodes = Array.from(new Set(rows.map((r) => r.league_id).filter(Boolean) as string[]));
  await Promise.all(
    uniqueCodes.map(async (raw) => {
      const resolved = await resolveLeagueId(supabase, raw);
      if (resolved) leagueMap.set(raw.toLowerCase(), resolved);
    }),
  );
  return leagueMap;
}

// Uniform duplicate-key tolerance (2026-07-20 A+ pass): re-running the same
// import is idempotent for EVERY entity, not just teams. Duplicate rows are
// counted as `skipped` and surfaced in the response — never failed, never silent.
export function isDuplicateKeyError(err: unknown): boolean {
  const msg = err instanceof Error
    ? err.message
    : String((err as { message?: string; code?: string })?.message ?? "");
  const code = String((err as { code?: string })?.code ?? "");
  return msg.includes("duplicate key") || code === "23505";
}

// ── HANDLERS ─────────────────────────────────────────────────────────────────
export async function handleScoresCsvUpload(ctx: HandlerCtx) {
  await ensureMutation(ctx.req, ctx);
  const session = await requireOpsAdminSession(ctx.req, ctx.admin);

  const body = (await ctx.req.json().catch(() => null)) as {
    kind: "teams" | "players" | "schedules" | "events" | "scores";
    csvText?: string;
    rows?: Array<Record<string, string>>;
    format?: string;
  } | null;

  if (!body) return json({ ok: false, error: "body_required" }, 400);
  const { kind, csvText, format } = body;
  let rows = body.rows ?? [];

  if (!kind) return json({ ok: false, error: "kind_required" }, 400);

  if (csvText) {
    rows = parseCsv(csvText);
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return json({ ok: false, error: "rows_required" }, 400);
  }

  const isV1 = format === "v1" || rows.some(r => r.schema_version === "v1" || r.format === "v1");
  if (!isV1) {
    return json({ ok: false, error: "unsupported_schema_version" }, 400);
  }

  const riskLane = classifyRiskLane(`csv_upload.${kind}`, { rows });
  if (riskLane === "BLOCKED") {
    await writeIngressFailure(ctx.admin, `${kind}_upload_blocked_sql_injection`, rows, "upload", session.userId);
    return json({ ok: false, error: "blocked_class_payload" }, 403);
  }

  const config = INGEST_CONFIGS[kind];
  if (!config) return json({ ok: false, error: "invalid_kind" }, 400);

  const validationErrors: Array<{ row: number; field?: string; code: string; message: string }> = [];
  const validatedRows: Record<string, string>[] = [];

  rows.forEach((row, index) => {
    // v1 marker handling: skip ONLY pure marker rows (marker fields + no data).
    // Data rows that also carry a schema_version/format column are validated
    // with the marker fields stripped — never silently dropped (fix 2026-07-20).
    const { schema_version: _sv, format: _fmt, ...dataFields } = row;
    const hasMarker = Boolean(_sv || _fmt);
    const isMarkerOnly =
      hasMarker &&
      Object.values(dataFields).every((v) => v == null || String(v).trim() === "");
    if (isMarkerOnly) return;
    const parsed = config.schema.safeParse(hasMarker ? dataFields : row);
    if (!parsed.success) {
      parsed.error.errors.forEach(err => {
        validationErrors.push({
          row: index + 1,
          field: String(err.path[0] ?? ""),
          code: err.code,
          message: err.message,
        });
      });
    } else {
      validatedRows.push(parsed.data as Record<string, string>);
    }
  });

  if (validationErrors.length > 0) {
    return json({ ok: false, errors: validationErrors }, 422);
  }

  let inserted = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];

  const leagueMap = await fetchLeagueMap(ctx.admin, validatedRows);

  try {
    const payload = validatedRows.map(row => config.resolvePayload(row, leagueMap));
    const query = ctx.admin.from(config.table);
    
    let res;
    if (config.onConflict) {
      res = await query.upsert(payload, { onConflict: config.onConflict });
    } else {
      res = await query.insert(payload);
    }
    
    if (res.error) throw res.error;
    inserted = validatedRows.length;
  } catch (bulkErr) {
    // Fallback row-by-row
    for (const row of validatedRows) {
      try {
        const resolveFn = config.resolveFallbackPayload || config.resolvePayload;
        const payload = resolveFn(row, leagueMap);
        const query = ctx.admin.from(config.table);
        
        let res;
        if (config.onConflict) {
          res = await query.upsert(payload, { onConflict: config.onConflict });
        } else {
          res = await query.insert(payload);
        }

        if (res.error) {
          if (isDuplicateKeyError(res.error)) {
            skipped++;
            continue;
          }
          throw res.error;
        }
        inserted++;
      } catch (e) {
        failed++;
        errors.push(e instanceof Error ? e.message : "unknown");
      }
    }
  }

  // Domain-event parity with /ops/imports/* (2026-07-20 A+ pass): the CSV path
  // now emits the same `${kind}_imported` events so downstream projections and
  // OmniHub sync see bulk uploads too. Fire-and-forget; failures logged only.
  if (inserted > 0) {
    await Promise.allSettled(
      validatedRows.map((row) =>
        ctx.admin.rpc("enqueue_local_domain_event", {
          p_event_type: `${kind}_imported`,
          p_entity_type: kind,
          p_entity_id: null,
          p_league_id: row.league_id || null,
          p_payload: row,
          p_trace_id: crypto.randomUUID(),
          p_available_at: new Date().toISOString(),
        }).then(({ error }) => {
          if (error) console.warn(`[csv-upload] enqueue_local_domain_event warning (${kind}):`, error.message);
        }),
      ),
    );
  }

  const idempotencyKey = ctx.req.headers.get("x-idempotency-key") ?? crypto.randomUUID();
  await writeImportJob(ctx.admin, {
    job_type: kind,
    submitted_by: session.userId,
    total_rows: rows.length,
    inserted_rows: inserted,
    failed_rows: failed,
    payload_summary: { sample: rows[0] ?? null, skipped_rows: skipped, row_errors: errors.slice(0, 20) },
    error_summary: errors.slice(0, 5).join("; ") || null,
  });

  await ctx.admin.from("audit_logs").insert({
    actor_id: session.userId,
    action: `csv_upload_${kind}`,
    ref_type: kind,
    ref_id: crypto.randomUUID(),
    payload: { count: rows.length, inserted, skipped, failed },
    idempotency_key: idempotencyKey,
  });

  return json({ ok: true, inserted, skipped, failed, errors });
}

export async function handleImportRoute(
  ctx: HandlerCtx,
  kind: "teams" | "players" | "schedules" | "events",
) {
  await ensureMutation(ctx.req, ctx);
  const session = await requireOpsAdminSession(ctx.req, ctx.admin);

  const body = (await ctx.req.json().catch(() => null)) as {
    rows?: Array<Record<string, string>>;
  } | null;
  const rawRows = body?.rows ?? [];
  if (!Array.isArray(rawRows) || rawRows.length === 0) {
    return json({ ok: false, error: "rows_required" }, 400);
  }

  const rows = rawRows.map((r): Record<string, string> => ({
    ...r,
    league_id: r.league_id ?? r.leagueId,
    season_id: r.season_id ?? r.seasonId,
    division_id: r.division_id ?? r.divisionId ?? r.division,
    user_id: r.user_id ?? r.userId,
    team_id: r.team_id ?? r.teamId,
    jersey_number: r.jersey_number ?? r.jerseyNumber,
    starts_at: r.starts_at ?? r.startsAt,
    ends_at: r.ends_at ?? r.endsAt,
    venue_id: r.venue_id ?? r.venueId,
    court_id: r.court_id ?? r.courtId,
  }));

  const config = INGEST_CONFIGS[kind];
  if (!config) return json({ ok: false, error: "invalid_kind" }, 400);

  const riskLane = classifyRiskLane(`import_route.${kind}`, { rows });
  if (riskLane === "BLOCKED") {
    await writeIngressFailure(ctx.admin, `${kind}_import_blocked_sql_injection`, rows, "admin_mutation", session.userId);
    return json({ ok: false, error: "blocked_class_payload" }, 403);
  }

  const validationErrors: Array<{ row: number; field?: string; code: string; message: string }> = [];
  const validatedRows: Record<string, string>[] = [];
  rows.forEach((row, index) => {
    const parsed = config.schema.safeParse(row);
    if (!parsed.success) {
      parsed.error.errors.forEach(err => {
        validationErrors.push({
          row: index + 1,
          field: String(err.path[0] ?? ""),
          code: err.code,
          message: err.message,
        });
      });
    } else {
      validatedRows.push(parsed.data as Record<string, string>);
    }
  });
  if (validationErrors.length > 0) {
    return json({ ok: false, errors: validationErrors }, 422);
  }

  let insertedRows = 0;
  let skippedRows = 0;
  let failedRows = 0;
  const errors: string[] = [];
  let bulkSuccess = false;

  const leagueMap = await fetchLeagueMap(ctx.admin, validatedRows);

  try {
    const payload = validatedRows.map(row => config.resolvePayload(row, leagueMap));
    const query = ctx.admin.from(config.table);

    let res;
    if (config.onConflict) {
      res = await query.upsert(payload, { onConflict: config.onConflict });
    } else {
      res = await query.insert(payload);
    }
    if (res.error) throw res.error;
    bulkSuccess = true;
  } catch (bulkError) {
    // Fallback
  }

  if (bulkSuccess) {
    insertedRows = validatedRows.length;
    await Promise.allSettled(
      validatedRows.map((row) =>
        ctx.admin.rpc("enqueue_local_domain_event", {
          p_event_type: `${kind}_imported`,
          p_entity_type: kind,
          p_entity_id: null,
          p_league_id: row.league_id || null,
          p_payload: row,
          p_trace_id: crypto.randomUUID(),
          p_available_at: new Date().toISOString(),
        }).then(({ error }) => {
          if (error) {
            console.warn(`[import] enqueue_local_domain_event warning (${kind}):`, error.message);
          }
        }),
      ),
    );
  } else {
    const BATCH_SIZE = 50;
    for (let i = 0; i < validatedRows.length; i += BATCH_SIZE) {
      const batch = validatedRows.slice(i, i + BATCH_SIZE);
      try {
        const payload = batch.map(row => config.resolvePayload(row, leagueMap));
        const query = ctx.admin.from(config.table);
        
        let res;
        if (config.onConflict) {
          res = await query.upsert(payload, { onConflict: config.onConflict });
        } else {
          res = await query.insert(payload);
        }
        if (res.error) throw res.error;

        await Promise.all(
          batch.map((row) =>
            ctx.admin.rpc("enqueue_local_domain_event", {
              p_event_type: `${kind}_imported`,
              p_entity_type: kind,
              p_entity_id: null,
              p_league_id: row.league_id || null,
              p_payload: row,
              p_trace_id: crypto.randomUUID(),
              p_available_at: new Date().toISOString(),
            }),
          ),
        );
        insertedRows += batch.length;
      } catch (batchError) {
        for (const row of batch) {
          try {
            const resolveFn = config.resolveFallbackPayload || config.resolvePayload;
            const payload = resolveFn(row, leagueMap);
            const query = ctx.admin.from(config.table);

            let res;
            if (config.onConflict) {
              res = await query.upsert(payload, { onConflict: config.onConflict });
            } else {
              res = await query.insert(payload);
            }

            if (res.error) {
              if (isDuplicateKeyError(res.error)) {
                skippedRows += 1;
                continue;
              }
              throw res.error;
            }

            await ctx.admin.rpc("enqueue_local_domain_event", {
              p_event_type: `${kind}_imported`,
              p_entity_type: kind,
              p_entity_id: null,
              p_league_id: row.league_id || null,
              p_payload: row,
              p_trace_id: crypto.randomUUID(),
              p_available_at: new Date().toISOString(),
            });
            insertedRows += 1;
          } catch (error) {
            failedRows += 1;
            errors.push(error instanceof Error ? error.message : "import_failed");
            await writeIngressFailure(
              ctx.admin,
              `${kind}_import_failed`,
              row,
              "admin_mutation",
              session.userId,
            );
          }
        }
      }
    }
  }

  const job = await writeImportJob(ctx.admin, {
    job_type: kind,
    submitted_by: session.userId,
    total_rows: validatedRows.length,
    inserted_rows: insertedRows,
    failed_rows: failedRows,
    payload_summary: { sample: validatedRows[0] ?? null, skipped_rows: skippedRows, row_errors: errors.slice(0, 20) },
    error_summary: errors.slice(0, 5).join("; ") || null,
  });

  const idempotencyKey = ctx.req.headers.get("x-idempotency-key") ?? crypto.randomUUID();
  await ctx.admin.from("audit_logs").insert({
    actor_id: session.userId,
    action: `import_${kind}`,
    ref_type: "import_jobs",
    ref_id: job.id,
    payload: { total_rows: validatedRows.length, inserted_rows: insertedRows, failed_rows: failedRows },
    idempotency_key: idempotencyKey,
  });

  return json({ ok: true, summary: job });
}

// RETAINED COMPAT ROUTE (2026-07-20 audit): /ops/scores/import stays live for
// API compatibility (tests + potential external callers), but shares
// INGEST_CONFIGS.scores schema + classifyRiskLane with /api/ops/upload/csv,
// guaranteeing behavioral validation parity. New UI work must use
// /api/ops/upload/csv (kind="scores") via useOpsCsvUpload (offline queue).
export async function handleScoresCsvImport(ctx: HandlerCtx) {
  await ensureMutation(ctx.req, ctx);
  const session = await requireOpsAdminSession(ctx.req, ctx.admin);

  const body = (await ctx.req.json().catch(() => null)) as { rows?: Array<Record<string, string>> } | null;
  const rows = body?.rows ?? [];
  if (!Array.isArray(rows) || rows.length === 0) {
    return json({ ok: false, error: "rows_required" }, 400);
  }

  const riskLane = classifyRiskLane("import_route.scores", { rows });
  if (riskLane === "BLOCKED") {
    await writeIngressFailure(ctx.admin, "scores_import_blocked_sql_injection", rows, "admin_mutation", session.userId);
    return json({ ok: false, error: "blocked_class_payload" }, 403);
  }

  const config = INGEST_CONFIGS.scores;
  const validationErrors: Array<{ row: number; field?: string; code: string; message: string }> = [];
  const validatedRows: Record<string, string>[] = [];
  rows.forEach((row, index) => {
    const parsed = config.schema.safeParse(row);
    if (!parsed.success) {
      parsed.error.errors.forEach(err => {
        validationErrors.push({
          row: index + 1,
          field: String(err.path[0] ?? ""),
          code: err.code,
          message: err.message,
        });
      });
    } else {
      validatedRows.push(parsed.data as Record<string, string>);
    }
  });
  if (validationErrors.length > 0) {
    return json({ ok: false, errors: validationErrors }, 422);
  }

  let inserted = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];

  const leagueMap = await fetchLeagueMap(ctx.admin, validatedRows);

  let bulkSuccess = false;
  try {
    const payload = validatedRows.map(row => config.resolvePayload(row, leagueMap));
    const { error } = await ctx.admin.from(config.table).insert(payload);
    if (error) throw error;
    bulkSuccess = true;
    inserted = validatedRows.length;
  } catch (bulkErr) {
    // Fallback
  }

  if (!bulkSuccess) {
    for (const row of validatedRows) {
      try {
        const payload = config.resolvePayload(row, leagueMap);
        const { error } = await ctx.admin.from(config.table).insert(payload);
        if (error) {
          if (isDuplicateKeyError(error)) {
            skipped++;
          } else {
            failed++;
            errors.push(`${row.home_label || "Unknown"} vs ${row.away_label || "Unknown"}: ${error.message}`);
          }
        } else {
          inserted++;
        }
      } catch (e) {
        failed++;
        errors.push(e instanceof Error ? e.message : "unknown");
      }
    }
  }

  return json({ ok: true, inserted, skipped, failed, errors });
}

// ── ROSTER IMAGE INGEST ──────────────────────────────────────────────────────
// Closes the root-cause gap: no image → roster path existed before this (only
// scoreboard/event/single-POTG-player parsers wrote anywhere). This handler is
// the only path in the codebase that can bulk-create a team AND attach N
// players to it from one operator action. Team resolution mirrors the
// find-by-league+name-else-create pattern already proven in resolvePotgPlayer's
// team lookup; player provisioning reuses resolvePotgPlayer itself (same
// profile/player find-or-create the POTG pipeline relies on) so there is one
// canonical player-provisioning path, not two.
const rosterPlayerRowSchema = z.object({
  name: z.string().min(1, "Player name is required"),
  jerseyNumber: z.union([z.number(), z.string(), z.null()]).optional(),
  position: z.string().optional().nullable(),
});

const rosterImportSchema = z.object({
  leagueId: z.string().trim().min(1, "League ID/code is required"),
  seasonId: z.string().uuid("Season ID must be a valid UUID"),
  teamName: z.string().trim().min(1, "Team name is required"),
  players: z.array(rosterPlayerRowSchema).min(1, "At least one player is required"),
});

// Jersey numbers come from OCR review or free-text input — validate to a
// non-negative integer and return a warning instead of silently storing
// garbage (e.g. "23G" misread, or a stray negative/fractional value).
function parseJerseyNumber(raw: unknown): { value: number | null; invalid: boolean } {
  if (raw == null || raw === "") return { value: null, invalid: false };
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return { value: null, invalid: true };
  return { value: n, invalid: false };
}

// Shared by the initial team lookup and the post-duplicate-key race recovery
// below — deliberately NOT a Postgres upsert. teams' unique index on
// (season_id, name) is case-sensitive text equality; an upsert's ON CONFLICT
// would miss a same-team-different-casing OCR read (e.g. "BALL IS LIFE" vs
// "Ball is Life") and create a second team row instead of reusing the first.
// The ilike lookup here is what makes that dedup case-insensitive.
async function findRosterTeamId(
  admin: SupabaseClient,
  leagueUuid: string,
  seasonId: string,
  teamName: string,
): Promise<{ id: string | null; error: string | null }> {
  const { data, error } = await admin
    .from("teams")
    .select("id")
    .eq("league_id", leagueUuid)
    .eq("season_id", seasonId)
    .ilike("name", teamName)
    .maybeSingle();
  if (error) return { id: null, error: error.message };
  return { id: data?.id ? String(data.id) : null, error: null };
}

export async function handleRosterImport(ctx: HandlerCtx) {
  await ensureMutation(ctx.req, ctx);
  const session = await requireOpsAdminSession(ctx.req, ctx.admin);

  const body = await ctx.req.json().catch(() => null);
  const parsed = rosterImportSchema.safeParse(body);
  if (!parsed.success) {
    return json({
      ok: false,
      errors: parsed.error.errors.map((err) => ({
        field: String(err.path[0] ?? ""),
        code: err.code,
        message: err.message,
      })),
    }, 422);
  }
  const { leagueId, seasonId, teamName, players } = parsed.data;

  const riskLane = classifyRiskLane("roster_import", { teamName, players });
  if (riskLane === "BLOCKED") {
    await writeIngressFailure(ctx.admin, "roster_import_blocked_sql_injection", parsed.data, "admin_mutation", session.userId);
    return json({ ok: false, error: "blocked_class_payload" }, 403);
  }

  // Rule 10 (CLAUDE.md): resolve the app-level league slug/uuid through the
  // shared resolver — never pass a raw client value into a uuid league_id column.
  const leagueUuid = await resolveLeagueId(ctx.admin, leagueId);
  if (!leagueUuid) {
    return json({ ok: false, error: "invalid_league_code" }, 400);
  }

  // Scoped by season_id (not just league_id): teams.unique(season_id, name)
  // means the same team name legitimately recurs across seasons as distinct
  // rows. A league-only lookup would silently attach this season's roster to
  // a prior season's team of the same name — league-only matching is correct
  // for resolvePotgPlayer (a single-player spotlight card that never creates
  // a team), but this handler creates/targets a specific team, so it must
  // match the DB's actual uniqueness scope.
  let teamId: string;
  let teamInserted = false;
  const initialLookup = await findRosterTeamId(ctx.admin, leagueUuid, seasonId, teamName);
  if (initialLookup.error) return json({ ok: false, error: initialLookup.error }, 500);

  if (initialLookup.id) {
    teamId = initialLookup.id;
  } else {
    const { data: newTeam, error: teamInsertError } = await ctx.admin
      .from("teams")
      .insert({
        league_id: leagueUuid,
        season_id: seasonId,
        name: teamName,
        status: "published",
      })
      .select("id")
      .single();
    if (teamInsertError) {
      if (isDuplicateKeyError(teamInsertError)) {
        // Re-running an identical import — the unique(season_id, name) constraint
        // means the row now exists; fetch it instead of failing.
        const raceLookup = await findRosterTeamId(ctx.admin, leagueUuid, seasonId, teamName);
        if (!raceLookup.id) return json({ ok: false, error: "team_resolution_failed" }, 500);
        teamId = raceLookup.id;
      } else {
        return json({ ok: false, error: teamInsertError.message }, 500);
      }
    } else {
      teamId = String(newTeam.id);
      teamInserted = true;
    }
  }

  let inserted = 0;
  let skipped = 0;
  let failed = 0;
  const warnings: string[] = [];
  const errors: string[] = [];

  // Deliberately sequential, not Promise.all — resolvePotgPlayer is a
  // read-then-write on profiles keyed by display_name with no unique
  // constraint backing it. Two players sharing a name (twins, Jr./Sr.)
  // processed concurrently would both miss each other's uncommitted insert
  // and create duplicate profiles; sequential processing guarantees the
  // second one finds the first's already-committed row instead.
  //
  // The per-player update() below is also deliberately not batched into one
  // upsert — every other bulk-import path in this file (handleImportRoute)
  // isolates failures per row for the same reason: one bad row must not sink
  // the rest of an otherwise-good roster.
  for (const player of players) {
    const resolution = await resolvePotgPlayer(ctx.admin, player.name, leagueUuid, {
      teamName,
      actorId: session.userId,
    });
    if (resolution.ok === false) {
      failed++;
      errors.push(`${player.name}: ${resolution.error}`);
      continue;
    }
    warnings.push(...resolution.warnings.map((w) => `${player.name}: ${w}`));

    const { value: jerseyNumber, invalid: jerseyInvalid } = parseJerseyNumber(player.jerseyNumber);
    if (jerseyInvalid) {
      warnings.push(`${player.name}: invalid_jersey_number_ignored (${JSON.stringify(player.jerseyNumber)})`);
    }
    const { error: updateError } = await ctx.admin
      .from("players")
      .update({
        team_id: teamId,
        jersey_number: jerseyNumber,
        position: player.position || null,
      })
      .eq("id", resolution.playerId)
      .select()
      .maybeSingle();
    if (updateError) {
      failed++;
      errors.push(`${player.name}: ${updateError.message}`);
      continue;
    }

    if (resolution.provisioned) inserted++;
    else skipped++;
  }

  await ctx.admin.rpc("enqueue_local_domain_event", {
    p_event_type: "roster_imported",
    p_entity_type: "teams",
    p_entity_id: teamId,
    p_league_id: leagueUuid,
    p_payload: { teamName, playerCount: players.length },
    p_trace_id: crypto.randomUUID(),
    p_available_at: new Date().toISOString(),
  }).then(({ error }: { error: { message: string } | null }) => {
    if (error) console.warn("[roster-import] enqueue_local_domain_event warning:", error.message);
  });

  await writeImportJob(ctx.admin, {
    job_type: "roster",
    submitted_by: session.userId,
    total_rows: players.length,
    inserted_rows: inserted,
    failed_rows: failed,
    payload_summary: { teamName, teamInserted, skipped, warnings: warnings.slice(0, 20) },
    error_summary: errors.slice(0, 5).join("; ") || null,
  });

  const idempotencyKey = ctx.req.headers.get("x-idempotency-key") ?? crypto.randomUUID();
  await ctx.admin.from("audit_logs").insert({
    actor_id: session.userId,
    action: "roster_import",
    ref_type: "teams",
    ref_id: teamId,
    payload: { teamName, playerCount: players.length, inserted, skipped, failed },
    idempotency_key: idempotencyKey,
  });

  return json({ ok: true, teamId, inserted, skipped, failed, warnings, errors });
}
