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
  - [2. "Out of the Bubble" Serendipity](#2-out-of-the-bubble-serendipity)
  - [3. Signal Tuning with Undo / Redo Safeguards](#3-signal-tuning-with-undo--redo-safeguards)
  - [4. Google Search RSS Discovery & Feed Synthesis](#4-google-search-rss-discovery--feed-synthesis)
  - [5. Outbound SSRF Hardening & Network Security](#5-outbound-ssrf-hardening--network-security)
  - [6. High-Signal Deterministic Fallback Engine](#6-high-signal-deterministic-fallback-engine)
  - [7. OPML Import & Export](#7-opml-import--export)
  - [8. Distraction-Free Reader & iOS Web Speech Read Aloud](#8-distraction-free-reader--ios-web-speech-read-aloud)
  - [9. Mobile & iOS Safari Viewport Hardening](#9-mobile--ios-safari-viewport-hardening)
  - [10. Progressive Web App (PWA) Support](#10-progressive-web-app-pwa-support)
- [System Architecture](#system-architecture)
- [API Reference](#api-reference)
  - [`POST /api/curate`](#post-apicurate)
  - [`POST /api/feed-stream`](#post-apifeed-stream)
  - [`POST /api/discover-sources`](#post-apidiscover-sources)
  - [`POST /api/parse-opml`](#post-apiparse-opml)
  - [`GET /api/generated-feed`](#get-apigenerated-feed)
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
- **Serendipity by design**: Includes deliberate "Out of the Bubble" selections from history, philosophy, design, and economics to prevent intellectual echo chambers.
- **Forgiving user controls**: Any negative preference signal (such as clicking "Fewer like this") provides an immediate inline undo confirmation and interactive toast fallback, ensuring accidental taps never purge content permanently.

---

## Key Features

### 1. Daily Curated Digest
- **Configurable Morning Issue**: Select your target reading load (3, 5, 8, 12, or 15 articles) with estimated reading times and categorized tags.
- **Dynamic Summaries**: Automatically generates concise, informative executive summaries and reading notes.
- **Editorial Ranking**: Scores articles on analytical density, source reputation, topic diversity, and personal reading history.

### 2. "Out of the Bubble" Serendipity
- Deliberately identifies and highlights articles outside your standard reading habits.
- Pulls from foundational domains such as long-term thinking, political philosophy, urbanism, and deep history to challenge assumptions and spark creative cross-pollination.

### 3. Signal Tuning with Undo / Redo Safeguards
- **More Like This**: Boosts weights for related topics and source categories.
- **Fewer Like This**: Deprioritizes recurring themes without abrupt card deletion.
- **Undo / Redo Fallback**:
  - When clicking "Fewer", the card morphs into an inline placeholder with `[ ⟲ Undo / Redo ]` and a dismiss option.
  - An interactive toast notification persists for 7 seconds with a direct one-click `Undo / Redo` action.
  - Inside the reader modal, clicking "Fewer" preserves your place and displays a reversible `✓ Fewer like this (Undo)` state without closing the article.

### 4. Google Search RSS Discovery & Feed Synthesis
- **Search Authors & Outlets**: Enter the name of any publication, thinker, or newsletter (e.g., *Stratechery*, *Marginal Revolution*, *Dan Luu*).
- **RSS Availability Check**: Powered by Google Search grounding to detect whether the site provides native RSS/Atom feeds, Substack endpoints, or WordPress feeds.
- **Automatic Feed Synthesis**: For publications without native feeds, Curator extracts article links and generates a clean, parsable RSS 2.0 XML endpoint via `/api/generated-feed`.

### 5. Outbound SSRF Hardening & Network Security
- **DNS Lookup Guard (`guardedLookup`)**: Verifies all resolved IP addresses at connect time to prevent DNS rebinding attacks.
- **Private Address Blocking**: Rejects connections to loopback (`127.0.0.0/8`, `::1`), private ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `fc00::/7`), CGNAT (`100.64.0.0/10`), link-local/cloud metadata (`169.254.0.0/16`, `fe80::/10`, `metadata.google.internal`), and multicast addresses.
- **Safe Redirect Resolution**: Limits redirect hops to 4 with re-validation on every hop.
- **Payload Size Cap**: Enforces a strict 2MB maximum page download limit (`MAX_PAGE_BYTES`) to prevent denial-of-service memory exhaustion.

### 6. High-Signal Deterministic Fallback Engine
- If the Gemini API key is not present or an AI service error occurs, Curator automatically and seamlessly falls back to its built-in **Deterministic Editorial Signal Engine**.
- The deterministic algorithm scores articles using title heuristics, domain authority rankings, content length metrics, and time-decay curves.
- The user's reading flow is never blocked or interrupted by network or API availability issues.

### 7. OPML Import & Export
- **One-Click Migration**: Import existing subscriptions from Feedly, Inoreader, NetNewsWire, Readwise Reader, Reeder, or NewsBlur.
- **Folder Preservation**: Preserves nested categories, folders, and custom tags.
- **Export Anytime**: Download a clean, standardized `.opml` XML file containing your complete watch list.

### 8. Distraction-Free Reader & iOS Web Speech Read Aloud
- **Typographic Discipline**: Clean reading interface using *Lora* (serif body), *Plus Jakarta Sans* (interface), and *JetBrains Mono* (metadata).
- **Native Web Speech Read Aloud**:
  - Integrated text-to-speech audio player powered by the browser's native `window.speechSynthesis`.
  - Fully compatible with iOS Safari and modern mobile browsers.
  - Play, pause, resume, and stop controls with progress tracking.
- **Scroll Depth Tracker**: Automatically tracks reading progress and marks articles as finished once the user scrolls past 85% depth.

### 9. Mobile & iOS Safari Viewport Hardening
- **Zero Horizontal Bleed**: `overflow-x: hidden`, `width: 100%`, and `background-color: #020617` enforced across `html`, `body`, `#root`, and layout wrappers.
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
│  - Plus Jakarta Sans + Lora + JetBrains Mono                    │
│  - Top Header Navigation with Refresh & Settings Controls       │
│  - Bottom Dock Navigation (Today, Feeds, Saved, Sources)        │
│  - Signal Tuning with Undo/Redo Fallbacks                       │
│  - Web Speech API Audio Player                                  │
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
│        Google GenAI SDK        │   Deterministic Signal Engine  │
│      (gemini-2.5-flash)        │      (Automatic Fallback)      │
│  - Deep article curation       │  - Analytical density scoring  │
│  - Executive summaries         │  - Anti-clickbait heuristics   │
│  - "Out of Bubble" serendipity │  - Domain authority ranking    │
└────────────────────────────────┴────────────────────────────────┘
```

---

## API Reference

### `POST /api/curate`
Accepts a list of sources, item count target (3–15), and optional topic preference adjustments. Gathers recent feed entries and returns ranked, summarized digest articles with an "Out of the Bubble" pick.

**Request Body:**
```json
{
  "sources": [
    { "id": "src_0", "title": "Nicole Williams", "feedUrl": "https://pmresearcher.substack.com/feed", "folder": "Strategy & Craft" }
  ],
  "signals": { "more": ["Technology"], "less": ["Crypto"] },
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

## Getting Started

### Prerequisites
- **Node.js**: v18.0.0 or higher
- **npm**: v9.0.0 or higher
- *(Optional)* **Gemini API Key**: A free API key from [Google AI Studio](https://aistudio.google.com/). If omitted, Curator automatically runs using the built-in Deterministic Editorial Engine.

### Installation

1. Clone or download the repository:
   ```bash
   git clone https://github.com/your-username/curator.git
   cd curator
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

### Environment Variables

Create a `.env` file in the project root:
```env
# Optional: Google AI Studio Gemini API Key for AI curation & summaries
GEMINI_API_KEY=your_gemini_api_key_here

# Server port (defaults to 3000)
PORT=3000
```

> **Note**: If `GEMINI_API_KEY` is not provided, Curator automatically operates on its Deterministic Editorial Engine with zero configuration required.

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
- **Zero Third-Party Trackers**: No analytics SDKs, advertising pixels, or telemetry services are included.
- **Your Data Remains Yours**: Export your entire reading library at any time using standard OPML.

---

## License

This project is licensed under the [MIT License](LICENSE).
