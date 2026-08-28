# Fracture

A roguelite arena survivor. Vanilla JS + Canvas, no framework, Vite for the dev server.

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

**Controls** — `WASD` / arrows to move. All weapons aim and fire themselves.
`1` `2` `3` pick an upgrade, `Esc` or `P` pauses. After a death, `R` runs again
and `H` returns to the Hub. The gear icon (top-right, reachable from anywhere)
opens mute/volume settings.

The game opens on the **Hub** — Loadout on the left, and a tabbed Forge /
Stash / Outpost panel on the right. Forge what you can afford, equip it, and
press Begin Run. Check the Outpost tab between runs for whatever your drones
produced while you were away.

## The arsenal

You start with Splinter and can hold **four weapons at once** (the starter plus
three). Six are acquirable, so the arsenal is a real choice — you cannot collect
one of everything.

The design rule: *no two weapons should want the same positioning.*

| Weapon | Behaviour | Wants you to | Crowd dependence |
|---|---|---|---|
| **Splinter** | Fast single bolt at the nearest enemy | anything — it's the reliable baseline | x1.1 |
| **Seeker** | Slow homing shards; applies Mark | fight alongside other weapons | x1.2 |
| **Scattergun** | Wide cone of short-lived pellets | get dangerously close | x1.9 |
| **Lance** | Instant beam, pierces everything in a line | line enemies up | x3.6 |
| **Warden Blades** | Blades orbit you, cutting what they sweep | stand *inside* the crowd | x6.4 |
| **Quake** | Shockwave ring bursting outward from you | be in the middle of it | x8.7 |
| **Ember Trail** | Drops burning ground behind you | never stop running | x14.4 |

"Crowd dependence" is measured: damage per second against a 45-enemy crowd
divided by the same weapon against 6 enemies. It's the number that says whether
a weapon is a scalpel or a lawnmower, and it's what makes two arsenals *play*
differently rather than just hitting for different amounts.

## The upgrade tree

Phase 1 drew three upgrades at random from a flat list, which meant every run
converged on the same numbers in a different order. Now the pool is a directed
graph — 45 nodes, 25 of them gated behind a prerequisite or behind owning a
particular weapon.

- **Global upgrades** (+15% damage, +12% attack speed, …) are multipliers that
  lift your whole arsenal, and are always available.
- **Weapon branches** require owning that weapon. Committing a level-up to a
  weapon opens its branch: `Choke Bore` → `Double Barrel`, `Whirl` → `Vortex`,
  `White Heat` → `Wildfire`.
- **Synergy nodes** change what the game *does* rather than what a number is.

Offer weights adapt: new weapons are heavily favoured while your arsenal is
small, then fall away sharply, so the front half of a run is about *choosing* a
build and the back half is about *deepening* it.

## Synergy combos

These are the pairings worth building toward. Each multiplier is a **median of
three measured runs** against the same fight without the combo — single samples
vary by as much as 50%, so treat these as the shape of the effect rather than
exact figures.

1. **Volatile Remains + a multi-hit weapon.** Corpses detonate; detonations
   finish off wounded neighbours, which detonate in turn. With Scattergun's
   pellet spray that's **2.5x**, rising to **4.8x** with `Unstable Core`. The
   chain reactions fall out of the deferred-damage queue for free (see below).
2. **Wildfire + Ember Trail.** Enemies that die burning leave fire pools, which
   ignite whatever walks over them — genuinely self-sustaining in a crowd.
   **~2.0x**, and capped deliberately (see *Balance notes*).
3. **Arc Lightning + many small hits.** Crits arc to a neighbour, so weapons
   rolling lots of crit checks (Scattergun, Splinter with Fork) benefit far more
   than one big slow hit. **1.54x** on a crit-stacked Splinter.
4. **Overcharge (Lance) + tanky enemies.** The beam deals +20% for each enemy
   already pierced. **1.45x** against enemies that survive the first hit — and
   nothing at all against grunts that die anyway, which is exactly the trade-off
   it should have. Pair it with anything that clumps a line.
5. **Fissure (Quake) + Vortex or slows.** Quake cracks the ground into burning
   rifts. **1.42x**, and rifts only pay off if enemies stay in them.
6. **Vortex + Warden Blades.** Blades drag the crowd inward instead of letting
   it scatter, holding enemies inside the cutting radius. **1.37x**, and it
   feeds every AoE you own.
7. **Target Lock (Seeker) + any fast weapon.** Seeker impacts Mark everything
   nearby, and marked enemies take +35% from *all* sources. Marks ~60% of the
   crowd, so the ceiling is about **1.23x** — the more attacks per second you
   have, the closer you get to it.

## Project layout

```
index.html            canvas + HUD + overlay markup
src/
  main.js             entry point — owns the ORDER systems run in
  core/               engine-level, knows nothing about Fracture
    loop.js           fixed 60Hz sim, decoupled render
    input.js          polled keyboard state
    spatialGrid.js    uniform grid for broad-phase queries
    rng.js, math.js
  game/
    config.js         *** every balance number in the game ***
    state.js          GameState — single source of truth for a run
    stats.js          generic modifier stack  <- the crafting seam
    weaponDefs.js     the seven weapons: data + fire/tick hooks
    weapons.js        weapon engine + projectiles, beams, shockwaves, zones
    upgrades.js       the upgrade tree (45 nodes)
    enemies.js        spawn, AI, statuses, death and on-death effects
    player.js  waves.js  xp.js  effects.js
  render/
    renderer.js       all canvas drawing
    camera.js         smoothed follow camera + shake
  ui/
    hud.js  levelup.js  gameover.js
  styles/main.css
```

