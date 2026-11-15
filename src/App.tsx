import React, { useState, useEffect } from 'react';
import { 
  Bookmark, Rss, RefreshCw, Check, CheckCheck, Plus, Trash2, 
  Download, Upload, Sliders, ExternalLink, ArrowLeft, Sparkles, 
  AlertCircle, X, Home, Compass,
  ThumbsUp, ThumbsDown, FileUp, Search, Globe, Volume2, Play, Pause, Square,
  RotateCcw, EyeOff, BarChart3, Clock, ArrowRight
} from 'lucide-react';
import QRCode from 'qrcode';
import { CuratorMark, CuratorFullLogo } from './components/CuratorLogo';
import { WeeklyReviewModal, WeeklyReadingItem } from './components/WeeklyReviewModal';

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
  lastSyncedAt?: number;
  avatar?: string;
}

interface SemanticFeedbackItem {
  id: string;
  vote: 'like' | 'dislike';
  title: string;
  text: string;
  timestamp: number;
  source?: string;
  folder?: string;
}

function decodeArticleEntities(text: string): string {
  return (text || '')
    .replace(/&#x([0-9a-f]+);/gi, (entity, hex: string) => {
      const code = parseInt(hex, 16);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : entity;
    })
    .replace(/&#(\d+);/g, (entity, dec: string) => {
      const code = parseInt(dec, 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : entity;
    })
    .replace(/&nbsp;/gi, ' ')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&hellip;/gi, '…')
    .replace(/&rsquo;|&lsquo;/gi, '’')
    .replace(/&rdquo;|&ldquo;/gi, '”')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

