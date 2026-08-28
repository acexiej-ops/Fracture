/**
 * terrainSprites.js — procedural sprite definitions for terrain objects.
 *
 * Each terrain type has a simple pixel-art shape drawn from the shared
 * PixelBuffer pipeline. Explosive barrels and healing wells get distinct
 * color coding so the player can read them at a glance.
 */

export const TERRAIN_SPRITES = {
  crate: {
    width: 4, height: 4,
    pixels: [
      '####',
      '#..#',
      '#..#',
      '####',
    ],
    palette: { '#': '#8a6b3d', '.': '#6b5228' },
  },
  crate_damaged: {
    width: 4, height: 4,
    pixels: [
      '##.#',
      '#..#',
      '#..#',
      '.##.',
    ],
    palette: { '#': '#8a6b3d', '.': '#6b5228' },
  },
  barrel: {
    width: 4, height: 5,
    pixels: [
      '.##.',
      '#..#',
      '#..#',
      '#..#',
      '.##.',
    ],
    palette: { '#': '#cc3333', '.': '#991111' },
  },
  barrel_damaged: {
    width: 4, height: 5,
    pixels: [
      '.##.',
      '#..#',
      '#.#.',
      '#..#',
      '.##.',
    ],
    palette: { '#': '#cc3333', '.': '#991111' },
  },
  spike: {
    width: 3, height: 3,
    pixels: [
      '.#.',
      '#.#',
      '#.#',
    ],
    palette: { '#': '#a97dff' },
    glow: { color: '#a97dff', radius: 10, alpha: 0.25 },
  },
  well_heal: {
    width: 5, height: 5,
    pixels: [
      '.###.',
      '#...#',
      '#.#.#',
      '#...#',
      '.###.',
    ],
    palette: { '#': '#4a9a6a', '.': '#2a6a4a' },
    glow: { color: '#7dffa8', radius: 16, alpha: 0.3 },
  },
  crystal: {
    width: 3, height: 5,
    pixels: [
      '.#.',
      '###',
      '###',
      '###',
      '.#.',
    ],
    palette: { '#': '#ffe066' },
    glow: { color: '#ffe066', radius: 12, alpha: 0.3 },
  },
  rock: {
    width: 5, height: 4,
    pixels: [
      '..#..',
      '.###.',
      '#####',
      '#####',
    ],
    palette: { '#': '#576574', '.': '#3d4a56' },
  },

  // Explosion visual (drawn briefly when a barrel detonates)
  explosion: {
    width: 7, height: 7,
    pixels: [
      '..***..',
      '.*****.',
      '*******',
      '*******',
      '*******',
      '.*****.',
      '..***..',
    ],
    palette: { '*': '#ff8a3d' },
    glow: { color: '#ff3b3b', radius: 24, alpha: 0.6 },
  },

  // Heal burst visual
  heal_burst: {
    width: 5, height: 5,
    pixels: [
      '..*..',
      '.*.*.',
      '*...*',
      '.*.*.',
      '..*..',
    ],
    palette: { '*': '#7dffa8' },
    glow: { color: '#7dffa8', radius: 14, alpha: 0.4 },
  },
};
