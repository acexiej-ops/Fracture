/**
 * weaponDefs.js — the arsenal.
 *
 * A weapon is data plus one or two behaviour hooks:
 *
 *   base    the weapon's own numbers, before the player's global multipliers.
 *           Read them with `wstat(state, weapon, name)`, never directly — that
 *           helper is what folds in the player's stats.
 *   fire()  called when the weapon's cooldown elapses. Most weapons live here.
 *   tick()  called every frame, for weapons with continuous presence (orbit).
 *   target  'nearest' asks the engine for a target and skips firing without
 *           one; 'self' fires regardless of whether anything is in range.
 *
 * The design goal was that no two weapons should want the same positioning.
 * Splinter rewards standing off; Scattergun rewards getting close; Orbit wants
 * you *inside* the crowd; Ember wants you running away in a straight line.
 */

import { rng } from '../core/rng.js';
import { spawnParticles } from './effects.js';
import { TAU } from '../core/math.js';
import { addZone } from './state.js';
import { queuePendingHit, acquireProjectile } from './weaponBases.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Fold the player's global stats into one of a weapon's own numbers. */
export function wstat(state, weapon, name) {
  const base = weapon.stats.get(name);
  const g = state.stats;
  switch (name) {
    case 'damage':          return base * g.get('damage');
    case 'cooldown':        return base / g.get('attackSpeed');
    case 'area':            return base * g.get('area');
    case 'projectileSpeed': return base * g.get('projectileSpeed');
    case 'duration':        return base * g.get('duration');
    case 'knockback':       return base * g.get('knockback');
    case 'count':           return Math.max(1, Math.round(base + g.get('projectileCount')));
    case 'pierce':          return Math.max(0, Math.round(base + g.get('pierce')));
    default:                return base;
  }
}

/** Roll crit once, so a hit's crit state is consistent across its damage. */
export function rollCrit(state) {
  return rng.bool(state.stats.get('critChance'));
}

export function critDamage(state, damage, crit) {
  return crit ? damage * state.stats.get('critMult') : damage;
}

// ---------------------------------------------------------------------------
// The weapons
// ---------------------------------------------------------------------------

