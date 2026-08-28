/**
 * gearArt.js — pixel icons for everything the Forge can make.
 *
 * Until now gear was text-only in the Forge and Stash: a name, a rarity
 * colour, and a list of stat lines. That reads as a spreadsheet rather than as
 * loot, and it makes two items of the same rarity indistinguishable at a
 * glance even when they do completely different things.
 *
 * ART FORMAT
 * ----------
 * Same convention as weaponArt.js — a literal character grid plus a palette
 * mapping characters to colours, `.` meaning transparent. Authoring as text
 * means a silhouette is readable straight out of the source and a one-pixel
 * change is a one-character diff.
 *
 * Icons are 10x10 rather than the weapons' 8x8: gear is only ever drawn in UI
 * at a comfortable size, never in a crowded frame, so it can afford the extra
 * detail that makes a helmet read as a helmet.
 *
 * WHY THE PALETTE IS SHARED WITH WEAPONS
 * --------------------------------------
 * Grouping colours by material rather than by item is the single biggest thing
 * that makes a mixed set read as one game rather than as clip art. A steel
 * vest and a steel blade should be the same steel.
 */

import { defineSprite, PixelBuffer } from '../../render/pixel.js';

const P = {
  steel:  { s: '#c9d6e4', S: '#8fa4bd', d: '#5a6b80', D: '#333f52' },
  gold:   { g: '#ffd166', G: '#e0a020', y: '#fff3b0', Y: '#a67c1f' },
  fire:   { r: '#ff3b1f', o: '#ff8a3d', f: '#ffd166' },
  ice:    { c: '#7ce7ff', C: '#4fa8d8', w: '#ffffff' },
  toxic:  { t: '#b8ff5e', T: '#5a9e28' },
  void:   { v: '#b45cff', V: '#6b2d9e', k: '#12081f' },
  blood:  { R: '#8f1428', e: '#d42a44' },
  bone:   { b: '#f4f0e4', B: '#c4bca8' },
  elec:   { l: '#7ce7ff', L: '#2b8fd6', z: '#ffe066' },
  hide:   { h: '#8a6c28', H: '#5c4415' },
  ichor:  { i: '#b45cff', I: '#7a2fd0', n: '#e0a8ff' },
  cloth:  { m: '#5a6b80', M: '#333f52', p: '#9fb3c8' },
};

const pal = (...groups) => Object.assign({ '.': null }, ...groups);

/**
 * The icons.
 *
 * Grouped by slot so the file stays navigable as it grows, and so a missing
 * entry for a new recipe is obvious rather than buried.
 */
