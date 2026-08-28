/**
 * server/index.js — WebSocket multiplayer server.
 *
 * Runs as a standalone Node.js process (not bundled by Vite).
 * Start with: node server/index.js
 *
 * Uses plain `ws` — no framework, no Express, no build step.
 * The server is authoritative: it owns the canonical game state and broadcasts
 * snapshots at 20 tick/s. Clients run prediction locally and reconcile
 * against the server's snapshot.
 */

import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { Room } from './room.js';

const PORT = parseInt(process.env.PORT ?? '3001', 10);
const TICK_RATE = 20;
const TICK_MS = 1000 / TICK_RATE;

// An explicit http.Server rather than handing `ws` a bare port. `ws` creates
// its own internal http.Server either way, but with no reference to it there
// is no way to answer a plain GET — and most PaaS free tiers (Render's
// included) health-check a web service over HTTP before routing traffic to
// it. Without this, the service can look "unhealthy" and get cycled even
// though the WebSocket half is working fine. Costs nothing on a host that
// doesn't health-check (Fly, localhost).
const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('fracture multiplayer server: ok');
});
const wss = new WebSocketServer({ server });
const rooms = new Map();

function getOrCreateRoom(roomId) {
  let room = rooms.get(roomId);
  if (room === undefined) {
    room = new Room(roomId);
    rooms.set(roomId, room);
  }
  return room;
}

wss.on('connection', (ws) => {
  let currentRoom = null;
  let playerId = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.type) {
      case 'join': {
        const roomId = msg.room ?? 'default';
        const room = getOrCreateRoom(roomId);
        playerId = room.addPlayer(ws, msg.name ?? 'Drifter');
        currentRoom = room;
        ws.send(JSON.stringify({
          type: 'joined',
          playerId,
          room: roomId,
          players: room.getPlayerList(),
          leaderId: room.leaderId,
          tick: room.tick,
        }));
        room.broadcast({
          type: 'playerJoined',
          playerId,
          name: msg.name ?? 'Drifter',
        }, ws);
        break;
      }

      case 'input': {
        if (currentRoom === null) break;
        currentRoom.queueInput(playerId, {
          seq: msg.seq,
          keys: msg.keys,
          tick: msg.tick,
        });
        break;
      }

      case 'ability': {
        if (currentRoom === null) break;
        currentRoom.queueAbility(playerId, {
          slot: msg.slot,
          tick: msg.tick,
        });
        break;
      }

      case 'startRun': {
        // startRun() itself re-checks playerId === leaderId — the switch
        // case having a currentRoom is not what makes this safe, the room's
        // own check is. A non-leader sending this is simply ignored.
        if (currentRoom !== null) currentRoom.startRun(playerId);
        break;
      }

      case 'leave': {
        if (currentRoom !== null) {
          currentRoom.removePlayer(playerId);
          ws.send(JSON.stringify({ type: 'left' }));
          currentRoom = null;
          playerId = null;
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    if (currentRoom !== null) {
      currentRoom.removePlayer(playerId);
      currentRoom = null;
      playerId = null;
    }
  });
});

// Server tick loop — advance room states at TICK_RATE
let lastTick = Date.now();
function tick() {
  const now = Date.now();
  const dt = (now - lastTick) / 1000;
  lastTick = now;

  for (const [id, room] of rooms) {
    room.update(dt);
    if (room.isEmpty()) {
      rooms.delete(id);
    }
  }
}

setInterval(tick, TICK_MS);

server.listen(PORT, () => {
  console.log(`[fracture] Multiplayer server listening on ws://localhost:${PORT}`);
  console.log(`[fracture] Tick rate: ${TICK_RATE}/s`);
});
