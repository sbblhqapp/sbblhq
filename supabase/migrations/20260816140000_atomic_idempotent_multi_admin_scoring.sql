-- Migration: 20260816140000_atomic_idempotent_multi_admin_scoring.sql
-- Enables seamless, race-condition-free real-time score compilation and aggregation
-- from multiple concurrent admin accounts simultaneously with atomic idempotency.

create or replace function public.fn_atomic_record_player_stat(
  p_game_id uuid,
  p_player_id uuid,
  p_stat text,
  p_delta int,
  p_team_side text,
  p_idempotency_key text default null,
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_current_stats jsonb;
  v_stat_col text := lower(p_stat);
begin
  -- Validate stat column
  if v_stat_col not in ('pts', 'reb', 'ast', 'stl', 'blk', 'fls', 'min') then
    raise exception 'invalid_stat_type: %', p_stat;
  end if;

  -- 1. Idempotency Check: if this key already executed, return current state without re-applying delta
  if p_idempotency_key is not null and exists (
    select 1 from public.audit_logs 
    where idempotency_key = p_idempotency_key
  ) then
    select to_jsonb(p) into v_current_stats
    from public.player_game_stats p
    where p.game_id = p_game_id and p.player_id = p_player_id;

    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'stats', v_current_stats
    );
  end if;

  -- 2. Atomic UPSERT into player_game_stats
  insert into public.player_game_stats as pgs (
    game_id, player_id, pts, reb, ast, stl, blk, fls, min, updated_at
  ) values (
    p_game_id, p_player_id,
    case when v_stat_col = 'pts' then greatest(0, p_delta) else 0 end,
    case when v_stat_col = 'reb' then greatest(0, p_delta) else 0 end,
    case when v_stat_col = 'ast' then greatest(0, p_delta) else 0 end,
    case when v_stat_col = 'stl' then greatest(0, p_delta) else 0 end,
    case when v_stat_col = 'blk' then greatest(0, p_delta) else 0 end,
    case when v_stat_col = 'fls' then greatest(0, p_delta) else 0 end,
    case when v_stat_col = 'min' then greatest(0, p_delta) else 0 end,
    now()
  )
  on conflict (game_id, player_id) do update set
    pts = case when v_stat_col = 'pts' then greatest(0, pgs.pts + p_delta) else pgs.pts end,
    reb = case when v_stat_col = 'reb' then greatest(0, pgs.reb + p_delta) else pgs.reb end,
    ast = case when v_stat_col = 'ast' then greatest(0, pgs.ast + p_delta) else pgs.ast end,
    stl = case when v_stat_col = 'stl' then greatest(0, pgs.stl + p_delta) else pgs.stl end,
    blk = case when v_stat_col = 'blk' then greatest(0, pgs.blk + p_delta) else pgs.blk end,
    fls = case when v_stat_col = 'fls' then greatest(0, pgs.fls + p_delta) else pgs.fls end,
    min = case when v_stat_col = 'min' then greatest(0, pgs.min + p_delta) else pgs.min end,
    updated_at = now()
  returning to_jsonb(pgs.*) into v_current_stats;

  -- 3. If scoring stat (pts) changed, atomically update overlay_game_state and games
  if v_stat_col = 'pts' and p_delta <> 0 and p_team_side in ('home', 'away') then
    -- Ensure overlay row exists
    insert into public.overlay_game_state (game_id, home_score, away_score, updated_at)
    values (p_game_id, 0, 0, now())
    on conflict (game_id) do nothing;

    if p_team_side = 'home' then
      update public.overlay_game_state
      set home_score = greatest(0, home_score + p_delta),
          updated_at = now(),
          last_event_at = now()
      where game_id = p_game_id;

      update public.games
      set home_score = greatest(0, home_score + p_delta),
          updated_at = now()
      where id = p_game_id;
    elsif p_team_side = 'away' then
      update public.overlay_game_state
      set away_score = greatest(0, away_score + p_delta),
          updated_at = now(),
          last_event_at = now()
      where game_id = p_game_id;

      update public.games
      set away_score = greatest(0, away_score + p_delta),
          updated_at = now()
      where id = p_game_id;
    end if;
  end if;

  -- 4. Record audit log with idempotency_key
  insert into public.audit_logs (
    actor_id, action, ref_type, ref_id, payload, idempotency_key
  ) values (
    p_actor_id,
    'record_player_stat',
    'player_game_stats',
    p_game_id::text || ':' || p_player_id::text,
    jsonb_build_object(
      'gameId', p_game_id,
      'playerId', p_player_id,
      'stat', v_stat_col,
      'delta', p_delta,
      'teamSide', p_team_side
    ),
    coalesce(p_idempotency_key, gen_random_uuid()::text)
  );

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'stats', v_current_stats
  );
end;
$$;

create or replace function public.fn_atomic_adjust_overlay_score(
  p_game_id uuid,
  p_team_side text,
  p_delta int,
  p_event_text text default null,
  p_idempotency_key text default null,
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_overlay_json jsonb;
begin
  if p_team_side not in ('home', 'away') then
    raise exception 'invalid_team_side: %', p_team_side;
  end if;

  -- Idempotency check
  if p_idempotency_key is not null and exists (
    select 1 from public.audit_logs
    where idempotency_key = p_idempotency_key
  ) then
    select to_jsonb(o) into v_overlay_json
    from public.overlay_game_state o
    where o.game_id = p_game_id;

    return jsonb_build_object('ok', true, 'idempotent', true, 'overlay', v_overlay_json);
  end if;

  -- Ensure overlay exists
  insert into public.overlay_game_state (game_id, home_score, away_score, updated_at)
  values (p_game_id, 0, 0, now())
  on conflict (game_id) do nothing;

  -- Atomic update
  if p_team_side = 'home' then
    update public.overlay_game_state as o
    set home_score = greatest(0, o.home_score + p_delta),
        last_event_text = coalesce(p_event_text, o.last_event_text),
        last_event_at = now(),
        updated_at = now()
    where o.game_id = p_game_id
    returning to_jsonb(o.*) into v_overlay_json;

    update public.games
    set home_score = greatest(0, home_score + p_delta),
        updated_at = now()
    where id = p_game_id;
  else
    update public.overlay_game_state as o
    set away_score = greatest(0, o.away_score + p_delta),
        last_event_text = coalesce(p_event_text, o.last_event_text),
        last_event_at = now(),
        updated_at = now()
    where o.game_id = p_game_id
    returning to_jsonb(o.*) into v_overlay_json;

    update public.games
    set away_score = greatest(0, away_score + p_delta),
        updated_at = now()
    where id = p_game_id;
  end if;

  -- Audit log
  insert into public.audit_logs (
    actor_id, action, ref_type, ref_id, payload, idempotency_key
  ) values (
    p_actor_id,
    'adjust_overlay_score',
    'overlay_game_state',
    p_game_id::text,
    jsonb_build_object('gameId', p_game_id, 'teamSide', p_team_side, 'delta', p_delta),
    coalesce(p_idempotency_key, gen_random_uuid()::text)
  );

  return jsonb_build_object('ok', true, 'idempotent', false, 'overlay', v_overlay_json);
end;
$$;

-- Grant execution to authenticated & service roles
grant execute on function public.fn_atomic_record_player_stat(uuid, uuid, text, int, text, text, uuid) to authenticated, service_role;
grant execute on function public.fn_atomic_adjust_overlay_score(uuid, text, int, text, text, uuid) to authenticated, service_role;