`core/` knows nothing about the game, `game/` knows nothing about rendering, and
`render/` + `ui/` only read state. Systems never call each other — `main.js`
sequences them.

## How the stat model works

This is the part that matters for the crafting system later.

With one weapon, "damage" could just be the player's damage. With seven, the
player's stats became **global multipliers** layered on top of each weapon's own
numbers:

```
effective damage   = weapon.damage   x player.damage
effective cooldown = weapon.cooldown / player.attackSpeed
effective count    = weapon.count    + player.projectileCount
```

Read via `wstat(state, weapon, name)` — never off the weapon directly. That one
indirection is why a weapon stays balanced relative to its peers no matter what
the player has stacked, and why `+15% damage` correctly improves an arsenal it
has never heard of.

Both layers are the same `Stats` class from Phase 1: a stack of modifiers tagged
with a source, resolved as `(base + flat) * (1 + inc) * mult`. A global upgrade
pushes a modifier onto `state.stats`; a weapon upgrade pushes one onto
`weapon.stats`; a crafted affix will push one onto either. `removeSource(id)`
takes it back off, so gear can be unequipped without any combat code knowing
gear exists.

Upgrades that can't be expressed as a number — corpses detonating, burning
deaths spreading fire — set a flag on `state.flags` instead, and the system that
cares reads it. Keeping them in one bag makes it obvious what non-stat behaviour
a run has switched on.

## Notes on the implementation

- **Deferred damage queue.** Hits found while walking the spatial grid are
  queued on `state.pendingHits` and applied after traversal, because an
  on-death effect that damages *other* enemies would otherwise mutate the crowd
  midway through iterating it. The flush loop re-reads the queue length each
  iteration, so a detonation that kills three more enemies gets *their*
  detonations processed in the same drain — chain reactions fall out of the
  queue for free, with no recursion, and always terminate because a dead enemy
  is skipped.
- **Beams resolve front-to-back.** Everything a Lance touches is collected, then
  sorted by distance along the beam, because Overcharge ramps damage per enemy
  already pierced and would be meaningless in arbitrary order.
- **Swept collision.** Shots travel ~700px/s, far enough to tunnel through a
  small enemy in one tick, so collision tests the segment travelled.
- **Fixed timestep**, spatial grid, pre-rendered glow sprites, and viewport
  culling all carry over from Phase 1.

Measured with a maxed four-weapon build at wave 40 against ~400 enemies:
**2.0ms median / 5.2ms p95 render, 0.1ms median / 1.4ms p95 update**, against a
16.67ms frame budget.

## Balance notes

Three things had to be capped or they ran away, and all three are worth knowing
about before tuning:

- **Zones (28)** and **blast rings (36)**. Wildfire pools are created by deaths
  that the pools themselves cause — a feedback loop that scales with crowd
  density, and crowd density *is* the difficulty curve. Uncapped it reached 149
  concurrent zones and outran the game entirely.
- **Quake damage falls off toward the rim.** With flat damage it was the
  strongest weapon in the game by a wide margin: it hit the whole crowd for full
  damage, needed no aim, and worked perfectly *while running away*, which is the
  optimal playstyle anyway.
- **Enemy speed and spawn rate are uncapped.** Any ceiling on either is a wave
  at which difficulty stops growing in a dimension the player cannot out-scale,
  and a strong build parks there forever. The giveaway was two very different
  builds finishing a 25-minute run with an *identical* 36,940 kills — both were
  spawn-limited rather than damage-limited. With the caps removed, a fully-maxed
  build dropped into wave 31 dies in 23 seconds, and wave 61 in 4.

Enemy speed in particular is the curve that ends runs. It was the one left flat
in Phase 1, which is why inflating health and spawn counts never threatened a
competent player — they simply outran everything. It also turns `Light Step`
from a nicety into a defensive stat.

## Character balance

The roster grew to 21 Driftwalkers across several passes with no measurement
step — every stat lean was authored by feel. `scripts/balance_sim.mjs`
simulates all 21 under identical conditions (Normal difficulty, no gear, a
25-minute cap, 5 fixed seeds averaged) using the real game systems — waves,
enemies, weapons, abilities, XP/level-up — imported directly under Node with
a minimal canvas/DOM shim, the same "measure it, don't guess" approach
already used elsewhere in this project. Movement is a simple, uniform
"flee whatever's nearby, weighted by distance" heuristic (there's no real
pathing AI to reuse, and it's the same rule for every character, so
differences in outcome reflect the character, not simulated-AI skill);
abilities and the ultimate are pressed the instant they're off cooldown,
since `updateAbilities` never auto-fires and several kits lean on ability
uptime as much as weapon DPS. Run it with `node scripts/balance_sim.mjs
[seeds] [maxMinutes]`.

**Three real bugs turned up before any stat could be trusted, and all three
had to be fixed first:**

- **Every character was silently starting with a second, hidden Splinter.**
  `applyCharacter()` resolved the character's weapon (an arsenal id like
  `breaker_maul`) through `buildWeapon(baseId, ...)`, which expects a base
  *behavior* id (`slam`, `lash`, ...) — arsenal ids never match, so it always
  fell back to `addWeapon(state, 'splinter')`. The character's real weapon
  was then granted correctly a moment later by `seedInventory` — the dead
  code in `applyCharacter` was just deleted.
