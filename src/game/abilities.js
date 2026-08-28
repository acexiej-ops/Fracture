/**
 * abilities.js — active, player-triggered powers.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every weapon in this game fires itself. That was a deliberate design choice
 * and it stays — but it means the only input the player has ever had is
 * movement, so the only skill expressed is positioning. Abilities add a second
 * axis: *timing*. A parry is worthless information unless you press it on the
 * right frame, and no amount of good positioning substitutes for that.
 *
 * THE SHAPE
 * ---------
 * Three cooldown abilities (Q / E / R) and one ultimate (SPACE) per character.
 * The ultimate charges from kills rather than from a timer, which ties it to
 * engagement: a player who is actually fighting gets their ultimate, a player
 * running laps does not. That is the same pressure the enrage timer applies,
 * expressed as a reward instead of a punishment.
 *
 * COMPOSITION
 * -----------
 * Forty abilities is only tractable because they are built from a dozen shared
 * EFFECTS primitives. An ability is data plus a short `activate` that calls
 * one or two of them; nothing here reimplements damage, buffs or summoning.
 * Adding a character means writing four small entries, not four systems.
 */

import { rng } from '../core/rng.js';
import { spawnParticles } from './effects.js';
import { addBlast, addZone } from './state.js';
import { TAU } from '../core/math.js';
import { healPlayer } from './player.js';
import { critDamage, rollCrit, addSweep, addDeployable, queuePendingHit, acquireProjectile } from './weaponBases.js';
import { applySlow, applyBurn } from './enemies.js';
import { sfx } from '../audio/sfx.js';
import { getKeyBinding } from '../core/input.js';

// Defaults, kept as the fallback baked into getKeyBinding() itself — these
// two exports exist only so a caller that just wants "what does the UI show
// before any rebind" has something to read without calling getKeyBinding
// three times. The actual gameplay check below never reads these directly;
// it asks getKeyBinding() fresh every tick, which is what makes a rebind
// from the Keybindings panel take effect without needing a restart.
export const ABILITY_KEYS = ['KeyQ', 'KeyE', 'KeyR'];
export const ULTIMATE_KEY = 'Space';
export const KEY_LABELS = ['Q', 'E', 'R'];

/** Ultimate charge economy. Tuned so a normal wave yields roughly one ult. */
export const ULT = {
  perKill: 0.006,
  perElite: 0.05,
  perBoss: 0.34,
  // A small trickle so a quiet stretch still creeps forward, but far too slow
  // to be a substitute for fighting.
  perSecond: 0.004,
};

// ---------------------------------------------------------------------------
// EFFECTS — the shared primitives every ability is built from.
// ---------------------------------------------------------------------------

