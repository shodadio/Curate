import { useEffect, useId, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { ModelCatalogOption } from '../../lib/modelCatalog';

const MODEL_PRICE_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumSignificantDigits: 3,
});

function modelPriceLabel(model: ModelCatalogOption): string {
  if (model.promptPerMillion === undefined || model.completionPerMillion === undefined) return '';
  const input = MODEL_PRICE_FORMATTER.format(model.promptPerMillion);
  const output = MODEL_PRICE_FORMATTER.format(model.completionPerMillion);
  return ` · ${input} in / ${output} out per 1M tokens`;
}

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
  const pickerId = useId();
  const [models, setModels] = useState<ModelCatalogOption[]>([]);
  const [status, setStatus] = useState<{ tone: 'idle' | 'failed'; message: string }>({ tone: 'idle', message: '' });
  const [fetching, setFetching] = useState(false);
  const requestController = useRef<AbortController | null>(null);
  const requestSequence = useRef(0);

  // A different service, URL or key belongs to a different catalogue. Cancel the old request
  // too, so a slow response cannot put models for the old service back in this picker.
  useEffect(() => {
    requestSequence.current += 1;
    requestController.current?.abort();
    requestController.current = null;
    setModels([]);
    setFetching(false);
    setStatus({ tone: 'idle', message: '' });
  }, [provider, baseUrl, apiKey, kind]);

  useEffect(() => () => {
    requestSequence.current += 1;
    requestController.current?.abort();
  }, []);

  const canFetch = provider === 'openai-compatible';

  const fetchModels = async () => {
    requestController.current?.abort();
    const controller = new AbortController();
    const requestId = ++requestSequence.current;
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 35_000);
    requestController.current = controller;
    setFetching(true);
    setStatus({ tone: 'idle', message: '' });
    try {
      const response = await fetch('/api/list-models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, apiKey, baseUrl, kind }),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (requestId !== requestSequence.current) return;
      if (!response.ok || !data?.ok) {
        setModels([]);
        setStatus({
          tone: 'failed',
          message: String(data?.error || `Could not load models (HTTP ${response.status}).`),
        });
        return;
      }

      const all: ModelCatalogOption[] = Array.isArray(data?.modelOptions)
        ? data.modelOptions.filter((model: any) => model && typeof model.id === 'string' && model.id.trim())
        : Array.isArray(data?.models)
          ? data.models.map((id: unknown) => ({ id: String(id) }))
          : [];
      // Some compatible providers do not identify embedding models; preserve their full list
      // rather than hiding every option when the catalogue has no embedding IDs.
      const embeddingModels = kind === 'embedding' && data?.source !== 'openrouter'
        ? all.filter(model => /embed/i.test(model.id))
        : [];
      const narrowed = embeddingModels.length > 0;
      const list = narrowed ? embeddingModels : all;
      setModels(list);
      const noun = kind === 'embedding' && (narrowed || data?.source === 'openrouter') ? 'embedding model' : 'model';
      const ordering = data?.source === 'openrouter' && kind === 'chat' ? ', lowest-cost first' : '';
      setStatus({
        tone: list.length === 0 ? 'failed' : 'idle',
        message: list.length === 0
          ? 'The provider returned no usable models. Check the URL and model permissions.'
          : `${list.length} ${noun}${list.length === 1 ? '' : 's'} fetched${ordering} — choose one below, or keep typing an ID.`,
      });
    } catch {
      if (requestId !== requestSequence.current) return;
      setModels([]);
      setStatus({
        tone: 'failed',
        message: timedOut
          ? 'Fetching models timed out. Check the provider URL and try again.'
          : "Could not reach this app's server. Try again in a moment.",
      });
    } finally {
      window.clearTimeout(timeout);
      if (requestId === requestSequence.current) {
        requestController.current = null;
        setFetching(false);
      }
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <label htmlFor={inputId} className="block text-xs font-medium text-[#1c1a17]">{label}</label>
        {canFetch && (
          <button
            type="button"
            onClick={() => void fetchModels()}
            disabled={fetching}
            className="shrink-0 flex items-center gap-1 text-xs font-semibold text-[#1c1a17] underline underline-offset-2 hover:no-underline transition disabled:opacity-50"
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
        autoComplete="off"
        spellCheck={false}
                  className="w-full bg-[#fffdf7] border border-[#c9bc9f] rounded-xl px-3 py-2 text-xs text-[#1c1a17] font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8a5a24]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#f6f1e7] focus:border-[#8a5a24]"
      />

      {/* A real picker, not a type-ahead: browsers keep a datalist's options hidden until you
          type, so the fetched list looked like it had never arrived. */}
      {models.length > 0 && (
        <select
          id={pickerId}
          value={models.some(model => model.id === value) ? value : ''}
          onChange={event => { if (event.target.value) onChange(event.target.value); }}
          aria-label={`${label}: fetched models`}
          className="mt-1.5 w-full bg-[#fffdf7] border border-[#c9bc9f] rounded-xl px-3 py-2 text-xs text-[#1c1a17] font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8a5a24]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#f6f1e7] focus:border-[#8a5a24] cursor-pointer"
        >
          <option value="">
            {`Choose from ${models.length} fetched model${models.length === 1 ? '' : 's'}`}
          </option>
          {models.map(model => (
            <option key={model.id} value={model.id}>{`${model.id}${modelPriceLabel(model)}`}</option>
          ))}
        </select>
      )}

      {status.message && (
        <p className={`text-xs mt-1 ${status.tone === 'failed' ? 'text-[#1c1a17] font-semibold' : 'text-[#6f675c]'}`}>
          {status.message}
        </p>
      )}
    </div>
  );
}