- **A cosmetic effect was desyncing every seeded run.** `player.js`'s
  movement-dust particle was gated on `Math.random() < 0.35`, not the
  seeded `rng` — but the particles it then spawns roll their spread/speed
  *from* the seeded `rng`. Whether that extra draw happened was effectively
  random, so it silently desynced every enemy spawn, crit roll and affix
  roll after the first dash — the exact reproducibility `rng.js`'s own
  header comment promises, broken by one dust effect, and the reason two
  runs of the balance harness at the same seed gave completely different
  results until this was found and fixed (`Math.random()` → `rng.bool(0.35)`).
  This also means every seeded **tournament** run was subtly unfair between
  players in ways that had nothing to do with skill.
- **4 of the 5 newest characters were silently playing a different
  weapon than their kit describes.** Chronicler, Blood Mage, Engineer and
  Chronokeeper (`meta/newCharacters.js`) declared weapon ids (`quill_storm`,
  `blood_orb`, `sentry_gun`, `temporal_bolt`) that don't exist anywhere in
  the arsenal — `seedInventory`'s fallback chain (arsenal id → behavior id →
  `'fire_wand'`) landed all four on Fire Wand, nothing like "freeze/control",
  "sacrifice/AoE", "summon/turret" or "time/rewind". Reassigned each to a
  real, previously-unused weapon that actually matches: `chrono_pocket`,
  `earthquake_stomp`, `electric_fence`, `void_rift`.

**With those fixed, two rounds of measure → adjust → re-measure** (composite
score = average rank across survival time, wave reached, kills, and damage
dealt; a character flagged as an outlier sits >25% of the roster size away
from the median rank):

| Character | Stat | Before | After |
|---|---|---|---|
| Bulwark | maxHp / regen | +65 / +0.8 | +48 / +0.6 |
| Reaver | maxHp | +25 | +15 |
| Grave-Tender | regen | +1.6 | +1.1 |
| Tidebreaker | maxHp | +40 | +28 |
| Ashwalker | damage | −0.20 | −0.12 |
| Chemist | damage | +0.10 | +0.16 |
| Half-Warped | regen | −0.4 | −0.25 |
| Blood Mage | maxHp / regen | −35 / −0.6 | −15 / (removed) |

**Bulwark, Reaver, Grave-Tender and Tidebreaker stayed at the top of the
ranking even after trimming** — worth being honest about why rather than
keep chasing the simulation's number: nobody in the harness survives past
wave ~5 (the bot has no real skill), so the simulation mostly measures raw
early-game survivability, and all four lean on exactly that (HP, regen,
knockback control). A skilled human run goes much further and would let
weapon/build scaling matter far more than it can here — trimming these
four further risked gutting their actual identity to satisfy a ceiling this
specific bot hits regardless. **Chemist and Blood Mage stayed at the
bottom** for a related but opposite reason: both pair a fragile lean with a
close-range weapon (`acid_spray`, `earthquake_stomp`), and a bot whose only
strategy is "flee whatever's nearby" structurally can't get either weapon
into range — a real player, weaving in for a hit and back out, would not
be nearly this starved. Their buffs above are kept (they're reasonable on
their own terms) but not pushed further to chase parity with a number the
bot can't fairly produce for that archetype.

## Phase 3 — crafting

Progress now persists between runs. A run is where you gather; the **Hub** is
where you spend.

### Materials

Three tiers, five materials. Common ones (**Slag**, **Filament**) credit straight
to the run total on kill; rare (**Alloy**, **Ichor**) and exotic (**Resonant
Core**) drop as physical motes you have to go and collect. That split is
deliberate: four hundred enemies dropping pickups would bury the arena, but a
rare drop should still be a moment you notice.

### Resonant nodes

Nodes are the reliable source of rare material, and they are a *decision* rather
than a pickup. They spawn 420–900px away — off-screen, with an edge marker
pointing at them and a countdown ring — and cracking one wakes a guard pack in a
ring around you. Taking a node means abandoning whatever ground you had
established and fighting on unfamiliar terrain. Kills alone would make a
rare-tier recipe take a dozen runs.

### Gear

Three slots — **Weapon**, **Armour**, **Trinket** — and three rarities. Rarity
does two things at once: it scales the rolled base stats (1.0x / 1.18x / 1.40x)
*and* it decides how many affix lines the item gets (1 / 2 / 3). The strongest
affixes are gated behind rarity, so an exotic roll is worth chasing beyond simply
having more lines on it.

Base stats roll within a range, so two items off the same recipe are never quite
the same. A **weapon rig** grants its weapon at run start and carries
weapon-scoped bonuses that land on that weapon's own stat stack.

Nineteen affixes. Most are stat lines, but seven change behaviour and set flags
instead — the same mechanism Phase 2's synergy upgrades use, which means crafted
gear feeds straight into those combos:

| Affix | Effect |
|---|---|
| Chilling | chance on hit to slow |
| Smouldering | chance on hit to ignite |
| Barbed | enemies that touch you take damage |
| Scavenging | more material drops |
| Avaricious | more experience |
| Leeching | chance on kill to heal |
| Unstable | slain enemies detonate — an innate Volatile Remains |

### Recipe unlocks

14 recipes, 3 open at the start. The rest unlock either by **finding a material
for the first time** or by **hitting a milestone** (total kills, best wave, best
time). Unlocks key off materials *ever seen*, not currently held — spending your
last Alloy must never re-lock a recipe you already earned. Locked recipes show
exactly what they're waiting on.

