# Turning on bug reports

One SQL script, same pattern as the saves and friends tables. About two
minutes — plus one thing you must change before running it.

Until you do this, the in-game "Report a Bug" button still shows and still
lets a player type a report, but submitting it fails quietly (nothing
breaks, the player just sees "couldn't send that — try again later"). The
admin panel shows "not set up yet".

---

## 1. Pick a password, then run the SQL

Open **[supabase/migrations/20260827000000_bug_reports_setup.sql](supabase/migrations/20260827000000_bug_reports_setup.sql)**.

**Before you paste it into Supabase, replace both occurrences of
`'change-me-please'` with a real password of your choosing.** That literal
string is compared inside the database every time the admin panel asks for
reports — anyone who knows it can read every report ever submitted, so
don't leave the placeholder in place, and don't reuse a password you use
anywhere else (it sits in the database in plain text, same tradeoff as the
Wi-Fi password on your router — fine for something this low-stakes, not
fine to reuse).

Then: Supabase dashboard → **SQL Editor** → paste the (edited) file → Run.

## 2. Open the admin panel

Visit your game with `?admin` on the end of the URL:

```
https://fracture-game.vercel.app/?admin
```

It'll ask for the password you just picked. Get it right and you'll see
every report, newest first, with a button to mark each one reviewed once
you've actually looked at it (so new ones stand out from ones you've
already seen).

Nothing about this URL is secret or hidden from view — anyone who guesses
`?admin` sees the password PROMPT, same as anyone can see a login page.
What they can't do without the actual password is see a single report,
because the query that returns them lives entirely behind the password
check in the database, not behind anything in the page itself.

## Why a password check instead of a real admin account

Supabase's normal model is: sign in, and RLS policies decide what your
account can see. That works well when the thing being protected is *your
own* data. An admin panel doesn't fit that shape — it needs to see
*everyone's* reports, which is exactly the kind of access a normal RLS
policy is supposed to prevent. Rather than build a whole "is this user an
admin" role system for one screen, the two functions in the SQL file check
a password directly and only return anything if it matches. Same idea as
`find_player`/`my_friends` in the friends setup: a narrow, deliberately
inflexible function stands in for a broader permission you don't want to
grant.

## What a report actually contains

Whatever the player typed, plus automatically attached context: current
wave and character if they were mid-run, the browser's user agent, and a
timestamp. No account, email, or identifying info is collected — a report
is anonymous unless the player happens to describe themselves in the
message.

## Cost

Same free tier as everything else in this project. A bug report is a few
hundred bytes; you will not come close to any limit from this alone.
