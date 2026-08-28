import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serves a project site under /repo-name/, not the domain
  // root, so that build needs every asset URL prefixed or it 404s on its own
  // JS/CSS. Vercel (and most other static hosts) serve from the root, so
  // they need the opposite. The GH Pages workflow sets GITHUB_PAGES=true for
  // its build step; every other build (npm run dev, npm run build, Vercel's
  // own build) gets the plain root path.
  base: process.env.GITHUB_PAGES === 'true' ? '/fracture/' : '/',
  server: {
    port: 5173,
    open: false,
    // Fail loudly instead of silently hopping to another port, so the URL in
    // your browser is always the right one.
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
  },
});