const EFFECTS = {
  /** Damage everything in a radius around a point. */
  burst(state, x, y, radius, damage, opts = {}) {
    const crit = rollCrit(state);
    const dealt = critDamage(state, damage * state.stats.get('damage'), crit);
    const r = radius * state.stats.get('area');
    state.enemyGrid.forEachNear(x, y, r + 40, (e) => {
      if (!e.alive) return;
      const dx = e.x - x, dy = e.y - y;
      const reach = r + e.radius;
      if (dx * dx + dy * dy > reach * reach) return;
      const d = Math.hypot(dx, dy) || 1;
      const kb = (opts.knockback ?? 0) / (e.mass || 1);
      queuePendingHit(state, {
        enemy: e, damage: dealt, crit,
        kx: (dx / d) * kb, ky: (dy / d) * kb,
      });
      if (opts.slow !== undefined) applySlow(e, opts.slow, opts.slowTime ?? 2);
      if (opts.burn !== undefined) applyBurn(e, opts.burn * state.stats.get('damage'), opts.burnTime ?? 2.5);
    });
    addBlast(state, {
      x, y, radius: r, life: 0.32, maxLife: 0.32, color: opts.color ?? '#ffffff',
    });
    spawnParticles(state, x, y, opts.particles ?? 20, {
      color: opts.color ?? '#ffffff', speed: 260, speedVar: 140,
      life: 0.4, lifeVar: 0.2, size: 3.5, drag: 4,
    });
    state.addShake(opts.shake ?? 6);
  },

  /**
   * Move the player instantly, with i-frames for the trip.
   *
   * DIRECTION: where you are MOVING, not where you are aiming.
   *
   * This used to read p.facing, which weapons.js rewrites every frame to point
   * at the current auto-target. The result was a dash that fired off toward
   * whichever enemy the targeting had picked that instant — unpredictable, and
   * frequently backwards into the crowd you were trying to escape. A movement
   * ability has to answer to the movement keys.
   *
   * `toward: true` is the deliberate exception for gap-closers (Leap Strike,
   * Grapple), where lunging at the target IS the ability. Even then, holding a
   * direction overrides it, so you are never carried somewhere you did not ask
   * to go.
   *
   * Standing still falls back to the last heading you steered, then to facing,
   * so a dash from a standstill still goes somewhere sensible.
   */
  dash(state, distance, { invuln = 0.35, toward = false, color = '#8ff0ff' } = {}) {
    const p = state.player;
    const steering = p.moving === true && Number.isFinite(p.moveAngle);
    let angle;
    if (steering) {
      angle = p.moveAngle;                       // held direction always wins
    } else if (toward && state.target !== null && state.target.alive) {
      angle = Math.atan2(state.target.y - p.y, state.target.x - p.x);
    } else {
      angle = Number.isFinite(p.moveAngle) ? p.moveAngle : p.facing;
    }
    const fromX = p.x, fromY = p.y;
    p.x = Math.max(20, Math.min(2580, p.x + Math.cos(angle) * distance));
    p.y = Math.max(20, Math.min(1880, p.y + Math.sin(angle) * distance));
    p.invuln = Math.max(p.invuln, invuln);

    // A trail of afterimages along the path, so the teleport reads as travel
    // rather than as the sprite jumping.
    const steps = 7;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      spawnParticles(state, fromX + (p.x - fromX) * t, fromY + (p.y - fromY) * t, 2, {
        color, speed: 40, life: 0.28, size: 3, drag: 5,
      });
    }
    return angle;
  },

  /**
   * Open a parry window.
   *
   * While `parryTime` is up, `damagePlayer` refuses the hit outright and sets
   * `parrySuccess`, which this system reads on the next tick to fire the
   * counter. Splitting it that way means the parry does not need to know what
   * hit it — contact damage, a bolt, a mortar and a boss slam all route
   * through the same one check.
   */
  parry(state, window, counter) {
    const p = state.player;
    p.parryTime = window;
    p.parryCounter = counter;
    p.parryFlash = 1;
  },

  /** A temporary stat buff, removed automatically when it expires. */
  buff(state, id, mods, duration) {
    const source = 'ability:' + id;
    state.stats.removeSource(source);
    for (const m of mods) state.stats.add({ ...m, source });
    state.stats.recompute();
    state.abilityBuffs.push({ source, time: duration });
    // maxHp buffs must not leave current health above the new cap when they
    // expire; clamping on expiry is handled in updateAbilities.
  },

  /** Fire a ring of projectiles outward. Reuses the player's own first weapon
   *  so the volley visually matches whatever they are actually carrying. */
  volley(state, count, damageMult, { speed = 620, life = 1.6, color = null } = {}) {
    const p = state.player;
    const source = state.weapons[0] ?? null;
    const base = source !== null ? source.stats.get('damage') : 12;
    const start = rng.angle();
    for (let i = 0; i < count; i++) {
      const a = start + (i / count) * TAU;
      const crit = rollCrit(state);
      state.projectiles.push(acquireProjectile({
        kind: 'bolt',
        weapon: 'ability', weaponRef: source,
        x: p.x + Math.cos(a) * 18, y: p.y + Math.sin(a) * 18,
        vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
        angle: a,
        damage: critDamage(state, base * damageMult * state.stats.get('damage'), crit),
        crit, pierce: 1, knockback: 60, radius: 5, life,
        color: color ?? (source?.def?.color ?? '#8ff0ff'),
        hit: new Set(), marks: 0, markRadius: 0,
      }));
    }
  },

  /** A lingering damaging field on the ground. */
  field(state, x, y, radius, dps, duration, color) {
    addZone(state, {
      weapon: 'ability', kind: 'ability',
      x, y,
      radius: radius * state.stats.get('area'),
      dps: dps * state.stats.get('damage'),
      burn: 0,
      life: duration * state.stats.get('duration'),
      maxLife: duration * state.stats.get('duration'),
      tick: 0, color,
    });
  },

  /** Slow everything nearby without damaging it. */
  chill(state, radius, mult, duration, color = '#7ce7ff') {
    const p = state.player;
    const r = radius * state.stats.get('area');
    state.enemyGrid.forEachNear(p.x, p.y, r, (e) => {
      if (!e.alive) return;
      const dx = e.x - p.x, dy = e.y - p.y;
      if (dx * dx + dy * dy > r * r) return;
      applySlow(e, mult, duration);
    });
    addSweep(state, {
      x: p.x, y: p.y, radius: r, facing: 0, arc: TAU, ring: true,
      life: 0.4, maxLife: 0.4, color, follow: false,
    });
  },

  /** Pull nearby enemies toward the player. */
  pull(state, radius, force) {
    const p = state.player;
    const r = radius * state.stats.get('area');
    state.enemyGrid.forEachNear(p.x, p.y, r, (e) => {
      if (!e.alive || e.type.boss === true) return;
      const dx = p.x - e.x, dy = p.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > r) return;
      e.vx += (dx / d) * force / (e.mass || 1);
      e.vy += (dy / d) * force / (e.mass || 1);
    });
  },

  /** Vacuum every orb on the field toward the player. */
  vacuum(state) {
    for (const o of state.orbs) { o.magnetized = true; o.speed = Math.max(o.speed, 400); }
    spawnParticles(state, state.player.x, state.player.y, 24, {
      color: '#7ce7ff', speed: 180, life: 0.5, size: 3, drag: 3,
    });
  },

  /** Grant a temporary absorb shield. */
  shield(state, amount) {
    const p = state.player;
    p.shieldMax = Math.max(p.shieldMax, amount);
    p.shield = Math.min(p.shieldMax, (p.shield ?? 0) + amount);
    spawnParticles(state, p.x, p.y, 16, { color: '#8ff0ff', speed: 140, life: 0.5, size: 3 });
  },

  /** Place turrets around the player. */
  turrets(state, count, duration) {
    const p = state.player;
    const source = state.weapons[0] ?? null;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * TAU;
      addDeployable(state, {
        kind: 'turret', weapon: 'ability', weaponRef: source,
        x: p.x + Math.cos(a) * 46, y: p.y + Math.sin(a) * 46,
        life: duration, maxLife: duration,
        cooldown: 0, fireRate: 0.45, range: 330, cap: 12,
        color: '#7dffa8', spin: 0,
      });
    }
  },

  /** Trade health for effect. Never lethal — floors at 1. */
  sacrifice(state, amount) {
    const p = state.player;
    const paid = Math.min(amount, p.hp - 1);
    if (paid > 0) p.hp -= paid;
    spawnParticles(state, p.x, p.y, 14, { color: '#ff4d6d', speed: 150, life: 0.4, size: 3 });
    return paid;
  },
};

// ---------------------------------------------------------------------------
// Ability definitions
//
// `kind` picks the HUD icon (see spriteDefs). `cd` is seconds. Ultimates have
// no cooldown — they cost a full charge bar instead.
// ---------------------------------------------------------------------------

const A = (id, name, kind, cd, blurb, activate, extra = {}) =>
  ({ id, name, kind, cd, blurb, activate, ...extra });

