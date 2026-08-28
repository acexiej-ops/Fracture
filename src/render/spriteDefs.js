/**
 * spriteDefs.js — every sprite in the game, authored procedurally.
 *
 * Nothing here rasterises at import time; `defineSprite` only records a
 * `draw(buf, frame)` callback that the cache in pixel.js calls on first use.
 * So this file is a catalogue, and adding art means adding an entry — which
 * is the property Phases 3 and 4 depend on, since a weapon roster and a
 * character roster both need to mint sprites from data rather than by hand.
 *
 * Authoring convention: art-pixels, not screen-pixels. Each sprite picks a
 * grid size proportional to the thing it represents so that **pixel density
 * stays constant across the game** — a Warped Bulwark is not a Warped Drifter
 * scaled up, it is a bigger sprite made of the same-sized pixels, which is
 * how pixel art actually works and the main thing that keeps a mixed screen
 * looking like one coherent set.
 */

import {
  defineSprite, PixelBuffer, ramp, mix, ICHOR, RARITY_PALETTES,
} from './pixel.js';
import { ENEMY_TYPES } from '../game/config.js';
import { CHARACTERS } from '../meta/characters.js';

// Enemies author at 2 screen-px per art-px: fine enough for a readable
// silhouette at a 13px-radius grunt, chunky enough to still read as pixels.
const ENEMY_SCALE = 2;

/** Grid size for a body of `radius` world-units, plus margin for outline,
 *  spikes and Ichor leak (which draws *outside* the silhouette). */
function gridFor(radius) {
  return Math.ceil((radius / ENEMY_SCALE) * 2) + 7;
}

// ---------------------------------------------------------------------------
// Warped body shapes
//
// Each generator draws a filled silhouette in `p.base`, then adds interior
// shading (`p.dark` low, `p.light` high) and one bright "eye"/core pixel
// cluster. That last part matters more than it sounds: at this size a single
// bright feature is what makes a shape read as a *creature* rather than a
// polygon, which is the whole difference between the old vector look and this.
// ---------------------------------------------------------------------------

/**
 * FRAMES is 6, not 3, and that is the single biggest change to how the Warped
 * read on screen.
 *
 * Three frames can only do "up, middle, down" — a bob. Six gives room for an
 * actual cycle: a lead limb, a trailing limb, a squash on the plant and a
 * stretch on the lift. That is the difference between a shape that pulses and
 * a creature that walks.
 *
 * Every body follows the same skeleton so the roster reads as one species:
 *   step   -1/0/+1, the vertical bob of the whole body
 *   phase  0..1 through the cycle, for anything continuous
 *   lead   which side's limb is forward this frame
 * plus at least one *non-locomotion* feature that animates on a different
 * period — a blink, a charging core, a shifting plate. Motion that is all one
 * frequency reads as mechanical; a second, slower rhythm reads as alive.
 */
const FRAMES = 6;

/**
 * Body bob and limb swing, in QUADRATURE — bob on sine, limb on cosine.
 *
 * This matters more than it looks. The obvious implementation is a lookup
 * like [0,-1,-1,0,1,1] for the bob and a "which half of the cycle" flag for
 * the limb, and that is what this was first: it produced only 3-5 genuinely
 * distinct frames out of 6, because several frames landed on the same (bob,
 * limb) pair and rendered pixel-identical. A Warped Mote had three unique
 * frames pretending to be six.
 *
 * Offsetting the two by a quarter cycle guarantees every frame is a different
 * combination, which is also just how a walk works: the body is lowest when a
 * leg is planted, not when it is swinging.
 */
const stepOf = (f) => Math.round(Math.sin((f % FRAMES) / FRAMES * Math.PI * 2) * 1.6);
const limbOf = (f) => Math.round(Math.cos((f % FRAMES) / FRAMES * Math.PI * 2) * 1.6);
/** Which limb leads. Derived from the swing so it never fights it. */
const leadOf = (f) => (limbOf(f) >= 0 ? 1 : -1);
/** Slow blink — open for most of the cycle, shut for one frame. */
const blinkOf = (f) => (f % FRAMES) === 4;

