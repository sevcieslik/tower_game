-- Utility Geo Guess: global Today leaderboard, independent of kiosk/event/source.
-- Run ONCE in Supabase SQL Editor, then select "Today" in Admin > Game setup.
-- Today = local day in America/Denver. Public response contains no email or device IDs.
-- This function DOES NOT modify game_entries or existing leaderboard functions.

create or replace function public.get_public_today_leaderboard(
  p_limit integer default 5,
  p_entry_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_enabled boolean := false;
  v_day date;
  v_start timestamptz;
  v_end timestamptz;
  v_total bigint := 0;
  v_rows jsonb := '[]'::jsonb;
  v_position jsonb := null;
begin
  select (gs.leaderboard_scope = 'daily')
    into v_enabled
  from public.game_settings gs
  where gs.id = true;

  if not coalesce(v_enabled, false) then
    return jsonb_build_object(
      'enabled', false,
      'rows', '[]'::jsonb,
      'position', null
    );
  end if;

  v_day := (now() at time zone 'America/Denver')::date;
  v_start := v_day::timestamp at time zone 'America/Denver';
  v_end := (v_day + 1)::timestamp at time zone 'America/Denver';

  select count(*) into v_total
  from public.game_entries e
  where e.played_at >= v_start
    and e.played_at < v_end
    and e.score_km is not null;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'entry_id', r.id,
      'name', r.name,
      'score_km', r.score_km,
      'rank', r.rank
    ) order by r.rank
  ), '[]'::jsonb)
  into v_rows
  from (
    select e.id, e.name, e.score_km,
           row_number() over (
             order by e.score_km asc, e.played_at asc, e.id asc
           ) as rank
    from public.game_entries e
    where e.played_at >= v_start
      and e.played_at < v_end
      and e.score_km is not null
    order by e.score_km asc, e.played_at asc, e.id asc
    limit greatest(1, least(coalesce(p_limit, 5), 50))
  ) r;

  if p_entry_id is not null then
    select jsonb_build_object(
      'rank', ranked.rank,
      'players', v_total,
      'top_five', ranked.rank <= 5,
      'scope_label', 'Today'
    )
    into v_position
    from (
      select e.id,
             row_number() over (
               order by e.score_km asc, e.played_at asc, e.id asc
             ) as rank
      from public.game_entries e
      where e.played_at >= v_start
        and e.played_at < v_end
        and e.score_km is not null
    ) ranked
    where ranked.id = p_entry_id;
  end if;

  return jsonb_build_object(
    'enabled', true,
    'timezone', 'America/Denver',
    'date', to_char(v_day, 'YYYY-MM-DD'),
    'rows', v_rows,
    'position', v_position
  );
end;
$$;

revoke all on function public.get_public_today_leaderboard(integer, uuid) from public;
grant execute on function public.get_public_today_leaderboard(integer, uuid) to anon, authenticated;

-- Optional smoke test after setting "Today" in the Admin UI:
-- select public.get_public_today_leaderboard(5, null);