export const ABILITIES = {

  // --- The Scavenger: generalist, no sharp edges -------------------------
  scrap_burst: A('scrap_burst', 'Scrap Burst', 'burst', 7,
    'A short-range concussive blast.',
    (s) => EFFECTS.burst(s, s.player.x, s.player.y, 130, 46, { knockback: 260, color: '#4fd8ff' })),
  salvage_dash: A('salvage_dash', 'Salvage Dash', 'dash', 6,
    'Dash forward and drag loose Ichor with you.',
    (s) => { EFFECTS.dash(s, 190, { color: '#4fd8ff' }); EFFECTS.vacuum(s); }),
  field_repair: A('field_repair', 'Field Repair', 'heal', 14,
    'Patch yourself up mid-drift.',
    (s) => { healPlayer(s, 24 + s.maxHp * 0.1); EFFECTS.shield(s, 18); }),
  overclock: A('overclock', 'Overclock', 'ult', 0,
    'Everything you own runs hot for eight seconds.',
    (s) => EFFECTS.buff(s, 'overclock', [
      { stat: 'damage', type: 'inc', value: 0.6 },
      { stat: 'attackSpeed', type: 'inc', value: 0.6 },
      { stat: 'moveSpeed', type: 'inc', value: 0.25 },
    ], 8), { ultimate: true, duration: 8 }),

  // --- The Bulwark: parry, stand, absorb ---------------------------------
  iron_parry: A('iron_parry', 'Iron Parry', 'parry', 5,
    'A brief window. Anything that connects is refused, and answered.',
    (s) => EFFECTS.parry(s, 0.45, { radius: 170, damage: 70, knockback: 420, color: '#8fa4bd' })),
  bulwark_slam: A('bulwark_slam', 'Bulwark Slam', 'burst', 9,
    'Drives everything away from you at once.',
    (s) => EFFECTS.burst(s, s.player.x, s.player.y, 175, 62, { knockback: 520, color: '#8fa4bd', shake: 12 })),
  plate_up: A('plate_up', 'Plate Up', 'shield', 13,
    'Locks the plating down. Slower, but much harder to move.',
    (s) => { EFFECTS.shield(s, 55); EFFECTS.buff(s, 'plate_up',
      [{ stat: 'moveSpeed', type: 'inc', value: -0.2 }], 6); }),
  immovable: A('immovable', 'Immovable', 'ult', 0,
    'Six seconds where nothing can move you and everything that touches you burns.',
    (s) => {
      s.player.immovableTime = 6;
      EFFECTS.buff(s, 'immovable', [{ stat: 'damage', type: 'inc', value: 0.3 }], 6);
    }, { ultimate: true, duration: 6 }),

  // --- The Kite: never be where the hit lands ----------------------------
  blink: A('blink', 'Blink', 'dash', 4,
    'A long step that skips the space between.',
    (s) => EFFECTS.dash(s, 300, { invuln: 0.5, color: '#f4ff5e' })),
  afterimage: A('afterimage', 'Afterimage', 'field', 10,
    'Leaves something behind that the Warped would rather chase.',
    (s) => { EFFECTS.field(s, s.player.x, s.player.y, 90, 26, 3.5, '#f4ff5e');
             EFFECTS.chill(s, 140, 0.55, 2.2, '#f4ff5e'); }),
  quickstep: A('quickstep', 'Quickstep', 'buff', 11,
    '+75% move speed and +30% attack speed for 5 seconds.',
    (s) => EFFECTS.buff(s, 'quickstep', [
      { stat: 'moveSpeed', type: 'inc', value: 0.75 },
      { stat: 'attackSpeed', type: 'inc', value: 0.3 },
    ], 5)),
  phase_storm: A('phase_storm', 'Phase Storm', 'ult', 0,
    'Untouchable for five seconds, and everything you pass through comes apart.',
    (s) => {
      s.player.invuln = Math.max(s.player.invuln, 5);
      s.player.phaseStormTime = 5;
      EFFECTS.buff(s, 'phase_storm', [{ stat: 'moveSpeed', type: 'inc', value: 0.5 }], 5);
    }, { ultimate: true, duration: 5 }),

  // --- The Gunner: solve it at distance ----------------------------------
  suppressing_fire: A('suppressing_fire', 'Suppressing Fire', 'volley', 6,
    'Puts a lot of shots downrange at once.',
    (s) => EFFECTS.volley(s, 14, 0.85, { color: '#c9d6ff' })),
  combat_roll: A('combat_roll', 'Combat Roll', 'dash', 5,
    'Breaks contact and steadies the aim.',
    (s) => { EFFECTS.dash(s, 210, { color: '#c9d6ff' });
             EFFECTS.buff(s, 'combat_roll', [{ stat: 'critChance', type: 'flat', value: 0.2 }], 4); }),
  focus: A('focus', 'Focus', 'buff', 12,
    'Every shot for the next five seconds is looking for a weak point.',
    (s) => EFFECTS.buff(s, 'focus', [
      { stat: 'critChance', type: 'flat', value: 0.35 },
      { stat: 'critMult', type: 'flat', value: 0.6 },
    ], 5)),
  barrage: A('barrage', 'Barrage', 'ult', 0,
    'Six seconds of continuous fire in every direction.',
    (s) => { s.player.barrageTime = 6; }, { ultimate: true, duration: 6 }),

  // --- The Warden: let the ground do it ----------------------------------
  deploy_sentry: A('deploy_sentry', 'Deploy Sentry', 'summon', 8,
    'Drops a pair of sentries on your position.',
    (s) => EFFECTS.turrets(s, 2, 10)),
  barrier: A('barrier', 'Barrier', 'field', 10,
    'Freezes the ground around you solid.',
    (s) => { EFFECTS.chill(s, 200, 0.35, 4, '#7dffa8');
             EFFECTS.field(s, s.player.x, s.player.y, 130, 18, 5, '#7dffa8'); }),
  mending_field: A('mending_field', 'Mending Field', 'heal', 15,
    'Ground that puts you back together while you stand on it.',
    (s) => { healPlayer(s, 18); EFFECTS.buff(s, 'mending_field',
      [{ stat: 'regen', type: 'flat', value: 6 }], 6); }),
  garrison: A('garrison', 'Garrison', 'ult', 0,
    'Six sentries, all at once, all yours.',
    (s) => EFFECTS.turrets(s, 6, 14), { ultimate: true }),

  // --- The Vessel: spend everything ---------------------------------------
  ichor_lance: A('ichor_lance', 'Ichor Lance', 'burst', 7,
    'Puts everything into one point.',
    (s) => {
      const t = s.target;
      const x = t !== null && t.alive ? t.x : s.player.x;
      const y = t !== null && t.alive ? t.y : s.player.y;
      EFFECTS.burst(s, x, y, 105, 150, { color: '#ff5ec4', shake: 10 });
    }),
  siphon_life: A('siphon_life', 'Siphon', 'heal', 12,
    'Takes it out of them and puts it back into you.',
    (s) => {
      let drained = 0;
      const p = s.player;
      s.enemyGrid.forEachNear(p.x, p.y, 200, (e) => {
        if (!e.alive) return;
        const dx = e.x - p.x, dy = e.y - p.y;
        if (dx * dx + dy * dy > 200 * 200) return;
        queuePendingHit(s, { enemy: e, damage: 30 * s.stats.get('damage'), crit: false });
        drained += 3;
      });
      healPlayer(s, Math.min(45, drained));
      EFFECTS.chill(s, 200, 0.6, 2, '#ff5ec4');
    }),
  overload: A('overload', 'Overload', 'buff', 14,
    'Burns your own health for a damage spike.',
    (s) => { EFFECTS.sacrifice(s, s.maxHp * 0.18);
             EFFECTS.buff(s, 'overload', [{ stat: 'damage', type: 'inc', value: 1.1 }], 6); }),
  detonation: A('detonation', 'Detonation', 'ult', 0,
    'One massive nova centered on you — heavy damage and knockback across a huge radius.',
    (s) => {
      EFFECTS.burst(s, s.player.x, s.player.y, 420, 340,
        { knockback: 700, color: '#ff5ec4', shake: 26, particles: 60 });
    }, { ultimate: true }),

  // --- The Choirmaster: more of everything --------------------------------
  scatter_volley: A('scatter_volley', 'Scatter Volley', 'volley', 6,
    'Twenty shots, no aiming.',
    (s) => EFFECTS.volley(s, 20, 0.6, { color: '#ffb703' })),
  echo_shot: A('echo_shot', 'Echo', 'buff', 10,
    'Every weapon you own briefly fires twice.',
    (s) => EFFECTS.buff(s, 'echo_shot', [
      { stat: 'projectileCount', type: 'flat', value: 3 },
      { stat: 'attackSpeed', type: 'inc', value: 0.35 },
    ], 6)),
  swarm_call: A('swarm_call', 'Swarm Call', 'summon', 12,
    'Calls in drones of your own.',
    (s) => {
      const p = s.player;
      const source = s.weapons[0] ?? null;
      for (let i = 0; i < 3; i++) {
        addDeployable(s, {
          kind: 'companion', weapon: 'ability', weaponRef: source,
          x: p.x, y: p.y, life: 12, maxLife: 12,
          cooldown: 0, fireRate: 0.4, range: 300, cap: 8,
          color: '#ffb703', orbit: (i / 3) * TAU, orbitR: 52,
        });
      }
    }),
  chorus: A('chorus', 'Chorus', 'ult', 0,
    'Eight seconds where everything you own sings at once.',
    (s) => EFFECTS.buff(s, 'chorus', [
      { stat: 'projectileCount', type: 'flat', value: 6 },
      { stat: 'attackSpeed', type: 'inc', value: 1.0 },
      { stat: 'area', type: 'inc', value: 0.4 },
    ], 8), { ultimate: true, duration: 8 }),

  // --- The Reaver: take it back -------------------------------------------
  riposte: A('riposte', 'Riposte', 'parry', 5,
    'Catch the blow and open them up for it.',
    (s) => EFFECTS.parry(s, 0.4, { radius: 140, damage: 90, knockback: 300, color: '#ff4d6d', heal: 14 })),
  leap_strike: A('leap_strike', 'Leap Strike', 'dash', 6,
    'Closes on the nearest target and lands on it.',
    (s) => {
      EFFECTS.dash(s, 230, { toward: true, color: '#ff4d6d' });
      EFFECTS.burst(s, s.player.x, s.player.y, 120, 70, { knockback: 240, color: '#ff4d6d' });
    }),
  blood_frenzy: A('blood_frenzy', 'Blood Frenzy', 'buff', 13,
    'Faster, meaner, and it feeds.',
    (s) => { EFFECTS.buff(s, 'blood_frenzy', [
      { stat: 'attackSpeed', type: 'inc', value: 0.55 },
      { stat: 'moveSpeed', type: 'inc', value: 0.2 },
    ], 7); s.player.frenzyTime = 7; }),
  crimson_tide: A('crimson_tide', 'Crimson Tide', 'ult', 0,
    'Everything nearby bleeds, and all of it comes to you.',
    (s) => {
      EFFECTS.burst(s, s.player.x, s.player.y, 300, 180, { color: '#ff4d6d', shake: 18, particles: 44 });
      healPlayer(s, s.maxHp * 0.4);
      s.player.frenzyTime = 8;
    }, { ultimate: true, duration: 8 }),

  // --- The Longdrifter: take everything -----------------------------------
  grapple: A('grapple', 'Grapple', 'pull', 7,
    'Drags the crowd into reach whether it wanted to come or not.',
    (s) => { EFFECTS.pull(s, 320, 620); EFFECTS.chill(s, 320, 0.6, 1.6, '#b45cff'); }),
  scavenge: A('scavenge', 'Scavenge', 'buff', 9,
    'Pulls in everything on the floor.',
    (s) => { EFFECTS.vacuum(s); EFFECTS.buff(s, 'scavenge',
      [{ stat: 'pickupRadius', type: 'inc', value: 1.5 }], 8); }),
  second_wind: A('second_wind', 'Second Wind', 'heal', 15,
    'One more push than you had in you.',
    (s) => { healPlayer(s, 30 + s.maxHp * 0.12);
             EFFECTS.buff(s, 'second_wind', [{ stat: 'moveSpeed', type: 'inc', value: 0.4 }], 5); }),
  hoard: A('hoard', 'Hoard', 'ult', 0,
    'Ten seconds where everything falls toward you and hits harder on the way.',
    (s) => { EFFECTS.vacuum(s); EFFECTS.buff(s, 'hoard', [
      { stat: 'pickupRadius', type: 'inc', value: 3 },
      { stat: 'damage', type: 'inc', value: 0.45 },
    ], 10); }, { ultimate: true, duration: 10 }),

  // --- The Half-Warped: let it in -----------------------------------------
  ichor_burst: A('ichor_burst', 'Ichor Burst', 'burst', 6,
    'Vents what you are carrying, all at once.',
    (s) => EFFECTS.burst(s, s.player.x, s.player.y, 165, 58,
      { burn: 12, burnTime: 3, color: '#a97dff', shake: 8 })),
  warp_step: A('warp_step', 'Warp Step', 'dash', 5,
    'Steps through instead of across.',
    (s) => {
      EFFECTS.burst(s, s.player.x, s.player.y, 90, 32, { color: '#a97dff', shake: 3 });
      EFFECTS.dash(s, 260, { invuln: 0.45, color: '#a97dff' });
      EFFECTS.burst(s, s.player.x, s.player.y, 90, 32, { color: '#a97dff', shake: 3 });
    }),
  embrace: A('embrace', 'Embrace', 'buff', 14,
    'Costs 25% of your max health, then +90% damage and +50% area for 7 seconds.',
    (s) => { EFFECTS.sacrifice(s, s.maxHp * 0.25);
             EFFECTS.buff(s, 'embrace', [
               { stat: 'damage', type: 'inc', value: 0.9 },
               { stat: 'area', type: 'inc', value: 0.5 },
             ], 7); }),
  unmaking: A('unmaking', 'Unmaking', 'ult', 0,
    '+80% damage, +60% area and +30% move speed for 8 seconds, plus a burning aura around you the whole time.',
    (s) => {
      s.player.unmakingTime = 8;
      EFFECTS.buff(s, 'unmaking', [
        { stat: 'damage', type: 'inc', value: 0.8 },
        { stat: 'area', type: 'inc', value: 0.6 },
        { stat: 'moveSpeed', type: 'inc', value: 0.3 },
      ], 8);
      EFFECTS.burst(s, s.player.x, s.player.y, 260, 120, { color: '#a97dff', shake: 20 });
    }, { ultimate: true, duration: 8 }),

  // --- The Ashwalker: everything it touches keeps burning ----------------
  cinder_line: A('cinder_line', 'Cinder Line', 'field', 8,
    'Lay a burning line across the ground ahead of you.',
    (s) => {
      const p = s.player;
      const a = Number.isFinite(p.moveAngle) ? p.moveAngle : p.facing;
      for (let i = 1; i <= 4; i++) {
        EFFECTS.field(s, p.x + Math.cos(a) * i * 70, p.y + Math.sin(a) * i * 70,
          58, 22, 5, '#ff8a3d');
      }
    }),
  ashstep: A('ashstep', 'Ashstep', 'dash', 6,
    'Dash, and leave a fire where you were standing.',
    (s) => {
      const x = s.player.x, y = s.player.y;
      EFFECTS.dash(s, 200, { color: '#ff8a3d' });
      EFFECTS.field(s, x, y, 76, 26, 4.5, '#ff8a3d');
    }),
  stoke: A('stoke', 'Stoke', 'buff', 13,
    'Burn hotter and wider for six seconds.',
    (s) => EFFECTS.buff(s, 'stoke', [
      { stat: 'area', type: 'inc', value: 0.5 },
      { stat: 'duration', type: 'inc', value: 0.5 },
    ], 6)),
  conflagration: A('conflagration', 'Conflagration', 'ult', 0,
    'The ground around you catches for ten seconds.',
    (s) => {
      const p = s.player;
      for (let ring = 1; ring <= 3; ring++) {
        for (let i = 0; i < 6 * ring; i++) {
          const a = (i / (6 * ring)) * Math.PI * 2;
          EFFECTS.field(s, p.x + Math.cos(a) * ring * 105, p.y + Math.sin(a) * ring * 105,
            72, 30, 10, '#ff8a3d');
        }
      }
      s.addShake(14);
    }, { ultimate: true, duration: 10 }),

  // --- The Tidebreaker: block, then punish -------------------------------
  bulwark_guard: A('bulwark_guard', 'Guard', 'parry', 7,
    'Raise the shield. A hit taken in the window is refused and returned.',
    (s) => EFFECTS.parry(s, 0.5, 120)),
  breakwater: A('breakwater', 'Breakwater', 'burst', 9,
    'Shove everything away hard enough to make room.',
    (s) => EFFECTS.burst(s, s.player.x, s.player.y, 165, 40,
      { knockback: 520, color: '#4fd8ff' })),
  brace: A('brace', 'Brace', 'shield', 15,
    'Absorb the next 70 damage.',
    (s) => EFFECTS.shield(s, 70)),
  undertow: A('undertow', 'Undertow', 'ult', 0,
    'Drag everything in, then break it outward.',
    (s) => {
      EFFECTS.pull(s, 420, 900);
      EFFECTS.burst(s, s.player.x, s.player.y, 260, 150,
        { knockback: 700, color: '#4fd8ff' });
      s.addShake(18);
    }, { ultimate: true }),

  // --- The Nullhand: carries nothing, so the hands do the work -----------
  open_palm: A('open_palm', 'Open Palm', 'burst', 5,
    'A close, fast concussion. Comes back quickly.',
    (s) => EFFECTS.burst(s, s.player.x, s.player.y, 120, 58,
      { knockback: 300, color: '#dff7ff' })),
  still_water: A('still_water', 'Still Water', 'chill', 8,
    'Everything nearby slows to half speed.',
    (s) => EFFECTS.chill(s, 230, 0.5, 4, '#dff7ff')),
  empty_hand: A('empty_hand', 'Empty Hand', 'buff', 12,
    'Move and strike far faster for seven seconds.',
    (s) => EFFECTS.buff(s, 'empty_hand', [
      { stat: 'attackSpeed', type: 'inc', value: 0.45 },
      { stat: 'moveSpeed', type: 'inc', value: 0.2 },
    ], 7), { duration: 7 }),
  nothing_held: A('nothing_held', 'Nothing Held', 'ult', 0,
    'Four concussions in sequence, each wider than the last.',
    (s) => {
      for (let i = 0; i < 4; i++) {
        EFFECTS.burst(s, s.player.x, s.player.y, 130 + i * 55, 70,
          { knockback: 340, color: '#dff7ff' });
      }
      s.addShake(16);
    }, { ultimate: true }),

  // --- The Grave-Tender: takes a little back ------------------------------
  last_rites: A('last_rites', 'Last Rites', 'heal', 11,
    'Close a wound. Restores 34 health.',
    (s) => { s.player.hp = Math.min(s.stats.get('maxHp'), s.player.hp + 34); }),
  soil_bind: A('soil_bind', 'Soil Bind', 'field', 9,
    'Consecrate the ground underfoot - it holds and it hurts.',
    (s) => {
      EFFECTS.field(s, s.player.x, s.player.y, 150, 20, 6, '#7dffa8');
      EFFECTS.chill(s, 150, 0.55, 6, '#7dffa8');
    }),
  vigil: A('vigil', 'Vigil', 'shield', 14,
    'Absorb 45 damage, and regenerate while it holds.',
    (s) => {
      EFFECTS.shield(s, 45);
      EFFECTS.buff(s, 'vigil', [{ stat: 'regen', type: 'flat', value: 4 }], 8);
    }),
  procession: A('procession', 'Procession', 'ult', 0,
    'Sentries at every corner, and a long field beneath them.',
    (s) => {
      EFFECTS.turrets(s, 6, 12);
      EFFECTS.field(s, s.player.x, s.player.y, 240, 26, 12, '#7dffa8');
      EFFECTS.buff(s, 'procession', [{ stat: 'regen', type: 'flat', value: 6 }], 12);
    }, { ultimate: true, duration: 12 }),

  // --- The Splitspine: everything happens twice --------------------------
  split_strike: A('split_strike', 'Split Strike', 'volley', 6,
    'Two volleys, a beat apart.',
    (s) => {
      EFFECTS.volley(s, 5, 0.9, { color: '#b45cff' });
      EFFECTS.volley(s, 5, 0.9, { color: '#b45cff', speed: 520 });
    }),
  sidestep: A('sidestep', 'Sidestep', 'dash', 5,
    'Dash, leaving a copy behind that bursts.',
    (s) => {
      const x = s.player.x, y = s.player.y;
      EFFECTS.dash(s, 210, { color: '#b45cff' });
      EFFECTS.burst(s, x, y, 120, 52, { knockback: 220, color: '#b45cff' });
    }),
  doubling: A('doubling', 'Doubling', 'buff', 13,
    'Two more projectiles from everything for eight seconds.',
    (s) => EFFECTS.buff(s, 'doubling', [
      { stat: 'projectileCount', type: 'flat', value: 2 },
      { stat: 'attackSpeed', type: 'inc', value: 0.2 },
    ], 8)),
  both_of_us: A('both_of_us', 'Both Of Us', 'ult', 0,
    'For ten seconds there are simply two of you.',
    (s) => EFFECTS.buff(s, 'both_of_us', [
      { stat: 'projectileCount', type: 'flat', value: 3 },
      { stat: 'damage', type: 'inc', value: 0.4 },
      { stat: 'attackSpeed', type: 'inc', value: 0.4 },
      { stat: 'pierce', type: 'flat', value: 2 },
    ], 10), { ultimate: true, duration: 10 }),

  // --- The Coilwright: current wants somewhere to go ---------------------
  live_cable: A('live_cable', 'Live Cable', 'volley', 5,
    'A fast spray of charged bolts.',
    (s) => EFFECTS.volley(s, 7, 0.8, { speed: 820, color: '#f4ff5e' })),
  earth_spike: A('earth_spike', 'Earth Spike', 'burst', 7,
    'Ground the current through everything close.',
    (s) => EFFECTS.burst(s, s.player.x, s.player.y, 145, 62,
      { knockback: 200, color: '#f4ff5e' })),
  overwind: A('overwind', 'Overwind', 'buff', 12,
    'Fire much faster for six seconds.',
    (s) => EFFECTS.buff(s, 'overwind', [
      { stat: 'attackSpeed', type: 'inc', value: 0.7 },
      { stat: 'projectileSpeed', type: 'inc', value: 0.4 },
    ], 6)),
  full_discharge: A('full_discharge', 'Full Discharge', 'ult', 0,
    'Dump the whole coil at once.',
    (s) => {
      for (let i = 0; i < 3; i++) EFFECTS.volley(s, 14, 1.1, { speed: 900, color: '#f4ff5e' });
      EFFECTS.burst(s, s.player.x, s.player.y, 300, 130, { knockback: 420, color: '#f4ff5e' });
      s.addShake(16);
    }, { ultimate: true }),

  // --- The Chronicler: freeze and control --------------------------------
  frost_nova: A('frost_nova', 'Frost Nova', 'burst', 7,
    'An expanding ring of frost that slows everything it touches.',
    (s) => {
      EFFECTS.burst(s, s.player.x, s.player.y, 180, 30, {
        slow: 0.4, slowTime: 3.5, color: '#7ce7ff', shake: 5,
      });
    }),

  temporal_step: A('temporal_step', 'Temporal Step', 'dash', 5,
    'Step through a moment — the world slows around you.',
    (s) => {
      EFFECTS.dash(s, 220, { color: '#7ce7ff' });
      EFFECTS.chill(s, 200, 0.45, 2.5, '#7ce7ff');
    }),

  glacier: A('glacier', 'Glacier', 'field', 12,
    'Plant a frozen zone that holds enemies in place.',
    (s) => {
      EFFECTS.field(s, s.player.x, s.player.y, 140, 14, 6, '#7ce7ff');
      EFFECTS.chill(s, 140, 0.3, 6, '#7ce7ff');
    }),

  absolute_zero: A('absolute_zero', 'Absolute Zero', 'ult', 0,
    'Eight seconds where everything around you is frozen solid.',
    (s) => {
      EFFECTS.chill(s, 340, 0.15, 8, '#7ce7ff');
      EFFECTS.field(s, s.player.x, s.player.y, 220, 22, 8, '#7ce7ff');
      EFFECTS.buff(s, 'absolute_zero', [
        { stat: 'duration', type: 'inc', value: 0.5 },
      ], 8);
      s.addShake(12);
    }, { ultimate: true, duration: 8 }),

  // --- The Chemist: toxic DoT spread ------------------------------------
  toxic_splash: A('toxic_splash', 'Toxic Splash', 'burst', 6,
    'A splash of corrosive fluid that burns on contact.',
    (s) => {
      const t = s.target;
      const x = t !== null && t.alive ? t.x : s.player.x;
      const y = t !== null && t.alive ? t.y : s.player.y;
      EFFECTS.burst(s, x, y, 130, 28, {
        burn: 10, burnTime: 4, color: '#b8ff5e', shake: 4,
      });
    }),

  acid_trail: A('acid_trail', 'Acid Trail', 'field', 8,
    'Leave a trail of acid wherever you walk.',
    (s) => {
      const p = s.player;
      EFFECTS.buff(s, 'acid_trail', [], 6);
      s.player.acidTrailTime = 6;
      EFFECTS.field(s, p.x, p.y, 80, 18, 6, '#b8ff5e');
    }),

  mutagen: A('mutagen', 'Mutagen', 'buff', 14,
    'Inject yourself with a compound. It hurts, but it makes everything else hurt more.',
    (s) => {
      EFFECTS.sacrifice(s, s.maxHp * 0.12);
      EFFECTS.buff(s, 'mutagen', [
        { stat: 'damage', type: 'inc', value: 0.55 },
        { stat: 'duration', type: 'inc', value: 0.4 },
      ], 7);
    }),

  pandemic: A('pandemic', 'Pandemic', 'ult', 0,
    'Ten seconds where every kill spreads toxic fire to everything nearby.',
    (s) => {
      s.player.pandemicTime = 10;
      EFFECTS.buff(s, 'pandemic', [
        { stat: 'duration', type: 'inc', value: 0.6 },
        { stat: 'area', type: 'inc', value: 0.3 },
      ], 10);
    }, { ultimate: true, duration: 10 }),

  // --- The Blood Mage: sacrifice for power --------------------------------
  blood_bolt: A('blood_bolt', 'Blood Bolt', 'volley', 5,
    'Fire bolts made of your own life force.',
    (s) => {
      EFFECTS.sacrifice(s, s.maxHp * 0.06);
      EFFECTS.volley(s, 8, 1.4, { color: '#ff4d6d' });
    }),

  crimson_dash: A('crimson_dash', 'Crimson Dash', 'dash', 6,
    'Dash, leaving a blood trail that damages enemies.',
    (s) => {
      const x = s.player.x, y = s.player.y;
      EFFECTS.dash(s, 200, { color: '#ff4d6d' });
      EFFECTS.field(s, x, y, 90, 30, 4, '#ff4d6d');
    }),

  life_tap: A('life_tap', 'Life Tap', 'burst', 8,
    'Consume your blood to unleash a devastating nova.',
    (s) => {
      const paid = EFFECTS.sacrifice(s, s.maxHp * 0.15);
      if (paid > 0) {
        EFFECTS.burst(s, s.player.x, s.player.y, 200, 80 + paid * 2, {
          knockback: 350, color: '#ff4d6d', shake: 14, particles: 36,
        });
      }
    }),

  blood_reckoning: A('blood_reckoning', 'Blood Reckoning', 'ult', 0,
    'Sacrifice half your remaining health for a cataclysmic explosion.',
    (s) => {
      const paid = EFFECTS.sacrifice(s, s.player.hp * 0.5);
      if (paid > 0) {
        EFFECTS.burst(s, s.player.x, s.player.y, 380, 200 + paid * 3, {
          knockback: 600, color: '#ff4d6d', shake: 24, particles: 56,
        });
        healPlayer(s, paid * 0.3);
      }
    }, { ultimate: true }),

  // --- The Engineer: deploy and control -----------------------------------
  deploy_turret: A('deploy_turret', 'Deploy Turret', 'summon', 7,
    'Drop a sentry that fires automatically.',
    (s) => EFFECTS.turrets(s, 1, 12)),

  overclock_turrets: A('overclock_turrets', 'Overclock', 'buff', 11,
    'All deployables fire twice as fast.',
    (s) => {
      EFFECTS.buff(s, 'overclock_turrets', [
        { stat: 'attackSpeed', type: 'inc', value: 0.5 },
      ], 6);
      EFFECTS.turrets(s, 2, 8);
    }),

  minefield: A('minefield', 'Minefield', 'field', 13,
    'Scatter mines across the ground around you.',
    (s) => {
      const p = s.player;
      for (let i = 0; i < 5; i++) {
        const a = rng.angle();
        const d = rng.range(40, 140);
        addZone(s, {
          weapon: 'ability', kind: 'mine',
          x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d,
          radius: 40, dps: 60, burn: 0,
          life: 12 * s.stats.get('duration'),
          maxLife: 12 * s.stats.get('duration'),
          tick: 0, color: '#ffb703',
        });
      }
    }),

  armada: A('armada', 'Armada', 'ult', 0,
    'Eight sentries, all at once. The arena is yours.',
    (s) => {
      EFFECTS.turrets(s, 8, 14);
      EFFECTS.buff(s, 'armada', [
        { stat: 'attackSpeed', type: 'inc', value: 0.3 },
      ], 14);
      s.addShake(10);
    }, { ultimate: true, duration: 14 }),

  // --- The Chronokeeper: time manipulation --------------------------------
  time_bolt: A('time_bolt', 'Time Bolt', 'volley', 5,
    'Bolts that slow whatever they hit.',
    (s) => {
      const count = 6 + Math.floor(s.stats.get('projectileCount'));
      const p = s.player;
      const start = rng.angle();
      for (let i = 0; i < count; i++) {
        const a = start + (i / count) * TAU;
        const crit = rollCrit(s);
        s.projectiles.push(acquireProjectile({
          kind: 'bolt', weapon: 'ability',
          x: p.x + Math.cos(a) * 18, y: p.y + Math.sin(a) * 18,
          vx: Math.cos(a) * 700, vy: Math.sin(a) * 700,
          angle: a,
          damage: critDamage(s, 14 * s.stats.get('damage'), crit),
          crit, pierce: 1, knockback: 40, radius: 5, life: 1.8,
          color: '#b45cff', hit: new Set(), marks: 0, markRadius: 0,
          onHit: (enemy) => applySlow(enemy, 0.5, 2.5),
        }));
      }
    }),

  rewind: A('rewind', 'Rewind', 'heal', 14,
    'Rewind your wounds. Restores 30% of damage taken in the last 4 seconds.',
    (s) => {
      const recent = s.player.recentDamageTaken ?? 0;
      const heal = Math.min(recent * 0.3, 50);
      healPlayer(s, heal + 15);
      spawnParticles(s, s.player.x, s.player.y, 18, {
        color: '#b45cff', speed: 120, life: 0.5, size: 3,
      });
    }),

  dilate: A('dilate', 'Dilate', 'buff', 10,
    'Time moves faster for you and slower for everything else.',
    (s) => {
      EFFECTS.buff(s, 'dilate', [
        { stat: 'attackSpeed', type: 'inc', value: 0.4 },
        { stat: 'moveSpeed', type: 'inc', value: 0.3 },
      ], 5);
      EFFECTS.chill(s, 260, 0.4, 5, '#b45cff');
    }),

  time_stop: A('time_stop', 'Time Stop', 'ult', 0,
    'Everything freezes for six seconds. Only you move.',
    (s) => {
      s.player.timeStopTime = 6;
      EFFECTS.chill(s, 500, 0.05, 6, '#b45cff');
      s.player.invuln = Math.max(s.player.invuln, 6);
      s.addShake(16);
    }, { ultimate: true, duration: 6 }),
};

