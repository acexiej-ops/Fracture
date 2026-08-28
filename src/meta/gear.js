/**
 * gear.js — crafted items: slots, rarity, rolled bases, and affixes.
 *
 * An item is data. It carries a list of stat modifiers in exactly the shape
 * `Stats.add()` already takes, plus optional `flags` for behaviour that isn't a
 * number. That is the whole reason equipping gear needs no changes to any
 * combat code: a crafted affix and a level-up upgrade are the same thing to the
 * modifier stack, so they stack and resolve together automatically.
 *
 *   value = (base + sum(flat)) * (1 + sum(inc)) * product(mult)
 *
 * Gear modifiers are applied at run start, before the first level-up, and are
 * tagged `gear:<uid>` so a single item's contribution can be removed cleanly.
 */

/**
 * Six named slots, not three generic ones — each carries its own stat
 * identity, so "what should I craft next" is a real question with a real
 * answer instead of "whatever's cheapest in this bucket".
 */
export const SLOTS = {
  weapon:   { id: 'weapon',   name: 'Rig',       blurb: 'Walk into the Fracture already holding it.' },
  necklace: { id: 'necklace', name: 'Necklace',  blurb: 'Attack power and whatever your passives are quietly doing.' },
  gloves:   { id: 'gloves',   name: 'Gloves',    blurb: 'Baseline attack stats — and where a critical strike comes from.' },
  suit:     { id: 'suit',     name: 'Suit',      blurb: 'Health, mostly. A lot of it.' },
  belt:     { id: 'belt',     name: 'Belt',      blurb: 'Health, and whatever stands between you and the next hit.' },
  boots:    { id: 'boots',    name: 'Boots',     blurb: 'Health and how fast you move around the Fracture.' },
};

/**
 * The rarity ladder: seven standard tiers, plus Ancient as the one special
 * tier above them.
 *
 * Two things climb together, on purpose: `affixes` (how many effect lines the
 * item rolls) and `baseScale` (how hard its base stats hit). Raising only one
 * makes a top-tier item either a stat stick with no character or a pile of
 * small effects on a weak frame; raising both is what makes a Mythic roll feel
 * categorically different from a Rare rather than 20% better.
 *
 * `baseScale` growth is deliberately super-linear at the top while cost
 * growth is steeper still (see RARITY_COST). The top tiers are meant to be
 * chase items you craft occasionally, not the default you make every time
 * you have materials — Ancient especially: it isn't the eighth rung of the
 * same ladder so much as a separate, rarer thing sitting above it, with its
 * own exclusive affixes (see AFFIXES below) nothing lower can roll.
 *
 * Colours run the conventional game-loot spectrum — grey, green, blue,
 * purple, pink, red, gold — because players already read that ladder
 * instantly and inventing a private one buys nothing. Ancient deliberately
 * breaks from it (a pale, near-white glow) rather than inventing an eighth
 * saturated colour, since the point is that it doesn't quite belong on the
 * same ladder as the seven that do.
 */
export const RARITIES = {
  common:    { id: 'common',    name: 'Common',    affixes: 1, color: '#9fb3c8', baseScale: 1.00 },
  uncommon:  { id: 'uncommon',  name: 'Uncommon',  affixes: 2, color: '#7dffa8', baseScale: 1.12 },
  rare:      { id: 'rare',      name: 'Rare',      affixes: 3, color: '#4fd8ff', baseScale: 1.26 },
  epic:      { id: 'epic',      name: 'Epic',      affixes: 4, color: '#b45cff', baseScale: 1.42 },
  // Exotic and Legendary swapped power levels here on request (the ladder
  // order became Common/Uncommon/Rare/Epic/Exotic/Mythic/Legendary) — each
  // NAME kept its own established colour (Exotic stays pink, Legendary
  // stays gold, Mythic stays red), only which POSITION each name sits at
  // changed. Legendary is now the top of these seven; Ancient sits above
  // all of them as the one genuinely special tier beyond the normal ladder.
  exotic:    { id: 'exotic',    name: 'Exotic',    affixes: 5, color: '#ff5ec4', baseScale: 1.60 },
  mythic:    { id: 'mythic',    name: 'Mythic',    affixes: 6, color: '#ff4d6d', baseScale: 1.82 },
  legendary: { id: 'legendary', name: 'Legendary', affixes: 7, color: '#ffb703', baseScale: 2.10 },
  // A near-white, slightly warm glow — every other tier already owns a
  // saturated colour (grey/green/cyan/purple/pink/red/gold), so "beyond
  // Legendary" reads clearest as something none of them are: pale, bright,
  // almost colourless, like it doesn't quite belong on the same ladder.
  ancient:   { id: 'ancient',   name: 'Ancient',   affixes: 8, color: '#f5f3e8', baseScale: 2.5 },
};

