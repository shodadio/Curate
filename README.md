# Curator — Morning Reading Editor & Intelligent RSS Digest

[![TypeScript](https://img.shields.io/badge/TypeScript-7.x-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=black)](https://react.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-38bdf8?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Express](https://img.shields.io/badge/Express-4.x-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![Google GenAI SDK](https://img.shields.io/badge/@google/genai-3.3-4285f4?logo=google&logoColor=white)](https://ai.google.dev/)
[![PWA Ready](https://img.shields.io/badge/PWA-Ready-5A0FC8?logo=pwa&logoColor=white)](https://web.dev/progressive-web-apps/)
[![License: MIT](https://img.shields.io/badge/License-MIT-amber.svg)](LICENSE)

> **Curator** is a calm, finite reading editor that turns unmanageable RSS streams, Substacks, and web publications into an elegant, focused daily digest. Designed around editorial intentionality rather than algorithmic engagement loops, it selects high-signal articles each morning, balances your intellectual diet with serendipitous perspectives, and provides instant fallback safeguards for signal tuning.

---

## Table of Contents

- [Editorial Philosophy](#editorial-philosophy)
- [Key Features](#key-features)
  - [1. Daily Curated Digest](#1-daily-curated-digest)
  - [2. Deliberate Stretch ("Out of the Bubble" picks)](#2-deliberate-stretch-out-of-the-bubble-picks)
  - [3. Signal Tuning with Undo Safeguards](#3-signal-tuning-with-undo-safeguards)
  - [4. Google Search RSS Discovery & Feed Synthesis](#4-google-search-rss-discovery--feed-synthesis)
  - [5. Outbound SSRF Hardening & Network Security](#5-outbound-ssrf-hardening--network-security)
  - [6. Provider-Configurable Curation & Semantic Ranking](#6-provider-configurable-curation--semantic-ranking)
  - [7. OPML Import & Export](#7-opml-import--export)
  - [8. Distraction-Free Reader & Onboard Read Aloud](#8-distraction-free-reader--onboard-read-aloud)
  - [9. Mobile & iOS Safari Viewport Hardening](#9-mobile--ios-safari-viewport-hardening)
  - [10. Progressive Web App (PWA) Support](#10-progressive-web-app-pwa-support)
- [System Architecture](#system-architecture)
- [API Reference](#api-reference)
  - [`POST /api/curate`](#post-apicurate)
  - [`POST /api/calibrate`](#post-apicalibrate)
  - [`POST /api/feed-stream`](#post-apifeed-stream)
  - [`POST /api/source-descriptions`](#post-apisource-descriptions)
  - [`POST /api/article-text`](#post-apiarticle-text)
  - [`POST /api/article-texts`](#post-apiarticle-texts)
  - [`POST /api/check-feed`](#post-apicheck-feed)
  - [`POST /api/discover-sources`](#post-apidiscover-sources)
  - [`POST /api/parse-opml`](#post-apiparse-opml)
  - [`POST /api/test-provider`](#post-apitest-provider)
  - [`POST /api/provider-models`](#post-apiprovider-models)
  - [`GET /api/generated-feed`](#get-apigenerated-feed)
  - [`GET /api/favicon`](#get-apifavicon)
  - [`GET /api/health`](#get-apihealth)
  - [`GET /api/semantic-status`](#get-apisemantic-status)
  - [`GET /api/usage`](#get-apiusage)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Environment Variables](#environment-variables)
  - [Running Locally](#running-locally)
  - [Production Deployment](#production-deployment)
- [Available Scripts](#available-scripts)
- [Privacy & Local Persistence](#privacy--local-persistence)
- [License](#license)

---

## Editorial Philosophy

Modern digital reading is burdened by infinite feeds, engagement algorithms, and ad-incentivized outrage. Standard RSS readers often amplify this problem by accumulating unread counters that induce guilt and information fatigue.

**Curator** reintroduces the classic ritual of the **finite morning edition**:
- **Finite editions**: Choose between 3, 5, 8, 12, or 15 high-signal pieces each morning. When you reach the bottom, you are done for the day.
- **Editorial signal over clickbait**: Evaluates articles based on analytical depth, evergreen value, and original reporting rather than sensationalism.
- **Deliberate stretch by design**: The digest includes "Out of the Bubble" selections from history, philosophy, design, and economics — tuned by the **Serendipity** slider in the Today controls — to prevent intellectual echo chambers.
- **Forgiving user controls**: Any negative preference signal (such as clicking "Fewer like this") provides an immediate inline undo confirmation and interactive toast fallback, ensuring accidental taps never purge content permanently.

---

## Key Features

### 1. Daily Curated Digest
- **Configurable Morning Issue**: Select your target reading load (3, 5, 8, 12, or 15 articles) with estimated reading times and categorized tags.
- **Dynamic Summaries**: Automatically generates concise, informative executive summaries and reading notes.
- **Editorial Ranking**: Scores articles on analytical density, source reputation, topic diversity, and personal reading history.

### 2. Deliberate Stretch ("Out of the Bubble" picks)
- The Today controls label the dial **Serendipity**, and the digest section carrying these picks is titled **Deliberate Stretch — Outside Your Usual Bubble**.
- Deliberately identifies and highlights articles outside your standard reading habits.
- Pulls from foundational domains such as long-term thinking, political philosophy, urbanism, and deep history to challenge assumptions and spark creative cross-pollination.

### 3. Signal Tuning with Undo Safeguards
- **Streamlined Icon-Only Controls**: Clean, minimalist thumbs-up and thumbs-down icon buttons on cards keep the layout uncluttered without extraneous "More" or "Less" text labels.
- **More Like This**: Boosts weights for related topics and source categories (amber highlight on activation).
- **Fewer Like This**: Deprioritizes recurring themes without abrupt card deletion (rose highlight on activation).
- **Undo fallback**:
  - When clicking "Fewer", the card morphs into an inline placeholder with an **Undo** button and a dismiss option.
  - A toast notification appears with a direct one-click **Undo** action.
  - Inside the reader modal, clicking "Fewer" preserves your place and shows an **Undo** button without closing the article.

### 4. Google Search RSS Discovery & Feed Synthesis
- **Search Authors & Outlets**: Enter the name of any publication, thinker, or newsletter (e.g., *Stratechery*, *Marginal Revolution*, *Dan Luu*).
- **RSS Availability Check**: Powered by Google Search grounding to detect whether the site provides native RSS/Atom feeds, Substack endpoints, or WordPress feeds.
- **Automatic Feed Synthesis**: For publications without native feeds, Curator extracts article links and generates a clean, parsable RSS 2.0 XML endpoint via `/api/generated-feed`.

### 5. Outbound SSRF Hardening & Network Security
- **DNS Lookup Guard (`guardedLookup`)**: Verifies all resolved IP addresses at connect time to prevent DNS rebinding attacks.
- **Private Address Blocking**: Rejects connections to loopback (`127.0.0.0/8`, `::1`), private ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `fc00::/7`), CGNAT (`100.64.0.0/10`), link-local/cloud metadata (`169.254.0.0/16`, `fe80::/10`, `metadata.google.internal`), and multicast addresses.
- **Safe Redirect Resolution**: Limits redirect hops to 4 with re-validation on every hop.
- **Payload Size Cap**: Enforces a strict 2MB maximum page download limit (`MAX_PAGE_BYTES`) to prevent denial-of-service memory exhaustion.

### 6. Provider-Configurable Curation & Semantic Ranking
- Digest curation can use a configurable OpenAI-compatible chat endpoint, Anthropic, optional Gemini, or the built-in deterministic engine.
- Semantic ranking uses a separately configured OpenAI-compatible embeddings endpoint or optional Gemini embeddings, with provider/model/base URL settings in the app.
- Feedback examples remain browser-local; embedding vectors are short-lived server-memory cache entries. If an API is unavailable, Curator falls back to deterministic ranking.
- Google Search grounding is an optional source-discovery adapter; without it, source discovery uses Curator's built-in publication directory.

### 7. OPML Import & Export
- **One-Click Migration**: Import existing subscriptions from Feedly, Inoreader, NetNewsWire, Readwise Reader, Reeder, or NewsBlur.
- **Folder Preservation**: Preserves nested categories, folders, and custom tags.
- **Export Anytime**: Download a clean, standardized `.opml` XML file containing your complete watch list.

### 8. Distraction-Free Reader & Onboard Read Aloud
- **Typographic Discipline**: One self-hosted variable family, *Inter* (roman 47 KB + italic 51 KB woff2, `font-display: optional`), used for the interface, reading bodies, wordmark and metadata alike — no Google Fonts requests, so text never reflows or changes face after first paint.
- **Native Read Aloud**:
  - A sentence-by-sentence queue over the browser's own `window.speechSynthesis`, so an article is never cut off by the engine's long-utterance limit (Chrome stops at roughly fifteen seconds, iOS stalls on very long strings), and every paragraph break gets a natural beat.
  - Defaults to **Jamie (Premium)** at a calm 0.95× rate when the browser exposes that voice; otherwise it leaves voice selection to the device's Spoken Content settings. Automatic mode prefers voices explicitly named Enhanced, Premium, Neural or Natural. Other installed voices and any speed can be chosen by hand in **Settings → Read aloud**, with a *Hear this voice* preview.
  - Live progress bar with paragraph and sentence position, the spoken paragraph highlighted, and tap-any-paragraph to listen from that point.
  - Feed debris — URLs, footnote marks, bracket asides, "Read more" furniture, abbreviations and currency — is normalised out of the text before it reaches the voice.
- **Scroll Depth Tracker**: Automatically tracks reading progress and marks articles as finished once the user scrolls past 85% depth.

### 9. Mobile & iOS Safari Viewport Hardening
- **Zero Horizontal Bleed**: `overflow-x: clip`, `width: 100%`, and `background-color: #020617` enforced across `html`, `body`, `#root`, and layout wrappers. Clipping avoids creating an overflow scroll container that can interrupt the sticky header.
- **Safe Area Insets**: Uses `viewport-fit=cover` and responsive padding (`px-4 sm:px-6`) to prevent notch clipping or cut-off margins on mobile viewports.
- **Floating Bottom Dock**: Floating navigation dock centered using `left-1/2 -translate-x-1/2` and clamped to `w-[calc(100%-2rem)] max-w-lg`, preventing horizontal page jitter.

### 10. Progressive Web App (PWA) Support
- **Standalone Display**: Configured via Web App Manifest for full-screen, app-like experience when added to the home screen.
- **Icon Set**: Complete set of PWA assets (`favicon.ico`, `apple-touch-icon.png`, `pwa-192x192.png`, `pwa-512x512.png`).
- **Offline Reliability**: Powered by `vite-plugin-pwa` with service worker asset caching.

---

## System Architecture

Curator is built as a unified full-stack web application with Vite middlewares running inside an Express backend.

```
┌─────────────────────────────────────────────────────────────────┐
│                       Client (React 19)                         │
│  - Inter (self-hosted, sole family)                                │
│  - Top Header Navigation with Refresh & Settings Controls       │
│  - Bottom Dock Navigation (Today, Feeds, Saved, Sources)        │
│  - Signal Tuning with Undo Fallbacks                            │
│  - Sentence-Queued Read Aloud (voice + rate)                    │
│  - LocalStorage State Manager (Bookmarks, Stats, Signal Weights)│
└────────────────────────────────┬────────────────────────────────┘
                                 │ HTTP / JSON
┌────────────────────────────────▼────────────────────────────────┐
│                   Server (Express + Vite)                       │
│  - server.ts entry point                                        │
│  - Vite dev server middleware mounted in dev                     │
│  - Outbound SSRF Protection (DNS Lookup Guard & IP Filter)      │
├─────────────────────────────────────────────────────────────────┤
│                     Core API Endpoints                          │
│  • /api/curate                 • /api/discover-sources          │
│  • /api/feed-stream            • /api/generated-feed            │
│  • /api/parse-opml                                              │
├────────────────────────────────┬────────────────────────────────┤
│                                │                                │
│      Provider Adapters         │   Built-in Semantic Engine     │
│  - OpenAI-compatible APIs      │      (Always On, No Key)       │
│  - Optional Anthropic/Gemini   │  - TF-IDF article similarity   │
│  - Separate embedding API      │  - Vote-weighted centroids     │
│                                │  - Recency + exposure decay    │
└────────────────────────────────┴────────────────────────────────┘
```

---

## API Reference

Every endpoint lives on the same Express server, so there is no separate API host or CORS setup. Routes that fetch feeds or reach an AI provider are rate-limited in memory per client per minute (30 for `/api/curate`, 6 for `/api/discover-sources` and `/api/parse-opml`, and so on); over the limit they answer `429` with a `Retry-After` header. "Per client" means the requesting address, which is only the real visitor when `TRUST_PROXY=1` is set behind your proxy — see [Environment Variables](#environment-variables).

### `POST /api/curate`
Accepts a list of sources, item count target (3–15), and optional topic preference adjustments. Gathers recent feed entries and returns ranked, summarized digest articles with an "Out of the Bubble" pick.

Ranking happens in three layers, and all three run without any API key:

1. **Built-in semantic engine** — TF-IDF vectors over each article's title, folder, summary and excerpt, compared against recency-weighted centroids of your liked and disliked articles. Legacy votes (ids without a stored excerpt) are recovered from the live pool so the engine learns immediately.
2. **Freshness** — articles you have already been shown are down-weighted (heavy for 18 hours, lighter for up to two weeks), and a manual refresh keeps the current digest's articles out of the pool when there is room. Feed libraries wider than one run can fetch are rotated by a per-request seed.
3. **Optional provider embeddings** — when an OpenAI-compatible or Gemini embeddings endpoint is configured, provider similarity is blended 65/35 with the built-in scores. Provider failures fall back to the built-in engine rather than silently disabling semantic ranking.

### Setup and calibration
A cold profile has nothing to rank against, so the app ships a three-step setup flow (shown on first run when no votes exist, and re-runnable from **Settings → Your reading preferences → Teach Curator with articles**):

1. **Sources** — shows the feed count and scans them.
2. **Calibration** — presents up to 12 recent articles from across the library (max 2 per source) with *More like this* / *Not for me*. Each tap is written to the browser-local profile exactly like a digest vote.
3. **Engine** — confirms the built-in engine is on and builds the first digest. Embeddings providers stay optional.

Calibration is served by `POST /api/calibrate` with `{ sources, excludeIds }` and returns up to 12 candidate articles, newest first and spread across sources. It uses the same feed cache as curation, so a scan immediately followed by a digest does not re-download every feed.

**Request Body:**
```json
{
  "sources": [
    { "id": "src_0", "title": "Nicole Williams", "feedUrl": "https://pmresearcher.substack.com/feed", "folder": "Strategy & Craft" }
  ],
  "signals": { "more": ["Technology"], "less": ["Crypto"] },
  "feedback": [
    { "id": "live_ab12", "vote": "like", "title": "The Architecture of Deep Focus", "text": "…", "timestamp": 1732000000000, "source": "Nicole Williams", "folder": "Strategy & Craft" }
  ],
  "recentlyShown": [{ "id": "live_cd34", "shownAt": 1732000000000 }],
  "previousDigestIds": ["live_cd34"],
  "fresh": true,
  "seed": "1732000000000-0.42",
  "itemCount": 6,
  "serendipityDial": 20
}
```

**Response:**
```json
{
  "digest": [
    {
      "id": "item_123",
      "title": "The Architecture of Deep Focus",
      "summary": "An examination of cognitive endurance in knowledge work.",
      "readingTimeMinutes": 7,
      "source": "Nicole Williams",
      "folder": "Strategy & Craft",
      "url": "https://example.com/article",
      "isOutOfBubble": false
    }
  ],
  "generatedByAI": true
}
```

---

### `POST /api/calibrate`
Builds the three-step setup flow's calibration list: up to 12 recent articles, spread across at most 14 sources with no more than two per source and newest first. It shares the curation feed cache, so a calibration scan followed by a digest does not re-download every feed.

**Request Body:**
```json
{
  "sources": [
    { "id": "src_0", "title": "Nicole Williams", "feedUrl": "https://pmresearcher.substack.com/feed", "folder": "Strategy & Craft" }
  ],
  "excludeIds": ["live_cd34"]
}
```

**Response:** `{ "candidates": [...] }` in the same article shape as a digest entry. Answers `404` when no live articles could be read.

---

### `POST /api/feed-stream`
Retrieves chronological feed entries for a specific source ID or across all subscribed sources for the traditional "Feeds" stream.

**Request Body:**
```json
{
  "sourceTitle": "Nicole Williams"
}
```

---

### `POST /api/source-descriptions`
Fetches each source’s publication description from RSS/Atom metadata, falling back to the site’s standard metadata when the feed has no blurb. The Sources screen requests descriptions in small batches and caches them with each source in browser storage.

**Request Body:** `{ "sources": [{ "id": "src_0", "feedUrl": "https://example.com/feed.xml" }] }`

**Response:** `{ "sources": [{ "id": "src_0", "description": "A publication about…" }] }`. A source may include an `error` when its feed or site could not be reached.

---

### `POST /api/article-text`
Re-extracts one article's body on demand. A piece saved before the reader kept inline links has only the link's words in its stored text, so opening it fetches the piece once and rewrites that copy; text cleaned since then carries a `linksCleaned` flag and is never fetched again. The extractor and its 24-hour cache are the ones curation already uses, so a story fetched for the digest costs nothing here.

**Request Body:** `{ "url": "https://example.com/story" }`

**Response:** `{ "text": "…" }`, with each citation carried as a `[label](url)` marker. An empty string means the article could not be read, and the reader keeps the copy it already had.

---

### `POST /api/article-texts`
Re-extracts several saved pieces in one pass, for the “Add citations” action in Saved. It is the same extractor and 24-hour cache as `POST /api/article-text`, four stories at a time, so a long queue is not a burst of requests to its publishers.

**Request Body:** `{ "items": [{ "id": "live_abc", "url": "https://example.com/story" }] }` (up to 16 per call)

**Response:** `{ "articles": [{ "id": "live_abc", "text": "…" }] }`. An empty `text` means that piece could not be read and its stored copy stays as it is.

---

### `POST /api/check-feed`
Proves a feed URL works before it is added to the watch list, using the same outbound filter and parser as curation.

**Request Body:**
```json
{ "feedUrl": "https://marginalrevolution.com/feed" }
```

**Response:** `{ "ok": true, "itemCount": 25, "title": "Marginal Revolution" }`, or `{ "ok": false, "error": "…" }` with a readable reason. A bad address is a normal answer here, so both cases return `200`.

---

### `POST /api/discover-sources`
Performs a grounded search using Google Search to discover publications, assess RSS availability, and extract sample headlines.

**Request Body:**
```json
{
  "query": "Byzantine history"
}
```

---

### `POST /api/parse-opml`
Parses an uploaded `.opml` or `.xml` file and converts it into structured `SourceItem` objects categorized by folder.

**Request Body:**
```json
{
  "opmlText": "<?xml version=\"1.0\"?><opml version=\"2.0\">...</opml>"
}
```

---

### `POST /api/test-provider`
The **Test API** button in Settings: one minimal request using the provider, key, base URL and model currently configured, so a wrong credential surfaces there instead of silently falling back to deterministic ranking during a digest. `kind` is `chat` or `embedding`; an embeddings ping also reports the returned vector `dimensions`.

**Request Body:**
```json
{
  "kind": "chat",
  "provider": "openai-compatible",
  "apiKey": "sk-…",
  "baseUrl": "https://api.openai.com/v1",
  "model": "gpt-4o-mini"
}
```

**Response:** `{ "ok": true, "provider": "openai-compatible", "model": "gpt-4o-mini", "latencyMs": 412, "reply": "pong" }`. Failures return `{ "ok": false, "error": "…" }` with `200`, because the route reports a bad key rather than throwing.

---

### `POST /api/provider-models`
The **Load models** action beside the model field in Settings: asks an OpenAI-compatible service for the model names it currently serves (`GET {baseUrl}/models` with the same key), so a retired or mistyped ID — the cause of a provider's “The supported API model names are …” rejection — is a tap instead of a guess. The names are offered as buttons under the field; the field still accepts any ID typed by hand.

**Request Body:**
```json
{
  "provider": "openai-compatible",
  "apiKey": "sk-…",
  "baseUrl": "https://api.deepseek.com/v1"
}
```

**Response:** `{ "ok": true, "provider": "openai-compatible", "models": ["deepseek-flash", "deepseek-v4-pro"], "count": 2 }`, sorted and de-duplicated. A refused key or unreachable provider returns `{ "ok": false, "error": "…" }` with `200`, the error carrying the provider's own words rather than its JSON envelope.

---

### `GET /api/generated-feed`
Synthesizes a live RSS 2.0 XML feed for websites that do not provide native feeds, validated through the outbound security filter.

**Query Parameters:**
- `url`: The target website URL to scrape and convert into RSS (e.g., `https://example.com/blog`).

---

### `GET /api/favicon`
Returns a source's site icon, fetched server-side and cached in memory for seven days. The browser asks this route rather than a favicon provider, so opening the digest makes no third-party requests.

**Query Parameters:**
- `domain`: The feed's hostname (e.g., `marginalrevolution.com`).

---

### `GET /api/health`
Liveness probe used by the client at startup and by container health checks. Returns `{ "ok": true, "service": "curator" }` with `Cache-Control: no-store`.

---

### `GET /api/semantic-status`
Reports whether a server-side Gemini key is configured (`geminiConfigured`) alongside `localEngine: true`. The built-in semantic engine is always available, so this route never gates curation.

---

### `GET /api/usage`
Running token and cost accounting for the AI and outbound traffic the server has made: `today`, `week` and `month` totals plus a 30-day `days` series, with USD (and GBP at `usdPerGbp`), current peak-pricing flag, the rates in use and the retention window. Counters live in server memory and reset on restart, so this is a spend tripwire for an operator, not a billing record.

> Be aware that this route is **not authenticated**: on a public deployment it reveals your AI spend, so gate it at your proxy if that matters.

---

## Getting Started

### Prerequisites
- **Bun**: v1.1 or higher — the committed `bun.lock` is the one authoritative lockfile, and installs are `bun install --frozen-lockfile`
- **Node.js**: v22 — the runtime the Docker image ships (`node:22-slim`); Bun runs the server locally via `tsx`, so no separate build step is needed for development
- *(Optional)* Provider API keys: configure an OpenAI-compatible endpoint, Anthropic, or Gemini in Curator's Settings. A server-side Gemini key is optional for Google Search-grounded discovery and Gemini-provider fallback.

### Installation

1. Clone or download the repository:
   ```bash
   git clone https://github.com/your-username/curator.git
   cd curator
   ```

2. Install dependencies from the committed lockfile:
   ```bash
   bun install --frozen-lockfile
   ```

### Environment Variables

Create a `.env` file in the project root:
```env
# Optional server-side Gemini key for Google Search grounding,
# or when Gemini is selected as the curation/embedding provider.
GEMINI_API_KEY=your_gemini_api_key_here

# Server port (defaults to 3000)
PORT=3000

# Set to 1 when Curator runs behind a reverse proxy you control
# (Cloud Run, Render, Fly, nginx, a load balancer).
TRUST_PROXY=1

# Set to 1 only to let public source discovery spend the server's own
# GEMINI_API_KEY; otherwise it uses a key supplied by the browser.
ALLOW_SERVER_KEY=1
```

> **`TRUST_PROXY` matters on any deployment.** Rate limits are keyed by the requesting address. Unset, that address is the proxy's socket, so every visitor shares a single bucket and one busy client can trigger `429`s for everyone. Set it to `1` behind a trusted proxy — and only then, since `X-Forwarded-For` is client-controlled otherwise, which would let a caller mint a fresh bucket per request.

> **Note**: Other provider keys and OpenAI-compatible base URLs are configured in Curator's Settings and stored in this browser. Without an AI provider, Curator uses deterministic curation.

### Running Locally

Start the full-stack development server (Express with Vite middleware mounted in-process, run through `tsx`):
```bash
bun run dev
```

Open your browser to [http://localhost:3000](http://localhost:3000), or whichever `PORT` you set. TypeScript and TSX need no build step here — `tsx` transpiles on the fly and Vite serves the client.

### Production Deployment

1. Build the production client bundle into `dist/`:
   ```bash
   bun run build
   ```

2. Start the server with `NODE_ENV=production` so it serves `dist/` instead of mounting the Vite dev middleware:
   ```bash
   NODE_ENV=production bun run start
   ```

   `bun run start` executes `tsx server.ts`, the same entry point as development. Without `NODE_ENV=production` you get the development middleware and the built bundle is ignored, so set it in your process environment (the `Dockerfile` already sets it, along with `PORT=8080`).

If you deploy behind a proxy, set `TRUST_PROXY=1` as described in [Environment Variables](#environment-variables) — otherwise the per-client rate limits collapse into one shared bucket.

---

## Available Scripts

| Command | Description |
| :--- | :--- |
| `bun run dev` | Starts the Express server with Vite middleware in development mode (`tsx server.ts`). |
| `bun run build` | Builds the production client assets into `dist/` (`vite build`). |
| `bun run start` | Runs `tsx server.ts`; add `NODE_ENV=production` to serve the built `dist/`. |
| `bun run lint` | Runs the TypeScript compiler check (`tsc --noEmit`) to validate type safety. |
| `bun run preview` | Serves the built bundle with `vite preview` (client only, no API routes). |
| `bun run clean` | Deletes build output (`dist/` and `server.js`). |

---

## Privacy & Local Persistence

Curator is built local-first:
- **No Remote User Accounts**: Subscriptions, reading stats, saved articles, and signal preferences are stored exclusively in your browser's `localStorage`.
- **No Trackers**: No analytics SDKs, advertising pixels, or telemetry services are included. Source icons are fetched by the Curator server (`GET /api/favicon`) and cached there, so your browser never asks a favicon provider about the feeds you read.
- **What still talks to publishers**: article thumbnails load from each publication's own image CDN, and opening "Read original" obviously visits them. That reveals your IP to that publisher — the same exposure as subscribing in any RSS reader — but nothing else about your reading is shared.
- **Your Data Remains Yours**: Export your entire reading library at any time using standard OPML.

---

## License

This project is licensed under the [MIT License](LICENSE).
