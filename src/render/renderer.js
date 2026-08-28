/**
 * renderer.js — all canvas drawing. Reads state, never mutates it.
 *
 * Performance notes, since a late run puts 400+ enemies and ~900 particles on
 * screen at once:
 *   - No `shadowBlur` in the hot loop. Glows are pre-rendered radial-gradient
 *     sprites, blitted with `drawImage` under the 'lighter' composite op.
 *   - Everything is culled against the viewport before drawing.
 *   - The draw loops allocate nothing per frame.
 */

import { ARENA, PLAYER, NODES, CHESTS, FX, BIOMES, ELITE } from '../game/config.js';
import { shakeOffset } from './camera.js';
import { TAU } from '../core/math.js';
import { drawSprite, corruptionVariant, animFrame, hasSprite } from './pixel.js';
import { registerAllSprites } from './spriteDefs.js';
import { quality, onSettingsChange } from '../meta/settings.js';
import { getKeyBinding } from '../core/input.js';
import { codeToLabel } from '../ui/keybindSettings.js';
import { arenaBounds } from '../game/state.js';
import { PASSIVES } from '../game/passives.js';
import { t } from '../i18n/i18n.js';

const NODE_RADIUS = NODES.radius;
const CHEST_RADIUS = CHESTS.radius;

// Mirrors the rarity palette in src/meta/gear.js. Duplicated rather than
// imported — the renderer stays free of any dependency on the meta layer, and
// three hex codes are cheap enough to keep in sync by hand.
const CHEST_COLORS = { common: '#9fb3c8', rare: '#ffb703', exotic: '#ff5ec4' };

const PALETTE = {
  bg: '#0a0d14',
  grid: '#141a26',
  gridMajor: '#1d2537',
  wall: '#33415c',
  orb: '#7ce7ff',
  orbCore: '#dffaff',
  shot: '#8ff0ff',
  shotCrit: '#fff3b0',
  player: '#4fd8ff',
};

// ---------------------------------------------------------------------------
// Glow sprite cache — a handful of small canvases, built once on first use.
// ---------------------------------------------------------------------------

const glowCache = new Map();

function getGlow(color, radius) {
  radius = Math.round(radius);
  const key = color + '|' + radius;
  const cached = glowCache.get(key);
  if (cached !== undefined) return cached;

  const size = Math.ceil(radius * 2);
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(radius, radius, 0, radius, radius, radius);
  grad.addColorStop(0, rgba(color, 0.85));
  grad.addColorStop(0.4, rgba(color, 0.28));
  grad.addColorStop(1, rgba(color, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);

  glowCache.set(key, c);
  return c;
}

function rgba(hex, alpha) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h;
  const n = parseInt(full, 16);
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')';
}

