---
name: twitter
description: Fetch trending topics and posts from X/Twitter by scraping with auto-login
---

# Command

```bash
node skills/trends/twitter/search.mjs [--query "topic"] [--region US]
```

# Output format

JSON to stdout: `{ "site": "X/Twitter", "url": "...", "trends": [...], "partial": false }`

# Rules

- Run the command directly
- Requires TWITTER_USER and TWITTER_PASS environment variables
- Uses persistent browser profile to cache login session
- Your response must be ONLY the raw JSON — no text before or after

## Script

```javascript
#!/usr/bin/env node

import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
puppeteerExtra.use(StealthPlugin());

const args = process.argv.slice(2);
function getArg(name) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : null;
}

const query = getArg("query");
const TIMEOUT = 40_000;
const PROFILE_DIR = "/tmp/x-twitter-profile";
const USER = process.env.TWITTER_USER;
const PASS = process.env.TWITTER_PASS;

function emit(data) {
  console.log(JSON.stringify(data));
}

if (!USER || !PASS) {
  emit({ site: "X/Twitter", url: "https://x.com", trends: [], error: "TWITTER_USER and TWITTER_PASS not set in .env", partial: false });
  process.exit(0);
}

function formatMetric(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}

let browser;
try {
  browser = await puppeteerExtra.launch({
    headless: false,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--window-size=1366,768",
      "--start-minimized",
      `--user-data-dir=${PROFILE_DIR}`,
    ],
  });

  // Minimize immediately via CDP
  const pages = await browser.pages();
  const page = pages[0] || await browser.newPage();
  const cdp = await page.createCDPSession();
  try {
    const { windowId } = await cdp.send("Browser.getWindowForTarget");
    await cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "minimized" } });
  } catch {
    try { await cdp.send("Browser.setWindowBounds", { windowId: 1, bounds: { windowState: "minimized" } }); } catch {}
  }

  // Close any extra blank tabs
  for (const p of pages.slice(1)) { try { await p.close(); } catch {} }

  await page.setViewport({ width: 1366, height: 768 });

  // ---------- Login if needed ----------
  async function ensureLoggedIn() {
    await page.goto("https://x.com/home", { waitUntil: "domcontentloaded", timeout: TIMEOUT });
    await new Promise((r) => setTimeout(r, 4000));

    const url = page.url();
    if (!url.includes("/login") && !url.includes("/i/flow/login")) {
      return; // already logged in via cached session
    }

    console.error("[twitter] Session expired, logging in...");

    // Go to the login page directly for a clean state
    await page.goto("https://x.com/i/flow/login", { waitUntil: "networkidle2", timeout: TIMEOUT });
    await new Promise((r) => setTimeout(r, 4000));

    // Wait for username input
    await page.waitForSelector('input[autocomplete="username"]', { timeout: 15000 });
    await page.type('input[autocomplete="username"]', USER, { delay: 50 });

    // Click "Next"
    const buttons = await page.$$('button[role="button"]');
    for (const btn of buttons) {
      const text = await btn.evaluate((b) => b.textContent || "");
      if (text.toLowerCase().includes("next")) {
        await btn.click();
        break;
      }
    }
    await new Promise((r) => setTimeout(r, 2000));

    // Check for unusual activity / phone/email verification step
    const verifyInput = await page.$('input[data-testid="ocfEnterTextTextInput"]');
    if (verifyInput) {
      // X is asking for email or phone verification — type the username/email
      console.error("[twitter] Verification step detected, entering username...");
      await verifyInput.type(USER, { delay: 50 });
      const verifyBtns = await page.$$('button[data-testid="ocfEnterTextNextButton"]');
      if (verifyBtns.length > 0) await verifyBtns[0].click();
      await new Promise((r) => setTimeout(r, 2000));
    }

    // Wait for password input
    await page.waitForSelector('input[type="password"]', { timeout: 10000 });
    await page.type('input[type="password"]', PASS, { delay: 50 });

    // Click "Log in"
    const loginBtn = await page.$('button[data-testid="LoginForm_Login_Button"]');
    if (loginBtn) {
      await loginBtn.click();
    } else {
      const allBtns = await page.$$('button[role="button"]');
      for (const btn of allBtns) {
        const text = await btn.evaluate((b) => b.textContent || "");
        if (text.toLowerCase().includes("log in")) {
          await btn.click();
          break;
        }
      }
    }

    // Wait for navigation to home
    await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 3000));

    if (page.url().includes("/home")) {
      console.error("[twitter] Login successful");
    } else {
      console.error("[twitter] Login may have failed, current URL:", page.url());
    }
  }

  await ensureLoggedIn();

  const trends = [];
  const apiData = [];

  // Intercept API responses
  page.on("response", async (res) => {
    try {
      const url = res.url();
      if (
        url.includes("/SearchTimeline") ||
        url.includes("/GenericTimelineById") ||
        url.includes("guide.json") ||
        url.includes("/Explore")
      ) {
        apiData.push(await res.text());
      }
    } catch {}
  });

  if (query) {
    // ---------- Search mode ----------
    const searchUrl = `https://x.com/search?q=${encodeURIComponent(query)}&src=typed_query&f=top`;
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: TIMEOUT });
    await new Promise((r) => setTimeout(r, 5000));

    // Parse API responses
    for (const raw of apiData) {
      try {
        const data = JSON.parse(raw);
        const instructions = data?.data?.search_by_raw_query?.search_timeline?.timeline?.instructions || [];
        for (const inst of instructions) {
          for (const entry of inst.entries || []) {
            const tweet = entry?.content?.itemContent?.tweet_results?.result;
            if (!tweet) continue;
            const legacy = tweet.legacy || tweet.tweet?.legacy;
            if (!legacy?.full_text) continue;
            const userResult = tweet.core?.user_results?.result || tweet.tweet?.core?.user_results?.result || {};
            const user = userResult.legacy || userResult;
            trends.push({
              title: legacy.full_text.slice(0, 200),
              description: "",
              source: "X/Twitter",
              url: `https://x.com/${user?.screen_name || "i"}/status/${legacy.id_str || ""}`,
              volume: (legacy.favorite_count || 0) + (legacy.retweet_count || 0),
              volumeLabel: `${formatMetric(legacy.favorite_count || 0)} likes, ${formatMetric(legacy.retweet_count || 0)} RTs`,
              category: user?.screen_name ? `@${user.screen_name}` : "",
              timestamp: legacy.created_at ? new Date(legacy.created_at).toISOString() : "",
            });
          }
        }
      } catch {}
    }

    // DOM fallback
    if (trends.length === 0) {
      const tweetEls = await page.$$('[data-testid="tweet"]');
      for (const el of tweetEls.slice(0, 25)) {
        try {
          const text = await el.$eval('[data-testid="tweetText"]', (e) => e.textContent || "").catch(() => "");
          if (!text) continue;
          const link = await el.$eval('a[href*="/status/"]', (e) => e.href).catch(() => "");
          trends.push({
            title: text.slice(0, 200),
            description: "",
            source: "X/Twitter",
            url: link || searchUrl,
            volume: 0,
            volumeLabel: "",
            category: "",
            timestamp: new Date().toISOString(),
          });
        } catch {}
      }
    }

    emit({ site: "X/Twitter", url: searchUrl, trends: trends.slice(0, 25), partial: false });
  } else {
    // ---------- Global trending ----------
    await page.goto("https://x.com/explore/tabs/trending", { waitUntil: "domcontentloaded", timeout: TIMEOUT });
    await new Promise((r) => setTimeout(r, 5000));

    // Scroll to load
    await page.evaluate(() => window.scrollBy(0, 1000));
    await new Promise((r) => setTimeout(r, 2000));

    // DOM: trending topic cells
    const trendEls = await page.$$('[data-testid="trend"]');
    for (const el of trendEls) {
      try {
        const lines = await el.evaluate((e) => {
          const spans = Array.from(e.querySelectorAll("span"));
          return spans.map((s) => s.textContent || "").filter(Boolean);
        });
        // Filter out tiny/separator spans
        const meaningful = lines.filter((l) => l.length > 1 && l !== "·" && l !== "…");
        const postsLine = meaningful.find((l) => /\d+[.\d]*[KkMm]?\s*(posts|tweets|publicaciones)/i.test(l));
        const catLine = meaningful.find((l) => /trending|entertainment|sports|gaming|music|politics|business|tecnología|deportes/i.test(l));
        const topicLine = meaningful.find((l) => l !== postsLine && l !== catLine && !l.match(/^\d+\s*·/) && l.length > 1);
        if (!topicLine) continue;

        let vol = 0;
        if (postsLine) {
          const num = parseFloat(postsLine.replace(/[^0-9.]/g, "")) || 0;
          if (postsLine.toLowerCase().includes("m")) vol = num * 1_000_000;
          else if (postsLine.toLowerCase().includes("k")) vol = num * 1_000;
          else vol = num;
        }

        trends.push({
          title: topicLine,
          description: "",
          source: "X/Twitter",
          url: `https://x.com/search?q=${encodeURIComponent(topicLine)}`,
          volume: vol,
          volumeLabel: postsLine || "",
          category: catLine || "Trending",
          timestamp: new Date().toISOString(),
        });
      } catch {}
    }

    // Also try API data
    for (const raw of apiData) {
      try {
        const data = JSON.parse(raw);
        const items = data?.timeline?.instructions?.[0]?.addEntries?.entries || [];
        for (const entry of items) {
          const trend = entry?.content?.timelineModule?.items?.[0]?.item?.content?.trend;
          if (!trend?.name) continue;
          if (trends.some((t) => t.title === trend.name)) continue;
          trends.push({
            title: trend.name,
            description: trend.description || "",
            source: "X/Twitter",
            url: trend.url?.url || `https://x.com/search?q=${encodeURIComponent(trend.name)}`,
            volume: trend.trendMetadata?.tweetCount || 0,
            volumeLabel: trend.trendMetadata?.metaDescription || "",
            category: "Trending",
            timestamp: new Date().toISOString(),
          });
        }
      } catch {}
    }

    emit({ site: "X/Twitter", url: "https://x.com/explore/tabs/trending", trends: trends.slice(0, 25), partial: false });
  }

  await browser.close();
} catch (err) {
  emit({ site: "X/Twitter", url: "https://x.com/explore", trends: [], error: err.message, partial: false });
  if (browser) await browser.close().catch(() => {});
}
```
