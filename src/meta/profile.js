/**
 * profile.js — everything that survives between runs.
 *
 * Materials, crafted gear, the equipped loadout, and the milestones that gate
 * recipes all live here, serialised to localStorage.
 *
 * Loading is written defensively on purpose. Saved data is the one input the
 * code cannot make assumptions about: it may have been written by an older
 * build, truncated by a crashed tab, or edited by hand. A corrupt save should
 * cost the player their progress at worst — it must never throw and leave them
 * staring at a blank page with no way back to a working game.
 */

import { MATERIAL_IDS } from './materials.js';
import { CHARACTER_BY_ID, DEFAULT_CHARACTER, isCharacterUnlocked } from './characters.js';
import { SLOTS, RARITIES, sanitizeItem, craftItem, rollAffixes } from './gear.js';
import { RECIPE_BY_ID, costFor, canAfford } from './recipes.js';
import { BOSS_UNIQUES } from './bossUniques.js';
import {
  DRONE_BY_ID, OUTPOST_UPGRADES,
  droneCost, isDroneUnlocked, upgradeCost, pendingYield, rollBonus,
} from './outpost.js';

const STORAGE_KEY = 'fracture.profile';
const VERSION = 2;

function emptyMaterials() {
  const out = {};
  for (const id of MATERIAL_IDS) out[id] = 0;
  return out;
}

function emptyLoadout() {
  const out = {};
  for (const slot in SLOTS) out[slot] = null;
  return out;
}

/**
 * Validate a raw loadout-shaped object against gear that actually exists,
 * the same "only real gear survives" rule migrate() already applies
 * everywhere else. Shared by the live loadout and every saved preset so
 * there is exactly one place that knows what a valid loadout looks like.
 */
function sanitizeLoadout(raw, gear) {
  const out = emptyLoadout();
  if (raw === null || typeof raw !== 'object') return out;
  for (const slot in SLOTS) {
    const uid = raw[slot];
    if (typeof uid === 'string' && gear.some((g) => g.uid === uid && g.slot === slot)) {
      out[slot] = uid;
    }
  }
  return out;
}

/** Exported for the Hub's "is this preset the current loadout" check. */
export function loadoutsEqual(a, b) {
  for (const slot in SLOTS) {
    if (a[slot] !== b[slot]) return false;
  }
  return true;
}

function defaultProfile() {
  return {
    version: VERSION,
    materials: emptyMaterials(),
    scrip: 0,          // the loose currency chests award; spent on reforging gear
    gear: [],
    loadout: emptyLoadout(),
    // Named snapshots of `loadout`, so switching builds between runs is a
    // click instead of re-equipping three slots from memory each time.
    loadoutPresets: [],
    seenMaterials: [],
    // Boss ids (see meta/bossUniques.js) whose one-time trophy weapon has
    // already been earned — a boss keeps dropping its normal guaranteed
    // chest on every kill, but its unique only ever comes home once.
    bossUniques: [],
    milestones: {
      bestWave: 0, bestTime: 0, totalKills: 0, runs: 0,
      // Lifetime counters (accumulate every run, like totalKills/runs
      // already do) added for the later character-unlock tiers — a "have
      // you sustained real play" gate that bestWave/bestTime/totalKills/
      // runs alone can't quite express.
      totalBossKills: 0, totalPlaytime: 0,
    },
    // Which Driftwalker the player last took in. A display choice only — it
    // never gates anything, so an unknown id just falls back to the default.
    character: 'scav',
    // Best tournament score per week key, e.g. { '2026-W35': 1206010 }.
    // Keyed rather than a single number so an old week's result survives the
    // rotation and can still be shown as history.
    tournament: {},
    outpost: {
      drones: { scrap: 0, hauler: 0, rig: 0 },
      upgrades: { speed: 0, cap: 0, luck: 0 },
      // A brand new profile has never been idle, so the clock starts now —
      // not at epoch zero, which would hand a fresh save a free multi-hour
      // backlog the moment the offline cap existed.
      lastCollectedAt: Date.now(),
    },
  };
}

/** Flat Scrip cost to reroll one item's affixes, scaled by its own rarity. */
/**
 * Scrip cost to reroll an item's affixes, per rarity.
 *
 * Must cover every rarity in RARITY_ORDER. When the ladder went from three
 * tiers to seven this table was left at three, and the `?? REFORGE_COST.common`
 * fallback at both call sites turned that into a silent pricing bug rather
 * than an error: rerolling a Mythic — six affix lines — cost the same 15 Scrip
 * as rerolling a Common. Rolls climb steeply because the number of lines being
 * rerolled climbs with them.
 */
