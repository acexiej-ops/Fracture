/**
 * craftingStations.js — placeable crafting stations with multi-step recipes.
 *
 * Stations are world entities that players can walk up to and interact with.
 * Each station type unlocks specific recipe categories and has a multi-step
 * crafting process (gather materials -> refine -> assemble).
 *
 * Stations persist between runs via the profile but are placed during runs
 * at fixed arena positions. They are NOT player-built — they are pre-existing
 * structures the player discovers and activates.
 */

import { MATERIAL_IDS } from '../meta/materials.js';

/**
 * Station types. Each provides access to different recipe tiers and categories.
 */
export const STATION_TYPES = {
  forge: {
    id: 'forge',
    name: 'Fracture Forge',
    desc: 'Raw material refinement. Converts base materials into higher tiers.',
    color: '#ff8a3d',
    radius: 28,
    recipes: ['refine_slag', 'refine_filament', 'refine_alloy'],
    unlockWave: 1,
  },
  altar: {
    id: 'altar',
    name: 'Ichor Altar',
    desc: 'Channel Ichor energy to empower gear beyond normal limits.',
    color: '#ff5ec4',
    radius: 24,
    recipes: ['empower_weapon', 'empower_armor', 'empower_trinket'],
    unlockWave: 5,
  },
  anvil: {
    id: 'anvil',
    name: 'Resonant Anvil',
    desc: 'Reshape gear affixes. Roll new properties on existing equipment.',
    color: '#4fd8ff',
    radius: 26,
    recipes: ['reforge_common', 'reforge_rare', 'reforge_legendary'],
    unlockWave: 3,
  },
  well: {
    id: 'well',
    name: 'Core Well',
    desc: 'Extract power from Core shards to create unique effects.',
    color: '#b45cff',
    radius: 22,
    recipes: ['extract_core', 'imbue_core'],
    unlockWave: 8,
  },
};

/**
 * Multi-step crafting recipes specific to stations.
 *
 * Each recipe has stages: materials -> intermediate -> final product.
 * The player must complete each stage in order. Each stage has its own cost
 * and output, and intermediate items are consumed when the next stage starts.
 */
export const STATION_RECIPES = {
  // Forge: material refinement
  refine_slag: {
    id: 'refine_slag',
    name: 'Purify Slag',
    desc: 'Burn impurities out of raw slag.',
    station: 'forge',
    stages: [
      { name: 'Heat', cost: { slag: 15 }, output: 'heated_slag', time: 3 },
      { name: 'Purify', cost: { heated_slag: 1 }, output: { filament: 4 }, time: 2 },
    ],
  },
  refine_filament: {
    id: 'refine_filament',
    name: 'Draw Filament',
    desc: 'Draw filament into usable conductors.',
    station: 'forge',
    stages: [
      { name: 'Heat', cost: { filament: 12 }, output: 'heated_filament', time: 3 },
      { name: 'Draw', cost: { heated_filament: 1 }, output: { alloy: 2 }, time: 2.5 },
    ],
  },
  refine_alloy: {
    id: 'refine_alloy',
    name: 'Forge Alloy',
    desc: 'Smelt alloy into high-grade plating.',
    station: 'forge',
    unlock: { materials: ['alloy'] },
    stages: [
      { name: 'Smelt', cost: { alloy: 6 }, output: 'molten_alloy', time: 4 },
      { name: 'Plate', cost: { molten_alloy: 1 }, output: { ichor: 2 }, time: 3 },
    ],
  },

  // Altar: empower gear
  empower_weapon: {
    id: 'empower_weapon',
    name: 'Empower Weapon',
    desc: 'Channel Ichor through a weapon to boost its base damage.',
    station: 'altar',
    stages: [
      { name: 'Attune', cost: { ichor: 4 }, output: 'attuned_ichor', time: 3 },
      { name: 'Empower', cost: { attuned_ichor: 1 }, output: { slag: 20 }, time: 4 },
    ],
  },
  empower_armor: {
    id: 'empower_armor',
    name: 'Empower Armor',
    desc: 'Infuse armor with Ichor for extra protection.',
    station: 'altar',
    stages: [
      { name: 'Attune', cost: { ichor: 3 }, output: 'attuned_ichor', time: 3 },
      { name: 'Infuse', cost: { attuned_ichor: 1 }, output: { filament: 15 }, time: 4 },
    ],
  },
  empower_trinket: {
    id: 'empower_trinket',
    name: 'Empower Trinket',
    desc: 'Resonate a trinket with Core energy.',
    station: 'altar',
    unlock: { materials: ['core'] },
    stages: [
      { name: 'Attune', cost: { ichor: 6, core: 1 }, output: 'empowered_core', time: 5 },
      { name: 'Resonate', cost: { empowered_core: 1 }, output: { core: 1, ichor: 4 }, time: 4 },
    ],
  },

  // Anvil: reforge gear
  reforge_common: {
    id: 'reforge_common',
    name: 'Reforge (Common)',
    desc: 'Reroll common-tier affixes.',
    station: 'anvil',
    stages: [
      { name: 'Break Down', cost: { slag: 8 }, output: 'broken_slag', time: 2 },
      { name: 'Reforge', cost: { broken_slag: 1 }, output: { slag: 5 }, time: 2 },
    ],
  },
  reforge_rare: {
    id: 'reforge_rare',
    name: 'Reforge (Rare)',
    desc: 'Reroll rare-tier affixes with better odds.',
    station: 'anvil',
    unlock: { materials: ['alloy'] },
    stages: [
      { name: 'Disassemble', cost: { alloy: 3 }, output: 'alloy_scraps', time: 3 },
      { name: 'Reshape', cost: { alloy_scraps: 1 }, output: { alloy: 2, filament: 8 }, time: 3 },
    ],
  },
  reforge_legendary: {
    id: 'reforge_legendary',
    name: 'Reforge (Legendary)',
    desc: 'Reroll legendary affixes with excellent odds.',
    station: 'anvil',
    unlock: { materials: ['ichor'] },
    stages: [
      { name: 'Dissolve', cost: { ichor: 5 }, output: 'dissolved_ichor', time: 4 },
      { name: 'Restore', cost: { dissolved_ichor: 1 }, output: { ichor: 3, core: 1 }, time: 4 },
    ],
  },

  // Well: core extraction
  extract_core: {
    id: 'extract_core',
    name: 'Extract Core',
    desc: 'Pull usable Core from raw Ichor.',
    station: 'well',
    unlock: { materials: ['ichor'] },
    stages: [
      { name: 'Filter', cost: { ichor: 10 }, output: 'filtered_ichor', time: 4 },
      { name: 'Extract', cost: { filtered_ichor: 1 }, output: { core: 1 }, time: 5 },
    ],
  },
  imbue_core: {
    id: 'imbue_core',
    name: 'Imbue Core',
    desc: 'Use Core to create a powerful temporary buff.',
    station: 'well',
    unlock: { materials: ['core'] },
    stages: [
      { name: 'Attune', cost: { core: 1, ichor: 6 }, output: 'imbued_core', time: 5 },
      { name: 'Release', cost: { imbued_core: 1 }, output: { slag: 40, filament: 20, alloy: 6 }, time: 3 },
    ],
  },
};

