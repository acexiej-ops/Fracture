# Turning on friends

One SQL script to run, same as the saves table. About two minutes.

Until you run it, the Friends tab explains that friends are unavailable and
everything else works exactly as it does now — no errors, nothing blocked.

> **Already ran the old version of this file?** An earlier version of this
> setup gave every player a name *and* a rolled four-digit tag (`Driftwalker
> #1234`), so names didn't have to be unique. That's been reversed — names are
> unique now, tags are gone from the UI. If your project already has the
> `players` table from before, just run
> [`supabase/migrations/20260827010000_unique_names.sql`](supabase/migrations/20260827010000_unique_names.sql)
> in the SQL editor and you're done — skip the block below, you already have
> the table.
>
> **Already have the table from before "Join a friend's game" existed?** Run
> [`supabase/migrations/20260827020000_hosting_status.sql`](supabase/migrations/20260827020000_hosting_status.sql)
> too — it adds the two columns and the updated `my_friends()` a friend's
> "Join" button in the Friends tab depends on.

---

## Run this in the Supabase SQL editor

```sql
-- ---------------------------------------------------------------------------
-- Players: the chosen display name. Globally unique, case-insensitively.
-- ---------------------------------------------------------------------------
create table public.players (
  user_id    uuid primary key references auth.users on delete cascade,
  name       text not null check (char_length(name) between 3 and 16),
  -- Historical: an earlier version paired a name with this rolled tag so
  -- names didn't have to be unique. Nothing reads it anymore; it's kept only
  -- because dropping a NOT NULL column buys nothing here.
  tag        text not null check (tag ~ '^[0-9]{4}$'),
  created_at timestamptz not null default now(),
  -- Set by the client while connected to a multiplayer room, cleared on
  -- leaving. Lets a friend's "Join" button in the Friends tab work without
  -- anyone reading a code out loud — see my_friends() below.
  hosting_code text,
  hosting_at   timestamptz
);

create unique index players_name_lower_key on public.players (lower(name));

alter table public.players enable row level security;

-- You can read and write only your own row. Nobody can read the table
-- directly, which is what stops anyone dumping every username.
create policy "own player row" on public.players
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Friendships. One row per pair, owned by whoever sent the request.
-- ---------------------------------------------------------------------------
create table public.friendships (
  requester  uuid not null references auth.users on delete cascade,
  addressee  uuid not null references auth.users on delete cascade,
  status     text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  primary key (requester, addressee)
);

alter table public.friendships enable row level security;

create policy "see own friendships" on public.friendships
  for select using (auth.uid() = requester or auth.uid() = addressee);

create policy "send requests" on public.friendships
  for insert with check (auth.uid() = requester and requester <> addressee);

-- Only the person who RECEIVED a request can accept it.
create policy "respond to requests" on public.friendships
  for update using (auth.uid() = addressee) with check (auth.uid() = addressee);

create policy "remove own friendships" on public.friendships
  for delete using (auth.uid() = requester or auth.uid() = addressee);

-- ---------------------------------------------------------------------------
-- Exact-match lookup, by name only.
--
-- SECURITY DEFINER so it can see rows the policy above hides — but it matches
-- on the full name and returns at most one row, so it answers "does
-- Driftwalker exist" without ever answering "who else is here".
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Your friends, with their names resolved — plus whatever room code they've
-- published while connected to multiplayer, so the Friends tab can offer a
-- one-click Join instead of someone reading a code out loud.
--
-- Also SECURITY DEFINER, and also scoped: it only ever joins rows where you
-- are one of the two parties, so it cannot leak anyone you are not connected
-- to.
-- ---------------------------------------------------------------------------
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
grant execute on function public.my_friends() to authenticated;
grant execute on function public.name_available(text) to authenticated;
```

---

## Why it is built this way

**The `players` table is not readable.** The obvious design lets any signed-in
user `select * from players` so the client can look people up. That also lets
any signed-in user download every username in your game, which is exactly how
scraped user lists happen. The policy here allows only your own row, and the
two `SECURITY DEFINER` functions provide the narrow answers the game actually
needs: *does this exact name exist* and *who are my friends*. Neither can
enumerate.

**`security definer` deserves the scrutiny it usually gets.** It means the
function runs with the definer's rights and bypasses RLS, so a careless one is
a hole. Both are safe for the same reason: their `where` clauses pin the result
to either an exact name match or to rows where `auth.uid()` is already a
party. `set search_path = public` is there so the function cannot be tricked
into resolving a table name somewhere else.

**Names are globally unique.** An earlier version of this file paired a name
with a rolled four-digit tag specifically so names didn't have to be unique —
several players could all be *Driftwalker*, distinguished by tag, the way
Discord and Battle.net both do it. That's been reversed: the good names now go
to whoever claims them first, and everyone after that just picks something
else, the way a username works anywhere else.

**Requests need accepting.** `status` starts `pending` and only the addressee
can update it. Auto-accepting would let anyone attach themselves to your list
uninvited.

**Hosting status is just two columns on your own row, not a presence
system.** There's no realtime channel here — a friend's "Join" button appears
because the Friends tab already polls `my_friends()` on open, and now that
includes whatever room code you last wrote to your own row while connected.
`hosting_at` lets the UI hide a code once it's stale (someone who closed the
tab without leaving cleanly), without needing a cleanup job — see
`src/ui/friends.js`'s freshness check.

## What the game does with it

| Moment | Behaviour |
|---|---|
| Signed out | Friends tab explains you need an account. Nothing errors. |
| Signed in, no name yet | Prompts you to choose one immediately. |
| Name already taken | Told outright — pick a different one. |
| Adding a friend | Exact display name. Sends a pending request. |
| Being added | Shows under Pending with Accept / Decline. |
| A friend is in a multiplayer room | Shows a Join button next to their name; clicking it connects you to their room directly. |
| Not configured at all | Tab renders the same "unavailable" note as signed-out. |
