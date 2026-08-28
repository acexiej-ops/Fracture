/**
 * nodes.js — resonant nodes, the arena's rare-material source.
 *
 * A node is a decision rather than a pickup: it spawns far from the player, and
 * cracking it wakes a guard pack around them. Taking one means abandoning
 * whatever ground you had and fighting on unfamiliar terrain, which is exactly
 * the tension the material economy needs — otherwise rare mats would just be a
 * function of how long you survived.
 */

import { ARENA, NODES, WAVES } from './config.js';
import { rng } from '../core/rng.js';
import { removeAt } from './state.js';
import { spawnParticles } from './effects.js';
import { spawnEnemy, availableTypes } from './enemies.js';
import { spawnMaterialMote } from './xp.js';
import { rollNodeDrops, dropsPhysically } from '../meta/materials.js';

export function updateNodes(state, dt) {
  state.nodeTimer -= dt;

  if (state.nodeTimer <= 0 && state.nodes.length < NODES.maxActive) {
    state.nodeTimer = NODES.interval;
    spawnNode(state);
  }

  const player = state.player;

  for (let i = state.nodes.length - 1; i >= 0; i--) {
    const n = state.nodes[i];

    n.pulse += dt * 2.4;
    n.life -= dt;
    if (n.life <= 0) {
      fadeNode(state, n);
      removeAt(state.nodes, i);
      continue;
    }

    if (!player.alive) continue;

    const dx = player.x - n.x, dy = player.y - n.y;
    const reach = NODES.radius + player.radius;
    if (dx * dx + dy * dy <= reach * reach) {
      harvestNode(state, n);
      removeAt(state.nodes, i);
    }
  }
}

function spawnNode(state) {
  const p = state.player;

  // Try a few times for a spot that's both far enough away and inside the
  // arena; give up rather than placing one somewhere useless.
  for (let attempt = 0; attempt < 12; attempt++) {
    const angle = rng.angle();
    const dist = rng.range(NODES.minDistance, NODES.maxDistance);
    const x = p.x + Math.cos(angle) * dist;
    const y = p.y + Math.sin(angle) * dist;
    const pad = 90;
    if (x < pad || x > ARENA.width - pad || y < pad || y > ARENA.height - pad) continue;

    state.nodes.push({
      x, y,
      life: NODES.lifetime,
      maxLife: NODES.lifetime,
      pulse: rng.angle(),
    });
    return;
  }
}

function harvestNode(state, n) {
  const drops = rollNodeDrops(state.wave, rng);

  for (const id of drops) {
    if (dropsPhysically(id)) spawnMaterialMote(state, n.x, n.y, id);
    else state.runMaterials[id] = (state.runMaterials[id] ?? 0) + 1;
  }

  state.addShake(9);
  spawnParticles(state, n.x, n.y, 40, {
    color: '#ffe9a8', speed: 300, speedVar: 170, life: 0.7, lifeVar: 0.3,
    size: 4, drag: 3.2,
  });
  spawnParticles(state, n.x, n.y, 14, {
    color: '#ffffff', speed: 160, life: 0.3, size: 3,
  });

  // The cost: a guard pack, spawned in a ring around the node the player is
  // now standing in the middle of.
  const types = availableTypes(state.wave);
  const count = NODES.guards(state.wave);
  // Same missing cap as the boss summon paths in enemies.js — a node guard
  // pack spawned on top of an already-crowded field could push the total
  // well past WAVES.maxEnemies, the ceiling every other spawn path respects.
  for (let i = 0; i < count && state.enemies.length < WAVES.maxEnemies; i++) {
    const a = (i / count) * Math.PI * 2 + rng.range(-0.2, 0.2);
    const d = rng.range(150, 260);
    const type = rng.weighted(types, (t) => t.weight);
    spawnEnemy(state, type.id, n.x + Math.cos(a) * d, n.y + Math.sin(a) * d);
  }

  state.nodesHarvested++;
}

/** A node that timed out crumbles quietly rather than vanishing. */
function fadeNode(state, n) {
  spawnParticles(state, n.x, n.y, 10, {
    color: '#6f7f95', speed: 70, life: 0.5, size: 2.5,
  });
}
