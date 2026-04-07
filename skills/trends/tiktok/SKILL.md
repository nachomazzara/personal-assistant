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
- Global mode: public API for trending hashtags
- Query mode: public API for hashtag stats + Puppeteer for post count from tag page
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
    // statsV2 has accurate counts, stats often returns 0
    const statsV2 = info.statsV2 || {};
    const stats = info.stats || {};
    return {
      views: parseInt(statsV2.viewCount) || stats.viewCount || 0,
      videos: parseInt(statsV2.videoCount) || stats.videoCount || 0,
      desc: info.challenge?.desc || "",
    };
  } catch { return { views: 0, videos: 0, desc: "" }; }
}

// Scrape the tag page to get real post count from the h2 header
async function scrapeTagPagePostCount(name) {
  let browser;
  try {
    browser = await puppeteerExtra.launch({
      headless: false,
      args: ["--no-sandbox", "--start-minimized", "--disable-blink-features=AutomationControlled", "--window-size=1366,768"],
    });
    const page = (await browser.pages())[0];
    const cdp = await page.createCDPSession();
    try { const {windowId} = await cdp.send("Browser.getWindowForTarget"); await cdp.send("Browser.setWindowBounds", {windowId, bounds:{windowState:"minimized"}}); } catch {}

    await page.goto(`https://www.tiktok.com/tag/${encodeURIComponent(name)}`, { waitUntil: "networkidle2", timeout: 25000 });
    await new Promise(r => setTimeout(r, 3000));

    // Get post count from h2 header (e.g. "10K posts")
    const postText = await page.$eval("h2", el => el.textContent).catch(() => "");

    // Intercept the item_list API response the browser makes
    let latestVideoDate = "";
    let latestVideoDesc = "";
    const itemListPromise = new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(null), 8000);
      page.on("response", async (res) => {
        try {
          if (res.url().includes("/api/challenge/item_list")) {
            const text = await res.text();
            if (text.length > 50) {
              clearTimeout(timeout);
              resolve(JSON.parse(text));
            }
          }
        } catch {}
      });
    });

    // Scroll down to trigger the item_list API call
    await page.evaluate(() => window.scrollBy(0, 600));
    await new Promise(r => setTimeout(r, 2000));
    await page.evaluate(() => window.scrollBy(0, 600));

    const itemData = await itemListPromise;
    if (itemData?.itemList?.length > 0) {
      const latest = itemData.itemList[0];
      if (latest.createTime) {
        const d = new Date(latest.createTime * 1000);
        const daysAgo = Math.floor((Date.now() - d.getTime()) / 86400000);
        latestVideoDate = daysAgo === 0 ? "today" : daysAgo === 1 ? "yesterday" : `${daysAgo}d ago`;
      }
      latestVideoDesc = latest.desc?.slice(0, 200) || "";
    }

    await browser.close();
    return { postText, latestVideoDate, latestVideoDesc };
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    return { postText: "", latestVideoDate: "", latestVideoDesc: "" };
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

  // Enrich with stats
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

// ---- QUERY: hashtag stats + scrape tag page for real post count ----
async function searchTrends(q) {
  const name = q.replace(/^#/, "");
  const trends = [];

  // Get API stats + scrape tag page in parallel
  const [apiStats, pageData] = await Promise.all([
    getHashtagStats(name),
    scrapeTagPagePostCount(name),
  ]);

  // Use statsV2 for accurate video count if available
  let videoCount = apiStats.videos;
  const postCount = pageData.postText; // e.g. "10K posts"
  const postNum = parseHumanCount(postCount);
  if (postNum > videoCount) videoCount = postNum;

  // Build rich description
  const descParts = [];
  if (postCount) descParts.push(postCount);
  if (apiStats.views > 0) descParts.push(`${formatCount(apiStats.views)} total views`);
  if (pageData.latestVideoDate) descParts.push(`Latest video: ${pageData.latestVideoDate}`);
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

  // Add latest video description as a separate entry if we got one
  if (pageData.latestVideoDesc) {
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

  // Also try related hashtags
  const related = [`${name}viral`, `${name}trend`, `${name}fyp`];
  for (const tag of related) {
    const stats = await getHashtagStats(tag);
    if (stats.views > 100000) {
      trends.push({
        title: `#${tag}`,
        description: stats.desc || `${formatCount(stats.views)} views`,
        source: "TikTok",
        url: `https://www.tiktok.com/tag/${encodeURIComponent(tag)}`,
        volume: stats.views,
        volumeLabel: `${formatCount(stats.views)} views`,
        category: "Related Hashtag",
        timestamp: "",
      });
    }
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
