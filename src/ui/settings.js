/**
 * settings.js — the settings panel: audio, graphics quality, and language.
 *
 * A small floating control, independent of run phase, reachable from both the
 * Hub and an in-progress run: audio is the one setting that shouldn't require
 * leaving what you're doing to change. It talks directly to the `sfx` singleton
 * rather than through main.js, since there's no game-state reason for anything
 * else to know it exists.
 */

import { QUALITY, QUALITY_ORDER, getSettings, setSetting } from '../meta/settings.js';
import { LANGUAGES, getLanguage, setLanguage, t, onLanguageChange } from '../i18n/i18n.js';
import { KeybindUI } from './keybindSettings.js';
import { applyBindings } from '../core/input.js';

export class SettingsPanel {
  constructor(root, sfx) {
    this.root = root;
    this.sfx = sfx;
    this.button = document.getElementById('settings-btn');
    this.visible = false;

    this.el = {
      mute: root.querySelector('[data-set="mute"]'),
      volume: root.querySelector('[data-set="volume"]'),
      volumeLabel: root.querySelector('[data-set="volume-label"]'),
      close: root.querySelector('[data-set="close"]'),
      quality: root.querySelector('[data-set="quality"]'),
      reduceShake: root.querySelector('[data-set="reduce-shake"]'),
      showFps: root.querySelector('[data-set="show-fps"]'),
      language: root.querySelector('[data-set="language"]'),
      keybinds: root.querySelector('[data-set="keybinds"]'),
    };

    // The "Configure" button existed with no click handler at all before
    // this — clicking it did nothing, because nothing was ever wired to it.
    this.keybindUI = new KeybindUI();
    this.keybindUI.onUpdate = (bindings) => applyBindings(bindings);
    this.el.keybinds?.addEventListener('click', () => this.keybindUI.open(root.id));

    // Reflect whatever was loaded from storage before any interaction.
    this.el.mute.checked = sfx.muted;
    this.el.volume.value = String(Math.round(sfx.volume * 100));
    this._updateLabel();

    this._buildQuality();
    this._buildLanguages();
    this._syncToggles();
    this.applyLanguage();

    // Re-label everything when the language changes from anywhere, including
    // this panel itself.
    onLanguageChange(() => this.applyLanguage());

    this.el.quality.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-quality]');
      if (btn === null) return;
      setSetting('quality', btn.dataset.quality);
      this._buildQuality();
    });

    this.el.reduceShake.addEventListener('change', () => {
      setSetting('reduceShake', this.el.reduceShake.checked);
    });

    this.el.showFps.addEventListener('change', () => {
      setSetting('showFps', this.el.showFps.checked);
    });

    this.el.language.addEventListener('change', () => {
      setLanguage(this.el.language.value);
    });

    this.button.addEventListener('click', () => this.toggle());
    this.el.close.addEventListener('click', () => this.hide());

    this.el.mute.addEventListener('change', () => {
      this.sfx.setMuted(this.el.mute.checked);
    });

    this.el.volume.addEventListener('input', () => {
      this.sfx.setVolume(Number(this.el.volume.value) / 100);
      this._updateLabel();
    });

    // Click-outside-to-close. Checked against both the panel and the toggle
    // button so clicking the button to close doesn't also immediately reopen it.
    this._onOutsideClick = (e) => {
      if (!this.visible) return;
      if (this.root.contains(e.target) || this.button.contains(e.target)) return;
      this.hide();
    };
    document.addEventListener('pointerdown', this._onOutsideClick);
  }

  _buildQuality() {
    const active = getSettings().quality;
    this.el.quality.innerHTML = QUALITY_ORDER.map((id) => {
      const on = id === active;
      return '<button type="button" class="seg-btn' + (on ? ' on' : '') + '"'
        + ' data-quality="' + id + '"' + (on ? ' aria-pressed="true"' : '')
        + '>' + t('settings.quality.' + id) + '</button>';
    }).join('');
  }

  _buildLanguages() {
    const active = getLanguage();
    // Native name only. Someone looking for their own language scans for the
    // word they actually use, not the English exonym for it.
    this.el.language.innerHTML = LANGUAGES.map((l) =>
      '<option value="' + l.id + '"' + (l.id === active ? ' selected' : '') + '>'
      + l.native + '</option>').join('');
  }

  _syncToggles() {
    const st = getSettings();
    this.el.reduceShake.checked = st.reduceShake;
    this.el.showFps.checked = st.showFps;
  }

  /** Re-label every [data-i18n] node in the panel. */
  applyLanguage() {
    for (const node of this.root.querySelectorAll('[data-i18n]')) {
      node.textContent = t(node.dataset.i18n);
    }
    const title = this.root.querySelector('.settings-head h2');
    if (title !== null) title.textContent = t('settings.title');
    this._buildQuality();
  }

  _updateLabel() {
    this.el.volumeLabel.textContent = this.el.volume.value + '%';
  }

  toggle() {
    if (this.visible) this.hide(); else this.show();
  }

  show() {
    this.visible = true;
    this.root.classList.add('visible');
  }

  hide() {
    this.visible = false;
    this.root.classList.remove('visible');
  }
}
