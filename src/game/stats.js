/**
 * stats.js — derived stats from a stack of modifiers.
 *
 * This is the seam the whole progression system hangs off. Nothing mutates a
 * stat directly; instead it registers a *modifier* tagged with a source. A
 * level-up upgrade and (later) a crafted item affix are the same thing to this
 * system — which is why gear can be equipped and unequipped without any of the
 * combat code knowing that gear exists.
 *
 *   value = (base + sum(flat)) * (1 + sum(inc)) * product(mult)
 *
 * - `flat` : absolute addition        (+20 max HP)
 * - `inc`  : additive percentages     (+15% damage, three of them = +45%)
 * - `mult` : multiplicative           (x1.5 damage, stacks compoundingly)
 *
 * Additive percentages are the workhorse: they stack predictably and don't
 * explode when a player finds six of them.
 */

export class Stats {
  constructor(base) {
    this.base = { ...base };
    this.modifiers = [];
    this.values = { ...base };
    this._dirty = true;
    this.recompute();
  }

  /**
   * @param {object} mod  { stat, type: 'flat'|'inc'|'mult', value, source }
   */
  add(mod) {
    this.modifiers.push(mod);
    this._dirty = true;
  }

  addAll(mods) {
    for (const m of mods) this.modifiers.push(m);
    this._dirty = true;
  }

  /** Remove every modifier contributed by a source (e.g. unequipping an item). */
  removeSource(source) {
    const before = this.modifiers.length;
    this.modifiers = this.modifiers.filter((m) => m.source !== source);
    if (this.modifiers.length !== before) this._dirty = true;
  }

  /** How many modifiers a given source has contributed. Used for upgrade caps. */
  countSource(source) {
    let n = 0;
    for (const m of this.modifiers) if (m.source === source) n++;
    return n;
  }

  recompute() {
    if (!this._dirty) return this.values;

    const flat = {}, inc = {}, mult = {};
    for (const m of this.modifiers) {
      const bucket = m.type === 'flat' ? flat : m.type === 'inc' ? inc : mult;
      if (m.type === 'mult') bucket[m.stat] = (bucket[m.stat] ?? 1) * m.value;
      else bucket[m.stat] = (bucket[m.stat] ?? 0) + m.value;
    }

    for (const key in this.base) {
      const v = (this.base[key] + (flat[key] ?? 0)) * (1 + (inc[key] ?? 0)) * (mult[key] ?? 1);
      this.values[key] = v;
    }

    // Deliberately no game-specific clamping here. Phase 1 floored
    // `projectileCount` at 1, which was right when this block *was* the weapon;
    // now that it's a global bonus added on top of each weapon's own count, a
    // floor of 1 would hand every weapon a free extra projectile at base.
    // Rounding to whole numbers is the caller's job — see `wstat`.

    this._dirty = false;
    return this.values;
  }

  get(name) {
    if (this._dirty) this.recompute();
    return this.values[name];
  }

  /** Snapshot for the HUD / debug panel. */
  snapshot() {
    if (this._dirty) this.recompute();
    return { ...this.values };
  }
}