export const WEAPONS = {

  /**
   * SPLINTER — the Phase 1 weapon, now the starter.
   * A single fast bolt at the nearest enemy. Reliable, unexciting, scales fine.
   */
  splinter: {
    id: 'splinter',
    name: 'Splinter',
    blurb: 'Fires a fast bolt at the nearest enemy.',
    color: '#8ff0ff',
    target: 'nearest',
    base: {
      damage: 14, cooldown: 0.42, range: 430, projectileSpeed: 700,
      count: 1, pierce: 0, knockback: 95,
    },
    fire(state, weapon, target) {
      const p = state.player;
      const count = wstat(state, weapon, 'count');
      const speed = wstat(state, weapon, 'projectileSpeed');
      const damage = wstat(state, weapon, 'damage');
      const pierce = wstat(state, weapon, 'pierce');
      const knockback = wstat(state, weapon, 'knockback');
      const baseAngle = Math.atan2(target.y - p.y, target.x - p.x);
      const spread = 0.13;
      const start = -spread * (count - 1) / 2;

      for (let i = 0; i < count; i++) {
        const angle = baseAngle + start + spread * i;
        const crit = rollCrit(state);
        state.projectiles.push(acquireProjectile({
          kind: 'bolt', weapon: weapon.id,
          x: p.x + Math.cos(angle) * (p.radius + 4),
          y: p.y + Math.sin(angle) * (p.radius + 4),
          vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
          angle, damage: critDamage(state, damage, crit), crit,
          pierce, knockback, radius: 5, life: 2.2, color: '#8ff0ff',
          hit: new Set(),
        }));
      }
      spawnParticles(state, p.x + Math.cos(baseAngle) * 14, p.y + Math.sin(baseAngle) * 14, 3, {
        color: '#ffe9a8', speed: 90, life: 0.12, size: 2.5, angle: baseAngle, spread: 0.9,
      });
    },
  },

  /**
   * SCATTERGUN — a wide cone of short-lived pellets.
   * Enormous close-range burst that evaporates at distance, because the pellets
   * expire before they arrive. Wants you shoulder-deep in the crowd.
   */
  scattergun: {
    id: 'scattergun',
    name: 'Scattergun',
    blurb: 'A wide cone of pellets. Devastating up close, useless at range.',
    color: '#ffb703',
    target: 'nearest',
    base: {
      damage: 9, cooldown: 0.85, range: 300, projectileSpeed: 620,
      count: 7, pierce: 0, knockback: 130, spread: 0.85, life: 0.42,
    },
    fire(state, weapon, target) {
      const p = state.player;
      const count = wstat(state, weapon, 'count');
      const speed = wstat(state, weapon, 'projectileSpeed');
      const damage = wstat(state, weapon, 'damage');
      const pierce = wstat(state, weapon, 'pierce');
      const knockback = wstat(state, weapon, 'knockback');
      const spread = weapon.stats.get('spread');
      const life = weapon.stats.get('life') * state.stats.get('duration');
      const baseAngle = Math.atan2(target.y - p.y, target.x - p.x);

      for (let i = 0; i < count; i++) {
        // Jittered rather than evenly fanned: a ragged cone reads as a shotgun.
        const angle = baseAngle + rng.range(-spread / 2, spread / 2);
        const crit = rollCrit(state);
        const v = speed * rng.range(0.82, 1.18);
        state.projectiles.push(acquireProjectile({
          kind: 'pellet', weapon: weapon.id,
          x: p.x + Math.cos(angle) * (p.radius + 2),
          y: p.y + Math.sin(angle) * (p.radius + 2),
          vx: Math.cos(angle) * v, vy: Math.sin(angle) * v,
          angle, damage: critDamage(state, damage, crit), crit,
          pierce, knockback, radius: 4, life, color: '#ffb703',
          hit: new Set(),
        }));
      }
      state.addShake(2.5);
      spawnParticles(state, p.x + Math.cos(baseAngle) * 16, p.y + Math.sin(baseAngle) * 16, 8, {
        color: '#ffd166', speed: 150, life: 0.16, size: 3, angle: baseAngle, spread: 1.1,
      });
    },
  },

  /**
   * LANCE — an instant hitscan beam that pierces everything in a line.
   * Long cooldown, so it's about lining shots up rather than spraying. The
   * Overcharge upgrade makes each successive enemy in the line take more, which
   * turns "get them in a row" into an actual objective.
   */
  lance: {
    id: 'lance',
    name: 'Lance',
    blurb: 'A piercing beam that strikes everything in a line.',
    color: '#b45cff',
    target: 'nearest',
    base: {
      damage: 26, cooldown: 1.5, range: 620, width: 13, count: 1,
      knockback: 40, rampPerHit: 0, life: 0.22,
    },
    fire(state, weapon, target) {
      const p = state.player;
      const angle = Math.atan2(target.y - p.y, target.x - p.x);
      const range = weapon.stats.get('range');
      const width = weapon.stats.get('width') * state.stats.get('area');
      const beams = wstat(state, weapon, 'count');
      const life = weapon.stats.get('life');

      // Extra beams fan out rather than stacking on the same line.
      const fan = 0.22;
      const start = -fan * (beams - 1) / 2;

      for (let i = 0; i < beams; i++) {
        const a = angle + start + fan * i;
        state.beams.push({
          weapon: weapon.id,
          x1: p.x, y1: p.y,
          x2: p.x + Math.cos(a) * range,
          y2: p.y + Math.sin(a) * range,
          width,
          damage: wstat(state, weapon, 'damage'),
          rampPerHit: weapon.stats.get('rampPerHit'),
          knockback: wstat(state, weapon, 'knockback'),
          crit: rollCrit(state),
          life, maxLife: life,
          resolved: false,
          color: '#c98cff',
        });
      }
      state.addShake(3);
    },
  },

  /**
   * ORBIT — blades that circle the player continuously.
   * No cooldown and no targeting: it is pure positioning. Standing still does
   * nothing; carving through a crowd shreds. Each blade tracks a per-enemy
   * re-hit timer so it can't machine-gun a single target.
   */
  orbit: {
    id: 'orbit',
    name: 'Warden Blades',
    blurb: 'Blades circle you, cutting anything they sweep through.',
    color: '#7dffa8',
    target: 'self',
    continuous: true,
    base: {
      damage: 11, cooldown: 0, count: 2, radius: 92, spinRate: 2.6,
      knockback: 70, rehit: 0.45, bladeSize: 11, pull: 0,
    },
    init(weapon) {
      weapon.scratch.angle = 0;
      weapon.scratch.hitTimers = new Map();   // enemy -> seconds until re-hittable
    },
    tick(state, weapon, dt) {
      const p = state.player;
      const count = wstat(state, weapon, 'count');
      const radius = weapon.stats.get('radius') * state.stats.get('area');
      const damage = wstat(state, weapon, 'damage');
      const knockback = wstat(state, weapon, 'knockback');
      const rehit = weapon.stats.get('rehit');
      const bladeSize = weapon.stats.get('bladeSize') * Math.sqrt(state.stats.get('area'));
      const pull = weapon.stats.get('pull');

      weapon.scratch.angle = (weapon.scratch.angle + weapon.stats.get('spinRate') * dt) % TAU;

      // Vortex is a *field*, not an on-hit nudge. Applying it only when a blade
      // connected meant it fired at most once per enemy per re-hit window, which
      // was far too sparse to visibly clump anything. As a continuous inward
      // acceleration it fights the enemy's own steering to a steady drift.
      if (pull > 0) {
        const reach = radius * 1.8;
        state.enemyGrid.forEachNear(p.x, p.y, reach, (e) => {
          if (!e.alive) return;
          const dx = p.x - e.x, dy = p.y - e.y;
          const d = Math.hypot(dx, dy);
          if (d > reach || d < 1) return;
          e.vx += (dx / d) * pull * dt;
          e.vy += (dy / d) * pull * dt;
        });
      }

      // Tick down per-enemy re-hit timers, dropping expired and dead entries so
      // the Map can't grow unbounded across a long run.
      const timers = weapon.scratch.hitTimers;
      for (const [enemy, t] of timers) {
        const next = t - dt;
        if (next <= 0 || !enemy.alive) timers.delete(enemy);
        else timers.set(enemy, next);
      }

      for (let i = 0; i < count; i++) {
        const a = weapon.scratch.angle + (TAU / count) * i;
        const bx = p.x + Math.cos(a) * radius;
        const by = p.y + Math.sin(a) * radius;

        state.enemyGrid.forEachNear(bx, by, bladeSize + 26, (e) => {
          if (!e.alive || timers.has(e)) return;
          const dx = e.x - bx, dy = e.y - by;
          const reach = bladeSize + e.radius;
          if (dx * dx + dy * dy > reach * reach) return;

          timers.set(e, rehit);
          const crit = rollCrit(state);
          // Knock along the blade's travel rather than away from the player, so
          // blades sling enemies around you instead of shoving them out of reach.
          const tangent = a + Math.PI / 2;
          queuePendingHit(state, {
            enemy: e,
            damage: critDamage(state, damage, crit),
            crit,
            kx: Math.cos(tangent) * knockback,
            ky: Math.sin(tangent) * knockback,
          });

        });
      }
    },
  },

  /**
   * QUAKE — a shockwave ring that expands out from the player.
   * Fires on a timer with no target needed, so it's the one weapon that keeps
   * working while you're running for your life. Hits each enemy once as the
   * ring sweeps past, and shoves everything outward.
   */
  quake: {
    id: 'quake',
    name: 'Quake',
    blurb: 'A shockwave bursts outward from you, flinging enemies back.',
    color: '#ff8a3d',
    target: 'self',
    base: {
      damage: 12, cooldown: 3.2, radius: 150, knockback: 300,
      expandTime: 0.34, leavesFissure: 0, fissureDps: 0,
    },
    fire(state, weapon) {
      const p = state.player;
      const radius = weapon.stats.get('radius') * state.stats.get('area');
      state.shockwaves.push({
        weapon: weapon.id,
        x: p.x, y: p.y,
        radius: 10,
        maxRadius: radius,
        damage: wstat(state, weapon, 'damage'),
        knockback: wstat(state, weapon, 'knockback'),
        crit: rollCrit(state),
        expandTime: weapon.stats.get('expandTime'),
        life: weapon.stats.get('expandTime'),
        hit: new Set(),
        color: '#ff8a3d',
      });

      // Fissure: the slam cracks the ground, leaving burning zones behind.
      const fissures = weapon.stats.get('leavesFissure');
      if (fissures > 0) {
        const dps = weapon.stats.get('fissureDps') * state.stats.get('damage');
        for (let i = 0; i < fissures; i++) {
          const a = rng.angle();
          const d = rng.range(radius * 0.3, radius * 0.85);
          addZone(state, {
            weapon: weapon.id, kind: 'fissure',
            x: p.x + Math.cos(a) * d,
            y: p.y + Math.sin(a) * d,
            radius: 48 * state.stats.get('area'),
            dps,
            life: 3.5 * state.stats.get('duration'),
            maxLife: 3.5 * state.stats.get('duration'),
            tick: 0, burn: 0,
            color: '#ff8a3d',
          });
        }
      }

      state.addShake(6);
      spawnParticles(state, p.x, p.y, 16, {
        color: '#ffb703', speed: 260, speedVar: 140, life: 0.4, size: 3.5, drag: 5,
      });
    },
  },

  /**
   * SEEKER — slow homing projectiles that curve into whatever is nearest.
   * Low direct damage; its job is applying Mark, which makes everything else
   * you own hit harder. The one weapon that's better in a build than alone.
   */
  seeker: {
    id: 'seeker',
    name: 'Seeker',
    blurb: 'Slow homing shards that chase enemies down.',
    color: '#ff5ec4',
    target: 'nearest',
    base: {
      damage: 19, cooldown: 1.1, range: 520, projectileSpeed: 250,
      count: 2, pierce: 0, knockback: 55, turnRate: 5.2,
      marks: 0, markRadius: 0,
    },
    fire(state, weapon, target) {
      const p = state.player;
      const count = wstat(state, weapon, 'count');
      const speed = wstat(state, weapon, 'projectileSpeed');
      const damage = wstat(state, weapon, 'damage');

      for (let i = 0; i < count; i++) {
        // Launch on a spread so they arc apart before homing in — a tight
        // stack of seekers all hitting one enemy looks like a bug.
        const angle = Math.atan2(target.y - p.y, target.x - p.x) + rng.range(-0.9, 0.9);
        const crit = rollCrit(state);
        state.projectiles.push(acquireProjectile({
          kind: 'seeker', weapon: weapon.id,
          x: p.x, y: p.y,
          vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
          angle,
          damage: critDamage(state, damage, crit), crit,
          pierce: wstat(state, weapon, 'pierce'),
          knockback: wstat(state, weapon, 'knockback'),
          radius: 6, life: 3.2 * state.stats.get('duration'),
          color: '#ff5ec4',
          speed,
          turnRate: weapon.stats.get('turnRate'),
          marks: weapon.stats.get('marks'),
          markRadius: weapon.stats.get('markRadius') * state.stats.get('area'),
          target: null,
          hit: new Set(),
        }));
      }
    },
  },

  /**
   * EMBER — drops a burning zone at the player's feet on a timer.
   * Deals no damage where you are, only where you *were*, so it rewards
   * constantly moving and laying a trail the crowd has to walk through.
   */
  ember: {
    id: 'ember',
    name: 'Ember Trail',
    blurb: 'Leaves burning ground behind you. Damage over time.',
    color: '#ff5a3c',
    target: 'self',
    base: {
      damage: 0, cooldown: 1.2, dps: 9, radius: 48, zoneLife: 2.8,
      burn: 1.4, count: 1,
    },
    fire(state, weapon) {
      const p = state.player;
      const life = weapon.stats.get('zoneLife') * state.stats.get('duration');
      const count = wstat(state, weapon, 'count');

      for (let i = 0; i < count; i++) {
        // Drop slightly behind the player so the trail lays down properly
        // instead of always igniting under their feet.
        const back = Math.hypot(p.vx, p.vy) > 20
          ? Math.atan2(-p.vy, -p.vx)
          : rng.angle();
        const d = count === 1 ? 0 : rng.range(0, 34);
        addZone(state, {
          weapon: weapon.id, kind: 'ember',
          x: p.x + Math.cos(back) * d,
          y: p.y + Math.sin(back) * d,
          radius: weapon.stats.get('radius') * state.stats.get('area'),
          dps: weapon.stats.get('dps') * state.stats.get('damage'),
          burn: weapon.stats.get('burn'),
          life, maxLife: life,
          tick: 0,
          color: '#ff5a3c',
        });
      }
    },
  },
};

/** Every weapon except the starter, for the "acquire a weapon" upgrade nodes. */
export const ACQUIRABLE = Object.keys(WEAPONS).filter((id) => id !== 'splinter');
