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

const TIMEOUT = 60_000;
const PROFILE_DIR = "/tmp/x-twitter-profile";
const USER = process.env.TWITTER_USER;
const PASS = process.env.TWITTER_PASS;

function emit(data) {
  console.log(JSON.stringify(data));
}

if (!USER || !PASS) {
  emit({ site: "X/Twitter", url: "https://x.com", trends: [], error: "TWITTER_USER and TWITTER_PASS not set", partial: false });
  process.exit(0);
}

let browser;
try {
  browser = await puppeteerExtra.launch({
    headless: false,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--window-size=1500,900",
      `--user-data-dir=${PROFILE_DIR}`,
    ],
  });

  // Helper: get a working page, creating new one if needed
  async function getPage() {
    const allPages = await browser.pages();
    return allPages[allPages.length - 1] || await browser.newPage();
  }

  let page = await getPage();
  await page.setViewport({ width: 1500, height: 900 });

  // Minimize browser immediately via CDP
  try {
    const cdp = await page.createCDPSession();
    const { windowId } = await cdp.send("Browser.getWindowForTarget");
    await cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "minimized" } });
  } catch {}

  // Step 1: Check if already logged in (persistent profile may have session)
  console.error("[twitter] 🔐 Checking auth status...");
  await page.goto("https://x.com/home", { waitUntil: "domcontentloaded", timeout: TIMEOUT });
  await new Promise(r => setTimeout(r, 3000));

  let currentUrl = page.url();
  const isLoggedIn = !currentUrl.includes("/login") && !currentUrl.includes("/i/flow");
  console.error(`[twitter] Current page: ${currentUrl} (logged in: ${isLoggedIn})`);

  // Step 2: Login only if needed
  if (!isLoggedIn) {
    console.error("[twitter] → Need to log in...");
    let emailAttempts = 0;
    let passwordFound = false;

    while (emailAttempts < 3 && !passwordFound) {
      try {
        console.error(`[twitter] → Entering email (attempt ${emailAttempts + 1})...`);
        const inputs = await page.$$('input');
        if (inputs.length === 0) { break; }
        const emailInput = inputs[0];
        await emailInput.click({ clickCount: 3 });
        await new Promise(r => setTimeout(r, 200));
        await emailInput.type(USER, { delay: 30 });
        await new Promise(r => setTimeout(r, 800));

        const buttons = await page.$$('button');
        for (const btn of buttons) {
          const text = await btn.evaluate(el => el.textContent?.trim());
          if (text === 'Next') {
            await btn.click();
            await new Promise(r => setTimeout(r, 2500));
            break;
          }
        }

        const hasPass = await page.$('input[type="password"]');
        if (hasPass) { passwordFound = true; break; }
        emailAttempts++;
      } catch (e) {
        console.error(`[twitter] Email attempt error: ${e.message}`);
        emailAttempts++;
      }
    }

    // Fill password
    try {
      await page.waitForSelector('input[type="password"]', { timeout: 10000 }).catch(() => {});
      const passwordInput = await page.$('input[type="password"]');
      if (passwordInput) {
        console.error("[twitter] → Filling password...");
        await passwordInput.click({ clickCount: 3 });
        await new Promise(r => setTimeout(r, 200));
        await passwordInput.type(PASS, { delay: 30 });
        await new Promise(r => setTimeout(r, 1000));

        const buttons = await page.$$('button');
        for (const btn of buttons) {
          const text = await btn.evaluate(el => el.textContent?.toLowerCase() || "");
          if (text.includes('log in')) { await btn.click(); break; }
        }
        await new Promise(r => setTimeout(r, 5000));
      }
    } catch (e) {
      console.error(`[twitter] Password step error: ${e.message}`);
    }
  }

  // Step 3: Open a FRESH page for trending to avoid detached frame issues
  // The login flow may have corrupted the original page's frame
  console.error("[twitter] 🌐 Opening fresh page for trending...");
  const trendPage = await browser.newPage();
  await trendPage.setViewport({ width: 1500, height: 900 });

  await trendPage.goto("https://x.com/explore/tabs/trending", { waitUntil: "domcontentloaded", timeout: TIMEOUT });
  await new Promise(r => setTimeout(r, 4000));

  console.error("[twitter] ⏳ Waiting for trends to load...");

  try {
    await trendPage.waitForSelector('[data-testid="trend"]', { timeout: 20000 }).catch(() => null);
  } catch {}

  console.error("[twitter] 📜 Scrolling to load content...");
  for (let i = 0; i < 5; i++) {
    await trendPage.evaluate(() => window.scrollBy(0, 600));
    await new Promise(r => setTimeout(r, 1200));
  }

  // Extract actual trends from DOM
  console.error("[twitter] 🔍 Scraping trends...");
  const trends = [];
  const trendData = await trendPage.evaluate(() => {
    const items = [];

    const trendElements = document.querySelectorAll('[data-testid="trend"]');
    const debug = { trendElementsFound: trendElements.length };

    // Parse trend elements - handle both ranked and unranked formats
    trendElements.forEach((el) => {
      const text = el.innerText || "";
      const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);

      if (lines.length < 1) return;

      let name = "";
      let posts = "";

      // Check if this is a ranked trend (starts with number · ...)
      if (lines.length >= 3 && lines[0].match(/^\d+$/) && lines[1] === "·") {
        // Skip the ranking and separator, get the trend name (usually after category)
        // Format: "1\n·\nTrending in Argentina\n#TrendName" or "2\n·\nMusic · Trending\n#MusicTrend"
        let foundName = false;
        for (let i = 2; i < lines.length; i++) {
          const line = lines[i];
          // Skip category/location lines, grab first other non-empty line
          if (!line.match(/^(Trending in|Only on|Music|Entertainment|Sports|Politics|Business|News)/i) && line.length > 1) {
            name = line;
            foundName = true;
            break;
          }
        }
      } else if (lines[0].match(/^\d{1,2}$/)) {
        // Skip if ONLY a number with no separator (malformed)
        return;
      } else {
        name = lines[0];
      }

      posts = lines.find(l => l.match(/\d+[KMB]?\s*(posts?|discussions?)/i)) || "";

      if (name && name.length >= 1 && name.length < 300 &&
          !name.match(/^(Trending|What's happening|Home|Messages|Bookmarks)\s/i)) {
        items.push({ name, posts });
      }
    });

    return { items, debug };
  });

  console.error(`[twitter] Found ${trendData.debug.trendElementsFound} trend elements, extracted: ${trendData.items.length}`);

  for (const item of trendData.items) {
    if (item.name && !trends.some(t => t.title === item.name)) {
      trends.push({
        title: item.name,
        description: "",
        source: "X/Twitter",
        url: `https://x.com/search?q=${encodeURIComponent(item.name)}`,
        volume: 0,
        volumeLabel: item.posts || "",
        category: "Trending",
        timestamp: new Date().toISOString(),
      });
    }
  }

  console.error(`[twitter] ✅ Extracted ${trends.length} trends`);

  emit({
    site: "X/Twitter",
    url: "https://x.com/explore/tabs/trending",
    trends: trends.slice(0, 25),
    partial: false,
  });

  await new Promise(r => setTimeout(r, 2000));
  await browser.close();
} catch (err) {
  console.error(`[twitter] ❌ Error: ${err.message}`);
  emit({
    site: "X/Twitter",
    url: "https://x.com",
    trends: [],
    error: err.message,
    partial: false,
  });
  if (browser) await browser.close().catch(() => {});
}
```
