import type { SupabaseClient } from '@supabase/supabase-js';

export type Row = Record<string, unknown>;
export type TestState = Record<string, Row[]>;

type RpcOverride = (payload: Row) => Promise<{ data: unknown; error: { message: string } | null }> | { data: unknown; error: { message: string } | null };
type QueryResponse<T> = { data: T; error: { message: string } | null };
type CountResponse = { count: number | null; error: { message: string } | null };
type MaybeSingleBuilder = {
  maybeSingle: () => Promise<QueryResponse<Row | null>>;
  single: () => Promise<QueryResponse<Row | null>>;
};
type UpdateBuilder = {
  eq: (col: string, value: unknown) => UpdateBuilder;
  is: (col: string, value: unknown) => UpdateBuilder;
  neq: (col: string, value: unknown) => { error: null };
  select: () => MaybeSingleBuilder;
};
type QueryApi = {
  eq: (col: string, value: unknown) => QueryApi;
  is: (col: string, value: unknown) => QueryApi;
  neq: (col: string, value: unknown) => QueryApi;
  gt: (col: string, value: unknown) => QueryApi;
  gte: (col: string, value: unknown) => QueryApi;
  lt: (col: string, value: unknown) => QueryApi;
  in: (col: string, values: unknown[]) => QueryApi;
  ilike: (col: string, pattern: string) => QueryApi;
  order: () => QueryApi;
  limit: () => QueryApi;
  /** Second arg mirrors supabase-js `{ count: 'exact', head: true }` for count-only queries. */
  select: (columns?: string, opts?: { count?: string; head?: boolean }) => QueryApi;
  maybeSingle: () => Promise<QueryResponse<Row | null>>;
  single: () => Promise<QueryResponse<Row | null>>;
  then: (
    resolve: (value: QueryResponse<Row[]> | CountResponse) => unknown,
  ) => Promise<unknown>;
  insert: (row: Row | Row[]) => { select?: () => { single: () => Promise<QueryResponse<Row>> }; error: null };
  update: (patch: Row) => UpdateBuilder;
  upsert: (row: Row | Row[], opts?: { onConflict?: string }) => { select: () => { single: () => Promise<QueryResponse<Row | null>> } } | { error: null };
};

export const testEnv = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-with-enough-length-for-tests',
  VITE_STREAM_URL: 'https://cdn.example.com/live/default.m3u8',
  OMNIHUB_SIGNING_SECRET: 'test-signing-secret',
} as unknown as Env;

function rowMatches(row: Row, filters: Array<(row: Row) => boolean>) {
  return filters.every((fn) => fn(row));
}

