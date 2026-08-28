/**
 * weaponMods.js — the 20 modifiers a base type can be built with.
 *
 * Where a base type is the *verb* of a weapon, a modifier is the *adverb*: it
 * does not change how damage is delivered through space, only what happens
 * along the way. That split is what makes the combinatorics tractable — 21
 * bases x 20 modifiers is a roster nobody has to hand-author, precisely
 * because the two axes never need to know about each other.
 *
 * A modifier is three optional things:
 *
 *   stats   flat/multiplicative adjustments folded into the weapon's own Stats
 *           stack at build time. Cheapest kind; no runtime cost at all.
 *   hooks   onFire / onHit / onKill, called by the engine at the three moments
 *           a weapon can be observed doing something.
 *   tags    what the generator uses for naming and for refusing nonsense
 *           combinations (see `isValidCombo`).
 *
 * The single most important design constraint here: **onHit fires from
 * `flushPendingHits`**, the one chokepoint every player-sourced hit in the
 * game already passes through. That is why a modifier works identically on a
 * bolt, a beam, a mine blast and a turret shot without any of them knowing
 * modifiers exist.
 */

import { rng } from '../core/rng.js';
import { spawnParticles } from './effects.js';
import { addZone, addBlast } from './state.js';
import { applyBurn, applySlow } from './enemies.js';
import { healPlayer } from './player.js';
import { TAU } from '../core/math.js';
import { queuePendingHit, acquireProjectile } from './weaponBases.js';

/** Roll a chance that scales with nothing — modifiers are flat by design, so
 *  that a build's power comes from *which* it stacks, not from stat inflation. */
const chance = (c) => rng.next() < c;