### How gear reaches a run

This is the payoff for building `Stats` as a source-tagged modifier stack back in
Phase 1. `applyLoadout()` runs once, straight after `new GameState()`:

1. weapon rigs grant their weapon, so weapon-scoped modifiers have a target;
2. every modifier is pushed onto the player's stack, or that weapon's stack,
   tagged `gear:<uid>`;
3. behaviour flags accumulate onto `state.flags`.

No combat code changed. An affix and a level-up upgrade are the same kind of
object, so they land in the same stack and resolve through the same formula —
gear simply gets there first. Verified directly:

```
maxHp        145 = 100 base + 20 gear + 25 upgrade          (flat sum)
attackSpeed  1.2266 = 1 x (1 + 0.1066 gear + 0.12 upgrade)  (additive percent)
quake damage 20.382 = 12 x (1 + 0.098 gear + 0.60 upgrade)  (weapon-scoped)
```

Flags mostly add, with one exception: two Chilling items take the *stronger*
slow multiplier rather than summing past 100%, which would send enemies
backwards.

### Saving

Everything lives in one `localStorage` key. Loading is written defensively,
because a save file is the one input the code cannot make assumptions about — it
may come from an older build, a crashed tab, or a text editor. Every field is
re-derived rather than trusted: unknown material ids are dropped, negative and
fractional counts are clamped, malformed gear entries are discarded
individually, and a loadout pointing at gear that no longer exists is cleared.
Verified against deliberately hostile saves — invalid JSON, `null`, wrong types
throughout, dangling references — none of which throw. A corrupt save costs
progress at worst; it never leaves the player at a blank page.

## Project layout (additions)

```
src/meta/               everything that outlives a run
  materials.js          tiers, drop tables, node yields
  gear.js               slots, rarities, the affix pool, item rolling
  recipes.js            what can be crafted, costs, unlock gates
  profile.js            localStorage persistence + defensive migration
  loadout.js            the bridge: applies equipped gear to a run
src/game/nodes.js       resonant nodes in the arena
src/audio/sfx.js        every sound cue, synthesised — no audio files
src/ui/hub.js           the between-runs screen
src/ui/settings.js      the mute/volume panel
```

## Phase 3 scope

Built: a three-tier material economy with two acquisition routes, resonant
nodes, 14 recipes with two kinds of unlock gate, three gear slots, three
rarities, 19 affixes (7 of them behavioural), a hub with forge / stash /
loadout, and persistence that survives a hostile save file.

Still not built: meta-progression beyond recipes (no permanent stat tree), and
gear cannot yet be re-rolled or upgraded once crafted — a crafted item is final.

## Enemy variety

Nine archetypes now, up from four, and the design rule was the same one the
weapons follow: **no two should threaten you the same way**, so a build that
handles one is never automatically safe from the rest.

| Enemy | Behaviour | What it punishes |
|---|---|---|
| Grunt / Darter / Brute / Charger | (Phase 1) chase, fast chase, tank, telegraphed dash | standing still |
| **Lurker** | holds range, strafes, telegraphs then fires a bolt | pure kiting — the one damage source distance alone doesn't stop |
| **Skitter** | fast, juke timer re-rolls a bounded heading offset | non-homing shots that have to lead a target |
| **Juggernaut** | huge HP pool, 35% flat damage reduction | burst damage — mitigation makes a single big hit worth less than the same total spread out |
| **Swarmling** | 4 HP, spawns in clusters of 6 via `swarmSize` | standing still while many small threats close from every side |
| **Husk** | roots and telegraphs within 100px, then detonates for AoE | melee range on reflex — backing off during the windup fizzles it |

**Wave mixing** was mostly already structural — `spawnOne` draws each enemy from
a weighted roll over every unlocked type, so a wave was never single-archetype
by construction. What needed adding was the *wave-boundary burst*: a pure
weighted roll repeated N times can land on one type by chance, so
`spawnDiverseBurst` round-robins a shuffled type list instead, guaranteeing the
step into a new wave reads as mixed pressure. Verified across a real 400s run:
13 of 14 waves observed carried 2+ distinct types, and by wave 9 all nine
archetypes were spawning in the same wave.

**Enemy projectiles** are a new entity type (`state.enemyProjectiles`), updated
and collided against the player in their own pass — deliberately not reusing
the player's `updateProjectiles`, since they don't need pierce, crit, or the
spatial grid, just a line and one collision test against one target.

**Balance**: the first version of these nine, measured against the identical
greedy build used throughout Phase 2/3 testing, cut survival time roughly 3x
(a build that used to survive the full test cap now died at wave 10). The
lurker's ranged chip damage was the main driver — it's the one threat a
kiting-only strategy cannot out-position at all, so it needed the lightest
touch of the three new damage-dealers. Tuned lurker damage/cooldown, juggernaut
contact damage, and husk blast damage/radius down until median survival across
a random-pick-bot sample landed back in the same range Phase 2 always showed.

## Sound

Every cue is synthesised with the Web Audio API — oscillators and filtered
noise bursts shaped with a short gain envelope — rather than loaded from audio
files. `src/audio/sfx.js` owns one `AudioContext`, built lazily on the first
keydown or pointerdown (autoplay policy blocks audio before a user gesture, so
the engine starts inert and has no dependency on load order).

