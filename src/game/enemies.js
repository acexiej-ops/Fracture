/**
 * enemies.js — enemy lifecycle: spawn, AI, separation, damage, death.
 *
 * AI is deliberately simple (walk at the player, hurt them on contact). The
 * interesting behaviour comes from *crowd* dynamics: separation forces turn a
 * pile of identical chasers into a pressing wall you have to carve through,
 * which is what makes kiting feel good.
 */

import { ENEMY_TYPES, WAVES, COMBAT, STATUS, ARENA, FX, CHESTS, PLAYER, ELITE, ENRAGE, BOSS_BUFF } from './config.js';
import { rng } from '../core/rng.js';
import { rollKillDrops, dropsPhysically } from '../meta/materials.js';
import { removeAt, addZone, addBlast, arenaBounds } from './state.js';
import { spawnParticles, spawnDamageNumber } from './effects.js';
import { spawnXpOrbs, spawnMaterialMote } from './xp.js';
import { maybeDropChest } from './chests.js';
import { damagePlayer, healPlayer } from './player.js';
import { sfx } from '../audio/sfx.js';
import { TAU, damp, clamp } from '../core/math.js';
import { addUltCharge, ULT } from './abilities.js';
import { BOSS_UNIQUES, mintBossUniqueItem } from '../meta/bossUniques.js';
import { queuePendingHit } from './weaponBases.js';

export function spawnEnemy(state, typeId, x, y) {
  const t = ENEMY_TYPES[typeId];
  const hpScale = WAVES.hpScale(state.wave);
  const spdScale = WAVES.speedScale(state.wave);
  const dmgScale = WAVES.damageScale(state.wave);

  // Elites: a rare extra modifier on top of an existing archetype. Never
  // bosses (they're already a whole encounter) and never swarm-cluster
  // members (an elite needs to stand alone to be worth singling out — a
  // six-pack of them would just be a different, unreadable difficulty spike).
  const eligible = t.boss !== true && t.swarmSize === undefined;
  const isElite = eligible && state.wave >= ELITE.unlockWave && rng.next() < ELITE.chance;
  const eliteKind = isElite ? rng.pick(ELITE.modifiers) : null;
  const isBoss = t.boss === true;

  // Tournament mutators and the chosen difficulty both multiply the spawned
  // enemy's own numbers, applied here at the single spawn chokepoint so
  // nothing downstream needs to know either mode exists. In practice only
  // one is ever non-1 at a time (tournaments fix their own difficulty and
  // skip the picker — see main.js's startRun), but folding both into the
  // same multiplier means neither has to know the other exists either.
  const mut = state.tournament?.enemyMult ?? null;
  const diff = state.difficulty ?? null;
  const mHp = (mut === null ? 1 : mut.hp) * (diff === null ? 1 : diff.hpMult);
  const mSpeed = (mut === null ? 1 : mut.speed) * (diff === null ? 1 : diff.speedMult);
  const mDamage = (mut === null ? 1 : mut.damage) * (diff === null ? 1 : diff.dmgMult);
  const mRadius = mut === null ? 1 : mut.radius;
  const mMass = mut === null ? 1 : mut.mass;
  const mXp = mut === null ? 1 : mut.xp;

  // Difficulty's own boss-specific axis (DIFFICULTIES.bossHpMult/bossDmgMult)
  // layers on top of BOSS_BUFF rather than replacing it, so Normal can ease
  // off boss fights specifically without softening Normal's trash mobs or
  // touching Medium/Hard's boss tuning at all.
  const bHp = isBoss ? BOSS_BUFF.hpMult * (diff?.bossHpMult ?? 1) : 1;
  const bDmg = isBoss ? BOSS_BUFF.damageMult * (diff?.bossDmgMult ?? 1) : 1;

  const maxHp = t.hp * hpScale * (isElite ? ELITE.hpMult : 1) * bHp * mHp;
  const enemy = {
    type: t,
    x, y,
    vx: 0, vy: 0,
    hp: maxHp,
    maxHp,
    radius: t.radius * (isElite ? ELITE.radiusMult : 1) * mRadius,
    speed: t.speed * spdScale * (isElite ? ELITE.speedMult : 1) * (isBoss ? BOSS_BUFF.speedMult : 1) * mSpeed,
    damage: t.damage * dmgScale * (isElite ? ELITE.damageMult : 1) * bDmg * mDamage,
    xp: t.xp * (isElite ? ELITE.xpMult : 1) * mXp,
    mass: t.mass * mMass,
    contactCd: 0,
    hitFlash: 0,
    alive: true,

    // Body-blocking: accumulated per-tick positional correction from
    // resolveBodyCollisions, applied then zeroed each tick.
    corrX: 0, corrY: 0,

    // Elite: which modifier this instance carries (null for every ordinary
    // enemy), plus its own cooldown/telegraph state. A rotating ring in the
    // renderer is the visual tell; `eliteSpin` desyncs it across instances
    // the same way `wobble` already desyncs the idle animation.
    elite: eliteKind,
    eliteSpin: isElite ? rng.angle() : 0,
    wallerTimer: eliteKind === 'waller' ? rng.range(1.2, ELITE.waller.interval) : 0,
    mortarTimer: eliteKind === 'mortar' ? rng.range(0.8, ELITE.mortar.cooldown)
      : t.mortar ? rng.range(t.mortar.cooldown * 0.4, t.mortar.cooldown) : 0,
    // Speed Aura's *targets* (any ordinary enemy caught in range) carry these
    // two fields regardless of whether they're an elite themselves.
    auraSpeedMult: 1, auraSpeedTime: 0,
    // Rending (weapon modifier) strips armour into this, decaying on its own.
    armorShred: 0, armorShredTime: 0,

    // Status effects. All decay on the enemy's own update.
    burnTime: 0, burnDps: 0,
    markTime: 0,
    slowTime: 0, slowMult: 1,
    burnTick: 0,
    spawnFade: 0.25,     // brief fade-in so they don't pop into existence
    wobble: rng.angle(), // desynchronises the idle animation across the horde
    // Charger state machine
    dashTimer: t.dash ? rng.range(0, t.dash.interval) : 0,
    dashState: 'none',   // 'none' | 'windup' | 'dashing'
    dashTime: 0,
    dashDirX: 0,
    dashDirY: 0,

    // Lurker: ranged attack cooldown, randomised so a pack doesn't volley in sync.
    rangedCooldown: t.ranged ? rng.range(t.ranged.cooldown * 0.3, t.ranged.cooldown) : 0,
    rangedWindup: 0,   // >0 while telegraphing a shot

    // Skitter: erratic juke — a randomised heading offset that expires and rerolls.
    jukeTimer: t.erratic ? rng.range(0, t.erratic.jukeMax) : 0,
    jukeAngle: 0,

    // Husk: proximity-triggered detonation state machine.
    detonateState: 'none',   // 'none' | 'priming' | 'gone'
    detonateTime: 0,
    detonateCooldown: 0,     // brief immunity after backing off, so it can't re-trigger every frame

    // Boss: phase tracking plus one cooldown/windup pair per attack it owns.
    // Idle cooldowns are pre-randomised like every other archetype's, so a
    // boss doesn't open every fight with the exact same first move.
    bossPhase: 1,
    slamState: 'none', slamTimer: t.slam ? rng.range(t.slam.interval * 0.4, t.slam.interval) : 0, slamTime: 0,
    chargeState: 'none', chargeTimer: t.bossCharge ? rng.range(t.bossCharge.interval * 0.4, t.bossCharge.interval) : 0,
    chargeTime: 0, chargeDirX: 0, chargeDirY: 0,
    volleyTimer: t.volley ? rng.range(t.volley.interval * 0.5, t.volley.interval) : 0,
    summonTimer: t.summon ? rng.range(t.summon.interval * 0.5, t.summon.interval) : 0,
    auraTick: 0,
    summonSwarmTimer: t.summonSwarm ? rng.range(t.summonSwarm.interval * 0.5, t.summonSwarm.interval) : 0,

    // Boss teleport: either the Harbinger's primary means of repositioning
    // (`teleportPrimary`), or a phase-2-only escape the Warden gains once
    // bloodied. `state` covers the brief vanish/reappear telegraph so the
    // blink itself has a beat a player can notice, not an instant snap.
    teleportTimer: t.teleport
      ? rng.range((t.teleport.interval ?? t.teleport.cooldown) * 0.5, t.teleport.interval ?? t.teleport.cooldown)
      : 0,
    teleportState: 'none',   // 'none' | 'vanishing' | 'reappearing'
    teleportTime: 0,
  };
  state.enemies.push(enemy);
  return enemy;
}

