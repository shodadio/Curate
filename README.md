# Curator — Morning Reading Editor & Intelligent RSS Digest

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=black)](https://react.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-38bdf8?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Express](https://img.shields.io/badge/Express-4.x-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![Google GenAI SDK](https://img.shields.io/badge/@google/genai-3.3-4285f4?logo=google&logoColor=white)](https://ai.google.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-amber.svg)](LICENSE)

> **Curator** is a calm, finite morning reading editor that turns unmanageable RSS streams, Substacks, and web publications into an elegant, focused daily digest. Designed around editorial intentionality rather than algorithmic dopamine loops, it selects high-signal articles each morning, balances your intellectual diet with serendipitous perspectives, and provides instant fallback safeguards for signal tuning.

---

## Table of Contents

- [Editorial Philosophy](#editorial-philosophy)
- [Key Features](#key-features)
  - [Daily Curated Digest](#1-daily-curated-digest)
  - ["Out of the Bubble" Serendipity](#2-out-of-the-bubble-serendipity)
  - [Signal Tuning with Undo / Redo Safeguards](#3-signal-tuning-with-undo--redo-safeguards)
  - [Live `/cost` Free Tier Quota Inspector & Terminal](#4-live-cost-free-tier-quota-inspector--terminal)
  - [Seamless Deterministic Fallback Engine](#5-seamless-deterministic-fallback-engine)
  - [Google Search RSS Discovery & Feed Synthesis](#6-google-search-rss-discovery--feed-synthesis)
  - [OPML Import & Export](#7-opml-import--export)
  - [Distraction-Free Reader & iOS Web Speech Read Aloud](#8-distraction-free-reader--ios-web-speech-read-aloud)
  - [Mobile & iOS Safari Viewport Hardening](#9-mobile--ios-safari-viewport-hardening)
- [System Architecture](#system-architecture)
- [API Reference](#api-reference)
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

Modern digital reading is broken by infinite feeds, engagement algorithms, and ad-incentivized outrage. Standard RSS readers often make the problem worse by creating an unread counter backlog that induces guilt and fatigue.

**Curator** reintroduces the classic ritual of the **finite morning edition**:
- **Finite editions**: Choose between 3, 5, 8, 12, or 15 high-signal pieces each morning. When you reach the bottom, you're finished for the day.
- **Editorial signal over clickbait**: Evaluates articles based on analytical depth, evergreen value, and original reporting rather than sensationalism.
- **Serendipity by design**: Includes deliberate "Out of the Bubble" selections from history, philosophy, design, and economics to prevent intellectual echo chambers.
- **Forgiving user controls**: Any negative preference signal (such as clicking "Fewer like this") provides an immediate inline undo confirmation and interactive toast fallback, ensuring accidental taps never purge content permanently.

---

## Key Features

### 1. Daily Curated Digest
- **Custom Morning Issue**: Configurable issue size (3, 5, 8, 12, or 15 articles) with estimated reading times and topic badges.
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

### 4. Live `/cost` Free Tier Quota Inspector & Terminal
- **Real-Time Free Tier Telemetry**: Monitors Google Generative Language API limits:
  - **1,500 Requests Per Day (RPD)**.
  - **15 Requests Per Minute (RPM)** rolling window.
  - Live progress bar showing exact percentage remaining (e.g., `99.9% remaining`).
- **Countdown to Daily Reset**: Live countdown timer calculating the exact time remaining until midnight UTC (`00:00:00 UTC`), when Google's daily quota window resets.
- **Settings & Terminal Integration**:
  - Full inspector widget embedded directly inside the **Settings** tab.
  - Interactive `/cost` command terminal modal supporting `/cost`, `/test`, `/reset`, `/stats`, and `/help`.
  - Immediate manual API ping (`/test`) to verify connectivity and refresh quota counters.

### 5. Seamless Deterministic Fallback Engine
- If the Gemini API key is missing, or if prepayment balance is depleted (`$0.00` / HTTP `402 Payment Required`), Curator automatically shifts to a **Deterministic Editorial Signal Engine**.
- The deterministic algorithm scores articles using title heuristics, domain authority rankings, content length metrics, and time-decay curves.
- The user's reading flow is never blocked or broken by API billing errors.

### 6. Google Search RSS Discovery & Feed Synthesis
- **Search Authors & Outlets**: Enter the name of any publication, thinker, or newsletter (e.g., *Stratechery*, *Marginal Revolution*, *Dan Luu*).
- **RSS Availability Check**: Powered by Google Search grounding to detect whether the site provides native RSS/Atom feeds, Substack endpoints, or WordPress feeds.
- **Automatic Feed Synthesis**: For publications without native feeds, Curator generates a clean, parsable XML feed endpoint via `/api/generated-feed`.

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
- **Safe Area Insets**: Uses `viewport-fit=cover` and responsive padding (`px-4 sm:px-6`) to prevent notch clipping or cut-off margins on iPhone viewports.
- **Floating Bottom Dock**: Floating navigation dock centered using `left-1/2 -translate-x-1/2` and clamped to `w-[calc(100%-2rem)] max-w-lg`, preventing horizontal page jitter.

---

## System Architecture

Curator is built as a unified full-stack web application with Vite middlewares running inside an Express backend.

```
┌─────────────────────────────────────────────────────────────────┐
│                       Client (React 19)                         │
│  - Plus Jakarta Sans + Lora + JetBrains Mono                    │
│  - Bottom Dock Navigation (Today, Feeds, Saved, Sources, Settings)│
│  - Signal Tuning with Undo/Redo Fallbacks                       │
│  - Web Speech API Audio Player                                  │
│  - LocalStorage State Manager (Bookmarks, Stats, Signal Weights)│
└────────────────────────────────┬────────────────────────────────┘
                                 │ HTTP / JSON
┌────────────────────────────────▼────────────────────────────────┐
│                   Server (Express + Vite)                       │
│  - server.ts entry point                                        │
│  - Vite dev server middleware mounted in dev                     │
│  - Live Quota & /cost Tracker (1500 RPD, 15 RPM, UTC Countdown) │
├─────────────────────────────────────────────────────────────────┤
│                     Core API Endpoints                          │
│  • /api/cost               • /api/curate                        │
│  • /api/cost/test          • /api/fetch-article                 │
│  • /api/cost/reset         • /api/feed-stream                   │
│  • /api/parse-opml         • /api/discover-sources              │
│  • /api/status             • /api/generated-feed                │
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

### Quota & Cost Endpoints

#### `GET /api/cost`
Returns real-time diagnostics on free tier quota usage, requests remaining, and the UTC reset countdown.
```json
{
  "tier": "Gemini Flash Free Tier (1,500 RPD / 15 RPM)",
  "limitDaily": 1500,
  "usedDaily": 1,
  "remainingDaily": 1499,
  "percentRemaining": 99.9,
  "limitPerMinute": 15,
  "usedThisMinute": 1,
  "remainingThisMinute": 14,
  "resetsAtUtc": "2026-11-15T00:00:00.000Z",
  "resetsInSeconds": 44120,
  "resetsInFormatted": "12h 15m 20s",
  "aiQuotaDepleted": false,
  "costSoFar": "$0.00",
  "currency": "USD",
  "status": "active",
  "engine": "Gemini 2.5 / Flash AI Model"
}
```

#### `POST /api/cost/test`
Sends a minimal probe request to the Gemini API (`gemini-2.5-flash`), tests connection health, and immediately refreshes quota counters.

#### `POST /api/cost/reset`
Resets local session request counters back to zero.

---

### Curation & Content Endpoints

#### `POST /api/curate`
Accepts a list of sources, item count target (3–15), and optional topic preference adjustments. Gathers recent feed entries and returns ranked, summarized digest articles with an "Out of the Bubble" pick.

#### `POST /api/fetch-article`
Fetches a web article URL, extracts readable main text, removes navigation and ad clutter, and returns clean HTML content for the reader view.

#### `POST /api/feed-stream`
Retrieves raw, chronological feed entries for a specific source ID or across all subscribed sources for the traditional "Feeds" stream.

#### `POST /api/discover-sources`
Performs a grounded search using Google Search to discover publications, assess RSS availability, and extract sample headlines.

#### `POST /api/parse-opml`
Parses an uploaded `.opml` or `.xml` file and converts it into structured `SourceItem` objects categorized by folder.

#### `GET /api/generated-feed`
Synthesizes a live RSS 2.0 XML feed for websites that do not provide native feeds.

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

> **Note**: If `GEMINI_API_KEY` is not provided or runs out of quota, Curator automatically operates on its Deterministic Editorial Engine with zero configuration required.

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
