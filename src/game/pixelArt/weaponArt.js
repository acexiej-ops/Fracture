/**
 * weaponArt.js — the raw 8-bit pixel matrices for every weapon and projectile.
 *
 * ART FORMAT
 * ----------
 * Each entry is a literal character grid plus a palette mapping characters to
 * colours. `.` is always transparent. This is deliberately authored as text
 * rather than as procedural drawing calls: you can read a weapon's silhouette
 * straight out of the source, edit a single pixel by changing one character,
 * and diff a sprite change in a code review. That is the whole reason retro
 * art pipelines used grids.
 *
 *   icon   what the weapon itself looks like — used by the UI (inventory,
 *          level-up cards, evolution previews).
 *   proj   what it puts on screen — the projectile, orb, blade or effect.
 *
 * Frames are listed in animation order. A one-frame entry is a static sprite;
 * multi-frame entries are advanced by the animation engine (see animator.js).
 *
 * RENDERING
 * ---------
 * Matrices are compiled once, on first use, into cached offscreen canvases via
 * the project's existing pixel pipeline (src/render/pixel.js) — so a matrix is
 * rasterised exactly once no matter how many copies are on screen, and blits
 * afterwards cost one drawImage each. That matters: a late-game screen can
 * hold hundreds of projectiles.
 */

import { defineSprite, PixelBuffer } from '../../render/pixel.js';

// ---------------------------------------------------------------------------
// Shared palettes. Grouping colours by material rather than by weapon keeps
// the whole arsenal looking like one set — the single biggest thing that makes
// mixed sprites read as a coherent game rather than as clip art.
// ---------------------------------------------------------------------------

const P = {
  // metals
  steel: { s: '#c9d6e4', S: '#8fa4bd', d: '#5a6b80', D: '#333f52' },
  gold:  { g: '#ffd166', G: '#e0a020', y: '#fff3b0', Y: '#a67c1f' },
  // energies
  fire:  { r: '#ff3b1f', o: '#ff8a3d', y: '#ffd166', w: '#fff3b0' },
  ice:   { c: '#7ce7ff', C: '#4fa8d8', w: '#ffffff', W: '#dff6ff' },
  toxic: { t: '#b8ff5e', T: '#5a9e28', k: '#2f4a14' },
  void:  { v: '#b45cff', V: '#6b2d9e', k: '#12081f', b: '#2a3f8f' },
  holy:  { h: '#fff3b0', H: '#ffd166', l: '#ffffff' },
  blood: { R: '#8f1428', r: '#d42a44', w: '#ffffff' },
  wood:  { n: '#8a6c28', N: '#5c4415', m: '#3a2a0c' },
  bone:  { b: '#f4f0e4', B: '#c4bca8', k: '#6b6355' },
  elec:  { e: '#7ce7ff', E: '#2b8fd6', w: '#ffffff', y: '#ffe066' },
  shadow:{ p: '#7a4fd8', P: '#3d2470', k: '#0f0a1c', s: '#c9d6e4' },
};

/** Merge palette groups into one lookup for a sprite. */
const pal = (...groups) => Object.assign({ '.': null }, ...groups);

// ---------------------------------------------------------------------------
// THE ART
//
// Categories mirror the arsenal's own grouping so the file stays navigable as
// it grows. Every weapon has an `icon`; `proj` is optional for weapons whose
// on-screen effect is drawn procedurally (auras, fissures) rather than blitted.
// ---------------------------------------------------------------------------

