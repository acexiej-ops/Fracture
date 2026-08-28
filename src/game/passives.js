/**
 * passives.js — passive items, which are both a stat source and an evolution
 * catalyst.
 *
 * A passive does two jobs, and the second is the reason the evolution system
 * works at all: it grants stats while held, AND it is the key that unlocks a
 * weapon's evolved form. That dual role is what makes a passive pick a real
 * decision — you are choosing a stat line now and a specific transformation
 * later, and the two may not point at the same build.
 *
 * `mods` are Stats-stack modifiers, applied per level and tagged by source, so
 * they resolve through the same `(base + flat) * (1 + inc) * mult` formula as
 * gear affixes, character leans and level-up upgrades. Nothing special-cases
 * a passive.
 */

export const MAX_LEVEL = 8;

export const PASSIVES = {
  spinach: {
    id: 'spinach', name: 'Spinach', color: '#7dffa8',
    blurb: '+10% damage per level.',
    // Per level. Level 3 Spinach = 3x this.
    mods: [{ stat: 'damage', type: 'inc', value: 0.10 }],
  },
  spellbinder: {
    id: 'spellbinder', name: 'Spellbinder', color: '#7ce7ff',
    blurb: '+12% effect duration per level.',
    mods: [{ stat: 'duration', type: 'inc', value: 0.12 }],
  },
  duplicator: {
    id: 'duplicator', name: 'Duplicator', color: '#ffd166',
    blurb: 'Every weapon gains +0.5 projectiles per level, rounded down — '
      + 'a new shot only appears every second level, not gradually.',
    // Deliberately half a projectile per level: an extra shot only lands on
    // even levels, so the item has visible breakpoints instead of a smooth
    // curve nobody can feel.
    mods: [{ stat: 'projectileCount', type: 'flat', value: 0.5 }],
  },
  hollow_heart: {
    id: 'hollow_heart', name: 'Hollow Heart', color: '#ff5ec4',
    blurb: '+14 max health per level.',
    mods: [{ stat: 'maxHp', type: 'flat', value: 14 }],
  },
  pummarola: {
    id: 'pummarola', name: 'Pummarola', color: '#ff4d6d',
    blurb: '+0.35 health regen per second, per level.',
    mods: [{ stat: 'regen', type: 'flat', value: 0.35 }],
  },
  wings: {
    id: 'wings', name: 'Wings', color: '#c9d6e4',
    blurb: '+8% move speed per level.',
    mods: [{ stat: 'moveSpeed', type: 'inc', value: 0.08 }],
  },
  candelabrador: {
    id: 'candelabrador', name: 'Candelabrador', color: '#ffb703',
    blurb: '+10% area of effect per level.',
    mods: [{ stat: 'area', type: 'inc', value: 0.10 }],
  },
  bracer: {
    id: 'bracer', name: 'Bracer', color: '#8ff0ff',
    blurb: '+10% projectile speed per level.',
    mods: [{ stat: 'projectileSpeed', type: 'inc', value: 0.10 }],
  },
  empty_tome: {
    id: 'empty_tome', name: 'Empty Tome', color: '#b45cff',
    blurb: '+8% attack speed per level — this is what speeds up ability cooldowns too.',
    mods: [{ stat: 'attackSpeed', type: 'inc', value: 0.08 }],
  },
  clover: {
    id: 'clover', name: 'Clover', color: '#b8ff5e',
    blurb: '+3% critical hit chance per level.',
    mods: [{ stat: 'critChance', type: 'flat', value: 0.03 }],
  },
  // === Added to widen the level-up pool ==================================
  //
  // Every mod below names a stat the Stats stack already resolves. A passive
  // naming a stat nothing consumes would still level up, still show on the
  // card, still take a pick — and do nothing. That failure is invisible in the
  // UI and only surfaces as "this build feels bad", so the rule here is: no
  // new stat without the engine change that reads it, in the same commit.
  //
  // Values are PER LEVEL and cap at MAX_LEVEL (8), so read every number below
  // as "x8 at full stack".

  whetstone: {
    id: 'whetstone', name: 'Whetstone', color: '#c9d6e4',
    blurb: '+12% critical damage per level.',
    mods: [{ stat: 'critMult', type: 'flat', value: 0.12 }],
  },
  lodestone: {
    id: 'lodestone', name: 'Lodestone', color: '#ffb703',
    blurb: '+12% pickup radius per level.',
    mods: [{ stat: 'pickupRadius', type: 'inc', value: 0.12 }],
  },
  ballast: {
    id: 'ballast', name: 'Ballast', color: '#8fa4bd',
    blurb: '+16% knockback and +8 max health per level.',
    mods: [{ stat: 'knockback', type: 'inc', value: 0.16 },
           { stat: 'maxHp', type: 'flat', value: 8 }],
  },
  quill: {
    id: 'quill', name: 'Quill', color: '#7ce7ff',
    blurb: '+0.5 pierce per level, rounded down — one more enemy pierced every second level.',
    mods: [{ stat: 'pierce', type: 'flat', value: 0.5 }],
  },
  hourglass: {
    id: 'hourglass', name: 'Hourglass', color: '#b45cff',
    blurb: '+14% effect duration per level.',
    mods: [{ stat: 'duration', type: 'inc', value: 0.14 }],
  },
  featherfall: {
    id: 'featherfall', name: 'Featherfall', color: '#dff7ff',
    blurb: '+6% move speed and +8% projectile speed per level.',
    mods: [{ stat: 'moveSpeed', type: 'inc', value: 0.06 },
           { stat: 'projectileSpeed', type: 'inc', value: 0.08 }],
  },
  cinder_heart: {
    id: 'cinder_heart', name: 'Cinder Heart', color: '#ff8a3d',
    blurb: '+14% damage per level, at the cost of -4 max health per level.',
    mods: [{ stat: 'damage', type: 'inc', value: 0.14 },
           { stat: 'maxHp', type: 'flat', value: -4 }],
  },
  ichor_sump: {
    id: 'ichor_sump', name: 'Ichor Sump', color: '#b45cff',
    blurb: '+12 max health and +0.25 health regen per second, per level.',
    mods: [{ stat: 'maxHp', type: 'flat', value: 12 },
           { stat: 'regen', type: 'flat', value: 0.25 }],
  },
  splitter: {
    id: 'splitter', name: 'Splitter', color: '#ffd166',
    blurb: '+0.25 projectile count per level, rounded down — one extra shot every 4 levels.',
    // Fractional per level so it takes four picks to earn a whole extra
    // projectile. A flat +1 per level would be the strongest pick in the game
    // by a wide margin — projectile count multiplies every weapon at once.
    mods: [{ stat: 'projectileCount', type: 'flat', value: 0.25 }],
  },
  resonator: {
    id: 'resonator', name: 'Resonator', color: '#7dffa8',
    blurb: '+9% area and +8% knockback per level.',
    mods: [{ stat: 'area', type: 'inc', value: 0.09 },
           { stat: 'knockback', type: 'inc', value: 0.08 }],
  },
  hair_trigger: {
    id: 'hair_trigger', name: 'Hair Trigger', color: '#ff4d6d',
    blurb: '+13% attack speed per level, at the cost of -3% damage per level.',
    mods: [{ stat: 'attackSpeed', type: 'inc', value: 0.13 },
           { stat: 'damage', type: 'inc', value: -0.03 }],
  },
  marrow: {
    id: 'marrow', name: 'Marrow', color: '#f4f0e4',
    blurb: '+0.45 health regen per second, per level.',
    mods: [{ stat: 'regen', type: 'flat', value: 0.45 }],
  },
  glass_eye: {
    id: 'glass_eye', name: 'Glass Eye', color: '#ff5ec4',
    blurb: '+2.5% critical hit chance and +10% critical damage per level.',
    mods: [{ stat: 'critChance', type: 'flat', value: 0.025 },
           { stat: 'critMult', type: 'flat', value: 0.10 }],
  },
  longshot: {
    id: 'longshot', name: 'Longshot', color: '#c9d6ff',
    blurb: '+16% projectile speed and +0.25 pierce per level (rounded down).',
    mods: [{ stat: 'projectileSpeed', type: 'inc', value: 0.16 },
           { stat: 'pierce', type: 'flat', value: 0.25 }],
  },

};

export const PASSIVE_IDS = Object.keys(PASSIVES);

/** Every modifier a passive contributes at a given level, ready for the stack. */
export function passiveModifiers(id, level) {
  const p = PASSIVES[id];
  if (p === undefined || level <= 0) return [];
  const out = [];
  for (const m of p.mods) {
    out.push({ ...m, value: m.value * level, source: 'passive:' + id });
  }
  return out;
}
