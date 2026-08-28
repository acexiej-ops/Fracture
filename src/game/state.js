/**
 * state.js — the single source of truth for a run.
 *
 * Everything mutable about the game lives here. Systems (waves, combat,
 * weapons, fx) are stateless functions that read and write this object, and the
 * renderer only ever reads it. Restarting a run is just `new GameState()`.
 */

import { PLAYER, ARENA, WAVES, XP, NODES, CHESTS } from './config.js';
import { Stats } from './stats.js';
import { SpatialGrid } from '../core/spatialGrid.js';

/** Run phases. The loop consults this to decide what to simulate. */
export const Phase = {
  PLAYING: 'playing',
  LEVEL_UP: 'levelUp',   // simulation frozen, upgrade cards showing
  DEAD: 'dead',
  PAUSED: 'paused',
};

export class GameState {
  constructor(seed) {
    this.seed = seed;
    this.phase = Phase.PLAYING;

    this.time = 0;            // seconds survived — keeps running always (HUD clock, best time)
    // Wave number is derived from THIS clock, not `time` — see waves.js,
    // which stops advancing it for as long as a boss is alive, so the next
    // wave (and the next boss) can never start until this one is beaten.
    this.waveClock = 0;
    this.wave = 1;
    this.waveTimer = 0;
    this.kills = 0;
    this.damageDealt = 0;

    // Set by waves.js for the duration of a boss fight: a smaller box, centred
    // on the player, that temporarily replaces the full arena — see
    // arenaBounds() below. Null the rest of the time.
    this.arenaBounds = null;

    // ---- Player ----
    this.stats = new Stats(PLAYER.baseStats);
    this.player = {
      x: ARENA.width / 2,
      y: ARENA.height / 2,
      vx: 0,
      vy: 0,
      radius: PLAYER.radius,
      hp: this.stats.get('maxHp'),
      facing: 0,            // radians, aims at current target
      // radians, the direction you are STEERING. Deliberately separate from
      // `facing`: dashes follow this, weapons follow `facing`.
      moveAngle: 0,
      invuln: 0,
      hitFlash: 0,
      alive: true,
      moving: false,
      envSlowMult: 1,   // set each tick by biome hazards (e.g. Frostreach ice)
      // crowdSlowMult eases toward how hemmed-in the player currently is —
      // set once per tick by enemies.js's body-collision pass, consumed by
      // updatePlayer the tick after (see COMBAT.crowdSlow* in config.js).
      crowdSlowMult: 1,
      // Granted by weapon modifiers (weaponMods.js): Warding tops up `shield`,
      // which absorbs damage before health does; Surging refreshes
      // `surgeTime`, a brief move-speed boost for landing hits.
      shield: 0,
      shieldMax: 0,
      surgeTime: 0,

      // --- Abilities (game/abilities.js) ---
      // A parry is a *refusal*, not mitigation: while parryTime is up,
      // damagePlayer returns false outright and flags parrySuccess, which the
      // ability system reads next tick to fire the counter. Splitting it that
      // way means the parry never needs to know what hit it — contact damage,
      // a bolt, a mortar and a boss slam all route through the same check.
      parryTime: 0,
      parryCounter: null,
      parrySuccess: false,
      parryFlash: 0,
      // Ongoing ultimate timers, ticked in updateAbilities.
      barrageTime: 0, phaseStormTime: 0, immovableTime: 0,
      unmakingTime: 0, frenzyTime: 0,
    };

    // ---- Progression ----
    this.level = 1;
    this.xp = 0;
    this.xpToNext = XP.toNextLevel(1);
    this.pendingLevelUps = 0;
    this.upgradeChoices = [];
    this.takenUpgrades = new Map();  // upgrade id -> times taken

    /**
     * The run's arsenal. Owns which weapons and passives are held and at what
     * level; `arsenalProgression.syncInventory` keeps `this.weapons` and
     * `this.stats` in step with it. Assigned by main.js at run start (it
     * needs the character's starting weapon, which state.js has no business
     * knowing about).
     */
    this.inventory = null;

    /**
     * Active abilities: three on cooldown plus one charge-fed ultimate.
     * Built by main.js at run start from the chosen character.
     */
    this.abilities = null;
    /** Temporary stat buffs granted by abilities, expiring on their own. */
    this.abilityBuffs = [];
    /** Transient "ULTIMATE" callout, read once by the renderer then cleared. */
    this.ultimateBanner = null;
    /** Pointer state, handed over by main.js each frame so canvas-drawn UI
     *  (the ability bar) can hit-test hover without importing the input layer. */
    this.hoverInput = null;
    /** Remote players for multiplayer, populated by net client each frame. */
    this.remotePlayers = [];
    this.multiplayer = false;

    // ---- Weapons ----
    // Populated by main.js on run start (the starter weapon) and by upgrade
    // nodes that grant new ones. Each entry carries its own Stats stack.
    this.weapons = [];

    /**
     * Synergy flags.
     *
     * Some upgrades don't fit the stat-modifier model because they change what
     * the game *does*, not what a number is: corpses detonating, burning deaths
     * leaving fire. Those set a flag here, and the system that cares reads it.
     * Keeping them in one bag makes it obvious what non-stat behaviour a run
     * has switched on.
     */
    this.flags = {
      explodeDamage: 0,     // Volatile Remains: flat blast damage on death
      explodeHpScale: 0,    // ...plus this fraction of the victim's max HP
      explodeRadius: 60,
      wildfire: 0,          // burning deaths leave a fire pool of this DPS
      arcDamage: 0,         // crits arc to a nearby enemy for this much
      arcRange: 170,

      // --- Set by crafted gear affixes (Phase 3) ---
      onHitSlowChance: 0,   // chance per hit to slow the target
      onHitSlowMult: 0,     // speed multiplier applied when it procs (0 = none)
      onHitSlowTime: 0,
      onHitBurnChance: 0,
      onHitBurnDps: 0,
      onHitBurnTime: 0,
      thorns: 0,            // damage dealt back to anything that touches you
      salvageBonus: 0,      // multiplies material drop chance
      xpBonus: 0,           // multiplies experience gained
      killHealChance: 0,
      killHealAmount: 0,
    };

    /** uids of the gear this run was started with, for the summary screen. */
    this.equippedGear = [];

    /** Which Driftwalker is on this run — set by applyCharacter, read by the
     *  renderer to pick the right sprite and by the summary screen. */
    this.character = 'scav';
    this.characterName = 'The Scavenger';

    /** Materials gathered this run, banked to the profile on death. */
    this.runMaterials = {};

    /** Resonant nodes currently standing in the arena. */
    this.nodes = [];
    this.nodeTimer = NODES.firstSpawn;
    this.nodesHarvested = 0;

    /** Chests currently standing in the arena, and what this run has banked. */
    this.chests = [];
    this.chestFindTimer = CHESTS.findFirstSpawn;
    this.chestsOpened = 0;
    this.runCurrency = 0;       // Scrip earned this run, banked to the profile on death
    this.runGear = [];          // items granted by chests this run, banked on death

    // Boss-unique trophies (see meta/bossUniques.js): `bossUniquesOwned` is a
    // snapshot of the profile's already-earned ids, taken at run start, so
    // enemies.js can check eligibility without needing a profile reference;
    // `bossUniquesEarnedThisRun` stages new ones the same way `runGear` stages
    // chest loot, only made permanent when the run actually banks.
    this.bossUniquesOwned = [];
    this.bossUniquesEarnedThisRun = [];

    /**
     * A transient reveal queued by the last chest opened — read once by the
     * HUD/renderer to show the floating "+N Alloy, Rare Chest: X" callout,
     * then cleared. Kept singular rather than a list: overlapping reveals from
     * two chests opened a frame apart would just be noise, so the newer one
     * simply replaces whatever hadn't been read yet.
     */
    this.chestReveal = null;

    /** Bosses defeated this run — drives the escalating boss roster. */
    this.bossesDefeated = 0;

    /**
     * Set by `killEnemy` the instant a boss dies, read and cleared by
     * `main.js` on the very next tick to trigger the defeat banner. The same
     * "system sets a message, the orchestrator shows it" shape `newWave`
     * already uses for the wave banner.
     */
    this.bossJustDefeated = null;

    /** Hit-stop: a brief freeze on a big kill, sold as impact rather than lag. */
    this.hitStopTimer = 0;

    /** A brief bright screen pulse on a critical hit. */
    this.critFlashTimer = 0;

    /** Kill combo: consecutive kills within a short window of each other. */
    this.comboCount = 0;
    this.comboTimer = 0;
    this.comboBest = 0;

    /** Which biome this run is playing in — picked once at construction. */
    this.biome = 'wastes';
    this.biomeHazards = [];      // active environmental hazard telegraphs/zones
    this.biomeSpawnTimer = 0;

    /**
     * Enrage: seconds since the player's last kill, and the 0..1 factor that
     * ramps up once that exceeds ENRAGE.graceTime. `enrageSpeedMult` and
     * `enrageDamageMult` are derived from the factor once per tick in
     * `updateEnrage` and read everywhere enemy speed/damage is computed.
     */
    this.timeSinceLastKill = 0;
    this.enrageFactor = 0;
    this.enrageSpeedMult = 1;
    this.enrageDamageMult = 1;

    // ---- Entities (plain arrays + swap-remove; no allocation churn) ----
    this.enemies = [];
    this.projectiles = [];
    this.enemyProjectiles = [];   // bolts fired at the player by ranged enemies
    this.beams = [];         // Lance strikes: resolved on frame 1, then drawn
    this.shockwaves = [];    // Quake rings, expanding
    this.zones = [];         // lingering ground effects (ember, fissure, fire)
    this.blasts = [];        // purely visual detonation rings
    this.arcs = [];          // purely visual crit-arc lightning
    this.walls = [];         // Waller elites' temporary barriers (warn -> solid -> gone)
    this.mortarShells = [];  // Mortar elites' in-flight shells (telegraph -> impact)
    this.deployables = [];   // turrets, companions and mines — one array, kind-tagged
    this.sweeps = [];        // melee/aura sweep visuals (damage resolves at creation)
    this.orbs = [];
    this.particles = [];
    this.damageNumbers = [];

    /**
     * Deferred damage queue. Hits found while walking the spatial grid are
     * queued here and applied after traversal, so an on-death effect that
     * damages other enemies can't mutate the crowd mid-iteration.
     */
    this.pendingHits = [];

    // ---- Spatial acceleration ----
    this.enemyGrid = new SpatialGrid(72);

    // ---- Camera / presentation ----
    this.camera = { x: ARENA.width / 2, y: ARENA.height / 2, shake: 0 };
    this.spawnAccumulator = 0;

    this.target = null;      // current auto-attack target (an enemy or null)
  }

