import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import fs from 'node:fs';
import path from 'path';
import { execSync } from 'node:child_process';
import {defineConfig, type Plugin, type ResolvedConfig} from 'vite';
import { BUILD_INFO_FILE, commitFromEnv, noteFromEnv } from './lib/buildInfo.ts';
import type { BuildStampInfo } from './lib/buildStamp.ts';

// Keep the full Git SHA when the build host provides it, so it can be compared with main in GitHub.
// A build without Git history is identified separately by a source-snapshot id.
const envCommit = commitFromEnv();
const commit = /^[0-9a-f]{40}$/i.test(envCommit)
  ? envCommit.toLowerCase()
  : (() => {
      try {
        const value = execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
        return /^[0-9a-f]{40}$/i.test(value) ? value.toLowerCase() : '';
      } catch {
        return '';
      }
    })();
const buildId = commit
  ? commit.slice(0, 7)
  : (process.env.SOURCE_BUILD_ID || envCommit).trim().slice(0, 7);

// The repository this bundle came from, so the stamp in Settings names its source as well
// as its version. A GitHub build supplies this; local builds fall back to the project repo.
const repository = process.env.GITHUB_REPOSITORY || 'shodadio/Curate';

// The server cannot read .git and cannot see build args, so the build leaves its identity next
// to the bundle. GET /api/version reads this file.
function writeBuildInfo(info: BuildStampInfo): Plugin {
  let outDir = '';
  return {
    name: 'curator-build-info',
    apply: 'build',
    configResolved(config: ResolvedConfig) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      if (!outDir) return;
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, BUILD_INFO_FILE), `${JSON.stringify(info, null, 2)}\n`);
    },
  };
}

export default defineConfig(({ command }) => {
  // A build without either a Git SHA or a source snapshot id cannot be identified after deploy.
  if (command === 'build' && !buildId) {
    console.warn(
      '\n\x1b[1;31m[Curator build] No build identity found.\x1b[0m\n' +
        '  Pass SOURCE_COMMIT=<full-sha>, build from a checkout with .git, or set SOURCE_BUILD_ID.\n'
    );
  }
  const buildInfo: BuildStampInfo = {
    commit,
    buildId,
    builtAt: new Date().toISOString(),
    repo: repository,
    note: noteFromEnv(),
  };
  return {
    define: {
      __BUILD_INFO__: JSON.stringify(buildInfo),
    },
    plugins: [
      react(),
      tailwindcss(),
      writeBuildInfo(buildInfo),
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
