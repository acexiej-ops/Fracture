/**
 * inventory.js — what the player is carrying, and the animation state of it.
 *
 * Holds weapons and passives with independent levels (1-8), owns the four
 * methods the game loop calls each frame, and is the single place that knows
 * how a held item turns into a live engine weapon.
 *
 * METHOD NAMES: the four required entry points are exposed under the exact
 * snake_case names specified — `upgrade_item`, `check_evolutions`,
 * `update_animations`, `draw_pixel_sprites`. The rest of this codebase is
 * camelCase, so each also has a camelCase alias pointing at the same function;
 * use whichever reads better at the call site, they are not two code paths.
 */

import { MAX_LEVEL, PASSIVES, passiveModifiers } from './passives.js';
import { WEAPON_BY_ID, resolveWeapon, registerArsenalArt } from './arsenal.js';
import { availableEvolutions, openEvolutionChest, evolutionHints } from './evolutions.js';
import { frameCount } from './pixelArt/weaponArt.js';
import { drawSprite } from '../render/pixel.js';

/** Animation states an item can be in. */
export const ANIM = {
  IDLE: 'IDLE',
  ATTACKING: 'ATTACKING',
};

/** How many sprite frames per second each state plays at. */
const FPS = { [ANIM.IDLE]: 5, [ANIM.ATTACKING]: 14 };

/** How long an ATTACKING state holds before falling back to IDLE. */
const ATTACK_HOLD = 0.22;

export const MAX_WEAPONS = 6;
export const MAX_PASSIVES = 6;

/**
 * One carried weapon. Owns its own animation clock, because two copies of the
 * same weapon at different levels should still be able to animate out of phase
 * — a shared clock would make every Fire Wand on screen flicker in lockstep,
 * which is exactly the "this is a texture, not a thing" look to avoid.
 */
class CarriedWeapon {
  constructor(id, level) {
    const entry = WEAPON_BY_ID.get(id);
    this.id = id;
    this.name = entry?.name ?? id;
    this.category = entry?.category ?? '';
    this.art = entry?.art ?? id;
    this.level = level;

    // --- Animation & pixel engine state -----------------------------------
    this.current_frame = 0;
    this.frame_timer = 0;
    this.animation_state = ANIM.IDLE;
    this.rotation_angle = 0;      // radians; spun by update_animations
    this.spin_rate = 0;           // radians/sec, set from the weapon's category
    this.flash = 0;               // 0-1, drives the white crit/impact flash
    this._attackHold = 0;
    this._iconFrames = Math.max(1, frameCount(this.art, 'icon'));
    this._projFrames = Math.max(1, frameCount(this.art, 'proj'));

    // Spinners spin. Boomerangs and coins tumble fastest, orbitals turn
    // steadily, everything else holds still and animates by frame only.
    if (id === 'cross_boomerang' || id === 'coin_gun' || id === 'bone_tosser') this.spin_rate = 9;
    else if (this.category.startsWith('Orbital')) this.spin_rate = 2.4;
    else if (id === 'chrono_pocket') this.spin_rate = 1.2;

    this.def = resolveWeapon(id, level);
  }

  /** Re-resolve the engine definition after a level change. */
  refresh() {
    this.def = resolveWeapon(this.id, this.level);
  }

  /** Called by the game when this weapon actually fires. */
  onFired() {
    this.animation_state = ANIM.ATTACKING;
    this._attackHold = ATTACK_HOLD;
    this.flash = 1;
  }
}

class CarriedPassive {
  constructor(id, level) {
    const entry = PASSIVES[id];
    this.id = id;
    this.name = entry?.name ?? id;
    this.color = entry?.color ?? '#ffffff';
    this.level = level;
    this.current_frame = 0;
    this.frame_timer = 0;
    this.animation_state = ANIM.IDLE;
    this.rotation_angle = 0;
  }
}

