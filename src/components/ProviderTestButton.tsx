import { useEffect, useState } from 'react';
import { Check, RefreshCw, X } from 'lucide-react';

type TestStatus =
  | { state: 'idle' }
  | { state: 'running' }
  | { state: 'ok'; message: string }
  | { state: 'failed'; message: string };

interface ProviderTestButtonProps {
  kind: 'chat' | 'embedding';
  provider: string;
  apiKey: string;
  baseUrl?: string;
  model: string;
  disabled?: boolean;
}

// A one-request ping for the API settings panel: it asks the server to make a minimal
// call with exactly the configuration shown on screen, so a wrong key, URL or model is
// reported here instead of being swallowed by the silent fallback during a digest.
export function ProviderTestButton({
  kind,
  provider,
  apiKey,
  baseUrl = '',
  model,
  disabled = false,
}: ProviderTestButtonProps) {
  const [status, setStatus] = useState<TestStatus>({ state: 'idle' });

  // Any edit to the configuration invalidates the last result.
  useEffect(() => {
    setStatus({ state: 'idle' });
  }, [kind, provider, apiKey, baseUrl, model]);

  const runTest = async () => {
    setStatus({ state: 'running' });
    try {
      const res = await fetch('/api/test-provider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, provider, apiKey, baseUrl, model }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        setStatus({
          state: 'failed',
          message: String(data?.error || `Test failed (HTTP ${res.status}).`),
        });
        return;
      }
      const latencyMs = Number(data.latencyMs) || 0;
      const detail = kind === 'chat'
        ? (data.reply ? `replied “${String(data.reply).trim().slice(0, 60)}”` : 'answered the request')
        : `returned a ${Number(data.dimensions) || 0}-dimension vector`;
      setStatus({ state: 'ok', message: `${detail} in ${latencyMs} ms.` });
    } catch {
      setStatus({ state: 'failed', message: "Could not reach this app's server." });
    }
  };

  const running = status.state === 'running';

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={runTest}
        disabled={disabled || running}
        className="px-3 py-2 rounded-xl bg-transparent border border-[#c9bc9f] text-xs font-medium text-[#1c1a17] hover:border-[#1c1a17] transition disabled:opacity-50 flex items-center gap-1.5"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${running ? 'animate-spin' : ''}`} />
        <span>{running ? 'Testing…' : 'Test API'}</span>
      </button>

      {status.state === 'ok' && (
        <p className="text-xs text-[#1c1a17] font-medium flex items-start gap-1.5">
          <Check className="w-3 h-3 mt-0.5 shrink-0" strokeWidth={3} />
          <span>Passed — {status.message}</span>
        </p>
      )}

      {status.state === 'failed' && (
        <p className="text-xs text-[#1c1a17] font-medium flex items-start gap-1.5">
          <X className="w-3 h-3 mt-0.5 shrink-0" strokeWidth={3} />
          <span>Failed — {status.message}</span>
        </p>
      )}
    </div>
  );
}
