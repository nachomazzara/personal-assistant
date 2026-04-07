---
name: hackernews
description: Fetch trending stories from Hacker News using the official API and Algolia search
---

# Command

```bash
node skills/trends/hackernews/search.mjs [--query "topic"] [--region US]
```

# Output format

JSON to stdout: `{ "site": "Hacker News", "url": "...", "trends": [...], "partial": false }`

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
const HEADERS = { "User-Agent": "PersonalAssistant/1.0" };

async function fetchJSON(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function getGlobalTrends() {
  const ids = await fetchJSON("https://hacker-news.firebaseio.com/v0/topstories.json");
  const top30 = ids.slice(0, 30);
  const items = await Promise.all(
    top30.map((id) => fetchJSON(`https://hacker-news.firebaseio.com/v0/item/${id}.json`))
  );
  return items.filter(Boolean).map((item) => ({
    title: item.title,
    description: item.text ? item.text.replace(/<[^>]*>/g, "").slice(0, 200) : "",
    source: "Hacker News",
    url: item.url || `https://news.ycombinator.com/item?id=${item.id}`,
    volume: item.score || 0,
    volumeLabel: `${item.score} points, ${item.descendants || 0} comments`,
    category: item.type === "job" ? "Jobs" : "Tech",
    timestamp: new Date(item.time * 1000).toISOString(),
  }));
}

async function searchTrends(q) {
  // Search recent stories (last 30 days) sorted by relevance, then also by date
  const thirtyDaysAgo = Math.floor((Date.now() - 30 * 86400000) / 1000);
  const [relevance, recent] = await Promise.all([
    fetchJSON(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&tags=story&hitsPerPage=15&numericFilters=points>3,created_at_i>${thirtyDaysAgo}`),
    fetchJSON(`https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(q)}&tags=story&hitsPerPage=15&numericFilters=points>1`),
  ]);
  // Merge and dedup
  const seen = new Set();
  const allHits = [];
  for (const hit of [...(relevance.hits || []), ...(recent.hits || [])]) {
    if (seen.has(hit.objectID)) continue;
    seen.add(hit.objectID);
    allHits.push(hit);
  }
  // Sort by points descending
  allHits.sort((a, b) => (b.points || 0) - (a.points || 0));
  const data = { hits: allHits.slice(0, 25) };
  return (data.hits || []).map((hit) => ({
    title: hit.title,
    description: hit.story_text ? hit.story_text.replace(/<[^>]*>/g, "").slice(0, 200) : "",
    source: "Hacker News",
    url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
    volume: hit.points || 0,
    volumeLabel: `${hit.points} points, ${hit.num_comments || 0} comments`,
    category: "Tech",
    timestamp: hit.created_at || "",
  }));
}

try {
  const trends = query ? await searchTrends(query) : await getGlobalTrends();
  console.log(JSON.stringify({
    site: "Hacker News",
    url: query ? `https://hn.algolia.com/?q=${encodeURIComponent(query)}` : "https://news.ycombinator.com/",
    trends,
    partial: false,
  }));
} catch (err) {
  console.log(JSON.stringify({ site: "Hacker News", url: "https://news.ycombinator.com/", trends: [], error: err.message, partial: false }));
}
```
