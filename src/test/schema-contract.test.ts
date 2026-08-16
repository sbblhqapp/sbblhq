// ── SCHEMA CONTRACT GATE (2026-07-20) ───────────────────────────────────────
// Lesson adopted from proven production pipelines (GameChanger runs a Schema
// Registry so producers can never emit shapes the pipeline doesn't know):
// every table/column the app's hot paths reference MUST exist in the schema
// defined by supabase/migrations. This is the gate that would have caught the
// RxDB `leagues._modified` bug (PostgREST 42703 → 400 retry flood in prod)
// before any deploy. Extend TABLE_COLUMN_CONTRACT whenever a new query path
// references a new column — CI fails loudly if the migration is missing.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(__dirname, '../../supabase/migrations');

function buildSchemaMap(): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  const NON_COLUMN = new Set(['primary', 'unique', 'constraint', 'foreign', 'check', 'like', 'exclude']);
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    // create table [if not exists] [public.]name ( ...cols... );
    const createRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?(\w+)"?\s*\(([\s\S]*?)\n\);/gi;
    for (const m of sql.matchAll(createRe)) {
      const table = m[1].toLowerCase();
      const cols = tables.get(table) ?? new Set<string>();
      for (const rawLine of m[2].split('\n')) {
        const line = rawLine.trim().replace(/^"/, '');
        const word = line.split(/[\s("]/)[0]?.toLowerCase();
        if (word && /^[a-z_][a-z0-9_]*$/.test(word) && !NON_COLUMN.has(word)) cols.add(word);
      }
      tables.set(table, cols);
    }
    // alter table [public.]name add column [if not exists] col ...
    const alterRe = /alter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?(?:public\.)?"?(\w+)"?[\s\S]*?add\s+column\s+(?:if\s+not\s+exists\s+)?"?(\w+)"?/gi;
    for (const m of sql.matchAll(alterRe)) {
      const table = m[1].toLowerCase();
      const cols = tables.get(table) ?? new Set<string>();
      cols.add(m[2].toLowerCase());
      tables.set(table, cols);
    }
  }
  return tables;
}

// Table → columns referenced by worker/client hot paths (ingest, POTG
// auto-provisioning, import history, audit trail, ingress capture).
const TABLE_COLUMN_CONTRACT: Record<string, string[]> = {
  profiles: ['user_id', 'display_name', 'full_name', 'created_by'],
  players: ['user_id', 'league_id', 'team_id', 'created_by', 'merged_into', 'merged_at', 'display_name'],
  teams: ['name', 'league_id', 'season_id'],
  leagues: ['code'],
  player_game_stats: ['game_id', 'player_id'],
  import_jobs: ['job_type', 'submitted_by', 'total_rows', 'inserted_rows', 'failed_rows', 'payload_summary', 'error_summary', 'status', 'created_at'],
  ingress_buffer: ['correlation_id', 'raw_input', 'error_reason', 'status', 'risk_score', 'source_type', 'user_id', 'created_at'],
  audit_logs: ['actor_id', 'action', 'ref_type', 'ref_id', 'payload', 'idempotency_key'],
  event_outbox: ['event_type', 'status', 'retries', 'created_at', 'available_at', 'dead_lettered_at'],
};

describe('schema contract — code column references exist in migrations', () => {
  const schema = buildSchemaMap();

  it('parses the migration set (sanity)', () => {
    expect(schema.size).toBeGreaterThan(10);
    expect(schema.has('profiles')).toBe(true);
  });

  for (const [table, columns] of Object.entries(TABLE_COLUMN_CONTRACT)) {
    it(`table "${table}" has all contracted columns`, () => {
      const actual = schema.get(table);
      expect(actual, `table "${table}" not found in migrations`).toBeDefined();
      const missing = columns.filter((c) => !actual!.has(c));
      expect(missing, `missing columns on "${table}": ${missing.join(', ')}`).toEqual([]);
    });
  }

  it('regression: nothing replicates client collections against Supabase (the _modified bug class)', () => {
    const rxdbSrc = readFileSync(join(__dirname, '../lib/rxdb.ts'), 'utf8');
    expect(rxdbSrc).not.toContain('replicateSupabase');
    // _modified/_deleted exist only in local Dexie schemas, never in queries.
    expect(schema.get('leagues')?.has('_modified') ?? false).toBe(false);
  });
});
