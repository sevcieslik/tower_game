-- Utility Geo Guess: one daily leaderboard across ALL devices and events.
-- Execute this once in Supabase > SQL Editor before merging the frontend.
--
-- "Today" is calculated in America/Denver (including DST).
-- These functions intentionally return no email or other personal details.
-- Does not alter any game_entries rows or existing RPC functions.
--
-- game_settings.id is the existing singleton BOOLEAN key (= true).

create or replace function public.is_today_leaderboard_enabled()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.game_settings as settings
    where settings.id = true
      and settings.leaderboard_scope = 'daily'
  );
$$;

revoke all on function public.is_today_leaderboard_enabled() from public;
grant execute on function public.is_today_leaderboard_enabled()
  to anon, authenticated;


-- The sole criteria for including a game is its played_at timestamp.
-- No event_id, kiosk_id, sales_rep_id or source filters.
-- Score order: lowest distance first; ties break by played_at then id.

create or replace function public.get_today_leaderboard(p_limit integer default 5)
returns table (
  entry_id uuid,
  name text,
  score_km numeric,
  rank bigint,
  players bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with bounds as (
    select
      date_trunc('day', now() at time zone 'America/Denver')
        at time zone 'America/Denver' as start_at,
      (date_trunc('day', now() at time zone 'America/Denver')
        + interval '1 day') at time zone 'America/Denver' as end_at
  ),
  ranked as (
    select
      entry.id::uuid as entry_id,
      entry.name::text as name,
      entry.score_km::numeric as score_km,
      row_number() over (
        order by entry.score_km asc, entry.played_at asc, entry.id asc
      )::bigint as rank,
      count(*) over ()::bigint as players
    from public.game_entries as entry
    cross join bounds
    where entry.played_at >= bounds.start_at
      and entry.played_at < bounds.end_at
      and entry.score_km is not null
  )
  select ranked.entry_id, ranked.name, ranked.score_km,
         ranked.rank, ranked.players
  from ranked
  order by ranked.rank
  limit least(greatest(coalesce(p_limit, 5), 1), 50);
$$;

revoke all on function public.get_today_leaderboard(integer) from public;
grant execute on function public.get_today_leaderboard(integer)
  to anon, authenticated;


-- Used only to show a player their own daily position after saving.
-- Prize-zone calculations for specific events remain separate.

create or replace function public.get_today_player_position(p_entry_id uuid)
returns table (
  rank bigint,
  players bigint,
  top_five boolean,
  scope_label text,
  prize_mode text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with bounds as (
    select
      date_trunc('day', now() at time zone 'America/Denver')
        at time zone 'America/Denver' as start_at,
      (date_trunc('day', now() at time zone 'America/Denver')
        + interval '1 day') at time zone 'America/Denver' as end_at
  ),
  ranked as (
    select
      entry.id,
      row_number() over (
        order by entry.score_km asc, entry.played_at asc, entry.id asc
      )::bigint as position,
      count(*) over ()::bigint as total_players
    from public.game_entries as entry
    cross join bounds
    where entry.played_at >= bounds.start_at
      and entry.played_at < bounds.end_at
      and entry.score_km is not null
  )
  select
    ranked.position,
    ranked.total_players,
    (ranked.position <= 5) as top_five,
    'Today'::text as scope_label,
    'off'::text as prize_mode
  from ranked
  where ranked.id = p_entry_id;
$$;

revoke all on function public.get_today_player_position(uuid) from public;
grant execute on function public.get_today_player_position(uuid)
  to anon, authenticated;

-- Check the current configuration and today's entries after running:
-- select public.is_today_leaderboard_enabled();
-- select * from public.get_today_leaderboard(5);
-- select * from public.get_today_player_position(
--   '<an existing game_entries.id from today>'::uuid
-- );
