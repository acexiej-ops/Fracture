/**
 * xp.js — XP orbs and the level-up trigger.
 *
 * Orbs use a magnet: once inside pickup radius they accelerate toward the
 * player instead of teleporting. The little stream of orbs chasing you after a
 * big kill is a big part of the reward loop.
 */

import { XP } from './config.js';
import { MATERIALS } from '../meta/materials.js';
import { rng } from '../core/rng.js';
import { removeAt, Phase } from './state.js';
import { spawnParticles } from './effects.js';

export function spawnXpOrbs(state, x, y, value) {
  // Big enemies drop several small orbs rather than one fat one — more
  // satisfying to hoover up, and the stream reads as a bigger reward.
  const count = value <= 1 ? 1 : Math.min(5, Math.ceil(value / 2));
  const per = value / count;
  for (let i = 0; i < count; i++) {
    const a = rng.angle();
    const d = rng.range(0, XP.scatter);
    state.orbs.push({
      x: x + Math.cos(a) * d,
      y: y + Math.sin(a) * d,
      vx: Math.cos(a) * rng.range(20, 70),
      vy: Math.sin(a) * rng.range(20, 70),
      value: per,
      radius: XP.orbRadius,
      magnetized: false,
      speed: 0,
      bob: rng.angle(),
    });
  }
}

/**
 * A material mote. Deliberately the same entity as an XP orb — it wants exactly
 * the same magnet, drift and collection behaviour, so reusing the orb path is
 * both less code and less to get wrong than a parallel system.
 */
export function spawnMaterialMote(state, x, y, materialId) {
  const a = rng.angle();
  state.orbs.push({
    kind: 'material',
    material: materialId,
    color: MATERIALS[materialId].color,
    x: x + Math.cos(a) * 8,
    y: y + Math.sin(a) * 8,
    vx: Math.cos(a) * rng.range(30, 90),
    vy: Math.sin(a) * rng.range(30, 90),
    value: 0,
    radius: XP.orbRadius + 2.5,
    magnetized: false,
    speed: 0,
    bob: rng.angle(),
  });
}

export function updateOrbs(state, dt) {
  const { orbs, player } = state;
  const pickupRadius = state.stats.get('pickupRadius');
  const pr2 = pickupRadius * pickupRadius;
  const collectDist = player.radius + XP.orbRadius + 4;

  for (let i = orbs.length - 1; i >= 0; i--) {
    const o = orbs[i];
    o.bob += dt * 5;

    const dx = player.x - o.x;
    const dy = player.y - o.y;
    const d2 = dx * dx + dy * dy;

    if (!o.magnetized && d2 < pr2) o.magnetized = true;

    if (o.magnetized) {
      const d = Math.sqrt(d2) || 1;
      o.speed = Math.min(XP.magnetSpeed, o.speed + XP.magnetAccel * dt);
      o.x += (dx / d) * o.speed * dt;
      o.y += (dy / d) * o.speed * dt;

      if (d < collectDist) {
        collectOrb(state, o);
        removeAt(orbs, i);
        continue;
      }
    } else {
      // Drift to a stop where it landed.
      o.vx *= 1 - 4 * dt;
      o.vy *= 1 - 4 * dt;
      o.x += o.vx * dt;
      o.y += o.vy * dt;
    }
  }
}

function collectOrb(state, orb) {
  if (orb.kind === 'material') {
    state.runMaterials[orb.material] = (state.runMaterials[orb.material] ?? 0) + 1;
    spawnParticles(state, orb.x, orb.y, 8, {
      color: orb.color, speed: 110, life: 0.4, size: 3,
    });
    return;
  }

  // The greed affix multiplies experience, not orb count, so it compounds with
  // pickup radius rather than duplicating it.
  state.xp += orb.value * (1 + state.flags.xpBonus);
  spawnParticles(state, orb.x, orb.y, 2, {
    color: '#8ff0ff', speed: 60, life: 0.2, size: 2,
  });

  // A single pickup can cross several thresholds late in a run.
  while (state.xp >= state.xpToNext) {
    state.xp -= state.xpToNext;
    state.level++;
    state.xpToNext = XP.toNextLevel(state.level);
    state.pendingLevelUps++;
  }

  if (state.pendingLevelUps > 0 && state.phase === Phase.PLAYING) {
    state.phase = Phase.LEVEL_UP;
  }
}
