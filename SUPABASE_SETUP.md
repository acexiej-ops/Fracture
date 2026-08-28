# Turning on accounts

Everything is built and tested. There is **one step I could not do for you** —
creating the Supabase account — plus pasting two values back. About five
minutes.

Until you do this, the game behaves exactly as it does today: local saves only,
and the Hub shows no account UI at all. Nothing is broken in the meantime.

---

## 1. Create the project

1. Go to **[supabase.com](https://supabase.com)** and sign up (free tier is fine).
2. **New project.** Pick any name. Choose a region near you. Save the database
   password it asks you to set — you will not need it for this, but Supabase
   will want it if you ever open the SQL editor from a new device.
3. Wait ~2 minutes for it to provision.

## 2. Create the saves table

Open **SQL Editor** in the left sidebar, paste this, and hit Run:

```sql
create table public.saves (
  user_id    uuid primary key references auth.users on delete cascade,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.saves enable row level security;

create policy "own save" on public.saves
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

**That policy is the entire security model**, so it is worth understanding
rather than just pasting: it means the database itself refuses any read or
write where the requesting user is not the row's owner. Not the client, not my
code — the database. Even if someone took the public key out of your bundle,
they could only ever reach their own row.

## 3. Get your two values

**Settings → API**, and copy:

- **Project URL** — looks like `https://abcdefgh.supabase.co`
- **anon / public** key — a long string starting `eyJ...`

> **Both are safe to commit.** The anon key identifies the *project*, not a
> user; the policy above is what protects data. This is the key Supabase
> intends to ship in client-side bundles.
>
> The **`service_role`** key on that same page is the dangerous one — it
> bypasses row-level security entirely. Never put it in this repo, in a
> `VITE_`-prefixed variable, or anywhere the browser can read it.

## 4. Paste them in

Either edit `src/meta/cloudConfig.js` directly:

```js
export const CLOUD_CONFIG = {
  url: import.meta.env?.VITE_SUPABASE_URL ?? 'https://YOURPROJECT.supabase.co',
  anonKey: import.meta.env?.VITE_SUPABASE_ANON_KEY ?? 'eyJ...',
};
```

…or, to keep them out of git, set them as environment variables in your Vercel
project (**Settings → Environment Variables**) and leave the file alone:

```
VITE_SUPABASE_URL       = https://YOURPROJECT.supabase.co
VITE_SUPABASE_ANON_KEY  = eyJ...
```

Then redeploy. The account UI appears in the Hub header automatically.

## 5. Optional — turn off email confirmation

By default Supabase emails a confirmation link before an account can sign in.
That is the right default for a real product, but it is friction for a game.

**Authentication → Providers → Email → uncheck "Confirm email"** to let players
sign up and start playing immediately.

The code handles both: if confirmation is on, signup shows *"Check your email
to confirm, then sign in."* instead of logging straight in.

## 6. If confirmation emails link to "this site can't be reached"

The client now tells Supabase to point the confirmation link at whatever
origin the signup happened on (`window.location.origin`) — but Supabase only
honors that if the origin is on the project's own allowlist. Without this
step, every confirmation link falls back to the dashboard's **Site URL**,
which defaults to Supabase's own placeholder (`http://localhost:3000`) and
fails for anyone who isn't running a dev server on that exact port.

**Authentication → URL Configuration**, in the Supabase dashboard:

- **Site URL** — set to your real deployed URL, e.g. `https://fracture-game.vercel.app`
- **Redirect URLs** — add that same URL (and, if you also test signup locally,
  `http://localhost:5173`). Supabase requires an exact match here; a trailing
  slash mismatch is enough to fall back to the Site URL default silently.

Nothing in this repo needs to change once those two fields are set — the fix
above already sends the right origin on every signup, for every visitor,
without hardcoding a single domain into the client.

---

## How saves merge (worth knowing before you rely on it)

The obvious approach — newest write wins — is **wrong**, and the code
deliberately does not do it.

Picture the real failure: you play for an hour on your laptop, then open the
game on your phone, which has an empty local save. The phone's save is
*newer*, so last-write-wins destroys the hour. A timestamp tells you when a
file was touched, not how much progress it holds.

So instead, every field takes the **better** value:

| Field | Rule |
|---|---|
| Materials, Scrip, milestones, drones, upgrades | **Maximum** of the two |
| Gear | **Union** by uid — items crafted on both devices all survive |
| Seen materials | Union |
| Loadout | Kept only if the item it points at survived |
| Outpost `lastCollectedAt` | **Earlier** of the two, so offline production is never silently discarded |
| Character | Whichever side actually picked one (a fresh save's default never overwrites a real choice) |

Materials take the max rather than the **sum** on purpose: summing would double
a balance on every sync round trip.

This is verified — including the laptop-vs-fresh-phone case, two devices with
different progress each keeping everything, order independence, and idempotence
(merging a result with itself changes nothing).

## What happens when

| Moment | Behaviour |
|---|---|
| Sign up with existing local progress | Local save is merged up into the new account. Nothing is lost. |
| Sign in on a new device | Cloud and local merge; the better of each field wins both ways. |
| Any profile change while signed in | Pushed to the cloud, debounced ~2.5s so rapid crafting is one write. |
| Sign out | Pending changes are flushed immediately first. |
| Offline / network down / not signed in | Local save only. Nothing errors, nothing blocks. |
| Not configured at all | No account UI renders. The game is exactly what it was. |

## Cost

The free tier is 500MB of database and 50,000 monthly active users. A save is
a few KB. You will not come close.
