/**
 * characters.js — the ten Driftwalkers.
 *
 * Each is three things, and all three have to pull in the same direction or
 * the pick isn't a real decision:
 *
 *   weapon   an ARSENAL weapon id (see game/arsenal.js). Declared directly
 *            rather than as an engine behaviour: several arsenal weapons share
 *            a behaviour, so guessing one from the other collapsed four
 *            different characters onto Fire Wand.
 *   stats    a lean, expressed as modifiers on the player's base stat block.
 *            Every lean has a genuine cost, not just a bonus: the Bulwark is
 *            slow, the Kite is fragile, the Vessel starts with less health
 *            than anyone. A roster of strictly-better picks is a roster with
 *            one correct answer.
 *   sprite   a distinct silhouette + palette (see spriteDefs.js), so the
 *            roster reads at a glance rather than as ten recolours.
 *
 * Five are available immediately; five unlock against the same
 * `profile.milestones` counters the recipe system already gates on
 * (bestWave / bestTime / totalKills / runs), so unlocks are earned by the
 * things a player is already doing rather than by a parallel currency.
 *
 * `stats` entries are Stats-stack modifiers: { stat, type, value }. They're
 * pushed with source 'character' at run start, so they resolve through the
 * exact same formula as gear affixes and level-up upgrades.
 */

