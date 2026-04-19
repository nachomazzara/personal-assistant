---
name: tiktok
description: Scrape TikTok Creative Center for trending hashtags (by region & category), songs, and creators
---

# Command

```bash
node skills/trends/tiktok/search.mjs
```

# Output format

JSON to stdout: `{ "site": "TikTok", "url": "...", "trends": [...], "partial": false }`

Each trend includes `category` field: "Trending Hashtags - XX", "Trending Songs", "Trending Creators", or one of the 24 content categories.

## Script

```javascript
#!/usr/bin/env node
import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
puppeteerExtra.use(StealthPlugin());

function emit(data) { console.log(JSON.stringify(data)); }

function formatCount(n) {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CC_BASE = "https://ads.tiktok.com/business/creativecenter/inspiration/popular";

const HASHTAG_REGIONS = [
  { code: "", label: "Worldwide" },
  { code: "US", label: "US" }, { code: "CA", label: "CA" }, { code: "MX", label: "MX" },
  { code: "BR", label: "BR" }, { code: "AR", label: "AR" }, { code: "CO", label: "CO" },
  { code: "GB", label: "GB" }, { code: "DE", label: "DE" }, { code: "FR", label: "FR" },
  { code: "JP", label: "JP" }, { code: "IN", label: "IN" }, { code: "ID", label: "ID" },
  { code: "ZA", label: "ZA" }, { code: "NG", label: "NG" }, { code: "EG", label: "EG" },
];

const CATEGORY_SEEDS = {
  "Singing & Dancing": ["dance", "dancetok", "dancechallenge", "choreography", "dancing", "kpop", "kpopdance", "tiktokdance", "dancetrend", "shuffle", "salsa", "bachata", "ballet", "streetdance", "dancecover", "danceparty", "hiphopclassics", "danceoff", "dancelife", "dancemoves", "dancelover", "urbandance", "dancvirals", "rhythmdance", "bestdance", "clubdance", "showdance", "dancevideos", "grouptok", "ballroom"],
  "Lipsync": ["lipsync", "lipsyncbattle", "lipsynctok", "lipsyncchallenge", "lipsyncvideo", "pov", "povchallenge", "povvideo", "duet", "duetchallenge", "transition", "transitionvideo", "smoothtransition", "voiceover", "actingchallenge", "actingpov", "stitch", "stitchme", "duetme", "lipsyncfunny", "lipsyncgirls", "magictransition", "playback", "actingskills", "lipread"],
  "Comedy": ["comedy", "funny", "humor", "laugh", "jokes", "funnyvideos", "hilarious", "funnytiktok", "funnymemes", "comedytiktok", "lol", "relatable", "skit", "comedyskit", "parody", "roast", "meme", "memes", "memesdaily", "trynottolaugh", "darkhumor", "irony", "comedygold", "standupcomedy", "funnymoments"],
  "Sports": ["sports", "nba", "soccer", "football", "basketball", "athlete", "sportstok", "nfl", "baseball", "tennis", "volleyball", "boxing", "cricket", "rugby", "skateboarding", "surfing", "esports", "extremesports", "sportsfail", "sportswin", "sportshighlights", "sportsmoments", "cycling", "swimming", "crossfit"],
  "Anime & Comics": ["anime", "animeedit", "manga", "cosplay", "animelover", "otaku", "animetok", "naruto", "onepiece", "dragonball", "demonslayer", "jujutsukaisen", "attackontitan", "myheroacademia", "bleach", "comics", "marvel", "dc", "cosplaytok", "cosplayer", "fanart", "animeart", "conceptart", "graphicnovel", "superheroes"],
  "Relationship": ["relationship", "couple", "love", "dating", "couplegoals", "relationshipgoals", "boyfriend", "girlfriend", "couplevideos", "lovestory", "cutecouple", "marriage", "crush", "heartbreak", "singlelife", "flirting", "firstdate", "longdistance", "soulmate", "romanticvideo", "anniversary", "datingadvice", "relationshiptok", "couplelife", "weddingday"],
  "Lifestyle": ["lifestyle", "selfcare", "wellness", "mindfulness", "morningroutine", "luxurylifestyle", "minimalist", "slowliving", "aestheticlifestyle", "selfimprovement", "personaldevelopment", "healthylifestyle", "sustainability", "ecofriendly", "thatgirl", "gratitude", "journaling", "meditation", "adulting", "productiveday", "grindset", "bossbabe", "cleanliving", "lifetips", "girlboss"],
  "Daily Life": ["dailylife", "dayinmylife", "vlog", "routine", "lifeupdate", "morningroutine", "nightroutine", "dailyvlog", "studentlife", "worklife", "wfh", "workfromhome", "momlife", "dadlife", "livingalone", "apartmentlife", "roomtour", "sundayreset", "mealprep", "groceryshopping", "citylife", "suburbanlife", "chores", "collegestyle", "parentinglife"],
  "Food": ["food", "foodtok", "recipe", "cooking", "foodie", "yummy", "delicious", "foodlover", "homecooking", "baking", "dessert", "pizza", "sushi", "ramen", "tacos", "burger", "pasta", "healthyfood", "veganfood", "streetfood", "mukbang", "foodreview", "asmrfood", "cookingtime", "foodtrend"],
  "Travel": ["travel", "traveltok", "wanderlust", "vacation", "adventure", "backpacking", "solotravel", "roadtrip", "beachlife", "mountains", "camping", "hiking", "europetravel", "asiatravel", "budgettravel", "luxurytravel", "hoteltour", "airbnb", "traveltips", "travelinspo", "familytravel", "citybreak", "flightlife", "couplestraveling", "travelvideos"],
  "Beauty": ["beauty", "makeup", "skincare", "beautytok", "makeuptutorial", "cosmetics", "skincareroutine", "glowup", "naturalbeauty", "nailart", "nails", "hairstyle", "hairtutorial", "haircare", "hairtransformation", "eyemakeup", "contouring", "lipstick", "perfume", "fragrance", "beautyreview", "makeuplook", "makeupinspo", "beautytips", "makeupchallenge"],
  "Education": ["education", "learnontiktok", "study", "knowledge", "school", "didyouknow", "funfacts", "studywithme", "university", "learning", "tutorialvideo", "explainer", "sciencefact", "historylesson", "languagelearning", "edutok", "infotok", "braintok", "smarttok", "educationtok", "lifelessons", "howtovideo", "factcheck", "readingbooks", "mathhelp"],
  "Gaming": ["gaming", "gamer", "videogames", "gaminglife", "pcgaming", "streamer", "gamingtok", "gamingsetup", "minecraft", "fortnite", "roblox", "valorant", "leagueoflegends", "callofduty", "gta", "gamingmemes", "gamingmoments", "speedrun", "retrogaming", "rpg", "esportsgaming", "mobilegaming", "consolegaming", "twitch", "gamepassion"],
  "Music": ["music", "musician", "musicvideo", "newsong", "hiphop", "singer", "rap", "rnb", "pop", "indie", "edm", "rock", "country", "jazz", "classical", "originalmusic", "songwriting", "beatmaking", "producer", "acousticmusic", "livesong", "newartist", "musicperformance", "covering", "alternative"],
  "DIY": ["diy", "crafts", "handmade", "tutorial", "howto", "diycrafts", "diyprojects", "upcycle", "woodworking", "sewing", "knitting", "crochet", "embroidery", "homeimprovement", "homerenovation", "diyhome", "interiordesign", "roomdecor", "origami", "resin", "3dprinting", "candles", "jewelrymaking", "papercraft", "diymakeup"],
  "Fitness": ["fitness", "gym", "workout", "fitnesstok", "exercise", "fitnessmotivation", "workoutroutine", "bodybuilding", "weightlifting", "cardio", "hiit", "yoga", "pilates", "stretching", "abs", "legday", "running", "crossfit", "calisthenics", "homeworkout", "gymlife", "gymrat", "gainz", "fitnessjourney", "transformation"],
  "Pets": ["pets", "dog", "cat", "catsoftiktok", "dogsoftiktok", "petlover", "funnyanimals", "animallovers", "kitten", "puppy", "catvideos", "dogvideos", "cutecats", "cutedogs", "exoticpets", "rabbit", "hamster", "parrot", "pettok", "animaltok", "petlife", "dogtraining", "petfood", "rescuepet", "petcare"],
  "Science": ["science", "sciencefacts", "space", "nature", "biology", "chemistry", "physics", "sciencetok", "astronomy", "cosmos", "nasa", "quantumphysics", "evolution", "genetics", "neuroscience", "psychology", "ecology", "climatescience", "geology", "botany", "scienceexperiment", "discovery", "innovation", "microscope", "oceanography"],
  "Business": ["business", "entrepreneur", "money", "finance", "startup", "businesstok", "sidehustle", "passiveincome", "investing", "stockmarket", "crypto", "realestate", "dropshipping", "ecommerce", "smallbusiness", "freelance", "marketing", "branding", "socialmediamarketing", "monetize", "ceo", "founder", "leadership", "productivity", "worksmarter"],
  "Art": ["art", "artist", "painting", "drawing", "digitalart", "artwork", "arttok", "illustration", "watercolor", "oilpainting", "sketch", "pencildrawing", "digitalpainting", "procreate", "animation", "sculpture", "ceramics", "pottery", "streetart", "graffiti", "conceptart", "fanart", "timelapse", "artprocess", "artcommunity"],
  "Acting": ["acting", "actor", "drama", "theatre", "film", "actingtips", "actingclass", "monologue", "improv", "audition", "behindthescenes", "filmmaking", "shortfilm", "cinematography", "directing", "scriptwriting", "moviereview", "tvshow", "netflix", "indiefilm", "hollywoodlife", "bollywood", "castingcall", "actorlife", "seriesreview"],
  "Motivation": ["motivation", "inspiration", "success", "mindset", "goals", "motivationalvideo", "successstory", "mindsetshift", "dailymotivation", "positivethinking", "growthmindset", "confidence", "selfbelief", "hardwork", "nevergiveup", "perseverance", "motivationalquotes", "lifequotes", "abundance", "manifestation", "lawofattraction", "affirmations", "visionboard", "wisdom", "grind"],
  "Entertainment": ["entertainment", "movies", "tvshows", "celebrity", "popculturetok", "viralvideo", "trendingvideo", "reaction", "reactvideo", "review", "commentary", "karaoke", "realitytv", "gameshow", "influencer", "showbiz", "hollywoodgossip", "content", "watchme", "popularvideos", "opinion", "entertainmenttok", "talkshow", "comedyshow", "popculture"],
  "Technology": ["technology", "tech", "ai", "gadgets", "coding", "techtok", "technews", "techreview", "artificialintelligence", "machinelearning", "programming", "softwaredev", "webdev", "cybersecurity", "blockchain", "innovation", "robotics", "futuretech", "gadgetreview", "smartphone", "laptop", "wearable", "iot", "cloudcomputing", "startuplife"],
};

const CATEGORIES = Object.keys(CATEGORY_SEEDS);

const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
};

// ---------------------------------------------------------------------------
// Browser helpers
// ---------------------------------------------------------------------------

async function launchBrowser() {
  const browser = await puppeteerExtra.launch({
    headless: false,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled", "--start-minimized"],
  });
  try {
    const page = (await browser.pages())[0] || await browser.newPage();
    const cdp = await page.createCDPSession();
    const { windowId } = await cdp.send("Browser.getWindowForTarget");
    await cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "minimized" } });
  } catch {}
  return browser;
}

// ---------------------------------------------------------------------------
// Creative Center — navigate page with request interception to boost limit,
// then collect the API response data
// ---------------------------------------------------------------------------

function setupInterception(page) {
  const pending = {};
  // Target country code to force on API requests (SPA ignores URL params)
  let _targetCountry = "";

  page.on("request", (request) => {
    const url = request.url();
    if (url.includes("creative_radar_api")) {
      let newUrl = url;
      if (newUrl.includes("limit=")) newUrl = newUrl.replace(/limit=\d+/, "limit=50");
      if (_targetCountry && newUrl.includes("country_code=")) {
        newUrl = newUrl.replace(/country_code=[^&]*/, `country_code=${_targetCountry}`);
      }
      request.continue({ url: newUrl !== url ? newUrl : undefined });
    } else {
      request.continue();
    }
  });

  // Expose setter for target country
  pending._setCountry = (cc) => { _targetCountry = cc; };

  page.on("response", async (response) => {
    const url = response.url();
    if (!url.includes("creative_radar_api")) return;
    const endpoint = url.split("?")[0].split("/").slice(-2).join("/");
    const skip = ["filter", "configure", "location", "user", "safety", "tt_info", "initial"];
    if (skip.some(s => endpoint.includes(s))) return;

    try {
      const text = await response.text();
      const json = JSON.parse(text);
      if (json.code !== 0 || !json.data) return;

      // Find the main data array (list, creators, soundList, etc.)
      for (const key of Object.keys(json.data)) {
        if (Array.isArray(json.data[key]) && json.data[key].length > 0) {
          pending[endpoint] = json.data[key];
          break;
        }
      }
    } catch {}
  });

  return pending;
}

async function navigateAndCollect(page, pending, url, endpointKey, { timeout = 20000, forceReload = false } = {}) {
  // Clear any prior data for this key
  delete pending[endpointKey];

  if (forceReload) {
    // Navigate away first to break SPA cache — needed when changing region params
    await page.goto("about:blank", { timeout: 5000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 300));
  }

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout });
  } catch {
    // Timeout is fine — data may have arrived via API before page fully loads
  }

  // Wait for API response
  const deadline = Date.now() + 12000;
  while (!pending[endpointKey] && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 500));
  }

  return pending[endpointKey] || null;
}

// ---------------------------------------------------------------------------
// Trending Hashtags per region
// ---------------------------------------------------------------------------

async function fetchAllHashtags(page, pending) {
  const allTrends = [];

  for (const region of HASHTAG_REGIONS) {
    const label = region.code || "Worldwide";
    const countryParam = region.code ? `&country_code=${region.code}` : "";
    const url = `${CC_BASE}/hashtag/pc/en?period=7&page=1${countryParam}&sort_by=popular`;

    // Force the correct country_code on the API request (SPA auto-detects user location)
    pending._setCountry(region.code);
    console.error(`[tiktok] Fetching hashtags - ${label}...`);

    const list = await navigateAndCollect(page, pending, url, "hashtag/list", { forceReload: true });
    if (!list) {
      console.error(`[tiktok]   ${label}: no data`);
      continue;
    }

    const category = `Trending Hashtags - ${label}`;
    const trends = list.slice(0, 20).map((item) => {
      const views = parseInt(item.video_views) || parseInt(item.publish_cnt) || 0;
      const videos = parseInt(item.publish_cnt) || 0;
      const trendData = item.trend || [];
      const growth = trendData.length >= 2
        ? Math.round(((trendData[trendData.length - 1]?.value || 0) - (trendData[0]?.value || 0)) * 100)
        : 0;
      const growthLabel = growth > 0 ? `+${growth}%` : "";
      const industry = item.industry_info?.value || "";

      // rank_diff_type: 4 = NEW to the chart (never ranked before)
      // rank_diff_type: 1 = rising (was ranked before, climbing)
      const isNew = item.rank_diff_type === 4;
      const isRising = item.rank_diff_type === 1 && (item.rank_diff || 0) > 10;

      const tags = [];
      if (isNew) tags.push("NEW");
      if (isRising) tags.push(`RISING +${item.rank_diff} spots`);
      if (growthLabel) tags.push(growthLabel);
      if (industry) tags.push(industry);

      return {
        title: `#${item.hashtag_name || "unknown"}`,
        description: `${formatCount(views)} views · ${formatCount(videos)} posts${growthLabel ? ` · ${growthLabel} growth` : ""}${isNew ? " · NEW" : ""}${industry ? ` · ${industry}` : ""}`,
        source: "TikTok",
        url: `https://www.tiktok.com/tag/${encodeURIComponent(item.hashtag_name || "")}`,
        volume: views,
        volumeLabel: `${formatCount(views)} views`,
        category,
        timestamp: new Date().toISOString(),
        relatedTerms: tags,
      };
    });

    allTrends.push(...trends);
    console.error(`[tiktok]   ${label}: ${trends.length} hashtags`);
  }

  return allTrends;
}