export const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'exotic', 'mythic', 'legendary', 'ancient'];

// ---------------------------------------------------------------------------
// Affixes
// ---------------------------------------------------------------------------

/**
 * `minRarity` gates the strongest affixes behind better crafts, which is what
 * makes an exotic roll worth chasing beyond simply having more lines on it.
 * `slots` restricts an affix to where it makes sense.
 *
 * `roll(rng)` returns { desc, mods, flags } — mods feed the stat stack, flags
 * feed `state.flags` for behaviour the modifier system can't express.
 */
export const AFFIXES = [
  {
    id: 'crit', name: 'Keen', minRarity: 'common',
    roll: (r) => { const v = r.range(0.04, 0.09);
      return { desc: '+' + Math.round(v * 100) + '% critical strike chance',
        mods: [{ stat: 'critChance', type: 'flat', value: v }] }; },
  },
  {
    id: 'critdmg', name: 'Brutal', minRarity: 'rare',
    roll: (r) => { const v = r.range(0.18, 0.42);
      return { desc: '+' + Math.round(v * 100) + '% critical damage',
        mods: [{ stat: 'critMult', type: 'flat', value: v }] }; },
  },
  {
    id: 'damage', name: 'Honed', minRarity: 'common',
    roll: (r) => { const v = r.range(0.06, 0.14);
      return { desc: '+' + Math.round(v * 100) + '% damage',
        mods: [{ stat: 'damage', type: 'inc', value: v }] }; },
  },
  {
    id: 'haste', name: 'Quickened', minRarity: 'common',
    roll: (r) => { const v = r.range(0.05, 0.12);
      return { desc: '+' + Math.round(v * 100) + '% attack speed',
        mods: [{ stat: 'attackSpeed', type: 'inc', value: v }] }; },
  },
  {
    id: 'area', name: 'Broad', minRarity: 'common',
    roll: (r) => { const v = r.range(0.06, 0.15);
      return { desc: '+' + Math.round(v * 100) + '% area of effect',
        mods: [{ stat: 'area', type: 'inc', value: v }] }; },
  },
  {
    id: 'hp', name: 'Bolstered', minRarity: 'common',
    roll: (r) => { const v = Math.round(r.range(14, 30));
      return { desc: '+' + v + ' max health',
        mods: [{ stat: 'maxHp', type: 'flat', value: v }] }; },
  },
  {
    id: 'regen', name: 'Mending', minRarity: 'common',
    roll: (r) => { const v = r.range(0.3, 0.9);
      return { desc: '+' + v.toFixed(1) + ' health per second',
        mods: [{ stat: 'regen', type: 'flat', value: v }] }; },
  },
  {
    id: 'move', name: 'Fleet', minRarity: 'common',
    roll: (r) => { const v = r.range(0.04, 0.09);
      return { desc: '+' + Math.round(v * 100) + '% movement speed',
        mods: [{ stat: 'moveSpeed', type: 'inc', value: v }] }; },
  },
  {
    id: 'pickup', name: 'Attracting', minRarity: 'common',
    roll: (r) => { const v = r.range(0.15, 0.40);
      return { desc: '+' + Math.round(v * 100) + '% XP pickup radius',
        mods: [{ stat: 'pickupRadius', type: 'inc', value: v }] }; },
  },
  {
    id: 'duration', name: 'Enduring', minRarity: 'rare',
    roll: (r) => { const v = r.range(0.10, 0.25);
      return { desc: '+' + Math.round(v * 100) + '% effect duration',
        mods: [{ stat: 'duration', type: 'inc', value: v }] }; },
  },
  {
    id: 'pierce', name: 'Perforating', minRarity: 'rare',
    roll: () => ({ desc: 'All shots pass through +1 enemy',
      mods: [{ stat: 'pierce', type: 'flat', value: 1 }] }),
  },
  {
    id: 'multishot', name: 'Splintering', minRarity: 'exotic',
    roll: () => ({ desc: '+1 projectile from every weapon',
      mods: [{ stat: 'projectileCount', type: 'flat', value: 1 }] }),
  },
  // === Added with the seven-tier ladder ====================================
  //
  // Every mod below uses a stat the Stats stack already resolves, and every
  // flag is one the engine already reads (see enemies.js / chests.js). That is
  // deliberate: an affix naming a stat nothing consumes rolls, displays, and
  // does absolutely nothing — a failure that is invisible in the UI and only
  // shows up as "this item feels bad". Adding a genuinely new effect means
  // wiring the engine in the same change, not just adding a line here.

  {
    id: 'pierce_gear', name: 'Lancing', minRarity: 'uncommon',
    roll: (r) => { const v = Math.round(r.range(1, 2));
      return { desc: '+' + v + ' pierce on every projectile',
        mods: [{ stat: 'pierce', type: 'flat', value: v }] }; },
  },
  {
    id: 'duration_gear', name: 'Lingering', minRarity: 'uncommon',
    roll: (r) => { const v = r.range(0.08, 0.20);
      return { desc: '+' + Math.round(v * 100) + '% effect duration',
        mods: [{ stat: 'duration', type: 'inc', value: v }] }; },
  },
  {
    id: 'velocity', name: 'Driven', minRarity: 'uncommon',
    roll: (r) => { const v = r.range(0.08, 0.18);
      return { desc: '+' + Math.round(v * 100) + '% projectile speed',
        mods: [{ stat: 'projectileSpeed', type: 'inc', value: v }] }; },
  },
  {
    id: 'knockback', name: 'Repelling', minRarity: 'uncommon',
    roll: (r) => { const v = r.range(0.15, 0.35);
      return { desc: '+' + Math.round(v * 100) + '% knockback',
        mods: [{ stat: 'knockback', type: 'inc', value: v }] }; },
  },
  {
    id: 'reach', name: 'Magnetic', minRarity: 'uncommon', slots: ['necklace'],
    roll: (r) => { const v = r.range(0.12, 0.28);
      return { desc: '+' + Math.round(v * 100) + '% pickup radius',
        mods: [{ stat: 'pickupRadius', type: 'inc', value: v }] }; },
  },
  {
    id: 'multishot_gear', name: 'Splitting', minRarity: 'epic',
    roll: () => ({ desc: '+1 projectile from every weapon',
      mods: [{ stat: 'projectileCount', type: 'flat', value: 1 }] }),
  },
  {
    id: 'savagery', name: 'Savage', minRarity: 'epic',
    roll: (r) => { const v = r.range(0.16, 0.28);
      return { desc: '+' + Math.round(v * 100) + '% damage',
        mods: [{ stat: 'damage', type: 'inc', value: v }] }; },
  },
  {
    id: 'frenzy', name: 'Frenzied', minRarity: 'epic',
    roll: (r) => { const v = r.range(0.14, 0.24);
      return { desc: '+' + Math.round(v * 100) + '% attack speed',
        mods: [{ stat: 'attackSpeed', type: 'inc', value: v }] }; },
  },
  {
    id: 'bulwarked', name: 'Adamant', minRarity: 'epic', slots: ['suit', 'belt'],
    roll: (r) => { const v = Math.round(r.range(34, 58));
      return { desc: '+' + v + ' max health',
        mods: [{ stat: 'maxHp', type: 'flat', value: v }] }; },
  },
  {
    id: 'immolation', name: 'Immolating', minRarity: 'exotic',
    roll: (r) => { const c = r.range(0.25, 0.45), d = r.range(9, 18);
      return { desc: Math.round(c * 100) + '% chance to set enemies burning ('
          + Math.round(d) + ' dps)',
        flags: { onHitBurnChance: c, onHitBurnDps: d, onHitBurnTime: 3 } }; },
  },
  {
    id: 'cataclysm', name: 'Cataclysmic', minRarity: 'exotic',
    roll: (r) => { const v = r.range(0.30, 0.50);
      return { desc: 'Slain enemies detonate for ' + Math.round(v * 100) + '% damage',
        flags: { explodeDamage: v } }; },
  },
  {
    id: 'apex', name: 'Apex', minRarity: 'mythic',
    roll: (r) => { const d = r.range(0.20, 0.32), h = r.range(0.16, 0.26);
      return { desc: '+' + Math.round(d * 100) + '% damage and +'
          + Math.round(h * 100) + '% attack speed',
        mods: [{ stat: 'damage', type: 'inc', value: d },
               { stat: 'attackSpeed', type: 'inc', value: h }] }; },
  },
  {
    id: 'executioner', name: "Executioner's", minRarity: 'mythic',
    roll: (r) => { const c = r.range(0.10, 0.16), m = r.range(0.45, 0.75);
      return { desc: '+' + Math.round(c * 100) + '% crit chance and +'
          + Math.round(m * 100) + '% crit damage',
        mods: [{ stat: 'critChance', type: 'flat', value: c },
               { stat: 'critMult', type: 'flat', value: m }] }; },
  },
  {
    id: 'unmaking', name: 'Unmaking', minRarity: 'legendary',
    roll: (r) => { const v = r.range(0.34, 0.52), p2 = Math.round(r.range(2, 3));
      return { desc: '+' + Math.round(v * 100) + '% area, +' + p2 + ' pierce, +1 projectile',
        mods: [{ stat: 'area', type: 'inc', value: v },
               { stat: 'pierce', type: 'flat', value: p2 },
               { stat: 'projectileCount', type: 'flat', value: 1 }] }; },
  },
  {
    id: 'ascendant', name: 'Ascendant', minRarity: 'legendary',
    roll: (r) => { const hp = Math.round(r.range(60, 95)), rg = r.range(1.4, 2.4);
      return { desc: '+' + hp + ' max health and +' + rg.toFixed(1) + ' health per second',
        mods: [{ stat: 'maxHp', type: 'flat', value: hp },
               { stat: 'regen', type: 'flat', value: rg }] }; },
  },

  // === Ancient-exclusive ====================================================
  //
  // These two never roll below Ancient — not a stronger version of an
  // existing line, a line that literally cannot exist on anything lower.
  // That's what makes Ancient a genuinely different thing to chase rather
  // than "Legendary with one more slot": a Legendary item can roll every
  // other affix in this file at a higher value with enough luck, but never
  // one of these two, at any luck.
  {
    id: 'transcendent', name: 'Transcendent', minRarity: 'ancient',
    roll: (r) => { const d = r.range(0.30, 0.46), h = r.range(0.24, 0.36), c = r.range(0.10, 0.16);
      return { desc: '+' + Math.round(d * 100) + '% damage, +' + Math.round(h * 100)
          + '% attack speed, +' + Math.round(c * 100) + '% crit chance',
        mods: [{ stat: 'damage', type: 'inc', value: d },
               { stat: 'attackSpeed', type: 'inc', value: h },
               { stat: 'critChance', type: 'flat', value: c }] }; },
  },
  {
    id: 'undying', name: 'Undying', minRarity: 'ancient',
    roll: (r) => { const t = Math.round(r.range(28, 45)), c = r.range(0.16, 0.26);
      return { desc: 'Enemies that touch you take ' + t + ' damage, and '
          + Math.round(c * 100) + '% of kills restore 2 health',
        flags: { thorns: t, killHealChance: c, killHealAmount: 2 } }; },
  },
];