export const WEAPON_ART = {

  // === PROJECTILE TYPES ====================================================

  fire_wand: {
    palette: pal(P.fire, P.wood),
    icon: [[
      '.....yw.',
      '....ywy.',
      '...yrry.',
      '..non...',
      '.non....',
      'non.....',
      'on......',
      'n.......',
    ]],
    // Flickering fire trail: the core stays put, the outer licks move.
    proj: [
      ['..o..', '.oyo.', 'oywyo', '.oyo.', '..o..'],
      ['..y..', '.yry.', 'yrwry', '.oro.', '..o..'],
      ['..o..', '.roy.', 'rywyr', '.oyo.', '..r..'],
    ],
  },

  shadow_dagger: {
    palette: pal(P.steel, P.shadow),
    icon: [[
      '....s...',
      '...ss...',
      '...ss...',
      '...ss...',
      '..pssp..',
      '...pp...',
      '...pp...',
      '...P....',
    ]],
    proj: [['..s..', '..s..', '.sss.', '..p..', '..P..']],
  },

  cross_boomerang: {
    palette: pal(P.steel, { b: '#4fa8ff', B: '#2b6fd6' }),
    icon: [[
      '...bb...',
      '...bb...',
      '.bbBBbb.',
      'bBBssBBb',
      'bBBssBBb',
      '.bbBBbb.',
      '...bb...',
      '...bb...',
    ]],
    // Four rotation frames — a spinning cross reads best as discrete steps.
    proj: [
      ['..b..', '..b..', 'bbSbb', '..b..', '..b..'],
      ['.b.b.', '..b..', '.bSb.', '..b..', '.b.b.'],
      ['.....', 'bbbbb', '..S..', 'bbbbb', '.....'],
      ['.b.b.', '..b..', '.bSb.', '..b..', '.b.b.'],
    ],
  },

  heroic_bow: {
    palette: pal(P.wood, P.steel, P.bone),
    // Two frames: the bow flexes as it looses.
    icon: [
      ['..nn....', '.n..n...', 'n....n..', 'n....B..', 'n....B..', 'n....n..', '.n..n...', '..nn....'],
      ['...nn...', '..n..n..', '.n....n.', '.n...BB.', '.n...BB.', '.n....n.', '..n..n..', '...nn...'],
    ],
    proj: [['.....', '....B', '.BBBB', '....B', '.....']],
  },

  bone_tosser: {
    palette: pal(P.bone),
    icon: [[
      '.bb..bb.',
      'bBbbbbBb',
      '.bBBBBb.',
      '..bBBb..',
      '..bBBb..',
      '.bBBBBb.',
      'bBbbbbBb',
      '.bb..bb.',
    ]],
    proj: [
      ['bb.bb', 'bBBBb', '.bBb.', 'bBBBb', 'bb.bb'],
      ['.b.b.', 'bBBBb', 'bBbBb', 'bBBBb', '.b.b.'],
    ],
  },

  magic_missile: {
    palette: pal({ n: '#ff5ec4', N: '#c41d8f', w: '#ffffff', W: '#ffe4f6' }),
    icon: [[
      '...n....',
      '..nNn...',
      '.nNwNn..',
      'nNwwwNn.',
      '.nNwNn..',
      '..nNn...',
      '...n....',
      '........',
    ]],
    // Pulsing energy star.
    proj: [
      ['..n..', '.nNn.', 'nNwNn', '.nNn.', '..n..'],
      ['.n.n.', 'nNwNn', '.wWw.', 'nNwNn', '.n.n.'],
    ],
  },

  poison_dart: {
    palette: pal(P.toxic, P.steel),
    icon: [[
      '.......t',
      '......tT',
      '.....tT.',
      '....tT..',
      '...dT...',
      '..dD....',
      '.dD.....',
      'k.......',
    ]],
    proj: [
      ['..t..', '..t..', '.tTt.', '..T..', '..k..'],
      ['..t..', '..t..', '.tTt.', '..T..', '..t..'],
    ],
  },

  laser_pistol: {
    palette: pal(P.steel, { w: '#ffffff' }),
    icon: [[
      '........',
      '.ssssss.',
      'sSSSSSSw',
      'sSdddSSw',
      'sSSSSSS.',
      '.dS.....',
      '.dS.....',
      '.DD.....',
    ]],
    proj: [['.....', '.....', 'wwwww', '.....', '.....']],
  },

  // === AREA OF EFFECT ======================================================

  holy_aura: {
    palette: pal(P.holy, P.gold),
    icon: [
      ['..hhhh..', '.h....h.', 'h......h', 'h......h', 'h......h', 'h......h', '.h....h.', '..hhhh..'],
      ['..HHHH..', '.H.ll.H.', 'H.l..l.H', 'H......H', 'H......H', 'H.l..l.H', '.H.ll.H.', '..HHHH..'],
    ],
    proj: [['..l..', '.lhl.', 'lh.hl', '.lhl.', '..l..']],
  },

  santa_water: {
    palette: pal(P.ice, { b: '#4fa8ff', d: '#2b6fd6' }),
    icon: [[
      '...dd...',
      '...bb...',
      '..dbbd..',
      '.dbCCbd.',
      '.dbCCbd.',
      '.dbCCbd.',
      '.dbbbbd.',
      '..dddd..',
    ]],
    proj: [
      ['.....', '..c..', '.cCc.', 'cCCCc', '.ccc.'],
      ['..c..', '.c.c.', 'c.C.c', 'cCCCc', 'ccccc'],
    ],
  },

  sonic_wave: {
    palette: pal(P.ice),
    icon: [
      ['..c.....', '.c.c....', 'c.c.c...', 'c.c.c...', 'c.c.c...', 'c.c.c...', '.c.c....', '..c.....'],
      ['....c...', '...c.c..', '..c.c.c.', '..c.c.c.', '..c.c.c.', '..c.c.c.', '...c.c..', '....c...'],
    ],
    proj: [['.ccc.', 'c...c', 'c...c', 'c...c', '.ccc.']],
  },

  gravity_bomb: {
    palette: pal(P.void),
    icon: [
      ['..vvv...', '.vVkVv..', 'vVkkkVv.', 'vkkkkkv.', 'vVkkkVv.', '.vVkVv..', '..vvv...', '........'],
      ['...v....', '..vVv...', '.vVkVv..', 'vVkkkVv.', '.vVkVv..', '..vVv...', '...v....', '........'],
    ],
    proj: [
      ['..v..', '.vkv.', 'vkkkv', '.vkv.', '..v..'],
      ['.....', '..v..', '.vkv.', '..v..', '.....'],
    ],
  },

  earthquake_stomp: {
    palette: pal(P.wood, { g: '#6b5a3a' }),
    icon: [[
      'n.......',
      '.n......',
      '.nn.....',
      '..n.n...',
      '..nn.n..',
      '...n..n.',
      '...n...n',
      '...N....',
    ]],
    // Fissures are drawn procedurally as jagged lines; no blitted projectile.
  },

  acid_spray: {
    palette: pal(P.toxic),
    icon: [[
      '.......t',
      '..t...tT',
      '.....tT.',
      '..t.tT..',
      '.tTtT...',
      'tTT.....',
      '.t......',
      '........',
    ]],
    proj: [
      ['.t.t.', 't.T.t', '.tTt.', 't.T.t', '.t.t.'],
      ['t.t.t', '.tTt.', 't.T.t', '.tTt.', 't.t.t'],
    ],
  },

  blizzard_scroll: {
    palette: pal(P.ice),
    icon: [[
      '.w...w..',
      '..c...c.',
      'w...w...',
      '..c...c.',
      '.w...w..',
      '...c...c',
      '.w...w..',
      '..c...c.',
    ]],
    // Square crystals, alternating — snow reads as blocks in 8-bit, not stars.
    proj: [
      ['.....', '.www.', '.wCw.', '.www.', '.....'],
      ['..w..', '.wcw.', 'wcCcw', '.wcw.', '..w..'],
    ],
  },

  mine_layer: {
    palette: pal(P.steel, { r: '#ff3b1f', R: '#8f1414' }),
    // Blinking arm light.
    icon: [
      ['........', '..d..d..', '.dSSSSd.', 'dSSrrSSd', 'dSSrrSSd', '.dSSSSd.', '..d..d..', '........'],
      ['........', '..d..d..', '.dSSSSd.', 'dSSRRSSd', 'dSSRRSSd', '.dSSSSd.', '..d..d..', '........'],
    ],
    proj: [
      ['.ddd.', 'dSrSd', 'dr.rd', 'dSrSd', '.ddd.'],
      ['.ddd.', 'dSRSd', 'dR.Rd', 'dSRSd', '.ddd.'],
    ],
  },

  // === ORBITALS & CLOSE RANGE ==============================================

  orbiting_blades: {
    palette: pal(P.steel, P.wood),
    icon: [[
      '...s....',
      '...s....',
      '...s....',
      '..sss...',
      '...n....',
      '...n....',
      '..nnn...',
      '........',
    ]],
    proj: [['..s..', '..s..', '.sSs.', '..n..', '..N..']],
  },

  garlic_shield: {
    palette: pal({ y: '#fff3b0', Y: '#e8d98a', w: '#ffffff' }),
    icon: [
      ['..yyyy..', '.y....y.', 'y......y', 'y..ww..y', 'y..ww..y', 'y......y', '.y....y.', '..yyyy..'],
      ['..YYYY..', '.Y....Y.', 'Y......Y', 'Y..ww..Y', 'Y..ww..Y', 'Y......Y', '.Y....Y.', '..YYYY..'],
    ],
  },

  whip: {
    palette: pal(P.wood, P.bone),
    icon: [[
      'nn......',
      '.nn.....',
      '..nn....',
      '...nn...',
      '....nn..',
      '.....nn.',
      '......nn',
      '.......m',
    ]],
    proj: [['nnnn.', '...nn', '....n', '.....', '.....']],
  },

  plasma_ring: {
    palette: pal(P.elec),
    icon: [
      ['..eee...', '.e...e..', 'e..y..e.', 'e.yEy.e.', 'e..y..e.', '.e...e..', '..eee...', '........'],
      ['..EEE...', '.E.y.E..', 'E.yey.E.', 'E.eEe.E.', 'E.yey.E.', '.E.y.E..', '..EEE...', '........'],
    ],
    proj: [['.eee.', 'e...e', 'e...e', 'e...e', '.eee.']],
  },

  fire_shield: {
    palette: pal(P.fire),
    // Three fireballs at 120 degrees — the icon shows all three mid-rotation.
    icon: [[
      '..y.....',
      '.yoy....',
      'yoroy...',
      '.yoy..y.',
      '..y..yoy',
      '.y....y.',
      'yoy.....',
      '.y......',
    ]],
    proj: [
      ['..y..', '.yoy.', 'yoroy', '.yoy.', '..y..'],
      ['..o..', '.oyo.', 'oywyo', '.oyo.', '..o..'],
    ],
  },

  spike_armor: {
    palette: pal(P.steel),
    icon: [[
      '...s....',
      's..S..s.',
      '.s.S.s..',
      '..sSs...',
      'sSSDSSs.',
      '..sSs...',
      '.s.S.s..',
      's..S..s.',
    ]],
    proj: [['..s..', '..S..', '.sSs.', '..D..', '.....']],
  },

  // === COMPANIONS & SUMMONS ================================================

  drone_helper: {
    // `w` is here for the projectile bolt. A character with no palette entry
    // renders transparent rather than erroring, so a missing key produces a
    // silently invisible sprite — see the validateArt() guard at the bottom of
    // this file, which exists because exactly that happened here.
    palette: pal(P.steel, { r: '#ff3b1f', R: '#8f1414', w: '#ffffff' }),
    // Blinking red lens.
    icon: [
      ['........', '..dSSd..', '.dSSSSd.', 'dSrrrrSd', 'dSrrrrSd', '.dSSSSd.', '..d..d..', '.d....d.'],
      ['........', '..dSSd..', '.dSSSSd.', 'dSRRRRSd', 'dSRRRRSd', '.dSSSSd.', '..d..d..', '.d....d.'],
    ],
    proj: [['.....', '..w..', '.www.', '..w..', '.....']],
  },

  ghost_familiar: {
    palette: pal({ w: '#ffffff', W: '#c9d6e4', k: '#333f52' }),
    icon: [
      ['..wwww..', '.wwwwww.', 'wwkwwkww', 'wwwwwwww', 'wwwwwwww', 'wWwWwWww', 'w.w.w.w.', '........'],
      ['..wwww..', '.wwwwww.', 'wwkwwkww', 'wwwwwwww', 'wwwwwwww', 'wwWwWwWw', '.w.w.w.w', '........'],
    ],
  },

  haunting_skull: {
    palette: pal(P.bone, { r: '#ff3b1f' }),
    icon: [
      ['.bbbbbb.', 'bBBBBBBb', 'bBrrBrrB', 'bBrrBrrB', 'bBBBBBBb', 'bBkBkBkb', '.bkbkbkb', '..bbbb..'],
      ['.bbbbbb.', 'bBBBBBBb', 'bBrrBrrB', 'bBrrBrrB', 'bBBBBBBb', 'bB.B.B.b', '.bkbkbkb', '..bbbb..'],
    ],
  },

  attack_bud: {
    palette: pal(P.toxic, P.wood),
    icon: [[
      '...t....',
      '..tTt...',
      '.tTkTt..',
      '..tTt...',
      '...t....',
      '...n....',
      '...n....',
      '..NNN...',
    ]],
    proj: [['.....', '.nn..', 'nNNn.', '.nn..', '.....']],
  },

  // === MELEE ================================================================
  //
  // Melee icons are drawn on the diagonal, hilt at bottom-left, edge at
  // top-right. A vertical blade in an 8x8 grid is a 1px line with no read;
  // the diagonal gives the silhouette twice the length to work with, which is
  // the standard trick for weapon sprites at this size.

  rift_cleaver: {
    palette: pal(P.steel, P.wood, P.void),
    icon: [[
      '.....ss.',
      '....sSs.',
      '...sSSs.',
      '..sSSs..',
      '.sSSs...',
      'vnns....',
      'nn......',
      'm.......',
    ]],
    proj: [['..s..', '.sSs.', 'sSSSs', '.sSs.', '..s..']],
  },

  warden_pike: {
    palette: pal(P.steel, P.wood),
    icon: [[
      '......ss',
      '.....sSs',
      '....sS..',
      '...nS...',
      '..nn....',
      '.nn.....',
      'nn......',
      'm.......',
    ]],
    proj: [['..s..', '..s..', '.sSs.', '..n..', '..N..']],
  },

  breaker_maul: {
    palette: pal(P.steel, P.wood, P.gold),
    icon: [[
      '..SSSS..',
      '.SssssS.',
      '.SssssS.',
      '..SnnS..',
      '...nn...',
      '...nn...',
      '...nn...',
      '...mm...',
    ]],
    proj: [['.SSS.', 'SsssS', 'SsnsS', 'SsssS', '.SSS.']],
  },

  ichor_lash: {
    palette: pal(P.void, P.wood, P.toxic),
    icon: [[
      '.......v',
      '......vV',
      '.....vV.',
      '...vvV..',
      '..vV....',
      '.nvV....',
      'nn......',
      'm.......',
    ]],
    proj: [
      ['....v', '...vV', '..vV.', '.vV..', 'v....'],
      ['....V', '...vv', '..vV.', '.Vv..', 'V....'],
    ],
  },

  twin_fangs: {
    palette: pal(P.steel, P.shadow),
    icon: [[
      '...s..s.',
      '..sS.sS.',
      '.sS.sS..',
      'sS.sS...',
      'p.sS....',
      'PsS.....',
      'pP......',
      'k.......',
    ]],
    proj: [['..s..', '.sSs.', 's.p.s', '.sSs.', '..s..']],
  },

  gravedigger: {
    palette: pal(P.steel, P.wood, P.bone),
    icon: [[
      '..sssss.',
      '.sSSSSs.',
      'sSs.....',
      '.Ss.....',
      '..n.....',
      '..n.....',
      '..n.....',
      '..m.....',
    ]],
    proj: [['ssss.', 'sSSs.', '..ns.', '..n..', '..m..']],
  },

  // === TACTICAL & EXPERIMENTAL =============================================

  chrono_pocket: {
    palette: pal(P.gold, { k: '#3a2a0c' }),
    // Ticking hand, four positions.
    icon: [
      ['...GG...', '..gyyg..', '.gy.kyg.', 'gy..kyg.', 'gy..yyg.', '.gy..yg.', '..gyyg..', '...GG...'],
      ['...GG...', '..gyyg..', '.gy..yg.', 'gy.kkyg.', 'gy..yyg.', '.gy..yg.', '..gyyg..', '...GG...'],
      ['...GG...', '..gyyg..', '.gy..yg.', 'gy..yyg.', 'gy..kyg.', '.gy.kyg.', '..gyyg..', '...GG...'],
      ['...GG...', '..gyyg..', '.gy..yg.', 'gykkyyg.', 'gy..yyg.', '.gy..yg.', '..gyyg..', '...GG...'],
    ],
  },

  electric_fence: {
    palette: pal(P.steel, P.elec),
    icon: [
      ['dSd..dSd', 'dSd..dSd', 'dSd.edSd', 'dSde.dSd', 'dSd.edSd', 'dSde.dSd', 'dSd..dSd', 'dDd..dDd'],
      ['dSd..dSd', 'dSd..dSd', 'dSde.dSd', 'dSd.edSd', 'dSde.dSd', 'dSd.edSd', 'dSd..dSd', 'dDd..dDd'],
    ],
    proj: [
      ['..e..', '.e.e.', 'e.w.e', '.e.e.', '..e..'],
      ['.e.e.', 'e.w.e', '.eEe.', 'e.w.e', '.e.e.'],
    ],
  },

  coin_gun: {
    palette: pal(P.wood, P.gold, P.steel),
    icon: [[
      '........',
      '.nnnnn..',
      'nNNNNNn.',
      'nNggggNn',
      'nNNNNNn.',
      '.nnnnn..',
      '..mm....',
      '..mm....',
    ]],
    // Spinning coin: wide, narrow, edge, narrow.
    proj: [
      ['.ggg.', 'gyygg', 'gyGyg', 'ggyyg', '.ggg.'],
      ['..g..', '.gyg.', '.gGg.', '.gyg.', '..g..'],
      ['.....', '..G..', '..G..', '..G..', '.....'],
      ['..g..', '.gyg.', '.gGg.', '.gyg.', '..g..'],
    ],
  },

  void_rift: {
    palette: pal(P.void),
    icon: [
      ['..bbbb..', '.bkkkkb.', 'bkkVVkkb', 'bkVkkVkb', 'bkVkkVkb', 'bkkVVkkb', '.bkkkkb.', '..bbbb..'],
      ['...bb...', '..bkkb..', '.bkkkkb.', 'bkkVVkkb', 'bkkVVkkb', '.bkkkkb.', '..bkkb..', '...bb...'],
    ],
    proj: [
      ['..b..', '.bkb.', 'bkVkb', '.bkb.', '..b..'],
      ['.....', '..b..', '.bkb.', '..b..', '.....'],
    ],
  },

  // Registered because the evolution map references it (Thunder Loop), even
  // though it is not one of the numbered thirty. Flagged rather than silently
  // dropped or silently renamed onto Electric Fence.
  chain_bolt: {
    palette: pal(P.elec),
    icon: [[
      '....ee..',
      '...ee...',
      '..eee...',
      '.eeww...',
      '...wwee.',
      '...eee..',
      '..ee....',
      '..e.....',
    ]],
    proj: [
      ['..e..', '.ew..', 'eweEe', '..we.', '..e..'],
      ['.e.e.', '..w..', 'eEwEe', '..w..', '.e.e.'],
    ],
  },
};

