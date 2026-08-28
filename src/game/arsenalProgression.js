/**
 * arsenalProgression.js — the bridge that puts the arsenal in charge of
 * levelling, replacing the 45-node upgrade tree.
 *
 * WHAT THIS REPLACES AND WHY IT IS A BRIDGE, NOT A REWRITE
 * --------------------------------------------------------
 * The old tree owned two functions: `rollUpgradeChoices(state)` produced three
 * cards, `applyUpgrade(state, choice)` applied one. This file provides
 * drop-in replacements with the same signatures and the same card shape, so
 * `ui/levelup.js` needs no changes at all — it still receives
 * `{ id, name, desc, tag, isWeapon }` and still knows nothing about where a
 * choice came from.
 *
 * THE SYNC PROBLEM
 * ----------------
 * The combat engine reads `state.weapons` (live `Weapon` instances carrying
 * their own Stats stack and per-weapon scratch state — an orbit's angle, a
 * charge beam's accumulated charge). The inventory holds levels. Those are two
 * representations of the same thing and they must not drift.
 *
 * `syncInventory` reconciles them **in place** rather than rebuilding the
 * array: a rebuild would reset every weapon's scratch, which would visibly
 * snap orbiting blades back to angle zero and dump a charge beam's charge
 * every single time the player levelled anything. Instead it patches the
 * existing Stats base and only adds/removes what actually changed.
 */

import { rng } from '../core/rng.js';
import { MAX_LEVEL, PASSIVES, PASSIVE_IDS } from './passives.js';
import {
  BASE_THIRTY, WEAPON_BY_ID, resolveWeapon, registerArsenalArt,
} from './arsenal.js';
import { WEAPONS } from './weaponDefs.js';
import { addWeapon } from './weapons.js';
import { MAX_WEAPONS, MAX_PASSIVES } from './inventory.js';
import { evolutionStatus } from './evolutions.js';
import { t } from '../i18n/i18n.js';

const CARDS = 3;

// ---------------------------------------------------------------------------
// Rolling choices
// ---------------------------------------------------------------------------

/**
 * Build the pool of everything the player could legally be offered.
 *
 * Weights encode the pacing: brand-new weapons are heavily favoured while the
 * arsenal is nearly empty and fall away sharply once it is full, so the front
 * of a run is about *choosing* a build and the back half is about deepening
 * it. That is the same shape the old tree used, kept deliberately — it was the
 * part of the tree that worked.
 */
function buildPool(state) {
  const inv = state.inventory;
  const pool = [];

  const weaponSlots = MAX_WEAPONS - inv.weapons.size;
  const passiveSlots = MAX_PASSIVES - inv.passives.size;

  // --- Level up what you already hold ---
  for (const w of inv.weapons.values()) {
    if (w.level >= MAX_LEVEL) continue;
    const evo = evolutionStatus(w.id, inv);
    pool.push({
      kind: 'weapon-up', id: w.id, level: w.level,
      // A weapon one level from unlocking an evolution is worth surfacing.
      weight: w.level === MAX_LEVEL - 1 && evo.reason !== 'no evolution' ? 90 : 55,
    });
  }
  for (const p of inv.passives.values()) {
    if (p.level >= MAX_LEVEL) continue;
    pool.push({ kind: 'passive-up', id: p.id, level: p.level, weight: 45 });
  }

  // --- Acquire something new ---
  if (weaponSlots > 0) {
    // Steep early bias: 140 with an empty arsenal down to ~28 when nearly full.
    const w = 20 + weaponSlots * 24;
    for (const entry of BASE_THIRTY) {
      if (inv.has(entry.id)) continue;
      pool.push({ kind: 'weapon-new', id: entry.id, weight: w });
    }
  }
  if (passiveSlots > 0) {
    const w = 14 + passiveSlots * 10;
    for (const id of PASSIVE_IDS) {
      if (inv.has(id)) continue;
      pool.push({ kind: 'passive-new', id, weight: w });
    }
  }

  return pool;
}

/**
 * The two or three numbers worth putting on a card at a glance — damage and
 * cooldown always (every weapon has both), plus whichever of radius/duration/
 * projectile speed this one actually uses. Not every stat a weapon has, just
 * the ones a player would otherwise have to read the blurb to guess at.
 */