/** Which four abilities each character carries. Order is Q, E, R, ULT. */
export const CHARACTER_ABILITIES = {
  scav:    ['scrap_burst', 'salvage_dash', 'field_repair', 'overclock'],
  bulwark: ['iron_parry', 'bulwark_slam', 'plate_up', 'immovable'],
  kite:    ['blink', 'afterimage', 'quickstep', 'phase_storm'],
  gunner:  ['suppressing_fire', 'combat_roll', 'focus', 'barrage'],
  warden:  ['deploy_sentry', 'barrier', 'mending_field', 'garrison'],
  vessel:  ['ichor_lance', 'siphon_life', 'overload', 'detonation'],
  swarm:   ['scatter_volley', 'echo_shot', 'swarm_call', 'chorus'],
  reaver:  ['riposte', 'leap_strike', 'blood_frenzy', 'crimson_tide'],
  drifter: ['grapple', 'scavenge', 'second_wind', 'hoard'],
  anomaly: ['ichor_burst', 'warp_step', 'embrace', 'unmaking'],
  ember:   ['cinder_line', 'ashstep', 'stoke', 'conflagration'],
  tide:    ['bulwark_guard', 'breakwater', 'brace', 'undertow'],
  null:    ['open_palm', 'still_water', 'empty_hand', 'nothing_held'],
  tender:  ['last_rites', 'soil_bind', 'vigil', 'procession'],
  echo:    ['split_strike', 'sidestep', 'doubling', 'both_of_us'],
  coil:    ['live_cable', 'earth_spike', 'overwind', 'full_discharge'],
  chronicler:  ['frost_nova', 'temporal_step', 'glacier', 'absolute_zero'],
  chemist:     ['toxic_splash', 'acid_trail', 'mutagen', 'pandemic'],
  bloodmage:   ['blood_bolt', 'crimson_dash', 'life_tap', 'blood_reckoning'],
  engineer:    ['deploy_turret', 'overclock_turrets', 'minefield', 'armada'],
  chronokeeper: ['time_bolt', 'rewind', 'dilate', 'time_stop'],
};

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