const BODIES = {
  /** Drifter — a hunched operator-shape that still walks like it used to. */
  triangle(buf, p, r, cx, cy, f) {
    const step = stepOf(f), lead = leadOf(f);
    const y = cy + step;

    // Legs first so the body covers their tops.
    const sw = limbOf(f);
    buf.rect(cx - 2, y + r * 0.5, 2, Math.max(1, r * 0.5 + sw), p.dark);
    buf.rect(cx + 1, y + r * 0.5, 2, Math.max(1, r * 0.5 - sw), p.dark);

    // Hunched wedge body, pointing along its heading.
    buf.poly([cx + r, y, cx - r * 0.7, y - r * 0.85, cx - r * 0.3, y, cx - r * 0.7, y + r * 0.85], p.base);
    buf.poly([cx + r, y, cx - r * 0.7, y - r * 0.85, cx - r * 0.35, y - r * 0.15], p.light);
    // A single eye that blinks — the cheapest possible "this is alive" cue.
    if (!blinkOf(f)) buf.disc(cx + r * 0.25, y - r * 0.1, Math.max(1, r * 0.18), p.hilite);
    else buf.rect(cx + r * 0.1, y - r * 0.1, 2, 1, p.outline);
  },


  /** Cinderling - a burning husk, guttering as it walks. */
  cinderling(buf, p, r, cx, cy, f) {
    const step = stepOf(f), sw = limbOf(f);
    const y = cy + step;
    buf.rect(cx - 2, y + r * 0.5, 2, Math.max(1, r * 0.5 + sw), p.dark);
    buf.rect(cx + 1, y + r * 0.5, 2, Math.max(1, r * 0.5 - sw), p.dark);
    buf.disc(cx, y, r * 0.8, p.base);
    buf.disc(cx, y - r * 0.2, r * 0.45, p.light);
    // The flame gutters on the off-frames, so it never reads as a static glow.
    const lick = f % 2 === 0 ? r * 0.9 : r * 0.6;
    buf.poly([cx, y - lick - r * 0.5, cx - r * 0.35, y - r * 0.5, cx + r * 0.35, y - r * 0.5], p.hilite);
    if (!blinkOf(f)) buf.set(cx, y - r * 0.15, p.outline);
  },

  /** Rimewalker - stiff and crystalline, refracting at the edges. */
  rime(buf, p, r, cx, cy, f) {
    const y = cy + stepOf(f);
    const sw = limbOf(f);
    buf.poly([cx, y - r, cx + r * 0.75, y - r * 0.3, cx + r * 0.5, y + r * 0.9,
              cx - r * 0.5, y + r * 0.9, cx - r * 0.75, y - r * 0.3], p.base);
    buf.poly([cx, y - r, cx + r * 0.75, y - r * 0.3, cx, y], p.light);
    // Shards that catch light on alternate frames.
    buf.set(cx - r * 0.9, y - r * 0.5 + sw, p.hilite);
    buf.set(cx + r * 0.9, y + r * 0.2 - sw, p.hilite);
    if (!blinkOf(f)) {
      buf.set(cx - r * 0.3, y - r * 0.25, p.outline);
      buf.set(cx + r * 0.3, y - r * 0.25, p.outline);
    }
  },

  /** Sporecarrier - bloated, with a sac that pulses out of step with its walk. */
  spore(buf, p, r, cx, cy, f) {
    const y = cy + stepOf(f);
    const phase = (f % FRAMES) / FRAMES;
    // Cosine against the sine-driven bob, so the pulse never lines up with the
    // step and the two never collapse into one motion.
    const swell = 1 + Math.cos(phase * Math.PI * 2) * 0.18;
    buf.disc(cx, y + r * 0.15, r * 0.85 * swell, p.base);
    buf.disc(cx - r * 0.2, y - r * 0.1, r * 0.4 * swell, p.light);
    buf.disc(cx + r * 0.45, y - r * 0.55, r * 0.3 * swell, p.hilite);
    if (!blinkOf(f)) buf.set(cx - r * 0.15, y + r * 0.1, p.outline);
  },

  /** Conduit - a floating node, arcing between its own two poles. */
  conduit(buf, p, r, cx, cy, f) {
    const y = cy + stepOf(f);
    buf.rect(cx - r * 0.25, y - r, r * 0.5, r * 2, p.base);
    buf.disc(cx, y, r * 0.5, p.light);
    // The arc jumps ends each frame - cheap, and reads as live current.
    const top = f % 2 === 0;
    const ay = top ? y - r : y + r;
    buf.set(cx - r * 0.7, ay, p.hilite);
    buf.set(cx + r * 0.7, ay, p.hilite);
    buf.set(cx, ay, p.hilite);
    if (!blinkOf(f)) buf.set(cx, y, p.outline);
  },

  /** Skimmer — fast and thin, leaning into its own motion. */
  diamond(buf, p, r, cx, cy, f) {
    const phase = (f % FRAMES) / FRAMES;
    const stretch = 1 + Math.sin(phase * Math.PI * 2) * 0.16;
    const y = cy + stepOf(f);
    buf.poly([cx, y - r * 1.15 * stretch, cx + r * 0.6, y, cx, y + r * 1.15 * stretch, cx - r * 0.6, y], p.base);
    buf.poly([cx, y - r * 1.15 * stretch, cx + r * 0.6, y, cx, y], p.light);
    // Speed streaks behind it, alternating side — reads as darting.
    const sw = limbOf(f);
    buf.set(cx - r * 0.9, y + sw, p.dark);
    buf.set(cx - r * 1.2, y + sw * 1.6, p.dark);
    if (sw !== 0) buf.set(cx - r * 1.5, y + sw * 2, p.dark);
    if (!blinkOf(f)) buf.rect(cx - 1, y - 1, 2, 2, p.hilite);
  },

  /** Hulk — a heavy slab that visibly lands each step. */
  square(buf, p, r, cx, cy, f) {
    const step = stepOf(f), lead = leadOf(f);
    const y = cy + step;
    // Squash on the plant frames, stretch on the lift — weight.
    const sq = step > 0 ? 1.12 : step < 0 ? 0.94 : 1;
    const w = Math.round(r * 0.92 * sq);
    const h = Math.round(r * 0.92 / sq);

    const sw = limbOf(f);
    buf.rect(cx - 3, y + h - 1, 3, Math.max(1, 3 + sw), p.dark);
    buf.rect(cx + 1, y + h - 1, 3, Math.max(1, 3 - sw), p.dark);

    buf.rect(cx - w, y - h, w * 2, h * 2, p.base);
    buf.rect(cx - w, y - h, w * 2, Math.max(1, Math.round(h * 0.5)), p.light);
    buf.rect(cx - w, y + Math.round(h * 0.4), w * 2, Math.max(1, Math.round(h * 0.6)), p.dark);
    buf.line(cx - w, y, cx + w - 1, y, p.outline);
    // Two eyes under a plate brow.
    if (!blinkOf(f)) {
      buf.rect(cx - Math.round(w * 0.5), y - Math.round(h * 0.35), 2, 2, p.hilite);
      buf.rect(cx + Math.round(w * 0.2), y - Math.round(h * 0.35), 2, 2, p.hilite);
    }
  },

  /** Lunger — coils tight, then throws its spike forward. */
  pentagon(buf, p, r, cx, cy, f) {
    const fr = f % FRAMES;
    const y = cy + stepOf(f);
    // Coil through the first half, extend hard on the back half.
    const coil = fr < 3 ? 1 - fr * 0.06 : 0.88 + (fr - 3) * 0.14;
    buf.ngon(cx, y, r * coil, 5, p.base);
    buf.ngon(cx, y - r * 0.2, r * 0.5 * coil, 5, p.light);
    const reach = r * (fr >= 4 ? 1.45 : 1.05);
    buf.poly([cx, y - reach, cx + r * 0.26, y - r * 0.5, cx - r * 0.26, y - r * 0.5], p.hilite);
    if (!blinkOf(f)) buf.rect(cx - 1, y, 2, 2, p.outline);
  },

  /** Caster — planted, and visibly charging between shots. */
  hexagon(buf, p, r, cx, cy, f) {
    const fr = f % FRAMES;
    const y = cy + Math.round(limbOf(f) * 0.5);
    buf.ngon(cx, y, r, 6, p.base, 0);
    buf.ngon(cx, y, r * 0.62, 6, p.dark, 0);
    // The core charges over the cycle and discharges on the last frame — a
    // slower rhythm than the body, so it reads as a second system.
    const charge = fr / (FRAMES - 1);
    const coreR = Math.max(1, r * (0.2 + charge * 0.22));
    buf.disc(cx, y, coreR, fr === 5 ? p.hilite : p.light);
    if (fr === 5) buf.ring(cx, y, Math.round(r * 0.8), p.hilite);
  },

  /** Scuttler — many legs, moving out of phase with each other. */
  star(buf, p, r, cx, cy, f) {
    const fr = f % FRAMES;
    const y = cy + stepOf(f);
    buf.star(cx, y, r * 1.2, r * 0.48, 5, p.base, -Math.PI / 2 + fr * 0.18);
    buf.disc(cx, y, Math.max(1, r * 0.42), p.light);
    // Six skittering legs, each offset so they never move together.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + fr * 0.3;
      const wig = ((i + fr) % 2) * 0.8;
      buf.set(cx + Math.cos(a) * (r * 1.25 + wig), y + Math.sin(a) * (r * 1.25 + wig), p.dark);
    }
    if (!blinkOf(f)) buf.rect(cx - 1, y - 1, 2, 2, p.hilite);
  },

  /** Bulwark — armour plates that shift as it trudges. */
  octagon(buf, p, r, cx, cy, f) {
    const step = stepOf(f), lead = leadOf(f);
    const y = cy + step;
    const sw = limbOf(f);
    buf.rect(cx - 4, y + r * 0.72, 4, Math.max(1, 3 + sw), p.dark);
    buf.rect(cx + 1, y + r * 0.72, 4, Math.max(1, 3 - sw), p.dark);

    buf.ngon(cx, y, r, 8, p.dark, -Math.PI / 8);
    buf.ngon(cx, y, r * 0.78, 8, p.base, -Math.PI / 8);
    buf.ngon(cx, y, r * 0.38, 8, p.light, -Math.PI / 8);
    // Rivets rotate on their own period, faster than the walk.
    //
    // 0.2 rad/frame was too slow: at this radius consecutive frames rounded to
    // the same pixel, so two of the six rendered identically. Rotation speed
    // has to clear one whole art-pixel per frame or the animation quietly
    // does nothing — the constraint that a sub-pixel rotation is no rotation.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + (f % FRAMES) * 0.42;
      buf.set(cx + Math.cos(a) * r * 0.62, y + Math.sin(a) * r * 0.62, p.hilite);
    }
    if (!blinkOf(f)) {
      buf.rect(cx - 2 + Math.round(sw * 0.4), y - 1, 1, 2, ICHOR.light);
      buf.rect(cx + 1 + Math.round(sw * 0.4), y - 1, 1, 2, ICHOR.light);
    }
  },

  /** Mote — barely a body, so it is all shimmer. */
  circle(buf, p, r, cx, cy, f) {
    const phase = (f % FRAMES) / FRAMES;
    const pr = r * (0.86 + Math.sin(phase * Math.PI * 2) * 0.16);
    // Drifts on both axes in quadrature — a mote does not walk, it wanders,
    // and a purely radial pulse gave it only three distinct frames.
    const y = cy + stepOf(f);
    const x = cx + Math.round(limbOf(f) * 0.6);
    buf.disc(x, y, pr, p.base);
    buf.disc(x - pr * 0.25, y - pr * 0.25, Math.max(1, pr * 0.45), p.light);
    if ((f % FRAMES) % 3 === 0) buf.set(x, y - pr - 1, p.hilite);
  },

  /** Husk — a cracked shell around something building toward going off. */
  core(buf, p, r, cx, cy, f) {
    const fr = f % FRAMES;
    const y = cy + stepOf(f);
    buf.disc(cx, y, r, p.dark);
    buf.ring(cx, y, Math.round(r), p.base);
    // The core swells across the whole cycle and flashes at the top — a
    // countdown you can read from across the arena.
    const swell = 0.28 + (fr / (FRAMES - 1)) * 0.4;
    buf.disc(cx, y, Math.max(1, r * swell), fr >= 4 ? p.hilite : p.light);
    // Cracks widen as it swells.
    buf.line(cx - r, y, cx + r, y, p.outline);
    buf.line(cx, y - r, cx, y + r, p.outline);
    if (fr >= 4) {
      buf.line(cx - r * 0.7, y - r * 0.7, cx + r * 0.7, y + r * 0.7, ICHOR.base);
      buf.line(cx + r * 0.7, y - r * 0.7, cx - r * 0.7, y + r * 0.7, ICHOR.base);
    }
  },

  // --- Anomalies: bigger grids, so more real detail rather than more scale.

  /** The Maw — a crown of teeth around a swallowing dark centre. */
  behemoth(buf, p, r, cx, cy, f) {
    const fr = f % FRAMES;
    const y = cy + stepOf(f);
    // The jaws open and close across the cycle.
    const gape = 0.62 + Math.sin((fr / FRAMES) * Math.PI * 2) * 0.12;
    buf.star(cx, y, r, r * gape, 9, p.base, fr * 0.09);
    buf.ngon(cx, y, r * 0.64, 9, p.dark, fr * 0.09);
    buf.disc(cx, y, r * 0.34, '#0a0410');
    buf.ring(cx, y, Math.round(r * 0.34), fr >= 3 ? ICHOR.light : ICHOR.base);
    // Inner teeth, counter-rotating.
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 - fr * 0.16;
      buf.disc(cx + Math.cos(a) * r * 0.5, y + Math.sin(a) * r * 0.5, 1.6, p.hilite);
    }
  },

  /** The Choir — nested rings and a ring of orbiting voices. */
  warden(buf, p, r, cx, cy, f) {
    const fr = f % FRAMES;
    const y = cy + (fr % 2 === 0 ? 0 : -1);
    buf.ngon(cx, y, r, 6, p.base, 0);
    buf.ngon(cx, y, r * 0.82, 6, p.dark, 0);
    buf.ring(cx, y, Math.round(r * 0.55), p.light);
    const pulse = 0.24 + (fr / FRAMES) * 0.14;
    buf.disc(cx, y, r * pulse, fr >= 4 ? p.hilite : ICHOR.light);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + fr * 0.26;
      buf.disc(cx + Math.cos(a) * r * 0.92, y + Math.sin(a) * r * 0.92, 1.4, p.hilite);
    }
  },

  /** The Brood — visibly full of what it is about to release. */
  swarmQueen(buf, p, r, cx, cy, f) {
    const fr = f % FRAMES;
    const y = cy + stepOf(f);
    const petals = 8;
    // Petals flex open and closed — it breathes.
    const open = 0.68 + Math.sin((fr / FRAMES) * Math.PI * 2) * 0.12;
    for (let i = 0; i < petals; i++) {
      const a = (i / petals) * Math.PI * 2 + fr * 0.13;
      buf.disc(cx + Math.cos(a) * r * open, y + Math.sin(a) * r * open,
        r * 0.29, i % 2 === 0 ? p.base : p.dark);
    }
    buf.disc(cx, y, r * 0.55, p.base);
    buf.disc(cx, y, r * 0.34, p.light);
    buf.disc(cx, y, r * (0.12 + (fr / FRAMES) * 0.1), fr >= 4 ? p.hilite : ICHOR.light);
  },
};

