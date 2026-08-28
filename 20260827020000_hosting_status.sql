-- ---------------------------------------------------------------------------
-- Lets a friend see "X is playing — Join" instead of having to ask for a room
-- code by voice/text and type it in by hand. While connected to a
-- multiplayer room, the client writes its own room code onto its own
-- `players` row; `my_friends()` now also returns that (plus when it was last
-- refreshed) so the Friends tab can render a one-click Join for anyone whose
-- code is recent.
--
-- Run this AFTER 20260826000000_friends_setup.sql (and after
-- 20260827010000_unique_names.sql, if you've run that).
-- ---------------------------------------------------------------------------

alter table public.players add column if not exists hosting_code text;
alter table public.players add column if not exists hosting_at timestamptz;

drop function if exists public.my_friends();

-- Same shape as before, plus hosting_code/hosting_at. Still scoped to rows
-- where you are one of the two parties — this changes what's returned about
-- someone you're already connected to, not who can be looked up.
create function public.my_friends()
returns table (
  user_id uuid, name text, tag text, status text, direction text,
  hosting_code text, hosting_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select pl.user_id, pl.name, pl.tag, f.status,
         case when f.requester = auth.uid() then 'outgoing' else 'incoming' end,
         pl.hosting_code, pl.hosting_at
  from public.friendships f
  join public.players pl
    on pl.user_id = case when f.requester = auth.uid()
                         then f.addressee else f.requester end
  where f.requester = auth.uid() or f.addressee = auth.uid();
$$;

grant execute on function public.my_friends() to authenticated;

-- Note: no new policy needed to WRITE hosting_code/hosting_at — the existing
-- "own player row" policy on public.players (from the friends setup) already
-- covers updates to your own row, and this migration doesn't touch that
-- policy at all.
