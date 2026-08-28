/**
 * aiDirector.js — reactive AI Director that dynamically adjusts difficulty.
 *
 * Inspired by Left 4 Dead's AI Director, this system monitors player
 * performance in real-time and adjusts the spawning, enemy composition, and
 * environmental pressure to maintain a target engagement level.
 *
 * The Director runs a slow evaluation every 5 seconds, tracking:
 *   - Player DPS (damage dealt per second)
 *   - Player HP percentage (how close to death)
 *   - Kill rate (kills per second)
 *   - Time since last elite/boss kill
 *   - Current wave number
 *
 * Based on these metrics, it adjusts:
 *   - Spawn rate multiplier (0.6x - 1.6x)
 *   - Elite chance multiplier (0.5x - 2.0x)
 *   - Swarm probability boost
 *   - Environmental hazard frequency
 *   - Enrage grace period adjustment
 */

import { WAVES, ENRAGE } from './config.js';

/** Target engagement zone — the Director tries to keep the player here. */
const TARGET = {
  hpMin: 0.35,           // below this, Director eases off
  hpMax: 0.85,           // above this, Director ramps up
  killRateMin: 1.5,      // kills per second, below = too quiet
  killRateMax: 4.0,      // kills per second, above = too hectic
  dpsPerWave: 30,        // expected DPS per wave for "on track"
};

/** How aggressively the Director corrects. Higher = faster swings. */
const LAMBDA = {
  spawnRate: 0.12,
  eliteChance: 0.10,
  swarmBoost: 0.08,
  hazardBoost: 0.06,
};

/**
 * Create the initial Director state. Runs at the start of each run.
 */
export function createDirectorState() {
  return {
    timer: 0,
    evalInterval: 5,

    // Running averages (smoothed)
    playerDPS: 0,
    playerHpFrac: 1,
    killRate: 2,

    // Derived multipliers (0-2 range, centered at 1)
    spawnRateMult: 1,
    eliteChanceMult: 1,
    swarmBoost: 0,
    hazardBoost: 0,

    // Enrage adjustment
    enrageGraceBonus: 0,

    // Chaos engine: periodic spikes of intense pressure
    chaosTimer: 0,
    chaosInterval: 25,
    chaosActive: false,
    chaosDuration: 0,
    chaosMult: 1,
  };
}

/**
 * Tick the Director. Call once per game frame.
 *
 * @param {object} director - Director state
 * @param {number} dt - delta time in seconds
 * @param {object} state - game state (kills, damageDealt, player, wave, time)
 */
export function tickDirector(director, dt, state) {
  director.timer += dt;

  // Smooth HP fraction
  const hpFrac = state.hpFraction;
  director.playerHpFrac += (hpFrac - director.playerHpFrac) * 0.02;

  // Evaluate every N seconds
  if (director.timer >= director.evalInterval) {
    director.timer -= director.evalInterval;
    evaluate(director, state);
  }

  // Chaos engine: periodic difficulty spikes
  director.chaosTimer += dt;
  if (director.chaosActive) {
    director.chaosDuration -= dt;
    if (director.chaosDuration <= 0) {
      director.chaosActive = false;
      director.chaosMult = 1;
    }
  } else if (director.chaosTimer >= director.chaosInterval) {
    director.chaosTimer = 0;
    director.chaosActive = true;
    director.chaosDuration = rngRange(4, 8);
    director.chaosMult = rngRange(1.3, 1.8);
    // Reduce chaos interval as waves progress (more frequent spikes later)
    director.chaosInterval = Math.max(15, 25 - state.wave * 0.5);
  }
}

/**
 * Core evaluation — compare current metrics against targets and adjust.
 */
function evaluate(director, state) {
  // Kill rate (kills per second over this evaluation window)
  const windowSeconds = director.evalInterval;
  const recentKills = state.kills - (director._lastKills ?? 0);
  director._lastKills = state.kills;
  const killRate = recentKills / windowSeconds;
  director.killRate += (killRate - director.killRate) * 0.3;

  // DPS estimate (smoothed)
  const recentDPS = state.damageDealt / Math.max(1, state.time);
  director.playerDPS += (recentDPS - director.playerDPS) * 0.15;

  // --- Spawn rate ---
  // If player is healthy and killing fast, ramp spawns. If struggling, ease off.
  const hpPressure = director.playerHpFrac < TARGET.hpMin
    ? -(TARGET.hpMin - director.playerHpFrac) * 2
    : director.playerHpFrac > TARGET.hpMax
      ? (director.playerHpFrac - TARGET.hpMax) * 1.5
      : 0;

  const killPressure = director.killRate < TARGET.killRateMin
    ? -(TARGET.killRateMin - director.killRate) * 0.3
    : director.killRate > TARGET.killRateMax
      ? (director.killRate - TARGET.killRateMax) * 0.2
      : 0;

  const spawnTarget = 1 + hpPressure + killPressure;
  director.spawnRateMult += (Math.max(0.6, Math.min(1.6, spawnTarget))
    - director.spawnRateMult) * LAMBDA.spawnRate;

  // --- Elite chance ---
  // More elites when player is cruising, fewer when they're dying.
  const eliteTarget = 1 + hpPressure * 0.8 + killPressure * 0.5;
  director.eliteChanceMult += (Math.max(0.5, Math.min(2.0, eliteTarget))
    - director.eliteChanceMult) * LAMBDA.eliteChance;

  // --- Swarm boost ---
  // Swarms are a density pressure. Boost them when the player is doing well.
  const swarmTarget = Math.max(0, director.playerHpFrac - 0.5) * 2;
  director.swarmBoost += (Math.min(1, swarmTarget) - director.swarmBoost)
    * LAMBDA.swarmBoost;

  // --- Hazard boost ---
  // More environmental hazards as a soft pressure.
  const hazardTarget = director.playerHpFrac > 0.6 ? 0.3 : 0;
  director.hazardBoost += (hazardTarget - director.hazardBoost) * LAMBDA.hazardBoost;

  // --- Enrage grace ---
  // Give the player more breathing room if they're struggling.
  director.enrageGraceBonus = director.playerHpFrac < 0.3 ? 3 : 0;
}

/**
 * Get the effective spawn rate multiplier (combines Director + chaos).
 */
export function getSpawnRateMult(director) {
  return director.spawnRateMult * director.chaosMult;
}

/**
 * Get the effective elite chance multiplier.
 */
export function getEliteChanceMult(director) {
  return director.eliteChanceMult * director.chaosMult;
}

/**
 * Get the effective swarm probability boost (0-1).
 */
export function getSwarmBoost(director) {
  return Math.min(1, director.swarmBoost * director.chaosMult);
}

/**
 * Get the effective hazard frequency boost (0-1).
 */
export function getHazardBoost(director) {
  return Math.min(1, director.hazardBoost * director.chaosMult);
}

/**
 * Get the adjusted enrage grace time.
 */
export function getEnrageGrace(director) {
  return ENRAGE.graceTime + director.enrageGraceBonus;
}

/**
 * Is a chaos spike currently active?
 */
export function isChaosActive(director) {
  return director.chaosActive;
}

function rngRange(min, max) {
  return min + Math.random() * (max - min);
}