// ---------------------------------------------------------------------------
// EVOLVED FORMS
//
// Authored at a larger grid on purpose. An evolution that is the same sprite
// recoloured reads as a palette swap; one that is visibly *more pixels* reads
// as a different, bigger object — which is the whole promise of an evolution.
// ---------------------------------------------------------------------------

export const EVOLVED_ART = {
  hellfire_meteor: {
    palette: pal(P.fire, { k: '#3a1408' }),
    icon: [[
      '...wyoyw....',
      '..wyorroyw..',
      '.wyorrkrroy.',
      'wyorrkkkrroy',
      'yorrkkkkkrro',
      'orrkkkkkkkrr',
      'orrkkkkkkkrr',
      'yorrkkkkkrro',
      'wyorrkkkrroy',
      '.wyorrkrroy.',
      '..wyorroyw..',
      '...wyoyw....',
    ]],
    proj: [
      ['..oyo..', '.oyryo.', 'oyrkryo', 'yrkkkry', 'oyrkryo', '.oyryo.', '..oyo..'],
      ['..yry..', '.yrwry.', 'yrwkwry', 'rwkkkwr', 'yrwkwry', '.yrwry.', '..yry..'],
    ],
  },

  vortex_shields: {
    palette: pal(P.steel, P.elec),
    icon: [[
      '...ssss.....',
      '..sSSSSs....',
      '.sS.ee.Ss...',
      'sS.eEEe.Ss..',
      'sS.eEEe.Ss..',
      '.sS.ee.Ss...',
      '..sSSSSs....',
      '...ssss.....',
      '..s....s....',
      '.sS....Ss...',
      '.sS....Ss...',
      '..ssssss....',
    ]],
    proj: [['..s..', '.sSs.', 'sSeSs', '.sSs.', '..s..']],
  },

  thunder_loop: {
    palette: pal(P.elec, { y: '#ffe066', Y: '#ffb703' }),
    icon: [[
      '....yy......',
      '...yy.......',
      '..yyy.......',
      '.yyww...yy..',
      '...wwy.yy...',
      '....yyyyy...',
      '...yyww.....',
      '..yy.wwy....',
      '.yy....yyy..',
      '.y.......yy.',
      '..........y.',
      '............',
    ]],
    proj: [
      ['..y..', '.yw..', 'ywYwy', '..wy.', '..y..'],
      ['.y.y.', '..w..', 'yYwYy', '..w..', '.y.y.'],
    ],
  },

  bloody_tear: {
    palette: pal(P.blood, { k: '#2a0810' }),
    icon: [[
      'r...........',
      'Rr..........',
      '.Rr.........',
      '.wRr........',
      '..wRr.......',
      '...wRr......',
      '....wRr.....',
      '.....wRr....',
      '......wRr...',
      '.......wRr..',
      '........wRr.',
      '.........wR.',
    ]],
    // The white flash frame is the crit tell.
    proj: [
      ['rRr..', '.rRr.', '..rRr', '...rR', '....r'],
      ['www..', '.www.', '..www', '...ww', '....w'],
    ],
  },

  soul_eater: {
    palette: pal(P.void, { k: '#0a0410' }),
    icon: [[
      '..vvvvvv....',
      '.vVkkkkVv...',
      'vVkkkkkkVv..',
      'vkkVVVVkkv..',
      'vkVkkkkVkv..',
      'vkVkkkkVkv..',
      'vkkVVVVkkv..',
      'vVkkkkkkVv..',
      '.vVkkkkVv...',
      '..vvvvvv....',
      '............',
      '............',
    ]],
    proj: [
      ['..v..', '.vVv.', 'vVkVv', '.vVv.', '..v..'],
      ['.v.v.', 'v.k.v', '.kkk.', 'v.k.v', '.v.v.'],
    ],
  },
};

