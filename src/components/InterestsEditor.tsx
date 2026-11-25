import { useState } from 'react';
import { Plus, X } from 'lucide-react';
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
  more: 'border-[#c9bc9f] bg-[#ece4d1] text-[#1c1a17] hover:border-[#1c1a17]',
  less: 'border-[#c9bc9f] bg-transparent text-[#3f3a33] hover:border-[#1c1a17]',
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
      <div>
        <h4 className="text-xs font-semibold text-[#1c1a17]">{title}</h4>
        <p className="text-xs text-[#6f675c] mt-0.5">{summary}</p>
      </div>

      {items.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {items.map(label => (
            <button
              key={label}
              type="button"
              onClick={() => onChange(removeInterest(value, group, label))}
              className={`inline-flex items-center gap-1.5 px-2.5 py-2 rounded-xl border text-xs font-medium transition cursor-pointer ${CHIP_TONE[group]}`}
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
          className="flex-1 min-w-0 rounded-xl bg-[#fffdf7] border border-[#c9bc9f] px-3 py-2.5 text-xs text-[#1c1a17] placeholder:text-[#a39a8c] focus:outline-none focus:border-[#8a5a24] disabled:opacity-50"
        />
        <button
          type="button"
          onClick={commit}
          disabled={atCap || !draft.trim()}
          className="px-3 py-2.5 rounded-xl bg-[#1c1a17] border border-[#1c1a17] text-xs font-medium text-[#f6f1e7] hover:bg-[#3a352d] transition disabled:opacity-40 flex items-center gap-1.5 shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add</span>
        </button>
      </div>

      {/* Suggestions belong to the "more" list only: offering the same folder chips under both
          lists read as a stray chip repeated, not as a choice. */}
      {group === 'more' && unusedSuggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-[#6f675c]">From your folders:</span>
          {unusedSuggestions.map(label => (
            <button
              key={label}
              type="button"
              onClick={() => onChange(addInterest(value, group, label))}
              className="text-xs px-2 py-1.5 rounded-lg text-[#6f675c] border border-[#ddd2bc] hover:text-[#1c1a17] hover:border-[#1c1a17] transition"
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
    <div className="space-y-5">
      <InterestRow
        group="more"
        title="More of this"
        summary="Lifted in the ranking of today's digest."
        hint="e.g. Artificial Intelligence"
        value={value}
        suggestions={suggestions}
        onChange={onChange}
      />

      {/* The same paired rule the masthead uses: one list ends where the next begins. */}
      <div aria-hidden="true" className="flex flex-col gap-[3px]">
        <span className="h-[2px] w-full bg-[#1c1a17]/50" />
        <span className="h-px w-full bg-[#1c1a17]/20" />
      </div>

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
