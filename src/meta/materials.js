/**
 * materials.js — the raw crafting currency and where it comes from.
 *
 * Three tiers. Common materials auto-credit on kill because four hundred
 * enemies dropping physical pickups would bury the arena; rare and exotic ones
 * drop as collectable motes, which is what makes finding one feel like an
 * event. That split is deliberate — the moment-to-moment readability of the
 * fight matters more than literal consistency.
 */

export const TIERS = {
  common: { id: 'common', name: 'Common', color: '#9fb3c8', order: 0 },
  rare:   { id: 'rare',   name: 'Rare',   color: '#ffb703', order: 1 },
  exotic: { id: 'exotic', name: 'Exotic', color: '#ff5ec4', order: 2 },
};

export const MATERIALS = {
  slag: {
    id: 'slag', name: 'Slag', tier: 'common', color: '#9fb3c8',
    blurb: 'Fused wreckage. Every Warped thing leaves some behind.',
  },
  filament: {
    id: 'filament', name: 'Filament', tier: 'common', color: '#7ce7ff',
    blurb: 'Drawn from the quick ones. Still carrying a charge.',
  },
  alloy: {
    id: 'alloy', name: 'Alloy', tier: 'rare', color: '#ffb703',
    blurb: 'Plating that held its shape. The heavy Warped carry it.',
  },
  ichor: {
    id: 'ichor', name: 'Ichor', tier: 'rare', color: '#b45cff',
    blurb: 'What the Fracture leaks. It made them; a Driftwalker makes it work.',
  },
  core: {
    id: 'core', name: 'Resonant Core', tier: 'exotic', color: '#ff5ec4',
    blurb: 'Cut from an Anomaly, and still resonating. Rare beyond reason.',
  },
};

export const MATERIAL_IDS = Object.keys(MATERIALS);

/** Materials in a stable display order: tier first, then definition order. */
export const MATERIALS_ORDERED = MATERIAL_IDS
  .map((id) => MATERIALS[id])
  .sort((a, b) => TIERS[a.tier].order - TIERS[b.tier].order);

/** True for materials that spawn a collectable mote rather than auto-crediting. */
export const dropsPhysically = (id) => MATERIALS[id].tier !== 'common';

/**
 * Per-kill drop table, by enemy archetype.
 *
 * `chance` is per kill; `wave` is the earliest wave it can appear. Numbers are
 * small on purpose — a run should yield tens of common and a handful of rare,
 * so that a single exotic is worth changing how you play for.
 */
const DROP_TABLE = {
  grunt:   [ { id: 'slag', chance: 0.085 } ],
  darter:  [ { id: 'filament', chance: 0.10 } ],
  brute:   [ { id: 'slag', chance: 0.30 },
             { id: 'alloy', chance: 0.055 },
             { id: 'core', chance: 0.0022, wave: 12 } ],
  charger: [ { id: 'filament', chance: 0.13 },
             { id: 'ichor', chance: 0.045 },
             { id: 'core', chance: 0.0015, wave: 12 } ],
};

/**
 * Roll what a single kill drops.
 * @returns {Array<string>} material ids, usually empty
 */
export function rollKillDrops(typeId, wave, rng) {
  const table = DROP_TABLE[typeId];
  if (table === undefined) return [];

  const out = [];
  for (const entry of table) {
    if (entry.wave !== undefined && wave < entry.wave) continue;
    // Later waves are a little more generous, but it flattens off fast so a
    // very long run doesn't trivialise the economy.
    const bonus = 1 + Math.min(0.9, (wave - 1) * 0.035);
    if (rng.next() < entry.chance * bonus) out.push(entry.id);
  }
  return out;
}

/**
 * What a harvest node yields. Nodes are the reliable source of rare material —
 * kills alone would make a rare-tier recipe take a dozen runs.
 */
export function rollNodeDrops(wave, rng) {
  const out = [];
  const commons = 3 + rng.int(0, 3);
  for (let i = 0; i < commons; i++) {
    out.push(rng.bool(0.5) ? 'slag' : 'filament');
  }

  const rares = 1 + (rng.bool(Math.min(0.7, 0.2 + wave * 0.03)) ? 1 : 0);
  for (let i = 0; i < rares; i++) {
    out.push(rng.bool(0.5) ? 'alloy' : 'ichor');
  }

  if (wave >= 8 && rng.bool(Math.min(0.25, 0.02 + wave * 0.008))) out.push('core');

  return out;
}

/** Sum a list of material ids into a { id: count } bag. */
export function tally(ids, into = {}) {
  for (const id of ids) into[id] = (into[id] ?? 0) + 1;
  return into;
}