export const GEAR_ART = {

  // === ARMOUR ==============================================================

  scrap_vest: { palette: pal(P.steel, P.hide), grid: [
    '..dddd....',
    '.dSSSSd...',
    'dSssssSd..',
    'dSsddsSd..',
    'dSsddsSd..',
    'dSssssSd..',
    '.dSssSd...',
    '..dhhd....',
    '..dhhd....',
    '...dd.....',
  ] },

  plated_vest: { palette: pal(P.steel), grid: [
    '.dddddd...',
    'dSSSSSSd..',
    'dSssssSd..',
    'dsSssSsd..',
    'dsSssSsd..',
    'dSssssSd..',
    'dSSSSSSd..',
    '.dSddSd...',
    '..dd.dd...',
    '..........',
  ] },

  resonant_shell: { palette: pal(P.steel, P.ichor), grid: [
    '..dddd....',
    '.dSiiSd...',
    'dSinniSd..',
    'dsinnisd..',
    'dsinnisd..',
    'dSinniSd..',
    '.dSiiSd...',
    '..dIId....',
    '..dd.d....',
    '..........',
  ] },

  bulwark_plate: { palette: pal(P.steel, P.gold), grid: [
    'dddddddd..',
    'dSSSSSSSd.',
    'dSgGGgSSd.',
    'dSGyyGSSd.',
    'dSGyyGSSd.',
    'dSgGGgSSd.',
    'dSSSSSSSd.',
    'dSdd.ddSd.',
    '.dd...dd..',
    '..........',
  ] },

  drift_weave: { palette: pal(P.cloth, P.ice), grid: [
    '..mmmm....',
    '.mppppm...',
    'mpcccpm...',
    'mpcwwcpm..',
    'mpcwwcpm..',
    'mpcccpm...',
    '.mppppm...',
    '..mMMm....',
    '..m..m....',
    '..........',
  ] },

  ashen_carapace: { palette: pal(P.fire, P.steel), grid: [
    '..dddd....',
    '.droord...',
    'droffordd.',
    'drofforsd.',
    'drofforsd.',
    'droofordd.',
    '.drrrrd...',
    '..dood....',
    '..dd.d....',
    '..........',
  ] },

  // === TRINKETS ============================================================

  lucky_bolt: { palette: pal(P.gold, P.steel), grid: [
    '....gg....',
    '...gyyg...',
    '..gyGGyg..',
    '..gyGGyg..',
    '...gyyg...',
    '....gg....',
    '....SS....',
    '....SS....',
    '....dd....',
    '..........',
  ] },

  ichor_lens: { palette: pal(P.ichor, P.steel, P.void), grid: [
    '...dddd...',
    '..dinnid..',
    '.dinIInid.',
    '.dnIvvInd.',
    '.dnIvvInd.',
    '.dinIInid.',
    '..dinnid..',
    '...dddd...',
    '..........',
    '..........',
  ] },

  hunters_charm: { palette: pal(P.bone, P.blood), grid: [
    '....bb....',
    '...bBBb...',
    '..bB..Bb..',
    '..bB..Bb..',
    '..bBeeBb..',
    '...bBBb...',
    '....bb....',
    '....ee....',
    '....RR....',
    '..........',
  ] },

  static_coil: { palette: pal(P.elec, P.steel), grid: [
    '...dddd...',
    '..dLllLd..',
    '.dLzllzLd.',
    '.dlzLLzld.',
    '.dlzLLzld.',
    '.dLzllzLd.',
    '..dLllLd..',
    '...dddd...',
    '..........',
    '..........',
  ] },

  vine_knot: { palette: pal(P.toxic, P.hide), grid: [
    '...tt.....',
    '..tTTt....',
    '.tTthTt...',
    'tTt..tTt..',
    'tTt..tTt..',
    '.tTthTt...',
    '..tTTt....',
    '...tt.....',
    '..hh......',
    '..........',
  ] },

  frost_sigil: { palette: pal(P.ice), grid: [
    '....c.....',
    '..c.c.c...',
    '...ccc....',
    'ccccwcccc.',
    '...ccc....',
    '..c.c.c...',
    '....c.....',
    '..........',
    '..........',
    '..........',
  ] },

  ember_seal: { palette: pal(P.fire, P.gold), grid: [
    '....r.....',
    '...ror....',
    '..rofor...',
    '.rofffor..',
    '.rofffor..',
    '..rofor...',
    '...ror....',
    '....g.....',
    '....G.....',
    '..........',
  ] },

  void_anchor: { palette: pal(P.void, P.steel), grid: [
    '....vv....',
    '...vVVv...',
    '..vVkkVv..',
    '.vVkkkkVv.',
    '.vVkkkkVv.',
    '..vVkkVv..',
    '...vVVv...',
    '....dd....',
    '...dSSd...',
    '..........',
  ] },

  core_shard: { palette: pal(P.ichor, P.void, P.steel), grid: [
    '....n.....',
    '...nin....',
    '..niIin...',
    '.niIvIin..',
    '.niIvIin..',
    '..niIin...',
    '...nin....',
    '....n.....',
    '..........',
    '..........',
  ] },

  // === WEAPON RIGS =========================================================

  splinter_rig: { palette: pal(P.steel, P.hide), grid: [
    '........s.',
    '.......ss.',
    '......ssS.',
    '.....ssS..',
    '....ssS...',
    '...ssS....',
    '..hsS.....',
    '.hHS......',
    'hH........',
    '..........',
  ] },

  scattergun_rig: { palette: pal(P.steel, P.hide), grid: [
    '..........',
    '..ssssssS.',
    '.sSSSSSSS.',
    'hHhsSSSSs.',
    'hHh.......',
    '.hH.......',
    '..h.......',
    '..........',
    '..........',
    '..........',
  ] },

  orbit_rig: { palette: pal(P.steel, P.ice), grid: [
    '...cccc...',
    '..c....c..',
    '.c..ss..c.',
    'c..sSSs..c',
    'c..sSSs..c',
    '.c..ss..c.',
    '..c....c..',
    '...cccc...',
    '..........',
    '..........',
  ] },

  quake_rig: { palette: pal(P.steel, P.gold), grid: [
    '..SSSS....',
    '.SssssS...',
    'SsgGGgsS..',
    '.SssssS...',
    '..SddS....',
    '...dd.....',
    '...dd.....',
    '...dd.....',
    '..ddd.....',
    '..........',
  ] },

  ember_rig: { palette: pal(P.fire, P.steel), grid: [
    '.....r....',
    '....ro....',
    '...rof....',
    '..rofr....',
    '.rofr.....',
    'rofr......',
    'dSr.......',
    'dS........',
    'd.........',
    '..........',
  ] },

  cleaver_rig: { palette: pal(P.steel, P.blood), grid: [
    '....ssss..',
    '...sSSSSs.',
    '..sSSSSSs.',
    '..sSSSSs..',
    '.eSSSSs...',
    '.eRSSs....',
    '.eR.d.....',
    '..R.d.....',
    '....d.....',
    '..........',
  ] },

  pike_rig: { palette: pal(P.steel, P.toxic), grid: [
    '.......ss.',
    '......sSs.',
    '.....sSs..',
    '....sSs...',
    '...tSs....',
    '..tTs.....',
    '.tT.......',
    'tT........',
    'T.........',
    '..........',
  ] },

  lash_rig: { palette: pal(P.ichor, P.steel), grid: [
    '.......ii.',
    '.....iiIn.',
    '...iiI....',
    '..iI......',
    '.iI.......',
    'iI........',
    'dS........',
    'dS........',
    'd.........',
    '..........',
  ] },

  // === BOSS-UNIQUE RIGS ====================================================
  //
  // One per Anomaly (see meta/bossUniques.js) — same 10x10 grid+palette
  // format as every rig above, just guaranteed rather than crafted.

  maws_toll_rig: { palette: pal(P.steel, P.blood), grid: [
    '..SSSS....',
    '.SssssS...',
    'SsRRRRsS..',
    'SsRRRRsS..',
    '.SssssS...',
    '..SSSS....',
    '...dd.....',
    '...dd.....',
    '...dd.....',
    '..ddd.....',
  ] },

  choirbell_rig: { palette: pal(P.steel, P.elec), grid: [
    '...ss.....',
    '..sSSs....',
    '.sSllSs...',
    'sSllllSs..',
    'sSlLLlSs..',
    '.sSllSs...',
    '..sSSs....',
    '...zz.....',
    '...dd.....',
    '..ddd.....',
  ] },

  broodling_rig: { palette: pal(P.steel, P.toxic), grid: [
    '..........',
    '...tt.....',
    '..tTTt....',
    '.tTttTt...',
    '.tTttTt...',
    '..tTTt....',
    '...tt.....',
    '..s..s....',
    '.S....S...',
    '..........',
  ] },

  omen_beam_rig: { palette: pal(P.steel, P.void), grid: [
    '........vv',
    '.......vVv',
    '......vV..',
    '.....vV...',
    '....vV....',
    '...vV.....',
    '..vV......',
    '.vV.......',
    'kV........',
    '..........',
  ] },
};

