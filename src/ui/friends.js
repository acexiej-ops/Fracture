/**
 * friends.js (UI) — the Friends tab.
 *
 * Renders one of four states, and says which one it is in rather than showing
 * an empty box:
 *   - cloud not configured for this build
 *   - signed out
 *   - signed in but no display name chosen yet
 *   - the actual list
 *
 * Naming the state matters more here than in most panels. Every failure mode
 * of a social feature looks identical from the outside — an empty list — so an
 * empty list has to be distinguishable from "you are not signed in" and from
 * "the tables were never created".
 */

import { isConfigured, isSignedIn } from '../meta/cloud.js';
import {
  getMyName, claimName, listFriends, addFriend, acceptFriend, removeFriend,
  NAME_MIN, NAME_MAX, HOSTING_FRESH_MS,
} from '../meta/friends.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class FriendsPanel {
  /** @param {{ onJoinRoom?: (code: string) => void }} [opts] */
  constructor(root, opts = {}) {
    this.root = root;
    this.onJoinRoom = opts.onJoinRoom ?? null;
    this.state = { loading: false, error: null, me: null, lists: null };
    this._bound = false;
  }

  /** Wire delegated handlers once. The panel's innerHTML is rebuilt often. */
  _bind() {
    if (this._bound || this.root === null) return;
    this._bound = true;

    this.root.addEventListener('click', async (e) => {
      const claim = e.target.closest('[data-fr="claim"]');
      if (claim !== null) { await this._claim(); return; }

      const add = e.target.closest('[data-fr="add"]');
      if (add !== null) { await this._add(); return; }

      const accept = e.target.closest('[data-fr-accept]');
      if (accept !== null) {
        await this._act(() => acceptFriend(accept.dataset.frAccept));
        return;
      }
      const remove = e.target.closest('[data-fr-remove]');
      if (remove !== null) {
        await this._act(() => removeFriend(remove.dataset.frRemove));
        return;
      }
      const join = e.target.closest('[data-fr-join]');
      if (join !== null && this.onJoinRoom !== null) {
        this.onJoinRoom(join.dataset.frJoin);
        return;
      }
      const copy = e.target.closest('[data-fr="copy"]');
      if (copy !== null && this.state.me !== null) {
        try {
          await navigator.clipboard.writeText(this.state.me.name);
          copy.textContent = 'Copied';
          setTimeout(() => { copy.textContent = 'Copy'; }, 1400);
        } catch {
          // Clipboard access can be denied; the tag is on screen anyway, so
          // this is a convenience failing, not a feature failing.
          copy.textContent = 'Select it';
        }
      }
    });

    // Enter submits whichever field has focus.
    this.root.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      if (e.target.matches('[data-fr="name-input"]')) { e.preventDefault(); this._claim(); }
      if (e.target.matches('[data-fr="add-input"]')) { e.preventDefault(); this._add(); }
    });
  }

  async _claim() {
    const input = this.root.querySelector('[data-fr="name-input"]');
    if (input === null) return;
    this.state.error = null;
    const res = await claimName(input.value);
    if (!res.ok) { this.state.error = res.error; this.render(); return; }
    this.state.me = { name: res.name, tag: res.tag };
    await this.refresh();
  }

  async _add() {
    const input = this.root.querySelector('[data-fr="add-input"]');
    if (input === null) return;
    this.state.error = null;
    const res = await addFriend(input.value);
    if (!res.ok) { this.state.error = res.error; this.render(); return; }
    input.value = '';
    await this.refresh();
  }

  async _act(fn) {
    this.state.error = null;
    const res = await fn();
    if (res && res.ok === false) { this.state.error = res.error; this.render(); return; }
    await this.refresh();
  }

  /** Pull identity and lists from the server, then repaint. */
  async refresh() {
    this._bind();
    if (!isConfigured() || !isSignedIn()) { this.state.me = null; this.state.lists = null; this.render(); return; }

    this.state.loading = true;
    this.render();

    this.state.me = await getMyName();
    if (this.state.me !== null) {
      const lists = await listFriends();
      if (lists.ok) { this.state.lists = lists; this.state.error = null; }
      else { this.state.lists = null; this.state.error = lists.error; }
    }
    this.state.loading = false;
    this.render();
  }

  render() {
    if (this.root === null) return;
    this._bind();

    if (!isConfigured()) {
      this.root.innerHTML = this._note('Friends need cloud saves, which are not configured for this build.');
      return;
    }
    if (!isSignedIn()) {
      this.root.innerHTML = this._note('Sign in to pick a name and add friends.');
      return;
    }
    if (this.state.loading && this.state.me === null) {
      this.root.innerHTML = this._note('Loading…');
      return;
    }
    if (this.state.me === null) {
      this.root.innerHTML = this._nameForm();
      return;
    }
    this.root.innerHTML = this._list();
  }

  _note(text) {
    return '<p class="fr-note">' + esc(text) + '</p>'
      + (this.state.error !== null ? '<p class="fr-error">' + esc(this.state.error) + '</p>' : '');
  }

  _nameForm() {
    return '<div class="fr-claim">'
      + '<h3>Choose a display name</h3>'
      + '<p class="fr-note">Others add you by this exact name, so it has to be '
      + 'yours alone — pick something not already taken.</p>'
      + '<div class="fr-row">'
      + '<input type="text" data-fr="name-input" maxlength="' + NAME_MAX + '"'
      + ' placeholder="Driftwalker" autocomplete="off" spellcheck="false" />'
      + '<button class="btn" data-fr="claim" type="button">Claim</button>'
      + '</div>'
      + '<p class="fr-hint">' + NAME_MIN + '–' + NAME_MAX + ' characters. Letters, numbers, spaces, - and _.</p>'
      + (this.state.error !== null ? '<p class="fr-error">' + esc(this.state.error) + '</p>' : '')
      + '</div>';
  }

  _list() {
    const me = this.state.me;
    const l = this.state.lists;

    const head = '<div class="fr-me">'
      + '<span class="fr-me-label">Your name</span>'
      + '<span class="fr-tag">' + esc(me.name) + '</span>'
      + '<button class="btn-mini" data-fr="copy" type="button">Copy</button>'
      + '</div>';

    const addBox = '<div class="fr-row fr-add">'
      + '<input type="text" data-fr="add-input" placeholder="Driftwalker"'
      + ' autocomplete="off" spellcheck="false" />'
      + '<button class="btn" data-fr="add" type="button">Add friend</button>'
      + '</div>';

    const err = this.state.error !== null
      ? '<p class="fr-error">' + esc(this.state.error) + '</p>' : '';

    if (l === null) return head + addBox + err;

    const row = (f, actions) => '<li class="fr-item">'
      + '<span class="fr-tag">' + esc(f.name) + '</span>'
      + '<span class="fr-actions">' + actions + '</span></li>';

    const incoming = l.incoming.length === 0 ? '' :
      '<h4 class="fr-section">Wants to be friends</h4><ul class="fr-list">'
      + l.incoming.map((f) => row(f,
        '<button class="btn-mini" data-fr-accept="' + esc(f.user_id) + '">Accept</button>'
        + '<button class="btn-mini btn-danger" data-fr-remove="' + esc(f.user_id) + '">Decline</button>'
      )).join('') + '</ul>';

    // A friend counts as "playing" only while their published code is recent
    // — HOSTING_FRESH_MS covers a missed refresh tick without letting a
    // session that ended without cleanly leaving keep advertising forever.
    const isHosting = (f) => typeof f.hosting_code === 'string' && f.hosting_code !== ''
      && typeof f.hosting_at === 'string'
      && Date.now() - Date.parse(f.hosting_at) < HOSTING_FRESH_MS;

    const accepted = l.accepted.length === 0 ? '' :
      '<h4 class="fr-section">Friends</h4><ul class="fr-list">'
      + l.accepted.map((f) => row(f,
        (isHosting(f)
          ? '<span class="fr-playing">Playing</span>'
            + '<button class="btn-mini btn-join" data-fr-join="' + esc(f.hosting_code) + '">Join</button>'
          : '')
        + '<button class="btn-mini btn-danger" data-fr-remove="' + esc(f.user_id) + '">Remove</button>'
      )).join('') + '</ul>';

    const outgoing = l.outgoing.length === 0 ? '' :
      '<h4 class="fr-section">Sent</h4><ul class="fr-list">'
      + l.outgoing.map((f) => row(f,
        '<span class="fr-pending">Pending</span>'
        + '<button class="btn-mini btn-danger" data-fr-remove="' + esc(f.user_id) + '">Cancel</button>'
      )).join('') + '</ul>';

    const empty = (l.accepted.length + l.incoming.length + l.outgoing.length) === 0
      ? '<p class="fr-note">No friends yet. Share your name so people can add you.</p>' : '';

    return head + addBox + err + incoming + accepted + outgoing + empty;
  }
}
