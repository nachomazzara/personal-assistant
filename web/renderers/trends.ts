// ---------------------------------------------------------------------------
// Trends renderer
// ---------------------------------------------------------------------------

interface TrendItem {
  title: string;
  description?: string;
  source: string;
  url?: string;
  volume?: number;
  volumeLabel?: string;
  category?: string;
  relatedTerms?: string[];
  timestamp?: string;
}

interface TrendData {
  site?: string;
  trends?: TrendItem[];
  error?: string;
}

// ---------------------------------------------------------------------------
// Trend data store — maps IDs to trend info for the Connect button
// ---------------------------------------------------------------------------
export const trendDataStore = new Map<string, { title: string; description: string; source: string; url?: string; relatedTerms?: string[]; category?: string }>();
let _trendIdCounter = 0;

export function resetTrendDataStore() {
  trendDataStore.clear();
  _trendIdCounter = 0;
}

function storeTrend(t: { title: string; description?: string; source: string; url?: string; relatedTerms?: string[]; category?: string }): string {
  const id = `trend-${_trendIdCounter++}`;
  trendDataStore.set(id, {
    title: t.title,
    description: t.description || "",
    source: t.source,
    url: t.url,
    relatedTerms: t.relatedTerms,
    category: t.category,
  });
  return id;
}

