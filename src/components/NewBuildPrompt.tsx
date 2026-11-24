import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';

import { isNewerBuild, type BuildStampInfo } from '../../lib/buildStamp';
import { fetchServerBuild, reloadWithLatestBuild } from '../buildUpdate';

// Installed apps keep the shell their service worker precached, so a deploy can go unnoticed
// for days. Offer one tap to switch when the server reports a newer build. No polling loop: check
// on first load and whenever the app returns to foreground.
const FIRST_CHECK_MS = 1500;
const CHECK_INTERVAL_MS = 60_000;

export function NewBuildPrompt() {
  const [newer, setNewer] = useState<BuildStampInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const dismissedRef = useRef('');
  const checkedAtRef = useRef(0);

  const check = useCallback(async () => {
    const now = Date.now();
    if (now - checkedAtRef.current < CHECK_INTERVAL_MS) return;
    checkedAtRef.current = now;
    // Offline, or an older server without the route, leaves nothing to compare.
    const report = await fetchServerBuild();
    if (!report || !isNewerBuild(__BUILD_INFO__, report)) return;
    if (dismissedRef.current === (report.commit || report.builtAt)) return;
    setNewer(report);
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(check, FIRST_CHECK_MS);
    const onForeground = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onForeground);
    window.addEventListener('focus', onForeground);
    window.addEventListener('pageshow', onForeground);
    return () => {
      window.clearTimeout(initial);
      document.removeEventListener('visibilitychange', onForeground);
      window.removeEventListener('focus', onForeground);
      window.removeEventListener('pageshow', onForeground);
    };
  }, [check]);

  const dismiss = () => {
    dismissedRef.current = newer ? newer.commit || newer.builtAt : '';
    setNewer(null);
  };

  const applyUpdate = async () => {
    setBusy(true);
    await reloadWithLatestBuild();
  };

  if (!newer) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed safe-update left-1/2 z-[60] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2"
    >
      <div className="flex items-center gap-2 rounded-xl border border-[#1c1a17]/30 bg-[#1c1a17] px-3 py-2 text-xs text-[#f6f1e7] shadow-2xl animate-fade-in">
        <RefreshCw className="h-3.5 w-3.5 shrink-0" />
        <div className="min-w-0 flex-1 leading-tight">
          <span className="block">A newer build is ready.</span>
          {newer.note ? (
            <span className="mt-0.5 line-clamp-2 block text-[11px] opacity-70">{newer.note}</span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={applyUpdate}
          disabled={busy}
          className="inline-flex min-h-8 shrink-0 items-center justify-center rounded-lg border border-[#f6f1e7]/40 bg-transparent px-2.5 text-[11px] font-semibold transition hover:bg-[#f6f1e7]/15 disabled:opacity-60 cursor-pointer"
        >
          {busy ? 'Updating…' : 'Reload'}
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss update notice"
          className="shrink-0 rounded-md p-1 opacity-60 transition hover:opacity-100 cursor-pointer"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
