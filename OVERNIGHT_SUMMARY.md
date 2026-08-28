# Overnight run — four-phase overhaul

All four phases completed and committed. Each phase is its own commit, so any
one of them can be rolled back independently.

```
b6bb9f4  PHASE 4: Character select — 10 Driftwalkers
6c43650  PHASE 3: Weapon system — 22 bases x 21 modifiers
e3484e3  PHASE 2: Pixel-art foundation
3e129bc  PHASE 1: Theme & naming
3019811  Checkpoint (pre-overhaul — roll back here to undo everything)
```

Roll back to any point with `git reset --hard <hash>`. **Nothing has been
pushed or deployed** — the live Vercel and GitHub Pages builds are still on
the pre-overhaul version. That was deliberate: this is a large gameplay
change and it seemed worth you seeing it first.

## One thing to know before you read further

**I could not see any of this rendered.** The browser pane in this environment
refuses to composite frames, so every screenshot attempt failed. Everything
below was verified programmatically — sprite pixel data read back out of the
canvas, DOM queries, simulated runs, timing measurements. That catches logic
errors well and catches "it looks wrong" not at all. The pixel art in
particular deserves a real look before you trust it.

---

## Phase 1 — Theme & naming

Locked in the setting without touching a single system: every id stayed what
it was, only display names and flavour text changed.

- **New `src/meta/lore.js`** holds the setting's nouns and the Anomaly banner
  builders, so later screens read naming from one place.
- **Enemies are the Warped**, named on a ladder tracking how far gone each is
  (Warped Drifter → Warped Skimmer → Warped Hulk → … → Warped Husk). Each
  gained a `corruption` value (0–1) that Phase 2's sprite layer then used.
- **Bosses are Anomalies** with single proper nouns, since they have no
  original shape left to name them after: **The Maw**, **The Choir**, **The
  Brood**. This also resolved a name collision that was already there — the
  old `Warden` boss vs. the `Warden Blades` weapon.
- **Ichor** was already a rare material, and is now explicitly the substance
  the Fracture leaks. Material, recipe, gear-slot and Hub flavour updated.
- UI verbs re-themed: "Enter the Fracture", "Drift Again", "UNMADE",
  gear slots became Rig / Plating / Charm.

---

## Phase 2 — Pixel-art foundation

Built as a **pipeline**, not as art for the current entities, because Phases 3
and 4 both needed to mint art from data.

**`src/render/pixel.js`** — the engine:
- `PixelBuffer`: a nullable colour grid plus primitives (disc, ring, poly,
  ngon, star, line, mirrorX, outline). Authored in art-pixels.
- Sprites rasterise **once** per (key, frame, variant, angle) into an offscreen
  canvas at integer upscale with smoothing off, then blit with one
  `drawImage`. Verified the cache grows to ~176 entries under a 400-enemy
  screen and then stops (+2 over 300 frames).
- `ramp()`: a deliberately short 5-step shade ramp per colour, which is what
  keeps palettes "limited" in the sense the style depends on. Sprites measured
  at 4–8 distinct colours each.
- `applyCorruption()`: per-pixel Ichor damage escalating in three stages —
  violet body pixels, then the silhouette starting to fail, then Ichor
  bleeding *outside* the outline. Deterministic, so a re-cached sprite is
  identical. Verified monotonic on a Warped Drifter: **0 / 16 / 44 / 100 /
  132** exact-Ichor pixels at corruption 0 / .2 / .5 / .8 / 1.
- Directional sprites pre-bake 16 headings rather than rotating live.

**`src/render/spriteDefs.js`** — the catalogue: 12 Warped/Anomaly bodies, the
Driftwalker, XP motes, 5 material gems, 3 chest rarities, the resonant node.
Plus `projectileSprite()`, a **factory** rather than a fixed list — which is
what let Phase 3 give every generated weapon real art.

The old vector `drawShape()` was deleted rather than left as a second source
of truth for what a Warped Hulk looks like.

**Juice:** damage numbers gained a spawn pop (overshoot ~1.5×, crits harder)
and sideways drift so stacked numbers fan out instead of smearing. Death
bursts became three layers — chunky body debris sized to read as sprite pixels
scattering, an Ichor spray scaled by the victim's corruption, and a white core
flash. Screen shake and hit-flash already existed and are unchanged.

---

## Phase 3 — Weapon system

**22 base types × 21 modifiers = 4,090 valid weapons** (spec asked for 20/20).

**`weaponBases.js`** — 22 bases, each a distinct *verb* for delivering damage,
held to the project's existing rule that no two should want the same
positioning: Rail wants them lined up, Aura wants them touching you, Mine
wants you to have predicted where they'll be, Turret wants ground you chose,
Boomerang wants them on the return path. Fourteen new (Cleave, Lash, Sentry,
Drift Drone, Rift Charge, Recursor, Railpike, Caroms, Fuse Shard, Bleedfield,
Arcwork, Siphon, Overcharge, Rupture, Voidburst).

**The seven originals were migrated, not rewritten** — re-registered under
their own ids, so every recipe, upgrade node and saved gear item naming
`splinter` or `quake` keeps resolving, and the balance work already on them
carried over intact.

**`weaponMods.js`** — 21 modifiers. The load-bearing decision: `onHit` fires
from `flushPendingHits`, the single chokepoint every player-sourced hit
already passes through. That's why a modifier works identically on a bolt, a
beam, a mine blast and a turret shot without any of them knowing modifiers
exist.

