/**
 * config.js — every balance knob in one place.
 *
 * Rule of thumb: no gameplay number should be hardcoded anywhere else.
 * Tuning the feel of the game should mean editing this file only.
 */

export const ARENA = {
  width: 2600,
  height: 1900,
  gridSize: 80,
};

export const PLAYER = {
  radius: 14,
  /**
   * The player's global stat block.
   *
   * Phase 2 changed what these mean. With one weapon, `damage` could just be
   * "your damage". With seven, the player's stats are *multipliers* layered on
   * top of each weapon's own numbers — so +20% damage improves your whole
   * arsenal, and a weapon stays balanced relative to its peers no matter what
   * the player has stacked. Each weapon declares its own base damage, cooldown,
   * area and so on in weaponDefs.js.
   *
   * Multipliers start at 1 and flat adds at 0, so a fresh run applies no
   * distortion at all.
   */
  baseStats: {
    // --- Survival ---
    maxHp: 100,
    moveSpeed: 215,
    regen: 0,
    pickupRadius: 140,

    // --- Global multipliers (scale every weapon) ---
    damage: 1,            // "might"
    attackSpeed: 1,       // "haste" — divides each weapon's cooldown
    area: 1,              // blast radii, beam width, orbit distance
    projectileSpeed: 1,
    duration: 1,          // how long zones and effects linger
    knockback: 1,

    // --- Global flat adds (applied on top of each weapon's own value) ---
    projectileCount: 0,
    pierce: 0,

    // --- Crit is rolled globally, per hit ---
    critChance: 0.05,
    critMult: 2.0,
  },
  invulnTime: 0.65,        // i-frames after taking a hit
  hitKnockback: 150,
  // Six, matching the arsenal progression model (six weapons + six passives).
  // Was four when a 45-node upgrade tree owned level-ups and weapons were only
  // one of several things a card could grant; now that every level-up is a
  // weapon or a passive, four slots filled up long before the run did.
  maxWeapons: 6,
  // Heavier than the light/medium trash (grunt 1, darter 0.7, skitter 0.55,
  // swarmling 0.4, lurker 1.1, charger 1.4), lighter than anything built to
  // soak hits (brute 3, juggernaut 6, bosses 4-12). Small stuff barely budges
  // the player on contact; a wall of heavy enemies genuinely resists.
  mass: 2.4,
};

/** Status effects enemies can carry. Durations are in seconds. */
export const STATUS = {
  burn: { color: '#ff8a3d', tickRate: 0.25 },
  mark: { color: '#ff5ec4', damageTaken: 1.35 },
  slow: { color: '#7ce7ff' },
};

export const XP = {
  orbRadius: 5,
  magnetSpeed: 620,        // speed orbs fly at once vacuumed
  magnetAccel: 2400,
  scatter: 18,            // how far orbs scatter from the kill site
  // XP needed to go from level n -> n+1
  toNextLevel: (level) => Math.floor(5 + (level - 1) * 4 + Math.pow(level - 1, 1.5)),
};

/**
 * Enemy archetypes — the Warped: creatures, machinery and lost operators
 * twisted by prolonged Ichor exposure into hostile forms. `name` is display
 * only (the id is what every system keys off), and the naming ladder tracks
 * how far gone each one is: a Drifter still walks like the operator it used
 * to be, a Husk is barely holding a shape at all.
 *
 * `xp` is the orb value dropped on death.
 * `weight` drives spawn frequency once the type has unlocked.
 * `corruption` (0-1) drives how visibly Ichor-eaten the sprite renders — see
 * the pixel-art layer. It tracks danger, not rarity, so a player learns to
 * read "more corrupted" as "hits harder" without being told.
 */
