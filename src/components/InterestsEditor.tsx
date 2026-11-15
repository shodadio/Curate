import { useState } from 'react';
import { Plus, Sparkles, X } from 'lucide-react';
import {
  MAX_INTERESTS,
  addInterest,
  removeInterest,
  type InterestGroup,
  type InterestSet,
} from '../interests';

interface InterestsEditorProps {
  value: InterestSet;
  suggestions: string[];
  onChange: (next: InterestSet) => void;
}

const CHIP_TONE: Record<InterestGroup, string> = {
  more: 'border-amber-500/30 bg-amber-500/10 text-amber-200 hover:border-amber-400/60',
  less: 'border-rose-500/25 bg-rose-500/10 text-rose-200 hover:border-rose-400/50',
};

function InterestRow({
  group,
  title,
  hint,
  summary,
  value,
  suggestions,
  onChange,
}: {
  group: InterestGroup;
  title: string;
  hint: string;
  summary: string;
  value: InterestSet;
  suggestions: string[];
  onChange: (next: InterestSet) => void;
}) {
  const [draft, setDraft] = useState('');
  const items = value[group];
  const atCap = items.length >= MAX_INTERESTS;

  const commit = () => {
    const next = addInterest(value, group, draft);
    if (next !== value) onChange(next);
    setDraft('');
  };

  const unusedSuggestions = suggestions
    .filter(label => ![...value.more, ...value.less].some(used => used.toLowerCase() === label.toLowerCase()))
    .slice(0, 6);

  return (
    <div className="space-y-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <h4 className="text-xs font-semibold text-slate-200">{title}</h4>
          <p className="text-[11px] text-slate-500 mt-0.5">{summary}</p>
        </div>
        <span className="text-[10px] font-mono text-slate-600 shrink-0">
          {items.length}/{MAX_INTERESTS}
        </span>
      </div>

      {items.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {items.map(label => (
            <button
              key={label}
              type="button"
              onClick={() => onChange(removeInterest(value, group, label))}
              className={`inline-flex items-center gap-1.5 px-2.5 py-2 rounded-xl border text-[11px] font-medium transition cursor-pointer ${CHIP_TONE[group]}`}
              title={`Remove ${label}`}
            >
              <span>{label}</span>
              <X className="w-3 h-3 opacity-70" />
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          type="text"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
          }}
          placeholder={hint}
          disabled={atCap}
          maxLength={40}
          className="flex-1 min-w-0 rounded-xl bg-slate-950 border border-slate-800 px-3 py-2.5 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-amber-500 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={commit}
          disabled={atCap || !draft.trim()}
          className="px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs font-medium text-slate-300 hover:text-slate-100 hover:border-slate-700 transition disabled:opacity-40 flex items-center gap-1.5 shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add</span>
        </button>
      </div>

      {unusedSuggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] text-slate-600">From your folders:</span>
          {unusedSuggestions.map(label => (
            <button
              key={label}
              type="button"
              onClick={() => onChange(addInterest(value, group, label))}
              className="text-[10px] px-2 py-1.5 rounded-lg text-slate-400 border border-slate-800 hover:text-slate-200 hover:border-slate-700 transition"
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function InterestsEditor({ value, suggestions, onChange }: InterestsEditorProps) {
  return (
    <div className="p-6 rounded-3xl bg-slate-900/40 border border-slate-900 space-y-5">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0">
          <Sparkles className="w-4 h-4 text-amber-400" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-slate-200">Interests</h3>
          <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
            What you want more or less of. These nudge the ranking of your digest — they never hide your feeds.
            A chip matches its exact words in a title, summary or folder, so “AI” and “Artificial Intelligence”
            are different matches. Your votes keep teaching the profile, and Serendipity still pulls in the unexpected.
          </p>
        </div>
      </div>

      <InterestRow
        group="more"
        title="More of this"
        summary="Lifted in the ranking of today's digest."
        hint="e.g. Artificial Intelligence"
        value={value}
        suggestions={suggestions}
        onChange={onChange}
      />

      <div className="border-t border-slate-900" />

      <InterestRow
        group="less"
        title="Less of this"
        summary="Down-weighted, not removed."
        hint="e.g. Celebrity news"
        value={value}
        suggestions={suggestions}
        onChange={onChange}
      />
    </div>
  );
}
