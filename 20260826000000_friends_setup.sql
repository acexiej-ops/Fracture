-- Friends setup: players, friendships, and helper functions.
-- See FRIENDS_SETUP.md for security rationale.

-- Saves table (idempotent — safe to re-run)
create table if not exists public.saves (
  user_id    uuid primary key references auth.users on delete cascade,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.saves enable row level security;

do $$ begin
  create policy "own save" on public.saves
    for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
exception when duplicate_object then null;
end $$;

-- Players: display name + four-digit tag.
create table if not exists public.players (
  user_id    uuid primary key references auth.users on delete cascade,
  name       text not null check (char_length(name) between 3 and 16),
  tag        text not null check (tag ~ '^[0-9]{4}$'),
  created_at timestamptz not null default now(),
  unique (name, tag)
);

alter table public.players enable row level security;

do $$ begin
  create policy "own player row" on public.players
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null;
end $$;

-- Friendships: one row per pair, status is pending or accepted.
create table if not exists public.friendships (
  requester  uuid not null references auth.users on delete cascade,
  addressee  uuid not null references auth.users on delete cascade,
  status     text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  primary key (requester, addressee)
);

alter table public.friendships enable row level security;

do $$ begin
  create policy "see own friendships" on public.friendships
    for select using (auth.uid() = requester or auth.uid() = addressee);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "send requests" on public.friendships
    for insert with check (auth.uid() = requester and requester <> addressee);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "respond to requests" on public.friendships
    for update using (auth.uid() = addressee) with check (auth.uid() = addressee);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "remove own friendships" on public.friendships
    for delete using (auth.uid() = requester or auth.uid() = addressee);
exception when duplicate_object then null;
end $$;

-- Functions
create or replace function public.find_player(p_name text, p_tag text)
returns table (user_id uuid, name text, tag text)
language sql
security definer
set search_path = public
as $$
  select pl.user_id, pl.name, pl.tag
  from public.players pl
  where lower(pl.name) = lower(p_name) and pl.tag = p_tag
  limit 1;
$$;

create or replace function public.my_friends()
returns table (user_id uuid, name text, tag text, status text, direction text)
language sql
security definer
set search_path = public
as $$
  select pl.user_id, pl.name, pl.tag, f.status,
         case when f.requester = auth.uid() then 'outgoing' else 'incoming' end
  from public.friendships f
  join public.players pl
    on pl.user_id = case when f.requester = auth.uid()
                         then f.addressee else f.requester end
  where f.requester = auth.uid() or f.addressee = auth.uid();
$$;

create or replace function public.name_available(p_name text, p_tag text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select not exists (
    select 1 from public.players pl
    where lower(pl.name) = lower(p_name) and pl.tag = p_tag
  );
$$;

grant execute on function public.find_player(text, text) to authenticated;
grant execute on function public.my_friends() to authenticated;
grant execute on function public.name_available(text, text) to authenticated;