export const ENEMY_TYPES = {
  grunt: {
    id: 'grunt', name: 'Warped Drifter',
    hp: 14, speed: 82, damage: 8, radius: 13, xp: 1,
    color: '#ff4d6d', shape: 'triangle',
    unlockWave: 1, weight: 100,
    mass: 1, corruption: 0.15,
  },
  darter: {
    id: 'darter', name: 'Warped Skimmer',
    hp: 9, speed: 145, damage: 5, radius: 10, xp: 1,
    color: '#ffb703', shape: 'diamond',
    unlockWave: 1, weight: 60,
    mass: 0.7, corruption: 0.2,
  },
  cinderling: {
    id: 'cinderling', name: 'Cinderling',
    hp: 20, speed: 96, damage: 10, radius: 12, xp: 2,
    color: '#ff8a3d', shape: 'cinderling',
    unlockWave: 2, weight: 45,
    mass: 0.9, corruption: 0.3,
  },
  rimewalker: {
    id: 'rimewalker', name: 'Rimewalker',
    hp: 46, speed: 62, damage: 14, radius: 17, xp: 4,
    color: '#7ce7ff', shape: 'rime',
    unlockWave: 3, weight: 30,
    mass: 2.0, corruption: 0.35,
  },
  sporecarrier: {
    id: 'sporecarrier', name: 'Sporecarrier',
    hp: 34, speed: 70, damage: 11, radius: 16, xp: 3,
    color: '#b8ff5e', shape: 'spore',
    unlockWave: 2, weight: 35,
    mass: 1.6, corruption: 0.4,
  },
  conduit: {
    id: 'conduit', name: 'Conduit',
    hp: 26, speed: 110, damage: 12, radius: 13, xp: 3,
    color: '#ffe066', shape: 'conduit',
    unlockWave: 4, weight: 28,
    mass: 1.1, corruption: 0.3,
  },
  brute: {
    id: 'brute', name: 'Warped Hulk',
    hp: 80, speed: 55, damage: 20, radius: 23, xp: 6,
    color: '#b45cff', shape: 'square',
    unlockWave: 3, weight: 22,
    mass: 3, corruption: 0.45,
  },
  // Charger telegraphs, then lunges. Still contact-damage only, but it forces
  // you to actually watch the arena instead of holding one direction forever.
  charger: {
    id: 'charger', name: 'Warped Lunger',
    hp: 30, speed: 66, damage: 13, radius: 15, xp: 3,
    color: '#4ddbff', shape: 'pentagon',
    unlockWave: 4, weight: 30,
    mass: 1.4, corruption: 0.35,
    dash: { interval: 2.6, windup: 0.45, speed: 470, duration: 0.42, range: 340 },
  },

  // Lurker holds range and shoots. The first enemy that punishes standing
  // still — everything before this just walks at you, so "am I in the open"
  // was never a question worth asking. Low contact damage on purpose: its
  // threat is the bolt, not the touch.
  lurker: {
    id: 'lurker', name: 'Warped Caster',
    hp: 17, speed: 96, damage: 4, radius: 13, xp: 2,
    color: '#4dffb0', shape: 'hexagon',
    unlockWave: 3, weight: 20,
    mass: 1.1, corruption: 0.4,
    ranged: {
      minRange: 320, maxRange: 460,   // holds inside this band, kites outside it
      cooldown: 2.3, windup: 0.32,
      projectileSpeed: 300, projectileDamage: 6, projectileRadius: 6, projectileLife: 2.2,
    },
  },

  // Skitter is fast and never runs in a straight line. Non-homing shots have
  // to lead a target; skitter is built to make that lead wrong.
  skitter: {
    id: 'skitter', name: 'Warped Scuttler',
    hp: 7, speed: 178, damage: 6, radius: 9, xp: 1,
    color: '#f4ff5e', shape: 'star',
    unlockWave: 2, weight: 44,
    mass: 0.55, corruption: 0.3,
    erratic: { jukeMin: 0.18, jukeMax: 0.4, jukeAngle: 1.15, burst: 1.35 },
  },

  // Juggernaut is the answer to "what soaks a hit and keeps coming." Flat
  // damage reduction means a single big crit is worth less against it than
  // the same total spread across several — it rewards sustained fire over
  // burst, the opposite of what most builds are already good at.
  juggernaut: {
    id: 'juggernaut', name: 'Warped Bulwark',
    hp: 230, speed: 34, damage: 19, radius: 28, xp: 8,
    color: '#7a5cff', shape: 'octagon',
    unlockWave: 6, weight: 9,
    mass: 6, corruption: 0.7,
    armor: 0.35,   // flat fraction of incoming damage shrugged off
  },

  // Swarmling never spawns alone — the type carries `swarmSize`, and the
  // spawn director reads that to place a whole cluster from one weighted
  // roll. Individually worthless; the threat is standing still while eight
  // of them close in from every side at once.
  swarmling: {
    id: 'swarmling', name: 'Warped Mote',
    hp: 4, speed: 112, damage: 3, radius: 7, xp: 1,
    color: '#ff9ecf', shape: 'circle',
    unlockWave: 4, weight: 16,
    mass: 0.4, corruption: 0.25,
    swarmSize: 6, swarmScatter: 46,
  },

  // Husk barely damages you on contact — it detonates instead. The windup
  // roots it and flashes a warning ring wide enough to actually be dodgeable,
  // which is the whole point: it punishes staying at melee range on reflex,
  // not staying there at all.
  husk: {
    id: 'husk', name: 'Warped Husk',
    hp: 24, speed: 72, damage: 2, radius: 15, xp: 3,
    color: '#ff3b3b', shape: 'core',
    unlockWave: 5, weight: 16,
    mass: 1.6, corruption: 0.85,
    detonate: { triggerRange: 100, windup: 0.6, blastRadius: 122, damage: 22, cooldownAfterFizzle: 1.2 },
  },

  // ---------------------------------------------------------------------
  // Anomalies — Warped entities that have fully lost their original shape.
  // They get single proper nouns rather than "Warped <something>" names for
  // exactly that reason: there is no longer a something to name them after.
  //
  // No `unlockWave`/`weight`, so `availableTypes()`'s weighted pool never
  // rolls one by accident — `undefined <= wave` is always false. They only
  // ever appear via `spawnBoss`, called directly from the wave director on a
  // milestone wave. Everything else about them — how hard they hit, how much
  // HP they carry — comes from the exact same `spawnEnemy` scaling every
  // regular enemy gets, so The Maw at wave 25 is already tougher than one at
  // wave 5 with no separate "boss tier" multiplier needed.
  // ---------------------------------------------------------------------

  // The Maw: a melee wall that used to have no answer to being kited — now
  // it does. Chases normally, alternates a telegraphed ground slam with a
  // telegraphed charge up close, and lobs a predictive mortar shell when the
  // player opens up more distance than even the charge covers. Three
  // distinct tells, none of them safe to just walk away from.
  behemoth: {
    id: 'behemoth',
    name: 'The Maw',
    hp: 900, speed: 46, damage: 10, radius: 40, xp: 40,
    color: '#ff3b6b', shape: 'behemoth',
    mass: 12, boss: true, bossPhaseCount: 2, corruption: 1,
    slam: { interval: 1.9, windup: 0.55, radius: 215, damage: 58 },
    bossCharge: { interval: 3.2, windup: 0.42, speed: 700, duration: 0.75, range: 640 },
    // Only fires beyond the charge's own range — the two attacks split the
    // distance between them rather than overlapping, so there's no gap where
    // running away is simply free.
    mortar: {
      cooldown: 3.4, leadTime: 0.8, travelTime: 1.0, blastRadius: 130, damage: 42,
      color: '#ff3b6b', minRange: 640,
    },
  },

  // The Choir: a ranged caster that also calls in help. Holds range like a
  // Warped Caster at Anomaly scale, fires wide volleys, periodically summons
  // a small pack, and — once bloodied — stops holding still for it: closing
  // to melee now makes it blink to a fresh angle instead of just backing up,
  // so cornering it stops working exactly when the fight gets dangerous.
  warden: {
    id: 'warden',
    name: 'The Choir',
    hp: 620, speed: 62, damage: 6, radius: 32, xp: 40,
    color: '#4dffb0', shape: 'warden',
    mass: 4, boss: true, bossPhaseCount: 2, corruption: 1,
    ranged: {
      minRange: 360, maxRange: 560, cooldown: 1.5, windup: 0.32,
      projectileSpeed: 420, projectileDamage: 16, projectileRadius: 7, projectileLife: 2.6,
    },
    volley: { interval: 2.7, count: 10, spread: 1.1 },
    summon: { interval: 5, count: 5 },
    // Phase-2-only: see the `t.teleport && e.bossPhase === 2` check in the
    // Warden branch of updateBossAI. Deliberately not active in phase 1 —
    // the opening read of the fight should still be "hold range and volley."
    teleport: { triggerRange: 220, cooldown: 2.2, minDistance: 420, maxDistance: 600 },
  },

  // The Brood: used to be pure melee-range aura plus adds, which meant a
  // player who never let it get close took zero direct damage from it. It
  // now backs that up with a slow, spreading volley of its own — spore
  // bursts that punish standing still just as much as standing close.
  swarmQueen: {
    id: 'swarmQueen',
    name: 'The Brood',
    hp: 700, speed: 58, damage: 0, radius: 34, xp: 40,
    color: '#ff5ec4', shape: 'swarmQueen',
    mass: 5, boss: true, bossPhaseCount: 2, corruption: 1,
    aura: { radius: 155, damage: 15, tickInterval: 0.5 },
    summonSwarm: { interval: 3.8, count: 9, scatter: 60 },
    ranged: {
      minRange: 0, maxRange: 900, cooldown: 1, windup: 0,
      projectileSpeed: 210, projectileDamage: 12, projectileRadius: 10, projectileLife: 3.4,
    },
    volley: { interval: 3.2, count: 14, spread: Math.PI * 2 },
  },

  // The Harbinger: the roster's dedicated ranged threat, and the one that
  // never lets melee pressure work at all. Barely walks — instead it blinks
  // to a fresh angle on its own clock, holding distance through repositioning
  // rather than speed, while alternating a direct bolt volley with a lobbed
  // mortar shell aimed at where the player is heading. Reads and punishes
  // completely differently from the other three: nothing about this fight is
  // "get close and hit it."
  harbinger: {
    id: 'harbinger',
    name: 'The Harbinger',
    hp: 480, speed: 24, damage: 4, radius: 30, xp: 44,
    color: '#b45cff', shape: 'warden',
    mass: 3, boss: true, bossPhaseCount: 2, corruption: 1,
    teleportPrimary: true,
    teleport: { interval: 3.0, warmup: 0.4, minDistance: 380, maxDistance: 620 },
    ranged: {
      minRange: 300, maxRange: 700, cooldown: 1.9, windup: 0.3,
      projectileSpeed: 520, projectileDamage: 14, projectileRadius: 6, projectileLife: 2.2,
    },
    volley: { interval: 3.6, count: 7, spread: 0.8 },
    mortar: {
      cooldown: 4.2, leadTime: 0.9, travelTime: 1.15, blastRadius: 145, damage: 46,
      color: '#b45cff', minRange: 0,
    },
  },
};

