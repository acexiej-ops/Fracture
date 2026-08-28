/**
 * camera.js — smoothed follow camera, clamped to the arena.
 *
 * A small amount of lag, plus a lead in the direction of travel, makes movement
 * feel weighty without the screen ever feeling like it's fighting the player.
 */

import { damp, clamp } from '../core/math.js';
import { rng } from '../core/rng.js';
import { quality } from '../meta/settings.js';
import { arenaBounds } from '../game/state.js';

const FOLLOW_LAMBDA = 9;
const LOOK_AHEAD = 0.14;   // fraction of current velocity to lead by

export function updateCamera(state, dt, viewW, viewH) {
  const cam = state.camera;
  const p = state.player;

  cam.x = damp(cam.x, p.x + p.vx * LOOK_AHEAD, FOLLOW_LAMBDA, dt);
  cam.y = damp(cam.y, p.y + p.vy * LOOK_AHEAD, FOLLOW_LAMBDA, dt);

  // Don't show the void outside the arena — unless the arena (or, during a
  // boss fight, the shrunk bounds around it) is smaller than the window, in
  // which case centre it.
  const bounds = arenaBounds(state);
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  const halfW = viewW / 2;
  const halfH = viewH / 2;
  cam.x = w <= viewW ? (bounds.minX + bounds.maxX) / 2 : clamp(cam.x, bounds.minX + halfW, bounds.maxX - halfW);
  cam.y = h <= viewH ? (bounds.minY + bounds.maxY) / 2 : clamp(cam.y, bounds.minY + halfH, bounds.maxY - halfH);
}

/** Per-frame shake offset. Read by the renderer, never stored on the camera. */
const ZERO_SHAKE = [0, 0];

export function shakeOffset(state) {
  // Performance mode zeroes shake, and so does the standalone "reduce shake"
  // toggle — that one exists for motion sensitivity, which is a separate
  // reason from framerate and should not require dropping visual quality.
  if (quality().screenShake <= 0) return ZERO_SHAKE;
  const s = state.camera.shake;
  if (s <= 0.01) return [0, 0];
  return [rng.range(-s, s), rng.range(-s, s)];
}