// Behaviour affixes. These can't be expressed as a stat, so they set flags that
// the relevant system reads — the same mechanism Phase 2's synergy upgrades use,
// which means crafted gear can feed straight into those combos.
AFFIXES.push(
  {
    id: 'onhit_slow', name: 'Chilling', minRarity: 'common',
    roll: (r) => { const c = r.range(0.10, 0.22), m = r.range(0.45, 0.65);
      return { desc: Math.round(c * 100) + '% chance on hit to slow by '
          + Math.round((1 - m) * 100) + '% for 1.5s',
        flags: { onHitSlowChance: c, onHitSlowMult: m, onHitSlowTime: 1.5 } }; },
  },
  {
    id: 'onhit_burn', name: 'Smouldering', minRarity: 'rare',
    roll: (r) => { const c = r.range(0.10, 0.20), d = r.range(8, 16);
      return { desc: Math.round(c * 100) + '% chance on hit to ignite for '
          + Math.round(d) + ' damage per second',
        flags: { onHitBurnChance: c, onHitBurnDps: d, onHitBurnTime: 2 } }; },
  },
  {
    id: 'thorns', name: 'Barbed', minRarity: 'common', slots: ['belt'],
    roll: (r) => { const v = Math.round(r.range(8, 20));
      return { desc: 'Enemies that touch you take ' + v + ' damage',
        flags: { thorns: v } }; },
  },
  {
    id: 'salvage', name: 'Scavenging', minRarity: 'common', slots: ['necklace'],
    roll: (r) => { const v = r.range(0.15, 0.40);
      return { desc: '+' + Math.round(v * 100) + '% material drop chance',
        flags: { salvageBonus: v } }; },
  },
  {
    id: 'greed', name: 'Avaricious', minRarity: 'rare', slots: ['necklace'],
    roll: (r) => { const v = r.range(0.10, 0.25);
      return { desc: '+' + Math.round(v * 100) + '% experience gained',
        flags: { xpBonus: v } }; },
  },
  {
    id: 'killheal', name: 'Leeching', minRarity: 'rare',
    roll: (r) => { const c = r.range(0.03, 0.08);
      return { desc: Math.round(c * 100) + '% chance on kill to restore 2 health',
        flags: { killHealChance: c, killHealAmount: 2 } }; },
  },
  {
    id: 'volatile_seed', name: 'Unstable', minRarity: 'exotic',
    roll: (r) => { const v = Math.round(r.range(4, 9));
      return { desc: 'Slain enemies detonate for ' + v + ' damage',
        flags: { explodeDamage: v } }; },
  },
);

