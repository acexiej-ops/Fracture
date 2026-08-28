/**
 * pixel.js — the art pipeline. Everything drawn in this game that is meant to
 * look like a sprite comes from here.
 *
 * The whole approach in one paragraph: sprites are authored as small grids of
 * colour (16x16-ish), drawn procedurally in code by `draw(buf, frame)`
 * callbacks, rasterised **once** into an offscreen canvas at an integer
 * upscale with image smoothing off, cached, and thereafter blitted with a
 * single `drawImage`. That gets real blocky pixel art with no external asset
 * files, and — because the expensive part happens once per (sprite, frame,
 * variant, angle) rather than per draw — a screen holding 400 Warped costs
 * the same per-entity as the flat vector shapes it replaces.
 *
 * Why a grid rather than just drawing small vector shapes: a vector circle
 * scaled down is a smooth circle, and a *pixel* circle is a specific,
 * deliberately chunky staircase. The difference is the entire look. Authoring
 * on a grid also means "corruption" can be a per-pixel operation (see
 * `applyCorruption`), which is what lets a Warped Husk read as visibly
 * Ichor-eaten while a Warped Drifter barely does.
 *
 * Three things later phases depend on, so they are deliberately generic:
 *   - `PixelBuffer`  — the drawing surface + primitive set.
 *   - `defineSprite` / `drawSprite` — author once by key, blit anywhere.
 *   - `ramp` / palettes — limited, consistent colour per tier and rarity.
 */

// One art-pixel is this many screen pixels. 3 keeps sprites chunky enough to
// read as pixel art at the zoom this game plays at without turning a 16x16
// enemy into a billboard.
export const PIXEL_SCALE = 3;

// Directional sprites are pre-rendered at this many evenly spaced headings
// rather than rotated live: rotating a canvas per entity per frame would undo
// both the performance win and the crispness. 16 buckets is fine enough that
// the stepping reads as "sprite art" rather than as a bug.
const ANGLE_BUCKETS = 16;

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

/** '#rgb' | '#rrggbb' -> [r, g, b] */
export function hexToRgb(hex) {
  const h = String(hex).replace('#', '');
  const full = h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r, g, b) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}