// ---------------------------------------------------------------------------
// Trending Songs — uses __NEXT_DATA__ SSR (3 items) + API interception
// ---------------------------------------------------------------------------

async function fetchTrendingSongs(page, pending) {
  const url = `${CC_BASE}/music/pc/en?period=7&page=1&sort_by=popular`;
  console.error("[tiktok] Fetching trending songs...");

  // Try API interception first
  const list = await navigateAndCollect(page, pending, url, "sound/rank_list", { forceReload: true });

  // If API interception got data, use it
  if (list && list.length > 0) {
    return parseSongs(list);
  }

  // Fallback: parse __NEXT_DATA__ from the page (only 3 items from SSR)
  console.error("[tiktok]   Falling back to __NEXT_DATA__...");
  try {
    const nextData = await page.evaluate(() => {
      const el = document.getElementById("__NEXT_DATA__");
      if (!el) return null;
      const json = JSON.parse(el.textContent);
      return json?.props?.pageProps?.data?.soundList || null;
    });
    if (nextData && nextData.length > 0) {
      return parseSongs(nextData);
    }
  } catch {}

  console.error("[tiktok]   No songs data");
  return [];
}

function parseSongs(list) {
  return list.slice(0, 20).map((item) => {
    const author = item.author || "";
    const title = item.title || item.clip_name || item.music_name || "Unknown";
    const trendData = item.trend || [];
    const growth = trendData.length >= 2
      ? Math.round(((trendData[trendData.length - 1]?.value || 0) - (trendData[0]?.value || 0)) * 100)
      : 0;
    const growthLabel = growth > 0 ? `+${growth}%` : "";

    return {
      title: `${title}${author ? ` - ${author}` : ""}`,
      description: `Rank #${item.rank || "?"}${growthLabel ? ` · ${growthLabel} growth` : ""}${item.duration ? ` · ${item.duration}s` : ""}`,
      source: "TikTok",
      url: item.link || `https://www.tiktok.com/music/${encodeURIComponent(title)}`,
      volume: item.rank ? (1000 - (item.rank * 10)) : 0,
      volumeLabel: `#${item.rank || "?"}`,
      category: "Trending Songs",
      timestamp: new Date().toISOString(),
      relatedTerms: ["TRENDING SOUND", growthLabel].filter(Boolean),
    };
  });
}

