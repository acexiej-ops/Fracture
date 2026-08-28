/**
 * server/room.js — authoritative game room for one multiplayer session.
 *
 * The server tracks player positions (for anti-cheat authority) and wave/
 * time bookkeeping, and applies player inputs. It does NOT run a lethal
 * combat simulation — see ENEMY_SIMULATION_ENABLED below for why.
 *
 * WHY SERVER-SIDE ENEMIES ARE DISABLED, NOT JUST TUNED DOWN
 * -----------------------------------------------------------------------
 * This used to also spawn its own enemies, move them toward the nearest
 * player, and apply contact damage — a genuine second combat simulation
 * running in parallel with each client's own local one. The idea (per the
 * original design) was that this would eventually be the seed of real
 * shared combat: the server's enemies as shared truth, clients rendering
 * and fighting THOSE instead of their own private ones.
 *
 * That wiring was never finished — no client ever rendered or interacted
 * with a single server-side enemy. So in practice this was a fully
 * invisible combat system running behind the real one: something a player
 * could not see, could not fight, and could not dodge, but which could
 * still kill them. Confirmed directly: a player standing still died to it
 * in 15.6 seconds. From that player's screen, their run simply ended for
 * no visible reason, and their friend watched their character freeze mid-
 * step and stop responding a few seconds before that (see below) — two
 * different-looking bug reports from the exact same cause.
 *
 * THE FREEZE, SPECIFICALLY
 * -----------------------------------------------------------------------
 * The input-processing loop below has always skipped dead players
 * (`if (!player.alive) continue`) — reasonable on its own, since a dead
 * player's position shouldn't keep changing from input. But combined with
 * invisible death, the sequence from a friend's point of view was: your
 * character keeps walking normally, then silently stops and never moves
 * again, several seconds before anything explains why.
 *
 * Making the invisible simulation less lethal instead of turning it off
 * would still leave the actual problem — SOMETHING a player can't see or
 * react to determines whether they live — just on a longer timer. Real
 * shared combat (finishing that original design: sync the server's
 * enemies to the client, actually render and fight them) is the correct
 * fix long-term. Until that exists, "off" is the only version of this that
 * isn't actively worse than not having it.
 */
const ENEMY_SIMULATION_ENABLED = false;

const TICK_RATE = 20;
const ARENA_W = 2600;
const ARENA_H = 1900;
const PLAYER_RADIUS = 14;
const PLAYER_SPEED = 215;
const ENEMY_BASE_SPEED = 82;
const ENEMY_BASE_HP = 14;
const ENEMY_BASE_DAMAGE = 8;
const ENEMY_RADIUS = 13;
const CONTACT_COOLDOWN = 0.55;
const SPAWN_INTERVAL = 1.2;
const WAVE_DURATION = 17;

let nextPlayerId = 1;

export class Room {
  constructor(id) {
    this.id = id;
    this.players = new Map();
    this.enemies = [];
    this.tick = 0;
    this.time = 0;
    this.wave = 1;
    this.waveTimer = 0;
    this.spawnAccumulator = 0;
    this.spawnTimer = SPAWN_INTERVAL;
    this.inputs = new Map();
    this.abilityQueue = [];
    // A room used to run its enemy simulation from the instant it existed —
    // before anyone had pressed Start, before anyone was even looking at the
    // run screen. Joining a room and sitting in the lobby was enough to get
    // hunted down and killed with no idea it was even happening. `started`
    // gates the entire simulation (spawning, movement, damage, wave
    // progression) behind an explicit go-ahead; see update().
    this.started = false;
    // The first player to join owns the room's Start button. Enforced HERE,
    // not just hidden client-side — a client-only gate is a suggestion, not
    // a rule, since nothing stops a modified client from sending the message
    // anyway.
    this.leaderId = null;
  }

  addPlayer(ws, name) {
    const id = 'p' + (nextPlayerId++);
    const spawnX = ARENA_W / 2 + (Math.random() - 0.5) * 200;
    const spawnY = ARENA_H / 2 + (Math.random() - 0.5) * 200;
    if (this.leaderId === null) this.leaderId = id;
    this.players.set(id, {
      id, ws, name,
      x: spawnX, y: spawnY,
      hp: 100, maxHp: 100,
      alive: true,
      invuln: 0,
      lastInputSeq: -1,
    });
    return id;
  }

