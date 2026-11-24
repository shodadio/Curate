// Local build metadata is stored next to the client bundle so Settings and the version endpoint
// can identify the exact build without relying on a runtime GitHub request.
import fs from 'node:fs';
import path from 'node:path';

import { normalizeNote, parseBuildStamp, type BuildStampInfo } from './buildStamp.ts';

export const BUILD_INFO_FILE = 'build-info.json';
export const DEFAULT_REPO = 'shodadio/Curate';

// The first non-empty value names the commit supplied by a build host. SOURCE_COMMIT remains the
// documented override; full commit hashes are retained in build-info.json.
export const commitEnvNames = [
  'SOURCE_COMMIT',         // Docker --build-arg, the documented override
  'GITHUB_SHA',            // GitHub Actions
  'CI_COMMIT_SHA',         // GitLab CI
  'COMMIT_SHA',            // Cloud Build
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

// The one-line note a release can carry, baked into the build like the commit. Optional: a
// release without one shows the plain "newer build" line.
export function noteFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return normalizeNote(env.RELEASE_NOTE || env.BUILD_NOTE);
}

export function commitFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  for (const name of commitEnvNames) {
    const value = (env[name] || '').trim();
    if (value) return value;
  }
  return '';
}

export function parseBuildInfo(raw: string): BuildStampInfo | null {
  try {
    const parsed = parseBuildStamp(JSON.parse(raw));
    if (!parsed) return null;
    return {
      ...parsed,
      repo: parsed.repo || DEFAULT_REPO,
      note: normalizeNote(parsed.note),
    };
  } catch {
    return null;
  }
}

export function readBuildInfo(distDir: string): BuildStampInfo | null {
  try {
    return parseBuildInfo(fs.readFileSync(path.join(distDir, BUILD_INFO_FILE), 'utf8'));
  } catch {
    return null;
  }
}