Eight cues: weapon fire (one tone profile per weapon family — a "pew" for
Splinter, a noise burst for Scattergun, a rising sweep for Lance, a low thump
for Quake), enemy hit (brighter/higher for a crit), enemy death, level-up (a
three-note arpeggio), an upgrade or gear pick, taking damage, player death, and
forging gear (more notes and a shimmer for a rarer craft — common gets two
notes, exotic gets four plus a noise sparkle).

A frame-scoped rate limiter caps `shoot`/`hit`/`kill` at 8/6/4 per simulation
tick, reset via `sfx.beginFrame()` from the main loop — the same shape as
`Input.beginFrame()`. Without it, a forty-kill chain reaction would start forty
overlapping oscillators in one frame: not louder, just node churn and noise.
`playerHit` is deliberately unlimited, since the 0.65s i-frame window already
spaces out real hits far more than any rate limit would.

**Settings**: a gear icon fixed top-right, reachable from both the Hub and an
in-progress run, opening a small panel with a mute checkbox and a volume
slider. Persisted to its own `localStorage` key, independent of run progress.
Found one real bug while testing it: the Hub's `update()` has an early return
for "nothing simulates behind a modal screen," and the settings-close-on-Escape
check was placed *after* that return — meaning Escape could never close the
panel while sitting on the Hub, which is exactly where a player is most likely
to have opened it first. Moved the check above the early return.

## Boss fights

Every 5th wave, forever — recurring milestones in an endless run, not a
capstone. A boss never blocks progress: trash still trickles in while one is
alive (at 35% of the normal rate, so the fight stays the focus without the
arena going quiet), and you can ignore a boss entirely and keep levelling from
regular kills if you'd rather not engage it.

Three archetypes, cycling round-robin (wave 5 = Behemoth, 10 = Warden, 15 =
Swarm Queen, 20 = Behemoth again, now scaled by the same wave-based curves
every regular enemy gets — no separate "boss tier" multiplier needed):

- **Behemoth** — a melee wall alternating a telegraphed ground slam with a
  telegraphed charge. Two different tells, so reading *which* is coming
  matters, not just reacting to contact.
- **Warden** — holds range like a Lurker at boss scale, fires wide volleys,
  and periodically summons a small pack. The fight is as much about the adds
  as the boss itself.
- **Swarm Queen** — a mobile damage aura that periodically calls in swarmling
  clusters. Never hits hard alone; the danger is the arena filling up while
  you're focused on the health bar.

Every boss gets a phase transition at 50% HP (faster attacks, no new moveset)
and a dedicated HUD health bar with phase pips, replacing the small per-enemy
bar every other archetype gets — the one enemy the screen should organise
around gets to say so.

Bosses live in the exact same `state.enemies` array and pipeline as everything
else (targeting, `damageEnemy`, status effects, on-death synergies all just
work), dispatched through one extra branch checked *before* dash/ranged/
erratic/detonate — a boss can carry a `ranged` sub-config for its bolt tell
without being routed through the plain Lurker AI that block would otherwise
trigger. Defeating one guarantees a rare-or-better chest and its own fanfare,
separate from the ordinary probabilistic drop.

## Arena biomes

Picked once per run: The Wastes (the original arena, no hazard), Cinder Fields
(fire geysers), Frostreach (ice that slows). Deliberately *not* static
obstacles or walls — that would mean teaching every enemy's AI and every
projectile to path around them, a much bigger change than "the arena looks and
feels different this run." A hazard only ever threatens the player directly,
never a stat and never an enemy, so it can't shift build balance the way a
weapon or upgrade could.

Hazards are self-contained (`src/game/biomes.js`), not routed through the
weapon-authored `zones` system — those zones are built and tuned to damage
*enemies* (Ember, Fissure); branching them to also threaten the player would
complicate a well-tested system for one feature. Every hazard telegraphs
first: a dashed warning ring with no effect, then a filled zone that actually
damages or slows once it's live — nothing here can hurt the player without
drawing the ring version of itself first.

## Game feel

Three additions, kept deliberately small next to everything else this pass:

- **Hit-stop** — a few frames of true freeze on a kill that deserves one (a
  boss, anything brute-and-heavier, or a crit), sold as impact rather than
  lag. Implemented as an early return at the top of `_simulate`: while the
  timer is active, nothing below it — AI, weapons, even the clock — advances,
  and the world holds its current frame because rendering runs independently.
- **Crit flash** — a brief bright screen pulse on a critical hit, layered
  under the low-health vignette so the two never compete for the same read.
- **Kill combo** — consecutive kills within 1.1s of each other keep a streak
  alive, shown once it's worth mentioning (3+) and sized to the count.

## Chests

A reward layer on top of the existing systems, not a new one: a chest can
only ever hand out materials the forge already eats, Scrip a new reforge
action eats, or gear rolled through the exact same `craftItem` a Hub forge
uses. Three tiers, colour-matched to gear rarity, visually distinct before
you open one — a box silhouette (the one shape not already claimed by an
orb, a node, or an enemy), with slow-orbiting motes marking an exotic at a
glance.

**Three sources:**
1. A small per-kill chance, dropped where the enemy died.
2. A "found in the open" spawn — like a resonant node's placement, but with
   no guard pack, since a chest is meant to read as a pure bonus rather than
   another fight.
3. A guaranteed rare-or-better chest on every boss kill.
4. An end-of-run performance chest, tier-weighted by how far the run got —
   the one chest in the game opened with a deliberate button click rather
   than on contact, since the Game Over screen is the one moment with no
   combat pressure behind it, so a manual click earns its keep instead of
   just adding friction. Its rarity stays a mystery until opened.