/** Round-robin Anomaly roster. Which kind manifests at a milestone wave. */
export const BOSS_ROSTER = ['behemoth', 'warden', 'swarmQueen', 'harbinger'];

/** Anomalies manifest every N waves, forever. */
export const BOSS_WAVE_INTERVAL = 5;

export function bossKindForWave(wave) {
  const cycleIndex = Math.floor(wave / BOSS_WAVE_INTERVAL) - 1;
  return BOSS_ROSTER[((cycleIndex % BOSS_ROSTER.length) + BOSS_ROSTER.length) % BOSS_ROSTER.length];
}

/**
 * Difficulty selection, picked once at the Hub before a run starts (see
 * hub.js's difficulty picker and main.js's startRun). Applied the same way
 * a tournament's mutators are — as a multiplier layered on top of every
 * enemy's normal per-wave scaling in enemies.js's spawnEnemy — so nothing
 * about wave pacing, boss cycling or loot needs to know difficulty exists.
 *
 * `oneHit` is its own axis, not a stat multiplier: any hit that gets past a
 * shield or a parry kills outright, checked directly in player.js's
 * damagePlayer. Enemies stay at Normal's numbers in that mode — the danger
 * is entirely "don't get hit", not also "and they hit harder".
 *
 * `bossHpMult`/`bossDmgMult` layer on top of BOSS_BUFF specifically — added
 * so Normal's boss fights could be eased on their own axis without touching
 * BOSS_BUFF itself (which Medium/Hard still want at full strength) or
 * softening Normal's ordinary trash mobs along with it.
 *
 * `regenBonus` is the one difficulty axis that touches the PLAYER rather
 * than enemies — applied once at run start (see main.js's startRun) as a
 * flat addition to the `regen` stat. Normal is meant to be forgiving in a
 * way Medium/Hard shouldn't be, and passive healing is a forgiveness lever
 * enemy-side multipliers can't express.
 */
