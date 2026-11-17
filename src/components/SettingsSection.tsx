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

// One collapsible Settings card: the title is always visible, the detail is one click away.
export function SettingsSection({ id, icon, title, meta, children }: SettingsSectionProps) {
  return (
    <details
      id={id}
      className="group rounded-3xl border border-slate-700/70 bg-slate-900/40 scroll-mt-6 open:border-slate-600/80 open:bg-slate-900/60"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2.5 px-5 py-4 [&::-webkit-details-marker]:hidden">
        <span className="shrink-0 text-amber-400">{icon}</span>
        <span className="text-sm font-semibold text-slate-100">{title}</span>
        <span className="ml-auto min-w-0 truncate text-xs text-slate-400 tabular-nums">{meta}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-4 px-5 pb-5">{children}</div>
    </details>
  );
}