**Opening** is instant on contact for in-run chests, same as every other
pickup (orbs, motes, nodes) — combat never pauses for it. The "event" feeling
comes from the reveal instead: a burst scaled to rarity, a distinct chime
(`sfx.chest`, pitched down a fourth from `sfx.craft` so the two don't blur
together), and a floating world-space summary of exactly what came out.

**New currency**: Scrip, earned only from chests, spent only on **Reforge** —
rerolling one item's affixes in the Hub while keeping its rolled base stats,
slot, and recipe untouched. Gives Scrip a real, contained purpose without
building a full shop.

**Balance**: the first tuning pass (0.028 drop chance per kill) produced 24
opened chests and 122 units of exotic-tier material from one 5-minute run —
enough to make the entire scarcity-based economy Phase 3 was built around
irrelevant. A reward layer sitting on top of existing systems isn't supposed
to replace what makes them work. Cut to 0.005 (roughly 6x lower) plus a longer
interval on the "found" spawn; a typical run now nets a small handful of
chests total, most of that from bosses rather than ambient luck, and one
material windfall genuinely reads as a moment rather than routine income.

## Project layout (this pass)

```
src/game/chests.js      in-run chest entities: spawn, contact-open, banking
src/meta/chests.js       chest tier weighting + content rolls, shared by every
                          chest source (in-run, boss, end-of-run)
src/game/biomes.js       environmental hazards for the run's chosen biome
```

Plus additions inside existing files: boss archetypes and the biome/chest
config live in `game/config.js`; boss AI dispatch and attack functions live
in `game/enemies.js` alongside the enemy AI they're structured like; `Scrip`
and `reforge()` live in `meta/profile.js` next to the rest of what survives
between runs.

## The Outpost

A passive mining colony, in a new Hub tab alongside Forge and Stash — the Hub
itself was restructured from three fixed columns into Loadout (still its own
column) plus a tabbed panel, since a fourth static column would have been
cramped and the request specifically asked for a tab.

**Deliberately common-tier only.** Drones produce Slag and Filament and
nothing else — never Alloy, Ichor, or Core. That's enforced structurally, not
just by convention: `YIELD_MATERIALS` in `src/meta/outpost.js` is the single
list every drone tier's yield is validated against, and every recipe still
gated behind rare/exotic material stays gated behind actually playing a run.
Verified directly: 20 collections with every drone and upgrade maxed out
never produced anything but the two common materials.

**Three drone tiers**, each unlocked by owning at least one of the previous —
Scrap Skimmer → Salvage Hauler → Extraction Rig — standard idle-game cost
scaling (`cost(n) = base × growth^n`, growth ~1.15-1.18 per tier). Costs and
yields are both in the same two common materials the drones produce, so
buying a drone is spending today's grind-easing to buy more of it tomorrow —
a self-contained loop that doesn't touch the rest of the economy.

**Offline production is a pure function of `(profile, now)`** — nothing is
ticked by a background timer. "Accrued while the game was closed" falls out
for free: the next time anything asks, it computes real elapsed time since
`lastCollectedAt` and multiplies by the rate, capped by the offline limit.
Verified by saving with a 5-hour-old timestamp, reloading the page into a
brand new `Game` instance with no running interval from before, and
confirming the correct 5 hours of pending yield was already there on the very
first render.

**Collection is a deliberate button**, not automatic — materials accrue but
sit as a "pending" amount (shown live, ticking up once a second while the tab
is open) until clicked. A small chance per collection — boosted by the
Prospector's Luck upgrade — turns it into a Bonus Haul at 1.8-3x, its own
distinct flash and chime, satisfying both "an upgrade for bonus-yield chance"
and "the Outpost occasionally surfaces a bonus event" as one mechanism: the
upgrade raises the odds of the event that's always possible.

**The upgrade tree** (separate from anything a run can grant): Overclock
(+15%/level production), Cold Storage (+3h/level offline cap), Prospector's
Luck (+4%/level bonus chance) — each independently levelled, each capped, so
the Outpost stays a grind-easing side system rather than something worth
over-investing in.

**The scene is a room, not a diorama or a strip of icons**: a wall band and a
floor band, seamed by a baseboard, give it a contained space with a viewport
and a small trophy shelf on the wall (its pips count real Outpost upgrade
levels bought, capped small — flavour that quietly tracks investment rather
than becoming a second progress bar). On the floor, an ops terminal sits
fixed centre-back, and each owned drone tier gets its own station in front of
it — a crate, a salvage cart, a reactor stand — spread left/centre/right so
all three can be visible at once. Each drone is a small worker character (a
rounded body with a pair of dot eyes) running a full loop: work its station
(a shake), walk to the terminal (a hop arc), deposit (a pulse), walk back,
idle briefly, repeat — real motion between two fixed anchor points, not a bob
in place. Several drones owned at once are jittered a few pixels apart around
their shared station and around the terminal, so a cluster of workers reads
as distinct characters rather than one stack sitting exactly on top of
itself. The terminal's screen fill is two-tone (a Slag band under a Filament
band) in the same proportion the pending numbers below list, and its height
is the offline cap's fill fraction — the same `3.0h / 6h` the progress bar
spells out as a number, drawn as a level instead — with a status LED that
only pulses while at least one drone is actually producing.

