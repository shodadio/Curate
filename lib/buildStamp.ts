// The line Settings shows under the build: the repository, the version and when it was built.
// Kept free of React so the formatting can be unit-tested.

export interface BuildStampInfo {
  commit: string;
  builtAt: string;
  repo: string;
  // Optional one line about what changed, shown in the update notice.
  note?: string;
}

export const NOTE_MAX_LENGTH = 120;

// A release note is a single short line. Folding it to one line keeps the notice one tap tall,
// and the cut keeps a long changelog from turning it into a paragraph.
export function normalizeNote(value: unknown): string {
  if (typeof value !== 'string') return '';
  const line = value.replace(/\s+/g, ' ').trim();
  if (line.length <= NOTE_MAX_LENGTH) return line;
  return `${line.slice(0, NOTE_MAX_LENGTH - 1).trimEnd()}…`;
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

// The client's copy of a GET /api/version body. A reply that names no build at all is no report:
// there is nothing to compare it with, and treating it as one would make an unstamped server
// look current.
export function parseVersionReport(value: unknown): BuildStampInfo | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const commit = typeof record.commit === 'string' ? record.commit.trim() : '';
  const builtAt = typeof record.builtAt === 'string' ? record.builtAt.trim() : '';
  if (!commit && !builtAt) return null;
  return {
    commit,
    builtAt,
    repo: typeof record.repo === 'string' ? record.repo : '',
    note: normalizeNote(record.note),
  };
}

// Whether the server is running a later build than the bundle on this device. The note is not
// part of the comparison, so changed wording alone never offers an update. Build time is the
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
