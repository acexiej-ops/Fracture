/**
 * main.js — entry point and orchestrator.
 *
 * This file owns the *order* of things: which systems run, in what sequence,
 * and which of them are allowed to run in each phase. The systems themselves
 * know nothing about each other.
 *
 * Tick order matters in two places:
 *   - `updateEnemies` rebuilds the spatial grid, so weapon targeting and
 *     projectile collision must come after it.
 *   - the camera updates last, so it follows the position the player actually
 *     ended the tick at rather than lagging a frame behind.
 */

import './styles/main.css';

import { GameLoop } from './core/loop.js';
import { Input, getKeyBinding } from './core/input.js';
import { rng } from './core/rng.js';
import { tournamentFor, enemyMultipliers, spawnRateMultiplier, scoreRun } from './meta/tournament.js';

import { GameState, Phase } from './game/state.js';
import { DIFFICULTIES, DEFAULT_DIFFICULTY } from './game/config.js';
import { sfx } from './audio/sfx.js';
import { updatePlayer } from './game/player.js';
import { updateEnemies, updateEnemyProjectiles, updateWalls, updateMortarShells } from './game/enemies.js';
import { updateWaves } from './game/waves.js';
import {
  addWeapon, updateWeapons, updateProjectiles,
  updateBeams, updateShockwaves, updateZones,
} from './game/weapons.js';
import { updateDeployables, updateSweeps } from './game/weaponBases.js';
import { registerBaseWeapons } from './game/weaponGen.js';
import { updateOrbs } from './game/xp.js';
import { updateEffects } from './game/effects.js';
import { Inventory } from './game/inventory.js';
import {
  rollArsenalChoices, applyArsenalChoice, syncInventory, seedInventory,
} from './game/arsenalProgression.js';

import { Renderer } from './render/renderer.js';
import { updateCamera } from './render/camera.js';

import { updateNodes } from './game/nodes.js';
import { updateChests } from './game/chests.js';
import { rollChestTier, rollChestContents, performanceBonus } from './meta/chests.js';
import { pickBiome, updateBiomeHazards } from './game/biomes.js';

import { Hud } from './ui/hud.js';
import { LevelUpScreen } from './ui/levelup.js';
import { GameOverScreen } from './ui/gameover.js';
import { HubScreen } from './ui/hub.js';
import { SettingsPanel } from './ui/settings.js';
import { installStrings, applyStaticStrings, onLanguageChange, t } from './i18n/i18n.js';
import { STRINGS } from './i18n/strings.js';
import { getSettings, onSettingsChange, suggestQuality, setSetting } from './meta/settings.js';

import { Profile } from './meta/profile.js';
import { applyLoadout } from './meta/loadout.js';
import { applyCharacter } from './meta/applyCharacter.js';
import { createAbilityState, updateAbilities } from './game/abilities.js';
import { anomalyArrives, anomalyFalls } from './meta/lore.js';
import { AuthPanel } from './ui/auth.js';
import { ReportPanel } from './ui/report.js';
import { AdminPanel } from './ui/admin.js';
import { setProvider, restoreSession, flushPush } from './meta/cloud.js';
import { createSupabaseProvider } from './meta/cloudSupabase.js';
import { CLOUD_CONFIG, cloudConfigured } from './meta/cloudConfig.js';
import { NetClient } from './net/client.js';
import { syncLeaderboardStats } from './meta/leaderboard.js';

const BEST_TIME_KEY = 'fracture.bestTime';

