/**
 * multiplayer.js — lobby UI for creating and joining multiplayer rooms.
 *
 * Rendered as a hub tab panel. Lets the player:
 *   1. Enter a server address (defaults to current hostname)
 *   2. Enter a room code (or create a new one)
 *   3. See who's in the room
 *   4. Start a multiplayer run
 *
 * The NetClient is owned by main.js and passed in here for control.
 */

import { t } from '../i18n/i18n.js';
import { sfx } from '../audio/sfx.js';
import { setHostingRoom, clearHostingRoom } from '../meta/friends.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const DEFAULT_PORT = 3001;

// This guess only holds if the Render service is named exactly
// "fracture-server" — unlike Fly.io, Render subdomains are a single global
// namespace shared by every Render user, not scoped to your account, so
// there's no guarantee that name is even available to you. Set
// VITE_MP_SERVER_URL as a Vercel env var to the real address instead of
// relying on this guess; see MULTIPLAYER_SETUP.md.
const PROD_SERVER_URL = 'wss://fracture-server.onrender.com';

export class MultiplayerPanel {
  constructor(root, net, { onStartMulti }) {
    this.root = root;
    this.net = net;
    this.onStartMulti = onStartMulti;

    this.roomInput = null;
    this.serverInput = null;
    this.playerList = null;
    this.statusEl = null;
    this.startBtn = null;
    this.joinBtn = null;
    this.leaveBtn = null;

    this.roomCode = '';
    this.connected = false;
    this.connecting = false;
    this.wakingUp = false;
    this.players = [];
    this.playerName = this._loadName();
    // Bumped on every join/leave. A retry loop closure checks this before
    // acting, so a stale attempt (from a join the player already cancelled,
    // or that a newer join superseded) can't clobber state out of order.
    this._joinToken = 0;

    this._bind();
  }

  _loadName() {
    try {
      return localStorage.getItem('fracture.mpName') || 'Drifter';
    } catch { return 'Drifter'; }
  }

  _saveName(name) {
    try { localStorage.setItem('fracture.mpName', name); } catch { /* */ }
  }

  _loadServer() {
    try {
      return localStorage.getItem('fracture.mpServer') || '';
    } catch { return ''; }
  }

  _saveServer(url) {
    try { localStorage.setItem('fracture.mpServer', url); } catch { /* */ }
  }

