/**
 * friends.js — display names and the friends list.
 *
 * IDENTITY MODEL
 * --------------
 * Names are globally unique, case-insensitively — the first `Driftwalker` to
 * claim it is the only one. Everyone else has to pick something else, the same
 * way a username works anywhere else.
 *
 * A `tag` column still exists on each row for historical reasons (an earlier
 * version paired a name with a rolled four-digit tag so names didn't have to
 * be unique), but nothing reads it anymore — it's populated on insert purely
 * to satisfy the column's NOT NULL constraint without a second migration.
 *
 * TALKING TO THE SERVER
 * ---------------------
 * Every call here goes through two `SECURITY DEFINER` Postgres functions
 * rather than reading tables directly. The `players` table is deliberately not
 * readable: a policy that lets any signed-in user select from it also lets any
 * signed-in user download every username in the game. `find_player` answers
 * "does this exact name exist" and `my_friends` answers "who am I connected
 * to", and neither can enumerate. See FRIENDS_SETUP.md.
 *
 * DEGRADATION
 * -----------
 * Not configured, not signed in, tables not created, network down — every path
 * returns a plain `{ ok: false, error }` and the UI says so. Nothing here can
 * break a run or a save, because none of it touches Profile.
 */

import { isConfigured, isSignedIn, getSession } from './cloud.js';
import { CLOUD_CONFIG } from './cloudConfig.js';

const SESSION_KEY = 'fracture.session';
const NAME_KEY = 'fracture.playerName';

/** Name rules, enforced client-side AND by a CHECK constraint in Postgres. */
export const NAME_MIN = 3;
export const NAME_MAX = 16;

/**
 * What counts as a usable name.
 *
 * Letters, digits, spaces, underscores and hyphens. Deliberately narrow: it
 * keeps names typeable on any keyboard, since a friend has to be able to
 * enter yours exactly.
 */
export function validateName(raw) {
  const name = String(raw ?? '').trim();
  if (name.length < NAME_MIN) return { ok: false, error: 'Name must be at least ' + NAME_MIN + ' characters.' };
  if (name.length > NAME_MAX) return { ok: false, error: 'Name must be at most ' + NAME_MAX + ' characters.' };
  if (!/^[\p{L}\p{N} _-]+$/u.test(name)) {
    return { ok: false, error: 'Use letters, numbers, spaces, hyphens or underscores.' };
  }
  if (/^[ _-]|[ _-]$/.test(name)) return { ok: false, error: 'Name cannot start or end with a space or symbol.' };
  return { ok: true, name };
}

/** A random four-digit tag, as a string so leading zeros survive.
 *  Purely cosmetic now — see the file header — kept only to satisfy the
 *  `tag` column's NOT NULL constraint on insert. */
function rollTag() {
  return String(Math.floor(Math.random() * 10000)).padStart(4, '0');
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

function readToken() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw === null) return null;
    const s = JSON.parse(raw);
    return typeof s?.accessToken === 'string' ? s.accessToken : null;
  } catch { return null; }
}

function base() { return String(CLOUD_CONFIG.url ?? '').replace(/\/+$/, ''); }

function headers(token) {
  return {
    'Content-Type': 'application/json',
    apikey: CLOUD_CONFIG.anonKey,
    Authorization: 'Bearer ' + token,
  };
}

/**
 * Call one of the Postgres functions.
 *
 * Errors are surfaced, never swallowed. A friends feature that silently does
 * nothing when the tables are missing is indistinguishable from one that is
 * broken, and the most likely cause here is simply that the setup SQL has not
 * been run yet — which is worth saying out loud.
 */
async function rpc(fn, args) {
  if (!isConfigured()) return { ok: false, error: 'Cloud features are not configured for this build.' };
  if (!isSignedIn()) return { ok: false, error: 'Sign in to use friends.' };
  const token = readToken();
  if (token === null) return { ok: false, error: 'Your session expired. Sign in again.' };

  let res;
  try {
    res = await fetch(base() + '/rest/v1/rpc/' + fn, {
      method: 'POST', headers: headers(token), body: JSON.stringify(args ?? {}),
    });
  } catch {
    return { ok: false, error: 'Could not reach the server. Check your connection.' };
  }

  if (res.status === 404) {
    return { ok: false, error: 'Friends are not set up on this project yet (see FRIENDS_SETUP.md).' };
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return { ok: false, error: 'Server error ' + res.status + (detail !== '' ? ': ' + detail.slice(0, 160) : '') };
  }
  const data = await res.json().catch(() => null);
  return { ok: true, data };
}

