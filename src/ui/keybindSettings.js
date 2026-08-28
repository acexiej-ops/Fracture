/**
 * keybindSettings.js — keybinding remapping UI.
 *
 * Lets the player rebind movement keys and ability keys. Bindings persist
 * in localStorage and are read by the Input class on construction.
 *
 * The UI is a settings sub-panel that appears when "Keybindings" is clicked
 * in the main settings panel.
 */

const STORAGE_KEY = 'fracture.keybindings';

/**
 * Default key mappings. Movement keys are NOT remappable (WASD/arrows are
 * hardcoded in Input), but ability keys and ultimate are.
 */
export const DEFAULT_BINDINGS = {
  ability1: 'KeyQ',
  ability2: 'KeyE',
  ability3: 'KeyR',
  ultimate: 'Space',
  pause: 'Escape',
  skillTree: 'KeyK',
  interact: 'KeyF',
};

const LABEL_MAP = {
  ability1: 'Ability 1 (Q)',
  ability2: 'Ability 2 (E)',
  ability3: 'Ability 3 (R)',
  ultimate: 'Ultimate',
  pause: 'Pause',
  skillTree: 'Skill Tree',
  interact: 'Interact',
};

/**
 * Load custom bindings from localStorage, merging with defaults so new
 * bindings are always present even if the save file predates them.
 */
export function loadBindings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return { ...DEFAULT_BINDINGS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_BINDINGS, ...parsed };
  } catch {
    return { ...DEFAULT_BINDINGS };
  }
}

/**
 * Save custom bindings to localStorage.
 */
export function saveBindings(bindings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
  } catch { /* non-fatal */ }
}

/**
 * Reset bindings to defaults.
 */
export function resetBindings() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* non-fatal */ }
  return { ...DEFAULT_BINDINGS };
}

/**
 * Convert an event.code to a human-readable label.
 */
export function codeToLabel(code) {
  if (code === undefined || code === null) return '???';
  return code
    .replace('Key', '')
    .replace('Arrow', '↑↓←→ '.charAt(0) + ' ')
    .replace('Digit', '#')
    .replace('Space', 'Space')
    .replace('ShiftLeft', 'L-Shift')
    .replace('ShiftRight', 'R-Shift')
    .replace('ControlLeft', 'L-Ctrl')
    .replace('ControlRight', 'R-Ctrl')
    .replace('AltLeft', 'L-Alt')
    .replace('AltRight', 'R-Alt');
}

/**
 * Display name for a binding slot.
 */
export function bindingLabel(slot) {
  return LABEL_MAP[slot] ?? slot;
}

/**
 * Create and manage the keybinding settings panel.
 *
 * Usage:
 *   const ui = new KeybindUI();
 *   ui.open();   // shows the panel
 *   ui.close();  // hides it
 */
export class KeybindUI {
  constructor() {
    this.bindings = loadBindings();
    this.listening = null;   // which slot is waiting for a key
    this.container = null;
    this.onUpdate = null;    // callback when bindings change
    this._onKeyDown = this._onKeyDown.bind(this);
  }

  open(containerId = 'settings') {
    this.bindings = loadBindings();
    this.listening = null;

    const parent = document.getElementById(containerId);
    if (parent === null) return;

    // Check if panel already exists
    this.container = parent.querySelector('[data-kb="panel"]');
    if (this.container === null) {
      this.container = document.createElement('div');
      this.container.dataset.kb = 'panel';
      this.container.className = 'settings-subpanel';
      parent.appendChild(this.container);
    }

    this._render();
    this.container.hidden = false;
    window.addEventListener('keydown', this._onKeyDown);
  }

  close() {
    if (this.container !== null) this.container.hidden = true;
    this.listening = null;
    window.removeEventListener('keydown', this._onKeyDown);
  }

  _render() {
    if (this.container === null) return;

    let html = '<h3>Keybindings</h3>';

    for (const [slot, code] of Object.entries(this.bindings)) {
      const label = bindingLabel(slot);
      const keyLabel = codeToLabel(code);
      const isListening = this.listening === slot;

      html += `<div class="kb-row">
        <span class="kb-label">${label}</span>
        <button class="kb-key ${isListening ? 'kb-listening' : ''}"
                data-kb-slot="${slot}" type="button">
          ${isListening ? 'Press a key...' : keyLabel}
        </button>
      </div>`;
    }

    html += `<div class="kb-actions">
      <button class="btn btn-ghost" data-kb="reset" type="button">Reset to Default</button>
      <button class="btn" data-kb="close" type="button">Done</button>
    </div>`;

    this.container.innerHTML = html;

    // Bind click handlers
    for (const btn of this.container.querySelectorAll('[data-kb-slot]')) {
      btn.addEventListener('click', () => {
        const slot = btn.dataset.kbSlot;
        this.listening = this.listening === slot ? null : slot;
        this._render();
      });
    }

    const resetBtn = this.container.querySelector('[data-kb="reset"]');
    if (resetBtn !== null) {
      resetBtn.addEventListener('click', () => {
        this.bindings = resetBindings();
        this.listening = null;
        this._render();
        if (this.onUpdate !== null) this.onUpdate(this.bindings);
      });
    }

    const closeBtn = this.container.querySelector('[data-kb="close"]');
    if (closeBtn !== null) {
      closeBtn.addEventListener('click', () => {
        saveBindings(this.bindings);
        this.close();
        if (this.onUpdate !== null) this.onUpdate(this.bindings);
      });
    }
  }

  _onKeyDown(e) {
    if (this.listening === null) return;
    if (isTextEntry(e.target)) return;

    e.preventDefault();
    e.stopPropagation();

    const code = e.code;

    // Don't allow duplicate bindings (swap if conflict)
    for (const [slot, existing] of Object.entries(this.bindings)) {
      if (slot !== this.listening && existing === code) {
        this.bindings[slot] = this.bindings[this.listening];
        break;
      }
    }

    this.bindings[this.listening] = code;
    this.listening = null;
    saveBindings(this.bindings);
    this._render();
    if (this.onUpdate !== null) this.onUpdate(this.bindings);
  }
}

function isTextEntry(el) {
  if (el === null || el === undefined) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}
