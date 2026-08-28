/**
 * weaponGen.js — turns (base type + 1-2 modifiers) into a real weapon.
 *
 * This is the piece that makes the roster scale. Adding one base type adds
 * ~20 new weapons; adding one modifier adds ~21. Nothing has to be
 * hand-authored per combination, and — the property that actually matters —
 * nothing has to be hand-*balanced* per combination either, because a
 * modifier's stat adjustments are relative and its hooks are proportional to
 * the damage they observe.
 *
 * A generated weapon is the same shape the engine already consumed before
 * this file existed: `{ id, name, blurb, color, target, base, fire, tick }`.
 * That is deliberate — `addWeapon`, the Stats stack, the upgrade tree and
 * every saved gear item that names a weapon all keep working with no changes.
 *
 * Generated ids are stable and deterministic: `<base>+<mod>` / `<base>+<modA>+<modB>`,
 * sorted, so the same combination always produces the same id across sessions.
 * That matters because a saved profile can reference a generated weapon.
 */

import { WEAPON_BASES, BASE_IDS } from './weaponBases.js';
import { WEAPON_MODS, modsFor, isValidCombo } from './weaponMods.js';
import { WEAPONS } from './weaponDefs.js';
import { projectileSprite } from '../render/spriteDefs.js';
import { mix } from '../render/pixel.js';

/** Registry of every generated weapon def, by generated id. */
export const GENERATED = {};

/** Build the canonical id for a base + modifier list. */
export function weaponId(baseId, modIds) {
  return modIds.length === 0 ? baseId : baseId + '+' + [...modIds].sort().join('+');
}

/**
 * Fold a modifier's stat adjustments into a base's numbers.
 *
 * `flat` adds, `mult` multiplies. Applied at build time into the def's `base`
 * block rather than at runtime, so a generated weapon costs exactly what a
 * hand-written one costs to run — the generation is a build step, not a layer
 * the hot loop pays for every frame.
 */
function applyStatMods(baseStats, mods) {
  const out = { ...baseStats };
  for (const mod of mods) {
    if (mod.stats === undefined) continue;
    for (const [stat, adj] of Object.entries(mod.stats)) {
      // Only touch stats the base actually has: `arc` on a bolt weapon is
      // meaningless, and inventing it would silently create a stat the base's
      // fire() never reads.
      if (out[stat] === undefined) continue;
      if (adj.flat !== undefined) out[stat] += adj.flat;
      if (adj.mult !== undefined) out[stat] *= adj.mult;
    }
  }
  return out;
}

/**
 * Name a generated weapon.
 *
 * One prefix reads naturally ("Rimed Railpike"). Two prefixes stack in a
 * fixed order rather than a random one, so the same combination always
 * produces the same name — a weapon whose name changed between runs would
 * read as a different weapon.
 */
function buildName(base, mods) {
  if (mods.length === 0) return base.name;
  const prefixes = mods.map((m) => m.prefix).join(' ');
  return prefixes + ' ' + base.name;
}

function buildBlurb(base, mods) {
  if (mods.length === 0) return base.blurb;
  return base.blurb + ' ' + mods.map((m) => m.blurb).join(' ');
}

/** Tint the base's colour toward its modifiers' elements, if any carry one. */
function buildColor(base, mods) {
  let color = base.color;
  for (const mod of mods) {
    if (mod.element !== undefined) color = mix(color, mod.element, 0.45);
  }
  return color;
}

/**
 * Compose the fire hook: run the base's own fire, then every modifier's
 * `onFire`.
 *
 * `baseFire` is stashed on the def because the Echoing modifier re-enters it
 * directly — it must repeat the *base* behaviour, not the composed one, or an
 * Echo would trigger its own onFire hooks and could recurse.
 */
function composeFire(base, mods) {
  const baseFire = base.fire;
  if (baseFire === undefined) return undefined;

  const onFireHooks = mods.filter((m) => m.onFire !== undefined);
  const projectileKind = mods.find((m) => m.projectileKind !== undefined)?.projectileKind;

  return function fire(state, weapon, target) {
    const before = projectileKind !== undefined ? state.projectiles.length : 0;

    baseFire(state, weapon, target);

    // Seeking retags whatever the base just fired, rather than every base
    // needing to know homing exists. Only projectiles created by *this* call
    // are touched, which is why the length is sampled first.
    //
    // The retag must also install the fields the seeker steering actually
    // reads — `target`, `turnRate` and `speed`. A bolt has none of them, and
    // `steerSeeker` dereferences `pr.target.alive` after only checking for
    // `null`, so an un-initialised retag crashed on the first steered frame.
    if (projectileKind !== undefined) {
      for (let i = before; i < state.projectiles.length; i++) {
        const pr = state.projectiles[i];
        if (pr.kind !== 'bolt' && pr.kind !== 'pellet') continue;
        pr.kind = projectileKind;
        pr.target = null;
        pr.turnRate = pr.turnRate ?? 5.5;
        pr.speed = pr.speed ?? Math.hypot(pr.vx, pr.vy);
      }
    }

    for (const mod of onFireHooks) mod.onFire(state, weapon, target);
  };
}