export const WEAPON_MODS = {

  // --- Output-shape modifiers -------------------------------------------

  multishot: {
    id: 'multishot', name: 'Splintered', prefix: 'Splintered',
    blurb: 'Fires an additional projectile.',
    tags: ['projectile'],
    stats: { count: { flat: 1 }, damage: { mult: 0.82 } },
  },

  broad: {
    id: 'broad', name: 'Broad', prefix: 'Broad',
    blurb: 'Everything it makes is larger.',
    tags: ['any'],
    stats: { radius: { mult: 1.35 }, arc: { mult: 1.25 }, width: { mult: 1.3 }, damage: { mult: 0.93 } },
  },

  pierce: {
    id: 'pierce', name: 'Perforating', prefix: 'Perforating',
    blurb: 'Shots pass through two more of the Warped.',
    tags: ['projectile'],
    stats: { pierce: { flat: 2 } },
  },

  rapid: {
    id: 'rapid', name: 'Rapid', prefix: 'Rapid',
    blurb: 'Noticeably shorter cooldown.',
    tags: ['any'],
    stats: { cooldown: { mult: 0.72 }, damage: { mult: 0.86 } },
  },

  keen: {
    id: 'keen', name: 'Keen', prefix: 'Keen',
    blurb: 'Far more likely to land a critical hit.',
    tags: ['any'],
    // Crit is rolled globally per hit, so this modifier grants its bonus by
    // pushing a modifier onto the *player's* stack for as long as the weapon
    // is held, rather than trying to intercept every roll.
    playerStats: { critChance: { flat: 0.12 } },
  },

  force: {
    id: 'force', name: 'Concussive', prefix: 'Concussive',
    blurb: 'Hits throw the Warped back hard.',
    tags: ['any'],
    stats: { knockback: { mult: 2.2 } },
  },

  // --- On-hit status modifiers ------------------------------------------

  frost: {
    id: 'frost', name: 'Rimed', prefix: 'Rimed',
    blurb: 'Hits chill the Warped, slowing them.',
    tags: ['any'], element: '#7ce7ff',
    onHit(state, weapon, enemy) {
      if (chance(0.5)) applySlow(enemy, 0.55, 1.6);
    },
  },

  burn: {
    id: 'burn', name: 'Smouldering', prefix: 'Smouldering',
    blurb: 'Hits set the Warped alight.',
    tags: ['any'], element: '#ff8a3d',
    onHit(state, weapon, enemy) {
      if (chance(0.45)) applyBurn(enemy, 7 * state.stats.get('damage'), 2.2);
    },
  },

  venom: {
    id: 'venom', name: 'Septic', prefix: 'Septic',
    blurb: 'A slow poison that stacks its duration rather than its bite.',
    tags: ['any'], element: '#b8ff5e',
    onHit(state, weapon, enemy) {
      // Deliberately weaker per tick than Smouldering but much longer, so the
      // two read as different answers rather than the same effect twice: burn
      // is for things you want dead now, venom is for things that are going
      // to be chasing you for a while.
      if (chance(0.55)) applyBurn(enemy, 3.2 * state.stats.get('damage'), 5.5);
    },
  },

  shred: {
    id: 'shred', name: 'Rending', prefix: 'Rending',
    blurb: 'Strips armour, so everything after hits harder.',
    tags: ['any'],
    onHit(state, weapon, enemy) {
      // Caps at 0.35 — enough to fully strip a Warped Bulwark's mitigation,
      // never enough to invert it into bonus damage.
      enemy.armorShred = Math.min(0.35, (enemy.armorShred ?? 0) + 0.06);
      enemy.armorShredTime = 4;
    },
  },

  leech: {
    id: 'leech', name: 'Leeching', prefix: 'Leeching',
    blurb: 'A little of what it takes comes back to you.',
    tags: ['any'],
    onHit(state, weapon, enemy) {
      if (chance(0.14)) healPlayer(state, 1.5);
    },
  },

  surge: {
    id: 'surge', name: 'Surging', prefix: 'Surging',
    blurb: 'Landing a hit briefly quickens your step.',
    tags: ['any'],
    onHit(state) {
      // A short refreshing buff rather than a stacking one: the point is that
      // *staying in the fight* keeps you fast, which cuts against turtling.
      state.player.surgeTime = 1.2;
    },
  },

  // --- On-hit spread modifiers ------------------------------------------

  explosive: {
    id: 'explosive', name: 'Volatile', prefix: 'Volatile',
    blurb: 'Impacts detonate.',
    tags: ['any'], element: '#ffca6b',
    onHit(state, weapon, enemy, hit) {
      if (hit.fromMod === 'explosive') return;   // no self-chaining
      const radius = 58 * state.stats.get('area');
      const dmg = hit.damage * 0.42;
      addBlast(state, {
        x: enemy.x, y: enemy.y, radius, life: 0.24, maxLife: 0.24, color: '#ffca6b',
      });
      state.enemyGrid.forEachNear(enemy.x, enemy.y, radius + 30, (o) => {
        if (!o.alive || o === enemy) return;
        const dx = o.x - enemy.x, dy = o.y - enemy.y;
        const reach = radius + o.radius;
        if (dx * dx + dy * dy > reach * reach) return;
        queuePendingHit(state, {
          enemy: o, damage: dmg, crit: false, weapon, fromMod: 'explosive',
        });
      });
    },
  },

  chain: {
    id: 'chain', name: 'Arcing', prefix: 'Arcing',
    blurb: 'Hits leap to a nearby Warped.',
    tags: ['any'], element: '#7ce7ff',
    onHit(state, weapon, enemy, hit) {
      if (hit.fromMod === 'chain') return;
      if (!chance(0.35)) return;
      const t = state.enemyGrid.findNearest(enemy.x, enemy.y, 165, (e) => e.alive && e !== enemy);
      if (t === null) return;
      queuePendingHit(state, {
        enemy: t, damage: hit.damage * 0.5, crit: false, weapon, fromMod: 'chain',
      });
      if (state.arcs.length < 40) {
        state.arcs.push({
          x1: enemy.x, y1: enemy.y, x2: t.x, y2: t.y, life: 0.15, maxLife: 0.15,
        });
      }
    },
  },

  split: {
    id: 'split', name: 'Fracturing', prefix: 'Fracturing',
    blurb: 'Impacts throw off fragments.',
    tags: ['projectile'], element: '#c9d6ff',
    onHit(state, weapon, enemy, hit) {
      if (hit.fromMod !== undefined) return;
      if (!chance(0.4)) return;
      const base = rng.angle();
      for (let i = 0; i < 3; i++) {
        const a = base + (i / 3) * TAU;
        state.projectiles.push(acquireProjectile({
          kind: 'bolt', weapon: weapon.id, weaponRef: weapon,
          x: enemy.x, y: enemy.y,
          vx: Math.cos(a) * 380, vy: Math.sin(a) * 380,
          angle: a, damage: hit.damage * 0.3, crit: false,
          pierce: 0, knockback: 20, radius: 4, life: 0.5,
          color: '#c9d6ff', hit: new Set(enemy ? [enemy] : []),
          marks: 0, markRadius: 0, fromMod: 'split',
        }));
      }
    },
  },

  homing: {
    id: 'homing', name: 'Seeking', prefix: 'Seeking',
    blurb: 'Its shots correct toward the Warped.',
    tags: ['projectile'],
    // Handled at spawn time rather than on hit: the generator flips fired
    // projectiles to the 'seeker' kind, which the engine already steers.
    projectileKind: 'seeker',
    stats: { projectileSpeed: { mult: 0.8 } },
  },

  bloom: {
    id: 'bloom', name: 'Blooming', prefix: 'Blooming',
    blurb: 'The Warped it kills come apart violently.',
    tags: ['any'], element: '#ff5ec4',
    onKill(state, weapon, enemy) {
      const radius = 70 * state.stats.get('area');
      const dmg = 14 * state.stats.get('damage') + enemy.maxHp * 0.12;
      addBlast(state, {
        x: enemy.x, y: enemy.y, radius, life: 0.26, maxLife: 0.26, color: '#ff5ec4',
      });
      state.enemyGrid.forEachNear(enemy.x, enemy.y, radius + 30, (o) => {
        if (!o.alive || o === enemy) return;
        const dx = o.x - enemy.x, dy = o.y - enemy.y;
        const reach = radius + o.radius;
        if (dx * dx + dy * dy > reach * reach) return;
        queuePendingHit(state, {
          enemy: o, damage: dmg, crit: false, weapon, fromMod: 'bloom',
        });
      });
    },
  },

  // --- On-cast modifiers -------------------------------------------------

  echo: {
    id: 'echo', name: 'Echoing', prefix: 'Echoing',
    blurb: 'Sometimes fires a second time for free.',
    tags: ['any'],
    onFire(state, weapon, target) {
      if (weapon.scratch._echoing === true) return;   // never recurse
      if (!chance(0.25)) return;
      weapon.scratch._echoing = true;
      try {
        // Re-enter the base's own fire. Guarded by the flag above so an Echo
        // can never trigger an Echo, which would be an unbounded chain.
        weapon.def.baseFire(state, weapon, target);
      } finally {
        weapon.scratch._echoing = false;
      }
    },
  },

  bulwark: {
    id: 'bulwark', name: 'Warding', prefix: 'Warding',
    blurb: 'Each cast layers a little shielding over you.',
    tags: ['any'],
    onFire(state) {
      // Shield is a small pool that refills on cast and decays on its own, so
      // a slow heavy weapon and a fast light one end up with similar uptime.
      const max = 18 + state.stats.get('maxHp') * 0.05;
      state.player.shield = Math.min(max, (state.player.shield ?? 0) + max * 0.34);
      state.player.shieldMax = max;
    },
  },

  chaos: {
    id: 'chaos', name: 'Unstable', prefix: 'Unstable',
    blurb: 'Every hit rolls a different element.',
    tags: ['any'], element: '#ff5ec4',
    onHit(state, weapon, enemy, hit) {
      if (hit.fromMod !== undefined) return;
      const roll = rng.int(0, 3);
      if (roll === 0) applyBurn(enemy, 6 * state.stats.get('damage'), 2);
      else if (roll === 1) applySlow(enemy, 0.55, 1.4);
      else if (roll === 2) {
        const t = state.enemyGrid.findNearest(enemy.x, enemy.y, 150, (e) => e.alive && e !== enemy);
        if (t !== null) {
          queuePendingHit(state, {
            enemy: t, damage: hit.damage * 0.4, crit: false, weapon, fromMod: 'chaos',
          });
        }
      } else {
        addBlast(state, {
          x: enemy.x, y: enemy.y, radius: 46 * state.stats.get('area'),
          life: 0.2, maxLife: 0.2, color: '#ff5ec4',
        });
      }
      spawnParticles(state, enemy.x, enemy.y, 4, {
        color: ['#ff8a3d', '#7ce7ff', '#b8ff5e', '#ff5ec4'][roll],
        speed: 130, life: 0.22, size: 2.5,
      });
    },
  },

  lingering: {
    id: 'lingering', name: 'Lingering', prefix: 'Lingering',
    blurb: 'Leaves a caustic pool wherever it connects.',
    tags: ['any'], element: '#b45cff',
    onHit(state, weapon, enemy, hit) {
      if (hit.fromMod !== undefined) return;
      if (!chance(0.22)) return;
      const life = 2.4 * state.stats.get('duration');
      addZone(state, {
        weapon: weapon.id, weaponRef: weapon, kind: 'lingering',
        x: enemy.x, y: enemy.y,
        radius: 42 * state.stats.get('area'),
        dps: 9 * state.stats.get('damage'),
        burn: 0, life, maxLife: life, tick: 0,
        color: '#b45cff',
      });
    },
  },
};