// ---------------------------------------------------------------------------
// Trending Creators
// ---------------------------------------------------------------------------

async function fetchTrendingCreators(page, pending) {
  const url = `${CC_BASE}/creator/pc/en?period=7&page=1&sort_by=follower`;
  console.error("[tiktok] Fetching trending creators...");

  const list = await navigateAndCollect(page, pending, url, "creator/list", { forceReload: true });
  if (!list) {
    console.error("[tiktok]   No creators data");
    return [];
  }

  return list.slice(0, 20).map((item) => {
    const followers = parseInt(item.follower_cnt) || 0;
    const likes = parseInt(item.liked_cnt) || 0;
    const nick = item.nick_name || "Unknown";

    return {
      title: `@${nick}`,
      description: `${formatCount(followers)} followers · ${formatCount(likes)} likes`,
      source: "TikTok",
      url: item.tt_link || `https://www.tiktok.com/@${encodeURIComponent(nick)}`,
      volume: followers,
      volumeLabel: `${formatCount(followers)} followers`,
      category: "Trending Creators",
      timestamp: new Date().toISOString(),
      relatedTerms: ["RISING CREATOR"],
    };
  });
}

// ---------------------------------------------------------------------------
// Category seed fallback via challenge/detail API (pure fetch, no browser)
// ---------------------------------------------------------------------------

