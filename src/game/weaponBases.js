/**
 * weaponBases.js — the 21 base combat behaviours a weapon can be built from.
 *
 * A "base type" is the *verb* of a weapon: how it delivers damage in space and
 * time. It is deliberately the axis that cannot be expressed as a number,
 * because that is what makes two weapons genuinely different rather than the
 * same weapon with different stats. A modifier (weaponMods.js) then says what
 * happens on top; `weaponGen.js` combines the two.
 *
 * The design rule inherited from Phase 2 of this project still holds and is
 * the reason this list is shaped the way it is: **no two bases should want the
 * same positioning.** Rail wants enemies lined up; Aura wants them touching
 * you; Mine wants you to have planned where they will be a second from now;
 * Turret wants you to hold ground you chose; Boomerang wants them on the
 * return path. If a proposed base only differed by a number, it was folded
 * into an existing one instead.
 *
 * The seven original weapons are imported and re-exported rather than
 * rewritten — they were already exactly this shape (data + a `fire` hook), so
 * migrating them is genuinely just re-registering them as bases, and every
 * recipe, upgrade and saved gear item that references `splinter` or `quake`
 * keeps working untouched.
 */

import { rng } from '../core/rng.js';
import { spawnParticles } from './effects.js';
import { TAU } from '../core/math.js';
import { addZone, addBlast, removeAt } from './state.js';
import { WEAPONS as LEGACY_WEAPONS, wstat, rollCrit, critDamage } from './weaponDefs.js';
import { MELEE_BASES } from './weaponMelee.js';

export { wstat, rollCrit, critDamage };

export const projectilePool = [];
export const pendingHitPool = [];

export function acquireProjectile(values) {
  const projectile = projectilePool.pop() ?? {};
  Object.assign(projectile, values);
  projectile.hit = values.hit ?? new Set();
  return projectile;
}

export function releaseProjectile(projectile) {
  projectile.hit?.clear();
  for (const key in projectile) delete projectile[key];
  projectilePool.push(projectile);
}

export function queuePendingHit(state, values) {
  const hit = pendingHitPool.pop() ?? {};
  Object.assign(hit, values);
  state.pendingHits.push(hit);
  return hit;
}

export function releasePendingHit(hit) {
  for (const key in hit) delete hit[key];
  pendingHitPool.push(hit);
}

// ---------------------------------------------------------------------------
// Shared spawn helpers — every base builds its entities through these, so a
// modifier that wants to tag "the thing this weapon just made" has exactly one
// entity shape to reason about.
// ---------------------------------------------------------------------------

/**
 * Fire one projectile along `angle`.
 *
 * `weaponRef` is the live weapon instance, carried on the projectile so that
 * when the hit finally resolves (in flushPendingHits, potentially several
 * entities and one deferred queue later) the modifier hooks still know which
 * weapon caused it. Without that back-reference, on-hit modifiers could not
 * exist at all.
 */
export function shoot(state, weapon, angle, opts = {}) {
  const p = state.player;
  const crit = rollCrit(state);
  const damage = critDamage(state, opts.damage ?? wstat(state, weapon, 'damage'), crit);
  const speed = opts.speed ?? wstat(state, weapon, 'projectileSpeed');
  const from = opts.from ?? p;

  const pr = acquireProjectile({
    kind: opts.kind ?? 'bolt',
    weapon: weapon.id,
    weaponRef: weapon,
    x: from.x + Math.cos(angle) * (opts.offset ?? 18),
    y: from.y + Math.sin(angle) * (opts.offset ?? 18),
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    angle,
    damage,
    crit,
    pierce: opts.pierce ?? wstat(state, weapon, 'pierce'),
    knockback: opts.knockback ?? wstat(state, weapon, 'knockback'),
    radius: opts.radius ?? 5,
    life: opts.life ?? 2.2,
    color: opts.color ?? weapon.def.color,
    hit: new Set(),
    marks: opts.marks ?? 0,
    markRadius: opts.markRadius ?? 0,
  });
  if (opts.extra !== undefined) Object.assign(pr, opts.extra);
  state.projectiles.push(pr);
  return pr;
}