/** Blend two hex colours. `t` 0 -> a, 1 -> b. */
export function mix(a, b, t) {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

export function shade(hex, amount) {
  return amount >= 0 ? mix(hex, '#ffffff', amount) : mix(hex, '#000000', -amount);
}

/**
 * A limited shade ramp from one base colour — the thing that makes a set of
 * sprites look like they belong to the same game. Deliberately only five
 * steps: pixel art reads better with a short, committed ramp than with a
 * smooth gradient, and a short ramp is also what keeps a palette "limited"
 * in the sense the style actually depends on.
 */
export function ramp(base) {
  return {
    outline: mix(base, '#05070c', 0.68),
    dark: mix(base, '#05070c', 0.42),
    base,
    light: mix(base, '#ffffff', 0.24),
    hilite: mix(base, '#ffffff', 0.52),
  };
}

/** The Ichor palette — what corruption paints onto everything it touches. */
export const ICHOR = ramp('#b45cff');

/** Gear/chest rarity palettes, matching meta/gear.js's rarity colours. */
export const RARITY_PALETTES = {
  common: ramp('#9fb3c8'),
  rare: ramp('#ffb703'),
  exotic: ramp('#ff5ec4'),
};

// ---------------------------------------------------------------------------
// PixelBuffer — a small grid with a primitive set, the authoring surface.
// ---------------------------------------------------------------------------

/**
 * A `w x h` grid of nullable colour strings. Null means transparent, which
 * matters: sprites are silhouettes on a dark field, so "no pixel" has to be a
 * real, distinct state rather than a background-coloured pixel.
 *
 * Coordinates are clipped rather than wrapped or thrown on, so a generator can
 * draw slightly outside its own bounds (a spike, a leak) without every call
 * site needing bounds arithmetic.
 */
export class PixelBuffer {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.data = new Array(w * h).fill(null);
  }

  inBounds(x, y) { return x >= 0 && x < this.w && y >= 0 && y < this.h; }

  set(x, y, color) {
    x |= 0; y |= 0;
    if (!this.inBounds(x, y) || color === null) return;
    this.data[y * this.w + x] = color;
  }

  get(x, y) {
    x |= 0; y |= 0;
    return this.inBounds(x, y) ? this.data[y * this.w + x] : null;
  }

  clearAt(x, y) {
    x |= 0; y |= 0;
    if (this.inBounds(x, y)) this.data[y * this.w + x] = null;
  }

  rect(x, y, w, h, color) {
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) this.set(x + i, y + j, color);
    }
  }

  /** Filled disc, using a squared-distance test so the edge steps honestly. */
  disc(cx, cy, r, color) {
    const r2 = r * r;
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy <= r2) this.set(x, y, color);
      }
    }
  }

  /** Hollow ring, one pixel thick. */
  ring(cx, cy, r, color) {
    const outer = r * r;
    const inner = (r - 1) * (r - 1);
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const dx = x - cx, dy = y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 <= outer && d2 > inner) this.set(x, y, color);
      }
    }
  }

  /** Bresenham. */
  line(x0, y0, x1, y1, color) {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, color);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  /** Scanline-filled polygon. `pts` is a flat [x0,y0, x1,y1, ...] list. */
  poly(pts, color) {
    let minY = Infinity, maxY = -Infinity;
    for (let i = 1; i < pts.length; i += 2) {
      if (pts[i] < minY) minY = pts[i];
      if (pts[i] > maxY) maxY = pts[i];
    }
    const n = pts.length / 2;
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      const xs = [];
      for (let i = 0; i < n; i++) {
        const ax = pts[i * 2], ay = pts[i * 2 + 1];
        const j = (i + 1) % n;
        const bx = pts[j * 2], by = pts[j * 2 + 1];
        if ((ay <= y && by > y) || (by <= y && ay > y)) {
          xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
        }
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let x = Math.ceil(xs[k]); x <= Math.floor(xs[k + 1]); x++) this.set(x, y, color);
      }
    }
  }

  /** Regular n-gon, filled. `rot` in radians. */
  ngon(cx, cy, r, sides, color, rot = -Math.PI / 2) {
    const pts = [];
    for (let i = 0; i < sides; i++) {
      const a = rot + (i / sides) * Math.PI * 2;
      pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    this.poly(pts, color);
  }

  /** Star, filled. Alternates between `r` and `innerR`. */
  star(cx, cy, r, innerR, points, color, rot = -Math.PI / 2) {
    const pts = [];
    for (let i = 0; i < points * 2; i++) {
      const a = rot + (i / (points * 2)) * Math.PI * 2;
      const rad = i % 2 === 0 ? r : innerR;
      pts.push(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
    }
    this.poly(pts, color);
  }

  /** Mirror the left half onto the right. Keeps hand-authored shapes symmetric. */
  mirrorX() {
    const half = Math.floor(this.w / 2);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < half; x++) {
        this.set(this.w - 1 - x, y, this.get(x, y));
      }
    }
  }

  /**
   * Trace a one-pixel outline around every filled region. This is the single
   * biggest reason the sprites read as sprites rather than as coloured blobs:
   * a dark keyline is what separates a silhouette from the background at this
   * size, and doing it here means no generator has to draw its own.
   */
  outline(color) {
    const additions = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.get(x, y) !== null) continue;
        if (this.get(x - 1, y) !== null || this.get(x + 1, y) !== null
          || this.get(x, y - 1) !== null || this.get(x, y + 1) !== null) {
          additions.push(x, y);
        }
      }
    }
    for (let i = 0; i < additions.length; i += 2) {
      this.set(additions[i], additions[i + 1], color);
    }
  }

  /** Every non-empty pixel becomes `color`. Used for the hit-flash variant. */
  flatten(color) {
    for (let i = 0; i < this.data.length; i++) {
      if (this.data[i] !== null) this.data[i] = color;
    }
  }

  /** Rasterise to an offscreen canvas at `scale` screen-pixels per art-pixel. */
  toCanvas(scale = PIXEL_SCALE) {
    const c = document.createElement('canvas');
    c.width = this.w * scale;
    c.height = this.h * scale;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const col = this.data[y * this.w + x];
        if (col === null) continue;
        g.fillStyle = col;
        g.fillRect(x * scale, y * scale, scale, scale);
      }
    }
    return c;
  }
}