/**
 * Register one sprite per Warped/Anomaly type.
 *
 * Corruption is applied by the cache (via the `c<n>` variant) rather than
 * baked in here, so a single definition covers every corruption level and an
 * elite that renders more corrupted than its base type costs one extra
 * cached canvas, not a second definition.
 */
export function registerEnemySprites() {
  for (const id in ENEMY_TYPES) {
    const t = ENEMY_TYPES[id];
    const body = BODIES[t.shape] ?? BODIES.circle;
    const size = gridFor(t.radius);
    const p = ramp(t.color);
    const artR = t.radius / ENEMY_SCALE;

    defineSprite('enemy:' + id, {
      w: size, h: size, frames: FRAMES, scale: ENEMY_SCALE,
      directional: t.shape === 'triangle' || t.shape === 'pentagon',
      draw: (buf, frame) => body(buf, p, artR, size / 2, size / 2, frame),
    });
  }
}

// ---------------------------------------------------------------------------
// The Driftwalker
// ---------------------------------------------------------------------------

/**
 * The player. A hooded scavenger silhouette rather than an arrow — the arrow
 * read as "a cursor", and a game whose whole fiction is *a person who learned
 * to carry Ichor* should show a person. Directional, since it always faces
 * whatever the auto-attack is targeting.
 *
 * The Ichor the Driftwalker carries is drawn as a violet core at the chest:
 * the one bit of corruption palette on a friendly sprite, which is exactly
 * the character's premise.
 */