**`weaponGen.js`** — composition. Deterministic ids (`base+modA+modB`, sorted)
so a saved profile can reference a generated weapon. Stat folding happens at
build time, so a generated weapon costs exactly what a hand-written one costs
to run. Every weapon mints its own projectile sprite from its modifier-tinted
colour — verified 12/12 sampled weapons produce distinct sprites and colours.

New entity families: **deployables** (turrets/companions/mines) and **sweeps**
(melee/aura arcs). Plus Warding's shield pool, Surging's speed buff, and
Rending's armour shred (capped so it can never invert mitigation into a bonus).

---

## Phase 4 — Character select

Ten Driftwalkers in a new **Crew** tab, now the Hub's landing tab.

| | Character | Lean | Opens with |
|---|---|---|---|
| open | The Scavenger | baseline | Splinter |
| open | The Bulwark | +65 HP, −22% speed | Cleave |
| open | The Kite | +30% speed, −32 HP | Seeker |
| open | The Gunner | +crit, −15% area | Railpike |
| open | The Warden | +40% duration, −15% haste | Sentry |
| 1500 kills | The Vessel | +35% dmg, 55 HP | Overcharge |
| wave 8 | The Choirmaster | +1 projectile, −18% dmg | Splintered Scattergun |
| 4 min | The Reaver | sustain bruiser | Leeching Cleave |
| 15 runs | The Longdrifter | +50% pickup | Rift Charge |
| wave 14 | The Half-Warped | +22% everything, 45 HP | Smouldering Bleedfield |

Every lean pays for itself — a roster of strictly-better picks would have one
correct answer. Five gate on the **same `profile.milestones` counters the
recipe system already uses**, so unlocks are earned by what you're already
doing rather than by a parallel currency.

Sprites share one cloaked base (so they read as ten members of one profession)
plus a per-character silhouette change — pauldrons, streamers, a barrel, a
deploy rack, a pack, orbiting motes, a body coming apart. The silhouette
carries the identity rather than the colour, because colour alone fails
exactly when it matters: small, in a crowded frame. Roster cards render the
**live sprite**, so the portrait is literally what represents you in the arena.

---

## Bugs found and fixed

All five were found by the automated sweeps, not by reading the code. None
were in the code I'd just written being obviously wrong — they were all
integration mismatches that only appear when you actually run the thing.

1. **Overcharge could never fire.** The engine reassigns `weapon.cooldown`
   immediately after `fire()` returns, so a `fire()` that deferred itself by
   zeroing the cooldown had that overwritten one line later. The charge never
   built past one frame. Charge now runs on its own clock.

2. **Siphon poisoned `state.damageDealt` with NaN.** `updateBeams` resolves
   *every* beam entity as a damage beam, and Siphon pushes a visual-only one
   with no `damage` field. Fixed at the call site and hardened in
   `resolveBeam` — a silent NaN propagates to the run summary far from its
   cause.

3. **Seeking + any non-seeker base crashed.** The retag flipped `kind` to
   `'seeker'` without installing `target`/`turnRate`/`speed`, and
   `steerSeeker` checked `=== null` before dereferencing `.alive`.

4. **Projectile modifiers were silently dead on all seven migrated weapons.**
   `PROJECTILE_BASES` still listed pre-migration ids (`bolt`/`spread`/
   `homing`). The Choirmaster asked for a Splintered Scattergun and got a
   plain one, with no error anywhere. This is the one I'd most want a second
   pair of eyes on — it failed *invisibly*, and the only reason it surfaced is
   that a character declared a modified weapon and the test compared the
   resolved id against the declared one. Fixing it grew the roster 3,856 →
   4,090.

5. **Same-tier Outpost drones stacked** (pre-existing, fixed earlier in the
   session).

Two apparent failures turned out to be **test artifacts**, not bugs, and are
called out here so they don't get "fixed" later: `orbit+broad` dealing zero
damage (Broad widens the orbit 92→124px and my harness had parked enemies at
exactly 100px, inside the sweep — against varied spacing it deals 61.4 vs base
66), and a batch of console errors that were stale HMR entries from mid-edit
saves, confirmed clean in a fresh tab.

---

## Verification performed

- **All 22 base types** fire and deal finite damage in isolation.
- **All 410 base × single-modifier combinations** pass with zero failures.
- **400 random 2-modifier weapons** pass with zero failures.
- **All 10 characters** apply their exact declared weapon id and a distinct
  stat block, and play a clean 40-second run with real wave spawning.
- **Unlock gating**: locked characters refuse selection; choice persists
  across reload; a save naming an unknown character falls back to the default
  rather than throwing.
- **Performance** at 393 enemies with a deployable-heavy loadout: update
  0.6 ms p50 / 1.8 ms p95, render 3.1 ms p50 / 7.7 ms p95, against a 16.67 ms
  frame budget.
- Production build succeeds; no console errors in a fresh tab.
- Test data cleaned out of localStorage afterward.

## Suggested first steps in the morning

1. **Just look at it.** `npm run dev` — the pixel art and the Crew tab are the
   two things I had no way to evaluate.
2. **Check the difficulty.** Character stat leans and the 14 new weapon bases
   were balanced by reasoning, not by playtesting. The Vessel dealt 3,820
   damage in the same 40s window where the Scavenger dealt 952 — that's an
   intentional glass-cannon gap, but 4× may be too wide.
3. **Deploy when you're happy**: `git push` (auto-deploys Pages) and
   `vercel --prod`.
