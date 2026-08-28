/**
 * skillTree.js — PoE-style passive skill web.
 *
 * A hexagonal grid of nodes, each granting a small passive bonus. Players
 * allocate nodes at level milestones (10, 20, 30, 40, 50, 60) — one node per
 * milestone, chosen from the frontier of already-connected nodes.
 *
 * Nodes are organized in clusters radiating outward from a central keystone.
 * Each cluster has a theme (offence, defence, utility, elemental) so the tree
 * reads as a set of meaningful paths rather than a random scatter.
 *
 * Allocations persist in the profile and reset at the start of each run —
 * the tree is a permanent account-level progression, not a per-run choice.
 */

export const ALLOCATE_LEVELS = [10, 20, 30, 40, 50, 60];

/**
 * Node shapes: small, medium, keystone.
 * Keystones are powerful but require 3+ adjacent allocations to reach.
 */
const SHAPE = {
  SMALL: 'small',
  MEDIUM: 'medium',
  KEYSTONE: 'keystone',
};

/**
 * All skill tree nodes. Layout uses hex-grid coordinates (col, row).
 * The rendering layer converts these to pixel positions.
 *
 * Each node grants one or more stat modifiers in the same format as character
 * stats: { stat, type, value }.
 */
export const SKILL_NODES = [
  // ===== Centre: starter keystone =====
  { id: 'root', col: 0, row: 0, shape: SHAPE.KEYSTONE, name: 'Fracture Touched',
    desc: '+5% damage, +3% move speed',
    stats: [
      { stat: 'damage', type: 'inc', value: 0.05 },
      { stat: 'moveSpeed', type: 'inc', value: 0.03 },
    ],
    requires: [], },

  // ===== Offence cluster (right) =====
  { id: 'o1', col: 2, row: 0, shape: SHAPE.SMALL, name: 'Sharp Edge',
    desc: '+4% damage',
    stats: [{ stat: 'damage', type: 'inc', value: 0.04 }],
    requires: ['root'], },
  { id: 'o2', col: 4, row: 0, shape: SHAPE.SMALL, name: 'Deep Strike',
    desc: '+3% crit chance',
    stats: [{ stat: 'critChance', type: 'flat', value: 0.03 }],
    requires: ['o1'], },
  { id: 'o3', col: 4, row: 1, shape: SHAPE.SMALL, name: 'Momentum',
    desc: '+6% attack speed',
    stats: [{ stat: 'attackSpeed', type: 'inc', value: 0.06 }],
    requires: ['o1'], },
  { id: 'o4', col: 6, row: 0, shape: SHAPE.KEYSTONE, name: 'Glass Cannon',
    desc: '+12% damage, -8% max HP',
    stats: [
      { stat: 'damage', type: 'inc', value: 0.12 },
      { stat: 'maxHp', type: 'flat', value: -8 },
    ],
    requires: ['o2', 'o3'], },
  { id: 'o5', col: 6, row: 2, shape: SHAPE.SMALL, name: 'Keen Eye',
    desc: '+0.15 crit multiplier',
    stats: [{ stat: 'critMult', type: 'flat', value: 0.15 }],
    requires: ['o3'], },
  { id: 'o6', col: 8, row: 1, shape: SHAPE.MEDIUM, name: 'Volatility',
    desc: '+5% damage, +3% area',
    stats: [
      { stat: 'damage', type: 'inc', value: 0.05 },
      { stat: 'area', type: 'inc', value: 0.03 },
    ],
    requires: ['o4', 'o5'], },

  // ===== Defence cluster (left) =====
  { id: 'd1', col: -2, row: 0, shape: SHAPE.SMALL, name: 'Thick Skin',
    desc: '+8 max HP',
    stats: [{ stat: 'maxHp', type: 'flat', value: 8 }],
    requires: ['root'], },
  { id: 'd2', col: -4, row: 0, shape: SHAPE.SMALL, name: 'Iron Blood',
    desc: '+0.3 regen',
    stats: [{ stat: 'regen', type: 'flat', value: 0.3 }],
    requires: ['d1'], },
  { id: 'd3', col: -4, row: -1, shape: SHAPE.SMALL, name: 'Fortified',
    desc: '+5 max HP, +0.2 regen',
    stats: [
      { stat: 'maxHp', type: 'flat', value: 5 },
      { stat: 'regen', type: 'flat', value: 0.2 },
    ],
    requires: ['d1'], },
  { id: 'd4', col: -6, row: 0, shape: SHAPE.KEYSTONE, name: 'Unyielding',
    desc: '+20 max HP, -4% move speed',
    stats: [
      { stat: 'maxHp', type: 'flat', value: 20 },
      { stat: 'moveSpeed', type: 'inc', value: -0.04 },
    ],
    requires: ['d2', 'd3'], },
  { id: 'd5', col: -6, row: -2, shape: SHAPE.SMALL, name: 'Second Wind',
    desc: '+1.0 regen',
    stats: [{ stat: 'regen', type: 'flat', value: 1.0 }],
    requires: ['d3'], },
  { id: 'd6', col: -8, row: -1, shape: SHAPE.MEDIUM, name: 'Bulwark Soul',
    desc: '+10 max HP, +0.5 regen',
    stats: [
      { stat: 'maxHp', type: 'flat', value: 10 },
      { stat: 'regen', type: 'flat', value: 0.5 },
    ],
    requires: ['d4', 'd5'], },

  // ===== Utility cluster (up) =====
  { id: 'u1', col: 0, row: -2, shape: SHAPE.SMALL, name: 'Fleet Foot',
    desc: '+4% move speed',
    stats: [{ stat: 'moveSpeed', type: 'inc', value: 0.04 }],
    requires: ['root'], },
  { id: 'u2', col: 1, row: -4, shape: SHAPE.SMALL, name: 'Quick Hands',
    desc: '+5% attack speed',
    stats: [{ stat: 'attackSpeed', type: 'inc', value: 0.05 }],
    requires: ['u1'], },
  { id: 'u3', col: -1, row: -4, shape: SHAPE.SMALL, name: 'Scavenger',
    desc: '+8% pickup radius',
    stats: [{ stat: 'pickupRadius', type: 'inc', value: 0.08 }],
    requires: ['u1'], },
  { id: 'u4', col: 0, row: -6, shape: SHAPE.KEYSTONE, name: 'Magnetic Core',
    desc: '+18% pickup radius, +5% move speed',
    stats: [
      { stat: 'pickupRadius', type: 'inc', value: 0.18 },
      { stat: 'moveSpeed', type: 'inc', value: 0.05 },
    ],
    requires: ['u2', 'u3'], },
  { id: 'u5', col: 2, row: -5, shape: SHAPE.SMALL, name: 'Haste',
    desc: '+3% move speed, +3% attack speed',
    stats: [
      { stat: 'moveSpeed', type: 'inc', value: 0.03 },
      { stat: 'attackSpeed', type: 'inc', value: 0.03 },
    ],
    requires: ['u2'], },
  { id: 'u6', col: 0, row: -8, shape: SHAPE.MEDIUM, name: 'Time Slip',
    desc: '+6% attack speed, +4% move speed',
    stats: [
      { stat: 'attackSpeed', type: 'inc', value: 0.06 },
      { stat: 'moveSpeed', type: 'inc', value: 0.04 },
    ],
    requires: ['u4', 'u5'], },

  // ===== Elemental cluster (down) =====
  { id: 'e1', col: 0, row: 2, shape: SHAPE.SMALL, name: 'Wide Blast',
    desc: '+4% area',
    stats: [{ stat: 'area', type: 'inc', value: 0.04 }],
    requires: ['root'], },
  { id: 'e2', col: 1, row: 4, shape: SHAPE.SMALL, name: 'Lingering',
    desc: '+5% duration',
    stats: [{ stat: 'duration', type: 'inc', value: 0.05 }],
    requires: ['e1'], },
  { id: 'e3', col: -1, row: 4, shape: SHAPE.SMALL, name: 'Kinetic',
    desc: '+4% projectile speed',
    stats: [{ stat: 'projectileSpeed', type: 'inc', value: 0.04 }],
    requires: ['e1'], },
  { id: 'e4', col: 0, row: 6, shape: SHAPE.KEYSTONE, name: 'Overcharged',
    desc: '+8% area, +8% duration, -5% damage',
    stats: [
      { stat: 'area', type: 'inc', value: 0.08 },
      { stat: 'duration', type: 'inc', value: 0.08 },
      { stat: 'damage', type: 'inc', value: -0.05 },
    ],
    requires: ['e2', 'e3'], },
  { id: 'e5', col: 2, row: 5, shape: SHAPE.SMALL, name: 'Shrapnel',
    desc: '+1 projectile count',
    stats: [{ stat: 'projectileCount', type: 'flat', value: 1 }],
    requires: ['e2'], },
  { id: 'e6', col: 0, row: 8, shape: SHAPE.MEDIUM, name: 'Deluge',
    desc: '+6% area, +1 projectile',
    stats: [
      { stat: 'area', type: 'inc', value: 0.06 },
      { stat: 'projectileCount', type: 'flat', value: 1 },
    ],
    requires: ['e4', 'e5'], },

  // ===== Outer ring connector nodes (small, cheap) =====
  { id: 'c1', col: 3, row: -3, shape: SHAPE.SMALL, name: 'Edge',
    desc: '+3% damage',
    stats: [{ stat: 'damage', type: 'inc', value: 0.03 }],
    requires: ['o1', 'u2'], },
  { id: 'c2', col: -3, row: -3, shape: SHAPE.SMALL, name: 'Guard',
    desc: '+5 max HP',
    stats: [{ stat: 'maxHp', type: 'flat', value: 5 }],
    requires: ['d1', 'u3'], },
  { id: 'c3', col: 3, row: 3, shape: SHAPE.SMALL, name: 'Reach',
    desc: '+4% projectile speed',
    stats: [{ stat: 'projectileSpeed', type: 'inc', value: 0.04 }],
    requires: ['o1', 'e3'], },
  { id: 'c4', col: -3, row: 3, shape: SHAPE.SMALL, name: 'Resilient',
    desc: '+0.3 regen, +5 max HP',
    stats: [
      { stat: 'regen', type: 'flat', value: 0.3 },
      { stat: 'maxHp', type: 'flat', value: 5 },
    ],
    requires: ['d2', 'e2'], },
];