export const MOD_IDS = Object.keys(WEAPON_MODS);

/**
 * Which modifiers make sense on which bases.
 *
 * A modifier tagged `projectile` needs actual travelling projectiles to act
 * on — `Perforating Bleedfield` would be a weapon whose defining trait does
 * literally nothing, which is worse than a weak combination because it reads
 * as a bug. Everything tagged `any` is universally valid.
 */
// NOTE: these are the *base ids*, which for the seven migrated weapons are
// their original names (`splinter`, `scattergun`, `seeker`) — not the generic
// behaviour words. Getting this list wrong fails silently and invisibly: an
// invalid combo is filtered out by `buildWeapon`, so the weapon still builds,
// just without the modifier that was supposed to define it.
const PROJECTILE_BASES = new Set([
  'splinter', 'scattergun', 'seeker',
  'boomerang', 'rail', 'ricochet', 'seeder', 'turret', 'companion',
]);

export function isValidCombo(baseId, modId) {
  const mod = WEAPON_MODS[modId];
  if (mod === undefined) return false;
  if (mod.tags.includes('any')) return true;
  if (mod.tags.includes('projectile')) return PROJECTILE_BASES.has(baseId);
  return true;
}

/** Every modifier legal on a given base. */
export function modsFor(baseId) {
  return MOD_IDS.filter((m) => isValidCombo(baseId, m));
}
