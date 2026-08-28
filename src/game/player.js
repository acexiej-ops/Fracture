/**
 * player.js — movement, health, regeneration.
 *
 * Movement is intentionally snappy rather than physical: input maps almost
 * directly to velocity with a short smoothing window. In a game where you dodge
 * by weaving between enemies, acceleration ramps feel like input lag.
 */

import { PLAYER } from './config.js';
import { clamp, damp, closestPointOnSegment } from '../core/math.js';
import { spawnParticles } from './effects.js';
import { sfx } from '../audio/sfx.js';
import { arenaBounds } from './state.js';
import { rng } from '../core/rng.js';

const ACCEL_LAMBDA = 22;   // higher = snappier. 22 is "responsive but not twitchy".

export function updatePlayer(state, dt, input) {
  const p = state.player;
  if (!p.alive) return;

  // Surging (weapon modifier): a brief move-speed boost refreshed by landing
  // hits, so staying engaged keeps you fast — deliberately cutting against
  // the same turtling the enrage timer punishes.
  if (p.surgeTime > 0) p.surgeTime = Math.max(0, p.surgeTime - dt);
  const surgeMult = p.surgeTime > 0 ? 1.25 : 1;

  // Warding (weapon modifier): the shield pool decays on its own, so it is
  // uptime you maintain by casting rather than a bank you fill once.
  if (p.shield > 0) p.shield = Math.max(0, p.shield - dt * 2.2);

  const [ix, iy] = input.moveVector();
  // envSlowMult is set fresh each tick by biome hazards (e.g. Frostreach ice);
  // crowdSlowMult eases toward how many solid enemy contacts the player was
  // under last tick (see resolveBodyCollisions in enemies.js) — together
  // they're "the ground" and "the crowd" as two independent brakes on speed.
  const speed = state.stats.get('moveSpeed') * p.envSlowMult * p.crowdSlowMult * surgeMult;

  const targetVx = ix * speed;
  const targetVy = iy * speed;

  p.vx = damp(p.vx, targetVx, ACCEL_LAMBDA, dt);
  p.vy = damp(p.vy, targetVy, ACCEL_LAMBDA, dt);

  p.x += p.vx * dt;
  p.y += p.vy * dt;

  // Hard arena walls. Kill the velocity component so you don't stick.
  // Bounds shrink to a box around the fight while a boss is alive (see
  // arenaBounds/waves.js) so the boss can't simply be kited across the map.
  const r = p.radius;
  const bounds = arenaBounds(state);
  if (p.x < bounds.minX + r) { p.x = bounds.minX + r; p.vx = 0; }
  if (p.x > bounds.maxX - r) { p.x = bounds.maxX - r; p.vx = 0; }
  if (p.y < bounds.minY + r) { p.y = bounds.minY + r; p.vy = 0; }
  if (p.y > bounds.maxY - r) { p.y = bounds.maxY - r; p.vy = 0; }

  resolveWallCollisions(state);

  p.moving = ix !== 0 || iy !== 0;

  // The direction the PLAYER is travelling, kept separate from p.facing.
  //
  // p.facing is the aim direction — weapons.js rewrites it every frame to
  // point at the auto-target. Dashes used to read that, which is why they
  // fired off toward whatever enemy happened to be selected instead of where
  // you were steering. Movement and aim are genuinely different things here,
  // so they get separate fields.
  //
  // Held from the last non-zero input rather than reset to 0, so dashing
  // during the brief gap between keypresses (or while knocked back) still
  // goes the way you were last heading instead of snapping east.
  if (p.moving) p.moveAngle = Math.atan2(iy, ix);

  // Trail dust while moving — cheap motion cue on a dark background. Seeded,
  // not Math.random(): this used to desync a fixed-seed run (spawnParticles
  // below draws from the seeded rng too, so an unseeded gate deciding
  // whether that draw happens at all made every enemy spawn/roll after the
  // first dash diverge from the same seed run to run) — exactly the
  // reproducibility rng.js's own header comment promises, broken by one
  // cosmetic effect.
  if (p.moving && rng.bool(0.35)) {
    spawnParticles(state, p.x, p.y + r * 0.4, 1, {
      color: '#2f6f8f', speed: 20, speedVar: 15, life: 0.28, size: 2, drag: 4,
    });
  }

  if (p.invuln > 0) p.invuln = Math.max(0, p.invuln - dt);
  if (p.hitFlash > 0) p.hitFlash = Math.max(0, p.hitFlash - dt * 4);

  const regen = state.stats.get('regen');
  if (regen > 0 && p.hp < state.maxHp) {
    p.hp = Math.min(state.maxHp, p.hp + regen * dt);
  }
}

