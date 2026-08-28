/**
 * weapons.js — the weapon engine.
 *
 * Holds the player's weapon instances and drives every projectile-ish entity in
 * the game. The definitions in weaponDefs.js say *what* a weapon does; this file
 * is the machinery that runs them and resolves their hits.
 *
 * Each weapon carries its own `Stats` stack seeded from its definition, so a
 * "+30% Scattergun damage" upgrade is a modifier on that weapon alone, while a
 * "+15% damage" upgrade is a modifier on the player and lifts everything. Both
 * are the same mechanism as the crafting system will use.
 */

import { Stats } from './stats.js';
import { removeAt, addZone, addBlast } from './state.js';
import { damageEnemy, applyBurn, applyMark } from './enemies.js';
import { spawnParticles } from './effects.js';
import { WEAPONS, wstat } from './weaponDefs.js';
import { ARENA, PLAYER } from './config.js';
import { sfx } from '../audio/sfx.js';
import { queuePendingHit, releasePendingHit, releaseProjectile } from './weaponBases.js';

class Weapon {
  constructor(def) {
    this.def = def;
    this.id = def.id;
    this.name = def.name;
    this.stats = new Stats(def.base);
    this.cooldown = 0;
    this.rank = 1;        // how many upgrades this weapon has received
    this.scratch = {};    // per-weapon working state (orbit angle, timers)
    this.damageDealt = 0; // for the run summary / build readout
    if (def.init !== undefined) def.init(this);
  }
}

/** Give the player a weapon. Returns the instance, or null if already owned. */
export function addWeapon(state, id) {
  if (state.weapons.some((w) => w.id === id)) return null;
  if (state.weapons.length >= PLAYER.maxWeapons) return null;
  const def = WEAPONS[id];
  if (def === undefined) return null;
  const weapon = new Weapon(def);
  state.weapons.push(weapon);

  // Some modifiers (Keen) grant a *global* stat rather than a weapon-scoped
  // one, because the stat they touch is rolled globally per hit. Pushed onto
  // the player's stack tagged by weapon id, so it comes back off cleanly if
  // the weapon is ever removed — the same source-tagging gear already uses.
  if (def.playerStats !== undefined) {
    for (const mod of def.playerStats) {
      for (const [stat, adj] of Object.entries(mod.playerStats)) {
        if (adj.flat !== undefined) {
          state.stats.add({ stat, type: 'flat', value: adj.flat, source: 'weapon:' + id });
        }
        if (adj.inc !== undefined) {
          state.stats.add({ stat, type: 'inc', value: adj.inc, source: 'weapon:' + id });
        }
      }
    }
  }
  return weapon;
}

export function getWeapon(state, id) {
  return state.weapons.find((w) => w.id === id) ?? null;
}

export function hasWeapon(state, id) {
  return state.weapons.some((w) => w.id === id);
}

// ---------------------------------------------------------------------------

export function updateWeapons(state, dt) {
  const p = state.player;
  if (!p.alive) return;

  // One target lookup per frame, shared by every weapon that wants one. Each
  // weapon still respects its own range against that target.
  const longestRange = state.weapons.reduce(
    (m, w) => Math.max(m, w.stats.get('range') ?? 0), 0);
  state.target = longestRange > 0
    ? state.enemyGrid.findNearest(p.x, p.y, longestRange, (e) => e.alive)
    : null;

  if (state.target !== null) {
    p.facing = Math.atan2(state.target.y - p.y, state.target.x - p.x);
  }

  for (const weapon of state.weapons) {
    const def = weapon.def;

    if (def.tick !== undefined) def.tick(state, weapon, dt);
    if (def.fire === undefined) continue;

    weapon.cooldown -= dt;
    if (weapon.cooldown > 0) continue;

    if (def.target === 'nearest') {
      const range = weapon.stats.get('range');
      const t = state.target;
      // Respect this weapon's own range, not the shared lookup's.
      if (t === null || !t.alive) { weapon.cooldown = 0; continue; }
      const dx = t.x - p.x, dy = t.y - p.y;
      if (dx * dx + dy * dy > range * range) { weapon.cooldown = 0; continue; }
      def.fire(state, weapon, t);
    } else {
      def.fire(state, weapon);
    }

    // One call site for every weapon's discrete fire — cheaper than threading
    // an audio import through each `fire()` body, and it keeps those files
    // presentation-free (behaviour only).
    //
    // `arsenalId` rather than `weapon.id`: the engine id is a generated
    // composite (`splinter+burn`), while sound and animation are keyed to the
    // weapon the player thinks they are holding (`fire_wand`).
    const soundId = def.arsenalId ?? weapon.id;
    sfx.shoot(soundId);

    // Tell the inventory so the held-weapon sprite plays its swing and the
    // HUD icon flashes. Guarded because a run can fire before an inventory
    // exists (the Hub renders a dormant state behind the menu).
    if (state.inventory !== null && state.inventory !== undefined) {
      state.inventory.notifyFired(def.arsenalId ?? weapon.id);
    }

    weapon.cooldown = wstat(state, weapon, 'cooldown');
  }

  flushPendingHits(state);
}

