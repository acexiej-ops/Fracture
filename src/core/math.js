/** Small math helpers. Kept dependency-free and allocation-light. */

export const TAU = Math.PI * 2;

export const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);
export const lerp = (a, b, t) => a + (b - a) * t;

/** Frame-rate independent exponential smoothing toward a target. */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

export const dist2 = (ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay;
  return dx * dx + dy * dy;
};

export const dist = (ax, ay, bx, by) => Math.sqrt(dist2(ax, ay, bx, by));

/** Normalize a vector in place-ish; returns [x, y] scaled to `len`. */
export function normalize(x, y, len = 1) {
  const m = Math.hypot(x, y);
  if (m < 1e-6) return [0, 0];
  return [(x / m) * len, (y / m) * len];
}

/** Closest point on segment (x1,y1)-(x2,y2) to (px,py). Returns [x, y]. */
export function closestPointOnSegment(x1, y1, x2, y2, px, py) {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-6) return [x1, y1];
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return [x1 + dx * t, y1 + dy * t];
}

export function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
