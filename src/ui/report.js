/**
 * report.js — the "Report a Bug" form.
 *
 * Deliberately account-free: opening this never checks whether anyone is
 * signed in, and submitting never touches Profile. A bug report has to work
 * for the player who hits something broken and does not want to create an
 * account before they can even tell you about it.
 */

import { submitReport, gatherContext } from '../meta/bugReports.js';
import { t } from '../i18n/i18n.js';

export class ReportPanel {
  constructor(root, { getState, getProfile }) {
    this.getState = getState;
    this.getProfile = getProfile;
    this.busy = false;

    this.el = {
      modal: root.querySelector('[data-report="modal"]'),
      close: root.querySelector('[data-report="close"]'),
      form: root.querySelector('[data-report="form"]'),
      message: root.querySelector('[data-report="message"]'),
      error: root.querySelector('[data-report="error"]'),
      submit: root.querySelector('[data-report="submit"]'),
      sent: root.querySelector('[data-report="sent"]'),
    };

    this.el.close.addEventListener('click', () => this.close());
    this.el.modal.addEventListener('click', (e) => {
      if (e.target === this.el.modal) this.close();
    });
    this.el.form.addEventListener('submit', (e) => {
      e.preventDefault();
      this._submit();
    });
  }

  open() {
    this.el.modal.hidden = false;
    this.el.form.hidden = false;
    this.el.sent.hidden = true;
    this._setError(null);
    this.el.message.value = '';
    this.el.message.focus();
  }

  close() {
    this.el.modal.hidden = true;
  }

  async _submit() {
    if (this.busy) return;
    const message = this.el.message.value.trim();
    if (message.length === 0) {
      this._setError(t('report.errorEmpty'));
      return;
    }

    this.busy = true;
    this.el.submit.disabled = true;
    this._setError(null);

    const context = gatherContext(this.getState(), this.getProfile());
    const res = await submitReport(message, context);

    this.busy = false;
    this.el.submit.disabled = false;

    if (!res.ok) {
      this._setError(res.error ?? t('report.errorGeneric'));
      return;
    }

    this.el.form.hidden = true;
    this.el.sent.hidden = false;
    // Give the "thanks" message a moment to actually be read before closing
    // on its own — a report that vanishes instantly reads as "did that even
    // send?" as much as an error would.
    setTimeout(() => this.close(), 1800);
  }

  _setError(msg) {
    if (msg === null) { this.el.error.hidden = true; this.el.error.textContent = ''; return; }
    this.el.error.hidden = false;
    this.el.error.textContent = msg;
  }
}