export function registerPlayerSprite(paletteBase = '#4fd8ff') {
  registerCharacterSprite('player', paletteBase, 'scav');
}

/**
 * Per-character silhouettes.
 *
 * Every Driftwalker shares a common base — a cloaked figure facing its
 * heading, carrying a violet Ichor core at the chest (the one bit of
 * corruption palette on a friendly sprite, which is the character's whole
 * premise) — and then a `build` function adds the silhouette change that
 * makes it recognisable at a glance. Sharing the base is deliberate: ten
 * unrelated shapes would stop reading as ten members of the same profession.
 *
 * The build is what carries the identity, not the colour, because colour
 * alone fails exactly when it matters — in a crowded frame at small size.
 */
const CHARACTER_BUILDS = {
  /** Baseline: nothing added. */
  scav() {},

  /** Bulwark: heavy pauldrons and a wider stance. */
  bulwark(buf, p, cx, cy, bob) {
    buf.rect(cx - 3, cy - 5 + bob, 4, 3, p.light);
    buf.rect(cx - 3, cy + 3 + bob, 4, 3, p.light);
    buf.rect(cx + 1, cy - 4 + bob, 2, 9, p.base);
  },

  /** Kite: swept-back streamers, nothing on the body at all. */
  kite(buf, p, cx, cy, bob, frame) {
    const sway = frame % 2 === 0 ? 0 : 1;
    buf.line(cx - 6, cy - 3 + bob, cx - 9, cy - 5 + bob - sway, p.light);
    buf.line(cx - 6, cy + 3 + bob, cx - 9, cy + 5 + bob + sway, p.light);
  },

  /** Gunner: a long barrel held forward. */
  gunner(buf, p, cx, cy, bob) {
    buf.rect(cx + 1, cy + 1 + bob, 7, 2, p.light);
    buf.set(cx + 8, cy + 1 + bob, p.hilite);
  },

  /** Warden: a deployment rack on the back. */
  warden(buf, p, cx, cy, bob) {
    buf.rect(cx - 5, cy - 3 + bob, 3, 6, p.light);
    buf.set(cx - 4, cy - 2 + bob, p.hilite);
    buf.set(cx - 4, cy + 1 + bob, p.hilite);
  },

  /** Vessel: overfull — Ichor visibly running down the whole body. */
  vessel(buf, p, cx, cy, bob, frame) {
    buf.set(cx - 1, cy - 2 + bob, ICHOR.base);
    buf.set(cx + 1, cy + 2 + bob, ICHOR.base);
    buf.set(cx - 2, cy + 1 + bob, ICHOR.light);
    if (frame % 2 === 0) buf.set(cx, cy + 3 + bob, ICHOR.dark);
  },

  /** Choirmaster: a small ring of orbiting motes. */
  swarm(buf, p, cx, cy, bob, frame) {
    for (let i = 0; i < 3; i++) {
      const a = frame * 0.5 + (i / 3) * Math.PI * 2;
      buf.set(cx + Math.cos(a) * 6, cy + Math.sin(a) * 5 + bob, p.hilite);
    }
  },

  /** Reaver: hooked blades at both flanks. */
  reaver(buf, p, cx, cy, bob) {
    buf.poly([cx + 2, cy - 4 + bob, cx + 6, cy - 6 + bob, cx + 4, cy - 3 + bob], p.hilite);
    buf.poly([cx + 2, cy + 4 + bob, cx + 6, cy + 6 + bob, cx + 4, cy + 3 + bob], p.hilite);
  },

  /** Longdrifter: a heavy pack, and a wide collection halo. */
  drifter(buf, p, cx, cy, bob, frame) {
    buf.rect(cx - 6, cy - 3 + bob, 4, 6, p.base);
    buf.rect(cx - 6, cy - 3 + bob, 4, 2, p.light);
    if (frame % 2 === 0) {
      buf.set(cx - 8, cy - 4 + bob, p.hilite);
      buf.set(cx - 8, cy + 4 + bob, p.hilite);
    }
  },

  /** Ashwalker: trailing embers, and a scorched trailing edge. */
  ember(buf, p, cx, cy, bob, frame) {
    buf.rect(cx - 5, cy - 1 + bob, 3, 3, p.hilite);
    const a = frame * 0.9;
    buf.set(cx - 7 - (frame % 2), cy - 3 + bob + Math.sin(a), p.light);
    buf.set(cx - 7 - (frame % 2), cy + 3 + bob - Math.sin(a), p.base);
  },

  /** Tidebreaker: a heavy round shield carried on the leading arm. */
  tide(buf, p, cx, cy, bob) {
    buf.rect(cx + 2, cy - 5 + bob, 3, 10, p.light);
    buf.rect(cx + 3, cy - 3 + bob, 1, 6, p.hilite);
    buf.set(cx + 2, cy + bob, p.hilite);
  },

  /** Nullhand: an empty, open palm — no weapon silhouette at all. */
  null_(buf, p, cx, cy, bob, frame) {
    const open = frame % 2 === 0 ? 1 : 0;
    buf.rect(cx + 3, cy - 2 + bob, 3, 4, p.light);
    buf.clearAt(cx + 4, cy + bob);
    if (open === 1) {
      buf.set(cx + 6, cy - 2 + bob, p.hilite);
      buf.set(cx + 6, cy + 2 + bob, p.hilite);
    }
  },

  /** Grave-Tender: a lantern swinging on a hooked pole. */
  tender(buf, p, cx, cy, bob, frame) {
    const swing = frame % 2 === 0 ? 0 : 1;
    buf.line(cx - 2, cy - 5 + bob, cx + 4, cy - 6 + bob, p.base);
    buf.rect(cx + 4, cy - 5 + bob + swing, 3, 3, p.hilite);
    buf.set(cx + 5, cy - 4 + bob + swing, ICHOR.light);
  },

  /** Splitspine: a doubled silhouette, one half a half-step behind. */
  echo(buf, p, cx, cy, bob, frame) {
    const lag = frame % 2 === 0 ? 2 : 3;
    buf.rect(cx - lag - 2, cy - 4 + bob, 4, 8, p.dark);
    buf.rect(cx - lag - 1, cy - 3 + bob, 2, 6, p.base);
  },

  /** Coilwright: a spool of live cable, arcing between two posts. */
  coil(buf, p, cx, cy, bob, frame) {
    buf.rect(cx - 5, cy - 4 + bob, 2, 8, p.light);
    buf.rect(cx + 3, cy - 4 + bob, 2, 8, p.light);
    if (frame % 2 === 0) {
      buf.set(cx - 2, cy - 3 + bob, p.hilite);
      buf.set(cx + 1, cy + 2 + bob, p.hilite);
    } else {
      buf.set(cx - 1, cy + 3 + bob, p.hilite);
      buf.set(cx + 2, cy - 2 + bob, p.hilite);
    }
  },

  /** Half-Warped: the silhouette itself is coming apart. */
  anomaly(buf, p, cx, cy, bob, frame) {
    buf.clearAt(cx - 3, cy - 2 + bob);
    buf.clearAt(cx - 1, cy + 2 + bob);
    buf.set(cx + 2, cy - 3 + bob, ICHOR.base);
    buf.set(cx - 4, cy + 1 + bob, ICHOR.light);
    const a = frame * 0.7;
    buf.set(cx + Math.cos(a) * 7, cy + Math.sin(a) * 6 + bob, ICHOR.base);
  },
};