export function createAdmin(
  state: TestState,
  options: { upsertErrorTable?: string; rpc?: Record<string, RpcOverride> } = {},
): SupabaseClient {
  function query(table: string): QueryApi {
    const filters: Array<(row: Row) => boolean> = [];
    let countMode = false;
    const api: QueryApi = {
      eq(col, value) { filters.push((row) => row[col] === value); return api; },
      is(col, value) { filters.push((row) => (value === null ? row[col] == null : row[col] === value)); return api; },
      neq(col, value) { filters.push((row) => row[col] !== value); return api; },
      gt(col, value) { filters.push((row) => String(row[col]) > String(value)); return api; },
      gte(col, value) { filters.push((row) => String(row[col]) >= String(value)); return api; },
      lt(col, value) { filters.push((row) => String(row[col]) < String(value)); return api; },
      in(col, values) { filters.push((row) => values.includes(row[col])); return api; },
      ilike(col, pattern) {
        const rx = new RegExp('^' + String(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$', 'i');
        filters.push((row) => rx.test(String(row[col] ?? '')));
        return api;
      },
      order() { return api; },
      limit() { return api; },
      select(_columns, opts) { if (opts?.count) countMode = true; return api; },
      maybeSingle: async () => ({ data: (state[table] ?? []).find((row) => rowMatches(row, filters)) ?? null, error: null }),
      single: async () => {
        const row = (state[table] ?? []).find((item) => rowMatches(item, filters));
        return row ? { data: row, error: null } : { data: null, error: { message: 'not_found' } };
      },
      then: async (resolve) => {
        const matched = (state[table] ?? []).filter((row) => rowMatches(row, filters));
        return countMode
          ? resolve({ count: matched.length, error: null })
          : resolve({ data: matched, error: null });
      },
      insert(row) {
        if (table === 'api_idempotency_keys') return { error: null };
        const normalizeOne = (r: Row) => ({
          ...r,
          id: r.id ?? crypto.randomUUID(),
          code: r.code ?? crypto.randomUUID(),
          created_at: r.created_at ?? new Date().toISOString(),
        });
        // Bulk insert (array payload, e.g. handleImportRoute) — no .select()
        // chained by real callers of this path, so just persist and resolve.
        if (Array.isArray(row)) {
          const normalized = row.map(normalizeOne);
          state[table] = [...(state[table] ?? []), ...normalized];
          return { error: null } as unknown as ReturnType<QueryApi['insert']>;
        }
        const normalized = normalizeOne(row);
        state[table] = [...(state[table] ?? []), normalized];
        return { select: () => ({ single: async () => ({ data: normalized, error: null }) }), error: null };
      },
      update(patch) {
        const updateFilters = [...filters];
        const applyPatch = () => {
          (state[table] ?? []).forEach((row) => {
            if (rowMatches(row, updateFilters)) Object.assign(row, patch);
          });
        };
        const builder: UpdateBuilder = {
          eq(col, value) { updateFilters.push((row) => row[col] === value); return builder; },
          is(col, value) { updateFilters.push((row) => (value === null ? row[col] == null : row[col] === value)); return builder; },
          neq(col, value) {
            updateFilters.push((row) => row[col] !== value);
            applyPatch();
            return { error: null };
          },
          select: () => {
            applyPatch();
            const row = (state[table] ?? []).find((item) => rowMatches(item, updateFilters));
            return {
              maybeSingle: async () => ({ data: row ?? null, error: null }),
              single: async () => ({ data: row ?? null, error: row ? null : { message: 'not_found' } }),
            };
          },
        };
        return builder;
      },
      upsert(row) {
        if (options.upsertErrorTable === table) {
          return { select: () => ({ single: async () => ({ data: null, error: { message: 'forced_upsert_error' } }) }) };
        }
        const rows = state[table] = state[table] ?? [];
        const upsertOne = (r: Row) => {
          const existing = table === 'stream_access_sessions'
            ? rows.find((x) => x.user_id === r.user_id && (x.game_id ?? null) === (r.game_id ?? null) && x.idempotency_key === r.idempotency_key)
            : rows.find((x) => x.id === r.id);
          const target = existing ?? { ...r, id: r.id ?? crypto.randomUUID(), code: r.code ?? crypto.randomUUID() };
          Object.assign(target, r);
          if (!existing) rows.push(target);
          return target;
        };
        // Bulk upsert (array payload, e.g. handleImportRoute) — no .select()
        // chained by real callers of this path, so just persist and resolve.
        if (Array.isArray(row)) {
          row.forEach(upsertOne);
          return { error: null } as unknown as ReturnType<QueryApi['upsert']>;
        }
        const target = upsertOne(row);
        return { select: () => ({ single: async () => ({ data: target, error: null }) }) };
      },
    };
    return api;
  }

  const admin = {
    from: (table: string) => query(table),
    rpc: async (name: string, payload: Row) => {
      if (options.rpc?.[name]) return options.rpc[name](payload);
      if (name === 'can_user_view_stream') {
        const ent = (state.stream_entitlements ?? []).find((row) => row.user_id === payload.p_user_id && row.game_id === payload.p_game_id && row.status === 'active' && (!row.expires_at || new Date(String(row.expires_at)).getTime() > Date.now()));
        return { data: Boolean(ent), error: null };
      }
      if (name === 'consume_stream_rate_limit') return { data: true, error: null };
      return { data: null, error: null };
    },
  };
  return admin as unknown as SupabaseClient;
}

export function authedRequest(path: string, userId: string, body: Row, init: RequestInit = {}) {
  return new Request(`https://worker.test${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-idempotency-key': `idem-${userId}-${JSON.stringify(body).slice(0, 16)}-${crypto.randomUUID()}`,
      'x-sbbl-user-id-verified': userId,
      ...(init.headers as Record<string, string> | undefined),
    },
    body: JSON.stringify(body),
  });
}

export function baseState(overrides: Partial<TestState> = {}): TestState {
  return {
    stream_admin_config: [{ id: true, collection_id: 'https://cdn.example.com/live/main.m3u8', title: 'SBBL Live', is_live: true, active_game_id: null, updated_at: new Date().toISOString() }],
    stream_access_sessions: [],
    profiles: [],
    user_role_assignments: [],
    stream_entitlements: [],
    games: [],
    ...overrides,
  };
}
