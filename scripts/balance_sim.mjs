/**
 * balance_sim.mjs — measure all 21 characters under identical conditions.
 *
 * Runs the REAL game systems (waves, enemies, weapons, abilities, XP/level-up)
 * under Node with a minimal canvas/DOM shim — no hand-rolled approximation of
 * combat. Movement is driven by a simple, uniform "flee the nearest enemy"
 * heuristic (there's no real pathing AI to reuse, and a stationary player
 * gets swarmed identically regardless of character — that measures spawn
 * pressure, not the character). Abilities and the ultimate are pressed the
 * instant they're off cooldown, since updateAbilities never auto-fires and
 * several kits lean on ability uptime as much as weapon DPS.
 *
 * Every character runs with an EMPTY profile (no gear, no loadout) at Normal
 * difficulty, across several seeds, so the only variable between runs is the
 * character itself.
 *
 * Usage: node scripts/balance_sim.mjs [seeds] [maxMinutes]
 */

// ---------------------------------------------------------------------------
// Minimal DOM/canvas shim — same recipe worked out earlier this session for
// verifying the Whip and boss-loot paths under plain Node.
// ---------------------------------------------------------------------------
globalThis.document = {
  createElement(tag) {
    if (tag !== 'canvas') throw new Error('unexpected element ' + tag);
    const ctx = {
      canvas: null,
      fillStyle: '', strokeStyle: '', globalAlpha: 1, globalCompositeOperation: 'source-over',
      lineWidth: 1, lineCap: 'butt', imageSmoothingEnabled: true,
    };
    const methods = ['fillRect', 'clearRect', 'beginPath', 'moveTo', 'lineTo', 'arc', 'closePath',
      'fill', 'stroke', 'drawImage', 'save', 'restore', 'translate', 'rotate', 'scale', 'setTransform',
      'createImageData', 'putImageData', 'getImageData', 'setLineDash'];
    for (const m of methods) ctx[m] = () => ({ data: new Uint8ClampedArray(4) });
    const canvas = { width: 8, height: 8, getContext: () => ctx };
    ctx.canvas = canvas;
    return canvas;
  },
};
const _storage = new Map();
globalThis.localStorage = {
  getItem: (k) => (_storage.has(k) ? _storage.get(k) : null),
  setItem: (k, v) => _storage.set(k, String(v)),
  removeItem: (k) => _storage.delete(k),
};
const noop = () => {};
const fakeWindow = {
  addEventListener: noop, removeEventListener: noop,
  localStorage: globalThis.localStorage,
  location: { href: 'http://localhost/', origin: 'http://localhost' },
  innerWidth: 1280, innerHeight: 720,
  requestAnimationFrame: (fn) => setTimeout(fn, 16),
  AudioContext: function () {
    return { createGain: () => ({ connect: noop, gain: { value: 1 } }), destination: {}, resume: async () => {}, state: 'running' };
  },
};
globalThis.window = fakeWindow;
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node', language: 'en' }, configurable: true });
globalThis.AudioContext = fakeWindow.AudioContext;
globalThis.Image = class { constructor() { this.onload = null; } set src(_v) { if (this.onload) this.onload(); } };

// ---------------------------------------------------------------------------
// Imports — mirrors main.js's own import list for the systems it ticks.
// ---------------------------------------------------------------------------
const { GameState, Phase } = await import('../src/game/state.js');
const { DIFFICULTIES } = await import('../src/game/config.js');
const { updatePlayer } = await import('../src/game/player.js');
const { updateEnemies, updateEnemyProjectiles, updateWalls, updateMortarShells } = await import('../src/game/enemies.js');
const { updateWaves } = await import('../src/game/waves.js');
const { updateWeapons, updateProjectiles, updateBeams, updateShockwaves, updateZones } = await import('../src/game/weapons.js');
const { updateDeployables, updateSweeps } = await import('../src/game/weaponBases.js');
const { registerBaseWeapons } = await import('../src/game/weaponGen.js');
const { updateOrbs } = await import('../src/game/xp.js');
const { updateEffects } = await import('../src/game/effects.js');
const { Inventory } = await import('../src/game/inventory.js');
const { rollArsenalChoices, applyArsenalChoice, seedInventory } = await import('../src/game/arsenalProgression.js');
const { updateCamera } = await import('../src/render/camera.js');
const { applyCharacter } = await import('../src/meta/applyCharacter.js');
const { createAbilityState, updateAbilities } = await import('../src/game/abilities.js');
const { CHARACTERS } = await import('../src/meta/characters.js');
const { Profile } = await import('../src/meta/profile.js');
const { rng } = await import('../src/core/rng.js');
const { getKeyBinding } = await import('../src/core/input.js');