/**
 * Register one Driftwalker sprite. Called per character by
 * `registerCharacterSprites`, and by `registerPlayerSprite` for the default.
 */
export function registerCharacterSprite(key, paletteBase, build = 'scav') {
  const p = ramp(paletteBase);
  const addBuild = CHARACTER_BUILDS[build] ?? CHARACTER_BUILDS.scav;

  defineSprite(key, {
    w: 19, h: 19, frames: 4, scale: 2, directional: true,
    draw: (buf, frame) => {
      const cx = 9, cy = 9;
      // Quadrature again, for the same reason the Warped needed it: the
      // obvious `frame === 1 || frame === 3 ? 0 : -1` gave frames 0 and 2 an
      // identical bob and no other difference, so the Driftwalker's four-frame
      // walk was really three frames with one repeated. Bob on sine, stride on
      // cosine, and all four are distinct.
      const bob = Math.round(Math.sin(frame / 4 * Math.PI * 2) * 1.2) - 1;
      const stride = Math.round(Math.cos(frame / 4 * Math.PI * 2) * 1.4);

      // Cloak: a wedge trailing behind the heading (sprite faces +x).
      buf.poly([cx - 6, cy - 4 + bob, cx + 1, cy - 3 + bob, cx + 1, cy + 3 + bob, cx - 6, cy + 4 + bob], p.dark);
      buf.poly([cx - 6, cy - 4 + bob, cx + 1, cy - 3 + bob, cx - 2, cy + bob], mix(p.dark, '#000000', 0.2));
      // A thin rim-light along the cloak's leading edge — the one line that
      // was missing between "a flat silhouette" and "a silhouette with a
      // light source." Traces the same edge the two polys above already
      // share, so it costs one more shape rather than reworking either.
      buf.line(cx - 6, cy - 4 + bob, cx + 1, cy - 3 + bob, mix(p.light, '#ffffff', 0.15));
      // Body / shoulders.
      buf.rect(cx - 2, cy - 3 + bob, 5, 6, p.base);
      buf.rect(cx - 2, cy - 3 + bob, 5, 2, p.light);
      // Forward cowl, now with its own dark seam so it reads as a wedge of
      // depth rather than a single flat triangle of colour.
      buf.poly([cx + 3, cy - 2 + bob, cx + 6, cy + bob, cx + 3, cy + 2 + bob], p.hilite);
      buf.line(cx + 3, cy - 2 + bob, cx + 3, cy + 2 + bob, mix(p.hilite, '#000000', 0.25));
      // Legs, swinging on the stride. This is the part that actually makes it
      // a walk rather than a hover — the cloak alone reads as floating.
      buf.rect(cx - 2, cy + 3 + bob, 2, Math.max(1, 3 + stride), p.dark);
      buf.rect(cx + 1, cy + 3 + bob, 2, Math.max(1, 3 - stride), p.dark);

      // The carried Ichor.
      buf.set(cx, cy + bob, ICHOR.light);
      buf.set(cx, cy + 1 + bob, ICHOR.base);
      // Trailing sparks, offset by the stride so no two frames match.
      buf.set(cx - 7, cy + bob + stride, ICHOR.dark);
      if (stride !== 0) buf.set(cx - 8, cy + bob + stride * 2, ICHOR.dark);

      addBuild(buf, p, cx, cy, bob, frame);
    },
  });
}

