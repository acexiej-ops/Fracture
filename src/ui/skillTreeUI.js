/**
 * skillTreeUI.js — canvas-drawn PoE-style passive skill tree overlay.
 *
 * Renders the hex grid of nodes, highlights available/allocated nodes,
 * and handles click-to-allocate. The tree opens on a dedicated overlay
 * div in index.html, keyed by the 'skilltree' id.
 */

import {
  SKILL_NODES, SKILL_NODE_BY_ID, getAvailableNodes, maxAllocations,
  ALLOCATE_LEVELS,
} from '../game/skillTree.js';

const NODE_RADIUS = {
  small: 16,
  medium: 22,
  keystone: 30,
};

const HEX_SPACING_X = 90;
const HEX_SPACING_Y = 78;
const CANVAS_PADDING = 60;

const COLORS = {
  background: '#0a0e1a',
  line: '#1e2940',
  lineAvailable: '#3b5998',
  nodeDefault: '#1a2444',
  nodeAvailable: '#2a4a7a',
  nodeAllocated: '#4fd8ff',
  nodeKeystone: '#ffb703',
  nodeKeystoneAllocated: '#ffd54f',
  text: '#c8d6e5',
  textAllocated: '#ffffff',
  textDim: '#576574',
  border: '#2c3e50',
  borderAllocated: '#4fd8ff',
  hover: 'rgba(79, 216, 255, 0.15)',
  available: 'rgba(79, 216, 255, 0.08)',
};

function nodePos(node) {
  const x = CANVAS_PADDING + (node.col + 6) * HEX_SPACING_X;
  const y = CANVAS_PADDING + (node.row + 10) * HEX_SPACING_Y;
  return { x, y };
}