// ---------------------------------------------------------------------------
// Corruption — the visual language for "how far gone is this thing".
// ---------------------------------------------------------------------------

/**
 * Deterministic hash-noise. Corruption has to look scattered but be *stable*:
 * re-deriving the same sprite must produce the same pixels, or a cached sprite
 * and a re-cached one would visibly differ.
 */
function noise2(x, y, seed) {
  let n = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  n = (n ^ (n >>> 13)) * 1274126177;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

/**
 * Eat into a finished sprite with Ichor, proportionally to `amount` (0-1).
 *
 * Three escalating effects, so the progression reads as a process rather than
 * a colour swap: at low corruption a few body pixels go violet; by the middle
 * the violet pixels start glowing (the light ramp); at high corruption the
 * silhouette itself starts breaking — pixels drop out entirely and stray
 * Ichor pixels bleed *outside* the original outline. A Warped Husk at 0.85
 * looks like it is coming apart, which is exactly what it is about to do.
 */
export function applyCorruption(buf, amount, seed = 1) {
  if (amount <= 0) return;

  for (let y = 0; y < buf.h; y++) {
    for (let x = 0; x < buf.w; x++) {
      if (buf.get(x, y) === null) continue;
      const n = noise2(x, y, seed);

      if (n < amount * 0.45) {
        buf.set(x, y, n < amount * 0.16 ? ICHOR.light : ICHOR.base);
      }
      // Past the halfway mark the body starts failing outright.
      if (amount > 0.5 && n > 1 - (amount - 0.5) * 0.22) buf.clearAt(x, y);
    }
  }

  // Ichor bleeding past the silhouette. Only at high corruption, and only
  // adjacent to existing pixels, so it reads as leaking rather than as noise.
  if (amount > 0.55) {
    const leaks = [];
    for (let y = 0; y < buf.h; y++) {
      for (let x = 0; x < buf.w; x++) {
        if (buf.get(x, y) !== null) continue;
        const touching = buf.get(x - 1, y) !== null || buf.get(x + 1, y) !== null
          || buf.get(x, y - 1) !== null || buf.get(x, y + 1) !== null;
        if (touching && noise2(x, y, seed + 99) < (amount - 0.55) * 0.5) leaks.push(x, y);
      }
    }
    for (let i = 0; i < leaks.length; i += 2) {
      buf.set(leaks[i], leaks[i + 1], ICHOR.dark);
    }
  }
}

// ---------------------------------------------------------------------------
// Sprite registry + cache
// ---------------------------------------------------------------------------

/**
 * key -> { w, h, frames, directional, draw(buf, frame) }
 *
 * Definitions are registered up front (see spriteDefs.js) but nothing is
 * rasterised until something actually asks to draw it, so a run only ever
 * pays for the sprites it uses.
 */
const defs = new Map();
const cache = new Map();

export function defineSprite(key, def) {
  defs.set(key, {
    w: def.w ?? 16,
    h: def.h ?? 16,
    frames: def.frames ?? 1,
    directional: def.directional === true,
    scale: def.scale ?? PIXEL_SCALE,
    draw: def.draw,
  });
  return key;
}

export function hasSprite(key) { return defs.has(key); }

export function spriteFrameCount(key) {
  const d = defs.get(key);
  return d === undefined ? 1 : d.frames;
}

/**
 * Rasterise (and memoise) one concrete variant of a sprite.
 *
 * `variant` is a free-form string so callers can cache derived looks —
 * 'flash' for the white hit-flash, `c<n>` for a corruption level — without
 * this module needing to know what every caller wants. It is part of the
 * cache key, so each distinct look is built exactly once.
 */
function rasterise(key, frame, variant, angleBucket) {
  const def = defs.get(key);
  if (def === undefined) return null;

  const buf = new PixelBuffer(def.w, def.h);
  def.draw(buf, frame, variant);

  if (variant.startsWith('c')) {
    const amount = Number(variant.slice(1)) / 100;
    if (Number.isFinite(amount)) applyCorruption(buf, amount, hashKey(key));
  }
  buf.outline('#05070c');
  if (variant === 'flash') buf.flatten('#ffffff');

  let canvas = buf.toCanvas(def.scale);

  if (def.directional && angleBucket !== 0) {
    const angle = (angleBucket / ANGLE_BUCKETS) * Math.PI * 2;
    const size = Math.ceil(Math.hypot(canvas.width, canvas.height));
    const rc = document.createElement('canvas');
    rc.width = size;
    rc.height = size;
    const g = rc.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.translate(size / 2, size / 2);
    g.rotate(angle);
    g.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
    canvas = rc;
  }

  return canvas;
}

function hashKey(key) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return h;
}

