/**
 * passiveArt.js — pixel icons for the 24 passives.
 *
 * Same format and same pipeline as weaponArt.js: an 8x8 character grid plus a
 * palette, registered into the exact same sprite cache under the exact same
 * key convention (`wart:icon:<id>`). That reuse is deliberate, not just
 * convenient — it means the inventory strip (inventory.js's
 * draw_pixel_sprites, which already looks up `'wart:icon:' + item.id` for
 * anything without its own `art` field) and the level-up card
 * (weaponPixelIcon, same lookup) both pick up this art with no changes of
 * their own: a passive simply stops being the one kind of item with no icon.
 *
 * Rather than hand-picking a shade and highlight for 24 separate icons, each
 * one derives its palette from the single accent colour passives.js already
 * assigns that passive (`a` = that colour, `b` = a darker shade of it for
 * outline/shadow, `c` = a lighter tint for a highlight) — so a new passive
 * only ever needs a grid, never a colour decision to keep in sync.
 */

import { registerArt } from './weaponArt.js';
import { PASSIVES } from '../passives.js';

/** Parse #rrggbb / #rgb into [r,g,b] ints 0-255. */
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const rgbToHex = (r, g, b) => '#' + [r, g, b].map((v) =>
  Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

/** Move a colour toward black (factor < 0) or white (factor > 0), 0..1 magnitude. */
function tint(hex, factor) {
  const [r, g, b] = hexToRgb(hex);
  const target = factor < 0 ? 0 : 255;
  const t = Math.abs(factor);
  return rgbToHex(r + (target - r) * t, g + (target - g) * t, b + (target - b) * t);
}

/** a = the passive's own colour, b = shadow/outline, c = highlight, . = transparent. */
const palFor = (color) => ({ '.': null, a: color, b: tint(color, -0.55), c: tint(color, 0.55) });

// ---------------------------------------------------------------------------
// The 24 icons. Grids only — palette is derived, see palFor above.
// ---------------------------------------------------------------------------

const GRIDS = {
  // Spinach — a simple leaf on a stem.
  spinach: [
    '........',
    '...a....',
    '..aaa...',
    '.aaaaa..',
    '.abaaa..',
    '..aba...',
    '...b....',
    '...b....',
  ],
  // Spellbinder — an arcane orb, rings within a ring.
  spellbinder: [
    '........',
    '..bbbb..',
    '.bcccb..',
    '.baaab..',
    '.baaab..',
    '.bcccb..',
    '..bbbb..',
    '........',
  ],
  // Duplicator — one shape, and its echo just behind and right.
  duplicator: [
    '.bb.....',
    'bcab....',
    'bcab.bb.',
    '.bb.bcab',
    '....bcab',
    '.....bb.',
    '........',
    '........',
  ],
  // Hollow Heart — a heart with a hollow (unfilled) core.
  hollow_heart: [
    '........',
    '.aa.aa..',
    'abbabba.',
    'ab...ba.',
    '.ab.ba..',
    '..aba...',
    '...a....',
    '........',
  ],
  // Pummarola — a tomato: round body, little leaf top.
  pummarola: [
    '..bcb...',
    '.b.b.b..',
    '.aaaaa..',
    'aacaaaa.',
    'aaaaaaa.',
    '.aaaaa..',
    '..baa...',
    '........',
  ],
  // Wings — a single feathered wing, swept back.
  wings: [
    '...aa...',
    '..aaab..',
    '.aaaab..',
    'aaaab...',
    'aaab....',
    'aab.....',
    'ab......',
    '........',
  ],
  // Candelabrador — a candelabra: three flames on a stand.
  candelabrador: [
    'c.c.c...',
    'a.a.a...',
    'b.b.b...',
    'bbbbbbb.',
    '..bbb...',
    '..bbb...',
    '.bbbbb..',
    '........',
  ],
  // Bracer — an armband/vambrace with a speed chevron.
  bracer: [
    '........',
    '.bbbbb..',
    '.bacab..',
    '.bacab..',
    '.bacab..',
    '.bacab..',
    '.bbbbb..',
    '........',
  ],
  // Empty Tome — an open book, blank pages (attack speed, no flourish needed).
  empty_tome: [
    '........',
    'bb...bb.',
    'bca.acb.',
    'bca.acb.',
    'bca.acb.',
    'bca.acb.',
    'bb...bb.',
    '........',
  ],
  // Clover — four-leaf clover.
  clover: [
    '........',
    '.aa.aa..',
    'aabaaba.',
    '.aabaa..',
    'aabaaba.',
    '.aa.aa..',
    '...b....',
    '...b....',
  ],
  // Whetstone — a sharpening stone with a spark off the edge.
  whetstone: [
    '......c.',
    '.....c..',
    '..aaab..',
    '.aaaab..',
    'aaaab...',
    'aaab....',
    'aab.....',
    '........',
  ],
  // Lodestone — a horseshoe magnet, poles marked.
  lodestone: [
    'aa....aa',
    'ab....ba',
    'ab....ba',
    'ab....ba',
    'ab....ba',
    '.bb..bb.',
    '.cc..cc.',
    '........',
  ],
  // Ballast — a heavy weight (anchor-like drop shape).
  ballast: [
    '..bbb...',
    '..bab...',
    '.baaab..',
    '.baaab..',
    '.baaab..',
    '..bab...',
    '.bbbbb..',
    '........',
  ],
  // Quill — a feather pen, nib down.
  quill: [
    '......a.',
    '.....aa.',
    '....aab.',
    '...aab..',
    '..aab...',
    '.aab....',
    'ab......',
    'b.......',
  ],
  // Hourglass — the classic pinch shape.
  hourglass: [
    'bbbbbbb.',
    '.aaaaa..',
    '..aaa...',
    '...c....',
    '..aaa...',
    '.aaaaa..',
    'bbbbbbb.',
    '........',
  ],
  // Featherfall — a single drifting feather, angled.
  featherfall: [
    '....aa..',
    '...aab..',
    '..aab...',
    '.aacb...',
    'aab.b...',
    'ab..b...',
    'b...b...',
    '........',
  ],
  // Cinder Heart — a heart wreathed in flame.
  cinder_heart: [
    '..c.c...',
    '.aa.aa..',
    'aabaaba.',
    'aba.aba.',
    '.ab.ba..',
    '..aba...',
    '...a....',
    '........',
  ],
  // Ichor Sump — a heart-shaped droplet, half full.
  ichor_sump: [
    '...aa...',
    '..aaaa..',
    '.aaaaaa.',
    '.aaaaaa.',
    '.abbbba.',
    '..abba..',
    '...bb...',
    '........',
  ],
  // Splitter — one arrow forking into two.
  splitter: [
    '..a.....',
    '..a.....',
    '..a.....',
    '..a.....',
    '.a.a....',
    'a...a...',
    'b...b...',
    '........',
  ],
  // Resonator — concentric pulse rings, off-centre like a struck bell.
  resonator: [
    '..bbb...',
    '.b...b..',
    'b.acc.b.',
    'b.cac.b.',
    'b.acc.b.',
    '.b...b..',
    '..bbb...',
    '........',
  ],
  // Hair Trigger — a trigger/lightning bolt, fast and sharp.
  hair_trigger: [
    '...aa...',
    '..aa....',
    '.aa.....',
    'aaaaa...',
    '...aa...',
    '..aa....',
    '.aa.....',
    '........',
  ],
  // Marrow — a cross-section of bone, spongy core.
  marrow: [
    'aa....aa',
    'ab....ba',
    '.ab..ba.',
    '..abba..',
    '..abba..',
    '.ab..ba.',
    'ab....ba',
    'aa....aa',
  ],
  // Glass Eye — a wide-open eye, sharp glint.
  glass_eye: [
    '........',
    '..bbbb..',
    '.baaaab.',
    'baacaab.',
    'baacaab.',
    '.baaaab.',
    '..bbbb..',
    '........',
  ],
  // Longshot — a long arrow in flight, fletched.
  longshot: [
    '.......a',
    '......a.',
    'b....a..',
    '.bb.a...',
    'b.aa....',
    '.b......',
    '........',
    '........',
  ],
};

export const PASSIVE_ART = {};

let registered = false;

/** Called once, from the same place registerArsenalArt() already runs. Idempotent. */
export function registerAllPassiveArt() {
  if (registered) return;
  registered = true;
  for (const [id, grid] of Object.entries(GRIDS)) {
    const color = PASSIVES[id]?.color ?? '#9fb3c8';
    const art = { palette: palFor(color), icon: [grid] };
    PASSIVE_ART[id] = art;
    registerArt(id, art, 'icon', { scale: 3 });
  }
}
