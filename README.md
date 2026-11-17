# Curator — Morning Reading Editor & Intelligent RSS Digest

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=black)](https://react.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-38bdf8?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Express](https://img.shields.io/badge/Express-4.x-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![Google GenAI SDK](https://img.shields.io/badge/@google/genai-3.3-4285f4?logo=google&logoColor=white)](https://ai.google.dev/)
[![PWA Ready](https://img.shields.io/badge/PWA-Ready-5A0FC8?logo=pwa&logoColor=white)](https://web.dev/progressive-web-apps/)
[![License: MIT](https://img.shields.io/badge/License-MIT-amber.svg)](LICENSE)

> **Curator** is a calm, finite morning reading editor that turns unmanageable RSS streams, Substacks, and web publications into an elegant, focused daily digest. Designed around editorial intentionality rather than algorithmic engagement loops, it selects high-signal articles each morning, balances your intellectual diet with serendipitous perspectives, and provides instant fallback safeguards for signal tuning.

---

## Table of Contents

- [Editorial Philosophy](#editorial-philosophy)
- [Key Features](#key-features)
  - [1. Daily Curated Digest](#1-daily-curated-digest)
  - [2. Deliberate Stretch ("Out of the Bubble" picks)](#2-deliberate-stretch-out-of-the-bubble-picks)
  - [3. Signal Tuning with Undo Safeguards](#3-signal-tuning-with-undo-safeguards)
  - [4. Google Search RSS Discovery & Feed Synthesis](#4-google-search-rss-discovery--feed-synthesis)
  - [5. Outbound SSRF Hardening & Network Security](#5-outbound-ssrf-hardening--network-security)
  - [6. High-Signal Deterministic Fallback Engine](#6-high-signal-deterministic-fallback-engine)
  - [7. OPML Import & Export](#7-opml-import--export)
  - [8. Distraction-Free Reader & Onboard Read Aloud](#8-distraction-free-reader--onboard-read-aloud)
  - [9. Mobile & iOS Safari Viewport Hardening](#9-mobile--ios-safari-viewport-hardening)
  - [10. Progressive Web App (PWA) Support](#10-progressive-web-app-pwa-support)
- [System Architecture](#system-architecture)
- [API Reference](#api-reference)
  - [`POST /api/curate`](#post-apicurate)
  - [`POST /api/feed-stream`](#post-apifeed-stream)
  - [`POST /api/discover-sources`](#post-apidiscover-sources)
  - [`POST /api/parse-opml`](#post-apiparse-opml)
  - [`GET /api/generated-feed`](#get-apigenerated-feed)
  - [`GET /api/favicon`](#get-apifavicon)
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

### `POST /api/feed-stream`
Retrieves chronological feed entries for a specific source ID or across all subscribed sources for the traditional "Feeds" stream.

**Request Body:**
```json
{
  "sourceTitle": "Nicole Williams"
}
```

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

## Getting Started

### Prerequisites
- **Node.js**: v18.0.0 or higher
- **Bun**: v1.1 or higher — the committed `bun.lock` is the one authoritative lockfile
- **npm**: v9.0.0 or higher *(optional; `npm install` works, but there is no committed npm lockfile)*
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
```

> **Note**: Other provider keys and OpenAI-compatible base URLs are configured in Curator's Settings and stored in this browser. Without an AI provider, Curator uses deterministic curation.

### Running Locally

Start the full-stack development server:
```bash
npm run dev
```

Open your browser to [http://localhost:3000](http://localhost:3000).

### Production Deployment

1. Build the production client bundle:
   ```bash
   npm run build
   ```

2. Start the production server:
   ```bash
   npm start
   ```

---

## Available Scripts

Every script below also runs with `bun run <script>`; the table uses `npm run` for brevity.

| Command | Description |
| :--- | :--- |
| `npm run dev` | Starts the Express server with Vite middleware in development mode (`tsx server.ts`). |
| `npm run build` | Compiles TypeScript and builds the production client assets into `dist/`. |
| `npm run start` | Runs the server in production mode (`node server.ts`). |
| `npm run lint` | Runs the TypeScript compiler check (`tsc --noEmit`) to validate type safety. |
| `npm run clean` | Deletes build output (`dist/` and `server.js`). |

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