function connectBtn(trendId: string): string {
  return `<button class="trend-prompt-btn" data-trend-id="${trendId}" title="Generate video prompt connecting this trend to your topic">Connect</button>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderTag(tag: string): string {
  const upper = tag.toUpperCase();
  const cls = upper === "NEW" || upper === "NEW THIS WEEK" ? "trend-tag trend-tag-new"
    : upper === "RISING" ? "trend-tag trend-tag-rising"
    : upper === "HOT NOW" ? "trend-tag trend-tag-hot"
    : upper === "ORGANIC" ? "trend-tag trend-tag-organic"
    : "trend-tag";
  return `<span class="${cls}">${escapeHtml(tag)}</span>`;
}

function timeAgo(iso: string): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0 || isNaN(diff)) return "";
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function renderTrendCard(t: TrendItem): string {
  const trendId = storeTrend(t);
  const title = escapeHtml(t.title);
  const desc = t.description ? escapeHtml(t.description) : "";
  const vol = t.volumeLabel ? escapeHtml(t.volumeLabel) : "";
  const cat = t.category ? escapeHtml(t.category) : "";
  const time = timeAgo(t.timestamp || "");
  const related = (t.relatedTerms || []).slice(0, 5);
  const href = t.url ? ` href="${escapeHtml(t.url)}" target="_blank"` : "";

  return `<a class="trend-card" data-source="${escapeHtml(t.source)}"${href}>
    <div class="trend-main">
      <span class="trend-title">${title}</span>
      ${desc ? `<span class="trend-desc">${desc}</span>` : ""}
      ${related.length ? `<div class="trend-related">${related.map(renderTag).join("")}</div>` : ""}
    </div>
    <div class="trend-meta">
      ${cat ? `<span class="trend-category">${cat}</span>` : ""}
      ${vol ? `<span class="trend-volume">${vol}</span>` : ""}
      ${time ? `<span class="trend-time">${time}</span>` : ""}
      ${connectBtn(trendId)}
    </div>
  </a>`;
}

export function renderTrends(data: TrendData, container: HTMLElement): void {
  const trends = data.trends || [];
  if (data.error && trends.length === 0) {
    container.innerHTML = `<div class="source-error">${escapeHtml(data.error)}</div>`;
    return;
  }
  if (trends.length === 0) {
    container.innerHTML = `<div class="trend-empty">No trends found</div>`;
    return;
  }
  const sorted = [...trends].sort((a, b) => (b.volume || 0) - (a.volume || 0));
  container.innerHTML = sorted.map(renderTrendCard).join("");
}

// ---------------------------------------------------------------------------
// Combined view — group similar trends across platforms
// ---------------------------------------------------------------------------

interface CombinedItem extends TrendItem {
  _source?: string;
}

interface TrendGroup {
  items: CombinedItem[];
  keywords: Set<string>;
}

function extractKeywords(s: string): string[] {
  return s.toLowerCase()
    .replace(/[#@_\-:,."'!?()\[\]{}]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2)
    // Remove common stop words
    .filter((w) => !["the", "and", "for", "are", "was", "but", "not", "you", "all", "can", "has", "her", "his", "how", "its", "may", "new", "now", "our", "out", "own", "say", "she", "too", "who", "with", "this", "that", "from", "have", "been", "will", "more", "when", "what", "your", "than", "them", "then", "into", "just", "about"].includes(w));
}

function groupSimilarity(groupKw: Set<string>, itemKw: string[]): number {
  if (itemKw.length === 0 || groupKw.size === 0) return 0;
  let overlap = 0;
  for (const w of itemKw) {
    if (groupKw.has(w)) overlap++;
  }
  // Need at least 2 keyword overlap or >50% match
  const ratio = overlap / Math.min(groupKw.size, itemKw.length);
  if (overlap >= 2 && ratio >= 0.4) return ratio;
  if (overlap >= 1 && ratio >= 0.6) return ratio;
  return 0;
}

export function renderTrendsCombined(items: CombinedItem[], container: HTMLElement): void {
  if (items.length === 0) {
    container.innerHTML = `<div class="trend-empty">No trends found</div>`;
    return;
  }

  // Group by keyword similarity
  const groups: TrendGroup[] = [];

  for (const item of items) {
    const kw = extractKeywords(item.title);
    let bestGroup: TrendGroup | null = null;
    let bestScore = 0;

    for (const group of groups) {
      const score = groupSimilarity(group.keywords, kw);
      if (score > bestScore) {
        bestScore = score;
        bestGroup = group;
      }
    }

    if (bestGroup && bestScore >= 0.4) {
      bestGroup.items.push(item);
      for (const w of kw) bestGroup.keywords.add(w);
    } else {
      groups.push({ items: [item], keywords: new Set(kw) });
    }
  }

  // Sort by weighted score: volume is primary, cross-platform is a bonus multiplier
  const sorted = groups.sort((a, b) => {
    const sourcesA = new Set(a.items.map((i) => i._source || i.source)).size;
    const sourcesB = new Set(b.items.map((i) => i._source || i.source)).size;
    const volA = a.items.reduce((s, i) => s + (i.volume || 0), 0);
    const volB = b.items.reduce((s, i) => s + (i.volume || 0), 0);
    // Cross-platform gets a 2x bonus, but volume drives the ranking
    const scoreA = volA * (sourcesA > 1 ? 2 : 1);
    const scoreB = volB * (sourcesB > 1 ? 2 : 1);
    return scoreB - scoreA;
  });

  // Count cross-platform groups
  const crossPlatform = sorted.filter((g) => new Set(g.items.map((i) => i._source || i.source)).size > 1).length;

  let html = `<div class="combined-header">${items.length} trends from all sources`;
  if (crossPlatform > 0) html += ` &middot; <strong>${crossPlatform} cross-platform</strong>`;
  html += `</div>`;

  for (const group of sorted) {
    const sources = [...new Set(group.items.map((i) => i._source || i.source))];
    const totalVol = group.items.reduce((s, i) => s + (i.volume || 0), 0);
    const isCross = sources.length > 1;

    // Pick best title (shortest meaningful one, or highest volume)
    const main = group.items.reduce((best, item) =>
      (item.volume || 0) > (best.volume || 0) ? item : best
    , group.items[0]);

    // Collect all unique descriptions
    const descriptions = group.items
      .map((i) => i.description)
      .filter((d): d is string => !!d && d.length > 10)
      .slice(0, 2);
    const descHtml = descriptions.length > 0
      ? `<span class="trend-desc">${descriptions.map((d) => escapeHtml(d)).join(" &middot; ")}</span>`
      : "";

    // Collect all related terms
    const allRelated = [...new Set(group.items.flatMap((i) => i.relatedTerms || []))].slice(0, 6);

    const dataSources = sources.join(",");
    const href = main.url ? ` href="${escapeHtml(main.url)}" target="_blank"` : "";
    const trendId = storeTrend({
      title: main.title,
      description: descriptions[0] || main.description,
      source: sources.join(", "),
      url: main.url,
      relatedTerms: allRelated,
      category: main.category,
    });

    html += `<a class="trend-card${isCross ? " trend-cross-platform" : ""}" data-source="${escapeHtml(dataSources)}"${href}>
      <div class="trend-main">
        <span class="trend-title">${escapeHtml(main.title)}</span>
        ${descHtml}
        <div class="trend-sources">${sources.map((s) => `<span class="trend-source-tag">${escapeHtml(s)}</span>`).join("")}</div>
        ${allRelated.length ? `<div class="trend-related">${allRelated.map(renderTag).join("")}</div>` : ""}
      </div>
      <div class="trend-meta">
        ${main.category ? `<span class="trend-category">${escapeHtml(main.category)}</span>` : ""}
        ${totalVol ? `<span class="trend-volume">${totalVol.toLocaleString()}</span>` : ""}
        ${isCross ? `<span class="trend-cross">${sources.length} platforms</span>` : ""}
        ${connectBtn(trendId)}
      </div>
    </a>`;
  }
  container.innerHTML = html;
}

// ---------------------------------------------------------------------------
// LLM-grouped view — uses groups from server-side LLM
// ---------------------------------------------------------------------------

export interface LLMGroup {
  label: string;
  description: string;
  items: number[];
}

export function renderTrendsGrouped(
  trends: TrendItem[],
  groups: LLMGroup[],
  container: HTMLElement,
): void {
  if (groups.length === 0) {
    container.innerHTML = `<div class="trend-empty">No groups found</div>`;
    return;
  }

  const crossPlatform = groups.filter((g) => {
    const sources = new Set(g.items.map((i) => trends[i]?.source).filter(Boolean));
    return sources.size > 1;
  }).length;

  // Sort groups by weighted score: volume primary, cross-platform bonus
  const scoredGroups = groups.map((group) => {
    const groupItems = group.items.map((i) => trends[i]).filter(Boolean);
    const sources = new Set(groupItems.map((i) => i.source));
    const totalVol = groupItems.reduce((s, i) => s + (i.volume || 0), 0);
    return { group, groupItems, sources: [...sources], totalVol, isCross: sources.size > 1 };
  }).filter((g) => g.groupItems.length > 0)
    .sort((a, b) => {
      const scoreA = a.totalVol * (a.isCross ? 2 : 1);
      const scoreB = b.totalVol * (b.isCross ? 2 : 1);
      return scoreB - scoreA;
    });

  let html = `<div class="combined-header">${trends.length} trends grouped into ${scoredGroups.length} topics`;
  if (crossPlatform > 0) html += ` &middot; <strong>${crossPlatform} cross-platform</strong>`;
  html += `</div>`;

  for (const { group, groupItems, sources, totalVol, isCross } of scoredGroups) {
    const dataSources = sources.join(",");
    const groupId = `group-${Math.random().toString(36).slice(2, 8)}`;
    const trendId = storeTrend({
      title: group.label,
      description: group.description,
      source: sources.join(", "),
      relatedTerms: groupItems.flatMap((i) => i.relatedTerms || []).slice(0, 8),
      category: groupItems[0]?.category,
    });

    // Sort items within group by volume
    const sortedItems = [...groupItems].sort((a, b) => (b.volume || 0) - (a.volume || 0));

    html += `<div class="trend-group${isCross ? " trend-cross-platform" : ""}" data-source="${escapeHtml(dataSources)}">
      <div class="trend-group-header" data-toggle="${groupId}">
        <div class="trend-main">
          <span class="trend-title">${escapeHtml(group.label)}</span>
          <span class="trend-desc">${escapeHtml(group.description)}</span>
          <div class="trend-sources">${sources.map((s) => `<span class="trend-source-tag">${escapeHtml(s)}</span>`).join("")}</div>
        </div>
        <div class="trend-meta">
          ${totalVol ? `<span class="trend-volume">${totalVol.toLocaleString()}</span>` : ""}
          ${isCross ? `<span class="trend-cross">${sources.length} platforms</span>` : ""}
          ${connectBtn(trendId)}
          <span class="trend-expand">${sortedItems.length} item${sortedItems.length > 1 ? "s" : ""} ▾</span>
        </div>
      </div>
      <div class="trend-group-items" id="${groupId}">
        ${sortedItems.map((item) => {
          const vol = item.volumeLabel ? escapeHtml(item.volumeLabel) : "";
          const time = timeAgo(item.timestamp || "");
          const href = item.url ? ` href="${escapeHtml(item.url)}" target="_blank"` : "";
          return `<a class="trend-subitem"${href}>
            <span class="trend-subitem-source">${escapeHtml(item.source)}</span>
            <span class="trend-subitem-title">${escapeHtml(item.title)}</span>
            ${item.description ? `<span class="trend-subitem-desc">${escapeHtml(item.description).slice(0, 120)}</span>` : ""}
            <span class="trend-subitem-meta">${[vol, time].filter(Boolean).join(" · ")}</span>
          </a>`;
        }).join("")}
      </div>
    </div>`;
  }

  container.innerHTML = html;

  // Toggle expand/collapse
  container.querySelectorAll(".trend-group-header").forEach((header) => {
    header.addEventListener("click", () => {
      const targetId = (header as HTMLElement).dataset.toggle || "";
      const items = document.getElementById(targetId);
      if (!items) return;
      const isOpen = items.classList.contains("open");
      items.classList.toggle("open");
      const arrow = header.querySelector(".trend-expand");
      if (arrow) arrow.textContent = arrow.textContent!.replace(isOpen ? "▴" : "▾", isOpen ? "▾" : "▴");
    });
  });
}