function weaponStatLines(stats) {
  if (stats === undefined) return [];
  const lines = [];
  if (stats.damage !== undefined) lines.push({ label: t('run.statDamage'), value: Math.round(stats.damage) });
  if (stats.cooldown !== undefined) lines.push({ label: t('run.statCooldown'), value: stats.cooldown.toFixed(1) + 's' });
  if (stats.radius !== undefined) lines.push({ label: t('run.statRadius'), value: Math.round(stats.radius) });
  if (stats.duration !== undefined) lines.push({ label: t('run.statDuration'), value: stats.duration.toFixed(1) + 's' });
  return lines;
}

/** Turn a pool entry into a card the existing level-up screen can render. */
function toCard(entry, inv) {
  if (entry.kind === 'weapon-new') {
    const def = WEAPON_BY_ID.get(entry.id);
    return {
      id: entry.id, kind: entry.kind, isWeapon: true,
      name: t('weapon.' + entry.id + '.name') || def.name, tag: 'weapon',
      desc: t('weapon.' + entry.id + '.blurb') || def.blurb,
      hint: def.category,
      art: def.art,
      stats: weaponStatLines(def.stats),
    };
  }
  if (entry.kind === 'passive-new') {
    const p = PASSIVES[entry.id];
    return {
      id: entry.id, kind: entry.kind, isWeapon: false,
      name: t('passive.' + entry.id + '.name') || p.name, tag: 'passive',
      desc: t('passive.' + entry.id + '.blurb') || p.blurb,
      art: entry.id,
    };
  }
  if (entry.kind === 'weapon-up') {
    const def = WEAPON_BY_ID.get(entry.id);
    const next = entry.level + 1;
    const evo = evolutionStatus(entry.id, inv);
    let hint;
    if (next >= MAX_LEVEL && evo.reason !== 'no evolution') {
      hint = evo.needsPassive || evo.ready
        ? t('run.evolvesWith', { name: evo.passiveName })
        : t('run.maxLevel');
    }
    return {
      id: entry.id, kind: entry.kind, isWeapon: false,
      name: t('weapon.' + entry.id + '.name') || def.name, tag: 'weapon',
      desc: t('run.levelProgress', { cur: entry.level, next }),
      hint,
      art: def.art,
      maxStacks: MAX_LEVEL, taken: entry.level,
    };
  }
  const p = PASSIVES[entry.id];
  const next = entry.level + 1;
  return {
    id: entry.id, kind: entry.kind, isWeapon: false,
    name: t('passive.' + entry.id + '.name') || p.name, tag: 'passive',
    desc: t('run.levelProgress', { cur: entry.level, next }),
    art: entry.id,
    maxStacks: MAX_LEVEL, taken: entry.level,
  };
}

/**
 * DROP-IN REPLACEMENT for `rollUpgradeChoices(state)`.
 * Returns up to three distinct cards.
 */
export function rollArsenalChoices(state) {
  const inv = state.inventory;
  const pool = buildPool(state);

  if (pool.length === 0) {
    // Everything owned and maxed — a very long run. Offer a plain bump rather
    // than an empty screen, same fallback the old tree had.
    return [{
      id: 'overflow', kind: 'overflow', isWeapon: false,
      name: t('run.overflowName'), tag: 'offence',
      desc: t('run.overflowDesc'),
    }];
  }

  const picked = [];
  const available = [...pool];
  while (picked.length < CARDS && available.length > 0) {
    const choice = rng.weighted(available, (e) => e.weight);
    picked.push(toCard(choice, inv));
    available.splice(available.indexOf(choice), 1);
  }
  return picked;
}

// ---------------------------------------------------------------------------
// Applying a choice
// ---------------------------------------------------------------------------

/**
 * DROP-IN REPLACEMENT for `applyUpgrade(state, choice)`.
 */
export function applyArsenalChoice(state, choice) {
  if (choice.kind === 'overflow') {
    state.stats.add({ stat: 'damage', type: 'inc', value: 0.10, source: 'overflow' });
    state.stats.recompute();
    return true;
  }

  const result = state.inventory.upgrade_item(choice.id);
  if (result === null) return false;

  syncInventory(state);
  return true;
}

// ---------------------------------------------------------------------------
// Inventory -> engine sync
// ---------------------------------------------------------------------------

/**
 * Reconcile `state.weapons` and `state.stats` with the inventory.
 *
 * Safe to call as often as you like — it is idempotent, and it only touches
 * what actually differs. Call it after ANY inventory mutation (level-up,
 * evolution, a chest grant).
 */
