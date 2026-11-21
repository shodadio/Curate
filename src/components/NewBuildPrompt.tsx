import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';

import { isNewerBuild, normalizeNote, type BuildStampInfo } from '../../lib/buildStamp';

// Installed apps keep the shell their service worker precached, so a deploy can go unnoticed
// for days. The server names the build it is running at /api/version; when that is later than
// this bundle, offer one tap to switch. No polling loop: a check on first load and whenever
// the app comes back to the foreground is enough.
const FIRST_CHECK_MS = 1500;
const CHECK_INTERVAL_MS = 60_000;

function reportFrom(value: unknown): BuildStampInfo | null {
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

export function NewBuildPrompt() {
  const [newer, setNewer] = useState<BuildStampInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const dismissedRef = useRef('');
  const checkedAtRef = useRef(0);

  const check = useCallback(async () => {
    const now = Date.now();
    if (now - checkedAtRef.current < CHECK_INTERVAL_MS) return;
    checkedAtRef.current = now;
    try {
      const response = await fetch('/api/version', {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) return;
      // A server from before this route can answer with the app shell instead of JSON.
      if (!(response.headers.get('content-type') || '').includes('application/json')) return;
      const report = reportFrom(await response.json());
      if (!report || !isNewerBuild(__BUILD_INFO__, report)) return;
      if (dismissedRef.current === (report.commit || report.builtAt)) return;
      setNewer(report);
    } catch {
      // Offline, or an older server without the route: nothing to compare.
    }
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
    // The old worker would serve its precached shell again, so release it before reloading.
    try {
      const registrations = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
      await Promise.all(registrations.map((registration) => registration.unregister()));
    } catch {
      // Reload anyway; if the old bundle comes back the prompt returns.
    }
    window.location.reload();
  };

  if (!newer) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed safe-update left-1/2 z-[60] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2"
    >
      <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-slate-900/95 px-3 py-2 text-xs text-slate-200 shadow-2xl backdrop-blur-md animate-fade-in">
        <RefreshCw className="h-3.5 w-3.5 shrink-0 text-amber-400" />
        <div className="min-w-0 flex-1 leading-tight">
          <span className="block">A newer build is ready.</span>
          {newer.note ? (
            <span className="mt-0.5 line-clamp-2 block text-[11px] text-slate-400">{newer.note}</span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={applyUpdate}
          disabled={busy}
          className="inline-flex min-h-8 shrink-0 items-center justify-center rounded-lg border border-amber-500/40 bg-amber-500/20 px-2.5 text-[11px] font-semibold text-amber-300 transition hover:bg-amber-500/30 disabled:opacity-60 cursor-pointer"
        >
          {busy ? 'Updating…' : 'Reload'}
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss update notice"
          className="shrink-0 rounded-md p-1 text-slate-500 transition hover:text-slate-300 cursor-pointer"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
