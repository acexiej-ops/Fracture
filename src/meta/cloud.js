/**
 * cloud.js — accounts and cross-device save sync.
 *
 * DESIGN CONSTRAINT THAT SHAPES EVERYTHING HERE
 * ----------------------------------------------
 * This game has always worked offline against localStorage, and it must keep
 * working that way. So cloud sync is strictly *additive*: `Profile` remains
 * the source of truth during play and still saves locally on every change.
 * The cloud is a mirror that gets pushed to and pulled from at defined
 * moments. If the network is down, the credentials are missing, or the
 * provider is not configured at all, every call here degrades to a no-op and
 * the game is exactly what it was before.
 *
 * That is why `isConfigured()` exists and why every public function checks it.
 * An unconfigured build is not a broken build.
 *
 * PROVIDER INDEPENDENCE
 * ---------------------
 * Everything below talks to a small `provider` interface (signUp, signIn,
 * signOut, getSession, load, save). The Supabase implementation lives in
 * `cloudSupabase.js`. Swapping to Firebase means writing one more adapter,
 * not touching this file or any caller.
 *
 * THE MERGE PROBLEM
 * -----------------
 * A player with local progress who signs up for the first time must not lose
 * it, and a player signing in on a second device must not have their good
 * save clobbered by an empty one. Those pull in opposite directions, so
 * `mergeProfiles` resolves them field by field, always taking the *better* of
 * the two rather than the newer. See its comment for why.
 */

import { Profile } from './profile.js';
import { SLOTS } from './gear.js';

let provider = null;
let session = null;          // { userId, email } or null
let lastPushAt = 0;
let pushTimer = null;
// The last sync failure, or null. Surfaced in the UI: a save that silently
// stops syncing is worse than one that says it stopped, because the player
// keeps playing and only finds out on another device.
let syncError = null;

/** Listeners for auth/sync state changes, so UI can re-render. */
const listeners = new Set();
export function onCloudChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { for (const fn of listeners) { try { fn(getStatus()); } catch { /* a bad listener must not break sync */ } } }

/** Install a provider. Called once at boot; safe to call with null. */
export function setProvider(p) {
  provider = p;
  emit();
}

export function isConfigured() { return provider !== null; }
export function getSyncError() { return syncError; }
export function getSession() { return session; }
export function isSignedIn() { return session !== null; }

