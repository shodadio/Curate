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
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-3 sm:p-6 safe-modal bg-slate-950/85 backdrop-blur-md overflow-hidden animate-fade-in"
      onClick={onClose}
    >
      <div 
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Weekly Reading Review"
        className="w-full max-w-2xl max-h-[calc(100dvh-1.5rem)] overflow-y-auto overscroll-contain bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl my-auto relative text-slate-100"
        onClick={e => e.stopPropagation()}
      >
        {/* Subtle warm ambient header banner */}
        <div className="relative sticky top-0 z-10 p-6 sm:p-8 bg-slate-900 bg-[linear-gradient(180deg,rgba(245,158,11,0.10),rgba(15,23,42,0)_55%)] border-b border-slate-800/80">
          <button 
            type="button"
            onClick={onClose}
            className="absolute top-5 right-5 w-8 h-8 rounded-full bg-slate-800/80 hover:bg-slate-750 text-slate-400 hover:text-slate-100 flex items-center justify-center transition border border-slate-700/50 cursor-pointer z-10"
            title="Close review"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-3.5 mb-3 pr-14">
            <CuratorMark className="w-11 h-11 shadow-lg drop-shadow-[0_4px_12px_rgba(245,158,11,0.25)]" />
            <div>
              <div className="flex items-center gap-2">
                <span className="font-serif text-sm tracking-[0.2em] font-semibold text-amber-400">THE CURATOR</span>
                <span className="text-xs uppercase font-mono tracking-wider px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  Weekly Review
                </span>
              </div>
              <h2 className="text-xl sm:text-2xl font-serif font-bold text-slate-100 tracking-tight mt-0.5">
                Past Week Reading Activity
              </h2>
            </div>
          </div>

          <p className="text-xs sm:text-sm text-slate-400 max-w-lg">
            A calm retrospective of your intellectual diet over the past 7 days ({weekRangeLabel}) — time spent, topic breadth, and reading discipline.
          </p>
        </div>

        {/* Modal Body */}
        <div className="p-6 sm:p-8 space-y-8">
          {totalArticles === 0 && (
            <div className="p-5 rounded-2xl bg-slate-950/60 border border-slate-800/80 text-xs text-slate-400 leading-relaxed">
              No reading has been recorded in the last 7 days yet. Finish an article and the time you spend will appear here.
            </div>
          )}

          {/* Key Stat Cards Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
            <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800/80">
              <div className="flex items-center gap-1.5 text-xs text-amber-400 font-medium mb-1">
                <Clock className="w-3.5 h-3.5" />
                <span>Total Time</span>
              </div>
              <div className="text-2xl font-bold font-serif text-slate-100">
                {totalMinutes} <span className="text-xs font-sans text-slate-400 font-normal">mins</span>
              </div>
              <div className={`text-xs mt-1 flex items-center gap-1 ${
                weekDeltaPct === null ? 'text-slate-400' : weekDeltaPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}>
                <TrendingUp className="w-3 h-3" />
                <span>
                  {weekDeltaPct === null
                    ? (priorWeekMinutes > 0 ? `${priorWeekMinutes} min read the week before` : 'No prior week recorded')
                    : `${weekDeltaPct >= 0 ? '+' : ''}${weekDeltaPct}% vs prior week`}
                </span>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800/80">
              <div className="flex items-center gap-1.5 text-xs text-amber-400 font-medium mb-1">
                <BookOpen className="w-3.5 h-3.5" />
                <span>Articles Read</span>
              </div>
              <div className="text-2xl font-bold font-serif text-slate-100">
                {totalArticles} <span className="text-xs font-sans text-slate-400 font-normal">items</span>
              </div>
              <div className="text-xs text-slate-400 mt-1">
                {avgMinutesPerArticle} min average per article
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800/80">
              <div className="flex items-center gap-1.5 text-xs text-amber-400 font-medium mb-1">
                <Layers className="w-3.5 h-3.5" />
                <span>Top Topic</span>
              </div>
              <div className="text-base sm:text-lg font-bold font-serif text-slate-100 truncate">
                {topTopic || 'No reading yet'}
              </div>
              <div className="text-xs text-amber-300/80 mt-1">
                {totalMinutes > 0 ? `${sortedTopics[0]?.pct ?? 0}% of reading time` : 'Nothing recorded yet'}
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800/80">
              <div className="flex items-center gap-1.5 text-xs text-amber-400 font-medium mb-1">
                <Compass className="w-3.5 h-3.5" />
                <span>Serendipity</span>
              </div>
              <div className="text-2xl font-bold font-serif text-slate-100">
                {stretchCount} <span className="text-xs font-sans text-slate-400 font-normal">stretch</span>
              </div>
              <div className="text-xs text-slate-400 mt-1">
                Outside routine
              </div>
            </div>
          </div>

          {/* Daily Rhythm Chart */}
          <div className="p-5 rounded-2xl bg-slate-950/60 border border-slate-800/80 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 text-slate-200 font-semibold">
                <BarChart3 className="w-4 h-4 text-amber-400" />
                <span>Daily Reading Rhythm (Minutes per Day)</span>
              </div>
              <span className="text-slate-400 text-xs">Past 7 Days</span>
            </div>

            <div className="pt-4 pb-1 grid grid-cols-7 gap-2 items-end h-32">
              {dailyMinutes.map((d, i) => {
                const heightPct = maxDayMins > 0 ? Math.max(4, Math.round((d.minutes / maxDayMins) * 100)) : 0;
                const isPeak = maxDayMins > 0 && d.minutes === maxDayMins;
                return (
                  <div key={d.day} className="flex flex-col items-center gap-1.5 h-full justify-end group">
                    <span className="text-xs font-mono text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity">
                      {d.minutes}m
                    </span>
                    <div 
                      className={`w-full max-w-[28px] rounded-t-lg transition-all ${
                        isPeak
                          ? 'bg-gradient-to-t from-amber-600 to-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.4)]'
                          : 'bg-slate-800 hover:bg-slate-700'
                      }`}
                      style={{ height: `${heightPct}%` }}
                    />
                    <span className={`text-xs font-medium ${isPeak ? 'text-amber-300 font-semibold' : 'text-slate-400'}`}>
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
              <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <span>Most-Read Topics & Intellectual Focus</span>
              </h3>
              <span className="text-xs text-slate-400">{sortedTopics.length} topics explored</span>
            </div>

            {/* Proportional Segmented Bar */}
            <div className="h-3 w-full rounded-full bg-slate-800 flex overflow-hidden p-0.5 gap-0.5">
              {sortedTopics.map((top, idx) => {
                const colors = [
                  'bg-amber-400',
                  'bg-orange-500',
                  'bg-emerald-400',
                  'bg-sky-400',
                  'bg-rose-400',
                  'bg-purple-400'
                ];
                return (
                  <div 
                    key={top.topic}
                    className={`${colors[idx % colors.length]} rounded-full transition-all`}
                    style={{ width: `${top.pct}%` }}
                    title={`${top.topic}: ${top.minutes}m (${top.pct}%)`}
                  />
                );
              })}
            </div>

            {/* Topic List */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {sortedTopics.map((top, idx) => {
                const dotColors = [
                  'bg-amber-400 text-amber-300 border-amber-500/30',
                  'bg-orange-500 text-orange-300 border-orange-500/30',
                  'bg-emerald-400 text-emerald-300 border-emerald-500/30',
                  'bg-sky-400 text-sky-300 border-sky-500/30',
                  'bg-rose-400 text-rose-300 border-rose-500/30',
                  'bg-purple-400 text-purple-300 border-purple-500/30'
                ];
                return (
                  <div 
                    key={top.topic}
                    className="p-3 rounded-xl bg-slate-950/40 border border-slate-800/60 flex items-center justify-between text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={`w-2 h-2 rounded-full ${dotColors[idx % dotColors.length].split(' ')[0]}`} />
                      <span className="font-medium text-slate-200 truncate">{top.topic}</span>
                    </div>
                    <div className="flex items-center gap-2 text-slate-400 shrink-0">
                      <span className="font-mono text-slate-300 font-semibold">{top.minutes} min</span>
                      <span className="text-xs text-slate-400">({top.pct}%)</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Top Sources Read */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-200">Most-Read Publications & Authors</h3>
            <div className="flex flex-wrap gap-2">
              {topSources.map(s => (
                <div 
                  key={s.source}
                  className="px-3 py-1.5 rounded-full bg-slate-950 border border-slate-800 text-xs flex items-center gap-2 text-slate-300"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                  <span className="font-medium text-slate-200">{s.source}</span>
                  <span className="text-slate-400 font-mono text-xs">· {s.minutes}m</span>
                </div>
              ))}
            </div>
          </div>

          {/* Articles Read This Week Log */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-200">Completed Articles Log</h3>
              <span className="text-xs text-slate-400">{recentItems.length} articles</span>
            </div>

            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {recentItems.map(item => (
                <div 
                  key={item.id}
                  onClick={() => {
                    if (onOpenArticle) onOpenArticle(item.id);
                    onClose();
                  }}
                  className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 hover:border-amber-500/40 hover:bg-slate-900 transition flex items-center justify-between gap-3 text-xs cursor-pointer group"
                >
                  <div className="min-w-0">
                    <h4 className="font-medium text-slate-200 group-hover:text-amber-300 transition-colors line-clamp-1">
                      {item.title}
                    </h4>
                    <div className="flex items-center gap-2 text-slate-400 text-xs mt-0.5">
                      <span className="text-slate-300">{item.source}</span>
                      <span>·</span>
                      <span className="text-amber-400/90">{displayFolder(item.folder)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-mono text-slate-400 text-xs bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                      {item.readTime || `${item.minutesSpent ?? 0} min read`}
                    </span>
                    <Check className="w-4 h-4 text-emerald-400" />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Editorial Synthesis Reflection */}
          <div className="p-5 rounded-2xl bg-amber-500/5 border border-amber-500/20 text-xs space-y-2">
            <div className="flex items-center gap-2 text-amber-400 font-semibold">
              <Sparkles className="w-4 h-4" />
              <span>Curator Editorial Synthesis</span>
            </div>
            <p className="text-slate-300 leading-relaxed">
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
        <div className="p-4 sm:p-6 bg-slate-950 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
          <button 
            type="button"
            onClick={handleShare}
            className="px-4 min-h-11 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 text-xs font-semibold inline-flex items-center justify-center gap-2 transition border border-slate-700 cursor-pointer"
          >
            <Share2 className="w-3.5 h-3.5 text-amber-400" />
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
                className="inline-flex min-h-11 items-center rounded-xl border border-slate-800 bg-slate-900 px-4 text-xs font-medium text-slate-300 transition hover:bg-slate-800 hover:text-slate-100 cursor-pointer"
              >
                Adjust preferences
              </button>
            )}
            <button 
              type="button"
              onClick={onClose}
              className="inline-flex min-h-11 items-center rounded-xl bg-amber-500 px-5 text-xs font-semibold text-slate-950 transition hover:bg-amber-400 cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
