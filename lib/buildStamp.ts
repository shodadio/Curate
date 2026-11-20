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

// Every result names a version. The branch that lacks a commit is the build's last line of
// defence, not a normal path: Settings must never read "Built <time>" with nothing to pin it to.
export function formatBuildStamp(info: BuildStampInfo): string {
  const repo = (info.repo || '').trim();
  const commit = (info.commit || '').trim();
  const when = whenText(info.builtAt);
  const version = commit
    ? (when ? `Build ${commit} · ${when}` : `Build ${commit}`)
    : `Build ${generatedVersion(info.builtAt)}`;
  return repo ? `${repo} · ${version}` : version;
}