export function getSprite(key, frame = 0, variant = 'base', angleBucket = 0) {
  const def = defs.get(key);
  if (def === undefined) return null;
  const f = ((frame % def.frames) + def.frames) % def.frames;
  const b = def.directional ? ((angleBucket % ANGLE_BUCKETS) + ANGLE_BUCKETS) % ANGLE_BUCKETS : 0;
  const id = key + '|' + f + '|' + variant + '|' + b;

  let c = cache.get(id);
  if (c === undefined) {
    c = rasterise(key, f, variant, b);
    cache.set(id, c);
  }
  return c;
}

/** Radians -> the pre-baked heading bucket a directional sprite should use. */
export function angleToBucket(angle) {
  return Math.round((angle / (Math.PI * 2)) * ANGLE_BUCKETS) & (ANGLE_BUCKETS - 1);
}

/**
 * Blit a sprite centred on (x, y).
 *
 * `scale` here is an extra multiplier on top of the sprite's own pixel scale,
 * used for things that need to grow (a boss, a charged projectile) — kept
 * separate so the cached canvas stays one size and only the blit changes.
 */
export function drawSprite(ctx, key, x, y, opts = {}) {
  const {
    frame = 0, variant = 'base', angle = null, scale = 1, alpha = 1,
  } = opts;

  const bucket = angle === null ? 0 : angleToBucket(angle);
  const c = getSprite(key, frame, variant, bucket);
  if (c === null) return;

  const w = c.width * scale;
  const h = c.height * scale;

  const prevAlpha = ctx.globalAlpha;
  const prevSmooth = ctx.imageSmoothingEnabled;
  if (alpha !== 1) ctx.globalAlpha = prevAlpha * alpha;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(c, Math.round(x - w / 2), Math.round(y - h / 2), w, h);
  ctx.imageSmoothingEnabled = prevSmooth;
  if (alpha !== 1) ctx.globalAlpha = prevAlpha;
}

/**
 * The variant string for a given corruption level, quantised to 10% steps.
 *
 * Quantising is the point: corruption is a continuous 0-1 authoring value, but
 * caching a distinct rasterisation per possible float would defeat the cache
 * entirely. Ten buckets is far more gradation than the eye resolves on a
 * 16x16 sprite.
 */
export function corruptionVariant(amount) {
  if (amount <= 0) return 'base';
  return 'c' + Math.round(Math.min(1, amount) * 10) * 10;
}

/** Frame index for a time-driven looping animation. */
export function animFrame(time, fps, frames) {
  return Math.floor(time * fps) % frames;
}

/** Diagnostics — used by tests to confirm the cache is actually working. */
export function spriteCacheSize() { return cache.size; }
export function clearSpriteCache() { cache.clear(); }
export function registeredSprites() { return [...defs.keys()]; }
