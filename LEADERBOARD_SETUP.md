# Turning on the leaderboard

One SQL script, same pattern as friends and bug reports. Needs the Friends
setup already run first ([`FRIENDS_SETUP.md`](FRIENDS_SETUP.md)) — the
leaderboard lives on the same `players` table friends does.

Until you run it, the Leaderboard tab explains it isn't set up yet.
Nothing else is affected.

---

## Run this in the Supabase SQL editor

Paste the contents of
[`supabase/migrations/20260827030000_leaderboard.sql`](supabase/migrations/20260827030000_leaderboard.sql)
and hit Run.

---

## Why it is built this way

**This is a deliberate, narrow exception, not a policy change.** Every other
cloud feature here (friends, hosting status) is built around one rule: the
`players` table cannot be enumerated by a client, so nobody can dump every
username in the game. A leaderboard is the one feature that is *supposed* to
be a public, sortable list — that's a real tension, not an oversight, so it
gets its own explicit surface instead of loosening `players`' own row-level
security.

**Only four columns are ever exposed:** name, best wave reached, best
survival time, and total kills — plus which character was last played, for a
little color. Never the tag, never hosting status, and never anything from
the `saves` table: materials, crafted gear, and the actual equipped loadout
all stay private. The leaderboard shows what a player *achieved*, not what
they *have*.

**Entries require a claimed name, by construction.** `leaderboard()` and
`player_profile()` both read from the same `players` row `find_player` and
`my_friends` already use — a signed-in account that never claimed a name has
no row to read, so it never appears, with no separate check needed.

**Stats sync once per run-end, not continuously.** `syncLeaderboardStats()`
mirrors `best_wave` / `best_time` / `total_kills` / `character` from the
local profile onto the player's row after a run banks its rewards, and again
whenever the Hub loads. Nothing else about a profile is ever synced there.
