/**
 * tournament.js — a fixed run that is the same for everybody.
 *
 * WHY THIS CAN EXIST AT ALL
 * -------------------------
 * Every random decision in the simulation already draws from one seeded RNG
 * singleton (`core/rng.js`), and `startRun` already records its seed on the
 * state so a run can be replayed by passing the seed back in. So a shared run
 * is not a new system — it is the existing seed, chosen from the calendar
 * instead of from Math.random.
 *
 * The one deliberate exception is the player's trail dust in player.js, which
 * uses Math.random directly. That is cosmetic — it spawns a particle and
 * touches no simulation state — so two players on the same seed see the same
 * run even though their dust differs. Anything that CAN affect the outcome
 * must draw from `rng`, and a future change that reaches for Math.random in
 * the simulation would quietly break fairness here.
 *
 * WHAT MAKES IT A CONTEST
 * -----------------------
 * Same seed is necessary but not sufficient. A shared seed with unrestricted
 * gear just measures who has farmed the most, so tournament runs also:
 *   - ignore equipped gear entirely (no loadout is applied)
 *   - fix the biome, so the terrain hazard is the same problem for everyone
 *   - apply a fixed set of enemy mutators drawn from the same seed
 *
 * What is NOT fixed is the character. Locking that would make the mode one
 * puzzle with one answer; leaving it open makes the week's ruleset a question
 * ("which of these sixteen handles THIS?") rather than a script.
 */

import { RNG } from '../core/rng.js';

/**
 * Enemy mutators. A tournament week picks two, deterministically from its own
 * seed, and they apply to every enemy that spawns.
 *
 * These multiply the spawned enemy's own numbers rather than replacing them,
 * for the same reason biome bias multiplies spawn weight: the wave curve stays
 * the tuned curve, and a mutator colours it instead of becoming a second
 * balance problem nobody has playtested.
 *
 * Every mutator has a downside as well as an upside. A week that is purely
 * "everything is harder" is not a different puzzle, it is just a smaller
 * number at the end.
 */
export const MUTATORS = {
  frenzied: {
    id: 'frenzied', name: 'Frenzied',
    blurb: 'The Warped move much faster, and die a little easier.',
    enemy: { speed: 1.35, hp: 0.85 },
  },
  armoured: {
    id: 'armoured', name: 'Ossified',
    blurb: 'Thicker plating, slower gait.',
    enemy: { hp: 1.5, speed: 0.85 },
  },
  swollen: {
    id: 'swollen', name: 'Swollen',
    blurb: 'Bigger, heavier, and they hit harder.',
    enemy: { radius: 1.25, mass: 1.4, damage: 1.2 },
  },
  brittle: {
    id: 'brittle', name: 'Brittle',
    blurb: 'They break easily. There are simply more of them.',
    enemy: { hp: 0.6, damage: 0.9 }, spawnRate: 1.45,
  },
  starving: {
    id: 'starving', name: 'Starving',
    blurb: 'Less Ichor in them. You level slower than you are used to.',
    enemy: { xp: 0.7 },
  },
  relentless: {
    id: 'relentless', name: 'Relentless',
    blurb: 'No pause between waves worth the name.',
    spawnRate: 1.3,
  },
  gilded: {
    id: 'gilded', name: 'Gilded',
    blurb: 'They carry more than they should. Worth the risk.',
    enemy: { hp: 1.25, xp: 1.6 },
  },
  hollowed: {
    id: 'hollowed', name: 'Hollowed',
    blurb: 'Fragile, fast, and far too many.',
    enemy: { hp: 0.7, speed: 1.2 }, spawnRate: 1.25,
  },
};

export const MUTATOR_IDS = Object.keys(MUTATORS);

/** Biomes a tournament can land on. Excludes the featureless starter map. */
const TOURNAMENT_BIOMES = ['cinder', 'frost', 'bloom', 'static_', 'hollow', 'emberfall'];

/**
 * The ISO-week key for a date, e.g. "2026-W35".
 *
 * ISO weeks rather than "days since epoch / 7" so the rotation lands on a
 * Monday in every timezone's local reckoning of the week, and so the label
 * shown to players matches what a calendar would call it.
 */
export function weekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // ISO weeks run Monday..Sunday; shift so the Thursday of the week determines the year.
  const day = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return d.getUTCFullYear() + '-W' + String(week).padStart(2, '0');
}

/** A stable 32-bit seed from a week key. */
function seedFromKey(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * The full ruleset for a given week.
 *
 * Derived entirely from the week key, so every client computes the identical
 * ruleset offline with no server involved. That is the reason this mode works
 * at all on a static site.
 */
export function tournamentFor(date = new Date()) {
  const key = weekKey(date);
  const seed = seedFromKey(key);

  // A private RNG, not the global one: deriving the ruleset must not advance
  // the sequence the actual run will draw from, or the run would differ
  // depending on whether the Hub had been opened first.
  const r = new RNG(seed);

  const biome = TOURNAMENT_BIOMES[Math.floor(r.next() * TOURNAMENT_BIOMES.length)];

  const pool = [...MUTATOR_IDS];
  const mutators = [];
  for (let i = 0; i < 2 && pool.length > 0; i++) {
    const idx = Math.floor(r.next() * pool.length);
    mutators.push(pool[idx]);
    pool.splice(idx, 1);
  }

  return { key, seed, biome, mutators };
}

/** Combined enemy multipliers for a ruleset. */
export function enemyMultipliers(ruleset) {
  const out = { hp: 1, speed: 1, damage: 1, radius: 1, mass: 1, xp: 1 };
  for (const id of ruleset.mutators) {
    const m = MUTATORS[id]?.enemy;
    if (m === undefined) continue;
    for (const k in m) out[k] = (out[k] ?? 1) * m[k];
  }
  return out;
}

/** Combined spawn-rate multiplier for a ruleset. */
export function spawnRateMultiplier(ruleset) {
  let out = 1;
  for (const id of ruleset.mutators) {
    const m = MUTATORS[id]?.spawnRate;
    if (typeof m === 'number') out *= m;
  }
  return out;
}

/**
 * Score a finished tournament run.
 *
 * Wave dominates and time breaks ties within a wave, because reaching wave 12
 * is a categorically better result than surviving a long time on wave 9 —
 * a pure-time score would reward stalling in a cleared arena, which is the
 * least interesting way to play.
 */
export function scoreRun({ wave = 0, time = 0, kills = 0 } = {}) {
  return Math.max(0, Math.floor(wave) * 100000 + Math.floor(time) * 100 + Math.min(kills, 99));
}

export function describeScore(score) {
  if (!Number.isFinite(score) || score <= 0) return 'No run yet';
  const wave = Math.floor(score / 100000);
  const time = Math.floor((score % 100000) / 100);
  const m = Math.floor(time / 60);
  const s = time % 60;
  return 'Wave ' + wave + ' - ' + m + ':' + String(s).padStart(2, '0');
}
