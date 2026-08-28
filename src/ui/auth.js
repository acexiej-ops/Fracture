/**
 * auth.js — the sign-in / create-account panel and the Hub's account chip.
 *
 * Deliberately self-contained: it owns its own DOM, listens to `cloud.js` for
 * state, and tells the Hub to re-render when a sync changes the profile. The
 * rest of the UI does not know accounts exist.
 *
 * When cloud saves are unconfigured, `mount()` renders nothing at all rather
 * than a disabled button. Dead UI that explains why it is dead is worse than
 * no UI: the offline game is a complete game, not a degraded one.
 */

import { forgetCachedName, getMyName, claimName } from '../meta/friends.js';
import {
  isConfigured, isSignedIn, getStatus, signIn, signUp, signOut,
  onCloudChange, queuePush,
} from '../meta/cloud.js';
import { t, onLanguageChange } from '../i18n/i18n.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export class AuthPanel {
  /**
   * @param {HTMLElement} root         the #hub element
   * @param {object}      opts
   * @param {() => object} opts.getProfile   current live Profile
   * @param {() => void}   opts.onProfileChanged  re-render the Hub after a sync
   */
  constructor(root, { getProfile, onProfileChanged }) {
    this.getProfile = getProfile;
    this.onProfileChanged = onProfileChanged;
    this.mode = 'signin';        // 'signin' | 'signup'
    this.busy = false;

    this.el = {
      chip: root.querySelector('[data-hub="account"]'),
      modal: root.querySelector('[data-auth="modal"]'),
      panel: root.querySelector('.auth-panel'),
      close: root.querySelector('[data-auth="close"]'),
      title: root.querySelector('[data-auth="title"]'),
      blurb: root.querySelector('[data-auth="blurb"]'),
      form: root.querySelector('[data-auth="form"]'),
      email: root.querySelector('[data-auth="email"]'),
      password: root.querySelector('[data-auth="password"]'),
      error: root.querySelector('[data-auth="error"]'),
      submit: root.querySelector('[data-auth="submit"]'),
      switch: root.querySelector('[data-auth="switch"]'),
      switchText: root.querySelector('[data-auth="switch-text"]'),
      nameModal: root.querySelector('[data-namegate="modal"]'),
      nameForm: root.querySelector('[data-namegate="form"]'),
      nameInput: root.querySelector('[data-namegate="name"]'),
      nameError: root.querySelector('[data-namegate="error"]'),
      nameSubmit: root.querySelector('[data-namegate="submit"]'),
    };

    this.el.nameForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      this._submitName();
    });

    this.el.chip.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-auth-action]');
      if (btn === null) return;
      if (btn.dataset.authAction === 'open') this.open('signin');
      else if (btn.dataset.authAction === 'signout') this._signOut();
    });

    this.el.close.addEventListener('click', () => this.close());
    // Clicking the backdrop closes; clicking inside the panel must not.
    this.el.modal.addEventListener('click', (e) => {
      if (e.target === this.el.modal) this.close();
    });
    this.el.switch.addEventListener('click', () => {
      this.setMode(this.mode === 'signin' ? 'signup' : 'signin');
    });
    this.el.form.addEventListener('submit', (e) => {
      e.preventDefault();
      this._submit();
    });

    onCloudChange(() => this.renderChip());
    // The modal, once opened, is static-per-mode — nothing re-renders its
    // labels while it sits open. If someone switches language with it open
    // (or the chip behind it), both need to pick up the new strings live.
    onLanguageChange(() => {
      this.renderChip();
      if (!this.el.modal.hidden) this.setMode(this.mode);
    });
  }

  /** Render the header chip. Draws nothing when cloud is unconfigured. */
  renderChip() {
    if (!isConfigured()) { this.el.chip.innerHTML = ''; return; }
    const st = getStatus();

    if (!st.signedIn) {
      this.el.chip.innerHTML =
        '<button class="btn-account" data-auth-action="open" type="button">' + esc(t('account.signIn')) + '</button>'
        + '<span class="account-note">' + esc(t('account.cloudBlurb')) + '</span>';
      return;
    }

    // A sync failure has to be visible. Silently showing "Signed in" while
    // nothing is actually reaching the cloud is how a player loses hours
    // without knowing — they only find out on the next device.
    const failed = typeof st.syncError === 'string' && st.syncError !== '';
    const synced = failed
      ? 'Not synced - ' + st.syncError
      : (st.lastPushAt > 0 ? 'Synced ' + relativeTime(st.lastPushAt) : 'Signed in');
    this.el.chip.innerHTML =
      '<div class="account-info">'
      + '<span class="account-email">' + esc(st.email ?? 'Account') + '</span>'
      + '<span class="account-note' + (failed ? ' account-note-bad' : '')
      + '" data-auth="synced">' + esc(synced) + '</span>'
      + '</div>'
      + '<button class="btn-account ghost" data-auth-action="signout" type="button">' + esc(t('account.signOut')) + '</button>';
  }

  setMode(mode) {
    this.mode = mode;
    const isUp = mode === 'signup';
    this.el.title.textContent = isUp ? t('account.create') : t('account.signIn');
    this.el.blurb.textContent = isUp
      // Says exactly what will happen to their existing save, because "will my
      // progress survive this" is the only real question at this moment.
      ? t('account.blurbSignUp')
      : t('account.blurbSignIn');
    this.el.submit.textContent = isUp ? t('account.create') : t('account.signIn');
    this.el.switchText.textContent = isUp ? t('account.alreadyHaveAccount') : t('account.noAccountYet');
    this.el.switch.textContent = isUp ? t('account.signIn') : t('account.switchToSignUp');
    this.el.password.setAttribute('autocomplete', isUp ? 'new-password' : 'current-password');
    this._setError(null);
  }

  open(mode = 'signin') {
    if (!isConfigured()) return;
    this.setMode(mode);
    this.el.modal.hidden = false;
    this.el.email.focus();
  }

  close() {
    this.el.modal.hidden = true;
    this._setError(null);
    this.el.password.value = '';
  }

  _setError(msg) {
    if (msg === null || msg === undefined) {
      this.el.error.hidden = true;
      this.el.error.textContent = '';
      return;
    }
    this.el.error.hidden = false;
    this.el.error.textContent = msg;
  }

  _setBusy(busy) {
    this.busy = busy;
    this.el.submit.disabled = busy;
    this.el.submit.textContent = busy
      ? (this.mode === 'signup' ? 'Creating…' : 'Signing in…')
      : (this.mode === 'signup' ? 'Create account' : 'Sign in');
  }

  async _submit() {
    if (this.busy) return;
    const email = this.el.email.value.trim();
    const password = this.el.password.value;
    if (email === '' || password.length < 6) {
      this._setError('Enter an email and a password of at least 6 characters.');
      return;
    }

    this._setBusy(true);
    this._setError(null);
    const profile = this.getProfile();

    const res = this.mode === 'signup'
      ? await signUp(email, password, profile)
      : await signIn(email, password, profile);

    this._setBusy(false);

    if (!res.ok) { this._setError(res.error ?? 'Something went wrong.'); return; }

    // Signed in, but the cloud read failed. We deliberately did NOT write
    // anything in that case, so their cloud save is intact — say so, because
    // "signed in but your progress is missing" is alarming without it.
    if (res.syncFailed === true) {
      this._setError('Signed in, but could not load your cloud save: '
        + (res.error ?? 'unknown error') + ' Your saved progress is untouched - try again shortly.');
      this.renderChip();
      return;
    }

    if (res.needsConfirmation === true) {
      this._setError(null);
      this.el.blurb.textContent = res.message
        ?? 'Account created. Check your email to confirm, then sign in.';
      this.setModeAfterConfirm();
      return;
    }

    this.close();

    // Every signed-in player needs a claimed name — it's what the redesigned
    // Hub shows above the chosen character, and what friends add you by.
    // Checked with a live read, not the cache, since a fresh account or a
    // fresh device never has one cached yet.
    const named = await getMyName({ useCache: false });
    if (named === null) { this._openNameGate(); return; }

    this.renderChip();
    // The merge may have changed materials, gear or unlocks, so the whole Hub
    // needs redrawing rather than just the chip.
    this.onProfileChanged();
  }

  /**
   * Checked on boot after a session restores, not just right after signing
   * in — an account created before names existed, or one that closed the tab
   * mid-gate, is signed in but still unnamed the next time it loads.
   */
  async checkNameGate() {
    if (!isSignedIn()) return;
    const named = await getMyName({ useCache: false });
    if (named === null) this._openNameGate();
  }

  _openNameGate() {
    this.el.nameModal.hidden = false;
    this._setNameError(null);
    this.el.nameInput.value = '';
    this.el.nameInput.focus();
  }

  _setNameError(msg) {
    if (msg === null || msg === undefined) {
      this.el.nameError.hidden = true;
      this.el.nameError.textContent = '';
      return;
    }
    this.el.nameError.hidden = false;
    this.el.nameError.textContent = msg;
  }

  async _submitName() {
    if (this.busy) return;
    this.busy = true;
    this.el.nameSubmit.disabled = true;
    this._setNameError(null);

    const res = await claimName(this.el.nameInput.value);

    this.busy = false;
    this.el.nameSubmit.disabled = false;

    if (!res.ok) { this._setNameError(res.error); return; }

    this.el.nameModal.hidden = true;
    this.renderChip();
    this.onProfileChanged();
  }

  /** After a signup that needs email confirmation, flip to sign-in but keep
   *  the message on screen so the player knows what to do next. */
  setModeAfterConfirm() {
    this.mode = 'signin';
    this.el.title.textContent = 'Sign in';
    this.el.submit.textContent = 'Sign in';
    this.el.switchText.textContent = 'No account yet?';
    this.el.switch.textContent = 'Create one';
  }

  async _signOut() {
    // Push whatever is pending before dropping the session, or the last few
    // seconds of play would be stranded locally.
    queuePush(this.getProfile(), { immediate: true });
    await signOut();
    // Drop the cached display name too. It is keyed by user id so it could not
    // show the wrong tag, but leaving another account's name in storage after
    // an explicit sign-out is not something to do on a shared machine.
    forgetCachedName();
    this.renderChip();
    this.onProfileChanged();
  }
}

function relativeTime(ts) {
  const secs = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (secs < 5) return 'just now';
  if (secs < 60) return secs + 's ago';
  const mins = Math.round(secs / 60);
  if (mins < 60) return mins + 'm ago';
  return Math.round(mins / 60) + 'h ago';
}