export function updateEnemies(state, dt) {
  const { enemies, player } = state;
  const grid = state.enemyGrid;

  // Rebuild the broad-phase once per tick; weapons and separation both use it.
  grid.rebuild(enemies);

  updateEnrage(state, dt);

  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];

    if (!e.alive) { removeAt(enemies, i); continue; }

    if (e.spawnFade > 0) e.spawnFade = Math.max(0, e.spawnFade - dt);
    if (e.hitFlash > 0) e.hitFlash = Math.max(0, e.hitFlash - dt * 6);
    if (e.contactCd > 0) e.contactCd -= dt;
    e.wobble += dt * 6;

    updateStatuses(state, e, dt);
    if (!e.alive) { removeAt(enemies, i); continue; }

    const dx = player.x - e.x;
    const dy = player.y - e.y;
    const distToPlayer = Math.hypot(dx, dy) || 1;
    const dirX = dx / distToPlayer;
    const dirY = dy / distToPlayer;

    const speed = e.speed * e.slowMult * e.auraSpeedMult * state.enrageSpeedMult;

    let desiredVx, desiredVy;

    if (e.type.boss === true) {
      // Checked first, ahead of dash/ranged/erratic/detonate: a boss can carry
      // one of those sub-configs for a piece of its kit (Warden reuses `ranged`
      // for its bolt tell) without being routed through that archetype's plain
      // AI — bosses always get their own dedicated function.
      [desiredVx, desiredVy] = updateBossAI(state, e, dt, dirX, dirY, distToPlayer, speed);
      if (!e.alive) { removeAt(enemies, i); continue; }
    } else if (e.type.dash) {
      updateChargerAI(e, dt, dirX, dirY, distToPlayer);
      if (e.dashState === 'windup') {
        desiredVx = dirX * speed * 0.12;   // near-freeze telegraph
        desiredVy = dirY * speed * 0.12;
      } else if (e.dashState === 'dashing') {
        desiredVx = e.dashDirX * e.type.dash.speed * e.slowMult * state.enrageSpeedMult;
        desiredVy = e.dashDirY * e.type.dash.speed * e.slowMult * state.enrageSpeedMult;
      } else {
        desiredVx = dirX * speed;
        desiredVy = dirY * speed;
      }
    } else if (e.type.ranged) {
      [desiredVx, desiredVy] = updateLurkerAI(state, e, dt, dirX, dirY, distToPlayer, speed);
    } else if (e.type.erratic) {
      [desiredVx, desiredVy] = updateSkitterAI(e, dt, dirX, dirY, speed);
    } else if (e.type.detonate) {
      [desiredVx, desiredVy] = updateHuskAI(state, e, dt, dirX, dirY, distToPlayer, speed);
      // The husk may have just killed itself mid-branch. Nothing below this
      // point — separation, movement, contact damage — applies to a corpse.
      if (!e.alive) { removeAt(enemies, i); continue; }
    } else {
      desiredVx = dirX * speed;
      desiredVy = dirY * speed;
    }

    // Elite modifiers layer on top of whatever base AI just ran — a Waller
    // Grunt still chases normally *and* periodically boxes the player in; a
    // Mortar Darter still darts around *and* lobs shells. Purely a side
    // effect here (walls/shells/aura-buffs), never touches this enemy's own
    // desiredVx/Vy.
    if (e.elite !== null) updateEliteModifier(state, e, dt, distToPlayer);

    // Separation: push out of neighbours so the horde spreads into a crowd.
    let sepX = 0, sepY = 0;
    const sepRadius = e.radius * 2.1;
    grid.forEachNear(e.x, e.y, sepRadius, (other) => {
      if (other === e || !other.alive) return;
      const ox = e.x - other.x;
      const oy = e.y - other.y;
      const d2 = ox * ox + oy * oy;
      const minDist = e.radius + other.radius;
      if (d2 > minDist * minDist || d2 < 1e-6) return;
      const d = Math.sqrt(d2);
      // Lighter enemies get shoved more than heavy ones.
      const push = (1 - d / minDist) * (other.mass / (e.mass + other.mass)) * 2;
      sepX += (ox / d) * push;
      sepY += (oy / d) * push;
    });

    desiredVx += sepX * COMBAT.separationForce;
    desiredVy += sepY * COMBAT.separationForce;

    // Knockback lives in vx/vy and decays; steering is applied on top of it.
    e.vx += (desiredVx - e.vx) * Math.min(1, dt * 10);
    e.vy += (desiredVy - e.vy) * Math.min(1, dt * 10);

    e.x += e.vx * dt;
    e.y += e.vy * dt;

    // Contact damage. Also nudge the enemy out of the player so the player
    // silhouette stays visible even when swarmed.
    const touchDist = e.radius + player.radius;
    if (player.alive && distToPlayer < touchDist) {
      if (e.contactCd <= 0) {
        if (damagePlayer(state, e.damage * state.enrageDamageMult, e.x, e.y)) {
          e.contactCd = COMBAT.contactCooldown;
          // Thorns fires on the same cooldown as the enemy's attack, so it
          // scales with how often you're actually being hit.
          if (state.flags.thorns > 0) {
            queuePendingHit(state, { enemy: e, damage: state.flags.thorns, crit: false });
          }
        }
      }
      const overlap = touchDist - distToPlayer;
      e.x -= dirX * overlap * 0.6;
      e.y -= dirY * overlap * 0.6;
    }
  }

  resolveBodyCollisions(state, dt);

  // While a boss fight has shrunk the arena (see arenaBounds/waves.js), the
  // boss itself is the one enemy still alive and still moving under its own
  // AI — nothing about charge dashes, teleports or mortar repositioning
  // knows those bounds exist, so it gets the same hard wall the player
  // already has, checked once here after every other position source
  // (steering, separation, body-collision correction) has had its say.
  if (state.arenaBounds !== null) {
    const bounds = arenaBounds(state);
    for (const e of enemies) {
      if (!e.alive || e.type.boss !== true) continue;
      const r = e.radius;
      if (e.x < bounds.minX + r) e.x = bounds.minX + r;
      if (e.x > bounds.maxX - r) e.x = bounds.maxX - r;
      if (e.y < bounds.minY + r) e.y = bounds.minY + r;
      if (e.y > bounds.maxY - r) e.y = bounds.maxY - r;
    }
  }
}