export const CHARACTERS = [
  // --- Unlocked from the start -------------------------------------------

  {
    id: 'scav',
    name: 'The Scavenger',
    title: 'Balanced',
    blurb: 'Walked out of the first Fracture with all their fingers. Nothing '
      + 'special, and that is the point — every trick still works on them.',
    weapon: 'magic_missile',
    palette: '#4fd8ff',
    build: 'scav',
    stats: [],
    lean: 'No strengths, no holes. The baseline everything else is measured against.',
  },

  {
    id: 'bulwark',
    name: 'The Bulwark',
    title: 'Tank',
    blurb: 'Plated so heavily the Ichor cannot find a way in. Getting anywhere '
      + 'takes a while.',
    weapon: 'breaker_maul',
    palette: '#8fa4bd',
    build: 'bulwark',
    stats: [
      { stat: 'maxHp', type: 'flat', value: 48 },
      { stat: 'regen', type: 'flat', value: 0.6 },
      { stat: 'moveSpeed', type: 'inc', value: -0.22 },
      { stat: 'damage', type: 'inc', value: -0.10 },
    ],
    lean: 'Far more health and steady regen. Genuinely slow, and hits softer.',
  },

  {
    id: 'kite',
    name: 'The Kite',
    title: 'Fast / fragile',
    blurb: 'Never stopped running after the first drift. Has not needed to.',
    weapon: 'shadow_dagger',
    palette: '#f4ff5e',
    build: 'kite',
    stats: [
      { stat: 'moveSpeed', type: 'inc', value: 0.30 },
      { stat: 'pickupRadius', type: 'inc', value: 0.35 },
      { stat: 'maxHp', type: 'flat', value: -32 },
    ],
    lean: 'Much faster, much wider pickup. Dies to two mistakes instead of four.',
  },

  {
    id: 'gunner',
    name: 'The Gunner',
    title: 'Ranged',
    blurb: 'Solved the Warped problem at distance and never revisited it.',
    weapon: 'laser_pistol',
    palette: '#c9d6ff',
    build: 'gunner',
    stats: [
      { stat: 'projectileSpeed', type: 'inc', value: 0.25 },
      { stat: 'critChance', type: 'flat', value: 0.06 },
      { stat: 'area', type: 'inc', value: -0.15 },
    ],
    lean: 'Faster shots and more crits. Every area effect is smaller.',
  },

  {
    id: 'warden',
    name: 'The Warden',
    title: 'Support / zoning',
    blurb: 'Would rather the ground did the work. Usually gets their way.',
    weapon: 'attack_bud',
    palette: '#7dffa8',
    build: 'warden',
    stats: [
      { stat: 'duration', type: 'inc', value: 0.40 },
      { stat: 'area', type: 'inc', value: 0.18 },
      { stat: 'attackSpeed', type: 'inc', value: -0.15 },
    ],
    lean: 'Everything you place lasts longer and covers more. Slower to act.',
  },

  // --- Milestone unlocks --------------------------------------------------

  {
    id: 'vessel',
    name: 'The Vessel',
    title: 'Glass cannon',
    blurb: 'Carries more Ichor than is advisable. It shows in the numbers, and '
      + 'in how little it takes to end them.',
    weapon: 'gravity_bomb',
    palette: '#ff5ec4',
    build: 'vessel',
    stats: [
      { stat: 'damage', type: 'inc', value: 0.35 },
      { stat: 'critMult', type: 'flat', value: 0.4 },
      { stat: 'maxHp', type: 'flat', value: -45 },
    ],
    unlock: { totalKills: 500 },
    lean: 'The highest damage in the roster, on the smallest health pool.',
  },

  {
    id: 'swarm',
    name: 'The Choirmaster',
    title: 'Multi-projectile',
    blurb: 'Learned what the Choir does and decided to do it back.',
    weapon: 'bone_tosser',
    palette: '#ffb703',
    build: 'swarm',
    stats: [
      { stat: 'projectileCount', type: 'flat', value: 1 },
      { stat: 'attackSpeed', type: 'inc', value: 0.15 },
      { stat: 'damage', type: 'inc', value: -0.18 },
    ],
    unlock: { bestWave: 6 },
    lean: 'An extra projectile from every weapon. Each one hits for less.',
  },

  {
    id: 'reaver',
    name: 'The Reaver',
    title: 'Lifesteal bruiser',
    blurb: 'Takes it back out of them. Has to stay close to do it.',
    weapon: 'twin_fangs',
    palette: '#ff4d6d',
    build: 'reaver',
    stats: [
      { stat: 'maxHp', type: 'flat', value: 15 },
      { stat: 'attackSpeed', type: 'inc', value: 0.12 },
      { stat: 'pickupRadius', type: 'inc', value: -0.25 },
    ],
    unlock: { bestTime: 150 },
    lean: 'Sustains through contact. Has to walk over its own drops.',
  },

  {
    id: 'drifter',
    name: 'The Longdrifter',
    title: 'Scaling / greed',
    blurb: 'Stays in far past the point anyone sensible leaves.',
    weapon: 'ichor_lash',
    palette: '#b45cff',
    build: 'drifter',
    stats: [
      { stat: 'pickupRadius', type: 'inc', value: 0.5 },
      { stat: 'moveSpeed', type: 'inc', value: 0.08 },
      { stat: 'maxHp', type: 'flat', value: -15 },
    ],
    unlock: { runs: 6 },
    lean: 'Huge pickup radius — levels faster than anyone, if it survives to.',
  },

  {
    id: 'anomaly',
    name: 'The Half-Warped',
    title: 'High risk',
    blurb: 'Somewhere past the point of coming back. Still walking, still '
      + 'theirs — mostly.',
    weapon: 'holy_aura',
    palette: '#a97dff',
    build: 'anomaly',
    // Deliberately the most extreme block in the roster: the largest single
    // bonus AND the largest single penalty, so it plays as a genuine gamble
    // rather than as "the best one you unlock last".
    stats: [
      { stat: 'damage', type: 'inc', value: 0.22 },
      { stat: 'attackSpeed', type: 'inc', value: 0.22 },
      { stat: 'area', type: 'inc', value: 0.22 },
      { stat: 'maxHp', type: 'flat', value: -55 },
      { stat: 'regen', type: 'flat', value: -0.25 },
    ],
    unlock: { bestWave: 15 },
    lean: 'Everything offensive is up. Half the health, and it bleeds.',
  },

  // --- Second wave of unlocks --------------------------------------------
  //
  // Six more, each built around a mechanic the first ten do not cover:
  // damage-over-time, mitigation-through-blocking, ability-centric play with
  // no starting weapon lean, sustain-off-corpses, a lag-behind clone, and
  // chain damage. A roster grows by adding verbs, not by adding stat spreads.
  //
  // Five additional characters (chronicler, chemist, bloodmage, engineer,
  // chronokeeper) are imported from newCharacters.js and appended below.

  {
    id: 'ember',
    name: 'The Ashwalker',
    title: 'Burn / attrition',
    blurb: 'Walked out of a zone that was still on fire three weeks later. '
      + 'Something of it came along.',
    weapon: 'santa_water',
    palette: '#ff8a3d',
    build: 'ember',
    stats: [
      { stat: 'duration', type: 'inc', value: 0.45 },
      { stat: 'area', type: 'inc', value: 0.15 },
      { stat: 'damage', type: 'inc', value: -0.12 },
    ],
    unlock: { totalKills: 5000 },
    lean: 'Everything lingering burns far longer. Direct hits land softer.',
  },

  {
    id: 'tide',
    name: 'The Tidebreaker',
    title: 'Block / counter',
    blurb: 'Learned that the Warped commit fully to every swing, and built a '
      + 'career on the half-second afterwards.',
    weapon: 'warden_pike',
    palette: '#4fd8ff',
    build: 'tide',
    stats: [
      { stat: 'maxHp', type: 'flat', value: 28 },
      { stat: 'knockback', type: 'inc', value: 0.5 },
      { stat: 'moveSpeed', type: 'inc', value: -0.12 },
    ],
    unlock: { bestWave: 13 },
    lean: 'Sturdy, and shoves hard enough to make room. Not quick.',
  },

  {
    id: 'null',
    name: 'The Nullhand',
    title: 'Ability-focused',
    blurb: 'Carries nothing. Insists that is the point, and has the record to '
      + 'argue it.',
    weapon: 'garlic_shield',
    palette: '#dff7ff',
    build: 'null_',
    stats: [
      { stat: 'attackSpeed', type: 'inc', value: -0.25 },
      { stat: 'maxHp', type: 'flat', value: 20 },
      { stat: 'moveSpeed', type: 'inc', value: 0.10 },
    ],
    unlock: { runs: 60 },
    lean: 'Weapons fire slowly — abilities come back fast enough to matter.',
  },

  {
    id: 'tender',
    name: 'The Grave-Tender',
    title: 'Sustain',
    blurb: 'Someone has to close the eyes. Takes a little back each time.',
    weapon: 'gravedigger',
    palette: '#7dffa8',
    build: 'tender',
    stats: [
      { stat: 'regen', type: 'flat', value: 1.1 },
      { stat: 'pickupRadius', type: 'inc', value: 0.20 },
      { stat: 'critChance', type: 'flat', value: -0.04 },
    ],
    unlock: { bestTime: 900 },
    lean: 'Heals steadily through anything. Almost never crits.',
  },

  {
    id: 'echo',
    name: 'The Splitspine',
    title: 'Double-hit',
    blurb: 'Two of them came back out. Both insist they are the original.',
    weapon: 'cross_boomerang',
    palette: '#b45cff',
    build: 'echo',
    stats: [
      { stat: 'projectileCount', type: 'flat', value: 1 },
      { stat: 'pierce', type: 'flat', value: 1 },
      { stat: 'damage', type: 'inc', value: -0.22 },
      { stat: 'maxHp', type: 'flat', value: -20 },
    ],
    unlock: { totalKills: 15000 },
    lean: 'An extra piercing projectile from everything. Each hit is weaker.',
  },

  {
    id: 'coil',
    name: 'The Coilwright',
    title: 'Chain damage',
    blurb: 'Ran cable through the Fracture to see what it would carry. It '
      + 'carries a great deal.',
    weapon: 'chain_bolt',
    palette: '#f4ff5e',
    build: 'coil',
    stats: [
      { stat: 'projectileSpeed', type: 'inc', value: 0.35 },
      { stat: 'attackSpeed', type: 'inc', value: 0.18 },
      { stat: 'area', type: 'inc', value: -0.20 },
      { stat: 'maxHp', type: 'flat', value: -25 },
    ],
    unlock: { bestWave: 30, totalBossKills: 20 },
    lean: 'Fires fast and travels fast. Small blasts, and fragile.',
  },
];