/**
 * Hits queued during spatial-grid traversal are applied here instead of inline.
 *
 * Killing an enemy can trigger on-death effects that damage *other* enemies
 * (Volatile Remains), which would otherwise mean recursively mutating the crowd
 * midway through iterating it. Draining a queue keeps that strictly ordered.
 */
export function flushPendingHits(state) {
  const hits = state.pendingHits;
  if (hits.length === 0) return;
  // Re-read length each iteration: a modifier hook can queue more hits (a
  // chain jump, an explosion, a bloom), and those need draining in the same
  // pass — the same property the on-death chain reactions already rely on.
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    if (!h.enemy.alive) {
      releasePendingHit(h);
      continue;
    }

    const killed = damageEnemy(state, h.enemy, h.damage, {
      crit: h.crit, kx: h.kx ?? 0, ky: h.ky ?? 0,
      silent: h.silent ?? false, noArc: h.noArc ?? false,
    });

    // Weapon-modifier hooks. This is the one chokepoint every player-sourced
    // hit in the game passes through, which is exactly why a modifier can
    // work identically on a bolt, a beam, a mine blast and a turret shot
    // without any of those knowing modifiers exist.
    const w = h.weapon;
    if (w !== undefined && w !== null && w.def !== undefined) {
      const def = w.def;
      if (def.onHit !== undefined && def.onHit.length > 0) {
        for (let k = 0; k < def.onHit.length; k++) def.onHit[k].onHit(state, w, h.enemy, h);
      }
      if (killed && def.onKill !== undefined && def.onKill.length > 0) {
        for (let k = 0; k < def.onKill.length; k++) def.onKill[k].onKill(state, w, h.enemy, h);
      }
    }
    releasePendingHit(h);
  }
  hits.length = 0;
}

/**
 * A planted Fuse Shard going off. Queued through `pendingHits` like every
 * other area effect, so its damage still runs the weapon's on-hit modifiers.
 */
function detonateSeeder(state, pr) {
  const radius = pr.blastRadius;
  state.enemyGrid.forEachNear(pr.x, pr.y, radius + 30, (e) => {
    if (!e.alive) return;
    const dx = e.x - pr.x, dy = e.y - pr.y;
    const reach = radius + e.radius;
    if (dx * dx + dy * dy > reach * reach) return;
    const d = Math.hypot(dx, dy) || 1;
    const kb = pr.knockback / (e.mass || 1);
    queuePendingHit(state, {
      enemy: e, damage: pr.damage, crit: pr.crit, weapon: pr.weaponRef,
      kx: (dx / d) * kb, ky: (dy / d) * kb,
    });
  });
  addBlast(state, {
    x: pr.x, y: pr.y, radius, life: 0.3, maxLife: 0.3, color: pr.color,
  });
  spawnParticles(state, pr.x, pr.y, 16, {
    color: pr.color, speed: 230, speedVar: 120, life: 0.38, size: 3.5, drag: 4,
  });
  state.addShake(5);
}

// ---------------------------------------------------------------------------
// Projectiles — bolts, pellets, and homing seekers
// ---------------------------------------------------------------------------

