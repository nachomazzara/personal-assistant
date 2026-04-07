---
name: tiktok
description: Fetch trending hashtags from TikTok with post counts, view counts, and recent activity
---

# Command

```bash
node skills/trends/tiktok/search.mjs [--query "topic"] [--region US]
```

# Output format

JSON to stdout: `{ "site": "TikTok", "url": "...", "trends": [...], "partial": false }`

# Rules

- Run the command directly
- Requires TIKTOK_USER and TIKTOK_PASS in .env for full video data (dates, engagement)
- Falls back to public API (hashtag stats only) without credentials
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
const region = getArg("region") || "US";
const TT_USER = process.env.TIKTOK_USER;
const TT_PASS = process.env.TIKTOK_PASS;
const PROFILE_DIR = "/tmp/tiktok-profile";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
};

function emit(data) { console.log(JSON.stringify(data)); }

function formatCount(n) {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}

function parseHumanCount(s) {
  if (!s) return 0;
  const num = parseFloat(s.replace(/[^0-9.]/g, "")) || 0;
  const lower = s.toLowerCase();
  if (lower.includes("b")) return num * 1_000_000_000;
  if (lower.includes("m")) return num * 1_000_000;
  if (lower.includes("k")) return num * 1_000;
  return num;
}

async function fetchJSON(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function getHashtagStats(name) {
  try {
    const data = await fetchJSON(
      `https://www.tiktok.com/api/challenge/detail/?challengeName=${encodeURIComponent(name)}`
    );
    const info = data.challengeInfo || {};
    const statsV2 = info.statsV2 || {};
    const stats = info.stats || {};
    return {
      views: parseInt(statsV2.viewCount) || stats.viewCount || 0,
      videos: parseInt(statsV2.videoCount) || stats.videoCount || 0,
      desc: info.challenge?.desc || "",
    };
  } catch { return { views: 0, videos: 0, desc: "" }; }
}

// ---------------------------------------------------------------------------
// Browser-based scraping with auto-login
// ---------------------------------------------------------------------------
async function launchBrowser() {
  const hasCredentials = TT_USER && TT_PASS;
  const browser = await puppeteerExtra.launch({
    headless: false,
    args: [
      "--no-sandbox", "--start-minimized",
      "--disable-blink-features=AutomationControlled",
      "--window-size=1366,768",
      ...(hasCredentials ? [`--user-data-dir=${PROFILE_DIR}`] : []),
    ],
  });
  const page = (await browser.pages())[0] || await browser.newPage();
  const cdp = await page.createCDPSession();
  try {
    const { windowId } = await cdp.send("Browser.getWindowForTarget");
    await cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "minimized" } });
  } catch {
    try { await cdp.send("Browser.setWindowBounds", { windowId: 1, bounds: { windowState: "minimized" } }); } catch {}
  }
  await page.setViewport({ width: 1366, height: 768 });
  return { browser, page };
}

async function ensureLoggedIn(page) {
  if (!TT_USER || !TT_PASS) return false;

  await page.goto("https://www.tiktok.com/foryou", { waitUntil: "domcontentloaded", timeout: 25000 });
  await new Promise(r => setTimeout(r, 3000));

  // Check if already logged in
  const isLoggedIn = await page.evaluate(() => {
    return !document.querySelector('[data-e2e="top-login-button"]') &&
           !document.body.innerText.includes("Log in to TikTok");
  });
  if (isLoggedIn) return true;

  console.error("[tiktok] Logging in...");
  await page.goto("https://www.tiktok.com/login/phone-or-email/email", { waitUntil: "networkidle2", timeout: 25000 });
  await new Promise(r => setTimeout(r, 3000));

  // Type email/username
  const emailInput = await page.$('input[name="username"], input[type="text"][placeholder*="email"], input[type="text"][placeholder*="Email"]');
  if (emailInput) {
    await emailInput.click({ clickCount: 3 });
    await emailInput.type(TT_USER, { delay: 40 });
  }

  // Type password
  const passInput = await page.$('input[type="password"]');
  if (passInput) {
    await passInput.click();
    await passInput.type(TT_PASS, { delay: 40 });
  }

  // Click login button
  const loginBtn = await page.$('button[data-e2e="login-button"], button[type="submit"]');
  if (loginBtn) await loginBtn.click();

  await new Promise(r => setTimeout(r, 5000));

  // Check for CAPTCHA — if present, wait longer
  const hasCaptcha = await page.evaluate(() =>
    !!document.querySelector('[class*="captcha"], #captcha, [id*="captcha"]')
  );
  if (hasCaptcha) {
    console.error("[tiktok] CAPTCHA detected, waiting...");
    await new Promise(r => setTimeout(r, 15000));
  }

  const loggedIn = await page.evaluate(() => {
    return !document.querySelector('[data-e2e="top-login-button"]');
  });
  console.error(`[tiktok] Login ${loggedIn ? "successful" : "may have failed"}`);
  return loggedIn;
}

