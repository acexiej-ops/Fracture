# Turning on multiplayer

Multiplayer needs its own server — it isn't something Vercel can host, because
Vercel serves static files and the game's WebSocket connection needs a process
that stays running and holds room state in memory. That's what `server/` is:
a small standalone Node process, separate from the site.

Two things need to happen, in order:

1. **Test it locally** (no account needed — you can do this right now).
2. **Deploy the server somewhere with a public address** (needs a free
   Render.com account, no credit card required — the one step I can't do
   for you).

Until step 2 is done, the Multiplayer tab still works for LAN/local testing —
it just can't be reached by someone on a different network.

---

## 1. Test it locally

In one terminal:

```bash
cd server
npm install
npm start
```

You should see:

```
[fracture] Multiplayer server listening on ws://localhost:3001
[fracture] Tick rate: 20/s
```

In another terminal, run the game as usual (`npm run dev`), open it in two
browser tabs (or two devices on the same network, using your machine's LAN IP
instead of `localhost`), and in each: Hub → **Multiplayer** tab → pick a name,
leave the Server field as `ws://localhost:3001`, enter the same Room Code in
both, and Join. Both tabs should show each other in the player list. Either
one can click **Start Multiplayer Run**.

## 2. Deploy the server (so it works for anyone, anywhere)

Using **[Render.com](https://render.com)** — its free "Web Service" tier
doesn't ask for a card at signup and supports WebSockets natively. Everything
below is done in Render's dashboard; no CLI, no `fly.toml`-equivalent file
needed.

1. Sign up at render.com (GitHub login is the fastest path, and means Render
   can already see your repo).
2. **New → Web Service** → connect the `fracture-game` repo.
3. Fill in:
   - **Root Directory**: `server`
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free
4. Create the service. First deploy takes a couple of minutes; watch the
   logs for the same startup lines you saw locally
   (`[fracture] Multiplayer server listening on ws://localhost:<port>` —
   the port number will be whatever Render assigned, that's normal, the
   server already reads it from `process.env.PORT`).
5. Once live, Render shows a URL like `https://fracture-server.onrender.com`
   — the same host works for WebSocket at `wss://fracture-server.onrender.com`.

**Whatever that exact address turns out to be** (Render subdomains are a
global namespace shared by everyone on Render, not scoped to your account —
`fracture-server` may or may not be free for you to claim), set it as a
Vercel environment variable so the deployed site actually uses it:

- Vercel project → **Settings → Environment Variables**
- `VITE_MP_SERVER_URL` = `wss://YOUR-ACTUAL-NAME.onrender.com`
- Redeploy the site (same pattern as `VITE_SUPABASE_URL` earlier)

If you *do* end up with exactly `fracture-server.onrender.com`, the client's
hardcoded fallback in `src/ui/multiplayer.js` already matches it and the env
var is optional — but setting it anyway costs nothing and removes any doubt.

### The free tier's one real tradeoff: it sleeps

A free Render web service spins down after 15 minutes with no traffic, and
takes roughly 30–60 seconds to wake back up on the next connection. In
practice: if nobody's played in a while, the first person to open the
Multiplayer tab and hit Join will sit on "Connecting..." for that first
minute while it wakes, then it's normal speed for as long as anyone's
connected. Nothing to fix — just worth knowing so it doesn't look broken.

## Cost

Render's free web service is enough for this — one small always-on-while-
active instance, and a handful of concurrent rooms at 20 ticks/second is
light load. You will not need to upgrade for casual use with friends.

## What multiplayer does NOT do (yet)

- No matchmaking or public room list — a room code is the only way to find
  the other player, same as a private Discord voice channel.
- No persistence: closing the last connection to a room ends it and its
  state is gone. Nothing here touches Profile or cloud saves.
- Rooms are unauthenticated — anyone with the room code can join. Fine for
  playing with friends, not meant to survive someone posting the code
  publicly.
