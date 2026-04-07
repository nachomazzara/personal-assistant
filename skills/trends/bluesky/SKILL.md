---
name: bluesky
description: Fetch trending topics and posts from Bluesky using the public AT Protocol API
---

# Command

```bash
node skills/trends/bluesky/search.mjs [--query "topic"] [--region US]
```

# Output format

JSON to stdout: `{ "site": "Bluesky", "url": "...", "trends": [...], "partial": false }`

# Rules

- Run the command directly
- No authentication required — uses public API
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
const BASE = "https://public.api.bsky.app/xrpc";

async function fetchJSON(url) {
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "PersonalAssistant/1.0" },
  });
  if (!res.ok) {
    if (res.status === 403 || res.status === 429) return null; // rate limited
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return res.json();
}

async function getGlobalTrends() {
  const trends = [];

  // Get trending topics
  try {
    const data = await fetchJSON(`${BASE}/app.bsky.unspecced.getTrendingTopics`);
    if (!data) throw new Error("rate limited");
    for (const topic of (data.topics || data.suggested || [])) {
      const name = topic.topic || topic.displayName || topic.tag || "";
      if (!name) continue;
      trends.push({
        title: name,
        description: topic.description || "",
        source: "Bluesky",
        url: `https://bsky.app/search?q=${encodeURIComponent(name)}`,
        volume: topic.count || 0,
        volumeLabel: topic.count ? `${topic.count} posts` : "Trending",
        category: "Trending Topic",
        timestamp: new Date().toISOString(),
      });
    }
  } catch {}

  // Supplement with popular recent posts if few topics
  if (trends.length < 10) {
    try {
      const data = await fetchJSON(`${BASE}/app.bsky.feed.searchPosts?q=*&sort=top&limit=25`);
      if (!data) throw new Error("rate limited");
      for (const item of (data.posts || [])) {
        const record = item.record || {};
        const text = record.text || "";
        if (!text || text.length < 10) continue;
        const title = text.slice(0, 120) + (text.length > 120 ? "..." : "");
        trends.push({
          title,
          description: "",
          source: "Bluesky",
          url: `https://bsky.app/profile/${item.author?.handle}/post/${item.uri?.split("/").pop()}`,
          volume: (item.likeCount || 0) + (item.repostCount || 0),
          volumeLabel: `${item.likeCount || 0} likes, ${item.repostCount || 0} reposts`,
          category: `@${item.author?.handle || "unknown"}`,
          timestamp: record.createdAt || item.indexedAt || "",
        });
      }
    } catch {}
  }

  return trends.slice(0, 25);
}

async function searchTrends(q) {
  const data = await fetchJSON(
    `${BASE}/app.bsky.feed.searchPosts?q=${encodeURIComponent(q)}&sort=top&limit=25`
  );
  if (!data) return [];
  return (data.posts || []).map((item) => {
    const record = item.record || {};
    const text = record.text || "";
    const title = text.slice(0, 120) + (text.length > 120 ? "..." : "");
    return {
      title,
      description: "",
      source: "Bluesky",
      url: `https://bsky.app/profile/${item.author?.handle}/post/${item.uri?.split("/").pop()}`,
      volume: (item.likeCount || 0) + (item.repostCount || 0),
      volumeLabel: `${item.likeCount || 0} likes, ${item.repostCount || 0} reposts`,
      category: `@${item.author?.handle || "unknown"}`,
      timestamp: record.createdAt || item.indexedAt || "",
    };
  });
}

try {
  const trends = query ? await searchTrends(query) : await getGlobalTrends();
  console.log(JSON.stringify({
    site: "Bluesky",
    url: query ? `https://bsky.app/search?q=${encodeURIComponent(query)}` : "https://bsky.app/",
    trends,
    partial: false,
  }));
} catch (err) {
  console.log(JSON.stringify({ site: "Bluesky", url: "https://bsky.app/", trends: [], error: err.message, partial: false }));
}
```