export function syncInventory(state) {
  const inv = state.inventory;

  // --- Weapons ---
  const wanted = new Map();   // engine weapon id -> carried weapon
  for (const carried of inv.weapons.values()) {
    if (carried.def === null) continue;
    // Register the resolved def under the id the engine will look it up by.
    WEAPONS[carried.def.id] = carried.def;
    wanted.set(carried.def.id, carried);
  }

  // Remove weapons the inventory no longer holds — this is how an evolution's
  // base weapon actually leaves the player's hands.
  //
  // Crucially this only touches weapons the inventory ITSELF placed, marked
  // with `fromInventory`. Crafted weapon rigs (meta/loadout.js) add engine
  // weapons directly, outside the arsenal entirely; without this guard the
  // very first level-up silently deleted the weapon the player had crafted,
  // equipped and started the run holding — a gear slot quietly doing nothing.
  for (let i = state.weapons.length - 1; i >= 0; i--) {
    const w = state.weapons[i];
    if (w.fromInventory === true && !wanted.has(w.id)) state.weapons.splice(i, 1);
  }

  for (const [engineId, carried] of wanted) {
    const existing = state.weapons.find((w) => w.id === engineId);
    if (existing === undefined) {
      const added = addWeapon(state, engineId);
      // May be null when a rig already filled the last slot; that is a real
      // (if unlucky) outcome, not an error — the inventory still holds it and
      // it will be placed if a slot frees up.
      if (added !== null) added.fromInventory = true;
      continue;
    }
    // A weapon can be both rig-granted and inventory-held (a Splinter Rig plus
    // a character that starts with the same behaviour). Claiming it here means
    // the inventory manages it from now on, which is what the player expects
    // once it starts appearing on level-up cards.
    existing.fromInventory = true;
    // Already held: patch its numbers in place rather than replacing the
    // instance, so per-weapon scratch (orbit angle, accumulated charge)
    // survives a level-up instead of visibly resetting every time.
    existing.stats.base = { ...carried.def.base };
    existing.stats._dirty = true;
    existing.stats.recompute();
    existing.name = carried.def.name;
    existing.level = carried.level;
  }

  // --- Passives ---
  // Cleared and re-added wholesale. Passive modifiers are a pure function of
  // (id, level) with no per-instance state, so there is nothing to preserve
  // and a full rebuild is both simpler and impossible to desync.
  for (const id of PASSIVE_IDS) state.stats.removeSource('passive:' + id);
  for (const mod of inv.passiveStatModifiers()) state.stats.add(mod);
  state.stats.recompute();

  // maxHp can move (Hollow Heart), and health must not sit above its own cap.
  if (state.player.hp > state.maxHp) state.player.hp = state.maxHp;
}

/**
 * Seed a fresh run's inventory from the chosen character's starting weapon.
 * Called from `applyCharacter`'s slot in the run-start sequence.
 */
export function seedInventory(state, startingWeaponId) {
  registerArsenalArt();
  const inv = state.inventory;

  // Characters declare an ARSENAL weapon id directly. The behaviour-matching
  // fallback below is only a safety net for an unknown id (an older save, a
  // renamed weapon) — it is deliberately NOT the primary path, because
  // several arsenal weapons share one behaviour and matching on behaviour
  // silently collapsed four different characters onto the same weapon.
  const exact = BASE_THIRTY.find((w) => w.id === startingWeaponId);
  const fallback = BASE_THIRTY.find((w) => w.behavior === String(startingWeaponId).split('+')[0]);
  inv.grantWeapon((exact ?? fallback)?.id ?? 'fire_wand', 1);
  syncInventory(state);
}

/** Diagnostics: is the engine's weapon list in step with the inventory? */
export function auditSync(state) {
  const problems = [];
  const inv = state.inventory;
  const engineIds = new Set(state.weapons.map((w) => w.id));
  for (const carried of inv.weapons.values()) {
    if (carried.def === null) { problems.push({ id: carried.id, issue: 'unresolved def' }); continue; }
    if (!engineIds.has(carried.def.id)) {
      problems.push({ id: carried.id, issue: 'held but not in state.weapons' });
    }
  }
  const wantedIds = new Set([...inv.weapons.values()].map((c) => c.def?.id));
  for (const w of state.weapons) {
    // Rig-granted weapons legitimately live outside the inventory, so only an
    // inventory-owned weapon with no backing entry is actually a desync.
    if (w.fromInventory === true && !wantedIds.has(w.id)) {
      problems.push({ id: w.id, issue: 'inventory-owned but not held' });
    }
  }
  return problems;
}
