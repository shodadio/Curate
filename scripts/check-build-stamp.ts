// Release gate: a build must record either its Git commit or a distinct source snapshot id.
import { BUILD_INFO_FILE, readBuildInfo } from '../lib/buildInfo.ts';

const distDir = process.argv[2] || 'dist';
const info = readBuildInfo(distDir);

if (!info) {
  console.error(
    `No readable ${BUILD_INFO_FILE} in ${distDir}/ — the build could not record its identity.`
  );
  process.exit(1);
}

const identity = info.commit ? `commit ${info.commit}` : info.buildId ? `source snapshot ${info.buildId}` : '';
if (!identity) {
  console.error(
    `The build in ${distDir}/ has no commit or source snapshot id (builtAt: ${info.builtAt || 'unset'}). Pass SOURCE_COMMIT=<full-sha>, SOURCE_BUILD_ID=<id>, or build from a checkout with .git.`
  );
  process.exit(1);
}

console.log(
  `Build records ${identity}${info.builtAt ? `, built ${info.builtAt}` : ''} — ${distDir}/${BUILD_INFO_FILE}`
);
