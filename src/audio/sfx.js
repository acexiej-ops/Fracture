/**
 * sfx.js — every sound in the game, synthesised with the Web Audio API.
 *
 * No audio files: every cue is a handful of oscillator/noise nodes shaped with
 * a short gain envelope, generated on the fly. That keeps the game a pure code
 * asset (nothing to fetch, nothing to license) and means a new cue is a few
 * lines of numbers here rather than a trip to an editor.
 *
 * Autoplay policy means no sound can play before a user gesture. The engine
 * starts inert and builds its AudioContext lazily on the first keydown or
 * pointerdown, same shape as `Input` attaching its listeners — nothing else in
 * the game needs to know this happened.
 *
 * A frame-scoped rate limiter caps how many of each *category* of sound can
 * fire per simulation tick. Without it, a 40-kill chain reaction would start
 * forty overlapping oscillators in one frame — not louder, just a wall of
 * noise and needless node churn. `beginFrame()` mirrors `Input.beginFrame()`:
 * called once per tick from the main loop, resetting the counters.
 */

const STORAGE_KEY = 'fracture.audio';
const DEFAULT_VOLUME = 0.55;

const FRAME_LIMITS = { shoot: 8, hit: 6, kill: 4 };

class SfxEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.volume = DEFAULT_VOLUME;
    this._frameCounts = {};

    this._load();

    this._unlock = this._unlock.bind(this);
    window.addEventListener('pointerdown', this._unlock);
    window.addEventListener('keydown', this._unlock);
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  _unlock() {
    if (this.ctx !== null) {
      // Browsers suspend the context when the tab loses focus; resuming on the
      // next gesture is what actually restores sound rather than just muting it.
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? window.webkitAudioContext;
    if (Ctor === undefined) return;   // no Web Audio support: fail silent, not loud

    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(this.ctx.destination);

    window.removeEventListener('pointerdown', this._unlock);
    window.removeEventListener('keydown', this._unlock);
  }

  /** Reset per-frame sound budgets. Call once per simulation tick. */
  beginFrame() {
    this._frameCounts = {};
  }

  _allow(category) {
    const limit = FRAME_LIMITS[category];
    if (limit === undefined) return true;
    const n = this._frameCounts[category] ?? 0;
    if (n >= limit) return false;
    this._frameCounts[category] = n + 1;
    return true;
  }

  // -------------------------------------------------------------------------
  // Settings (persisted)
  // -------------------------------------------------------------------------

  _load() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (raw !== null && typeof raw === 'object') {
        if (typeof raw.muted === 'boolean') this.muted = raw.muted;
        if (Number.isFinite(raw.volume)) this.volume = clamp01(raw.volume);
      }
    } catch {
      // Corrupt or inaccessible: play at defaults rather than fail to boot.
    }
  }

  _save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ muted: this.muted, volume: this.volume }));
    } catch { /* non-fatal */ }
  }

  setVolume(v) {
    this.volume = clamp01(v);
    if (this.master !== null && !this.muted) this.master.gain.value = this.volume;
    this._save();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master !== null) this.master.gain.value = m ? 0 : this.volume;
    this._save();
  }

  // ---------------------------------------------------------------------
  // Low-level synthesis
  // ---------------------------------------------------------------------

  /**
   * One oscillator with a short attack/decay envelope. `freqEnd`, if given,
   * sweeps the pitch across the note — that single parameter is what turns a
   * flat blip into a "pew" or a "womp".
   */
  _tone({ freq = 440, freqEnd, duration = 0.12, type = 'sine', gain = 0.25, delay = 0 }) {
    if (this.ctx === null || this.muted) return;
    const t0 = this.ctx.currentTime + delay;

    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(1, freq), t0);
    if (freqEnd !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + duration);
    }

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  /** A short burst of filtered white noise — percussive hits, crunches, fizz. */
  _noise({ duration = 0.15, gain = 0.2, delay = 0, filterFreq = 1800, filterType = 'lowpass' }) {
    if (this.ctx === null || this.muted) return;
    const t0 = this.ctx.currentTime + delay;

    const size = Math.max(1, Math.floor(this.ctx.sampleRate * duration));
    const buffer = this.ctx.createBuffer(1, size, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < size; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / size);

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = filterFreq;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start(t0);
  }

  // ---------------------------------------------------------------------
  // Cues
  // ---------------------------------------------------------------------

  /**
   * A weapon firing.
   *
   * Every weapon has its own voice, and every shot is *detuned* slightly from
   * the last. That detune is the single most important line in this file: a
   * fixed pitch repeating three times a second is a machine-gun of identical
   * beeps, which is what made the old single square-wave "pew" grating rather
   * than punchy. A few percent of random pitch and duration turns the same
   * cue into something the ear reads as repeated *events* instead of a tone.
   *
   * Fast weapons are also voiced on soft waveforms (sine/triangle) and low
   * gain; square and sawtooth are reserved for slow, heavy weapons that fire
   * rarely enough to earn the harshness.
   */
  shoot(weaponId) {
    if (!this._allow('shoot')) return;
    const p = SHOOT_PROFILES[weaponId] ?? SHOOT_PROFILES._default;

    // +/- 6% pitch, +/- 12% length. Enough to break up repetition, not enough
    // to make a weapon sound like a different weapon shot to shot.
    const j = 1 + (Math.random() - 0.5) * 0.12;
    const jd = 1 + (Math.random() - 0.5) * 0.24;

    if (p.noise !== undefined) {
      this._noise({
        ...p.noise,
        duration: (p.noise.duration ?? 0.08) * jd,
        filterFreq: (p.noise.filterFreq ?? 2400) * j,
      });
    }
    if (p.tone !== undefined) {
      this._tone({
        ...p.tone,
        freq: p.tone.freq * j,
        freqEnd: p.tone.freqEnd !== undefined ? p.tone.freqEnd * j : undefined,
        duration: (p.tone.duration ?? 0.08) * jd,
      });
    }
    // A second, quieter layer at a different pitch — this is what gives a
    // sound body. One oscillator is a beep; two is an instrument.
    if (p.layer !== undefined) {
      this._tone({
        ...p.layer,
        freq: p.layer.freq * j,
        freqEnd: p.layer.freqEnd !== undefined ? p.layer.freqEnd * j : undefined,
        duration: (p.layer.duration ?? 0.08) * jd,
        delay: p.layer.delay ?? 0.012,
      });
    }
  }

  /**
   * An enemy took damage and survived.
   *
   * Pitched by the victim's mass, so hitting a Warped Mote and hitting a
   * Warped Bulwark are audibly different events. That is free information —
   * you can hear whether your damage is landing on something that matters
   * without looking away from where you are moving.
   */
  hit(crit = false, enemyType = null) {
    if (!this._allow('hit')) return;
    const mass = enemyType?.mass ?? 1;
    // Heavier -> lower and duller. Range roughly 480Hz (boss) to 900Hz (mote).
    const pitch = 900 / (1 + Math.log2(1 + mass) * 0.42);
    const j = 1 + (Math.random() - 0.5) * 0.14;

    if (crit) {
      this._tone({ freq: pitch * 1.5 * j, freqEnd: pitch * 2.1 * j,
                   duration: 0.085, type: 'triangle', gain: 0.15 });
      this._noise({ duration: 0.05, gain: 0.07, filterFreq: 5200 });
      return;
    }
    this._tone({ freq: pitch * j, duration: 0.04, type: 'triangle', gain: 0.075 });
    // Armoured things clang instead of thud.
    if (enemyType?.armor) {
      this._noise({ duration: 0.045, gain: 0.05, filterFreq: 3400, filterType: 'bandpass' });
    }
  }

  /**
   * An enemy died. Voiced by archetype rather than one death sound for
   * everything: a swarm popping and a Bulwark coming apart should not be the
   * same event.
   */
  kill(enemyType = null) {
    if (!this._allow('kill')) return;
    const mass = enemyType?.mass ?? 1;
    const j = 1 + (Math.random() - 0.5) * 0.16;
    const base = 460 / (1 + Math.log2(1 + mass) * 0.5);

    this._tone({ freq: base * j, freqEnd: base * 0.32 * j,
                 duration: 0.1 + Math.min(0.14, mass * 0.02),
                 type: mass >= 3 ? 'sawtooth' : 'triangle',
                 gain: 0.09 + Math.min(0.08, mass * 0.012) });
    this._noise({ duration: 0.06 + Math.min(0.12, mass * 0.016),
                  gain: 0.045 + Math.min(0.06, mass * 0.01),
                  filterFreq: 1600 / (1 + mass * 0.18) });

    // Anything genuinely heavy gets a low thump underneath — the weight cue.
    if (mass >= 3) {
      this._tone({ freq: 90 * j, freqEnd: 52, duration: 0.22,
                   type: 'sine', gain: 0.13, delay: 0.02 });
    }
  }

  /**
   * A Warped attacking — a telegraph, a lunge, a detonation windup. Distinct
   * from the player's own cues so "something is about to hit me" never gets
   * lost inside the noise of my own weapons.
   */
  enemyAttack(kind, enemyType = null) {
    if (!this._allow('hit')) return;
    const mass = enemyType?.mass ?? 1;
    const j = 1 + (Math.random() - 0.5) * 0.12;
    // Bosses get their own voice for the same mechanic kind, when one
    // exists — call sites don't need to know or care that they're hitting a
    // boss, they just say what happened ('slam', 'charge', ...) same as always.
    const bossKind = 'boss' + kind.charAt(0).toUpperCase() + kind.slice(1);
    const prof = (enemyType?.boss === true && ENEMY_ATTACK_PROFILES[bossKind] !== undefined)
      ? ENEMY_ATTACK_PROFILES[bossKind]
      : ENEMY_ATTACK_PROFILES[kind];
    if (prof === undefined) return;
    this._tone({ ...prof.tone, freq: prof.tone.freq * j / (1 + mass * 0.04),
                 freqEnd: prof.tone.freqEnd !== undefined ? prof.tone.freqEnd * j : undefined });
    if (prof.noise !== undefined) this._noise(prof.noise);
  }

  /** The player took a hit. Not rate-limited — i-frames already space these out. */
  playerHit() {
    this._tone({ freq: 180, duration: 0.09, type: 'square', gain: 0.22 });
    this._noise({ duration: 0.12, gain: 0.16, filterFreq: 600 });
  }

  /** The player died. */
  playerDeath() {
    this._tone({ freq: 500, freqEnd: 60, duration: 0.7, type: 'sawtooth', gain: 0.22 });
    this._noise({ duration: 0.5, gain: 0.14, filterFreq: 400, delay: 0.05 });
  }

  /** A level-up card screen opened. A short triumphant arpeggio. */
  levelUp() {
    this._tone({ freq: 523, duration: 0.11, type: 'triangle', gain: 0.18 });
    this._tone({ freq: 659, duration: 0.11, type: 'triangle', gain: 0.18, delay: 0.07 });
    this._tone({ freq: 784, duration: 0.16, type: 'triangle', gain: 0.2, delay: 0.14 });
  }

  /** An upgrade or gear pick was applied — quieter than the level-up chime. */
  pick() {
    this._tone({ freq: 660, freqEnd: 880, duration: 0.08, type: 'sine', gain: 0.14 });
  }

  /**
   * A craft completed in the Hub. More layers and a wider spread for a rarer
   * item, so the sound itself communicates "you made something good."
   */
  craft(rarity = 'common') {
    const notes = { common: [523, 659], rare: [523, 659, 784], exotic: [493, 659, 830, 987] }[rarity]
      ?? [523, 659];
    notes.forEach((freq, i) => {
      this._tone({ freq, duration: 0.16, type: 'triangle', gain: 0.16, delay: i * 0.05 });
    });
    if (rarity === 'exotic') {
      this._noise({ duration: 0.3, gain: 0.05, filterFreq: 3000, delay: 0.05 });
    }
  }

  /**
   * A chest opening in the arena or on the Game Over screen. Distinct from
   * `craft` so the two don't blur together: a lid-creak noise burst up front,
   * then a chime that gets fuller and brighter with tier, same shape as craft
   * but pitched down a fourth so a chest never sounds like "you made this".
   */
  chest(tier = 'common') {
    this._noise({ duration: 0.1, gain: 0.12, filterFreq: 900, filterType: 'bandpass' });
    const notes = { common: [392, 494], rare: [392, 494, 587], exotic: [349, 440, 523, 698] }[tier]
      ?? [392, 494];
    notes.forEach((freq, i) => {
      this._tone({ freq, duration: 0.2, type: 'triangle', gain: 0.17, delay: 0.06 + i * 0.055 });
    });
    if (tier === 'exotic') {
      this._noise({ duration: 0.4, gain: 0.06, filterFreq: 4200, delay: 0.1 });
    }
  }

  /** A boss milestone arriving — low, ominous, unmistakable from a normal kill. */
  bossSpawn() {
    this._tone({ freq: 90, freqEnd: 55, duration: 0.55, type: 'sawtooth', gain: 0.24 });
    this._tone({ freq: 180, freqEnd: 110, duration: 0.5, type: 'square', gain: 0.1, delay: 0.05 });
    this._noise({ duration: 0.4, gain: 0.1, filterFreq: 300, delay: 0.1 });
  }

  /** A boss falling — the biggest fanfare in the game, on purpose. */
  bossDefeat() {
    [392, 494, 587, 784].forEach((freq, i) => {
      this._tone({ freq, duration: 0.28, type: 'triangle', gain: 0.2, delay: i * 0.09 });
    });
    this._noise({ duration: 0.5, gain: 0.1, filterFreq: 2000, delay: 0.15 });
  }
}

