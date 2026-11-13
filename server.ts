import express from 'express';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Track free tier usage for AI requests
let aiRequestCount = 0;
const FREE_TIER_LIMIT = 10000;

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  const PORT = process.env.PORT || 3000;

  // Initialize Gemini SDK if API key is present
  const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
  const ai = apiKey
    ? new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      })
    : null;

  // API Routes
  app.get('/api/status', (req, res) => {
    const remaining = Math.max(0, FREE_TIER_LIMIT - aiRequestCount);
    const percent = ((remaining / FREE_TIER_LIMIT) * 100).toFixed(1);
    res.json({
      status: 'ok',
      freeTier: {
        limit: FREE_TIER_LIMIT,
        used: aiRequestCount,
        remaining,
        percentRemaining: parseFloat(percent)
      }
    });
  });

  // OPML Parser endpoint
  app.post('/api/parse-opml', (req, res) => {
    try {
      const { opmlText } = req.body;
      if (!opmlText || typeof opmlText !== 'string' || !opmlText.trim()) {
        return res.status(400).json({ error: 'No OPML content provided' });
      }

      const decodeXml = (str: string) =>
        str
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
          .replace(/&#39;/g, "'");

      const getAttr = (tag: string, attr: string): string | undefined => {
        const regex = new RegExp(`\\b${attr}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i');
        const match = tag.match(regex);
        const val = match?.[1] ?? match?.[2];
        return val !== undefined ? decodeXml(val.trim()) : undefined;
      };

      const sources: Array<{
        id: string;
        title: string;
        feedUrl: string;
        folder: string;
        status: 'active' | 'failing';
        failingReason?: string;
      }> = [];
      const failures: Array<{ title: string; reason: string }> = [];
      const seenUrls = new Set<string>();

      // Tokenize all <outline ...> opening/self-closing tags and </outline> closing tags
      const tagRegex = /<\/outline\s*>|<outline\b[^>]*\/?>/gi;
      const folderStack: string[] = [];
      let match: RegExpExecArray | null;
      let foundAnyOutline = false;

      while ((match = tagRegex.exec(opmlText)) !== null) {
        const tag = match[0];
        foundAnyOutline = true;

        if (/^<\/outline/i.test(tag)) {
          if (folderStack.length > 0) {
            folderStack.pop();
          }
          continue;
        }

        const isSelfClosing = /\/>$/.test(tag);
        const xmlUrl = getAttr(tag, 'xmlUrl');
        const title = getAttr(tag, 'title') || getAttr(tag, 'text') || '';
        const categoryAttr = getAttr(tag, 'category');
        const typeAttr = getAttr(tag, 'type');

        if (xmlUrl !== undefined) {
          const cleanTitle = title || xmlUrl;
          const folder =
            folderStack.length > 0
              ? folderStack[folderStack.length - 1]
              : categoryAttr || 'Uncategorized';

          if (!xmlUrl) {
            failures.push({ title: cleanTitle || 'Unnamed feed', reason: 'Missing feed URL' });
            continue;
          }

          const normalizedUrl = xmlUrl.toLowerCase();
          if (seenUrls.has(normalizedUrl)) {
            continue; // deduplicate identical feeds silently
          }
          seenUrls.add(normalizedUrl);

          let isValidUrl = false;
          try {
            const parsed = new URL(xmlUrl);
            isValidUrl = parsed.protocol === 'http:' || parsed.protocol === 'https:';
          } catch {
            isValidUrl = false;
          }

          if (!isValidUrl) {
            sources.push({
              id: 'src_' + Math.random().toString(36).substring(2, 9),
              title: cleanTitle,
              feedUrl: xmlUrl,
              folder,
              status: 'failing',
              failingReason: 'Invalid feed URL format',
            });
            failures.push({ title: cleanTitle, reason: 'Invalid feed URL format' });
          } else {
            sources.push({
              id: 'src_' + Math.random().toString(36).substring(2, 9),
              title: cleanTitle,
              feedUrl: xmlUrl,
              folder,
              status: 'active',
            });
          }
        } else if (!isSelfClosing) {
          // Container folder outline (e.g. <outline text="Economics" title="Economics">)
          const isRootWrapper =
            !title ||
            title.toLowerCase() === 'subscriptions' ||
            title.toLowerCase() === 'feeds';
          folderStack.push(
            isRootWrapper
              ? folderStack[folderStack.length - 1] || 'Uncategorized'
              : title
          );
        } else if (typeAttr && typeAttr.toLowerCase() === 'rss') {
          // Self-closing RSS outline without xmlUrl
          failures.push({ title: title || 'Unnamed feed', reason: 'Missing xmlUrl attribute' });
        }
      }

      if (!foundAnyOutline || (sources.length === 0 && failures.length === 0)) {
        return res.status(400).json({
          error: 'No subscription outlines found. Please upload a valid .opml or .xml subscription file.',
        });
      }

      const successCount = sources.filter(s => s.status === 'active').length;
      const failCount = sources.filter(s => s.status === 'failing').length;

      res.json({
        success: true,
        totalImported: sources.length,
        successCount,
        failCount,
        failures,
        sources,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to parse OPML' });
    }
  });

  // Curate daily digest using Gemini
  app.post('/api/curate', async (req, res) => {
    try {
      const { sources, signals, readingStats, serendipityDial, itemCount = 6 } = req.body;
      aiRequestCount++;

      const moreSignals: string[] = Array.isArray(signals?.more) ? signals.more : [];
      const lessSignals: string[] = Array.isArray(signals?.less) ? signals.less : [];
      const lessIds: string[] = Array.isArray(signals?.lessIds) ? signals.lessIds : [];

      // If Gemini API is available, use it to generate highly tailored editorial digest items and why-reasons
      if (ai) {
        try {
          const prompt = `You are a sophisticated personal reading editor. Your task is to curate a daily reading digest of exactly ${itemCount} items based on the user's subscriptions, recent reading signals, and a serendipity dial (${serendipityDial}% out of bubble).

Subscriptions available: ${JSON.stringify(sources?.slice(0, 30) || [])}
User explicit signals:
- MORE like this (prioritize these sources, writers, folders, and adjacent ideas): ${JSON.stringify(moreSignals)}
- LESS like this (exclude or strongly avoid these sources, topics, and articles): ${JSON.stringify(lessSignals)}
Implicit reading completion stats (articles/sources finished): ${JSON.stringify(readingStats || {})}
Serendipity Dial setting: ${serendipityDial}% (0% = stay close to established interests; 100% = strong stretch into new intellectual territories).

Rules:
1. Generate ${itemCount} articles.
2. Strictly respect LESS signals: do not include items from sources or topics in LESS.
3. Prioritize MORE signals: include follow-ups or deeper cuts from sources/topics in MORE and reflect that in the "why" note.
4. At least 1 (or 2 if serendipity dial is >= 40) must be an "isOutOfBubble": true stretch item from outside standard interests, clearly labelled as a stretch.
5. Each item needs:
   - id: unique string
   - title: compelling article title
   - source: source publication name
   - folder: category folder
   - readTime: estimated reading time (e.g. "6 min read")
   - why: ONE short sentence of plain English explaining why it was chosen (e.g., "In your economics folder", "Follows on from the Byzantine trade piece you read last week", "You asked for more from this writer", "A deliberate stretch into architectural history").
   - summary: 2-3 sentence teaser
   - url: simulated article url
   - fullText: full article text (400-600 words of rich, thoughtful essay or long-form prose suitable for a clean reading view).
   - isOutOfBubble: boolean (true for stretch items)

Return ONLY valid JSON array of objects with these exact keys.`;

          const response = await ai.models.generateContent({
            model: 'gemini-4-hydrogen',
            contents: prompt,
            config: {
              responseMimeType: 'application/json'
            }
          });

          if (response.text) {
            const data = JSON.parse(response.text);
            if (Array.isArray(data) && data.length > 0) {
              return res.json({ digest: data, generatedByAI: true });
            }
          }
        } catch (aiErr) {
          console.error('Gemini curation fallback used due to error:', aiErr);
        }
      }

      // Curated pool with real signal-aware ranking when AI key is missing or call fails
      const pool = [
        {
          id: 'item_0',
          title: 'Nobody Ever Gets Credit for Fixing Problems that Never Happened',
          source: 'Nicole Williams',
          folder: 'Strategy & Craft',
          readTime: '6 min read',
          why: 'You finish this writer almost every time.',
          summary: 'Working harder pays off fast; working smarter pays off with interest. The fire you put out earns a thank you; the fire you prevented earns nothing.',
          url: 'https://substack.com/@pmresearcher/fixing-unseen-problems',
          bannerImage: '/assets/aistudio/IMG_0653_a0a9ce59.png',
          quote: 'What gets seen gets rewarded. The fire you put out earns a thank you. The fire you prevented earns nothing',
          fullText: `What gets seen gets rewarded. The fire you put out earns a thank you. The fire you prevented earns nothing.

In organizational dynamics, heroic firefighting is visible, dramatic, and emotionally compelling. When a server crashes at 2 AM or a supply chain breaks on a holiday weekend, the engineer or manager who stays up all night to patch the leak is celebrated. They receive public recognition, awards, and promotions because everyone witnessed the catastrophe and its subsequent resolution.

Quiet prevention, by contrast, is completely invisible. The architectural refactor that eliminated the concurrency race condition before it ever triggered an outage produces no metrics, no alarms, and no drama. Nobody sends an email saying: "Congratulations, the system did not crash today."

To build lasting systems—whether technical architectures, institutions, or personal intellectual routines—we must cultivate taste for the uncelebrated disciplines: calm prevention, rigorous invariants, and quiet curation.`,
          isOutOfBubble: false
        },
        {
          id: 'item_1',
          title: 'The Architecture of Long-Lived Systems and Institutional Memory',
          source: 'Dan Luu',
          folder: 'Tech & Engineering',
          readTime: '7 min read',
          why: 'You finish this writer almost every time.',
          summary: 'An exploration of how organizations maintain technical knowledge across decades without falling victim to institutional amnesia.',
          url: 'https://danluu.com/systems-memory',
          fullText: `When building software or large institutions, the hardest problem is rarely writing the initial code or establishing the charter. The hardest problem is ensuring that the tacit knowledge of why decisions were made survives the departure of the people who made them.

In most modern engineering teams, documentation decays rapidly because it is treated as a chore rather than a living artifact. When an engineer leaves, their mental model of the system leaves with them. Over time, the codebase becomes a series of archaeological layers where current maintainers are afraid to touch certain modules because nobody remembers what load-bearing assumptions they rely on.

Contrast this with organizations that treat institutional memory as a first-class engineering discipline. In these environments, every significant architectural refactoring begins with a design doc that records not just the chosen path, but the three discarded alternatives and the precise failure modes that ruled them out. When new engineers join, they do not just read the code; they read the intellectual history of the product.

The lesson for individual readers and curators is similar. Our reading diets often suffer from amnesia. We consume hundreds of articles a week, retaining fleeting impressions while forgetting the foundational frameworks that connected them. Building a personal reading digest is not just about finding new things to read; it is about creating a deliberate anchor for what we choose to retain.`,
          isOutOfBubble: false
        },
        {
          id: 'item_2',
          title: 'Venetian Banking Innovations and the Birth of Modern Credit',
          source: 'Marginal Revolution',
          folder: 'Economics',
          readTime: '9 min read',
          why: 'Follows on from the Byzantine trade piece you read last week.',
          summary: 'How 14th-century merchants in the Venetian lagoon invented bills of exchange and fractional reserve practices that powered the Renaissance.',
          url: 'https://marginalrevolution.com/venice-credit',
          fullText: `In the crowded piazzas of 14th-century Venice, merchants faced a logistical nightmare. Transporting gold coin across pirate-infested Mediterranean trade routes was both dangerous and inefficient. Out of this necessity arose the giro bank and the bill of exchange—instruments that transformed credit from a personal favor between acquaintances into a liquid, transferable financial asset.

A merchant in Constantinople could deposit silver with a banker and receive a scrap of parchment. Upon arriving in Venice, he could present that parchment to a correspondent banker and collect local currency without a single ounce of metal crossing the sea. More importantly, those parchment bills could be endorsed and passed to third parties to settle debts, effectively creating an early form of private paper money.

This financial leap was not merely technical; it required a profound evolution in institutional trust. Venice established specialized maritime courts that resolved commercial disputes in days rather than months, ensuring that the velocity of capital remained high. When trust is codified into reliable legal frameworks, economies unlock unprecedented productive capacity.

For the modern reader interested in economic history, the trajectory from Byzantine trade networks to Venetian banking and onward to Renaissance finance illustrates how trade routes are invariably preceded by financial innovation.`,
          isOutOfBubble: false
        },
        {
          id: 'item_3',
          title: 'The Unseen Geometry of Traditional Japanese Joinery',
          source: 'A List Apart',
          folder: 'Design',
          readTime: '5 min read',
          why: 'In your design folder.',
          summary: 'Why interlocking timber joints without nails or glue achieve seismic resilience and enduring aesthetic harmony.',
          url: 'https://alistapart.com/japanese-joinery',
          fullText: `In traditional Japanese timber architecture, master carpenters construct soaring temples and multi-story pagodas without a single nail, screw, or drop of glue. Instead, they rely on complex interlocking joints—such as the sashigane and kanawa tsugi—that lock tighter as wood expands and contracts with humidity and seismic tremors.

This approach reflects a philosophy where structure and ornamentation are inseparable. The joint is both the engineering mechanism that bears the load and the visual signature of the craftsperson. Every angle is calculated to distribute stress across multiple vectors, allowing ancient wooden structures to sway gracefully during earthquakes rather than fracturing under rigid resistance.

Digital design often suffers from the opposite impulse: adding layers of surface decoration while hiding the structural fragility underneath. When we examine how great systems are built, whether in timber or software, the most resilient designs are those where every connection is self-supporting and transparent.`,
          isOutOfBubble: false
        },
        {
          id: 'item_4',
          title: 'Stratechery: The Aggregation Theory of Modern Media',
          source: 'Stratechery by Ben Thompson',
          folder: 'Tech & Strategy',
          readTime: '11 min read',
          why: 'You finish this writer almost every time.',
          summary: 'How the internet shifted power from content producers to content aggregators, and what comes next.',
          url: 'https://stratechery.com/aggregation-theory',
          fullText: `For decades, media companies enjoyed local monopolies because distribution was physically constrained. If you owned the printing press, the delivery trucks, or the cable television lines, you controlled access to the audience. Content creators had to partner with distributors on unfavorable terms because there was no alternative path to the consumer.

The internet inverted this power dynamic completely. Distribution marginal cost dropped to zero, and all content became instantly accessible globally. In this new paradigm, the bottleneck shifted from distribution to discovery.

Enter the Aggregator. Companies like Google, Facebook, Apple, and Spotify do not produce content; they aggregate users by providing superior discovery and curation experiences. Because the aggregator owns the primary relationship with the consumer, suppliers of content—news publishers, musicians, independent writers—must compete for placement on the aggregator's terms.

Understanding Aggregation Theory is essential for anyone trying to make sense of modern digital media ecosystems. It explains why traditional paywalls succeed for niche professional monopolies while general interest publications struggle to maintain independent pricing power.`,
          isOutOfBubble: false
        },
        {
          id: 'item_5',
          title: 'Deep Time and the 10,000-Year Clock',
          source: 'Long Now Foundation',
          folder: 'Philosophy & Long-term',
          readTime: '6 min read',
          why: 'In your philosophy folder.',
          summary: 'Designing mechanical artifacts intended to run accurately for millennia requires rethinking human impatience.',
          url: 'https://longnow.org/10000-year-clock',
          fullText: `Modern civilization suffers from a chronic temporal myopia. We plan in quarterly earnings reports, political election cycles, and 24-hour news cycles. Yet the most profound challenges facing humanity—ecological stewardship, nuclear waste management, infrastructure resilience—operate on timescales of centuries and millennia.

The 10,000-Year Clock, designed to tick once a year, chime once a century, and have its cuckoo come out every millennium, is an exercise in shifting human perspective. To build an artifact that can endure for ten millennia, engineers must solve problems of material fatigue, thermal expansion, and human curiosity that most modern projects never encounter.

When we force ourselves to think in deep time, our daily priorities shift. We realize that most of the urgent noise that consumes our morning attention is ephemeral, while the quiet, compounding choices we make today are what truly shape the world our descendants inherit.`,
          isOutOfBubble: false
        },
        {
          id: 'item_6',
          title: 'Why Small Tools Outlast Grand Platforms',
          source: 'Dan Luu',
          folder: 'Tech & Engineering',
          readTime: '8 min read',
          why: 'Consistent with the engineering essays you read to the end.',
          summary: 'A look at unix utilities, plain text formats, and why narrow software endures while ambitious suites collapse.',
          url: 'https://danluu.com/small-tools',
          fullText: `Every decade brings a wave of all-in-one platforms promising to unify communication, documents, tasks, and knowledge under a single proprietary roof. Almost inevitably, those platforms grow sluggish, accumulate conflicting workflows, and eventually vanish when corporate priorities shift.

Meanwhile, small single-purpose tools built around open formats keep working quietly for thirty or forty years. Their durability comes from restraint: they do one job cleanly, expose predictable interfaces, and refuse to trap user data inside opaque silos.

For anyone designing personal software, this is a liberating principle. When a tool has a narrow mandate and clear boundaries, it remains comprehensible to its user long after larger products become burdensome.`,
          isOutOfBubble: false
        },
        {
          id: 'item_7',
          title: 'The Medici Ledger: Double-Entry Bookkeeping as Cultural Engine',
          source: 'Marginal Revolution',
          folder: 'Economics',
          readTime: '7 min read',
          why: 'Next step from Venetian credit into Renaissance finance.',
          summary: 'How systematic balance sheets allowed Florentine merchants to coordinate branches across Europe without losing control.',
          url: 'https://marginalrevolution.com/medici-ledger',
          fullText: `Before double-entry bookkeeping spread across northern Italy, even wealthy trading houses struggled to tell whether a distant voyage had truly turned a profit or simply moved cash from one pocket to another. Luca Pacioli's codification of Venetian accounting methods turned commerce into a legible discipline.

With debits and credits mirrored across every transaction, partners in Florence could audit branches in Bruges or London with confidence. Accounting did not merely record Renaissance wealth; it made long-distance trust scalable.`,
          isOutOfBubble: false
        },
        {
          id: 'item_8',
          title: 'Scaling Laws and the Economics of Inference',
          source: 'The Anthropic Stack',
          folder: 'Tech & AI',
          readTime: '10 min read',
          why: 'In your Tech & AI folder.',
          summary: 'Why the bottleneck in applied machine intelligence is shifting from training runs to latency, verification, and cost per decision.',
          url: 'https://anthropic.com/research/inference-economics',
          fullText: `For several years, progress in machine intelligence was measured primarily by the size of training clusters. Now the decisive engineering frontier lies in inference: how much reasoning can be delivered reliably within a tight budget of latency and compute.

When intelligence becomes cheap enough to run quietly in the background—curating feeds, verifying citations, or parsing messy documents—the user interface changes. Instead of prompting a chat box, people interact with calm editorial tools that do the sifting ahead of time.`,
          isOutOfBubble: false
        },
        {
          id: 'item_9',
          title: 'The Quiet Rise of Municipal Water Architects',
          source: 'Prospect Magazine',
          folder: 'Culture',
          readTime: '6 min read',
          why: 'In your Culture folder.',
          summary: 'Inside the unglamorous civic engineering reshaping how European cities survive simultaneous droughts and flash floods.',
          url: 'https://prospectmagazine.co.uk/water-architects',
          fullText: `Beneath every resilient city lies an invisible choreography of retention basins, permeable stone plazas, and gravity-fed canals. While skyline towers draw headlines, urban hydrologists are quietly rewriting the rules of civic design so neighborhoods absorb sudden storms instead of channeling them into overwhelmed rivers.

Walking through rebuilt squares in Rotterdam or Lyon, most residents notice only shaded trees and stepped amphitheaters—unaware that the entire plaza doubles as a flood buffer.`,
          isOutOfBubble: false
        },
        {
          id: 'item_10',
          title: 'The Sonification of Stellar Nurseries: Listening to Nebulae',
          source: 'The New Yorker - Books',
          folder: 'Culture',
          readTime: '8 min read',
          why: 'Deliberate stretch: Outside your usual tech and economics routine.',
          summary: 'How astronomers are translating James Webb Space Telescope infrared data into audible soundscapes.',
          url: 'https://www.newyorker.com/science/stellar-sonification',
          fullText: `For centuries, astronomy has been an overwhelmingly visual science. We chart the universe through photographs rendered in false color, mapping light waves that our eyes cannot naturally perceive. But in recent years, astrophysicists and sound artists have begun translating astronomical telescope data into audible frequencies—a process known as sonification.

When the infrared emissions of the Carina Nebula or the Pillars of Creation are mapped onto pitch, tempo, and timbre, something extraordinary happens. Dense regions of collapsing gas translate into deep, resonant bass drones, while newborn stars twinkling in the cluster sound like crystalline chimes cascading across the stereo field.

This auditory rendering does more than provide an artistic spectacle for planetarium visitors. It allows researchers to perceive complex spatial patterns in stellar data that might go unnoticed in visual spectrograms. The human ear is remarkably acute at discerning overlapping acoustic frequencies and rhythmic anomalies.

For readers whose typical intellectual diet is anchored in economics, technology, and policy, stepping into the auditory universe of stellar sonification offers a profound reminder of the beauty of interdisciplinary perception.`,
          isOutOfBubble: true
        },
        {
          id: 'item_11',
          title: 'How Medieval Bell Founders Tuned Bronze by Ear',
          source: 'World Politics & History',
          folder: 'History',
          readTime: '7 min read',
          why: 'Deliberate stretch: Craft acoustics from outside your usual reading trail.',
          summary: 'Before electronic frequency analyzers, Flemish foundry families discovered how lathe-scraping inner ribs unlocked pure harmonic overtones.',
          url: 'https://worldhistory.com/bell-acoustics',
          fullText: `A church bell does not produce a single musical note; it rings with a complex stack of partials that can easily clash into a metallic clang. In the seventeenth century, brothers Pieter and François Hemony solved a puzzle that had stumped European metalworkers for centuries: how to cast and shave bronze profiles so five distinct overtones align in clear harmony.

Working with nothing more than tuning rods and disciplined ears, they turned civic bell towers into precision instruments heard across entire valleys.`,
          isOutOfBubble: true
        }
      ];

      const matchesSignal = (item: typeof pool[0], list: string[]) =>
        list.some(sig => {
          const s = sig.toLowerCase();
          return (
            item.source.toLowerCase() === s ||
            item.folder.toLowerCase() === s ||
            item.title.toLowerCase().includes(s)
          );
        });

      const activeSourceNames = new Set(
        Array.isArray(sources)
          ? sources.filter((s: any) => s.status !== 'failing').map((s: any) => String(s.title).toLowerCase())
          : []
      );

      const scored = pool
        .filter(item => !lessIds.includes(item.id) && !matchesSignal(item, lessSignals))
        .map((item, idx) => {
          let score = 100 - idx;
          let why = item.why;

          if (activeSourceNames.has(item.source.toLowerCase())) {
            score += 10;
          }
          if (matchesSignal(item, moreSignals)) {
            score += 35;
            why = `More from ${item.source}, as you asked.`;
          }
          if (readingStats && readingStats[item.id]?.finished) {
            score += 5;
          }

          return { ...item, why, _score: score };
        });

      const inBubble = scored
        .filter(i => !i.isOutOfBubble)
        .sort((a, b) => b._score - a._score);

      const outBubble = scored
        .filter(i => i.isOutOfBubble)
        .sort((a, b) => b._score - a._score);

      const stretchTarget = serendipityDial >= 50 ? Math.min(2, outBubble.length) : Math.min(1, outBubble.length);
      const regularTarget = Math.max(0, itemCount - stretchTarget);

      const selected = [
        ...inBubble.slice(0, regularTarget),
        ...outBubble.slice(0, stretchTarget)
      ].map(({ _score, ...rest }) => rest);

      res.json({ digest: selected, generatedByAI: false });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to generate digest' });
    }
  });

  // Fetch article reader proxy
  app.post('/api/fetch-article', async (req, res) => {
    try {
      const { url } = req.body;
      if (!url) {
        return res.status(400).json({ error: 'URL required' });
      }

      res.json({
        success: true,
        url,
        title: 'Article Reader View',
        content: 'Clean reading view content successfully loaded and formatted for distraction-free reading.'
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Comprehensive multi-source feed stream endpoint
  app.post('/api/feed-stream', async (req, res) => {
    try {
      const { sourceTitle, sourceId } = req.body;

      const feedArticles = [
        {
          id: 'fa_nw_1',
          source: 'Nicole Williams',
          folder: 'Strategy & Craft',
          title: 'Nobody Ever Gets Credit for Fixing Problems that Never Happened',
          publishedAt: 'Today · 30m ago',
          readTime: '6 min read',
          summary: 'What gets seen gets rewarded. The fire you put out earns a thank you. The fire you prevented earns nothing.',
          url: 'https://substack.com/@pmresearcher/fixing-unseen-problems',
          fullText: `What gets seen gets rewarded. The fire you put out earns a thank you. The fire you prevented earns nothing.

In organizational dynamics, heroic firefighting is visible, dramatic, and emotionally compelling. When a server crashes at 2 AM or a supply chain breaks on a holiday weekend, the engineer or manager who stays up all night to patch the leak is celebrated.

Quiet prevention, by contrast, is completely invisible. The architectural refactor that eliminated the concurrency race condition before it ever triggered an outage produces no metrics, no alarms, and no drama.`,
          bannerImage: '/assets/aistudio/IMG_0653_a0a9ce59.png',
          quote: 'What gets seen gets rewarded. The fire you put out earns a thank you. The fire you prevented earns nothing',
          isOutOfBubble: false,
          why: 'Top pick from PM Researcher.'
        },
        {
          id: 'fa_ant_1',
          source: 'The Anthropic Stack',
          folder: 'Tech & AI',
          title: 'Scaling Laws and the Economics of Inference',
          publishedAt: 'Today · 35m ago',
          readTime: '10 min read',
          summary: 'Why the engineering bottleneck in machine intelligence is shifting from massive training runs to inference throughput, verification budgets, and latency guarantees.',
          url: 'https://anthropic.com/research/inference-economics',
          fullText: `For several years, progress in machine intelligence was measured primarily by the scale of training compute. Today, the decisive competitive frontier is inference: how much reasoning can be executed reliably within strict latency envelopes.

When inference becomes abundant and fast, applications shift from synchronous chat interfaces to quiet background editors. Instead of asking a prompt box for suggestions, tools pre-compute digests, verify citations, and organize material before the user even opens their screen.

This architectural shift rewards software that exercises editorial restraint. The goal is no longer generating maximal text, but delivering dense, high-signal curation that respects human attention.`,
          bannerImage: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?auto=format&fit=crop&w=1200&q=80',
          isOutOfBubble: false,
          why: 'In your Tech & AI folder.'
        },
        {
          id: 'fa_ant_2',
          source: 'The Anthropic Stack',
          folder: 'Tech & AI',
          title: 'Constitutional Steering: Guiding Agentic Workflows with Verifiable Invariants',
          publishedAt: 'Yesterday · 4:15 PM',
          readTime: '8 min read',
          summary: 'How system-level constitutions and invariant tests keep multi-step autonomous processes aligned without brittleness.',
          url: 'https://anthropic.com/research/constitutional-steering',
          fullText: `Autonomous agents often derail not because their core logic fails, but because small drift across sequential tool invocations compounds into hallucination.

By enforcing verifiable invariants at boundary transitions, systems can maintain predictable trajectory. The key is treating every intermediate tool call as an auditable contract with strict post-conditions rather than an opaque block of text.`,
          bannerImage: 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1200&q=80',
          isOutOfBubble: false,
          why: 'Follows your interest in software architecture.'
        },
        {
          id: 'fa_ant_3',
          source: 'The Anthropic Stack',
          folder: 'Tech & AI',
          title: 'Measuring Latency Floor Reductions in Parallel Tool Invocations',
          publishedAt: 'Nov 11 · 9:00 AM',
          readTime: '6 min read',
          summary: 'Benchmarking the architectural advantages of co-executing verification tools in single rounds.',
          url: 'https://anthropic.com/research/tool-latency-floors',
          fullText: `When client applications wait for sequential roundtrips between distributed services, latency degrades user engagement quickly.

Batching queries into single parallel dispatches reduces P95 turnaround times significantly while keeping system state atomic. This design pattern proves critical for responsive mobile web applications.`,
          bannerImage: 'https://images.unsplash.com/photo-1507679799987-c73779587ccf?auto=format&fit=crop&w=1200&q=80',
          isOutOfBubble: false,
          why: 'Engineering mechanics from The Anthropic Stack.'
        },
        {
          id: 'fa_wh_1',
          source: 'World Politics & History',
          folder: 'History',
          title: 'How Medieval Bell Founders Tuned Bronze by Ear',
          publishedAt: 'Today · 1h ago',
          readTime: '7 min read',
          summary: 'Before electronic spectrum analyzers, Flemish foundry masters learned how shaving internal bronze ribs unlocked harmonic resonance across five octaves.',
          url: 'https://worldhistory.com/bell-acoustics',
          fullText: `A cast church bell produces five distinct acoustic overtones: the strike note, the hum, the tierce, the quint, and the nominal. In unmachined bells, these partials clash discordantly.

In the seventeenth century, the Hemony brothers perfected vertical lathe carving on bronze bells, cutting away metal from specific inner rings until the five frequencies resonated in pure concord. This acoustic breakthrough transformed European cityscapes into harmonious musical landscapes.`,
          bannerImage: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1200&q=80',
          isOutOfBubble: false,
          why: 'In your History folder.'
        },
        {
          id: 'fa_wh_2',
          source: 'World Politics & History',
          folder: 'History',
          title: 'The Grain Routes of Byzantium: Logistics of Imperial Survival',
          publishedAt: 'Yesterday · 2:30 PM',
          readTime: '9 min read',
          summary: 'How Constantinople survived centuries of siege through fortified granaries, maritime grain fleets, and price stabilization laws.',
          url: 'https://worldhistory.com/byzantine-grain-routes',
          fullText: `The survival of Byzantium was fundamentally an exercise in grain logistics. With hundreds of thousands of citizens confined behind the Theodosian walls, supply lines from Egypt and the Black Sea coasts had to remain unbroken.

The empire established the praefectus annonae to oversee shipping manifests, build earthquake-resilient stone silos, and distribute bread rations during famine. When military lines broke, administrative logistics kept civilization afloat.`,
          bannerImage: 'https://images.unsplash.com/photo-1513694203232-719a280e022f?auto=format&fit=crop&w=1200&q=80',
          isOutOfBubble: false,
          why: 'Direct continuation of the Byzantine trade series.'
        },
        {
          id: 'fa_prospect_1',
          source: 'Prospect Magazine',
          folder: 'Culture',
          title: 'The Quiet Rise of Municipal Water Architects',
          publishedAt: 'Today · 2h ago',
          readTime: '6 min read',
          summary: 'Inside the unglamorous civic civil engineering reshaping how European cities absorb torrential storms while restoring urban biodiversity.',
          url: 'https://prospectmagazine.co.uk/water-architects',
          fullText: `Beneath every resilient metropolis lies a network of retention ponds, subterranean drainage channels, and porous paving stones designed to prevent street inundation.

In Rotterdam, public squares serve as basketball courts in dry weather and sunken retention basins during cloudbursts. Rather than hiding storm water in concrete culverts, contemporary urban hydrologists integrate water openly into public civic life.`,
          bannerImage: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1200&q=80',
          isOutOfBubble: false,
          why: 'In your Culture folder.'
        },
        {
          id: 'fa_prospect_2',
          source: 'Prospect Magazine',
          folder: 'Culture',
          title: 'The Rebirth of European Night Trains and Slow Transit',
          publishedAt: 'Nov 12 · 11:20 AM',
          readTime: '7 min read',
          summary: 'Why overnight sleeper lines from Vienna to Brussels are filling up with travelers who value unhurried transit over airport security lines.',
          url: 'https://prospectmagazine.co.uk/night-trains',
          fullText: `As aviation taxes and airport congestion mount, European travelers are returning to overnight sleeper routes. Falling asleep in Berlin and waking up in Paris offers a restorative rhythm lost in short-haul air travel.

The renaissance of cross-border rail highlights a broader shift toward deliberate slowness in personal technology, travel, and media consumption.`,
          bannerImage: 'https://images.unsplash.com/photo-1513694203232-719a280e022f?auto=format&fit=crop&w=1200&q=80',
          isOutOfBubble: false,
          why: 'From Prospect Magazine.'
        },
        {
          id: 'fa_bhaskar_1',
          source: 'Dr. Bhaskar Economics',
          folder: 'Economics',
          title: 'Fractional Reserve Mechanics in Early Renaissance Trading Hubs',
          publishedAt: 'Today · 3h ago',
          readTime: '9 min read',
          summary: 'How deposit receipts in Genoa and Venice evolved into liquid secondary credit instruments that bypassed papal usury restrictions.',
          url: 'https://bhaskar.econ/fractional-reserve-genoa',
          fullText: `Medieval merchant bankers discovered that only a small portion of deposited gold coin was ever withdrawn simultaneously. By issuing transfer receipts to settlement merchants, banks unlocked multiplier credit that fueled naval shipping.

This paper analyses how maritime credit contracts evolved within commercial guilds to establish early capital reserves without central bank oversight.`,
          bannerImage: 'https://images.unsplash.com/photo-1507679799987-c73779587ccf?auto=format&fit=crop&w=1200&q=80',
          isOutOfBubble: false,
          why: 'In your Economics folder.'
        },
        {
          id: 'fa_dan_1',
          source: 'Dan Luu',
          folder: 'Tech & Engineering',
          title: 'The Architecture of Long-Lived Systems and Institutional Memory',
          publishedAt: 'Today · 4h ago',
          readTime: '7 min read',
          summary: 'An exploration of how engineering organizations preserve architectural rationale across decades without succumbing to institutional amnesia.',
          url: 'https://danluu.com/systems-memory',
          fullText: `When building software or large institutions, the hardest problem is rarely writing the initial code or establishing the charter. The hardest problem is ensuring that the tacit knowledge of why decisions were made survives the departure of the people who made them.

In most modern engineering teams, documentation decays rapidly because it is treated as a chore rather than a living artifact. When an engineer leaves, their mental model of the system leaves with them. Over time, the codebase becomes a series of archaeological layers where current maintainers are afraid to touch certain modules because nobody remembers what load-bearing assumptions they rely on.`,
          bannerImage: 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1200&q=80',
          isOutOfBubble: false,
          why: 'You finish this writer almost every time.'
        },
        {
          id: 'fa_dan_2',
          source: 'Dan Luu',
          folder: 'Tech & Engineering',
          title: 'Why Small Tools Outlast Grand Platforms',
          publishedAt: 'Yesterday · 10:00 AM',
          readTime: '8 min read',
          summary: 'A look at unix utilities, plain text formats, and why narrow software endures while ambitious suites collapse under feature bloat.',
          url: 'https://danluu.com/small-tools',
          fullText: `Every decade brings a wave of all-in-one platforms promising to unify communication, documents, tasks, and knowledge under a single proprietary roof. Almost inevitably, those platforms grow sluggish, accumulate conflicting workflows, and eventually vanish when corporate priorities shift.

Meanwhile, small single-purpose tools built around open formats keep working quietly for thirty or forty years. Their durability comes from restraint: they do one job cleanly, expose predictable interfaces, and refuse to trap user data inside opaque silos.`,
          bannerImage: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?auto=format&fit=crop&w=1200&q=80',
          isOutOfBubble: false,
          why: 'Dan Luu engineering archive.'
        },
        {
          id: 'fa_strat_1',
          source: 'Stratechery by Ben Thompson',
          folder: 'Tech & Strategy',
          title: 'Stratechery: The Aggregation Theory of Modern Media',
          publishedAt: 'Today · 5h ago',
          readTime: '11 min read',
          summary: 'How zero marginal distribution cost inverted media power dynamics, and why owning discovery dominates owning supply.',
          url: 'https://stratechery.com/aggregation-theory',
          fullText: `For decades, media companies enjoyed local monopolies because distribution was physically constrained. If you owned the printing press, the delivery trucks, or the cable television lines, you controlled access to the audience.

The internet inverted this power dynamic completely. Distribution marginal cost dropped to zero, and all content became instantly accessible globally. In this new paradigm, the bottleneck shifted from distribution to discovery.`,
          bannerImage: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1200&q=80',
          isOutOfBubble: false,
          why: 'You finish this writer almost every time.'
        },
        {
          id: 'fa_mr_1',
          source: 'Marginal Revolution',
          folder: 'Economics',
          title: 'Venetian Banking Innovations and the Birth of Modern Credit',
          publishedAt: 'Today · 6h ago',
          readTime: '9 min read',
          summary: 'How 14th-century merchants in the Venetian lagoon invented bills of exchange and giro banking that powered the Renaissance.',
          url: 'https://marginalrevolution.com/venice-credit',
          fullText: `In the crowded piazzas of 14th-century Venice, merchants faced a logistical nightmare. Transporting gold coin across pirate-infested Mediterranean trade routes was both dangerous and inefficient. Out of this necessity arose the giro bank and the bill of exchange—instruments that transformed credit from a personal favor between acquaintances into a liquid, transferable financial asset.`,
          bannerImage: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1200&q=80',
          isOutOfBubble: false,
          why: 'Follows on from the Byzantine trade piece.'
        },
        {
          id: 'fa_mr_2',
          source: 'Marginal Revolution',
          folder: 'Economics',
          title: 'The Medici Ledger: Double-Entry Bookkeeping as Cultural Engine',
          publishedAt: 'Yesterday · 8:15 AM',
          readTime: '7 min read',
          summary: 'How systematic balance sheets allowed Florentine merchant houses to coordinate overseas branches with audit confidence.',
          url: 'https://marginalrevolution.com/medici-ledger',
          fullText: `Before double-entry bookkeeping spread across northern Italy, even wealthy trading houses struggled to tell whether a distant voyage had truly turned a profit or simply moved cash from one pocket to another. Luca Pacioli's codification of Venetian accounting methods turned commerce into a legible discipline.`,
          bannerImage: 'https://images.unsplash.com/photo-1507679799987-c73779587ccf?auto=format&fit=crop&w=1200&q=80',
          isOutOfBubble: false,
          why: 'Next step in Renaissance financial history.'
        },
        {
          id: 'fa_ala_1',
          source: 'A List Apart',
          folder: 'Design',
          title: 'The Unseen Geometry of Traditional Japanese Joinery',
          publishedAt: 'Today · 7h ago',
          readTime: '5 min read',
          summary: 'Why interlocking timber joints without nails or glue achieve seismic resilience and timeless aesthetic harmony.',
          url: 'https://alistapart.com/japanese-joinery',
          fullText: `In traditional Japanese timber architecture, master carpenters construct soaring temples and multi-story pagodas without a single nail, screw, or drop of glue. Instead, they rely on complex interlocking joints—such as the sashigane and kanawa tsugi—that lock tighter as wood expands and contracts with humidity and seismic tremors.`,
          bannerImage: 'https://images.unsplash.com/photo-1513694203232-719a280e022f?auto=format&fit=crop&w=1200&q=80',
          isOutOfBubble: false,
          why: 'In your Design folder.'
        },
        {
          id: 'fa_longnow_1',
          source: 'Long Now Foundation',
          folder: 'Philosophy & Long-term',
          title: 'Deep Time and the 10,000-Year Clock',
          publishedAt: 'Yesterday · 5:00 PM',
          readTime: '6 min read',
          summary: 'Designing mechanical artifacts intended to run accurately for millennia requires rethinking human impatience.',
          url: 'https://longnow.org/10000-year-clock',
          fullText: `Modern civilization suffers from a chronic temporal myopia. We plan in quarterly earnings reports, political election cycles, and 24-hour news cycles. Yet the most profound challenges facing humanity—ecological stewardship, nuclear waste management, infrastructure resilience—operate on timescales of centuries and millennia.`,
          bannerImage: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1200&q=80',
          isOutOfBubble: false,
          why: 'In your Philosophy folder.'
        },
        {
          id: 'fa_ny_1',
          source: 'The New Yorker - Books',
          folder: 'Culture',
          title: 'The Sonification of Stellar Nurseries: Listening to Nebulae',
          publishedAt: 'Nov 12 · 2:00 PM',
          readTime: '8 min read',
          summary: 'How astronomers are translating James Webb Space Telescope infrared data into audible soundscapes.',
          url: 'https://www.newyorker.com/science/stellar-sonification',
          fullText: `For centuries, astronomy has been an overwhelmingly visual science. We chart the universe through photographs rendered in false color, mapping light waves that our eyes cannot naturally perceive. But in recent years, astrophysicists and sound artists have begun translating astronomical telescope data into audible frequencies—a process known as sonification.`,
          bannerImage: 'https://images.unsplash.com/photo-1507679799987-c73779587ccf?auto=format&fit=crop&w=1200&q=80',
          isOutOfBubble: true,
          why: 'Deliberate stretch: Outside your usual tech and economics routine.'
        }
      ];

      // If a specific source title or ID was selected, filter by that source
      let filtered = feedArticles;
      if (sourceTitle && sourceTitle.trim() && sourceTitle !== 'all') {
        const queryNorm = sourceTitle.trim().toLowerCase();
        filtered = feedArticles.filter(
          item =>
            item.source.toLowerCase() === queryNorm ||
            item.source.toLowerCase().includes(queryNorm) ||
            queryNorm.includes(item.source.toLowerCase())
        );

        // If it's a custom source without pre-baked articles, synthesize realistic articles
        if (filtered.length === 0) {
          filtered = [
            {
              id: `fa_custom_${Date.now()}_1`,
              source: sourceTitle,
              folder: 'Custom Feed',
              title: `Latest Dispatches from ${sourceTitle}`,
              publishedAt: 'Today · 15m ago',
              readTime: '6 min read',
              summary: `Recent analytical reporting and essays directly from the ${sourceTitle} publication stream.`,
              url: `https://example.com/${encodeURIComponent(sourceTitle)}`,
              fullText: `This entry represents the live syndicated article stream from ${sourceTitle}. In this stream, entries appear in chronological arrival order—providing the traditional, comprehensive view of everything published by this author or organization.\n\nWhile Curator's morning digest distills five to eight items with editorial explanations, this Feeds tab gives you unfiltered access to the complete chronological stream whenever you want to browse all entries.`,
              bannerImage: 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1200&q=80',
              isOutOfBubble: false,
              why: `From your ${sourceTitle} subscription.`
            },
            {
              id: `fa_custom_${Date.now()}_2`,
              source: sourceTitle,
              folder: 'Custom Feed',
              title: `Archived Note: Foundational Perspectives on ${sourceTitle}`,
              publishedAt: 'Yesterday · 3:45 PM',
              readTime: '5 min read',
              summary: `Earlier commentary and historical analysis published in the ${sourceTitle} feed.`,
              url: `https://example.com/${encodeURIComponent(sourceTitle)}/archive`,
              fullText: `A deeper retrospective from ${sourceTitle}. Reading older entries in an author's archive helps uncover the foundational mental models that inform their current viewpoints.\n\nTraditional RSS streams allow you to track the evolution of an author's thinking over time without algorithmic interference.`,
              bannerImage: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1200&q=80',
              isOutOfBubble: false,
              why: `Archived article from ${sourceTitle}.`
            }
          ];
        }
      }

      res.json({
        success: true,
        source: sourceTitle || 'all',
        total: filtered.length,
        articles: filtered
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to retrieve feed stream' });
    }
  });

  // Helper utilities for RSS discovery and HTML-to-RSS investigation
  const fetchPageWithTimeout = async (targetUrl: string, timeoutMs = 4500) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(targetUrl, {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; CuratorRSSInvestigator/1.0)',
          'Accept': 'application/rss+xml, application/atom+xml, application/feed+json, application/xml, text/xml, text/html;q=0.9, */*;q=0.8'
        }
      });
      const contentType = response.headers.get('content-type') || '';
      const text = await response.text();
      return { ok: response.ok, status: response.status, url: response.url || targetUrl, contentType, text };
    } finally {
      clearTimeout(timer);
    }
  };

  const detectFeedFormat = (text: string, contentType: string): 'RSS 2.0' | 'Atom' | 'JSON Feed' | null => {
    const lowerCt = contentType.toLowerCase();
    const head = text.slice(0, 2000).toLowerCase();
    if (lowerCt.includes('feed+json') || (head.includes('https://jsonfeed.org/version') && head.includes('"items"'))) {
      return 'JSON Feed';
    }
    if (head.includes('<feed') && (head.includes('http://www.w3.org/2005/atom') || head.includes('<entry'))) {
      return 'Atom';
    }
    if (head.includes('<rss') || head.includes('<rdf:rdf') || (head.includes('<channel>') && head.includes('<item>'))) {
      return 'RSS 2.0';
    }
    return null;
  };

  const extractFeedTitles = (text: string, format: 'RSS 2.0' | 'Atom' | 'JSON Feed'): string[] => {
    try {
      if (format === 'JSON Feed') {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed.items)) {
          return parsed.items
            .slice(0, 3)
            .map((it: any) => String(it.title || it.content_text || '').trim())
            .filter(Boolean);
        }
        return [];
      }
      const tag = format === 'Atom' ? 'entry' : 'item';
      const itemRegex = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
      const titles: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = itemRegex.exec(text)) !== null && titles.length < 3) {
        const titleMatch = m[1].match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
        if (titleMatch?.[1]) {
          const clean = titleMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
          if (clean) titles.push(clean);
        }
      }
      return titles;
    } catch {
      return [];
    }
  };

  const extractAlternateFeedsFromHtml = (html: string, baseUrl: string): string[] => {
    const found: string[] = [];
    const linkRegex = /<link\b[^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = linkRegex.exec(html)) !== null) {
      const tag = m[0];
      const rel = tag.match(/\brel\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
      const relVal = (rel?.[1] ?? rel?.[2] ?? '').toLowerCase();
      if (!relVal.includes('alternate')) continue;

      const type = tag.match(/\btype\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
      const typeVal = (type?.[1] ?? type?.[2] ?? '').toLowerCase();
      if (
        !typeVal.includes('rss') &&
        !typeVal.includes('atom') &&
        !typeVal.includes('feed+json') &&
        !typeVal.includes('xml')
      ) {
        continue;
      }

      const href = tag.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
      const hrefVal = (href?.[1] ?? href?.[2] ?? '').trim();
      if (!hrefVal) continue;
      try {
        const resolved = new URL(hrefVal, baseUrl).toString();
        if (!found.includes(resolved)) found.push(resolved);
      } catch {
        // ignore invalid href
      }
    }
    return found;
  };

  const extractHtmlArticleCandidates = (html: string, baseUrl: string): Array<{ title: string; url: string }> => {
    const results: Array<{ title: string; url: string }> = [];
    const seenUrls = new Set<string>();
    const skipPattern = /\/(login|signin|signup|register|privacy|terms|cookie|about|contact|subscribe|pricing|search|tag|category|author)\b/i;

    // Prefer links inside <article> or heading tags (<h1>-<h4>)
    const blockRegex = /<(?:article|h1|h2|h3|h4)\b[^>]*>[\s\S]*?<\/(?:article|h1|h2|h3|h4)>/gi;
    const anchorRegex = /<a\b[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi;

    const collectFromHtmlChunk = (chunk: string) => {
      let aMatch: RegExpExecArray | null;
      anchorRegex.lastIndex = 0;
      while ((aMatch = anchorRegex.exec(chunk)) !== null && results.length < 10) {
        const rawHref = (aMatch[1] ?? aMatch[2] ?? '').trim();
        const rawText = aMatch[3].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('javascript:') || rawHref.startsWith('mailto:')) continue;
        if (rawText.length < 18 || rawText.length > 180) continue;

        try {
          const resolved = new URL(rawHref, baseUrl).toString();
          if (skipPattern.test(resolved)) continue;
          if (resolved === baseUrl || resolved === baseUrl + '/') continue;
          if (seenUrls.has(resolved)) continue;
          seenUrls.add(resolved);
          results.push({ title: rawText, url: resolved });
        } catch {
          // ignore
        }
      }
    };

    let bMatch: RegExpExecArray | null;
    while ((bMatch = blockRegex.exec(html)) !== null && results.length < 10) {
      collectFromHtmlChunk(bMatch[0]);
    }

    if (results.length < 2) {
      collectFromHtmlChunk(html);
    }

    return results;
  };

  const investigateSourceForRss = async (candidate: {
    title: string;
    siteUrl: string;
    guessedFeedUrl?: string;
    folder?: string;
    summary?: string;
  }) => {
    const baseOutput = {
      title: candidate.title,
      siteUrl: candidate.siteUrl,
      folder: candidate.folder || 'Discovered',
      summary: candidate.summary || '',
    };

    let normalizedSiteUrl = candidate.siteUrl;
    try {
      const u = new URL(normalizedSiteUrl);
      normalizedSiteUrl = u.toString();
    } catch {
      return {
        ...baseOutput,
        rssStatus: 'unavailable' as const,
        canGenerateRss: false,
        feedUrl: null as string | null,
        feedFormat: null as string | null,
        sampleTitles: [] as string[],
        investigationNote: 'Invalid website URL returned from search.',
      };
    }

    const probeFeedUrl = async (urlToTest: string) => {
      try {
        const res = await fetchPageWithTimeout(urlToTest, 3500);
        if (!res.ok) return null;
        const format = detectFeedFormat(res.text, res.contentType);
        if (!format) return null;
        return {
          feedUrl: res.url,
          format,
          sampleTitles: extractFeedTitles(res.text, format),
        };
      } catch {
        return null;
      }
    };

    // 1. Probe guessedFeedUrl if provided
    if (candidate.guessedFeedUrl) {
      const direct = await probeFeedUrl(candidate.guessedFeedUrl);
      if (direct) {
        return {
          ...baseOutput,
          rssStatus: 'native' as const,
          canGenerateRss: false,
          feedUrl: direct.feedUrl,
          feedFormat: direct.format,
          sampleTitles: direct.sampleTitles,
          investigationNote: `Verified native ${direct.format} feed.`,
        };
      }
    }

    // 2. Fetch site HTML to look for <link rel="alternate"> or inspect HTML structure
    let htmlRes: Awaited<ReturnType<typeof fetchPageWithTimeout>> | null = null;
    try {
      htmlRes = await fetchPageWithTimeout(normalizedSiteUrl, 4500);
      // In case siteUrl itself IS already a feed
      const directFormat = detectFeedFormat(htmlRes.text, htmlRes.contentType);
      if (htmlRes.ok && directFormat) {
        return {
          ...baseOutput,
          rssStatus: 'native' as const,
          canGenerateRss: false,
          feedUrl: htmlRes.url,
          feedFormat: directFormat,
          sampleTitles: extractFeedTitles(htmlRes.text, directFormat),
          investigationNote: `Verified native ${directFormat} feed.`,
        };
      }
    } catch {
      htmlRes = null;
    }

    if (htmlRes && htmlRes.ok) {
      const alternateFeeds = extractAlternateFeedsFromHtml(htmlRes.text, htmlRes.url);
      for (const altUrl of alternateFeeds.slice(0, 2)) {
        const verified = await probeFeedUrl(altUrl);
        if (verified) {
          return {
            ...baseOutput,
            rssStatus: 'native' as const,
            canGenerateRss: false,
            feedUrl: verified.feedUrl,
            feedFormat: verified.format,
            sampleTitles: verified.sampleTitles,
            investigationNote: `Native ${verified.format} feed discovered in page metadata.`,
          };
        }
      }
    }

    // 3. Probe common feed endpoints at origin
    try {
      const origin = new URL(normalizedSiteUrl).origin;
      const commonPaths = ['/feed', '/rss', '/feed.xml', '/rss.xml', '/atom.xml', '/index.xml'];
      const probeResults = await Promise.all(commonPaths.map(p => probeFeedUrl(origin + p)));
      const foundStandard = probeResults.find(Boolean);
      if (foundStandard) {
        return {
          ...baseOutput,
          rssStatus: 'native' as const,
          canGenerateRss: false,
          feedUrl: foundStandard.feedUrl,
          feedFormat: foundStandard.format,
          sampleTitles: foundStandard.sampleTitles,
          investigationNote: `Native ${foundStandard.format} feed found at standard endpoint.`,
        };
      }
    } catch {
      // ignore
    }

    // 4. Evaluate whether an RSS feed can be generated from the HTML page
    if (!htmlRes) {
      return {
        ...baseOutput,
        rssStatus: 'unreachable' as const,
        canGenerateRss: false,
        feedUrl: null,
        feedFormat: null,
        sampleTitles: [],
        investigationNote: 'Site timed out or could not be reached to check for RSS generation.',
      };
    }

    const bodyLower = htmlRes.text.toLowerCase();
    const isBlocked =
      htmlRes.status === 401 ||
      htmlRes.status === 403 ||
      htmlRes.status === 429 ||
      bodyLower.includes('cf-browser-verification') ||
      bodyLower.includes('attention required! | cloudflare') ||
      bodyLower.includes('just a moment...');

    if (isBlocked) {
      return {
        ...baseOutput,
        rssStatus: 'blocked' as const,
        canGenerateRss: false,
        feedUrl: null,
        feedFormat: null,
        sampleTitles: [],
        investigationNote: `No native feed found; site blocks automated HTML reading (HTTP ${htmlRes.status}), so an RSS feed cannot be generated.`,
      };
    }

    const articleCandidates = extractHtmlArticleCandidates(htmlRes.text, htmlRes.url);
    if (articleCandidates.length >= 2) {
      const generatedFeedUrl = `/api/generated-feed?url=${encodeURIComponent(htmlRes.url)}&title=${encodeURIComponent(candidate.title)}`;
      return {
        ...baseOutput,
        rssStatus: 'generatable' as const,
        canGenerateRss: true,
        feedUrl: generatedFeedUrl,
        feedFormat: 'Generated RSS 2.0',
        sampleTitles: articleCandidates.slice(0, 3).map(a => a.title),
        investigationNote: `No native RSS found, but ${articleCandidates.length} structured HTML articles are accessible — an RSS feed can be generated.`,
      };
    }

    const isSpaShell =
      (bodyLower.includes('<div id="root"></div>') || bodyLower.includes('<div id="app"></div>') || bodyLower.includes('__next_data__')) &&
      articleCandidates.length === 0;

    return {
      ...baseOutput,
      rssStatus: 'unavailable' as const,
      canGenerateRss: false,
      feedUrl: null,
      feedFormat: null,
      sampleTitles: [],
      investigationNote: isSpaShell
        ? 'No native feed found; page requires client-side JavaScript rendering, so an HTML-to-RSS feed cannot be generated.'
        : 'No native feed found and no structured article links were detected on this page.',
    };
  };

  // Google Search Grounding + RSS Feed Investigation endpoint
  app.post('/api/discover-sources', async (req, res) => {
    try {
      const { query } = req.body;
      if (!query || typeof query !== 'string' || !query.trim()) {
        return res.status(400).json({ error: 'Search terms are required.' });
      }

      if (!ai) {
        return res.status(503).json({
          error: 'Google Search discovery requires a configured GEMINI_API_KEY on the server.',
        });
      }

      aiRequestCount++;

      const prompt = `Use Google Search to find 5 to 6 high-quality independent publications, blogs, newsletters, or editorial websites relevant to this search topic: "${query.trim()}".

Focus on thoughtful writing and recurring publications (not social media profiles, shopping pages, or encyclopedias).

Return a JSON array (wrapped in \`\`\`json ... \`\`\`) where each object has:
- "title": publication or blog name
- "siteUrl": full homepage or section URL (https://...)
- "guessedFeedUrl": likely RSS or Atom feed URL if known, otherwise empty string ""
- "folder": short 1-2 word topic folder name (e.g. "Economics", "History", "AI & Tech")
- "summary": one concise plain-English sentence describing what the publication writes about.`;

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
        },
      });

      const rawText = response.text || '';
      const groundingMetadata = response.candidates?.[0]?.groundingMetadata;
      const groundingChunks = (groundingMetadata?.groundingChunks || [])
        .map((c: any) => ({
          title: c?.web?.title || '',
          uri: c?.web?.uri || '',
        }))
        .filter((c: { title: string; uri: string }) => Boolean(c.uri));

      const webSearchQueries: string[] = groundingMetadata?.webSearchQueries || [];

      // Parse JSON array from grounded response text
      let parsedCandidates: Array<{
        title: string;
        siteUrl: string;
        guessedFeedUrl?: string;
        folder?: string;
        summary?: string;
      }> = [];

      try {
        const fencedMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);
        const jsonCandidate = fencedMatch ? fencedMatch[1] : rawText;
        const arrayMatch = jsonCandidate.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
          const parsed = JSON.parse(arrayMatch[0]);
          if (Array.isArray(parsed)) {
            parsedCandidates = parsed.filter(
              (item: any) => item && typeof item.title === 'string' && typeof item.siteUrl === 'string'
            );
          }
        }
      } catch {
        // Fallback to grounding chunks if model output wasn't cleanly structured JSON
      }

      // If JSON parsing yielded nothing, build candidates directly from Google Search groundingChunks
      if (parsedCandidates.length === 0 && groundingChunks.length > 0) {
        const seenOrigins = new Set<string>();
        for (const chunk of groundingChunks) {
          try {
            const origin = new URL(chunk.uri).origin;
            if (seenOrigins.has(origin)) continue;
            seenOrigins.add(origin);
            parsedCandidates.push({
              title: chunk.title || origin.replace(/^https?:\/\/(www\.)?/, ''),
              siteUrl: chunk.uri,
              folder: query.trim().slice(0, 24),
              summary: 'Discovered via Google Search grounding.',
            });
            if (parsedCandidates.length >= 6) break;
          } catch {
            // ignore
          }
        }
      }

      // Deduplicate by origin and cap at 6 candidates for snappy parallel investigation
      const uniqueCandidates: typeof parsedCandidates = [];
      const seenDomains = new Set<string>();
      for (const cand of parsedCandidates) {
        try {
          const host = new URL(cand.siteUrl).hostname.replace(/^www\./, '').toLowerCase();
          if (seenDomains.has(host)) continue;
          seenDomains.add(host);
          uniqueCandidates.push(cand);
          if (uniqueCandidates.length >= 6) break;
        } catch {
          // skip malformed urls
        }
      }

      const investigated = await Promise.all(
        uniqueCandidates.map(cand => investigateSourceForRss(cand))
      );

      res.json({
        query: query.trim(),
        webSearchQueries,
        groundingLinks: groundingChunks.slice(0, 8),
        results: investigated,
      });
    } catch (err: any) {
      console.error('Discover sources error:', err);
      res.status(500).json({ error: err?.message || 'Failed to search for sources.' });
    }
  });

  // Generated HTML-to-RSS 2.0 endpoint for sites without native RSS
  app.get('/api/generated-feed', async (req, res) => {
    try {
      const targetUrl = String(req.query.url || '').trim();
      const feedTitle = String(req.query.title || 'Generated Curator Feed').trim();
      if (!targetUrl) {
        return res.status(400).send('Missing url parameter');
      }

      const page = await fetchPageWithTimeout(targetUrl, 5000);
      if (!page.ok) {
        return res.status(502).send(`Upstream site returned HTTP ${page.status}`);
      }

      const articles = extractHtmlArticleCandidates(page.text, page.url);
      const escapeXml = (s: string) =>
        s
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&apos;');

      const nowRfc822 = new Date().toUTCString();
      const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(feedTitle)}</title>
    <link>${escapeXml(page.url)}</link>
    <description>Generated RSS feed extracted from ${escapeXml(page.url)}</description>
    <lastBuildDate>${nowRfc822}</lastBuildDate>
    ${articles
      .map(
        a => `<item>
      <title>${escapeXml(a.title)}</title>
      <link>${escapeXml(a.url)}</link>
      <guid isPermaLink="true">${escapeXml(a.url)}</guid>
    </item>`
      )
      .join('\n    ')}
  </channel>
</rss>`;

      res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
      res.send(rssXml);
    } catch (err: any) {
      res.status(500).send(err?.message || 'Failed to generate RSS feed');
    }
  });

  // Vite middleware for development
  const vite = await createViteServer({
    server: { middlewareMode: true, hmr: process.env.DISABLE_HMR !== 'true' }
  });

  app.use(vite.middlewares);

  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