/**
 * Body-blocking: a firm positional correction on top of the soft separation
 * above. Runs once more over fresh post-movement positions (hence the second
 * grid rebuild — everyone's moved since the top-of-tick one) and directly
 * shoves any pair still overlapping apart, mass-weighted the same way the
 * soft separation already is. Enemy-enemy pairs stop visually stacking; the
 * enemy-player pass additionally displaces the player themselves (a wall of
 * heavy enemies genuinely resists) and tallies how many simultaneous solid
 * contacts they're under, which becomes next tick's `crowdSlowMult` — the
 * "surrounded and slowed" half of the feature. Corrections are accumulated
 * per-entity and applied in a final pass rather than mutated mid-query, so
 * the result doesn't depend on iteration order.
 */
function resolveBodyCollisions(state, dt) {
  const { enemies, player } = state;
  const grid = state.enemyGrid;
  grid.rebuild(enemies);

  let pushPX = 0, pushPY = 0, contacts = 0;

  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (!e.alive) continue;
    e.corrX = 0;
    e.corrY = 0;
  }

  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (!e.alive) continue;

    grid.forEachNear(e.x, e.y, e.radius * 2.4, (other) => {
      if (other === e || !other.alive) return;
      const dx = e.x - other.x, dy = e.y - other.y;
      const d2 = dx * dx + dy * dy;
      const minDist = e.radius + other.radius;
      if (d2 >= minDist * minDist || d2 < 1e-6) return;
      const d = Math.sqrt(d2);
      const overlap = minDist - d;
      const share = other.mass / (e.mass + other.mass);
      const nx = dx / d, ny = dy / d;
      e.corrX += nx * overlap * share * COMBAT.bodyPushStrength;
      e.corrY += ny * overlap * share * COMBAT.bodyPushStrength;
    });

    if (player.alive) {
      const dx = e.x - player.x, dy = e.y - player.y;
      const d2 = dx * dx + dy * dy;
      const minDist = e.radius + player.radius;
      if (d2 < minDist * minDist && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const overlap = minDist - d;
        const nx = dx / d, ny = dy / d;
        const enemyShare = PLAYER.mass / (e.mass + PLAYER.mass);
        e.corrX += nx * overlap * enemyShare * COMBAT.bodyPushStrength;
        e.corrY += ny * overlap * enemyShare * COMBAT.bodyPushStrength;

        const playerShare = e.mass / (e.mass + PLAYER.mass);
        pushPX -= nx * overlap * playerShare * COMBAT.bodyPushStrength;
        pushPY -= ny * overlap * playerShare * COMBAT.bodyPushStrength;
        contacts++;
      }
    }
  }

  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (!e.alive) continue;
    e.x += e.corrX;
    e.y += e.corrY;
  }

  if (player.alive) {
    player.x += pushPX;
    player.y += pushPY;
    const target = Math.max(COMBAT.crowdSlowMin, 1 - contacts * COMBAT.crowdSlowPerContact);
    player.crowdSlowMult = damp(player.crowdSlowMult, target, COMBAT.crowdSlowLambda, dt);
  }
}

/**
 * Enrage: derives `state.enrageFactor` (0..1) from how long it's been since
 * the player's last kill (reset in `killEnemy`), then the speed/damage
 * multipliers everything else in this file reads. `damp` toward 1 while
 * stalling and toward 0 while actively killing, at different rates, so
 * building it up takes real time but a single lucky hit mid-flee can't wipe
 * it out — only sustained re-engagement does.
 */
function updateEnrage(state, dt) {
  state.timeSinceLastKill += dt;
  const target = state.timeSinceLastKill > ENRAGE.graceTime ? 1 : 0;
  const lambda = target > state.enrageFactor ? ENRAGE.rampLambda : ENRAGE.decayLambda;
  state.enrageFactor = damp(state.enrageFactor, target, lambda, dt);
  state.enrageSpeedMult = 1 + state.enrageFactor * ENRAGE.maxSpeedBonus;
  state.enrageDamageMult = 1 + state.enrageFactor * ENRAGE.maxDamageBonus;
}

// ---------------------------------------------------------------------------
// Elite modifiers — layered on top of an existing archetype's own AI.
// ---------------------------------------------------------------------------

function updateEliteModifier(state, e, dt, distToPlayer) {
  if (e.elite === 'waller') {
    e.wallerTimer -= dt;
    if (e.wallerTimer <= 0 && distToPlayer < ELITE.waller.castRange) {
      castWaller(state, e);
      e.wallerTimer = ELITE.waller.interval;
    }
  } else if (e.elite === 'mortar') {
    e.mortarTimer -= dt;
    if (e.mortarTimer <= 0 && distToPlayer < ELITE.mortar.maxRange) {
      fireMortar(state, e);
      e.mortarTimer = ELITE.mortar.cooldown;
    }
  } else if (e.elite === 'speedAura') {
    applySpeedAura(state, e);
  }
}

/**
 * Boxes the player in with a short, gapped arc of temporary walls centred on
 * the player's current position — cutting off a retreat rather than building
 * a cage around the elite itself. Telegraphed (see updateWalls/renderer)
 * before becoming solid, so it's a read-and-reposition threat, not a surprise.
 */
function castWaller(state, e) {
  const cfg = ELITE.waller;
  const p = state.player;
  const baseAngle = rng.angle();

  for (let i = 0; i < cfg.segmentCount; i++) {
    const angle = baseAngle + (i / cfg.segmentCount) * TAU + rng.range(-0.2, 0.2);
    const cx = p.x + Math.cos(angle) * cfg.placeRadius;
    const cy = p.y + Math.sin(angle) * cfg.placeRadius;
    const tangent = angle + Math.PI / 2;
    const hx = Math.cos(tangent) * (cfg.segmentLength / 2);
    const hy = Math.sin(tangent) * (cfg.segmentLength / 2);

    state.walls.push({
      x1: cx - hx, y1: cy - hy, x2: cx + hx, y2: cy + hy,
      thickness: cfg.thickness,
      phase: 'warn', timer: cfg.warnDuration, warnDuration: cfg.warnDuration,
      life: cfg.wallLife, maxLife: cfg.wallLife,
      color: cfg.color,
    });
  }

  spawnParticles(state, p.x, p.y, 8, { color: cfg.color, speed: 70, life: 0.3, size: 2.5 });
}

/**
 * Lobs a shell at where the player is *heading* (current position plus
 * velocity times a fixed lead time), not where they are right now — the
 * predicted-position aim is the whole point, so kiting in a straight line is
 * exactly what gets punished, and cutting a new direction the instant the
 * telegraph appears is exactly how it's dodged.
 */
