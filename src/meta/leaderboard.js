/**
 * leaderboard.js — the global leaderboard and public player profiles.
 *
 * WHY THIS IS ITS OWN NARROW SURFACE
 * ----------------------------------
 * Every other cloud feature in this game (friends.js, cloudSupabase.js) is
 * built around one rule: nobody can enumerate players. A leaderboard is the
 * one feature that is *supposed* to be an enumerable, sortable list — that
 * tension is real, not an oversight, so it gets its own explicit, minimal
 * public surface rather than loosening the `players` table's own policy.
 *
 * Two SECURITY DEFINER functions (see the migration) expose exactly four
 * columns — name, best wave, best time, total kills, and which character was
 * last played — for the leaderboard and for one profile lookup. Nothing else
 * on `players` (tag, hosting status) or on `saves` (materials, gear, actual
 * equipped loadout) is reachable through them. A player's crafted gear stays
 * private; the leaderboard shows what they *achieved*, not what they *have*.
 *
 * Entries require a claimed name (see friends.js) by construction: the
 * `players` row these functions read from only exists once a name has been
 * claimed, so a signed-in player who never named themselves simply has
 * nothing to sync and never appears.
 *
 * DEGRADATION
 * -----------
 * Same shape as everywhere else in this codebase: not configured, not signed
 * in, tables not created, network down — every path returns a plain
 * `{ ok: false, error }`, never a throw.
 */

import { isConfigured, isSignedIn, getSession } from './cloud.js';
import { CLOUD_CONFIG } from './cloudConfig.js';

const SESSION_KEY = 'fracture.session';

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

async function rpc(fn, args) {
  if (!isConfigured()) return { ok: false, error: 'Cloud features are not configured for this build.' };
  if (!isSignedIn()) return { ok: false, error: 'Sign in to view the leaderboard.' };
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
    return { ok: false, error: 'The leaderboard is not set up on this project yet (see LEADERBOARD_SETUP.md).' };
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return { ok: false, error: 'Server error ' + res.status + (detail !== '' ? ': ' + detail.slice(0, 160) : '') };
  }
  const data = await res.json().catch(() => null);
  return { ok: true, data };
}

/** Top N players, ranked by best wave reached (ties broken by best time). */
export async function fetchLeaderboard(limit = 50) {
  const res = await rpc('leaderboard', { p_limit: limit });
  if (!res.ok) return res;
  return { ok: true, entries: Array.isArray(res.data) ? res.data : [] };
}

/** One named player's public stats, for a profile view. Null if no such name. */
export async function fetchPlayerProfile(name) {
  const res = await rpc('player_profile', { p_name: name });
  if (!res.ok) return res;
  const row = Array.isArray(res.data) && res.data.length > 0 ? res.data[0] : null;
  return { ok: true, profile: row };
}

/**
 * Mirror the handful of stats the leaderboard actually needs onto the
 * player's own row. Called once per run-end (see main.js's `_die`) and once
 * on Hub load — never a general-purpose profile sync, so there is exactly
 * one place that decides what becomes public.
 *
 * Silently unavailable when signed out or unnamed, same as setHostingRoom —
 * this is a convenience layered on top of playing, not a requirement to play.
 */
export async function syncLeaderboardStats(profile) {
  const session = getSession();
  if (session === null) return { ok: false, error: 'Sign in first.' };
  if (!isConfigured()) return { ok: false, error: 'Cloud features are not configured for this build.' };
  const token = readToken();
  if (token === null) return { ok: false, error: 'Your session expired.' };

  const m = profile.milestones ?? {};
  const body = {
    best_wave: Math.round(m.bestWave ?? 0),
    best_time: Number(m.bestTime ?? 0),
    total_kills: Math.round(m.totalKills ?? 0),
    character_id: typeof profile.character === 'string' ? profile.character : null,
  };

  try {
    const res = await fetch(
      base() + '/rest/v1/players?user_id=eq.' + encodeURIComponent(session.userId),
      { method: 'PATCH', headers: { ...headers(token), Prefer: 'return=minimal' }, body: JSON.stringify(body) },
    );
    if (!res.ok) return { ok: false, error: 'Server error ' + res.status };
    return { ok: true };
  } catch {
    return { ok: false, error: 'Could not reach the server.' };
  }
}