/**
 * Per-weapon voices.
 *
 * Shape: { tone?, layer?, noise? } - `tone` is the body, `layer` is a quieter
 * second oscillator that gives it width, `noise` is texture. `shoot()` detunes
 * all three per shot.
 *
 * GAIN BUDGET is the thing to respect when adding to this table. A weapon that
 * fires every 0.3s must sit around 0.05-0.07 or it dominates the mix and
 * fatigues fast; a weapon on a 2s cooldown can take 0.16 and feel powerful.
 * The old table ignored this and voiced everything at ~0.11 regardless of fire
 * rate, which is most of why the rapid weapons were unpleasant to listen to.
 */
const SHOOT_PROFILES = {
  _default: { tone: { freq: 700, freqEnd: 560, duration: 0.05, type: 'triangle', gain: 0.07 } },

  // --- Legacy engine ids (crafted rigs and older saves still name these) ---
  splinter:   { tone: { freq: 760, freqEnd: 620, duration: 0.05, type: 'triangle', gain: 0.07 } },
  scattergun: { noise: { duration: 0.09, gain: 0.13, filterFreq: 2400 } },
  lance:      { tone: { freq: 260, freqEnd: 920, duration: 0.15, type: 'sawtooth', gain: 0.12 } },
  quake:      { tone: { freq: 100, freqEnd: 40, duration: 0.22, type: 'sine', gain: 0.18 } },
  seeker:     { tone: { freq: 500, freqEnd: 660, duration: 0.09, type: 'sine', gain: 0.07 } },
  ember:      { tone: { freq: 330, freqEnd: 250, duration: 0.09, type: 'sawtooth', gain: 0.05 } },

  // --- PROJECTILE ---------------------------------------------------------
  fire_wand:       { tone: { freq: 420, freqEnd: 300, duration: 0.10, type: 'sawtooth', gain: 0.075 },
                     noise: { duration: 0.08, gain: 0.05, filterFreq: 1500 } },
  shadow_dagger:   { tone: { freq: 1180, freqEnd: 900, duration: 0.035, type: 'triangle', gain: 0.05 } },
  cross_boomerang: { tone: { freq: 560, freqEnd: 760, duration: 0.12, type: 'triangle', gain: 0.09 },
                     layer: { freq: 840, duration: 0.10, type: 'sine', gain: 0.04 } },
  heroic_bow:      { tone: { freq: 300, freqEnd: 180, duration: 0.09, type: 'triangle', gain: 0.10 },
                     noise: { duration: 0.06, gain: 0.07, filterFreq: 1100 } },
  bone_tosser:     { tone: { freq: 640, freqEnd: 520, duration: 0.09, type: 'square', gain: 0.06 },
                     noise: { duration: 0.05, gain: 0.04, filterFreq: 3000 } },
  magic_missile:   { tone: { freq: 880, freqEnd: 1180, duration: 0.10, type: 'sine', gain: 0.07 },
                     layer: { freq: 1320, freqEnd: 1560, duration: 0.08, type: 'sine', gain: 0.03 } },
  poison_dart:     { tone: { freq: 700, freqEnd: 980, duration: 0.05, type: 'sine', gain: 0.055 } },
  laser_pistol:    { tone: { freq: 1500, freqEnd: 620, duration: 0.05, type: 'sawtooth', gain: 0.06 } },

  // --- AREA OF EFFECT -----------------------------------------------------
  holy_aura:        { tone: { freq: 660, freqEnd: 990, duration: 0.16, type: 'sine', gain: 0.045 },
                      layer: { freq: 1320, duration: 0.14, type: 'sine', gain: 0.02 } },
  santa_water:      { noise: { duration: 0.18, gain: 0.10, filterFreq: 1400 },
                      tone: { freq: 340, freqEnd: 200, duration: 0.14, type: 'sine', gain: 0.07 } },
  sonic_wave:       { tone: { freq: 220, freqEnd: 640, duration: 0.20, type: 'sine', gain: 0.13 },
                      layer: { freq: 440, freqEnd: 1280, duration: 0.16, type: 'sine', gain: 0.05 } },
  gravity_bomb:     { tone: { freq: 200, freqEnd: 46, duration: 0.30, type: 'sine', gain: 0.17 },
                      noise: { duration: 0.20, gain: 0.07, filterFreq: 500 } },
  earthquake_stomp: { tone: { freq: 88, freqEnd: 40, duration: 0.30, type: 'sine', gain: 0.19 },
                      noise: { duration: 0.24, gain: 0.10, filterFreq: 380 } },
  acid_spray:       { noise: { duration: 0.12, gain: 0.09, filterFreq: 3600, filterType: 'bandpass' } },
  blizzard_scroll:  { noise: { duration: 0.20, gain: 0.07, filterFreq: 5200, filterType: 'highpass' },
                      tone: { freq: 1100, freqEnd: 1500, duration: 0.16, type: 'sine', gain: 0.04 } },
  mine_layer:       { tone: { freq: 300, freqEnd: 420, duration: 0.07, type: 'square', gain: 0.08 } },

  // --- ORBITAL & CLOSE ----------------------------------------------------
  orbiting_blades: { tone: { freq: 900, freqEnd: 700, duration: 0.05, type: 'triangle', gain: 0.045 } },
  garlic_shield:   { tone: { freq: 240, freqEnd: 200, duration: 0.10, type: 'sine', gain: 0.045 } },
  whip:            { noise: { duration: 0.05, gain: 0.13, filterFreq: 4200, filterType: 'bandpass' },
                     tone: { freq: 1300, freqEnd: 420, duration: 0.07, type: 'triangle', gain: 0.07 } },
  plasma_ring:     { tone: { freq: 1000, freqEnd: 1400, duration: 0.07, type: 'square', gain: 0.05 },
                     noise: { duration: 0.05, gain: 0.04, filterFreq: 6000, filterType: 'highpass' } },
  fire_shield:     { tone: { freq: 380, freqEnd: 300, duration: 0.07, type: 'sawtooth', gain: 0.045 } },
  spike_armor:     { tone: { freq: 520, freqEnd: 400, duration: 0.06, type: 'square', gain: 0.05 } },

  // --- SUMMONS ------------------------------------------------------------
  drone_helper:   { tone: { freq: 1050, freqEnd: 1350, duration: 0.09, type: 'square', gain: 0.06 } },
  ghost_familiar: { tone: { freq: 420, freqEnd: 620, duration: 0.16, type: 'sine', gain: 0.06 } },
  haunting_skull: { tone: { freq: 300, freqEnd: 460, duration: 0.16, type: 'triangle', gain: 0.07 },
                    layer: { freq: 150, duration: 0.18, type: 'sine', gain: 0.04 } },
  attack_bud:     { tone: { freq: 620, freqEnd: 820, duration: 0.07, type: 'triangle', gain: 0.06 } },

  // --- MELEE --------------------------------------------------------------
  // Voiced noise-forward: a swing is air and contact, not a pitch. Every one
  // of these leads with filtered noise (the whoosh) and lands a short tone
  // under it (the impact), which is the opposite of how the ranged weapons
  // are built and is what makes melee audibly a different kind of attack.
  rift_cleaver: { noise: { duration: 0.13, gain: 0.13, filterFreq: 1500 },
                  tone: { freq: 200, freqEnd: 120, duration: 0.11, type: 'sawtooth', gain: 0.10 } },
  warden_pike:  { noise: { duration: 0.08, gain: 0.09, filterFreq: 2600 },
                  tone: { freq: 480, freqEnd: 320, duration: 0.08, type: 'triangle', gain: 0.08 } },
  breaker_maul: { tone: { freq: 110, freqEnd: 48, duration: 0.28, type: 'sine', gain: 0.20 },
                  noise: { duration: 0.20, gain: 0.12, filterFreq: 700 } },
  ichor_lash:   { noise: { duration: 0.05, gain: 0.12, filterFreq: 4600, filterType: 'bandpass' },
                  tone: { freq: 1400, freqEnd: 380, duration: 0.08, type: 'triangle', gain: 0.07 } },
  twin_fangs:   { noise: { duration: 0.045, gain: 0.06, filterFreq: 3400 },
                  tone: { freq: 1000, freqEnd: 760, duration: 0.035, type: 'triangle', gain: 0.04 } },
  gravedigger:  { noise: { duration: 0.22, gain: 0.13, filterFreq: 900 },
                  tone: { freq: 150, freqEnd: 70, duration: 0.24, type: 'sawtooth', gain: 0.14 } },

  // --- TACTICAL -----------------------------------------------------------
  chrono_pocket:  { tone: { freq: 1200, duration: 0.05, type: 'sine', gain: 0.05 },
                    layer: { freq: 900, duration: 0.07, type: 'sine', gain: 0.03 } },
  electric_fence: { tone: { freq: 1400, freqEnd: 900, duration: 0.08, type: 'square', gain: 0.06 },
                    noise: { duration: 0.06, gain: 0.05, filterFreq: 7000, filterType: 'highpass' } },
  coin_gun:       { tone: { freq: 1600, freqEnd: 2100, duration: 0.09, type: 'sine', gain: 0.07 },
                    layer: { freq: 2400, duration: 0.06, type: 'sine', gain: 0.035 } },
  void_rift:      { tone: { freq: 160, freqEnd: 60, duration: 0.26, type: 'sawtooth', gain: 0.13 },
                    noise: { duration: 0.22, gain: 0.06, filterFreq: 420 } },
  chain_bolt:     { tone: { freq: 1250, freqEnd: 780, duration: 0.10, type: 'square', gain: 0.07 },
                    noise: { duration: 0.07, gain: 0.05, filterFreq: 6500, filterType: 'highpass' } },

  // --- EVOLVED (lower and louder - an evolution should sound like an event)
  hellfire_meteor: { tone: { freq: 150, freqEnd: 55, duration: 0.34, type: 'sawtooth', gain: 0.20 },
                     noise: { duration: 0.30, gain: 0.13, filterFreq: 900 } },
  vortex_shields:  { tone: { freq: 700, freqEnd: 520, duration: 0.07, type: 'triangle', gain: 0.06 } },
  thunder_loop:    { tone: { freq: 1500, freqEnd: 620, duration: 0.14, type: 'square', gain: 0.11 },
                     noise: { duration: 0.10, gain: 0.08, filterFreq: 7200, filterType: 'highpass' } },
  bloody_tear:     { noise: { duration: 0.06, gain: 0.15, filterFreq: 4000, filterType: 'bandpass' },
                     tone: { freq: 1500, freqEnd: 320, duration: 0.10, type: 'sawtooth', gain: 0.10 } },
  soul_eater:      { tone: { freq: 130, freqEnd: 78, duration: 0.20, type: 'sawtooth', gain: 0.09 },
                     layer: { freq: 260, duration: 0.18, type: 'sine', gain: 0.05 } },
};

