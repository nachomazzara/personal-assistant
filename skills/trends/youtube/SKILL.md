---
name: youtube
description: Fetch trending videos from YouTube using the Data API v3
---

# Command

```bash
node skills/trends/youtube/search.mjs [--query "topic"] [--region US]
```

# Output format

JSON to stdout: `{ "site": "YouTube", "url": "...", "trends": [...], "partial": false }`

# Rules

- Run the command directly
- Requires YOUTUBE_API_KEY environment variable
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
const API_KEY = process.env.YOUTUBE_API_KEY;

if (!API_KEY) {
  console.log(JSON.stringify({ site: "YouTube", url: "https://www.youtube.com/", trends: [], error: "YOUTUBE_API_KEY not set", partial: false }));
  process.exit(0);
}

const BASE = "https://www.googleapis.com/youtube/v3";

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text().then(t => t.slice(0, 200))}`);
  return res.json();
}

function formatViews(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M views`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K views`;
  return `${n} views`;
}

async function getGlobalTrends() {
  const data = await fetchJSON(
    `${BASE}/videos?part=snippet,statistics&chart=mostPopular&regionCode=${region}&maxResults=25&key=${API_KEY}`
  );
  return (data.items || []).map((item) => {
    const s = item.snippet;
    const stats = item.statistics || {};
    const views = parseInt(stats.viewCount || "0");
    return {
      title: s.title,
      description: s.description?.slice(0, 200) || "",
      source: "YouTube",
      url: `https://www.youtube.com/watch?v=${item.id}`,
      volume: views,
      volumeLabel: formatViews(views),
      category: s.channelTitle || "Video",
      timestamp: s.publishedAt || "",
    };
  });
}

async function searchTrends(q) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const searchData = await fetchJSON(
    `${BASE}/search?part=snippet&q=${encodeURIComponent(q)}&order=viewCount&publishedAfter=${since}&type=video&maxResults=25&regionCode=${region}&key=${API_KEY}`
  );
  const ids = (searchData.items || []).map((i) => i.id?.videoId).filter(Boolean);
  if (ids.length === 0) return [];

  const statsData = await fetchJSON(
    `${BASE}/videos?part=statistics,snippet&id=${ids.join(",")}&key=${API_KEY}`
  );
  return (statsData.items || []).map((item) => {
    const s = item.snippet;
    const stats = item.statistics || {};
    const views = parseInt(stats.viewCount || "0");
    return {
      title: s.title,
      description: s.description?.slice(0, 200) || "",
      source: "YouTube",
      url: `https://www.youtube.com/watch?v=${item.id}`,
      volume: views,
      volumeLabel: formatViews(views),
      category: s.channelTitle || "Video",
      timestamp: s.publishedAt || "",
    };
  });
}

try {
  const trends = query ? await searchTrends(query) : await getGlobalTrends();
  console.log(JSON.stringify({
    site: "YouTube",
    url: query
      ? `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=CAMSAhAB`
      : "https://www.youtube.com/feed/trending",
    trends,
    partial: false,
  }));
} catch (err) {
  console.log(JSON.stringify({ site: "YouTube", url: "https://www.youtube.com/", trends: [], error: err.message, partial: false }));
}
```