/**
 * Build a weapon definition from a base id and modifier ids.
 * Returns the def, or null if the combination is invalid.
 */
export function buildWeapon(baseId, modIds = []) {
  const base = WEAPON_BASES[baseId];
  if (base === undefined) return null;

  const valid = modIds.filter((m) => WEAPON_MODS[m] !== undefined && isValidCombo(baseId, m));
  const mods = valid.map((m) => WEAPON_MODS[m]);

  const id = weaponId(baseId, valid);
  if (GENERATED[id] !== undefined) return GENERATED[id];

  const color = buildColor(base, mods);
  const def = {
    id,
    baseId,
    mods: valid,
    name: buildName(base, mods),
    blurb: buildBlurb(base, mods),
    archetype: base.archetype,
    color,
    target: base.target,
    base: applyStatMods(base.base, mods),
    // Every weapon owns a projectile sprite minted from its own colour and
    // its base's projectile silhouette — so a generated weapon has real art
    // rather than a shared placeholder, and two weapons that differ only by
    // modifier are still visually distinguishable in flight.
    sprite: projectileSprite(color, base.projKind === 'ring' ? 'lg' : 'md', base.projKind ?? 'bolt'),
    baseFire: base.fire,
    fire: composeFire(base, mods),
    tick: base.tick,
    init: base.init,
    // Hooks the engine calls. Pre-filtered at build time so the hot path
    // never re-scans the modifier list.
    onHit: mods.filter((m) => m.onHit !== undefined),
    onKill: mods.filter((m) => m.onKill !== undefined),
    playerStats: mods.filter((m) => m.playerStats !== undefined),
  };

  GENERATED[id] = def;
  // Registered into the same WEAPONS map `addWeapon` already reads, so a
  // generated weapon is grantable by exactly the same call as a built-in one.
  WEAPONS[id] = def;
  return def;
}

/**
 * How many distinct weapons this system can currently produce.
 * Reported rather than enumerated: building all of them up front would mint
 * thousands of sprite definitions for weapons a run will never see.
 */
export function rosterSize() {
  let total = 0;
  for (const baseId of BASE_IDS) {
    const mods = modsFor(baseId);
    const n = mods.length;
    total += 1;                    // the bare base
    total += n;                    // one modifier
    total += (n * (n - 1)) / 2;    // two modifiers, unordered
  }
  return total;
}

/** Enumerate every valid combination, as ids. Used by tests and the codex. */
export function enumerateRoster({ maxMods = 2 } = {}) {
  const out = [];
  for (const baseId of BASE_IDS) {
    out.push(weaponId(baseId, []));
    const mods = modsFor(baseId);
    if (maxMods >= 1) {
      for (const m of mods) out.push(weaponId(baseId, [m]));
    }
    if (maxMods >= 2) {
      for (let i = 0; i < mods.length; i++) {
        for (let j = i + 1; j < mods.length; j++) {
          out.push(weaponId(baseId, [mods[i], mods[j]]));
        }
      }
    }
  }
  return out;
}

/** Roll a random valid weapon. `rng` is passed in to stay seed-deterministic. */
export function randomWeapon(rng, { minMods = 0, maxMods = 2, baseId = null } = {}) {
  const chosenBase = baseId ?? rng.pick(BASE_IDS);
  const pool = modsFor(chosenBase);
  const count = Math.min(pool.length, rng.int(minMods, maxMods));

  const picked = [];
  const available = [...pool];
  for (let i = 0; i < count && available.length > 0; i++) {
    const idx = rng.int(0, available.length - 1);
    picked.push(available[idx]);
    available.splice(idx, 1);
  }
  return buildWeapon(chosenBase, picked);
}

/**
 * Register the bare (modifier-free) form of every base type.
 *
 * Called once at boot so the upgrade tree and the recipe list have a stable,
 * always-present set to draw from; modified variants are minted lazily when
 * something actually rolls one.
 */
let registeredBases = false;
export function registerBaseWeapons() {
  if (registeredBases) return;
  registeredBases = true;
  for (const baseId of BASE_IDS) buildWeapon(baseId, []);
}
