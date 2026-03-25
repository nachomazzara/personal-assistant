# Personal Assistant

Skill-based agent orchestrator powered by [pi-coding-agent](https://github.com/mariozechner/pi-coding-agent). Takes a prompt, discovers skills, and spawns parallel pi-agent instances.

## Architecture

```
agent.ts                          entry point
prompts/system.md                 system prompt for all instances
skills/
  {category}/
    config.json                   { maxConcurrent: N }
    {skill}/SKILL.md              instructions + embedded script
```

The orchestrator discovers `skills/{category}/config.json`, extracts `## Script` code blocks from each `SKILL.md` into runnable `.mjs` files, spawns one pi-agent per skill (respecting `maxConcurrent`), and aggregates JSON results to stdout.

## Usage

```bash
npx tsx agent.ts "search flights from Buenos Aires to New York departing October 11 returning October 21"
```

```bash
MODEL=claude-opus-4-6 npx tsx agent.ts "flights EZE to JFK Oct 11-21"
```

## Auth

Set `ANTHROPIC_OAUTH_REFRESH_TOKEN` or place `.auth.json` in the root.

## Skills

### flights (max 4 concurrent)

| Skill | Method | Output |
|-------|--------|--------|
| kayak | Puppeteer + API interception + CSRF pagination | 50 flights |
| google | Puppeteer + GetShoppingResults RPC | ~31 flights |
| skyscanner | Direct fetch to pricecalendar API | 50 prices/date |
| turismocity | Puppeteer + rpull API interception | 50 flights + provider |
| despegar | Link only (anti-bot protection) | URL |

## Adding skills

1. Create `skills/{category}/{skill}/SKILL.md` with frontmatter (`name`, `description`)
2. Add `## Script` with a `` ```javascript `` code block
3. For new categories, add `skills/{category}/config.json`

## Setup

```bash
npm install
```
