/**
 * outpost.js — the passive mining colony: drones, offline production, and its
 * own small upgrade tree, entirely separate from run-based progression.
 *
 * This is a genuinely different kind of system from everything else in
 * `src/meta/` — materials.js, gear.js and recipes.js all describe *rewards a
 * run hands you*; this describes something that keeps producing whether a run
 * happens or not. Deliberately capped to common-tier output only (see
 * `YIELD_MATERIALS`): the Outpost exists to ease the grind for Slag and
 * Filament, not to become a second way to earn the Alloy/Ichor/Core a run's
 * recipes are gated behind. If it produced rare material, there would be no
 * reason to ever leave the Hub.
 *
 * Every quantity here is a pure function of `(profile, now)` — nothing is
 * ticked by a timer while the game is closed. "Production while offline"
 * falls out for free: the next time anything asks, it just computes the real
 * time elapsed since `lastCollectedAt` and multiplies by the rate. No
 * background process, no missed tick, no drift.
 */

const HOUR_MS = 3600 * 1000;

/** Drones only ever produce these two — the whole point of the constraint. */
export const YIELD_MATERIALS = ['slag', 'filament'];

/**
 * Three tiers, each unlocked by owning at least one of the previous — a
 * standard idle-game ladder. Cost is a mix of the two common materials,
 * scaled geometrically per unit already owned: `cost(n) = base * growth^n`.
 * Yield leans further toward Filament at higher tiers, since Slag is the
 * easier of the two to find by hand early on.
 */
export const DRONE_TIERS = [
  {
    id: 'scrap', name: 'Scrap Skimmer', order: 0,
    unlockRequires: null,
    baseCost: { slag: 25, filament: 8 }, growth: 1.15,
    yieldPerHour: { slag: 3, filament: 1 },
    blurb: 'Picks through the wreckage outside the arena walls.',
  },
  {
    id: 'hauler', name: 'Salvage Hauler', order: 1,
    unlockRequires: 'scrap',
    baseCost: { slag: 60, filament: 40 }, growth: 1.16,
    yieldPerHour: { slag: 4, filament: 5 },
    blurb: 'Bigger, slower, and it does not come back empty.',
  },
  {
    id: 'rig', name: 'Extraction Rig', order: 2,
    unlockRequires: 'hauler',
    baseCost: { slag: 90, filament: 130 }, growth: 1.18,
    yieldPerHour: { slag: 6, filament: 11 },
    blurb: 'The Outpost biggest hauler, running around the clock.',
  },
];

export const DRONE_BY_ID = new Map(DRONE_TIERS.map((t) => [t.id, t]));

/**
 * The upgrade tree. Each is levelled independently, costs scale the same
 * geometric way drones do, and all three are capped so the Outpost stays a
 * grind-easing side system rather than something worth over-investing in.
 */
export const OUTPOST_UPGRADES = {
  speed: {
    id: 'speed', name: 'Overclock', maxLevel: 4,
    perLevel: 0.15,   // +15% production per level
    baseCost: { slag: 50, filament: 30 }, growth: 1.6,
    describe: (lvl) => '+' + Math.round(lvl * 15) + '% drone output',
  },
  cap: {
    id: 'cap', name: 'Cold Storage', maxLevel: 4,
    perLevel: 3,      // +3 offline hours per level
    baseCost: { slag: 40, filament: 60 }, growth: 1.6,
    describe: (lvl) => '+' + (lvl * 3) + 'h offline cap',
  },
  luck: {
    id: 'luck', name: 'Prospectors Luck', maxLevel: 5,
    perLevel: 0.04,   // +4% bonus-event chance per level
    baseCost: { slag: 35, filament: 35 }, growth: 1.55,
    describe: (lvl) => '+' + Math.round(lvl * 4) + '% bonus-haul chance',
  },
};

const BASE_OFFLINE_CAP_HOURS = 6;
const BASE_BONUS_CHANCE = 0.06;
const BONUS_MULT_RANGE = [1.8, 3.0];

export function droneCount(profile, tierId) {
  return profile.outpost.drones[tierId] ?? 0;
}

export function isDroneUnlocked(profile, tierId) {
  const t = DRONE_BY_ID.get(tierId);
  if (t === undefined) return false;
  if (t.unlockRequires === null) return true;
  return droneCount(profile, t.unlockRequires) > 0;
}

/** Cost to buy the *next* drone of this tier, given how many are owned. */
export function droneCost(profile, tierId) {
  const t = DRONE_BY_ID.get(tierId);
  const owned = droneCount(profile, tierId);
  const mult = Math.pow(t.growth, owned);
  const cost = {};
  for (const mat in t.baseCost) cost[mat] = Math.ceil(t.baseCost[mat] * mult);
  return cost;
}

export function upgradeLevel(profile, key) {
  return profile.outpost.upgrades[key] ?? 0;
}

/** Cost of the next level of an upgrade, or null if already maxed. */
export function upgradeCost(profile, key) {
  const def = OUTPOST_UPGRADES[key];
  const level = upgradeLevel(profile, key);
  if (level >= def.maxLevel) return null;
  const mult = Math.pow(def.growth, level);
  const cost = {};
  for (const mat in def.baseCost) cost[mat] = Math.ceil(def.baseCost[mat] * mult);
  return cost;
}

/** Total production rate across every owned drone, before the offline cap. */
export function productionPerHour(profile) {
  const speedMult = 1 + upgradeLevel(profile, 'speed') * OUTPOST_UPGRADES.speed.perLevel;
  const rate = { slag: 0, filament: 0 };
  for (const t of DRONE_TIERS) {
    const owned = droneCount(profile, t.id);
    if (owned === 0) continue;
    for (const mat of YIELD_MATERIALS) {
      rate[mat] += owned * (t.yieldPerHour[mat] ?? 0) * speedMult;
    }
  }
  return rate;
}

export function offlineCapHours(profile) {
  return BASE_OFFLINE_CAP_HOURS + upgradeLevel(profile, 'cap') * OUTPOST_UPGRADES.cap.perLevel;
}

export function bonusChance(profile) {
  return BASE_BONUS_CHANCE + upgradeLevel(profile, 'luck') * OUTPOST_UPGRADES.luck.perLevel;
}

/**
 * What collecting right now would yield, without banking it — read by the
 * Hub every render (and every tick of its live ticker) so the number climbing
 * on screen is always the actual truth, never a cached snapshot that drifts.
 */
export function pendingYield(profile, now) {
  const elapsedMs = Math.max(0, now - profile.outpost.lastCollectedAt);
  const cappedMs = Math.min(elapsedMs, offlineCapHours(profile) * HOUR_MS);
  const hours = cappedMs / HOUR_MS;

  const rate = productionPerHour(profile);
  const materials = {};
  for (const mat of YIELD_MATERIALS) {
    const amount = Math.floor(rate[mat] * hours);
    if (amount > 0) materials[mat] = amount;
  }
  return { materials, hoursCovered: hours, cappedOut: elapsedMs > cappedMs };
}

/**
 * Roll whether this collection is a bonus haul, and by how much. Rolled once
 * per collect — a bonus event is a property of *this collection*, not
 * something that can be previewed before committing to it.
 */
export function rollBonus(profile, rng) {
  if (rng.next() >= bonusChance(profile)) return null;
  return +rng.range(BONUS_MULT_RANGE[0], BONUS_MULT_RANGE[1]).toFixed(2);
}