/** Build the per-run ability state for a character. */
export function createAbilityState(characterId) {
  const ids = CHARACTER_ABILITIES[characterId] ?? CHARACTER_ABILITIES.scav;
  return {
    slots: ids.slice(0, 3).map((id) => ({
      def: ABILITIES[id], cooldown: 0, ready: true,
    })),
    ultimate: { def: ABILITIES[ids[3]], charge: 0, ready: false },
  };
}

/** Charge the ultimate. Called from killEnemy. */
export function addUltCharge(state, amount) {
  const ult = state.abilities?.ultimate;
  if (ult === undefined) return;
  ult.charge = Math.min(1, ult.charge + amount);
  ult.ready = ult.charge >= 1;
}

/**
 * Tick cooldowns, expire buffs, resolve parries, and read input.
 *
 * Input is read here rather than in main.js so that everything about an
 * ability — its cooldown, its activation, its ongoing effect — lives in one
 * file. main.js only has to call this.
 */
export function updateAbilities(state, dt, input) {
  const ab = state.abilities;
  if (ab === null || ab === undefined) return;
  const p = state.player;

  // --- Cooldowns ---
  for (const slot of ab.slots) {
    if (slot.cooldown > 0) {
      slot.cooldown = Math.max(0, slot.cooldown - dt);
      slot.ready = slot.cooldown === 0;
    }
  }

  // --- Ultimate trickle ---
  if (!ab.ultimate.ready) {
    ab.ultimate.charge = Math.min(1, ab.ultimate.charge + ULT.perSecond * dt);
    ab.ultimate.ready = ab.ultimate.charge >= 1;
  }

  // --- Temporary buffs ---
  for (let i = state.abilityBuffs.length - 1; i >= 0; i--) {
    const b = state.abilityBuffs[i];
    b.time -= dt;
    if (b.time <= 0) {
      state.stats.removeSource(b.source);
      state.stats.recompute();
      state.abilityBuffs.splice(i, 1);
      // A maxHp buff expiring must not leave health above the new cap.
      if (p.hp > state.maxHp) p.hp = state.maxHp;
    }
  }

  // --- Parry window and its counter ---
  if (p.parryTime > 0) {
    p.parryTime = Math.max(0, p.parryTime - dt);
    // A visible ring while the window is open — a parry the player cannot see
    // the timing of is a coin flip, not a skill.
    if (p.parryTime === 0) p.parryCounter = null;
  }
  if (p.parryFlash > 0) p.parryFlash = Math.max(0, p.parryFlash - dt * 3);

  if (p.parrySuccess === true) {
    p.parrySuccess = false;
    const c = p.parryCounter;
    if (c !== null && c !== undefined) {
      EFFECTS.burst(state, p.x, p.y, c.radius, c.damage,
        { knockback: c.knockback, color: c.color, shake: 14, particles: 30 });
      if (c.heal !== undefined) healPlayer(state, c.heal);
      // A successful parry refunds most of its own cooldown, so reading an
      // attack correctly is rewarded with the chance to do it again.
      const slot = ab.slots.find((sl) => sl.def.kind === 'parry');
      if (slot !== undefined) { slot.cooldown = Math.min(slot.cooldown, 1.2); slot.ready = false; }
      sfx.craft('rare');
      state.player.invuln = Math.max(state.player.invuln, 0.4);
    }
    p.parryTime = 0;
    p.parryCounter = null;
  }

  // --- Ongoing ultimate effects ---
  tickUltimateEffects(state, dt);

  // --- Input ---
  if (input === null || input === undefined || !p.alive) return;

  for (let i = 0; i < ab.slots.length; i++) {
    const slot = ab.slots[i];
    if (!input.wasPressed(getKeyBinding('ability' + (i + 1)))) continue;
    if (!slot.ready || slot.cooldown > 0) continue;
    slot.def.activate(state);
    // Same `attackSpeed` stat weapons already divide their fire-rate cooldown
    // by (see weaponBases.js) — reused rather than a parallel stat, so every
    // existing source of "faster" (Empty Tome, gear affixes, character leans,
    // level-up upgrades) actually shortens ability cooldowns too. Before this,
    // an item literally described as "Shortens every cooldown you have" did
    // nothing to abilities at all — this was the missing wire.
    slot.cooldown = slot.def.cd / state.stats.get('attackSpeed');
    slot.ready = false;
    sfx.pick();
  }

  if (input.wasPressed(getKeyBinding('ultimate')) && ab.ultimate.ready) {
    ab.ultimate.def.activate(state);
    ab.ultimate.charge = 0;
    ab.ultimate.ready = false;
    state.addShake(16);
    sfx.levelUp();
    state.ultimateBanner = { name: ab.ultimate.def.name, age: 0 };
  }
}

