-- ---------------------------------------------------------------------------
-- Reverses the name+tag identity model: display names are now globally
-- unique, case-insensitively. The tag column stays (existing rows already
-- have one, and dropping it buys nothing), but it no longer participates in
-- uniqueness or lookups — only the name does.
--
-- Run this AFTER 20260826000000_friends_setup.sql. Safe to run even if a
-- couple of players already collide on the same name+different tags today:
-- that unique index creation will simply fail and tell you which rows to
-- rename first (see the note at the bottom).
-- ---------------------------------------------------------------------------

drop function if exists public.find_player(text, text);
drop function if exists public.name_available(text, text);

alter table public.players drop constraint if exists players_name_tag_key;

create unique index if not exists players_name_lower_key on public.players (lower(name));

-- Exact-match lookup, by name only.
create function public.find_player(p_name text)
returns table (user_id uuid, name text, tag text)
language sql
security definer
set search_path = public
as $$
  select pl.user_id, pl.name, pl.tag
  from public.players pl
  where lower(pl.name) = lower(p_name)
  limit 1;
$$;

-- Is a name free? Returns a boolean only — never a row.
create function public.name_available(p_name text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select not exists (
    select 1 from public.players pl where lower(pl.name) = lower(p_name)
  );
$$;

grant execute on function public.find_player(text) to authenticated;
grant execute on function public.name_available(text) to authenticated;

-- If the unique index above failed with a duplicate-key error, two existing
-- players already share a name (different tags, back when that was allowed).
-- Find them with:
--
--   select lower(name), array_agg(user_id) from public.players
--   group by lower(name) having count(*) > 1;
--
-- and rename one of each pair (update public.players set name = '...' where
-- user_id = '...') before re-running this file.