export function updateProjectiles(state, dt) {
  const { projectiles } = state;
  const grid = state.enemyGrid;

  for (let i = projectiles.length - 1; i >= 0; i--) {
    const pr = projectiles[i];

    pr.life -= dt;
    if (pr.life <= 0) { removeAt(projectiles, i); releaseProjectile(pr); continue; }

    if (pr.kind === 'seeker') steerSeeker(state, pr, dt);
    else if (pr.kind === 'boomerang') {
      // Flies out, stalls, then comes back through the same lane. `hit` is
      // cleared on the turn so the return leg can strike the same enemies
      // again — that second pass is the entire reason to use this base.
      pr.outTimer -= dt;
      if (pr.outTimer <= 0 && !pr.returning) {
        pr.returning = true;
        pr.vx = -pr.vx; pr.vy = -pr.vy;
        pr.angle += Math.PI;
        pr.hit.clear();
      }
    } else if (pr.kind === 'seeder' && !pr.planted) {
      // Decelerates to a stop, plants, then detonates on its fuse.
      pr.vx *= 1 - Math.min(1, dt * 3.2);
      pr.vy *= 1 - Math.min(1, dt * 3.2);
      if (Math.hypot(pr.vx, pr.vy) < 60) {
        pr.planted = true;
        pr.vx = 0; pr.vy = 0;
      }
    }

    if (pr.kind === 'seeder' && pr.planted) {
      pr.fuse -= dt;
      if (pr.fuse <= 0) {
        detonateSeeder(state, pr);
        removeAt(projectiles, i);
        releaseProjectile(pr);
        continue;
      }
    }

    const prevX = pr.x, prevY = pr.y;
    pr.x += pr.vx * dt;
    pr.y += pr.vy * dt;

    // Ricochet bounces off the arena bounds instead of expiring on them,
    // which is what turns a corner from a dead end into a usable surface.
    if (pr.kind === 'ricochet' && pr.bounces > 0) {
      let bounced = false;
      if (pr.x < 6) { pr.x = 6; pr.vx = Math.abs(pr.vx); bounced = true; }
      else if (pr.x > ARENA.width - 6) { pr.x = ARENA.width - 6; pr.vx = -Math.abs(pr.vx); bounced = true; }
      if (pr.y < 6) { pr.y = 6; pr.vy = Math.abs(pr.vy); bounced = true; }
      else if (pr.y > ARENA.height - 6) { pr.y = ARENA.height - 6; pr.vy = -Math.abs(pr.vy); bounced = true; }
      if (bounced) {
        pr.bounces--;
        pr.angle = Math.atan2(pr.vy, pr.vx);
        pr.hit.clear();   // a bounced shot is a fresh threat to the same crowd
        spawnParticles(state, pr.x, pr.y, 4, {
          color: pr.color, speed: 120, life: 0.18, size: 2.5,
        });
      }
    }

    if (pr.x < -50 || pr.x > ARENA.width + 50 || pr.y < -50 || pr.y > ARENA.height + 50) {
      removeAt(projectiles, i);
      releaseProjectile(pr);
      continue;
    }

    // Fast projectiles can cross a small enemy entirely within one tick, so
    // test the segment travelled rather than the end point.
    const stepLen = Math.hypot(pr.x - prevX, pr.y - prevY);
    const midX = (prevX + pr.x) / 2;
    const midY = (prevY + pr.y) / 2;
    let consumed = false;

    grid.forEachNear(midX, midY, stepLen / 2 + pr.radius + 26, (e) => {
      if (consumed || !e.alive || pr.hit.has(e)) return;
      if (!segmentHitsCircle(prevX, prevY, pr.x, pr.y, e.x, e.y, e.radius + pr.radius)) return;

      pr.hit.add(e);

      const kb = pr.knockback / (e.mass || 1);
      const m = Math.hypot(pr.vx, pr.vy) || 1;
      queuePendingHit(state, {
        enemy: e, damage: pr.damage, crit: pr.crit,
        // Carried from the projectile so on-hit modifiers still know which
        // weapon caused a hit that resolves a whole deferred queue later.
        weapon: pr.weaponRef, fromMod: pr.fromMod,
        kx: (pr.vx / m) * kb, ky: (pr.vy / m) * kb,
      });

      // Mark a radius, not just the victim. Marking only the enemy that was
      // hit was almost worthless: a Seeker shard usually *kills* what it hits,
      // so the mark landed on a corpse and no living enemy ever carried it.
      if (pr.marks > 0) {
        if (pr.markRadius > 0) {
          state.enemyGrid.forEachNear(e.x, e.y, pr.markRadius, (o) => {
            if (!o.alive) return;
            const ox = o.x - e.x, oy = o.y - e.y;
            if (ox * ox + oy * oy <= pr.markRadius * pr.markRadius) applyMark(o, pr.marks);
          });
        } else {
          applyMark(e, pr.marks);
        }
      }

      spawnParticles(state, e.x, e.y, pr.crit ? 6 : 3, {
        color: pr.crit ? '#fff3b0' : pr.color,
        speed: 150, life: 0.2, size: 2.5,
        angle: pr.angle + Math.PI, spread: 1.6,
      });

      if (pr.pierce > 0) pr.pierce--;
      else consumed = true;
    });

    if (consumed) {
      removeAt(projectiles, i);
      releaseProjectile(pr);
    }
  }

  flushPendingHits(state);
}