/** Damage everything inside a circle, queued through the deferred hit path. */
export function damageCircle(state, weapon, x, y, radius, damage, opts = {}) {
  const crit = opts.crit ?? rollCrit(state);
  const dealt = critDamage(state, damage, crit);
  state.enemyGrid.forEachNear(x, y, radius + 40, (e) => {
    if (!e.alive) return;
    const dx = e.x - x, dy = e.y - y;
    const reach = radius + e.radius;
    if (dx * dx + dy * dy > reach * reach) return;
    const d = Math.hypot(dx, dy) || 1;
    const kb = (opts.knockback ?? 0) / (e.mass || 1);
    queuePendingHit(state, {
      enemy: e, damage: dealt, crit, weapon,
      kx: (dx / d) * kb, ky: (dy / d) * kb,
    });
  });
}

/** Damage everything inside an arc (cone) — the melee/whip primitive. */
export function damageArc(state, weapon, x, y, radius, facing, halfAngle, damage, opts = {}) {
  const crit = opts.crit ?? rollCrit(state);
  const dealt = critDamage(state, damage, crit);
  state.enemyGrid.forEachNear(x, y, radius + 40, (e) => {
    if (!e.alive) return;
    const dx = e.x - x, dy = e.y - y;
    const reach = radius + e.radius;
    if (dx * dx + dy * dy > reach * reach) return;
    // Angular difference wrapped into [-PI, PI] so a sweep that straddles the
    // -PI/+PI seam doesn't silently miss everything on one side of it.
    let diff = Math.atan2(dy, dx) - facing;
    while (diff > Math.PI) diff -= TAU;
    while (diff < -Math.PI) diff += TAU;
    if (Math.abs(diff) > halfAngle) return;
    const d = Math.hypot(dx, dy) || 1;
    const kb = (opts.knockback ?? 0) / (e.mass || 1);
    queuePendingHit(state, {
      enemy: e, damage: dealt, crit, weapon,
      kx: (dx / d) * kb, ky: (dy / d) * kb,
    });
  });
}

/** A purely visual melee sweep. Damage is already resolved by damageArc. */
export function addSweep(state, sweep) {
  if (state.sweeps.length >= 24) return;
  state.sweeps.push(sweep);
}

/** Place a turret / companion / mine. All three share one array and one loop. */
export function addDeployable(state, d) {
  // Capped per kind so a cooldown-reduction build can't carpet the arena and
  // turn the frame budget into a slideshow.
  const sameKind = state.deployables.filter((x) => x.kind === d.kind && x.weapon === d.weapon);
  const cap = d.cap ?? 6;
  if (sameKind.length >= cap) {
    // Oldest one goes, so a fresh placement always does something visible.
    const oldest = sameKind[0];
    const idx = state.deployables.indexOf(oldest);
    if (idx >= 0) state.deployables.splice(idx, 1);
  }
  state.deployables.push(d);
}

const nearestTo = (state, x, y, range) =>
  state.enemyGrid.findNearest(x, y, range, (e) => e.alive);

// ---------------------------------------------------------------------------
// The base types
// ---------------------------------------------------------------------------

/**
 * The seven originals, re-registered as bases. Their `fire` hooks are
 * unchanged — this is a migration, not a rewrite, so the balance work already
 * done on them carries over exactly.
 */
// Keyed by their ORIGINAL ids, not new ones. That is what makes this a
// migration rather than a parallel system: `buildWeapon('splinter', [])`
// registers back over `WEAPONS.splinter`, so every recipe, upgrade node and
// saved gear item that already names `splinter` keeps resolving — and the
// player can never end up holding both a legacy and a generated copy of the
// same weapon, which giving them new ids would have allowed.
const MIGRATED = {
  splinter: { ...LEGACY_WEAPONS.splinter, baseId: 'splinter', projKind: 'bolt', archetype: 'Single-target bolt' },
  scattergun: { ...LEGACY_WEAPONS.scattergun, baseId: 'scattergun', projKind: 'pellet', archetype: 'Close-range cone' },
  lance: { ...LEGACY_WEAPONS.lance, baseId: 'lance', projKind: 'shard', archetype: 'Piercing beam' },
  orbit: { ...LEGACY_WEAPONS.orbit, baseId: 'orbit', projKind: 'shard', archetype: 'Orbiting blades' },
  quake: { ...LEGACY_WEAPONS.quake, baseId: 'quake', projKind: 'ring', archetype: 'Radial burst' },
  seeker: { ...LEGACY_WEAPONS.seeker, baseId: 'seeker', projKind: 'orb', archetype: 'Homing shard' },
  ember: { ...LEGACY_WEAPONS.ember, baseId: 'ember', projKind: 'ring', archetype: 'Ground trail' },
};