// ---------------------------------------------------------------------------
// COMPILER — matrix -> cached sprite
// ---------------------------------------------------------------------------

/**
 * Compile one character matrix into a PixelBuffer.
 *
 * Rows may be ragged; anything past a row's length is transparent. That is a
 * convenience for hand-authoring — trailing dots are tedious to keep aligned
 * and their absence should not be an error.
 */
function matrixToBuffer(matrix, palette) {
  const h = matrix.length;
  const w = matrix.reduce((m, row) => Math.max(m, row.length), 0);
  const buf = new PixelBuffer(w, h);
  for (let y = 0; y < h; y++) {
    const row = matrix[y];
    for (let x = 0; x < row.length; x++) {
      const color = palette[row[x]];
      if (color !== undefined && color !== null) buf.set(x, y, color);
    }
  }
  return buf;
}

const registered = new Set();

/**
 * Register a matrix set as an animated sprite.
 *
 * `kind` is 'icon' or 'proj'. Returns the sprite key, or null when the entry
 * has no art of that kind (an aura has an icon but no blitted projectile) —
 * callers treat null as "draw this one procedurally instead".
 */
export function registerArt(id, art, kind, { scale = 3, directional = false } = {}) {
  const frames = art[kind];
  if (frames === undefined || frames.length === 0) return null;

  const key = 'wart:' + kind + ':' + id;
  if (registered.has(key)) return key;
  registered.add(key);

  const w = frames.reduce((m, f) => Math.max(m, f.reduce((n, r) => Math.max(n, r.length), 0)), 0);
  const h = frames.reduce((m, f) => Math.max(m, f.length), 0);

  defineSprite(key, {
    w, h, frames: frames.length, scale, directional,
    draw: (buf, frame) => {
      const src = matrixToBuffer(frames[frame], art.palette);
      // Centre a smaller frame inside the shared canvas, so a multi-frame
      // sprite whose frames differ in size doesn't jitter between them.
      const ox = Math.floor((w - src.w) / 2);
      const oy = Math.floor((h - src.h) / 2);
      for (let y = 0; y < src.h; y++) {
        for (let x = 0; x < src.w; x++) buf.set(x + ox, y + oy, src.get(x, y));
      }
    },
  });
  return key;
}

