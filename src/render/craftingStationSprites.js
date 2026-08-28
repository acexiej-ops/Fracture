/**
 * craftingStationSprites.js — procedural sprite definitions for crafting stations.
 *
 * Each station type gets a distinct silhouette drawn from the shared
 * PixelBuffer pipeline. Stations are larger than player sprites and
 * rendered with a glow aura to make them visible from a distance.
 */

export const CRAFTING_STATION_SPRITES = {
  forge: {
    width: 5, height: 5,
    pixels: [
      '..#..',
      '.###.',
      '#####',
      '.###.',
      '..#..',
    ],
    palette: { '#': '#ff8a3d' },
    glow: { color: '#ff8a3d', radius: 20, alpha: 0.35 },
  },
  forge_active: {
    width: 5, height: 5,
    pixels: [
      '.***.',
      '*###*',
      '#####',
      '*###*',
      '.***.',
    ],
    palette: { '#': '#ff8a3d', '*': '#ffcc80' },
    glow: { color: '#ffcc80', radius: 28, alpha: 0.5 },
  },
  altar: {
    width: 5, height: 5,
    pixels: [
      '.#.#.',
      '..#..',
      '#####',
      '.#.#.',
      '.....',
    ],
    palette: { '#': '#ff5ec4' },
    glow: { color: '#ff5ec4', radius: 18, alpha: 0.3 },
  },
  altar_active: {
    width: 5, height: 5,
    pixels: [
      '.***.',
      '..#..',
      '#####',
      '.#.#.',
      '.....',
    ],
    palette: { '#': '#ff5ec4', '*': '#ffaae0' },
    glow: { color: '#ffaae0', radius: 24, alpha: 0.45 },
  },
  anvil: {
    width: 5, height: 5,
    pixels: [
      '#####',
      '.###.',
      '..#..',
      '.###.',
      '#####',
    ],
    palette: { '#': '#4fd8ff' },
    glow: { color: '#4fd8ff', radius: 16, alpha: 0.3 },
  },
  anvil_active: {
    width: 5, height: 5,
    pixels: [
      '#####',
      '*###*',
      '..#..',
      '*###*',
      '#####',
    ],
    palette: { '#': '#4fd8ff', '*': '#aaeeff' },
    glow: { color: '#aaeeff', radius: 22, alpha: 0.45 },
  },
  well: {
    width: 4, height: 5,
    pixels: [
      '.##.',
      '#..#',
      '#..#',
      '.##.',
      '..#.',
    ],
    palette: { '#': '#b45cff' },
    glow: { color: '#b45cff', radius: 16, alpha: 0.3 },
  },
  well_active: {
    width: 4, height: 5,
    pixels: [
      '.##.',
      '#**#',
      '#**#',
      '.##.',
      '..#.',
    ],
    palette: { '#': '#b45cff', '*': '#ddbbff' },
    glow: { color: '#ddbbff', radius: 22, alpha: 0.45 },
  },

  // Crafting progress indicator (drawn above the station)
  progress_ring: {
    width: 7, height: 7,
    pixels: [
      '..###..',
      '.#...#.',
      '#.....#',
      '#.....#',
      '#.....#',
      '.#...#.',
      '..###..',
    ],
    palette: { '#': '#ffffff' },
    glow: { color: '#ffffff', radius: 6, alpha: 0.2 },
  },
};
