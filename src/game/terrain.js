/**
 * terrain.js — destructible objects, traps, and environmental hazards.
 *
 * Terrain objects sit in the arena and interact with gameplay:
 *   - Destructible crates/barrels drop materials when destroyed
 *   - Spike traps damage enemies AND the player
 *   - Explosive barrels detonate when hit, damaging everything nearby
 *   - Healing wells restore HP when walked over
 *
 * All terrain is procedural — no sprite assets needed. Objects are drawn
 * as simple geometric shapes with color coding.
 */

import { ARENA } from './config.js';
import { rng } from '../core/rng.js';
import { spawnParticles } from './effects.js';
import { healPlayer } from './player.js';

/**
 * Terrain object types.
 */
export const TERRAIN_TYPES = {
  crate: {
    id: 'crate',
    name: 'Scrap Crate',
    hp: 12,
    radius: 14,
    color: '#8a6b3d',
    dropChance: 0.7,
    dropMin: 1,
    dropMax: 3,
    destructible: true,
  },
  barrel: {
    id: 'barrel',
    name: 'Explosive Barrel',
    hp: 6,
    radius: 12,
    color: '#ff3b3b',
    destructible: true,
    explosive: true,
    explosionRadius: 120,
    explosionDamage: 45,
    explosionColor: '#ff8a3d',
  },
  spike: {
    id: 'spike',
    name: 'Ichor Spike',
    hp: Infinity,
    radius: 16,
    color: '#a97dff',
    destructible: false,
    trap: true,
    trapDamage: 5,
    trapInterval: 1.0,
    trapColor: '#a97dff',
  },
  well: {
    id: 'well',
    name: 'Healing Well',
    hp: Infinity,
    radius: 18,
    color: '#7dffa8',
    destructible: false,
    healAmount: 15,
    healCooldown: 8,
    healColor: '#7dffa8',
  },
  crystal: {
    id: 'crystal',
    name: 'Resonant Crystal',
    hp: 20,
    radius: 16,
    color: '#ffe066',
    destructible: true,
    dropChance: 1.0,
    dropMin: 3,
    dropMax: 8,
    dropMaterial: 'filament',
    xpOnDestroy: 15,
  },
  rock: {
    id: 'rock',
    name: 'Arena Rock',
    hp: 40,
    radius: 22,
    color: '#576574',
    destructible: true,
    blockMovement: true,
    blockProjectiles: true,
  },
};

/**
 * Spawn terrain objects at the start of a run.
 *
 * @param {number} wave - current wave number
 * @returns {Array} terrain objects
 */
export function generateTerrain(wave) {
  const objects = [];
  const count = 12 + Math.floor(wave * 1.5);

  for (let i = 0; i < count; i++) {
    const typeRoll = rng.next();
    let typeId;
    if (typeRoll < 0.35) typeId = 'crate';
    else if (typeRoll < 0.50) typeId = 'barrel';
    else if (typeRoll < 0.60) typeId = 'spike';
    else if (typeRoll < 0.68) typeId = 'well';
    else if (typeRoll < 0.78) typeId = 'crystal';
    else typeId = 'rock';

    const type = TERRAIN_TYPES[typeId];
    const x = rng.range(80, ARENA.width - 80);
    const y = rng.range(80, ARENA.height - 80);

    objects.push({
      id: 'terrain_' + i + '_' + Math.floor(rng.next() * 10000),
      type: typeId,
      x, y,
      hp: type.hp,
      maxHp: type.hp,
      radius: type.radius,
      alive: true,
      trapTimer: 0,
      healTimer: 0,
      hitFlash: 0,
    });
  }

  return objects;
}

/**
 * Spawn additional terrain when a new wave starts.
 */
