/**
 * hub.js — the between-runs screen: materials, forge, stash, loadout.
 *
 * Rendered as DOM rather than canvas. It's a menu — text, lists and buttons are
 * what the browser is already good at, and keeping it out of the render loop
 * means it costs nothing while a run is going.
 *
 * The whole screen re-renders from the profile on any change. It's a handful of
 * nodes touched only on interaction, so the simplicity is worth far more than
 * the diffing would save.
 */

import { MATERIALS, MATERIALS_ORDERED, TIERS } from '../meta/materials.js';
import { RARITIES, RARITY_ORDER, SLOTS, describeBase } from '../meta/gear.js';
import { WEAPONS } from '../game/weaponDefs.js';
import { BIOMES } from '../game/config.js';
import { FriendsPanel } from './friends.js';
import { RECIPES, RECIPE_BY_ID, isRecipeUnlocked, unlockHint, costFor, canAfford, missingFor } from '../meta/recipes.js';
import { formatTime } from '../core/math.js';
import { sfx } from '../audio/sfx.js';
import { REFORGE_COST, MAX_LOADOUT_PRESETS, loadoutsEqual } from '../meta/profile.js';
import {
  tournamentFor, MUTATORS, describeScore,
} from '../meta/tournament.js';
import { materialIcon, gearIcon, gearPixelIcon } from './icons.js';
import { OPENING_LINE } from '../meta/lore.js';
import {
  CHARACTERS, CHARACTER_BY_ID, DEFAULT_CHARACTER, isCharacterUnlocked,
  characterUnlockHint, characterUnlockProgress,
} from '../meta/characters.js';
import { getMyName } from '../meta/friends.js';
import { DIFFICULTIES, DEFAULT_DIFFICULTY } from '../game/config.js';
import { buildWeapon } from '../game/weaponGen.js';
import { ABILITIES, CHARACTER_ABILITIES } from '../game/abilities.js';
import { getKeyBinding } from '../core/input.js';
import { codeToLabel } from './keybindSettings.js';
import { getSprite } from '../render/pixel.js';
import {
  DRONE_TIERS, OUTPOST_UPGRADES, droneCount, isDroneUnlocked, droneCost,
  upgradeLevel, upgradeCost, productionPerHour, offlineCapHours, bonusChance, pendingYield,
} from '../meta/outpost.js';
import { t } from '../i18n/i18n.js';
import { MultiplayerPanel } from './multiplayer.js';
import { LeaderboardPanel } from './leaderboard.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// Scrip is its own currency, not a material, so it gets its own icon rather
// than borrowing `materialIcon` — a small coin rather than a mined chunk.
const SCRIP_ICON = '<span class="icon icon-material" style="--icon-size:18px">'
  + '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" width="18" height="18">'
  + '<circle cx="16" cy="16" r="12" fill="#ffd166"/>'
  + '<circle cx="16" cy="16" r="12" fill="none" stroke="#a67c1f" stroke-width="1.5"/>'
  + '<text x="16" y="21" font-size="14" font-weight="700" text-anchor="middle" fill="#5c4315">S</text>'
  + '</svg></span>';

// An undiscovered material's icon is deliberately a plain silhouette, not the
// real shape — seeing the shape before finding the material would give away
// more than the "???" name does.
const UNKNOWN_ICON = '<span class="icon icon-material" style="--icon-size:18px">'
  + '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" width="18" height="18">'
  + '<circle cx="16" cy="16" r="12" fill="#3a4456"/>'
  + '<text x="16" y="21" font-size="14" font-weight="700" text-anchor="middle" fill="#6b7788">?</text>'
  + '</svg></span>';

// One small character per drone tier for the Outpost scene — a rounded body
// and a pair of dot eyes, so each drone reads as a little worker doing a job
// rather than an abstract icon. Distinct silhouette and colour per tier so a
// glance at the room tells scrap skimmers from rigs without reading a label.
const DRONE_GLYPH = {
  scrap: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">'
    + '<ellipse cx="12" cy="15" rx="8" ry="6" fill="#8fa4bd"/>'
    + '<circle cx="12" cy="7.2" r="1.5" fill="#8fa4bd"/>'
    + '<line x1="12" y1="8.6" x2="12" y2="10" stroke="#8fa4bd" stroke-width="1.3"/>'
    + '<circle cx="9" cy="14.5" r="1.4" fill="#1c2530"/>'
    + '<circle cx="15" cy="14.5" r="1.4" fill="#1c2530"/>'
    + '</svg>',
  hauler: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">'
    + '<ellipse cx="10.5" cy="15" rx="9" ry="6.5" fill="#ffb703"/>'
    + '<rect x="15" y="9" width="6.5" height="7.5" rx="2" fill="#d99a06"/>'
    + '<circle cx="7.5" cy="14.5" r="1.5" fill="#3a2c00"/>'
    + '<circle cx="13.5" cy="14.5" r="1.5" fill="#3a2c00"/>'
    + '</svg>',
  rig: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">'
    + '<path d="M12 4 L20 12 L12 21 L4 12 Z" fill="#ff5ec4"/>'
    + '<path d="M12 4 L20 12 L12 21 L4 12 Z" fill="#fff" opacity="0.12"/>'
    + '<circle cx="9.3" cy="12" r="1.5" fill="#fff"/>'
    + '<circle cx="14.7" cy="12" r="1.5" fill="#fff"/>'
    + '</svg>',
};

// Where each tier's station sits along the room's floor — spread left/centre/
// right so all three can be visible without overlapping, with the terminal
// fixed at 50% (see _outpostScene). Small per-drone jitter is added around
// this anchor at render time so a cluster of owned drones reads as several
// distinct workers rather than one stack.
const NODE_X = { scrap: 15, hauler: 50, rig: 85 };

// One piece of furniture per drone tier, sat at each station — a crate, a
// salvage cart, a reactor stand — so the room reads as a real place with
// things in it, not a row of unlabelled dots.
const NODE_GLYPH = {
  scrap: '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">'
    + '<ellipse cx="16" cy="28" rx="12" ry="2.4" fill="#000" opacity="0.22"/>'
    + '<rect x="6" y="12" width="20" height="15" rx="2.5" fill="#4a5567"/>'
    + '<rect x="6" y="12" width="20" height="15" rx="2.5" fill="#fff" opacity="0.05"/>'
    + '<rect x="6" y="18.5" width="20" height="2.2" fill="#333c4a"/>'
    + '</svg>',
  hauler: '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">'
    + '<ellipse cx="16" cy="28" rx="13" ry="2.4" fill="#000" opacity="0.22"/>'
    + '<path d="M7 12 L25 12 L21 24 L11 24 Z" fill="#8a6c28"/>'
    + '<path d="M7 12 L25 12 L21 24 L11 24 Z" fill="#fff" opacity="0.06"/>'
    + '<circle cx="12" cy="26" r="2.4" fill="#2a2010"/>'
    + '<circle cx="20" cy="26" r="2.4" fill="#2a2010"/>'
    + '<rect x="10" y="8" width="12" height="3" rx="1.5" fill="#7ce7ff" opacity="0.85"/>'
    + '</svg>',
  rig: '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">'
    + '<ellipse cx="16" cy="28" rx="13" ry="2.4" fill="#000" opacity="0.24"/>'
    + '<path d="M16 9 L26 15 L26 23 L16 29 L6 23 L6 15 Z" fill="#4a2a3d"/>'
    + '<path d="M16 9 L26 15 L26 23 L16 29 L6 23 L6 15 Z" fill="#fff" opacity="0.05"/>'
    + '<circle cx="16" cy="19" r="5" fill="#ff5ec4" class="rig-core"/>'
    + '<circle cx="16" cy="19" r="2.2" fill="#fff" opacity="0.85"/>'
    + '</svg>',
};