export const DIFFICULTIES = {
  normal: {
    id: 'normal', hpMult: 1.0, dmgMult: 1.0, speedMult: 1.0, oneHit: false,
    bossHpMult: 0.7, bossDmgMult: 0.75, regenBonus: 0.5,
  },
  medium: {
    id: 'medium', hpMult: 1.35, dmgMult: 1.25, speedMult: 1.06, oneHit: false,
    bossHpMult: 1, bossDmgMult: 1, regenBonus: 0,
  },
  hard: {
    id: 'hard', hpMult: 1.85, dmgMult: 1.65, speedMult: 1.14, oneHit: false,
    bossHpMult: 1, bossDmgMult: 1, regenBonus: 0,
  },
  oneHit: {
    id: 'oneHit', hpMult: 1.0, dmgMult: 1.0, speedMult: 1.0, oneHit: true,
    bossHpMult: 1, bossDmgMult: 1, regenBonus: 0,
  },
};

export const DEFAULT_DIFFICULTY = 'normal';

export const WAVES = {
  // Cut from 20 after direct playtesting feedback ("way too easy") — shorter
  // waves compound every curve below faster in real time without changing any
  // of the curves' own shape, which is the most direct lever for "the game
  // takes too long to get dangerous".
  duration: 17,            // seconds per wave
  // Difficulty scaling per wave index (wave 1 = multiplier of 1.0)
  // Both curves carry a quadratic term on purpose.
  //
  // Player damage scales *multiplicatively* — additive-percent damage times
  // additive-percent attack speed times projectile count — which is close to
  // exponential in level. Purely linear enemy scaling can never catch that, and
  // a run that a good build can no longer lose stops being a run. The squared
  // term is what eventually closes the gap and ends the run.
  // Steepened after direct playtesting feedback that the game was "way too
  // easy" — prior tuning was validated against bot simulations, which
  // systematically under-play a human: a bot's flee radius reacts to distance
  // alone, while a person reads telegraphs, plans an escape route, and times
  // movement far more precisely. Trust the firsthand report over the bots.
  // Floor raised from 1.0 to 1.5 on explicit "make early game really hard"
  // feedback — every version of this curve before started wave 1 at
  // exactly base stats, since (wave-1) is 0 there regardless of growth
  // rate. Steepening the RATE only ever made later waves scarier; it could
  // never touch how wave 1 itself feels, because the rate term contributes
  // nothing until waves have actually passed. The floor is the only lever
  // that reaches the start of the run at all.
  hpScale: (wave) => 1.5 + 0.19 * (wave - 1) + 0.007 * (wave - 1) ** 2,
  /**
   * Enemy speed is the curve that actually ends runs, and it was the one left
   * flat. Capped at 1.45x, a grunt tops out at 119 px/s against a player who
   * starts at 215 and can upgrade past 340 — so kiting stayed free forever and
   * a strong build simply never got caught, no matter how much health or how
   * many enemies were thrown at it. Inflating those only slowed the damage
   * race; it never threatened the player.
   *
   * Letting speed climb toward the player's own makes late waves close the gap,
   * turns Light Step from a nicety into a defensive stat, and gives darters
   * (145 base) a genuine chance to run you down.
   *
   * With this curve carrying the difficulty, the health and spawn-rate curves
   * could be relaxed again — they no longer have to end the run by themselves,
   * so a run has room to reach the deep end of the upgrade tree first.
   *
   * Uncapped on purpose. Any ceiling here is a wave at which difficulty stops
   * growing in the only dimension the player cannot out-scale, and a strong
   * enough build parks there forever. Without one, every run ends eventually.
   */
  // Same floor-not-rate reasoning as hpScale: 1.2 from wave 1 on, so kiting
  // isn't free even in the opening minute.
  speedScale: (wave) => 1.2 + 0.048 * (wave - 1),
  damageScale: (wave) => 1.4 + 0.14 * (wave - 1),
  // Enemies spawned per second.
  // These curves were pushed much harder while Quake and the fire loop were
  // still outrunning them. Once those were fixed at the source, the same curves
  // ended every run by wave 12 — before a player ever reaches the deep branches
  // the tree exists for. Tuned back to let a good build reach roughly level 30.
  // Also uncapped, for the same reason as speed. Two builds that both cleared
  // everything thrown at them finished a 25-minute run with an *identical*
  // 36,940 kills — the giveaway that they were spawn-limited, not
  // damage-limited, and that the rate ceiling was the thing holding the run
  // open. `maxEnemies` still bounds what can be on screen, so this costs
  // nothing in performance.
  // Floor raised 1.0 -> 1.7 for the same reason as the curves above: wave 1
  // used to spawn at exactly the old baseline rate no matter how the growth
  // term was tuned.
  spawnRate: (wave) => 1.7 + 0.34 * (wave - 1) + 0.013 * (wave - 1) ** 2,
  maxEnemies: 420,
  spawnMargin: 90,         // how far outside the viewport enemies appear
};