/** The fourteen new behaviours. */
const NEW_BASES = {

  // CLEAVE and WHIP used to live here. Both were replaced by the motions in
  // weaponMelee.js: they resolved damage in an arc and drew a static filled
  // wedge, which is a hitbox with a decoration on it, not a swing. The
  // replacements animate a blade through the arc over the attack's life.

  /**
   * TURRET — a stationary emplacement that fires on its own.
   * The only base whose damage happens where you *were*, so it rewards
   * committing to ground and kiting around it rather than kiting away.
   */
  turret: {
    baseId: 'turret', id: 'turret', name: 'Sentry', archetype: 'Deployable turret',
    blurb: 'Drops a sentry that holds the ground you left it on.',
    color: '#7dffa8', target: 'self', projKind: 'bolt',
    base: {
      damage: 9, cooldown: 4.2, range: 340, projectileSpeed: 560,
      duration: 8, fireRate: 0.55, count: 1, pierce: 0, knockback: 60,
    },
    fire(state, weapon) {
      const p = state.player;
      const life = weapon.stats.get('duration') * state.stats.get('duration');
      addDeployable(state, {
        kind: 'turret', weapon: weapon.id, weaponRef: weapon,
        x: p.x, y: p.y, life, maxLife: life,
        cooldown: 0, fireRate: weapon.stats.get('fireRate'),
        range: weapon.stats.get('range'), cap: 4,
        color: weapon.def.color, spin: 0,
      });
      spawnParticles(state, p.x, p.y, 10, { color: weapon.def.color, speed: 120, life: 0.3, size: 3 });
    },
  },

  /**
   * COMPANION — a drone that follows you and shoots.
   * Turret's opposite: the damage travels with you, so it asks nothing of
   * your positioning and instead gives up the turret's ability to cover an
   * area you have abandoned.
   */
  companion: {
    baseId: 'companion', id: 'companion', name: 'Drift Drone', archetype: 'Summoned companion',
    blurb: 'A salvaged drone tags along and picks its own targets.',
    color: '#8ff0ff', target: 'self', projKind: 'bolt',
    base: {
      damage: 7, cooldown: 9, range: 300, projectileSpeed: 620,
      duration: 14, fireRate: 0.5, count: 1, pierce: 0, knockback: 40,
    },
    fire(state, weapon) {
      const p = state.player;
      const life = weapon.stats.get('duration') * state.stats.get('duration');
      addDeployable(state, {
        kind: 'companion', weapon: weapon.id, weaponRef: weapon,
        x: p.x, y: p.y, life, maxLife: life,
        cooldown: 0, fireRate: weapon.stats.get('fireRate'),
        range: weapon.stats.get('range'), cap: 3,
        color: weapon.def.color, orbit: rng.angle(), orbitR: 46,
      });
      spawnParticles(state, p.x, p.y, 12, { color: weapon.def.color, speed: 140, life: 0.35, size: 3 });
    },
  },

  /**
   * MINE — proximity charges left on the ground.
   * The one base that asks you to predict where enemies will be rather than
   * react to where they are; laying them behind you while retreating is the
   * whole technique.
   */
  mine: {
    baseId: 'mine', id: 'mine', name: 'Rift Charge', archetype: 'Proximity mine',
    blurb: 'Leaves armed charges that go off when something walks too close.',
    color: '#ff5a3c', target: 'self', projKind: 'orb',
    base: {
      damage: 42, cooldown: 2.4, radius: 78, duration: 12,
      trigger: 40, count: 1, pierce: 0, knockback: 220,
    },
    fire(state, weapon) {
      const p = state.player;
      const life = weapon.stats.get('duration') * state.stats.get('duration');
      const n = wstat(state, weapon, 'count');
      for (let i = 0; i < n; i++) {
        const a = rng.angle();
        const d = n === 1 ? 0 : rng.range(10, 40);
        addDeployable(state, {
          kind: 'mine', weapon: weapon.id, weaponRef: weapon,
          x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d,
          life, maxLife: life, cap: 10,
          trigger: weapon.stats.get('trigger'),
          radius: weapon.stats.get('radius') * state.stats.get('area'),
          damage: wstat(state, weapon, 'damage'),
          knockback: wstat(state, weapon, 'knockback'),
          color: weapon.def.color, armTime: 0.35,
        });
      }
    },
  },

  /**
   * BOOMERANG — a shot that comes back through everything it already passed.
   * Damage is doubled along one line rather than spread over an area, so it
   * wants a crowd strung out along a lane, not clustered.
   */
  boomerang: {
    baseId: 'boomerang', id: 'boomerang', name: 'Recursor', archetype: 'Returning shot',
    blurb: 'A shard that stops, turns, and comes back through the same lane.',
    color: '#b8ff5e', target: 'nearest', projKind: 'shard',
    base: {
      damage: 15, cooldown: 1.0, range: 420, projectileSpeed: 460,
      count: 1, pierce: 99, knockback: 70, outTime: 0.42,
    },
    fire(state, weapon, target) {
      const p = state.player;
      const count = wstat(state, weapon, 'count');
      const baseAngle = Math.atan2(target.y - p.y, target.x - p.x);
      const spread = 0.3;
      const start = -spread * (count - 1) / 2;
      for (let i = 0; i < count; i++) {
        shoot(state, weapon, baseAngle + start + spread * i, {
          kind: 'boomerang', radius: 7, life: weapon.stats.get('outTime') * 2.4,
          extra: {
            returning: false,
            outTimer: weapon.stats.get('outTime'),
            // Cleared on the turn so the return leg can hit the same enemies
            // again — that second pass is the entire reason to use this.
            spin: 0,
          },
        });
      }
    },
  },

  /**
   * RAIL — a hitscan-fast shot that refuses to stop.
   * Distinct from Beam: Beam is instant and resolves front-to-back in one
   * frame; Rail is a real travelling projectile with unlimited pierce, so it
   * keeps threatening the lane behind its first target for a full second.
   */
  rail: {
    baseId: 'rail', id: 'rail', name: 'Railpike', archetype: 'Wall-piercing shot',
    blurb: 'A shot that does not stop for anything it hits.',
    color: '#c9d6ff', target: 'nearest', projKind: 'bolt',
    base: {
      damage: 22, cooldown: 1.15, range: 700, projectileSpeed: 1500,
      count: 1, pierce: 999, knockback: 40,
    },
    fire(state, weapon, target) {
      const p = state.player;
      const count = wstat(state, weapon, 'count');
      const a = Math.atan2(target.y - p.y, target.x - p.x);
      const spread = 0.09;
      const start = -spread * (count - 1) / 2;
      for (let i = 0; i < count; i++) {
        shoot(state, weapon, a + start + spread * i, {
          radius: 6, life: 1.1, pierce: 999,
        });
      }
      spawnParticles(state, p.x + Math.cos(a) * 16, p.y + Math.sin(a) * 16, 6, {
        color: '#ffffff', speed: 200, life: 0.14, size: 2.5, angle: a, spread: 0.35,
      });
    },
  },

  /**
   * RICOCHET — bounces off the arena walls instead of expiring on them.
   * Turns the arena edge from a dead boundary into a surface you can use,
   * which is the only base that makes fighting *in a corner* correct.
   */
  ricochet: {
    baseId: 'ricochet', id: 'ricochet', name: 'Caroms', archetype: 'Bouncing shot',
    blurb: 'Shards that keep going, off the walls, until they run out.',
    color: '#5ee7ff', target: 'nearest', projKind: 'orb',
    base: {
      damage: 13, cooldown: 0.8, range: 460, projectileSpeed: 520,
      count: 2, pierce: 0, knockback: 80, bounces: 4,
    },
    fire(state, weapon, target) {
      const p = state.player;
      const count = wstat(state, weapon, 'count');
      const baseAngle = Math.atan2(target.y - p.y, target.x - p.x);
      const spread = 0.5;
      const start = -spread * (count - 1) / 2;
      for (let i = 0; i < count; i++) {
        shoot(state, weapon, baseAngle + start + spread * i, {
          kind: 'ricochet', radius: 6, life: 3.4,
          extra: { bounces: Math.round(weapon.stats.get('bounces')) },
        });
      }
    },
  },

  /**
   * SEEDER — a shot that plants itself and detonates on a fuse.
   * The delay is the mechanic: it does nothing where it lands *now*, so it is
   * only good if you can read where the crowd is heading.
   */
  seeder: {
    baseId: 'seeder', id: 'seeder', name: 'Fuse Shard', archetype: 'Delayed detonation',
    blurb: 'Sticks where it lands, then goes off a moment later.',
    color: '#ff9f4d', target: 'nearest', projKind: 'orb',
    base: {
      damage: 46, cooldown: 1.9, range: 480, projectileSpeed: 430,
      radius: 92, fuse: 0.85, count: 1, pierce: 0, knockback: 160,
    },
    fire(state, weapon, target) {
      const p = state.player;
      const count = wstat(state, weapon, 'count');
      const baseAngle = Math.atan2(target.y - p.y, target.x - p.x);
      const spread = 0.35;
      const start = -spread * (count - 1) / 2;
      for (let i = 0; i < count; i++) {
        shoot(state, weapon, baseAngle + start + spread * i, {
          kind: 'seeder', radius: 7, life: 2.6,
          extra: {
            fuse: weapon.stats.get('fuse'),
            blastRadius: weapon.stats.get('radius') * state.stats.get('area'),
            planted: false,
          },
        });
      }
    },
  },

  /**
   * AURA — a constant damaging field centred on you.
   * Requires no targeting and no cooldown management at all; the entire cost
   * is that it only ever damages what is already close enough to be hurting
   * you. Directly at odds with every kiting build.
   */
  aura: {
    baseId: 'aura', id: 'aura', name: 'Bleedfield', archetype: 'Damage aura',
    blurb: 'Leaks Ichor constantly. Anything close enough to touch you is taking it.',
    color: '#b45cff', target: 'self', projKind: 'ring',
    base: { damage: 7, cooldown: 0.45, radius: 118, count: 1, pierce: 0, knockback: 0 },
    fire(state, weapon) {
      const p = state.player;
      const radius = weapon.stats.get('radius') * state.stats.get('area');
      damageCircle(state, weapon, p.x, p.y, radius, wstat(state, weapon, 'damage'));
      addSweep(state, {
        x: p.x, y: p.y, radius, facing: 0, arc: TAU, follow: true,
        life: 0.22, maxLife: 0.22, color: weapon.def.color, ring: true,
      });
    },
  },

  /**
   * LATTICE — a beam that jumps from target to target.
   * Damage scales with how *packed* the crowd is rather than how lined up it
   * is, which is the exact inverse of Beam and Rail.
   */
  lattice: {
    baseId: 'lattice', id: 'lattice', name: 'Arcwork', archetype: 'Chaining bolt',
    blurb: 'A charge that leaps between the Warped until it runs out of leaps.',
    color: '#7ce7ff', target: 'nearest', projKind: 'bolt',
    base: {
      damage: 16, cooldown: 1.1, range: 420, jumps: 4, jumpRange: 190,
      falloff: 0.82, count: 1, pierce: 0, knockback: 30,
    },
    fire(state, weapon, target) {
      const jumps = Math.round(weapon.stats.get('jumps'));
      const jumpRange = weapon.stats.get('jumpRange') * state.stats.get('area');
      const falloff = weapon.stats.get('falloff');
      let damage = wstat(state, weapon, 'damage');
      let current = target;
      const seen = new Set();

      for (let i = 0; i <= jumps && current !== null; i++) {
        seen.add(current);
        const crit = rollCrit(state);
        queuePendingHit(state, {
          enemy: current, damage: critDamage(state, damage, crit), crit, weapon,
        });
        const from = current;
        current = state.enemyGrid.findNearest(from.x, from.y, jumpRange,
          (e) => e.alive && !seen.has(e));
        if (current !== null && state.arcs.length < 40) {
          state.arcs.push({
            x1: from.x, y1: from.y, x2: current.x, y2: current.y,
            life: 0.18, maxLife: 0.18,
          });
        }
        damage *= falloff;
      }
    },
  },

  /**
   * SIPHON — a held beam that ticks while a target stays in range.
   * The only base with no burst at all: it is pure sustained single-target,
   * so it is the answer to an Anomaly and nearly useless against a swarm.
   */
  siphon: {
    baseId: 'siphon', id: 'siphon', name: 'Siphon', archetype: 'Channelled beam',
    blurb: 'Locks on and drains, for as long as you can keep it in range.',
    color: '#ff5ec4', target: 'nearest', projKind: 'ring',
    base: { damage: 5.5, cooldown: 0.12, range: 330, count: 1, pierce: 0, knockback: 0, rampMax: 2.2 },
    fire(state, weapon, target) {
      const p = state.player;
      // Ramps the longer it stays on one target, and resets the moment the
      // lock breaks — that ramp is what makes holding the lock the skill.
      if (weapon.scratch.lock === target) {
        weapon.scratch.ramp = Math.min(weapon.stats.get('rampMax'), (weapon.scratch.ramp ?? 1) + 0.035);
      } else {
        weapon.scratch.lock = target;
        weapon.scratch.ramp = 1;
      }
      const crit = rollCrit(state);
      const dmg = critDamage(state, wstat(state, weapon, 'damage') * weapon.scratch.ramp, crit);
      queuePendingHit(state, { enemy: target, damage: dmg, crit, weapon, silent: true });

      // `resolved: true` because this beam is *visual only* — Siphon already
      // queued its own single-target hit above. Without the flag, updateBeams
      // would run resolveBeam over it and read an undefined `b.damage`,
      // poisoning state.damageDealt with NaN.
      state.beams.push({
        x1: p.x, y1: p.y, x2: target.x, y2: target.y,
        width: 5 + weapon.scratch.ramp * 3, life: 0.12, maxLife: 0.12,
        color: weapon.def.color, resolved: true,
      });
    },
  },

  /**
   * LANCE CHARGE — winds up, then releases a beam scaled by how long it held.
   * A cooldown you can *feel* passing, and the only base where standing still
   * through the wind-up is rewarded rather than punished.
   */
  chargeBeam: {
    baseId: 'chargeBeam', id: 'chargeBeam', name: 'Overcharge', archetype: 'Charge-up beam',
    blurb: 'Builds a charge, then lets it all go at once in a straight line.',
    color: '#fff3b0', target: 'nearest', projKind: 'ring',
    base: {
      damage: 30, cooldown: 2.6, range: 620, width: 30,
      chargeTime: 1.4, chargeBonus: 1.8, count: 1, pierce: 0, knockback: 210,
    },
    init(weapon) { weapon.scratch.charge = 0; },
    tick(state, weapon, dt) {
      // Charge accumulates unconditionally while the weapon waits out its
      // cooldown, and is consumed on fire.
      //
      // It deliberately does NOT gate on `weapon.cooldown <= 0`: the engine
      // reassigns `weapon.cooldown` immediately after every `fire()` returns,
      // so a fire() that tried to defer itself by zeroing the cooldown had
      // that overwritten a line later — the charge could never build past one
      // frame's worth and the weapon never fired at all. Letting the charge
      // run on its own clock and sizing `cooldown` (2.6s) longer than
      // `chargeTime` (1.4s) gets the intended "always fires fully charged"
      // behaviour without fighting the engine over one field.
      weapon.scratch.charge = Math.min(
        weapon.stats.get('chargeTime'), (weapon.scratch.charge ?? 0) + dt);
    },
    fire(state, weapon, target) {
      const p = state.player;
      const chargeTime = weapon.stats.get('chargeTime');
      const frac = Math.min(1, (weapon.scratch.charge ?? 0) / chargeTime);
      weapon.scratch.charge = 0;

      const mult = 1 + (weapon.stats.get('chargeBonus') - 1) * frac;
      const range = weapon.stats.get('range');
      const width = weapon.stats.get('width') * state.stats.get('area');
      const a = Math.atan2(target.y - p.y, target.x - p.x);
      const ex = p.x + Math.cos(a) * range;
      const ey = p.y + Math.sin(a) * range;

      const crit = rollCrit(state);
      const dmg = critDamage(state, wstat(state, weapon, 'damage') * mult, crit);
      const half = width / 2;
      state.enemyGrid.forEachNear((p.x + ex) / 2, (p.y + ey) / 2, range / 2 + width, (e) => {
        if (!e.alive) return;
        // Perpendicular distance from the beam's line segment.
        const vx = ex - p.x, vy = ey - p.y;
        const len2 = vx * vx + vy * vy;
        let t = ((e.x - p.x) * vx + (e.y - p.y) * vy) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const cxp = p.x + vx * t, cyp = p.y + vy * t;
        const dx = e.x - cxp, dy = e.y - cyp;
        const reach = half + e.radius;
        if (dx * dx + dy * dy > reach * reach) return;
        queuePendingHit(state, {
          enemy: e, damage: dmg, crit, weapon,
          kx: Math.cos(a) * wstat(state, weapon, 'knockback') / (e.mass || 1),
          ky: Math.sin(a) * wstat(state, weapon, 'knockback') / (e.mass || 1),
        });
      });

      // Visual only — Overcharge resolved its own swept-rectangle damage
      // above. See the Siphon note for why the flag is load-bearing.
      state.beams.push({
        x1: p.x, y1: p.y, x2: ex, y2: ey,
        width, life: 0.26, maxLife: 0.26, color: weapon.def.color, resolved: true,
      });
      state.addShake(7);
    },
  },

  /**
   * RUPTURE — drops a lingering field on the target's position.
   * Ground-targeted rather than player-centred, so unlike Aura or Trail it
   * threatens somewhere you are not, and unlike Mine it starts working
   * immediately instead of waiting to be triggered.
   */
  rupture: {
    baseId: 'rupture', id: 'rupture', name: 'Rupture', archetype: 'Ground-targeted zone',
    blurb: 'Tears a small rift open under whatever you are looking at.',
    color: '#ff5a7a', target: 'nearest', projKind: 'ring',
    base: {
      damage: 15, cooldown: 2.1, range: 460, radius: 82,
      duration: 3.4, count: 1, pierce: 0, knockback: 0,
    },
    fire(state, weapon, target) {
      const n = wstat(state, weapon, 'count');
      const life = weapon.stats.get('duration') * state.stats.get('duration');
      for (let i = 0; i < n; i++) {
        const a = rng.angle();
        const d = i === 0 ? 0 : rng.range(30, 70);
        addZone(state, {
          weapon: weapon.id, weaponRef: weapon, kind: 'rupture',
          x: target.x + Math.cos(a) * d, y: target.y + Math.sin(a) * d,
          radius: weapon.stats.get('radius') * state.stats.get('area'),
          dps: wstat(state, weapon, 'damage'),
          burn: 0, life, maxLife: life, tick: 0,
          color: weapon.def.color,
        });
      }
      addBlast(state, {
        x: target.x, y: target.y, radius: weapon.stats.get('radius') * 0.7,
        life: 0.2, maxLife: 0.2, color: weapon.def.color,
      });
    },
  },

  /**
   * NOVA — a burst centred on the *target* rather than on you.
   * Pulse's mirror image: same radial shape, opposite positioning demand.
   * Pulse wants the crowd around you; Nova wants it around something else.
   */
  nova: {
    baseId: 'nova', id: 'nova', name: 'Voidburst', archetype: 'Remote burst',
    blurb: 'Collapses a pocket of space where the crowd is thickest.',
    color: '#a97dff', target: 'nearest', projKind: 'ring',
    base: {
      damage: 34, cooldown: 1.7, range: 480, radius: 105,
      count: 1, pierce: 0, knockback: 240,
    },
    fire(state, weapon, target) {
      const radius = weapon.stats.get('radius') * state.stats.get('area');
      damageCircle(state, weapon, target.x, target.y, radius,
        wstat(state, weapon, 'damage'), { knockback: wstat(state, weapon, 'knockback') });
      addBlast(state, {
        x: target.x, y: target.y, radius, life: 0.3, maxLife: 0.3, color: weapon.def.color,
      });
      spawnParticles(state, target.x, target.y, 16, {
        color: weapon.def.color, speed: 240, speedVar: 120, life: 0.35, size: 3.5, drag: 4,
      });
      state.addShake(4);
    },
  },
};