// Reader-side clean-up in case cached feed text still carries markup debris.
function buildArticleParagraphs(text: string): string[] {
  if (!text) return [];
  const clean = decodeArticleEntities(text)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/([,.;:!?])(?=[A-Za-z0-9“"'(])/g, '$1 ')
    .replace(/\n{3,}/g, '\n\n');

  return clean
    .split(/\n{2,}/)
    .map(paragraph => {
      let next = paragraph
        .replace(/\s*\n\s*/g, ' ')
        .replace(/\s+([,.;:!?])/g, '$1')
        .replace(/\s{2,}/g, ' ')
        .trim();
      // A stripped inline link can leave a paragraph starting with the punctuation that followed it.
      if (/^[,;:.]/.test(next)) {
        next = next.replace(/^[,;:.]+\s*/, '');
        next = next.charAt(0).toUpperCase() + next.slice(1);
      }
      return next;
    })
    .filter(paragraph => paragraph.length > 0 && /[\p{L}\p{N}]/u.test(paragraph))
    .filter(paragraph => !(paragraph.length < 180 && /^(click here|subscribe|sign up|follow me|read more|share this|advertisement)\b/i.test(paragraph)))
    .filter(paragraph => !/^the post .+ appeared first on /i.test(paragraph));
}

function QRCodeBox({ url }: { url: string }) {
  const [svgStr, setSvgStr] = useState<string>('');
  useEffect(() => {
    QRCode.toString(url, { type: 'svg', width: 160, margin: 1, color: { dark: '#020617', light: '#ffffff' } }, (err, string) => {
      if (!err && string) {
        setSvgStr(string);
      }
    });
  }, [url]);

  return (
    <div className="bg-white p-3 rounded-2xl shadow-lg border border-slate-800 shrink-0 flex items-center justify-center w-40 h-40">
      {svgStr ? (
        <div dangerouslySetInnerHTML={{ __html: svgStr }} className="w-full h-full flex items-center justify-center [&>svg]:w-full [&>svg]:h-full" />
      ) : (
        <div className="text-xs text-slate-400">Loading QR...</div>
      )}
    </div>
  );
}

export default function App() {
  // Navigation & View state
  const [activeTab, setActiveTab] = useState<'today' | 'saved' | 'sources' | 'settings' | 'feeds'>('today');
  const [selectedArticle, setSelectedArticle] = useState<DigestItem | null>(null);
  const [selectedFeedSource, setSelectedFeedSource] = useState<string | null>(null);
  const [feedStreamArticles, setFeedStreamArticles] = useState<DigestItem[]>([]);
  const [loadingFeedStream, setLoadingFeedStream] = useState<boolean>(false);
  const [readSourceIds, setReadSourceIds] = useState<string[]>(() => {
    const saved = localStorage.getItem('curator_read_sources');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { /* ignore */ }
    }
    return ['src_mr', 'src_dan'];
  });
  const [readArticleIds, setReadArticleIds] = useState<string[]>(() => {
    const saved = localStorage.getItem('curator_read_articles');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { /* ignore */ }
    }
    return [];
  });
  const [readingStats, setReadingStats] = useState<Record<string, { maxDepth?: number; finished?: boolean; lastRead?: number }>>(() => {
    try {
      const raw = localStorage.getItem('curator_reading_stats');
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  });
  const [refreshingSourceId, setRefreshingSourceId] = useState<string | null>(null);

  // App data state with localStorage persistence
  const [sources, setSources] = useState<SourceItem[]>(() => {
    const defaultSources: SourceItem[] = [
      { id: 'src_row', title: 'Rest of World', feedUrl: 'https://restofworld.org/feed/latest', folder: 'Global Tech', status: 'active', lastSyncedAt: now - 75 * 60 * 1000 }
    ];

    const saved = localStorage.getItem('curator_sources');
    if (saved) {
      try {
        const parsed: SourceItem[] = JSON.parse(saved);
        const hasStaleDummy = parsed.some(s =>
          s.feedUrl.includes('pmresearcher') ||
          s.feedUrl.includes('bhaskar.econ') ||
          s.feedUrl.includes('worldhistory.com')
        );
        if (!hasStaleDummy && Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      } catch (e) { /* ignore */ }
    }
    return defaultSources;
  });

  const [digest, setDigest] = useState<DigestItem[]>([]);
  const [semanticSummary, setSemanticSummary] = useState<{
    feedbackExamples: number;
    providerVectors: number;
    deprioritized: number;
    localEngine?: boolean;
  } | null>(null);
  const [feedReport, setFeedReport] = useState<{
    attempted: number;
    failed: Array<{ title: string; reason: string }>;
  } | null>(null);

  // First-run calibration flow for the semantic profile
  const [showSetupWizard, setShowSetupWizard] = useState<boolean>(() => {
    try {
      if (localStorage.getItem('curator_setup_complete')) return false;
      const savedFeedback = JSON.parse(localStorage.getItem('curator_semantic_feedback') || '[]');
      return !(Array.isArray(savedFeedback) && savedFeedback.length > 0);
    } catch {
      return true;
    }
  });
  const [setupStep, setSetupStep] = useState<1 | 2 | 3>(1);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [loadingCalibration, setLoadingCalibration] = useState<boolean>(false);
  const [calibrationCandidates, setCalibrationCandidates] = useState<DigestItem[]>([]);
  const [calibrationIndex, setCalibrationIndex] = useState<number>(0);
  const [calibrationVotes, setCalibrationVotes] = useState<number>(0);
  const [savedArticles, setSavedArticles] = useState<DigestItem[]>(() => {
    const saved = localStorage.getItem('curator_saved_articles');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      } catch (e) { /* ignore */ }
    }
    return [];
  });
  const [savedIds, setSavedIds] = useState<string[]>(() => {
    const saved = localStorage.getItem('curator_saved_ids');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { /* ignore */ }
    }
    return [];
  });

  const [weeklyHistory, setWeeklyHistory] = useState<WeeklyReadingItem[]>(() => {
    const saved = localStorage.getItem('curator_weekly_history');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          // Older builds seeded demo history; drop only those known placeholder ids
          const seededIds = new Set(['wh_1', 'wh_2', 'wh_3', 'wh_4', 'wh_5', 'wh_6', 'wh_7']);
          return parsed.filter((it: WeeklyReadingItem) => !seededIds.has(it.id));
        }
      } catch (e) { /* ignore */ }
    }
    // Starts empty: history is only what the reader has actually finished
    return [];
  });
  const [showWeeklyReviewModal, setShowWeeklyReviewModal] = useState<boolean>(false);

  useEffect(() => {
    localStorage.setItem('curator_weekly_history', JSON.stringify(weeklyHistory));
  }, [weeklyHistory]);

  const weekCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const weeklyRecent = weeklyHistory.filter(it => it.completedAt >= weekCutoff);
  const totalWeeklyMinutes = weeklyRecent.reduce((acc, it) => acc + (it.minutesSpent ?? 0), 0);
  const topWeeklyTopic = (() => {
    const counts: Record<string, number> = {};
    weeklyRecent.forEach(it => { counts[it.folder] = (counts[it.folder] || 0) + (it.minutesSpent ?? 0); });
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    return sorted[0]?.[0] || 'No reading yet';
  })();

  const [signals, setSignals] = useState<{
    moreTopics: string[];
    lessTopics: string[];
    moreIds: string[];
    lessIds: string[];
    more: string[];
    less: string[];
  }>(() => {
    const saved = localStorage.getItem('curator_signals');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Older versions turned a vote into a broad folder preference. Keep exact article IDs,
        // but clear those topic rules so the semantic profile can learn from article content.
        return {
          moreTopics: [],
          lessTopics: [],
          moreIds: Array.isArray(parsed.moreIds) ? parsed.moreIds : [],
          lessIds: Array.isArray(parsed.lessIds) ? parsed.lessIds : [],
          more: [],
          less: [],
        };
      } catch (e) { /* ignore */ }
    }
    return { moreTopics: [], lessTopics: [], moreIds: [], lessIds: [], more: [], less: [] };
  });
  const [semanticFeedback, setSemanticFeedback] = useState<SemanticFeedbackItem[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('curator_semantic_feedback') || '[]');
      if (!Array.isArray(saved)) return [];
      return saved
        .filter((item: any) => item && typeof item.id === 'string' &&
          (item.vote === 'like' || item.vote === 'dislike') &&
          typeof item.title === 'string' && typeof item.text === 'string' &&
          Number.isFinite(item.timestamp))
        .slice(-40);
    } catch {
      return [];
    }
  });
  const [serverGeminiAvailable, setServerGeminiAvailable] = useState<boolean>(false);

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
  const [aiProvider, setAiProvider] = useState<string>(() => {
    const saved = localStorage.getItem('curator_ai_provider');
    if (saved === 'openai') return 'openai-compatible';
    if (saved === 'gemini') return 'deterministic';
    return saved || 'deterministic';
  });
  const [customApiKey, setCustomApiKey] = useState<string>(() => localStorage.getItem('curator_custom_api_key') || '');
  const [aiBaseUrl, setAiBaseUrl] = useState<string>(() => localStorage.getItem('curator_ai_base_url') || '');
  const [aiModel, setAiModel] = useState<string>(() => localStorage.getItem('curator_ai_model') || '');
  const [embeddingProvider, setEmbeddingProvider] = useState<string>(() => localStorage.getItem('curator_embedding_provider') || 'openai-compatible');
  const [embeddingApiKey, setEmbeddingApiKey] = useState<string>(() => localStorage.getItem('curator_embedding_api_key') || '');
  const [embeddingBaseUrl, setEmbeddingBaseUrl] = useState<string>(() => localStorage.getItem('curator_embedding_base_url') || '');
  const [embeddingModel, setEmbeddingModel] = useState<string>(() => localStorage.getItem('curator_embedding_model') || '');
  const embeddingKeyMatchesChatProvider =
    (embeddingProvider === 'gemini' && aiProvider === 'gemini') ||
    (embeddingProvider === 'openai-compatible' && aiProvider === 'openai-compatible');
  const semanticServiceReady = embeddingProvider === 'openai-compatible'
    ? Boolean((embeddingApiKey || (embeddingKeyMatchesChatProvider && customApiKey)) && (embeddingBaseUrl || (embeddingKeyMatchesChatProvider && aiBaseUrl)))
    : embeddingProvider === 'gemini'
      ? Boolean(embeddingApiKey || (embeddingKeyMatchesChatProvider && customApiKey) || serverGeminiAvailable)
      : false;

  const [loadingDigest, setLoadingDigest] = useState<boolean>(false);
  const [activeToast, setActiveToast] = useState<{
    id: string;
    message: string;
    actionLabel?: string;
    onAction?: () => void;
  } | null>(null);
  const toastTimeoutRef = React.useRef<any>(null);
  // Screen Wake Lock held while read-aloud is playing so the phone does not sleep mid-article
  const wakeLockRef = React.useRef<any>(null);
  const wakeLockWantedRef = React.useRef(false);
  // Monotonic ids so a slow, superseded response can never overwrite newer state
  const digestRequestRef = React.useRef(0);
  const feedStreamRequestRef = React.useRef(0);
  const speechCancelledRef = React.useRef(false);

  // Muted cards state for immediate inline Undo / Redo when user clicks "Fewer"
  const [mutedCards, setMutedCards] = useState<Record<string, DigestItem>>({});

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

  // Read Aloud (iOS onboard speech synthesis).
  // Voice, rate and pitch are never set here: the system speaks with the
  // default voice and settings the user picked in Spoken Content.
  const [speechPlaying, setSpeechPlaying] = useState<boolean>(false);
  const [speechPaused, setSpeechPaused] = useState<boolean>(false);

  useEffect(() => {
    localStorage.setItem('curator_saved_articles', JSON.stringify(savedArticles));
  }, [savedArticles]);

  useEffect(() => {
    localStorage.setItem('curator_sources', JSON.stringify(sources));
  }, [sources]);

  useEffect(() => {
    localStorage.setItem('curator_saved_ids', JSON.stringify(savedIds));
  }, [savedIds]);

  useEffect(() => {
    localStorage.setItem('curator_signals', JSON.stringify(signals));
  }, [signals]);

  useEffect(() => {
    localStorage.setItem('curator_semantic_feedback', JSON.stringify(semanticFeedback));
  }, [semanticFeedback]);

  useEffect(() => {
    fetch('/api/semantic-status')
      .then(res => res.json())
      .then(data => setServerGeminiAvailable(Boolean(data.geminiConfigured)))
      .catch(() => setServerGeminiAvailable(false));
  }, []);

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
    localStorage.setItem('curator_custom_api_key', customApiKey);
  }, [customApiKey]);

  useEffect(() => {
    localStorage.setItem('curator_ai_base_url', aiBaseUrl);
  }, [aiBaseUrl]);

  useEffect(() => {
    localStorage.setItem('curator_ai_model', aiModel);
  }, [aiModel]);

  useEffect(() => {
    localStorage.setItem('curator_embedding_provider', embeddingProvider);
  }, [embeddingProvider]);

  useEffect(() => {
    localStorage.setItem('curator_embedding_api_key', embeddingApiKey);
  }, [embeddingApiKey]);

  useEffect(() => {
    localStorage.setItem('curator_embedding_base_url', embeddingBaseUrl);
  }, [embeddingBaseUrl]);

  useEffect(() => {
    localStorage.setItem('curator_embedding_model', embeddingModel);
  }, [embeddingModel]);

  useEffect(() => {
    localStorage.setItem('curator_read_sources', JSON.stringify(readSourceIds));
  }, [readSourceIds]);

  useEffect(() => {
    localStorage.setItem('curator_read_articles', JSON.stringify(readArticleIds));
  }, [readArticleIds]);

  useEffect(() => {
    localStorage.setItem('curator_reading_stats', JSON.stringify(readingStats));
  }, [readingStats]);

  useEffect(() => {
    // While setup is open, calibration votes accumulate first and one digest is built at the end.
    if (showSetupWizard) return;
    // Debounced so dragging the serendipity slider or tapping counts issues one request, not dozens
    const timer = setTimeout(() => { generateDigest(); }, 450);
    return () => clearTimeout(timer);
  }, [itemCount, serendipityDial, signals, semanticFeedback, showSetupWizard]);
  useEffect(() => {
    if (activeTab === 'feeds') {
      fetchFeedStream(selectedFeedSource || 'all');
    }
  }, [activeTab, selectedFeedSource]);

  const fetchFeedStream = async (sourceTitle?: string) => {
    const requestId = ++feedStreamRequestRef.current;
    setLoadingFeedStream(true);
    try {
      const res = await fetch('/api/feed-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceTitle: sourceTitle || 'all', sources })
      });
      const data = await res.json();
      if (requestId !== feedStreamRequestRef.current) return;
      if (Array.isArray(data.articles)) {
        setFeedStreamArticles(data.articles);
      }
    } catch (e) {
      // fallback
    } finally {
      if (requestId === feedStreamRequestRef.current) setLoadingFeedStream(false);
    }
  };

  const handleOpenFeedStream = (sourceTitle: string, sourceId?: string) => {
    // The tab/source effect performs the fetch; calling it here too caused a duplicate request
    setSelectedFeedSource(sourceTitle);
    setActiveTab('feeds');

    if (sourceId) {
      if (!readSourceIds.includes(sourceId)) {
        setReadSourceIds(prev => [...prev, sourceId]);
        const matched = sources.find(s => s.id === sourceId);
        showToast(`Marked ${matched ? matched.title : sourceTitle} updates as read`);
      }
    } else if (sourceTitle && sourceTitle !== 'all') {
      const match = sources.find(
        s => s.title.toLowerCase() === sourceTitle.toLowerCase() ||
             sourceTitle.toLowerCase().includes(s.title.toLowerCase())
      );
      if (match && !readSourceIds.includes(match.id)) {
        setReadSourceIds(prev => [...prev, match.id]);
        showToast(`Marked ${match.title} updates as read`);
      }
    }
  };

  const markAllSourcesAsRead = () => {
    const all = sources.map(s => s.id);
    setReadSourceIds(all);
    showToast('All feeds marked as read — dots dismissed');
  };

  const markAllSourcesAsUnread = () => {
    setReadSourceIds([]);
    showToast('Unread indicators reset');
  };

  const generateDigest = async (options?: { fresh?: boolean }) => {
    const requestId = ++digestRequestRef.current;
    setLoadingDigest(true);
    try {
      let readingStats = {};
      try {
        readingStats = JSON.parse(localStorage.getItem('curator_reading_stats') || '{}');
      } catch (e) { /* ignore */ }

      // Freshness history lives in this browser. The digest currently on screen is not
      // "already shown" — the server only down-weights pieces you have moved past.
      let shownHistory: Array<{ id: string; shownAt: number }> = [];
      try {
        const savedHistory = JSON.parse(localStorage.getItem('curator_digest_history') || '[]');
        if (Array.isArray(savedHistory)) {
          shownHistory = savedHistory
            .filter((entry: any) => entry && typeof entry.id === 'string' && Number.isFinite(entry.shownAt))
            .slice(-150);
        }
      } catch {
        shownHistory = [];
      }

      const currentDigestIds = new Set(digest.map(item => item.id));
      const recentlyShown = shownHistory.filter(entry => !currentDigestIds.has(entry.id));

      const res = await fetch('/api/curate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sources,
          signals,
          feedback: semanticFeedback,
          readingStats,
          serendipityDial,
          itemCount,
          provider: aiProvider,
          apiKey: customApiKey,
          baseUrl: aiBaseUrl,
          model: aiModel,
          embeddingProvider,
          embeddingApiKey,
          embeddingBaseUrl,
          embeddingModel,
          recentlyShown,
          previousDigestIds: [...currentDigestIds],
          fresh: Boolean(options?.fresh),
          seed: options?.fresh ? `${Date.now()}-${Math.random()}` : 'stable',
        })
      });
      const data = await res.json().catch(() => ({}));
      if (requestId !== digestRequestRef.current) return;
      if (!res.ok) {
        showToast(data?.error ? `Could not refresh the digest: ${data.error}` : 'Could not refresh the digest');
        return;
      }
      if (Array.isArray(data.digest) && data.digest.length > 0) {
        setDigest(data.digest);
        if (data.semanticSummary) setSemanticSummary(data.semanticSummary);
        if (data.feedReport) setFeedReport(data.feedReport);

        const shownAt = Date.now();
        const freshIds = new Set<string>(data.digest.map((item: DigestItem) => item.id));
        const mergedHistory = [
          ...shownHistory.filter(entry => !freshIds.has(entry.id)),
          ...data.digest.map((item: DigestItem) => ({ id: item.id, shownAt })),
        ].slice(-150);
        localStorage.setItem('curator_digest_history', JSON.stringify(mergedHistory));
      }
    } catch (e) {
      showToast('Could not refresh the digest');
    } finally {
      if (requestId === digestRequestRef.current) setLoadingDigest(false);
    }
  };

  const showToast = (msg: string, actionLabel?: string, onAction?: () => void) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    const item = {
      id: Math.random().toString(36).substring(2, 9),
      message: msg,
      actionLabel,
      onAction
    };
    setActiveToast(item);
    toastTimeoutRef.current = setTimeout(() => {
      setActiveToast(prev => (prev?.id === item.id ? null : prev));
    }, onAction ? 7000 : 3500);
  };

  const recordSemanticFeedback = (item: DigestItem, vote: 'like' | 'dislike') => {
    const text = `${item.title}\n${item.summary}\n${item.fullText}`
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 3000);
    setSemanticFeedback(prev => [
      ...prev.filter(entry => entry.id !== item.id),
      { id: item.id, vote, title: item.title, text, timestamp: Date.now(), source: item.source, folder: item.folder },
    ].slice(-40));
  };

  const removeSemanticFeedback = (itemId: string) => {
    setSemanticFeedback(prev => prev.filter(entry => entry.id !== itemId));
  };

  const markSetupComplete = () => {
    try {
      localStorage.setItem('curator_setup_complete', '1');
    } catch { /* ignore */ }
  };

  const openSetupWizard = () => {
    setSetupStep(1);
    setSetupError(null);
    setCalibrationIndex(0);
    setCalibrationVotes(0);
    setShowSetupWizard(true);
  };

  const dismissSetupWizard = () => {
    markSetupComplete();
    setShowSetupWizard(false);
  };

  const finishSetup = () => {
    markSetupComplete();
    setShowSetupWizard(false);
    showToast(calibrationVotes > 0
      ? `Calibrated with ${calibrationVotes} verdicts — building your digest`
      : 'Setup saved — building your digest');
  };

  const loadCalibration = async () => {
    setLoadingCalibration(true);
    setSetupError(null);
    try {
      const res = await fetch('/api/calibrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sources,
          excludeIds: semanticFeedback.map(entry => entry.id),
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !Array.isArray(data.candidates) || data.candidates.length === 0) {
        setSetupError(data?.error || 'No live articles came back. Check your feed URLs, then try again.');
        return;
      }
      setCalibrationCandidates(data.candidates);
      setCalibrationIndex(0);
      setCalibrationVotes(0);
      setSetupStep(2);
    } catch {
      setSetupError('Could not reach your feeds. Check your connection and try again.');
    } finally {
      setLoadingCalibration(false);
    }
  };

  const answerCalibration = (item: DigestItem, vote: 'like' | 'dislike') => {
    recordSemanticFeedback(item, vote);
    setCalibrationVotes(prev => prev + 1);
    const nextIndex = calibrationIndex + 1;
    setCalibrationIndex(nextIndex);
    if (nextIndex >= calibrationCandidates.length) {
      setSetupStep(3);
    }
  };

  const handleMore = (item: DigestItem) => {
    const alreadyMore = (signals.moreIds || []).includes(item.id);
    const existingFeedback = semanticFeedback.find(entry => entry.id === item.id);
    if (alreadyMore && existingFeedback?.vote === 'like') {
      setSignals(prev => ({
        ...prev,
        moreIds: (prev.moreIds || []).filter(id => id !== item.id),
        moreTopics: [],
        lessTopics: [],
        more: [],
        less: [],
      }));
      removeSemanticFeedback(item.id);
      showToast('Removed this article from your semantic profile');
      return;
    }
    if (alreadyMore) {
      setSignals(prev => ({
        ...prev,
        lessIds: (prev.lessIds || []).filter(id => id !== item.id),
        moreTopics: [],
        lessTopics: [],
        more: [],
        less: [],
      }));
      recordSemanticFeedback(item, 'like');
      showToast('Added this like to your semantic profile');
      return;
    }

    setSignals(prev => ({
      ...prev,
      moreIds: Array.from(new Set([...(prev.moreIds || []), item.id])),
      lessIds: (prev.lessIds || []).filter(id => id !== item.id),
      moreTopics: [],
      lessTopics: [],
      more: [],
      less: [],
    }));
    recordSemanticFeedback(item, 'like');
    showToast('Semantic profile learned from this article');
  };

  const handleLess = (item: DigestItem) => {
    const isAlreadyLess = (signals.lessIds || []).includes(item.id);
    const existingFeedback = semanticFeedback.find(entry => entry.id === item.id);
    if (isAlreadyLess && !mutedCards[item.id]) {
      if (existingFeedback?.vote === 'dislike') {
        undoHandleLess(item.id);
      } else {
        recordSemanticFeedback(item, 'dislike');
        showToast('Added this dislike to your semantic profile');
      }
      return;
    }

    setSignals(prev => ({
      ...prev,
      lessIds: Array.from(new Set([...(prev.lessIds || []), item.id])),
      moreIds: (prev.moreIds || []).filter(id => id !== item.id),
      moreTopics: [],
      lessTopics: [],
      more: [],
      less: [],
    }));
    recordSemanticFeedback(item, 'dislike');

    // Retain in mutedCards so the card slot shows an inline Undo / Redo fallback
    setMutedCards(prev => ({
      ...prev,
      [item.id]: item
    }));

    showToast('Semantic profile learned to avoid this article', 'Undo', () => undoHandleLess(item.id));
  };

  const undoHandleLess = (itemId: string) => {
    const item = mutedCards[itemId] || digest.find(d => d.id === itemId) || feedStreamArticles.find(d => d.id === itemId);
    const topic = item?.folder;

    setMutedCards(prev => {
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
    removeSemanticFeedback(itemId);

    setSignals(prev => ({
      ...prev,
      lessIds: (prev.lessIds || []).filter(id => id !== itemId),
      moreTopics: [],
      lessTopics: [],
      more: [],
      less: [],
    }));

    showToast(topic ? `Restored article from ${topic}` : 'Restored article to feed');
  };

  const permanentlyDismissMuted = (itemId: string) => {
    setMutedCards(prev => {
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
    setDigest(prev => prev.filter(d => d.id !== itemId));
  };

  const handleSave = (item: DigestItem) => {
    const isSaved = savedIds.includes(item.id);
    if (isSaved) {
      setSavedIds(prev => prev.filter(id => id !== item.id));
      setSavedArticles(prev => prev.filter(a => a.id !== item.id));
      showToast('Removed from saved items');
    } else {
      setSavedIds(prev => [...prev, item.id]);
      setSavedArticles(prev => [item, ...prev.filter(a => a.id !== item.id)]);
      showToast('Saved to your reading queue');
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
      const responseText = await res.text();
      let data: any = null;
      try {
        data = responseText ? JSON.parse(responseText) : null;
      } catch {
        // The server may return a non-JSON error page, such as for an oversized request.
      }
      if (!res.ok) {
        setImportError(res.status === 413
          ? 'This OPML file is too large to import. Try a smaller export.'
          : data?.error || `Could not parse subscription file (HTTP ${res.status}).`);
        return;
      }
      if (!data || typeof data !== 'object') {
        setImportError('The OPML import service returned an invalid response. Please try again.');
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
      setImportError('Unable to reach the OPML import service. Please try again.');
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
        body: JSON.stringify({ query: q, apiKey: customApiKey })
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

  const getSourceAvatar = (feedUrl?: string): string | undefined => {
    if (!feedUrl) return undefined;
    try {
      const url = new URL(feedUrl);
      return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(url.hostname)}&sz=128`;
    } catch (e) {
      return undefined;
    }
  };

  const formatSyncTime = (timestamp?: number): string => {
    if (!timestamp) return 'Not synced yet';
    const diff = Math.max(0, Date.now() - timestamp);
    if (diff < 60 * 1000) return 'Just now';
    const mins = Math.floor(diff / (60 * 1000));
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const formatDeliveryTime = (value: string): string => {
    const [hours, minutes] = value.split(':').map(Number);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return value;
    const d = new Date();
    d.setHours(hours, minutes, 0, 0);
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  };

  const getShortSourceTitle = (title: string): string => {
    if (!title) return '';
    let clean = title.trim();
    // Strip leading articles and honorifics
    clean = clean.replace(/^(the|a|an)\s+/i, '');
    clean = clean.replace(/^dr\.?\s+/i, '');

    // Canonical source abbreviations for concise circle labels
    if (/^Stratechery/i.test(clean)) return 'Stratechery';
    if (/^Marginal Revolution/i.test(clean)) return 'Marginal Rev';
    if (/^World Politics/i.test(clean)) return 'World History';
    if (/^Long Now/i.test(clean)) return 'Long Now';
    if (/^Rest of World/i.test(clean)) return 'Rest of World';
    if (/^Dan Luu/i.test(clean)) return 'Dan Luu';
    if (/^List Apart/i.test(clean)) return 'List Apart';
    if (/^Anthropic/i.test(clean)) return 'Anthropic';
    if (/^Nicole Williams/i.test(clean)) return 'Nicole W.';
    if (/^Prospect/i.test(clean)) return 'Prospect';
    if (/^Bhaskar/i.test(clean)) return 'Bhaskar';

    const parts = clean.split(/\s+/);
    if (parts.length >= 2 && (parts[0].length + parts[1].length) <= 12) {
      return `${parts[0]} ${parts[1]}`;
    }
    return parts[0];
  };

  const handleRefreshSource = async (source: SourceItem) => {
    setRefreshingSourceId(source.id);
    try {
      // The endpoint matches on sourceTitle, not feedUrl — sending only feedUrl refreshed the wrong feeds
      const res = await fetch('/api/feed-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceTitle: source.title, sources })
      });
      const data = await res.json().catch(() => ({}));
      const articles: DigestItem[] = Array.isArray(data.articles) ? data.articles : [];
      const fetched = res.ok && articles.length > 0;

      setSources(prev => prev.map(s => {
        if (s.id !== source.id) return s;
        return fetched
          ? { ...s, lastSyncedAt: Date.now(), status: 'active' as const, failingReason: undefined }
          : {
              ...s,
              status: 'failing' as const,
              failingReason: res.ok ? 'This feed returned no articles.' : (data.error || `Feed returned HTTP ${res.status}.`)
            };
      }));

      if (fetched) {
        if (selectedFeedSource === source.title) {
          setFeedStreamArticles(articles);
        }
        showToast(`Fetched ${articles.length} ${articles.length === 1 ? 'article' : 'articles'} from "${source.title}"`);
      } else {
        showToast(`Could not refresh "${source.title}"`);
      }
    } catch (e) {
      setSources(prev => prev.map(s => s.id === source.id
        ? { ...s, status: 'failing' as const, failingReason: 'Network error while refreshing this feed.' }
        : s));
      showToast(`Could not refresh "${source.title}"`);
    } finally {
      setRefreshingSourceId(null);
    }
  };

  const releaseWakeLock = () => {
    wakeLockWantedRef.current = false;
    const lock = wakeLockRef.current;
    wakeLockRef.current = null;
    if (lock && typeof lock.release === 'function') {
      try {
        lock.release();
      } catch {
        // already released by the browser
      }
    }
  };

  const requestWakeLock = async () => {
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator) || wakeLockRef.current) return;
    wakeLockWantedRef.current = true;
    try {
      const lock = await (navigator as any).wakeLock.request('screen');
      if (!wakeLockWantedRef.current) {
        // Playback stopped while the request was in flight
        try { lock.release(); } catch { /* ignore */ }
        return;
      }
      wakeLockRef.current = lock;
      // The browser releases the lock automatically when the page is hidden
      lock.addEventListener?.('release', () => {
        if (wakeLockRef.current === lock) wakeLockRef.current = null;
      });
    } catch {
      // Denied (e.g. Low Power Mode) or unsupported — playback continues normally
    }
  };

  useEffect(() => {
    const onVisibilityChange = () => {
      // Locks are dropped on tab switch; re-acquire only if audio is still running unattended
      if (document.visibilityState === 'visible' && speechPlaying && !speechPaused) {
        requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [speechPlaying, speechPaused]);

  // Release the wake lock only when the app itself goes away
  useEffect(() => () => releaseWakeLock(), []);

  const handleToggleReadAloud = (article: DigestItem, restart = false, rateOverride?: number) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      showToast('Speech audio is not supported in this browser.');
      return;
    }

    if (speechPlaying && !restart) {
      if (speechPaused) {
        window.speechSynthesis.resume();
        setSpeechPaused(false);
        requestWakeLock();
        showToast('Resumed reading aloud');
      } else {
        window.speechSynthesis.pause();
        setSpeechPaused(true);
        releaseWakeLock();
        showToast('Paused reading aloud');
      }
      return;
    }

    window.speechSynthesis.cancel();

    const cleanBody = article.fullText
      .replace(/<[^>]*>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"');

    const textToRead = `${article.title}. By ${article.source}. ${article.summary}. ${cleanBody}`;
    const utterance = new SpeechSynthesisUtterance(textToRead);

    // Leave voice, rate, pitch and volume untouched so the system speaks with
    // the default voice and speech settings the user chose on the device.

    utterance.onstart = () => {
      setSpeechPlaying(true);
      setSpeechPaused(false);
      requestWakeLock();
      showToast('Reading aloud with your default voice');
    };

    utterance.onend = () => {
      releaseWakeLock();
      setSpeechPlaying(false);
      setSpeechPaused(false);
      // cancel() also fires onend — a deliberate stop must not mark the article finished
      const cancelled = speechCancelledRef.current;
      speechCancelledRef.current = false;
      if (cancelled) return;
      setReadingStats(prev => ({
        ...prev,
        [article.id]: { maxDepth: 100, finished: true, lastRead: Date.now() }
      }));
      setReadArticleIds(prev => (prev.includes(article.id) ? prev : [...prev, article.id]));
      showToast('Finished listening · Read through recorded');
    };

    utterance.onerror = (e) => {
      console.warn('SpeechSynthesis error:', e);
      releaseWakeLock();
      setSpeechPlaying(false);
      setSpeechPaused(false);
    };

    // Request during the user gesture; onstart confirms playback actually began
    speechCancelledRef.current = false;
    requestWakeLock();
    window.speechSynthesis.speak(utterance);
  };

  const handleStopReadAloud = () => {
    speechCancelledRef.current = true;
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    releaseWakeLock();
    setSpeechPlaying(false);
    setSpeechPaused(false);
  };

  const handleSendTestNotification = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      showToast('This browser does not support notifications.');
      return;
    }
    if (!notificationsEnabled) {
      showToast('Turn morning notifications on first.');
      return;
    }
    let permission = Notification.permission;
    if (permission === 'default') {
      permission = await Notification.requestPermission();
    }
    if (permission !== 'granted') {
      showToast('Notifications are blocked in your browser settings.');
      return;
    }
    try {
      new Notification('The Curator', {
        body: `${digest.length || itemCount} items ready in today's digest.`,
        icon: '/pwa-192x192.png'
      });
      showToast('Test notification sent');
    } catch {
      showToast('This browser could not show a notification.');
    }
  };

  const getCardActions = (itemId: string) => {
    const stats = readingStats[itemId] || {};

    const isReadThrough = Boolean(stats?.finished || (stats?.maxDepth && stats.maxDepth >= 85));
    const isClicked = readArticleIds.includes(itemId) || Boolean(stats?.maxDepth && stats.maxDepth > 0);
    const isVotedMore = Boolean(signals.moreIds?.includes(itemId));
    const isVotedLess = Boolean(signals.lessIds?.includes(itemId));
    const isSaved = savedIds.includes(itemId);

    const hasAnyAction = isReadThrough || isClicked || isVotedMore || isVotedLess || isSaved;

    const actionTags: Array<{ label: string; color: 'emerald' | 'amber' | 'rose' | 'sky' | 'purple' }> = [];

    if (isReadThrough) {
      actionTags.push({ label: 'Read through', color: 'emerald' });
    } else if (isClicked) {
      const depth = stats?.maxDepth ? `${stats.maxDepth}% read` : 'Clicked through';
      actionTags.push({ label: depth, color: 'sky' });
    }

    if (isVotedMore) {
      actionTags.push({ label: 'Voted More', color: 'amber' });
    } else if (isVotedLess) {
      actionTags.push({ label: 'Voted Less', color: 'rose' });
    }

    if (isSaved) {
      actionTags.push({ label: 'Saved', color: 'amber' });
    }

    return {
      hasAnyAction,
      isReadThrough,
      isClicked,
      isVotedMore,
      isVotedLess,
      isSaved,
      actionTags,
      summaryText: actionTags.length > 0 ? actionTags.map(t => t.label).join(' · ') : 'None',
    };
  };

  const openArticle = (item: DigestItem) => {
    setSelectedArticle(item);

    // Mark article as read / clicked
    setReadArticleIds(prev => (prev.includes(item.id) ? prev : [...prev, item.id]));

    // Update reading stats
    setReadingStats(prev => {
      const current = prev[item.id] || { maxDepth: 0, finished: false };
      return {
        ...prev,
        [item.id]: {
          ...current,
          lastRead: Date.now()
        }
      };
    });

    // Mark corresponding source as read to dismiss its orange dot immediately
    const match = sources.find(
      s => s.title.toLowerCase() === item.source.toLowerCase() ||
           item.source.toLowerCase().includes(s.title.toLowerCase())
    );
    if (match && !readSourceIds.includes(match.id)) {
      setReadSourceIds(prev => [...prev, match.id]);
    }
  };

  const closeArticle = () => {
    handleStopReadAloud();
    setSelectedArticle(null);
  };

  useEffect(() => {
    if (savedIds.length > 0) {
      const allKnownArticles = [...digest, ...feedStreamArticles];
      if (allKnownArticles.length > 0) {
        setSavedArticles(prev => {
          const existingIds = new Set(prev.map(a => a.id));
          const missing = allKnownArticles.filter(item => savedIds.includes(item.id) && !existingIds.has(item.id));
          if (missing.length > 0) {
            return [...prev, ...missing];
          }
          return prev;
        });
      }
    }
  }, [digest, feedStreamArticles, savedIds]);

  const sourcesByFolder = sources.reduce((acc, src) => {
    const folder = src.folder || 'Uncategorized';
    if (!acc[folder]) acc[folder] = [];
    acc[folder].push(src);
    return acc;
  }, {} as Record<string, SourceItem[]>);

  const savedDigestItems = [
    ...savedArticles,
    ...digest.filter(d => savedIds.includes(d.id) && !savedArticles.some(s => s.id === d.id)),
    ...feedStreamArticles.filter(a => savedIds.includes(a.id) && !savedArticles.some(s => s.id === a.id))
  ];
  const normalDigest = digest.filter(d => !d.isOutOfBubble);
  const outOfBubbleDigest = digest.filter(d => d.isOutOfBubble);
  const currentCalibrationItem = calibrationCandidates[calibrationIndex];
  const articleParagraphs = selectedArticle ? buildArticleParagraphs(selectedArticle.fullText) : [];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-slate-800 selection:text-white w-full max-w-full overflow-x-hidden">
      {/* Toast Notification with Undo / Action fallback */}
      {activeToast && (
        <div className="fixed safe-toast left-1/2 -translate-x-1/2 z-[60] max-w-[calc(100vw-2rem)] bg-slate-900/95 border border-slate-700/80 text-slate-200 text-xs px-4 py-2.5 rounded-full shadow-2xl flex items-center gap-3 animate-fade-in backdrop-blur-md">
          <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span>{activeToast.message}</span>
          {activeToast.actionLabel && activeToast.onAction && (
            <button
              type="button"
              onClick={() => {
                activeToast.onAction?.();
                setActiveToast(null);
              }}
              className="ml-1 px-2.5 py-0.5 rounded-full bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 font-semibold text-[11px] border border-amber-500/40 transition flex items-center gap-1 cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              <span>{activeToast.actionLabel}</span>
            </button>
          )}
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
              const wasFinished = Boolean(readingStats[selectedArticle.id]?.finished);
              setReadingStats(prev => {
                const current = prev[selectedArticle.id] || { maxDepth: 0, finished: false };
                const newMax = Math.max(current.maxDepth || 0, progress);
                const finished = newMax >= 80 || Boolean(current.finished);
                if (newMax === (current.maxDepth || 0) && finished === Boolean(current.finished)) return prev;
                return {
                  ...prev,
                  [selectedArticle.id]: { maxDepth: newMax, finished, lastRead: Date.now() }
                };
              });
              if (progress >= 80 || wasFinished) {
                setReadArticleIds(prev => (prev.includes(selectedArticle.id) ? prev : [...prev, selectedArticle.id]));
                const minutes = parseInt(selectedArticle.readTime) || 0;
                setWeeklyHistory(prev => {
                  if (prev.some(it => it.id === selectedArticle.id)) return prev;
                  return [{
                    id: selectedArticle.id,
                    title: selectedArticle.title,
                    source: selectedArticle.source,
                    folder: selectedArticle.folder,
                    readTime: selectedArticle.readTime,
                    minutesSpent: minutes,
                    completedAt: Date.now(),
                    url: selectedArticle.url
                  }, ...prev];
                });
              }
            }
          }}
        >
          <header className="sticky top-0 z-20 safe-reader-header bg-slate-950/95 backdrop-blur-md border-b border-slate-800/80 px-6 pb-4 flex items-center justify-between">
            {/* Visual reading progress bar */}
            <div className="absolute top-0 left-0 right-0 h-1 bg-slate-900 overflow-hidden">
              <div 
                className="h-full bg-amber-400 transition-all duration-150 ease-out"
                style={{ width: `${readingStats[selectedArticle.id]?.maxDepth || 0}%` }}
                role="progressbar"
                aria-valuenow={readingStats[selectedArticle.id]?.maxDepth || 0}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Article reading progress"
              />
            </div>

            <button 
              onClick={closeArticle}
              className="flex items-center gap-2 min-h-10 px-1 text-sm font-medium text-slate-400 hover:text-slate-100 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Digest</span>
            </button>
            <div className="flex items-center gap-2">
              <button 
                type="button"
                onClick={() => handleToggleReadAloud(selectedArticle)}
                className={`px-3 py-2 min-h-10 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition ${
                  speechPlaying
                    ? 'bg-amber-500/20 border-amber-500/50 text-amber-300 ring-2 ring-amber-500/30'
                    : 'bg-slate-900 border-slate-800 text-slate-300 hover:text-amber-400 hover:border-slate-700'
                }`}
                title="Read aloud with your default device voice"
              >
                {speechPlaying ? (
                  speechPaused ? <Play className="w-3.5 h-3.5 fill-current" /> : <Pause className="w-3.5 h-3.5 fill-current" />
                ) : (
                  <Volume2 className="w-3.5 h-3.5 text-amber-400" />
                )}
                <span>{speechPlaying ? (speechPaused ? 'Resume' : 'Pause') : 'Read aloud'}</span>
              </button>
              <button 
                onClick={() => handleSave(selectedArticle)}
                className={`p-2 min-w-10 min-h-10 flex items-center justify-center rounded-xl border transition-colors ${savedIds.includes(selectedArticle.id) ? 'bg-amber-500/10 border-amber-500/30 text-amber-400' : 'border-slate-800 text-slate-400 hover:text-slate-100'}`}
                title="Save for later"
              >
                <Bookmark className="w-4 h-4" />
              </button>
            </div>
          </header>

          <main className="max-w-2xl mx-auto w-full px-6 py-10 flex-1">
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

            {/* Minimalist Editorial Context Note */}
            <div className="mb-8 pb-5 border-b border-slate-900 flex items-start gap-2 text-xs text-slate-400">
              <span className="text-amber-400/90 font-medium not-italic shrink-0 whitespace-nowrap">Curator's Note:</span>
              <span className="italic text-slate-300 leading-relaxed">{selectedArticle.why}</span>
            </div>

            {/* Sleek Read Aloud bar (visible only when active) */}
            {speechPlaying && (
              <div className="mb-8 p-3 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center justify-between gap-3 text-xs animate-fade-in shadow-md">
                <div className="flex items-center gap-2.5 min-w-0">
                  <button
                    type="button"
                    onClick={() => handleToggleReadAloud(selectedArticle)}
                    className="w-7 h-7 rounded-lg bg-amber-500 text-slate-950 flex items-center justify-center shrink-0 hover:bg-amber-400 transition"
                    title={speechPaused ? 'Resume' : 'Pause'}
                  >
                    {speechPaused ? <Play className="w-3.5 h-3.5 fill-current ml-0.5" /> : <Pause className="w-3.5 h-3.5 fill-current" />}
                  </button>
                  <span className="text-slate-200 truncate" title="Voice and rate follow Settings › Accessibility › Spoken Content">
                    {speechPaused ? 'Audio paused' : 'Reading aloud with your default voice'}
                  </span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleStopReadAloud}
                    className="p-1 text-slate-400 hover:text-rose-400 transition"
                    title="Stop"
                  >
                    <Square className="w-3.5 h-3.5 fill-current" />
                  </button>
                </div>
              </div>
            )}

            <div className="max-w-[68ch] mx-auto text-slate-300 font-reading space-y-5 text-[1.0625rem] leading-[1.75]">
              {articleParagraphs.length > 0 ? articleParagraphs.map((paragraph, idx) => (
                <p key={idx} className="text-pretty">{paragraph}</p>
              )) : (
                <p className="text-slate-400 text-base">This feed supplied no readable body text. Use “Read original” below to open the article.</p>
              )}
            </div>

            {/* Typographic End-mark */}
            <div className="flex items-center justify-center pt-16 pb-8 text-slate-700">
              <span className="text-sm tracking-[0.6em] select-none opacity-40 font-serif">· · ·</span>
            </div>

            {/* Minimalist Editorial Completion & Tuning Footer */}
            <footer className="pt-10 pb-24">
              {/* Primary Outbound Action & Feedback Row */}
              <div className="flex items-center justify-between gap-4">
                <a
                  href={selectedArticle.url || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => {
                    setReadingStats(prev => ({
                      ...prev,
                      [selectedArticle.id]: {
                        maxDepth: Math.max(prev[selectedArticle.id]?.maxDepth || 0, 100),
                        finished: true,
                        lastRead: Date.now()
                      }
                    }));
                    setReadArticleIds(prev => (prev.includes(selectedArticle.id) ? prev : [...prev, selectedArticle.id]));
                    showToast(`Opening original on ${selectedArticle.source}`);
                  }}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-400 hover:text-amber-300 underline underline-offset-4 decoration-amber-500/40 hover:decoration-amber-300 transition-colors group cursor-pointer"
                >
                  <span>Read original</span>
                  <ExternalLink className="w-4 h-4 text-amber-400/80 group-hover:text-amber-300 group-hover:translate-x-0.5 transition-transform shrink-0" />
                </a>

                {/* Feedback Icons Aligned to Right */}
                <div className="flex items-center gap-1.5 ml-auto">
                  <button
                    type="button"
                    onClick={() => handleMore(selectedArticle)}
                    className={`p-2 min-w-10 min-h-10 flex items-center justify-center rounded-xl transition cursor-pointer ${
                      signals.moreIds?.includes(selectedArticle.id)
                        ? 'text-amber-400 bg-amber-500/15 border border-amber-500/40 shadow-sm'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent'
                    }`}
                    title={
                      signals.moreIds?.includes(selectedArticle.id)
                        ? 'More on this topic (active)'
                        : 'More on this topic'
                    }
                    aria-label="More on this topic"
                  >
                    <ThumbsUp className={`w-4 h-4 ${
                      signals.moreIds?.includes(selectedArticle.id)
                        ? 'fill-amber-400/30'
                        : ''
                    }`} />
                  </button>

                  <button
                    type="button"
                    onClick={() => handleLess(selectedArticle)}
                    className={`p-2 min-w-10 min-h-10 flex items-center justify-center rounded-xl transition cursor-pointer ${
                      signals.lessIds?.includes(selectedArticle.id)
                        ? 'text-rose-400 bg-rose-500/15 border border-rose-500/40 shadow-sm'
                        : 'text-slate-400 hover:text-rose-400 hover:bg-slate-900 border border-transparent'
                    }`}
                    title={
                      signals.lessIds?.includes(selectedArticle.id)
                        ? 'Fewer on this topic (active)'
                        : 'Fewer on this topic'
                    }
                    aria-label="Fewer on this topic"
                  >
                    <ThumbsDown className={`w-4 h-4 ${
                      signals.lessIds?.includes(selectedArticle.id)
                        ? 'fill-rose-400/30'
                        : ''
                    }`} />
                  </button>

                  {signals.lessIds?.includes(selectedArticle.id) && (
                    <button
                      type="button"
                      onClick={() => undoHandleLess(selectedArticle.id)}
                      className="p-1.5 text-xs text-amber-400 hover:text-amber-300 transition-colors"
                      title="Undo fewer on this topic"
                      aria-label="Undo"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </footer>
          </main>
        </div>
      )}

      {/* Main Top Header Bar */}
      <header className="sticky top-0 z-40 w-full safe-header bg-slate-950/95 backdrop-blur-md border-b border-slate-900/80 px-3 sm:px-6 pb-3 shrink-0 shadow-sm">
        <div className="max-w-3xl w-full mx-auto flex items-center justify-between gap-3">
          {/* Official Brand Logo & Subtitle */}
          <button 
            type="button" 
            onClick={() => setActiveTab('today')}
            className="flex items-center gap-3 text-left focus:outline-none group cursor-pointer"
            title="The Curator — Home"
          >
            <CuratorMark className="w-9 h-9 sm:w-10 sm:h-10 drop-shadow-md group-hover:scale-105 transition-transform" />
            <div className="min-w-0">
              <div className="flex items-baseline gap-1.5 leading-none">
                <span className="font-serif text-[11px] font-semibold tracking-[0.24em] text-amber-500/90">THE</span>
                <span className="font-serif text-base font-bold tracking-[0.16em] text-slate-100">CURATOR</span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1 truncate">Your morning reading editor</p>
            </div>
          </button>

          {/* Right Action Icons: Weekly Review, Refresh and Settings */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setShowWeeklyReviewModal(true)}
              className="flex items-center justify-center gap-1.5 px-3 min-w-11 min-h-11 rounded-full bg-slate-900 border border-slate-800 hover:border-amber-500/40 text-slate-300 hover:text-amber-300 transition text-xs font-medium cursor-pointer shadow-sm group"
              title="Open Weekly Reading Review"
            >
              <BarChart3 className="w-3.5 h-3.5 text-amber-400 group-hover:scale-110 transition-transform" />
              <span className="hidden sm:inline font-mono text-[11px] text-amber-300 font-semibold">{totalWeeklyMinutes}m week</span>
            </button>
            <button 
              type="button"
              onClick={() => generateDigest({ fresh: true })}
              disabled={loadingDigest}
              className="w-11 h-11 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-300 hover:text-slate-100 hover:border-slate-700 transition disabled:opacity-50 cursor-pointer"
              title="Refresh today's digest"
            >
              <RefreshCw className={`w-4 h-4 ${loadingDigest ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={() => setActiveTab(prev => prev === 'settings' ? 'today' : 'settings')}
              className={`w-11 h-11 rounded-full border flex items-center justify-center transition cursor-pointer shadow-sm ${
                activeTab === 'settings'
                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                  : 'bg-slate-900 border-slate-800 text-slate-300 hover:text-slate-100 hover:border-slate-700'
              }`}
              title="Settings & Preferences"
            >
              <Sliders className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Content Area */}
      <main className="flex-1 max-w-3xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 pb-32 safe-main overflow-x-hidden">
        {/* TAB 1: TODAY */}
        {activeTab === 'today' && (
          <div className="space-y-6 animate-fade-in w-full max-w-full">
            {/* Weekly Intellectual Summary Banner Card */}
            <div 
              onClick={() => setShowWeeklyReviewModal(true)}
              className="p-4 rounded-2xl bg-gradient-to-r from-amber-500/10 via-slate-900/80 to-slate-900/60 border border-amber-500/20 flex items-center justify-between gap-3 text-xs cursor-pointer hover:border-amber-500/40 hover:bg-slate-900 transition-all shadow-sm group"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0">
                  <BarChart3 className="w-4 h-4 text-amber-400" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 font-semibold text-slate-200 truncate">
                    <span>Weekly Reading Retrospective</span>
                    <span className="text-[10px] font-mono font-normal text-amber-300 bg-amber-500/20 px-1.5 py-0.5 rounded shrink-0">
                      {totalWeeklyMinutes} mins
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5 truncate">
                    Top focus: <span className="text-slate-300 font-medium">{topWeeklyTopic}</span> · {weeklyRecent.length} articles read
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1 text-amber-400 group-hover:translate-x-0.5 transition-transform shrink-0 font-medium text-[11px]">
                <span className="hidden sm:inline">View Review</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </div>
            </div>

            <div className="flex flex-col items-start gap-3 border-b border-slate-900 pb-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold tracking-tight text-slate-100">Today's Digest</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Curated at {formatDeliveryTime(deliveryTime)} · {digest.length} items worth your time
                  {semanticSummary && semanticSummary.feedbackExamples > 0
                    ? ` · ranked from ${semanticSummary.feedbackExamples} vote examples`
                    : ''}
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span>Show:</span>
                {[5, 6, 8, 10].map(num => (
                  <button
                    key={num}
                    onClick={() => setItemCount(num)}
                    className={`px-3 py-2 min-h-9 rounded-lg font-medium transition ${itemCount === num ? 'bg-slate-800 text-slate-100 shadow-inner' : 'text-slate-400 hover:text-slate-200'}`}
                  >
                    {num}
                  </button>
                ))}
              </div>
            </div>

            {feedReport && feedReport.failed.length > 0 && (
              <button
                type="button"
                onClick={() => setActiveTab('sources')}
                className="w-full flex items-center gap-2 text-left text-[11px] text-amber-300/80 bg-amber-500/5 border border-amber-500/20 rounded-xl px-3 py-2 hover:bg-amber-500/10 transition"
              >
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>
                  {feedReport.failed.length} of {feedReport.attempted} feeds returned nothing today
                  {' '}({feedReport.failed.slice(0, 3).map(f => f.title).join(', ')}
                  {feedReport.failed.length > 3 ? ', …' : ''}). Tap to review sources.
                </span>
              </button>
            )}

            {loadingDigest && digest.length === 0 ? (
              <div className="py-20 text-center text-slate-500 space-y-3">
                <RefreshCw className="w-6 h-6 animate-spin mx-auto text-amber-500" />
                <p className="text-sm">Synthesizing your morning reading list...</p>
              </div>
            ) : digest.length === 0 ? (
              <div className="py-20 text-center text-slate-500 space-y-2">
                <p className="text-sm">No new items today. Your sources are quiet.</p>
                <button onClick={() => generateDigest({ fresh: true })} className="text-xs text-amber-400 underline">Fetch today's live digest</button>
              </div>
            ) : (
              <div className="space-y-8">
                {/* Normal Curated Cards */}
                {normalDigest.map((item) => {
                  const actions = getCardActions(item.id);

                  if (mutedCards[item.id]) {
                    return (
                      <div 
                        key={item.id} 
                        className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80 flex items-center justify-between text-xs animate-fade-in backdrop-blur-sm shadow-sm"
                      >
                        <div className="flex items-center gap-2.5 text-slate-300">
                          <EyeOff className="w-4 h-4 text-slate-500 shrink-0" />
                          <span>
                            Quietened <span className="font-semibold text-slate-200">"{item.source}"</span> · Fewer stories like this will appear.
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); undoHandleLess(item.id); }}
                            className="px-3 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-300 hover:bg-amber-500/30 font-semibold transition flex items-center gap-1.5 cursor-pointer shadow-sm"
                            title="Undo: Restore this card immediately"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>Undo / Redo</span>
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); permanentlyDismissMuted(item.id); }}
                            className="text-slate-500 hover:text-slate-300 p-1.5 rounded-md transition"
                            title="Dismiss placeholder"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <article 
                      key={item.id}
                      onClick={() => openArticle(item)}
                      className={`group rounded-3xl transition-all duration-300 cursor-pointer overflow-hidden relative ${
                        actions.hasAnyAction
                          ? 'bg-slate-900/95 border-2 border-emerald-500/60 shadow-[0_22px_50px_-8px_rgba(0,0,0,0.95),0_0_0_1px_rgba(16,185,129,0.35)] hover:border-emerald-400 hover:shadow-[0_28px_60px_-8px_rgba(0,0,0,0.98),0_0_0_1.5px_rgba(16,185,129,0.5)]'
                          : 'bg-slate-900/95 border-2 border-slate-700/80 shadow-[0_22px_50px_-8px_rgba(0,0,0,0.95),0_0_0_1px_rgba(255,255,255,0.12)] hover:border-amber-500/60 hover:shadow-[0_28px_60px_-8px_rgba(0,0,0,0.98),0_0_0_1.5px_rgba(245,158,11,0.35)]'
                      }`}
                    >
                      {/* Author sub-header with Substack branding and Actioned status */}
                      <div className="p-5 pb-3 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {(() => {
                            const itemAvatar = getSourceAvatar(item.url);
                            return (
                              <div className="w-9 h-9 rounded-full bg-slate-900 border border-slate-700 flex items-center justify-center overflow-hidden shrink-0 relative">
                                {itemAvatar ? (
                                  <img 
                                    src={itemAvatar} 
                                    alt={item.source}
                                    className="w-full h-full object-cover rounded-full"
                                    onError={(e) => {
                                      (e.currentTarget as HTMLElement).style.display = 'none';
                                      const fallback = e.currentTarget.parentElement?.querySelector('.card-author-initials');
                                      if (fallback) fallback.classList.remove('hidden');
                                    }}
                                  />
                                ) : null}
                                <span className={`card-author-initials text-xs font-bold text-amber-400 ${itemAvatar ? 'hidden' : ''}`}>
                                  {item.source.slice(0, 2).toUpperCase()}
                                </span>
                              </div>
                            );
                          })()}
                          <div>
                            <div className="text-xs font-bold text-slate-100 flex items-center gap-1.5">
                              <span>{item.source}</span>
                            </div>
                            <div className="text-[11px] text-slate-400">
                              {item.publishedAt || '30m'} · {item.folder} · {item.readTime}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {actions.isReadThrough ? (
                            <div 
                              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-950/90 border border-emerald-500/60 text-[10px] font-bold text-emerald-300 shadow-sm"
                              title="Read through completed"
                            >
                              <Check className="w-3 h-3 text-emerald-400 stroke-[3]" />
                              <span>Read through</span>
                            </div>
                          ) : actions.isVotedMore ? (
                            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-950/90 border border-amber-500/50 text-[10px] font-bold text-amber-300">
                              <ThumbsUp className="w-3 h-3 text-amber-400" />
                              <span>More like this</span>
                            </div>
                          ) : actions.isVotedLess ? (
                            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-950/90 border border-rose-500/50 text-[10px] font-bold text-rose-300">
                              <ThumbsDown className="w-3 h-3 text-rose-400" />
                              <span>Less like this</span>
                            </div>
                          ) : actions.isClicked ? (
                            <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-sky-950/90 border border-sky-500/40 text-[10px] font-medium text-sky-300">
                              <span>Opened</span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-slate-800/80 border border-slate-700/60 text-[10px] font-medium text-slate-400">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                              <span>New</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Billboard Hero Image Card with Bookmark Save Button right on image */}
                      {item.bannerImage && (
                        <div className="relative mx-3.5 rounded-2xl overflow-hidden h-60 md:h-72 shadow-lg border border-slate-700/60">
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
                              className={`p-2.5 min-w-11 min-h-11 flex items-center justify-center rounded-xl backdrop-blur-md border transition shadow-lg ${
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

                        {/* Quiet editorial why note */}
                        <p className="text-xs text-slate-400 italic">
                          <span className="text-amber-400/90 font-medium not-italic">Why: </span>{item.why}
                        </p>

                        {/* Card Curation & Reading Actions */}
                        <div className="pt-2 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
                          {/* Read More Link directly to original source */}
                          <a
                            href={item.url || '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => {
                              e.stopPropagation();
                              setReadArticleIds(prev => (prev.includes(item.id) ? prev : [...prev, item.id]));
                              showToast(`Opening source on ${item.source}`);
                            }}
                            className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-amber-300 transition-colors"
                            title={`Read more on ${item.source} (opens external browser or app)`}
                          >
                            <span>Read original on {item.source}</span>
                            <ExternalLink className="w-3 h-3 text-slate-500" />
                          </a>

                          {/* Curation actions: More, Less (icon-only, reading preferences) */}
                          <div className="flex items-center gap-1.5">
                            <button 
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleMore(item); }}
                              className={`p-2 min-w-10 min-h-10 flex items-center justify-center rounded-xl border transition ${
                                actions.isVotedMore
                                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-300 shadow-sm'
                                  : 'bg-slate-950/80 border-slate-700/80 text-slate-400 hover:text-amber-300 hover:border-amber-500/40'
                              }`}
                              title={actions.isVotedMore ? `More on ${item.folder || 'this topic'} (voted)` : `More on ${item.folder || 'this topic'}`}
                              aria-label={`More on ${item.folder || 'this topic'}`}
                            >
                              <ThumbsUp className={`w-3.5 h-3.5 ${
                                actions.isVotedMore ? 'fill-amber-400/30' : ''
                              }`} />
                            </button>
                            <button 
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleLess(item); }}
                              className={`p-2 min-w-10 min-h-10 flex items-center justify-center rounded-xl border transition ${
                                actions.isVotedLess
                                  ? 'bg-rose-500/20 border-rose-500/50 text-rose-300 shadow-sm'
                                  : 'bg-slate-950/80 border-slate-700/80 text-slate-400 hover:text-rose-300 hover:border-rose-500/40'
                              }`}
                              title={actions.isVotedLess ? `Fewer on ${item.folder || 'this topic'} (voted)` : `Fewer on ${item.folder || 'this topic'}`}
                              aria-label={`Fewer on ${item.folder || 'this topic'}`}
                            >
                              <ThumbsDown className={`w-3.5 h-3.5 ${
                                actions.isVotedLess ? 'fill-rose-400/30' : ''
                              }`} />
                            </button>
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}

                {/* Out of Bubble Stretch Section */}
                {outOfBubbleDigest.length > 0 && (
                  <div className="pt-6 space-y-6">
                    <div className="flex items-center gap-2 border-b border-slate-900 pb-3">
                      <Sparkles className="w-4 h-4 text-rose-400" />
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-rose-400">
                        Deliberate Stretch — Outside Your Usual Bubble
                      </h3>
                    </div>

                    {outOfBubbleDigest.map((item) => {
                      const actions = getCardActions(item.id);

                      if (mutedCards[item.id]) {
                        return (
                          <div 
                            key={item.id} 
                            className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80 flex items-center justify-between text-xs animate-fade-in backdrop-blur-sm shadow-sm"
                          >
                            <div className="flex items-center gap-2.5 text-slate-300">
                              <EyeOff className="w-4 h-4 text-slate-500 shrink-0" />
                              <span>
                                Quietened stretch item <span className="font-semibold text-slate-200">"{item.source}"</span>
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); undoHandleLess(item.id); }}
                                className="px-3 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-300 hover:bg-amber-500/30 font-semibold transition flex items-center gap-1.5 cursor-pointer shadow-sm"
                                title="Undo: Restore this stretch item"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                                <span>Undo / Redo</span>
                              </button>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); permanentlyDismissMuted(item.id); }}
                                className="text-slate-500 hover:text-slate-300 p-1.5 rounded-md transition"
                                title="Dismiss placeholder"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      }

                      return (
                        <article 
                          key={item.id}
                          onClick={() => openArticle(item)}
                          className={`group rounded-3xl transition-all duration-300 cursor-pointer overflow-hidden relative ${
                            actions.hasAnyAction
                              ? 'bg-slate-900/95 border-2 border-emerald-500/60 shadow-[0_22px_50px_-8px_rgba(0,0,0,0.95),0_0_0_1px_rgba(16,185,129,0.35)] hover:border-emerald-400 hover:shadow-[0_28px_60px_-8px_rgba(0,0,0,0.98),0_0_0_1.5px_rgba(16,185,129,0.5)]'
                              : 'bg-slate-900/95 border-2 border-rose-600/70 shadow-[0_22px_50px_-8px_rgba(0,0,0,0.95),0_0_0_1px_rgba(244,63,94,0.3)] hover:border-rose-500 hover:shadow-[0_28px_60px_-8px_rgba(0,0,0,0.98),0_0_0_1.5px_rgba(244,63,94,0.45)]'
                          }`}
                        >
                          <div className="p-5 pb-3 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                            {(() => {
                            const itemAvatar = getSourceAvatar(item.url);
                            return (
                              <div className="w-9 h-9 rounded-full bg-slate-900 border border-rose-800 flex items-center justify-center overflow-hidden shrink-0 relative">
                                {itemAvatar ? (
                                  <img 
                                    src={itemAvatar} 
                                    alt={item.source}
                                    className="w-full h-full object-cover rounded-full"
                                    onError={(e) => {
                                      (e.currentTarget as HTMLElement).style.display = 'none';
                                      const fallback = e.currentTarget.parentElement?.querySelector('.out-author-initials');
                                      if (fallback) fallback.classList.remove('hidden');
                                    }}
                                  />
                                ) : null}
                                <span className={`out-author-initials text-xs font-bold text-rose-300 ${itemAvatar ? 'hidden' : ''}`}>
                                  {item.source.slice(0, 2).toUpperCase()}
                                </span>
                              </div>
                            );
                          })()}
                              <div>
                                <div className="text-xs font-bold text-rose-200">{item.source}</div>
                                <div className="text-[11px] text-rose-400/80">{item.folder} · {item.readTime}</div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {actions.isReadThrough ? (
                                <div 
                                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-950/90 border border-emerald-500/60 text-[10px] font-bold text-emerald-300 shadow-sm"
                                  title="Read through completed"
                                >
                                  <Check className="w-3 h-3 text-emerald-400 stroke-[3]" />
                                  <span>Read through</span>
                                </div>
                              ) : actions.isVotedMore ? (
                                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-950/90 border border-amber-500/50 text-[10px] font-bold text-amber-300">
                                  <ThumbsUp className="w-3 h-3 text-amber-400" />
                                  <span>More like this</span>
                                </div>
                              ) : actions.isVotedLess ? (
                                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-950/90 border border-rose-500/50 text-[10px] font-bold text-rose-300">
                                  <ThumbsDown className="w-3 h-3 text-rose-400" />
                                  <span>Less like this</span>
                                </div>
                              ) : actions.isClicked ? (
                                <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-sky-950/90 border border-sky-500/40 text-[10px] font-medium text-sky-300">
                                  <span>Opened</span>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-rose-950/70 border border-rose-800/60 text-[10px] font-medium text-rose-300">
                                  <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />
                                  <span>Stretch</span>
                                </div>
                              )}
                              <span className="text-[10px] uppercase font-semibold tracking-wider bg-rose-950/80 text-rose-300 px-2.5 py-0.5 rounded-full border border-rose-800/60">
                                Outside Bubble
                              </span>
                            </div>
                          </div>

                          {item.bannerImage && (
                            <div className="relative mx-3.5 rounded-2xl overflow-hidden h-60 md:h-64 shadow-lg border border-rose-800/40">
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
                                  className={`p-2.5 min-w-11 min-h-11 flex items-center justify-center rounded-xl backdrop-blur-md border transition shadow-lg ${
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

                            {/* Quiet editorial why note */}
                            <p className="text-xs text-rose-300/80 italic">
                              <span className="text-rose-400 font-medium not-italic">Why: </span>{item.why}
                            </p>

                            {/* Stretch Card Actions: Read more, More, Less */}
                            <div className="pt-2 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
                              {/* Read More Link directly to original source */}
                              <a
                                href={item.url || '#'}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setReadArticleIds(prev => (prev.includes(item.id) ? prev : [...prev, item.id]));
                                  showToast(`Opening source on ${item.source}`);
                                }}
                                className="inline-flex items-center gap-1.5 text-xs text-rose-400 hover:text-rose-300 transition-colors"
                                title={`Read more on ${item.source} (opens external browser or app)`}
                              >
                                <span>Read original on {item.source}</span>
                                <ExternalLink className="w-3 h-3 text-rose-500/70" />
                              </a>

                              {/* Curation actions: More, Less (icon-only) */}
                              <div className="flex items-center gap-1.5">
                                <button 
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); handleMore(item); }}
                                  className={`p-2 min-w-10 min-h-10 flex items-center justify-center rounded-xl border transition ${
                                    signals.moreIds?.includes(item.id)
                                      ? 'bg-amber-500/20 border-amber-500/50 text-amber-300 shadow-sm'
                                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-amber-300 hover:border-amber-500/40'
                                  }`}
                                  title={signals.moreIds?.includes(item.id) ? `More on ${item.folder || 'this topic'} (voted)` : `More on ${item.folder || 'this topic'}`}
                                  aria-label={`More on ${item.folder || 'this topic'}`}
                                >
                                  <ThumbsUp className={`w-3.5 h-3.5 ${
                                    signals.moreIds?.includes(item.id) ? 'fill-amber-400/30' : ''
                                  }`} />
                                </button>
                                <button 
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); handleLess(item); }}
                                  className={`p-2 min-w-10 min-h-10 flex items-center justify-center rounded-xl border transition ${
                                    signals.lessIds?.includes(item.id)
                                      ? 'bg-rose-500/20 border-rose-500/50 text-rose-300 shadow-sm'
                                      : 'bg-slate-900 border border-slate-700/80 text-slate-400 hover:text-rose-300 hover:border-rose-500/40'
                                  }`}
                                  title={signals.lessIds?.includes(item.id) ? `Fewer on ${item.folder || 'this topic'} (voted)` : `Fewer on ${item.folder || 'this topic'}`}
                                  aria-label={`Fewer on ${item.folder || 'this topic'}`}
                                >
                                  <ThumbsDown className={`w-3.5 h-3.5 ${
                                    signals.lessIds?.includes(item.id) ? 'fill-rose-400/30' : ''
                                  }`} />
                                </button>
                              </div>
                            </div>
                          </div>
                        </article>
                      );
                    })}
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
                {savedDigestItems.map((item) => {
                  const actions = getCardActions(item.id);
                  return (
                    <article 
                      key={item.id}
                      onClick={() => openArticle(item)}
                      className={`p-5 rounded-2xl transition-all duration-300 cursor-pointer space-y-3 relative ${
                        actions.hasAnyAction
                          ? 'bg-slate-900/95 border-2 border-emerald-500/60 shadow-[0_16px_40px_-6px_rgba(0,0,0,0.95),0_0_0_1px_rgba(16,185,129,0.3)] hover:border-emerald-400'
                          : 'bg-slate-900/95 border-2 border-slate-700/80 shadow-[0_16px_40px_-6px_rgba(0,0,0,0.95),0_0_0_1px_rgba(255,255,255,0.1)] hover:border-amber-500/50'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs text-slate-400">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-200">{item.source}</span>
                          <span aria-hidden="true">·</span>
                          <span>{item.readTime}</span>
                          <span aria-hidden="true">·</span>
                          <span className="text-amber-400 font-semibold flex items-center gap-1">
                            <Bookmark className="w-3 h-3 fill-amber-400" /> Saved
                          </span>
                          {actions.isReadThrough && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-emerald-400 font-semibold flex items-center gap-1">
                                <Check className="w-3 h-3 stroke-[3]" /> Read through
                              </span>
                            </>
                          )}
                        </div>
                        <div className="flex items-center gap-2.5">
                          <a
                            href={item.url || '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => {
                              e.stopPropagation();
                              setReadArticleIds(prev => (prev.includes(item.id) ? prev : [...prev, item.id]));
                              showToast(`Opening source on ${item.source}`);
                            }}
                            className="text-xs text-amber-400 hover:text-amber-300 font-medium flex items-center gap-1 transition"
                            title={`Read more on ${item.source} (opens external browser or app)`}
                          >
                            <span>Read more</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>

                          <button 
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleSave(item); }}
                            className="text-xs text-rose-400 hover:text-rose-300 font-medium transition"
                          >
                            Unsave
                          </button>
                        </div>
                      </div>

                      <h3 className="text-base font-semibold text-slate-100 hover:text-amber-300 transition">
                        {item.title}
                      </h3>
                      <p className="text-xs text-slate-400 line-clamp-1">{item.summary}</p>
                    </article>
                  );
                })}
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
            <section className="p-4 sm:p-5 rounded-3xl bg-slate-900/40 border border-slate-900 space-y-4 w-full max-w-full overflow-hidden">
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
              <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs flex items-start gap-3 w-full max-w-full">
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <span className="font-semibold block mb-0.5">Some sources require attention</span>
                  <span>{sources.filter(s => s.status === 'failing').length} source is currently not responding and has been quietly bypassed in digests.</span>
                </div>
              </div>
            )}

            <div className="space-y-6 w-full max-w-full">
              {Object.entries(sourcesByFolder).map(([folder, folderSources]: [string, SourceItem[]]) => (
                <div key={folder} className="space-y-3 w-full max-w-full">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-900 pb-2">
                    {folder} ({folderSources.length})
                  </h3>
                  <div className="grid gap-2 w-full max-w-full">
                    {folderSources.map((src) => {
                      const avatarUrl = getSourceAvatar(src.feedUrl);
                      const isRefreshing = refreshingSourceId === src.id;
                      return (
                        <div key={src.id} className="p-3.5 sm:p-4 rounded-2xl bg-slate-900/40 border border-slate-900 flex items-center justify-between gap-3 sm:gap-4 w-full max-w-full overflow-hidden">
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <div className="w-10 h-10 rounded-full bg-slate-950 border border-slate-800 flex items-center justify-center overflow-hidden shrink-0 relative">
                              {avatarUrl ? (
                                <img 
                                  src={avatarUrl} 
                                  alt={src.title} 
                                  className="w-full h-full object-cover rounded-full"
                                  onError={(e) => {
                                    (e.currentTarget as HTMLElement).style.display = 'none';
                                    const fallback = e.currentTarget.parentElement?.querySelector('.src-list-initials');
                                    if (fallback) fallback.classList.remove('hidden');
                                  }}
                                />
                              ) : null}
                              <span className={`src-list-initials text-xs font-bold text-amber-400 ${avatarUrl ? 'hidden' : ''}`}>
                                {src.title.slice(0, 2).toUpperCase()}
                              </span>
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-sm font-medium text-slate-200 truncate">{src.title}</span>
                                {src.status === 'failing' ? (
                                  <span className="text-[10px] bg-rose-500/10 text-rose-400 border border-rose-500/20 px-2 py-0.5 rounded shrink-0">Failing</span>
                                ) : (
                                  <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded shrink-0">Active</span>
                                )}
                              </div>
                              <span className="text-xs text-slate-400 truncate block mt-0.5">{src.feedUrl}</span>
                              <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mt-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                                <span>Synced {formatSyncTime(src.lastSyncedAt)}</span>
                              </div>
                              {src.failingReason && (
                                <span className="text-xs text-rose-400 block mt-1 break-words">{src.failingReason}</span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <button 
                              type="button"
                              onClick={() => handleRefreshSource(src)}
                              disabled={isRefreshing}
                              className="p-2 min-w-10 min-h-10 flex items-center justify-center text-slate-400 hover:text-amber-400 transition"
                              title="Force refresh this feed"
                            >
                              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-amber-400' : ''}`} />
                            </button>
                            <button 
                              type="button"
                              onClick={() => handleDeleteSource(src.id)}
                              className="p-2 min-w-10 min-h-10 flex items-center justify-center text-slate-500 hover:text-rose-400 transition"
                              title="Remove source"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* Add Source Modal */}
            {showAddSourceModal && (
              <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4 safe-modal">
                <div className="w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-3xl bg-slate-900 border border-slate-800 p-6 space-y-4">
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

            {/* First-run semantic setup */}
            {showSetupWizard && (
              <div className="fixed inset-0 z-[70] bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4">
                <div className="w-full max-w-lg rounded-3xl bg-slate-900 border border-slate-800 p-6 space-y-5 max-h-[90vh] overflow-y-auto animate-fade-in">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] uppercase tracking-wider text-amber-400/90 font-semibold">
                        Setup · step {setupStep} of 3
                      </p>
                      <h3 className="text-lg font-semibold text-slate-100 mt-1">
                        {setupStep === 1
                          ? 'Set up your semantic curator'
                          : setupStep === 2
                            ? 'Teach it in ten taps'
                            : 'Your engine is ready'}
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={dismissSetupWizard}
                      className="p-1 text-slate-500 hover:text-slate-200 transition"
                      title="Skip setup"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {[1, 2, 3].map(step => (
                      <span
                        key={step}
                        className={`h-1 flex-1 rounded-full transition-colors ${step <= setupStep ? 'bg-amber-500' : 'bg-slate-800'}`}
                      />
                    ))}
                  </div>

                  {setupStep === 1 && (
                    <div className="space-y-4">
                      <p className="text-xs text-slate-400 leading-relaxed">
                        Curator ranks your feeds by similarity to what you vote on. That profile comes from a few quick
                        verdicts below and stays in this browser — no account, no key, no third-party calls.
                      </p>

                      <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 text-xs text-slate-300 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-400">Feeds in your library</span>
                          <span className="font-semibold text-slate-100">{sources.length}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-400">Votes already in your profile</span>
                          <span className="font-semibold text-slate-100">{semanticFeedback.length}</span>
                        </div>
                      </div>

                      {setupError && (
                        <p className="text-[11px] text-rose-400 leading-relaxed">{setupError}</p>
                      )}

                      <div className="space-y-2">
                        <button
                          type="button"
                          onClick={loadCalibration}
                          disabled={loadingCalibration}
                          className="w-full px-4 py-2.5 rounded-xl bg-amber-500 text-slate-950 text-xs font-semibold flex items-center justify-center gap-2 hover:bg-amber-400 transition disabled:opacity-60"
                        >
                          {loadingCalibration ? (
                            <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Scanning your feeds…</>
                          ) : (
                            <><Sparkles className="w-3.5 h-3.5" /> Scan my feeds and calibrate</>
                          )}
                        </button>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setShowAddSourceModal(true)}
                            className="flex-1 px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs font-medium text-slate-300 hover:text-slate-100 transition"
                          >
                            Import OPML
                          </button>
                          <button
                            type="button"
                            onClick={finishSetup}
                            className="flex-1 px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs font-medium text-slate-400 hover:text-slate-200 transition"
                          >
                            Skip for now
                          </button>
                        </div>
                      </div>

                      <p className="text-[11px] text-slate-500 leading-relaxed">
                        No provider keys needed. OpenAI-compatible or Gemini embeddings are an optional upgrade in Settings.
                      </p>
                    </div>
                  )}

                  {setupStep === 2 && (
                    <div className="space-y-4">
                      <p className="text-xs text-slate-400 leading-relaxed">
                        Say what you would read and what you would not. Titles and excerpts only — the built-in engine
                        scores them on this app's server.
                      </p>

                      {currentCalibrationItem ? (
                        <div className="p-4 rounded-2xl bg-slate-950/70 border border-slate-800 space-y-2">
                          <div className="text-[11px] text-slate-500">
                            {currentCalibrationItem.source} · {currentCalibrationItem.folder}
                          </div>
                          <h4 className="text-sm font-semibold text-slate-100 leading-snug">
                            {currentCalibrationItem.title}
                          </h4>
                          <p className="text-[11px] text-slate-400 leading-relaxed line-clamp-3">
                            {currentCalibrationItem.summary}
                          </p>
                          <div className="flex gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => answerCalibration(currentCalibrationItem, 'like')}
                              className="flex-1 px-3 py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-semibold flex items-center justify-center gap-1.5 hover:bg-emerald-500/25 transition"
                            >
                              <ThumbsUp className="w-3.5 h-3.5" /> More like this
                            </button>
                            <button
                              type="button"
                              onClick={() => answerCalibration(currentCalibrationItem, 'dislike')}
                              className="flex-1 px-3 py-2 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-semibold flex items-center justify-center gap-1.5 hover:bg-rose-500/20 transition"
                            >
                              <ThumbsDown className="w-3.5 h-3.5" /> Not for me
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="p-4 rounded-2xl bg-slate-950/70 border border-slate-800 text-center text-xs text-slate-300">
                          <Check className="w-5 h-5 text-emerald-400 mx-auto mb-2" />
                          {calibrationVotes} verdict{calibrationVotes === 1 ? '' : 's'} recorded. That is enough to
                          rank today's digest.
                        </div>
                      )}

                      <div className="flex items-center justify-between text-[11px] text-slate-500">
                        <span>
                          {Math.min(calibrationIndex, calibrationCandidates.length)} of {calibrationCandidates.length} reviewed
                        </span>
                        <button
                          type="button"
                          onClick={() => setSetupStep(3)}
                          className="text-amber-400 font-medium hover:text-amber-300 transition"
                        >
                          Continue
                        </button>
                      </div>
                    </div>
                  )}

                  {setupStep === 3 && (
                    <div className="space-y-4">
                      <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 text-xs text-slate-300 space-y-1.5">
                        <div className="flex items-center gap-2 font-medium">
                          <span className="w-2 h-2 rounded-full bg-emerald-400" />
                          Built-in semantic engine: on
                        </div>
                        <p className="text-[11px] text-slate-400 leading-relaxed">
                          {calibrationVotes > 0
                            ? `Ranking from ${calibrationVotes} calibration verdict${calibrationVotes === 1 ? '' : 's'} plus any earlier votes.`
                            : 'Ranking from the votes you cast on digest cards.'}
                          {' '}No key and no third-party calls. Refreshing the digest rotates in pieces you have not seen.
                        </p>
                      </div>

                      <div className="flex flex-col gap-2">
                        <button
                          type="button"
                          onClick={finishSetup}
                          className="w-full px-4 py-2.5 rounded-xl bg-amber-500 text-slate-950 text-xs font-semibold hover:bg-amber-400 transition"
                        >
                          Build my digest
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            finishSetup();
                            setActiveTab('settings');
                          }}
                          className="w-full px-4 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs font-medium text-slate-300 hover:text-slate-100 transition"
                        >
                          Add an embeddings provider (optional)
                        </button>
                        <button
                          type="button"
                          onClick={() => setSetupStep(2)}
                          className="text-[11px] text-slate-500 hover:text-slate-300 transition"
                        >
                          Back to calibration
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* OPML Import Modal */}
            {showImportModal && (
              <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4 safe-modal">
                <div className="w-full max-w-lg rounded-3xl bg-slate-900 border border-slate-800 p-6 space-y-4 max-h-[calc(100dvh-2rem)] overflow-y-auto">
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
            {/* Brand Logo Banner */}
            <CuratorFullLogo className="w-full mx-auto" />

            <div className="border-b border-slate-900 pb-4">
              <h2 className="text-xl font-semibold tracking-tight text-slate-100">Settings</h2>
              <p className="text-xs text-slate-400 mt-0.5">Preferences & delivery configuration</p>
            </div>

            {/* Weekly Reading Activity Summary in Settings */}
            <div className="p-6 rounded-3xl bg-slate-900/40 border border-slate-900 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-amber-400" />
                    <span>Weekly Reading Retrospective</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {totalWeeklyMinutes} minutes read across {weeklyRecent.length} articles over the past 7 days.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowWeeklyReviewModal(true)}
                  className="px-3.5 py-1.5 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/25 transition text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <span>Open Full Review</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>

              <div className="grid grid-cols-3 gap-3 pt-1">
                <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-center">
                  <span className="text-[11px] text-slate-400 block mb-0.5">Time Spent</span>
                  <span className="text-base font-bold font-serif text-slate-100">{totalWeeklyMinutes}m</span>
                </div>
                <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-center">
                  <span className="text-[11px] text-slate-400 block mb-0.5">Completed</span>
                  <span className="text-base font-bold font-serif text-slate-100">{weeklyRecent.length}</span>
                </div>
                <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-center truncate">
                  <span className="text-[11px] text-slate-400 block mb-0.5">Lead Focus</span>
                  <span className="text-[11px] font-bold text-amber-300 block leading-tight whitespace-normal">{topWeeklyTopic}</span>
                </div>
              </div>
            </div>

            {/* Provider-configurable AI services */}
            <div className="p-6 rounded-3xl bg-slate-900/40 border border-slate-900 space-y-5">
              <div>
                <h3 className="text-sm font-semibold text-slate-200">AI Providers</h3>
                <p className="text-xs text-slate-400 mt-0.5">Chat and embeddings are configured independently. A built-in semantic engine always ranks your feeds by similarity to what you vote on; an embeddings provider is optional.</p>
              </div>

              <div className="space-y-3 pt-1">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">Digest curation provider</label>
                  <select
                    value={aiProvider}
                    onChange={e => setAiProvider(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-amber-500 cursor-pointer"
                  >
                    <option value="deterministic">Deterministic (no external AI)</option>
                    <option value="openai-compatible">OpenAI-compatible API</option>
                    <option value="anthropic">Anthropic Messages API</option>
                    <option value="gemini">Google Gemini (optional)</option>
                  </select>
                </div>

                {aiProvider === 'openai-compatible' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">Chat API base URL</label>
                    <input
                      type="url"
                      value={aiBaseUrl}
                      onChange={e => setAiBaseUrl(e.target.value)}
                      placeholder="https://api.openai.com/v1"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-amber-500"
                    />
                    <p className="text-[11px] text-slate-500 mt-1">Use an HTTPS OpenAI-compatible base URL, such as an OpenAI, OpenRouter, or compatible gateway endpoint.</p>
                  </div>
                )}

                {aiProvider !== 'deterministic' && (
                  <>
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1.5">Chat model</label>
                      <input
                        type="text"
                        value={aiModel}
                        onChange={e => setAiModel(e.target.value)}
                        placeholder={aiProvider === 'openai-compatible' ? 'e.g. gpt-4o-mini or provider model ID' : aiProvider === 'anthropic' ? 'e.g. claude-3-5-sonnet-20241022' : 'e.g. gemini-2.5-flash'}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-amber-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1.5">Chat API key</label>
                      <input
                        type="password"
                        value={customApiKey}
                        onChange={e => setCustomApiKey(e.target.value)}
                        placeholder="Your provider API key"
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-amber-500"
                      />
                      <p className="text-[11px] text-slate-500 mt-1">Stored in this browser and sent to the selected provider over HTTPS.</p>
                    </div>
                  </>
                )}

                <div className="pt-3 border-t border-slate-800">
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">Semantic embeddings provider</label>
                  <select
                    value={embeddingProvider}
                    onChange={e => {
                      const nextProvider = e.target.value;
                      setEmbeddingProvider(nextProvider);
                      setEmbeddingModel(current => {
                        if (current === 'text-embedding-3-small' || current === 'gemini-embedding-001') {
                          return nextProvider === 'gemini' ? 'gemini-embedding-001' : 'text-embedding-3-small';
                        }
                        return current;
                      });
                    }}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-amber-500 cursor-pointer"
                  >
                    <option value="openai-compatible">OpenAI-compatible embeddings API</option>
                    <option value="gemini">Google Gemini embeddings (optional)</option>
                    <option value="none">Off — built-in semantic engine only</option>
                  </select>
                </div>

                {embeddingProvider === 'openai-compatible' && (
                  <>
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1.5">Embeddings API base URL</label>
                      <input
                        type="url"
                        value={embeddingBaseUrl}
                        onChange={e => setEmbeddingBaseUrl(e.target.value)}
                        placeholder="https://api.openai.com/v1"
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-amber-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1.5">Embeddings model</label>
                      <input
                        type="text"
                        value={embeddingModel}
                        onChange={e => setEmbeddingModel(e.target.value)}
                        placeholder="text-embedding-3-small"
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-amber-500"
                      />
                    </div>
                  </>
                )}

                {embeddingProvider === 'gemini' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">Gemini embedding model</label>
                    <input
                      type="text"
                      value={embeddingModel}
                      onChange={e => setEmbeddingModel(e.target.value)}
                      placeholder="gemini-embedding-001"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-amber-500"
                    />
                  </div>
                )}

                {embeddingProvider !== 'none' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">Embeddings API key (optional)</label>
                    <input
                      type="password"
                      value={embeddingApiKey}
                      onChange={e => setEmbeddingApiKey(e.target.value)}
                      placeholder="Leave blank to reuse the chat key for the same provider"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-amber-500"
                    />
                    <p className="text-[11px] text-slate-500 mt-1">Keys are stored in this browser and sent only with requests. Provider endpoints must use HTTPS.</p>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  generateDigest({ fresh: true });
                  showToast('Provider settings applied; refreshing your digest');
                }}
                disabled={loadingDigest}
                className="px-4 py-2 text-xs font-medium rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/25 transition disabled:opacity-50"
              >
                Apply providers & refresh digest
              </button>
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
                  type="button"
                  onClick={handleSendTestNotification}
                  className="px-4 py-2 text-xs font-medium rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-slate-100 transition"
                >
                  Send me a test notification
                </button>
              </div>
            </div>

            {/* Browser-local semantic reading profile */}
            <div className="p-6 rounded-3xl bg-slate-900/40 border border-slate-900 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-200">Semantic Reading Profile</h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {semanticFeedback.length} of 40 feedback examples · {semanticFeedback.filter(item => item.vote === 'like').length} liked · {semanticFeedback.filter(item => item.vote === 'dislike').length} disliked
                  </p>
                </div>
                {(semanticFeedback.length > 0 || signals.moreIds.length > 0 || signals.lessIds.length > 0) && (
                  <button
                    type="button"
                    onClick={() => {
                      setSemanticFeedback([]);
                      setSignals({ moreTopics: [], lessTopics: [], moreIds: [], lessIds: [], more: [], less: [] });
                      showToast('Semantic reading profile reset');
                    }}
                    className="text-xs text-slate-400 hover:text-rose-400 transition shrink-0"
                  >
                    Reset profile
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={openSetupWizard}
                className="w-full px-3 py-2 rounded-xl bg-slate-950/70 border border-slate-800 text-xs font-medium text-amber-300 hover:border-amber-500/40 hover:text-amber-200 transition flex items-center justify-center gap-1.5"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{semanticFeedback.length > 0 ? 'Re-run calibration' : 'Run calibration'}</span>
              </button>

              <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 text-xs text-slate-300">
                <div className="flex items-center gap-2 font-medium">
                  <span className={`w-2 h-2 rounded-full ${embeddingProvider === 'none' || semanticServiceReady ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                  {embeddingProvider === 'none'
                    ? 'Built-in semantic engine active · no provider calls'
                    : semanticServiceReady
                      ? `Built-in engine + ${embeddingProvider === 'gemini' ? 'Gemini' : 'your OpenAI-compatible endpoint'} embeddings`
                      : 'Built-in semantic engine active · add an endpoint and key for provider vectors'}
                </div>
                {semanticSummary && (
                  <p className="text-[11px] text-slate-500 mt-2">
                    Last digest · {semanticSummary.feedbackExamples} vote examples ·{' '}
                    {semanticSummary.providerVectors > 0
                      ? `${semanticSummary.providerVectors} provider embeddings`
                      : 'built-in engine only'} ·{' '}
                    {semanticSummary.deprioritized} recently seen pieces down-weighted
                  </p>
                )}
                <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
                  Your votes and up to 40 article excerpts stay in this browser. The built-in semantic engine scores feed text on this app's server with no third-party calls and no key. Provider embeddings are optional: when enabled, feedback and candidate excerpts are also sent to the provider you choose. Nothing is synced or saved to a database, and provider vectors are cached in server memory only.
                </p>
              </div>
            </div>

            {/* Mobile Access QR Code Card */}
            <div className="p-6 rounded-3xl bg-slate-900/40 border border-slate-900 space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-200">Open on Your Phone</h3>
                <p className="text-xs text-slate-400 mt-0.5">Scan this QR code with your iPhone camera to open Curator instantly.</p>
              </div>
              <div className="flex flex-col sm:flex-row items-center gap-6 pt-2">
                <QRCodeBox url={typeof window !== 'undefined' ? window.location.origin : 'https://ais-dev-szra6uvq22i3o7dvcof5go-706549575453.europe-west2.run.app'} />
                <div className="space-y-2 text-xs text-slate-300">
                  <p className="font-medium text-slate-200">Quick Setup Instructions:</p>
                  <ol className="list-decimal list-inside space-y-1 text-slate-400">
                    <li>Open your iPhone Camera app and point it at the QR code.</li>
                    <li>Tap the notification banner to open Curator in Safari.</li>
                    <li>Tap the <strong>Share</strong> button and select <strong>Add to Home Screen</strong>.</li>
                  </ol>
                </div>
              </div>
            </div>

            {/* Subscription Export */}
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
            </div>
          </div>
        )}

        {/* TAB 5: FEEDS (Traditional Reading Stream) */}
        {activeTab === 'feeds' && (
          <div className="space-y-6 animate-fade-in w-full max-w-full">
            {/* Top Circular Source Stories Carousel */}
            <div className="overflow-x-auto no-scrollbar py-2 -mx-4 px-4 sm:-mx-6 sm:px-6">
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

                {sources.map((src) => {
                  const isSelected = selectedFeedSource === src.title;
                  const isUnread = !readSourceIds.includes(src.id);
                  const avatarUrl = getSourceAvatar(src.feedUrl);
                  return (
                    <button
                      key={src.id}
                      type="button"
                      onClick={() => handleOpenFeedStream(src.title, src.id)}
                      className="flex flex-col items-center gap-2 group cursor-pointer focus:outline-none"
                      title={isUnread ? `${src.title} (Unread)` : `${src.title} (Read)`}
                    >
                      <div className={`relative w-16 h-16 rounded-full p-0.5 transition-transform group-hover:scale-105 ${
                        isSelected
                          ? 'bg-amber-400 ring-2 ring-amber-400/50'
                          : isUnread
                          ? 'bg-gradient-to-tr from-amber-500 to-rose-500 shadow-md'
                          : 'bg-slate-800'
                      }`}>
                        <div className="w-full h-full rounded-full bg-slate-900 flex items-center justify-center overflow-hidden border-2 border-slate-950 relative">
                          {avatarUrl ? (
                            <img 
                              src={avatarUrl} 
                              alt={src.title} 
                              className="w-full h-full object-cover rounded-full"
                              onError={(e) => {
                                (e.currentTarget as HTMLElement).style.display = 'none';
                                const fallback = e.currentTarget.parentElement?.querySelector('.feed-circle-initials');
                                if (fallback) fallback.classList.remove('hidden');
                              }}
                            />
                          ) : null}
                          <span className={`feed-circle-initials text-xs font-bold ${avatarUrl ? 'hidden' : ''} ${isUnread ? 'text-slate-100' : 'text-slate-400'}`}>
                            {src.title.slice(0, 2).toUpperCase()}
                          </span>
                        </div>
                        {isUnread && !isSelected && (
                          <div 
                            className="absolute top-0 right-0 w-3.5 h-3.5 rounded-full bg-orange-500 border-2 border-slate-950 shadow-sm z-10"
                            title="Unread entries"
                          />
                        )}
                      </div>
                      <span className={`text-[11px] font-medium max-w-[76px] truncate text-center group-hover:text-amber-300 transition-colors ${
                        isSelected ? 'text-amber-300 font-semibold' : isUnread ? 'text-slate-200 font-semibold' : 'text-slate-400'
                      }`}>
                        {getShortSourceTitle(src.title)}
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

              <div className="flex items-center gap-2">
                {sources.some(s => !readSourceIds.includes(s.id)) ? (
                  <button
                    type="button"
                    onClick={markAllSourcesAsRead}
                    className="px-3 py-1.5 text-xs font-medium rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-amber-300 hover:border-amber-500/30 transition flex items-center gap-1.5"
                    title="Dismiss all unread orange dots"
                  >
                    <CheckCheck className="w-3.5 h-3.5 text-amber-400" />
                    <span>Mark all read</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={markAllSourcesAsUnread}
                    className="px-3 py-1.5 text-xs font-medium rounded-xl bg-slate-900/60 border border-slate-800 text-slate-400 hover:text-slate-200 transition text-[11px]"
                    title="Reset unread dots"
                  >
                    Reset unread dots
                  </button>
                )}

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
                {feedStreamArticles.map((item) => {
                  const actions = getCardActions(item.id);
                  return (
                    <article
                      key={item.id}
                      onClick={() => openArticle(item)}
                      className={`group rounded-3xl transition-all duration-300 cursor-pointer overflow-hidden relative ${
                        actions.hasAnyAction
                          ? 'bg-slate-900/95 border-2 border-emerald-500/60 shadow-[0_22px_50px_-8px_rgba(0,0,0,0.95),0_0_0_1px_rgba(16,185,129,0.35)] hover:border-emerald-400 hover:shadow-[0_28px_60px_-8px_rgba(0,0,0,0.98),0_0_0_1.5px_rgba(16,185,129,0.5)]'
                          : 'bg-slate-900/95 border-2 border-slate-700/80 shadow-[0_22px_50px_-8px_rgba(0,0,0,0.95),0_0_0_1px_rgba(255,255,255,0.12)] hover:border-amber-500/60 hover:shadow-[0_28px_60px_-8px_rgba(0,0,0,0.98),0_0_0_1.5px_rgba(245,158,11,0.35)]'
                      }`}
                    >
                      <div className="p-5 pb-3 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {(() => {
                            const itemAvatar = getSourceAvatar(item.url);
                            return (
                              <div className="w-9 h-9 rounded-full bg-slate-900 border border-slate-700 flex items-center justify-center overflow-hidden shrink-0 relative">
                                {itemAvatar ? (
                                  <img 
                                    src={itemAvatar} 
                                    alt={item.source}
                                    className="w-full h-full object-cover rounded-full"
                                    onError={(e) => {
                                      (e.currentTarget as HTMLElement).style.display = 'none';
                                      const fallback = e.currentTarget.parentElement?.querySelector('.stream-card-initials');
                                      if (fallback) fallback.classList.remove('hidden');
                                    }}
                                  />
                                ) : null}
                                <span className={`stream-card-initials text-xs font-bold text-amber-400 ${itemAvatar ? 'hidden' : ''}`}>
                                  {item.source.slice(0, 2).toUpperCase()}
                                </span>
                              </div>
                            );
                          })()}
                          <div>
                            <div className="text-xs font-bold text-slate-100 flex items-center gap-1.5">
                              <span>{item.source}</span>
                            </div>
                            <div className="text-[11px] text-slate-400">
                              {item.publishedAt ? `${item.publishedAt} · ` : ''}{item.folder} · {item.readTime}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {actions.isReadThrough ? (
                            <div 
                              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-950/90 border border-emerald-500/60 text-[10px] font-bold text-emerald-300 shadow-sm"
                              title="Read through completed"
                            >
                              <Check className="w-3 h-3 text-emerald-400 stroke-[3]" />
                              <span>Read through</span>
                            </div>
                          ) : actions.isVotedMore ? (
                            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-950/90 border border-amber-500/50 text-[10px] font-bold text-amber-300">
                              <ThumbsUp className="w-3 h-3 text-amber-400" />
                              <span>More like this</span>
                            </div>
                          ) : actions.isVotedLess ? (
                            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-950/90 border border-rose-500/50 text-[10px] font-bold text-rose-300">
                              <ThumbsDown className="w-3 h-3 text-rose-400" />
                              <span>Less like this</span>
                            </div>
                          ) : actions.isClicked ? (
                            <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-sky-950/90 border border-sky-500/40 text-[10px] font-medium text-sky-300">
                              <span>Opened</span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-slate-800/80 border border-slate-700/60 text-[10px] font-medium text-slate-400">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                              <span>New</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {item.bannerImage && (
                        <div className="relative mx-3.5 rounded-2xl overflow-hidden h-56 md:h-64 shadow-lg border border-slate-700/60">
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
                              className={`p-2.5 min-w-11 min-h-11 flex items-center justify-center rounded-xl backdrop-blur-md border transition shadow-lg ${
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

                        <div className="pt-2 flex items-center justify-between border-t border-slate-800/80">
                          {/* Read More Link directly to original source */}
                          <a
                            href={item.url || '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => {
                              e.stopPropagation();
                              setReadArticleIds(prev => (prev.includes(item.id) ? prev : [...prev, item.id]));
                              showToast(`Opening source on ${item.source}`);
                            }}
                            className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-amber-300 transition-colors"
                            title={`Read more on ${item.source} (opens external browser or app)`}
                          >
                            <span>Read original on {item.source}</span>
                            <ExternalLink className="w-3 h-3 text-slate-500" />
                          </a>

                          {/* Curation actions: More, Less (icon-only, reading preferences) */}
                          <div className="flex items-center gap-1.5">
                            <button 
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleMore(item); }}
                              className={`p-2 min-w-10 min-h-10 flex items-center justify-center rounded-xl border transition ${
                                actions.isVotedMore
                                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-300 shadow-sm'
                                  : 'bg-slate-950/80 border-slate-700/80 text-slate-400 hover:text-amber-300 hover:border-amber-500/40'
                              }`}
                              title={actions.isVotedMore ? `More on ${item.folder || 'this topic'} (voted)` : `More on ${item.folder || 'this topic'}`}
                              aria-label={`More on ${item.folder || 'this topic'}`}
                            >
                              <ThumbsUp className={`w-3.5 h-3.5 ${
                                actions.isVotedMore ? 'fill-amber-400/30' : ''
                              }`} />
                            </button>
                            <button 
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleLess(item); }}
                              className={`p-2 min-w-10 min-h-10 flex items-center justify-center rounded-xl border transition ${
                                actions.isVotedLess
                                  ? 'bg-rose-500/20 border-rose-500/50 text-rose-300 shadow-sm'
                                  : 'bg-slate-950/80 border-slate-700/80 text-slate-400 hover:text-rose-300 hover:border-rose-500/40'
                              }`}
                              title={actions.isVotedLess ? `Fewer on ${item.folder || 'this topic'} (voted)` : `Fewer on ${item.folder || 'this topic'}`}
                              aria-label={`Fewer on ${item.folder || 'this topic'}`}
                            >
                              <ThumbsDown className={`w-3.5 h-3.5 ${
                                actions.isVotedLess ? 'fill-rose-400/30' : ''
                              }`} />
                            </button>
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </main>


      {/* Bottom Dock Navigation */}
      <nav className="fixed safe-dock left-1/2 -translate-x-1/2 z-40 w-[calc(100%-2rem)] max-w-lg bg-slate-900/90 backdrop-blur-xl border border-slate-800/80 rounded-2xl py-2.5 px-3 shadow-2xl">
        <div className="flex items-center justify-around">
          <button 
            type="button"
            onClick={() => setActiveTab('today')}
            className={`flex flex-col items-center justify-center gap-1 min-h-11 min-w-11 relative transition ${activeTab === 'today' ? 'text-amber-400 font-semibold' : 'text-slate-400 hover:text-slate-200'}`}
          >
            <Home className="w-5 h-5" />
            <span className="text-[10px] tracking-tight">Today</span>
          </button>

          <button 
            type="button"
            onClick={() => setActiveTab('feeds')}
            className={`flex flex-col items-center justify-center gap-1 min-h-11 min-w-11 relative transition ${activeTab === 'feeds' ? 'text-amber-400 font-semibold' : 'text-slate-400 hover:text-slate-200'}`}
          >
            <div className="relative">
              <Rss className="w-5 h-5" />
              {sources.some(s => !readSourceIds.includes(s.id)) && (
                <div className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-orange-500 border border-slate-950" />
              )}
            </div>
            <span className="text-[10px] tracking-tight">Feeds</span>
          </button>

          <button 
            type="button"
            onClick={() => setActiveTab('saved')}
            className={`flex flex-col items-center justify-center gap-1 min-h-11 min-w-11 relative transition ${activeTab === 'saved' ? 'text-amber-400 font-semibold' : 'text-slate-400 hover:text-slate-200'}`}
          >
            <div className="relative">
              <Bookmark className="w-5 h-5" />
              {savedIds.length > 0 && (
                <div className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-orange-500 border border-slate-950" />
              )}
            </div>
            <span className="text-[10px] tracking-tight">Saved</span>
          </button>

          <button 
            type="button"
            onClick={() => setActiveTab('sources')}
            className={`flex flex-col items-center justify-center gap-1 min-h-11 min-w-11 relative transition ${activeTab === 'sources' ? 'text-amber-400 font-semibold' : 'text-slate-400 hover:text-slate-200'}`}
          >
            <Compass className="w-5 h-5" />
            <span className="text-[10px] tracking-tight">Sources</span>
          </button>
        </div>
      </nav>

      {/* Weekly Reading Review Modal */}
      <WeeklyReviewModal
        isOpen={showWeeklyReviewModal}
        onClose={() => setShowWeeklyReviewModal(false)}
        readingItems={weeklyHistory}
        onOpenArticle={(id) => {
          const item = digest.find(d => d.id === id) || savedArticles.find(s => s.id === id) || feedStreamArticles.find(f => f.id === id);
          if (item) setSelectedArticle(item);
        }}
        onOpenSettings={() => {
          setActiveTab('settings');
        }}
        showToast={showToast}
      />

    </div>
  );
}