function fireMortar(state, e) {
  // Elite mortar-carriers read from the shared ELITE config; a boss that
  // carries its own `mortar` block (Behemoth, Harbinger) uses its own tuned
  // numbers instead — same shell, same impact code, different punch.
  const cfg = e.type.mortar ?? ELITE.mortar;
  const p = state.player;
  const tx = clamp(p.x + p.vx * cfg.leadTime, 20, ARENA.width - 20);
  const ty = clamp(p.y + p.vy * cfg.leadTime, 20, ARENA.height - 20);

  state.mortarShells.push({
    x: tx, y: ty, sx: e.x, sy: e.y,
    radius: cfg.blastRadius,
    timer: cfg.travelTime, maxTimer: cfg.travelTime,
    damage: cfg.damage * state.enrageDamageMult,
    color: cfg.color,
  });

  spawnParticles(state, e.x, e.y, 6, { color: cfg.color, speed: 100, life: 0.25, size: 2.5 });
}

/** Refreshes a speed buff on every ordinary enemy currently inside the aura. */
function applySpeedAura(state, e) {
  const cfg = ELITE.speedAura;
  state.enemyGrid.forEachNear(e.x, e.y, cfg.radius, (other) => {
    if (other === e || !other.alive || other.type.boss === true) return;
    other.auraSpeedMult = cfg.speedMult;
    other.auraSpeedTime = cfg.refreshTime;
  });
}

/** Temporary walls: warn, then solid, then gone. Player collision against
 *  solid ones lives in player.js, right alongside the arena-bounds clamp. */
export function updateWalls(state, dt) {
  const walls = state.walls;
  for (let i = walls.length - 1; i >= 0; i--) {
    const w = walls[i];
    if (w.phase === 'warn') {
      w.timer -= dt;
      if (w.timer <= 0) w.phase = 'solid';
      continue;
    }
    w.life -= dt;
    if (w.life <= 0) removeAt(walls, i);
  }
}

/** Mortar shells: pure countdown to impact, no movement — the "projectile"
 *  is the telegraph itself, not something travelling across the screen. */
export function updateMortarShells(state, dt) {
  const shells = state.mortarShells;
  const p = state.player;

  for (let i = shells.length - 1; i >= 0; i--) {
    const s = shells[i];
    s.timer -= dt;
    if (s.timer > 0) continue;

    if (p.alive && Math.hypot(p.x - s.x, p.y - s.y) <= s.radius + p.radius) {
      damagePlayer(state, s.damage, s.x, s.y);
    }

    addBlast(state, { x: s.x, y: s.y, radius: s.radius, life: 0.32, maxLife: 0.32, color: s.color });
    spawnParticles(state, s.x, s.y, 20, {
      color: s.color, speed: 240, speedVar: 130, life: 0.4, lifeVar: 0.2, size: 3.5, drag: 4,
    });
    state.addShake(10);
    removeAt(shells, i);
  }
}

/**
 * Lurker: hold a distance band, strafe inside it, telegraph then fire.
 *
 * The windup takes priority over repositioning — like the charger, it roots
 * itself to sell the shot as dodgeable rather than "damage that just happens".
 */
function updateLurkerAI(state, e, dt, dirX, dirY, distToPlayer, speed) {
  const cfg = e.type.ranged;

  if (e.rangedWindup > 0) {
    e.rangedWindup -= dt;
    if (e.rangedWindup <= 0) {
      fireLurkerBolt(state, e);
      e.rangedCooldown = cfg.cooldown;
    }
    return [dirX * speed * 0.08, dirY * speed * 0.08];
  }

  e.rangedCooldown -= dt;
  if (e.rangedCooldown <= 0 && distToPlayer <= cfg.maxRange) {
    e.rangedWindup = cfg.windup;
    sfx.enemyAttack('shoot', e.type);
    return [dirX * speed * 0.08, dirY * speed * 0.08];
  }

  if (distToPlayer < cfg.minRange) return [-dirX * speed, -dirY * speed];
  if (distToPlayer > cfg.maxRange) return [dirX * speed, dirY * speed];

  // Inside the band: strafe perpendicular rather than closing the last gap,
  // which is what actually holds the range instead of oscillating through it.
  const side = Math.sin(e.wobble * 0.4) >= 0 ? 1 : -1;
  return [-dirY * speed * side, dirX * speed * side];
}

function fireLurkerBolt(state, e) {
  const cfg = e.type.ranged;
  const p = state.player;
  // Aimed at the player's position when the shot actually leaves, not when the
  // windup started — otherwise a moving target makes every bolt read as a miss
  // by design rather than because the player dodged it.
  const dx = p.x - e.x, dy = p.y - e.y;
  const d = Math.hypot(dx, dy) || 1;

  state.enemyProjectiles.push({
    x: e.x, y: e.y,
    vx: (dx / d) * cfg.projectileSpeed,
    vy: (dy / d) * cfg.projectileSpeed,
    damage: cfg.projectileDamage * state.enrageDamageMult,
    radius: cfg.projectileRadius,
    life: cfg.projectileLife,
    color: e.type.color,
  });

  spawnParticles(state, e.x, e.y, 5, {
    color: e.type.color, speed: 110, life: 0.16, size: 2.5,
    angle: Math.atan2(dy, dx), spread: 0.6,
  });
}

/**
 * Skitter: re-roll a bounded heading offset on a short timer. Bounded rather
 * than fully random so it still nets toward the player over time — it dodges
 * the *shot*, not the fight.
 */
function updateSkitterAI(e, dt, dirX, dirY, speed) {
  const cfg = e.type.erratic;

  e.jukeTimer -= dt;
  if (e.jukeTimer <= 0) {
    e.jukeTimer = rng.range(cfg.jukeMin, cfg.jukeMax);
    e.jukeAngle = rng.range(-cfg.jukeAngle, cfg.jukeAngle);
  }

  const angle = Math.atan2(dirY, dirX) + e.jukeAngle;
  const burst = 1 + (Math.abs(e.jukeAngle) / cfg.jukeAngle) * (cfg.burst - 1);
  return [Math.cos(angle) * speed * burst, Math.sin(angle) * speed * burst];
}

/**
 * Husk: approach normally, root and telegraph once inside trigger range, then
 * detonate. Fizzles (with a short cooldown before it can re-trigger) if the
 * player backs fully out during the windup, so backing off on reaction is a
 * real counter and not just a delay.
 */
function updateHuskAI(state, e, dt, dirX, dirY, distToPlayer, speed) {
  const cfg = e.type.detonate;

  if (e.detonateCooldown > 0) e.detonateCooldown -= dt;

  if (e.detonateState === 'priming') {
    e.detonateTime -= dt;
    if (e.detonateTime <= 0) {
      detonateHusk(state, e);
      return [0, 0];
    }
    if (distToPlayer > cfg.triggerRange * 1.4) {
      e.detonateState = 'none';
      e.detonateCooldown = cfg.cooldownAfterFizzle;
    }
    return [0, 0];   // rooted while priming — stillness is the tell
  }

  if (e.detonateState === 'none' && e.detonateCooldown <= 0 && distToPlayer <= cfg.triggerRange) {
    e.detonateState = 'priming';
    e.detonateTime = cfg.windup;
    sfx.enemyAttack('detonate', e.type);
    return [0, 0];
  }

  return [dirX * speed, dirY * speed];
}

