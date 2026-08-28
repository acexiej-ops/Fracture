/**
 * leaderboard.js (UI) — the Leaderboard tab: a ranked list, plus a way to
 * look up any one named player's public profile directly.
 *
 * Same "name the state" discipline as friends.js: not configured, signed
 * out, or a genuinely empty board all render their own message rather than
 * one ambiguous blank list.
 */

import { isConfigured, isSignedIn } from '../meta/cloud.js';
import { fetchLeaderboard, fetchPlayerProfile } from '../meta/leaderboard.js';
import { CHARACTER_BY_ID } from '../meta/characters.js';
import { formatTime } from '../core/math.js';
import { t } from '../i18n/i18n.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class LeaderboardPanel {
  constructor(root) {
    this.root = root;
    this.state = { loading: false, error: null, entries: null, lookup: null, lookupError: null };
    this._bound = false;
  }

  _bind() {
    if (this._bound || this.root === null) return;
    this._bound = true;

    this.root.addEventListener('click', async (e) => {
      const search = e.target.closest('[data-lb="search"]');
      if (search !== null) { await this._search(); return; }
      const clear = e.target.closest('[data-lb="clear-lookup"]');
      if (clear !== null) { this.state.lookup = null; this.state.lookupError = null; this.render(); return; }
      const row = e.target.closest('[data-lb-name]');
      if (row !== null) { await this._lookup(row.dataset.lbName); }
    });

    this.root.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.matches('[data-lb="search-input"]')) {
        e.preventDefault();
        this._search();
      }
    });
  }

  async _search() {
    const input = this.root.querySelector('[data-lb="search-input"]');
    if (input === null || input.value.trim() === '') return;
    await this._lookup(input.value);
  }

  async _lookup(name) {
    this.state.lookupError = null;
    const res = await fetchPlayerProfile(name);
    if (!res.ok) { this.state.lookupError = res.error; this.state.lookup = null; this.render(); return; }
    if (res.profile === null) { this.state.lookupError = t('leaderboard.notFound'); this.state.lookup = null; this.render(); return; }
    this.state.lookup = res.profile;
    this.render();
  }

  /** Pull the ranked list from the server, then repaint. */
  async refresh() {
    this._bind();
    if (!isConfigured() || !isSignedIn()) { this.state.entries = null; this.render(); return; }

    this.state.loading = true;
    this.render();

    const res = await fetchLeaderboard(50);
    if (res.ok) { this.state.entries = res.entries; this.state.error = null; }
    else { this.state.entries = null; this.state.error = res.error; }
    this.state.loading = false;
    this.render();
  }

  render() {
    if (this.root === null) return;
    this._bind();

    if (!isConfigured()) {
      this.root.innerHTML = this._note(t('leaderboard.notConfigured'));
      return;
    }
    if (!isSignedIn()) {
      this.root.innerHTML = this._note(t('leaderboard.signInToView'));
      return;
    }

    const search = '<div class="lb-search">'
      + '<input type="text" data-lb="search-input" placeholder="' + esc(t('leaderboard.searchPlaceholder')) + '"'
      + ' autocomplete="off" spellcheck="false" />'
      + '<button class="btn-mini" data-lb="search" type="button">' + t('leaderboard.search') + '</button>'
      + '</div>';

    const lookupBlock = this._renderLookup();

    if (this.state.loading && this.state.entries === null) {
      this.root.innerHTML = search + lookupBlock + this._note(t('leaderboard.loading'));
      return;
    }
    if (this.state.entries === null) {
      this.root.innerHTML = search + lookupBlock + this._note(this.state.error ?? t('leaderboard.notConfigured'));
      return;
    }
    if (this.state.entries.length === 0) {
      this.root.innerHTML = search + lookupBlock
        + '<p class="lb-note">' + t('leaderboard.empty') + '</p>';
      return;
    }

    const rows = this.state.entries.map((entry, i) => this._row(entry, i + 1)).join('');
    this.root.innerHTML = search + lookupBlock
      + '<ol class="lb-list">' + rows + '</ol>';
  }

  _renderLookup() {
    if (this.state.lookupError !== null) {
      return '<div class="lb-lookup lb-lookup-error">'
        + '<p class="lb-error">' + esc(this.state.lookupError) + '</p>'
        + '<button class="btn-mini" data-lb="clear-lookup" type="button">' + t('leaderboard.close') + '</button>'
        + '</div>';
    }
    if (this.state.lookup === null) return '';
    const p = this.state.lookup;
    const charName = CHARACTER_BY_ID.get(p.character_id)?.name ?? null;
    return '<div class="lb-lookup">'
      + '<div class="lb-lookup-head">'
      + '<strong>' + esc(p.name) + '</strong>'
      + '<button class="btn-mini" data-lb="clear-lookup" type="button">' + t('leaderboard.close') + '</button>'
      + '</div>'
      + '<ul class="lb-lookup-stats">'
      + '<li><em>' + t('leaderboard.bestWave') + '</em>' + esc(p.best_wave) + '</li>'
      + '<li><em>' + t('leaderboard.bestTime') + '</em>' + esc(formatTime(p.best_time)) + '</li>'
      + '<li><em>' + t('leaderboard.totalKills') + '</em>' + esc(Number(p.total_kills).toLocaleString()) + '</li>'
      + (charName !== null ? '<li><em>' + t('leaderboard.plays') + '</em>' + esc(charName) + '</li>' : '')
      + '</ul></div>';
  }

  _row(entry, rank) {
    return '<li class="lb-row' + (rank <= 3 ? ' lb-top' : '') + '">'
      + '<span class="lb-rank">' + rank + '</span>'
      + '<button type="button" class="lb-name" data-lb-name="' + esc(entry.name) + '">' + esc(entry.name) + '</button>'
      + '<span class="lb-stat" title="' + t('leaderboard.bestWave') + '">' + t('leaderboard.waveShort', { n: entry.best_wave }) + '</span>'
      + '<span class="lb-stat" title="' + t('leaderboard.bestTime') + '">' + esc(formatTime(entry.best_time)) + '</span>'
      + '<span class="lb-stat" title="' + t('leaderboard.totalKills') + '">' + t('leaderboard.killsShort', { n: Number(entry.total_kills).toLocaleString() }) + '</span>'
      + '</li>';
  }

  _note(text) {
    return '<p class="lb-note">' + esc(text) + '</p>';
  }
}