/**
 * Ultimates that do something every frame rather than once on cast.
 *
 * Kept together here rather than as `tick` hooks on each ability, because all
 * four are the same shape — a timer on the player plus a per-frame effect —
 * and scattering them would hide that.
 */
function tickUltimateEffects(state, dt) {
  const p = state.player;

  // Barrage: continuous fire in every direction.
  if (p.barrageTime > 0) {
    p.barrageTime -= dt;
    p.barrageTick = (p.barrageTick ?? 0) - dt;
    if (p.barrageTick <= 0) {
      p.barrageTick = 0.12;
      EFFECTS.volley(state, 8, 0.5, { color: '#c9d6ff' });
    }
  }

  // Phase Storm: damages everything the player moves through.
  if (p.phaseStormTime > 0) {
    p.phaseStormTime -= dt;
    p.phaseTick = (p.phaseTick ?? 0) - dt;
    if (p.phaseTick <= 0) {
      p.phaseTick = 0.16;
      EFFECTS.burst(state, p.x, p.y, 90, 34, { color: '#f4ff5e', shake: 1, particles: 6 });
    }
  }

  // Immovable: nothing shifts you, and contact burns.
  if (p.immovableTime > 0) {
    p.immovableTime -= dt;
    p.crowdSlowMult = 1;      // ignore body-blocking entirely
    p.immovableTick = (p.immovableTick ?? 0) - dt;
    if (p.immovableTick <= 0) {
      p.immovableTick = 0.3;
      EFFECTS.burst(state, p.x, p.y, 120, 30, { color: '#8fa4bd', shake: 2, particles: 8 });
    }
  }

  // Unmaking: a standing Ichor aura.
  if (p.unmakingTime > 0) {
    p.unmakingTime -= dt;
    p.unmakingTick = (p.unmakingTick ?? 0) - dt;
    if (p.unmakingTick <= 0) {
      p.unmakingTick = 0.25;
      EFFECTS.burst(state, p.x, p.y, 190, 40,
        { burn: 8, burnTime: 2, color: '#a97dff', shake: 2, particles: 10 });
    }
  }

  // Frenzy: heals on every kill while it lasts (read by killEnemy).
  if (p.frenzyTime > 0) p.frenzyTime -= dt;
}

export { EFFECTS };
