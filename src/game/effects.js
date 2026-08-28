/**
 * effects.js — particles, floating damage numbers, screen shake.
 *
 * Purely cosmetic, but this is most of what makes a hit *feel* like a hit.
 * Everything here is capped and degrades gracefully under load: when the
 * particle budget is full we simply stop spawning rather than tanking the
 * frame rate.
 */

import { FX } from './config.js';
import { rng } from '../core/rng.js';
import { removeAt } from './state.js';
import { quality } from '../meta/settings.js';

export const particlePool = [];

export function spawnParticles(state, x, y, count, opts = {}) {
  // Quality gate. Particles are the single biggest per-frame cost in a heavy
  // wave — hundreds of independent draw calls — so this is the first thing
  // Performance mode turns down. particleScale 0 skips the work entirely
  // rather than spawning particles the renderer will then decline to draw.
  const q = quality();
  if (q.particleScale <= 0) return;
  count = Math.max(1, Math.round(count * q.particleScale));

  const {
    color = '#ffffff',
    speed = 160,
    speedVar = 90,
    life = 0.35,
    lifeVar = 0.15,
    size = 3,
    drag = 6,
    spread = Math.PI * 2,
    angle = 0,
  } = opts;

  const budget = Math.min(q.maxParticles, FX.maxParticles) - state.particles.length;
  if (budget <= 0) return;
  const n = Math.min(count, budget);

  for (let i = 0; i < n; i++) {
    const a = angle + rng.range(-spread / 2, spread / 2);
    const s = speed + rng.range(-speedVar, speedVar);
    const particle = particlePool.pop() ?? {};
    Object.assign(particle, {
      x, y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      life: life + rng.range(-lifeVar, lifeVar),
      maxLife: life + lifeVar,
      size: size * rng.range(0.7, 1.3),
      color,
      drag,
    });
    state.particles.push(particle);
  }
}

export function spawnDamageNumber(state, x, y, amount, crit = false) {
  if (!FX.damageNumbers) return;
  // Cap so a 400-enemy screen doesn't turn into a wall of text.
  if (state.damageNumbers.length > 60) return;
  state.damageNumbers.push({
    x: x + rng.range(-6, 6),
    y: y - 8,
    vy: -46,
    life: crit ? 0.75 : 0.5,
    maxLife: crit ? 0.75 : 0.5,
    text: crit ? `${Math.round(amount)}!` : String(Math.round(amount)),
    crit,
    // Drives the pop: overshoots past 1 in the first few frames, then settles.
    // A number that appears at full size reads as UI; one that punches out
    // reads as an impact, which is the whole point of it being there.
    pop: 0,
    // Sideways drift, so a stack of numbers on one big target fans out
    // instead of overprinting itself into an unreadable smear.
    vx: rng.range(-18, 18),
  });
}

export function updateEffects(state, dt) {
  const parts = state.particles;
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.life -= dt;
    if (p.life <= 0) {
      removeAt(parts, i);
      particlePool.push(p);
      continue;
    }
    const d = 1 - p.drag * dt;
    p.vx *= d;
    p.vy *= d;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }

  const nums = state.damageNumbers;
  for (let i = nums.length - 1; i >= 0; i--) {
    const n = nums[i];
    n.life -= dt;
    if (n.life <= 0) { removeAt(nums, i); continue; }
    n.y += n.vy * dt;
    n.vy += 42 * dt;   // slight arc, reads better than a straight rise
    n.x += n.vx * dt;
    n.vx *= 1 - Math.min(1, dt * 4);   // drift fans out, then settles
    if (n.pop < 1) n.pop = Math.min(1, n.pop + dt * 9);
  }

  // Purely visual, damage-free entities: detonation rings and crit arcs.
  const blasts = state.blasts;
  for (let i = blasts.length - 1; i >= 0; i--) {
    blasts[i].life -= dt;
    if (blasts[i].life <= 0) removeAt(blasts, i);
  }

  const arcs = state.arcs;
  for (let i = arcs.length - 1; i >= 0; i--) {
    arcs[i].life -= dt;
    if (arcs[i].life <= 0) removeAt(arcs, i);
  }

  // The chest-opened reveal ages out on its own timer rather than a life
  // count-down like everything else here, since it's read (and cleared) by
  // the HUD/renderer as a single object, not an array entry to remove.
  if (state.chestReveal !== null) {
    state.chestReveal.age += dt;
    if (state.chestReveal.age > FX.chestRevealDuration) state.chestReveal = null;
  }

  // Kill combo: the window resets on its own once nothing's died recently,
  // so a break in the action always shows the streak ending rather than just
  // quietly forgetting it.
  if (state.comboTimer > 0) {
    state.comboTimer -= dt;
    if (state.comboTimer <= 0) state.comboCount = 0;
  }

  if (state.critFlashTimer > 0) state.critFlashTimer -= dt;

  // hitStopTimer is deliberately NOT ticked here. During an active freeze,
  // main.js's `_simulate` returns before ever calling `updateEffects` — that's
  // the freeze — so decrementing the timer would have to happen in the one
  // place that still runs while frozen. See `_simulate`.

  if (state.camera.shake > 0) {
    state.camera.shake = Math.max(0, state.camera.shake - state.camera.shake * FX.screenShakeDecay * dt - 1 * dt);
  }
}
