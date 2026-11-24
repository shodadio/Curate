import { useState } from 'react';
import { RefreshCw } from 'lucide-react';

import { formatBuildStamp, isNewerBuild } from '../../lib/buildStamp';
import { fetchServerBuild, reloadWithLatestBuild } from '../buildUpdate';

// The build line in Settings is where a reader works out whether this device is showing the
// latest deploy, so the answer arrives on demand instead of waiting for the automatic notice:
// ask the server which build it is running, and switch to it when it is newer.
type CheckState = 'idle' | 'checking' | 'current' | 'updating' | 'failed';

// A release can carry one line about what changed, the same line the automatic notice shows. The
// reload would take it away before it could be read, so a build that carries one waits a beat.
const NOTE_HOLD_MS = 2500;

const MESSAGES: Record<Exclude<CheckState, 'idle'>, string> = {
  checking: 'Checking the server…',
  current: 'You’re on the latest build.',
  updating: 'A newer build is ready — refreshing…',
  failed: 'Couldn’t check for updates. Try again in a moment.',
};

export function CheckLatestUpdates() {
  const [state, setState] = useState<CheckState>('idle');
  const [note, setNote] = useState('');

  const check = async () => {
    if (state === 'checking' || state === 'updating') return;
    setState('checking');
    setNote('');
    const server = await fetchServerBuild();
    if (!server) {
      setState('failed');
      return;
    }
    if (isNewerBuild(__BUILD_INFO__, server)) {
      const line = server.note || '';
      setNote(line);
      setState('updating');
      if (line) await new Promise(resolve => window.setTimeout(resolve, NOTE_HOLD_MS));
      await reloadWithLatestBuild();
      return;
    }
    setState('current');
  };

  const checking = state === 'checking' || state === 'updating';
  const label = state === 'checking' ? 'Checking…' : state === 'updating' ? 'Updating…' : 'Check latest updates';

  return (
    <div className="flex flex-col items-center gap-2 px-1 pt-1">
      {/* Which build this device is running: the quickest way to tell a stale phone from an
          updated one after a deploy. */}
      <p
        className="select-all text-center text-[0.7rem] text-[#6f675c]"
        title="The version of Curator loaded on this device"
      >
        {formatBuildStamp(__BUILD_INFO__)}
      </p>
      <button
        type="button"
        onClick={() => void check()}
        disabled={checking}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-[#d3c7ae] px-3.5 text-xs font-medium text-[#3f3a33] transition hover:border-[#1c1a17] hover:text-[#1c1a17] disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
      >
        <RefreshCw className={`h-3.5 w-3.5 shrink-0 ${checking ? 'animate-spin' : ''}`} />
        <span>{label}</span>
      </button>
      <p role="status" aria-live="polite" className="min-h-[1em] text-center text-[0.7rem] leading-relaxed text-[#6f675c]">
        {state === 'idle' ? '' : MESSAGES[state]}
      </p>
      {/* What the newer build changed, in the same words the automatic notice carries. */}
      {note ? (
        <p className="line-clamp-2 max-w-xs text-center text-[11px] leading-relaxed text-[#3f3a33]">
          {note}
        </p>
      ) : null}
    </div>
  );
}
