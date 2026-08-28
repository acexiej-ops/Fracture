/**
 * loadout.js — the bridge between the meta layer and a run.
 *
 * This is the payoff for building `Stats` as a source-tagged modifier stack back
 * in Phase 1. Equipping gear needs no changes to any combat code: an affix and a
 * level-up upgrade are the same kind of object, so they land in the same stack
 * and resolve through the same formula. Gear simply gets there first.
 *
 * Order matters in one place — a weapon rig has to *grant* its weapon before its
 * weapon-scoped modifiers can be attached to it.
 */

import { addWeapon, getWeapon } from '../game/weapons.js';
import { itemModifiers, itemFlags } from './gear.js';

/**
 * Apply every equipped item to a freshly-created run state.
 * Call once, immediately after `new GameState()` and the starter weapon.
 */
export function applyLoadout(state, profile) {
  const items = profile.equippedItems();
  const applied = [];

  // Pass 1: grant weapons, so weapon-scoped modifiers have somewhere to land.
  for (const item of items) {
    if (item.slot === 'weapon' && item.weaponId !== undefined) {
      addWeapon(state, item.weaponId);   // no-op if already owned or slots full
    }
  }

  // Pass 2: modifiers. Weapon-scoped ones go on that weapon's own stack, the
  // rest on the player's global stack.
  for (const item of items) {
    for (const mod of itemModifiers(item)) {
      if (mod.weapon !== undefined) {
        const weapon = getWeapon(state, mod.weapon);
        // The rig's weapon may have been rejected because the arsenal was
        // already full. Dropping the modifier is correct — there is nothing
        // for it to modify — but it must not throw.
        if (weapon === null) continue;
        weapon.stats.add({ stat: mod.stat, type: mod.type, value: mod.value, source: mod.source });
      } else {
        state.stats.add({ stat: mod.stat, type: mod.type, value: mod.value, source: mod.source });
      }
    }

    // Pass 3: behaviour flags, accumulated across every equipped item.
    const flags = itemFlags(item);
    for (const key in flags) {
      if (state.flags[key] === undefined) {
        // An affix referencing a flag no system reads would silently do nothing.
        // Louder is better than mysterious.
        console.warn('[fracture] gear set unknown flag "' + key + '"');
        continue;
      }
      state.flags[key] = combineFlag(key, state.flags[key], flags[key]);
    }

    applied.push(item.uid);
  }

  // Recompute everything once, rather than after each individual modifier.
  state.stats.recompute();
  for (const weapon of state.weapons) weapon.stats.recompute();

  // Health is rolled at construction from the un-geared maxHp, so a +max-health
  // item would otherwise leave the player starting on a partly-empty bar.
  state.player.hp = state.maxHp;

  state.equippedGear = applied;
  return applied;
}

/**
 * Most flags simply add. Slow *multipliers* are the exception: two chilling
 * affixes should stack toward a stronger slow, not sum past 100% into a value
 * that would send enemies backwards.
 */
function combineFlag(key, current, incoming) {
  if (key === 'onHitSlowMult') {
    // Both are "multiply enemy speed by this". Take the stronger (lower) one.
    return current === 0 ? incoming : Math.min(current, incoming);
  }
  if (key === 'onHitSlowTime' || key === 'onHitBurnTime') {
    return Math.max(current, incoming);
  }
  return current + incoming;
}
