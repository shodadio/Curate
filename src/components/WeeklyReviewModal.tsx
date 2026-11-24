import React from 'react';
import { 
  X, Clock, BookOpen, Compass, Sparkles, TrendingUp, 
  Share2, Check, ArrowRight, ExternalLink, Calendar,
  BarChart3, ThumbsUp, Layers
} from 'lucide-react';
import { CuratorMark } from './CuratorLogo';
import { focusableWithin, trapTabKey } from '../overlayFocus';

export interface WeeklyReadingItem {
  id: string;
  title: string;
  source: string;
  folder: string;
  readTime: string;
  minutesSpent: number;
  completedAt: number; // timestamp
  url?: string;
  avatar?: string;
}

interface WeeklyReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  readingItems: WeeklyReadingItem[];
  onOpenArticle?: (id: string) => void;
  onOpenSettings?: () => void;
  showToast?: (msg: string) => void;
}

export function WeeklyReviewModal({
  isOpen,
  onClose,
  readingItems,
  onOpenArticle,
  onOpenSettings,
  showToast
}: WeeklyReviewModalProps) {
  // Hooks before the early return: the review is a dialog, so it owns focus while it is open.
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (!isOpen) return;
    const panel = panelRef.current;
    if (!panel) return;

    const focusTimer = window.setTimeout(() => {
      if (!panel.contains(document.activeElement)) focusableWithin(panel)[0]?.focus();
    }, 30);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      trapTabKey(event, panel);
    };
    window.addEventListener('keydown', onKeyDown, true);

    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const displayFolder = (folder?: string) =>
    (!folder || folder.trim().toLowerCase() === 'uncategorized') ? 'General' : folder;

  // Every statistic below is derived from recorded reading — no placeholders, smoothing or defaults
  const dayMs = 24 * 60 * 60 * 1000;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const weekStart = todayStart.getTime() - 6 * dayMs;
  const priorWeekStart = weekStart - 7 * dayMs;
  // Bars are weekday initials, which alone never say which days they were.
  const shortDay = (at: number) => new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const weekRangeLabel = `${shortDay(weekStart)} – ${new Date(todayStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

  const recentItems = readingItems.filter(it => it.completedAt >= weekStart);
  const priorWeekItems = readingItems.filter(it => it.completedAt >= priorWeekStart && it.completedAt < weekStart);

  const minutesFor = (items: WeeklyReadingItem[]) =>
    items.reduce((acc, it) => acc + (it.minutesSpent ?? 0), 0);

  const totalMinutes = minutesFor(recentItems);
  const totalArticles = recentItems.length;
  const priorWeekMinutes = minutesFor(priorWeekItems);
  const weekDeltaPct = priorWeekMinutes > 0
    ? Math.round(((totalMinutes - priorWeekMinutes) / priorWeekMinutes) * 100)
    : null;
  const avgMinutesPerArticle = totalArticles > 0 ? Math.round((totalMinutes / totalArticles) * 10) / 10 : 0;

  // Topic breakdown
  const topicMap = new Map<string, { minutes: number; count: number }>();
  recentItems.forEach(it => {
    const topic = displayFolder(it.folder);
    const curr = topicMap.get(topic) || { minutes: 0, count: 0 };
    topicMap.set(topic, {
      minutes: curr.minutes + (it.minutesSpent ?? 0),
      count: curr.count + 1
    });
  });

  const sortedTopics = Array.from(topicMap.entries())
    .map(([topic, data]) => ({
      topic,
      minutes: data.minutes,
      count: data.count,
      pct: totalMinutes > 0 ? Math.round((data.minutes / totalMinutes) * 100) : 0
    }))
    .sort((a, b) => b.minutes - a.minutes);

  const topTopic = sortedTopics[0]?.topic;
  const stretchCount = topTopic
    ? recentItems.filter(it => displayFolder(it.folder) !== topTopic).length
    : 0;

  // Minutes per real calendar day over the last 7 days, labelled with each day's actual weekday
  const dailyMinutes = Array.from({ length: 7 }, (_, idx) => {
    const dayStart = weekStart + idx * dayMs;
    const dayEnd = dayStart + dayMs;
    const minutes = recentItems
      .filter(it => it.completedAt >= dayStart && it.completedAt < dayEnd)
      .reduce((sum, it) => sum + (it.minutesSpent ?? 0), 0);
    return {
      day: new Date(dayStart).toLocaleDateString('en-US', { weekday: 'short' }),
      minutes
    };
  });

  const maxDayMins = Math.max(0, ...dailyMinutes.map(d => d.minutes));

  // One ranked ink ladder for the whole review: the topic bar's slices and the topic
  // rows carry the same shade for the same rank, so the widest slice is the darkest.
  const topicShades = ['bg-[#1c1a17]', 'bg-[#1c1a17]/80', 'bg-[#1c1a17]/60', 'bg-[#1c1a17]/45', 'bg-[#1c1a17]/35'];
  const shadeFor = (index: number) => topicShades[Math.min(index, topicShades.length - 1)];

  // Sources breakdown
  const sourceMap = new Map<string, { count: number; minutes: number }>();
  recentItems.forEach(it => {
    const s = it.source || 'Curated';
    const curr = sourceMap.get(s) || { count: 0, minutes: 0 };
    sourceMap.set(s, {
      count: curr.count + 1,
      minutes: curr.minutes + (it.minutesSpent ?? 0)
    });
  });
  const topSources = Array.from(sourceMap.entries())
    .map(([source, data]) => ({ source, ...data }))
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 5);

  const handleShare = async () => {
    const summaryText = `📖 My Curator Weekly Reading Review:
