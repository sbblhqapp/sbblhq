/**
 * SCHEMA CONTRACT GUARD — blocks the 42703 / PGRST200 class of incident.
 *
 * WHY THIS EXISTS
 * ───────────────
 * Every validation gate in this repo (typecheck, lint, 1500+ unit tests, build)
 * passed green on 2026-08-18 while SIX production surfaces were dead, all from
 * the same root cause: worker queries naming columns and relationships that do
 * not exist on the live database.
 *
 *   * public Schedules page   — blank for all 3 leagues while 19 games existed
 *   * AppHome game rails      — 0 live / 0 upcoming / 0 recent for all leagues
 *   * playback preflight      — 404 "game_not_found" for games that exist
 *   * replay status           — same false 404
 *   * store checkout + billing— order INSERT impossible (orders had 0 rows)
 *   * Ops PPV revenue         — throws ops_revenue_failed
 *
 * Unit tests could not catch any of it: they mock the Supabase client, so a
 * fixture keyed on a phantom column (`orders.total_amount`) asserts happily
 * against a shape production can never return. Mocks verify our logic; only the
 * real schema verifies our column names.
 *
 * WHAT THIS DOES
 * ──────────────
 * Statically parses every `.from("<table>").select("<cols>")` chain under src/
 * and asserts each referenced column and embedded relationship exists in the
 * committed snapshot of the live schema. No network, no DB — runs in CI.
 *
 * REGENERATING THE SNAPSHOT (after any migration reaches production):
 *
 *   curl -sS -X POST \
 *     "https://api.supabase.com/v1/projects/$PROJECT_REF/database/query" \
 *     -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
 *     -H "Content-Type: application/json" \
 *     -d '{"query":"select c.relname as table_name, a.attname as column_name, c.relkind from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid where n.nspname='"'"'public'"'"' and c.relkind in ('"'"'r'"'"','"'"'v'"'"','"'"'m'"'"','"'"'p'"'"','"'"'f'"'"') and a.attnum>0 and not a.attisdropped order by 1,2;"}'
 *
 * then fold the rows into src/test/fixtures/production-schema.json.
 *
 * Use pg_class/pg_attribute, NOT information_schema.columns — the latter omits
 * materialized views, which yields a false "table does not exist" on
 * mvw_standings.
 *
 * IF THIS TEST FAILS: your query names a column the database does not have.
 * Fix the query, or ship the migration that adds the column AND refresh the
 * snapshot. Do not add to PENDING_MIGRATION_COLUMNS to silence it unless the
 * migration for that column is genuinely in this same change set.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import snapshot from './fixtures/production-schema.json';

const ROOT = resolve(__dirname, '../..');
const SRC = join(ROOT, 'src');

/**
 * Columns added by a migration in this change set that has not yet been applied
 * to production, so it is absent from the snapshot. Each entry MUST name the
 * migration that creates it. Remove the entry once the snapshot is refreshed.
 */
const PENDING_MIGRATION_COLUMNS: Record<string, string[]> = {
  // supabase/migrations/20260818150000_orders_add_metadata.sql
  orders: ['metadata'],
};

type Objects = Record<string, { kind: string; columns: string[] }>;
const OBJECTS = (snapshot as { objects: Objects }).objects;

/** table -> { fk column -> referenced table }, from pg_constraint contype='f'. */
const FKS = (snapshot as { foreignKeys: Record<string, Record<string, string>> }).foreignKeys;

const columnsOf = (table: string): Set<string> | null => {
  const entry = OBJECTS[table];
  if (!entry) return null;
  return new Set([...entry.columns, ...(PENDING_MIGRATION_COLUMNS[table] ?? [])]);
};

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, acc);
    else if (/\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name)) acc.push(p);
  }
  return acc;
}

type Parsed = { direct: string[]; embeds: Array<{ target: string; cols: Parsed }> };

/** Split a PostgREST select string into direct columns and embedded resources. */
function parseSelect(sel: string): Parsed {
  const direct: string[] = [];
  const embeds: Parsed['embeds'] = [];
  let depth = 0;
  let cur = '';
  const parts: string[] = [];
  for (const ch of sel) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  parts.push(cur);

  for (const raw of parts) {
    const p = raw.trim().replace(/\s+/g, ' ');
    if (!p) continue;
    const embed = p.match(/^([\w:!.]+)\s*\(([\s\S]*)\)$/);
    if (embed) {
      let target = embed[1];
      if (target.includes(':')) target = target.split(':')[1];
      if (target.includes('!')) target = target.split('!')[0];
      embeds.push({ target, cols: parseSelect(embed[2]) });
    } else {
      const col = p.split(':').pop()!.trim();
      if (col && col !== '*' && !col.includes('(')) direct.push(col.toLowerCase());
    }
  }
  return { direct, embeds };
}

type Finding = { file: string; line: number; detail: string };

