-- Utility Geo Guess | Current event leaderboard for ALL devices
-- Run in Supabase SQL Editor BEFORE deploying matching index.html.
-- New function does not replace the existing get_leaderboard_for_device,
-- submit_game_score, get_game_config or Today functions.
-- Public response excludes email addresses and all kiosk identifiers.

create or replace function public.get_public_event_leaderboard(
  p_limit integer,
  p_entry_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_event_id uuid;
  v_event_name text;
  v_prize_mode text;
  v_prize_rank integer;
  v_prize_score_km numeric;
  v_count bigint := 0;
  v_rows jsonb := '[]'::jsonb;
  v_position jsonb := null;
begin
  select
    gs.current_event_id,
    e.name,
    gs.prize_mode,
    gs.prize_rank,
    gs.prize_score_km
  into
    v_event_id,
    v_event_name,
    v_prize_mode,
    v_prize_rank,
    v_prize_score_km
  from public.game_settings gs
  left join public.events e on e.id = gs.current_event_id
  where gs.id = true
    and gs.leaderboard_scope = 'event';

  if v_event_id is null then
    return jsonb_build_object(
      'enabled', false,
      'rows', '[]'::jsonb,
      'position', null
    );
  end if;

  select count(*) into v_count
  from public.game_entries ge
  where ge.event_id = v_event_id
    and ge.score_km is not null;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'entry_id', r.id,
        'name', r.name,
        'score_km', r.score_km,
        'rank', r.rank
      ) order by r.rank
    ),
    '[]'::jsonb
  )
  into v_rows
  from (
    select
      ge.id,
      ge.name,
      ge.score_km,
      row_number() over (
        order by ge.score_km asc, ge.played_at asc, ge.id asc
      ) as rank
    from public.game_entries ge
    where ge.event_id = v_event_id
      and ge.score_km is not null
    order by ge.score_km asc, ge.played_at asc, ge.id asc
    limit greatest(1, least(coalesce(p_limit, 5), 50))
  ) r;

  if p_entry_id is not null then
    select jsonb_build_object(
      'rank', r.rank,
      'players', v_count,
      'top_five', r.rank <= 5,
      'scope_label', coalesce(v_event_name, 'Current event'),
      'prize_mode', coalesce(v_prize_mode, 'off'),
      'in_prize_zone', case
        when v_prize_mode = 'rank' then r.rank <= coalesce(v_prize_rank, 5)
        when v_prize_mode = 'score' then r.score_km <= v_prize_score_km
        else false end,
      'places_from_prize', case
        when v_prize_mode = 'rank' then greatest(r.rank - coalesce(v_prize_rank, 5), 0)
        else null end,
      'score_gap_km', case
        when v_prize_mode = 'score' then greatest(r.score_km - v_prize_score_km, 0)
        else null end
    )
    into v_position
    from (
      select
        ge.id,
        ge.score_km,
        row_number() over (
          order by ge.score_km asc, ge.played_at asc, ge.id asc
        ) as rank
      from public.game_entries ge
      where ge.event_id = v_event_id
        and ge.score_km is not null
    ) r
    where r.id = p_entry_id;
  end if;

  return jsonb_build_object(
    'enabled', true,
    'event_name', coalesce(v_event_name, 'Current event'),
    'rows', v_rows,
    'position', v_position
  );
end;
$$;

revoke all on function public.get_public_event_leaderboard(integer, uuid) from public;
grant execute on function public.get_public_event_leaderboard(integer, uuid) to anon, authenticated;

-- Test when Game setup > Leaderboard scope = Current event:
-- select public.get_public_event_leaderboard(5, null::uuid);
-- The result should have "enabled": true and a top-five list for CEATI Denver.