/**
 * Warped attack cues.
 *
 * Deliberately voiced away from the player's own palette - low, rough, and
 * *rising* where player cues mostly fall - so an incoming threat never gets
 * lost inside the sound of your own arsenal, which with six weapons firing is
 * most of the mix.
 */
const ENEMY_ATTACK_PROFILES = {
  charge:   { tone: { freq: 140, freqEnd: 300, duration: 0.28, type: 'sawtooth', gain: 0.10 } },
  shoot:    { tone: { freq: 380, freqEnd: 240, duration: 0.09, type: 'square', gain: 0.08 } },
  detonate: { tone: { freq: 200, freqEnd: 600, duration: 0.50, type: 'triangle', gain: 0.09 },
              noise: { duration: 0.30, gain: 0.05, filterFreq: 2000 } },
  slam:     { tone: { freq: 110, freqEnd: 260, duration: 0.40, type: 'sawtooth', gain: 0.13 } },
  spawn:    { tone: { freq: 220, freqEnd: 130, duration: 0.20, type: 'triangle', gain: 0.07 } },

  // Boss variants — auto-selected by enemyAttack() whenever the attacking
  // enemyType.boss is true, in place of the plain profile of the same kind.
  // Not just the trash version pitched down (mass already does that): each
  // one is voiced, layered, and paced differently, so an Anomaly's own
  // fight — now fought alone, with the arena cleared around it — sounds
  // like a different kind of threat from the moment it moves, not a bigger
  // grunt with the same voice.
  bossSlam:   { tone: { freq: 65, freqEnd: 210, duration: 0.60, type: 'sawtooth', gain: 0.22 },
                noise: { duration: 0.4, gain: 0.14, filterFreq: 280 } },
  bossCharge: { tone: { freq: 90, freqEnd: 360, duration: 0.48, type: 'sawtooth', gain: 0.19 },
                noise: { duration: 0.22, gain: 0.09, filterFreq: 900 } },
  bossShoot:  { tone: { freq: 260, freqEnd: 140, duration: 0.16, type: 'square', gain: 0.15 },
                noise: { duration: 0.07, gain: 0.06, filterFreq: 1100 } },
  // Calling adds in — a rise rather than an impact, since nothing is
  // hitting the player directly when this fires.
  bossSummon: { tone: { freq: 130, freqEnd: 340, duration: 0.55, type: 'triangle', gain: 0.16 },
                noise: { duration: 0.3, gain: 0.07, filterFreq: 1700 } },
  // The Brood's aura previously had no sound of its own at all — the only
  // boss mechanic dealing damage in total silence. A held-back gain since
  // this repeats every tickInterval for as long as the player stands in it,
  // not a one-off hit.
  bossAura:   { tone: { freq: 95, freqEnd: 78, duration: 0.20, type: 'sine', gain: 0.08 },
                noise: { duration: 0.16, gain: 0.035, filterFreq: 480 } },
};

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export const sfx = new SfxEngine();