export class Inventory {
  constructor() {
    registerArsenalArt();
    this.weapons = new Map();    // id -> CarriedWeapon
    this.passives = new Map();   // id -> CarriedPassive
    /** Set by performEvolution so the UI can play a reveal. Read once, cleared. */
    this.pendingEvolutionReveal = null;
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  getLevel(id) {
    return this.weapons.get(id)?.level ?? this.passives.get(id)?.level ?? 0;
  }

  has(id) { return this.getLevel(id) > 0; }
  weaponIds() { return [...this.weapons.keys()]; }
  passiveIds() { return [...this.passives.keys()]; }
  isMaxed(id) { return this.getLevel(id) >= MAX_LEVEL; }

  weaponsFull() { return this.weapons.size >= MAX_WEAPONS; }
  passivesFull() { return this.passives.size >= MAX_PASSIVES; }

  /** Live engine definitions for every held weapon, for the combat loop. */
  activeWeaponDefs() {
    return [...this.weapons.values()].map((w) => w.def).filter((d) => d !== null);
  }

  /** Every stat modifier the held passives contribute, ready for the stack. */
  passiveStatModifiers() {
    const out = [];
    for (const p of this.passives.values()) out.push(...passiveModifiers(p.id, p.level));
    return out;
  }

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------

  grantWeapon(id, level = 1) {
    if (this.weapons.has(id)) return this.weapons.get(id);
    if (!WEAPON_BY_ID.has(id)) return null;
    if (this.weaponsFull()) return null;
    const w = new CarriedWeapon(id, Math.min(level, MAX_LEVEL));
    this.weapons.set(id, w);
    return w;
  }

  grantPassive(id, level = 1) {
    if (this.passives.has(id)) return this.passives.get(id);
    if (PASSIVES[id] === undefined) return null;
    if (this.passivesFull()) return null;
    const p = new CarriedPassive(id, Math.min(level, MAX_LEVEL));
    this.passives.set(id, p);
    return p;
  }

  removeWeapon(id) { return this.weapons.delete(id); }

  /**
   * REQUIRED METHOD — increment an item's level.
   *
   * Grants the item if it is not held yet, so one call handles both "pick this
   * up" and "level this up"; a level-up screen offering an item you do not own
   * would otherwise need two code paths for what the player sees as one action.
   *
   * @returns {{ id, level, maxed, granted }|null}
   */
  upgrade_item(name) {
    const weapon = this.weapons.get(name);
    if (weapon !== undefined) {
      if (weapon.level >= MAX_LEVEL) return { id: name, level: weapon.level, maxed: true, granted: false };
      weapon.level++;
      weapon.refresh();     // re-resolve so the new numbers take effect now
      return { id: name, level: weapon.level, maxed: weapon.level >= MAX_LEVEL, granted: false };
    }

    const passive = this.passives.get(name);
    if (passive !== undefined) {
      if (passive.level >= MAX_LEVEL) return { id: name, level: passive.level, maxed: true, granted: false };
      passive.level++;
      return { id: name, level: passive.level, maxed: passive.level >= MAX_LEVEL, granted: false };
    }

    if (WEAPON_BY_ID.has(name)) {
      const w = this.grantWeapon(name, 1);
      return w === null ? null : { id: name, level: 1, maxed: false, granted: true };
    }
    if (PASSIVES[name] !== undefined) {
      const p = this.grantPassive(name, 1);
      return p === null ? null : { id: name, level: 1, maxed: false, granted: true };
    }
    return null;
  }

  /**
   * REQUIRED METHOD — every transformation the current inventory allows.
   *
   * Read-only: returns descriptors, changes nothing. Call it as often as you
   * like from UI code. `evolveViaChest()` is the mutating counterpart.
   */
  check_evolutions() {
    return availableEvolutions(this);
  }

  /** Hints for the UI: what is close, and what is blocking it. */
  evolutionHints() { return evolutionHints(this); }

  /** Open a chest: performs at most one evolution and stashes the reveal. */
  evolveViaChest() {
    const report = openEvolutionChest(this);
    if (report !== null) this.pendingEvolutionReveal = report;
    return report;
  }

  /**
   * REQUIRED METHOD — advance every animation clock.
   *
   * Called once per frame from the game loop with the frame delta in SECONDS.
   * Drives four things per item: sprite frame advance, rotation for spinners,
   * the ATTACKING -> IDLE fallback, and the impact flash decay.
   *
   * Deliberately driven by real delta rather than a fixed tick count, so
   * animation speed does not change with frame rate.
   */
  update_animations(delta_time) {
    for (const w of this.weapons.values()) {
      // ATTACKING is a hold, not a loop: it decays back to IDLE on its own so
      // nothing has to remember to clear it.
      if (w._attackHold > 0) {
        w._attackHold -= delta_time;
        if (w._attackHold <= 0) w.animation_state = ANIM.IDLE;
      }

      const fps = FPS[w.animation_state] ?? FPS[ANIM.IDLE];
      w.frame_timer += delta_time;
      const step = 1 / fps;
      while (w.frame_timer >= step) {
        w.frame_timer -= step;
        w.current_frame++;
      }
      // Kept in range here rather than at every read site.
      const frames = w.animation_state === ANIM.ATTACKING ? w._projFrames : w._iconFrames;
      if (frames > 0) w.current_frame %= frames;

      if (w.spin_rate !== 0) {
        w.rotation_angle = (w.rotation_angle + w.spin_rate * delta_time) % (Math.PI * 2);
      }

      if (w.flash > 0) w.flash = Math.max(0, w.flash - delta_time * 5);
    }

    for (const p of this.passives.values()) {
      p.frame_timer += delta_time;
      if (p.frame_timer >= 0.2) { p.frame_timer -= 0.2; p.current_frame++; }
    }
  }

  /**
   * REQUIRED METHOD — draw the carried weapons' icons.
   *
   * This renders the *inventory* (HUD strip, level-up cards, evolution
   * previews). Projectiles already in flight are drawn by the renderer's own
   * entity pass, because they are world objects with their own positions —
   * having two systems draw the same projectile would double it.
   *
   * @param ctx     a 2D context
   * @param x,y     top-left of the strip
   * @param opts    { size, gap, columns, showLevel }
   */
  draw_pixel_sprites(ctx, x, y, opts = {}) {
    const { size = 34, gap = 6, columns = 6, showLevel = true } = opts;
    const items = [...this.weapons.values(), ...this.passives.values()];

    items.forEach((item, i) => {
      const col = i % columns;
      const row = Math.floor(i / columns);
      const cx = x + col * (size + gap) + size / 2;
      const cy = y + row * (size + gap) + size / 2;

      const key = 'wart:icon:' + (item.art ?? item.id);
      // Spinners are drawn at their live rotation; everything else upright.
      const angle = item.rotation_angle !== 0 ? item.rotation_angle : null;
      // The flash is a cached all-white variant, not a per-draw composite —
      // compositing per sprite per frame is the expensive way to do this.
      const variant = item.flash > 0.5 ? 'flash' : 'base';

      drawSprite(ctx, key, cx, cy, {
        frame: item.current_frame,
        variant, angle,
        scale: size / 30,
      });

      if (showLevel && item.level > 1) {
        ctx.font = '700 10px ui-monospace, monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = item.level >= MAX_LEVEL ? '#ffd166' : '#e8fbff';
        ctx.fillText(String(item.level), cx + size / 2, cy + size / 2);
      }
    });
  }

  // -------------------------------------------------------------------------
  // camelCase aliases, so call sites in the rest of this codebase read
  // consistently with everything around them. Same functions, not copies.
  // -------------------------------------------------------------------------

  upgradeItem(name) { return this.upgrade_item(name); }
  checkEvolutions() { return this.check_evolutions(); }
  updateAnimations(dt) { return this.update_animations(dt); }
  drawPixelSprites(ctx, x, y, opts) { return this.draw_pixel_sprites(ctx, x, y, opts); }

  /** Notify the inventory that a weapon fired, so it can play ATTACKING. */
  notifyFired(weaponId) {
    this.weapons.get(weaponId)?.onFired();
  }

  /** Compact serialisable form, for saving mid-run state. */
  serialize() {
    return {
      weapons: [...this.weapons.values()].map((w) => ({ id: w.id, level: w.level })),
      passives: [...this.passives.values()].map((p) => ({ id: p.id, level: p.level })),
    };
  }

  static deserialize(raw) {
    const inv = new Inventory();
    if (raw === null || typeof raw !== 'object') return inv;
    for (const w of raw.weapons ?? []) {
      if (typeof w?.id === 'string') inv.grantWeapon(w.id, clampLevel(w.level));
    }
    for (const p of raw.passives ?? []) {
      if (typeof p?.id === 'string') inv.grantPassive(p.id, clampLevel(p.level));
    }
    return inv;
  }
}

/** Levels come from storage, so they are re-derived rather than trusted. */
function clampLevel(v) {
  if (!Number.isFinite(v)) return 1;
  return Math.max(1, Math.min(MAX_LEVEL, Math.floor(v)));
}
