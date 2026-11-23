import { useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { stripMarkdownSyntax } from '../../lib/markup';

interface SourceDescriptionProps {
  description: string;
  sourceTitle: string;
  expanded: boolean;
  onToggle: () => void;
}

// Two lines across the whole card, and "More" only when the clamp is really hiding
// words: a short blurb gets no control that would change nothing.
export function SourceDescription({ description, sourceTitle, expanded, onToggle }: SourceDescriptionProps) {
  const textRef = useRef<HTMLParagraphElement | null>(null);
  const [clipped, setClipped] = useState(false);

  useLayoutEffect(() => {
    const node = textRef.current;
    if (!node || expanded) return;
    const measure = () => setClipped(node.scrollHeight > node.clientHeight + 1);
    measure();
    // A rotation or a wider window can fit the same words into the two lines.
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [description, expanded]);

  return (
    <div>
      <p ref={textRef} className={`text-xs text-[#6f675c] leading-relaxed ${expanded ? '' : 'line-clamp-2'}`}>
        {stripMarkdownSyntax(description)}
      </p>
      {(clipped || expanded) && (
        <button
          type="button"
          onClick={onToggle}
          className="mt-0.5 inline-flex min-h-8 items-center gap-0.5 px-0.5 text-[11px] font-medium text-[#6f675c] hover:text-[#1c1a17] underline underline-offset-2 transition cursor-pointer"
          aria-expanded={expanded}
          title={expanded ? 'Show less of this site description' : `Show more about ${sourceTitle}`}
        >
          <span>{expanded ? 'Less' : 'More'}</span>
          <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
      )}
    </div>
  );
}
