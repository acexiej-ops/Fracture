/**
 * waves.js — the spawn director.
 *
 * Escalation comes from three dials turning at once: how *often* enemies
 * arrive, how *tough* they are (applied at spawn time in enemies.js), and
 * *which* archetypes are in the pool. Spawns are placed just outside the
 * viewport in a ring around the camera, so pressure always comes from the edges
 * of what the player can see.
 */

import { WAVES, ARENA, BOSS_WAVE_INTERVAL, bossKindForWave, BIOMES } from './config.js';
import { rng } from '../core/rng.js';
import { clamp } from '../core/math.js';
import { spawnEnemy, availableTypes } from './enemies.js';

// Half the side length of the box the arena shrinks to for a boss fight —
// tight enough that it reads as "just you and the boss", loose enough that
// the fight still has room to move in (a boss's own telegraphed attacks are
// sized against the ordinary arena, so shrinking further risked making them
// unavoidable).
const BOSS_ARENA_HALF = 480;

/**
 * @returns {{ newWave: boolean, bossName: string|null }} `bossName` is set on
 *   the one tick a milestone boss actually spawns, for `main.js` to announce —
 *   the same "system reports the moment, the orchestrator shows it" shape the
 *   wave banner already uses.
 */
export function updateWaves(state, dt, viewW, viewH) {
  // A boss fight is an arena, not a wave with one extra enemy in it: zero
  // ambient trash spawns for as long as the boss lives. A reduced-but-
  // nonzero rate used to run here, which was exactly why a boss read as
  // "just a bigger normal enemy" — it was fighting alongside a crowd instead
  // of standing alone. The boss's OWN adds (Choir's summon, Brood's
  // summonSwarm) are unaffected — those are its kit, not ambient pressure.
  const bossAlive = state.enemies.some((e) => e.type.boss === true && e.alive);

  // The wave clock simply doesn't run while a boss is alive, so the wave
  // number can't advance and the next boss can't be summoned until this one
  // is beaten. `state.time` (the HUD clock, best-time tracking) is untouched
  // — only wave progression pauses, not the run itself.
  if (!bossAlive) state.waveClock += dt;

  const startedNewWave = state.updateWave();
  let bossName = null;

  if (startedNewWave && state.wave > 1) {
    // A small burst at each wave boundary makes the step-up legible. It still
    // respects the cap — otherwise the burst walks straight past it.
    const burst = Math.min(24, 3 + state.wave * 2);
    spawnDiverseBurst(state, viewW, viewH, burst);

    if (state.wave % BOSS_WAVE_INTERVAL === 0) {
      bossName = spawnBossWave(state, viewW, viewH);
    }
  }

  const rateMult = bossAlive ? 0 : (state.tournament?.spawnRate ?? 1);

  state.spawnAccumulator += WAVES.spawnRate(state.wave) * rateMult * dt;

  while (state.spawnAccumulator >= 1) {
    state.spawnAccumulator -= 1;
    if (state.enemies.length >= WAVES.maxEnemies) {
      state.spawnAccumulator = 0;
      break;
    }
    spawnOne(state, viewW, viewH);
  }

  // Give the whole arena back the moment nothing boss-shaped is left alive —
  // rechecked here (rather than reusing the `bossAlive` above) so a boss that
  // died and was replaced by a fresh one in the same tick doesn't flicker the
  // walls open for a frame.
  if (state.arenaBounds !== null && !state.enemies.some((e) => e.type.boss === true && e.alive)) {
    state.arenaBounds = null;
  }

  return { newWave: startedNewWave, bossName };
}

/**
 * Places the milestone boss inside the very box the fight is about to be
 * confined to (see enterBossArena) — not just offscreen like an ordinary
 * spawn, which could as easily land outside the shrunk arena as inside it.
 */
function spawnBossWave(state, viewW, viewH) {
  const kind = bossKindForWave(state.wave);
  const bounds = bossArenaBounds(state);
  const p = pointInBossArena(state, bounds);
  const boss = spawnEnemy(state, kind, p[0], p[1]);
  enterBossArena(state, boss, bounds);
  return boss.type.name;
}

/** The box a boss fight confines both player and boss to — centred on the
 *  player, clamped so it never pokes outside the real arena. */
function bossArenaBounds(state) {
  const p = state.player;
  const half = BOSS_ARENA_HALF;
  const minX = clamp(p.x - half, 0, ARENA.width - half * 2);
  const minY = clamp(p.y - half, 0, ARENA.height - half * 2);
  return { minX, minY, maxX: minX + half * 2, maxY: minY + half * 2 };
}

/** A point inside `bounds`, far enough from the player that the boss doesn't
 *  simply appear on top of them. */
function pointInBossArena(state, bounds) {
  const p = state.player;
  const margin = 40;
  const minSpawnDist = 260;
  for (let attempt = 0; attempt < 8; attempt++) {
    const x = rng.range(bounds.minX + margin, bounds.maxX - margin);
    const y = rng.range(bounds.minY + margin, bounds.maxY - margin);
    if (Math.hypot(x - p.x, y - p.y) >= minSpawnDist) return [x, y];
  }
  // A box too small for any sample to clear minSpawnDist (a corner of the
  // real arena, heavily clamped) — fall back to whichever corner of the box
  // is furthest from the player rather than failing the spawn outright.
  const x = p.x < (bounds.minX + bounds.maxX) / 2 ? bounds.maxX - margin : bounds.minX + margin;
  const y = p.y < (bounds.minY + bounds.maxY) / 2 ? bounds.maxY - margin : bounds.minY + margin;
  return [x, y];
}