function detonateHusk(state, e) {
  const cfg = e.type.detonate;
  const p = state.player;

  // Blast radius is deliberately wider than the trigger range: backing off by
  // a token amount right as it goes off should not be a guaranteed dodge.
  if (p.alive && Math.hypot(p.x - e.x, p.y - e.y) <= cfg.blastRadius) {
    damagePlayer(state, cfg.damage * state.enrageDamageMult, e.x, e.y);
  }

  addBlast(state, { x: e.x, y: e.y, radius: cfg.blastRadius, life: 0.32, maxLife: 0.32, color: '#ff5a3c' });
  spawnParticles(state, e.x, e.y, 22, {
    color: '#ff5a3c', speed: 260, speedVar: 140, life: 0.4, lifeVar: 0.2, size: 3.5, drag: 4,
  });
  state.addShake(10);

  killEnemy(state, e, {});
}

// ---------------------------------------------------------------------------
// Bosses
//
// Each boss composes out of the same sub-configs regular archetypes use
// (`ranged` is the exact same shape a Lurker reads), plus one or two attacks
// of its own. `updateBossAI` dispatches on which config blocks a boss carries
// rather than on its name, so a future boss that mixes capabilities — a
// melee-and-summon hybrid, say — falls out of the existing pieces instead of
// needing a new bespoke branch.
// ---------------------------------------------------------------------------

function updateBossAI(state, e, dt, dirX, dirY, distToPlayer, speed) {
  const t = e.type;

  // Phase transition: once, crossing the halfway mark. Every attack's own
  // cooldown is divided by `phaseMult` from here on, so phase 2 reads as
  // "faster", not as a new moveset.
  if (e.bossPhase === 1 && e.hp <= e.maxHp * 0.5) {
    e.bossPhase = 2;
    spawnParticles(state, e.x, e.y, 30, {
      color: t.color, speed: 260, speedVar: 140, life: 0.5, lifeVar: 0.2, size: 4, drag: 3,
    });
    state.addShake(8);
  }
  const phaseMult = e.bossPhase === 2 ? 1.25 : 1;

  // --- Harbinger family: teleport-based repositioning, fires everything it
  // has from wherever it lands rather than chasing on foot. Checked first —
  // it also carries `ranged`/`volley`/`mortar` for the firing side of its
  // kit, which would otherwise misroute it into the Warden or Behemoth
  // branches below. ---
  if (t.teleportPrimary === true) {
    if (e.teleportState === 'vanishing') {
      e.teleportTime -= dt;
      if (e.teleportTime <= 0) {
        teleportBoss(state, e);
        e.teleportState = 'none';
        e.teleportTimer = t.teleport.interval / phaseMult;
      }
      return [0, 0];
    }
    e.teleportTimer -= dt;
    if (e.teleportTimer <= 0) {
      e.teleportState = 'vanishing';
      e.teleportTime = t.teleport.warmup;
      spawnParticles(state, e.x, e.y, 14, { color: t.color, speed: 120, life: 0.3, size: 3 });
      return [0, 0];
    }

    e.volleyTimer -= dt;
    if (e.volleyTimer <= 0 && distToPlayer < t.ranged.maxRange) {
      fireBossVolley(state, e);
      e.volleyTimer = t.volley.interval / phaseMult;
    }
    e.mortarTimer -= dt;
    if (e.mortarTimer <= 0) {
      fireMortar(state, e);
      e.mortarTimer = t.mortar.cooldown / phaseMult;
    }
    // Repositioning is what the teleport is for — it barely walks on its own.
    return [dirX * speed * 0.15, dirY * speed * 0.15];
  }

  // --- Behemoth family: telegraphed slam, telegraphed charge, and now a
  // lobbed mortar shell for the distance neither of those two reach. ---
  if (t.slam !== undefined) {
    if (e.slamState === 'priming') {
      e.slamTime -= dt;
      if (e.slamTime <= 0) {
        bossSlam(state, e);
        e.slamState = 'none';
        e.slamTimer = t.slam.interval / phaseMult;
      }
      return [0, 0];   // rooted through the whole telegraph, same as Husk
    }
    if (e.chargeState === 'windup') {
      e.chargeTime -= dt;
      e.chargeDirX = dirX; e.chargeDirY = dirY;   // locks in at the end, like Charger
      if (e.chargeTime <= 0) { e.chargeState = 'dashing'; e.chargeTime = t.bossCharge.duration; }
      return [dirX * speed * 0.1, dirY * speed * 0.1];
    }
    if (e.chargeState === 'dashing') {
      e.chargeTime -= dt;
      if (e.chargeTime <= 0) { e.chargeState = 'none'; e.chargeTimer = t.bossCharge.interval / phaseMult; }
      return [e.chargeDirX * t.bossCharge.speed, e.chargeDirY * t.bossCharge.speed];
    }

    e.slamTimer -= dt;
    e.chargeTimer -= dt;
    if (t.mortar) e.mortarTimer -= dt;
    // Slam only when close enough that it would actually connect; charge only
    // when there's room to build up speed; mortar only beyond even the
    // charge's reach — the three attacks split the distance between them
    // rather than competing for the same range.
    if (e.slamTimer <= 0 && distToPlayer < t.slam.radius * 1.3) {
      e.slamState = 'priming'; e.slamTime = t.slam.windup;
      sfx.enemyAttack('slam', e.type);
      return [0, 0];
    }
    if (e.chargeTimer <= 0 && distToPlayer > t.slam.radius && distToPlayer < t.bossCharge.range) {
      e.chargeState = 'windup'; e.chargeTime = t.bossCharge.windup;
      return [dirX * speed * 0.1, dirY * speed * 0.1];
    }
    if (t.mortar && e.mortarTimer <= 0 && distToPlayer >= t.mortar.minRange) {
      fireMortar(state, e);
      e.mortarTimer = t.mortar.cooldown / phaseMult;
      // Still closes the distance while it lobs — this isn't a root, unlike
      // the melee tells above, so running to extreme range only earns a
      // shell, not a breather.
      return [dirX * speed, dirY * speed];
    }
    return [dirX * speed, dirY * speed];
  }

  // --- Swarm Queen family: chase, a damage aura, periodic swarm bursts, and
  // now a slow spreading volley of its own — the aura only ever threatened a
  // player who let it get close; this gives it reach too. Checked before the
  // Warden branch below so a boss carrying both `aura` and `volley` (this
  // one) runs its own AI rather than falling into Warden's kiting logic. ---
  if (t.aura !== undefined) {
    const auraRadius = t.aura.radius * (e.bossPhase === 2 ? 1.3 : 1);
    e.auraTick -= dt;
    if (e.auraTick <= 0) {
      e.auraTick = t.aura.tickInterval;
      if (state.player.alive && distToPlayer < auraRadius) {
        damagePlayer(state, t.aura.damage * state.enrageDamageMult, e.x, e.y);
        sfx.enemyAttack('aura', e.type);
      }
    }
    e.summonSwarmTimer -= dt;
    if (e.summonSwarmTimer <= 0) {
      summonSwarmBurst(state, e);
      e.summonSwarmTimer = t.summonSwarm.interval / phaseMult;
    }
    if (t.volley) {
      e.volleyTimer -= dt;
      if (e.volleyTimer <= 0) {
        fireBossVolley(state, e);
        e.volleyTimer = t.volley.interval / phaseMult;
      }
    }
    return [dirX * speed, dirY * speed];
  }

  // --- Warden family: Lurker's own kiting/bolt AI, plus a volley and adds.
  // Once bloodied, it also stops tolerating being cornered — see the
  // teleport block below, gated to phase 2 by design (see config.js). ---
  if (t.volley !== undefined) {
    if (t.teleport && e.bossPhase === 2) {
      if (e.teleportState === 'vanishing') {
        e.teleportTime -= dt;
        if (e.teleportTime <= 0) {
          teleportBoss(state, e);
          e.teleportState = 'none';
          e.teleportTimer = t.teleport.cooldown;
        }
        return [0, 0];
      }
      e.teleportTimer -= dt;
      if (e.teleportTimer <= 0 && distToPlayer < t.teleport.triggerRange) {
        e.teleportState = 'vanishing';
        e.teleportTime = 0.25;
        spawnParticles(state, e.x, e.y, 14, { color: t.color, speed: 120, life: 0.3, size: 3 });
        return [0, 0];
      }
    }

    const [vx, vy] = updateLurkerAI(state, e, dt, dirX, dirY, distToPlayer, speed);

    e.volleyTimer -= dt;
    if (e.volleyTimer <= 0) {
      fireBossVolley(state, e);
      e.volleyTimer = t.volley.interval / phaseMult;
    }
    e.summonTimer -= dt;
    if (e.summonTimer <= 0) {
      summonPack(state, e);
      e.summonTimer = t.summon.interval;
    }
    return [vx, vy];
  }

  return [dirX * speed, dirY * speed];
}