/** How many named loadout presets a profile can hold at once. */
export const MAX_LOADOUT_PRESETS = 5;

export const REFORGE_COST = {
  common: 15, uncommon: 25, rare: 40, epic: 70,
  legendary: 120, mythic: 200, exotic: 320,
};

export class Profile {
  constructor(data) {
    Object.assign(this, data ?? defaultProfile());
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  static load() {
    let raw = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch {
      // Private browsing or storage disabled. The game still plays; it just
      // won't remember anything.
      return new Profile();
    }
    if (raw === null) return new Profile();

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.warn('[fracture] save file was not valid JSON; starting fresh');
      return new Profile();
    }

    return new Profile(migrate(parsed));
  }

  /**
   * The profile as a plain, serialisable object.
   *
   * Deliberately the exact shape `save()` writes and `migrate()` reads, so the
   * cloud never stores a second format that could drift from the local one.
   * One shape, three consumers (localStorage, the cloud, the migrator).
   */
  toJSON() {
    return {
      version: VERSION,
      materials: this.materials,
      scrip: this.scrip,
      gear: this.gear,
      loadout: this.loadout,
      loadoutPresets: this.loadoutPresets,
      seenMaterials: this.seenMaterials,
      bossUniques: this.bossUniques,
      milestones: this.milestones,
      character: this.character,
      tournament: this.tournament,
      outpost: this.outpost,
    };
  }

