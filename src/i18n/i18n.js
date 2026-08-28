/**
 * i18n.js — interface translation.
 *
 * SCOPE, STATED UP FRONT
 * ----------------------
 * This translates the *interface*: menus, buttons, settings, stat names, the
 * things you read while deciding something. It does NOT translate the
 * thousands of lines of item flavour text, weapon blurbs, and character
 * fiction. That is a deliberate line, not an oversight — machine-translating
 * flavour prose produces text that is worse than English for a bilingual
 * player and still wrong for a monolingual one, and hand-translating it is a
 * job for a human translator per language.
 *
 * So: chrome is translated, fiction stays in English. If you later hire
 * translators, the `strings` maps below are where their work drops in, and
 * nothing else has to change.
 *
 * HOW LOOKUP WORKS
 * ----------------
 * `t('key')` returns the active language's string, falling back to English,
 * falling back to the key itself. A missing key is therefore always visible as
 * a key rather than as a blank — silent blanks are how translation gaps ship.
 */

import { getSettings, setSetting, onSettingsChange } from '../meta/settings.js';

/**
 * The languages offered.
 *
 * Chosen as the largest game-playing populations rather than "all languages":
 * a half-finished list of forty is worse than a complete list of nine, because
 * every entry that exists implies a promise that it works.
 *
 * `native` is what the language calls itself — always show that, never the
 * English exonym, because someone looking for their own language is scanning
 * for the word they actually use.
 */
export const LANGUAGES = [
  { id: 'en',    name: 'English',             native: 'English' },
  { id: 'ko',    name: 'Korean',              native: '한국어' },
  { id: 'ja',    name: 'Japanese',            native: '日本語' },
  { id: 'zh',    name: 'Chinese (Simplified)', native: '简体中文' },
  { id: 'es',    name: 'Spanish',             native: 'Español' },
  { id: 'pt',    name: 'Portuguese (Brazil)', native: 'Português' },
  { id: 'fr',    name: 'French',              native: 'Français' },
  { id: 'de',    name: 'German',              native: 'Deutsch' },
  { id: 'ru',    name: 'Russian',             native: 'Русский' },
];

export const LANGUAGE_BY_ID = new Map(LANGUAGES.map((l) => [l.id, l]));

const listeners = new Set();
export function onLanguageChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

let strings = {};
let active = 'en';

/** Translate. Falls back English -> key, so a gap is visible, never blank. */
export function t(key, vars) {
  const table = strings[active] ?? {};
  const en = strings.en ?? {};
  let out = table[key] ?? en[key] ?? key;
  if (vars !== undefined) {
    for (const k in vars) out = out.split('{' + k + '}').join(String(vars[k]));
  }
  return out;
}

export function getLanguage() { return active; }

export function setLanguage(id) {
  if (!LANGUAGE_BY_ID.has(id)) return;
  active = id;
  setSetting('language', id);
  try { document.documentElement.lang = id; } catch { /* non-fatal */ }
  for (const fn of listeners) { try { fn(id); } catch { /* a bad listener must not break the UI */ } }
}

/**
 * Pick a starting language for a device that has never chosen one.
 *
 * Matches the browser's preference against what we actually ship, most
 * specific first, so `ko-KR` finds `ko`. Never guesses beyond the base tag.
 */
export function detectLanguage() {
  const saved = getSettings().language;
  if (LANGUAGE_BY_ID.has(saved)) return saved;
  try {
    for (const tag of navigator.languages ?? [navigator.language]) {
      if (typeof tag !== 'string') continue;
      if (LANGUAGE_BY_ID.has(tag)) return tag;
      const base = tag.split('-')[0];
      if (LANGUAGE_BY_ID.has(base)) return base;
    }
  } catch { /* the API is optional */ }
  return 'en';
}

export function installStrings(tables) {
  strings = tables;
  active = detectLanguage();
  try { document.documentElement.lang = active; } catch { /* non-fatal */ }
}

/**
 * Re-label every `[data-i18n]` node under `root` from the active language.
 *
 * This exists because most of the app's chrome is rendered dynamically and
 * already calls `t()` fresh on every render — that part self-updates for
 * free. What it doesn't cover is the handful of screens that are pure static
 * HTML, built once by index.html and never re-rendered by JS: the hub tab
 * bar, the start button, the pause and game-over overlays, the account
 * form's field labels. Those need something to actually walk the DOM and
 * apply the current language — this is that something.
 *
 * Call it once at boot (after the DOM exists) for the whole document, and
 * again from an `onLanguageChange` listener so a live switch doesn't require
 * a reload.
 */
export function applyStaticStrings(root = document) {
  for (const node of root.querySelectorAll('[data-i18n]')) {
    node.textContent = t(node.dataset.i18n);
  }
}

// Keep language in step if settings are changed from elsewhere.
onSettingsChange((s) => {
  if (s.language !== active && LANGUAGE_BY_ID.has(s.language)) setLanguage(s.language);
});