/**
 * Waller elites' walls block the player like a soft arena edge — solid only
 * once past their warn telegraph (see updateWalls in enemies.js), and only
 * against the player; enemies walk through their own walls freely, since the
 * point is to cut off *your* escape route, not to rebuild the arena for
 * everyone. A simple circle-vs-capsule push-out, same shape as every other
 * overlap resolution in this game.
 */
function resolveWallCollisions(state) {
  const p = state.player;
  const walls = state.walls;
  for (let i = 0; i < walls.length; i++) {
    const w = walls[i];
    if (w.phase !== 'solid') continue;

    const [cx, cy] = closestPointOnSegment(w.x1, w.y1, w.x2, w.y2, p.x, p.y);
    const dx = p.x - cx, dy = p.y - cy;
    const d2 = dx * dx + dy * dy;
    const minDist = p.radius + w.thickness / 2;
    if (d2 >= minDist * minDist || d2 < 1e-6) continue;

    const d = Math.sqrt(d2);
    const overlap = minDist - d;
    p.x += (dx / d) * overlap;
    p.y += (dy / d) * overlap;
    p.vx *= 0.3;
    p.vy *= 0.3;
  }
}

/** Returns true if the hit landed (i.e. wasn't eaten by i-frames). */
export function damagePlayer(state, amount, fromX, fromY) {
  const p = state.player;
  if (!p.alive || p.invuln > 0) return false;

  // PARRY. Checked before anything else, and it refuses the hit entirely
  // rather than reducing it — a parry that still chips you is just armour.
  // The counterattack is fired by the ability system on the next tick (see
  // abilities.js) so that this function stays a pure damage gate and does not
  // need to know what a counter looks like.
  if (p.parryTime > 0) {
    p.parrySuccess = true;
    p.parryFlash = 1;
    spawnParticles(state, p.x, p.y, 18, {
      color: '#ffffff', speed: 240, speedVar: 120, life: 0.3, size: 3.5,
    });
    state.addShake(8);
    return false;
  }

  // Warding's shield soaks first. A partly-absorbed hit still counts as a hit
  // (i-frames, knockback, the flash) — the shield reduces what it costs, not
  // whether it happened, which keeps the feedback honest.
  let incoming = amount;
  if (p.shield > 0) {
    const absorbed = Math.min(p.shield, incoming);
    p.shield -= absorbed;
    incoming -= absorbed;
    spawnParticles(state, p.x, p.y, 8, {
      color: '#8ff0ff', speed: 150, life: 0.3, size: 3,
    });
  }

  p.hp -= incoming;
  // One-Hit Death mode: a shield or a parry can still save you (both already
  // resolved above/before this point), but any damage that actually gets
  // through ends the run outright, regardless of remaining health.
  if (incoming > 0 && state.difficulty?.oneHit === true) p.hp = 0;
  p.invuln = PLAYER.invulnTime;
  p.hitFlash = 1;

  // Knock the player away from the attacker: gives a moment to disengage.
  const dx = p.x - fromX, dy = p.y - fromY;
  const m = Math.hypot(dx, dy) || 1;
  p.vx += (dx / m) * PLAYER.hitKnockback;
  p.vy += (dy / m) * PLAYER.hitKnockback;

  state.addShake(clamp(4 + amount * 0.35, 4, 14));
  spawnParticles(state, p.x, p.y, 12, {
    color: '#ff5a7a', speed: 190, life: 0.4, size: 3.5,
  });

  if (p.hp <= 0) {
    p.hp = 0;
    p.alive = false;
    state.addShake(26);
    spawnParticles(state, p.x, p.y, 70, {
      color: '#8ff0ff', speed: 340, speedVar: 200, life: 0.9, lifeVar: 0.4, size: 4, drag: 2.5,
    });
    sfx.playerDeath();
  } else {
    // Not rate-limited: i-frames already guarantee at least invulnTime between
    // calls, so this can never spam on its own.
    sfx.playerHit();
  }
  return true;
}

export function healPlayer(state, amount) {
  const p = state.player;
  const before = p.hp;
  p.hp = Math.min(state.maxHp, p.hp + amount);
  if (p.hp > before) {
    spawnParticles(state, p.x, p.y, 16, {
      color: '#7dffa8', speed: 120, life: 0.5, size: 3,
    });
  }
}
