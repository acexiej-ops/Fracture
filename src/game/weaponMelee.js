/**
 * weaponMelee.js — close-range weapon behaviours.
 *
 * WHY MELEE NEEDED ITS OWN FILE AND ITS OWN ENTITY
 * ------------------------------------------------
 * The first pass at melee (the old `cleave` / `whip`) resolved damage in an
 * arc and drew a static filled wedge for 0.16s. That is a hitbox with a
 * decoration on it, and it read as one: the wedge appeared fully formed,
 * never moved, and vanished. Nothing about it looked like a swing.
 *
 * A swing is a *motion*. What sells it is the blade travelling through the arc
 * over several frames, with a trail behind it that fades from where it started.
 * So a melee attack here is a real entity with a `progress` value that the
 * renderer reads to place the blade and draw the trail — the same data the
 * damage pass already used, now with a clock attached.
 *
 * Damage still resolves on frame one, deliberately. Sweeping the hitbox along
 * with the visual would mean an enemy standing at the end of the arc takes the
 * hit ~100ms after you pressed nothing (attacks are automatic), which reads as
 * unresponsive. Instant hitbox, animated blade: the hit is honest, the motion
 * is what you watch.
 *
 * FOUR MOTIONS, deliberately distinct in what they ask of your positioning:
 *   swing   a wide arc across your facing — wants a crowd in front of you
 *   thrust  a narrow lunge with reach — wants one target lined up
 *   slam    a full circle centred on you — wants to be surrounded
 *   lash    an extending, cracking whip — wants range you don't have to close
 */

import { rng } from '../core/rng.js';
import { spawnParticles } from './effects.js';
import { TAU } from '../core/math.js';
import { wstat, rollCrit, critDamage, damageArc, damageCircle, addSweep } from './weaponBases.js';

/**
 * Queue a melee visual.
 *
 * `progress` is what the renderer animates on: 0 at the start of the motion,
 * 1 at the end. Everything about how a melee attack *looks* is derived from
 * it, so a new motion type needs no new fields — only a new branch in the
 * renderer that reads progress differently.
 */
function addMelee(state, opts) {
  addSweep(state, {
    melee: true,
    kind: opts.kind,
    x: opts.x, y: opts.y,
    facing: opts.facing,
    radius: opts.radius,
    arc: opts.arc ?? 1.4,
    reach: opts.reach ?? opts.radius,
    life: opts.life, maxLife: opts.life,
    color: opts.color,
    trail: opts.trail ?? '#ffffff',
    follow: opts.follow !== false,
    // Which way the blade travels through the arc. Alternated per swing by the
    // weapon, so repeated attacks read as a real back-and-forth rather than
    // the same animation looping.
    dir: opts.dir ?? 1,
    segments: opts.segments ?? 0,
  });
}

const facingTo = (p, target) => Math.atan2(target.y - p.y, target.x - p.x);

