/**
 * icons.js — small inline-SVG icons for materials and gear, shared by every
 * DOM screen that lists them (Hub, Game Over, HUD).
 *
 * No image assets, same philosophy as the canvas renderer's geometric enemy
 * silhouettes: a handful of hand-authored shapes, distinct enough to read at
 * a glance, that cost nothing to ship and nothing to load. Kept in one file
 * because the same icon has to look identical everywhere it appears — a
 * Splinter Rig in the Stash and a Splinter Rig in the Loadout slot are the
 * same item, and should be the same drawing.
 *
 * Every function returns a ready-to-insert HTML string (an `<svg>` wrapped in
 * a sizing `<span>`), not a DOM node — every caller here already builds its
 * markup with string concatenation, so this matches that convention rather
 * than fighting it.
 */

import { MATERIALS } from '../meta/materials.js';
import { RARITIES } from '../meta/gear.js';
import { WEAPONS } from '../game/weaponDefs.js';
import { GEAR_ART } from '../game/pixelArt/gearArt.js';
import { getSprite } from '../render/pixel.js';

const NS = 'viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"';

// ---------------------------------------------------------------------------
// Materials — one shape per material, independent of gear rarity entirely.
// ---------------------------------------------------------------------------

const MATERIAL_SHAPES = {
  // Slag: a chunky, irregular lump — the only non-symmetric shape in the set,
  // reading as "debris" rather than anything refined.
  slag: (c) => `<path d="M10 6 L22 5 L27 13 L24 24 L14 27 L6 20 L5 12 Z" fill="${c}"/>`,

  // Filament: a coiled thread — the one shape built from a stroke, not a fill,
  // since it's the one material that's meant to read as thin and fibrous.
  filament: (c) =>
    `<path d="M6 24 Q10 14 16 20 Q22 26 26 8" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round"/>`,

  // Alloy: a hexagonal ingot with a bar-stock line through it.
  alloy: (c) => `
    <path d="M16 4 L27 10 L27 22 L16 28 L5 22 L5 10 Z" fill="${c}"/>
    <line x1="9" y1="16" x2="23" y2="16" stroke="rgba(0,0,0,0.25)" stroke-width="2"/>`,

  // Ichor: a droplet.
  ichor: (c) => `<path d="M16 4 C22 13 25 18 25 22 A9 9 0 0 1 7 22 C7 18 10 13 16 4 Z" fill="${c}"/>`,

  // Resonant Core: a faceted gem with an inner glow — the exotic material
  // should look like it's doing something, not just sitting there.
  core: (c) => `
    <path d="M16 3 L26 12 L22 27 L10 27 L6 12 Z" fill="${c}" opacity="0.9"/>
    <path d="M16 9 L21 13 L19 22 L13 22 L11 13 Z" fill="#fff" opacity="0.55"/>`,
};

export function materialIcon(id, size = 20) {
  const mat = MATERIALS[id];
  const color = mat?.color ?? '#9fb3c8';
  const shape = MATERIAL_SHAPES[id] ?? MATERIAL_SHAPES.slag;
  return `<span class="icon icon-material" style="--icon-size:${size}px">`
    + `<svg ${NS} width="${size}" height="${size}">${shape(color)}</svg></span>`;
}

// ---------------------------------------------------------------------------
// Gear — weapons get a shape per weapon (matching its in-run projectile
// colour, for recognisability); armour and trinkets get one shape each,
// tinted by rarity since they have no other visual identity in the game.
// ---------------------------------------------------------------------------

const WEAPON_SHAPES = {
  // Splinter: a thin bolt, same silhouette language as its in-run projectile.
  splinter: (c) => `<path d="M16 3 L20 14 L27 16 L20 18 L16 29 L12 18 L5 16 L12 14 Z" fill="${c}"/>`,

  // Scattergun: a spreading cone of pellets.
  scattergun: (c) => `
    <circle cx="16" cy="24" r="2.4" fill="${c}"/>
    <circle cx="9" cy="10" r="2" fill="${c}"/>
    <circle cx="16" cy="6" r="2" fill="${c}"/>
    <circle cx="23" cy="10" r="2" fill="${c}"/>
    <line x1="16" y1="22" x2="9" y2="11" stroke="${c}" stroke-width="1.5" opacity="0.5"/>
    <line x1="16" y1="22" x2="16" y2="7" stroke="${c}" stroke-width="1.5" opacity="0.5"/>
    <line x1="16" y1="22" x2="23" y2="11" stroke="${c}" stroke-width="1.5" opacity="0.5"/>`,

  // Lance: a beam with a bright core, exactly the two-layer look it fires with.
  lance: (c) => `
    <line x1="5" y1="16" x2="27" y2="16" stroke="${c}" stroke-width="7" stroke-linecap="round" opacity="0.55"/>
    <line x1="5" y1="16" x2="27" y2="16" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round"/>`,

  // Warden Blades: a ring with two orbiting blades — the weapon's whole idea.
  orbit: (c) => `
    <circle cx="16" cy="16" r="9" fill="none" stroke="${c}" stroke-width="1.5" opacity="0.4"/>
    <circle cx="25" cy="16" r="2.6" fill="${c}"/>
    <circle cx="7" cy="16" r="2.6" fill="${c}"/>`,

  // Quake: concentric shockwave rings.
  quake: (c) => `
    <circle cx="16" cy="16" r="4" fill="${c}"/>
    <circle cx="16" cy="16" r="9" fill="none" stroke="${c}" stroke-width="2" opacity="0.6"/>
    <circle cx="16" cy="16" r="13.5" fill="none" stroke="${c}" stroke-width="1.5" opacity="0.3"/>`,

  // Seeker: a curved homing shard.
  seeker: (c) => `<path d="M8 24 Q10 12 22 6 L19 12 Q13 16 13 24 Z" fill="${c}"/>`,

  // Ember Trail: a low guttering flame.
  ember: (c) => `<path d="M16 4 C21 11 23 15 23 19 A7 7 0 0 1 9 19 C9 15 11 12 13 13 C12 9 13 6 16 4 Z" fill="${c}"/>`,
};

