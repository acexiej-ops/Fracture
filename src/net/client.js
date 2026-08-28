/**
 * src/net/client.js — client-side multiplayer networking.
 *
 * Connects to the WebSocket server, sends inputs at the local frame rate,
 * receives authoritative snapshots, and provides two services:
 *
 *   1. **Prediction** — the client applies its own inputs immediately so
 *      movement feels instant, then reconciles when the server snapshot arrives.
 *   2. **Interpolation** — remote players are drawn between two received
 *      snapshots so their movement is smooth even at 20 tick/s server updates.
 *
 * The net layer is entirely optional: if the server is unreachable or the
 * player is in single-player, every function is a no-op that returns defaults.
 */

const RECONCILE_THRESHOLD = 3;       // px — snap if closer than this
const INTERP_DELAY_MS = 100;         // render remote players 100ms behind latest
const INPUT_SEND_RATE = 60;          // inputs sent at frame rate, not tick rate
const SNAPSHOT_SEND_INTERVAL = 50;   // ms between forced snapshots (fallback)

export class NetClient {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.playerId = null;
    this.roomId = null;
    // The room's leader (whoever joined first) is the only player allowed
    // to start the run — the server enforces this too, this is just so the
    // UI knows whose Start button to show. Kept current across a leader
    // leaving via the leaderId the server includes on 'playerLeft'.
    this.leaderId = null;
    this.tick = 0;

    // Latest server snapshot
    this.serverSnapshot = null;
    this.serverTick = 0;

    // Input sequencing
    this.inputSeq = 0;
    this.pendingInputs = [];

    // Remote player interpolation buffer: [{ time, players: Map<id, pos> }]
    this.snapshotBuffer = [];

    // Callbacks
    this.onJoined = null;
    this.onPlayerJoin = null;
    this.onPlayerLeave = null;
    this.onPlayerDied = null;
    this.onWaveStart = null;
    this.onSnapshot = null;
    this.onRunStarted = null;