registerBaseWeapons();

// ---------------------------------------------------------------------------
// Bot: flee the nearest enemy, press every ability/ultimate the instant
// it's ready.
// ---------------------------------------------------------------------------
function makeBotInput() {
  return {
    _moveVec: [0, 0],
    _pressed: new Set(),
    moveVector() { return this._moveVec; },
    wasPressed(code) { return this._pressed.has(code); },
    isDown() { return false; },
  };
}

const FLEE_RADIUS = 320;

function updateBotInput(input, state) {
  const p = state.player;
  // Sum a repulsion vector from every enemy within range, weighted by inverse
  // distance, rather than just the single nearest one — fleeing only the
  // closest threat is easy to corner (it just steers you into the next
  // closest one); this is the same "separation" idea a crowd of boids uses
  // and meaningfully cuts down on getting surrounded.
  let vx = 0, vy = 0;
  for (const e of state.enemies) {
    if (!e.alive) continue;
    const dx = p.x - e.x, dy = p.y - e.y;
    const d = Math.hypot(dx, dy);
    if (d > FLEE_RADIUS || d < 1) continue;
    const weight = (FLEE_RADIUS - d) / FLEE_RADIUS;
    vx += (dx / d) * weight;
    vy += (dy / d) * weight;
  }
  const mag = Math.hypot(vx, vy);
  input._moveVec = mag > 1e-3 ? [vx / mag, vy / mag] : [0, 0];

  input._pressed.clear();
  const ab = state.abilities;
  for (let i = 0; i < ab.slots.length; i++) {
    const slot = ab.slots[i];
    if (slot.ready && slot.cooldown <= 0) input._pressed.add(getKeyBinding('ability' + (i + 1)));
  }
  if (ab.ultimate.ready) input._pressed.add(getKeyBinding('ultimate'));
}

function autoLevelUp(state) {
  let guard = 0;
  while (state.phase === Phase.LEVEL_UP && guard++ < 200) {
    const choices = rollArsenalChoices(state);
    const choice = choices[Math.floor(rng.next() * choices.length)];
    applyArsenalChoice(state, choice);
    state.pendingLevelUps--;
    if (state.pendingLevelUps <= 0) state.phase = Phase.PLAYING;
  }
}

// ---------------------------------------------------------------------------
// One simulated run.
// ---------------------------------------------------------------------------
const VIEW_W = 1280, VIEW_H = 720;
const DT = 1 / 60;