  removePlayer(id) {
    const player = this.players.get(id);
    if (player === undefined) return;
    this.players.delete(id);
    // The room can't be permanently stuck un-startable just because whoever
    // happened to join first left — hand it to whoever's been there longest
    // (Maps iterate insertion order, so this is simply the next-oldest).
    // Resolved BEFORE the broadcast below, so remaining clients learn the
    // new leader in the same message rather than needing a second one.
    if (this.leaderId === id) {
      const next = this.players.keys().next();
      this.leaderId = next.done ? null : next.value;
    }
    this.broadcast({ type: 'playerLeft', playerId: id, leaderId: this.leaderId });
  }

  /** Attempt to start the run. Only the leader's request is honoured. */
  startRun(playerId) {
    if (this.started || playerId !== this.leaderId) return false;
    this.started = true;
    this.broadcast({ type: 'runStarted' });
    return true;
  }

  getPlayerList() {
    const list = [];
    for (const [id, p] of this.players) {
      // lastAckSeq tells EACH client which of its own input packets the
      // server has actually processed, so it knows what it can safely stop
      // re-predicting locally. Every player's own value goes out to
      // everyone (this list is broadcast identically to the whole room),
      // but only the entry matching your own id means anything to you —
      // see NetClient.reconcile(), which looks itself up by id rather than
      // reading a single shared value.
      list.push({ id, name: p.name, x: p.x, y: p.y, alive: p.alive, isLeader: id === this.leaderId, lastAckSeq: p.lastInputSeq });
    }
    return list;
  }

  queueInput(playerId, input) {
    this.inputs.set(playerId, input);
  }

  queueAbility(playerId, ability) {
    this.abilityQueue.push({ playerId, ...ability });
  }

  broadcast(msg, exclude = null) {
    const raw = JSON.stringify(msg);
    for (const [id, p] of this.players) {
      if (p.ws !== exclude && p.ws.readyState === 1) {
        p.ws.send(raw);
      }
    }
  }

  isEmpty() {
    return this.players.size === 0;
  }