  get maxHp() { return this.stats.get('maxHp'); }
  get hpFraction() { return Math.max(0, this.player.hp / this.maxHp); }
  get xpFraction() { return Math.min(1, this.xp / this.xpToNext); }

  /** Wave number derived from the wave clock, so it can never desync. */
  updateWave() {
    const w = Math.floor(this.waveClock / WAVES.duration) + 1;
    if (w !== this.wave) {
      this.wave = w;
      this.waveTimer = 0;
      return true;   // signals "new wave started" so the UI can announce it
    }
    this.waveTimer = this.waveClock % WAVES.duration;
    return false;
  }

  addShake(amount) {
    this.camera.shake = Math.min(28, this.camera.shake + amount);
  }
}

/**
 * The play area's current bounds — the full arena, unless a boss fight has
 * shrunk it (state.arenaBounds), in which case that box replaces it. Every
 * site that walls the player in, clamps the camera, or draws the arena's
 * background/border should read bounds through this rather than the ARENA
 * constant directly, so a boss fight actually looks and feels smaller instead
 * of only the encounter logic changing.
 */
export function arenaBounds(state) {
  if (state.arenaBounds !== null) return state.arenaBounds;
  return { minX: 0, minY: 0, maxX: ARENA.width, maxY: ARENA.height };
}