const AFFIX_BY_ID = new Map(AFFIXES.map((a) => [a.id, a]));

/** Affixes legal for a given rarity and slot. */
function eligibleAffixes(rarity, slot) {
  const rank = RARITY_ORDER.indexOf(rarity);
  return AFFIXES.filter((a) => {
    if (RARITY_ORDER.indexOf(a.minRarity) > rank) return false;
    if (a.slots !== undefined && !a.slots.includes(slot)) return false;
    return true;
  });
}

/** Roll the affix lines for one item. Never repeats an affix on the same item. */
export function rollAffixes(rarity, slot, rng) {
  const pool = eligibleAffixes(rarity, slot);
  const count = Math.min(RARITIES[rarity].affixes, pool.length);
  const out = [];
  const used = new Set();

  while (out.length < count) {
    const pick = pool[Math.floor(rng.next() * pool.length)];
    if (used.has(pick.id)) continue;
    used.add(pick.id);
    const rolled = pick.roll(rng);
    out.push({
      id: pick.id,
      name: pick.name,
      desc: rolled.desc,
      mods: rolled.mods ?? [],
      flags: rolled.flags ?? {},
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Crafting an item from a recipe
// ---------------------------------------------------------------------------

let uidCounter = 0;

function makeUid() {
  uidCounter++;
  return 'g' + Date.now().toString(36) + '_' + uidCounter.toString(36);
}

/**
 * Roll a concrete item from a recipe template.
 *
 * Base stats roll within the recipe's declared range and are then scaled by
 * rarity, so a rarer craft is better on both axes: stronger bases *and* more
 * affix lines. Two items off the same recipe are never quite the same.
 */
export function craftItem(recipe, rarity, rng) {
  const scale = RARITIES[rarity].baseScale;

  const base = (recipe.base ?? []).map((b) => {
    const raw = rng.range(b.min, b.max) * scale;
    // Whole numbers for flat stats; percentages keep their precision.
    const value = b.type === 'flat' ? Math.round(raw) : raw;
    return { stat: b.stat, type: b.type, value, weapon: b.weapon };
  });

  return {
    uid: makeUid(),
    recipe: recipe.id,
    name: recipe.name,
    slot: recipe.slot,
    rarity,
    weaponId: recipe.weaponId,
    base,
    affixes: rollAffixes(rarity, recipe.slot, rng),
    craftedAt: Date.now(),
  };
}

/** Human-readable lines for a base stat entry, for the item card. */
export function describeBase(entry) {
  const pct = (v) => (v >= 0 ? '+' : '') + Math.round(v * 100) + '%';
  const flat = (v) => (v >= 0 ? '+' : '') + Math.round(v);
  const NAMES = {
    maxHp: 'max health', regen: 'health per second', moveSpeed: 'movement speed',
    damage: 'damage', attackSpeed: 'attack speed', area: 'area of effect',
    critChance: 'critical chance', critMult: 'critical damage',
    pickupRadius: 'pickup radius', duration: 'effect duration',
    projectileCount: 'projectiles', pierce: 'pierce', knockback: 'knockback',
    cooldown: 'cooldown', count: 'projectiles', range: 'range',
  };
  const label = NAMES[entry.stat] ?? entry.stat;
  const amount = entry.type === 'flat' ? flat(entry.value) : pct(entry.value);
  return entry.weapon !== undefined
    ? amount + ' ' + label + ' (this weapon)'
    : amount + ' ' + label;
}

/** Every modifier an item contributes, ready for `Stats.add()`. */
export function itemModifiers(item) {
  const out = [];
  for (const b of item.base) {
    out.push({ stat: b.stat, type: b.type, value: b.value, weapon: b.weapon,
      source: 'gear:' + item.uid });
  }
  for (const a of item.affixes) {
    for (const m of a.mods) {
      out.push({ ...m, source: 'gear:' + item.uid });
    }
  }
  return out;
}

/** Merge every flag an item sets. Values accumulate across items. */
export function itemFlags(item) {
  const out = {};
  for (const a of item.affixes) {
    for (const key in a.flags) {
      out[key] = (out[key] ?? 0) + a.flags[key];
    }
  }
  return out;
}

/**
 * Rehydrate an item loaded from disk.
 *
 * Saved items are plain JSON, so anything the code expects to exist has to be
 * re-checked rather than assumed — a save written by an older build (or edited
 * by hand) must not be able to crash the run that equips it.
 */
export function sanitizeItem(raw) {
  if (raw === null || typeof raw !== 'object') return null;
  if (typeof raw.uid !== 'string' || typeof raw.slot !== 'string') return null;
  if (SLOTS[raw.slot] === undefined) return null;
  if (RARITIES[raw.rarity] === undefined) return null;

  const base = Array.isArray(raw.base)
    ? raw.base.filter((b) => b !== null && typeof b === 'object'
        && typeof b.stat === 'string' && Number.isFinite(b.value))
    : [];

  const affixes = Array.isArray(raw.affixes)
    ? raw.affixes
        .filter((a) => a !== null && typeof a === 'object' && AFFIX_BY_ID.has(a.id))
        .map((a) => ({
          id: a.id,
          name: a.name ?? AFFIX_BY_ID.get(a.id).name,
          desc: typeof a.desc === 'string' ? a.desc : '',
          mods: Array.isArray(a.mods)
            ? a.mods.filter((m) => m !== null && typeof m === 'object'
                && typeof m.stat === 'string' && Number.isFinite(m.value))
            : [],
          flags: (a.flags !== null && typeof a.flags === 'object') ? a.flags : {},
        }))
    : [];

  return {
    uid: raw.uid,
    recipe: typeof raw.recipe === 'string' ? raw.recipe : 'unknown',
    name: typeof raw.name === 'string' ? raw.name : 'Salvage',
    slot: raw.slot,
    rarity: raw.rarity,
    weaponId: typeof raw.weaponId === 'string' ? raw.weaponId : undefined,
    base,
    affixes,
    craftedAt: Number.isFinite(raw.craftedAt) ? raw.craftedAt : 0,
    // Boss-unique trophies (see meta/bossUniques.js) carry their own art
    // directly rather than resolving one through a Forge recipe — nothing
    // else currently sets either field, but both must survive a reload.
    art: typeof raw.art === 'string' ? raw.art : undefined,
    isBossUnique: raw.isBossUnique === true,
  };
}