  _getDefaultServer() {
    const saved = this._loadServer();
    if (saved) return saved;
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      return 'ws://localhost:' + DEFAULT_PORT;
    }
    // Production. This used to fall back to ws://localhost:3001 here too —
    // harmless on your own machine, but on the deployed site every visitor's
    // browser tried to reach a server on THEIR machine and silently failed.
    // Matches the app name in fly.toml; see MULTIPLAYER_SETUP.md.
    return import.meta.env?.VITE_MP_SERVER_URL ?? PROD_SERVER_URL;
  }

  _bind() {
    // Delegate clicks within the panel
    this.root.addEventListener('click', (e) => {
      const createBtn = e.target.closest('[data-mp="create"]');
      if (createBtn) { this._onCreate(); return; }

      const joinBtn = e.target.closest('[data-mp="join"]');
      if (joinBtn) { this._onJoin(); return; }

      const leaveBtn = e.target.closest('[data-mp="leave"]');
      if (leaveBtn) { this._onLeave(); return; }

      const startBtn = e.target.closest('[data-mp="start"]');
      if (startBtn) { this._onStartMultiplayer(); return; }
    });
  }

  /**
   * A short, easy-to-read-aloud room code, avoiding characters that are
   * commonly confused (0/O, 1/I/l) — the whole point of a code is that
   * someone reads it out or types it from memory a moment later.
   */
  _generateRoomCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 5; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
    return code;
  }

  /**
   * "Create Room": generates a fresh code and joins it immediately, so
   * whoever's starting the group doesn't have to invent a code themselves
   * just to get a private room — Join Room (typing a code a friend already
   * gave you) is the only other action, and inventing one by hand for that
   * path never made sense. The server doesn't distinguish create from join
   * at all — a room is just whatever code the first person to use it typed
   * — so this is purely a client-side convenience, not a new server concept.
   */
  _onCreate() {
    const roomEl = this.root.querySelector('[data-mp="room"]');
    if (roomEl !== null) roomEl.value = this._generateRoomCode();
    this._onJoin();
  }

  /**
   * Best-effort ping to wake a sleeping free-tier server.
   *
   * A free host (Render's included) spins its instance down after a stretch
   * of no traffic, and the FIRST connection attempt after that arrives while
   * it's still asleep and fails outright — the instance needs up to a
   * minute to boot before anything can reach it. A plain HTTP request
   * reliably kicks off that wake-up, so fire one alongside the WebSocket
   * attempt rather than making the player discover this by hand (which is
   * exactly what happened before this fix: opening the server's plain
   * https:// URL first, THEN retrying in-game, worked — because the first
   * visit was the wake-up call).
   *
   * `no-cors` because we don't need to read the response, only cause it to
   * happen; that also means it can't throw on a cross-origin response.
   */
  _wakeServer(wsUrl) {
    try {
      const httpUrl = wsUrl.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:');
      fetch(httpUrl, { mode: 'no-cors', cache: 'no-store' }).catch(() => {});
    } catch { /* best effort only */ }
  }

  /**
   * Entry point for the Friends tab's "Join" button — connects straight to a
   * friend's published room code without the player typing anything.
   * Leaves whatever room this client is already in first, same as clicking
   * Leave then typing the code in by hand would.
   */
  joinCode(code) {
    if (this.connected || this.connecting) this.leaveRoom();
    this._render();   // the room-code input only exists once neither flag is set
    const roomEl = this.root.querySelector('[data-mp="room"]');
    if (roomEl !== null) roomEl.value = code;
    this._onJoin();
  }

  _onJoin() {
    const roomEl = this.root.querySelector('[data-mp="room"]');
    const nameEl = this.root.querySelector('[data-mp="name"]');

    // Always the one real server — see _getDefaultServer(). It still checks
    // localStorage's fracture.mpServer first, which is deliberately left in
    // as a developer escape hatch (set it from devtools to point at a local
    // test server); there is just no UI field feeding it anymore.
    const server = this._getDefaultServer();
    const room = (roomEl?.value ?? '').trim() || 'default';
    const name = (nameEl?.value ?? '').trim() || 'Drifter';

    this._saveName(name);
    this.playerName = name;
    this.roomCode = room;
    this.connecting = true;
    this.wakingUp = false;
    this._render();

    // Invalidates any retry loop still running from a PRIOR join (the player
    // clicked Join, then Leave, then Join again before the first attempt
    // finished, say) — that loop's callbacks check this before touching
    // state, so they can't act on behalf of a join nobody is waiting on
    // anymore.
    const myAttempt = ++this._joinToken;

    // The room's full roster arrives on `onJoined`, once the server actually
    // replies — not on the raw socket opening, which is what `net.connected`
    // reflects. Seeding the list from `net.connected` alone (as this used to)
    // meant a client joining an already-populated room only ever saw itself,
    // since the roster the server sent back was never read.
    this.net.onJoined = (msg) => {
      if (myAttempt !== this._joinToken) return;
      this.connecting = false;
      this.connected = true;
      this.players = msg.players.map((p) => ({ id: p.id, name: p.name, isLeader: p.isLeader === true }));
      this._render();
      sfx.levelUp();

      // Lets a friend's Friends tab offer a one-click Join instead of
      // reading this code out loud. A no-op for a signed-out or unnamed
      // player — see setHostingRoom(). Refreshed on an interval rather than
      // set once, so a long session doesn't age past HOSTING_FRESH_MS and
      // quietly stop being joinable.
      setHostingRoom(room);
      clearInterval(this._hostingTimer);
      this._hostingTimer = setInterval(() => setHostingRoom(room), 90 * 1000);
    };
    this.net.onPlayerJoin = (msg) => {
      // Never the leader — the leader is whoever the room already had before
      // anyone else could join it.
      this.players.push({ id: msg.playerId, name: msg.name, isLeader: false });
      this._render();
      sfx.pick();
    };
    this.net.onPlayerLeave = (msg) => {
      this.players = this.players.filter((p) => p.id !== msg.playerId);
      // Leadership may have just changed hands (see client.js /
      // room.js) — reflect it on whoever's left in the list so the "Host"
      // tag moves to the right name without waiting for a full re-join.
      for (const p of this.players) p.isLeader = p.id === this.net.leaderId;
      this._render();
    };
    // The run doesn't begin because YOU clicked Start — it begins because
    // the SERVER says it began, which happens for every client in the room
    // at once, leader included. This is what actually starts your own local
    // run; the button below only ever asks the server to fire this.
    this.net.onRunStarted = () => {
      if (this.onStartMulti !== null) this.onStartMulti();
    };

    this._wakeServer(server);

    const startedAt = Date.now();
    const RETRY_EVERY_MS = 4000;
    // Render's free tier can take up to ~60s to wake from asleep; give this
    // real margin past that rather than a number that only covers the
    // typical case.
    const GIVE_UP_AFTER_MS = 75000;
    // Only start telling the player "waking up" once it's gone on long
    // enough that plain "Connecting..." would start to look broken instead
    // of normal.
    const WAKING_UP_HINT_AFTER_MS = 8000;

    const attempt = () => {
      if (myAttempt !== this._joinToken) return;
      const elapsed = Date.now() - startedAt;

      if (elapsed > GIVE_UP_AFTER_MS) {
        this.connecting = false;
        this.wakingUp = false;
        this.net.disconnect();
        this._render();
        return;
      }

      if (elapsed > WAKING_UP_HINT_AFTER_MS && !this.wakingUp) {
        this.wakingUp = true;
        this._render();
      }

      this.net.connect(server, room, name);

      setTimeout(() => {
        if (myAttempt !== this._joinToken) return;
        if (!this.connected) attempt();
      }, RETRY_EVERY_MS);
    };

    attempt();
  }

  _onLeave() {
    this.leaveRoom();
  }

  /**
   * Disconnect and reset lobby state, whether the player clicked Leave or
   * main.js called this because a multiplayer run just ended.
   *
   * That second caller matters: returning to the Hub after a run (death,
   * "Return to Anchor") used to leave the WebSocket connection open with no
   * way to close it except this button. The server never heard a `leave`
   * for that player, so it kept them in the room — playing dummy input
   * forever — right up until they rejoined the SAME room code, which just
   * added a second, live connection for the same person. Both then got
   * rendered: one dead weight from the orphaned session, one you actually
   * controlled. That's the whole "multiple copies of myself" bug. Calling
   * this on the way back to the Hub means there is no orphaned connection
   * left over to collide with.
   */
  leaveRoom() {
    this._joinToken++; // stop any in-flight retry loop from a pending join
    this.net.disconnect();
    const wasConnected = this.connected;
    this.connected = false;
    this.connecting = false;
    this.wakingUp = false;
    this.players = [];
    this.roomCode = '';
    this._render();

    clearInterval(this._hostingTimer);
    this._hostingTimer = null;
    // Only worth a request if we'd actually published something to clear —
    // leaving a room that was never joined (or a retry that gave up) has
    // nothing on the player row to undo.
    if (wasConnected) clearHostingRoom();
  }

  _onStartMultiplayer() {
    if (!this.connected || this.net.playerId === null) return;
    // Doesn't start anything itself — asks the server to, which then tells
    // every client in the room (onRunStarted) to start together. The button
    // isn't even rendered for a non-leader, but the server is what actually
    // enforces this (see Room.startRun), not this early return.
    if (!this.net.isLeader()) return;
    this.net.startMultiplayerRun();
  }

  _render() {
    const root = this.root;
    if (root === null) return;

    let html = '';

    // Header
    html += '<h3>' + esc(t('mp.title', 'Multiplayer')) + '</h3>';
    html += '<p class="mp-desc">' + esc(t('mp.desc', 'Create or join a room to play with friends.')) + '</p>';

    if (!this.connected && !this.connecting) {
      // Connection form
      html += '<div class="mp-form">';

      html += '<label class="mp-label">' + esc(t('mp.name', 'Name')) + '</label>';
      html += `<input class="mp-input" data-mp="name" type="text" value="${esc(this.playerName)}" maxlength="20" placeholder="Drifter" />`;

      // No server address field. There is exactly one multiplayer server
      // this game talks to (_getDefaultServer(), pinned at build time via
      // VITE_MP_SERVER_URL) — showing an editable field for it invited
      // people to paste in whatever URL they had on hand (including plain
      // https:// links, which WebSocket can't use at all), for a value
      // nobody actually needed to touch.

      html += '<label class="mp-label">' + esc(t('mp.room', 'Room Code')) + '</label>';
      html += `<input class="mp-input" data-mp="room" type="text" value="" placeholder="default" maxlength="30" />`;

      html += '<div class="mp-form-actions">';
      html += `<button class="btn btn-mp-create" data-mp="create" type="button">`
        + esc(t('mp.createRoom', 'Create Room')) + '</button>';
      html += `<button class="btn btn-mp-join" data-mp="join" type="button">`
        + esc(t('mp.joinRoom', 'Join Room')) + '</button>';
      html += '</div>';

      html += '</div>';
    }

    if (this.connecting) {
      html += '<div class="mp-status mp-connecting">';
      html += '<div class="mp-spinner"></div>';
      html += esc(this.wakingUp ? t('mp.wakingUp') : t('mp.connecting'));
      html += '</div>';
    }

    if (this.connected) {
      // Room info
      html += '<div class="mp-room-info">';
      html += '<div class="mp-room-header">';
      html += '<span class="mp-room-label">' + esc(t('mp.room', 'Room')) + ': <strong>' + esc(this.roomCode) + '</strong></span>';
      html += `<button class="btn btn-ghost btn-sm" data-mp="leave" type="button">`
        + esc(t('mp.leave', 'Leave')) + '</button>';
      html += '</div>';

      // Player list
      html += '<div class="mp-players">';
      html += '<h4>' + esc(t('mp.players', 'Players')) + ' (' + this.players.length + ')</h4>';
      for (const p of this.players) {
        const isMe = p.id === this.net.playerId;
        html += `<div class="mp-player ${isMe ? 'mp-player-me' : ''}">`;
        html += '<span class="mp-player-dot"></span> ';
        html += esc(p.name);
        if (p.isLeader) html += ' <span class="mp-host-tag">' + esc(t('mp.host', 'Host')) + '</span>';
        if (isMe) html += ' <span class="mp-you">' + esc(t('mp.you', '(you)')) + '</span>';
        html += '</div>';
      }
      html += '</div>';

      // Only the leader gets a Start button — the server enforces this
      // regardless (see Room.startRun), but showing a button that would
      // just get silently ignored is worse than not showing one. Everyone
      // else, leader included, actually enters the run off the server's
      // `runStarted` broadcast (see onRunStarted below) rather than off
      // clicking anything themselves — one code path for "the run began"
      // instead of a special case for whoever happened to press the button.
      if (this.net.isLeader()) {
        html += `<button class="btn btn-start btn-mp-start" data-mp="start" type="button">`
          + esc(t('mp.startGame', 'Start Multiplayer Run')) + '</button>';
      } else {
        html += '<p class="mp-waiting">' + esc(t('mp.waitingForHost', 'Waiting for the host to start...')) + '</p>';
      }

      html += '</div>';
    }

    root.innerHTML = html;
  }

  /** Re-render when the tab becomes visible. */
  refresh() {
    this._render();
  }
}