**Surviving the render model**: `_renderOutpost` rebuilds the whole scene's
markup every second (the live ticker), which would normally snap every
drone's walk animation back to frame zero. Each drone's `animation-delay` is
instead computed as a *negative* offset derived from the real clock every
render, so a freshly rebuilt element resumes mid-cycle instead of visibly
restarting — verified by sampling a drone's `getBoundingClientRect()` every
100ms across several rebuild boundaries and confirming its position kept
advancing rather than resetting. Collecting fires a floating "+N" burst per
material (plus a distinct "BONUS" line on a bonus haul) pinned, at spawn
time, to the pending row's actual on-screen position — not a fixed CSS
offset, which would have drifted the moment the scene's height changed — plus
a one-shot flash on the terminal screen. Both live in a layer sibling to
`.outpost` (see index.html) so the tab's own 1-second rebuild can't wipe an
in-flight animation out from under it.

### Project layout (this pass)

```
src/meta/outpost.js      drone tiers, upgrade tree, all production math —
                          every quantity a pure function of (profile, now)
```

Everything else is additions inside existing files: `Profile.buyDrone` /
`buyOutpostUpgrade` / `collectOutpost` in `meta/profile.js`, a fourth
`outpost` field in the saved profile shape (with the same defensive
migration every other field gets — verified against negative counts, unknown
tier ids, upgrade levels past the cap, and a corrupt timestamp, none of which
throw or grant an exploit), and the Hub's own three-column-to-tabbed
restructure in `index.html` / `ui/hub.js` / `styles/main.css`.

## Icons, and an idle-game pass on the Outpost

Two things this game read as a spreadsheet rather than a game: Forge/Stash
were pure text cards, and the Outpost was a counter with some bobbing dots
next to it. Both fixed without touching a single system — the whole pass is
new render output plus CSS, nothing in `meta/` or `game/` changed.

**Every material, weapon, armour and trinket now has an inline SVG icon**
(`src/ui/icons.js`), shared by every screen that lists an item — Forge
recipes, Stash cards, the Loadout, the HUD's run-materials strip, and the
Game Over haul/chest reveal. No image assets: shapes are geometric
silhouettes distinct per weapon/slot, matching the canvas renderer's own
visual language, and `gearIcon()` tints its background/border/glow to the
item's rarity colour so a glance at the Stash reads rarity before the text
does. An undiscovered material renders a deliberately generic "?" silhouette
rather than its real shape — seeing the shape would give away more than the
"???" name already withholds.

**The Outpost got a real idle-game treatment**: a live progress bar for the
offline cap (not just a number), a colony scene where the drones and
stockpile visually track the underlying data rather than decorating around
it, and a collect action that pays off with a floating number burst instead
of silently updating a total. See the updated **"The scene"** section above
for specifics.

## The Outpost, rebuilt as a room

The colony scene above was a floating silo and some flying dots on an open
background — better than a counter, but still read as a diorama rather than a
place. Rebuilt again, this time as an actual room: a wall and a floor instead
of an abstract backdrop, drones restyled from glyphs into small worker
characters with faces, and the silo reframed as a terminal sitting on a desk
rather than a tank floating in mid-air. Systems untouched — this is
`_outpostScene` and its CSS only; `_outpostShop`, `_outpostUpgrades`,
`_outpostCollectPanel`, and everything in `meta/outpost.js` are byte-for-byte
what they were before.

One real bug surfaced and got fixed along the way: with several drones of the
same tier owned, they all shared one station anchor exactly, so a cluster of
workers rendered as one drone sitting on top of itself rather than several.
Each drone now gets a small stable jitter (a few px in position, computed
from its own index) around both its station and the terminal, so owned
drones fan out and read as distinct characters — verified by reading several
same-tier drones' inline `--node-x`/`--node-y` custom properties back out of
the DOM and confirming they're all different.

Forge and Stash are unchanged in this pass — the reference this was built
from asked specifically for the Outpost's scene to stop reading as a list,
and Forge/Stash already got their own icon treatment in the pass above.

## Combat engagement: body-blocking, elites, enrage, telegraphs

Every weapon aims and fires itself, so difficulty can't come from aim skill —
it has to come from *positioning*. This pass is four additions aimed
squarely at that, none of which touch a weapon, an upgrade, or the crafting
economy.

### Body-blocking

Separation already existed (`COMBAT.separationForce`), but it was a soft
steering force blended into desired velocity — enough to keep a horde from
collapsing into one dot, not enough to guarantee two bodies never overlap,
and it never touched the player at all. `resolveBodyCollisions` in
`enemies.js` adds a second, *positional* pass at the end of every tick: the
grid is rebuilt against fresh post-movement positions, every still-overlapping
pair (enemy-enemy and enemy-player) is corrected directly along the contact
normal, mass-weighted the same way the soft separation already is. Corrections
are accumulated per-entity and applied in a final sub-pass rather than
mutated mid-query, so the result doesn't depend on iteration order.

The player got a `mass` (2.4 — heavier than early trash, lighter than
anything built to soak hits) so the same formula now applies symmetrically:
light enemies barely budge the player on contact, but a wall of heavy ones
genuinely resists and pushes back. Every simultaneous solid contact also
tallies toward `crowdSlowMult`, eased in with `damp()` and consumed by
`updatePlayer` the following tick — being surrounded costs real move speed,
floored at 32% so it's a punishing squeeze rather than a stunlock.

