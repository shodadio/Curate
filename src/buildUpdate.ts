// Ask the server which build it is running so installed apps can offer a newer bundle.
import { parseBuildStamp, type BuildStampInfo } from '../lib/buildStamp';

// The build the server is serving right now, or null when offline or when it has no build metadata.
export async function fetchServerBuild(): Promise<BuildStampInfo | null> {
  try {
    const response = await fetch('/api/version', {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    if (!(response.headers.get('content-type') || '').includes('application/json')) return null;
    return parseBuildStamp(await response.json());
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