/**
 * Instant reposition to a fresh point at a set distance from the player.
 * Bookended by the caller with a brief root-and-telegraph on the way out and
 * a particle burst on arrival, so the blink itself has a beat rather than
 * being an unreadable snap.
 */
function teleportBoss(state, e) {
  const cfg = e.type.teleport;
  const p = state.player;
  spawnParticles(state, e.x, e.y, 22, {
    color: e.type.color, speed: 220, speedVar: 120, life: 0.4, lifeVar: 0.15, size: 3.5, drag: 4,
  });
  const dist = rng.range(cfg.minDistance, cfg.maxDistance);
  const angle = rng.angle();
  e.x = clamp(p.x + Math.cos(angle) * dist, 30, ARENA.width - 30);
  e.y = clamp(p.y + Math.sin(angle) * dist, 30, ARENA.height - 30);
  spawnParticles(state, e.x, e.y, 22, {
    color: e.type.color, speed: 220, speedVar: 120, life: 0.4, lifeVar: 0.15, size: 3.5, drag: 4,
  });
  state.addShake(6);
}

function bossSlam(state, e) {
  const cfg = e.type.slam;
  const p = state.player;
  if (p.alive && Math.hypot(p.x - e.x, p.y - e.y) <= cfg.radius) {
    damagePlayer(state, cfg.damage * state.enrageDamageMult, e.x, e.y);
  }
  addBlast(state, { x: e.x, y: e.y, radius: cfg.radius, life: 0.35, maxLife: 0.35, color: e.type.color });
  spawnParticles(state, e.x, e.y, 26, {
    color: e.type.color, speed: 280, speedVar: 150, life: 0.45, lifeVar: 0.2, size: 4, drag: 4,
  });
  state.addShake(12);
}

function fireBossVolley(state, e) {
  const t = e.type.volley;
  const cfg = e.type.ranged;
  const p = state.player;
  const baseAngle = Math.atan2(p.y - e.y, p.x - e.x);
  const start = -t.spread / 2;
  const step = t.count > 1 ? t.spread / (t.count - 1) : 0;

  for (let i = 0; i < t.count; i++) {
    const angle = baseAngle + start + step * i;
    state.enemyProjectiles.push({
      x: e.x, y: e.y,
      vx: Math.cos(angle) * cfg.projectileSpeed, vy: Math.sin(angle) * cfg.projectileSpeed,
      damage: cfg.projectileDamage * state.enrageDamageMult, radius: cfg.projectileRadius, life: cfg.projectileLife,
      color: e.type.color,
    });
  }
  spawnParticles(state, e.x, e.y, 10, { color: e.type.color, speed: 140, life: 0.2, size: 3 });
  state.addShake(4);
}

function summonPack(state, e) {
  const t = e.type.summon;
  const kinds = ['grunt', 'darter'];
  // Regular wave spawning has always respected WAVES.maxEnemies (see
  // waves.js); this didn't, and a Warden left un-pressured for its full
  // 5s summon cooldown over a long run could keep adding to the field
  // indefinitely, well past the population every other spawn path is
  // capped at. That unbounded growth — not an algorithmic inefficiency
  // in any single system — is what actually drove the late-wave
  // performance collapse: every system downstream (collision, particles,
  // rendering) scales with entity count, so removing the one path that
  // could exceed the intended ceiling fixes all of them at once.
  for (let i = 0; i < t.count && state.enemies.length < WAVES.maxEnemies; i++) {
    const a = rng.angle(), d = rng.range(60, 130);
    spawnEnemy(state, kinds[i % kinds.length], e.x + Math.cos(a) * d, e.y + Math.sin(a) * d);
  }
  spawnParticles(state, e.x, e.y, 14, { color: e.type.color, speed: 120, life: 0.3, size: 3 });
  sfx.enemyAttack('summon', e.type);
}

function summonSwarmBurst(state, e) {
  const t = e.type.summonSwarm;
  // Same missing cap as summonPack above.
  for (let i = 0; i < t.count && state.enemies.length < WAVES.maxEnemies; i++) {
    const a = rng.angle(), d = rng.range(0, t.scatter);
    spawnEnemy(state, 'swarmling', e.x + Math.cos(a) * d, e.y + Math.sin(a) * d);
  }
  spawnParticles(state, e.x, e.y, 10, { color: e.type.color, speed: 100, life: 0.25, size: 2.5 });
  sfx.enemyAttack('summon', e.type);
}

function updateChargerAI(e, dt, dirX, dirY, distToPlayer) {
  const cfg = e.type.dash;
  if (e.dashState === 'none') {
    e.dashTimer -= dt;
    if (e.dashTimer <= 0 && distToPlayer < cfg.range) {
      e.dashState = 'windup';
      e.dashTime = cfg.windup;
      sfx.enemyAttack('charge', e.type);
    }
  } else if (e.dashState === 'windup') {
    e.dashTime -= dt;
    // Lock in the direction at the end of the telegraph, so it's dodgeable.
    e.dashDirX = dirX;
    e.dashDirY = dirY;
    if (e.dashTime <= 0) {
      e.dashState = 'dashing';
      e.dashTime = cfg.duration;
    }
  } else {
    e.dashTime -= dt;
    if (e.dashTime <= 0) {
      e.dashState = 'none';
      e.dashTimer = cfg.interval;
    }
  }
}

// ---------------------------------------------------------------------------
// Status effects
// ---------------------------------------------------------------------------

/** Burn stacks by refreshing duration and taking the stronger damage tick. */
export function applyBurn(e, dps, duration) {
  e.burnDps = Math.max(e.burnDps, dps);
  e.burnTime = Math.max(e.burnTime, duration);
}

export function applyMark(e, duration) {
  e.markTime = Math.max(e.markTime, duration);
}

export function applySlow(e, mult, duration) {
  e.slowMult = Math.min(e.slowMult, mult);
  e.slowTime = Math.max(e.slowTime, duration);
}

