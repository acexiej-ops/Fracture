/**
 * cloudConfig.js — where the Supabase project details go.
 *
 * ============================================================================
 * TO TURN ON ACCOUNTS, FILL IN THE TWO VALUES BELOW.
 * Until then the game runs exactly as it always has: local saves only, and the
 * Hub shows nothing about accounts at all.
 * ============================================================================
 *
 * Get them from your Supabase project:
 *   Settings -> API -> "Project URL"  and  "anon / public" key.
 *
 * BOTH ARE SAFE TO COMMIT. The anon key identifies the project, not a user;
 * Row Level Security is what actually protects data, and the policy in
 * SUPABASE_SETUP.md scopes every row to its owner. This is the key Supabase
 * intends to ship in client bundles.
 *
 * The `service_role` key is the dangerous one. It bypasses RLS entirely.
 * Never put it here, in any other file in this repo, or in a Vercel
 * environment variable that the client build can read.
 *
 * Values can also come from build-time env vars, which is the better route if
 * you would rather not have them in git at all: set VITE_SUPABASE_URL and
 * VITE_SUPABASE_ANON_KEY in your Vercel project settings and leave the
 * literals below empty.
 */

export const CLOUD_CONFIG = {
  // Prefer the env var when present; fall back to the literal below.
  url: import.meta.env?.VITE_SUPABASE_URL ?? 'https://thrqmpcvztmqjylyzsxd.supabase.co',
  anonKey: import.meta.env?.VITE_SUPABASE_ANON_KEY
    ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRocnFtcGN2enRtcWp5bHl6c3hkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc3MDkyMjYsImV4cCI6MjEwMzI4NTIyNn0.SMnVbyHdFDkmq92Pf-bGxjznE2_IEoGppbVOAZSvdvk',
};

/** True once both values are present. Everything cloud-related checks this. */
export function cloudConfigured() {
  return typeof CLOUD_CONFIG.url === 'string' && CLOUD_CONFIG.url !== ''
    && typeof CLOUD_CONFIG.anonKey === 'string' && CLOUD_CONFIG.anonKey !== '';
}