export class SkillTreeUI {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.container = null;
    this.allocated = [];
    this.available = [];
    this.level = 1;
    this.hoveredNode = null;
    this.onAllocate = null;
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onClick = this._onClick.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
  }

  open(profile, level) {
    this.level = level;
    this.allocated = [...(profile.skillTree ?? [])];
    this.available = getAvailableNodes(this.allocated);

    this.container = document.getElementById('skilltree');
    if (this.container === null) return;
    this.container.hidden = false;

    this.canvas = this.container.querySelector('canvas');
    if (this.canvas === null) return;

    this.ctx = this.canvas.getContext('2d');
    this._resize();
    this._bind();
    this._draw();
  }

  close() {
    this._unbind();
    if (this.container !== null) this.container.hidden = true;
    this.container = null;
    this.canvas = null;
    this.ctx = null;
  }

  _resize() {
    if (this.canvas === null) return;
    const parent = this.canvas.parentElement;
    this.canvas.width = parent.clientWidth;
    this.canvas.height = parent.clientHeight;
  }

  _bind() {
    if (this.canvas === null) return;
    this.canvas.addEventListener('mousemove', this._onMouseMove);
    this.canvas.addEventListener('click', this._onClick);
    window.addEventListener('keydown', this._onKeyDown);
  }

  _unbind() {
    if (this.canvas === null) return;
    this.canvas.removeEventListener('mousemove', this._onMouseMove);
    this.canvas.removeEventListener('click', this._onClick);
    window.removeEventListener('keydown', this._onKeyDown);
  }

  _onKeyDown(e) {
    if (e.key === 'Escape' || e.key === 'k' || e.key === 'K') {
      this.close();
    }
  }

  _onMouseMove(e) {
    if (this.canvas === null) return;
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    this.hoveredNode = null;
    for (const node of SKILL_NODES) {
      const pos = nodePos(node);
      const r = NODE_RADIUS[node.shape] ?? NODE_RADIUS.small;
      if (Math.hypot(mx - pos.x, my - pos.y) <= r + 4) {
        this.hoveredNode = node;
        break;
      }
    }
    this._draw();
  }

  _onClick(e) {
    if (this.hoveredNode === null) return;
    const node = this.hoveredNode;
    const allocSet = new Set(this.allocated);

    // Already allocated — do nothing (no unallocate for now)
    if (allocSet.has(node.id)) return;

    // Check if available
    const avail = getAvailableNodes(this.allocated);
    if (!avail.includes(node.id)) return;

    // Check allocation budget
    if (this.allocated.length >= maxAllocations(this.level)) return;

    this.allocated.push(node.id);
    this.available = getAvailableNodes(this.allocated);

    if (this.onAllocate !== null) this.onAllocate(this.allocated);
    this._draw();
  }

  _draw() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (ctx === null) return;

    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, w, h);

    const allocSet = new Set(this.allocated);
    const availSet = new Set(this.available);
    const budget = maxAllocations(this.level);
    const used = this.allocated.length;
    const remaining = budget - used;

    // Draw connection lines first
    ctx.lineWidth = 2;
    for (const node of SKILL_NODES) {
      const pos = nodePos(node);
      for (const reqId of node.requires) {
        const req = SKILL_NODE_BY_ID.get(reqId);
        if (req === undefined) continue;
        const rpos = nodePos(req);
        const bothAlloc = allocSet.has(node.id) && allocSet.has(reqId);
        const oneAvail = availSet.has(node.id) || availSet.has(reqId);
        ctx.strokeStyle = bothAlloc ? COLORS.nodeAllocated
          : oneAvail ? COLORS.lineAvailable
          : COLORS.line;
        ctx.beginPath();
        ctx.moveTo(rpos.x, rpos.y);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
      }
    }

    // Draw nodes
    for (const node of SKILL_NODES) {
      const pos = nodePos(node);
      const r = NODE_RADIUS[node.shape] ?? NODE_RADIUS.small;
      const allocated = allocSet.has(node.id);
      const available = availSet.has(node.id) && remaining > 0;
      const hovered = this.hoveredNode?.id === node.id;
      const isKeystone = node.shape === 'keystone' || node.shape === 'medium';

      // Glow for available nodes
      if (available && !allocated) {
        ctx.save();
        ctx.globalAlpha = 0.25 + 0.15 * Math.sin(Date.now() / 600);
        ctx.fillStyle = COLORS.nodeAvailable;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, r + 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Node fill
      ctx.fillStyle = allocated
        ? (isKeystone ? COLORS.nodeKeystoneAllocated : COLORS.nodeAllocated)
        : available
          ? COLORS.nodeAvailable
          : COLORS.nodeDefault;

      // Shape
      if (node.shape === 'keystone') {
        this._drawHexagon(ctx, pos.x, pos.y, r);
      } else if (node.shape === 'medium') {
        this._drawDiamond(ctx, pos.x, pos.y, r);
      } else {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Border
      ctx.strokeStyle = allocated ? COLORS.borderAllocated
        : hovered && available ? COLORS.nodeAllocated
        : COLORS.border;
      ctx.lineWidth = allocated ? 2.5 : 1.5;

      if (node.shape === 'keystone') {
        this._drawHexagonStroke(ctx, pos.x, pos.y, r);
      } else if (node.shape === 'medium') {
        this._drawDiamondStroke(ctx, pos.x, pos.y, r);
      } else {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Hover tooltip
      if (hovered) {
        this._drawTooltip(ctx, node, pos, r);
      }
    }

    // Title and budget
    ctx.fillStyle = COLORS.text;
    ctx.font = 'bold 18px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('PASSIVE SKILL TREE', w / 2, 30);

    ctx.font = '14px system-ui, sans-serif';
    ctx.fillStyle = remaining > 0 ? COLORS.nodeAllocated : COLORS.textDim;
    ctx.fillText(`Allocations: ${used}/${budget}`, w / 2, 50);

    if (remaining > 0) {
      ctx.fillStyle = COLORS.textDim;
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillText('Click a glowing node to allocate · Esc to close', w / 2, h - 16);
    } else {
      ctx.fillStyle = COLORS.textDim;
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillText('All allocations used · Esc to close', w / 2, h - 16);
    }
  }

  _drawTooltip(ctx, node, pos, r) {
    const lines = [node.name, node.desc];
    const tipW = 180;
    const tipH = 52;
    let tx = pos.x + r + 12;
    let ty = pos.y - tipH / 2;

    // Keep tooltip on screen
    if (tx + tipW > this.canvas.width) tx = pos.x - r - tipW - 12;
    if (ty < 10) ty = 10;
    if (ty + tipH > this.canvas.height - 10) ty = this.canvas.height - tipH - 10;

    ctx.fillStyle = 'rgba(10, 14, 26, 0.94)';
    ctx.strokeStyle = COLORS.borderAllocated;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(tx, ty, tipW, tipH, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = COLORS.textAllocated;
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(lines[0], tx + 8, ty + 18);

    ctx.fillStyle = COLORS.textDim;
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText(lines[1], tx + 8, ty + 36);
  }

  _drawHexagon(ctx, x, y, r) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i - Math.PI / 6;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }

  _drawHexagonStroke(ctx, x, y, r) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i - Math.PI / 6;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
  }

  _drawDiamond(ctx, x, y, r) {
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r, y);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r, y);
    ctx.closePath();
    ctx.fill();
  }

  _drawDiamondStroke(ctx, x, y, r) {
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r, y);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r, y);
    ctx.closePath();
    ctx.stroke();
  }
}