export const STATION_RECIPES_BY_ID = new Map(
  Object.entries(STATION_RECIPES).map(([k, v]) => [k, v])
);

/**
 * State for an active crafting process at a station.
 * Created when a player starts a multi-step recipe.
 */
export function createCraftingState(recipeId) {
  const recipe = STATION_RECIPES_BY_ID.get(recipeId);
  if (recipe === undefined) return null;
  return {
    recipeId,
    stageIndex: 0,
    timer: 0,
    active: true,
    completed: false,
  };
}

/**
 * Tick an active crafting process. Returns true when a stage completes.
 */
export function tickCrafting(crafting, dt, state) {
  if (crafting === null || !crafting.active || crafting.completed) return false;

  const recipe = STATION_RECIPES_BY_ID.get(crafting.recipeId);
  if (recipe === undefined) return false;

  const stage = recipe.stages[crafting.stageIndex];
  if (stage === undefined) {
    crafting.completed = true;
    crafting.active = false;
    return false;
  }

  crafting.timer += dt;
  if (crafting.timer >= stage.time) {
    crafting.timer = 0;
    crafting.stageIndex++;

    if (crafting.stageIndex >= recipe.stages.length) {
      crafting.completed = true;
      crafting.active = false;
      return true;  // full recipe complete
    }
  }
  return false;
}

/**
 * Can a player start this recipe? Checks material costs of the first stage.
 */
export function canStartRecipe(recipeId, materials) {
  const recipe = STATION_RECIPES_BY_ID.get(recipeId);
  if (recipe === undefined) return false;
  const stage = recipe.stages[0];
  for (const id in stage.cost) {
    if ((materials[id] ?? 0) < stage.cost[id]) return false;
  }
  return true;
}

/**
 * Get the crafting progress (0-1) for display.
 */
export function craftingProgress(crafting) {
  if (crafting === null || !crafting.active) return crafting?.completed ? 1 : 0;
  const recipe = STATION_RECIPES_BY_ID.get(crafting.recipeId);
  if (recipe === undefined) return 0;
  const stage = recipe.stages[crafting.stageIndex];
  if (stage === undefined) return 1;
  const stagesComplete = crafting.stageIndex;
  const stageProgress = crafting.timer / stage.time;
  return (stagesComplete + stageProgress) / recipe.stages.length;
}

/** World positions where stations can appear in the arena. */
export const STATION_POSITIONS = [
  { x: 400, y: 400, type: 'forge' },
  { x: 2200, y: 400, type: 'anvil' },
  { x: 400, y: 1500, type: 'altar' },
  { x: 2200, y: 1500, type: 'well' },
  { x: 1300, y: 250, type: 'forge' },
  { x: 1300, y: 1650, type: 'anvil' },
];

/**
 * Which stations are available for the current wave?
 */
export function availableStations(wave) {
  return STATION_POSITIONS.filter((pos) => {
    const type = STATION_TYPES[pos.type];
    return type !== undefined && wave >= type.unlockWave;
  });
}
