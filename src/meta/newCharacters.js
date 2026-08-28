/**
 * newCharacters.js — five new Driftwalkers filling roster gaps.
 *
 * Each fills a mechanical niche the existing 16 do not cover:
 *   chronicler — freeze/slow specialist (control)
 *   chemist    — toxic DoT spreader (sustained damage)
 *   bloodMage  — HP-costing high AoE (sacrifice)
 *   engineer   — turret/summon specialist (army)
 *   chronokeeper — time-manipulation (rewind/slow)
 */

export const NEW_CHARACTERS = [
  {
    id: 'chronicler',
    name: 'The Chronicler',
    title: 'Control / freeze',
    blurb: 'Read the Fracture\'s records long enough to learn how it slows down.',
    // Was 'quill_storm' — not a real arsenal weapon id, so this character
    // was silently falling back to Fire Wand (seedInventory's own last-resort
    // default) at run start, nothing like the freeze/control kit described
    // below. chrono_pocket is a real weapon whose actual effect (a field
    // that slows and damages everything standing in it) matches the lean.
    weapon: 'chrono_pocket',
    palette: '#7ce7ff',
    build: 'chronicler',
    stats: [
      { stat: 'duration', type: 'inc', value: 0.30 },
      { stat: 'area', type: 'inc', value: 0.12 },
      { stat: 'damage', type: 'inc', value: -0.15 },
    ],
    unlock: { bestTime: 300 },
    lean: 'Slows and freezes everything. Direct damage is softer.',
  },

  {
    id: 'chemist',
    name: 'The Chemist',
    title: 'Toxic / DoT',
    blurb: 'Brought samples back from a zone no one else walked out of. They work.',
    weapon: 'acid_spray',
    palette: '#b8ff5e',
    build: 'chemist',
    stats: [
      { stat: 'duration', type: 'inc', value: 0.50 },
      { stat: 'damage', type: 'inc', value: 0.16 },
      { stat: 'attackSpeed', type: 'inc', value: -0.06 },
    ],
    unlock: { totalKills: 18000 },
    lean: 'Everything that lingers, lingers much longer. Slower to act.',
  },

  {
    id: 'bloodmage',
    name: 'The Blood Mage',
    title: 'Sacrifice / AoE',
    blurb: 'Pays in health for effects no one else can afford.',
    // Was 'blood_orb' — not a real arsenal weapon id (same class of bug as
    // Chronicler's, above). earthquake_stomp is a real, unused weapon whose
    // actual effect (a wide, heavy area blast) matches "massive area and
    // damage" better than the Fire Wand it was silently falling back to.
    weapon: 'earthquake_stomp',
    palette: '#ff4d6d',
    build: 'bloodmage',
    stats: [
      { stat: 'area', type: 'inc', value: 0.25 },
      { stat: 'damage', type: 'inc', value: 0.20 },
      { stat: 'maxHp', type: 'flat', value: -15 },
    ],
    unlock: { bestWave: 28, bestTime: 1200 },
    lean: 'Massive area and damage, but burns its own blood to do it.',
  },

  {
    id: 'engineer',
    name: 'The Engineer',
    title: 'Summon / turret',
    blurb: 'Prefers not to be in the fight. The fight is in the fight.',
    // Was 'sentry_gun' — not a real arsenal weapon id (same bug again).
    // electric_fence is a real turret-behavior weapon (places nodes that
    // arc lightning between themselves), an actual match for "summon/turret"
    // instead of the Fire Wand fallback.
    weapon: 'electric_fence',
    palette: '#ffb703',
    build: 'engineer',
    stats: [
      { stat: 'duration', type: 'inc', value: 0.35 },
      { stat: 'area', type: 'inc', value: 0.10 },
      { stat: 'attackSpeed', type: 'inc', value: -0.10 },
      { stat: 'moveSpeed', type: 'inc', value: -0.08 },
    ],
    unlock: { runs: 150, totalKills: 40000 },
    lean: 'Deployables last longer and cover more ground. You do not.',
  },

  {
    id: 'chronokeeper',
    name: 'The Chronokeeper',
    title: 'Time / rewind',
    blurb: 'Saw the moment the Fracture started. Still standing in it.',
    // Was 'temporal_bolt' — not a real arsenal weapon id (same bug again).
    // void_rift is a real weapon whose actual effect (a lingering field that
    // pulls enemies toward its centre) reads as a small gravity/time
    // distortion, a real match for "time manipulation" instead of Fire Wand.
    weapon: 'void_rift',
    palette: '#b45cff',
    build: 'chronokeeper',
    stats: [
      { stat: 'attackSpeed', type: 'inc', value: 0.18 },
      { stat: 'projectileSpeed', type: 'inc', value: 0.20 },
      { stat: 'maxHp', type: 'flat', value: -20 },
      { stat: 'area', type: 'inc', value: -0.10 },
    ],
    unlock: { bestWave: 25, totalPlaytime: 36000 },
    lean: 'Fast and precise. Fragile, and every effect is smaller.',
  },
];
