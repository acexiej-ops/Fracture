-- ---------------------------------------------------------------------------
-- Global leaderboard and public player profiles.
--
-- Deliberately a narrow, explicit exception to "the players table cannot be
-- enumerated" (see friends_setup.sql) rather than a change to that policy: a
-- leaderboard IS supposed to be a public, sortable list. What it exposes is
-- limited to four columns — name, best wave, best time, total kills, and
-- last-played character — never tag, never hosting status, and never
-- anything from the saves table (materials, gear, the actual equipped
-- loadout stays private).
--
-- Column is `character_id`, not `character` — CHARACTER is a reserved SQL
-- keyword (part of CHARACTER VARYING), so a bare column or return-field
-- named `character` fails to parse at all ("syntax error at or near
-- 'character'"). Renamed everywhere rather than quoting it, since quoting
-- would have to be repeated correctly in every query that ever touches it.
--
-- Run this AFTER 20260826000000_friends_setup.sql.
-- ---------------------------------------------------------------------------

alter table public.players add column if not exists best_wave int not null default 0;
alter table public.players add column if not exists best_time real not null default 0;
alter table public.players add column if not exists total_kills int not null default 0;
alter table public.players add column if not exists character_id text;

-- Top N, ranked by furthest wave reached (ties broken by longest survival
-- time). A name only ever appears here once it has synced at least one run
-- — see src/meta/leaderboard.js's syncLeaderboardStats — so an account that
-- claimed a name but never finished a run simply isn't listed yet.
create or replace function public.leaderboard(p_limit int default 50)
returns table (name text, best_wave int, best_time real, total_kills int, character_id text)
language sql
security definer
set search_path = public
as $$
  select pl.name, pl.best_wave, pl.best_time, pl.total_kills, pl.character_id
  from public.players pl
  where pl.best_wave > 0 or pl.total_kills > 0
  order by pl.best_wave desc, pl.best_time desc
  limit least(greatest(p_limit, 1), 100);
$$;

-- One named player's public stats — same four columns, same exact-match
-- pattern find_player already uses, so it answers "what has this one name
-- achieved" without ever answering "who else is here".
create or replace function public.player_profile(p_name text)
returns table (name text, best_wave int, best_time real, total_kills int, character_id text)
language sql
security definer
set search_path = public
as $$
  select pl.name, pl.best_wave, pl.best_time, pl.total_kills, pl.character_id
  from public.players pl
  where lower(pl.name) = lower(p_name)
  limit 1;
$$;

grant execute on function public.leaderboard(int) to authenticated;
grant execute on function public.player_profile(text) to authenticated;