export function spawnWaveTerrain(wave) {
  const extras = [];
  const count = Math.floor(1 + wave * 0.5);

  for (let i = 0; i < count; i++) {
    const typeRoll = rng.next();
    let typeId;
    if (typeRoll < 0.4) typeId = 'crate';
    else if (typeRoll < 0.55) typeId = 'barrel';
    else typeId = 'spike';

    const type = TERRAIN_TYPES[typeId];
    const x = rng.range(100, ARENA.width - 100);
    const y = rng.range(100, ARENA.height - 100);

    extras.push({
      id: 'terrain_w' + wave + '_' + i + '_' + Math.floor(rng.next() * 10000),
      type: typeId,
      x, y,
      hp: type.hp,
      maxHp: type.hp,
      radius: type.radius,
      alive: true,
      trapTimer: 0,
      healTimer: 0,
      hitFlash: 0,
    });
  }

  return extras;
}

/**
 * Damage a terrain object. Returns { destroyed, drops, explosion } info.
 */
export function damageTerrain(obj, damage, state) {
  if (!obj.alive) return { destroyed: false };
  const type = TERRAIN_TYPES[obj.type];
  if (type === undefined || !type.destructible) return { destroyed: false };

  obj.hp -= damage;
  obj.hitFlash = 0.15;

  if (obj.hp <= 0) {
    obj.alive = false;
    const result = { destroyed: true, drops: [], explosion: null, xp: type.xpOnDestroy ?? 0 };

    // Drop materials
    if (type.dropChance > 0 && rng.next() < type.dropChance) {
      const count = rng.int(type.dropMin, type.dropMax);
      const matId = type.dropMaterial ?? 'slag';
      result.drops.push({ material: matId, amount: count });
    }

    // Explosion
    if (type.explosive) {
      result.explosion = {
        x: obj.x, y: obj.y,
        radius: type.explosionRadius,
        damage: type.explosionDamage,
        color: type.explosionColor,
      };
    }

    // Destroy particles
    spawnParticles(state, obj.x, obj.y, 14, {
      color: type.color, speed: 200, speedVar: 100,
      life: 0.5, lifeVar: 0.2, size: 3, drag: 4,
    });

    return result;
  }
  return { destroyed: false };
}

/**
 * Tick terrain interactions (traps, healing wells).
 */
export function tickTerrain(objects, dt, state) {
  const p = state.player;
  if (!p.alive) return;

  for (const obj of objects) {
    if (!obj.alive) continue;
    const type = TERRAIN_TYPES[obj.type];
    if (type === undefined) continue;

    if (obj.hitFlash > 0) obj.hitFlash = Math.max(0, obj.hitFlash - dt);

    const dx = p.x - obj.x;
    const dy = p.y - obj.y;
    const dist = Math.hypot(dx, dy);
    const touchDist = obj.radius + p.radius;

    // Spike trap
    if (type.trap && dist < touchDist) {
      obj.trapTimer -= dt;
      if (obj.trapTimer <= 0) {
        obj.trapTimer = type.trapInterval;
        return { type: 'trap', damage: type.trapDamage, x: obj.x, y: obj.y };
      }
    }

    // Healing well
    if (type.healAmount !== undefined && dist < touchDist) {
      obj.healTimer -= dt;
      if (obj.healTimer <= 0) {
        obj.healTimer = type.healCooldown;
        healPlayer(state, type.healAmount);
        spawnParticles(state, obj.x, obj.y, 12, {
          color: type.healColor, speed: 100, life: 0.4, size: 2.5,
        });
        return { type: 'heal', amount: type.healAmount };
      }
    }
  }
  return null;
}

/**
 * Check if a projectile hits a terrain object.
 */
export function projectileHitsTerrain(proj, objects) {
  for (const obj of objects) {
    if (!obj.alive) continue;
    const type = TERRAIN_TYPES[obj.type];
    if (type === undefined || !type.blockProjectiles) continue;

    const dx = proj.x - obj.x;
    const dy = proj.y - obj.y;
    if (dx * dx + dy * dy < (obj.radius + (proj.radius ?? 4)) ** 2) {
      return obj;
    }
  }
  return null;
}
