import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';
import { execSync } from 'node:child_process';
import {defineConfig} from 'vite';

// Which build a device is running: the commit it came from, when it was made. Docker images
// exclude .git, so the commit also comes from whichever host variable is set — the first one
// below wins, and SOURCE_COMMIT remains the documented override.
const commitEnvNames = [
  'SOURCE_COMMIT',         // Docker --build-arg, the documented override
  'GITHUB_SHA',            // GitHub Actions
  'CI_COMMIT_SHA',         // GitLab CI
  'COMMIT_SHA',            // Cloud Build (what AI Studio deploys run on)
  'SHORT_SHA',             // Cloud Build
  'COMMIT_REF',            // Netlify
  'VERCEL_GIT_COMMIT_SHA', // Vercel
  'RENDER_GIT_COMMIT',     // Render
  'RAILWAY_GIT_COMMIT_SHA',// Railway
  'CF_PAGES_COMMIT_SHA',   // Cloudflare Pages
  'WORKERS_CI_COMMIT_SHA', // Cloudflare Workers Builds
  'HEROKU_SLUG_COMMIT',    // Heroku
  'BITBUCKET_COMMIT',      // Bitbucket Pipelines
  'CIRCLE_SHA1',           // CircleCI
  'TRAVIS_COMMIT',         // Travis CI
  'BUILDKITE_COMMIT',      // Buildkite
  'DRONE_COMMIT_SHA',      // Drone
  'GIT_COMMIT',            // generic CI
  'GIT_COMMIT_SHA',        // generic CI
] as const;

const commitFromEnv = commitEnvNames
  .map(name => (process.env[name] || '').trim())
  .find(Boolean) || '';

const shortCommit = (() => {
  if (commitFromEnv) return commitFromEnv.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
})();

// The repository this bundle came from, so the stamp in Settings names its source as well
// as its version. A GitHub build supplies this; local builds fall back to the project repo.
const repository = process.env.GITHUB_REPOSITORY || 'shodadio/Curate';

export default defineConfig(({ command }) => {
  // A version-less stamp is a support problem: a phone cannot say which build it runs.
  // Say so where the operator will see it, before the bundle is written.
  if (command === 'build' && !shortCommit) {
    console.warn(
      '\n\x1b[1;31m[Curator build] No commit found for the build stamp.\x1b[0m\n' +
        '  Settings will show a generated build id instead of a version.\n' +
        '  Pass SOURCE_COMMIT=<sha>, or build from a checkout with .git, to stamp the real commit.\n'
    );
  }
  return {
    define: {
      __BUILD_INFO__: JSON.stringify({ commit: shortCommit, builtAt: new Date().toISOString(), repo: repository }),
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