export const COMBAT = {
  contactCooldown: 0.55,   // per-enemy cooldown between its touch attacks
  separationForce: 320,    // soft steering force that keeps the horde spread out

  // Body-blocking: a second, *positional* pass on top of the soft separation
  // above, run once per tick against fresh post-movement positions. Soft
  // separation steers enemies apart gradually; this instead directly corrects
  // any overlap still left over, so bodies stop visually stacking even in a
  // packed corner. `bodyPushStrength` is the fraction of overlap corrected
  // per tick — under 1 so it reads as firm contact, not a teleporting snap.
  bodyPushStrength: 0.85,
  // Each simultaneous solid contact against the player cuts this much off
  // their move speed (multiplicatively), floored at `crowdSlowMin` so being
  // surrounded slows you to a crawl rather than a hard stop — a hard stop
  // would just be a stunlock, not a positioning puzzle.
  crowdSlowPerContact: 0.14,
  crowdSlowMin: 0.32,
  crowdSlowLambda: 9,      // how fast the speed penalty eases toward its target
};

/**
 * Elites: rare, tougher versions of an existing archetype carrying one random
 * extra behaviour on top of whatever that archetype already does. Never
 * bosses or swarm-cluster members — a "worth singling out" enemy needs to
 * actually stand alone, which a six-pack of swarmlings never does.
 */
