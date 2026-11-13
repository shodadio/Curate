import React, { useState, useEffect } from 'react';
import { 
  Sun, Bookmark, Rss, Settings, RefreshCw, ChevronRight, Check, Plus, Trash2, 
  Download, Upload, Bell, Sliders, ExternalLink, ArrowLeft, Heart, Eye, Sparkles, 
  AlertCircle, ShieldCheck, HelpCircle, X, Edit2, MessageSquare, Repeat, Share2, Home, BookOpen, Headphones, MessageCircle, Activity,
  ThumbsUp, ThumbsDown, FileUp, Search, Globe
} from 'lucide-react';

interface DiscoveredSource {
  title: string;
  siteUrl: string;
  folder: string;
  summary: string;
  rssStatus: 'native' | 'generatable' | 'blocked' | 'unavailable' | 'unreachable';
  canGenerateRss: boolean;
  feedUrl: string | null;
  feedFormat: string | null;
  sampleTitles: string[];
  investigationNote: string;
}

interface DigestItem {
  id: string;
  title: string;
  source: string;
  folder: string;
  readTime: string;
  why: string;
  summary: string;
  url: string;
  fullText: string;
  isOutOfBubble: boolean;
  bannerImage?: string;
  avatar?: string;
  publishedAt?: string;
  quote?: string;
}

interface SourceItem {
  id: string;
  title: string;
  feedUrl: string;
  folder: string;
  status: 'active' | 'failing';
  failingReason?: string;
}