/** Every base type, keyed by base id. Melee motions are declared separately
 *  (weaponMelee.js) but registered into the same map, so nothing downstream
 *  needs to know a weapon is melee to build, fire or draw it. */
export const WEAPON_BASES = { ...MIGRATED, ...NEW_BASES, ...MELEE_BASES };

export const BASE_IDS = Object.keys(WEAPON_BASES);

// ---------------------------------------------------------------------------
// Deployables + sweeps: the two new entity families the new bases introduced.
// ---------------------------------------------------------------------------

/** Turrets, companions and mines. One loop, dispatched on `kind`. */
export function updateDeployables(state, dt) {
  const list = state.deployables;
  const p = state.player;

  for (let i = list.length - 1; i >= 0; i--) {
    const d = list[i];
    d.life -= dt;
    if (d.life <= 0) {
      if (d.kind === 'mine') detonateMine(state, d, false);
      list.splice(i, 1);
      continue;
    }

    if (d.kind === 'turret') {
      d.spin += dt * 2;
      d.cooldown -= dt;
      if (d.cooldown <= 0) {
        const t = nearestTo(state, d.x, d.y, d.range);
        if (t !== null) {
          d.cooldown = d.fireRate / state.stats.get('attackSpeed');
          const a = Math.atan2(t.y - d.y, t.x - d.x);
          shoot(state, d.weaponRef, a, { from: d, offset: 10, radius: 4, life: 1.4 });
        }
      }
    } else if (d.kind === 'companion') {
      // Trails the player on a lazy orbit rather than sticking to them, so it
      // reads as an escort and not as a second player sprite.
      d.orbit += dt * 1.6;
      const tx = p.x + Math.cos(d.orbit) * d.orbitR;
      const ty = p.y + Math.sin(d.orbit) * d.orbitR;
      d.x += (tx - d.x) * Math.min(1, dt * 6);
      d.y += (ty - d.y) * Math.min(1, dt * 6);

      d.cooldown -= dt;
      if (d.cooldown <= 0) {
        const t = nearestTo(state, d.x, d.y, d.range);
        if (t !== null) {
          d.cooldown = d.fireRate / state.stats.get('attackSpeed');
          const a = Math.atan2(t.y - d.y, t.x - d.x);
          shoot(state, d.weaponRef, a, { from: d, offset: 8, radius: 4, life: 1.2 });
        }
      }
    } else if (d.kind === 'mine') {
      if (d.armTime > 0) { d.armTime -= dt; continue; }
      const t = state.enemyGrid.findNearest(d.x, d.y, d.trigger, (e) => e.alive);
      if (t !== null) {
        detonateMine(state, d, true);
        list.splice(i, 1);
      }
    }
  }
}