/** Register every weapon's icon and projectile art. Idempotent. */
export function registerAllWeaponArt() {
  const keys = {};
  for (const [id, art] of Object.entries(WEAPON_ART)) {
    keys[id] = {
      icon: registerArt(id, art, 'icon', { scale: 3 }),
      // Projectiles rotate to face travel, so they pre-bake headings.
      proj: registerArt(id, art, 'proj', { scale: 2, directional: true }),
    };
  }
  for (const [id, art] of Object.entries(EVOLVED_ART)) {
    keys[id] = {
      icon: registerArt(id, art, 'icon', { scale: 3 }),
      proj: registerArt(id, art, 'proj', { scale: 3, directional: true }),
    };
  }
  return keys;
}

/** Frame count for a matrix set — used to seed animation state. */
export function frameCount(id, kind) {
  const art = WEAPON_ART[id] ?? EVOLVED_ART[id];
  if (art === undefined || art[kind] === undefined) return 1;
  return art[kind].length;
}

/**
 * Catch the one mistake this art format makes easy and silent: using a
 * character in a matrix that the sprite's palette has no entry for.
 *
 * An unmapped character renders transparent, so the sprite still "works" — it
 * is just invisible, or missing exactly the pixels you were looking at when
 * you wrote it. Nothing throws, nothing warns, and you find out by noticing a
 * weapon that fires nothing you can see. This walks every matrix and reports
 * unknown characters up front instead.
 *
 * Call from a test or a dev boot; it allocates nothing in production paths.
 */
export function validateArt() {
  const problems = [];
  const check = (setName, id, art) => {
    for (const kind of ['icon', 'proj']) {
      const frames = art[kind];
      if (frames === undefined) continue;
      frames.forEach((frame, fi) => {
        const unknown = new Set();
        for (const row of frame) {
          for (const ch of row) {
            if (!(ch in art.palette)) unknown.add(ch);
          }
        }
        if (unknown.size > 0) {
          problems.push({
            set: setName, id, kind, frame: fi,
            unknownChars: [...unknown],
            hint: 'not in palette — these pixels render transparent',
          });
        }
      });
    }
  };
  for (const [id, art] of Object.entries(WEAPON_ART)) check('WEAPON_ART', id, art);
  for (const [id, art] of Object.entries(EVOLVED_ART)) check('EVOLVED_ART', id, art);
  return problems;
}