export class HubScreen {
  constructor(root, profile, {
    onStart, onCraft, onEquip, onUnequip, onScrap, onReset, onReforge,
    onBuyDrone, onBuyOutpostUpgrade, onCollectOutpost, onSelectCharacter,
    onStartTournament, onStartMulti, net,
    onSavePreset, onLoadPreset, onUpdatePreset, onRenamePreset, onDeletePreset,
  }) {
    this.root = root;
    this.profile = profile;
    this.onStart = onStart;
    this.onStartTournament = onStartTournament ?? (() => {});
    this.onStartMulti = onStartMulti ?? (() => {});
    this.net = net;

    this.multiplayer = new MultiplayerPanel(root.querySelector('[data-hub="multiplayer"]'), net, {
      onStartMulti: () => this.onStartMulti(),
    });
    this.friends = new FriendsPanel(root.querySelector('[data-hub="friends"]'), {
      // A friend's "Join" button lives in the Friends tab but has to act on
      // the Multiplayer tab's panel — switch to it first so the connecting
      // state is actually visible, not just happening off-screen.
      onJoinRoom: (code) => {
        this._switchTab('multiplayer');
        this.multiplayer.joinCode(code);
      },
    });
    this.leaderboard = new LeaderboardPanel(root.querySelector('[data-hub="leaderboard"]'));
    // Same panel class, a second instance: the full tab keeps its search and
    // profile lookup, the persistent sidebar is just the ranked list itself
    // (see .leaderboard-side in main.css) so it's glanceable without leaving
    // whatever tab you're actually on.
    this.sideLeaderboard = new LeaderboardPanel(root.querySelector('[data-hub="side-leaderboard"]'));
    this.onCraft = onCraft;
    this.onEquip = onEquip;
    this.onUnequip = onUnequip;
    this.onScrap = onScrap;
    this.onReset = onReset;
    this.onReforge = onReforge;
    this.onBuyDrone = onBuyDrone;
    this.onBuyOutpostUpgrade = onBuyOutpostUpgrade;
    this.onCollectOutpost = onCollectOutpost;
    this.onSelectCharacter = onSelectCharacter;
    this.onSavePreset = onSavePreset;
    this.onLoadPreset = onLoadPreset;
    this.onUpdatePreset = onUpdatePreset;
    this.onRenamePreset = onRenamePreset;
    this.onDeletePreset = onDeletePreset;

    this.rarity = 'common';   // which rarity the forge is set to craft at
    this.forgeSlotFilter = 'all';   // which slot the recipe list is narrowed to
    this.stashFilters = { rarity: 'all', slot: 'all' };   // Stash tab's own filters
    this.visible = false;
    this.flash = null;        // transient "you made a thing" message
    this.activeTab = 'crew';
    this.playerName = null;   // this session's claimed display name, if any
    this.difficulty = this._loadDifficulty();
    this._outpostTimer = null;  // live ticker while the Outpost tab is open

    this.el = {
      materials: root.querySelector('[data-hub="materials"]'),
      tournament: root.querySelector('[data-hub="tournament"]'),
      friends: root.querySelector('[data-hub="friends"]'),
      record: root.querySelector('[data-hub="record"]'),
      loadout: root.querySelector('[data-hub="loadout"]'),
      summary: root.querySelector('[data-hub="summary"]'),
      recipes: root.querySelector('[data-hub="recipes"]'),
      rarity: root.querySelector('[data-hub="rarity"]'),
      forgeFilters: root.querySelector('[data-hub="forge-filters"]'),
      stash: root.querySelector('[data-hub="stash"]'),
      stashCount: root.querySelector('[data-hub="stash-count"]'),
      stashFilters: root.querySelector('[data-hub="stash-filters"]'),
      start: root.querySelector('[data-hub="start"]'),
      reset: root.querySelector('[data-hub="reset"]'),
      crew: root.querySelector('[data-hub="crew"]'),
      tabbar: root.querySelector('[data-hub="tabbar"]'),
      outpost: root.querySelector('[data-hub="outpost"]'),
      outpostPing: root.querySelector('[data-hub="outpost-ping"]'),
      outpostBurst: root.querySelector('[data-hub="outpost-burst"]'),
      multiplayer: root.querySelector('[data-hub="multiplayer"]'),
      portrait: root.querySelector('[data-hub="portrait"]'),
      playername: root.querySelector('[data-hub="playername"]'),
      overlay: root.querySelector('[data-hub="overlay"]'),
      overlayClose: root.querySelector('[data-hub="overlay-close"]'),
      loadoutEdit: root.querySelector('[data-hub="loadout-edit"]'),
      sidePanel: root.querySelector('[data-hub="side-panel"]'),
      sidePanelToggle: root.querySelector('[data-hub="side-panel-toggle"]'),
      difficulty: root.querySelector('[data-hub="difficulty"]'),
      presets: root.querySelector('[data-hub="presets"]'),
    };

    this.el.start.addEventListener('click', () => this.onStart(this.difficulty));
    this.el.reset.addEventListener('click', () => this._confirmReset());

    this.el.difficulty.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-difficulty]');
      if (btn === null) return;
      this.difficulty = btn.dataset.difficulty;
      this._saveDifficulty(this.difficulty);
      this._renderDifficulty();
    });

    this.el.tabbar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tab]');
      if (btn === null) return;
      this._switchTab(btn.dataset.tab);
    });

    this.el.overlayClose.addEventListener('click', () => this._closeOverlay());
    // Clicking the dimmed backdrop closes it; clicking inside the panel must not.
    this.el.overlay.addEventListener('click', (e) => {
      if (e.target === this.el.overlay) this._closeOverlay();
    });
    // Loadout only shows what's equipped — actually swapping gear happens in
    // the Stash tab, so "Edit" just opens straight to it.
    this.el.loadoutEdit.addEventListener('click', () => this._switchTab('stash'));

    this.el.sidePanelToggle.addEventListener('click', () => {
      this.el.sidePanel.classList.toggle('collapsed');
    });

    this.el.outpost.addEventListener('click', (e) => {
      const drone = e.target.closest('[data-buy-drone]');
      if (drone !== null && !drone.disabled) {
        if (this.onBuyDrone(drone.dataset.buyDrone)) sfx.pick();
        this.render();
        return;
      }
      const upg = e.target.closest('[data-buy-upgrade]');
      if (upg !== null && !upg.disabled) {
        if (this.onBuyOutpostUpgrade(upg.dataset.buyUpgrade)) sfx.pick();
        this.render();
        return;
      }
      const collect = e.target.closest('[data-collect]');
      if (collect !== null && !collect.disabled) {
        const result = this.onCollectOutpost();
        const gotAnything = Object.keys(result.materials).length > 0;
        if (gotAnything) {
          const label = result.bonusMult !== null
            ? t('outpost.bonusHaul', { n: result.bonusMult })
            : t('outpost.collected');
          this._flash(label, result.bonusMult !== null ? 'exotic' : 'common');
          sfx.chest(result.bonusMult !== null ? 'rare' : 'common');
        }
        this.render();
        // Spawned *after* render(), and into a layer render() never rebuilds
        // (see index.html) — the Outpost tab re-renders on its own 1-second
        // ticker, which would otherwise wipe a mid-flight burst out from
        // under itself before the animation had a chance to finish.
        if (gotAnything) this._spawnCollectBurst(result);
      }
    });

    // Delegated: the lists are rebuilt constantly, so binding per-row would
    // mean rebinding on every render.
    this.el.crew.addEventListener('click', (e) => {
      const card = e.target.closest('[data-pick-char]');
      if (card === null || card.classList.contains('locked')) return;
      if (this.onSelectCharacter(card.dataset.pickChar)) {
        sfx.pick();
        this.render();
      }
    });

    // Tournament start. Delegated on the panel because the button is rebuilt
    // by _renderTournament on every render, so a direct listener would be lost.
    if (this.el.tournament !== null && this.el.tournament !== undefined) {
      this.el.tournament.addEventListener('click', (e) => {
        if (e.target.closest('[data-hub="tournament-start"]') === null) return;
        this.onStartTournament();
      });
    }

    this.el.rarity.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-rarity]');
      if (btn === null) return;
      this.rarity = btn.dataset.rarity;
      this.render();
    });

    this.el.recipes.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-craft]');
      if (btn === null || btn.disabled) return;
      const item = this.onCraft(btn.dataset.craft, this.rarity);
      if (item !== null) { this._flash(t('hub.forged', { name: item.name }), item.rarity); sfx.craft(item.rarity); }
      this.render();
    });

    this.el.stash.addEventListener('click', (e) => {
      const equip = e.target.closest('[data-equip]');
      if (equip !== null) { this.onEquip(equip.dataset.equip); this.render(); return; }
      const reforge = e.target.closest('[data-reforge]');
      if (reforge !== null && !reforge.disabled) {
        const ok = this.onReforge(reforge.dataset.reforge);
        if (ok) { this._flash(t('hub.reforged'), this.profile.getItem(reforge.dataset.reforge)?.rarity ?? 'common'); sfx.craft('common'); }
        this.render();
        return;
      }
      const scrap = e.target.closest('[data-scrap]');
      if (scrap !== null) {
        const item = this.profile.getItem(scrap.dataset.scrap);
        if (item !== null && window.confirm(t('hub.confirmScrap', { name: item.name }))) {
          this.onScrap(scrap.dataset.scrap);
          this.render();
        }
      }
    });

    this.el.forgeFilters.addEventListener('click', (e) => {
      const slotBtn = e.target.closest('[data-forge-slot]');
      if (slotBtn === null) return;
      this.forgeSlotFilter = slotBtn.dataset.forgeSlot;
      this.render();
    });

    this.el.stashFilters.addEventListener('click', (e) => {
      const rarityBtn = e.target.closest('[data-stash-rarity]');
      if (rarityBtn !== null) {
        this.stashFilters.rarity = rarityBtn.dataset.stashRarity;
        this.render();
        return;
      }
      const slotBtn = e.target.closest('[data-stash-slot]');
      if (slotBtn !== null) {
        this.stashFilters.slot = slotBtn.dataset.stashSlot;
        this.render();
      }
    });

    this.el.loadout.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-unequip]');
      if (btn === null) return;
      this.onUnequip(btn.dataset.unequip);
      this.render();
    });

    this.el.presets.addEventListener('click', (e) => {
      const save = e.target.closest('[data-preset="save"]');
      if (save !== null) {
        const name = window.prompt(t('hub.presetNamePrompt'));
        if (name === null) return;   // cancelled
        if (!this.onSavePreset(name)) this._flash(t('hub.presetLimitReached'), 'common');
        this.render();
        return;
      }
      const load = e.target.closest('[data-preset-load]');
      if (load !== null) { this.onLoadPreset(Number(load.dataset.presetLoad)); this.render(); return; }
      const update = e.target.closest('[data-preset-update]');
      if (update !== null) {
        this.onUpdatePreset(Number(update.dataset.presetUpdate));
        this._flash(t('hub.presetUpdated'), 'common');
        this.render();
        return;
      }
      const rename = e.target.closest('[data-preset-rename]');
      if (rename !== null) {
        const index = Number(rename.dataset.presetRename);
        const current = this.profile.loadoutPresets[index]?.name ?? '';
        const name = window.prompt(t('hub.presetNamePrompt'), current);
        if (name === null) return;
        this.onRenamePreset(index, name);
        this.render();
        return;
      }
      const del = e.target.closest('[data-preset-delete]');
      if (del !== null) {
        const index = Number(del.dataset.presetDelete);
        const preset = this.profile.loadoutPresets[index];
        if (preset !== undefined && window.confirm(t('hub.confirmDeletePreset', { name: preset.name }))) {
          this.onDeletePreset(index);
          this.render();
        }
      }
    });
  }

  show() {
    this.visible = true;
    this.root.classList.add('visible');
    this.render();
    this.refreshIdentity();
    // Persistent sidebar, not just the tab — it needs its own refresh on
    // every Hub visit rather than only when the Leaderboard tab is clicked.
    this.sideLeaderboard.refresh();

    // A live ticker while the Hub is open — the pending-yield number and the
    // drone scene's animation only need CSS for motion, but the *number*
    // climbing in real time is what makes the Outpost read as "producing
    // right now" instead of a value that happens to update on interaction.
    // Scoped to the Outpost tab specifically inside the callback, so sitting
    // on Forge or Stash never reflows on a timer.
    clearInterval(this._outpostTimer);
    this._outpostTimer = setInterval(() => {
      if (this.activeTab === 'outpost' && !this.el.overlay.hidden) this._renderOutpost(this.profile);
    }, 1000);
  }

  /**
   * Pull the signed-in player's claimed name for the home view.
   *
   * Separate from render() (which is synchronous and fires constantly) since
   * this is the one piece of Hub state that lives on the server rather than
   * in the local profile. Called on show(), and again by main.js whenever
   * sign-in/sign-up/naming/sign-out changes who's signed in.
   */
  async refreshIdentity() {
    this.playerName = await getMyName();
    this.render();
  }

  hide() {
    this.visible = false;
    this.root.classList.remove('visible');
    clearInterval(this._outpostTimer);
    this._outpostTimer = null;
  }

  /**
   * Open a tab's content as an overlay on top of the persistent home view.
   *
   * Clicking the tab that's already open closes it back to the home view —
   * the dock has no separate close button of its own, so the toggle has to
   * live here.
   */
  _switchTab(tab) {
    if (tab === this.activeTab && !this.el.overlay.hidden) { this._closeOverlay(); return; }
    this.activeTab = tab;
    this.el.overlay.hidden = false;

    for (const btn of this.el.tabbar.querySelectorAll('[data-tab]')) {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    }
    for (const panel of this.root.querySelectorAll('[data-tab-panel]')) {
      panel.hidden = panel.dataset.tabPanel !== tab;
    }

    this.render();

    // Friends data is fetched on tab open rather than on every Hub render:
    // each refresh is a server round trip, and the Hub re-renders constantly
    // (every craft, equip, and material change).
    if (tab === 'friends') this.friends.refresh();
    if (tab === 'multiplayer') this.multiplayer.refresh();
    if (tab === 'leaderboard') this.leaderboard.refresh();
  }

  _closeOverlay() {
    this.el.overlay.hidden = true;
    for (const btn of this.el.tabbar.querySelectorAll('[data-tab]')) {
      btn.classList.remove('active');
    }
  }

  _flash(text, rarity) {
    this.flash = { text, rarity };
    clearTimeout(this._flashTimer);
    this._flashTimer = setTimeout(() => { this.flash = null; this.render(); }, 2600);
  }

  _confirmReset() {
    if (!window.confirm(t('hub.confirmReset'))) return;
    this.onReset();
    this.render();
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  render() {
    if (!this.visible) return;
    const p = this.profile;
    this._renderMaterials(p);
    this._renderRecord(p);
    this._renderRarityPicker(p);
    this._renderRecipes(p);
    this._renderStash(p);
    this._renderTournament(p);
    this._renderLoadout(p);
    this._renderOutpost(p);
    this._renderCrew(p);
    this._renderHome(p);
    this._renderDifficulty();
  }

  _loadDifficulty() {
    try {
      const saved = localStorage.getItem('fracture.difficulty');
      return saved !== null && DIFFICULTIES[saved] !== undefined ? saved : DEFAULT_DIFFICULTY;
    } catch { return DEFAULT_DIFFICULTY; }
  }

  _saveDifficulty(id) {
    try { localStorage.setItem('fracture.difficulty', id); } catch { /* non-fatal */ }
  }

  /**
   * A compact picker in the home view rather than a modal — the choice is
   * low-stakes enough (and reversible enough, next run) that it doesn't need
   * its own screen, just a segmented control next to the button it gates.
   */
  _renderDifficulty() {
    const order = ['normal', 'medium', 'hard', 'oneHit'];
    this.el.difficulty.innerHTML = order.map((id) => {
      const on = id === this.difficulty;
      return '<button type="button" class="difficulty-btn difficulty-' + id + (on ? ' active' : '') + '"'
        + ' data-difficulty="' + id + '"' + (on ? ' aria-pressed="true"' : '') + '>'
        + t('difficulty.' + id) + '</button>';
    }).join('');
  }

  /**
   * The persistent center view: whichever character is currently selected,
   * large, with the player's claimed name above it — the same portrait and
   * selection the Crew tab's roster already drives, just always on screen
   * rather than one card among many.
   */
  _renderHome(p) {
    const selected = CHARACTER_BY_ID.get(p.character ?? DEFAULT_CHARACTER)
      ?? CHARACTER_BY_ID.get(DEFAULT_CHARACTER);
    this.el.portrait.innerHTML = characterPortrait(selected, true);
    this.el.playername.textContent = this.playerName !== null ? this.playerName.name : '';
  }

  /**
   * The crew roster — pick which Driftwalker walks in.
   *
   * Each card carries the three things that make the pick a decision: the
   * character's own pixel portrait (rendered through the same sprite pipeline
   * that draws them in-run, so what you choose is literally what you see),
   * the weapon they open with, and the stat lean stated in full including its
   * cost. A locked card still shows all of that plus exactly what unlocks it
   * and how far along you are — a mystery box is not a goal.
   */
  _renderCrew(p) {
    const selected = p.character ?? DEFAULT_CHARACTER;

    this.el.crew.innerHTML = CHARACTERS.map((c) => {
      const unlocked = isCharacterUnlocked(c, p);
      const isSelected = unlocked && c.id === selected;
      const weaponDef = WEAPONS[c.weapon] ?? buildWeapon(...splitWeaponId(c.weapon));
      const weaponName = t('weapon.' + c.weapon + '.name');

      const statLines = c.stats.map((m) => {
        const label = t('stat.' + m.stat, { fallback: STAT_LABEL[m.stat] ?? m.stat });
        const val = m.type === 'inc'
          ? (m.value >= 0 ? '+' : '') + Math.round(m.value * 100) + '%'
          : (m.value >= 0 ? '+' : '') + round(m.value);
        return '<li class="' + (m.value >= 0 ? 'up' : 'down') + '">'
          + '<em>' + esc(label) + '</em>' + val + '</li>';
      }).join('');

      let footer;
      if (unlocked) {
        footer = '<button class="btn-mini btn-pick"' + (isSelected ? ' disabled' : '') + '>'
          + (isSelected ? t('hub.selected') : t('hub.select')) + '</button>';
      } else {
        const pct = Math.round(characterUnlockProgress(c, p) * 100);
        footer = '<div class="crew-lock">'
          + '<div class="crew-lock-bar"><div class="crew-lock-fill" style="width:' + pct + '%"></div></div>'
          + '<span>' + esc(characterUnlockHint(c, p) ?? t('hub.locked')) + '</span>'
          + '</div>';
      }

      return '<article class="crew-card' + (isSelected ? ' is-selected' : '')
        + (unlocked ? '' : ' locked') + '" data-pick-char="' + c.id + '"'
        + ' style="--cc:' + c.palette + '">'
        + '<header>'
        + '<span class="crew-portrait">' + characterPortrait(c, unlocked) + '</span>'
        + '<div><h4>' + esc(c.name) + '</h4>'
        + '<span class="crew-title">' + esc(c.title) + '</span></div>'
        + '</header>'
        + '<p class="crew-blurb">' + esc(c.blurb) + '</p>'
        + '<p class="crew-weapon"><em>' + t('hub.opensWith') + '</em> ' + esc(weaponName) + '</p>'
        + '<ul class="crew-stats">' + statLines + '</ul>'
        + characterKit(c.id)
        + '<p class="crew-lean">' + esc(c.lean) + '</p>'
        + footer
        + '</article>';
    }).join('');
  }

  _renderMaterials(p) {
    const scripChip = '<span class="mat tier-scrip" title="' + t('hub.scripTooltip') + '">'
      + SCRIP_ICON + '<em>' + t('run.scrip') + '</em><b>' + p.scrip + '</b></span>';

    this.el.materials.innerHTML = scripChip + MATERIALS_ORDERED.map((m) => {
      const held = p.materials[m.id] ?? 0;
      // Common materials are always named: they're the baseline currency, and
      // the starting recipes quote their cost in them, so hiding them behind
      // discovery just made the forge read as contradicting the ledger. Rare
      // and exotic stay hidden until found — that's where discovery is worth
      // something.
      const seen = m.tier === 'common' || p.seenMaterials.includes(m.id);
      return '<span class="mat tier-' + m.tier + (seen ? '' : ' unseen')
        + '" title="' + esc(seen ? m.blurb : t('material.notDiscovered')) + '">'
        + (seen ? materialIcon(m.id, 18) : UNKNOWN_ICON)
        + '<em>' + esc(seen ? t('material.' + m.id + '.name') : '???') + '</em>'
        + '<b>' + (seen ? held : '-') + '</b></span>';
    }).join('');
  }

  _renderRecord(p) {
    const m = p.milestones;
    const bits = [];
    if (m.runs > 0) {
      bits.push(m.runs === 1 ? t('hub.recordRun', { n: m.runs }) : t('hub.recordRuns', { n: m.runs }));
      bits.push(t('hub.recordBest', { time: formatTime(m.bestTime) }) + ' / ' + t('hub.recordWave', { n: m.bestWave }));
      bits.push(t('hub.recordKills', { n: m.totalKills.toLocaleString() }));
    } else {
      bits.push(OPENING_LINE);
    }
    this.el.record.textContent = bits.join('  ·  ');
  }

  _renderRarityPicker(p) {
    this.el.rarity.innerHTML = RARITY_ORDER.map((id) => {
      const r = RARITIES[id];
      const on = id === this.rarity;
      return '<button class="rarity-btn' + (on ? ' active' : '') + '" data-rarity="' + id + '"'
        + ' style="--rc:' + r.color + '">'
        + esc(t('rarity.' + id + '.name'))
        + '<small>' + (r.affixes === 1 ? t('rarity.affix', { n: r.affixes }) : t('rarity.affixes', { n: r.affixes })) + '</small>'
        + '</button>';
    }).join('')
    + (this.flash !== null
        ? '<span class="forge-flash" style="--rc:' + RARITIES[this.flash.rarity].color + '">'
          + esc(this.flash.text) + '</span>'
        : '');
  }

  /** Slot filter for the Forge's recipe list — same "all plus every real
   *  value" segmented row as the Stash's filters, just slot-only (a recipe
   *  has no fixed rarity of its own to filter by; that's what the rarity
   *  picker above it already controls). */
  _renderForgeFilters(p) {
    const slotBtn = (id, label) => '<button type="button" class="stash-filter-btn'
      + (this.forgeSlotFilter === id ? ' active' : '') + '" data-forge-slot="' + id + '">'
      + label + '</button>';

    this.el.forgeFilters.innerHTML = '<div class="stash-filter-row">'
      + slotBtn('all', t('hub.filterAll'))
      + Object.values(SLOTS).map((s) => slotBtn(s.id, t('slot.' + s.id + '.name'))).join('')
      + '</div>';
  }

  _renderRecipes(p) {
    this._renderForgeFilters(p);
    const filtered = this.forgeSlotFilter === 'all'
      ? RECIPES
      : RECIPES.filter((recipe) => recipe.slot === this.forgeSlotFilter);

    if (filtered.length === 0) {
      this.el.recipes.innerHTML = '<p class="empty">' + t('hub.stashNoMatch') + '</p>';
      return;
    }

    const rows = filtered.map((recipe) => {
      const unlocked = isRecipeUnlocked(recipe, p);
      // A preview icon at the rarity currently dialled in on the picker —
      // what you're about to forge, not just what you already have.
      const icon = gearPixelIcon(recipe.art, this.rarity, 40)
        ?? gearIcon({ slot: recipe.slot, weaponId: recipe.weaponId, rarity: this.rarity }, 34);

      if (!unlocked) {
        return '<div class="recipe locked">'
          + '<div class="recipe-head">' + icon + '<div><h3>' + esc(t('recipe.' + recipe.id + '.name')) + '</h3>'
          + '<span class="slot">' + esc(t('slot.' + recipe.slot + '.name')) + '</span></div></div>'
          + '<p class="locked-why">' + t('hub.lockedPrefix') + esc(unlockHint(recipe, p) ?? t('hub.keepPlaying')) + '</p>'
          + '</div>';
      }

      const cost = costFor(recipe, this.rarity);
      const affordable = canAfford(cost, p.materials);
      const missing = missingFor(cost, p.materials);

      const costHtml = Object.keys(cost).map((id) => {
        const short = missing[id] !== undefined;
        return '<span class="cost' + (short ? ' short' : '') + '">'
          + materialIcon(id, 15)
          + cost[id] + ' ' + esc(t('material.' + id + '.name')) + '</span>';
      }).join('');

      return '<div class="recipe">'
        + '<div class="recipe-head">' + icon + '<div><h3>' + esc(t('recipe.' + recipe.id + '.name')) + '</h3>'
        + '<span class="slot">' + esc(t('slot.' + recipe.slot + '.name')) + '</span></div></div>'
        + '<p class="recipe-blurb">' + esc(recipe.blurb) + '</p>'
        + '<div class="cost-row">' + costHtml + '</div>'
        + '<button class="btn btn-craft" data-craft="' + recipe.id + '"'
        + (affordable ? '' : ' disabled') + '>'
        + (affordable ? t('hub.forgePrefix') + esc(t('rarity.' + this.rarity + '.name')) : t('hub.notEnoughMaterials'))
        + '</button>'
        + '</div>';
    });
    this.el.recipes.innerHTML = rows.join('');
  }

  /**
   * The tournament panel.
   *
   * The whole ruleset is derived from the calendar on the client, so this
   * renders correctly offline and needs no server — which is the only reason
   * a shared-seed mode is possible on a static site at all.
   */
  _renderTournament(p) {
    if (this.el.tournament === null || this.el.tournament === undefined) return;
    const tw = tournamentFor();
    const best = (p.tournament ?? {})[tw.key] ?? 0;

    const rules = tw.mutators.map((id) => {
      const m = MUTATORS[id];
      if (m === undefined) return '';
      return '<li><strong>' + esc(m.name) + '</strong> — ' + esc(m.blurb) + '</li>';
    }).join('');

    // Past weeks, most recent first. Kept because a rotation that erases your
    // history makes every previous week feel like it did not count.
    const history = Object.entries(p.tournament ?? {})
      .filter(([k]) => k !== tw.key)
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .slice(0, 5)
      .map(([k, v]) => '<li><span class="tw-week">' + esc(k) + '</span>'
        + '<span class="tw-score">' + esc(describeScore(v)) + '</span></li>')
      .join('');

    this.el.tournament.innerHTML =
      '<div class="tw-head">'
      + '<h3>' + esc(tw.key) + '</h3>'
      + '<span class="tw-biome">' + esc(t('biome.' + tw.biome + '.name') ?? BIOMES[tw.biome]?.name ?? tw.biome) + '</span>'
      + '</div>'
      + '<p class="tw-blurb">' + t('tournament.blurb') + '</p>'
      + '<ul class="tw-rules">' + rules + '</ul>'
      + '<div class="tw-best">' + t('tournament.yourBest', { score: esc(describeScore(best)) }) + '</div>'
      + '<button class="btn btn-start" data-hub="tournament-start">' + t('tournament.start') + '</button>'
      + (history !== '' ? '<h4 class="tw-history-title">' + t('tournament.previousWeeks') + '</h4>'
          + '<ul class="tw-history">' + history + '</ul>' : '');
  }

  /**
   * Rarity + slot filters for the Stash. Both are "all plus every real
   * value" segmented rows rather than a dropdown — the roster is small
   * enough (8 rarities, 3 slots) that every option fits on screen at once,
   * which is one fewer click than a dropdown for the common case of
   * switching filters repeatedly while sorting through a big stash.
   */
  _renderStashFilters(p) {
    const rarityBtn = (id, label) => '<button type="button" class="stash-filter-btn'
      + (this.stashFilters.rarity === id ? ' active' : '') + '" data-stash-rarity="' + id + '">'
      + label + '</button>';
    const slotBtn = (id, label) => '<button type="button" class="stash-filter-btn'
      + (this.stashFilters.slot === id ? ' active' : '') + '" data-stash-slot="' + id + '">'
      + label + '</button>';

    const rarityRow = '<div class="stash-filter-row">'
      + rarityBtn('all', t('hub.filterAll'))
      + RARITY_ORDER.map((id) => rarityBtn(id, t('rarity.' + id + '.name'))).join('')
      + '</div>';

    const slotRow = '<div class="stash-filter-row">'
      + slotBtn('all', t('hub.filterAll'))
      + Object.values(SLOTS).map((s) => slotBtn(s.id, t('slot.' + s.id + '.name'))).join('')
      + '</div>';

    this.el.stashFilters.innerHTML = rarityRow + slotRow;
  }

  _renderStash(p) {
    this.el.stashCount.textContent = p.gear.length > 0 ? '(' + p.gear.length + ')' : '';

    this._renderStashFilters(p);

    if (p.gear.length === 0) {
      this.el.stash.innerHTML = '<p class="empty">' + t('hub.nothingForged') + '</p>';
      return;
    }

    // Newest first: the thing you just made is the thing you want to look at.
    const { rarity: rarityFilter, slot: slotFilter } = this.stashFilters;
    const filtered = p.gear.filter((item) =>
      (rarityFilter === 'all' || item.rarity === rarityFilter)
      && (slotFilter === 'all' || item.slot === slotFilter));
    const sorted = filtered.sort((a, b) => b.craftedAt - a.craftedAt);

    if (sorted.length === 0) {
      this.el.stash.innerHTML = '<p class="empty">' + t('hub.stashNoMatch') + '</p>';
      return;
    }

    this.el.stash.innerHTML = sorted.map((item) => {
      const equipped = p.loadout[item.slot] === item.uid;
      const reforgeCost = REFORGE_COST[item.rarity] ?? REFORGE_COST.common;
      const canReforge = p.scrip >= reforgeCost;
      // A boss-unique trophy can't be scrapped (Profile.scrap refuses it —
      // it's the only way to ever get it back, since "already earned" is
      // tracked separately from whether the item still exists), so the
      // button that would just silently fail is left off entirely.
      const scrapBtn = item.isBossUnique === true ? '' :
        '<button class="btn-mini btn-danger" data-scrap="' + item.uid + '">' + t('hub.scrap') + '</button>';
      return this._itemCard(item, {
        equipped,
        actions: '<button class="btn-mini" data-equip="' + item.uid + '"'
          + (equipped ? ' disabled' : '') + '>' + (equipped ? t('hub.equipped') : t('hub.equip')) + '</button>'
          + '<button class="btn-mini" data-reforge="' + item.uid + '"'
          + (canReforge ? '' : ' disabled')
          + ' title="' + t('hub.reforgeTitle', { n: reforgeCost }) + '">'
          + t('hub.reforgeN', { n: reforgeCost }) + '</button>'
          + scrapBtn,
      });
    }).join('');
  }

  /** One gear card. Shared by the stash and the loadout slots. */
  _itemCard(item, { equipped = false, actions = '' } = {}) {
    const r = RARITIES[item.rarity];
    // A crafted item remembers which recipe made it, which is how it finds
    // its art. A boss-unique trophy (meta/bossUniques.js) carries its own
    // art directly instead — it deliberately has no real Forge recipe to
    // look one up through. Items saved before recipes carried art fall
    // through to the generated shape rather than rendering a hole.
    const art = item.art ?? RECIPE_BY_ID.get(item.recipe)?.art;
    const icon = gearPixelIcon(art, item.rarity, 40) ?? gearIcon(item, 36);
    const baseLines = item.base.map((b) =>
      '<li class="base">' + esc(describeBase(b)) + '</li>').join('');
    const affixLines = item.affixes.map((a) =>
      '<li class="affix"><em>' + esc(a.name) + '</em> ' + esc(a.desc) + '</li>').join('');
    const uniqueBadge = item.isBossUnique === true
      ? '<span class="rarity boss-unique">' + t('hub.bossUnique') + '</span>' : '';

    return '<article class="item rarity-' + item.rarity + (equipped ? ' is-equipped' : '') + '"'
      + ' style="--rc:' + r.color + '">'
      + '<header>' + icon + '<div><h4>' + esc(item.name) + '</h4>'
      + '<span class="rarity">' + esc(t('rarity.' + item.rarity + '.name')) + '</span>' + uniqueBadge + '</div></header>'
      + '<ul class="item-stats">' + baseLines + affixLines + '</ul>'
      + (actions !== '' ? '<div class="item-actions">' + actions + '</div>' : '')
      + '</article>';
  }

  /**
   * Named snapshots of the loadout — save the current one, then switch
   * between saved builds with one click instead of re-equipping three slots
   * from memory each time. Capped at MAX_LOADOUT_PRESETS; each row carries
   * its own load/update/rename/delete rather than a separate edit mode,
   * since there's rarely more than a couple on screen at once.
   */
  _renderPresets(p) {
    const rows = p.loadoutPresets.map((preset, i) => {
      const isCurrent = loadoutsEqual(preset.items, p.loadout);
      return '<li class="preset-row' + (isCurrent ? ' is-current' : '') + '">'
        + '<button type="button" class="preset-name" data-preset-load="' + i + '"'
        + (isCurrent ? ' disabled' : '') + '>' + esc(preset.name) + '</button>'
        + '<span class="preset-actions">'
        + '<button type="button" class="btn-mini" data-preset-update="' + i + '" title="'
        + t('hub.presetUpdateTitle') + '">' + t('hub.presetUpdate') + '</button>'
        + '<button type="button" class="btn-mini" data-preset-rename="' + i + '">' + t('hub.rename') + '</button>'
        + '<button type="button" class="btn-mini btn-danger" data-preset-delete="' + i + '">' + t('hub.scrap') + '</button>'
        + '</span></li>';
    }).join('');

    const canAddMore = p.loadoutPresets.length < MAX_LOADOUT_PRESETS;
    this.el.presets.innerHTML = '<ul class="preset-list">' + rows + '</ul>'
      + (canAddMore
        ? '<button type="button" class="btn-mini btn-ghost preset-save" data-preset="save">'
          + t('hub.presetSave') + '</button>'
        : '<p class="preset-limit">' + t('hub.presetLimitReached') + '</p>');
  }

  /**
   * Two columns, matching how the equipment screen this is modelled on lays
   * it out: Weapon / Necklace / Gloves on the left, Suit / Belt / Boots on
   * the right — not an arbitrary reading order, so keep it explicit rather
   * than deriving it from `SLOTS`' own (alphabetical-ish) key order.
   */
  _renderLoadout(p) {
    this._renderPresets(p);

    const left = ['weapon', 'necklace', 'gloves'].map((s) => this._slotCard(s, p.loadout[s])).join('');
    const right = ['suit', 'belt', 'boots'].map((s) => this._slotCard(s, p.loadout[s])).join('');

    this.el.loadout.innerHTML = '<div class="loadout-columns">'
      + '<div class="loadout-col">' + left + '</div>'
      + '<div class="loadout-col">' + right + '</div>'
      + '</div>';
    this._renderSummary(p);
  }

  /** One loadout slot card. */
  _slotCard(slotId, uid) {
    const item = uid !== null && uid !== undefined ? this.profile.getItem(uid) : null;
    const name = esc(t('slot.' + slotId + '.name'));

    if (item === null) {
      return '<div class="slot-card empty">'
        + '<header><h4>' + name + '</h4></header>'
        + '<p class="slot-blurb">' + esc(t('slot.' + slotId + '.blurb')) + '</p>'
        + '<p class="slot-empty">' + t('hub.empty') + '</p></div>';
    }

    return '<div class="slot-card filled">'
      + '<header><h4>' + name + '</h4>'
      + '<button class="btn-mini" data-unequip="' + slotId + '">' + t('hub.remove') + '</button></header>'
      + this._itemCard(item)
      + '</div>';
  }

  /**
   * The combined effect of everything equipped.
   *
   * Worth showing because affixes stack across items — two pieces each giving
   * +8% crit is +16%, and the player should be able to see that without doing
   * the arithmetic themselves.
   */
  _renderSummary(p) {
    const items = p.equippedItems();
    if (items.length === 0) {
      this.el.summary.innerHTML = '<p class="empty">' + t('hub.emptyLoadout') + '</p>';
      return;
    }

    const totals = {};
    const flags = {};
    const weapons = [];
    const weaponLines = [];

    for (const item of items) {
      if (item.slot === 'weapon' && item.weaponId !== undefined) weapons.push(item.weaponId);
      // Weapon-scoped bases are listed separately: folding "+19% Splinter
      // damage" into a global "+19% damage" line would be a lie.
      for (const b of item.base) {
        if (b.weapon !== undefined) weaponLines.push(describeBase(b));
        else accumulate(totals, b);
      }
      for (const a of item.affixes) {
        for (const m of a.mods) accumulate(totals, m);
        for (const k in a.flags) flags[k] = (flags[k] ?? 0) + a.flags[k];
      }
    }

    // Sign the value rather than assuming every bonus is positive — a weapon
    // rig's cooldown roll is a *reduction*, and "+-10%" is nonsense.
    const signed = (v) => (v >= 0 ? '+' : '') + v;

    const lines = [];
    for (const key in totals) {
      const tot = totals[key];
      const label = t('stat.' + key);
      if (tot.flat !== 0) lines.push(label + ' ' + signed(round(tot.flat)));
      if (tot.inc !== 0) lines.push(label + ' ' + signed(Math.round(tot.inc * 100)) + '%');
    }

    // Splinter is always granted, so a Splinter rig must not list it twice.
    const names = [t('weapon.splinter.name')];
    for (const id of weapons) {
      const name = t('weapon.' + id + '.name');
      if (!names.includes(name)) names.push(name);
    }
    const weaponLine = '<p class="summary-weapons">' + t('hub.startingWeapons', { names: names.join(', ') }) + '</p>';

    const flagCount = Object.keys(flags).length;

    this.el.summary.innerHTML = '<h3>' + t('hub.equippedTotal') + '</h3>'
      + weaponLine
      + '<p class="summary-stats">' + (lines.length > 0 ? esc(lines.join('  ·  ')) : t('hub.noStatBonuses'))
      + '</p>'
      + (weaponLines.length > 0
          ? '<p class="summary-stats">' + esc(weaponLines.join('  ·  ')) + '</p>' : '')
      + (flagCount > 0
          ? '<p class="summary-flags">' + (flagCount === 1 ? t('hub.specialEffect', { n: flagCount }) : t('hub.specialEffects', { n: flagCount })) + '</p>'
          : '');
  }

  // -------------------------------------------------------------------------
  // Outpost — a passive colony, entirely separate from the Forge/Stash loop.
  // -------------------------------------------------------------------------

  _renderOutpost(p) {
    const now = Date.now();
    const pending = pendingYield(p, now);
    const hasPending = Object.keys(pending.materials).length > 0;
    const cap = offlineCapHours(p);

    // A quiet nudge on the tab itself when there's something worth collecting
    // and the player isn't already looking at it — the whole point of a
    // passive system is that you don't have to be staring at it to benefit,
    // but it should still be visible that it did something.
    const outpostOpen = this.activeTab === 'outpost' && !this.el.overlay.hidden;
    this.el.outpostPing.hidden = !hasPending || outpostOpen;

    this.el.outpost.innerHTML = this._outpostScene(p, pending, cap)
      + this._outpostCollectPanel(p, pending, cap)
      + this._outpostShop(p)
      + this._outpostUpgrades(p);
  }

  /**
   * The colony scene — a room the player looks into, not a counter. A wall
   * band and a floor band give it a contained space rather than an abstract
   * backdrop; a wall-mounted shelf and viewport are pure flavour, but the
   * floor is functional — an ops terminal fixed centre-back, and one station
   * per owned drone tier spread left/centre/right, with drones shuttling
   * between their station and the terminal so the room reads as a place with
   * things happening in it, not a row of icons. The terminal's two-tone
   * screen fill is the same pending Slag/Filament split the collect panel's
   * numbers show below it, drawn as a level rather than a percentage.
   */
  _outpostScene(p, pending, cap) {
    const MAX_SHOWN_PER_TIER = 5;
    const now = Date.now();
    let nodeMarkup = '';
    let droneMarkup = '';
    let totalOwned = 0;

    for (const t of DRONE_TIERS) {
      const owned = droneCount(p, t.id);
      totalOwned += owned;
      if (owned === 0) continue;

      const nodeX = NODE_X[t.id];
      nodeMarkup += '<div class="outpost-node" style="left:' + nodeX + '%" title="' + esc(t.name) + '">'
        + NODE_GLYPH[t.id] + '</div>';

      const shown = Math.min(owned, MAX_SHOWN_PER_TIER);
      for (let i = 0; i < shown; i++) {
        // Small stable jitter around the station anchor so several owned
        // drones huddled at one station read as distinct workers rather than
        // one stack sitting exactly on top of itself. A matching jitter on
        // the terminal side keeps simultaneous depositors apart too.
        const jitterX = ((i * 13 + t.order * 7) % 9) - 4;
        const jitterY = (i * 5) % 3 * 3;
        const termJitterX = ((i * 17 + t.order * 11) % 7) - 3;

        // Each drone gets its own cycle length so a squad never moves in
        // lockstep. The scene rebuilds every second (the live ticker), which
        // would normally snap every animation back to its start — instead
        // the delay is a *negative* offset derived from the real clock, so a
        // freshly-rebuilt element resumes exactly where its predecessor left
        // off rather than visibly restarting.
        const duration = 6.2 + ((i * 7 + t.order * 3) % 5) * 0.7;
        const phaseMs = (i * 3671 + t.order * 977) % 10000;
        const cyclePos = (now + phaseMs) % (duration * 1000);
        const delay = (-cyclePos / 1000).toFixed(2);
        droneMarkup += '<span class="drone" style="--node-x:' + (nodeX + jitterX) + '%; --node-y:' + (13 + jitterY) + 'px; '
          + '--term-x:' + (50 + termJitterX) + '%; --term-y:74px; --dur:' + duration.toFixed(2) + 's; --delay:' + delay + 's" '
          + 'title="' + esc(t.name) + '">' + DRONE_GLYPH[t.id] + '</span>';
      }
      if (owned > shown) {
        droneMarkup += '<span class="drone-more" style="left:' + nodeX + '%">+' + (owned - shown) + '</span>';
      }
    }

    // Two-tone screen fill: bottom band is Slag, the band above it Filament —
    // the same materials, in the same rough proportion, that the pending
    // readout below lists by number. Not just a percentage bar in a monitor.
    const fillFrac = cap > 0 ? Math.min(1, pending.hoursCovered / cap) : 0;
    const slagAmt = pending.materials.slag ?? 0;
    const filAmt = pending.materials.filament ?? 0;
    const slagRatio = slagAmt + filAmt > 0 ? slagAmt / (slagAmt + filAmt) : 0.5;
    const innerH = 50;
    const totalFillH = fillFrac * innerH;
    const slagH = totalFillH * slagRatio;
    const filH = totalFillH - slagH;
    const bodyBottom = 57;
    const slagY = bodyBottom - slagH;
    const filY = bodyBottom - totalFillH;

    const rate = productionPerHour(p);
    const hasProduction = rate.slag > 0 || rate.filament > 0;
    const led = '<circle cx="36" cy="10" r="2.2" fill="' + (hasProduction ? '#7cfc8a' : '#4a5567')
      + '" class="' + (hasProduction ? 'term-led on' : 'term-led') + '"/>';

    const terminal = '<div class="outpost-terminal" data-hub="outpost-terminal">'
      + '<svg viewBox="0 0 46 84" xmlns="http://www.w3.org/2000/svg">'
      + '<ellipse cx="23" cy="80" rx="20" ry="3" fill="#000" opacity="0.25"/>'
      + '<rect x="3" y="66" width="40" height="12" rx="3" fill="#333c4a"/>'
      + '<rect x="3" y="66" width="40" height="12" rx="3" fill="#fff" opacity="0.04"/>'
      + '<rect x="19" y="58" width="8" height="10" fill="#232b38"/>'
      + '<rect x="6" y="4" width="34" height="56" rx="5" fill="#1a212c" '
      + 'stroke="rgba(255,255,255,0.22)" stroke-width="1.4"/>'
      + '<clipPath id="outpost-term-clip"><rect x="9" y="7" width="28" height="50" rx="3"/></clipPath>'
      + '<g clip-path="url(#outpost-term-clip)">'
      + '<rect x="9" y="' + slagY.toFixed(1) + '" width="28" height="' + slagH.toFixed(1) + '" fill="#9fb3c8"/>'
      + '<rect x="9" y="' + filY.toFixed(1) + '" width="28" height="' + filH.toFixed(1) + '" fill="#7ce7ff"/>'
      + '<rect x="9" y="7" width="28" height="1.4" fill="#fff" opacity="0.08"/>'
      + '<rect x="9" y="22" width="28" height="1.4" fill="#fff" opacity="0.05"/>'
      + '<rect x="9" y="37" width="28" height="1.4" fill="#fff" opacity="0.05"/>'
      + '</g>'
      + led
      + '</svg></div>';

    // A little wall-mounted flavour, cheap and static except for the shelf:
    // one pip per two total Outpost upgrade levels bought, capped small — a
    // trophy shelf that quietly tracks real investment without becoming a
    // second progress bar.
    const upgLevels = upgradeLevel(p, 'speed') + upgradeLevel(p, 'cap') + upgradeLevel(p, 'luck');
    const pipCount = Math.min(6, Math.floor(upgLevels / 2));
    let pips = '';
    for (let i = 0; i < pipCount; i++) {
      pips += '<circle cx="' + (8 + i * 9) + '" cy="5" r="2.6" fill="#7ce7ff" opacity="0.85"/>';
    }
    const shelf = '<div class="outpost-shelf">'
      + '<svg viewBox="0 0 62 10" xmlns="http://www.w3.org/2000/svg">'
      + '<rect x="0" y="7" width="62" height="3" rx="1.5" fill="#2c3646"/>'
      + pips
      + '</svg></div>';

    const window_ = '<div class="outpost-window">'
      + '<svg viewBox="0 0 34 34" xmlns="http://www.w3.org/2000/svg">'
      + '<circle cx="17" cy="17" r="15" fill="#141a24" stroke="rgba(255,255,255,0.2)" stroke-width="1.6"/>'
      + '<circle cx="12" cy="12" r="1.1" fill="#7ce7ff" opacity="0.8"/>'
      + '<circle cx="22" cy="9" r="0.8" fill="#fff" opacity="0.6"/>'
      + '<circle cx="24" cy="19" r="1" fill="#ffb703" opacity="0.7"/>'
      + '<circle cx="9" cy="21" r="0.7" fill="#fff" opacity="0.5"/>'
      + '</svg></div>';

    const room = '<div class="outpost-wall"></div>'
      + '<div class="outpost-baseboard"></div>'
      + '<div class="outpost-floor"></div>'
      + window_ + shelf;

    if (totalOwned === 0) {
      return '<div class="outpost-scene empty">'
        + room
        + terminal
        + '<p class="empty-hint">' + t('outpost.noDronesYet') + '</p>'
        + '</div>';
    }

    return '<div class="outpost-scene">'
      + room
      + terminal
      + '<div class="outpost-nodes">' + nodeMarkup + '</div>'
      + '<div class="outpost-drones">' + droneMarkup + '</div>'
      + '</div>';
  }

  _outpostCollectPanel(p, pending, cap) {
    const hasPending = Object.keys(pending.materials).length > 0;
    const rate = productionPerHour(p);
    const hasProduction = rate.slag > 0 || rate.filament > 0;

    const rateLine = hasProduction
      ? t('outpost.rate', { slag: round(rate.slag), filament: round(rate.filament) })
      : t('outpost.noProduction');

    const pendingBits = Object.entries(pending.materials)
      .map(([id, n]) => '<span class="pending-mat">' + materialIcon(id, 17) + '+' + n + '</span>');

    const chance = Math.round(bonusChance(p) * 100);
    const fillPct = cap > 0 ? Math.min(100, Math.round((pending.hoursCovered / cap) * 100)) : 0;

    return '<div class="outpost-collect">'
      + '<div class="outpost-rate">' + esc(rateLine)
      + '<span class="outpost-cap">' + t('outpost.bonusChance', { n: chance }) + '</span></div>'

      + '<div class="outpost-cap-bar" title="' + pending.hoursCovered.toFixed(1) + 'h of ' + cap + 'h offline cap">'
      + '<div class="outpost-cap-fill' + (pending.cappedOut ? ' maxed' : '') + '" style="width:' + fillPct + '%"></div>'
      + '<span class="outpost-cap-label">' + pending.hoursCovered.toFixed(1) + 'h / ' + cap + 'h'
      + (pending.cappedOut ? t('outpost.capped') : '') + '</span>'
      + '</div>'

      + '<div class="outpost-pending" data-hub="outpost-pending">'
      + (hasPending
          ? pendingBits.join('')
          : '<span class="pending-empty">' + t('outpost.nothingToCollect') + '</span>')
      + '</div>'
      + '<button class="btn btn-collect" data-collect' + (hasPending ? '' : ' disabled') + '>' + t('outpost.collect') + '</button>'
      + '</div>';
  }

  /**
   * The collect payoff: a burst of "+N" material text rising out of the
   * pending readout, plus the terminal screen visibly flashing a beat later —
   * inserted into a layer `_renderOutpost` never rebuilds (see index.html),
   * so the Outpost tab's own 1-second ticker can't wipe it mid-animation.
   */
  _spawnCollectBurst(result) {
    const bits = Object.entries(result.materials)
      .map(([id, n]) => '<span class="burst-line">' + materialIcon(id, 20) + '+' + n + '</span>');
    if (result.bonusMult !== null) {
      bits.push('<span class="burst-line burst-bonus">x' + result.bonusMult + ' ' + t('outpost.bonus') + '</span>');
    }

    // The burst layer lives outside the rebuilt `.outpost` subtree (see
    // index.html) precisely so a mid-animation re-render can't wipe it, but
    // that means it can't rely on being laid out next to the pending row any
    // more — its `top` is pinned here, each time, to that row's actual
    // current on-screen position, so it tracks the scene's real height
    // rather than a number tuned to one snapshot of it.
    const pendingRow = this.el.outpost.querySelector('[data-hub="outpost-pending"]');
    if (pendingRow !== null) {
      const panelRect = this.el.outpostBurst.parentElement.getBoundingClientRect();
      const rowRect = pendingRow.getBoundingClientRect();
      this.el.outpostBurst.style.top = (rowRect.top - panelRect.top) + 'px';
    }

    const el = document.createElement('div');
    el.className = 'outpost-burst' + (result.bonusMult !== null ? ' is-bonus' : '');
    el.innerHTML = bits.join('');
    this.el.outpostBurst.appendChild(el);
    setTimeout(() => el.remove(), 1400);

    // The terminal itself gets a one-shot "just drained" flash, timed to
    // land as the floating numbers clear it — its next render (the very next
    // tick) will already show the fill back near empty, so this is purely
    // the beat that sells the transition rather than a literal height
    // animation.
    const terminal = this.el.outpost.querySelector('.outpost-terminal');
    if (terminal !== null) {
      terminal.classList.remove('collected');
      void terminal.offsetWidth;
      terminal.classList.add('collected');
    }
  }

  _outpostShop(p) {
    const rows = DRONE_TIERS.map((tier) => {
      const owned = droneCount(p, tier.id);
      const unlocked = isDroneUnlocked(p, tier.id);
      const icon = '<span class="icon-drone">' + DRONE_GLYPH[tier.id] + '</span>';

      if (!unlocked) {
        const need = DRONE_TIERS.find((x) => x.id === tier.unlockRequires);
        return '<div class="outpost-row locked">'
          + '<div class="outpost-row-head">' + icon + '<h4>' + esc(tier.name) + '</h4><span class="locked-tag">' + t('hub.locked') + '</span></div>'
          + '<p class="outpost-row-blurb">' + t('outpost.ownFirst', { name: esc(need.name) }) + '</p>'
          + '</div>';
      }

      const cost = droneCost(p, tier.id);
      const affordable = canAfford(cost, p.materials);
      const costHtml = Object.entries(cost).map(([id, n]) =>
        '<span class="cost' + ((p.materials[id] ?? 0) < n ? ' short' : '') + '">'
        + materialIcon(id, 15) + n + ' ' + esc(t('material.' + id + '.name'))
        + '</span>').join('');

      return '<div class="outpost-row">'
        + '<div class="outpost-row-head">' + icon + '<h4>' + esc(tier.name) + '</h4><span class="owned-tag">' + t('outpost.owned', { n: owned }) + '</span></div>'
        + '<p class="outpost-row-blurb">' + esc(tier.blurb) + t('outpost.yieldLine', { slag: tier.yieldPerHour.slag, filament: tier.yieldPerHour.filament }) + '</p>'
        + '<div class="cost-row">' + costHtml + '</div>'
        + '<button class="btn btn-mini btn-buy" data-buy-drone="' + tier.id + '"' + (affordable ? '' : ' disabled') + '>'
        + (affordable ? t('outpost.buy') : t('hub.notEnoughMaterials')) + '</button>'
        + '</div>';
    });

    return '<div class="outpost-section"><h3>' + t('outpost.drones') + '</h3>' + rows.join('') + '</div>';
  }

  _outpostUpgrades(p) {
    const rows = Object.values(OUTPOST_UPGRADES).map((u) => {
      const level = upgradeLevel(p, u.id);
      const maxed = level >= u.maxLevel;
      const cost = upgradeCost(p, u.id);
      const affordable = cost !== null && canAfford(cost, p.materials);

      const costHtml = cost === null ? '' : Object.entries(cost).map(([id, n]) =>
        '<span class="cost' + ((p.materials[id] ?? 0) < n ? ' short' : '') + '">'
        + materialIcon(id, 15) + n + ' ' + esc(t('material.' + id + '.name'))
        + '</span>').join('');

      return '<div class="outpost-row">'
        + '<div class="outpost-row-head"><h4>' + esc(u.name) + '</h4>'
        + '<span class="owned-tag">' + level + ' / ' + u.maxLevel + '</span></div>'
        + '<p class="outpost-row-blurb">' + esc(u.describe(level)) + '</p>'
        + (maxed
            ? '<div class="cost-row"><span class="cost">' + t('outpost.maxed') + '</span></div>'
            : '<div class="cost-row">' + costHtml + '</div>'
              + '<button class="btn btn-mini btn-buy" data-buy-upgrade="' + u.id + '"'
              + (affordable ? '' : ' disabled') + '>' + (affordable ? t('outpost.upgrade') : t('hub.notEnoughMaterials')) + '</button>')
        + '</div>';
    });

    return '<div class="outpost-section"><h3>' + t('outpost.upgrades') + '</h3>' + rows.join('') + '</div>';
  }
}