/**
 * On top of the same per-wave hpScale/speedScale/damageScale every regular
 * enemy gets — a boss used to be "whatever The Maw's base numbers happen to
 * scale to at this wave," which is exactly why one could read as just a big
 * grunt. This is what actually earns the arena that now clears for it: a
 * meaningfully harder fight, not just a lonelier one.
 */
export const BOSS_BUFF = {
  // Reversed on direct "too much HP, too little damage" feedback: a boss
  // fight was reading as a slow damage-sponge chore rather than a dangerous
  // encounter. HP pulled back down and damage pushed up so a fight is
  // shorter and hits harder — a real threat you have to dodge, not a wall
  // you whittle down while barely at risk.
  hpMult: 3.5,
  damageMult: 4.5,
  speedMult: 1.4,
};

export const ELITE = {
  // Was wave 4 — early waves had nothing tougher than base trash in the
  // pool at all. Now live from wave 1: the very first enemies a run sees
  // can already be a Waller, Mortar, or Speed Aura carrier.
  unlockWave: 1,
  chance: 0.09,       // per eligible spawn, once unlocked (was 0.05)
  hpMult: 1.9,
  damageMult: 1.35,
  radiusMult: 1.2,
  speedMult: 1.05,
  xpMult: 3,
  modifiers: ['waller', 'mortar', 'speedAura'],

  // Waller: periodically boxes the player in with a short arc of temporary
  // walls, centred on the player rather than the elite itself — the point is
  // to cut off an escape route, not to build a fort around its own body.
  // Deliberately leaves gaps (segmentCount short of a full circle) so it's a
  // forced choice of exit, never a literal cage.
  waller: {
    interval: 5.5,
    castRange: 520,
    warnDuration: 0.55,
    wallLife: 3.2,
    segmentCount: 3,
    segmentLength: 92,
    thickness: 14,
    placeRadius: 150,
    color: '#9fa8bd',
  },

  // Mortar: an indirect attack aimed at where the player is *heading*, not
  // where they are — dodged by reading the landing telegraph and being
  // somewhere else when it resolves, not by strafing a projectile in flight.
  mortar: {
    cooldown: 3.6,
    maxRange: 900,
    leadTime: 0.85,
    travelTime: 1.1,
    blastRadius: 95,
    damage: 26,
    color: '#ff8a3d',
  },

  // Speed Aura: a passive radius that hastens ordinary (non-elite, non-boss)
  // enemies caught inside it. Refreshed every tick they're in range and
  // decays shortly after leaving, the same shape the slow status already
  // uses, so a buffed straggler doesn't instantly snap back to normal speed
  // the moment it steps out.
  speedAura: {
    radius: 150,
    speedMult: 1.45,
    refreshTime: 0.35,
    color: '#7ce7ff',
  },
};