  /**
   * Replace this profile's contents in place from a plain object.
   *
   * In place rather than returning a new Profile, because `main.js` and the
   * Hub both hold a live reference — swapping the object would leave them
   * pointing at the old one. Runs through `migrate()` so cloud data gets the
   * same hostile-input treatment a local save file gets; a corrupted or
   * malicious row must not be trusted more than a corrupted local file.
   */
  applyJSON(data) {
    Object.assign(this, migrate(data ?? {}));
    this.save();
    return this;
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: VERSION,
        materials: this.materials,
        scrip: this.scrip,
        gear: this.gear,
        loadout: this.loadout,
        loadoutPresets: this.loadoutPresets,
        seenMaterials: this.seenMaterials,
        bossUniques: this.bossUniques,
        milestones: this.milestones,
        character: this.character,
        outpost: this.outpost,
      }));
      // Mirror to the cloud if an account is signed in. Debounced inside
      // queuePush, and a no-op when unconfigured or signed out — the local
      // write above is always the authoritative one.
      queueCloudPush(this);
      return true;
    } catch {
      // Quota exceeded, or storage disabled mid-session. Non-fatal.
      return false;
    }
  }

  /** Wipe everything. Used by the hub's reset control. */
  static clear() {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* non-fatal */ }
    return new Profile();
  }

  // -------------------------------------------------------------------------
  // Materials
  // -------------------------------------------------------------------------

  addMaterials(bag) {
    for (const id in bag) {
      if (this.materials[id] === undefined) continue;   // unknown id from an old save
      this.materials[id] += bag[id];
      // "Seen" is permanent: spending your last Alloy must not re-lock the
      // recipes that finding one unlocked.
      if (!this.seenMaterials.includes(id)) this.seenMaterials.push(id);
    }
  }

  spend(cost) {
    if (!canAfford(cost, this.materials)) return false;
    for (const id in cost) this.materials[id] -= cost[id];
    return true;
  }

  addScrip(amount) {
    this.scrip += amount;
  }

  spendScrip(amount) {
    if (this.scrip < amount) return false;
    this.scrip -= amount;
    return true;
  }

  // -------------------------------------------------------------------------
  // Gear
  // -------------------------------------------------------------------------

  /**
   * Record a tournament result, keeping only the better of it and what is
   * already stored. Returns true if this run was an improvement.
   *
   * "Better" rather than "latest" for the same reason the cloud merge takes
   * the better of every field: a worse run later should not erase a good one.
   */
  recordTournament(weekKey, score) {
    if (typeof weekKey !== 'string' || !Number.isFinite(score) || score <= 0) return false;
    if (this.tournament === undefined || this.tournament === null) this.tournament = {};
    const prev = this.tournament[weekKey] ?? 0;
    if (score <= prev) return false;
    this.tournament[weekKey] = Math.floor(score);
    this.save();
    return true;
  }

  craft(recipeId, rarity, rng) {
    const recipe = RECIPE_BY_ID.get(recipeId);
    if (recipe === undefined || RARITIES[rarity] === undefined) return null;

    const cost = costFor(recipe, rarity);
    if (!this.spend(cost)) return null;

    const item = craftItem(recipe, rarity, rng);
    this.gear.push(item);
    this.save();
    return item;
  }

  /**
   * Add a fully-formed item straight to the stash — the path chest rewards use,
   * bypassing the forge's material cost entirely. A found item didn't cost you
   * anything to make; that's the whole point of finding it.
   */
  grantItem(item) {
    this.gear.push(item);
    this.save();
    return item;
  }

  /**
   * Re-roll one item's affixes in place, keeping its rarity, slot, recipe and
   * rolled base stats untouched — only the affix lines change. Costs Scrip
   * rather than materials so the two currencies stay on separate tracks: one
   * for making things, one for fine-tuning what you already made.
   */
  reforge(uid, rng) {
    const item = this.getItem(uid);
    if (item === null) return false;
    const cost = REFORGE_COST[item.rarity] ?? REFORGE_COST.common;
    if (!this.spendScrip(cost)) return false;
    item.affixes = rollAffixes(item.rarity, item.slot, rng);
    this.save();
    return true;
  }

  getItem(uid) {
    return this.gear.find((g) => g.uid === uid) ?? null;
  }

  equip(uid) {
    const item = this.getItem(uid);
    if (item === null) return false;
    this.loadout[item.slot] = uid;
    this.save();
    return true;
  }

  unequip(slot) {
    if (this.loadout[slot] === undefined) return false;
    this.loadout[slot] = null;
    this.save();
    return true;
  }

  /**
   * Destroy an item, refunding a fraction of nothing — it's just gone.
   * Refused for a boss-unique trophy: "already earned" is tracked in
   * `bossUniques`, not by whether the item still exists in the stash, so
   * scrapping one would be the only way to lose it forever with no way to
   * ever get it back.
   */
  scrap(uid) {
    const idx = this.gear.findIndex((g) => g.uid === uid);
    if (idx === -1) return false;
    const item = this.gear[idx];
    if (item.isBossUnique === true) return false;
    if (this.loadout[item.slot] === uid) this.loadout[item.slot] = null;
    this.gear.splice(idx, 1);
    this.save();
    return true;
  }

  /** Save the CURRENT loadout as a new named preset. */
  savePreset(name) {
    if (this.loadoutPresets.length >= MAX_LOADOUT_PRESETS) return false;
    const clean = String(name ?? '').trim().slice(0, 24) || 'Loadout ' + (this.loadoutPresets.length + 1);
    this.loadoutPresets.push({ name: clean, items: { ...this.loadout } });
    this.save();
    return true;
  }

  /** Equip whatever a preset has saved. A slot whose item was since scrapped
   *  just goes empty rather than failing the whole switch. */
  loadPreset(index) {
    const preset = this.loadoutPresets[index];
    if (preset === undefined) return false;
    this.loadout = sanitizeLoadout(preset.items, this.gear);
    this.save();
    return true;
  }

  /** Overwrite a preset's saved items with whatever is currently equipped. */
  updatePreset(index) {
    const preset = this.loadoutPresets[index];
    if (preset === undefined) return false;
    preset.items = { ...this.loadout };
    this.save();
    return true;
  }

  renamePreset(index, name) {
    const preset = this.loadoutPresets[index];
    if (preset === undefined) return false;
    const clean = String(name ?? '').trim().slice(0, 24);
    if (clean === '') return false;
    preset.name = clean;
    this.save();
    return true;
  }

  deletePreset(index) {
    if (this.loadoutPresets[index] === undefined) return false;
    this.loadoutPresets.splice(index, 1);
    this.save();
    return true;
  }

  /** The equipped items, in slot order, skipping empty slots. */
  equippedItems() {
    const out = [];
    for (const slot in SLOTS) {
      const uid = this.loadout[slot];
      if (uid === null || uid === undefined) continue;
      const item = this.getItem(uid);
      if (item !== null) out.push(item);
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Outpost — a passive colony, entirely separate from run-based progression.
  // -------------------------------------------------------------------------

  buyDrone(tierId) {
    if (!isDroneUnlocked(this, tierId) || DRONE_BY_ID.get(tierId) === undefined) return false;
    const cost = droneCost(this, tierId);
    if (!this.spend(cost)) return false;
    this.outpost.drones[tierId] = (this.outpost.drones[tierId] ?? 0) + 1;
    this.save();
    return true;
  }

  buyOutpostUpgrade(key) {
    if (OUTPOST_UPGRADES[key] === undefined) return false;
    const cost = upgradeCost(this, key);
    if (cost === null) return false;   // already at max level
    if (!this.spend(cost)) return false;
    this.outpost.upgrades[key] = (this.outpost.upgrades[key] ?? 0) + 1;
    this.save();
    return true;
  }

  /**
   * Bank whatever the Outpost has produced since it was last collected. The
   * bonus-haul roll happens here, once, as part of committing the collection
   * — not something a player can preview and back out of.
   */
  collectOutpost(now, rng) {
    const { materials, hoursCovered } = pendingYield(this, now);
    const bonusMult = rollBonus(this, rng);

    const banked = {};
    for (const id in materials) {
      banked[id] = bonusMult !== null ? Math.round(materials[id] * bonusMult) : materials[id];
    }

    this.addMaterials(banked);
    this.outpost.lastCollectedAt = now;
    this.save();

    return { materials: banked, bonusMult, hoursCovered };
  }

  // -------------------------------------------------------------------------
  // Run results
  // -------------------------------------------------------------------------

  /**
   * Bank a finished run: materials earned, currency and gear from any chests
   * opened, and any milestone it beat.
   */
  /**
   * Choose which Driftwalker to take in next.
   *
   * Re-checks the unlock here rather than trusting the caller: the Hub
   * already refuses to select a locked character, but this is the method a
   * console or a future screen would reach for, and a selection that skipped
   * the gate would persist straight into the save.
   */
  selectCharacter(id) {
    const c = CHARACTER_BY_ID.get(id);
    if (c === undefined) return false;
    if (!isCharacterUnlocked(c, this)) return false;
    this.character = id;
    this.save();
    return true;
  }

  recordRun({ materials, currency, gear, wave, time, kills, bossUniques, bossKills }) {
    this.addMaterials(materials ?? {});
    if (currency) this.addScrip(currency);
    for (const item of gear ?? []) this.gear.push(item);
    // Boss uniques staged this run (state.bossUniquesEarnedThisRun) only
    // become permanent here, same as every other reward a run collects —
    // dying, Leaving or Restarting before this point never loses one, since
    // all three already funnel through this same call.
    for (const id of bossUniques ?? []) {
      if (!this.bossUniques.includes(id)) this.bossUniques.push(id);
    }
    const m = this.milestones;
    m.runs += 1;
    m.totalKills += kills ?? 0;
    m.totalBossKills += bossKills ?? 0;
    m.totalPlaytime += time ?? 0;
    if ((wave ?? 0) > m.bestWave) m.bestWave = wave;
    if ((time ?? 0) > m.bestTime) m.bestTime = time;
    this.save();
  }
}

// ---------------------------------------------------------------------------
// Migration / validation
// ---------------------------------------------------------------------------

/**
 * Coerce whatever came out of storage into a profile the rest of the code can
 * trust. Every field is re-derived rather than spread from the parsed object,
 * so an unexpected shape produces a default instead of propagating.
 */
function migrate(raw) {
  const out = defaultProfile();
  if (raw === null || typeof raw !== 'object') return out;

  // Materials: only known ids, only finite non-negative integers.
  if (raw.materials !== null && typeof raw.materials === 'object') {
    for (const id of MATERIAL_IDS) {
      const v = raw.materials[id];
      out.materials[id] = Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
    }
  }

  out.scrip = Number.isFinite(raw.scrip) && raw.scrip > 0 ? Math.floor(raw.scrip) : 0;

  if (Array.isArray(raw.gear)) {
    for (const g of raw.gear) {
      // A recipe-crafted item's saved `slot` can go stale if that recipe
      // moved to a different slot since the item was saved (the original
      // armor/trinket split into necklace/gloves/suit/belt/boots) — the
      // recipe itself is the authority on which slot an item belongs in
      // now, so a stale slot gets corrected here rather than the item
      // (and whatever was equipped in it) silently vanishing on load.
      // Boss-unique trophies have no real recipe (a synthetic id never in
      // RECIPE_BY_ID), so they always keep their own saved slot.
      if (g !== null && typeof g === 'object' && typeof g.recipe === 'string') {
        const recipe = RECIPE_BY_ID.get(g.recipe);
        if (recipe !== undefined) g.slot = recipe.slot;
      }
      const item = sanitizeItem(g);
      if (item !== null) out.gear.push(item);
    }
  }

  if (Array.isArray(raw.seenMaterials)) {
    out.seenMaterials = raw.seenMaterials.filter((id) => MATERIAL_IDS.includes(id));
  }
  // Anything currently held has obviously been seen, even if an older save
  // never tracked that separately.
  for (const id of MATERIAL_IDS) {
    if (out.materials[id] > 0 && !out.seenMaterials.includes(id)) {
      out.seenMaterials.push(id);
    }
  }

  // Boss uniques earned: only known boss ids. Validated before the loadout
  // below purely by convention (content, then what references it) — it has
  // no actual dependency on `out.gear`.
  if (Array.isArray(raw.bossUniques)) {
    out.bossUniques = raw.bossUniques.filter((id) =>
      typeof id === 'string' && BOSS_UNIQUES[id] !== undefined);
  }

  // Loadout: only pointing at gear that survived.
  out.loadout = sanitizeLoadout(raw.loadout, out.gear);

  // Saved presets: same "only real gear survives" rule as the live loadout
  // above, applied per preset. A slot pointing at scrapped gear just goes
  // empty rather than dropping the whole preset — losing one item shouldn't
  // erase the other two.
  if (Array.isArray(raw.loadoutPresets)) {
    for (const p of raw.loadoutPresets.slice(0, MAX_LOADOUT_PRESETS)) {
      if (p === null || typeof p !== 'object') continue;
      const items = sanitizeLoadout(p.items, out.gear);
      const name = typeof p.name === 'string' && p.name.trim() !== ''
        ? p.name.trim().slice(0, 24) : 'Loadout';
      out.loadoutPresets.push({ name, items });
    }
  }

  if (raw.milestones !== null && typeof raw.milestones === 'object') {
    for (const key in out.milestones) {
      const v = raw.milestones[key];
      if (Number.isFinite(v) && v > 0) out.milestones[key] = v;
    }
  }

  // Selected character. Validated against the live roster rather than trusted,
  // same as every other field here — a save naming a character that no longer
  // exists (an older build, a hand-edited file) falls back to the default
  // instead of leaving the Hub pointing at nothing.
  if (typeof raw.character === 'string' && CHARACTER_BY_ID.has(raw.character)) {
    out.character = raw.character;
  }

  // One-time re-lock migration, gated on VERSION rather than the "always
  // re-validate everything, every load" pattern the rest of this function
  // uses — the unlock thresholds were reworked (spread out, some made
  // stricter) after some players had already unlocked characters under the
  // old ones. A save from before that rework (version < 2, or no version at
  // all) gets its selected character re-checked against isCharacterUnlocked
  // using milestones as they stand *right now*; if it no longer qualifies,
  // fall back to the default the same way applyCharacter() already does at
  // run start. Nothing else changes — the character just has to be earned
  // again, same as anyone who never had it. Because save()/toJSON() always
  // write the *current* VERSION, the very next save clears this check for
  // that profile permanently: it runs at most once per save.
  if (!(Number.isFinite(raw.version) && raw.version >= 2)) {
    const chosen = CHARACTER_BY_ID.get(out.character);
    if (chosen === undefined || !isCharacterUnlocked(chosen, out)) {
      out.character = DEFAULT_CHARACTER;
    }
  }

  // Tournament scores: week key -> score. Only well-formed keys and positive
  // finite scores survive, same as every other field here.
  if (raw.tournament !== null && typeof raw.tournament === 'object') {
    for (const key in raw.tournament) {
      if (!/^\d{4}-W\d{2}$/.test(key)) continue;
      const v = raw.tournament[key];
      if (Number.isFinite(v) && v > 0) out.tournament[key] = Math.floor(v);
    }
  }

  if (raw.outpost !== null && typeof raw.outpost === 'object') {
    const ro = raw.outpost;

    if (ro.drones !== null && typeof ro.drones === 'object') {
      for (const id of DRONE_BY_ID.keys()) {
        const v = ro.drones[id];
        out.outpost.drones[id] = Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
      }
    }

    if (ro.upgrades !== null && typeof ro.upgrades === 'object') {
      for (const key in OUTPOST_UPGRADES) {
        const v = ro.upgrades[key];
        const level = Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
        out.outpost.upgrades[key] = Math.min(level, OUTPOST_UPGRADES[key].maxLevel);
      }
    }

    // A missing or corrupt timestamp defaults to now, same as a fresh
    // profile — never to epoch zero, which would hand a bad save file a free
    // multi-hour production backlog the instant it's loaded.
    out.outpost.lastCollectedAt = Number.isFinite(ro.lastCollectedAt) && ro.lastCollectedAt > 0
      ? ro.lastCollectedAt
      : Date.now();
  }

  return out;
}


/**
 * Cloud mirror hook.
 *
 * Resolved lazily on first use rather than imported at the top of the file:
 * `cloud.js` imports `Profile`, so a static import here would be a cycle. The
 * cached promise means the dynamic import happens at most once.
 */
let cloudModule = null;
function queueCloudPush(profile) {
  if (cloudModule === null) {
    cloudModule = import('./cloud.js').catch(() => ({ queuePush: () => {} }));
  }
  cloudModule.then((m) => { try { m.queuePush(profile); } catch { /* never break a local save */ } });
}