/** Human labels for the stats a character lean can touch. */
const STAT_LABEL = {
  maxHp: 'Health', regen: 'Regen', moveSpeed: 'Speed', damage: 'Damage',
  attackSpeed: 'Haste', area: 'Area', critChance: 'Crit', critMult: 'Crit dmg',
  pickupRadius: 'Pickup', duration: 'Duration', projectileCount: 'Projectiles',
  projectileSpeed: 'Shot speed', pierce: 'Pierce',
};

/** Split a possibly-modified weapon id ('cleave+leech') into buildWeapon args. */
function splitWeaponId(id) {
  const [baseId, ...mods] = String(id).split('+');
  return [baseId, mods];
}

/**
 * A character's in-game sprite, rendered into the roster card as an <img>.
 *
 * Pulled straight from the live sprite cache rather than drawn separately, so
 * the portrait is *literally* the sprite that will represent them in the
 * arena — a menu that showed different art from the game would be a promise
 * the game then breaks. Locked characters render at low opacity via CSS
 * rather than being hidden, so the roster reads as a goal.
 */
function characterPortrait(character, unlocked) {
  const canvas = getSprite('char:' + character.id, 0, 'base', 0);
  if (canvas === null) return '';
  return '<img class="crew-sprite' + (unlocked ? '' : ' locked') + '" alt="" src="'
    + canvas.toDataURL() + '" />';
}

