-- Utility Geo Guess | Today leaderboard in the viewer's local time zone
--
-- MIGRATION (non-destructive):
-- Run in Supabase SQL Editor BEFORE deploying the matching index.html.
-- The previous two-argument get_public_today_leaderboard(integer, uuid)
-- remains available for devices still using the old frontend.
-- The new three-argument overload is selected by p_timezone.
--
-- Read-only: never edits game_entries, events or kiosks.
-- Public output: player names and scores only, no emails or device IDs.
-- Ranking: ALL game_entries, regardless of event/kiosk/source.
-- Day: midnight-to-midnight in the supplied IANA time zone, based on NOW()
-- from PostgreSQL rather than the user's device clock. DST is supported.

create or replace function public.get_public_today_leaderboard(
  p_limit integer,
  p_entry_id uuid,
  p_timezone text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_enabled boolean := false;
  v_timezone text := 'UTC';
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

  -- Accept real PostgreSQL time zones only; do not execute dynamic SQL.
  -- Fallback to UTC when the browser reports an unknown zone.
  if p_timezone is not null
     and exists (
       select 1
       from pg_catalog.pg_timezone_names tz
       where tz.name = p_timezone
     )
  then
    v_timezone := p_timezone;
  end if;

  v_day := (now() at time zone v_timezone)::date;
  v_start := v_day::timestamp at time zone v_timezone;
  v_end := (v_day + 1)::timestamp at time zone v_timezone;

  select count(*) into v_total
  from public.game_entries e
  where e.played_at >= v_start
    and e.played_at < v_end
    and e.score_km is not null;

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
      e.id,
      e.name,
      e.score_km,
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
      select
        e.id,
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
    'timezone', v_timezone,
    'date', to_char(v_day, 'YYYY-MM-DD'),
    'rows', v_rows,
    'position', v_position
  );
end;
$$;

-- Only the function's safe JSON response is exposed to public clients.
revoke all on function public.get_public_today_leaderboard(integer, uuid, text) from public;
grant execute on function public.get_public_today_leaderboard(integer, uuid, text)
  to anon, authenticated;

-- Verify in SQL Editor after deployment, while Admin scope is "Today":
-- select public.get_public_today_leaderboard(5, null::uuid, 'America/Denver');
-- select public.get_public_today_leaderboard(5, null::uuid, 'Europe/London');
-- select public.get_public_today_leaderboard(5, null::uuid, 'Europe/Warsaw');
-- Each should return enabled=true and its own timezone/date.
