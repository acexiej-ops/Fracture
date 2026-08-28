/**
 * admin.js — the password-gated bug report viewer.
 *
 * Only ever shown when the page is opened with ?admin in the URL (see
 * main.js) — everyone else never sees this exists, let alone touches it.
 * The actual protection is NOT this file: it's the SECURITY DEFINER
 * password check inside the database (see BUG_REPORTS_SETUP.md). This is
 * just the form. A wrong password comes back looking identical to "correct
 * password, no reports yet" (see bugReports.js) — that's deliberate, so
 * this can't be used to test guesses against, but it does mean an empty
 * list here is genuinely ambiguous, and the copy below says so honestly
 * rather than pretending either way.
 */

import { fetchReportsAsAdmin, markReportReviewed } from '../meta/bugReports.js';
import { t } from '../i18n/i18n.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export class AdminPanel {
  constructor(root) {
    this.password = null;
    this.reports = [];

    this.el = {
      modal: root.querySelector('[data-admin="modal"]'),
      login: root.querySelector('[data-admin="login"]'),
      form: root.querySelector('[data-admin="form"]'),
      passwordInput: root.querySelector('[data-admin="password"]'),
      error: root.querySelector('[data-admin="error"]'),
      list: root.querySelector('[data-admin="list"]'),
      count: root.querySelector('[data-admin="count"]'),
      refresh: root.querySelector('[data-admin="refresh"]'),
      reports: root.querySelector('[data-admin="reports"]'),
    };

    this.el.form.addEventListener('submit', (e) => {
      e.preventDefault();
      this._unlock();
    });
    this.el.refresh.addEventListener('click', () => this._load());
    this.el.reports.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-mark-reviewed]');
      if (btn === null) return;
      this._markReviewed(btn.dataset.markReviewed);
    });
  }

  /** Only called when ?admin is present — see main.js. */
  show() {
    this.el.modal.hidden = false;
  }

  async _unlock() {
    const password = this.el.passwordInput.value;
    this._setError(null);
    const res = await fetchReportsAsAdmin(password);
    if (!res.ok) {
      this._setError(res.error);
      return;
    }
    this.password = password;
    this.reports = res.reports;
    this.el.login.hidden = true;
    this.el.list.hidden = false;
    this._render();
  }

  async _load() {
    if (this.password === null) return;
    const res = await fetchReportsAsAdmin(this.password);
    if (res.ok) this.reports = res.reports;
    this._render();
  }

  async _markReviewed(id) {
    if (this.password === null) return;
    await markReportReviewed(this.password, id);
    const r = this.reports.find((rep) => rep.id === id);
    if (r !== undefined) r.status = 'reviewed';
    this._render();
  }

  _render() {
    const total = this.reports.length;
    const unread = this.reports.filter((r) => r.status !== 'reviewed').length;

    if (total === 0) {
      // Genuinely ambiguous — see the module doc. Say so rather than
      // implying either "you're in" or "wrong password" with confidence
      // this code doesn't actually have.
      this.el.count.textContent = t('admin.emptyOrWrongPassword');
      this.el.reports.innerHTML = '';
      return;
    }

    this.el.count.textContent = total + (unread > 0 ? ' (' + unread + ' new)' : '');

    this.el.reports.innerHTML = this.reports.map((r) => {
      const ctx = r.context ?? {};
      const when = new Date(r.created_at).toLocaleString();
      const meta = [
        ctx.wave !== null && ctx.wave !== undefined ? 'wave ' + ctx.wave : null,
        ctx.character ?? null,
        ctx.language ?? null,
      ].filter((v) => v !== null).join(' · ');

      return '<div class="admin-report' + (r.status === 'reviewed' ? ' is-reviewed' : '') + '">'
        + '<div class="admin-report-head">'
        + '<span class="admin-report-time">' + esc(when) + '</span>'
        + (r.status !== 'reviewed'
          ? '<button class="btn btn-ghost btn-sm" data-mark-reviewed="' + esc(r.id) + '">'
            + esc(t('admin.markReviewed')) + '</button>'
          : '<span class="admin-reviewed-tag">' + esc(t('admin.reviewed')) + '</span>')
        + '</div>'
        + (meta ? '<div class="admin-report-meta">' + esc(meta) + '</div>' : '')
        + '<p class="admin-report-message">' + esc(r.message) + '</p>'
        + (ctx.userAgent ? '<div class="admin-report-ua">' + esc(ctx.userAgent) + '</div>' : '')
        + '</div>';
    }).join('');
  }

  _setError(msg) {
    if (msg === null || msg === undefined) { this.el.error.hidden = true; return; }
    this.el.error.hidden = false;
    this.el.error.textContent = msg;
  }
}