/**
 * Zones are the one entity type that can spawn *itself*: Wildfire pools are
 * created by deaths that the pools themselves cause. That feedback loop scales
 * with crowd density, and crowd density *is* the difficulty curve, so left
 * unchecked a fire build outruns the game entirely. The cap is the brake.
 * Dropping the oldest keeps the effect intact — the newest fire is the one
 * under the fight.
 */
const MAX_ZONES = 28;

export function addZone(state, zone) {
  if (state.zones.length >= MAX_ZONES) state.zones.shift();
  state.zones.push(zone);
}

/**
 * Detonation rings are purely decorative, and a chain reaction can start well
 * over a hundred in a single frame. Past a couple of dozen overlapping rings
 * the screen reads exactly the same, but each one is a scaled `drawImage` under
 * additive blending — measured at 178 concurrent, they pushed the render p95 to
 * 13.3ms against a 16.67ms budget. Dropping the excess is visually free.
 */
const MAX_BLASTS = 36;

export function addBlast(state, blast) {
  if (state.blasts.length >= MAX_BLASTS) return;
  state.blasts.push(blast);
}

/** Swap-remove: O(1) removal, order is irrelevant for all our entity lists. */
export function removeAt(arr, i) {
  const last = arr.length - 1;
  if (i !== last) arr[i] = arr[last];
  arr.pop();
}