function check(
  file: string,
  line: number,
  table: string,
  parsed: Parsed,
  findings: Finding[],
): void {
  const cols = columnsOf(table);
  if (!cols) {
    findings.push({ file, line, detail: `table/view "${table}" does not exist` });
    return;
  }
  for (const c of parsed.direct) {
    // Strip JSON path operators and casts: metadata->>'k', total::numeric
    const bare = c.replace(/->>?.*$/, '').replace(/::.*$/, '').trim();
    if (!bare || bare === '*' || bare === 'count') continue;
    if (!cols.has(bare)) {
      findings.push({ file, line, detail: `${table}.${bare} does not exist` });
    }
  }
  for (const e of parsed.embeds) {
    // PostgREST accepts an FK COLUMN name as the embed target
    // (e.g. `home_team:home_team_id(...)` on games). Check this FIRST: an
    // embed target that merely happens to share a name with a plain column is
    // NOT embeddable — `profiles:user_id(...)` on players fails with PGRST200
    // because players.user_id carries no foreign key, even though the column
    // itself exists. That distinction is the whole point of this branch.
    const viaFk = FKS[table]?.[e.target];
    if (viaFk) {
      check(file, line, viaFk, e.cols, findings);
      continue;
    }
    // Otherwise the target must name a real table/view related to this one.
    if (columnsOf(e.target)) {
      const related =
        Boolean(FKS[table] && Object.values(FKS[table]).includes(e.target)) ||
        Boolean(FKS[e.target] && Object.values(FKS[e.target]).includes(table)) ||
        // Many-to-many through a junction table that points at both sides.
        Object.values(FKS).some(
          (cols2) =>
            Object.values(cols2).includes(table) && Object.values(cols2).includes(e.target),
        );
      if (!related) {
        findings.push({
          file,
          line,
          detail: `embed "${e.target}" on "${table}" has no foreign-key relationship (PostgREST PGRST200)`,
        });
        continue;
      }
      check(file, line, e.target, e.cols, findings);
      continue;
    }
    findings.push({
      file,
      line,
      detail: `embed "${e.target}" on "${table}" is neither a related table nor an FK column`,
    });
  }
}

function collectFindings(files: string[]): Finding[] {
  const findings: Finding[] = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const fromRe = /\.from\(\s*["'`]([\w.]+)["'`]\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = fromRe.exec(text))) {
      const table = m[1].replace(/^public\./, '');
      // Bound the method chain so a later, unrelated .select() is not attributed
      // to this .from(): stop at the first depth-0 `;` or the next `.from(`.
      const tail = text.slice(m.index + m[0].length);
      let depth = 0;
      let end = tail.length;
      for (let i = 0; i < tail.length; i++) {
        const ch = tail[i];
        if (ch === '(' || ch === '[' || ch === '{') depth++;
        else if (ch === ')' || ch === ']' || ch === '}') {
          depth--;
          if (depth < 0) {
            end = i;
            break;
          }
        } else if (ch === ';' && depth === 0) {
          end = i;
          break;
        } else if (depth === 0 && tail.startsWith('.from(', i)) {
          end = i;
          break;
        }
      }
      const chain = tail.slice(0, end);
      // GAP tolerates comments between tokens. Without it, a `//` comment
      // written inside a `.select(` call makes the scanner skip that query
      // ENTIRELY — a silent blind spot, and exactly the failure mode this
      // guard exists to prevent. Verified by mutation test.
      const GAP = '(?:\\s|//[^\\n]*\\n|/\\*[\\s\\S]*?\\*/)*';
      const QUOTED = '(`[\\s\\S]*?`|"[^"]*"|\'[^\']*\')';
      const selM = chain.match(
        new RegExp('^' + GAP + '(?:\\.\\w+\\([^()]*\\)' + GAP + ')*?\\.select\\(' + GAP + QUOTED),
      );
      if (!selM) continue;
      const sel = selM[1].slice(1, -1);
      if (sel.includes('${')) continue; // runtime-composed select
      const line = text.slice(0, m.index).split('\n').length;
      check(relative(ROOT, file), line, table, parseSelect(sel), findings);
    }
  }
  return findings;
}

describe('schema contract: every selected column exists in production', () => {
  const files = sourceFiles(SRC);
  const findings = collectFindings(files);

  it('scans a meaningful number of query sites (guard against a silent no-op)', () => {
    const sites = files.reduce(
      (n, f) => n + (readFileSync(f, 'utf8').match(/\.from\(\s*["'`]/g)?.length ?? 0),
      0,
    );
    expect(sites).toBeGreaterThan(200);
  });

  it('references no non-existent column, table, or relationship', () => {
    const report = findings.map((f) => `  ${f.file}:${f.line}  ${f.detail}`).join('\n');
    expect(findings, `\nSchema contract violations:\n${report}\n`).toEqual([]);
  });

  it('knows the columns that caused the 2026-08-18 outage are genuinely absent', () => {
    // Pins the incident itself: if someone "fixes" a future failure by editing
    // the snapshot instead of the query, these assertions fail.
    expect(columnsOf('games')!.has('scheduled_at')).toBe(false);
    expect(columnsOf('games')!.has('venue_id')).toBe(false);
    expect(columnsOf('games')!.has('starts_at')).toBe(false);
    expect(columnsOf('games')!.has('ended_at')).toBe(false);
    expect(columnsOf('orders')!.has('total_amount')).toBe(false);
    // ...and the real columns those queries must use instead.
    expect(columnsOf('games')!.has('game_date')).toBe(true);
    expect(columnsOf('games')!.has('schedule_slot_id')).toBe(true);
    expect(columnsOf('orders')!.has('total')).toBe(true);
    expect(columnsOf('teams')!.has('logo_url')).toBe(true);
  });

  it('includes materialized views (information_schema.columns omits them)', () => {
    expect(OBJECTS['mvw_standings']).toBeDefined();
    expect(OBJECTS['mvw_standings'].kind).toBe('matview');
  });
});