export const SKILL_NODE_BY_ID = new Map(SKILL_NODES.map((n) => [n.id, n]));

/**
 * Get the set of node IDs a player can allocate next.
 * A node is available if:
 *   - not already allocated
 *   - at least one of its `requires` is already allocated
 *   - (root is always available if nothing is allocated yet)
 */
export function getAvailableNodes(allocated) {
  const allocSet = new Set(allocated);
  const result = [];
  for (const node of SKILL_NODES) {
    if (allocSet.has(node.id)) continue;
    if (node.requires.length === 0 && allocated.length === 0) {
      result.push(node.id);
      continue;
    }
    if (node.requires.some((r) => allocSet.has(r))) {
      result.push(node.id);
    }
  }
  return result;
}

/**
 * How many level milestones has the player reached?
 * This is the number of nodes they may allocate.
 */
export function maxAllocations(level) {
  let count = 0;
  for (const threshold of ALLOCATE_LEVELS) {
    if (level >= threshold) count++;
  }
  return count;
}

/**
 * Compute the aggregate stat bonuses from all allocated nodes.
 * Returns an array of stat modifiers ready for the Stats stack.
 */
export function computeTreeBonuses(allocated) {
  const mods = [];
  for (const id of allocated) {
    const node = SKILL_NODE_BY_ID.get(id);
    if (node === undefined) continue;
    for (const s of node.stats) {
      mods.push({ ...s, source: 'skillTree' });
    }
  }
  return mods;
}

/**
 * Validate an allocation list — ensure no node is listed twice, all
 * prerequisites are met, and the count does not exceed the max.
 */
export function validateAllocations(allocated, level) {
  if (allocated.length > maxAllocations(level)) return false;
  const seen = new Set();
  for (const id of allocated) {
    if (seen.has(id)) return false;
    seen.add(id);
    const node = SKILL_NODE_BY_ID.get(id);
    if (node === undefined) return false;
    if (node.requires.length === 0 && allocated.indexOf(id) !== 0) {
      // root must be first if present
    }
    // All requires must be before this node in the list
    const idx = allocated.indexOf(id);
    for (const req of node.requires) {
      if (allocated.indexOf(req) >= idx) return false;
    }
  }
  return true;
}