/**
 * The character's four abilities, as a compact keybind list.
 *
 * Shown on the roster card because abilities are now half of what a character
 * *is* — picking between the Bulwark and the Reaver without knowing one has a
 * parry and the other has a leap would be picking on stat lines alone, which
 * is exactly the shallow choice the ability system exists to replace.
 */
function characterKit(charId) {
  const ids = CHARACTER_ABILITIES[charId];
  if (ids === undefined) return '';
  const rows = ids.map((id, i) => {
    const a = ABILITIES[id];
    if (a === undefined) return '';
    const key = i < 3 ? codeToLabel(getKeyBinding('ability' + (i + 1))) : 'SPC';
    return '<li' + (i === 3 ? ' class="ult"' : '') + '>'
      + '<kbd>' + key + '</kbd>'
      + '<em>' + esc(t('ability.' + id + '.name')) + '</em>'
      + '<span>' + esc(t('ability.' + id + '.desc')) + '</span></li>';
  }).join('');
  return '<ul class="crew-kit">' + rows + '</ul>';
}

/** Bucket a modifier into flat / inc totals, matching how Stats resolves them. */
function accumulate(totals, mod) {
  const t = totals[mod.stat] ?? (totals[mod.stat] = { flat: 0, inc: 0 });
  if (mod.type === 'flat') t.flat += mod.value;
  else t.inc += mod.value;
}

const round = (v) => (Number.isInteger(v) ? v : Math.round(v * 10) / 10);
