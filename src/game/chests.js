/**
 * chests.js — chest entities standing in the arena: spawning, opening, and
 * banking what comes out of them.
 *
 * Two spawn paths. `killEnemy` rolls a small per-kill chance and drops one
 * where the enemy died — no detour required, a chest just occasionally lands
 * in your path. `updateChests` separately spawns one "found in the open" every
 * `CHESTS.findInterval`, placed like a resonant node but with no guard pack:
 * unlike a node, a chest is meant to read as a pure bonus, not a fight you're
 * choosing to start.
 *
 * Opening is instant on contact, same as every other pickup in the game
 * (orbs, motes, nodes) — combat never pauses for it. The "event" feeling comes
 * from the reveal instead: a burst scaled to rarity, a chest-specific chime,
 * and a floating summary of what came out, all handled here and read once by
 * the HUD via `state.chestReveal`.
 */

import { ARENA, CHESTS } from './config.js';
import { rng } from '../core/rng.js';
import { removeAt } from './state.js';
import { spawnParticles } from './effects.js';
import { syncInventory } from './arsenalProgression.js';
import { rollChestTier, rollChestContents, performanceBonus } from '../meta/chests.js';
import { sfx } from '../audio/sfx.js';

export function updateChests(state, dt, profile) {
  state.chestFindTimer -= dt;
  if (state.chestFindTimer <= 0 && state.chests.length < CHESTS.findMaxActive) {
    state.chestFindTimer = CHESTS.findInterval;
    spawnFoundChest(state);
  }

  const player = state.player;

  for (let i = state.chests.length - 1; i >= 0; i--) {
    const c = state.chests[i];
    c.pulse += dt * 2.2;
    c.life -= dt;
    if (c.life <= 0) { removeAt(state.chests, i); continue; }

    if (!player.alive) continue;
    const dx = player.x - c.x, dy = player.y - c.y;
    const reach = CHESTS.radius + player.radius;
    if (dx * dx + dy * dy <= reach * reach) {
      openChest(state, c, profile);
      removeAt(state.chests, i);
    }
  }
}

/** Called from `killEnemy` — a small chance to drop a chest where it died. */
export function maybeDropChest(state, x, y) {
  const bonus = state.flags.salvageBonus;
  const chance = CHESTS.dropChance * (1 + bonus);
  if (rng.next() >= chance) return;

  state.chests.push({
    x, y,
    tier: rollChestTier(rng, performanceBonus(state.wave, state.kills) * 0.4),
    life: CHESTS.lifetime,
    maxLife: CHESTS.lifetime,
    pulse: rng.angle(),
    source: 'drop',
  });
}

function spawnFoundChest(state) {
  const p = state.player;

  for (let attempt = 0; attempt < 12; attempt++) {
    const angle = rng.angle();
    const dist = rng.range(CHESTS.minDistance, CHESTS.maxDistance);
    const x = p.x + Math.cos(angle) * dist;
    const y = p.y + Math.sin(angle) * dist;
    const pad = 80;
    if (x < pad || x > ARENA.width - pad || y < pad || y > ARENA.height - pad) continue;

    // A found chest is a deliberate detour, so it's weighted a little better
    // than a battlefield drop — the same shape as a resonant node paying off
    // more than an ordinary kill.
    state.chests.push({
      x, y,
      tier: rollChestTier(rng, 0.5 + performanceBonus(state.wave, state.kills) * 0.4),
      life: CHESTS.lifetime,
      maxLife: CHESTS.lifetime,
      pulse: rng.angle(),
      source: 'found',
    });
    return;
  }
}

function openChest(state, chest, profile) {
  const contents = rollChestContents(chest.tier, rng, profile);

  for (const id in contents.materials) {
    state.runMaterials[id] = (state.runMaterials[id] ?? 0) + contents.materials[id];
  }
  state.runCurrency += contents.currency;
  if (contents.gear !== null) state.runGear.push(contents.gear);

  state.chestsOpened++;

  // EVOLUTION TRIGGER.
  //
  // A chest is the only thing that evolves a weapon — never a level-up, never
  // a timer. That is deliberate: an evolution is the biggest single power
  // swing in a run, and tying it to a thing you physically walk over makes the
  // moment legible instead of it silently happening behind a menu.
  //
  // At most one evolution per chest, so a player holding two ready pairs gets
  // two distinct moments rather than one confusing double transformation.
  let evolution = null;
  if (state.inventory !== null && state.inventory !== undefined) {
    evolution = state.inventory.evolveViaChest();
    if (evolution !== null) {
      syncInventory(state);
      // A much bigger burst than the chest's own — this is the payoff.
      spawnParticles(state, chest.x, chest.y, 46, {
        color: '#ffd166', speed: 320, speedVar: 180, life: 0.9, lifeVar: 0.3,
        size: 4.5, drag: 2.5,
      });
      spawnParticles(state, chest.x, chest.y, 18, {
        color: '#ffffff', speed: 200, life: 0.4, size: 4,
      });
      state.addShake(14);
      sfx.craft('exotic');
    }
  }

  state.chestReveal = {
    tier: chest.tier,
    materials: contents.materials,
    currency: contents.currency,
    gearName: contents.gear !== null ? contents.gear.name : null,
    gearRarity: contents.gear !== null ? contents.gear.rarity : null,
    // Read by the renderer's reveal callout, so an evolution announces itself
    // in the same place the rest of a chest's contents already do.
    evolutionName: evolution !== null ? evolution.name : null,
    x: chest.x, y: chest.y,
    age: 0,
  };

  const scale = { common: 1, rare: 1.5, exotic: 2.2 }[chest.tier] ?? 1;
  spawnParticles(state, chest.x, chest.y, Math.round(18 * scale), {
    color: tierColor(chest.tier), speed: 220 * scale, speedVar: 130, life: 0.5, lifeVar: 0.2,
    size: 3.5, drag: 3.5,
  });
  spawnParticles(state, chest.x, chest.y, 8, {
    color: '#ffffff', speed: 140, life: 0.22, size: 3,
  });
  state.addShake(3 + scale * 3);
  sfx.chest(chest.tier);
}

function tierColor(tier) {
  return { common: '#9fb3c8', rare: '#ffb703', exotic: '#ff5ec4' }[tier] ?? '#9fb3c8';
}
