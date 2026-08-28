/**
 * biomes.js — environmental hazards for the run's chosen biome.
 *
 * Self-contained on purpose: a hazard checks player distance and calls
 * `damagePlayer` or sets a slow field directly, rather than routing through
 * the weapon-authored `zones` system (ember trails, fissures). Those zones are
 * built and tuned to damage *enemies*; branching them to also threaten the
 * player would complicate a well-tested system for one feature. A hazard is
 * terrain, not a weapon — it earns its own small, separate update pass.
 *
 * Every hazard telegraphs before it does anything: `warnDuration` is a ring
 * with no effect, `activeDuration` is when it actually damages or slows.
 * Nothing here ever touches a build stat — only player position and health.
 */

import { ARENA, BIOMES } from './config.js';
import { rng } from '../core/rng.js';
import { removeAt } from './state.js';
import { spawnParticles } from './effects.js';
import { damagePlayer } from './player.js';

/** Pick a biome once, at run start. */
export function pickBiome(rngInstance) {
  const ids = Object.keys(BIOMES);
  return ids[Math.floor(rngInstance.next() * ids.length)];
}

export function updateBiomeHazards(state, dt) {
  const biome = BIOMES[state.biome];
  const cfg = biome.hazard;
  if (cfg === null) return;   // The Wastes: no hazard, nothing to do

  state.biomeSpawnTimer -= dt;
  if (state.biomeSpawnTimer <= 0 && state.biomeHazards.length < cfg.maxActive) {
    state.biomeSpawnTimer = cfg.interval;
    spawnHazard(state, cfg);
  }

  // Every tick, every active slow hazard the player is standing in competes to
  // set the strongest slow; if none apply this tick, the multiplier resets to
  // 1 rather than lingering from a hazard the player already left.
  let slowMult = 1;
  const player = state.player;

  for (let i = state.biomeHazards.length - 1; i >= 0; i--) {
    const h = state.biomeHazards[i];
    h.timer -= dt;

    if (h.phase === 'warn') {
      if (h.timer <= 0) {
        h.phase = 'active';
        h.timer = cfg.activeDuration;
        if (cfg.kind === 'damage') {
          spawnParticles(state, h.x, h.y, 20, {
            color: cfg.color, speed: 200, speedVar: 120, life: 0.4, size: 3.5, drag: 4,
          });
        }
      }
      continue;
    }

    // phase === 'active'
    if (h.timer <= 0) { removeAt(state.biomeHazards, i); continue; }

    const dx = player.x - h.x, dy = player.y - h.y;
    const inside = player.alive && dx * dx + dy * dy <= h.radius * h.radius;

    if (cfg.kind === 'damage' && inside) {
      h.tick -= dt;
      if (h.tick <= 0) {
        h.tick = cfg.tickInterval;
        damagePlayer(state, cfg.damagePerTick, h.x, h.y);
      }
    } else if (cfg.kind === 'slow' && inside) {
      slowMult = Math.min(slowMult, cfg.slowMult);
    }
  }

  state.player.envSlowMult = slowMult;
}

function spawnHazard(state, cfg) {
  const p = state.player;

  for (let attempt = 0; attempt < 10; attempt++) {
    const angle = rng.angle();
    const dist = rng.range(cfg.minDistance, cfg.maxDistance);
    const x = p.x + Math.cos(angle) * dist;
    const y = p.y + Math.sin(angle) * dist;
    const pad = cfg.radius + 20;
    if (x < pad || x > ARENA.width - pad || y < pad || y > ARENA.height - pad) continue;

    state.biomeHazards.push({
      x, y,
      radius: cfg.radius,
      phase: 'warn',
      timer: cfg.warnDuration,
      warnDuration: cfg.warnDuration,
      tick: 0,
      color: cfg.color,
    });
    return;
  }
}
