---
name: mastodon
description: Fetch trending hashtags and posts from Mastodon using the public API
---

# Command

```bash
node skills/trends/mastodon/search.mjs [--query "topic"] [--region US]
```

# Output format

JSON to stdout: `{ "site": "Mastodon", "url": "...", "trends": [...], "partial": false }`

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
const INSTANCE = "https://mastodon.social";
const HEADERS = { Accept: "application/json" };

async function fetchJSON(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function getGlobalTrends() {
  const trends = [];

  // Trending hashtags
  try {
    const tags = await fetchJSON(`${INSTANCE}/api/v1/trends/tags?limit=20`);
    for (const tag of tags) {
      const history = tag.history || [];
      const todayUses = history.length > 0 ? parseInt(history[0].uses || "0") : 0;
      const todayAccounts = history.length > 0 ? parseInt(history[0].accounts || "0") : 0;
      trends.push({
        title: `#${tag.name}`,
        description: "",
        source: "Mastodon",
        url: `${INSTANCE}/tags/${tag.name}`,
        volume: todayUses,
        volumeLabel: `${todayUses} posts by ${todayAccounts} people today`,
        category: "Hashtag",
        timestamp: new Date().toISOString(),
      });
    }
  } catch {}

  // Trending posts
  try {
    const posts = await fetchJSON(`${INSTANCE}/api/v1/trends/statuses?limit=10`);
    for (const post of posts) {
      const text = (post.content || "").replace(/<[^>]*>/g, "");
      const title = text.slice(0, 120) + (text.length > 120 ? "..." : "");
      if (!title) continue;
      trends.push({
        title,
        description: "",
        source: "Mastodon",
        url: post.url || `${INSTANCE}/@${post.account?.acct}/posts/${post.id}`,
        volume: (post.favourites_count || 0) + (post.reblogs_count || 0),
        volumeLabel: `${post.favourites_count || 0} favs, ${post.reblogs_count || 0} boosts`,
        category: `@${post.account?.acct || "unknown"}`,
        timestamp: post.created_at || "",
      });
    }
  } catch {}

  return trends;
}

async function searchTrends(q) {
  const data = await fetchJSON(
    `${INSTANCE}/api/v2/search?q=${encodeURIComponent(q)}&type=statuses&limit=25`
  );
  return (data.statuses || []).map((post) => {
    const text = (post.content || "").replace(/<[^>]*>/g, "");
    const title = text.slice(0, 120) + (text.length > 120 ? "..." : "");
    return {
      title: title || q,
      description: "",
      source: "Mastodon",
      url: post.url || `${INSTANCE}/@${post.account?.acct}/posts/${post.id}`,
      volume: (post.favourites_count || 0) + (post.reblogs_count || 0),
      volumeLabel: `${post.favourites_count || 0} favs, ${post.reblogs_count || 0} boosts`,
      category: `@${post.account?.acct || "unknown"}`,
      timestamp: post.created_at || "",
    };
  });
}

try {
  const trends = query ? await searchTrends(query) : await getGlobalTrends();
  console.log(JSON.stringify({
    site: "Mastodon",
    url: query ? `${INSTANCE}/search?q=${encodeURIComponent(query)}` : `${INSTANCE}/explore`,
    trends,
    partial: false,
  }));
} catch (err) {
  console.log(JSON.stringify({ site: "Mastodon", url: `${INSTANCE}/explore`, trends: [], error: err.message, partial: false }));
}
```
