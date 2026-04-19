---
name: google-trends
description: Fetch trending searches from Google Trends using the public API endpoints
---

# Command

```bash
node skills/trends/google-trends/search.mjs [--query "topic"] [--region US]
```

# Output format

JSON to stdout: `{ "site": "Google Trends", "url": "...", "trends": [...], "partial": false }`

# Rules

- Run the command directly
- Your response must be ONLY the raw JSON — no text before or after

## Script

```javascript
#!/usr/bin/env node

const args = process.argv.slice(2);
function getArg(name) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : null;
}

const query = getArg("query");
const region = getArg("region") || "US";

async function fetchText(url, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
          "Accept": "text/xml, application/rss+xml, application/xml, */*",
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    } catch (err) {
      if (attempt < retries) {
        console.error(`[google-trends] Fetch retry ${attempt + 1}/${retries}: ${err.message}`);
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
}

async function getGlobalTrends() {
  // Use the Google Trends daily trends RSS/JSON endpoint
  const url = `https://trends.google.com/trending/rss?geo=${region}`;
  const xml = await fetchText(url);

  const trends = [];
  // Parse RSS items
  const items = xml.split("<item>").slice(1);
  for (const item of items.slice(0, 25)) {
    const decodeEntities = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#x2F;/g, "/").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n));
    const getTag = (tag) => {
      const m = item.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?</${tag}>`, "s"));
      return m ? decodeEntities(m[1].trim()) : "";
    };
    const title = getTag("title");
    if (!title) continue;
    const traffic = getTag("ht:approx_traffic");
    const newsTitle = getTag("ht:news_item_title") || getTag("description");
    const newsUrl = getTag("ht:news_item_url") || getTag("link");
    const vol = parseInt((traffic || "").replace(/[^0-9]/g, "")) || 0;

    trends.push({
      title,
      description: newsTitle,
      source: "Google Trends",
      url: newsUrl || `https://trends.google.com/trends/explore?q=${encodeURIComponent(title)}&geo=${region}`,
      volume: vol,
      volumeLabel: traffic ? `${traffic} searches` : "",
      category: "Trending Search",
      relatedTerms: [],
      timestamp: new Date().toISOString(),
    });
  }
  return trends;
}

async function searchTrends(q) {
  const trends = [];

  // Get related topics from autocomplete
  let relatedTerms = [];
  try {
    const raw = await fetchText(
      `https://trends.google.com/trends/api/autocomplete/${encodeURIComponent(q)}?hl=en-US&tz=-180`
    );
    const clean = raw.replace(/^\)\]\}',?\n?/, "");
    const data = JSON.parse(clean);
    relatedTerms = (data.default?.topics || [])
      .map((t) => ({ title: t.title || "", type: t.type || "" }))
      .filter((t) => t.title)
      .slice(0, 10);
  } catch {}

  // Get daily trends and filter for relevance to the query
  const allTrends = await getGlobalTrends();
  const queryLower = q.toLowerCase();
  const relevant = allTrends.filter((t) =>
    t.title.toLowerCase().includes(queryLower) ||
    (t.description || "").toLowerCase().includes(queryLower)
  );

  // Add matching daily trends first (they have real volume)
  for (const t of relevant) {
    trends.push({ ...t, category: "Trending Search" });
  }

  // Add related topics from autocomplete
  for (const topic of relatedTerms) {
    if (trends.some((t) => t.title.toLowerCase() === topic.title.toLowerCase())) continue;
    // Check if this related topic appears in today's trending (for volume)
    const inTrending = allTrends.find((t) =>
      t.title.toLowerCase() === topic.title.toLowerCase()
    );
    trends.push({
      title: topic.title,
      description: inTrending
        ? inTrending.description || `Trending today — ${inTrending.volumeLabel}`
        : `Related ${topic.type || "topic"} — click to see interest over time on Google Trends`,
      source: "Google Trends",
      url: `https://trends.google.com/trends/explore?q=${encodeURIComponent(topic.title)}&geo=${region}`,
      volume: inTrending?.volume || 0,
      volumeLabel: inTrending?.volumeLabel || "",
      category: topic.type || "Related Topic",
      relatedTerms: [],
      timestamp: new Date().toISOString(),
    });
  }

  // If nothing found at all
  if (trends.length === 0) {
    trends.push({
      title: q,
      description: "Not in today's trending searches — click to see interest history on Google Trends",
      source: "Google Trends",
      url: `https://trends.google.com/trends/explore?q=${encodeURIComponent(q)}&geo=${region}`,
      volume: 0,
      volumeLabel: "",
      category: "Search Topic",
      relatedTerms: relatedTerms.map((t) => t.title),
      timestamp: new Date().toISOString(),
    });
  }

  return trends;
}

try {
  const trends = query ? await searchTrends(query) : await getGlobalTrends();
  console.log(JSON.stringify({
    site: "Google Trends",
    url: query
      ? `https://trends.google.com/trends/explore?q=${encodeURIComponent(query)}&geo=${region}`
      : `https://trends.google.com/trending?geo=${region}`,
    trends,
    partial: false,
  }));
} catch (err) {
  console.log(JSON.stringify({ site: "Google Trends", url: "https://trends.google.com/", trends: [], error: err.message, partial: false }));
}
```