function updateStatuses(state, e, dt) {
  if (e.markTime > 0) e.markTime -= dt;

  if (e.slowTime > 0) {
    e.slowTime -= dt;
    if (e.slowTime <= 0) e.slowMult = 1;
  }

  // Speed Aura's buff, refreshed every tick a target stays in range —
  // decays out shortly after they leave rather than snapping off instantly.
  if (e.auraSpeedTime > 0) {
    e.auraSpeedTime -= dt;
    if (e.auraSpeedTime <= 0) e.auraSpeedMult = 1;
  }

  // Rending's armour strip decays, so a Warped Bulwark you stopped shooting
  // recovers its mitigation rather than staying permanently stripped.
  if (e.armorShredTime > 0) {
    e.armorShredTime -= dt;
    if (e.armorShredTime <= 0) e.armorShred = 0;
  }

  if (e.burnTime > 0) {
    e.burnTime -= dt;
    e.burnTick -= dt;
    if (e.burnTick <= 0) {
      e.burnTick = STATUS.burn.tickRate;
      // Silent so a burning crowd doesn't bury the screen in damage numbers.
      damageEnemy(state, e, e.burnDps * STATUS.burn.tickRate, { silent: true, burn: true });
    }
    if (e.burnTime <= 0) e.burnDps = 0;
  }
}

// ---------------------------------------------------------------------------
// Damage
// ---------------------------------------------------------------------------

/**
 * Apply damage from a player source. Returns true if this killed the enemy.
 *
 * @param {object} opts  { crit, kx, ky, silent, burn }
 */
export function damageEnemy(state, e, amount, opts = {}) {
  if (!e.alive) return false;

  // Mark makes everything you own hit harder — it's the Seeker's whole point.
  let dealt = amount;
  if (e.markTime > 0) dealt *= STATUS.mark.damageTaken;
  // Armor (Warped Bulwark) shrugs off a flat fraction of every hit, after
  // Mark — it's mitigation on the raw blow, not a discount on the exploit.
  // The Rending modifier strips it via a per-instance `armorShred`; it is
  // never allowed to push effective armour below zero, which would turn a
  // mitigation stat into a damage bonus.
  if (e.type.armor) {
    const effective = Math.max(0, e.type.armor - (e.armorShred ?? 0));
    dealt *= (1 - effective);
  }

  e.hp -= dealt;
  e.hitFlash = 1;
  state.damageDealt += dealt;

  e.vx += opts.kx ?? 0;
  e.vy += opts.ky ?? 0;

  if (opts.silent !== true) {
    spawnDamageNumber(state, e.x, e.y - e.radius, dealt, opts.crit === true);
    if (opts.crit === true) state.critFlashTimer = FX.critFlashDuration;
  }

  // Gear on-hit procs. Gated on `silent` so lingering damage — burn ticks and
  // ground zones — can't re-proc them; a burn that keeps refreshing its own
  // burn would never expire.
  if (opts.silent !== true) {
    const f = state.flags;
    if (f.onHitSlowChance > 0 && rng.next() < f.onHitSlowChance) {
      applySlow(e, f.onHitSlowMult, f.onHitSlowTime);
    }
    if (f.onHitBurnChance > 0 && rng.next() < f.onHitBurnChance) {
      applyBurn(e, f.onHitBurnDps, f.onHitBurnTime);
    }
  }

  // ARC LIGHTNING — a crit jumps to a neighbour. `noArc` on the queued hit stops
  // an arc from arcing again, which would chain across the whole screen forever.
  if (opts.crit === true && opts.noArc !== true && state.flags.arcDamage > 0) {
    const range = state.flags.arcRange;
    const arcTarget = state.enemyGrid.findNearest(
      e.x, e.y, range, (o) => o.alive && o !== e);
    if (arcTarget !== null) {
      queuePendingHit(state, {
        enemy: arcTarget,
        damage: state.flags.arcDamage * state.stats.get('damage'),
        crit: false, noArc: true,
      });
      if (state.arcs.length < 40) {
        state.arcs.push({
          x1: e.x, y1: e.y, x2: arcTarget.x, y2: arcTarget.y,
          life: 0.16, maxLife: 0.16,
        });
      }
    }
  }

  if (e.hp <= 0) {
    if (opts.silent !== true) sfx.kill(e.type);
    killEnemy(state, e, opts);
    return true;
  }

  if (opts.silent !== true) {
    spawnParticles(state, e.x, e.y, opts.crit === true ? 7 : 3, {
      color: e.type.color, speed: 130, life: 0.25, size: 2.5,
    });
    sfx.hit(opts.crit === true, e.type);
  }
  return false;
}

/**
 * On-death effects live here, and they are what turn upgrades into synergies.
 *
 * Every effect queues its damage onto `state.pendingHits` rather than applying
 * it inline. The flush loop re-reads the queue length each iteration, so a
 * detonation that kills three more enemies gets *their* detonations processed
 * in the same drain — chain reactions fall out of the queue for free, and
 * without recursion. It always terminates because a dead enemy is skipped.
 */