// Scrape tag page: post count from header + video data from API interception
async function scrapeTagPage(name) {
  let browser;
  try {
    const launched = await launchBrowser();
    browser = launched.browser;
    const page = launched.page;

    // Login if credentials available
    const loggedIn = await ensureLoggedIn(page);

    // Set up API interception BEFORE navigating to tag page
    const videoItems = [];
    page.on("response", async (res) => {
      try {
        if (res.url().includes("/api/challenge/item_list")) {
          const text = await res.text();
          if (text.length > 50) {
            const data = JSON.parse(text);
            if (data.itemList) videoItems.push(...data.itemList);
          }
        }
      } catch {}
    });

    await page.goto(`https://www.tiktok.com/tag/${encodeURIComponent(name)}`, { waitUntil: "networkidle2", timeout: 25000 });
    await new Promise(r => setTimeout(r, 4000));

    // Get post count from header
    const postText = await page.$eval("h2", el => el.textContent).catch(() => "");

    // Scroll to trigger video loading
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, 600));
      await new Promise(r => setTimeout(r, 1500));
    }

    // Wait a bit more for API responses
    await new Promise(r => setTimeout(r, 2000));

    await browser.close();

    // Process video items
    let latestVideoDate = "";
    let latestVideoDesc = "";
    let recentCount = 0;
    const now = Date.now();
    const weekAgo = now - 7 * 86400000;

    if (videoItems.length > 0) {
      // Sort by createTime descending
      videoItems.sort((a, b) => (b.createTime || 0) - (a.createTime || 0));
      const latest = videoItems[0];
      if (latest.createTime) {
        const d = new Date(latest.createTime * 1000);
        const daysAgo = Math.floor((now - d.getTime()) / 86400000);
        latestVideoDate = daysAgo === 0 ? "today" : daysAgo === 1 ? "yesterday" : `${daysAgo}d ago`;
      }
      latestVideoDesc = latest.desc?.slice(0, 200) || "";
      // Count videos from last 7 days
      recentCount = videoItems.filter(v => v.createTime && v.createTime * 1000 > weekAgo).length;
    }

    return { postText, latestVideoDate, latestVideoDesc, recentCount, videoItems, loggedIn };
  } catch (err) {
    console.error(`[tiktok] scrapeTagPage error: ${err.message}`);
    if (browser) await browser.close().catch(() => {});
    return { postText: "", latestVideoDate: "", latestVideoDesc: "", recentCount: 0, videoItems: [], loggedIn: false };
  }
}

