/**
 * evolutions.js — the synergy map and the transformation engine.
 *
 * THE RULE
 * --------
 * A weapon evolves when ALL of these hold:
 *   1. the base weapon is at MAX_LEVEL (8),
 *   2. the required passive is owned at level >= 1,
 *   3. a chest is opened (evolution never fires passively — it is a reward
 *      you walk over, so the moment is legible).
 *
 * On evolution the base weapon is REMOVED and the evolved form is granted at
 * level 1. The passive is kept: it paid for the transformation but it is still
 * a stat item, and confiscating it would punish the player for using the
 * system.
 *
 * WHY THE MAP IS DATA
 * -------------------
 * Adding an evolution should be one line here plus one art entry, with no code
 * change anywhere. `EVOLUTION_MAP` is keyed by base weapon id, so the lookup in
 * `check_evolutions` is O(number of weapons held) rather than O(all pairs).
 */

import { MAX_LEVEL, PASSIVES } from './passives.js';
import { WEAPON_BY_ID } from './arsenal.js';

/**
 * base weapon id -> { passive, result, name, blurb }
 *
 * The five specified pairings. Each was chosen so the passive is thematically
 * the *reason* for the transformation, not an arbitrary key: Spinach (raw
 * damage) turns a bolt into a meteor; Spellbinder (duration) turns orbiting
 * blades into a permanent wall; Hollow Heart (health) turns a whip into
 * something that draws blood.
 */
export const EVOLUTION_MAP = {
  fire_wand: {
    passive: 'spinach',
    result: 'hellfire_meteor',
    blurb: 'Raw power turns a spark into a falling mountain.',
  },
  orbiting_blades: {
    passive: 'spellbinder',
    result: 'vortex_shields',
    blurb: 'Bound to last, the blades stop needing to come back around.',
  },
  chain_bolt: {
    passive: 'duplicator',
    result: 'thunder_loop',
    blurb: 'Every branch is struck twice, and the second is not an echo.',
  },
  whip: {
    passive: 'hollow_heart',
    result: 'bloody_tear',
    blurb: 'More to lose sharpens what you swing.',
  },
  garlic_shield: {
    passive: 'pummarola',
    result: 'soul_eater',
    blurb: 'What mends you learns to take it from something else.',
  },
};

/** Reverse lookup: which base produced an evolved form. */
export const EVOLVED_FROM = new Map(
  Object.entries(EVOLUTION_MAP).map(([base, e]) => [e.result, base]),
);

/**
 * Is this specific weapon ready to evolve, given an inventory?
 * Returns the evolution descriptor, or null with the reason it is blocked.
 */
export function evolutionStatus(weaponId, inventory) {
  const evo = EVOLUTION_MAP[weaponId];
  if (evo === undefined) return { ready: false, reason: 'no evolution' };

  const weaponLevel = inventory.getLevel(weaponId);
  if (weaponLevel <= 0) return { ready: false, reason: 'not owned' };

  const passiveLevel = inventory.getLevel(evo.passive);
  const passiveName = PASSIVES[evo.passive]?.name ?? evo.passive;

  if (weaponLevel < MAX_LEVEL) {
    return {
      ready: false,
      reason: 'Level ' + weaponLevel + '/' + MAX_LEVEL,
      needsLevel: true, passiveName, ...evo,
    };
  }
  if (passiveLevel < 1) {
    return {
      ready: false,
      reason: 'Requires ' + passiveName,
      needsPassive: true, passiveName, ...evo,
    };
  }
  return { ready: true, base: weaponId, passiveName, ...evo };
}

/**
 * Every evolution the current inventory could perform right now.
 *
 * This is the read-only query — it changes nothing, so the UI can call it
 * every frame to decorate a weapon slot with "ready to evolve" without any
 * risk of triggering the transformation as a side effect.
 */
export function availableEvolutions(inventory) {
  const out = [];
  for (const weaponId of inventory.weaponIds()) {
    const status = evolutionStatus(weaponId, inventory);
    if (status.ready) out.push(status);
  }
  return out;
}

/**
 * Perform one evolution. This is the mutating call, and it is deliberately
 * separate from the query above so a UI can never evolve something by looking
 * at it.
 *
 * @returns {object|null} a report of what changed, or null if not eligible
 */
export function performEvolution(inventory, weaponId) {
  const status = evolutionStatus(weaponId, inventory);
  if (!status.ready) return null;

  const evolvedDef = WEAPON_BY_ID.get(status.result);
  if (evolvedDef === undefined) return null;

  // Remove the base, grant the evolved form at level 1. The passive stays —
  // it is still a stat item, and taking it back would punish the player for
  // engaging with the system that just rewarded them.
  inventory.removeWeapon(weaponId);
  inventory.grantWeapon(status.result, 1);

  return {
    from: weaponId,
    to: status.result,
    name: evolvedDef.name,
    blurb: status.blurb,
    passiveUsed: status.passive,
    passiveName: status.passiveName,
  };
}

/**
 * The chest hook. Opening a chest performs at most ONE evolution — the first
 * available — so a player holding two ready pairs gets two distinct rewarding
 * moments instead of one confusing double transformation.
 */
export function openEvolutionChest(inventory) {
  const ready = availableEvolutions(inventory);
  if (ready.length === 0) return null;
  return performEvolution(inventory, ready[0].base);
}

/**
 * What the player is closest to evolving, for a UI hint.
 * Sorted by how close: max-level weapons only missing a passive come first.
 */
export function evolutionHints(inventory) {
  const hints = [];
  for (const weaponId of inventory.weaponIds()) {
    const s = evolutionStatus(weaponId, inventory);
    if (s.reason === 'no evolution' || s.reason === 'not owned') continue;
    hints.push({
      weaponId,
      result: s.result,
      ready: s.ready,
      reason: s.reason,
      passiveName: s.passiveName,
      // Ready first, then "just needs the passive", then "still levelling".
      sort: s.ready ? 0 : s.needsPassive ? 1 : 2,
    });
  }
  return hints.sort((a, b) => a.sort - b.sort);
}
