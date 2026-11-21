// What build a running server is serving. Vite stamps the client bundle; this module lets the
// server answer the same question from the file the build writes next to the bundle.
import fs from 'node:fs';
import path from 'node:path';

import { buildVersion, formatBuildStamp, normalizeNote, type BuildStampInfo } from './buildStamp.ts';

export const BUILD_INFO_FILE = 'build-info.json';
export const DEFAULT_REPO = 'shodadio/Curate';

// Shared with vite.config.ts. Docker images can drop .git, so the commit also comes from
// whichever host variable is set — the first one below wins, and SOURCE_COMMIT remains the
// documented override.
export const commitEnvNames = [
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

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

// A half-written or hand-edited file must neither crash the server nor let it claim a version
// it cannot back up. Missing fields are allowed; a file with no version at all is not.
export function parseBuildInfo(raw: string): BuildStampInfo | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const commit = text(record.commit);
  const builtAt = text(record.builtAt);
  if (!commit && !builtAt) return null;
  return { commit, builtAt, repo: text(record.repo) || DEFAULT_REPO, note: normalizeNote(record.note) };
}

export function readBuildInfo(distDir: string): BuildStampInfo | null {
  try {
    return parseBuildInfo(fs.readFileSync(path.join(distDir, BUILD_INFO_FILE), 'utf8'));
  } catch {
    return null;
  }
}

export interface VersionReport extends BuildStampInfo {
  version: string;
  stamp: string;
}

// One JSON object that answers "what is live?": the short version to match against a commit,
// and the same line Settings shows.
export function versionReport(info: BuildStampInfo): VersionReport {
  const report = {
    commit: text(info.commit),
    builtAt: text(info.builtAt),
    repo: text(info.repo) || DEFAULT_REPO,
    note: normalizeNote(info.note),
  };
  return { ...report, version: buildVersion(report), stamp: formatBuildStamp(report) };
}
