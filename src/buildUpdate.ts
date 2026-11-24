// Shared by the automatic update notice and the manual check in Settings: ask the server which
// build it is running, and switch this device to it.
import { parseVersionReport, type BuildStampInfo } from '../lib/buildStamp';

// The build the server is serving right now, or null when there is nothing to compare: offline,
// a server older than the version route, or a report that names no build.
export async function fetchServerBuild(): Promise<BuildStampInfo | null> {
  try {
    const response = await fetch('/api/version', {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    // A server from before this route can answer with the app shell instead of JSON.
    if (!(response.headers.get('content-type') || '').includes('application/json')) return null;
    return parseVersionReport(await response.json());
  } catch {
    return null;
  }
}

// The old worker would serve its precached shell again, so release it before reloading. A
// failure to unregister is no reason to stay on the old build: reload anyway, and the notice
// returns if the old bundle comes back.
export async function reloadWithLatestBuild(): Promise<void> {
  try {
    const registrations = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
    await Promise.all(registrations.map(registration => registration.unregister()));
  } catch {
    // Reload anyway.
  }
  window.location.reload();
}
