export interface BuildStampInfo {
  // A real Git commit SHA, when the build context knows one.
  commit: string;
  // A source snapshot id when the build has no Git history, or the short commit id otherwise.
  buildId: string;
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

export function shortCommitId(commit: string): string {
  return commit.trim().slice(0, 7);
}

export function formatBuildStamp(info: Pick<BuildStampInfo, 'commit' | 'buildId'>): string {
  if (info.commit.trim()) return `Build · ${shortCommitId(info.commit)}`;
  if (info.buildId.trim()) return `Source snapshot · ${shortCommitId(info.buildId)}`;
  return 'Build identity unavailable';
}

export function parseBuildStamp(value: unknown): BuildStampInfo | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const commit = typeof record.commit === 'string' ? record.commit.trim() : '';
  const buildId = typeof record.buildId === 'string' ? record.buildId.trim() : '';
  const builtAt = typeof record.builtAt === 'string' ? record.builtAt.trim() : '';
  if (!commit && !buildId && !builtAt) return null;
  return {
    commit,
    buildId: buildId || shortCommitId(commit),
    builtAt,
    repo: typeof record.repo === 'string' ? record.repo.trim() : '',
    note: normalizeNote(record.note),
  };
}

// The automatic update notice compares this device's bundle with the server's bundle.
export function isNewerBuild(app: BuildStampInfo, server: BuildStampInfo): boolean {
  const appAt = Date.parse(app.builtAt || '');
  const serverAt = Date.parse(server.builtAt || '');
  if (Number.isFinite(appAt) && Number.isFinite(serverAt)) return serverAt > appAt;
  const appId = (app.commit || app.buildId || '').trim();
  const serverId = (server.commit || server.buildId || '').trim();
  return Boolean(appId && serverId && appId !== serverId);
}
