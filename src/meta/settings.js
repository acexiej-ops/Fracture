/**
 * settings.js — player preferences that are not progress.
 *
 * Deliberately separate from Profile. Profile is *progress* — it syncs to the
 * cloud, merges across devices, and takes the better of two values. Settings
 * are per-device *preferences*, and merging them that way would be actively
 * wrong: performance mode is on because THIS machine is slow, so syncing it to
 * a fast one would be a bug, not a feature. So these live in their own
 * localStorage key and never leave the device.
 *
 * Everything here degrades to a default if storage is unavailable (private
 * browsing, storage disabled), same as the profile.
 */

const STORAGE_KEY = 'fracture.settings';

/**
 * Quality presets.
 *
 * `low` is not "the same game with fewer sparks" — it removes whole categories
 * of per-frame work. The expensive things in a Canvas 2D game of this shape,
 * roughly in order, are: overdraw from large translucent fills, per-particle
 * draw calls, text rasterisation (damage numbers), and full-screen passes
 * (vignette, flashes). Low mode cuts all four and keeps everything that
 * carries information — enemies, projectiles, health, pickups — untouched.
 *
 * That distinction is the design rule: performance mode may never remove
 * something you need to play. It removes decoration only.
 */
export const QUALITY = {
  high: {
    id: 'high', name: 'High',
    particleScale: 1.0,      // multiplier on every particle burst count
    maxParticles: 900,
    damageNumbers: true,
    floorDetail: true,       // the grid + biome texture underfoot
    vignette: true,
    critFlash: true,
    screenShake: 1.0,
    glows: true,             // radial gradients, elite rings, marker halos
    trails: true,
    hitFlash: true,
    renderScale: 1.0,
  },
  medium: {
    id: 'medium', name: 'Medium',
    particleScale: 0.5,
    maxParticles: 400,
    damageNumbers: true,
    floorDetail: true,
    vignette: true,
    critFlash: false,
    screenShake: 0.7,
    glows: false,
    trails: true,
    hitFlash: true,
    // Cap the backing store at 1x even on a HiDPI screen. A retina display
    // shades four times as many pixels per frame for a game drawn from chunky
    // pixel-art sprites that gain almost nothing from the extra resolution.
    renderScale: 1.0,
  },
  low: {
    id: 'low', name: 'Performance',
    particleScale: 0.0,      // no ambient particles at all
    maxParticles: 60,
    damageNumbers: false,
    floorDetail: false,
    vignette: false,
    critFlash: false,
    screenShake: 0.0,        // also helps motion sensitivity, not just fps
    glows: false,
    trails: false,
    hitFlash: true,          // KEPT: this is feedback, not decoration
    // The single biggest lever on a weak GPU: half-resolution backing store is
    // a quarter of the pixels shaded per frame. The art is deliberately chunky
    // pixel work, so it survives this far better than a detailed 2D game would.
    renderScale: 0.75,
  },
};

export const QUALITY_ORDER = ['high', 'medium', 'low'];

const DEFAULTS = {
  quality: 'high',
  language: 'en',
  showFps: false,
  // Independent of quality so a player on a fast machine can still turn off
  // shake for motion sickness without dropping to Performance.
  reduceShake: false,
};

function read() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') return { ...DEFAULTS };
    const out = { ...DEFAULTS };
    if (QUALITY[parsed.quality] !== undefined) out.quality = parsed.quality;
    if (typeof parsed.language === 'string') out.language = parsed.language;
    if (typeof parsed.showFps === 'boolean') out.showFps = parsed.showFps;
    if (typeof parsed.reduceShake === 'boolean') out.reduceShake = parsed.reduceShake;
    return out;
  } catch {
    return { ...DEFAULTS };
  }
}

let current = read();
const listeners = new Set();

export function getSettings() { return current; }

/** The resolved quality preset, with reduceShake folded in. */
export function quality() {
  const q = QUALITY[current.quality] ?? QUALITY.high;
  if (current.reduceShake && q.screenShake !== 0) return { ...q, screenShake: 0 };
  return q;
}

export function setSetting(key, value) {
  if (!(key in DEFAULTS)) return;
  current = { ...current, [key]: value };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(current)); } catch { /* non-fatal */ }
  for (const fn of listeners) { try { fn(current); } catch { /* a bad listener must not break settings */ } }
}

export function onSettingsChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/**
 * A one-time guess at whether this machine wants Performance mode.
 *
 * Only used to pick the DEFAULT on a device that has never chosen; an explicit
 * choice is always respected. Deliberately conservative — guessing "low" for
 * someone on a capable machine makes the game look worse for no reason, so
 * this only fires on strong signals.
 */
export function suggestQuality() {
  try {
    const cores = navigator.hardwareConcurrency ?? 8;
    const mem = navigator.deviceMemory ?? 8;
    if (cores <= 2 || mem <= 2) return 'low';
    if (cores <= 4 || mem <= 4) return 'medium';
  } catch { /* the APIs are optional */ }
  return 'high';
}