function runOne(characterId, seed, maxSeconds) {
  rng.reset(seed);

  const profile = new Profile();
  profile.character = characterId;
  // applyCharacter() silently substitutes DEFAULT_CHARACTER for anything the
  // profile doesn't currently qualify for (isCharacterUnlocked) — exactly
  // right for a real save, but it means a fresh zero-milestone Profile would
  // secretly simulate Scavenger for every gated character. The balance pass
  // wants each character's own designed stats regardless of unlock status.
  profile.milestones = {
    bestWave: 999, bestTime: 999999, totalKills: 999999, runs: 999999,
    totalBossKills: 999999, totalPlaytime: 999999999,
  };

  const state = new GameState(seed);
  state.biome = 'wastes';
  state.difficulty = DIFFICULTIES.normal;
  state.inventory = new Inventory();

  const character = applyCharacter(state, profile);
  state.abilities = createAbilityState(character.id);
  seedInventory(state, character.weapon);
  state.bossUniquesOwned = [];

  const input = makeBotInput();

  while (state.time < maxSeconds && state.player.alive) {
    if (state.phase === Phase.LEVEL_UP) { autoLevelUp(state); continue; }

    updateBotInput(input, state);

    state.time += DT;
    updateWaves(state, DT, VIEW_W, VIEW_H);
    updatePlayer(state, DT, input);
    updateAbilities(state, DT, input);
    updateEnemies(state, DT);
    updateEnemyProjectiles(state, DT);
    updateWalls(state, DT);
    updateMortarShells(state, DT);
    updateWeapons(state, DT);
    updateProjectiles(state, DT);
    updateBeams(state, DT);
    updateShockwaves(state, DT);
    updateZones(state, DT);
    updateDeployables(state, DT);
    updateSweeps(state, DT);
    updateOrbs(state, DT);
    updateEffects(state, DT);
    updateCamera(state, DT, VIEW_W, VIEW_H);

    if (state.phase === Phase.LEVEL_UP) autoLevelUp(state);
  }

  return {
    time: state.time, wave: state.wave, kills: state.kills,
    damageDealt: state.damageDealt, survived: state.player.alive,
  };
}

// ---------------------------------------------------------------------------
// Run every character across N seeds, average, rank.
// ---------------------------------------------------------------------------
const SEEDS = Number(process.argv[2]) || 5;
const MAX_MINUTES = Number(process.argv[3]) || 25;
const MAX_SECONDS = MAX_MINUTES * 60;

const results = [];
for (const c of CHARACTERS) {
  const runs = [];
  for (let s = 0; s < SEEDS; s++) {
    runs.push(runOne(c.id, 1000 + s, MAX_SECONDS));
  }
  const avg = (key) => runs.reduce((sum, r) => sum + r[key], 0) / runs.length;
  results.push({
    id: c.id, name: c.name,
    time: avg('time'), wave: avg('wave'), kills: avg('kills'), damage: avg('damageDealt'),
    capped: runs.filter((r) => r.survived).length,
  });
}

// Composite score: average of each metric's rank (1 = best), so no single
// metric (e.g. a huge damage number from an AoE build) dominates the others.
function rankOf(list, key, higherIsBetter = true) {
  const sorted = [...list].sort((a, b) => higherIsBetter ? b[key] - a[key] : a[key] - b[key]);
  const rank = new Map();
  sorted.forEach((r, i) => rank.set(r.id, i + 1));
  return rank;
}
const rTime = rankOf(results, 'time');
const rWave = rankOf(results, 'wave');
const rKills = rankOf(results, 'kills');
const rDamage = rankOf(results, 'damage');
for (const r of results) {
  r.avgRank = (rTime.get(r.id) + rWave.get(r.id) + rKills.get(r.id) + rDamage.get(r.id)) / 4;
}
results.sort((a, b) => a.avgRank - b.avgRank);

const medianRank = results[Math.floor(results.length / 2)].avgRank;

console.log(`\nBalance simulation — ${SEEDS} seeds x ${results.length} characters, Normal, ${MAX_MINUTES}min cap, no gear\n`);
console.log(
  'rank'.padEnd(5) + 'character'.padEnd(18) + 'time(s)'.padEnd(10)
  + 'wave'.padEnd(8) + 'kills'.padEnd(9) + 'damage'.padEnd(11) + 'capped'.padEnd(8) + 'avgRank',
);
results.forEach((r, i) => {
  const outlier = Math.abs(r.avgRank - medianRank) > results.length * 0.25 ? '  <-- outlier' : '';
  console.log(
    String(i + 1).padEnd(5) + r.name.padEnd(18) + r.time.toFixed(0).padEnd(10)
    + r.wave.toFixed(1).padEnd(8) + r.kills.toFixed(0).padEnd(9) + r.damage.toFixed(0).padEnd(11)
    + (r.capped + '/' + SEEDS).padEnd(8) + r.avgRank.toFixed(2) + outlier,
  );
});
console.log(`\nMedian avgRank: ${medianRank.toFixed(2)} — flagged rows sit >25% of the roster size away from it.\n`);