Verified directly: ten Brutes spawned exactly on top of the player (and each
other) resolved within a second into ten visibly distinct positions with no
remaining overlap, the player was physically displaced ~93px by the pile-up,
and `crowdSlowMult` dropped to 0.72. A 400-enemy stress test at wave 10 (the
README's own prior benchmark scenario) still held update at 0.7ms median /
1.6ms p95 against the 16.67ms frame budget — the second grid rebuild roughly
doubles the per-tick cost of the old separation pass alone, but that pass was
already cheap relative to the budget.

### Elites

A 5% chance (`ELITE.chance`, from wave 4 on) for a spawning enemy to roll as
an elite: 1.9x HP, 1.35x damage, 1.2x radius, 3x XP, and one random modifier
from `ELITE.modifiers`, layered *on top of* whatever AI its base archetype
already runs rather than replacing it — a Waller Grunt still chases normally
and periodically boxes the player in; a Mortar Darter still darts around and
lobs shells. Never bosses (already a whole encounter) and never
swarm-cluster members (an elite needs to stand alone to be worth singling
out). Visually: a rotating dashed gold ring tinted toward the modifier's own
colour, so "this one's different" reads before you're even close enough to
see its specific telegraph.

- **Waller** periodically casts a short, gapped arc of temporary walls
  centred on the *player's* position — cutting off a retreat rather than
  building a fort around itself. Telegraphed (dashed outline) before going
  solid, then blocks the player exactly like a soft arena edge for its
  lifetime. Deliberately leaves gaps: a forced choice of exit, never a cage.
- **Mortar** lobs a shell at where the player is *heading* — current
  position plus velocity times a fixed lead time — not where they are right
  now, so kiting in a straight line is exactly what it punishes and cutting a
  new direction the instant the telegraph appears is exactly how it's
  dodged. The telegraph is the growing red ring at the landing zone; there's
  no travelling projectile to react to, only the countdown.
- **Speed Aura** passively hastens ordinary (non-elite, non-boss) enemies
  within its radius, refreshed every tick they're in range and decaying
  shortly after they leave — the same shape the slow status already uses, so
  a buffed straggler doesn't instantly snap back the moment it steps out.

Verified: 2000 forced spawns landed a 5.2% elite rate split roughly evenly
across the three modifiers; bosses and swarmlings rolled zero elites across
1000 attempts each; a forced Mortar's shell landed at the exact
`player.x + player.vx * leadTime` position (checked against the actual
velocity read at fire time, mid-damp); a forced Waller produced three wall
segments that correctly blocked the player once solid; a forced Speed Aura
buffed an enemy 50px away and left one 400px away untouched.

### Enrage

Nothing else in the game punishes distance by itself — every other pressure
comes from proximity — so a build that never lets anything close could stall
indefinitely regardless of wave-based scaling. `ENRAGE` tracks
`timeSinceLastKill` (reset in `killEnemy`) instead of wall-clock time in the
current wave, since this game's "wave" is just a 17-second scaling bucket
that advances on its own either way — turtling isn't "staying in a wave too
long", it's "not fighting". Past a 9-second grace period, `enrageFactor`
ramps toward 1 via `damp()` (slow build), and back toward 0 just as soon as
kills resume (faster relief) — a single lucky hit mid-flee can't wipe out a
buildup, only sustained re-engagement does. The resulting speed/damage
multipliers (+50%/+60% at full enrage) are applied everywhere enemy
speed and damage are computed: live for continuous sources (contact damage,
movement speed, Swarm Queen's aura), baked in at the trigger moment for
discrete ones (every bolt, Husk's detonation, boss slam, Mortar shells) —
matching how bolt damage already treats "the moment it's fired" as the
meaningful snapshot.

Verified: with kills disabled, `enrageFactor` stayed at 0 through the grace
period, then measured 0.30 at 10s past a kill and 0.76 at 15s, driving
speed/damage multipliers to 1.15/1.18 and 1.38/1.46 respectively — matching
the configured curve.

### Telegraphs

Charger's dash and Husk's detonation already telegraphed (a ring, and a
ring sized to the actual blast radius); boss slam and boss charge — the
exact "exploding" and "charging" cases this was meant to cover — turned out
to have *no* visual telegraph at all despite already being rooted,
committed states in the AI. Fixed: boss slam now draws the identical
ring-sized-to-blast-radius language Husk already established, and both boss
charge and the regular Charger's dash now additionally draw a red dashed
trajectory line along the locked-in direction, sized to the attack's actual
travel distance (`speed * duration`, not the longer trigger range) — a ring
says "stay back", a line says "get off this line", and a charge is squarely
the second kind of threat. Lurker and Warden's shared ranged windup gained
the same kind of line, toward the current aim point, so the existing
tightening-ring tell communicates *timing* and the new line communicates
*direction*. Mortar's telegraph (see above) is the pulsing-radius case the
brief asked for directly.

### Project layout (this pass)

Additions inside existing files only — no new modules. `game/config.js` gets
`PLAYER.mass`, the `COMBAT.bodyPush*`/`crowdSlow*` tuning, and the new
`ELITE`/`ENRAGE` blocks; `game/enemies.js` gets `resolveBodyCollisions`,
`updateEnrage`, the elite spawn roll in `spawnEnemy`, the three modifier
functions, and `updateWalls`/`updateMortarShells`; `game/player.js` gets
`resolveWallCollisions` and reads `crowdSlowMult`; `core/math.js` gets
`closestPointOnSegment`, the one new shared geometry helper the wall
collision needed; `render/renderer.js` gets `_drawWalls`, `_drawMortarShells`,
`_drawEliteRing`, `_drawTrajectoryLine`, and the boss slam/charge telegraph
blocks inside `_drawEnemies`.
