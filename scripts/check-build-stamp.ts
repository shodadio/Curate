// Release gate: a build that cannot name its commit must not ship.
// The build writes its identity next to the bundle for GET /api/version; this reads that file
// and fails the run when the identity is missing or has no commit. Catching it here means a
// deploy is never published that cannot be matched to a commit from the running app.
import { BUILD_INFO_FILE, readBuildInfo } from '../lib/buildInfo.ts';

const distDir = process.argv[2] || 'dist';
const info = readBuildInfo(distDir);

if (!info) {
  console.error(
    `No readable ${BUILD_INFO_FILE} in ${distDir}/ — the build could not name its commit, so the running app could not report which version is live.`
  );
  process.exit(1);
}

if (!info.commit) {
  console.error(
    `The build in ${distDir}/ has no commit (builtAt: ${info.builtAt || 'unset'}). Pass SOURCE_COMMIT=<sha>, or build from a checkout with .git, so the deploy can be matched to a commit.`
  );
  process.exit(1);
}

console.log(
  `Build names ${info.commit}${info.builtAt ? `, built ${info.builtAt}` : ''} — ${distDir}/${BUILD_INFO_FILE}`
);