/** Register a sprite for every character in the roster. */
export function registerCharacterSprites(characters) {
  for (const c of characters) {
    registerCharacterSprite('char:' + c.id, c.palette, c.build);
  }
}

// ---------------------------------------------------------------------------
// Pickups
// ---------------------------------------------------------------------------

export function registerPickupSprites() {
  // XP mote: a small bright lozenge that breathes.
  const xp = ramp('#7ce7ff');
  defineSprite('orb:xp', {
    w: 9, h: 9, frames: 4, scale: 2,
    draw: (buf, frame) => {
      const r = [2.2, 2.8, 3.2, 2.8][frame];
      buf.disc(4, 4, r, xp.base);
      buf.disc(4, 4, r * 0.5, '#ffffff');
    },
  });

  // Material motes: one per material colour, drawn as a cut gem so they read
  // as a different *shape* from XP and not just a different colour.
  for (const [id, color] of Object.entries({
    slag: '#9fb3c8', filament: '#7ce7ff', alloy: '#ffb703',
    ichor: '#b45cff', core: '#ff5ec4',
  })) {
    const p = ramp(color);
    defineSprite('orb:mat:' + id, {
      w: 11, h: 11, frames: 4, scale: 2,
      draw: (buf, frame) => {
        const lift = [0, -1, 0, 1][frame];
        const cy = 5 + lift;
        buf.poly([5, cy - 4, 9, cy, 5, cy + 4, 1, cy], p.base);
        buf.poly([5, cy - 4, 9, cy, 5, cy], p.light);
        buf.set(5, cy - 1, p.hilite);
      },
    });
  }

  // Chests: one per rarity, lid seam and latch, with a lid that lifts on the
  // last frame so an unopened chest reads as impatient rather than static.
  for (const tier of ['common', 'rare', 'exotic']) {
    const p = RARITY_PALETTES[tier];
    defineSprite('chest:' + tier, {
      w: 15, h: 13, frames: 4, scale: 2,
      draw: (buf, frame) => {
        const lift = frame === 3 ? 1 : 0;
        buf.rect(2, 5, 11, 6, '#1a1f2b');
        buf.rect(2, 5, 11, 6, null);
        buf.rect(2, 5, 11, 6, mix('#1a1f2b', p.base, 0.15));
        buf.rect(2, 3 - lift, 11, 3, p.dark);       // lid
        buf.rect(2, 3 - lift, 11, 1, p.light);
        buf.rect(2, 6, 11, 1, p.base);              // seam
        buf.rect(6, 5 - lift, 3, 3, p.hilite);      // latch
        if (tier === 'exotic') {
          buf.set(1, 4 - lift, ICHOR.light);
          buf.set(13, 4 - lift, ICHOR.light);
        }
      },
    });
  }

  // Resonant node: a spinning crystal, the reliable rare-material source.
  const node = ramp('#ffe9a8');
  defineSprite('node', {
    w: 19, h: 19, frames: 4, scale: 2,
    draw: (buf, frame) => {
      const r = 6 + [0, 0.6, 1, 0.6][frame];
      buf.ngon(9, 9, r, 6, node.base, -Math.PI / 2 + frame * 0.12);
      buf.ngon(9, 9, r * 0.6, 6, node.hilite, -Math.PI / 2 + frame * 0.12);
      buf.disc(9, 9, 1.5, '#ffffff');
    },
  });
}

