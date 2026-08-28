/**
 * applyCharacter.js — the bridge between a chosen Driftwalker and a run.
 *
 * Deliberately the same shape as `loadout.js`, and for the same reason: a
 * character's stat lean is not a special kind of thing, it is just the first
 * batch of modifiers pushed onto the player's `Stats` stack. Gear affixes and
 * level-up upgrades land on that same stack afterwards and resolve through
 * the same `(base + flat) * (1 + inc) * mult` formula, so no combat code
 * anywhere needs to know characters exist.
 *
 * Everything is tagged `source: 'character'`, so a future "respec" or a
 * character swap mid-menu can lift the whole lean back off with one
 * `removeSource('character')` call.
 */

import { CHARACTER_BY_ID, DEFAULT_CHARACTER, isCharacterUnlocked } from './characters.js';

/**
 * Apply the profile's selected character to a freshly-created run state.
 * Call once, immediately after `new GameState()` and before `applyLoadout`.
 *
 * @returns {object} the character definition that was actually applied
 */
export function applyCharacter(state, profile) {
  let character = CHARACTER_BY_ID.get(profile.character ?? DEFAULT_CHARACTER);

  // Fall back if the save names something unknown, or something the player no
  // longer qualifies for (a wiped milestone, an edited save). A run must
  // always start with *a* character rather than refusing to start.
  if (character === undefined || !isCharacterUnlocked(character, profile)) {
    character = CHARACTER_BY_ID.get(DEFAULT_CHARACTER);
  }

  state.character = character.id;
  state.characterName = character.name;

  for (const mod of character.stats) {
    state.stats.add({ ...mod, source: 'character' });
  }

  // Health is re-seeded after the stat block lands, or a character with a
  // maxHp lean would start at the *base* 100 — the Bulwark would open with a
  // 165-point bar that is only 100 full, and the Vessel would open already
  // over its own maximum.
  state.player.hp = state.maxHp;

  // The starting weapon itself is granted by seedInventory() (called right
  // after this, in main.js's startRun) — that's the one that actually knows
  // how to resolve `character.weapon` (an ARSENAL id like 'breaker_maul')
  // into a real held weapon. This function used to *also* grant a weapon
  // here via `buildWeapon(character.weapon.split('+')[0], ...)`, but
  // buildWeapon expects a base *behavior* id ('slam', 'lash', ...), never an
  // arsenal id — so that lookup always failed and silently fell back to
  // `addWeapon(state, 'splinter')`. Every run was quietly starting with an
  // extra, untagged Splinter alongside the character's real weapon.

  return character;
}