/** Homing: rotate velocity toward the current target at a bounded turn rate. */
function steerSeeker(state, pr, dt) {
  // Re-acquire when the target dies, so a seeker never wanders off after a
  // corpse. Searching every frame for every seeker would be wasteful.
  // `== null` rather than `=== null` on purpose: it catches undefined too, so
  // a projectile retagged into a seeker by the Seeking modifier can't reach
  // the `.alive` dereference below with no target field at all.
  if (pr.target == null || !pr.target.alive) {
    pr.target = state.enemyGrid.findNearest(pr.x, pr.y, 460, (e) => e.alive && !pr.hit.has(e));
  }
  if (pr.target === null) return;

  const desired = Math.atan2(pr.target.y - pr.y, pr.target.x - pr.x);
  let delta = desired - pr.angle;
  // Wrap into [-PI, PI] so it always turns the short way round.
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;

  const maxTurn = pr.turnRate * dt;
  pr.angle += Math.max(-maxTurn, Math.min(maxTurn, delta));
  pr.vx = Math.cos(pr.angle) * pr.speed;
  pr.vy = Math.sin(pr.angle) * pr.speed;
}

/** Closest-point-on-segment test against a circle. */
function segmentHitsCircle(x1, y1, x2, y2, cx, cy, r) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = 0;
  if (len2 > 1e-9) {
    t = ((cx - x1) * dx + (cy - y1) * dy) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
  }
  const px = x1 + dx * t, py = y1 + dy * t;
  const ox = cx - px, oy = cy - py;
  return ox * ox + oy * oy <= r * r;
}

// ---------------------------------------------------------------------------
// Beams — resolved instantly on the frame they're fired, then linger to draw
// ---------------------------------------------------------------------------

export function updateBeams(state, dt) {
  const { beams } = state;

  for (let i = beams.length - 1; i >= 0; i--) {
    const b = beams[i];

    if (!b.resolved) {
      b.resolved = true;
      resolveBeam(state, b);
    }

    b.life -= dt;
    if (b.life <= 0) removeAt(beams, i);
  }

  flushPendingHits(state);
}

