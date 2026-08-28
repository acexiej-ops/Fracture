/**
 * bugReports.js — submitting a bug report, and the admin panel's read path.
 *
 * Deliberately account-free on the submit side: a bug is exactly the moment
 * a player might not want to sign up first, so this never checks
 * isSignedIn() and never touches Profile. It talks to the same Supabase
 * project as everything else in meta/, over plain fetch — see
 * cloudSupabase.js for why there's no SDK dependency.
 *
 * The read side (fetchReportsAsAdmin) is not gated by anything in this file
 * at all — the actual protection is entirely inside the database (see
 * BUG_REPORTS_SETUP.md): a SECURITY DEFINER function that only returns rows
 * if the password argument matches. Sending a wrong password here just gets
 * back an empty list, not an error, because the function can't tell "wrong
 * password" from "no reports yet" and shouldn't try to.
 */

import { CLOUD_CONFIG, cloudConfigured } from './cloudConfig.js';

function headers() {
  return {
    'Content-Type': 'application/json',
    apikey: CLOUD_CONFIG.anonKey,
    Authorization: 'Bearer ' + CLOUD_CONFIG.anonKey,
  };
}

/**
 * File a report. `context` is a plain object — whatever the caller thinks is
 * useful (wave, character, build info); this just forwards it into the jsonb
 * column untouched.
 */
export async function submitReport(message, context = {}) {
  if (!cloudConfigured()) return { ok: false, error: 'Not set up yet.' };
  const trimmed = message.trim();
  if (trimmed.length === 0) return { ok: false, error: 'Say a little about what happened.' };
  if (trimmed.length > 2000) return { ok: false, error: 'Keep it under 2000 characters.' };

  try {
    const res = await fetch(CLOUD_CONFIG.url.replace(/\/+$/, '') + '/rest/v1/bug_reports', {
      method: 'POST',
      headers: { ...headers(), Prefer: 'return=minimal' },
      body: JSON.stringify({ message: trimmed, context }),
    });
    if (!res.ok) {
      // A 404 here means the table/policy from BUG_REPORTS_SETUP.md hasn't
      // been created yet — say so plainly rather than a raw HTTP status.
      if (res.status === 404) {
        return { ok: false, error: 'Bug reports aren’t set up on this build yet.' };
      }
      return { ok: false, error: 'Couldn’t send that — try again later.' };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'Couldn’t reach the server. Check your connection.' };
  }
}

/** Everything the admin panel needs, gathered once at submit time. */
export function gatherContext(state, profile) {
  return {
    wave: state?.wave ?? null,
    character: profile?.character ?? null,
    inRun: state !== null && state !== undefined,
    url: typeof location !== 'undefined' ? location.href : null,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    language: typeof navigator !== 'undefined' ? navigator.language : null,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Admin-only: fetch every report. Returns `{ ok: true, reports }` on any
 * successful call — including a wrong password, which comes back as
 * `reports: []` rather than an error (see the module doc for why). The
 * caller can't distinguish "wrong password" from "no reports yet" from this
 * response alone, which is intentional: it means the UI can't leak a
 * signal a brute-force attempt could use either.
 */
export async function fetchReportsAsAdmin(password) {
  if (!cloudConfigured()) return { ok: false, error: 'Not set up yet.', reports: [] };
  try {
    const res = await fetch(
      CLOUD_CONFIG.url.replace(/\/+$/, '') + '/rest/v1/rpc/admin_get_reports',
      { method: 'POST', headers: headers(), body: JSON.stringify({ p_password: password }) },
    );
    if (!res.ok) {
      if (res.status === 404) return { ok: false, error: 'Not set up yet.', reports: [] };
      return { ok: false, error: 'Server error (HTTP ' + res.status + ').', reports: [] };
    }
    const reports = await res.json().catch(() => []);
    return { ok: true, reports: Array.isArray(reports) ? reports : [] };
  } catch {
    return { ok: false, error: 'Could not reach the server.', reports: [] };
  }
}

/** Admin-only: mark one report reviewed. Same silent-no-op-on-wrong-password shape. */
export async function markReportReviewed(password, id) {
  if (!cloudConfigured()) return false;
  try {
    const res = await fetch(
      CLOUD_CONFIG.url.replace(/\/+$/, '') + '/rest/v1/rpc/admin_mark_reviewed',
      { method: 'POST', headers: headers(), body: JSON.stringify({ p_password: password, p_id: id }) },
    );
    return res.ok;
  } catch {
    return false;
  }
}
