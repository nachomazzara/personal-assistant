# Personal Assistant

Skill-based agent orchestrator with a web UI. Takes a natural-language prompt, routes it to the right skill category via LLM, and spawns parallel scripts to fetch results from multiple providers.

## Architecture

```
server.ts                         HTTP + WebSocket server
router.ts                         LLM-powered prompt → category routing (Claude Haiku)
orchestrator.ts                   Discovers skills, extracts scripts, runs in parallel
web/
  index.html                      Home screen with category cards
  app.ts                          Frontend: WebSocket client, renderers, filters
  renderers/
    flights.ts                    Flight card renderer + flex dates
    trends.ts                     Trend card renderer + grouped view
    default.ts                    Fallback JSON renderer
skills/
  {category}/
    config.json                   { maxConcurrent, args, requiredFields, routerHints, renderer }
    {provider}/SKILL.md           Instructions + embedded script (## Script block)
```

The orchestrator discovers `skills/{category}/config.json`, extracts `## Script` code blocks from each `SKILL.md` into runnable `.mjs` files, spawns one Node process per skill (respecting `maxConcurrent`), and streams JSON results via WebSocket.

## Quick Start

```bash
npm install
npm run dev
```

Open `http://localhost:3000` — pick a category (Flights or Trends), type a prompt or click an example.

## Auth

Set `ANTHROPIC_OAUTH_REFRESH_TOKEN` or place `.auth.json` in the root.

### Optional API keys

| Variable | Required for | How to get |
|----------|-------------|------------|
| `YOUTUBE_API_KEY` | YouTube trends | [Google Cloud Console](https://console.cloud.google.com) → Enable YouTube Data API v3 → Create API Key. Free 10K units/day |
| `TWITTER_USER` | X/Twitter trends | Your X/Twitter username or email |
| `TWITTER_PASS` | X/Twitter trends | Your X/Twitter password |
| `TIKTOK_USER` | TikTok video dates/engagement | Your TikTok email or username |
| `TIKTOK_PASS` | TikTok video dates/engagement | Your TikTok password |

## Skills

### flights (max 5 concurrent)

| Provider | Method | Notes |
|----------|--------|-------|
| google | Puppeteer + GetShoppingResults RPC interception | Global aggregator |
| skyscanner | rebrowser-puppeteer + PerimeterX bypass | Global aggregator |
| kayak | Puppeteer + API interception + CSRF pagination | Global aggregator |
| turismocity | Puppeteer + rpull API interception | Argentine aggregator |
| aerolineas | Puppeteer + Bearer JWT + flex dates API | Aerolineas Argentinas |
| kiwi | Direct API fetch | Aggregator |
| latam | Puppeteer + API interception | LATAM Airlines |
| emirates | Puppeteer + API interception | Emirates |
| turkish | Puppeteer + form fill + API interception | Turkish Airlines |

### trends (max 8 concurrent)

| Provider | Method | Auth needed |
|----------|--------|-------------|
| google-trends | Google Trends RSS feed | None |
| reddit | Reddit public JSON API | None |
| hackernews | Official HN API + Algolia search | None |
| bluesky | AT Protocol public API | None |
| mastodon | Mastodon public REST API (mastodon.social) | None |
| youtube | YouTube Data API v3 | `YOUTUBE_API_KEY` |
| twitter | Puppeteer stealth + auto-login + API interception | `TWITTER_USER` + `TWITTER_PASS` |
| tiktok | Public API + Puppeteer stealth with auto-login | `TIKTOK_USER` + `TIKTOK_PASS` (optional, needed for video dates) |

**Trends supports two modes:**
- **Global**: omit `query` to get what's trending right now across all platforms
- **Query-based**: provide a topic (e.g., "AI trends", "teenager trends") to search each platform

## Adding Skills

### New provider in existing category

1. Create `skills/{category}/{provider}/SKILL.md` with frontmatter:
   ```yaml
   ---
   name: provider-name
   description: What this provider does
   ---
   ```
2. Add a `## Script` section with a ` ```javascript ` code block
3. Script must output JSON to stdout: `{ "site": "Name", "url": "...", "{items_key}": [...], "partial": false }`
4. Args are passed as CLI flags: `--from EZE --to JFK --departure 2026-04-15`

### New category

1. Create `skills/{category}/config.json` with:
   - `maxConcurrent`: parallel limit
   - `description`: what this category does
   - `args`: JSON schema for arguments
   - `requiredFields`: which output fields to validate
   - `routerHints`: guidance for the LLM router
   - `renderer`: which frontend renderer to use (or falls back to `default`)
   - `items`: key name for the results array
2. Create provider directories with `SKILL.md` files
3. Optionally create `web/renderers/{category}.ts` and register in `web/app.ts`
4. The router and orchestrator auto-discover new categories

## CLI Usage

```bash
# Run via CLI (no web UI)
npx tsx agent.ts "flights from Buenos Aires to New York next month"

# With model override
MODEL=claude-opus-4-6 npx tsx agent.ts "what's trending right now"
```

## Setup

```bash
npm install
npm run dev          # Dev mode with hot reload
npm run build:web    # Build frontend only
npm start            # Production mode
```
