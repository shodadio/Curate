import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';
import { execSync } from 'node:child_process';
import {defineConfig} from 'vite';

// Which build a device is running: the commit it came from, when it was made. Docker images
// exclude .git, so a deploy can pass the commit in through SOURCE_COMMIT (or GITHUB_SHA) —
// the build time alone still tells one deploy from another.
// Cloud Build (what AI Studio deploys run on) supplies COMMIT_SHA and SHORT_SHA on its own.
const commitFromEnv = process.env.SOURCE_COMMIT
  || process.env.SHORT_SHA
  || process.env.COMMIT_SHA
  || process.env.GITHUB_SHA
  || process.env.GIT_COMMIT
  || '';
const shortCommit = (() => {
  if (commitFromEnv.trim()) return commitFromEnv.trim().slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
})();

export default defineConfig(() => {
  return {
    define: {
      __BUILD_INFO__: JSON.stringify({ commit: shortCommit, builtAt: new Date().toISOString() }),
    },
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'fonts/*.woff2'],
        manifest: {
          id: '/',
          name: 'Curator — Daily Curated Reading Digest',
          short_name: 'Curator',
          description: 'A daily curated reading digest — your personal editor.',
          // Keep the manifest in step with the app's own background and <meta name="theme-color">
          theme_color: '#020617',
          background_color: '#020617',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        devOptions: {
          enabled: true,
          type: 'module',
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio cloud iframe environment to prevent WebSocket closed errors.
      hmr: false,
      allowedHosts: ['thecurator.ai.studio', '.ai.studio', '.run.app', 'localhost', '127.0.0.1'],
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