function detonateMine(state, d, triggered) {
  // An expiring mine still goes off, just for less — a charge that silently
  // vanishes would make the duration stat feel like a punishment.
  const mult = triggered ? 1 : 0.5;
  damageCircle(state, d.weaponRef, d.x, d.y, d.radius, d.damage * mult,
    { knockback: d.knockback });
  addBlast(state, {
    x: d.x, y: d.y, radius: d.radius, life: 0.3, maxLife: 0.3, color: d.color,
  });
  spawnParticles(state, d.x, d.y, triggered ? 18 : 8, {
    color: d.color, speed: 240, speedVar: 130, life: 0.4, size: 3.5, drag: 4,
  });
  if (triggered) state.addShake(6);
}

/** Melee sweep visuals. Damage already resolved when the sweep was created. */
export function updateSweeps(state, dt) {
  const sweeps = state.sweeps;
  const p = state.player;
  for (let i = sweeps.length - 1; i >= 0; i--) {
    const s = sweeps[i];
    s.life -= dt;
    if (s.life <= 0) { removeAt(sweeps, i); continue; }
    // Sweeps anchored to the player track them, so a swing doesn't visibly
    // detach from the Driftwalker mid-animation while you are moving.
    if (s.follow) { s.x = p.x; s.y = p.y; }
  }
}
