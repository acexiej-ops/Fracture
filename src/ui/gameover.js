/**
 * gameover.js — the run summary.
 *
 * Shows the two numbers the player actually cares about (time survived, wave
 * reached) plus a few supporting stats, and gets them back into a new run in
 * one keystroke. Restart friction is the enemy of a roguelite.
 */

import { formatTime } from '../core/math.js';
import { MATERIALS } from '../meta/materials.js';
import { materialIcon, gearIcon } from './icons.js';
import { t } from '../i18n/i18n.js';

const TIER_COLOR = { common: '#9fb3c8', rare: '#ffb703', exotic: '#ff5ec4' };
const TIER_KEYS = { common: 'run.chest.common', rare: 'run.chest.rare', exotic: 'run.chest.exotic' };

const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export class GameOverScreen {
  /**
   * @param {{ onOpenChest: (state) => { tier, materials, currency, gear } }} handlers
   *   `onOpenChest` rolls the reward AND banks it into the profile — this
   *   screen only ever asks for it once, on click, and displays whatever
   *   comes back. It never touches the profile directly, same separation
   *   `HubScreen`'s callbacks keep.
   */
  constructor(root, { onOpenChest } = {}) {
    this.root = root;
    this.el = {
      time: root.querySelector('[data-over="time"]'),
      wave: root.querySelector('[data-over="wave"]'),
      kills: root.querySelector('[data-over="kills"]'),
      level: root.querySelector('[data-over="level"]'),
      damage: root.querySelector('[data-over="damage"]'),
      best: root.querySelector('[data-over="best"]'),
      button: root.querySelector('[data-over="restart"]'),
      hub: root.querySelector('[data-over="hub"]'),
      haul: root.querySelector('[data-over="haul"]'),
      chestBox: root.querySelector('[data-over="chest-box"]'),
      chestGlow: root.querySelector('[data-over="chest-glow"]'),
      chestOpenBtn: root.querySelector('[data-over="chest-open"]'),
      chestContents: root.querySelector('[data-over="chest-contents"]'),
    };
    this.visible = false;
    this.onRestart = null;
    this.onHub = null;
    this.onOpenChest = onOpenChest ?? null;
    this.chestOpened = false;

    this.el.button.addEventListener('click', () => this._restart());
    this.el.hub.addEventListener('click', () => this._toHub());
    this.el.chestOpenBtn.addEventListener('click', () => this._openChest());
  }

  show(state, best) {
    this.visible = true;
    this._renderHaul(state);
    this._resetChest(state);

    this.el.time.textContent = formatTime(state.time);
    this.el.wave.textContent = String(state.wave);
    this.el.kills.textContent = String(state.kills);
    this.el.level.textContent = String(state.level);
    this.el.damage.textContent = String(Math.round(state.damageDealt));

    const isBest = state.time >= best - 0.001;
    this.el.best.textContent = isBest
      ? t('run.newBest')
      : t('run.best', { time: formatTime(best) });
    this.el.best.classList.toggle('is-best', isBest);

    this.root.classList.add('visible');
    // Focus the button so Enter/Space restarts without reaching for the mouse.
    this.el.button.focus();
  }

  hide() {
    this.visible = false;
    this.root.classList.remove('visible');
  }

  handleInput(input) {
    if (!this.visible) return;
    if (input.wasPressed('KeyR')) this._restart();
    if (input.wasPressed('KeyH')) this._toHub();
  }

  /** What the run actually earned — the reason to look at this screen at all. */
  _renderHaul(state) {
    const bag = state.runMaterials;
    const ids = Object.keys(bag).filter((id) => bag[id] > 0);

    if (ids.length === 0) {
      this.el.haul.innerHTML = '<p class="haul-empty">' + t('run.noMaterials') + '</p>';
      return;
    }

    const chips = ids.map((id) => {
      const m = MATERIALS[id];
      return '<span class="haul-mat">' + materialIcon(id, 16)
        + bag[id] + ' ' + m.name + '</span>';
    }).join('');

    const nodes = state.nodesHarvested > 0
      ? '<span class="haul-nodes">' + state.nodesHarvested + ' node'
        + (state.nodesHarvested === 1 ? '' : 's') + ' cracked</span>'
      : '';

    this.el.haul.innerHTML = '<h3>' + t('run.recovered') + '</h3><div class="haul-row">'
      + chips + nodes + '</div>';
  }

  /**
   * A performance chest, offered once per run and deliberately opened rather
   * than auto-collected — the one moment in the whole game with no combat
   * pressure behind it, so it's the one place a manual click earns its keep
   * instead of just adding friction. Its rarity stays a mystery (a neutral
   * glow, not a rarity colour) until the player actually opens it — knowing
   * the tier in advance would turn the reveal into a formality.
   */
  _resetChest(state) {
    this.chestOpened = false;
    this._pendingState = state;
    this.el.chestBox.classList.remove('opened');
    this.el.chestGlow.style.setProperty('--tc', '#8fa4bd');
    this.el.chestOpenBtn.disabled = false;
    this.el.chestOpenBtn.textContent = t('run.openChest');
    this.el.chestContents.innerHTML = '';
    this.el.chestContents.classList.remove('show');
  }

  _openChest() {
    if (this.chestOpened || this.onOpenChest === null) return;
    this.chestOpened = true;
    this.el.chestOpenBtn.disabled = true;

    const result = this.onOpenChest(this._pendingState);
    const color = TIER_COLOR[result.tier] ?? TIER_COLOR.common;

    this.el.chestGlow.style.setProperty('--tc', color);
    this.el.chestBox.classList.add('opened');
    this.el.chestOpenBtn.textContent = t(TIER_KEYS[result.tier] ?? 'run.chest.common');

    const lines = [];
    if (result.gear !== null) {
      lines.push('<span class="chest-gear" style="--tc:' + color + '">' + gearIcon(result.gear, 22)
        + esc(result.gear.rarity) + ' — ' + esc(result.gear.name) + '</span>');
    }
    const matBits = Object.entries(result.materials)
      .map(([id, n]) => '<span class="chest-mat">' + materialIcon(id, 14) + '+' + n + ' '
        + esc(MATERIALS[id]?.name ?? id) + '</span>');
    if (matBits.length > 0) lines.push('<span>' + matBits.join('  ') + '</span>');
    if (result.currency > 0) lines.push('<span>+' + result.currency + ' ' + t('run.scrip') + '</span>');

    this.el.chestContents.innerHTML = lines.join('');
    // Reflow before adding the class, so the reveal's CSS transition restarts
    // even if a chest was already opened once this session (it can't be, since
    // `chestOpened` guards re-entry, but the pattern matches the wave banner's
    // reflow trick for consistency).
    void this.el.chestContents.offsetWidth;
    this.el.chestContents.classList.add('show');
  }

  _toHub() {
    if (!this.visible) return;
    this.hide();
    if (this.onHub !== null) this.onHub();
  }

  _restart() {
    if (!this.visible) return;
    this.hide();
    if (this.onRestart !== null) this.onRestart();
  }
}
