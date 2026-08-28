/**
 * spatialGrid.js — uniform grid for broad-phase queries.
 *
 * With 400+ enemies on screen, "nearest enemy" and enemy-vs-enemy separation
 * are O(n^2) if done naively. Bucketing by cell makes both roughly O(n).
 * Rebuilt from scratch every tick: cheaper than incremental updates at this
 * entity count, and impossible to desync.
 */
export class SpatialGrid {
  constructor(cellSize = 64) {
    this.cellSize = cellSize;
    this.cells = new Map();
  }

  clear() { this.cells.clear(); }

  _key(cx, cy) { return cx * 73856093 ^ cy * 19349663; }

  insert(entity) {
    const cx = Math.floor(entity.x / this.cellSize);
    const cy = Math.floor(entity.y / this.cellSize);
    const key = this._key(cx, cy);
    let bucket = this.cells.get(key);
    if (bucket === undefined) {
      bucket = [];
      this.cells.set(key, bucket);
    }
    bucket.push(entity);
  }

  rebuild(entities) {
    this.clear();
    for (let i = 0; i < entities.length; i++) this.insert(entities[i]);
  }

  /**
   * Visit every entity within `radius` of (x, y). Callback-based to avoid
   * allocating a result array thousands of times per second.
   */
  forEachNear(x, y, radius, fn) {
    const cs = this.cellSize;
    const minX = Math.floor((x - radius) / cs);
    const maxX = Math.floor((x + radius) / cs);
    const minY = Math.floor((y - radius) / cs);
    const maxY = Math.floor((y + radius) / cs);

    for (let cy = minY; cy <= maxY; cy++) {
      for (let cx = minX; cx <= maxX; cx++) {
        const bucket = this.cells.get(this._key(cx, cy));
        if (bucket === undefined) continue;
        for (let i = 0; i < bucket.length; i++) fn(bucket[i]);
      }
    }
  }

  /** Closest live entity to (x, y) within `radius`, or null. */
  findNearest(x, y, radius, filter) {
    let best = null;
    let bestD2 = radius * radius;
    this.forEachNear(x, y, radius, (e) => {
      if (filter !== undefined && !filter(e)) return;
      const dx = e.x - x, dy = e.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) { bestD2 = d2; best = e; }
    });
    return best;
  }
}