export function getStatus() {
  return {
    configured: isConfigured(),
    signedIn: isSignedIn(),
    email: session?.email ?? null,
    lastPushAt,
    syncError,
  };
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

/**
 * Combine two saves into one, taking the better value for every field.
 *
 * WHY "BETTER" AND NOT "NEWER":
 * A last-write-wins merge is the obvious choice and it is wrong here. Consider
 * the actual failure: you play for an hour on your laptop, then open the game
 * on your phone, which has an empty local save. The phone's save is *newer*
 * (it was just created), so last-write-wins destroys the hour. Timestamps
 * describe when a file was touched, not how much progress it holds.
 *
 * Taking the maximum of every monotonic counter and the union of every
 * collection is safe in a way timestamps are not: this game has no mechanic
 * that legitimately *reduces* a milestone, so a lower value is always the
 * stale one. Materials take the max rather than the sum, so a sync loop can
 * never inflate them (summing twice would double a balance every round trip).
 *
 * Gear is unioned by uid, which is a random id assigned at craft time, so two
 * devices crafting simultaneously produce different uids and both items
 * survive.
 */
export function mergeProfiles(a, b) {
  if (a === null) return b;
  if (b === null) return a;

  const out = {
    version: Math.max(a.version ?? 1, b.version ?? 1),
    materials: {},
    scrip: Math.max(a.scrip ?? 0, b.scrip ?? 0),
    gear: [],
    loadout: {},
    seenMaterials: [...new Set([...(a.seenMaterials ?? []), ...(b.seenMaterials ?? [])])],
    milestones: {},
    // Prefer whichever side has actually *chosen* something. `scav` is the
    // default every fresh save carries, so taking `a` unconditionally meant
    // signing in on a new device silently reset your character pick back to
    // the starter — the one field where "local wins" is wrong, because a
    // fresh local save has no opinion to defend.
    character: pickCharacter(a.character, b.character),
    // Tournament: best score per week, taking the max. A week present on only
    // one side survives, so results earned on a phone are not lost by signing
    // in on a laptop that never played that week.
    tournament: {},
    outpost: {},
  };

  for (const key of new Set([
    ...Object.keys(a.tournament ?? {}), ...Object.keys(b.tournament ?? {}),
  ])) {
    out.tournament[key] = Math.max(a.tournament?.[key] ?? 0, b.tournament?.[key] ?? 0);
  }

  const matIds = new Set([
    ...Object.keys(a.materials ?? {}), ...Object.keys(b.materials ?? {}),
  ]);
  for (const id of matIds) {
    out.materials[id] = Math.max(a.materials?.[id] ?? 0, b.materials?.[id] ?? 0);
  }

  // Gear: union by uid. A duplicate uid means the same item, so keep one.
  const byUid = new Map();
  for (const item of [...(a.gear ?? []), ...(b.gear ?? [])]) {
    if (item !== null && typeof item === 'object' && typeof item.uid === 'string') {
      if (!byUid.has(item.uid)) byUid.set(item.uid, item);
    }
  }
  out.gear = [...byUid.values()];

  // Loadout: keep a slot only if the item it points at survived the merge.
  const uids = new Set(out.gear.map((g) => g.uid));
  for (const slot in SLOTS) {
    const pick = a.loadout?.[slot] ?? b.loadout?.[slot] ?? null;
    out.loadout[slot] = typeof pick === 'string' && uids.has(pick) ? pick : null;
  }

  const mKeys = new Set([
    ...Object.keys(a.milestones ?? {}), ...Object.keys(b.milestones ?? {}),
  ]);
  for (const k of mKeys) {
    out.milestones[k] = Math.max(a.milestones?.[k] ?? 0, b.milestones?.[k] ?? 0);
  }

  // Outpost: max every counter. `lastCollectedAt` takes the EARLIER of the two
  // — the later one would silently discard offline production accrued on the
  // other device, and the offline cap already bounds how much that can be.
  const ao = a.outpost ?? {}, bo = b.outpost ?? {};
  out.outpost.drones = {};
  for (const id of new Set([...Object.keys(ao.drones ?? {}), ...Object.keys(bo.drones ?? {})])) {
    out.outpost.drones[id] = Math.max(ao.drones?.[id] ?? 0, bo.drones?.[id] ?? 0);
  }
  out.outpost.upgrades = {};
  for (const k of new Set([...Object.keys(ao.upgrades ?? {}), ...Object.keys(bo.upgrades ?? {})])) {
    out.outpost.upgrades[k] = Math.max(ao.upgrades?.[k] ?? 0, bo.upgrades?.[k] ?? 0);
  }
  const times = [ao.lastCollectedAt, bo.lastCollectedAt].filter(Number.isFinite);
  out.outpost.lastCollectedAt = times.length > 0 ? Math.min(...times) : Date.now();

  return out;
}

/** A non-default pick beats the default; otherwise either will do. */
function pickCharacter(a, b) {
  const DEFAULT = 'scav';
  if (typeof a === 'string' && a !== DEFAULT) return a;
  if (typeof b === 'string' && b !== DEFAULT) return b;
  return a ?? b ?? DEFAULT;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/**
 * Create an account, then carry whatever is already saved locally up into it.
 *
 * The migration is the point: a player who has been playing offline and then
 * signs up must find their progress intact, not a fresh save. Local is merged
 * with whatever the (brand new, therefore empty) cloud row holds, so this is
 * safe even if the account somehow already had data.
 */
export async function signUp(email, password, localProfile) {
  if (!isConfigured()) return { ok: false, error: 'Cloud saves are not configured for this build.' };
  try {
    const res = await provider.signUp(email, password);
    if (!res.ok) return res;

    // Some providers require email confirmation before a session exists. If
    // there is no session yet we cannot write, and saying so plainly beats
    // silently doing nothing.
    if (res.session === null || res.session === undefined) {
      return { ok: true, needsConfirmation: true,
               message: 'Account created. Check your email to confirm, then sign in.' };
    }

    session = res.session;
    // A brand new account has no row, so load() returns null here normally.
    // It only throws on a genuine failure, and in that case we must not write
    // either — see signIn.
    let remote;
    try {
      remote = await provider.load(session.userId);
    } catch (e) {
      syncError = friendlyError(e);
      emit();
      return { ok: true, syncFailed: true, error: syncError };
    }
    const merged = mergeProfiles(localProfile.toJSON(), remote);
    localProfile.applyJSON(merged);
    await provider.save(session.userId, merged);
    lastPushAt = Date.now();
    syncError = null;
    emit();
    return { ok: true, migrated: true };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}

/**
 * Sign in and reconcile. Same merge as signup, deliberately — a device with
 * better local progress than the cloud should push it up, not lose it.
 */
export async function signIn(email, password, localProfile) {
  if (!isConfigured()) return { ok: false, error: 'Cloud saves are not configured for this build.' };
  try {
    const res = await provider.signIn(email, password);
    if (!res.ok) return res;
    session = res.session;

    // If the read fails we abort WITHOUT writing. Merging against a save we
    // could not read would push an empty local profile over a good cloud row
    // and destroy it. Signing in is still successful — the session is valid,
    // we just could not sync — so the player is told rather than silently
    // handed an empty save.
    let remote;
    try {
      remote = await provider.load(session.userId);
    } catch (e) {
      syncError = friendlyError(e);
      emit();
      return { ok: true, syncFailed: true, error: syncError };
    }

    const merged = mergeProfiles(localProfile.toJSON(), remote);
    localProfile.applyJSON(merged);
    await provider.save(session.userId, merged);
    lastPushAt = Date.now();
    syncError = null;
    emit();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }
}

export async function signOut() {
  if (!isConfigured()) return { ok: true };
  try { await provider.signOut(); } catch { /* signing out locally is enough */ }
  session = null;
  emit();
  return { ok: true };
}

/**
 * Restore an existing session on page load, and pull the cloud save down.
 * Returns true if a session was restored.
 */
export async function restoreSession(localProfile) {
  if (!isConfigured()) return false;
  let s;
  try {
    s = await provider.getSession();
  } catch {
    return false;
  }
  if (s === null || s === undefined) return false;
  session = s;

  // The read and the write are deliberately in separate try blocks. A failed
  // read must NOT fall through to the write: pushing local over a cloud save
  // we could not read is exactly how a good save gets replaced by an empty
  // one. On a read failure we keep the session, leave local alone, and say so.
  let remote;
  try {
    remote = await provider.load(session.userId);
  } catch (e) {
    syncError = friendlyError(e);
    emit();
    return true;
  }

  try {
    if (remote !== null) {
      const merged = mergeProfiles(localProfile.toJSON(), remote);
      localProfile.applyJSON(merged);
      // Push the merge back so both sides agree from here on.
      await provider.save(session.userId, merged);
      lastPushAt = Date.now();
    }
    syncError = null;
  } catch (e) {
    syncError = friendlyError(e);
  }
  emit();
  return true;
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

/**
 * Queue a push of the current profile.
 *
 * Debounced, because the natural call site is "whenever the profile changes"
 * and the Hub can change it several times a second while a player clicks
 * through crafting. Coalescing into one write per few seconds keeps this well
 * inside any free tier's limits and off the interaction path.
 */
export function queuePush(localProfile, { immediate = false } = {}) {
  if (!isConfigured() || !isSignedIn()) return;
  clearTimeout(pushTimer);
  const doPush = async () => {
    try {
      await provider.save(session.userId, localProfile.toJSON());
      lastPushAt = Date.now();
      syncError = null;
      emit();
    } catch (e) {
      // Still not fatal — the local save remains authoritative and the next
      // change retries — but it is no longer silent. Swallowing this meant a
      // player could play for hours believing they were synced and discover
      // otherwise only on another device.
      syncError = friendlyError(e);
      emit();
    }
  };
  if (immediate) doPush();
  else pushTimer = setTimeout(doPush, 2500);
}

/**
 * Flush any debounced push immediately.
 *
 * The 2.5s debounce is right for coalescing rapid crafting clicks, but it also
 * means the last few seconds of progress are still sitting in a timer when a
 * tab is closed. Called on pagehide/visibilitychange so closing the game does
 * not strand them.
 */
export function flushPush(localProfile) {
  if (!isConfigured() || !isSignedIn()) return;
  clearTimeout(pushTimer);
  pushTimer = null;
  try {
    provider.save(session.userId, localProfile.toJSON()).catch(() => {});
  } catch { /* nothing useful to do while the page is unloading */ }
}

/** Translate provider errors into something a player can act on. */
function friendlyError(e) {
  const msg = String(e?.message ?? e ?? 'Something went wrong.');
  if (/already registered|already exists/i.test(msg)) return 'That email already has an account. Try signing in.';
  if (/invalid login|invalid credentials/i.test(msg)) return 'Wrong email or password.';
  if (/password/i.test(msg) && /short|least/i.test(msg)) return 'Password must be at least 6 characters.';
  if (/rate|too many/i.test(msg)) return 'Too many attempts. Wait a minute and try again.';
  if (/network|fetch/i.test(msg)) return 'Could not reach the server. Check your connection.';
  return msg;
}