/**
 * Enrage: the answer to pure turtling. Nothing punishes distance by itself —
 * every other pressure in the game comes from proximity — so a player who
 * never lets anything close simply never takes a hit, no matter how long the
 * run goes. This instead tracks time since the player's *last kill*: go too
 * long without landing one and every enemy on screen gradually hits harder
 * and moves faster, easing back down the moment kills resume. A build that
 * wants to stall forever has to actually fight to hold the timer down.
 */
export const ENRAGE = {
  graceTime: 9,          // seconds without a kill before it starts building
  rampLambda: 0.35,       // damp() rate ramping the buff up — a slow build
  decayLambda: 1.1,       // damp() rate easing it back down — faster relief
  maxSpeedBonus: 0.5,     // +50% enemy speed at full enrage
  maxDamageBonus: 0.6,    // +60% enemy damage at full enrage
};

/**
 * Resonant nodes: the reliable source of rare material.
 *
 * They spawn well away from the player on purpose. Walking to one means leaving
 * whatever ground you had established, and cracking it wakes a guard pack — so
 * a node is a decision about whether you can afford the detour, not a free
 * pickup. Kills alone would make a rare-tier recipe take a dozen runs.
 */
export const NODES = {
  firstSpawn: 18,          // seconds before the first one appears
  interval: 32,            // seconds between spawns
  maxActive: 2,
  lifetime: 48,            // despawns if ignored, so they can't stockpile
  minDistance: 420,        // never spawns close enough to be free
  maxDistance: 900,
  radius: 22,
  guards: (wave) => Math.min(22, 4 + Math.floor(wave * 1.4)),
};

/**
 * Biomes: picked once at the start of a run, purely additive — a different
 * floor palette plus one environmental hazard mechanic. Deliberately not
 * static obstacles or walls: that would mean teaching every enemy's AI and
 * every projectile to path around them, a much bigger change than "the arena
 * looks and feels different this run." A hazard here only ever threatens the
 * player directly (never enemies, never a stat), so it can't shift build
 * balance the way a weapon or upgrade could — it's terrain, not power.
 */