async function fetchHashtagStats(name) {
  try {
    const res = await fetch(
      `https://www.tiktok.com/api/challenge/detail/?challengeName=${encodeURIComponent(name)}`,
      { headers: FETCH_HEADERS, signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (data.statusCode !== 0) return null;
    const info = data.challengeInfo || {};
    const statsV2 = info.statsV2 || {};
    const stats = info.stats || {};
    return {
      name,
      views: parseInt(statsV2.viewCount) || parseInt(stats.viewCount) || 0,
      videos: parseInt(statsV2.videoCount) || parseInt(stats.videoCount) || 0,
    };
  } catch {
    return null;
  }
}

async function fetchCategorySeeds(category, seeds) {
  const CONCURRENCY = 50;
  const results = [];

  for (let i = 0; i < seeds.length; i += CONCURRENCY) {
    const batch = seeds.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map(async (name) => {
        let result = await fetchHashtagStats(name);
        if (!result) {
          await new Promise(r => setTimeout(r, 500));
          result = await fetchHashtagStats(name);
        }
        return result;
      })
    );
    for (const s of settled) {
      if (s.status === "fulfilled" && s.value) results.push(s.value);
    }
  }

  const filtered = results.filter(r => r.videos > 50 || r.views > 500_000);
  filtered.sort((a, b) => b.videos - a.videos);

  return filtered.slice(0, 20).map((item) => ({
    title: `#${item.name}`,
    description: `${formatCount(item.videos)} videos · ${formatCount(item.views)} views`,
    source: "TikTok",
    url: `https://www.tiktok.com/tag/${encodeURIComponent(item.name)}`,
    volume: item.videos,
    volumeLabel: `${formatCount(item.videos)} videos`,
    category,
    timestamp: new Date().toISOString(),
    relatedTerms: [],
  }));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  let browser;
  try {
    browser = await launchBrowser();
    const page = (await browser.pages())[0] || await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });

    // Enable request interception to boost Creative Center API limits from 3 → 50
    // and to force the correct country_code (SPA ignores URL params)
    await page.setRequestInterception(true);
    await page.setCacheEnabled(false);
    const pending = setupInterception(page);

    const allTrends = [];

    // ---- Phase 1: Creative Center scraping ----
    console.error("[tiktok] Phase 1: Creative Center trending data...");

    // Trending hashtags per region (16 regions)
    const hashtags = await fetchAllHashtags(page, pending);
    allTrends.push(...hashtags);

    // Trending songs
    const songs = await fetchTrendingSongs(page, pending);
    allTrends.push(...songs);
    console.error(`[tiktok]   Songs: ${songs.length}`);

    // Trending creators
    const creators = await fetchTrendingCreators(page, pending);
    allTrends.push(...creators);
    console.error(`[tiktok]   Creators: ${creators.length}`);

    console.error(`[tiktok] Phase 1 complete: ${allTrends.length} trends from Creative Center`);

    // Close browser — no longer needed
    await browser.close().catch(() => {});
    browser = null;

    // ---- Phase 2: Category seed enrichment via challenge/detail API ----
    console.error(`[tiktok] Phase 2: Fetching ${CATEGORIES.length} content categories via seed hashtags...`);

    const categoryResults = await Promise.allSettled(
      CATEGORIES.map(async (category) => {
        const seeds = CATEGORY_SEEDS[category] || [];
        const trends = await fetchCategorySeeds(category, seeds);
        console.error(`[tiktok]   ${category}: ${trends.length} trends`);
        return trends;
      })
    );

    for (const result of categoryResults) {
      if (result.status === "fulfilled") {
        allTrends.push(...result.value);
      }
    }

    console.error(`[tiktok] Total trends: ${allTrends.length}`);

    emit({
      site: "TikTok",
      url: "https://ads.tiktok.com/business/creativecenter/",
      trends: allTrends,
      partial: false,
    });
  } catch (err) {
    console.error(`[tiktok] Error: ${err.message}`);
    emit({
      site: "TikTok",
      url: "https://ads.tiktok.com/business/creativecenter/",
      trends: [],
      error: err.message,
      partial: false,
    });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

main();
```
