import { useEffect, useId, useState } from 'react';
import { RefreshCw } from 'lucide-react';

interface ModelFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  provider: string;
  apiKey: string;
  baseUrl?: string;
  kind: 'chat' | 'embedding';
}

// The model box takes a typed ID and, for OpenAI-compatible services, the provider's own
// catalogue as a picker: "Fetch models" reads {base}/models with the key already typed, so
// nobody has to copy a model ID out of a documentation page and hope it is current.
export function ModelField({
  label,
  value,
  onChange,
  placeholder,
  provider,
  apiKey,
  baseUrl = '',
  kind,
}: ModelFieldProps) {
  const inputId = useId();
  const listId = useId();
  const [models, setModels] = useState<string[]>([]);
  const [status, setStatus] = useState<{ tone: 'idle' | 'failed'; message: string }>({ tone: 'idle', message: '' });
  const [fetching, setFetching] = useState(false);

  // A different service, URL or key belongs to a different catalogue.
  useEffect(() => {
    setModels([]);
    setStatus({ tone: 'idle', message: '' });
  }, [provider, baseUrl, apiKey]);

  const canFetch = provider === 'openai-compatible';

  const fetchModels = async () => {
    setFetching(true);
    setStatus({ tone: 'idle', message: '' });
    try {
      const response = await fetch('/api/list-models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, apiKey, baseUrl }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.ok) {
        setModels([]);
        setStatus({
          tone: 'failed',
          message: String(data?.error || `Could not load models (HTTP ${response.status}).`),
        });
        return;
      }
      const all: string[] = Array.isArray(data?.models) ? data.models.map(String) : [];
      // Matching can only use an embedding model, so narrow to those when the provider marks
      // any; a catalogue that marks none is shown whole rather than emptied.
      const embeddingModels = kind === 'embedding' ? all.filter(id => /embed/i.test(id)) : [];
      const list = embeddingModels.length > 0 ? embeddingModels : all;
      setModels(list);
      setStatus({
        tone: 'idle',
        message: `${list.length} model${list.length === 1 ? '' : 's'} loaded — open the box to choose, or keep typing.`,
      });
    } catch {
      setModels([]);
      setStatus({ tone: 'failed', message: "Could not reach this app's server." });
    } finally {
      setFetching(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <label htmlFor={inputId} className="block text-xs font-medium text-slate-300">{label}</label>
        {canFetch && (
          <button
            type="button"
            onClick={() => void fetchModels()}
            disabled={fetching}
            className="shrink-0 flex items-center gap-1 text-xs font-medium text-amber-300 hover:text-amber-200 transition disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${fetching ? 'animate-spin' : ''}`} />
            <span>{fetching ? 'Fetching…' : models.length > 0 ? 'Fetch again' : 'Fetch models'}</span>
          </button>
        )}
      </div>

      <input
        id={inputId}
        type="text"
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        list={models.length > 0 ? listId : undefined}
        autoComplete="off"
        spellCheck={false}
        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 focus:border-amber-500"
      />

      {models.length > 0 && (
        <datalist id={listId}>
          {models.map(model => <option key={model} value={model} />)}
        </datalist>
      )}

      {status.message && (
        <p className={`text-xs mt-1 ${status.tone === 'failed' ? 'text-rose-400' : 'text-slate-400'}`}>
          {status.message}
        </p>
      )}
    </div>
  );
}
