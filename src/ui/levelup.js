/**
 * levelup.js — the "pick 1 of 3" overlay.
 *
 * Simulation is frozen while this is open (the loop skips its update when the
 * phase is LEVEL_UP), so the player can read the cards with a hundred enemies
 * bearing down on them. Mouse and number keys both work; 1/2/3 is what people
 * reach for once they know the game.
 */

import { t } from '../i18n/i18n.js';
import { weaponPixelIcon } from './icons.js';

export class LevelUpScreen {
  constructor(root) {
    this.root = root;
    this.cardsEl = root.querySelector('[data-lvl="cards"]');
    this.levelEl = root.querySelector('[data-lvl="level"]');
    this.queueEl = root.querySelector('[data-lvl="queue"]');
    this.onPick = null;
    this.choices = [];
    this.visible = false;

    // One delegated listener rather than rebinding three per level-up.
    this.cardsEl.addEventListener('click', (e) => {
      const card = e.target.closest('.card');
      if (card === null) return;
      this._pick(Number(card.dataset.index));
    });
  }

  show(state, choices, onPick) {
    this.choices = choices;
    this.onPick = onPick;
    this.visible = true;

    this.levelEl.textContent = t('run.level', { n: state.level });

    // Tell the player when more level-ups are already banked, so a rapid
    // double-level doesn't feel like the screen glitched.
    const queued = state.pendingLevelUps - 1;
    this.queueEl.textContent = queued > 0 ? t('run.pending', { n: queued }) : '';

    this.cardsEl.innerHTML = choices.map((u, i) => {
      const taken = state.takenUpgrades.get(u.id) ?? 0;

      // A repeat pick shows its stack count; a capped one says so, because
      // "this is the last one" changes whether it's worth taking now.
      let stacks = '';
      if (taken > 0) {
        stacks = u.maxStacks !== undefined
          ? '<span class="stacks">' + taken + ' / ' + u.maxStacks + ' ' + t('run.taken') + '</span>'
          : '<span class="stacks">' + taken + ' ' + t('run.taken') + '</span>';
      }

      // The synergy hint is the whole reason the tree exists — it's what tells
      // the player *why* two cards might be worth combining.
      const hint = u.hint !== undefined
        ? '<span class="synergy">' + u.hint + '</span>' : '';

      const badge = u.isWeapon === true
        ? '<span class="badge">' + t('run.newWeapon') + '</span>'
        : '';

      // Every card kind carries `art` now (weapons and passives alike, new
      // or levelling up) — the overflow fallback card is the one legitimate
      // case with nothing to show, hence the guard rather than assuming it.
      const icon = u.art !== undefined ? weaponPixelIcon(u.art, 44) : null;

      const statLine = Array.isArray(u.stats) && u.stats.length > 0
        ? '<div class="card-stats">' + u.stats.map((s) =>
            '<span class="card-stat"><em>' + s.label + '</em>' + s.value + '</span>').join('')
          + '</div>'
        : '';

      return '<button class="card tag-' + u.tag + (u.isWeapon === true ? ' is-weapon' : '')
        + '" data-index="' + i + '">'
        + '<span class="key">' + (i + 1) + '</span>'
        + '<span class="tag">' + u.tag + '</span>'
        + badge
        + (icon !== null ? '<div class="card-icon">' + icon + '</div>' : '')
        + '<h3>' + u.name + '</h3>'
        + '<p>' + u.desc + '</p>'
        + statLine
        + hint
        + stacks
        + '</button>';
    }).join('');

    this.root.classList.add('visible');
  }

  hide() {
    this.visible = false;
    this.root.classList.remove('visible');
  }

  /** Called from the main loop's input pass while this screen is up. */
  handleInput(input) {
    if (!this.visible) return;
    for (let i = 0; i < this.choices.length; i++) {
      if (input.wasPressed('Digit' + (i + 1)) || input.wasPressed('Numpad' + (i + 1))) {
        this._pick(i);
        return;
      }
    }
  }

  _pick(index) {
    if (!this.visible) return;
    const choice = this.choices[index];
    if (choice === undefined) return;
    const cb = this.onPick;
    this.hide();
    if (cb !== null) cb(choice);
  }
}