export const BIOMES = {
  wastes: {
    id: 'wastes', name: 'The Driftwastes',
    floorTint: null, wallColor: '#33415c',
    hazard: null,
  },
  cinder: {
    id: 'cinder', name: 'The Cinder Rift',
    floorTint: 'rgba(120, 40, 20, 0.14)', wallColor: '#7a3a2a',
    bias: { cinderling: 2.4, rimewalker: 0.4 },
    hazard: {
      kind: 'damage',
      firstSpawn: 14, interval: 7.5, maxActive: 3,
      minDistance: 140, maxDistance: 420,
      radius: 68, warnDuration: 1.1, activeDuration: 3.2,
      tickInterval: 0.4, damagePerTick: 6,
      color: '#ff5a2e',
    },
  },
  frost: {
    id: 'frost', name: 'The Frostreach',
    floorTint: 'rgba(40, 90, 130, 0.16)', wallColor: '#3a5a78',
    bias: { rimewalker: 3.0, cinderling: 0.3, darter: 0.7 },
    hazard: {
      kind: 'slow',
      firstSpawn: 10, interval: 9, maxActive: 3,
      minDistance: 120, maxDistance: 460,
      radius: 90, warnDuration: 1.3, activeDuration: 5,
      slowMult: 0.55,
      color: '#7ce7ff',
    },
  },
  bloom: {
    id: 'bloom', name: 'The Sporefields',
    floorTint: 'rgba(60, 120, 40, 0.15)', wallColor: '#3f6b2a',
    // Biased toward the things that actually live here. `bias` multiplies a
    // type's spawn weight; anything unlisted keeps its base weight, so a biome
    // colours the mix rather than replacing it. Replacing it outright would
    // make each map a separate game with its own difficulty curve to tune.
    bias: { sporecarrier: 3.2, grunt: 1.2, darter: 0.5 },
    hazard: {
      kind: 'damage',
      firstSpawn: 12, interval: 6.5, maxActive: 4,
      minDistance: 130, maxDistance: 440,
      radius: 74, warnDuration: 1.2, activeDuration: 3.6,
      tickInterval: 0.45, damagePerTick: 5,
      color: '#b8ff5e',
    },
  },
  static_: {
    id: 'static_', name: 'The Static Reach',
    floorTint: 'rgba(120, 110, 40, 0.13)', wallColor: '#7a6b2a',
    bias: { conduit: 3.5, darter: 1.6, brute: 0.5 },
    hazard: {
      kind: 'damage',
      firstSpawn: 9, interval: 5.5, maxActive: 4,
      minDistance: 110, maxDistance: 400,
      radius: 56, warnDuration: 0.8, activeDuration: 2.2,
      tickInterval: 0.3, damagePerTick: 7,
      color: '#ffe066',
    },
  },
  hollow: {
    id: 'hollow', name: 'The Hollow Span',
    floorTint: 'rgba(70, 40, 110, 0.16)', wallColor: '#4a2a7a',
    bias: { brute: 2.2, juggernaut: 2.0, darter: 0.35, grunt: 0.7 },
    hazard: {
      kind: 'slow',
      firstSpawn: 11, interval: 8, maxActive: 3,
      minDistance: 120, maxDistance: 430,
      radius: 100, warnDuration: 1.2, activeDuration: 5.5,
      slowMult: 0.5,
      color: '#b45cff',
    },
  },
  emberfall: {
    id: 'emberfall', name: 'The Emberfall',
    floorTint: 'rgba(140, 60, 20, 0.17)', wallColor: '#8a4020',
    bias: { cinderling: 3.4, rimewalker: 0.3, grunt: 1.1 },
    hazard: {
      kind: 'damage',
      firstSpawn: 8, interval: 5, maxActive: 5,
      minDistance: 100, maxDistance: 460,
      radius: 60, warnDuration: 0.9, activeDuration: 2.6,
      tickInterval: 0.35, damagePerTick: 7,
      color: '#ff8a3d',
    },
  },
};

export const BIOME_IDS = Object.keys(BIOMES);

/**
 * Chests: the arena's own reward source, distinct from what a kill or a node
 * hands you. Two spawn paths share this config — a small per-kill drop chance,
 * and a periodic "found in the open" spawn that behaves like a node but
 * without the guard-pack cost, since a chest is meant to read as a pure
 * bonus rather than another fight.
 */
export const CHESTS = {
  // Measured against a real run: 0.028 produced 24 opened chests and 122
  // units of exotic-tier material from one 5-minute run — an entire economy
  // built around scarcity (see meta/recipes.js) made irrelevant by a reward
  // layer that was supposed to sit on top of it, not replace it. Retuned so a
  // typical ~1000-kill run yields roughly half a dozen from kills, plus
  // whatever it finds in the open.
  dropChance: 0.005,        // per kill, before any gear bonus multiplies it
  findFirstSpawn: 45,
  findInterval: 70,
  findMaxActive: 1,
  lifetime: 45,
  minDistance: 300,
  maxDistance: 800,
  radius: 16,
};

export const FX = {
  maxParticles: 900,
  damageNumbers: true,
  screenShakeDecay: 7,

  // Hit-stop: a few frames of true freeze on a kill that deserves one. Tiny on
  // purpose — this is meant to read as impact, not input lag. Gated by enemy
  // mass so it never fires on the constant stream of one-hit grunts, which
  // would turn "impact" into "sluggish".
  hitStopMassThreshold: 3,     // brute-and-heavier corpses trigger it
  hitStopDuration: 0.05,
  hitStopDurationBoss: 0.09,   // a boss kill earns a longer beat
  hitStopDurationCrit: 0.04,

  // Kill combo: consecutive kills inside this window keep the streak alive.
  comboWindow: 1.1,

  chestRevealDuration: 2.4,   // how long the post-open reward callout stays up
  critFlashDuration: 0.14,    // brief bright pulse on a critical hit
};