/**
 * Projectile sprites, minted by (colour, size, kind).
 *
 * Deliberately a *factory* rather than a fixed list: Phase 3 generates a
 * weapon roster from base types and modifiers, and every one of those needs
 * projectile art without a human authoring it. Calling this twice with the
 * same arguments returns the same cached key, so a roster of hundreds of
 * weapons still only mints one sprite per distinct look.
 */
const mintedProjectiles = new Set();

export function projectileSprite(color, size = 'md', kind = 'bolt') {
  const key = 'proj:' + kind + ':' + size + ':' + color;
  if (mintedProjectiles.has(key)) return key;
  mintedProjectiles.add(key);

  const p = ramp(color);
  const dims = { sm: 7, md: 9, lg: 13, xl: 17 }[size] ?? 9;
  const c = dims / 2;
  const r = dims / 2 - 1.5;

  const shapes = {
    /** A dart with a bright leading edge — reads as travelling. */
    bolt: (buf, frame) => {
      buf.poly([c + r, c, c - r, c - r * 0.55, c - r * 0.5, c, c - r, c + r * 0.55], p.base);
      buf.poly([c + r, c, c - r * 0.2, c - r * 0.3, c - r * 0.2, c + r * 0.3], '#ffffff');
      if (frame === 1) buf.set(c - r - 1, c, p.light);
    },
    /** A round slug — heavy, slow-reading. */
    orb: (buf, frame) => {
      buf.disc(c, c, r * (frame === 1 ? 1 : 0.88), p.base);
      buf.disc(c - r * 0.25, c - r * 0.25, r * 0.45, p.hilite);
    },
    /** A blade/shard — for orbiters and melee arcs. */
    shard: (buf) => {
      buf.poly([c, c - r, c + r * 0.5, c, c, c + r, c - r * 0.5, c], p.base);
      buf.poly([c, c - r, c + r * 0.5, c, c, c], p.hilite);
    },
    /** A ragged mote — for spread/pellet weapons. */
    pellet: (buf, frame) => {
      buf.disc(c, c, r * 0.7, p.base);
      if (frame % 2 === 0) buf.set(c, c, p.hilite);
    },
    /** A ring — for pulses, shockwaves and aura ticks. */
    ring: (buf, frame) => {
      buf.ring(c, c, Math.max(1, r - (frame % 2)), p.base);
      buf.ring(c, c, Math.max(1, r - 2), p.light);
    },
  };

  defineSprite(key, {
    w: dims, h: dims, frames: 2, scale: 2,
    directional: kind === 'bolt' || kind === 'shard',
    draw: shapes[kind] ?? shapes.bolt,
  });
  return key;
}

/** Register everything the base game needs. Idempotent. */
let registered = false;
export function registerAllSprites() {
  if (registered) return;
  registered = true;
  registerEnemySprites();
  registerPlayerSprite();
  registerCharacterSprites(CHARACTERS);
  registerPickupSprites();
}