// --- Third wave: five more characters from newCharacters.js ---
import { NEW_CHARACTERS } from './newCharacters.js';

for (const c of NEW_CHARACTERS) {
  CHARACTERS.push(c);
}

export const CHARACTER_BY_ID = new Map(CHARACTERS.map((c) => [c.id, c]));

export const DEFAULT_CHARACTER = 'scav';

/**
 * Is this character available?
 *
 * Reads the same `profile.milestones` counters the recipe system gates on, so
 * a player is always making progress toward unlocks just by playing — no
 * separate achievement currency to understand.
 */
export function isCharacterUnlocked(character, profile) {
  const u = character.unlock;
  if (u === undefined) return true;
  const m = profile.milestones;
  if (u.bestWave !== undefined && m.bestWave < u.bestWave) return false;
  if (u.bestTime !== undefined && m.bestTime < u.bestTime) return false;
  if (u.totalKills !== undefined && m.totalKills < u.totalKills) return false;
  if (u.runs !== undefined && m.runs < u.runs) return false;
  if (u.totalBossKills !== undefined && m.totalBossKills < u.totalBossKills) return false;
  if (u.totalPlaytime !== undefined && m.totalPlaytime < u.totalPlaytime) return false;
  return true;
}

/**
 * Plain-language description of what still stands between you and a
 * character — every unmet condition, not just the first one found. That
 * used to be fine when every character had exactly one unlock key; the
 * hardest tier now combines two (e.g. a wave AND a boss-kill count), and a
 * player missing both should see both, not just whichever this function
 * happened to check first.
 */
