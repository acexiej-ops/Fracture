/**
 * lore.js — the setting's vocabulary, in one place.
 *
 * Every screen that writes prose about the world reads its nouns from here
 * rather than hardcoding them, so the theme stays consistent as new screens
 * (character select, weapon descriptions) get added. Nothing here is a
 * gameplay value — it is display text only, and no system keys off it.
 *
 * The setting, in four terms:
 *
 *   FRACTURE     A tear in space. Something on the other side leaks through.
 *   ICHOR        What leaks. It rewrites whatever soaks in it long enough.
 *   THE WARPED   Creatures, machinery and lost operators that soaked too long.
 *   ANOMALY      A Warped thing that has lost its original shape entirely.
 *   DRIFTWALKER  You. A scavenger who worked out how to *use* Ichor instead
 *                of being unmade by it — which is not the same as being safe
 *                from it.
 */

export const LORE = {
  fracture: 'Fracture',
  ichor: 'Ichor',
  warped: 'Warped',
  anomaly: 'Anomaly',
  player: 'Driftwalker',
};

/** Banner text for the moment an Anomaly manifests / falls. */
export const anomalyArrives = (name) => 'ANOMALY: ' + name.toUpperCase();
export const anomalyFalls = (name) => name.toUpperCase() + ' UNMADE';

/**
 * Short setting-flavour lines, shown on the Hub when there's no run record to
 * report yet. Kept here rather than in the Hub so the Hub stays a renderer of
 * profile data and nothing else.
 */
export const OPENING_LINE =
  'No drifts logged. Take what the Fracture leaks and come back with it.';