// Armour and trinkets have no per-item identity beyond slot + rarity, so one
// shape each, filled with the item's own rarity colour.
const SLOT_SHAPES = {
  armor: (c) => `<path d="M16 4 L26 8 L26 16 C26 22 22 26 16 29 C10 26 6 22 6 16 L6 8 Z" fill="${c}" opacity="0.85"/>`,
  trinket: (c) => `
    <path d="M16 4 L24 11 L20 27 L12 27 L8 11 Z" fill="${c}" opacity="0.85"/>
    <path d="M16 4 L20 11 L12 11 Z" fill="#fff" opacity="0.35"/>`,
};

/** @param {object} item  a gear item — { slot, rarity, weaponId? } */
export function gearIcon(item, size = 36) {
  const rarityColor = RARITIES[item.rarity]?.color ?? '#9fb3c8';

  let shapeMarkup;
  if (item.slot === 'weapon' && item.weaponId !== undefined) {
    const weaponColor = WEAPONS[item.weaponId]?.color ?? rarityColor;
    const shapeFn = WEAPON_SHAPES[item.weaponId] ?? WEAPON_SHAPES.splinter;
    shapeMarkup = shapeFn(weaponColor);
  } else {
    const shapeFn = SLOT_SHAPES[item.slot] ?? SLOT_SHAPES.trinket;
    shapeMarkup = shapeFn(rarityColor);
  }

  return `<span class="icon icon-gear rarity-${item.rarity}" style="--icon-size:${size}px; --rc:${rarityColor}">`
    + `<svg ${NS} width="${size}" height="${size}">${shapeMarkup}</svg></span>`;
}

// ---------------------------------------------------------------------------
// Per-item pixel icons
// ---------------------------------------------------------------------------


/**
 * Rasterise a gear matrix once and cache it as a data URI.
 *
 * The Forge and Stash are DOM, not canvas, so the sprite cache the game uses
 * for in-run rendering does not help here. Baking each matrix to a data URI
 * once and reusing it as an <img> means the Stash can show a hundred items
 * without a hundred canvases, and the browser handles scaling.
 *
 * `image-rendering: pixelated` in CSS is what keeps a 10px grid crisp when
 * blown up to 40 — without it the browser smooths it into mush, which is the
 * usual reason hand-drawn pixel art looks wrong in a web UI.
 */
const artCache = new Map();

export function gearArtDataUri(artId) {
  if (artCache.has(artId)) return artCache.get(artId);
  const art = GEAR_ART[artId];
  if (art === undefined) { artCache.set(artId, null); return null; }

  const grid = art.grid;
  const h = grid.length;
  const w = grid[0].length;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  for (let y = 0; y < h; y++) {
    const row = grid[y];
    for (let x = 0; x < row.length; x++) {
      const colour = art.palette[row[x]];
      if (colour === null || colour === undefined) continue;
      ctx.fillStyle = colour;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  let uri = null;
  try { uri = cv.toDataURL('image/png'); } catch { uri = null; }
  artCache.set(artId, uri);
  return uri;
}

/**
 * An item icon: the hand-drawn pixel art when the item has some, and the old
 * generated SVG shape when it does not.
 *
 * The fallback matters — a recipe added without art still renders something
 * rather than a broken image, so missing art degrades to the previous look
 * instead of to a hole in the UI.
 */
export function gearPixelIcon(artId, rarity, size = 40) {
  const uri = gearArtDataUri(artId);
  if (uri === null) return null;
  const rarityColor = RARITIES[rarity]?.color ?? '#9fb3c8';
  return '<span class="icon icon-gear-art rarity-' + rarity + '"'
    + ' style="--icon-size:' + size + 'px; --rc:' + rarityColor + '">'
    + '<img src="' + uri + '" width="' + size + '" height="' + size + '" alt="" /></span>';
}

/**
 * A weapon's own hand-authored icon art (weaponArt.js's `icon` frames —
 * already built for exactly this: "used by the UI (inventory, level-up
 * cards, evolution previews)", per that file's own header comment, just
 * never actually wired up to the level-up card until now). Pulled from the
 * same sprite cache the in-run canvas uses, rather than re-rasterising, so
 * the icon here is guaranteed to be the same art the weapon fires as.
 */
const weaponIconCache = new Map();

export function weaponPixelIcon(artId, size = 40) {
  if (artId === undefined || artId === null) return null;
  let uri = weaponIconCache.get(artId);
  if (uri === undefined) {
    const canvas = getSprite('wart:icon:' + artId, 0, 'base', 0);
    uri = canvas !== null ? canvas.toDataURL('image/png') : null;
    weaponIconCache.set(artId, uri);
  }
  if (uri === null) return null;
  return '<span class="icon icon-weapon-art" style="--icon-size:' + size + 'px">'
    + '<img src="' + uri + '" width="' + size + '" height="' + size + '" alt="" /></span>';
}