export function killEnemy(state, e, opts = {}) {
  e.alive = false;
  state.kills++;
  state.timeSinceLastKill = 0;

  // Ultimate charge comes from kills, not from a timer. That ties it to
  // engagement: a player who is actually fighting earns their ultimate, one
  // running laps does not — the same pressure the enrage timer applies, as a
  // reward rather than a punishment.
  addUltCharge(state, e.type.boss === true ? ULT.perBoss
    : e.elite !== null && e.elite !== undefined ? ULT.perElite
    : ULT.perKill);

  // Blood Frenzy / Crimson Tide: the Reaver heals off kills while it lasts.
  if (state.player.frenzyTime > 0) healPlayer(state, 2.5);

  // Kill combo: consecutive kills inside the window keep the streak alive;
  // any gap resets it (handled in effects.js, where the timer ticks down).
  state.comboCount++;
  state.comboTimer = FX.comboWindow;
  if (state.comboCount > state.comboBest) state.comboBest = state.comboCount;

  // Hit-stop on a kill that deserves one: a boss, anything brute-and-heavier,
  // or a crit — gated by mass so the constant stream of one-hit grunts never
  // triggers it, which would read as lag instead of impact. Only the longest
  // requested freeze wins if several conditions overlap on the same kill.
  let stop = 0;
  if (e.type.boss === true) stop = FX.hitStopDurationBoss;
  else if (e.mass >= FX.hitStopMassThreshold) stop = FX.hitStopDuration;
  if (opts.crit === true) stop = Math.max(stop, FX.hitStopDurationCrit);
  if (stop > 0) state.hitStopTimer = Math.max(state.hitStopTimer, stop);

  const flags = state.flags;

  // VOLATILE REMAINS — corpses detonate, damaging everything nearby.
  if (flags.explodeDamage > 0) {
    const radius = flags.explodeRadius * state.stats.get('area');
    // Scaling partly off the victim's max HP means detonating a brute matters
    // more than detonating a grunt, without needing a separate upgrade.
    const damage = flags.explodeDamage * state.stats.get('damage')
      + e.maxHp * flags.explodeHpScale;

    addBlast(state, {
      x: e.x, y: e.y, radius, life: 0.28, maxLife: 0.28, color: '#ffca6b',
    });

    state.enemyGrid.forEachNear(e.x, e.y, radius + 30, (other) => {
      if (!other.alive || other === e) return;
      const dx = other.x - e.x, dy = other.y - e.y;
      const reach = radius + other.radius;
      if (dx * dx + dy * dy > reach * reach) return;
      const d = Math.hypot(dx, dy) || 1;
      queuePendingHit(state, {
        enemy: other, damage, crit: false,
        kx: (dx / d) * 90 / (other.mass || 1),
        ky: (dy / d) * 90 / (other.mass || 1),
      });
    });

    spawnParticles(state, e.x, e.y, 14, {
      color: '#ffca6b', speed: 240, speedVar: 120, life: 0.35, size: 3.5, drag: 5,
    });
  }

  // WILDFIRE — anything that dies while burning leaves a fire pool behind,
  // which sets fire to whatever walks over it. Self-sustaining in a crowd.
  if (flags.wildfire > 0 && (e.burnTime > 0 || opts.burn === true)) {
    const life = 1.8 * state.stats.get('duration');
    addZone(state, {
      weapon: 'wildfire', kind: 'ember',
      x: e.x, y: e.y,
      radius: 38 * state.stats.get('area'),
      dps: flags.wildfire * state.stats.get('damage'),
      burn: 1.2,
      life, maxLife: life,
      tick: 0,
      color: '#ff7a2f',
    });
  }

  // Death burst, in three layers so a kill reads as a body coming apart
  // rather than a puff of dust. Sized off the victim, so a Warped Mote pops
  // and a Warped Bulwark bursts.
  //
  // Layer 1: chunky body-coloured debris — deliberately large and slow-dragging
  // so the squares read as *pixels of the sprite* scattering, matching the art.
  spawnParticles(state, e.x, e.y, Math.min(24, 9 + e.radius), {
    color: e.type.color,
    speed: 200 + e.radius * 4,
    speedVar: 120,
    life: 0.45,
    lifeVar: 0.2,
    size: 4 + e.radius * 0.14,
    drag: 4,
  });
  // Layer 2: the Ichor that was driving it, sprayed out. Scaled by how far
  // gone the thing was, so the corruption the sprite shows is the corruption
  // that leaks when it dies.
  const corruption = e.type.corruption ?? 0.2;
  spawnParticles(state, e.x, e.y, Math.round(3 + corruption * 10), {
    color: '#b45cff',
    speed: 150 + e.radius * 3,
    speedVar: 90,
    life: 0.55,
    lifeVar: 0.25,
    size: 3,
    drag: 3,
  });
  // Layer 3: a white core flash on top reads as "that died" even when twenty
  // things die in the same frame.
  spawnParticles(state, e.x, e.y, 5, {
    color: '#ffffff', speed: 90, life: 0.16, size: 4,
  });

  if (e.mass >= 3) state.addShake(3.5);

  spawnXpOrbs(state, e.x, e.y, e.xp);
  dropMaterials(state, e);

  if (e.type.boss === true) {
    bossDefeated(state, e);
  } else {
    maybeDropChest(state, e.x, e.y);
  }

  const f = state.flags;
  if (f.killHealChance > 0 && rng.next() < f.killHealChance) {
    healPlayer(state, f.killHealAmount);
  }
}

/**
 * A boss dying is its own event, not just a bigger version of a normal kill:
 * a guaranteed rare-or-better chest (skipping the ordinary probabilistic
 * drop entirely — one deliberate reward beats "maybe two random ones"), the
 * defeat counter that keeps the roster cycling, and its own fanfare. The
 * actual banner text is read and shown by `main.js`, which owns the HUD —
 * this just leaves the message for it to pick up.
 */
function bossDefeated(state, e) {
  state.bossesDefeated++;

  // The one-time trophy weapon (see meta/bossUniques.js) — guaranteed the
  // first time this boss id is actually beaten, checked against both what
  // the profile already has AND what this same run has already staged (a
  // very long run can cycle through the boss roster more than once before
  // banking). Staged into runGear exactly like chest loot below, so it only
  // becomes permanent if the run is actually banked.
  const alreadyEarned = state.bossUniquesOwned.includes(e.type.id)
    || state.bossUniquesEarnedThisRun.includes(e.type.id);
  let uniqueItem = null;
  if (!alreadyEarned && BOSS_UNIQUES[e.type.id] !== undefined) {
    uniqueItem = mintBossUniqueItem(e.type.id, rng);
    state.runGear.push(uniqueItem);
    state.bossUniquesEarnedThisRun.push(e.type.id);
  }
  state.bossJustDefeated = { name: e.type.name, uniqueItem };

  state.chests.push({
    x: e.x, y: e.y,
    tier: rng.bool(0.45) ? 'exotic' : 'rare',
    life: CHESTS.lifetime, maxLife: CHESTS.lifetime,
    pulse: rng.angle(), source: 'drop',
  });

  spawnParticles(state, e.x, e.y, 60, {
    color: e.type.color, speed: 340, speedVar: 200, life: 0.8, lifeVar: 0.3, size: 5, drag: 2.5,
  });
  spawnParticles(state, e.x, e.y, 20, { color: '#ffffff', speed: 200, life: 0.35, size: 4 });
  state.addShake(20);
  sfx.bossDefeat();
}

/**
 * Common materials credit straight to the run total; rare and exotic ones drop
 * as a mote you have to go and collect. Four hundred enemies dropping physical
 * pickups would bury the arena, but a rare drop should still be a moment.
 */
function dropMaterials(state, e) {
  const drops = rollKillDrops(e.type.id, state.wave, rng);
  if (drops.length === 0) return;

  const bonus = state.flags.salvageBonus;
  for (const id of drops) {
    // Salvage gear rolls a second chance at the same drop rather than
    // fractionally inflating a count the player can't see.
    const copies = 1 + ((bonus > 0 && rng.next() < bonus) ? 1 : 0);
    for (let i = 0; i < copies; i++) {
      if (dropsPhysically(id)) spawnMaterialMote(state, e.x, e.y, id);
      else state.runMaterials[id] = (state.runMaterials[id] ?? 0) + 1;
    }
  }
}

/**
 * Enemy bolts fired by ranged types (currently just the Lurker). Kept in its
 * own pass, separate from the player's `updateProjectiles`, because it damages
 * the player instead of enemies and doesn't need pierce, crit, or the spatial
 * grid — just a straight line and one collision test.
 */
export function updateEnemyProjectiles(state, dt) {
  const bolts = state.enemyProjectiles;
  const player = state.player;

  for (let i = bolts.length - 1; i >= 0; i--) {
    const b = bolts[i];

    b.life -= dt;
    if (b.life <= 0) { removeAt(bolts, i); continue; }

    b.x += b.vx * dt;
    b.y += b.vy * dt;

    if (b.x < -60 || b.x > ARENA.width + 60 || b.y < -60 || b.y > ARENA.height + 60) {
      removeAt(bolts, i);
      continue;
    }

    if (player.alive) {
      const dx = player.x - b.x, dy = player.y - b.y;
      const reach = player.radius + b.radius;
      if (dx * dx + dy * dy <= reach * reach) {
        damagePlayer(state, b.damage, b.x, b.y);
        removeAt(bolts, i);
      }
    }
  }
}

/** Types available at the current wave, for the spawn director. */
export function availableTypes(wave) {
  const out = [];
  for (const key in ENEMY_TYPES) {
    if (ENEMY_TYPES[key].unlockWave <= wave) out.push(ENEMY_TYPES[key]);
  }
  return out;
}