/** Linearly blend two hex colours by `ratioB` (0 = pure A, 1 = pure B). */
function mixRgba(hexA, hexB, ratioB, alpha) {
  const toRgb = (hex) => {
    const h = hex.replace('#', '');
    const full = h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h;
    const n = parseInt(full, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const [ar, ag, ab] = toRgb(hexA);
  const [br, bg, bb] = toRgb(hexB);
  const r = Math.round(ar + (br - ar) * ratioB);
  const g = Math.round(ag + (bg - ag) * ratioB);
  const b = Math.round(ab + (bb - ab) * ratioB);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

// ---------------------------------------------------------------------------

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.width = 0;
    this.height = 0;
    this.dpr = 1;

    // Sprite definitions are registered once here rather than at module load,
    // so the catalogue is built after config has settled and nothing
    // rasterises until something is actually drawn.
    registerAllSprites();
    // Wall-clock seconds, advanced in draw(). Sprite animation is driven off
    // real time rather than the simulation clock on purpose: idle animation
    // should keep playing during hit-stop and while the game is paused behind
    // a menu, or the world looks like it crashed rather than paused.
    this._clock = 0;
    this._lastFrameAt = 0;

    // Observe the element rather than resizing once at construction. The
    // stylesheet is imported from JS, so on first load the canvas can still
    // measure 0x0 when the constructor runs; without this the backing store
    // would stay 0x0 until the user happened to resize the window.
    this._observer = new ResizeObserver(() => this.resize());
    this._observer.observe(canvas);

    this.resize();

    // Changing quality changes the backing-store size, so the canvas has to be
    // rebuilt — otherwise Performance mode only takes effect on the next
    // window resize, which looks like the setting doing nothing.
    onSettingsChange(() => this.resize());
  }

  resize() {
    // Cap DPR: on a 3x display, rendering 400 enemies at native density costs
    // more than the extra sharpness is worth.
    // Quality caps the backing-store resolution. This is the largest single
    // performance lever available to a canvas game — it multiplies the number
    // of pixels shaded every frame — and it costs only sharpness, never
    // information, which is why Performance mode is allowed to touch it.
    const scale = quality().renderScale ?? 1;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2) * scale;

    // Fall back to the window if the element hasn't been laid out yet: a zero
    // width would also feed 0 into the spawn ring and the camera clamp.
    const w = this.canvas.clientWidth || window.innerWidth || 1280;
    const h = this.canvas.clientHeight || window.innerHeight || 720;

    this.width = w;
    this.height = h;

    const bw = Math.round(w * this.dpr);
    const bh = Math.round(h * this.dpr);
    // Assigning to width/height clears the canvas, so only touch it on change.
    if (this.canvas.width !== bw || this.canvas.height !== bh) {
      this.canvas.width = bw;
      this.canvas.height = bh;
    }
  }

  draw(state) {
    const ctx = this.ctx;
    const vw = this.width;
    const vh = this.height;

    const now = performance.now() / 1000;
    // Clamped so a backgrounded tab returning after a long pause doesn't jump
    // every animation forward by thousands of frames at once.
    if (this._lastFrameAt !== 0) this._clock += Math.min(0.1, now - this._lastFrameAt);
    this._lastFrameAt = now;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = PALETTE.bg;
    ctx.fillRect(0, 0, vw, vh);

    const shake = shakeOffset(state);
    const camX = state.camera.x + shake[0];
    const camY = state.camera.y + shake[1];

    ctx.translate(Math.round(vw / 2 - camX), Math.round(vh / 2 - camY));

    const left = camX - vw / 2;
    const right = camX + vw / 2;
    const top = camY - vh / 2;
    const bottom = camY + vh / 2;

    // Draw order is layered like the fiction: ground effects underfoot, then
    // the crowd, then everything the player is doing on top of it.
    // One quality lookup per frame, passed down rather than re-read in every
    // helper — these run per entity, and a settings read inside a hot loop is
    // exactly the kind of thing that makes a "performance" mode slower.
    const q = quality();

    if (q.floorDetail) this._drawFloor(ctx, state, left, right, top, bottom);
    this._drawBiomeHazards(ctx, state, left, right, top, bottom);
    this._drawZones(ctx, state, left, right, top, bottom);
    this._drawWalls(ctx, state, left, right, top, bottom);
    this._drawNodes(ctx, state, left, right, top, bottom);
    this._drawChests(ctx, state, left, right, top, bottom);
    this._drawOrbs(ctx, state, left, right, top, bottom);
    this._drawEnemies(ctx, state, left, right, top, bottom);
    this._drawEnemyProjectiles(ctx, state, left, right, top, bottom);
    this._drawMortarShells(ctx, state, left, right, top, bottom);
    this._drawShockwaves(ctx, state);
    this._drawBlasts(ctx, state);
    this._drawBeams(ctx, state);
    this._drawArcs(ctx, state);
    this._drawOrbiters(ctx, state);
    this._drawDeployables(ctx, state, left, right, top, bottom);
    this._drawSweeps(ctx, state);
    this._drawProjectiles(ctx, state, left, right, top, bottom);
    this._drawPlayer(ctx, state);
    this._drawRemotePlayers(ctx, state);
    if (q.particleScale > 0 || state.particles.length > 0) {
      this._drawParticles(ctx, state, left, right, top, bottom);
    }
    // Text rasterisation is costly per glyph and there can be dozens of
    // numbers alive at once in a heavy wave. The health bar and hit flash
    // still convey that damage happened.
    if (q.damageNumbers) this._drawDamageNumbers(ctx, state, left, right, top, bottom);
    this._drawChestReveal(ctx, state);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this._drawNodeMarkers(ctx, state, vw, vh, camX, camY);
    this._drawChestMarkers(ctx, state, vw, vh, camX, camY);
    this._drawBossBar(ctx, state, vw, vh);
    this._drawInventoryStrip(ctx, state, vw, vh);
    this._drawAbilityBar(ctx, state, vw, vh);
    this._drawUltimateBanner(ctx, state, vw, vh);
    this._drawComboCounter(ctx, state, vw, vh);
    if (q.vignette) this._drawVignette(ctx, state, vw, vh);
    if (q.critFlash) this._drawCritFlash(ctx, state, vw, vh);
  }

  _drawFloor(ctx, state, left, right, top, bottom) {
    const step = ARENA.gridSize;
    const major = step * 5;

    const x0 = Math.max(0, Math.floor(left / step) * step);
    const x1 = Math.min(ARENA.width, Math.ceil(right / step) * step);
    const y0 = Math.max(0, Math.floor(top / step) * step);
    const y1 = Math.min(ARENA.height, Math.ceil(bottom / step) * step);

    const clipTop = Math.max(0, top);
    const clipBottom = Math.min(ARENA.height, bottom);
    const clipLeft = Math.max(0, left);
    const clipRight = Math.min(ARENA.width, right);

    // Biome tint: a flat colour wash under the grid, so a run reads as a
    // different place at a glance without touching the grid lines themselves.
    const biome = BIOMES[state.biome] ?? BIOMES.wastes;
    if (biome.floorTint !== null) {
      ctx.fillStyle = biome.floorTint;
      ctx.fillRect(clipLeft, clipTop, clipRight - clipLeft, clipBottom - clipTop);
    }

    // Minor lines then major lines: two stroke styles per frame, not one per line.
    ctx.lineWidth = 1;
    ctx.strokeStyle = PALETTE.grid;
    ctx.beginPath();
    for (let x = x0; x <= x1; x += step) {
      if (x % major === 0) continue;
      ctx.moveTo(x + 0.5, clipTop);
      ctx.lineTo(x + 0.5, clipBottom);
    }
    for (let y = y0; y <= y1; y += step) {
      if (y % major === 0) continue;
      ctx.moveTo(clipLeft, y + 0.5);
      ctx.lineTo(clipRight, y + 0.5);
    }
    ctx.stroke();

    ctx.strokeStyle = PALETTE.gridMajor;
    ctx.beginPath();
    for (let x = x0; x <= x1; x += step) {
      if (x % major !== 0) continue;
      ctx.moveTo(x + 0.5, clipTop);
      ctx.lineTo(x + 0.5, clipBottom);
    }
    for (let y = y0; y <= y1; y += step) {
      if (y % major !== 0) continue;
      ctx.moveTo(clipLeft, y + 0.5);
      ctx.lineTo(clipRight, y + 0.5);
    }
    ctx.stroke();

    ctx.strokeStyle = biome.wallColor;
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, ARENA.width, ARENA.height);

    // While a boss fight has shrunk the play area (see arenaBounds/waves.js),
    // draw its own walls too — otherwise the camera is clamped tight around a
    // box the player can't see the edge of, and "the arena got smaller" has
    // no visible read at all.
    const bounds = arenaBounds(state);
    if (state.arenaBounds !== null) {
      ctx.strokeStyle = '#ff5c5c';
      ctx.lineWidth = 4;
      ctx.setLineDash([14, 10]);
      ctx.strokeRect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
      ctx.setLineDash([]);
    }
  }

  _drawOrbs(ctx, state, left, right, top, bottom) {
    const orbs = state.orbs;
    if (orbs.length === 0) return;

    const xpGlow = getGlow(PALETTE.orb, 16);

    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < orbs.length; i++) {
      const o = orbs[i];
      if (o.x < left - 24 || o.x > right + 24 || o.y < top - 24 || o.y > bottom + 24) continue;
      // Material motes share the orb entity but carry their own colour, and are
      // drawn bigger — a rare drop should be visible across a busy screen.
      const isMat = o.kind === 'material';
      const g = isMat ? getGlow(o.color, 22) : xpGlow;
      const size = isMat ? 46 : 32;
      ctx.drawImage(g, o.x - size / 2, o.y - size / 2, size, size);
    }
    ctx.globalCompositeOperation = 'source-over';

    for (let i = 0; i < orbs.length; i++) {
      const o = orbs[i];
      if (o.x < left - 24 || o.x > right + 24 || o.y < top - 24 || o.y > bottom + 24) continue;
      const y = o.y + Math.sin(o.bob) * 1.2;
      const frame = animFrame(this._clock + o.bob * 0.2, 6, 4);
      // Materials are gems, XP is a mote — a different silhouette, not just a
      // different colour, so a rare drop is spottable across a busy screen.
      const key = o.kind === 'material' ? 'orb:mat:' + (o.material ?? 'slag') : 'orb:xp';
      drawSprite(ctx, key, o.x, y, { frame });
    }
  }

  /** Resonant nodes: a slowly pulsing crystal with a warning ring as it expires. */
  _drawNodes(ctx, state, left, right, top, bottom) {
    const nodes = state.nodes;
    if (nodes.length === 0) return;

    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.x < left - 80 || n.x > right + 80 || n.y < top - 80 || n.y > bottom + 80) continue;

      const pulse = 1 + Math.sin(n.pulse) * 0.12;
      const r = NODE_RADIUS * pulse;

      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(getGlow('#ffe9a8', 54), n.x - 54, n.y - 54, 108, 108);
      ctx.globalCompositeOperation = 'source-over';

      // Hexagonal crystal sprite, so it can't be mistaken for a Warped
      // silhouette — no enemy in the roster uses a spinning hex.
      drawSprite(ctx, 'node', n.x, n.y, {
        frame: animFrame(this._clock + n.pulse * 0.2, 5, 4),
        scale: pulse,
      });

      // Remaining-life ring, so the player can judge whether the detour is
      // still worth making.
      const frac = n.life / n.maxLife;
      ctx.strokeStyle = frac < 0.25 ? 'rgba(255,90,122,0.9)' : 'rgba(255,233,168,0.55)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(n.x, n.y, r + 12, -Math.PI / 2, -Math.PI / 2 + TAU * frac);
      ctx.stroke();
    }
  }

  /**
   * Screen-edge markers for nodes that are off camera. Nodes deliberately spawn
   * outside the viewport, so without this they would be invisible content.
   */
  _drawNodeMarkers(ctx, state, vw, vh, camX, camY) {
    const nodes = state.nodes;
    if (nodes.length === 0) return;

    const pad = 30;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const sx = n.x - camX + vw / 2;
      const sy = n.y - camY + vh / 2;
      if (sx >= pad && sx <= vw - pad && sy >= pad && sy <= vh - pad) continue;

      const cx = vw / 2, cy = vh / 2;
      const angle = Math.atan2(sy - cy, sx - cx);
      // Clamp the marker to the inside edge of the viewport.
      const mx = Math.max(pad, Math.min(vw - pad, cx + Math.cos(angle) * vw));
      const my = Math.max(pad, Math.min(vh - pad, cy + Math.sin(angle) * vh));

      ctx.save();
      ctx.translate(mx, my);
      ctx.rotate(angle);
      ctx.fillStyle = 'rgba(255, 233, 168, 0.92)';
      ctx.beginPath();
      ctx.moveTo(11, 0);
      ctx.lineTo(-8, -7);
      ctx.lineTo(-8, 7);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      const dist = Math.round(Math.hypot(n.x - camX, n.y - camY));
      ctx.font = '600 10px ui-monospace, monospace';
      ctx.fillStyle = 'rgba(255, 233, 168, 0.75)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(dist + 'm', mx, my + 17);
    }
  }

  /**
   * Chests. A box silhouette rather than a node's hexagon or an orb's circle —
   * three shapes already carry meaning in this game (crystal = resource,
   * circle = pickup), so a chest needed its own, and a box reads as "container"
   * without needing a label. Colour carries rarity, same palette as gear.
   */
  _drawChests(ctx, state, left, right, top, bottom) {
    const chests = state.chests;
    if (chests.length === 0) return;

    for (let i = 0; i < chests.length; i++) {
      const c = chests[i];
      if (c.x < left - 60 || c.x > right + 60 || c.y < top - 60 || c.y > bottom + 60) continue;

      const color = CHEST_COLORS[c.tier] ?? CHEST_COLORS.common;
      const pulse = 1 + Math.sin(c.pulse) * 0.1;
      const r = CHEST_RADIUS * pulse;

      ctx.globalCompositeOperation = 'lighter';
      const glowSize = c.tier === 'exotic' ? 60 : c.tier === 'rare' ? 50 : 42;
      ctx.drawImage(getGlow(color, glowSize), c.x - glowSize, c.y - glowSize, glowSize * 2, glowSize * 2);
      ctx.globalCompositeOperation = 'source-over';

      // Chest body as a pixel sprite, one per rarity — the lid lifts on the
      // last animation frame so a waiting chest reads as impatient.
      drawSprite(ctx, 'chest:' + (c.tier ?? 'common'), c.x, c.y, {
        frame: animFrame(this._clock + c.pulse * 0.3, 4, 4),
        scale: pulse,
      });

      // Exotic chests additionally get slow-orbiting motes, so the rarest tier
      // is unmistakable even in a crowd of regular enemies.
      if (c.tier === 'exotic') {
        ctx.fillStyle = color;
        for (let k = 0; k < 3; k++) {
          const a = c.pulse * 1.4 + (k * TAU) / 3;
          const ox = c.x + Math.cos(a) * (r + 10);
          const oy = c.y + Math.sin(a) * (r + 10) * 0.6;
          ctx.beginPath();
          ctx.arc(ox, oy, 2, 0, TAU);
          ctx.fill();
        }
      }

      const frac = c.life / c.maxLife;
      if (frac < 0.3) {
        ctx.strokeStyle = 'rgba(255,90,122,0.7)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(c.x, c.y, r + 10, -Math.PI / 2, -Math.PI / 2 + TAU * frac);
        ctx.stroke();
      }
    }
  }

  /** Screen-edge markers, but only for chests found in the open — a chest an
   *  enemy just dropped is already on-screen where you're fighting, so it
   *  doesn't need one. */
  _drawChestMarkers(ctx, state, vw, vh, camX, camY) {
    const found = state.chests.filter((c) => c.source === 'found');
    if (found.length === 0) return;

    const pad = 30;
    for (let i = 0; i < found.length; i++) {
      const c = found[i];
      const sx = c.x - camX + vw / 2;
      const sy = c.y - camY + vh / 2;
      if (sx >= pad && sx <= vw - pad && sy >= pad && sy <= vh - pad) continue;

      const cx = vw / 2, cy = vh / 2;
      const angle = Math.atan2(sy - cy, sx - cx);
      const mx = Math.max(pad, Math.min(vw - pad, cx + Math.cos(angle) * vw));
      const my = Math.max(pad, Math.min(vh - pad, cy + Math.sin(angle) * vh));
      const color = CHEST_COLORS[c.tier] ?? CHEST_COLORS.common;

      ctx.save();
      ctx.translate(mx, my);
      ctx.rotate(angle);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(11, 0);
      ctx.lineTo(-8, -7);
      ctx.lineTo(-8, 7);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  /**
   * The reveal after opening a chest: a floating summary that rises and fades
   * at the point it was opened, world-space so it scrolls with the camera
   * rather than pinning to the screen. This — not an instant popup — is what's
   * supposed to sell "an event happened here."
   */
  _drawChestReveal(ctx, state) {
    const r = state.chestReveal;
    if (r === null) return;

    const t = r.age / FX.chestRevealDuration;
    const rise = t * 46;
    const alpha = t < 0.15 ? t / 0.15 : Math.max(0, 1 - (t - 0.55) / 0.45);
    if (alpha <= 0) return;

    // An evolution overrides the chest's own colour and headline — it is by far
    // the most important thing that just happened, and it should not be the
    // third line of a materials list.
    const evolved = r.evolutionName !== null && r.evolutionName !== undefined;
    const color = evolved ? '#ffd166' : (CHEST_COLORS[r.tier] ?? CHEST_COLORS.common);
    const lines = [];
    const tierName = { common: 'Chest', rare: 'Rare Chest', exotic: 'Exotic Chest' }[r.tier] ?? 'Chest';
    lines.push(evolved ? 'EVOLVED — ' + r.evolutionName : tierName);
    if (r.gearName !== null) lines.push(r.gearRarity + ' — ' + r.gearName);
    // Capitalised inline rather than importing the meta-layer's material name
    // table — the renderer otherwise has zero dependency on `src/meta/`, and
    // an id like "alloy" reads fine as "Alloy" without a lookup.
    const matBits = Object.entries(r.materials).map(([id, n]) =>
      '+' + n + ' ' + id.charAt(0).toUpperCase() + id.slice(1));
    if (matBits.length > 0) lines.push(matBits.join('  '));
    if (r.currency > 0) lines.push('+' + r.currency + ' Scrip');

    const x = r.x, y = r.y - 34 - rise;
    ctx.textAlign = 'center';
    ctx.globalAlpha = alpha;

    ctx.font = '700 13px ui-monospace, monospace';
    ctx.fillStyle = color;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(lines[0], x, y);

    ctx.font = '600 11px ui-monospace, monospace';
    ctx.fillStyle = '#e8fbff';
    for (let i = 1; i < lines.length; i++) {
      ctx.fillText(lines[i], x, y + 16 * i);
    }

    ctx.globalAlpha = 1;
  }

  _drawEnemies(ctx, state, left, right, top, bottom) {
    const enemies = state.enemies;
    const pad = 40;

    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      // Killed by a projectile later in this same tick; cleaned up next tick.
      if (!e.alive) continue;
      if (e.x < left - pad || e.x > right + pad || e.y < top - pad || e.y > bottom + pad) continue;

      const fading = e.spawnFade > 0;
      if (fading) ctx.globalAlpha = 1 - e.spawnFade / 0.25;

      // Elite: a persistent rotating dashed ring, tinted toward its specific
      // modifier's colour, so "this one's different" reads before you're
      // even close enough to see its own telegraphs — the whole point of
      // asking for elites to be identifiable at a glance.
      if (e.elite !== null) this._drawEliteRing(ctx, e);

      // Speed Aura: a soft persistent radius, breathing gently — not a
      // telegraph (it's not about to attack), but still needs to read as "an
      // active effect happening here" the same way a biome hazard does.
      if (e.elite === 'speedAura') {
        const pulse = 0.85 + Math.sin(e.wobble * 0.5) * 0.08;
        const rr = ELITE.speedAura.radius * pulse;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha *= 0.18;
        ctx.drawImage(getGlow(ELITE.speedAura.color, rr), e.x - rr, e.y - rr, rr * 2, rr * 2);
        ctx.globalAlpha = fading ? 1 - e.spawnFade / 0.25 : 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = rgba(ELITE.speedAura.color, 0.22);
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 7]);
        ctx.beginPath();
        ctx.arc(e.x, e.y, rr, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Charger telegraph: a bright expanding ring, readable at a glance.
      if (e.dashState === 'windup') {
        const t = 1 - e.dashTime / e.type.dash.windup;
        ctx.strokeStyle = 'rgba(255,255,255,' + (0.25 + 0.75 * (1 - t)) + ')';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.radius + 6 + t * 10, 0, TAU);
        ctx.stroke();
        this._drawTrajectoryLine(ctx, e.x, e.y, e.dashDirX, e.dashDirY, e.type.dash.speed * e.type.dash.duration, t);
      }

      // Boss charge telegraph: same shape as Charger's windup, but a charge
      // covers real distance in a straight line, so a directional trajectory
      // line matters here more than the ring does — it's the difference
      // between "stay away from me" and "get off this line".
      if (e.chargeState === 'windup') {
        const t = 1 - e.chargeTime / e.type.bossCharge.windup;
        ctx.strokeStyle = 'rgba(255,255,255,' + (0.25 + 0.75 * (1 - t)) + ')';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.radius + 8 + t * 12, 0, TAU);
        ctx.stroke();
        this._drawTrajectoryLine(ctx, e.x, e.y, e.chargeDirX, e.chargeDirY, e.type.bossCharge.speed * e.type.bossCharge.duration, t);
      }

      // Boss slam telegraph: identical language to Husk's own — an expanding
      // ring sized to exactly what the blast will reach.
      if (e.slamState === 'priming') {
        const t = 1 - e.slamTime / e.type.slam.windup;
        const rr = e.type.slam.radius * (0.35 + 0.65 * t);
        ctx.strokeStyle = 'rgba(255,59,59,' + (0.2 + 0.55 * t) + ')';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([5, 6]);
        ctx.beginPath();
        ctx.arc(e.x, e.y, rr, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Lurker/Warden telegraph: a tightening ring around the shooter itself
      // — it's rooted, so the tell has nowhere else to be — plus a red
      // trajectory line toward the current aim point, so the *direction* is
      // readable too, not just the timing.
      if (e.rangedWindup > 0) {
        const t = 1 - e.rangedWindup / e.type.ranged.windup;
        ctx.strokeStyle = 'rgba(77,255,176,' + (0.3 + 0.6 * t) + ')';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.radius + 10 - t * 4, 0, TAU);
        ctx.stroke();

        const p = state.player;
        const dx = p.x - e.x, dy = p.y - e.y;
        const d = Math.hypot(dx, dy) || 1;
        ctx.strokeStyle = 'rgba(255,59,59,' + (0.15 + 0.45 * t) + ')';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 6]);
        ctx.beginPath();
        ctx.moveTo(e.x, e.y);
        ctx.lineTo(e.x + (dx / d) * e.type.ranged.maxRange, e.y + (dy / d) * e.type.ranged.maxRange);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Husk telegraph: an expanding ring sized to the actual blast radius —
      // what you see is exactly what the explosion will reach, not a hint of it.
      if (e.detonateState === 'priming') {
        const t = 1 - e.detonateTime / e.type.detonate.windup;
        const rr = e.type.detonate.blastRadius * (0.35 + 0.65 * t);
        ctx.strokeStyle = 'rgba(255,59,59,' + (0.2 + 0.55 * t) + ')';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([5, 6]);
        ctx.beginPath();
        ctx.arc(e.x, e.y, rr, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // The Warped body, as a pixel sprite.
      //
      // Three channels stack without competing, because each uses a different
      // property of the sprite: `variant` carries corruption (how far gone it
      // is) or the white hit-flash; the animation frame carries idle motion;
      // and burning is an additive overlay pass rather than a recolour, so a
      // burning *and* corrupted enemy still reads as both at once.
      const elite = e.elite !== null && e.elite !== undefined;
      // Elites render visibly more Ichor-eaten than their base type — the
      // corruption scale doubles as the danger scale, so a more dangerous
      // version of a familiar enemy should look further gone.
      const corruption = Math.min(1, (e.type.corruption ?? 0.2) + (elite ? 0.3 : 0));
      const variant = e.hitFlash > 0.05 ? 'flash' : corruptionVariant(corruption);
      const frame = animFrame(this._clock + e.wobble * 0.1, 6, 3);
      const spriteScale = e.radius / e.type.radius;   // elites are 1.2x
      const heading = Math.atan2(e.vy, e.vx);

      drawSprite(ctx, 'enemy:' + e.type.id, e.x, e.y, {
        frame, variant, angle: heading, scale: spriteScale,
      });

      // Burning: an additive fire wash over the sprite it is already on top
      // of, rather than swapping the body colour out for orange. Keeps the
      // silhouette and the corruption read intact underneath.
      if (e.burnTime > 0) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.4;
        const g = getGlow('#ff8a3d', e.radius * 1.3);
        ctx.drawImage(g, e.x - e.radius * 1.3, e.y - e.radius * 1.3, e.radius * 2.6, e.radius * 2.6);
        ctx.globalAlpha = fading ? 1 - e.spawnFade / 0.25 : 1;
        ctx.globalCompositeOperation = 'source-over';
      }

      if (e.markTime > 0) {
        ctx.strokeStyle = 'rgba(255,94,196,0.85)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.radius + 5, 0, TAU);
        ctx.stroke();
      }

      // Health bar only for chunky enemies that have actually been hurt — one
      // per grunt would bury the screen in UI.
      if (e.maxHp > 40 && e.hp < e.maxHp) {
        const w = e.radius * 2;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(e.x - w / 2, e.y - e.radius - 9, w, 3);
        ctx.fillStyle = '#ff5a7a';
        ctx.fillRect(e.x - w / 2, e.y - e.radius - 9, w * (e.hp / e.maxHp), 3);
      }

      if (fading) ctx.globalAlpha = 1;
    }
  }

  /**
   * The shared "this is an elite" tell: a dashed ring, bigger and rotating
   * (so it never looks static even when the enemy itself is standing still),
   * coloured toward gold with a shift from its specific modifier's own
   * colour mixed in — gold alone says "elite", the shift says "which kind",
   * without needing a whole second symbol.
   */
  _drawEliteRing(ctx, e) {
    // The ring itself is information (this enemy is an elite), so Performance
    // mode keeps it — it just draws it flat instead of as a layered glow.
    const glows = quality().glows;
    const cfg = ELITE[e.elite];
    const rr = e.radius + 9;
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(e.eliteSpin);
    ctx.strokeStyle = mixRgba('#ffe066', cfg.color, 0.45, 0.8);
    ctx.lineWidth = 2.2;
    ctx.setLineDash([rr * 0.55, rr * 0.4]);
    ctx.beginPath();
    ctx.arc(0, 0, rr, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    e.eliteSpin += 0.03;
  }

  /**
   * A fading red dashed line along a locked-in direction, for any attack
   * that's about to cover ground in a straight line (a charge) rather than
   * hit a radius around the attacker — a ring says "stay back", a line says
   * "get off this line", and a charge is squarely the second kind of threat.
   */
  _drawTrajectoryLine(ctx, x, y, dirX, dirY, range, t) {
    ctx.strokeStyle = 'rgba(255,59,59,' + (0.18 + 0.5 * t) + ')';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + dirX * range, y + dirY * range);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /**
   * Enemy bolts. Deliberately a different visual language from the player's
   * own shots — a hot red core instead of cyan/amber — so "is that mine or
   * theirs" is never a question mid-fight.
   */
  _drawEnemyProjectiles(ctx, state, left, right, top, bottom) {
    const bolts = state.enemyProjectiles;
    if (bolts.length === 0) return;

    const glow = getGlow('#ff3b3b', 16);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < bolts.length; i++) {
      const b = bolts[i];
      if (b.x < left - 24 || b.x > right + 24 || b.y < top - 24 || b.y > bottom + 24) continue;
      ctx.drawImage(glow, b.x - 16, b.y - 16, 32, 32);
    }
    ctx.globalCompositeOperation = 'source-over';

    ctx.fillStyle = '#ffdada';
    for (let i = 0; i < bolts.length; i++) {
      const b = bolts[i];
      if (b.x < left - 24 || b.x > right + 24 || b.y < top - 24 || b.y > bottom + 24) continue;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.radius * 0.62, 0, TAU);
      ctx.fill();
    }
  }

  /**
   * Turrets, companions and mines. Each gets a distinct silhouette rather
   * than a shared dot, because they mean completely different things: a
   * turret is ground you chose to hold, a companion is damage that follows
   * you, and a mine is a decision you already made about where the crowd
   * will be. All three are drawn with the pixel pipeline's blocky vocabulary
   * so they sit with the sprites rather than on top of them.
   */
  _drawDeployables(ctx, state, left, right, top, bottom) {
    const list = state.deployables;
    if (list.length === 0) return;

    for (let i = 0; i < list.length; i++) {
      const d = list[i];
      if (d.x < left - 60 || d.x > right + 60 || d.y < top - 60 || d.y > bottom + 60) continue;

      // Everything blinks out over its last half-second, so an expiring
      // deployable never just vanishes mid-fight without warning.
      const ending = d.life < 0.6 && Math.floor(d.life * 12) % 2 === 0;
      ctx.globalAlpha = ending ? 0.35 : 1;

      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(getGlow(d.color, 26), d.x - 26, d.y - 26, 52, 52);
      ctx.globalCompositeOperation = 'source-over';

      if (d.kind === 'turret') {
        // A squat blocky emplacement with a rotating barrel.
        ctx.fillStyle = '#141a26';
        ctx.fillRect(d.x - 9, d.y - 6, 18, 13);
        ctx.fillStyle = d.color;
        ctx.fillRect(d.x - 9, d.y - 6, 18, 4);
        ctx.fillRect(d.x - 7, d.y + 4, 14, 3);
        ctx.save();
        ctx.translate(d.x, d.y);
        ctx.rotate(d.spin);
        ctx.fillStyle = d.color;
        ctx.fillRect(0, -2, 14, 4);
        ctx.restore();
      } else if (d.kind === 'companion') {
        // A small hovering chassis with a single bright optic.
        const bob = Math.sin(this._clock * 6 + d.orbit) * 2;
        ctx.fillStyle = '#141a26';
        ctx.fillRect(d.x - 7, d.y - 5 + bob, 14, 10);
        ctx.fillStyle = d.color;
        ctx.fillRect(d.x - 7, d.y - 5 + bob, 14, 3);
        ctx.fillRect(d.x - 9, d.y - 1 + bob, 3, 3);
        ctx.fillRect(d.x + 6, d.y - 1 + bob, 3, 3);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(d.x - 2, d.y + bob, 4, 3);
      } else if (d.kind === 'mine') {
        // A pulsing charge — faster as it nears expiry, so the pulse rate
        // itself tells you how long it has left without a timer bar.
        const armed = d.armTime <= 0;
        const rate = armed ? 5 + (1 - d.life / d.maxLife) * 8 : 2;
        const pulse = 0.5 + Math.sin(this._clock * rate) * 0.5;
        const r = 6 + pulse * 2;
        ctx.fillStyle = '#141a26';
        ctx.beginPath();
        ctx.arc(d.x, d.y, r, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = armed ? d.color : 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.fillStyle = armed ? d.color : '#5a6577';
        ctx.beginPath();
        ctx.arc(d.x, d.y, 2.5 + pulse * 1.5, 0, TAU);
        ctx.fill();
        // Trigger radius, faint, so its actual reach is readable.
        if (armed) {
          ctx.strokeStyle = rgba(d.color, 0.13 + pulse * 0.1);
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 6]);
          ctx.beginPath();
          ctx.arc(d.x, d.y, d.trigger, 0, TAU);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  /**
   * Melee sweeps and aura pulses. Drawn as a filled wedge (or full ring)
   * that fades over its short life — the shape is exactly the area that was
   * already damaged, so what you see is a truthful record of what was hit,
   * not a decoration approximating it.
   */
  _drawSweeps(ctx, state) {
    const sweeps = state.sweeps;
    if (sweeps.length === 0) return;

    for (let i = 0; i < sweeps.length; i++) {
      const s = sweeps[i];
      const t = s.life / s.maxLife;          // 1 -> 0 over the sweep's life
      const progress = 1 - t;                // 0 -> 1, how far through the motion

      if (s.melee === true) {
        this._drawMeleeMotion(ctx, s, progress, t);
        continue;
      }

      // Non-melee sweeps (Bleedfield's aura pulse) stay a simple ring.
      if (s.ring === true) {
        ctx.strokeStyle = rgba(s.color, t * 0.55);
        ctx.lineWidth = 3 + (1 - t) * 4;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.radius * (0.86 + (1 - t) * 0.18), 0, TAU);
        ctx.stroke();
        continue;
      }

      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = t * 0.4;
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.arc(s.x, s.y, s.radius, s.facing - s.arc / 2, s.facing + s.arc / 2);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

      ctx.strokeStyle = rgba('#ffffff', t * 0.8);
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.radius, s.facing - s.arc / 2, s.facing + s.arc / 2);
      ctx.stroke();
    }
  }

  /**
   * The four melee motions.
   *
   * All of them animate off `progress` (0 at the start of the swing, 1 at the
   * end) rather than drawing a fixed shape and fading it. That is the entire
   * difference between "a hitbox with a decoration" and something that reads
   * as a swing: the blade has to actually travel, and it has to leave a trail
   * behind where it has been.
   */
  _drawMeleeMotion(ctx, s, progress, t) {
    // Ease-out: a swing is fast at the start and decelerates. Linear motion
    // reads as mechanical — this is most of what makes it feel like weight.
    const eased = 1 - Math.pow(1 - progress, 2.2);

    if (s.kind === 'slam') {
      // Expanding shockwave ring plus a bright inner flash. No facing, so the
      // whole read is "everything around you, right now".
      const r = s.radius * (0.25 + eased * 0.85);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = t * 0.5;
      ctx.drawImage(getGlow(s.color, r), s.x - r, s.y - r, r * 2, r * 2);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

      ctx.strokeStyle = rgba('#ffffff', t * 0.9);
      ctx.lineWidth = 3 + t * 5;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = rgba(s.color, t * 0.7);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r * 0.72, 0, TAU);
      ctx.stroke();
      return;
    }

    if (s.kind === 'thrust') {
      // Extends fast, retracts slower — a lunge, not a laser. The blade is a
      // tapered quad so it reads as a point going in rather than a bar.
      const out = progress < 0.4 ? progress / 0.4 : 1 - (progress - 0.4) / 0.6;
      const reach = s.radius * (0.35 + out * 0.65);
      const cos = Math.cos(s.facing), sin = Math.sin(s.facing);
      const nx = -sin, ny = cos;
      const halfW = 7 * (0.5 + out * 0.5);

      ctx.fillStyle = rgba(s.color, 0.35 + t * 0.45);
      ctx.beginPath();
      ctx.moveTo(s.x + nx * halfW, s.y + ny * halfW);
      ctx.lineTo(s.x + cos * reach, s.y + sin * reach);
      ctx.lineTo(s.x - nx * halfW, s.y - ny * halfW);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = rgba('#ffffff', t * 0.95);
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(s.x + cos * s.radius * 0.2, s.y + sin * s.radius * 0.2);
      ctx.lineTo(s.x + cos * reach, s.y + sin * reach);
      ctx.stroke();
      return;
    }

    if (s.kind === 'lash') {
      // A real whip: a curved chain of segments whose tip travels out and
      // snaps back, curving away from the direction of travel under its own
      // momentum. The curvature is what makes it a whip and not a spear.
      const out = progress < 0.45 ? progress / 0.45 : 1 - (progress - 0.45) / 0.55;
      const segs = s.segments > 0 ? s.segments : 10;
      const dir = s.dir ?? 1;

      ctx.lineCap = 'round';
      let px = s.x, py = s.y;
      for (let k = 1; k <= segs; k++) {
        const f = k / segs;
        const dist = s.radius * out * f;
        // Lag increases toward the tip, so the whip trails behind its own
        // base rather than staying straight — the classic S-curve.
        const bend = Math.sin(f * Math.PI) * s.arc * dir * (1 - out * 0.55);
        const a = s.facing + bend;
        const x = s.x + Math.cos(a) * dist;
        const y = s.y + Math.sin(a) * dist;

        // Tapers toward the tip, and the last segment is the bright crack.
        ctx.strokeStyle = k === segs
          ? rgba('#ffffff', t * 0.95)
          : rgba(s.color, (0.35 + t * 0.5) * (0.4 + f * 0.6));
        ctx.lineWidth = Math.max(1.2, 5 * (1 - f * 0.7));
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(x, y);
        ctx.stroke();
        px = x; py = y;
      }

      // Tip flash at full extension.
      if (out > 0.85) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(getGlow('#ffffff', 18), px - 18, py - 18, 36, 36);
        ctx.globalCompositeOperation = 'source-over';
      }
      return;
    }

    // --- 'swing' (default): a blade travelling through the arc, with a trail.
    const half = s.arc / 2;
    const from = s.facing - half * s.dir;
    const bladeAngle = from + s.arc * s.dir * eased;

    // Trail: the wedge between where the swing started and where the blade is
    // now, fading as it ages. This is the part that sells motion.
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = t * 0.32;
    ctx.fillStyle = s.color;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.arc(s.x, s.y, s.radius, Math.min(from, bladeAngle), Math.max(from, bladeAngle));
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // The bright leading edge, thickest at the blade and thinning behind it.
    ctx.lineCap = 'round';
    ctx.strokeStyle = rgba('#ffffff', 0.35 + t * 0.6);
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.radius, Math.min(from, bladeAngle), Math.max(from, bladeAngle));
    ctx.stroke();

    // The blade itself: a short bar at the leading edge, perpendicular to the
    // arc, so there is an actual object doing the cutting.
    const bx = s.x + Math.cos(bladeAngle) * s.radius;
    const by = s.y + Math.sin(bladeAngle) * s.radius;
    const inner = s.radius * 0.45;
    const ix = s.x + Math.cos(bladeAngle) * inner;
    const iy = s.y + Math.sin(bladeAngle) * inner;
    ctx.strokeStyle = rgba('#ffffff', 0.9);
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(ix, iy);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.strokeStyle = rgba(s.color, 0.95);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ix, iy);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }

  _drawProjectiles(ctx, state, left, right, top, bottom) {
    const projectiles = state.projectiles;
    if (projectiles.length === 0) return;

    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < projectiles.length; i++) {
      const p = projectiles[i];
      if (p.x < left - 30 || p.x > right + 30 || p.y < top - 30 || p.y > bottom + 30) continue;
      // Each weapon's shots glow in its own colour, so a busy screen still
      // reads as "that was the Seeker" rather than one undifferentiated blur.
      const s = p.crit ? 40 : 28;
      const glow = getGlow(p.crit ? PALETTE.shotCrit : p.color, p.crit ? 20 : 14);
      ctx.drawImage(glow, p.x - s / 2, p.y - s / 2, s, s);
    }
    ctx.globalCompositeOperation = 'source-over';

    // The projectile body itself, as the pixel sprite its weapon was minted
    // with (see weaponGen.js). A weapon whose colour was tinted by its
    // modifiers fires a visibly different shot from the bare base — which is
    // what "a full sprite per weapon, not an abstract combination" means in
    // practice, without anyone hand-authoring one per combination.
    const frame = animFrame(this._clock, 8, 2);
    for (let i = 0; i < projectiles.length; i++) {
      const p = projectiles[i];
      if (p.x < left - 30 || p.x > right + 30 || p.y < top - 30 || p.y > bottom + 30) continue;

      const key = p.weaponRef?.def?.sprite;
      if (key !== undefined) {
        drawSprite(ctx, key, p.x, p.y, {
          frame, angle: p.angle, scale: p.crit ? 1.35 : 1,
          variant: p.crit ? 'flash' : 'base',
        });
      } else {
        // Legacy/unowned projectiles (a split fragment, an elite's bolt) keep
        // the original streak so nothing ever renders as nothing.
        const len = p.crit ? 16 : 11;
        ctx.strokeStyle = p.crit ? '#fffbe0' : '#ffffff';
        ctx.lineWidth = p.crit ? 5 : 3.4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p.x - Math.cos(p.angle) * len, p.y - Math.sin(p.angle) * len);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
    }
  }

  /** Lingering ground effects: ember trails, fissures, wildfire pools. */
  _drawZones(ctx, state, left, right, top, bottom) {
    const zones = state.zones;
    if (zones.length === 0) return;

    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < zones.length; i++) {
      const z = zones[i];
      if (z.x + z.radius < left || z.x - z.radius > right) continue;
      if (z.y + z.radius < top || z.y - z.radius > bottom) continue;

      // Fade out over the last third of the zone's life so the player can see
      // that ground is about to stop being dangerous.
      const t = z.life / z.maxLife;
      ctx.globalAlpha = Math.min(1, t * 3) * 0.5;
      const glow = getGlow(z.color, 64);
      ctx.drawImage(glow, z.x - z.radius, z.y - z.radius, z.radius * 2, z.radius * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // A dashed rim makes the exact edge readable, which matters when you're
    // deciding whether you can cut a corner through your own fire.
    ctx.setLineDash([6, 7]);
    ctx.lineWidth = 1.5;
    for (let i = 0; i < zones.length; i++) {
      const z = zones[i];
      if (z.x + z.radius < left || z.x - z.radius > right) continue;
      if (z.y + z.radius < top || z.y - z.radius > bottom) continue;
      const t = z.life / z.maxLife;
      ctx.strokeStyle = rgba(z.color, Math.min(1, t * 3) * 0.55);
      ctx.beginPath();
      ctx.arc(z.x, z.y, z.radius, 0, TAU);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  /**
   * Waller elites' temporary barriers: a thin dashed outline while only a
   * warning, then a solid rounded bar once it can actually block the player —
   * the same warn-then-live language the biome hazards already use, so a new
   * threat type doesn't need a new visual grammar to be read at a glance.
   */
  _drawWalls(ctx, state, left, right, top, bottom) {
    const walls = state.walls;
    if (walls.length === 0) return;

    ctx.lineCap = 'round';
    for (let i = 0; i < walls.length; i++) {
      const w = walls[i];
      if (Math.max(w.x1, w.x2) < left || Math.min(w.x1, w.x2) > right) continue;
      if (Math.max(w.y1, w.y2) < top || Math.min(w.y1, w.y2) > bottom) continue;

      if (w.phase === 'warn') {
        const t = 1 - w.timer / w.warnDuration;
        ctx.strokeStyle = rgba(w.color, 0.25 + 0.55 * t);
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 5]);
        ctx.beginPath();
        ctx.moveTo(w.x1, w.y1);
        ctx.lineTo(w.x2, w.y2);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        // Fades out over its last third, same "this is about to stop being
        // solid" cue every other timed hazard in the game already gives.
        const fadeT = Math.min(1, w.life / (w.maxLife * 0.35));
        ctx.strokeStyle = rgba(w.color, 0.85 * fadeT + 0.15);
        ctx.lineWidth = w.thickness;
        ctx.beginPath();
        ctx.moveTo(w.x1, w.y1);
        ctx.lineTo(w.x2, w.y2);
        ctx.stroke();

        ctx.strokeStyle = rgba('#ffffff', 0.3 * fadeT);
        ctx.lineWidth = Math.max(1, w.thickness * 0.25);
        ctx.beginPath();
        ctx.moveTo(w.x1, w.y1);
        ctx.lineTo(w.x2, w.y2);
        ctx.stroke();
      }
    }
  }

  /**
   * Mortar elites' shells: a red ring at the landing zone that fills in as
   * impact approaches (exactly the area the blast will cover, same promise
   * Husk's telegraph makes), plus a brief fading line back to where it was
   * fired from so the first instant reads as "incoming from there".
   */
  _drawMortarShells(ctx, state, left, right, top, bottom) {
    const shells = state.mortarShells;
    if (shells.length === 0) return;

    for (let i = 0; i < shells.length; i++) {
      const s = shells[i];
      if (s.x + s.radius < left || s.x - s.radius > right) continue;
      if (s.y + s.radius < top || s.y - s.radius > bottom) continue;

      const t = 1 - s.timer / s.maxTimer;

      // The origin line, visible only in the first fifth of the flight.
      const lineT = Math.max(0, 1 - t / 0.2);
      if (lineT > 0) {
        ctx.strokeStyle = rgba(s.color, 0.5 * lineT);
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 6]);
        ctx.beginPath();
        ctx.moveTo(s.sx, s.sy);
        ctx.lineTo(s.x, s.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // A soft fill grows underneath the ring so the last instant before
      // impact reads as urgent, not just a line getting brighter.
      ctx.globalAlpha = 0.12 + 0.22 * t;
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.radius * (0.3 + 0.7 * t), 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.strokeStyle = rgba('#ff3b3b', 0.25 + 0.65 * t);
      ctx.lineWidth = 2.5;
      ctx.setLineDash([7, 6]);
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.radius, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  /** Quake rings, expanding outward. */
  _drawShockwaves(ctx, state) {
    const waves = state.shockwaves;
    if (waves.length === 0) return;

    for (let i = 0; i < waves.length; i++) {
      const w = waves[i];
      const t = Math.max(0, w.life) / w.expandTime;
      ctx.strokeStyle = rgba(w.color, t * 0.9);
      ctx.lineWidth = 3 + t * 7;
      ctx.beginPath();
      ctx.arc(w.x, w.y, w.radius, 0, TAU);
      ctx.stroke();
    }
  }

  /** Volatile Remains detonations. Visual only — damage was already applied. */
  _drawBlasts(ctx, state) {
    const blasts = state.blasts;
    if (blasts.length === 0) return;

    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < blasts.length; i++) {
      const b = blasts[i];
      const t = b.life / b.maxLife;
      const r = b.radius * (1.15 - t * 0.35);
      ctx.globalAlpha = t * 0.75;
      const glow = getGlow(b.color, 48);
      ctx.drawImage(glow, b.x - r, b.y - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Lance beams: a wide soft core with a bright thin line down the middle. */
  _drawBeams(ctx, state) {
    const beams = state.beams;
    if (beams.length === 0) return;

    ctx.lineCap = 'round';
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < beams.length; i++) {
      const b = beams[i];
      const t = b.life / b.maxLife;
      ctx.strokeStyle = rgba(b.color, t * 0.5);
      ctx.lineWidth = b.width * t;
      ctx.beginPath();
      ctx.moveTo(b.x1, b.y1);
      ctx.lineTo(b.x2, b.y2);
      ctx.stroke();

      ctx.strokeStyle = rgba('#ffffff', t * 0.95);
      ctx.lineWidth = Math.max(1, b.width * 0.28 * t);
      ctx.beginPath();
      ctx.moveTo(b.x1, b.y1);
      ctx.lineTo(b.x2, b.y2);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Crit arcs — a jagged line between the crit victim and its neighbour. */
  _drawArcs(ctx, state) {
    const arcs = state.arcs;
    if (arcs.length === 0) return;

    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (let i = 0; i < arcs.length; i++) {
      const a = arcs[i];
      const t = a.life / a.maxLife;
      ctx.strokeStyle = rgba('#bfe9ff', t);
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(a.x1, a.y1);
      // Three fixed kinks: enough to read as lightning, cheap enough to spam.
      const dx = a.x2 - a.x1, dy = a.y2 - a.y1;
      const nx = -dy, ny = dx;
      for (let k = 1; k <= 3; k++) {
        const f = k / 4;
        const jitter = (k % 2 === 0 ? 0.06 : -0.06);
        ctx.lineTo(a.x1 + dx * f + nx * jitter, a.y1 + dy * f + ny * jitter);
      }
      ctx.lineTo(a.x2, a.y2);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * Warden Blades. These aren't entities — the weapon computes their positions
   * from one angle each frame, so the renderer recomputes the same thing rather
   * than the simulation storing six objects it doesn't need.
   */
  _drawOrbiters(ctx, state) {
    const weapon = state.weapons.find((w) => w.id === 'orbit');
    if (weapon === undefined) return;

    const p = state.player;
    const count = Math.max(1, Math.round(
      weapon.stats.get('count') + state.stats.get('projectileCount')));
    const radius = weapon.stats.get('radius') * state.stats.get('area');
    const size = weapon.stats.get('bladeSize') * Math.sqrt(state.stats.get('area'));
    const base = weapon.scratch.angle ?? 0;

    ctx.globalCompositeOperation = 'lighter';
    const glow = getGlow('#7dffa8', 22);
    for (let i = 0; i < count; i++) {
      const a = base + (TAU / count) * i;
      const bx = p.x + Math.cos(a) * radius;
      const by = p.y + Math.sin(a) * radius;
      ctx.drawImage(glow, bx - size * 1.6, by - size * 1.6, size * 3.2, size * 3.2);
    }
    ctx.globalCompositeOperation = 'source-over';

    ctx.fillStyle = '#d9ffe8';
    for (let i = 0; i < count; i++) {
      const a = base + (TAU / count) * i;
      const bx = p.x + Math.cos(a) * radius;
      const by = p.y + Math.sin(a) * radius;
      // Oriented along its travel so it reads as a blade, not a pebble.
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(a + Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(0, -size);
      ctx.lineTo(size * 0.55, 0);
      ctx.lineTo(0, size);
      ctx.lineTo(-size * 0.55, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  _drawPlayer(ctx, state) {
    const p = state.player;
    if (!p.alive) return;

    // Pickup radius, drawn very faintly — doubles as readable personal space.
    ctx.strokeStyle = 'rgba(124,231,255,0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(p.x, p.y, state.stats.get('pickupRadius'), 0, TAU);
    ctx.stroke();

    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(getGlow(PALETTE.player, 34), p.x - 34, p.y - 34, 68, 68);
    ctx.globalCompositeOperation = 'source-over';

    // The Driftwalker, as a pixel sprite. Blinks during i-frames so taking a
    // hit is unmistakable, and flashes white on the frame it lands.
    const blinking = p.invuln > 0 && Math.floor(p.invuln * 14) % 2 === 0;
    const variant = p.hitFlash > 0.3 ? 'flash' : 'base';
    // Walk cycle while moving, a slower idle sway while standing still.
    const frame = animFrame(this._clock, p.moving ? 10 : 3, 4);

    // Each Driftwalker has its own silhouette; `char:<id>` falls back to the
    // generic 'player' sprite if a run somehow carries an unknown character.
    const key = hasSprite('char:' + state.character) ? 'char:' + state.character : 'player';
    drawSprite(ctx, key, p.x, p.y, {
      frame, variant, angle: p.facing, alpha: blinking ? 0.45 : 1,
    });

    // The weapon in hand. Drawn AFTER the body so it sits on top, offset out
    // along the facing so it reads as held rather than worn.
    //
    // Without this the Driftwalker was a hooded figure with empty hands no
    // matter what they were carrying — the arsenal existed entirely as
    // projectiles and numbers, and the character sprite never acknowledged it.
    this._drawHeldWeapon(ctx, state, p);

    // Warding's shield, when a weapon modifier has granted any: a bright ring
    // that thins as the pool drains, so its remaining value is readable
    // without a second bar competing with the HUD's health bar.
    if (p.shield > 0 && p.shieldMax > 0) {
      const frac = Math.min(1, p.shield / p.shieldMax);
      ctx.strokeStyle = rgba('#8ff0ff', 0.3 + frac * 0.5);
      ctx.lineWidth = 1 + frac * 2.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, PLAYER.radius + 9, 0, TAU);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(232,251,255,0.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, PLAYER.radius + 4, 0, TAU);
    ctx.stroke();
  }

  _drawRemotePlayers(ctx, state) {
    const remote = state.remotePlayers;
    if (remote === undefined || remote.length === 0) return;

    const nameFont = '10px ' + (getComputedStyle(document.documentElement).getPropertyValue('--font') || 'sans-serif');

    for (const rp of remote) {
      if (!rp.alive) continue;

      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(getGlow('#7dffa8', 28), rp.x - 28, rp.y - 28, 56, 56);
      ctx.globalCompositeOperation = 'source-over';

      const frame = animFrame(this._clock, 10, 4);
      drawSprite(ctx, 'player', rp.x, rp.y, {
        frame, variant: 'base', angle: 0, alpha: 0.8,
      });

      ctx.strokeStyle = 'rgba(125,255,168,0.5)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(rp.x, rp.y, PLAYER.radius + 4, 0, TAU);
      ctx.stroke();

      ctx.font = nameFont;
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(125,255,168,0.8)';
      ctx.fillText(rp.name ?? '???', rp.x, rp.y - PLAYER.radius - 8);
    }
  }

  _drawParticles(ctx, state, left, right, top, bottom) {
    const parts = state.particles;
    if (parts.length === 0) return;

    ctx.globalCompositeOperation = 'lighter';

    // Particles are spawned in same-coloured bursts with near-identical
    // lifetimes, so tracking the last colour and quantising alpha to 1/8ths
    // skips almost every redundant canvas state write — and allocates nothing.
    // At the particle cap this is the difference between a few dozen state
    // changes per frame and nine hundred.
    let lastColor = null;
    let lastAlphaStep = -1;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p.x < left || p.x > right || p.y < top || p.y > bottom) continue;

      if (p.color !== lastColor) {
        ctx.fillStyle = p.color;
        lastColor = p.color;
      }

      const raw = p.life / p.maxLife;
      const a = raw < 0 ? 0 : raw > 1 ? 1 : raw;
      const step = (a * 8) | 0;
      if (step !== lastAlphaStep) {
        ctx.globalAlpha = step / 8 + 0.0625;
        lastAlphaStep = step;
      }

      const s = p.size * (0.4 + a * 0.6);
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  _drawDamageNumbers(ctx, state, left, right, top, bottom) {
    const nums = state.damageNumbers;
    if (nums.length === 0) return;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Two passes, normal then crit, so `font` and `fillStyle` are each assigned
    // twice per frame instead of once per number. Assigning `font` re-parses
    // the CSS font shorthand every time, which is the expensive part.
    //
    // The pop is applied via `translate`/`scale` rather than by re-assigning
    // `font` per number, for exactly the same reason — a scale transform is
    // cheap, a font re-parse per damage number at 60fps is not.
    for (let pass = 0; pass < 2; pass++) {
      const wantCrit = pass === 1;
      let styleSet = false;

      for (let i = 0; i < nums.length; i++) {
        const n = nums[i];
        if (n.crit !== wantCrit) continue;
        if (n.x < left || n.x > right || n.y < top || n.y > bottom) continue;

        if (!styleSet) {
          ctx.font = wantCrit
            ? '700 19px ui-monospace, monospace'
            : '600 13px ui-monospace, monospace';
          ctx.fillStyle = wantCrit ? '#ffe066' : '#ffffff';
          styleSet = true;
        }

        const raw = n.life / n.maxLife;
        ctx.globalAlpha = raw < 0 ? 0 : raw > 1 ? 1 : raw;

        // Overshoot to ~1.5x on spawn, settle to 1. Crits punch harder.
        const pop = n.pop ?? 1;
        const overshoot = wantCrit ? 0.85 : 0.5;
        const scale = pop < 1 ? 1 + Math.sin(pop * Math.PI) * overshoot : 1;

        if (scale !== 1) {
          ctx.save();
          ctx.translate(n.x, n.y);
          ctx.scale(scale, scale);
          ctx.fillText(n.text, 0, 0);
          ctx.restore();
        } else {
          ctx.fillText(n.text, n.x, n.y);
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Red edge glow that intensifies as health drops. */
  _drawVignette(ctx, state, vw, vh) {
    const frac = state.hpFraction;
    if (frac > 0.45) return;
    const intensity = (1 - frac / 0.45) * 0.5;

    const grad = ctx.createRadialGradient(
      vw / 2, vh / 2, Math.min(vw, vh) * 0.28,
      vw / 2, vh / 2, Math.max(vw, vh) * 0.72,
    );
    grad.addColorStop(0, 'rgba(255,0,40,0)');
    grad.addColorStop(1, 'rgba(255,0,40,' + intensity + ')');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, vw, vh);
  }

  /** A brief bright pulse on a crit, layered under the vignette so a red
   *  low-health screen and a crit flash never fight for the same read. */
  _drawCritFlash(ctx, state, vw, vh) {
    if (state.critFlashTimer === undefined || state.critFlashTimer <= 0) return;
    const t = state.critFlashTimer / FX.critFlashDuration;
    ctx.fillStyle = 'rgba(255, 243, 176, ' + (t * 0.14) + ')';
    ctx.fillRect(0, 0, vw, vh);
  }

  /**
   * The boss health bar. Deliberately not the small floating bar every other
   * enemy gets — a boss is the one enemy the whole screen should organise
   * around, so its health lives in a fixed HUD strip instead of a world-space
   * label that scrolls out of view the moment you kite away from it.
   */
  _drawBossBar(ctx, state, vw, vh) {
    const boss = state.enemies.find((e) => e.alive && e.type.boss === true);
    if (boss === undefined) return;

    const barW = Math.min(560, vw * 0.6);
    const x = vw / 2 - barW / 2;
    const y = 14;
    const h = 14;

    ctx.font = '700 12px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = boss.type.color;
    ctx.fillText(boss.type.name.toUpperCase(), vw / 2, y - 4);

    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x, y, barW, h);

    const frac = Math.max(0, boss.hp / boss.maxHp);
    const grad = ctx.createLinearGradient(x, 0, x + barW, 0);
    grad.addColorStop(0, boss.type.color);
    grad.addColorStop(1, '#ffffff');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, barW * frac, h);

    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, barW, h);

    // Phase pips: small ticks showing how many attack-phase cycles remain
    // legible at a glance, so a phase transition doesn't feel unannounced.
    if (boss.bossPhaseCount !== undefined) {
      for (let i = 1; i < boss.bossPhaseCount; i++) {
        const px = x + (barW * i) / boss.bossPhaseCount;
        ctx.strokeStyle = 'rgba(10,13,20,0.7)';
        ctx.beginPath();
        ctx.moveTo(px, y);
        ctx.lineTo(px, y + h);
        ctx.stroke();
      }
    }
  }

  /**
   * The weapon the Driftwalker is currently holding.
   *
   * Picks the most recently *fired* weapon rather than the first in the list,
   * so what you see in hand is what just went off — with several weapons held
   * at once, showing a fixed one would be actively misleading about which
   * attack the player is watching.
   *
   * Melee weapons additionally animate: they wind back and follow through with
   * the swing, driven by the same `animation_state` the inventory already
   * tracks. That is the difference between a weapon being *drawn on* the
   * character and the character being seen to *use* it.
   */
  _drawHeldWeapon(ctx, state, p) {
    const inv = state.inventory;
    if (inv === null || inv === undefined || inv.weapons.size === 0) return;

    // Most recently fired, falling back to the first held.
    let held = null;
    let bestFlash = -1;
    for (const w of inv.weapons.values()) {
      if (w.flash > bestFlash) { bestFlash = w.flash; held = w; }
    }
    if (held === null) return;

    const key = 'wart:icon:' + held.art;
    if (!hasSprite(key)) return;

    const isMelee = held.def?.melee === true
      || ['swing', 'thrust', 'slam', 'lash'].includes(held.def?.baseId);

    // Swing follow-through: winds back slightly, then sweeps forward. Uses the
    // attack flash as the clock so it stays in step with the actual attack.
    const swing = held.animation_state === 'ATTACKING' ? held.flash : 0;
    const swingAngle = isMelee ? (0.9 - swing * 1.9) : 0;

    // Held out to the side of the facing, so it never covers the body.
    const offAngle = p.facing + (isMelee ? 0.45 : 0.6) + swingAngle;
    const dist = isMelee ? 15 + swing * 7 : 14;
    const hx = p.x + Math.cos(offAngle) * dist;
    const hy = p.y + Math.sin(offAngle) * dist;

    // Weapon icons are authored hilt-to-edge on the diagonal (see
    // weaponArt.js), so +PI/4 aligns the blade with the direction of travel.
    const rot = p.facing + swingAngle + Math.PI / 4;

    drawSprite(ctx, key, hx, hy, {
      frame: held.current_frame,
      angle: rot,
      scale: 0.62,
      variant: held.flash > 0.6 ? 'flash' : 'base',
    });
  }

  /**
   * The carried arsenal, top-left under the run clock.
   *
   * Delegates the actual sprite blitting to `Inventory.draw_pixel_sprites`,
   * because the inventory owns the animation state those sprites are drawn at
   * — having the renderer reach in and read frame counters would put the same
   * knowledge in two places. The renderer's job here is only to decide *where*
   * the strip goes and to draw the frame around it.
   */
  _drawInventoryStrip(ctx, state, vw, vh) {
    const inv = state.inventory;
    if (inv === null || inv === undefined) return;
    const count = inv.weapons.size + inv.passives.size;
    if (count === 0) return;

    const size = 26;
    const gap = 4;
    const columns = 6;
    const rows = Math.ceil(count / columns);
    const x = 20;
    const y = 74;
    const w = Math.min(count, columns) * (size + gap) - gap;
    const h = rows * (size + gap) - gap;

    ctx.fillStyle = 'rgba(10, 14, 22, 0.55)';
    ctx.fillRect(x - 6, y - 6, w + 12, h + 12);
    ctx.strokeStyle = 'rgba(79, 216, 255, 0.18)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 6, y - 6, w + 12, h + 12);

    inv.draw_pixel_sprites(ctx, x, y, { size, gap, columns, showLevel: true });

    // Same "remember where things were drawn, hit-test the pointer against
    // it" approach as the ability bar (canvas has no :hover). Built here
    // rather than trusted to inventory.js because only the renderer knows
    // the on-screen cell each item landed in.
    this._inventoryRects = [];
    const items = [...inv.weapons.values(), ...inv.passives.values()];
    items.forEach((item, i) => {
      const col = i % columns;
      const row = Math.floor(i / columns);
      this._inventoryRects.push({
        x: x + col * (size + gap), y: y + row * (size + gap), w: size, h: size,
        isWeapon: i < inv.weapons.size, item,
      });
    });

    this._drawInventoryTooltip(ctx, state, vw, vh);
  }

  /**
   * Hover tooltip for the weapon/passive strip — same hit-test-the-pointer
   * approach as _drawAbilityTooltip, and deliberately anchored the same way
   * (above the icon, clamped to stay on screen) so the two canvas tooltips in
   * this game read as one system rather than two.
   */
  _drawInventoryTooltip(ctx, state, vw, vh) {
    const rects = this._inventoryRects;
    if (rects === undefined || rects.length === 0) return;
    const input = state.hoverInput;
    if (input === null || input === undefined || !input.mouseOver) return;

    const rect = this.canvas.getBoundingClientRect();
    const mx = input.mouseX - rect.left;
    const my = input.mouseY - rect.top;

    const hit = rects.find((r) => mx >= r.x && mx <= r.x + r.w
                               && my >= r.y && my <= r.y + r.h);
    if (hit === undefined) return;

    const item = hit.item;
    const blurb = hit.isWeapon
      ? (t('weapon.' + item.id + '.blurb') || item.def?.blurb || '')
      : (t('passive.' + item.id + '.blurb') || PASSIVES[item.id]?.blurb || '');
    const accent = hit.isWeapon ? '#8ff0ff' : '#ffd166';
    const pad = 10;
    const maxW = 240;

    ctx.font = '600 11px system-ui, sans-serif';
    const lines = wrapText(ctx, blurb, maxW - pad * 2);

    const titleH = 18;
    const metaH = item.level > 1 ? 14 : 0;
    const bodyH = lines.length * 14;
    const boxW = maxW;
    const boxH = pad * 2 + titleH + metaH + bodyH;
    const boxX = Math.max(8, Math.min(vw - boxW - 8, hit.x + hit.w / 2 - boxW / 2));
    const boxY = hit.y + hit.h + 10;

    ctx.fillStyle = 'rgba(8, 12, 20, 0.96)';
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(boxX + 0.5, boxY + 0.5, boxW - 1, boxH - 1);

    // A little pointer up toward the icon it describes — the strip sits at
    // the top of the screen, so unlike the ability bar's tooltip this one
    // opens downward and points back up at what it's describing.
    ctx.fillStyle = 'rgba(8, 12, 20, 0.96)';
    ctx.beginPath();
    ctx.moveTo(hit.x + hit.w / 2 - 6, boxY);
    ctx.lineTo(hit.x + hit.w / 2 + 6, boxY);
    ctx.lineTo(hit.x + hit.w / 2, boxY - 7);
    ctx.closePath();
    ctx.fill();

    let ty = boxY + pad + 12;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    ctx.font = '700 13px system-ui, sans-serif';
    ctx.fillStyle = accent;
    ctx.fillText(t(hit.isWeapon ? 'weapon.' + item.id + '.name' : 'passive.' + item.id + '.name') || item.name, boxX + pad, ty);
    ty += titleH;

    if (item.level > 1) {
      ctx.font = '600 10px ui-monospace, monospace';
      ctx.fillStyle = 'rgba(190, 205, 220, 0.75)';
      ctx.fillText(t('run.level', { n: item.level }), boxX + pad, ty);
      ty += metaH;
    }

    ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillStyle = '#dce9f5';
    for (const line of lines) {
      ctx.fillText(line, boxX + pad, ty);
      ty += 14;
    }
  }

  /**
   * The ability bar: three cooldown slots plus the ultimate.
   *
   * Bottom-centre rather than tucked in a corner, because unlike the weapon
   * strip these need to be *glanceable mid-fight* — a parry you have to look
   * away to check the cooldown of is a parry you will not press.
   *
   * Cooldown is drawn as a radial sweep that empties clockwise, which reads
   * faster than a number: you can see "nearly ready" without reading anything.
   */
  _drawAbilityBar(ctx, state, vw, vh) {
    const ab = state.abilities;
    if (ab === null || ab === undefined) return;

    // Rebuilt every frame and consumed by _drawAbilityTooltip immediately
    // after. The bar is painted on the canvas, so it cannot use CSS :hover —
    // it has to remember where it put things and hit-test them itself.
    this._abilityRects = [];

    const size = 46;
    const gap = 10;
    const total = ab.slots.length + 1;
    const barW = total * size + (total - 1) * gap;
    const x0 = vw / 2 - barW / 2;
    const y = vh - 74;

    for (let i = 0; i < ab.slots.length; i++) {
      const slot = ab.slots[i];
      const x = x0 + i * (size + gap);
      // Reads the live binding rather than a fixed QER — a player who
      // rebinds ability1 to, say, Z, needs the on-screen prompt to say Z,
      // not silently keep showing the key that no longer does anything.
      const keyLabel = codeToLabel(getKeyBinding('ability' + (i + 1)));
      this._drawAbilitySlot(ctx, x, y, size, {
        def: slot.def,
        label: keyLabel,
        ready: slot.cooldown <= 0,
        // 0 = just used, 1 = ready.
        progress: slot.def.cd > 0 ? 1 - slot.cooldown / slot.def.cd : 1,
        cooldownLeft: slot.cooldown,
      });
      this._abilityRects.push({ x, y, w: size, h: size, def: slot.def, key: keyLabel });
    }

    // The ultimate sits apart and reads gold when charged.
    const ux = x0 + ab.slots.length * (size + gap);
    const ultBinding = getKeyBinding('ultimate');
    this._drawAbilitySlot(ctx, ux, y, size, {
      def: ab.ultimate.def,
      // 'SPC' is a deliberately compact shorthand for the default Space —
      // codeToLabel('Space') would print the whole word, which doesn't fit
      // this badge. Any OTHER binding is already short (a single letter,
      // 'L-Shift', etc.) so it can just print as-is.
      label: ultBinding === 'Space' ? 'SPC' : codeToLabel(ultBinding),
      ready: ab.ultimate.ready,
      progress: ab.ultimate.charge,
      isUlt: true,
    });
    this._abilityRects.push({ x: ux, y, w: size, h: size, def: ab.ultimate.def,
                              key: 'SPACE', isUlt: true,
                              charge: ab.ultimate.charge });

    this._drawAbilityTooltip(ctx, state, vw, vh);
  }

  /**
   * Hover tooltip for the ability bar.
   *
   * Canvas UI gets no :hover, so this hit-tests the rects recorded while the
   * bar was drawn against the pointer position the input layer tracks. Drawn
   * last and above the bar so it is never occluded by the slots themselves.
   *
   * Positioned ABOVE the hovered slot rather than at the cursor: the bar sits
   * at the bottom of the screen, so a cursor-anchored tooltip would either
   * run off-screen or sit under the pointer where it hides what it describes.
   */
  _drawAbilityTooltip(ctx, state, vw, vh) {
    const rects = this._abilityRects;
    if (rects === undefined || rects.length === 0) return;
    const input = state.hoverInput;
    if (input === null || input === undefined || !input.mouseOver) return;

    // The canvas may be laid out at a different size than its backing store;
    // hit-test in CSS pixels, which is what both the pointer and the drawing
    // transform are already in.
    const rect = this.canvas.getBoundingClientRect();
    const mx = input.mouseX - rect.left;
    const my = input.mouseY - rect.top;

    const hit = rects.find((r) => mx >= r.x && mx <= r.x + r.w
                               && my >= r.y && my <= r.y + r.h);
    if (hit === undefined) return;

    const def = hit.def;
    const accent = hit.isUlt ? '#ffd166' : '#7ce7ff';
    const pad = 10;
    const maxW = 260;

    ctx.font = '600 11px system-ui, sans-serif';
    const lines = wrapText(ctx, def.blurb, maxW - pad * 2);

    const titleH = 18;
    const metaH = 14;
    const bodyH = lines.length * 14;
    const boxW = maxW;
    const boxH = pad * 2 + titleH + metaH + bodyH;
    const boxX = Math.max(8, Math.min(vw - boxW - 8, hit.x + hit.w / 2 - boxW / 2));
    const boxY = hit.y - boxH - 10;

    ctx.fillStyle = 'rgba(8, 12, 20, 0.96)';
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(boxX + 0.5, boxY + 0.5, boxW - 1, boxH - 1);

    // A little pointer down toward the slot it describes.
    ctx.fillStyle = 'rgba(8, 12, 20, 0.96)';
    ctx.beginPath();
    ctx.moveTo(hit.x + hit.w / 2 - 6, boxY + boxH);
    ctx.lineTo(hit.x + hit.w / 2 + 6, boxY + boxH);
    ctx.lineTo(hit.x + hit.w / 2, boxY + boxH + 7);
    ctx.closePath();
    ctx.fill();

    let ty = boxY + pad + 12;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    ctx.font = '700 13px system-ui, sans-serif';
    ctx.fillStyle = accent;
    ctx.fillText(def.name, boxX + pad, ty);
    ty += titleH;

    // Keybind plus either the cooldown or the ultimate's charge state.
    ctx.font = '600 10px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(190, 205, 220, 0.75)';
    const meta = hit.isUlt
      ? '[' + hit.key + ']  ULTIMATE  ·  ' + Math.floor((hit.charge ?? 0) * 100) + '% charged'
      : '[' + hit.key + ']  ' + def.cd + 's cooldown';
    ctx.fillText(meta, boxX + pad, ty);
    ty += metaH;

    ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillStyle = '#dce9f5';
    for (const line of lines) {
      ctx.fillText(line, boxX + pad, ty);
      ty += 14;
    }
  }

  _drawAbilitySlot(ctx, x, y, size, o) {
    const cx = x + size / 2;
    const cy = y + size / 2;
    const accent = o.isUlt ? '#ffd166' : '#7ce7ff';

    ctx.fillStyle = 'rgba(10, 14, 22, 0.78)';
    ctx.fillRect(x, y, size, size);

    // The unavailable portion, as a dark radial wedge that retreats clockwise.
    if (!o.ready) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.62)';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, size, -Math.PI / 2 + TAU * o.progress, -Math.PI / 2 + TAU);
      ctx.closePath();
      ctx.fill();
    }

    // The icon: a simple glyph per ability kind. Kind rather than per-ability
    // art because forty bespoke icons would be forty things to keep in sync,
    // and "what does this do" is carried by the shape (a chevron dashes, a
    // ring bursts, a shield blocks) far more than by a unique drawing would.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = o.ready ? accent : 'rgba(160,180,200,0.45)';
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    drawAbilityGlyph(ctx, o.def.kind);
    ctx.restore();

    // Border, brighter when usable — the primary "can I press this" signal.
    ctx.strokeStyle = o.ready ? accent : 'rgba(255,255,255,0.16)';
    ctx.lineWidth = o.ready ? 2 : 1;
    ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);

    if (o.ready && o.isUlt) {
      // A charged ultimate pulses, so it is impossible to miss that it is up.
      const pulse = 0.5 + Math.sin(this._clock * 5) * 0.5;
      ctx.strokeStyle = rgba('#ffd166', 0.35 + pulse * 0.45);
      ctx.lineWidth = 3;
      ctx.strokeRect(x - 2.5, y - 2.5, size + 5, size + 5);
    }

    // Keybind, bottom-right.
    ctx.font = '700 9px ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = o.ready ? accent : 'rgba(160,180,200,0.5)';
    ctx.fillText(o.label, x + size - 3, y + size - 2);

    // Seconds remaining, only while it actually matters.
    if (!o.ready && o.cooldownLeft !== undefined && o.cooldownLeft > 0) {
      ctx.font = '700 15px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(Math.ceil(o.cooldownLeft), cx, cy);
    }
    if (o.isUlt && !o.ready) {
      ctx.font = '700 9px ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = 'rgba(255,209,102,0.75)';
      ctx.fillText(Math.floor(o.progress * 100) + '%', x + 3, y + size - 2);
    }
  }

  /** A brief callout when an ultimate fires — the biggest button in the game
   *  should announce itself. */
  _drawUltimateBanner(ctx, state, vw, vh) {
    const b = state.ultimateBanner;
    if (b === null || b === undefined) return;
    b.age += 1 / 60;
    if (b.age > 1.6) { state.ultimateBanner = null; return; }

    const t = b.age / 1.6;
    const alpha = t < 0.12 ? t / 0.12 : Math.max(0, 1 - (t - 0.5) / 0.5);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'center';
    ctx.font = '700 30px ui-monospace, monospace';
    ctx.fillStyle = '#ffd166';
    ctx.fillText(b.name.toUpperCase(), vw / 2, vh * 0.3);
    ctx.font = '700 11px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(255,209,102,0.8)';
    ctx.fillText('ULTIMATE', vw / 2, vh * 0.3 - 26);
    ctx.restore();
  }

  /**
   * Kill combo counter. Shows once the streak is worth mentioning (3+) and
   * grows slightly with the count, positioned away from the HUD's own numbers
   * so it reads as a separate, momentary thing rather than a stat.
   */
  _drawComboCounter(ctx, state, vw, vh) {
    if (state.comboCount < 3 || state.comboTimer <= 0) return;

    const scale = Math.min(1.5, 1 + state.comboCount * 0.02);
    const alpha = Math.min(1, state.comboTimer / 0.3);

    ctx.save();
    ctx.translate(vw / 2, vh - 108);
    ctx.scale(scale, scale);
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'center';
    ctx.font = '700 22px ui-monospace, monospace';
    ctx.fillStyle = '#ffe066';
    ctx.fillText(state.comboCount + ' KILL COMBO', 0, 0);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /**
   * Biome hazards, self-contained rather than routed through the weapon-zone
   * pipeline (see `biomes.js`) — so this draws both of their two stages itself:
   * a dashed ring that tightens while it's only a warning, then a filled glow
   * disc once it's actually live. The switch between the two is the whole
   * point: nothing here should ever hurt the player without first drawing the
   * ring version of itself.
   */
  _drawBiomeHazards(ctx, state, left, right, top, bottom) {
    const hazards = state.biomeHazards;
    if (hazards.length === 0) return;

    for (let i = 0; i < hazards.length; i++) {
      const h = hazards[i];
      if (h.x + h.radius < left || h.x - h.radius > right) continue;
      if (h.y + h.radius < top || h.y - h.radius > bottom) continue;

      if (h.phase === 'warn') {
        const t = 1 - h.timer / h.warnDuration;
        ctx.strokeStyle = h.color + Math.round((0.25 + 0.55 * t) * 255).toString(16).padStart(2, '0');
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 5]);
        ctx.beginPath();
        ctx.arc(h.x, h.y, h.radius * (0.5 + 0.5 * t), 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        // Active: a soft filled glow, same visual language as the weapon-zone
        // system uses for "standing here does something" — reused for
        // familiarity even though the underlying mechanism is separate.
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.5;
        ctx.drawImage(getGlow(h.color, h.radius), h.x - h.radius, h.y - h.radius, h.radius * 2, h.radius * 2);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';

        ctx.strokeStyle = h.color + '70';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 6]);
        ctx.beginPath();
        ctx.arc(h.x, h.y, h.radius, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Enemy silhouettes now live in render/spriteDefs.js as pixel sprites.
//
// The old vector drawShape() that used to sit here was removed with Phase 2:
// a scaled-down vector polygon is a smooth polygon, and the whole point of
// the pixel pipeline is that a silhouette is a specific, deliberately chunky
// staircase of actual pixels. Keeping both would have meant two sources of
// truth for what a Warped Hulk looks like.
// ---------------------------------------------------------------------------

/**
 * Ability icons, one glyph per KIND rather than per ability.
 *
 * Forty bespoke icons would be forty things to keep in sync with forty
 * abilities, and would not actually communicate more: at 46px what the player
 * reads is the silhouette, and "chevrons = I move", "ring = it bursts",
 * "shield = it blocks" carries the meaning far better than a unique drawing
 * of each. Colour already distinguishes character; shape distinguishes verb.
 *
 * Drawn centred on the current transform origin.
 */
function drawAbilityGlyph(ctx, kind) {
  const P = Math.PI;
  switch (kind) {
    case 'dash':      // double chevron, pointing the way you go
      ctx.beginPath();
      ctx.moveTo(-9, -6); ctx.lineTo(-1, 0); ctx.lineTo(-9, 6);
      ctx.moveTo(1, -6); ctx.lineTo(9, 0); ctx.lineTo(1, 6);
      ctx.stroke();
      break;
    case 'parry':     // an angled blade meeting a guard
      ctx.beginPath();
      ctx.moveTo(-9, 7); ctx.lineTo(6, -8);
      ctx.moveTo(1, -9); ctx.lineTo(10, -6); ctx.lineTo(7, 3);
      ctx.stroke();
      break;
    case 'burst':     // concentric rings
      ctx.beginPath(); ctx.arc(0, 0, 4, 0, P * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, 9, 0, P * 2); ctx.stroke();
      break;
    case 'heal':      // a cross
      ctx.beginPath();
      ctx.moveTo(0, -8); ctx.lineTo(0, 8);
      ctx.moveTo(-8, 0); ctx.lineTo(8, 0);
      ctx.stroke();
      break;
    case 'shield':    // a heater shield
      ctx.beginPath();
      ctx.moveTo(0, -9); ctx.lineTo(8, -5); ctx.lineTo(8, 2);
      ctx.lineTo(0, 9); ctx.lineTo(-8, 2); ctx.lineTo(-8, -5);
      ctx.closePath(); ctx.stroke();
      break;
    case 'buff':      // an upward arrow
      ctx.beginPath();
      ctx.moveTo(0, 8); ctx.lineTo(0, -8);
      ctx.moveTo(-6, -3); ctx.lineTo(0, -9); ctx.lineTo(6, -3);
      ctx.stroke();
      break;
    case 'volley':    // three diverging shots
      ctx.beginPath();
      ctx.moveTo(-8, 6); ctx.lineTo(-3, -7);
      ctx.moveTo(0, 8); ctx.lineTo(0, -8);
      ctx.moveTo(8, 6); ctx.lineTo(3, -7);
      ctx.stroke();
      break;
    case 'summon':    // a small figure beside a larger one
      ctx.beginPath(); ctx.arc(-4, -2, 3.5, 0, P * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(5, 3, 2.2, 0, P * 2); ctx.stroke();
      break;
    case 'field':     // a dashed ground circle
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.arc(0, 0, 8, 0, P * 2); ctx.stroke();
      ctx.setLineDash([]);
      break;
    case 'pull':      // arrows converging inward
      ctx.beginPath();
      ctx.moveTo(-10, 0); ctx.lineTo(-3, 0);
      ctx.moveTo(-6, -3); ctx.lineTo(-3, 0); ctx.lineTo(-6, 3);
      ctx.moveTo(10, 0); ctx.lineTo(3, 0);
      ctx.moveTo(6, -3); ctx.lineTo(3, 0); ctx.lineTo(6, 3);
      ctx.stroke();
      break;
    case 'ult':       // a filled star — the only filled glyph, so it stands out
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -P / 2 + (i * P) / 5;
        const r = i % 2 === 0 ? 10 : 4.4;
        const px = Math.cos(a) * r, py = Math.sin(a) * r;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath(); ctx.fill();
      break;
    default:
      ctx.beginPath(); ctx.arc(0, 0, 7, 0, P * 2); ctx.stroke();
  }
}

/** Greedy word wrap against a measured pixel width. Assumes ctx.font is set. */
function wrapText(ctx, text, maxWidth) {
  const words = String(text).split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const candidate = line === '' ? w : line + ' ' + w;
    if (ctx.measureText(candidate).width > maxWidth && line !== '') {
      lines.push(line);
      line = w;
    } else {
      line = candidate;
    }
  }
  if (line !== '') lines.push(line);
  return lines;
}