/**
 * Rasterise one gear icon into the shared sprite cache.
 *
 * Scale 4 rather than the weapons' 3: gear icons appear in menus at rest, so
 * legibility beats density here, and there is never a crowd of them moving.
 */
function registerIcon(id, art) {
  const key = 'gear:' + id;
  const grid = art.grid;
  const h = grid.length;
  const w = grid[0].length;
  defineSprite(key, { width: w, height: h, scale: 4, frames: 1 }, (buf) => {
    for (let y = 0; y < h; y++) {
      const row = grid[y];
      for (let x = 0; x < row.length; x++) {
        const colour = art.palette[row[x]];
        if (colour !== null && colour !== undefined) buf.set(x, y, colour);
      }
    }
  });
  return key;
}

export function registerAllGearArt() {
  const keys = {};
  for (const [id, art] of Object.entries(GEAR_ART)) keys[id] = registerIcon(id, art);
  return keys;
}

/**
 * Validate every matrix against its own palette.
 *
 * This exists because unmapped characters fail SILENTLY — the pixel is simply
 * never drawn, so a typo produces a sprite with an invisible chunk (or an
 * entirely invisible sprite) and nothing anywhere reports a problem. That
 * happened twice during the weapon-art work and both times it was found by
 * eye, late. A check that runs in a test is much cheaper.
 */
export function validateGearArt() {
  const problems = [];
  for (const [id, art] of Object.entries(GEAR_ART)) {
    const width = art.grid[0].length;
    art.grid.forEach((row, y) => {
      if (row.length !== width) {
        problems.push(id + ': row ' + y + ' is ' + row.length + ' wide, expected ' + width);
      }
      for (const ch of row) {
        if (!(ch in art.palette)) {
          problems.push(id + ': character "' + ch + '" is not in its palette (row ' + y + ')');
        }
      }
    });
  }
  return problems;
}