  update(dt) {
    this.tick++;

    // Process player inputs. Always — moving around in the lobby before the
    // leader starts is harmless (nothing is hunting you yet) and means
    // position isn't stale the moment the run actually begins.
    for (const [playerId, input] of this.inputs) {
      const player = this.players.get(playerId);
      if (player === undefined || !player.alive) continue;
      // input.seq (NetClient's self-incrementing inputSeq, one higher every
      // single sendInput() call) is what's actually monotonic here.
      // input.tick used to be checked instead — but the client never
      // advances its own `tick` field after the initial join response sets
      // it once, so every packet for the rest of the connection carried the
      // SAME tick value. That meant only the very first movement input a
      // client ever sent was accepted; everything after looked like a
      // duplicate and was silently dropped forever. From another player's
      // screen, that reads as "I can't see my friend move" — one small
      // twitch right after they joined, then frozen for the rest of the run.
      if (input.seq <= player.lastInputSeq) continue;
      player.lastInputSeq = input.seq;

      let dx = 0, dy = 0;
      if (input.keys) {
        if (input.keys.w) dy -= 1;
        if (input.keys.s) dy += 1;
        if (input.keys.a) dx -= 1;
        if (input.keys.d) dx += 1;
      }
      if (dx !== 0 && dy !== 0) {
        const inv = Math.SQRT1_2;
        dx *= inv;
        dy *= inv;
      }
      player.x = Math.max(20, Math.min(ARENA_W - 20,
        player.x + dx * PLAYER_SPEED * dt));
      player.y = Math.max(20, Math.min(ARENA_H - 20,
        player.y + dy * PLAYER_SPEED * dt));
    }
    this.inputs.clear();

    // Everything below is the actual danger — clock, waves, spawning,
    // enemy AI, contact damage — and none of it used to wait for anyone's
    // go-ahead. A room ran this from the instant it existed, so joining and
    // sitting in the lobby (exactly what a non-leader did while waiting for
    // Start) was enough to get hunted down and killed before ever seeing
    // the run screen.
    if (!this.started) {
      this.broadcast({
        type: 'snapshot', tick: this.tick, time: this.time, wave: this.wave,
        players: this.getPlayerList(), enemies: [],
      });
      return;
    }

    this.time += dt;
    this.waveTimer += dt;

    // Wave progression
    if (this.waveTimer >= WAVE_DURATION) {
      this.waveTimer -= WAVE_DURATION;
      this.wave++;
      this.broadcast({ type: 'waveStart', wave: this.wave });
    }

    // See ENEMY_SIMULATION_ENABLED at the top of this file: an invisible,
    // unfightable combat system was actively killing players with no visual
    // cause. Left structurally intact (not deleted) so turning real shared
    // combat on later is "flip this flag once the client actually renders
    // these enemies", not "rebuild this from scratch".
    if (ENEMY_SIMULATION_ENABLED) {
      // Spawn enemies
      this.spawnAccumulator += dt;
      if (this.spawnAccumulator >= this.spawnTimer) {
        this.spawnAccumulator -= this.spawnTimer;
        const rateMult = 1 + 0.12 * (this.wave - 1);
        this.spawnTimer = SPAWN_INTERVAL / rateMult;
        this.spawnEnemy();
      }

      // Move enemies toward nearest player and resolve contact damage
      for (let i = this.enemies.length - 1; i >= 0; i--) {
        const e = this.enemies[i];
        if (e.hp <= 0) {
          this.enemies.splice(i, 1);
          continue;
        }

        // Find nearest alive player
        let nearest = null;
        let nearestDist = Infinity;
        for (const [, p] of this.players) {
          if (!p.alive) continue;
          const dx = p.x - e.x, dy = p.y - e.y;
          const d = dx * dx + dy * dy;
          if (d < nearestDist) {
            nearestDist = d;
            nearest = p;
          }
        }

        if (nearest !== null) {
          const dx = nearest.x - e.x, dy = nearest.y - e.y;
          const d = Math.hypot(dx, dy) || 1;
          const speed = e.speed * (1 + 0.02 * (this.wave - 1));
          e.x += (dx / d) * speed * dt;
          e.y += (dy / d) * speed * dt;

          // Contact damage
          const dist = Math.hypot(nearest.x - e.x, nearest.y - e.y);
          if (dist < PLAYER_RADIUS + e.radius) {
            e.contactTimer = (e.contactTimer ?? 0) - dt;
            if (e.contactTimer <= 0) {
              nearest.hp -= e.damage;
              nearest.invuln = CONTACT_COOLDOWN;
              e.contactTimer = CONTACT_COOLDOWN;
              if (nearest.hp <= 0) {
                nearest.alive = false;
                this.broadcast({ type: 'playerDied', playerId: nearest.id });
              }
            }
          }
        }

        // Clamp to arena
        e.x = Math.max(10, Math.min(ARENA_W - 10, e.x));
        e.y = Math.max(10, Math.min(ARENA_H - 10, e.y));
      }
    }

    // Broadcast snapshot
    this.broadcast({
      type: 'snapshot',
      tick: this.tick,
      time: this.time,
      wave: this.wave,
      players: this.getPlayerList(),
      enemies: this.enemies.map((e) => ({
        id: e.id, x: Math.round(e.x), y: Math.round(e.y),
        hp: e.hp, maxHp: e.maxHp, type: e.type,
      })),
    });
  }

  spawnEnemy() {
    if (this.enemies.length >= 400) return;
    const side = Math.floor(Math.random() * 4);
    let x, y;
    const margin = 60;
    switch (side) {
      case 0: x = Math.random() * ARENA_W; y = -margin; break;
      case 1: x = Math.random() * ARENA_W; y = ARENA_H + margin; break;
      case 2: x = -margin; y = Math.random() * ARENA_H; break;
      default: x = ARENA_W + margin; y = Math.random() * ARENA_H; break;
    }

    const hpMult = 1 + 0.15 * (this.wave - 1) + 0.006 * (this.wave - 1) ** 2;
    const baseHp = Math.round(ENEMY_BASE_HP * hpMult);

    this.enemies.push({
      id: 'e' + this.tick + '_' + this.enemies.length,
      x, y,
      hp: baseHp,
      maxHp: baseHp,
      speed: ENEMY_BASE_SPEED,
      damage: Math.round(ENEMY_BASE_DAMAGE * (1 + 0.1 * (this.wave - 1))),
      radius: ENEMY_RADIUS,
      type: 'grunt',
      contactTimer: 0,
    });
  }
}
