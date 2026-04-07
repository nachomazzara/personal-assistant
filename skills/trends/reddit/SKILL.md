---
name: reddit
description: Fetch trending posts and discussions from Reddit using the public JSON API
---

# Command

```bash
node skills/trends/reddit/search.mjs [--query "topic"] [--region US]
```

# Output format

JSON to stdout: `{ "site": "Reddit", "url": "...", "trends": [...], "partial": false }`

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
const HEADERS = { "User-Agent": "PersonalAssistant/1.0 (trending search)" };

async function fetchJSON(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function formatVolume(ups) {
  if (ups >= 1000) return `${(ups / 1000).toFixed(1)}k upvotes`;
  return `${ups} upvotes`;
}

function basicDescription(d) {
  if (d.selftext && d.selftext.length > 10) return d.selftext.slice(0, 200);
  if (d.link_flair_text) return d.link_flair_text;
  if (d.post_hint === "link" && d.domain && !d.domain.includes("reddit.com"))
    return d.domain;
  return "";
}

function mapPost(post) {
  const d = post.data;
  return {
    title: d.title,
    description: basicDescription(d),
    source: "Reddit",
    url: `https://www.reddit.com${d.permalink}`,
    permalink: d.permalink,
    needsComments: !basicDescription(d),
    volume: d.ups || 0,
    volumeLabel: `${formatVolume(d.ups || 0)}, ${d.num_comments || 0} comments`,
    category: `r/${d.subreddit}`,
    timestamp: new Date(d.created_utc * 1000).toISOString(),
  };
}

// Fetch subreddit descriptions (cached)
const subCache = new Map();
async function getSubDescription(sub) {
  if (subCache.has(sub)) return subCache.get(sub);
  try {
    const data = await fetchJSON(`https://www.reddit.com/r/${sub}/about.json`);
    const desc = (data.data?.public_description || "").slice(0, 80);
    subCache.set(sub, desc);
    return desc;
  } catch { subCache.set(sub, ""); return ""; }
}

// Fetch top comments for posts that lack descriptions (image/video posts)
async function enrichWithComments(posts) {
  const needEnrich = posts.filter((p) => p.needsComments).slice(0, 10);

  // Fetch unique subreddit descriptions in parallel
  const subs = [...new Set(needEnrich.map((p) => p.category.replace("r/", "")))];
  await Promise.all(subs.map((s) => getSubDescription(s)));

  await Promise.all(needEnrich.map(async (post) => {
    try {
      const data = await fetchJSON(
        `https://www.reddit.com${post.permalink}.json?limit=3&depth=1&sort=top&raw_json=1`
      );
      const comments = (data[1]?.data?.children || [])
        .filter((c) => c.kind === "t1" && c.data?.body)
        .slice(0, 3)
        .map((c) => c.data.body.replace(/\n+/g, " ").slice(0, 100));

      const subDesc = subCache.get(post.category.replace("r/", "")) || "";
      const parts = [];
      if (subDesc) parts.push(subDesc);
      if (comments.length > 0) parts.push(comments.join(" | "));
      if (parts.length > 0) post.description = parts.join(" — ");
    } catch {}
  }));
  // Clean up internal fields
  for (const p of posts) {
    delete p.permalink;
    delete p.needsComments;
  }
  return posts;
}

async function getGlobalTrends() {
  const data = await fetchJSON("https://www.reddit.com/r/popular/hot.json?limit=25&raw_json=1");
  const posts = (data.data?.children || []).map(mapPost);
  return enrichWithComments(posts);
}

async function searchTrends(q) {
  // Try hot posts from the past day first
  let data = await fetchJSON(
    `https://www.reddit.com/search.json?q=${encodeURIComponent(q)}&sort=hot&t=day&limit=25&raw_json=1`
  );
  let posts = (data.data?.children || []).map(mapPost);

  // If too few results, broaden to past week with relevance sort
  if (posts.length < 5) {
    data = await fetchJSON(
      `https://www.reddit.com/search.json?q=${encodeURIComponent(q)}&sort=relevance&t=week&limit=25&raw_json=1`
    );
    const morePosts = (data.data?.children || []).map(mapPost);
    // Merge without duplicates
    const seen = new Set(posts.map((p) => p.url));
    for (const p of morePosts) {
      if (!seen.has(p.url)) { posts.push(p); seen.add(p.url); }
    }
  }

  // Also check the dedicated subreddit if one exists (e.g. r/decentraland)
  try {
    const subData = await fetchJSON(
      `https://www.reddit.com/r/${encodeURIComponent(q)}/hot.json?limit=10&raw_json=1`
    );
    const subPosts = (subData.data?.children || []).map(mapPost);
    const seen = new Set(posts.map((p) => p.url));
    for (const p of subPosts) {
      if (!seen.has(p.url)) { posts.push(p); seen.add(p.url); }
    }
  } catch {} // subreddit may not exist

  return enrichWithComments(posts.slice(0, 25));
}

try {
  const trends = query ? await searchTrends(query) : await getGlobalTrends();
  console.log(JSON.stringify({
    site: "Reddit",
    url: query ? `https://www.reddit.com/search/?q=${encodeURIComponent(query)}&sort=hot&t=day` : "https://www.reddit.com/r/popular/",
    trends,
    partial: false,
  }));
} catch (err) {
  console.log(JSON.stringify({ site: "Reddit", url: "https://www.reddit.com/", trends: [], error: err.message, partial: false }));
}
```