export function characterUnlockHint(character, profile) {
  const u = character.unlock;
  if (u === undefined) return null;
  const m = profile.milestones;
  const parts = [];
  if (u.bestWave !== undefined && m.bestWave < u.bestWave) {
    parts.push('reach wave ' + u.bestWave + ' (best ' + m.bestWave + ')');
  }
  if (u.bestTime !== undefined && m.bestTime < u.bestTime) {
    parts.push('survive ' + Math.round(u.bestTime / 60) + ' minutes in one drift');
  }
  if (u.totalKills !== undefined && m.totalKills < u.totalKills) {
    parts.push(u.totalKills.toLocaleString() + ' total kills ('
      + m.totalKills.toLocaleString() + ')');
  }
  if (u.runs !== undefined && m.runs < u.runs) {
    parts.push(u.runs + ' drifts logged (' + m.runs + ')');
  }
  if (u.totalBossKills !== undefined && m.totalBossKills < u.totalBossKills) {
    parts.push(u.totalBossKills + ' Anomalies put down (' + m.totalBossKills + ')');
  }
  if (u.totalPlaytime !== undefined && m.totalPlaytime < u.totalPlaytime) {
    parts.push(Math.round(u.totalPlaytime / 3600) + ' hours drifted total ('
      + (m.totalPlaytime / 3600).toFixed(1) + ')');
  }
  if (parts.length === 0) return null;
  // Capitalise the first part only — the rest read as a comma list, not a
  // run of separate sentences.
  return parts[0].charAt(0).toUpperCase() + parts[0].slice(1)
    + (parts.length > 1 ? ', ' + parts.slice(1).join(', ') : '');
}

/** Progress toward a character's unlock, 0-1. Drives the progress bar. */
export function characterUnlockProgress(character, profile) {
  const u = character.unlock;
  if (u === undefined) return 1;
  const m = profile.milestones;
  const pairs = [
    [u.bestWave, m.bestWave], [u.bestTime, m.bestTime],
    [u.totalKills, m.totalKills], [u.runs, m.runs],
    [u.totalBossKills, m.totalBossKills], [u.totalPlaytime, m.totalPlaytime],
  ].filter(([need]) => need !== undefined);
  if (pairs.length === 0) return 1;
  let worst = 1;
  for (const [need, have] of pairs) worst = Math.min(worst, Math.min(1, have / need));
  return worst;
}

export function unlockedCharacters(profile) {
  return CHARACTERS.filter((c) => isCharacterUnlocked(c, profile));
}
