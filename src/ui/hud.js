/**
 * hud.js — the always-on readout: timer, wave, kills, health, XP, stats.
 *
 * Deliberately DOM rather than canvas. Text and bars are what the browser is
 * already good at, it keeps the canvas loop focused on the world, and styling
 * lives in CSS where it's quick to iterate on.
 *
 * Every setter compares against the last written value before touching the DOM:
 * this runs 60 times a second, and layout thrash is the one way a HUD can
 * meaningfully cost frames.
 */

import { formatTime } from '../core/math.js';
import { MATERIALS } from '../meta/materials.js';
import { materialIcon } from './icons.js';
import { t } from '../i18n/i18n.js';

export class Hud {
  constructor(root) {
    this.el = {
      time: root.querySelector('[data-hud="time"]'),
      wave: root.querySelector('[data-hud="wave"]'),
      kills: root.querySelector('[data-hud="kills"]'),
      level: root.querySelector('[data-hud="level"]'),
      hpFill: root.querySelector('[data-hud="hp-fill"]'),
      hpText: root.querySelector('[data-hud="hp-text"]'),
      xpFill: root.querySelector('[data-hud="xp-fill"]'),
      xpText: root.querySelector('[data-hud="xp-text"]'),
      banner: root.querySelector('[data-hud="banner"]'),
      stats: root.querySelector('[data-hud="stats"]'),
      weapons: root.querySelector('[data-hud="weapons"]'),
      runMats: root.querySelector('[data-hud="runmats"]'),
      fps: root.querySelector('[data-hud="fps"]'),
    };

    this._last = {};
    this._bannerTimer = 0;
    this._statsTimer = 0;
  }

  /** Write only when the rendered text actually changes. */
  _set(key, node, value) {
    if (this._last[key] === value) return;
    this._last[key] = value;
    node.textContent = value;
  }

  _setWidth(key, node, fraction) {
    const pct = Math.round(fraction * 1000) / 10;
    if (this._last[key] === pct) return;
    this._last[key] = pct;
    node.style.width = pct + '%';
  }

  update(state, dt, fps) {
    this._set('time', this.el.time, formatTime(state.time));
    this._set('wave', this.el.wave, t('run.wave', { n: state.wave }));
    this._set('kills', this.el.kills, String(state.kills));
    this._set('level', this.el.level, t('run.level', { n: state.level }));

    this._setWidth('hp', this.el.hpFill, state.hpFraction);
    this._set('hpText', this.el.hpText,
      Math.ceil(state.player.hp) + ' / ' + Math.round(state.maxHp));

    this._setWidth('xp', this.el.xpFill, state.xpFraction);
    this._set('xpText', this.el.xpText,
      Math.floor(state.xp) + ' / ' + state.xpToNext);

    // Turn the health bar red as it empties — peripheral-vision warning.
    const critical = state.hpFraction < 0.3;
    if (this._last.critical !== critical) {
      this._last.critical = critical;
      this.el.hpFill.classList.toggle('critical', critical);
    }

    if (this._bannerTimer > 0) {
      this._bannerTimer -= dt;
      if (this._bannerTimer <= 0) this.el.banner.classList.remove('show');
    }

    // The stat panel changes only on level-up, so a quarter-second refresh is
    // plenty and keeps ten more DOM writes out of every frame.
    this._statsTimer -= dt;
    if (this._statsTimer <= 0) {
      this._statsTimer = 0.25;
      this._updateStats(state);
      if (this.el.fps !== null) {
        this._set('fps', this.el.fps, Math.round(fps) + ' fps');
      }
    }
  }

  _updateStats(state) {
    const s = state.stats;

    // These are global multipliers now, so they're shown as percentages —
    // "+45%" is what the player can reason about, 1.45 isn't.
    const pct = (v) => (v >= 1 ? '+' : '') + Math.round((v - 1) * 100) + '%';

    const rows = [
      [t('run.stat.dmg'), pct(s.get('damage'))],
      [t('run.stat.haste'), pct(s.get('attackSpeed'))],
      [t('run.stat.area'), pct(s.get('area'))],
      [t('run.stat.crit'), Math.round(s.get('critChance') * 100) + '% / x' + s.get('critMult').toFixed(1)],
      [t('run.stat.speed'), Math.round(s.get('moveSpeed'))],
    ];
    const extraShots = s.get('projectileCount');
    if (extraShots > 0) rows.push([t('run.stat.shots'), '+' + Math.round(extraShots)]);
    const pierce = s.get('pierce');
    if (pierce > 0) rows.push([t('run.stat.pierce'), '+' + Math.round(pierce)]);
    const regen = s.get('regen');
    if (regen > 0) rows.push([t('run.stat.regen'), regen.toFixed(1) + '/s']);

    const html = rows
      .map(([k, v]) => '<span class="stat"><em>' + k + '</em>' + v + '</span>')
      .join('');

    if (this._last.stats !== html) {
      this._last.stats = html;
      this.el.stats.innerHTML = html;
    }

    this._updateWeapons(state);
    this._updateRunMaterials(state);
  }

  /** Materials banked so far this run — the reason to risk a node detour. */
  _updateRunMaterials(state) {
    const bag = state.runMaterials;
    const ids = Object.keys(bag).filter((id) => bag[id] > 0);
    const html = ids.map((id) => {
      const m = MATERIALS[id];
      return '<span class="rm">' + materialIcon(id, 14)
        + '<b>' + bag[id] + '</b>' + m.name + '</span>';
    }).join('');

    if (this._last.runMats !== html) {
      this._last.runMats = html;
      this.el.runMats.innerHTML = html;
    }
  }

  /** The arsenal strip: what you own, and how deeply you've invested in it. */
  _updateWeapons(state) {
    const html = state.weapons.map((w) => {
      const pips = w.rank > 1 ? ' <b>' + (w.rank - 1) + '</b>' : '';
      return '<span class="wpn" style="--wc:' + w.def.color + '">'
        + w.name + pips + '</span>';
    }).join('');

    if (this._last.weapons !== html) {
      this._last.weapons = html;
      this.el.weapons.innerHTML = html;
    }
  }

  announceWave(wave) {
    this._announce(t('run.wave', { n: wave }), 1.8);
  }

  /** A boss arriving or falling — longer on screen than a wave banner, since
   *  there's more text to read and the moment deserves the extra beat. */
  announceBoss(text, urgent = false) {
    this._announce(text, 2.6, urgent);
  }

  _announce(text, duration, urgent = false) {
    this.el.banner.textContent = text;
    this.el.banner.classList.toggle('boss', urgent);
    this.el.banner.classList.remove('show');
    // Force a reflow so re-adding the class restarts the CSS animation.
    void this.el.banner.offsetWidth;
    this.el.banner.classList.add('show');
    this._bannerTimer = duration;
  }
}
