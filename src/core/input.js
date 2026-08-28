/**
 * input.js — keyboard state as a polled snapshot.
 *
 * The game loop asks "what is held right now" rather than reacting to events,
 * which keeps movement smooth and independent of key-repeat behaviour.
 */

const MOVE_KEYS = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
};

/** Loaded from localStorage to avoid circular imports. */
let _customBindings = null;

function getBindings() {
  if (_customBindings === null) {
    try {
      const raw = localStorage.getItem('fracture.keybindings');
      _customBindings = raw !== null ? JSON.parse(raw) : {};
    } catch {
      _customBindings = {};
    }
  }
  return _customBindings;
}

/**
 * Get the key code for a binding slot (e.g. 'ability1', 'ultimate').
 * Falls back to the default if no custom binding exists.
 */
export function getKeyBinding(slot) {
  const defaults = {
    ability1: 'KeyQ', ability2: 'KeyE', ability3: 'KeyR',
    ultimate: 'Space', pause: 'Escape', skillTree: 'KeyK', interact: 'KeyF',
  };
  const bindings = getBindings();
  return bindings[slot] ?? defaults[slot] ?? null;
}

/**
 * Update the runtime bindings cache (called when the keybind UI saves new ones).
 */
export function applyBindings(bindings) {
  _customBindings = { ...bindings };
}

export class Input {
  constructor() {
    this.held = new Set();
    this.pressedThisFrame = new Set();
    this._queued = new Set();

    // Pointer position in CSS pixels relative to the viewport. Tracked purely
    // so canvas-drawn UI can respond to hover — the ability bar is painted on
    // the canvas, so it cannot use CSS :hover and has to hit-test itself.
    // `mouseOver` guards against a stale position lingering after the cursor
    // leaves, which would keep a tooltip open over nothing.
    this.mouseX = -1;
    this.mouseY = -1;
    this.mouseOver = false;

    this._onMouseMove = (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      this.mouseOver = true;
    };
    this._onMouseLeave = () => { this.mouseOver = false; };

    this._onKeyDown = (e) => {
      // Typing into a form field is not gameplay input.
      //
      // This guard became load-bearing the moment the game grew text inputs
      // (the account panel). Without it the handler below swallowed W, A, S
      // and D via preventDefault — so those letters could never be typed into
      // an email or password — AND still registered them as held, so typing
      // moved the player and a Q/E/R in a password fired abilities.
      if (isTextEntry(e.target)) return;

      // Don't let arrows/space scroll the page out from under the game.
      if (MOVE_KEYS[e.code] || e.code === 'Space') e.preventDefault();
      if (e.repeat) return;
      this.held.add(e.code);
      this._queued.add(e.code);
    };
    this._onKeyUp = (e) => {
      // Deliberately NOT guarded on the target. A key can be pressed on the
      // canvas and released after focus moves into a field; ignoring that
      // keyup would strand the key as permanently held and leave the player
      // gliding in one direction forever.
      this.held.delete(e.code);
    };

    // Focusing a field clears anything currently held, so a direction pressed
    // just before clicking into the email box doesn't keep the player moving
    // while they type.
    this._onFocusIn = (e) => {
      if (isTextEntry(e.target)) this.held.clear();
    };
    // Releasing focus mid-strafe otherwise leaves the player gliding forever.
    this._onBlur = () => this.held.clear();
  }

  attach(target = window) {
    target.addEventListener('keydown', this._onKeyDown);
    target.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mouseout', this._onMouseLeave);
    window.addEventListener('focusin', this._onFocusIn);
  }

  detach(target = window) {
    target.removeEventListener('keydown', this._onKeyDown);
    target.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mouseout', this._onMouseLeave);
    window.removeEventListener('focusin', this._onFocusIn);
  }

  /** Called once per frame by the loop, before update. */
  beginFrame() {
    this.pressedThisFrame = this._queued;
    this._queued = new Set();
  }

  isDown(code) { return this.held.has(code); }
  wasPressed(code) { return this.pressedThisFrame.has(code); }

  /** Movement axis as a normalized direction. Diagonals aren't faster. */
  moveVector() {
    let x = 0, y = 0;
    for (const code of this.held) {
      switch (MOVE_KEYS[code]) {
        case 'up': y -= 1; break;
        case 'down': y += 1; break;
        case 'left': x -= 1; break;
        case 'right': x += 1; break;
      }
    }
    if (x !== 0 && y !== 0) {
      const inv = Math.SQRT1_2;
      x *= inv; y *= inv;
    }
    return [clampAxis(x), clampAxis(y)];
  }
}

// Holding both W and S should cancel out, not stack into 2x speed.
const clampAxis = (v) => (v > 1 ? 1 : v < -1 ? -1 : v);

/**
 * Is this element somewhere the user is entering text or adjusting a control?
 *
 * SELECT and range/checkbox inputs are included on purpose, not just text
 * boxes: arrow keys legitimately drive a slider and a dropdown, and the game
 * swallowing them there would break the settings panel in the same way it
 * broke the login form.
 */
function isTextEntry(el) {
  if (el === null || el === undefined) return false;
  if (el.isContentEditable === true) return true;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}