export const MELEE_BASES = {

  /**
   * SWING — a wide blade arc across your facing.
   * The bread-and-butter melee motion: generous angle, moderate reach, and it
   * alternates direction each swing so a sustained fight looks like fighting.
   */
  swing: {
    baseId: 'swing', id: 'swing', name: 'Cleaver', archetype: 'Melee arc',
    blurb: 'A wide blade arc. Everything in front of you, nothing behind.',
    color: '#ff7edb', target: 'nearest', projKind: 'shard', melee: true,
    base: { damage: 30, cooldown: 0.62, range: 128, arc: 1.9, knockback: 210, count: 1, pierce: 0 },
    init(weapon) { weapon.scratch.swingDir = 1; },
    fire(state, weapon, target) {
      const p = state.player;
      const radius = weapon.stats.get('range') * state.stats.get('area');
      const arc = weapon.stats.get('arc');
      const facing = facingTo(p, target);

      damageArc(state, weapon, p.x, p.y, radius, facing, arc / 2,
        wstat(state, weapon, 'damage'), { knockback: wstat(state, weapon, 'knockback') });

      weapon.scratch.swingDir = -(weapon.scratch.swingDir ?? 1);
      addMelee(state, {
        kind: 'swing', x: p.x, y: p.y, facing, radius, arc,
        life: 0.22, color: weapon.def.color, dir: weapon.scratch.swingDir,
      });
      // Sparks thrown along the leading edge, not from the centre — the blade
      // is what is hitting things, so that is where debris should come from.
      const edge = facing + (arc / 2) * weapon.scratch.swingDir;
      spawnParticles(state, p.x + Math.cos(edge) * radius * 0.8, p.y + Math.sin(edge) * radius * 0.8,
        7, { color: weapon.def.color, speed: 210, life: 0.22, size: 3, angle: edge, spread: 1.2 });
    },
  },

  /**
   * THRUST — a narrow, long lunge.
   * Swing's opposite: almost no angle, far more reach. Wants one target lined
   * up rather than a crowd, and it is the only melee motion that meaningfully
   * out-ranges a Warped Caster's approach.
   */
  thrust: {
    baseId: 'thrust', id: 'thrust', name: 'Pike', archetype: 'Melee thrust',
    blurb: 'A long lunge down a single line. Reach instead of coverage.',
    color: '#c9d6ff', target: 'nearest', projKind: 'bolt', melee: true,
    base: { damage: 38, cooldown: 0.72, range: 210, arc: 0.42, knockback: 260, count: 1, pierce: 0 },
    fire(state, weapon, target) {
      const p = state.player;
      const reach = weapon.stats.get('range') * state.stats.get('area');
      const arc = weapon.stats.get('arc');
      const facing = facingTo(p, target);

      damageArc(state, weapon, p.x, p.y, reach, facing, arc / 2,
        wstat(state, weapon, 'damage'), { knockback: wstat(state, weapon, 'knockback') });

      addMelee(state, {
        kind: 'thrust', x: p.x, y: p.y, facing, radius: reach, arc,
        life: 0.18, color: weapon.def.color,
      });
      spawnParticles(state, p.x + Math.cos(facing) * reach, p.y + Math.sin(facing) * reach,
        6, { color: weapon.def.color, speed: 180, life: 0.2, size: 2.5, angle: facing, spread: 0.7 });
    },
  },

  /**
   * SLAM — a full 360 around you.
   * The only melee motion with no facing at all, so it is the one that wants
   * you surrounded rather than pointed at something. Slow and heavy to pay
   * for the coverage.
   */
  slam: {
    baseId: 'slam', id: 'slam', name: 'Maul', archetype: 'Melee slam',
    blurb: 'Brings it down on everything within reach, all at once.',
    color: '#ffb703', target: 'self', projKind: 'ring', melee: true,
    base: { damage: 44, cooldown: 1.25, range: 138, knockback: 330, count: 1, pierce: 0 },
    fire(state, weapon) {
      const p = state.player;
      const radius = weapon.stats.get('range') * state.stats.get('area');

      damageCircle(state, weapon, p.x, p.y, radius,
        wstat(state, weapon, 'damage'), { knockback: wstat(state, weapon, 'knockback') });

      addMelee(state, {
        kind: 'slam', x: p.x, y: p.y, facing: 0, radius, arc: TAU,
        life: 0.3, color: weapon.def.color,
      });
      spawnParticles(state, p.x, p.y, 18, {
        color: weapon.def.color, speed: 260, speedVar: 140, life: 0.35, size: 3.5, drag: 4,
      });
      state.addShake(7);
    },
  },

  /**
   * LASH — an actual whip.
   *
   * Replaces the old rotating-wedge "Lash", which was the single thing in the
   * arsenal that least resembled its own name. A whip is not a cone: it is a
   * thin line that extends, curves under its own momentum, cracks at the tip,
   * and snaps back. So this is drawn as a segmented curve whose tip travels
   * out and returns over the attack's life, and its damage is applied along
   * that line rather than inside a wedge.
   *
   * It also aims at the target now instead of rotating on a fixed timer —
   * "you cannot aim it" was a defensible design for an orbital, but it is a
   * terrible fit for a whip, which is fundamentally a directed attack.
   */
  lash: {
    baseId: 'lash', id: 'lash', name: 'Lash', archetype: 'Whip',
    blurb: 'Cracks out in a long curve and snaps back through whatever it caught.',
    color: '#ffd166', target: 'nearest', projKind: 'shard', melee: true,
    base: { damage: 26, cooldown: 0.52, range: 235, arc: 0.5, knockback: 190, count: 1, pierce: 0 },
    init(weapon) { weapon.scratch.lashDir = 1; },
    fire(state, weapon, target) {
      const p = state.player;
      const reach = weapon.stats.get('range') * state.stats.get('area');
      const facing = facingTo(p, target);
      const arc = weapon.stats.get('arc');

      // Damage is applied along the whip's line — a narrow arc, but a long
      // one, which is what makes it feel like a lash rather than a swing.
      damageArc(state, weapon, p.x, p.y, reach, facing, arc / 2,
        wstat(state, weapon, 'damage'), { knockback: wstat(state, weapon, 'knockback') });

      weapon.scratch.lashDir = -(weapon.scratch.lashDir ?? 1);
      addMelee(state, {
        kind: 'lash', x: p.x, y: p.y, facing, radius: reach, arc,
        life: 0.26, color: weapon.def.color, dir: weapon.scratch.lashDir,
        segments: 10,
      });

      // The crack: a sharp little burst at the tip, where the whip breaks the
      // sound barrier. It is the whole reason a whip is satisfying.
      const tipX = p.x + Math.cos(facing) * reach;
      const tipY = p.y + Math.sin(facing) * reach;
      spawnParticles(state, tipX, tipY, 9, {
        color: '#ffffff', speed: 240, speedVar: 120, life: 0.2, size: 3, drag: 5,
      });
    },
  },
};