export default function App() {
  // Navigation & View state
  const [activeTab, setActiveTab] = useState<'today' | 'saved' | 'sources' | 'settings' | 'feeds'>('today');
  const [selectedArticle, setSelectedArticle] = useState<DigestItem | null>(null);
  const [selectedFeedSource, setSelectedFeedSource] = useState<string | null>(null);
  const [feedStreamArticles, setFeedStreamArticles] = useState<DigestItem[]>([]);
  const [loadingFeedStream, setLoadingFeedStream] = useState<boolean>(false);
  const [recentReadItem, setRecentReadItem] = useState<DigestItem | null>(null);
  const [showKeepReading, setShowKeepReading] = useState<boolean>(true);
  const [showQuickActions, setShowQuickActions] = useState<boolean>(false);
  const [repostIds, setRepostIds] = useState<string[]>([]);

  // App data state with localStorage persistence
  const [sources, setSources] = useState<SourceItem[]>(() => {
    const saved = localStorage.getItem('curator_sources');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { /* ignore */ }
    }
    return [
      { id: 'src_0', title: 'Nicole Williams', feedUrl: 'https://pmresearcher.substack.com/feed', folder: 'Strategy & Craft', status: 'active' },
      { id: 'src_1', title: 'The Anthropic Stack', feedUrl: 'https://anthropic.com/feed', folder: 'Tech & AI', status: 'active' },
      { id: 'src_2', title: 'World Politics & History', feedUrl: 'https://worldhistory.com/feed', folder: 'History', status: 'active' },
      { id: 'src_3', title: 'Prospect Magazine', feedUrl: 'https://prospectmagazine.co.uk/feed', folder: 'Culture', status: 'active' },
      { id: 'src_4', title: 'Dr. Bhaskar Economics', feedUrl: 'https://bhaskar.econ/feed', folder: 'Economics', status: 'active' },
      { id: 'src_5', title: 'Stratechery by Ben Thompson', feedUrl: 'https://stratechery.com/feed/', folder: 'Tech & Strategy', status: 'active' },
      { id: 'src_6', title: 'Marginal Revolution', feedUrl: 'https://marginalrevolution.com/feed', folder: 'Economics', status: 'active' },
      { id: 'src_7', title: 'Dan Luu', feedUrl: 'https://danluu.com/atom.xml', folder: 'Tech & Engineering', status: 'active' },
      { id: 'src_8', title: 'A List Apart', feedUrl: 'https://alistapart.com/main/feed/', folder: 'Design', status: 'active' },
      { id: 'src_9', title: 'Long Now Foundation', feedUrl: 'https://longnow.org/feed/', folder: 'Philosophy & Long-term', status: 'active' },
      { id: 'src_10', title: 'Rest of World', feedUrl: 'https://restofworld.org/feed/', folder: 'Global Tech', status: 'failing', failingReason: 'Not responding (HTTP 503)' }
    ];
  });

  const [digest, setDigest] = useState<DigestItem[]>([]);
  const [savedIds, setSavedIds] = useState<string[]>(() => {
    const saved = localStorage.getItem('curator_saved_ids');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { /* ignore */ }
    }
    return [];
  });

  const [likedIds, setLikedIds] = useState<string[]>(() => {
    const saved = localStorage.getItem('curator_liked_ids');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { /* ignore */ }
    }
    return [];
  });

  const [signals, setSignals] = useState<{ more: string[]; less: string[]; moreIds?: string[]; lessIds?: string[] }>(() => {
    const saved = localStorage.getItem('curator_signals');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return {
          more: Array.isArray(parsed.more) ? parsed.more : [],
          less: Array.isArray(parsed.less) ? parsed.less : [],
          moreIds: Array.isArray(parsed.moreIds) ? parsed.moreIds : [],
          lessIds: Array.isArray(parsed.lessIds) ? parsed.lessIds : [],
        };
      } catch (e) { /* ignore */ }
    }
    return { more: [], less: [], moreIds: [], lessIds: [] };
  });

  // Settings
  const [serendipityDial, setSerendipityDial] = useState<number>(() => {
    const saved = localStorage.getItem('curator_serendipity');
    return saved ? Number(saved) : 25;
  });
  const [deliveryTime, setDeliveryTime] = useState<string>(() => localStorage.getItem('curator_delivery_time') || '07:00');
  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem('curator_notifications');
    return saved !== null ? JSON.parse(saved) : true;
  });
  const [itemCount, setItemCount] = useState<number>(() => {
    const saved = localStorage.getItem('curator_item_count');
    return saved ? Number(saved) : 6;
  });

  // Free tier & status
  const [freeTierInfo, setFreeTierInfo] = useState<{ limit: number; used: number; remaining: number; percentRemaining: number }>({
    limit: 10000,
    used: 156,
    remaining: 9844,
    percentRemaining: 98.4
  });

  // UI helpers
  const [loadingDigest, setLoadingDigest] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Add source modal state
  const [showAddSourceModal, setShowAddSourceModal] = useState<boolean>(false);
  const [newSourceTitle, setNewSourceTitle] = useState<string>('');
  const [newSourceUrl, setNewSourceUrl] = useState<string>('');
  const [newSourceFolder, setNewSourceFolder] = useState<string>('General');

  // OPML Import state
  const [importText, setImportText] = useState<string>('');
  const [importFileName, setImportFileName] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [isDraggingOpml, setIsDraggingOpml] = useState<boolean>(false);
  const [isImportingOpml, setIsImportingOpml] = useState<boolean>(false);
  const [showImportModal, setShowImportModal] = useState<boolean>(false);
  const [importResult, setImportResult] = useState<{
    totalImported: number;
    successCount: number;
    failCount: number;
    failures?: Array<{ title: string; reason: string }>;
  } | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  // Google Search & RSS investigation state
  const [discoverQuery, setDiscoverQuery] = useState<string>('');
  const [isDiscovering, setIsDiscovering] = useState<boolean>(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [discoverResults, setDiscoverResults] = useState<DiscoveredSource[]>([]);
  const [discoverGroundingLinks, setDiscoverGroundingLinks] = useState<Array<{ title: string; uri: string }>>([]);
  const [hasSearchedSources, setHasSearchedSources] = useState<boolean>(false);

  // Reading view timer & depth tracking
  const [readingStartTime, setReadingStartTime] = useState<number | null>(null);

  useEffect(() => {
    localStorage.setItem('curator_sources', JSON.stringify(sources));
  }, [sources]);

  useEffect(() => {
    localStorage.setItem('curator_saved_ids', JSON.stringify(savedIds));
  }, [savedIds]);

  useEffect(() => {
    localStorage.setItem('curator_liked_ids', JSON.stringify(likedIds));
  }, [likedIds]);

  useEffect(() => {
    localStorage.setItem('curator_signals', JSON.stringify(signals));
  }, [signals]);

  useEffect(() => {
    localStorage.setItem('curator_serendipity', serendipityDial.toString());
  }, [serendipityDial]);

  useEffect(() => {
    localStorage.setItem('curator_delivery_time', deliveryTime);
  }, [deliveryTime]);

  useEffect(() => {
    localStorage.setItem('curator_notifications', JSON.stringify(notificationsEnabled));
  }, [notificationsEnabled]);

  useEffect(() => {
    localStorage.setItem('curator_item_count', itemCount.toString());
  }, [itemCount]);

  useEffect(() => {
    fetchStatus();
    generateDigest();
  }, [itemCount, serendipityDial]);

  useEffect(() => {
    if (activeTab === 'feeds') {
      fetchFeedStream(selectedFeedSource || 'all');
    }
  }, [activeTab, selectedFeedSource]);

  const fetchFeedStream = async (sourceTitle?: string) => {
    setLoadingFeedStream(true);
    try {
      const res = await fetch('/api/feed-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceTitle: sourceTitle || 'all' })
      });
      const data = await res.json();
      if (data.articles) {
        setFeedStreamArticles(data.articles);
      }
    } catch (e) {
      // fallback
    } finally {
      setLoadingFeedStream(false);
    }
  };

  const handleOpenFeedStream = (sourceTitle: string) => {
    setSelectedFeedSource(sourceTitle);
    setActiveTab('feeds');
    fetchFeedStream(sourceTitle);
  };

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      if (data.freeTier) {
        setFreeTierInfo(data.freeTier);
      }
    } catch (e) {
      // offline
    }
  };

  const generateDigest = async () => {
    setLoadingDigest(true);
    try {
      let readingStats = {};
      try {
        readingStats = JSON.parse(localStorage.getItem('curator_reading_stats') || '{}');
      } catch (e) { /* ignore */ }

      const res = await fetch('/api/curate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sources, signals, readingStats, serendipityDial, itemCount })
      });
      const data = await res.json();
      if (data.digest) {
        // Attach realistic imagery matching the design aesthetic
        const enhanced = data.digest.map((item: DigestItem, idx: number) => {
          const banners = [
            '/assets/aistudio/IMG_0653_a0a9ce59.png',
            'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1200&q=80',
            'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1200&q=80',
            'https://images.unsplash.com/photo-1513694203232-719a280e022f?auto=format&fit=crop&w=1200&q=80',
            'https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1200&q=80',
            'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?auto=format&fit=crop&w=1200&q=80',
            'https://images.unsplash.com/photo-1507679799987-c73779587ccf?auto=format&fit=crop&w=1200&q=80'
          ];
          return {
            ...item,
            bannerImage: item.bannerImage || banners[idx % banners.length]
          };
        });
        setDigest(enhanced);
      }
      fetchStatus();
    } catch (e) {
      // fallback
    } finally {
      setLoadingDigest(false);
    }
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleMore = (item: DigestItem) => {
    const alreadyMore = signals.moreIds?.includes(item.id);
    if (alreadyMore) {
      setSignals(prev => ({
        ...prev,
        more: prev.more.filter(s => s !== item.source),
        moreIds: (prev.moreIds || []).filter(id => id !== item.id),
      }));
      showToast(`Cleared preference for "${item.source}"`);
      return;
    }

    setSignals(prev => ({
      more: Array.from(new Set([...prev.more, item.source])),
      less: prev.less.filter(s => s !== item.source),
      moreIds: Array.from(new Set([...(prev.moreIds || []), item.id])),
      lessIds: (prev.lessIds || []).filter(id => id !== item.id),
    }));
    showToast(`Noted: More like "${item.source}"`);
  };

  const handleLess = (item: DigestItem) => {
    setSignals(prev => ({
      more: prev.more.filter(s => s !== item.source),
      less: Array.from(new Set([...prev.less, item.source])),
      moreIds: (prev.moreIds || []).filter(id => id !== item.id),
      lessIds: Array.from(new Set([...(prev.lessIds || []), item.id])),
    }));
    setDigest(prev => prev.filter(d => d.id !== item.id));
    if (selectedArticle?.id === item.id) {
      setSelectedArticle(null);
    }
    showToast(`Quietened: Less from "${item.source}"`);
  };

  const handleSave = (item: DigestItem) => {
    if (savedIds.includes(item.id)) {
      setSavedIds(prev => prev.filter(id => id !== item.id));
      showToast('Removed from saved');
    } else {
      setSavedIds(prev => [...prev, item.id]);
      showToast('Saved for later');
    }
  };

  const handleLike = (item: DigestItem) => {
    if (likedIds.includes(item.id)) {
      setLikedIds(prev => prev.filter(id => id !== item.id));
    } else {
      setLikedIds(prev => [...prev, item.id]);
      showToast('Liked item');
    }
  };

  const handleAddSource = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSourceTitle || !newSourceUrl) return;
    const newSrc: SourceItem = {
      id: 'src_' + Date.now(),
      title: newSourceTitle,
      feedUrl: newSourceUrl,
      folder: newSourceFolder || 'General',
      status: 'active'
    };
    setSources(prev => [newSrc, ...prev]);
    setNewSourceTitle('');
    setNewSourceUrl('');
    setShowAddSourceModal(false);
    showToast('Source added successfully');
  };

  const handleDeleteSource = (id: string) => {
    setSources(prev => prev.filter(s => s.id !== id));
    showToast('Source removed');
  };

  const processOpmlText = async (rawText: string) => {
    if (!rawText.trim()) return;
    setIsImportingOpml(true);
    setImportError(null);
    setImportResult(null);
    try {
      const res = await fetch('/api/parse-opml', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ opmlText: rawText })
      });
      const data = await res.json();
      if (!res.ok) {
        setImportError(data.error || 'Could not parse subscription file.');
        return;
      }
      if (data.success && data.sources) {
        setSources(data.sources);
        setImportResult({
          totalImported: data.totalImported,
          successCount: data.successCount,
          failCount: data.failCount,
          failures: data.failures || []
        });
        showToast(`Imported ${data.totalImported} sources with folders intact`);
      }
    } catch (e) {
      setImportError('Error uploading or parsing subscription file.');
    } finally {
      setIsImportingOpml(false);
    }
  };

  const handleImportOPML = async () => {
    await processOpmlText(importText);
  };

  const handleOpmlFileSelected = async (file: File) => {
    setImportFileName(file.name);
    setImportError(null);
    try {
      const text = await file.text();
      setImportText(text);
      await processOpmlText(text);
    } catch (e) {
      setImportError('Could not read the selected file.');
    }
  };

  const openImportModal = () => {
    setImportError(null);
    setImportResult(null);
    setImportFileName(null);
    setShowImportModal(true);
  };

  const handleDiscoverSources = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = discoverQuery.trim();
    if (!q) return;
    setIsDiscovering(true);
    setDiscoverError(null);
    setHasSearchedSources(true);
    try {
      const res = await fetch('/api/discover-sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q })
      });
      const data = await res.json();
      if (!res.ok) {
        setDiscoverError(data.error || 'Search failed.');
        setDiscoverResults([]);
        setDiscoverGroundingLinks([]);
        return;
      }
      setDiscoverResults(Array.isArray(data.results) ? data.results : []);
      setDiscoverGroundingLinks(Array.isArray(data.groundingLinks) ? data.groundingLinks : []);
      fetchStatus();
    } catch (err) {
      setDiscoverError('Could not reach the search service.');
      setDiscoverResults([]);
    } finally {
      setIsDiscovering(false);
    }
  };

  const handleAddDiscoveredSource = (item: DiscoveredSource) => {
    if (!item.feedUrl) return;
    const normalizedFeedUrl = item.feedUrl.trim().toLowerCase();
    const alreadyExists = sources.some(s => s.feedUrl.trim().toLowerCase() === normalizedFeedUrl);
    if (alreadyExists) {
      showToast(`"${item.title}" is already in your sources`);
      return;
    }

    const newSrc: SourceItem = {
      id: 'src_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      title: item.title,
      feedUrl: item.feedUrl,
      folder: item.folder || 'Discovered',
      status: 'active'
    };
    setSources(prev => [newSrc, ...prev]);
    showToast(
      item.rssStatus === 'generatable'
        ? `Generated RSS and added "${item.title}"`
        : `Added "${item.title}" to ${newSrc.folder}`
    );
  };

  const handleExportOPML = () => {
    const opmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="1.0">
  <head>
    <title>Curator Subscriptions Export</title>
  </head>
  <body>
    ${sources.map(s => `<outline text="${s.title}" title="${s.title}" type="rss" xmlUrl="${s.feedUrl}" category="${s.folder}"/>`).join('\n    ')}
  </body>
</opml>`;
    const blob = new Blob([opmlContent], { type: 'text/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'curator_subscriptions.opml';
    a.click();
    showToast('Subscription list exported successfully');
  };

  const openArticle = (item: DigestItem) => {
    setSelectedArticle(item);
    setRecentReadItem(item);
    setShowKeepReading(true);
    setReadingStartTime(Date.now());
  };

  const closeArticle = () => {
    setSelectedArticle(null);
  };

  const sourcesByFolder = sources.reduce((acc, src) => {
    const folder = src.folder || 'Uncategorized';
    if (!acc[folder]) acc[folder] = [];
    acc[folder].push(src);
    return acc;
  }, {} as Record<string, SourceItem[]>);

  const savedDigestItems = digest.filter(d => savedIds.includes(d.id));
  const normalDigest = digest.filter(d => !d.isOutOfBubble);
  const outOfBubbleDigest = digest.filter(d => d.isOutOfBubble);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-slate-800 selection:text-white">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] bg-slate-900 border border-slate-800 text-slate-200 text-xs px-4 py-2.5 rounded-full shadow-2xl flex items-center gap-2 animate-fade-in">
          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Reading View Modal */}
      {selectedArticle && (
        <div 
          className="fixed inset-0 z-50 bg-slate-950 overflow-y-auto flex flex-col animate-fade-in"
          onScroll={(e) => {
            const target = e.currentTarget;
            const scrollHeight = target.scrollHeight - target.clientHeight;
            if (scrollHeight > 0 && selectedArticle) {
              const progress = Math.min(100, Math.round((target.scrollTop / scrollHeight) * 100));
              const stats = JSON.parse(localStorage.getItem('curator_reading_stats') || '{}');
              const current = stats[selectedArticle.id] || { maxDepth: 0, finished: false };
              const newMax = Math.max(current.maxDepth, progress);
              const finished = newMax >= 85 || current.finished;
              stats[selectedArticle.id] = { maxDepth: newMax, finished, lastRead: Date.now() };
              localStorage.setItem('curator_reading_stats', JSON.stringify(stats));
            }
          }}
        >
          <header className="sticky top-0 z-10 bg-slate-950/90 backdrop-blur-md border-b border-slate-800/80 px-6 py-4 flex items-center justify-between">
            <button 
              onClick={closeArticle}
              className="flex items-center gap-2 text-sm font-medium text-slate-400 hover:text-slate-100 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Digest</span>
            </button>
            <div className="flex items-center gap-3">
              <button 
                onClick={() => handleSave(selectedArticle)}
                className={`p-2 rounded-lg border transition-colors ${savedIds.includes(selectedArticle.id) ? 'bg-amber-500/10 border-amber-500/30 text-amber-400' : 'border-slate-800 text-slate-400 hover:text-slate-100'}`}
                title="Save for later"
              >
                <Bookmark className="w-4 h-4" />
              </button>
            </div>
          </header>

          <main className="max-w-2xl mx-auto w-full px-6 py-12 flex-1">
            <div className="text-xs text-slate-400 mb-3 flex items-center gap-2">
              <span className="font-medium text-slate-300">{selectedArticle.source}</span>
              <span aria-hidden="true">·</span>
              <span>{selectedArticle.folder}</span>
              <span aria-hidden="true">·</span>
              <span>{selectedArticle.readTime}</span>
            </div>

            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-slate-100 mb-6 leading-snug">
              {selectedArticle.title}
            </h1>

            {/* Why this is here note */}
            <div className="mb-8 p-4 rounded-xl bg-slate-900/60 border border-slate-800 text-sm text-slate-300 flex items-start gap-3">
              <Sparkles className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <span className="text-xs uppercase tracking-wider text-slate-500 block mb-0.5">Why this was chosen for you</span>
                <span>{selectedArticle.why}</span>
              </div>
            </div>

            <div className="prose prose-invert prose-slate max-w-none text-slate-300 leading-relaxed space-y-6 text-base font-serif">
              {selectedArticle.fullText.split('\n\n').map((paragraph, idx) => (
                <p key={idx}>{paragraph}</p>
              ))}
            </div>

            <div className="mt-12 pt-8 border-t border-slate-900 flex flex-col sm:flex-row items-center justify-between gap-4">
              <span className="text-xs text-slate-300 font-sans">End of article. How was this selection?</span>
              <div className="flex flex-wrap items-center gap-2 font-sans">
                <button 
                  type="button"
                  onClick={() => handleMore(selectedArticle)}
                  className={`px-4 py-2.5 text-xs font-medium rounded-lg border transition flex items-center gap-1.5 ${
                    signals.moreIds?.includes(selectedArticle.id) || signals.more.includes(selectedArticle.source)
                      ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                      : 'bg-slate-900 border-slate-800 text-slate-300 hover:text-slate-100 hover:bg-slate-800'
                  }`}
                >
                  <ThumbsUp className="w-3.5 h-3.5" />
                  <span>{signals.moreIds?.includes(selectedArticle.id) ? 'More like this ✓' : 'More like this'}</span>
                </button>
                <button 
                  type="button"
                  onClick={() => handleLess(selectedArticle)}
                  className="px-4 py-2.5 text-xs font-medium rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-rose-300 hover:border-rose-500/30 hover:bg-rose-500/10 transition flex items-center gap-1.5"
                >
                  <ThumbsDown className="w-3.5 h-3.5" />
                  <span>Less like this</span>
                </button>
                <button 
                  type="button"
                  onClick={() => handleSave(selectedArticle)}
                  className={`px-4 py-2.5 text-xs font-medium rounded-lg border transition flex items-center gap-1.5 ${
                    savedIds.includes(selectedArticle.id)
                      ? 'bg-amber-500/15 border-amber-500/40 text-amber-400'
                      : 'bg-slate-900 border-slate-800 text-slate-300 hover:text-slate-100 hover:bg-slate-800'
                  }`}
                >
                  <Bookmark className="w-3.5 h-3.5" />
                  <span>{savedIds.includes(selectedArticle.id) ? 'Saved' : 'Save for later'}</span>
                </button>
              </div>
            </div>
          </main>
        </div>
      )}

      {/* Main App Layout */}
      <header className="sticky top-0 z-30 bg-slate-950/95 backdrop-blur-md border-b border-slate-900/80 px-5 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-orange-500 shadow-sm">
            <Bookmark className="w-5 h-5 fill-orange-500 text-orange-500" />
          </div>
          <div>
            <h1 className="text-base font-semibold tracking-tight text-slate-100 leading-none">Curator</h1>
            <p className="text-xs text-slate-400 mt-1">Your morning reading editor</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button 
            type="button"
            onClick={() => setActiveTab('sources')}
            className="w-9 h-9 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-300 hover:text-slate-100 transition"
            title="Search and discover sources"
          >
            <Search className="w-4 h-4" />
          </button>
          <button 
            type="button"
            onClick={generateDigest}
            disabled={loadingDigest}
            className="w-9 h-9 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-300 hover:text-slate-100 transition disabled:opacity-50"
            title="Refresh today's digest"
          >
            <RefreshCw className={`w-4 h-4 ${loadingDigest ? 'animate-spin' : ''}`} />
          </button>
          <div className="w-9 h-9 rounded-full bg-slate-900 border border-slate-800 p-0.5 overflow-hidden flex items-center justify-center">
            <div className="w-full h-full rounded-full bg-gradient-to-tr from-amber-500 to-rose-500 flex items-center justify-center text-[10px] font-bold text-slate-950">
              ME
            </div>
          </div>
        </div>
      </header>

      {/* Content Area */}
      <main className="flex-1 max-w-3xl w-full mx-auto px-6 py-8 pb-32">
        {/* TAB 1: TODAY */}
        {activeTab === 'today' && (
          <div className="space-y-6 animate-fade-in">
            {/* Top Circular Source Stories Carousel (Links through to separate article stream) */}
            <div className="overflow-x-auto no-scrollbar py-2 -mx-6 px-6">
              <div className="flex items-center gap-4 min-w-max">
                {sources.slice(0, 10).map((src, idx) => (
                  <button
                    key={src.id}
                    type="button"
                    onClick={() => handleOpenFeedStream(src.title)}
                    className="flex flex-col items-center gap-2 group cursor-pointer focus:outline-none"
                    title={`Open ${src.title} article stream`}
                  >
                    <div className="relative w-16 h-16 rounded-full p-0.5 bg-gradient-to-tr from-amber-500 to-rose-500 shadow-md group-hover:scale-105 transition-transform">
                      <div className="w-full h-full rounded-full bg-slate-900 flex items-center justify-center overflow-hidden border-2 border-slate-950">
                        <span className="text-xs font-bold text-slate-200">
                          {src.title.slice(0, 2).toUpperCase()}
                        </span>
                      </div>
                      {idx % 2 === 0 && (
                        <div className="absolute top-0 right-0 w-3.5 h-3.5 rounded-full bg-orange-500 border-2 border-slate-950" />
                      )}
                    </div>
                    <span className="text-[11px] text-slate-300 font-medium max-w-[72px] truncate text-center group-hover:text-amber-300 transition-colors">
                      {src.title.split(' ')[0]}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between border-b border-slate-900 pt-4 pb-4">
              <div>
                <h2 className="text-xl font-semibold tracking-tight text-slate-100">Today's Digest</h2>
                <p className="text-xs text-slate-400 mt-0.5">Curated at 7:00 AM · {digest.length} items worth your time</p>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span>Show:</span>
                {[5, 6, 8, 10].map(num => (
                  <button
                    key={num}
                    onClick={() => setItemCount(num)}
                    className={`px-2.5 py-1 rounded-lg font-medium transition ${itemCount === num ? 'bg-slate-800 text-slate-100 shadow-inner' : 'text-slate-400 hover:text-slate-200'}`}
                  >
                    {num}
                  </button>
                ))}
              </div>
            </div>

            {loadingDigest && digest.length === 0 ? (
              <div className="py-20 text-center text-slate-500 space-y-3">
                <RefreshCw className="w-6 h-6 animate-spin mx-auto text-amber-500" />
                <p className="text-sm">Synthesizing your morning reading list...</p>
              </div>
            ) : digest.length === 0 ? (
              <div className="py-20 text-center text-slate-500 space-y-2">
                <p className="text-sm">No new items today. Your sources are quiet.</p>
                <button onClick={generateDigest} className="text-xs text-amber-400 underline">Generate sample digest</button>
              </div>
            ) : (
              <div className="space-y-8">
                {/* Normal Curated Cards */}
                {normalDigest.map((item) => (
                  <article 
                    key={item.id}
                    onClick={() => openArticle(item)}
                    className="group rounded-3xl bg-slate-900/60 border border-slate-900 hover:border-slate-800/80 overflow-hidden transition cursor-pointer shadow-xl relative"
                  >
                    {/* Author sub-header with Substack branding */}
                    <div className="p-5 pb-3 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-amber-500/20 to-orange-500/20 border border-slate-800 flex items-center justify-center text-xs font-bold text-amber-400 shrink-0">
                          {item.source.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div className="text-xs font-bold text-slate-100 flex items-center gap-1.5">
                            <span>{item.source}</span>
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {item.publishedAt || '30m'} · {item.folder} · {item.readTime}
                          </div>
                        </div>
                      </div>
                      <span className="text-orange-500 font-semibold text-xs flex items-center gap-1 font-mono tracking-wide">
                        <span className="font-black text-sm">≡</span>substack
                      </span>
                    </div>

                    {/* Author hook quote above card if available */}
                    {item.quote && (
                      <p className="px-5 pb-3 text-sm md:text-base text-slate-100 font-medium leading-snug">
                        {item.quote}
                      </p>
                    )}

                    {/* Billboard Hero Image Card with Bookmark Save Button right on image */}
                    {item.bannerImage && (
                      <div className="relative mx-3.5 rounded-2xl overflow-hidden h-60 md:h-72 shadow-lg border border-slate-800/40">
                        <img 
                          src={item.bannerImage} 
                          alt={item.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/45 to-transparent" />
                        
                        {/* Bookmark button in bottom right corner of image */}
                        <div className="absolute bottom-4 right-4 z-10">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleSave(item); }}
                            className={`p-2.5 rounded-xl backdrop-blur-md border transition shadow-lg ${
                              savedIds.includes(item.id)
                                ? 'bg-amber-500/20 border-amber-500/40 text-amber-400'
                                : 'bg-slate-950/70 border-slate-700/60 text-slate-200 hover:text-amber-400 hover:bg-slate-900/90'
                            }`}
                            title="Save for later"
                          >
                            <Bookmark className={`w-4 h-4 ${savedIds.includes(item.id) ? 'fill-amber-400 text-amber-400' : ''}`} />
                          </button>
                        </div>

                        {/* Title and summary overlay on bottom of image */}
                        <div className="absolute bottom-4 left-4 right-16">
                          <div className="text-[10px] uppercase font-bold tracking-wider text-amber-400/90 mb-1">
                            {item.folder}
                          </div>
                          <h3 className="text-lg md:text-xl font-bold tracking-tight text-white leading-snug drop-shadow-sm group-hover:text-amber-300 transition-colors">
                            {item.title}
                          </h3>
                          <p className="text-xs text-slate-300 mt-1 line-clamp-1">
                            {item.summary}
                          </p>
                        </div>
                      </div>
                    )}

                    <div className="p-5 space-y-4 pt-4">
                      {!item.bannerImage && (
                        <div>
                          <h3 className="text-xl font-bold tracking-tight text-slate-100 group-hover:text-amber-300 transition-colors">
                            {item.title}
                          </h3>
                          <p className="text-sm text-slate-400 mt-1 line-clamp-2">
                            {item.summary}
                          </p>
                        </div>
                      )}

                      {/* Why this is here note */}
                      <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 text-xs text-slate-300 flex items-start gap-2.5">
                        <Sparkles className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                        <div>
                          <span className="text-[10px] uppercase tracking-wider text-slate-400 block mb-0.5">Why this was chosen for you</span>
                          <span className="italic">{item.why}</span>
                        </div>
                      </div>

                      {/* Social engagement row (heart, comments, repost, share) */}
                      <div className="pt-2 flex items-center justify-between text-xs text-slate-400">
                        <div className="flex items-center gap-5">
                          <button 
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleLike(item); }}
                            className="flex items-center gap-1.5 text-slate-400 hover:text-rose-400 transition"
                          >
                            <Heart className={`w-4 h-4 ${likedIds.includes(item.id) ? 'fill-rose-500 text-rose-500' : ''}`} />
                            <span className="text-[11px]">{likedIds.includes(item.id) ? '2' : '1'}</span>
                          </button>
                          <button 
                            type="button"
                            onClick={(e) => { e.stopPropagation(); openArticle(item); }}
                            className="flex items-center gap-1.5 text-slate-400 hover:text-slate-200 transition"
                          >
                            <MessageSquare className="w-4 h-4" />
                            <span className="text-[11px]">1</span>
                          </button>
                          <button 
                            type="button"
                            onClick={(e) => { 
                              e.stopPropagation(); 
                              setRepostIds(prev => prev.includes(item.id) ? prev.filter(x => x !== item.id) : [...prev, item.id]);
                              showToast('Quoted in your daily notebook');
                            }}
                            className={`flex items-center gap-1.5 transition ${repostIds.includes(item.id) ? 'text-emerald-400' : 'text-slate-400 hover:text-slate-200'}`}
                          >
                            <Repeat className="w-4 h-4" />
                          </button>
                          <button 
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigator.clipboard.writeText(item.url || window.location.href);
                              showToast('Article link copied to clipboard');
                            }}
                            className="flex items-center gap-1.5 text-slate-400 hover:text-slate-200 transition"
                            title="Share article link"
                          >
                            <Share2 className="w-4 h-4" />
                          </button>
                        </div>

                        {/* Curation actions: More like this / Less like this */}
                        <div className="flex items-center gap-2">
                          <button 
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleMore(item); }}
                            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-[11px] transition ${
                              signals.moreIds?.includes(item.id) || signals.more.includes(item.source)
                                ? 'bg-amber-500/15 border-amber-500/40 text-amber-300 font-medium'
                                : 'bg-slate-900 border-slate-800 text-slate-300 hover:text-slate-100 hover:bg-slate-800'
                            }`}
                            title="More like this"
                          >
                            <ThumbsUp className="w-3 h-3" />
                            <span>{signals.moreIds?.includes(item.id) ? 'More ✓' : 'More'}</span>
                          </button>
                          <button 
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleLess(item); }}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-rose-300 hover:border-rose-500/30 hover:bg-rose-500/10 text-[11px] transition"
                            title="Less like this"
                          >
                            <ThumbsDown className="w-3 h-3" />
                            <span>Less</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </article>
                ))}

                {/* Out of Bubble Stretch Section */}
                {outOfBubbleDigest.length > 0 && (
                  <div className="pt-6 space-y-6">
                    <div className="flex items-center gap-2 border-b border-slate-900 pb-3">
                      <Sparkles className="w-4 h-4 text-rose-400" />
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-rose-400">
                        Deliberate Stretch — Outside Your Usual Bubble
                      </h3>
                    </div>

                    {outOfBubbleDigest.map((item) => (
                      <article 
                        key={item.id}
                        onClick={() => openArticle(item)}
                        className="group rounded-3xl bg-rose-950/10 border border-rose-900/30 hover:border-rose-800/50 overflow-hidden transition cursor-pointer shadow-xl relative"
                      >
                        <div className="p-5 pb-3 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-rose-500/25 border border-rose-900 flex items-center justify-center text-xs font-bold text-rose-300 shrink-0">
                              {item.source.slice(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <div className="text-xs font-bold text-rose-200">{item.source}</div>
                              <div className="text-[11px] text-rose-400/80">{item.folder} · {item.readTime}</div>
                            </div>
                          </div>
                          <span className="text-[10px] uppercase font-mono tracking-wider bg-rose-900/30 text-rose-300 px-2.5 py-0.5 rounded-full border border-rose-800/40">
                            Stretch
                          </span>
                        </div>

                        {item.quote && (
                          <p className="px-5 pb-3 text-sm md:text-base text-rose-100 font-medium leading-snug">
                            {item.quote}
                          </p>
                        )}

                        {item.bannerImage && (
                          <div className="relative mx-3.5 rounded-2xl overflow-hidden h-60 md:h-64 shadow-lg border border-rose-900/30">
                            <img 
                              src={item.bannerImage} 
                              alt={item.title}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/40 to-transparent" />
                            
                            <div className="absolute bottom-4 right-4 z-10">
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); handleSave(item); }}
                                className={`p-2.5 rounded-xl backdrop-blur-md border transition shadow-lg ${
                                  savedIds.includes(item.id)
                                    ? 'bg-amber-500/20 border-amber-500/40 text-amber-400'
                                    : 'bg-slate-950/70 border-rose-800/60 text-slate-200 hover:text-amber-400'
                                }`}
                                title="Save for later"
                              >
                                <Bookmark className={`w-4 h-4 ${savedIds.includes(item.id) ? 'fill-amber-400 text-amber-400' : ''}`} />
                              </button>
                            </div>

                            <div className="absolute bottom-4 left-4 right-16">
                              <div className="text-[10px] uppercase font-bold tracking-wider text-rose-400/90 mb-1">
                                Deliberate Stretch · {item.folder}
                              </div>
                              <h3 className="text-lg md:text-xl font-bold tracking-tight text-white leading-snug group-hover:text-rose-300 transition-colors">
                                {item.title}
                              </h3>
                              <p className="text-xs text-rose-200/80 mt-1 line-clamp-1">
                                {item.summary}
                              </p>
                            </div>
                          </div>
                        )}

                        <div className="p-5 space-y-4 pt-4">
                          {!item.bannerImage && (
                            <div>
                              <h3 className="text-xl font-bold tracking-tight text-slate-100 group-hover:text-rose-300 transition-colors">
                                {item.title}
                              </h3>
                              <p className="text-sm text-slate-400 mt-1 line-clamp-2">
                                {item.summary}
                              </p>
                            </div>
                          )}

                          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-rose-900/30 text-xs text-rose-200/90 flex items-start gap-2.5">
                            <Sparkles className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                            <div>
                              <span className="text-[10px] uppercase tracking-wider text-rose-400 block mb-0.5">Why this was chosen for you</span>
                              <span className="italic">{item.why}</span>
                            </div>
                          </div>

                          <div className="pt-2 flex items-center justify-between text-xs text-slate-400">
                            <div className="flex items-center gap-5">
                              <button 
                                type="button"
                                onClick={(e) => { e.stopPropagation(); handleLike(item); }}
                                className="flex items-center gap-1.5 text-slate-400 hover:text-rose-400 transition"
                              >
                                <Heart className={`w-4 h-4 ${likedIds.includes(item.id) ? 'fill-rose-500 text-rose-500' : ''}`} />
                                <span className="text-[11px]">{likedIds.includes(item.id) ? '2' : '1'}</span>
                              </button>
                              <button 
                                type="button"
                                onClick={(e) => { e.stopPropagation(); openArticle(item); }}
                                className="flex items-center gap-1.5 text-slate-400 hover:text-slate-200 transition"
                              >
                                <MessageSquare className="w-4 h-4" />
                                <span className="text-[11px]">1</span>
                              </button>
                              <button 
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setRepostIds(prev => prev.includes(item.id) ? prev.filter(x => x !== item.id) : [...prev, item.id]);
                                  showToast('Quoted in your daily notebook');
                                }}
                                className={`flex items-center gap-1.5 transition ${repostIds.includes(item.id) ? 'text-emerald-400' : 'text-slate-400 hover:text-slate-200'}`}
                              >
                                <Repeat className="w-4 h-4" />
                              </button>
                              <button 
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigator.clipboard.writeText(item.url || window.location.href);
                                  showToast('Article link copied to clipboard');
                                }}
                                className="flex items-center gap-1.5 text-slate-400 hover:text-slate-200 transition"
                                title="Share article link"
                              >
                                <Share2 className="w-4 h-4" />
                              </button>
                            </div>

                            <div className="flex items-center gap-2">
                              <button 
                                type="button"
                                onClick={(e) => { e.stopPropagation(); handleMore(item); }}
                                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-[11px] transition ${
                                  signals.moreIds?.includes(item.id) || signals.more.includes(item.source)
                                    ? 'bg-amber-500/15 border-amber-500/40 text-amber-300 font-medium'
                                    : 'bg-slate-900 border-slate-800 text-slate-300 hover:text-slate-100 hover:bg-slate-800'
                                }`}
                                title="More like this"
                              >
                                <ThumbsUp className="w-3 h-3" />
                                <span>{signals.moreIds?.includes(item.id) ? 'More ✓' : 'More'}</span>
                              </button>
                              <button 
                                type="button"
                                onClick={(e) => { e.stopPropagation(); handleLess(item); }}
                                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-rose-300 hover:border-rose-500/30 hover:bg-rose-500/10 text-[11px] transition"
                                title="Less like this"
                              >
                                <ThumbsDown className="w-3 h-3" />
                                <span>Less</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: SAVED */}
        {activeTab === 'saved' && (
          <div className="space-y-6 animate-fade-in">
            <div className="border-b border-slate-900 pb-4">
              <h2 className="text-xl font-semibold tracking-tight text-slate-100">Saved Items</h2>
              <p className="text-xs text-slate-400 mt-0.5">Your personal re-reading queue ({savedDigestItems.length})</p>
            </div>

            {savedDigestItems.length === 0 ? (
              <div className="py-20 text-center text-slate-500 space-y-2">
                <Bookmark className="w-8 h-8 mx-auto text-slate-700 mb-2" />
                <p className="text-sm">No saved items yet.</p>
                <p className="text-xs text-slate-600">Tap the bookmark icon on any digest item to save it here.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {savedDigestItems.map((item) => (
                  <article 
                    key={item.id}
                    onClick={() => openArticle(item)}
                    className="p-5 rounded-2xl bg-slate-900/40 border border-slate-900 hover:border-slate-800 transition cursor-pointer space-y-3"
                  >
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-300">{item.source}</span>
                        <span aria-hidden="true">·</span>
                        <span>{item.readTime}</span>
                      </div>
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleSave(item); }}
                        className="text-xs text-amber-400 hover:underline"
                      >
                        Unsave
                      </button>
                    </div>

                    <h3 className="text-base font-medium text-slate-100 hover:text-amber-300 transition">
                      {item.title}
                    </h3>
                    <p className="text-xs text-slate-400 line-clamp-1">{item.summary}</p>
                  </article>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: SOURCES */}
        {activeTab === 'sources' && (
          <div className="space-y-8 animate-fade-in">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-900 pb-4">
              <div>
                <h2 className="text-xl font-semibold tracking-tight text-slate-100">Watched Sources</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  {sources.length} sources across {Object.keys(sourcesByFolder).length} folders · {sources.filter(s => s.status === 'failing').length} failing
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button 
                  onClick={openImportModal}
                  className="px-3 py-1.5 text-xs font-medium rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-slate-100 transition flex items-center gap-1.5"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Import OPML</span>
                </button>
                <button 
                  onClick={handleExportOPML}
                  className="px-3 py-1.5 text-xs font-medium rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-slate-100 transition flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export</span>
                </button>
                <button 
                  onClick={() => setShowAddSourceModal(true)}
                  className="px-3 py-1.5 text-xs font-medium rounded-xl bg-amber-500 text-slate-950 font-semibold hover:bg-amber-400 transition flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Source</span>
                </button>
              </div>
            </div>

            {/* Google Search & RSS Investigation Tool */}
            <section className="p-5 rounded-3xl bg-slate-900/40 border border-slate-900 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                    <Search className="w-4 h-4 text-amber-400" />
                    <span>Find Sources &amp; Check RSS Availability</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Search the web for writers or publications. Each result is checked for native RSS/Atom feeds or whether an RSS feed can be generated.
                  </p>
                </div>
                {hasSearchedSources && (
                  <button
                    type="button"
                    onClick={() => {
                      setHasSearchedSources(false);
                      setDiscoverResults([]);
                      setDiscoverGroundingLinks([]);
                      setDiscoverError(null);
                    }}
                    className="text-xs text-slate-400 hover:text-slate-200 shrink-0"
                  >
                    Clear
                  </button>
                )}
              </div>

              <form onSubmit={handleDiscoverSources} className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={discoverQuery}
                    onChange={e => setDiscoverQuery(e.target.value)}
                    placeholder="Search topics or publications (e.g. Byzantine history, urban water)"
                    className="w-full rounded-xl bg-slate-950 border border-slate-800 pl-10 pr-3 py-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isDiscovering || !discoverQuery.trim()}
                  className="px-4 py-2.5 text-xs font-semibold rounded-xl bg-amber-500 text-slate-950 hover:bg-amber-400 transition disabled:opacity-50 whitespace-nowrap shrink-0 flex items-center justify-center gap-1.5"
                >
                  {isDiscovering ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Investigating...</span>
                    </>
                  ) : (
                    <>
                      <Globe className="w-3.5 h-3.5" />
                      <span>Search &amp; Check RSS</span>
                    </>
                  )}
                </button>
              </form>

              {discoverError && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
                  <span>{discoverError}</span>
                </div>
              )}

              {hasSearchedSources && !isDiscovering && !discoverError && discoverResults.length === 0 && (
                <p className="text-xs text-slate-400 py-2">
                  No matching publications found for those search terms. Try broader keywords.
                </p>
              )}

              {discoverResults.length > 0 && (
                <div className="space-y-3 pt-1">
                  {discoverResults.map((item, idx) => {
                    const isAdded =
                      !!item.feedUrl &&
                      sources.some(s => s.feedUrl.trim().toLowerCase() === item.feedUrl!.trim().toLowerCase());

                    return (
                      <div
                        key={`${item.siteUrl}-${idx}`}
                        className="p-4 rounded-2xl bg-slate-950/70 border border-slate-800/80 space-y-2.5"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium text-slate-100">{item.title}</span>
                              <span className="text-[11px] text-slate-400">· {item.folder}</span>
                            </div>
                            <a
                              href={item.siteUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-slate-400 hover:text-amber-400 transition inline-flex items-center gap-1 mt-0.5 break-all"
                            >
                              <span>{item.siteUrl}</span>
                              <ExternalLink className="w-3 h-3 shrink-0" />
                            </a>
                          </div>

                          {item.feedUrl && (item.rssStatus === 'native' || item.rssStatus === 'generatable') ? (
                            <button
                              type="button"
                              disabled={isAdded}
                              onClick={() => handleAddDiscoveredSource(item)}
                              className={`px-3 py-1.5 text-xs font-medium rounded-xl transition flex items-center gap-1.5 shrink-0 ${
                                isAdded
                                  ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300'
                                  : item.rssStatus === 'generatable'
                                    ? 'bg-amber-500/15 border border-amber-500/40 text-amber-300 hover:bg-amber-500/25'
                                    : 'bg-amber-500 text-slate-950 font-semibold hover:bg-amber-400'
                              }`}
                            >
                              {isAdded ? (
                                <>
                                  <Check className="w-3.5 h-3.5" />
                                  <span>Added</span>
                                </>
                              ) : item.rssStatus === 'generatable' ? (
                                <>
                                  <Plus className="w-3.5 h-3.5" />
                                  <span>Generate &amp; Add RSS</span>
                                </>
                              ) : (
                                <>
                                  <Plus className="w-3.5 h-3.5" />
                                  <span>Add Feed</span>
                                </>
                              )}
                            </button>
                          ) : (
                            <span className="text-[11px] text-rose-400 font-medium shrink-0">
                              RSS unavailable
                            </span>
                          )}
                        </div>

                        {item.summary && (
                          <p className="text-xs text-slate-300">{item.summary}</p>
                        )}

                        <div className="text-xs pt-1 border-t border-slate-900 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`font-medium ${
                                item.rssStatus === 'native'
                                  ? 'text-emerald-400'
                                  : item.rssStatus === 'generatable'
                                    ? 'text-amber-400'
                                    : 'text-rose-400'
                              }`}
                            >
                              {item.feedFormat ? item.feedFormat : 'No feed'}
                            </span>
                            <span aria-hidden="true" className="text-slate-600">·</span>
                            <span className="text-slate-400">{item.investigationNote}</span>
                          </div>

                          {item.feedUrl && (
                            <div className="text-[11px] text-slate-500 font-mono truncate">
                              Feed: {item.feedUrl}
                            </div>
                          )}

                          {item.sampleTitles && item.sampleTitles.length > 0 && (
                            <div className="text-[11px] text-slate-400 pt-1">
                              Recent items: {item.sampleTitles.join(' · ')}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {discoverGroundingLinks.length > 0 && (
                    <div className="pt-2 border-t border-slate-900 text-[11px] text-slate-400 space-y-1">
                      <span className="block font-medium text-slate-300">Google Search sources</span>
                      <div className="flex flex-wrap gap-x-3 gap-y-1">
                        {discoverGroundingLinks.map((link, idx) => (
                          <a
                            key={`${link.uri}-${idx}`}
                            href={link.uri}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-slate-400 hover:text-amber-400 underline truncate max-w-[240px]"
                          >
                            {link.title || link.uri}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>

            {sources.some(s => s.status === 'failing') && (
              <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs flex items-start gap-3">
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold block mb-0.5">Some sources require attention</span>
                  <span>{sources.filter(s => s.status === 'failing').length} source is currently not responding and has been quietly bypassed in digests.</span>
                </div>
              </div>
            )}

            <div className="space-y-6">
              {Object.entries(sourcesByFolder).map(([folder, folderSources]) => (
                <div key={folder} className="space-y-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-900 pb-2">
                    {folder} ({folderSources.length})
                  </h3>
                  <div className="grid gap-2">
                    {folderSources.map((src) => (
                      <div key={src.id} className="p-4 rounded-2xl bg-slate-900/40 border border-slate-900 flex items-center justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-slate-200 truncate">{src.title}</span>
                            {src.status === 'failing' ? (
                              <span className="text-[10px] bg-rose-500/10 text-rose-400 border border-rose-500/20 px-2 py-0.5 rounded">Failing</span>
                            ) : (
                              <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded">Active</span>
                            )}
                          </div>
                          <span className="text-xs text-slate-400 truncate block mt-0.5">{src.feedUrl}</span>
                          {src.failingReason && (
                            <span className="text-xs text-rose-400 block mt-1">{src.failingReason}</span>
                          )}
                        </div>
                        <button 
                          onClick={() => handleDeleteSource(src.id)}
                          className="p-2 text-slate-500 hover:text-rose-400 transition"
                          title="Remove source"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Add Source Modal */}
            {showAddSourceModal && (
              <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4">
                <div className="w-full max-w-md rounded-3xl bg-slate-900 border border-slate-800 p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-slate-100">Add New Source</h3>
                    <button onClick={() => setShowAddSourceModal(false)} className="text-slate-400 hover:text-slate-100">
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  <form onSubmit={handleAddSource} className="space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-400 mb-1">Source Title</label>
                      <input 
                        type="text" 
                        required
                        placeholder="e.g. Marginal Revolution"
                        value={newSourceTitle}
                        onChange={e => setNewSourceTitle(e.target.value)}
                        className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-amber-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-400 mb-1">RSS / Atom Feed URL</label>
                      <input 
                        type="url" 
                        required
                        placeholder="https://example.com/feed.xml"
                        value={newSourceUrl}
                        onChange={e => setNewSourceUrl(e.target.value)}
                        className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-amber-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-400 mb-1">Folder Grouping</label>
                      <input 
                        type="text" 
                        placeholder="e.g. Economics"
                        value={newSourceFolder}
                        onChange={e => setNewSourceFolder(e.target.value)}
                        className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-amber-500"
                      />
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                      <button 
                        type="button" 
                        onClick={() => setShowAddSourceModal(false)}
                        className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-slate-200"
                      >
                        Cancel
                      </button>
                      <button 
                        type="submit"
                        className="px-4 py-2 text-xs font-medium rounded-xl bg-amber-500 text-slate-950 font-semibold hover:bg-amber-400 transition"
                      >
                        Add Source
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {/* OPML Import Modal */}
            {showImportModal && (
              <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4">
                <div className="w-full max-w-lg rounded-3xl bg-slate-900 border border-slate-800 p-6 space-y-4 max-h-[90vh] overflow-y-auto">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-slate-100">Import Subscription List (OPML)</h3>
                    <button onClick={() => setShowImportModal(false)} className="text-slate-400 hover:text-slate-100">
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  <p className="text-xs text-slate-400">
                    Upload your reader’s <span className="text-slate-200 font-medium">.opml</span> or <span className="text-slate-200 font-medium">.xml</span> export file in one step, or paste its contents below. Folders are preserved.
                  </p>

                  {/* File Upload Dropzone */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".opml,.xml,text/xml,application/xml,text/x-opml"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        handleOpmlFileSelected(file);
                      }
                      e.target.value = '';
                    }}
                  />
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => fileInputRef.current?.click()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        fileInputRef.current?.click();
                      }
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDraggingOpml(true);
                    }}
                    onDragLeave={() => setIsDraggingOpml(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDraggingOpml(false);
                      const file = e.dataTransfer.files?.[0];
                      if (file) {
                        handleOpmlFileSelected(file);
                      }
                    }}
                    className={`rounded-2xl border-2 border-dashed p-5 text-center cursor-pointer transition ${
                      isDraggingOpml
                        ? 'border-amber-400 bg-amber-500/10'
                        : 'border-slate-700 bg-slate-950/60 hover:border-slate-600 hover:bg-slate-950'
                    }`}
                  >
                    <FileUp className="w-6 h-6 text-amber-400 mx-auto mb-2" />
                    <div className="text-xs font-medium text-slate-200">
                      {importFileName ? `Selected: ${importFileName}` : 'Choose an OPML / XML file or drop it here'}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-1">
                      Supports standard exports from Feedly, NetNewsWire, Reeder, Substack, and Inoreader
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-[11px] font-medium text-slate-400">
                      Or paste OPML XML directly
                    </label>
                    <textarea 
                      rows={5}
                      placeholder="<?xml version='1.0' encoding='UTF-8'?><opml>...</opml>"
                      value={importText}
                      onChange={e => setImportText(e.target.value)}
                      className="w-full rounded-xl bg-slate-950 border border-slate-800 p-3 text-xs text-slate-200 font-mono focus:outline-none focus:border-amber-500"
                    />
                  </div>

                  {importError && (
                    <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
                      <span>{importError}</span>
                    </div>
                  )}

                  {importResult && (
                    <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs space-y-2">
                      <div className="font-medium">
                        Imported {importResult.totalImported} sources ({importResult.successCount} active, {importResult.failCount} failing).
                      </div>
                      {importResult.failures && importResult.failures.length > 0 && (
                        <ul className="space-y-1 text-[11px] text-amber-300 border-t border-emerald-500/20 pt-2">
                          {importResult.failures.map((f, idx) => (
                            <li key={idx}>
                              {f.title}: {f.reason}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}

                  <div className="flex justify-end gap-2 pt-2">
                    <button 
                      type="button" 
                      onClick={() => setShowImportModal(false)}
                      className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-slate-200"
                    >
                      Close
                    </button>
                    <button 
                      type="button"
                      disabled={isImportingOpml || !importText.trim()}
                      onClick={handleImportOPML}
                      className="px-4 py-2 text-xs font-medium rounded-xl bg-amber-500 text-slate-950 font-semibold hover:bg-amber-400 transition disabled:opacity-50"
                    >
                      {isImportingOpml ? 'Importing...' : 'Process Import'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 4: SETTINGS */}
        {activeTab === 'settings' && (
          <div className="space-y-8 animate-fade-in">
            <div className="border-b border-slate-900 pb-4">
              <h2 className="text-xl font-semibold tracking-tight text-slate-100">Settings</h2>
              <p className="text-xs text-slate-400 mt-0.5">Preferences & delivery configuration</p>
            </div>

            {/* Serendipity Dial */}
            <div className="p-6 rounded-3xl bg-slate-900/40 border border-slate-900 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-200">The Serendipity Dial</h3>
                  <p className="text-xs text-slate-400 mt-0.5">How far outside your bubble should your daily stretch be?</p>
                </div>
                <span className="text-sm font-mono font-bold text-amber-400">{serendipityDial}%</span>
              </div>
              <input 
                type="range" 
                min="0" 
                max="100" 
                value={serendipityDial}
                onChange={e => setSerendipityDial(Number(e.target.value))}
                className="w-full accent-amber-500 cursor-pointer"
              />
              <div className="flex justify-between text-[11px] text-slate-400">
                <span>Stay close</span>
                <span>Balanced</span>
                <span>Push me</span>
              </div>
            </div>

            {/* Delivery Time & Notifications */}
            <div className="p-6 rounded-3xl bg-slate-900/40 border border-slate-900 space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-200">Morning Delivery Time</h3>
                  <p className="text-xs text-slate-400 mt-0.5">When your single daily digest notification arrives</p>
                </div>
                <input 
                  type="time" 
                  value={deliveryTime}
                  onChange={e => setDeliveryTime(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-sm text-slate-200 font-mono focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-slate-900">
                <div>
                  <h3 className="text-sm font-semibold text-slate-200">Push Notification</h3>
                  <p className="text-xs text-slate-400 mt-0.5">One calm notification per morning</p>
                </div>
                <button 
                  onClick={() => setNotificationsEnabled(!notificationsEnabled)}
                  className={`w-11 h-6 rounded-full transition relative ${notificationsEnabled ? 'bg-amber-500' : 'bg-slate-800'}`}
                >
                  <div className={`w-5 h-5 rounded-full bg-white absolute top-0.5 transition-transform ${notificationsEnabled ? 'translate-x-5.5' : 'translate-x-0.5'}`} />
                </button>
              </div>

              <div className="pt-2">
                <button 
                  onClick={() => {
                    showToast('Test notification sent: 6 items ready, 1 stretch item');
                  }}
                  className="px-4 py-2 text-xs font-medium rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-slate-100 transition"
                >
                  Send me a test notification
                </button>
              </div>
            </div>

            {/* Subscription Export & Free Tier Indicator */}
            <div className="p-6 rounded-3xl bg-slate-900/40 border border-slate-900 space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-200">Data & Subscriptions</h3>
                <p className="text-xs text-slate-400 mt-0.5">Your OPML subscription file is yours. Export anytime.</p>
              </div>
              <div>
                <button 
                  onClick={handleExportOPML}
                  className="px-4 py-2 text-xs font-medium rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-slate-100 transition flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  <span>Export full subscription list (.opml)</span>
                </button>
              </div>

              <div className="pt-4 border-t border-slate-950 flex items-center justify-between text-xs text-slate-400">
                <span>Google AI Free Tier Quota</span>
                <span className="font-mono text-emerald-400 font-medium">
                  {freeTierInfo.percentRemaining}% remaining ({freeTierInfo.remaining.toLocaleString()} reqs left)
                </span>
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: FEEDS (Traditional Reading Stream) */}
        {activeTab === 'feeds' && (
          <div className="space-y-6 animate-fade-in">
            {/* Top Circular Source Stories Carousel */}
            <div className="overflow-x-auto no-scrollbar py-2 -mx-6 px-6">
              <div className="flex items-center gap-4 min-w-max">
                {/* "All" feeds circle */}
                <button
                  type="button"
                  onClick={() => handleOpenFeedStream('all')}
                  className="flex flex-col items-center gap-2 group cursor-pointer focus:outline-none"
                >
                  <div className={`relative w-16 h-16 rounded-full p-0.5 transition-transform group-hover:scale-105 ${
                    !selectedFeedSource || selectedFeedSource === 'all'
                      ? 'bg-amber-400 ring-2 ring-amber-400/50'
                      : 'bg-slate-800'
                  }`}>
                    <div className="w-full h-full rounded-full bg-slate-900 flex items-center justify-center overflow-hidden border-2 border-slate-950">
                      <span className="text-xs font-bold text-slate-200">ALL</span>
                    </div>
                  </div>
                  <span className={`text-[11px] font-medium max-w-[72px] truncate text-center ${
                    !selectedFeedSource || selectedFeedSource === 'all' ? 'text-amber-400 font-semibold' : 'text-slate-400'
                  }`}>
                    All Feeds
                  </span>
                </button>

                {sources.map((src, idx) => {
                  const isSelected = selectedFeedSource === src.title;
                  return (
                    <button
                      key={src.id}
                      type="button"
                      onClick={() => handleOpenFeedStream(src.title)}
                      className="flex flex-col items-center gap-2 group cursor-pointer focus:outline-none"
                    >
                      <div className={`relative w-16 h-16 rounded-full p-0.5 transition-transform group-hover:scale-105 ${
                        isSelected
                          ? 'bg-amber-400 ring-2 ring-amber-400/50'
                          : 'bg-gradient-to-tr from-amber-500 to-rose-500 shadow-md'
                      }`}>
                        <div className="w-full h-full rounded-full bg-slate-900 flex items-center justify-center overflow-hidden border-2 border-slate-950">
                          <span className="text-xs font-bold text-slate-200">
                            {src.title.slice(0, 2).toUpperCase()}
                          </span>
                        </div>
                        {idx % 2 === 0 && !isSelected && (
                          <div className="absolute top-0 right-0 w-3.5 h-3.5 rounded-full bg-orange-500 border-2 border-slate-950" />
                        )}
                      </div>
                      <span className={`text-[11px] font-medium max-w-[72px] truncate text-center group-hover:text-amber-300 transition-colors ${
                        isSelected ? 'text-amber-300 font-semibold' : 'text-slate-300'
                      }`}>
                        {src.title.split(' ')[0]}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Stream Header */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-900 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-semibold tracking-tight text-slate-100">
                    {selectedFeedSource && selectedFeedSource !== 'all' ? selectedFeedSource : 'All Feeds Stream'}
                  </h2>
                  {selectedFeedSource && selectedFeedSource !== 'all' && (
                    <span className="text-[10px] uppercase font-mono tracking-wider bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full">
                      Feed Stream
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Traditional chronological reading stream · {feedStreamArticles.length} entries
                </p>
              </div>

              {selectedFeedSource && selectedFeedSource !== 'all' && (
                <button
                  type="button"
                  onClick={() => handleOpenFeedStream('all')}
                  className="px-3 py-1.5 text-xs font-medium rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-slate-100 transition"
                >
                  View all feeds
                </button>
              )}
            </div>

            {/* Article Stream */}
            {loadingFeedStream ? (
              <div className="py-20 text-center text-slate-500 space-y-3">
                <RefreshCw className="w-6 h-6 animate-spin mx-auto text-amber-500" />
                <p className="text-sm">Loading feed stream...</p>
              </div>
            ) : feedStreamArticles.length === 0 ? (
              <div className="py-20 text-center text-slate-500 space-y-2">
                <p className="text-sm">No entries found for this feed.</p>
                <button
                  type="button"
                  onClick={() => handleOpenFeedStream('all')}
                  className="text-xs text-amber-400 underline"
                >
                  Return to all feeds stream
                </button>
              </div>
            ) : (
              <div className="space-y-6">
                {feedStreamArticles.map((item) => (
                  <article
                    key={item.id}
                    onClick={() => openArticle(item)}
                    className="group rounded-3xl bg-slate-900/60 border border-slate-900 hover:border-slate-800/80 overflow-hidden transition cursor-pointer shadow-xl relative"
                  >
                    <div className="p-5 pb-3 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-amber-500/20 to-orange-500/20 border border-slate-800 flex items-center justify-center text-xs font-bold text-amber-400 shrink-0">
                          {item.source.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div className="text-xs font-bold text-slate-100 flex items-center gap-1.5">
                            <span>{item.source}</span>
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {item.publishedAt ? `${item.publishedAt} · ` : ''}{item.folder} · {item.readTime}
                          </div>
                        </div>
                      </div>
                      <span className="text-orange-500 font-semibold text-xs flex items-center gap-1 font-mono tracking-wide">
                        <span className="font-black text-sm">≡</span>stream
                      </span>
                    </div>

                    {item.quote && (
                      <p className="px-5 pb-3 text-sm md:text-base text-slate-100 font-medium leading-snug">
                        {item.quote}
                      </p>
                    )}

                    {item.bannerImage && (
                      <div className="relative mx-3.5 rounded-2xl overflow-hidden h-56 md:h-64 shadow-lg border border-slate-800/40">
                        <img 
                          src={item.bannerImage} 
                          alt={item.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/45 to-transparent" />
                        
                        <div className="absolute bottom-4 right-4 z-10">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleSave(item); }}
                            className={`p-2.5 rounded-xl backdrop-blur-md border transition shadow-lg ${
                              savedIds.includes(item.id)
                                ? 'bg-amber-500/20 border-amber-500/40 text-amber-400'
                                : 'bg-slate-950/70 border-slate-700/60 text-slate-200 hover:text-amber-400 hover:bg-slate-900/90'
                            }`}
                            title="Save for later"
                          >
                            <Bookmark className={`w-4 h-4 ${savedIds.includes(item.id) ? 'fill-amber-400 text-amber-400' : ''}`} />
                          </button>
                        </div>

                        <div className="absolute bottom-4 left-4 right-16">
                          <div className="text-[10px] uppercase font-bold tracking-wider text-amber-400/90 mb-1">
                            {item.folder}
                          </div>
                          <h3 className="text-lg md:text-xl font-bold tracking-tight text-white leading-snug drop-shadow-sm group-hover:text-amber-300 transition-colors">
                            {item.title}
                          </h3>
                          <p className="text-xs text-slate-300 mt-1 line-clamp-1">
                            {item.summary}
                          </p>
                        </div>
                      </div>
                    )}

                    <div className="p-5 space-y-4 pt-4">
                      {!item.bannerImage && (
                        <div>
                          <h3 className="text-xl font-bold tracking-tight text-slate-100 group-hover:text-amber-300 transition-colors">
                            {item.title}
                          </h3>
                          <p className="text-sm text-slate-400 mt-1 line-clamp-2">
                            {item.summary}
                          </p>
                        </div>
                      )}

                      <div className="pt-2 flex items-center justify-between text-xs text-slate-400">
                        <div className="flex items-center gap-5">
                          <button 
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleLike(item); }}
                            className="flex items-center gap-1.5 text-slate-400 hover:text-rose-400 transition"
                          >
                            <Heart className={`w-4 h-4 ${likedIds.includes(item.id) ? 'fill-rose-500 text-rose-500' : ''}`} />
                            <span className="text-[11px]">{likedIds.includes(item.id) ? '2' : '1'}</span>
                          </button>
                          <button 
                            type="button"
                            onClick={(e) => { e.stopPropagation(); openArticle(item); }}
                            className="flex items-center gap-1.5 text-slate-400 hover:text-slate-200 transition"
                          >
                            <MessageSquare className="w-4 h-4" />
                            <span className="text-[11px]">1</span>
                          </button>
                          <button 
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setRepostIds(prev => prev.includes(item.id) ? prev.filter(x => x !== item.id) : [...prev, item.id]);
                              showToast('Quoted in your daily notebook');
                            }}
                            className={`flex items-center gap-1.5 transition ${repostIds.includes(item.id) ? 'text-emerald-400' : 'text-slate-400 hover:text-slate-200'}`}
                          >
                            <Repeat className="w-4 h-4" />
                          </button>
                          <button 
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigator.clipboard.writeText(item.url || window.location.href);
                              showToast('Article link copied to clipboard');
                            }}
                            className="flex items-center gap-1.5 text-slate-400 hover:text-slate-200 transition"
                            title="Share article link"
                          >
                            <Share2 className="w-4 h-4" />
                          </button>
                        </div>

                        <div className="flex items-center gap-2">
                          <button 
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleMore(item); }}
                            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-[11px] transition ${
                              signals.moreIds?.includes(item.id) || signals.more.includes(item.source)
                                ? 'bg-amber-500/15 border-amber-500/40 text-amber-300 font-medium'
                                : 'bg-slate-900 border-slate-800 text-slate-300 hover:text-slate-100 hover:bg-slate-800'
                            }`}
                            title="More like this"
                          >
                            <ThumbsUp className="w-3 h-3" />
                            <span>{signals.moreIds?.includes(item.id) ? 'More ✓' : 'More'}</span>
                          </button>
                          <button 
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleLess(item); }}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-rose-300 hover:border-rose-500/30 hover:bg-rose-500/10 text-[11px] transition"
                            title="Less like this"
                          >
                            <ThumbsDown className="w-3 h-3" />
                            <span>Less</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Floating 'Keep reading' resume bar (borrowed from attached screenshot) */}
      {recentReadItem && showKeepReading && !selectedArticle && (
        <div className="fixed bottom-20 left-4 right-4 sm:left-auto sm:right-24 max-w-sm z-40 bg-slate-900/95 border border-slate-800 rounded-2xl p-2.5 flex items-center justify-between gap-3 shadow-2xl backdrop-blur-xl animate-fade-in">
          <button 
            type="button"
            onClick={() => openArticle(recentReadItem)}
            className="flex items-center gap-3 text-left overflow-hidden flex-1 cursor-pointer"
          >
            {recentReadItem.bannerImage ? (
              <img 
                src={recentReadItem.bannerImage} 
                alt="" 
                className="w-10 h-10 rounded-xl object-cover shrink-0 border border-slate-800" 
              />
            ) : (
              <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center text-xs font-bold text-slate-300 shrink-0">
                {recentReadItem.source.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div className="overflow-hidden">
              <span className="text-[10px] text-slate-400 block font-medium">Keep reading</span>
              <span className="text-xs font-semibold text-slate-200 truncate block">
                {recentReadItem.title}
              </span>
            </div>
          </button>
          <button 
            type="button"
            onClick={() => setShowKeepReading(false)}
            className="w-7 h-7 rounded-full bg-slate-800/80 hover:bg-slate-800 text-slate-400 hover:text-slate-200 flex items-center justify-center shrink-0 transition"
            title="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Floating Orange '+' Action Button (borrowed from attached screenshot) */}
      <div className="fixed bottom-20 right-5 z-40">
        <button 
          type="button"
          onClick={() => setShowQuickActions(!showQuickActions)}
          className="w-14 h-14 rounded-full bg-gradient-to-tr from-amber-500 to-orange-500 text-white shadow-xl shadow-orange-500/30 flex items-center justify-center hover:scale-105 active:scale-95 transition-transform"
          title="Quick actions"
        >
          <Plus className={`w-6 h-6 transition-transform ${showQuickActions ? 'rotate-45' : ''}`} />
        </button>

        {showQuickActions && (
          <div className="absolute bottom-16 right-0 w-64 rounded-2xl bg-slate-900 border border-slate-800 p-2 shadow-2xl space-y-1 animate-fade-in backdrop-blur-xl z-50">
            <button
              type="button"
              onClick={() => {
                setShowQuickActions(false);
                setActiveTab('sources');
              }}
              className="w-full px-3.5 py-2.5 text-left text-xs text-slate-200 hover:bg-slate-800 rounded-xl flex items-center gap-2.5 transition"
            >
              <Search className="w-4 h-4 text-amber-400" />
              <span>Discover Feeds (Google Search)</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setShowQuickActions(false);
                setShowAddSourceModal(true);
              }}
              className="w-full px-3.5 py-2.5 text-left text-xs text-slate-200 hover:bg-slate-800 rounded-xl flex items-center gap-2.5 transition"
            >
              <Plus className="w-4 h-4 text-amber-400" />
              <span>Add Source by URL</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setShowQuickActions(false);
                openImportModal();
              }}
              className="w-full px-3.5 py-2.5 text-left text-xs text-slate-200 hover:bg-slate-800 rounded-xl flex items-center gap-2.5 transition"
            >
              <FileUp className="w-4 h-4 text-amber-400" />
              <span>Import OPML File</span>
            </button>
          </div>
        )}
      </div>

      {/* Bottom Dock Navigation */}
      <nav className="fixed bottom-3 left-4 right-4 z-40 max-w-lg mx-auto bg-slate-900/90 backdrop-blur-xl border border-slate-800/80 rounded-2xl py-2.5 px-3 shadow-2xl">
        <div className="flex items-center justify-around">
          <button 
            onClick={() => setActiveTab('today')}
            className={`flex flex-col items-center gap-1 relative transition ${activeTab === 'today' ? 'text-amber-400' : 'text-slate-400 hover:text-slate-200'}`}
          >
            <Home className="w-5 h-5" />
            <span className="text-[10px] font-medium tracking-tight">Home</span>
          </button>

          <button 
            onClick={() => setActiveTab('saved')}
            className={`flex flex-col items-center gap-1 relative transition ${activeTab === 'saved' ? 'text-amber-400' : 'text-slate-400 hover:text-slate-200'}`}
          >
            <div className="relative">
              <Bookmark className="w-5 h-5" />
              {savedIds.length > 0 && (
                <div className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-orange-500 border border-slate-950" />
              )}
            </div>
            <span className="text-[10px] font-medium tracking-tight">Saved</span>
          </button>

          <button 
            onClick={() => setActiveTab('sources')}
            className={`flex flex-col items-center gap-1 relative transition ${activeTab === 'sources' ? 'text-amber-400' : 'text-slate-400 hover:text-slate-200'}`}
          >
            <Headphones className="w-5 h-5" />
            <span className="text-[10px] font-medium tracking-tight">Sources</span>
          </button>

          <button 
            onClick={() => setActiveTab('settings')}
            className={`flex flex-col items-center gap-1 relative transition ${activeTab === 'settings' ? 'text-amber-400' : 'text-slate-400 hover:text-slate-200'}`}
          >
            <Activity className="w-5 h-5" />
            <span className="text-[10px] font-medium tracking-tight">Settings</span>
          </button>

          <button 
            onClick={() => {
              setActiveTab('feeds');
            }}
            className={`flex flex-col items-center gap-1 relative transition ${activeTab === 'feeds' ? 'text-amber-400' : 'text-slate-400 hover:text-slate-200'}`}
          >
            <div className="relative">
              <Rss className="w-5 h-5" />
              <div className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-orange-500 border border-slate-950" />
            </div>
            <span className="text-[10px] font-medium tracking-tight">Feeds</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
