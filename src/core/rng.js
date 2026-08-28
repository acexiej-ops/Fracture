/**
 * Seeded RNG (mulberry32). Deterministic runs make balance bugs reproducible,
 * which matters a lot once crafted-item rolls enter the picture.
 */
export class RNG {
  constructor(seed = Date.now()) {
    this.seed = seed >>> 0;
    this.state = this.seed;
  }

  reset(seed = this.seed) {
    this.seed = seed >>> 0;
    this.state = this.seed;
  }

  /** Float in [0, 1). */
  next() {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Float in [min, max). */
  range(min, max) { return min + this.next() * (max - min); }

  /** Integer in [min, max]. */
  int(min, max) { return Math.floor(this.range(min, max + 1)); }

  bool(chance = 0.5) { return this.next() < chance; }

  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }

  angle() { return this.next() * Math.PI * 2; }

  /** Weighted pick. `weightFn` maps an item to a positive number. */
  weighted(items, weightFn) {
    let total = 0;
    for (const it of items) total += weightFn(it);
    if (total <= 0) return items[0];
    let roll = this.next() * total;
    for (const it of items) {
      roll -= weightFn(it);
      if (roll <= 0) return it;
    }
    return items[items.length - 1];
  }

  /** Pick `n` distinct items, weighted, without replacement. */
  weightedSample(items, weightFn, n) {
    const pool = [...items];
    const out = [];
    while (out.length < n && pool.length > 0) {
      const chosen = this.weighted(pool, weightFn);
      out.push(chosen);
      pool.splice(pool.indexOf(chosen), 1);
    }
    return out;
  }
}

export const rng = new RNG();