// ---- GLOBAL: trending hashtags via API ----
async function getGlobalTrends() {
  const trends = [];

  try {
    const data = await fetchJSON(`https://www.tiktok.com/node/share/discover?noUser=1&count=20`);
    for (const item of data.body?.[1]?.exploreList || data.body || []) {
      const tag = item.cardItem || item;
      const name = tag.title || tag.hashtagName || "";
      if (!name) continue;
      trends.push({
        title: `#${name}`,
        description: tag.subTitle || tag.description || "",
        source: "TikTok",
        url: `https://www.tiktok.com/tag/${encodeURIComponent(name)}`,
        volume: tag.extraInfo?.views || 0,
        volumeLabel: tag.extraInfo?.views ? `${formatCount(tag.extraInfo.views)} views` : "",
        category: "Hashtag",
        timestamp: "",
      });
    }
  } catch {}

  // Enrich with statsV2
  await Promise.all(trends.slice(0, 15).map(async (t) => {
    const name = t.title.replace(/^#/, "");
    const stats = await getHashtagStats(name);
    if (stats.views > 0) {
      t.volume = stats.views;
      t.volumeLabel = `${formatCount(stats.views)} views`;
      if (stats.videos > 0) t.volumeLabel += `, ${formatCount(stats.videos)} videos`;
    }
    if (stats.desc && !t.description) t.description = stats.desc;
  }));

  if (trends.length === 0) {
    const seeds = ["fyp", "trending", "viral", "foryou", "funny", "dance", "music", "fashion", "food", "fitness"];
    const results = await Promise.all(seeds.map(async (tag) => {
      const stats = await getHashtagStats(tag);
      return {
        title: `#${tag}`, description: stats.desc || "", source: "TikTok",
        url: `https://www.tiktok.com/tag/${tag}`,
        volume: stats.views, volumeLabel: stats.views ? `${formatCount(stats.views)} views` : "",
        category: "Hashtag", timestamp: "",
      };
    }));
    trends.push(...results.filter((t) => t.volume > 0));
  }

  return trends.slice(0, 25);
}

// ---- QUERY: hashtag stats + scrape tag page for videos ----
async function searchTrends(q) {
  const name = q.replace(/^#/, "");
  const trends = [];

  // Get API stats + scrape tag page in parallel
  const [apiStats, pageData] = await Promise.all([
    getHashtagStats(name),
    scrapeTagPage(name),
  ]);

  const postCount = pageData.postText;
  const postNum = parseHumanCount(postCount);
  let videoCount = apiStats.videos;
  if (postNum > videoCount) videoCount = postNum;

  // Build rich description
  const descParts = [];
  if (postCount) descParts.push(postCount);
  if (apiStats.views > 0) descParts.push(`${formatCount(apiStats.views)} total views`);
  if (pageData.latestVideoDate) descParts.push(`Latest video: ${pageData.latestVideoDate}`);
  if (pageData.recentCount > 0) descParts.push(`${pageData.recentCount} videos this week`);
  if (apiStats.desc) descParts.push(apiStats.desc);

  if (apiStats.views > 0 || postNum > 0) {
    trends.push({
      title: `#${name}`,
      description: descParts.join(" · ") || "",
      source: "TikTok",
      url: `https://www.tiktok.com/tag/${encodeURIComponent(name)}`,
      volume: apiStats.views || postNum,
      volumeLabel: descParts.slice(0, 2).join(", "),
      category: "Hashtag",
      timestamp: "",
    });
  }

  // Add individual recent videos if we got them
  for (const item of pageData.videoItems.slice(0, 15)) {
    const desc = item.desc || "";
    if (!desc || desc.length < 5) continue;
    const stats = item.stats || {};
    const author = item.author?.uniqueId || "";
    const created = item.createTime ? new Date(item.createTime * 1000) : null;
    const daysAgo = created ? Math.floor((Date.now() - created.getTime()) / 86400000) : null;
    const timeLabel = daysAgo !== null ? (daysAgo === 0 ? "today" : daysAgo === 1 ? "yesterday" : `${daysAgo}d ago`) : "";

    trends.push({
      title: desc.slice(0, 200),
      description: [
        timeLabel ? `Posted ${timeLabel}` : "",
        stats.playCount ? `${formatCount(stats.playCount)} plays` : "",
      ].filter(Boolean).join(" · "),
      source: "TikTok",
      url: item.id ? `https://www.tiktok.com/@${author}/video/${item.id}` : `https://www.tiktok.com/tag/${name}`,
      volume: (stats.diggCount || 0) + (stats.shareCount || 0) + (stats.commentCount || 0),
      volumeLabel: [
        stats.diggCount ? `${formatCount(stats.diggCount)} likes` : "",
        stats.shareCount ? `${formatCount(stats.shareCount)} shares` : "",
      ].filter(Boolean).join(", "),
      category: author ? `@${author}` : `#${name}`,
      timestamp: created ? created.toISOString() : "",
    });
  }

  // Add latest video description if we didn't get individual items
  if (pageData.videoItems.length === 0 && pageData.latestVideoDesc) {
    trends.push({
      title: pageData.latestVideoDesc,
      description: pageData.latestVideoDate ? `Posted ${pageData.latestVideoDate}` : "Latest video",
      source: "TikTok",
      url: `https://www.tiktok.com/tag/${encodeURIComponent(name)}`,
      volume: 0,
      volumeLabel: "",
      category: `#${name}`,
      timestamp: "",
    });
  }

  return trends.slice(0, 25);
}

try {
  const trends = query ? await searchTrends(query) : await getGlobalTrends();
  emit({
    site: "TikTok",
    url: query
      ? `https://www.tiktok.com/tag/${encodeURIComponent(query.replace(/^#/, ""))}`
      : "https://www.tiktok.com/discover",
    trends,
    partial: false,
  });
} catch (err) {
  emit({ site: "TikTok", url: "https://www.tiktok.com/discover", trends: [], error: err.message, partial: false });
}
```
