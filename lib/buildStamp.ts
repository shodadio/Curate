// The line Settings shows under the build: the repository, the version and when it was built.
// Kept free of React so the formatting can be unit-tested.

export interface BuildStampInfo {
  commit: string;
  builtAt: string;
  repo: string;
}

function whenText(builtAt: string): string {
  const at = new Date(builtAt);
  if (Number.isNaN(at.getTime())) return '';
  return at.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// A build that could not name its commit still gets a version from the moment it was made.
// UTC keeps the same build readable as the same id on every machine.
function generatedVersion(builtAt: string): string {
  const at = new Date(builtAt);
  if (Number.isNaN(at.getTime())) return 'unstamped';
  const iso = at.toISOString();
  return `${iso.slice(0, 10).replace(/-/g, '.')}-${iso.slice(11, 13)}${iso.slice(14, 16)}`;
}

// The identifier inside the stamp: the commit when the build knew it, otherwise the generated
// build id. Settings and the version route must name the same version.
export function buildVersion(info: BuildStampInfo): string {
  const commit = (info.commit || '').trim();
  return commit || generatedVersion(info.builtAt);
}

// Whether the server is running a later build than the bundle on this device. Build time is the
// reliable direction: a rollback reports a different commit but an older time, and no prompt
// should push a reader onto it.
export function isNewerBuild(app: BuildStampInfo, server: BuildStampInfo): boolean {
  const appAt = Date.parse(app.builtAt || '');
  const serverAt = Date.parse(server.builtAt || '');
  if (Number.isFinite(appAt) && Number.isFinite(serverAt)) return serverAt > appAt;
  const appCommit = (app.commit || '').trim();
  const serverCommit = (server.commit || '').trim();
  return Boolean(appCommit && serverCommit && appCommit !== serverCommit);
}

// Every result names a version. The branch that lacks a commit is the build's last line of
// defence, not a normal path: Settings must never read "Built <time>" with nothing to pin it to.
export function formatBuildStamp(info: BuildStampInfo): string {
  const repo = (info.repo || '').trim();
  const commit = (info.commit || '').trim();
  const when = whenText(info.builtAt);
  const version = commit && when ? `Build ${commit} · ${when}` : `Build ${buildVersion(info)}`;
  return repo ? `${repo} · ${version}` : version;
}
