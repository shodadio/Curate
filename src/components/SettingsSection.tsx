import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

interface SettingsSectionProps {
  id?: string;
  icon: ReactNode;
  title: string;
  /** Short status shown on the collapsed row, so the section is useful without opening it. */
  meta?: ReactNode;
  children: ReactNode;
}

// One collapsible Settings section: the title is always visible, the detail is one click away.
// It is a ruled block on the page rather than a card floating above it — a printed corner, a
// single hairline around it, and the same warm stock the masthead sits on.
export function SettingsSection({ id, icon, title, meta, children }: SettingsSectionProps) {
  return (
    <details
      id={id}
      className="group scroll-mt-6 border border-[#d3c7ae] bg-[#efe8d6] open:border-[#b9ad97] open:bg-[#ece4d1]"
    >
      {/* The title keeps the full row, so a long one such as "Advanced configuration" wraps
          at its words instead of being squeezed by the count beside it — the count went to a
          line of its own, where it also stops being cut off with an ellipsis. Nothing is
          broken inside a word: the page wrapper wraps anywhere, and a heading that came
          apart as "configuratio / n" was the cost of inheriting that. */}
      <summary className="flex cursor-pointer list-none items-start gap-2.5 px-5 py-4 [&::-webkit-details-marker]:hidden">
        <span className="mt-0.5 shrink-0 text-[#1c1a17]">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block font-serif text-[1.05rem] font-semibold leading-tight text-[#1c1a17] [overflow-wrap:break-word]">{title}</span>
          {meta && (
            <span className="mt-1 block text-xs leading-snug text-[#6f675c] tabular-nums [overflow-wrap:break-word]">{meta}</span>
          )}
        </span>
        <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-[#6f675c] transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-4 px-5 pb-5">{children}</div>
    </details>
  );
}