async function table(method, path, body, extraHeaders) {
  if (!isConfigured()) return { ok: false, error: 'Cloud features are not configured for this build.' };
  if (!isSignedIn()) return { ok: false, error: 'Sign in to use friends.' };
  const token = readToken();
  if (token === null) return { ok: false, error: 'Your session expired. Sign in again.' };

  let res;
  try {
    res = await fetch(base() + '/rest/v1/' + path, {
      method,
      headers: { ...headers(token), ...(extraHeaders ?? {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, error: 'Could not reach the server. Check your connection.' };
  }
  if (res.status === 404) {
    return { ok: false, error: 'Friends are not set up on this project yet (see FRIENDS_SETUP.md).' };
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return { ok: false, error: detail.slice(0, 200) || ('Server error ' + res.status), status: res.status };
  }
  const text = await res.text().catch(() => '');
  let data = null;
  if (text !== '') { try { data = JSON.parse(text); } catch { data = null; } }
  return { ok: true, data };
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * The signed-in player's own name row, or null if they have not chosen one.
 *
 * Cached in localStorage so the Hub can show your tag immediately on load
 * without a round trip; the cache is keyed by user id so signing in as someone
 * else on a shared machine cannot show the previous player's tag.
 */
export async function getMyName({ useCache = true } = {}) {
  const session = getSession();
  if (session === null) return null;

  if (useCache) {
    try {
      const raw = localStorage.getItem(NAME_KEY);
      if (raw !== null) {
        const c = JSON.parse(raw);
        if (c?.userId === session.userId && typeof c.name === 'string') {
          return { name: c.name, tag: c.tag };
        }
      }
    } catch { /* fall through to the network */ }
  }

  const res = await table('GET', 'players?select=name,tag&user_id=eq.'
    + encodeURIComponent(session.userId));
  if (!res.ok) return null;
  const row = Array.isArray(res.data) && res.data.length > 0 ? res.data[0] : null;
  if (row === null) return null;
  cacheName(session.userId, row);
  return row;
}

function cacheName(userId, row) {
  try {
    localStorage.setItem(NAME_KEY, JSON.stringify({ userId, name: row.name, tag: row.tag }));
  } catch { /* non-fatal */ }
}

/**
 * Claim a display name. Fails outright if someone else already has it —
 * there is no fallback tag to fall back on anymore, so the player just picks
 * a different name.
 */
export async function claimName(rawName) {
  const v = validateName(rawName);
  if (!v.ok) return v;

  const session = getSession();
  if (session === null) return { ok: false, error: 'Sign in first.' };

  const tag = rollTag();
  const res = await table('POST', 'players?on_conflict=user_id', {
    user_id: session.userId, name: v.name, tag,
  }, { Prefer: 'resolution=merge-duplicates,return=representation' });

  if (res.ok) {
    const row = { name: v.name, tag };
    cacheName(session.userId, row);
    return { ok: true, ...row };
  }
  // 23505 is Postgres' unique_violation — on_conflict only covers the
  // user_id case (re-claiming your own row), so a name already held by
  // someone else surfaces here instead.
  const isCollision = typeof res.error === 'string'
    && (res.error.includes('23505') || res.error.includes('duplicate key'));
  if (isCollision) return { ok: false, error: 'That name is taken. Try another.' };
  return { ok: false, error: res.error };
}

// ---------------------------------------------------------------------------
// Friends
// ---------------------------------------------------------------------------

/** Everyone you are connected to, pending or accepted. */
export async function listFriends() {
  const res = await rpc('my_friends');
  if (!res.ok) return res;
  const rows = Array.isArray(res.data) ? res.data : [];
  return {
    ok: true,
    accepted: rows.filter((r) => r.status === 'accepted'),
    incoming: rows.filter((r) => r.status === 'pending' && r.direction === 'incoming'),
    outgoing: rows.filter((r) => r.status === 'pending' && r.direction === 'outgoing'),
  };
}

/** Send a friend request to an exact display name. */
export async function addFriend(rawName) {
  const v = validateName(rawName);
  if (!v.ok) return v;

  const session = getSession();
  if (session === null) return { ok: false, error: 'Sign in first.' };

  const found = await rpc('find_player', { p_name: v.name });
  if (!found.ok) return found;
  const row = Array.isArray(found.data) && found.data.length > 0 ? found.data[0] : null;
  if (row === null) return { ok: false, error: 'No player with that name.' };
  if (row.user_id === session.userId) return { ok: false, error: 'That is you.' };

  const res = await table('POST', 'friendships', {
    requester: session.userId, addressee: row.user_id, status: 'pending',
  }, { Prefer: 'return=minimal' });

  if (!res.ok) {
    if (typeof res.error === 'string'
        && (res.error.includes('23505') || res.error.includes('duplicate key'))) {
      return { ok: false, error: 'You have already sent them a request.' };
    }
    return res;
  }
  return { ok: true, name: row.name, tag: row.tag };
}

/** Accept an incoming request. Only the addressee can do this; RLS enforces it. */
export async function acceptFriend(userId) {
  const session = getSession();
  if (session === null) return { ok: false, error: 'Sign in first.' };
  return table('PATCH',
    'friendships?requester=eq.' + encodeURIComponent(userId)
      + '&addressee=eq.' + encodeURIComponent(session.userId),
    { status: 'accepted' }, { Prefer: 'return=minimal' });
}

/**
 * Remove a friendship, in either direction.
 *
 * Two requests because the row could be stored either way round and PostgREST
 * has no OR across two equality filters on different columns. Both are
 * attempted and success of either counts — deleting a row that is not there is
 * not an error.
 */
export async function removeFriend(userId) {
  const session = getSession();
  if (session === null) return { ok: false, error: 'Sign in first.' };
  const me = encodeURIComponent(session.userId);
  const them = encodeURIComponent(userId);
  const a = await table('DELETE', 'friendships?requester=eq.' + me + '&addressee=eq.' + them,
    undefined, { Prefer: 'return=minimal' });
  const b = await table('DELETE', 'friendships?requester=eq.' + them + '&addressee=eq.' + me,
    undefined, { Prefer: 'return=minimal' });
  if (a.ok || b.ok) return { ok: true };
  return a.ok === false ? a : b;
}

/** Clear the cached name — called on sign-out so the next player starts clean. */
export function forgetCachedName() {
  try { localStorage.removeItem(NAME_KEY); } catch { /* non-fatal */ }
}

// ---------------------------------------------------------------------------
// Hosting status — lets a friend join with one click instead of being told a
// room code out loud. Not a presence system: no realtime channel, just two
// columns on your own player row that the Friends tab happens to read every
// time it already polls my_friends().
// ---------------------------------------------------------------------------

/** How long a published room code is treated as "still playing" before the
 *  Friends tab stops offering to join it — long enough to tolerate a missed
 *  refresh tick, short enough that closing the tab without leaving cleanly
 *  doesn't advertise a dead invite for the rest of the session. */
export const HOSTING_FRESH_MS = 5 * 60 * 1000;

/**
 * Publish the room the signed-in player is currently connected to.
 *
 * Silently unavailable when signed out — multiplayer itself needs no
 * account, and this is purely a convenience layered on top of it, not a
 * requirement to join a friend the old way (being told the code directly).
 */
export async function setHostingRoom(code) {
  const session = getSession();
  if (session === null) return { ok: false, error: 'Sign in first.' };
  return table('PATCH', 'players?user_id=eq.' + encodeURIComponent(session.userId),
    { hosting_code: code, hosting_at: new Date().toISOString() },
    { Prefer: 'return=minimal' });
}

/** Called on leaving a room (or disconnecting), so a friend's Friends tab
 *  stops offering to join a game that's already over. */
export async function clearHostingRoom() {
  const session = getSession();
  if (session === null) return { ok: false, error: 'Sign in first.' };
  return table('PATCH', 'players?user_id=eq.' + encodeURIComponent(session.userId),
    { hosting_code: null }, { Prefer: 'return=minimal' });
}
