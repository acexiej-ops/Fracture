/**
 * loop.js — fixed-timestep simulation with a decoupled render.
 *
 * Physics runs in constant 1/60s steps so collisions and knockback behave
 * identically on a 60Hz laptop and a 240Hz monitor. Rendering happens once per
 * animation frame with whatever the latest simulated state is.
 */

const STEP = 1 / 60;
const MAX_STEPS_PER_FRAME = 5; // beyond this we drop time rather than death-spiral

export class GameLoop {
  constructor({ update, render }) {
    this.update = update;
    this.render = render;
    this.accumulator = 0;
    this.lastTime = 0;
    this.running = false;
    this.rafId = null;
    this.fps = 60;
    this._fpsSmooth = 60;

    this._frame = this._frame.bind(this);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.rafId = requestAnimationFrame(this._frame);
  }

  stop() {
    this.running = false;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  _frame(now) {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this._frame);

    const rawFrameTime = (now - this.lastTime) / 1000;
    this.lastTime = now;

    // Reported FPS uses the REAL elapsed time, never clamped — this is the
    // one number that exists specifically to reveal a stall, however severe.
    // It used to read the clamped `frameTime` below, so any collapse worse
    // than 4fps (a genuine, sustained one — dense swarms of enemies,
    // projectiles and particles, not a backgrounded tab) got silently
    // rewritten to a healthy 60fps before the smoothing average ever saw
    // the real number. That's the whole reason "5 FPS but the counter says
    // 60" was possible: the counter was measuring a fabricated frame time,
    // not the one the browser actually experienced.
    if (rawFrameTime > 0) {
      this._fpsSmooth += (1 / rawFrameTime - this._fpsSmooth) * 0.05;
      this.fps = this._fpsSmooth;
    }

    // The SIMULATION's own step budget is still clamped separately: a tab
    // that was backgrounded for minutes returns one huge delta, and must be
    // treated as a single step rather than trying to "catch up" with a
    // queue of hundreds of update() calls.
    let frameTime = rawFrameTime;
    if (frameTime > 0.25) frameTime = STEP;

    this.accumulator += frameTime;

    let steps = 0;
    while (this.accumulator >= STEP && steps < MAX_STEPS_PER_FRAME) {
      this.update(STEP);
      this.accumulator -= STEP;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;

    this.render(this.accumulator / STEP);
  }
}

export { STEP };