function resolveBeam(state, b) {
  // A beam with no damage is a purely visual one (Siphon and Overcharge both
  // resolve their own hits and push a beam only to be seen). Guarded here as
  // well as at the call site: reading an undefined `damage` silently poisons
  // `state.damageDealt` with NaN, which then propagates into the run summary
  // rather than failing loudly anywhere near the cause.
  if (typeof b.damage !== 'number') return;

  const dx = b.x2 - b.x1, dy = b.y2 - b.y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = dx / len, ny = dy / len;

  // Gather everything the line touches, then sort by distance along it. Order
  // matters: Overcharge ramps damage with each enemy already pierced, so the
  // beam has to resolve front-to-back to be meaningful.
  const struck = [];
  const midX = (b.x1 + b.x2) / 2;
  const midY = (b.y1 + b.y2) / 2;

  state.enemyGrid.forEachNear(midX, midY, len / 2 + b.width + 40, (e) => {
    if (!e.alive) return;
    if (!segmentHitsCircle(b.x1, b.y1, b.x2, b.y2, e.x, e.y, e.radius + b.width / 2)) return;
    struck.push({ e, t: (e.x - b.x1) * nx + (e.y - b.y1) * ny });
  });

  struck.sort((a, c) => a.t - c.t);

  for (let i = 0; i < struck.length; i++) {
    const e = struck[i].e;
    const damage = b.damage * (1 + b.rampPerHit * i);
    queuePendingHit(state, {
      enemy: e, damage, crit: b.crit,
      kx: nx * (b.knockback / (e.mass || 1)),
      ky: ny * (b.knockback / (e.mass || 1)),
    });
    spawnParticles(state, e.x, e.y, 4, {
      color: b.color, speed: 130, life: 0.22, size: 2.5,
    });
  }

  b.struckCount = struck.length;
}

// ---------------------------------------------------------------------------
// Shockwaves — expanding rings that hit each enemy once as they sweep past
// ---------------------------------------------------------------------------

export function updateShockwaves(state, dt) {
  const { shockwaves } = state;

  for (let i = shockwaves.length - 1; i >= 0; i--) {
    const s = shockwaves[i];

    s.life -= dt;
    const progress = 1 - Math.max(0, s.life) / s.expandTime;
    s.radius = 10 + (s.maxRadius - 10) * easeOutCubic(progress);

    // Only test the growing annulus, not the whole disc: an enemy well inside
    // the ring was already hit on an earlier frame.
    state.enemyGrid.forEachNear(s.x, s.y, s.radius + 40, (e) => {
      if (!e.alive || s.hit.has(e)) return;
      const dx = e.x - s.x, dy = e.y - s.y;
      const d = Math.hypot(dx, dy);
      if (d > s.radius + e.radius) return;

      s.hit.add(e);
      const m = d || 1;
      const kb = s.knockback / (e.mass || 1);

      // Damage falls off toward the rim. A flat-damage ring made Quake the
      // strongest weapon in the game by a wide margin: it hit the entire crowd
      // for full damage, needed no aim, and worked perfectly while running away
      // — which is the optimal playstyle anyway. Falloff means it still rewards
      // being in the middle of the fight, without paying you for fleeing it.
      const falloff = Math.max(0.45, 1 - 0.55 * (d / s.maxRadius));

      queuePendingHit(state, {
        enemy: e, damage: s.damage * falloff, crit: s.crit,
        kx: (dx / m) * kb, ky: (dy / m) * kb,
      });
    });

    if (s.life <= 0) removeAt(shockwaves, i);
  }

  flushPendingHits(state);
}

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

// ---------------------------------------------------------------------------
// Zones — lingering ground effects (Ember trails, Quake fissures, fire pools)
// ---------------------------------------------------------------------------

const ZONE_TICK = 0.25;   // damage cadence, so DoT isn't 60 tiny hits a second

export function updateZones(state, dt) {
  const { zones } = state;

  for (let i = zones.length - 1; i >= 0; i--) {
    const z = zones[i];

    z.life -= dt;
    if (z.life <= 0) { removeAt(zones, i); continue; }

    z.tick -= dt;
    if (z.tick > 0) continue;
    z.tick = ZONE_TICK;

    const damage = z.dps * ZONE_TICK;

    state.enemyGrid.forEachNear(z.x, z.y, z.radius + 30, (e) => {
      if (!e.alive) return;
      const dx = e.x - z.x, dy = e.y - z.y;
      const reach = z.radius + e.radius;
      if (dx * dx + dy * dy > reach * reach) return;

      // Silent: a burning crowd would bury the screen in damage numbers.
      queuePendingHit(state, { enemy: e, damage, crit: false, silent: true });
      if (z.burn > 0) applyBurn(e, z.dps * 0.4, z.burn);
    });
  }

  flushPendingHits(state);
}