⏱️ ${totalMinutes} minutes spent reading
📚 ${totalArticles} articles completed
🏷️ Top topics: ${sortedTopics.slice(0, 3).map(t => `${t.topic} (${t.pct}%)`).join(' · ')}
✨ Curated with The Curator`;

    // On iOS the clipboard write succeeds silently and the summary lands nowhere the reader can
    // reach, so ask for the real share sheet whenever the device offers one.
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'My Curator Weekly Reading Review', text: summaryText });
        return;
      } catch (error) {
        // A cancelled share sheet is not a failure; anything else falls back to the clipboard.
        if ((error as DOMException | undefined)?.name === 'AbortError') return;
      }
    }

    if (navigator.clipboard) {
      await navigator.clipboard.writeText(summaryText);
      if (showToast) showToast('Weekly summary copied to clipboard!');
    } else if (showToast) {
      showToast('Weekly summary ready to share');
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-3 sm:p-6 safe-modal bg-[#1c1a17]/45 overflow-hidden animate-fade-in"
      onClick={onClose}
    >
      <div 
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Weekly Reading Review"
        className="no-sideways w-full max-w-2xl max-h-[calc(100dvh-1.5rem)] overflow-y-auto overscroll-contain bg-[#f6f1e7] border border-[#c9bc9f] rounded-3xl shadow-2xl my-auto relative text-[#1c1a17]"
        onClick={e => e.stopPropagation()}
      >
        <div className="relative sticky top-0 z-10 p-6 sm:p-8 bg-[#f6f1e7] border-b border-[#ddd2bc]">
          <button 
            type="button"
            onClick={onClose}
            className="absolute top-5 right-5 w-8 h-8 rounded-full bg-transparent hover:bg-[#1c1a17]/5 text-[#6f675c] hover:text-[#1c1a17] flex items-center justify-center transition border border-[#c9bc9f] cursor-pointer z-10"
            title="Close review"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-3.5 mb-3 pr-14">
            <CuratorMark className="w-11 h-11" />
            <div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="whitespace-nowrap font-serif text-sm tracking-[0.08em] font-semibold text-[#8a5a24]">THE CURATOR</span>
                <span className="whitespace-nowrap text-xs uppercase font-mono tracking-wider px-2 py-0.5 rounded-full bg-transparent text-[#3f3a33] border border-[#c9bc9f]">
                  Weekly Review
                </span>
              </div>
              <h2 className="text-xl sm:text-2xl font-serif font-bold text-[#1c1a17] mt-0.5">
                Past Week Reading Activity
              </h2>
            </div>
          </div>

          <p className="text-xs sm:text-sm text-[#6f675c] max-w-lg">
            A calm retrospective of your intellectual diet over the past 7 days ({weekRangeLabel}) — time spent, topic breadth, and reading discipline.
          </p>
        </div>

        {/* Modal Body */}
        <div className="p-6 sm:p-8 space-y-8">
          {totalArticles === 0 && (
            <div className="p-5 rounded-2xl bg-[#ece4d1] border border-[#ddd2bc] text-xs text-[#6f675c] leading-relaxed">
              No reading has been recorded in the last 7 days yet. Finish an article and the time you spend will appear here.
            </div>
          )}

          {/* Key Stat Cards Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
            <div className="p-4 rounded-2xl bg-[#ece4d1] border border-[#ddd2bc]">
              <div className="flex items-center gap-1.5 text-xs text-[#6f675c] font-medium mb-1">
                <Clock className="w-3.5 h-3.5" />
                <span>Total Time</span>
              </div>
              <div className="text-2xl font-bold text-[#1c1a17] tabular-nums">
                {totalMinutes} <span className="text-xs font-sans text-[#6f675c] font-normal">mins</span>
              </div>
              <div className="text-xs mt-1 flex items-center gap-1 text-[#3f3a33]">
                <TrendingUp className="w-3 h-3" />
                <span>
                  {weekDeltaPct === null
                    ? (priorWeekMinutes > 0 ? `${priorWeekMinutes} min read the week before` : 'No prior week recorded')
                    : `${weekDeltaPct >= 0 ? '▲' : '▼'} ${weekDeltaPct >= 0 ? '+' : ''}${weekDeltaPct}% vs prior week`}
                </span>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-[#ece4d1] border border-[#ddd2bc]">
              <div className="flex items-center gap-1.5 text-xs text-[#6f675c] font-medium mb-1">
                <BookOpen className="w-3.5 h-3.5" />
                <span>Articles Read</span>
              </div>
              <div className="text-2xl font-bold text-[#1c1a17] tabular-nums">
                {totalArticles} <span className="text-xs font-sans text-[#6f675c] font-normal">items</span>
              </div>
              <div className="text-xs text-[#6f675c] mt-1">
                {avgMinutesPerArticle} min average per article
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-[#ece4d1] border border-[#ddd2bc]">
              <div className="flex items-center gap-1.5 text-xs text-[#6f675c] font-medium mb-1">
                <Layers className="w-3.5 h-3.5" />
                <span>Top Topic</span>
              </div>
              <div className="text-base sm:text-lg font-bold text-[#1c1a17] truncate">
                {topTopic || 'No reading yet'}
              </div>
              <div className="text-xs text-[#6f675c] mt-1">
                {totalMinutes > 0 ? `${sortedTopics[0]?.pct ?? 0}% of reading time` : 'Nothing recorded yet'}
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-[#ece4d1] border border-[#ddd2bc]">
              <div className="flex items-center gap-1.5 text-xs text-[#6f675c] font-medium mb-1">
                <Compass className="w-3.5 h-3.5" />
                <span>Serendipity</span>
              </div>
              <div className="text-2xl font-bold text-[#1c1a17] tabular-nums">
                {stretchCount} <span className="text-xs font-sans text-[#6f675c] font-normal">stretch</span>
              </div>
              <div className="text-xs text-[#6f675c] mt-1">
                Outside routine
              </div>
            </div>
          </div>

          {/* Daily Rhythm Chart */}
          <div className="p-5 rounded-2xl bg-[#ece4d1] border border-[#ddd2bc] space-y-3">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 text-[#1c1a17] font-semibold">
                <BarChart3 className="w-4 h-4" />
                <span>Daily Reading Rhythm (Minutes per Day)</span>
              </div>
              <span className="text-[#6f675c] text-xs">Past 7 Days</span>
            </div>

            <div className="pt-4 pb-1 grid grid-cols-7 gap-1 sm:gap-2 items-end h-32">
              {dailyMinutes.map((d, i) => {
                const heightPct = maxDayMins > 0 ? Math.max(4, Math.round((d.minutes / maxDayMins) * 100)) : 0;
                const isPeak = maxDayMins > 0 && d.minutes === maxDayMins;
                return (
                  <div key={d.day} className="flex flex-col items-center gap-1.5 h-full justify-end group">
                    <span
                      className={`text-[10px] font-mono tabular-nums ${isPeak ? 'text-[#1c1a17] font-semibold' : 'text-[#6f675c]'}`}
                    >
                      {d.minutes}m
                    </span>
                    <div 
                      className={`w-full max-w-[28px] rounded-t-lg transition-all ${
                        isPeak
                          ? 'bg-[#1c1a17]'
                          : 'bg-[#1c1a17]/55'
                      }`}
                      style={{ height: `${heightPct}%` }}
                    />
                    <span className={`whitespace-nowrap text-[10px] sm:text-xs ${isPeak ? 'text-[#1c1a17] font-bold' : 'text-[#6f675c] font-medium'}`}>
                      {d.day}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Most-Read Topics Segmented Bar & Details */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#1c1a17] flex items-center gap-2">
                <span>Most-Read Topics & Intellectual Focus</span>
              </h3>
              <span className="text-xs text-[#6f675c]">{sortedTopics.length} topics explored</span>
            </div>

            {/* Proportional Segmented Bar */}
            <div className="h-3 w-full rounded-full bg-[#1c1a17]/10 flex overflow-hidden p-0.5 gap-0.5">
              {sortedTopics.map((top, idx) => {
                return (
                  <div
                    key={top.topic}
                    className={`${shadeFor(idx)} rounded-full transition-all`}
                    style={{ width: `${top.pct}%` }}
                    title={`${top.topic}: ${top.minutes}m (${top.pct}%)`}
                  />
                );
              })}
            </div>

            {/* Topic List */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {sortedTopics.map((top, idx) => {
                return (
                  <div
                    key={top.topic}
                    className="p-3 rounded-xl bg-[#ece4d1] border border-[#ddd2bc] flex items-center justify-between text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={`w-2 h-2 rounded-full ${shadeFor(idx)}`} />
                      <span className="font-medium text-[#1c1a17] truncate">{top.topic}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[#6f675c] shrink-0">
                      <span className="font-mono text-[#1c1a17] font-semibold">{top.minutes} min</span>
                      <span className="text-xs text-[#6f675c]">({top.pct}%)</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Top Sources Read */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-[#1c1a17]">Most-Read Publications & Authors</h3>
            <div className="flex flex-wrap gap-2">
              {topSources.map(s => (
                <div 
                  key={s.source}
                  className="px-3 py-1.5 rounded-full bg-[#ece4d1] border border-[#c9bc9f] text-xs flex items-center gap-2 text-[#3f3a33]"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-[#1c1a17]" />
                  <span className="font-medium text-[#1c1a17]">{s.source}</span>
                  <span className="text-[#6f675c] font-mono text-xs">· {s.minutes}m</span>
                </div>
              ))}
            </div>
          </div>

          {/* Articles Read This Week Log */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#1c1a17]">Completed Articles Log</h3>
              <span className="text-xs text-[#6f675c]">{recentItems.length} articles</span>
            </div>

            <div className="no-sideways space-y-2 max-h-56 overflow-y-auto pr-1">
              {recentItems.map(item => (
                <div 
                  key={item.id}
                  onClick={() => {
                    if (onOpenArticle) onOpenArticle(item.id);
                    onClose();
                  }}
                  className="p-3 rounded-xl bg-[#ece4d1] border border-[#ddd2bc] hover:border-[#1c1a17] transition flex items-center justify-between gap-3 text-xs cursor-pointer group"
                >
                  <div className="min-w-0">
                    <h4 className="font-medium text-[#1c1a17] group-hover:underline transition-colors line-clamp-1">
                      {item.title}
                    </h4>
                    <div className="flex items-center gap-2 text-[#6f675c] text-xs mt-0.5">
                      <span className="text-[#3f3a33]">{item.source}</span>
                      <span>·</span>
                      <span>{displayFolder(item.folder)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-mono text-[#3f3a33] text-xs bg-[#f6f1e7] px-2 py-0.5 rounded border border-[#c9bc9f]">
                      {item.readTime || `${item.minutesSpent ?? 0} min read`}
                    </span>
                    <Check className="w-4 h-4 text-[#1c1a17]" strokeWidth={3} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Editorial Synthesis Reflection */}
          <div className="p-5 rounded-2xl bg-[#ece4d1] border border-[#c9bc9f] text-xs space-y-2">
            <div className="flex items-center gap-2 text-[#1c1a17] font-semibold">
              <Sparkles className="w-4 h-4" />
              <span>Curator Editorial Synthesis</span>
            </div>
            <p className="text-[#3f3a33] leading-relaxed">
              {totalArticles === 0
                ? 'No reading activity to summarise yet. Once you finish an article, this reflection reports what you actually read.'
                : `Over the past 7 days you recorded ${totalMinutes} minutes across ${totalArticles} ${totalArticles === 1 ? 'article' : 'articles'}, ${sortedTopics[1]
                    ? `split mainly between ${sortedTopics[0].topic} (${sortedTopics[0].pct}%) and ${sortedTopics[1].topic} (${sortedTopics[1].pct}%)`
                    : `concentrated in ${sortedTopics[0].topic}`}.${stretchCount > 0
                    ? ` ${stretchCount} ${stretchCount === 1 ? 'item sat' : 'items sat'} outside your main focus.`
                    : ''}`}
            </p>
          </div>
        </div>

        {/* Modal Footer Actions — static at the end, so it never covers the content above it */}
        <div className="p-4 sm:p-6 bg-[#ece4d1] border-t border-[#ddd2bc] flex flex-wrap items-center justify-between gap-3">
          <button 
            type="button"
            onClick={handleShare}
            className="px-4 min-h-11 rounded-xl bg-transparent hover:bg-[#1c1a17]/5 text-[#1c1a17] text-xs font-semibold inline-flex items-center justify-center gap-2 transition border border-[#1c1a17]/40 cursor-pointer"
          >
            <Share2 className="w-3.5 h-3.5" />
            <span>Share Weekly Review</span>
          </button>

          <div className="flex items-center gap-2">
            {onOpenSettings && (
              <button 
                type="button"
                onClick={() => {
                  onClose();
                  onOpenSettings();
                }}
                className="inline-flex min-h-11 items-center rounded-xl border border-[#c9bc9f] bg-transparent px-4 text-xs font-medium text-[#3f3a33] transition hover:border-[#1c1a17] hover:text-[#1c1a17] cursor-pointer"
              >
                Adjust preferences
              </button>
            )}
            <button 
              type="button"
              onClick={onClose}
              className="inline-flex min-h-11 items-center rounded-xl bg-[#1c1a17] px-5 text-xs font-semibold text-[#f6f1e7] transition hover:bg-[#3a352d] cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
