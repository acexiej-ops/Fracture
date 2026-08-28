/**
 * cloudSupabase.js — the Supabase implementation of the cloud provider.
 *
 * WHY THIS TALKS TO THE REST API DIRECTLY
 * ---------------------------------------
 * The official `@supabase/supabase-js` client is ~120KB gzipped. This game's
 * entire bundle is currently around 78KB, so the SDK would more than double
 * the download to use two endpoints and one table. Supabase's auth and REST
 * APIs are plain HTTP with documented shapes, so this talks to them with
 * `fetch` and no dependency at all.
 *
 * The trade is real and worth naming: no auto-refresh of expired tokens, no
 * realtime, no built-in retry. Refresh is handled explicitly below; the other
 * two this game does not need. If that changes, swapping in the SDK means
 * rewriting only this file.
 *
 * ON THE KEY
 * ----------
 * The anon key is *designed* to be public — it identifies the project, and
 * Row Level Security is what actually protects data. It is safe in client
 * code and in the repo. The service_role key is the dangerous one and must
 * NEVER appear here or anywhere else in this project.
 *
 * REQUIRED TABLE (run once in the Supabase SQL editor — see SUPABASE_SETUP.md):
 *
 *   create table public.saves (
 *     user_id uuid primary key references auth.users on delete cascade,
 *     data jsonb not null,
 *     updated_at timestamptz not null default now()
 *   );
 *   alter table public.saves enable row level security;
 *   create policy "own save" on public.saves
 *     for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
 *
 * That policy is the whole security model: every query is scoped to the
 * authenticated user, enforced by the database rather than by this file.
 */

const SESSION_KEY = 'fracture.session';

export function createSupabaseProvider({ url, anonKey }) {
  if (typeof url !== 'string' || url === '' || typeof anonKey !== 'string' || anonKey === '') {
    return null;
  }
  const base = url.replace(/\/+$/, '');

  const authHeaders = (token) => ({
    'Content-Type': 'application/json',
    apikey: anonKey,
    Authorization: 'Bearer ' + (token ?? anonKey),
  });

  /** Persist the token set so a refresh survives a page reload. */
  function storeSession(json) {
    if (json === null) {
      try { localStorage.removeItem(SESSION_KEY); } catch { /* non-fatal */ }
      return null;
    }
    const s = {
      userId: json.user?.id,
      email: json.user?.email,
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      // `expires_in` is seconds from now; store an absolute deadline so a
      // reload hours later can tell the token is stale without guessing.
      expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
    };
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch { /* non-fatal */ }
    return s;
  }

  function readStoredSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw === null) return null;
      const s = JSON.parse(raw);
      return typeof s?.userId === 'string' ? s : null;
    } catch { return null; }
  }

  let current = readStoredSession();

  async function post(path, body, token) {
    const res = await fetch(base + path, {
      method: 'POST', headers: authHeaders(token), body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.msg ?? json.error_description ?? json.message ?? 'Request failed');
    return json;
  }

  /** Exchange a refresh token for a fresh access token. */
  async function refresh() {
    if (current?.refreshToken === undefined) return null;
    try {
      const json = await post('/auth/v1/token?grant_type=refresh_token',
        { refresh_token: current.refreshToken });
      current = storeSession(json);
      return current;
    } catch {
      current = storeSession(null);
      return null;
    }
  }

  /** A valid access token, refreshing first if it is close to expiry. */
  async function validToken() {
    if (current === null) return null;
    // 60s of slack, so a token cannot expire mid-request.
    if (current.expiresAt !== undefined && Date.now() > current.expiresAt - 60000) {
      const r = await refresh();
      return r?.accessToken ?? null;
    }
    return current.accessToken;
  }

  return {
    async signUp(email, password) {
      // Without this, the confirmation email links to whatever "Site URL" is
      // set in the Supabase dashboard's Auth settings — which defaults to
      // Supabase's own placeholder (localhost) unless someone has changed
      // it, giving every confirmation link a "this site can't be reached"
      // regardless of where the game is actually deployed. Passing the
      // page's own origin here makes the link correct independent of that
      // dashboard setting, as long as this origin is also on the project's
      // Redirect URLs allowlist (see SUPABASE_SETUP.md) — Supabase silently
      // falls back to the Site URL default for any origin not on that list.
      const redirectTo = encodeURIComponent(window.location.origin);
      const json = await post('/auth/v1/signup?redirect_to=' + redirectTo, { email, password });
      // When email confirmation is on, Supabase returns a user but no session.
      if (json.access_token === undefined) return { ok: true, session: null };
      current = storeSession(json);
      return { ok: true, session: { userId: current.userId, email: current.email } };
    },

    async signIn(email, password) {
      const json = await post('/auth/v1/token?grant_type=password', { email, password });
      current = storeSession(json);
      return { ok: true, session: { userId: current.userId, email: current.email } };
    },

    async signOut() {
      const token = await validToken();
      if (token !== null) {
        // Best effort — the local session is cleared regardless, so a failed
        // server call cannot leave the player stuck "signed in".
        try { await post('/auth/v1/logout', {}, token); } catch { /* ignore */ }
      }
      current = storeSession(null);
    },

    async getSession() {
      if (current === null) return null;
      const token = await validToken();
      if (token === null) return null;
      return { userId: current.userId, email: current.email };
    },

    /**
     * Fetch the stored save.
     *
     * Returns null ONLY for "no row yet". Every genuine failure THROWS.
     *
     * That distinction is load-bearing and used to be missing, with real
     * data-loss consequences. This returned null for three unrelated things:
     * no row, a failed request, and a dead token. The caller read all three as
     * "the cloud is empty", merged local into nothing, and pushed the result
     * back — so one transient read failure on a device with an empty local
     * save would overwrite a good cloud row with an empty one. Worse, it was
     * self-perpetuating: after the first wipe every later sign-in legitimately
     * found nothing. Throwing means the caller aborts instead of overwriting.
     */
    async load(userId) {
      const token = await validToken();
      if (token === null) throw new Error('Your session expired. Sign in again.');
      const res = await fetch(
        base + '/rest/v1/saves?user_id=eq.' + encodeURIComponent(userId) + '&select=data',
        { headers: authHeaders(token) });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error('Could not read your cloud save (HTTP ' + res.status + '). '
          + (detail !== '' ? detail.slice(0, 200) : 'Nothing was changed.'));
      }
      const rows = await res.json().catch(() => null);
      if (!Array.isArray(rows)) throw new Error('Cloud save came back malformed. Nothing was changed.');
      return rows.length > 0 ? rows[0].data : null;
    },

    async save(userId, data) {
      const token = await validToken();
      if (token === null) throw new Error('Your session expired. Sign in again.');
      // Upsert via Prefer: resolution=merge-duplicates, so the first save and
      // every save after it are the same request rather than insert-or-update
      // branching on whether a row already exists.
      const res = await fetch(base + '/rest/v1/saves?on_conflict=user_id', {
        method: 'POST',
        headers: { ...authHeaders(token), Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ user_id: userId, data, updated_at: new Date().toISOString() }),
      });
      // Throw rather than return false. A silently-dropped write is the worst
      // outcome here: the player keeps playing, believes they are synced, and
      // finds out only when they sign in somewhere else and it is not there.
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error('Could not save to the cloud (HTTP ' + res.status + '). '
          + (detail !== '' ? detail.slice(0, 200) : ''));
      }
      return true;
    },
  };
}
