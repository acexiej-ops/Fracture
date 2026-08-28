-- ---------------------------------------------------------------------------
-- Bug reports: anyone can submit one, only you (via a password) can read them.
--
-- Reports need to work for someone who has never signed in — a bug is exactly
-- the moment a player might not want to create an account first — so this
-- table accepts writes from the anon role with no auth check at all. That
-- makes the READ side the only thing worth protecting, and it is protected
-- the same way the rest of this project protects a narrow admin action: a
-- SECURITY DEFINER function that checks a password before it does anything,
-- rather than a Supabase user account with special privileges. See
-- BUG_REPORTS_SETUP.md for why, and for the one line you MUST edit before
-- running this.
-- ---------------------------------------------------------------------------

-- Supabase enables this by default on every new project, but the earlier
-- migrations in this repo never needed it (they let auth.users hand them a
-- uuid) — this is the first table here that generates its own, so this line
-- is just insurance. Costs nothing if it's already on.
create extension if not exists pgcrypto;

create table public.bug_reports (
  id         uuid primary key default gen_random_uuid(),
  message    text not null check (char_length(message) between 1 and 2000),
  context    jsonb,
  created_at timestamptz not null default now(),
  status     text not null default 'new' check (status in ('new', 'reviewed'))
);

alter table public.bug_reports enable row level security;

-- Anyone can file a report — signed in or not. There is deliberately no
-- select policy at all: RLS with zero matching policies means the table
-- reads as empty to every direct query, from anon AND from an authenticated
-- player. The only way to read this table is the function below.
create policy "anyone can submit a report" on public.bug_reports
  for insert
  with check (true);

-- ---------------------------------------------------------------------------
-- CHANGE THIS PASSWORD before running this file. It is compared in plain
-- text inside the database — fine for a small admin surface like this one,
-- but only as fine as the password itself, since anyone who reads this
-- function's source (or guesses the placeholder below) can call it.
-- ---------------------------------------------------------------------------
create function public.admin_get_reports(p_password text)
returns table (id uuid, message text, context jsonb, created_at timestamptz, status text)
language sql
security definer
set search_path = public
as $$
  select r.id, r.message, r.context, r.created_at, r.status
  from public.bug_reports r
  where p_password = 'change-me-please'
  order by r.created_at desc;
$$;

-- Companion action: mark a report reviewed once you've actually looked at
-- it, so the admin panel can distinguish new from already-seen. Same
-- password gate, and a mismatched password silently updates zero rows
-- rather than erroring — no reason to tell a wrong guess anything at all.
create function public.admin_mark_reviewed(p_password text, p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.bug_reports
  set status = 'reviewed'
  where p_password = 'change-me-please' and id = p_id;
$$;

grant execute on function public.admin_get_reports(text) to anon, authenticated;
grant execute on function public.admin_mark_reviewed(text, uuid) to anon, authenticated;
