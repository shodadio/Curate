import { formatBuildStamp } from '../../lib/buildStamp';

const GITHUB_REPO_URL = 'https://github.com/shodadio/Curate';

function formattedBuildTime(value: string): string {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
        timeZoneName: 'short',
      }).format(timestamp)
    : '';
}

// This stamp identifies the bundled build. A full commit can be compared with GitHub main;
// source snapshot ids identify builds without Git history and are not commit SHAs.
export function BuildIdentity() {
  const info = __BUILD_INFO__;
  const title = info.commit
    ? `${info.repo}@${info.commit}`
    : `${info.repo} source snapshot ${info.buildId || 'unavailable'}`;
  const builtAt = formattedBuildTime(info.builtAt);
  const compareUrl = info.commit
    ? `${GITHUB_REPO_URL}/compare/${info.commit}...main`
    : `${GITHUB_REPO_URL}/commits/main`;

  return (
    <div className="flex flex-col items-center gap-1 px-1 pt-1">
      <p className="text-center text-[0.7rem] text-[#6f675c]" title={title}>
        {formatBuildStamp(info)}
      </p>
      {info.commit ? (
        <p className="max-w-full break-all text-center font-mono text-[0.65rem] text-[#6f675c] select-all">
          {info.commit}
        </p>
      ) : (
        <p className="text-center text-[0.65rem] text-[#6f675c]">
          Snapshot IDs cannot be compared directly with commit SHAs.
        </p>
      )}
      {builtAt ? (
        <p className="text-center text-[0.7rem] text-[#6f675c]">Built {builtAt}</p>
      ) : null}
      <a
        href={compareUrl}
        target="_blank"
        rel="noreferrer"
        className="text-center text-[0.7rem] text-[#6f675c] underline underline-offset-2 hover:text-[#1c1a17]"
      >
        {info.commit ? 'Compare this commit with GitHub main' : 'View GitHub main'}
      </a>
    </div>
  );
}