/**
 * The moment a boss actually arrives: clear the field down to just the two
 * of you, and hand over whatever XP was already sitting on the ground.
 *
 * This is a despawn, not a kill — no XP, no loot, no on-death procs, no
 * combo credit for anything cleared here. Nothing was earned by making room;
 * `killEnemy` is the path for enemies the player actually beat, and this
 * deliberately avoids it. Setting `alive = false` is enough — updateEnemies
 * already prunes dead entries from the array every tick on its own.
 *
 * Existing orbs get vacuumed rather than instantly granted so the moment
 * still reads as something happening (the same pull-everything-in feel
 * `EFFECTS.vacuum` already gives a couple of abilities) instead of the XP
 * bar just silently jumping. Reduces on-screen entity count for the fight
 * too, which is the performance half of the same request — fewer trash
 * enemies and orbs alive at once means less for the spatial grid, collision
 * resolution, and renderer to do every frame.
 */
function enterBossArena(state, boss, bounds) {
  for (const e of state.enemies) {
    if (e !== boss) e.alive = false;
  }
  for (const o of state.orbs) {
    o.magnetized = true;
    o.speed = Math.max(o.speed, 400);
  }
  state.arenaBounds = bounds;
}


/**
 * A type's spawn weight in the current biome.
 *
 * `bias` multiplies the base weight rather than replacing it, so a biome
 * COLOURS the mix instead of swapping it out. Replacing the pool outright
 * would make each map effectively a separate game with its own difficulty
 * curve to tune, and would mean a player who unlocked a counter to one
 * archetype could find it simply absent.
 *
 * Anything the biome does not mention keeps its base weight untouched.
 */
function biomeWeight(state, t) {
  const bias = BIOMES[state.biome]?.bias;
  if (bias === undefined) return t.weight;
  const mult = bias[t.id];
  return typeof mult === 'number' ? t.weight * mult : t.weight;
}

/**
 * One weighted roll. If the type carries `swarmSize`, that single roll places
 * a whole cluster at once — a swarmling picked this way costs one "spawn
 * budget" tick but shows up as six or so, scattered around one point, which is
 * the whole reason it reads as a swarm and not six individual coincidences.
 */
function spawnOne(state, viewW, viewH) {
  const types = availableTypes(state.wave);
  const type = rng.weighted(types, (t) => biomeWeight(state, t));
  const p = offscreenPoint(state, viewW, viewH);
  if (p === null) return;

  if (type.swarmSize !== undefined) {
    spawnCluster(state, type, p[0], p[1]);
  } else {
    spawnEnemy(state, type.id, p[0], p[1]);
  }
}

function spawnCluster(state, type, x, y) {
  for (let i = 0; i < type.swarmSize; i++) {
    if (state.enemies.length >= WAVES.maxEnemies) return;
    const a = rng.angle();
    const d = rng.range(0, type.swarmScatter);
    spawnEnemy(state, type.id, x + Math.cos(a) * d, y + Math.sin(a) * d);
  }
}

/**
 * Wave-boundary burst, diversified across types rather than drawn purely by
 * weight. A pure weighted roll repeated N times can — and early on, often
 * does — land on one archetype for the whole burst; round-robining a shuffled
 * type list guarantees the step-up into a new wave actually reads as mixed
 * pressure, which is the point of the burst existing at all.
 */
function spawnDiverseBurst(state, viewW, viewH, count) {
  const types = availableTypes(state.wave);
  if (types.length === 0) return;

  const order = rng.weightedSample(types, (t) => biomeWeight(state, t), Math.min(types.length, 4));

  for (let i = 0; i < count && state.enemies.length < WAVES.maxEnemies; i++) {
    const type = order[i % order.length];
    const p = offscreenPoint(state, viewW, viewH);
    if (p === null) continue;
    if (type.swarmSize !== undefined) spawnCluster(state, type, p[0], p[1]);
    else spawnEnemy(state, type.id, p[0], p[1]);
  }
}

/**
 * A point just beyond the visible rectangle, inside the arena.
 *
 * We pick a side (weighted by its length, so a wide viewport doesn't
 * over-spawn along the short edges) and retry if that lands outside the arena.
 * Retrying rather than clamping matters when the player is fighting in a
 * corner: clamping would smear every spawn into a line along the wall.
 */
function offscreenPoint(state, viewW, viewH) {
  const cam = state.camera;
  const m = WAVES.spawnMargin;
  const halfW = viewW / 2 + m;
  const halfH = viewH / 2 + m;
  const pad = 24;

  const hWeight = halfW * 2;
  const vWeight = halfH * 2;
  const total = (hWeight + vWeight) * 2;

  for (let attempt = 0; attempt < 8; attempt++) {
    const roll = rng.next() * total;
    let x, y;
    if (roll < hWeight) {                       // top
      x = cam.x - halfW + rng.next() * halfW * 2;
      y = cam.y - halfH;
    } else if (roll < hWeight * 2) {            // bottom
      x = cam.x - halfW + rng.next() * halfW * 2;
      y = cam.y + halfH;
    } else if (roll < hWeight * 2 + vWeight) {  // left
      x = cam.x - halfW;
      y = cam.y - halfH + rng.next() * halfH * 2;
    } else {                                    // right
      x = cam.x + halfW;
      y = cam.y - halfH + rng.next() * halfH * 2;
    }

    if (x >= pad && x <= ARENA.width - pad && y >= pad && y <= ARENA.height - pad) {
      return [x, y];
    }
  }
  return null;   // hemmed in on all sides; skip this spawn rather than cheat
}