class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    this.renderer = new Renderer(this.canvas);

    this.input = new Input();
    this.input.attach();

    // Register the bare form of every base type into the shared WEAPONS map
    // before anything can ask for one. Modified variants are minted lazily
    // when something actually rolls them — building the whole roster up front
    // would define thousands of sprites for weapons a run will never see.
    registerBaseWeapons();

    this.hud = new Hud(document.getElementById('hud'));
    this.levelUp = new LevelUpScreen(document.getElementById('levelup'));
    this.gameOver = new GameOverScreen(document.getElementById('gameover'), {
      onOpenChest: (state) => this._openPerformanceChest(state),
    });
    this.pauseEl = document.getElementById('paused');
    this.pauseEl.querySelector('[data-pause="restart"]').addEventListener('click', () => this._pauseRestart());
    this.pauseEl.querySelector('[data-pause="leave"]').addEventListener('click', () => this._pauseLeave());

    this.net = new NetClient();

    this.gameOver.onRestart = () => this.startRun();
    this.gameOver.onHub = () => this.openHub();

    // Language must be resolved before any UI is built, or the first paint is
    // in English and then visibly swaps.
    installStrings(STRINGS);
    // Most of the UI is rendered dynamically and calls t() fresh every time,
    // so it picks up the active language for free. A handful of screens are
    // pure static HTML that JS never re-renders on its own (the pause and
    // game-over overlays, the hub tab bar, the account form's field labels)
    // — this is what actually applies the language to those.
    applyStaticStrings(document);

    // On a device that has never chosen, take a conservative guess from the
    // hardware. An explicit choice is always respected — this only ever fills
    // in the default, so nobody's setting gets overwritten by a guess.
    if (localStorage.getItem('fracture.settings') === null) {
      const guess = suggestQuality();
      if (guess !== 'high') setSetting('quality', guess);
    }

    this.settings = new SettingsPanel(document.getElementById('settings'), sfx);
    this._initFpsMeter();

    // Everything that survives between runs.
    this.profile = Profile.load();

    this.hub = new HubScreen(document.getElementById('hub'), this.profile, {
      onStart: (difficulty) => this.startRun({ difficulty }),
      onStartTournament: () => this.startRun({ tournament: tournamentFor() }),
      onStartMulti: () => this.startRun({ multiplayer: true }),
      net: this.net,
      onCraft: (recipeId, rarity) => this.profile.craft(recipeId, rarity, rng),
      onEquip: (uid) => this.profile.equip(uid),
      onUnequip: (slot) => this.profile.unequip(slot),
      onScrap: (uid) => this.profile.scrap(uid),
      onReforge: (uid) => this.profile.reforge(uid, rng),
      onBuyDrone: (tierId) => this.profile.buyDrone(tierId),
      onBuyOutpostUpgrade: (key) => this.profile.buyOutpostUpgrade(key),
      onCollectOutpost: () => this.profile.collectOutpost(Date.now(), rng),
      onSelectCharacter: (id) => this.profile.selectCharacter(id),
      onReset: () => { this.profile = Profile.clear(); this.hub.profile = this.profile; },
      onSavePreset: (name) => this.profile.savePreset(name),
      onLoadPreset: (index) => this.profile.loadPreset(index),
      onUpdatePreset: (index) => this.profile.updatePreset(index),
      onRenamePreset: (index, name) => this.profile.renamePreset(index, name),
      onDeletePreset: (index) => this.profile.deletePreset(index),
    });

    // Live language switching: re-label the static chrome everywhere, and
    // re-render the Hub since its templates embed translated text in the
    // markup they generate (not just in nodes applyStaticStrings can find).
    onLanguageChange(() => {
      applyStaticStrings(document);
      this.hub.render();
    });

    // Cloud saves, if this build is configured for them. Everything here is a
    // no-op otherwise — the game has always worked offline and still does.
    this.auth = new AuthPanel(document.getElementById('hub'), {
      getProfile: () => this.profile,
      // Identity (the claimed name shown above the character in the Hub) is
      // fetched from the server rather than the local profile, so a sign-in,
      // sign-up, name claim or sign-out all need their own refresh, not just
      // a redraw of whatever render() already has cached.
      onProfileChanged: () => this.hub.refreshIdentity(),
    });

    // Bug reports: deliberately account-free (getState/getProfile are only
    // used to attach context, never to gate whether the form opens at all).
    this.report = new ReportPanel(document, {
      getState: () => (this.inHub ? null : this.state),
      getProfile: () => this.profile,
    });
    document.querySelector('[data-set="report-bug"]')
      ?.addEventListener('click', () => this.report.open());

    // Admin panel: exists in the DOM for everyone, but .show() is the only
    // thing that ever reveals it, and that only happens for a URL nobody
    // stumbles into by accident. See admin.js — the actual protection is a
    // database-side password check, not this line.
    this.admin = new AdminPanel(document);
    if (new URLSearchParams(location.search).has('admin')) this.admin.show();
    if (cloudConfigured()) {
      setProvider(createSupabaseProvider(CLOUD_CONFIG));
      // Restoring a session is async and must not block first paint, so the
      // game boots offline-first and the Hub re-renders if a save comes down.
      // The push is debounced ~2.5s, so closing the tab moments after earning
      // something would otherwise strand it in a pending timer. pagehide is
      // the reliable signal here; visibilitychange also covers mobile
      // backgrounding, where pagehide is not guaranteed to run.
      const flush = () => { try { flushPush(this.profile); } catch { /* unloading */ } };
      window.addEventListener('pagehide', flush);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flush();
      });

      restoreSession(this.profile).then((restored) => {
        if (restored) this.hub.render();
        this.auth.renderChip();
        this.auth.checkNameGate();
        this.hub.refreshIdentity();
        // Keeps the leaderboard from going stale for a player who hasn't
        // finished a run in a while but has been signed in this whole time —
        // the run-end sync in _die() is the primary path, this just covers
        // the gap between sessions.
        syncLeaderboardStats(this.profile);
      });
    }
    this.auth.renderChip();

    this.bestTime = this._loadBestTime();

    this.state = null;
    this.loop = new GameLoop({
      update: (dt) => this.update(dt),
      render: () => this.render(),
    });

    // No resize listener needed: the renderer observes its own element, which
    // also catches layout changes that don't resize the window.

    // A run still has to exist for the renderer to draw behind the hub.
    this.startRun();
    this.openHub();
    this.loop.start();
  }

  // -------------------------------------------------------------------------
  // Run lifecycle
  // -------------------------------------------------------------------------

  /**
   * Begin a run. Gear is applied immediately after construction, before any
   * level-up can happen, so crafted modifiers are simply the first entries on
   * the same stack the upgrade cards push onto later.
   */
  /**
   * Begin a run.
   *
   * `tournament` is a ruleset from meta/tournament.js. When present the run is
   * the same for every player: the seed comes from the calendar rather than
   * from Math.random, the biome is fixed, enemy mutators apply, and equipped
   * gear is deliberately ignored — a shared seed with unrestricted gear just
   * measures who has farmed the most.
   */
  startRun({ tournament = null, multiplayer = false, difficulty = DEFAULT_DIFFICULTY } = {}) {
    // A fresh seed each run, but recorded on the state so a specific run can be
    // replayed later by passing it back in. A tournament simply supplies one.
    const seed = tournament !== null
      ? tournament.seed
      : (Math.random() * 0xffffffff) >>> 0;
    rng.reset(seed);

    this.state = new GameState(seed);
    this.state.multiplayer = multiplayer && this.net.connected;
    this.state.biome = tournament !== null ? tournament.biome : pickBiome(rng);
    if (tournament !== null) {
      this.state.tournament = {
        key: tournament.key,
        mutators: tournament.mutators,
        enemyMult: enemyMultipliers(tournament),
        spawnRate: spawnRateMultiplier(tournament),
      };
    } else {
      // A tournament fixes its own difficulty (the same seed and rules for
      // everyone) and has no picker in its UI, so this only ever applies to
      // a normal solo/co-op run.
      this.state.difficulty = DIFFICULTIES[difficulty] ?? DIFFICULTIES[DEFAULT_DIFFICULTY];
      // The one difficulty axis that touches the player rather than
      // enemies — Normal's forgiveness lever (see DIFFICULTIES' comment).
      // Tagged so it stays visible as its own line, same as gear and
      // level-up stats, rather than getting folded into the base value.
      if (this.state.difficulty.regenBonus > 0) {
        this.state.stats.add({
          stat: 'regen', type: 'flat', value: this.state.difficulty.regenBonus, source: 'difficulty',
        });
        this.state.stats.recompute();
      }
    }

    // The chosen Driftwalker, applied BEFORE gear so that character stats are
    // simply the first entries on the same modifier stack gear and level-up
    // upgrades push onto later — they resolve through one formula, in the
    // order they were acquired, with no special case for "character".
    // The arsenal owns which weapons the player holds, so the inventory is
    // built BEFORE gear: applyLoadout can still add engine weapons from rigs
    // on top, and syncInventory will not clobber them because it only removes
    // weapons the inventory itself previously placed.
    this.state.inventory = new Inventory();
    const character = applyCharacter(this.state, this.profile);
    // Abilities are per-character and per-run: three on cooldown plus one
    // charge-fed ultimate, built here because this is where the character is
    // finally known.
    this.state.abilities = createAbilityState(character.id);
    seedInventory(this.state, character.weapon);
    // Gear is deliberately skipped in tournament runs — see startRun's note.
    if (tournament === null) applyLoadout(this.state, this.profile);
    // Snapshot of what's already earned, so enemies.js can tell a fresh
    // boss-unique drop from one this profile already has without needing a
    // profile reference of its own.
    this.state.bossUniquesOwned = [...this.profile.bossUniques];

    this.banked = false;
    this.inHub = false;
    this.hub.hide();
    this.levelUp.hide();
    this.gameOver.hide();
    this.pauseEl.classList.remove('visible');

    // Multiplayer callbacks
    if (this.state.multiplayer && this.net.connected) {
      this.net.onPlayerJoin = (msg) => {
        this.hud.announceBoss('Player joined: ' + msg.name);
      };
      this.net.onPlayerLeave = (msg) => {
        this.hud.announceBoss('Player left');
      };
      this.net.onPlayerDied = (msg) => {
        this.hud.announceBoss('Player down!', true);
      };
      this.net.onWaveStart = (msg) => {
        this.state.wave = msg.wave;
        this.hud.announceWave(msg.wave);
      };
    }

    this.hud.announceWave(1);
  }

  openHub() {
    this.inHub = true;
    this.levelUp.hide();
    this.gameOver.hide();
    this.pauseEl.classList.remove('visible');
    // Returning from a multiplayer run used to leave the room connection
    // open with no way to close it short of the lobby's own Leave button —
    // see MultiplayerPanel.leaveRoom() for what that caused. Safe to call
    // unconditionally: it no-ops if there was never a connection.
    this.hub.multiplayer.leaveRoom();
    this.hub.show();
  }

  _loadBestTime() {
    try {
      return Number(localStorage.getItem(BEST_TIME_KEY)) || 0;
    } catch {
      return 0;   // private browsing / storage disabled: just don't track it
    }
  }

  _saveBestTime(time) {
    if (time <= this.bestTime) return;
    this.bestTime = time;
    try {
      localStorage.setItem(BEST_TIME_KEY, String(time));
    } catch {
      /* non-fatal */
    }
  }

  // -------------------------------------------------------------------------
  // Update
  // -------------------------------------------------------------------------

  update(dt) {
    this.input.beginFrame();
    sfx.beginFrame();
    const state = this.state;

    // Settings sits above every other screen — including the Hub — so this has
    // to run before the Hub's early return, or Escape can never close the panel
    // while sitting on the very screen a player is most likely to have opened
    // it from.
    if (this.input.wasPressed('Escape') && this.settings.visible) {
      this.settings.hide();
      return;
    }

    // The hub is a modal screen outside the run: nothing simulates behind it.
    if (this.inHub) return;

    // Phase-independent input first, so pause and restart always respond.
    // Escape always works as a fixed safety net regardless of what "pause"
    // is rebound to — a bad rebind should never be able to lock someone out
    // of pausing their own game.
    if (this.input.wasPressed('Escape') || this.input.wasPressed(getKeyBinding('pause'))) {
      this._togglePause();
    }

    switch (state.phase) {
      case Phase.PLAYING:
        this._simulate(dt);
        break;

      case Phase.LEVEL_UP:
        // Simulation frozen. Only the card screen listens.
        this.levelUp.handleInput(this.input);
        // Safety net for "phase says level-up but no cards are showing". Must
        // re-check the phase: picking the last card flips it back to PLAYING
        // inside handleInput, and without this guard we'd immediately reopen.
        if (state.phase === Phase.LEVEL_UP && !this.levelUp.visible) {
          this._openLevelUp();
        }
        break;

      case Phase.DEAD:
        this.gameOver.handleInput(this.input);
        // Keep effects running so the death burst plays out behind the panel.
        updateEffects(state, dt);
        break;

      case Phase.PAUSED:
        break;
    }

    this.hud.update(state, dt, this.loop.fps);
  }

  _simulate(dt) {
    const state = this.state;

    // Hit-stop: a brief freeze on a big kill, sold as impact rather than lag.
    // Ticked and checked here, the one place that still runs while "frozen" —
    // everything below (waves, AI, weapons, the clock itself) simply doesn't
    // advance for the duration, and the world holds its current frame because
    // `render()` runs independently of this early return.
    if (state.hitStopTimer > 0) {
      state.hitStopTimer = Math.max(0, state.hitStopTimer - dt);
      return;
    }

    const vw = this.renderer.width;
    const vh = this.renderer.height;

    state.time += dt;

    const wavesResult = updateWaves(state, dt, vw, vh);
    if (wavesResult.newWave) this.hud.announceWave(state.wave);
    if (wavesResult.bossName !== null) {
      sfx.bossSpawn();
      this.hud.announceBoss(anomalyArrives(wavesResult.bossName), true);
    }

    updatePlayer(state, dt, this.input);
    // Immediately after movement, so a dash resolves against the position the
    // player is actually at this frame, and a parry window opened this frame
    // is live before any enemy contact is tested below.
    updateAbilities(state, dt, this.input);

    // Send local input to server and reconcile against authoritative snapshot.
    if (state.multiplayer && this.net.connected) {
      // isDown, not isHeld — Input has no isHeld method. This threw a
      // TypeError on every multiplayer tick, and because GameLoop already
      // schedules the next requestAnimationFrame before calling update(),
      // the crash didn't freeze the loop — it just meant render() and
      // everything below this point (updateEnemies included) never ran on
      // ANY tick. That's the entire bug behind "no enemies spawn and I
      // can't move or use abilities": the multiplayer branch was crashing
      // before the frame could finish, 60 times a second, from the very
      // first tick of every multiplayer run.
      this.net.sendInput({
        w: this.input.isDown('KeyW') || this.input.isDown('ArrowUp'),
        s: this.input.isDown('KeyS') || this.input.isDown('ArrowDown'),
        a: this.input.isDown('KeyA') || this.input.isDown('ArrowLeft'),
        d: this.input.isDown('KeyD') || this.input.isDown('ArrowRight'),
      });
      this.net.reconcile(state.player);
      // The server runs its OWN separate enemy/contact-damage simulation for
      // player-position authority, entirely apart from this client's local
      // one — nothing previously checked whether IT had killed you. Without
      // this, dying there just froze you in place forever: reconcile()
      // above keeps snapping your position back to the server's (static,
      // dead) one every time local movement tries to diverge from it, with
      // no death screen and no explanation. state.player.alive drives the
      // exact same death path a single-player run already uses.
      if (!this.net.isLocalPlayerAlive()) state.player.alive = false;
      // Populate remote player positions for rendering
      const remoteIds = this.net.getRemotePlayerIds();
      state.remotePlayers = remoteIds.map((id) => {
        const pos = this.net.getInterpolatedPosition(id);
        const name = this.net.getPlayerName(id);
        return { id, name, x: pos?.x ?? 0, y: pos?.y ?? 0, alive: pos?.alive ?? false };
      }).filter((r) => r.alive);
    } else {
      state.remotePlayers = [];
    }

    // Rebuilds the spatial grid; every pass below depends on it. Enemy AI
    // (including ranged attacks) runs here, so their bolts are updated right
    // after — a bolt fired this tick still gets one full step before render.
    updateEnemies(state, dt);
    updateEnemyProjectiles(state, dt);
    // Elite entities: Waller's temporary barriers and Mortar's landing
    // telegraphs. Ticked here, right after the enemies that create them, so
    // next tick's updatePlayer (which reads solid walls) and this tick's
    // renderer both see up-to-date phases.
    updateWalls(state, dt);
    updateMortarShells(state, dt);

    // Weapons fire first, then their entities resolve. Beams and shockwaves
    // resolve before zones so a detonation started this frame can chain into
    // the burning ground it just created.
    updateWeapons(state, dt);
    updateProjectiles(state, dt);
    updateBeams(state, dt);
    updateShockwaves(state, dt);
    updateZones(state, dt);
    // Deployables run after the weapons that place them, so a turret dropped
    // this tick still gets its first targeting pass before anything renders.
    updateDeployables(state, dt);
    updateSweeps(state, dt);

    updateNodes(state, dt);
    updateChests(state, dt, this.profile);
    updateBiomeHazards(state, dt);
    updateOrbs(state, dt);
    updateEffects(state, dt);
    // Sprite frame timers, spin and the ATTACKING->IDLE decay for every held
    // weapon. Driven from the simulation tick so it freezes with hit-stop and
    // with the pause screen, matching every other in-world animation.
    state.inventory.update_animations(dt);

    updateCamera(state, dt, vw, vh);

    // Checked after every system that can kill an enemy has had its turn this
    // tick — a boss can just as easily die to a Zone tick as to the projectile
    // that hit it, so this can't be checked any earlier than here.
    if (state.bossJustDefeated !== null) {
      const { name, uniqueItem } = state.bossJustDefeated;
      // One combined banner rather than two calls — announceBoss has no
      // queue, so a second call this same tick would just cut the first off.
      const text = uniqueItem !== null
        ? anomalyFalls(name) + '  —  ' + uniqueItem.name.toUpperCase() + ' CLAIMED'
        : anomalyFalls(name);
      this.hud.announceBoss(text, true);
      state.bossJustDefeated = null;
    }

    // Death takes priority over a level-up banked in the same tick.
    if (!state.player.alive) {
      this._die();
    } else if (state.phase === Phase.LEVEL_UP) {
      this._openLevelUp();
    }
  }

  _openLevelUp() {
    const state = this.state;
    state.phase = Phase.LEVEL_UP;
    state.upgradeChoices = rollArsenalChoices(state);
    sfx.levelUp();

    this.levelUp.show(state, state.upgradeChoices, (choice) => {
      sfx.pick();
      applyArsenalChoice(state, choice);
      state.pendingLevelUps--;

      if (state.pendingLevelUps > 0) {
        // Another level was banked while this card was open: roll a fresh set
        // rather than dropping it.
        this._openLevelUp();
      } else {
        state.phase = Phase.PLAYING;
      }
    });
  }

  _die() {
    const state = this.state;
    state.phase = Phase.DEAD;
    this.levelUp.hide();
    this.pauseEl.classList.remove('visible');

    const previousBest = this.bestTime;
    this._saveBestTime(state.time);

    this._bankCurrentRun();

    // Tournament results are scored and kept separately from the normal run
    // haul. Inside the same `banked` guard would be wrong — that guard exists
    // to stop double-paying materials — but this must also only count once,
    // so it rides the same flag.
    if (state.tournament !== undefined && state.tournament !== null) {
      const score = scoreRun({ wave: state.wave, time: state.time, kills: state.kills });
      this.profile.recordTournament(state.tournament.key, score);
    }

    this.gameOver.show(state, previousBest);
  }

  /**
   * Rolls and immediately banks the end-of-run performance chest. Separate
   * from `_die()`'s own `recordRun` — this is a second, additional reward the
   * player has to deliberately open, not part of the automatic haul.
   */
  _openPerformanceChest(state) {
    const bonus = performanceBonus(state.wave, state.kills) * 1.2;
    const tier = rollChestTier(rng, bonus);
    const contents = rollChestContents(tier, rng, this.profile);

    this.profile.addMaterials(contents.materials);
    this.profile.addScrip(contents.currency);
    if (contents.gear !== null) this.profile.grantItem(contents.gear);

    sfx.chest(tier);
    return { tier, ...contents };
  }

  _togglePause() {
    const state = this.state;
    if (state.phase === Phase.PLAYING) {
      state.phase = Phase.PAUSED;
      this.pauseEl.classList.add('visible');
    } else if (state.phase === Phase.PAUSED) {
      state.phase = Phase.PLAYING;
      this.pauseEl.classList.remove('visible');
    }
  }

  /**
   * Bank whatever this run has collected so far into the profile — the exact
   * path `_die()` already used, pulled out so leaving or restarting mid-run
   * from the pause menu can share it. Guarded by the same `banked` flag
   * `_die()` relies on, so a run can never be paid out twice.
   */
  _bankCurrentRun() {
    if (this.banked) return;
    this.banked = true;
    const state = this.state;
    this.profile.recordRun({
      materials: state.runMaterials,
      currency: state.runCurrency,
      gear: state.runGear,
      wave: state.wave,
      time: state.time,
      kills: state.kills,
      bossUniques: state.bossUniquesEarnedThisRun,
      bossKills: state.bossesDefeated,
    });
    // Best-effort; a no-op when signed out or unnamed.
    syncLeaderboardStats(this.profile);
  }

  /**
   * Pause menu's "Restart Run": confirm (this ends the current attempt), bank
   * whatever it already earned exactly like a death would, then start fresh.
   */
  _pauseRestart() {
    if (!window.confirm(t('run.confirmRestartRun'))) return;
    this._bankCurrentRun();
    this.startRun();
  }

  /** Pause menu's "Leave Run": same banking, but back to the Anchor instead. */
  _pauseLeave() {
    if (!window.confirm(t('run.confirmLeaveRun'))) return;
    this._bankCurrentRun();
    this.openHub();
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  /**
   * A lightweight FPS readout, off by default.
   *
   * Samples over a second rather than showing instantaneous frame time: a
   * number flickering between 58 and 61 sixty times a second is unreadable,
   * and what a player actually wants to know is whether the game is holding
   * its budget, which is a one-second question.
   */
  _initFpsMeter() {
    this._fpsEl = document.getElementById('fps-meter');
    if (this._fpsEl === null) return;
    this._fpsFrames = 0;
    this._fpsSince = performance.now();
    const apply = () => {
      this._fpsEl.style.display = getSettings().showFps ? 'block' : 'none';
    };
    apply();
    onSettingsChange(apply);
  }

  _tickFpsMeter() {
    if (this._fpsEl === undefined || this._fpsEl === null) return;
    if (!getSettings().showFps) return;
    this._fpsFrames++;
    const now = performance.now();
    if (now - this._fpsSince >= 1000) {
      this._fpsEl.textContent = Math.round((this._fpsFrames * 1000) / (now - this._fpsSince)) + ' fps';
      this._fpsFrames = 0;
      this._fpsSince = now;
    }
  }

  render() {
    // The ability bar is canvas-drawn, so it cannot use CSS :hover — it
    // hit-tests the pointer itself. Handing the input object over here keeps
    // the renderer free of any direct dependency on the input module.
    if (this.state !== null) this.state.hoverInput = this.input;
    this.renderer.draw(this.state);
    this._tickFpsMeter();
  }
}

// The canvas is sized by CSS, so wait for layout before reading its box.
function boot() {
  window.game = new Game();   // handy for poking at state from the console
  hideLoadingScreen();
}

/**
 * The loading screen is plain inline HTML/CSS (see index.html) so it can
 * render before this bundle has even finished downloading — by the time
 * this runs, `new Game()` above has already built the Hub and started the
 * loop, so there's nothing left for it to cover. Removed outright after the
 * fade rather than left `display:none`, since a fixed, full-screen div
 * sitting in the DOM forever is one more thing a future change could
 * accidentally un-hide.
 */
function hideLoadingScreen() {
  const el = document.getElementById('loading-screen');
  if (el === null) return;
  el.classList.add('hidden');
  // transitionend won't fire at all for a reduced-motion visitor (the CSS
  // transition never runs), and can't be relied on for a backgrounded tab
  // either — a setTimeout past the transition's own 400ms is the fallback,
  // not the primary path, so the screen still comes down promptly on a
  // normal visit but can never get stuck showing on top of a loaded game.
  let done = false;
  const remove = () => { if (!done) { done = true; el.remove(); } };
  el.addEventListener('transitionend', remove, { once: true });
  setTimeout(remove, 500);
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