    this._inputTimer = 0;
  }

  connect(url, roomId = 'default', playerName = 'Drifter') {
    // A caller retrying a slow/failed join (a sleeping free-tier server can
    // take up to a minute to wake) calls this repeatedly without an explicit
    // disconnect() between attempts. Without closing the previous socket
    // first, its onclose/onerror could still fire AFTER the new one's onopen
    // — both write to the same `this.connected` — and flip a just-succeeded
    // connection back to "disconnected" a moment later.
    if (this.ws !== null) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      try { this.ws.close(); } catch { /* already closing/closed */ }
    }

    try {
      this.ws = new WebSocket(url);
    } catch {
      console.warn('[net] WebSocket connection failed — running offline');
      return;
    }

    this.ws.onopen = () => {
      this.connected = true;
      this.roomId = roomId;
      this.ws.send(JSON.stringify({
        type: 'join', room: roomId, name: playerName,
      }));
    };

    this.ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      this._handleMessage(msg);
    };

    this.ws.onclose = () => {
      this.connected = false;
      this.playerId = null;
    };

    this.ws.onerror = () => {
      this.connected = false;
    };
  }

  disconnect() {
    if (this.ws !== null) {
      try { this.ws.send(JSON.stringify({ type: 'leave' })); } catch { /* */ }
      this.ws.close();
    }
    this.connected = false;
    this.playerId = null;
  }

  /** Send local player input to the server. Called once per frame. */
  sendInput(keys) {
    if (!this.connected || this.ws === null) return;

    const input = {
      seq: this.inputSeq++,
      keys,
      tick: this.tick,
    };
    this.pendingInputs.push(input);

    this.ws.send(JSON.stringify({ type: 'input', ...input }));
  }

  /** Notify the server an ability was activated. */
  sendAbility(slot) {
    if (!this.connected || this.ws === null) return;
    this.ws.send(JSON.stringify({ type: 'ability', slot, tick: this.tick }));
  }

  /** Am I the one player in this room allowed to start the run? */
  isLeader() {
    return this.playerId !== null && this.playerId === this.leaderId;
  }

  /**
   * Ask the server to start the run for the whole room.
   *
   * Client-side isLeader() is what decides whether the UI even offers this,
   * but the actual permission check is server-side (Room.startRun) — this
   * message means nothing if a non-leader's client sends it anyway.
   */
  startMultiplayerRun() {
    if (!this.connected || this.ws === null) return;
    this.ws.send(JSON.stringify({ type: 'startRun' }));
  }

  /**
   * Reconcile the local player position with the server's authoritative state.
   *
   * The server snapshot includes what the server thinks the local player's
   * position is, after processing all received inputs up to that tick. We
   * discard any pending inputs the server has already acknowledged, and if
   * the remaining divergence exceeds RECONCILE_THRESHOLD we snap to the
   * server position. This prevents accumulated drift without requiring
   * perfect determinism.
   */
  reconcile(localPlayer) {
    if (this.serverSnapshot === null || !this.connected) return;
    if (localPlayer === null) return;

    const serverPlayers = this.serverSnapshot.players;
    const serverMe = serverPlayers.find((p) => p.id === this.playerId);
    if (serverMe === undefined) return;

    // Discard acknowledged inputs. This used to read
    // this.serverSnapshot.lastAckSeq — a field the server never actually
    // sent (it only exists per-player, inside each entry of `players`, since
    // a broadcast snapshot has no single shared value that means anything
    // to every recipient at once). That field was always undefined, so the
    // filter below always kept EVERY input ever sent for the entire
    // connection, and the reapply loop a few lines down replayed that
    // entire, ever-growing history on top of a hard position snap, every
    // single tick. That's what "shaky" was: not noise, but the player's own
    // rendered position being teleported to the correct spot and then
    // immediately dragged back off it by thousands of stale, already-
    // resolved inputs, sixty times a second.
    this.pendingInputs = this.pendingInputs.filter(
      (inp) => inp.seq > (serverMe.lastAckSeq ?? -1)
    );

    // Check divergence
    const dx = localPlayer.x - serverMe.x;
    const dy = localPlayer.y - serverMe.y;
    const dist = Math.hypot(dx, dy);

    if (dist > RECONCILE_THRESHOLD) {
      // Snap to server position
      localPlayer.x = serverMe.x;
      localPlayer.y = serverMe.y;
    }

    // Reapply any unacknowledged inputs on top of the server position
    for (const inp of this.pendingInputs) {
      let mx = 0, my = 0;
      if (inp.keys.w) my -= 1;
      if (inp.keys.s) my += 1;
      if (inp.keys.a) mx -= 1;
      if (inp.keys.d) mx += 1;
      if (mx !== 0 && my !== 0) {
        const inv = Math.SQRT1_2;
        mx *= inv;
        my *= inv;
      }
      localPlayer.x += mx * 215 * (1 / INPUT_SEND_RATE);
      localPlayer.y += my * 215 * (1 / INPUT_SEND_RATE);
    }

    // Clamp
    localPlayer.x = Math.max(20, Math.min(2580, localPlayer.x));
    localPlayer.y = Math.max(20, Math.min(1880, localPlayer.y));
  }

  /**
   * Get the interpolated position of a remote player for rendering.
   *
   * Returns null if no interpolation data is available (single-player,
   * or the remote player has not been seen yet).
   */
  getInterpolatedPosition(playerId) {
    if (this.snapshotBuffer.length < 2) return null;
    const targetTime = performance.now() - INTERP_DELAY_MS;

    // Find the two snapshots bracketing the target time
    let a = null, b = null;
    for (let i = 0; i < this.snapshotBuffer.length - 1; i++) {
      if (this.snapshotBuffer[i].time <= targetTime &&
          this.snapshotBuffer[i + 1].time >= targetTime) {
        a = this.snapshotBuffer[i];
        b = this.snapshotBuffer[i + 1];
        break;
      }
    }

    // If we're past both, use the latest pair
    if (a === null) {
      const len = this.snapshotBuffer.length;
      if (len < 2) return null;
      a = this.snapshotBuffer[len - 2];
      b = this.snapshotBuffer[len - 1];
    }

    const pa = a.players.get(playerId);
    const pb = b.players.get(playerId);
    if (pa === undefined || pb === undefined) return null;

    const t = (b.time - a.time) > 0
      ? Math.min(1, (targetTime - a.time) / (b.time - a.time))
      : 1;

    return {
      x: pa.x + (pb.x - pa.x) * t,
      y: pa.y + (pb.y - pa.y) * t,
      alive: pb.alive,
    };
  }

  /**
   * Is MY player still alive according to the server's own combat model?
   *
   * The server runs its own enemy simulation and its own hp/contact-damage
   * for player-position authority — completely separate from the local
   * client's single-player-style simulation (its own enemies, its own hp).
   * Nothing was reading this before, so a player the server had already
   * killed just sat frozen: reconcile() keeps snapping their local position
   * back to the server's (static, dead) one every tick they tried to move,
   * with no death screen and no explanation. `undefined` (no snapshot yet,
   * or we're not in it) reads as alive — this is a liveness check, not a
   * presence check, so "we don't know yet" must never look like "you died".
   */
  isLocalPlayerAlive() {
    if (this.serverSnapshot === null) return true;
    const me = this.serverSnapshot.players.find((p) => p.id === this.playerId);
    return me?.alive ?? true;
  }

  /** Get all remote player IDs currently known. */
  getRemotePlayerIds() {
    if (this.serverSnapshot === null) return [];
    return this.serverSnapshot.players
      .filter((p) => p.id !== this.playerId)
      .map((p) => p.id);
  }

  /** Get the name of a remote player by their ID. */
  getPlayerName(playerId) {
    if (this.serverSnapshot === null) return '???';
    const p = this.serverSnapshot.players.find((pl) => pl.id === playerId);
    return p?.name ?? '???';
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  _handleMessage(msg) {
    switch (msg.type) {
      case 'joined':
        this.playerId = msg.playerId;
        this.roomId = msg.room;
        this.leaderId = msg.leaderId ?? null;
        this.tick = msg.tick ?? 0;
        // `msg.players` is the room's FULL roster at the moment we joined —
        // everyone already there, not just us. `connected` flips true on the
        // raw socket opening (see connect()), well before this round trip
        // completes, so a caller polling `connected` alone would seed its
        // player list with only itself and never learn who else was already
        // in the room until somebody new happened to join after it. This
        // event fires once we actually have the real roster.
        if (this.onJoined !== null) this.onJoined(msg);
        break;

      case 'snapshot':
        this.serverSnapshot = msg;
        this.serverTick = msg.tick;
        this._bufferSnapshot(msg);
        break;

      case 'playerJoined':
        if (this.onPlayerJoin !== null) this.onPlayerJoin(msg);
        break;

      case 'playerLeft':
        // Carries the room's possibly-new leaderId (see room.js) — kept
        // current so the UI can hand the Start button to whoever's next if
        // the leader was the one who left.
        if (msg.leaderId !== undefined) this.leaderId = msg.leaderId;
        if (this.onPlayerLeave !== null) this.onPlayerLeave(msg);
        break;

      case 'playerDied':
        if (this.onPlayerDied !== null) this.onPlayerDied(msg);
        break;

      case 'waveStart':
        if (this.onWaveStart !== null) this.onWaveStart(msg);
        break;

      case 'runStarted':
        if (this.onRunStarted !== null) this.onRunStarted();
        break;

      case 'left':
        this.connected = false;
        this.playerId = null;
        break;
    }
  }

  _bufferSnapshot(snapshot) {
    const players = new Map();
    for (const p of snapshot.players) {
      players.set(p.id, { x: p.x, y: p.y, alive: p.alive });
    }
    this.snapshotBuffer.push({ time: performance.now(), players });

    // Keep buffer bounded to ~2s of snapshots at 20 tick/s
    while (this.snapshotBuffer.length > 40) {
      this.snapshotBuffer.shift();
    }
  }
}
