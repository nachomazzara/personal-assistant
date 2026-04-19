import { renderFlights, renderCombined, renderFlexDates } from "./renderers/flights.js";
import type { FlexDateEntry } from "./renderers/flights.js";
import { renderTrends, renderTrendsCombined, renderTrendsGrouped, trendDataStore, resetTrendDataStore } from "./renderers/trends.js";
import { renderDefault } from "./renderers/default.js";

// ---------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------
const form = document.getElementById("prompt-form") as HTMLFormElement;
const input = document.getElementById("prompt-input") as HTMLInputElement;
const btn = document.getElementById("prompt-btn") as HTMLButtonElement;
const results = document.getElementById("results") as HTMLElement;
const filtersEl = document.getElementById("filters") as HTMLElement;
const priceFilterEl = document.getElementById("price-filter") as HTMLSelectElement;
const durationFilterEl = document.getElementById("duration-filter") as HTMLSelectElement;
const sourceFilterEl = document.getElementById("source-filter") as HTMLSelectElement;
const categoryFilterEl = document.getElementById("category-filter") as HTMLSelectElement;
const filterCountEl = document.getElementById("filter-count") as HTMLElement;
const filterResetEl = document.getElementById("filter-reset") as HTMLButtonElement;
const viewToggle = document.getElementById("view-toggle") as HTMLButtonElement;
const groupBtn = document.getElementById("group-btn") as HTMLButtonElement;
const homeEl = document.getElementById("home") as HTMLElement;
const homeExamples = document.getElementById("home-examples") as HTMLElement;

// ---------------------------------------------------------------------------
// Home screen
// ---------------------------------------------------------------------------
const categoryExamples: Record<string, { text: string; prompt: string }[]> = {
  flights: [
    { text: "Buenos Aires to New York next month", prompt: "Flights from Buenos Aires to New York next month" },
    { text: "Cheapest flights to Europe from EZE", prompt: "Cheapest flights to Europe from EZE" },
    { text: "EZE to Miami round trip", prompt: "Flights from EZE to Miami round trip next week" },
  ],
  trends: [
    { text: "What's trending right now", prompt: "What's trending right now" },
    { text: "AI trends", prompt: "AI trends" },
    { text: "Teenager trends in social media", prompt: "Teenager trends in social media" },
  ],
};

const categoryPlaceholders: Record<string, string> = {
  flights: "Search flights... (e.g., EZE to JFK next Friday)",
  trends: "Search trends... (e.g., what's trending in AI)",
};

function showHome() {
  homeEl.classList.remove("hidden");
  results.innerHTML = "";
  filtersEl.classList.add("hidden");
  input.placeholder = "What are you looking for?";
  // Reset active state on cards
  homeEl.querySelectorAll(".category-card").forEach((c) => c.classList.remove("active"));
  homeExamples.innerHTML = "";
}

function hideHome() {
  homeEl.classList.add("hidden");
}

function selectCategory(category: string) {
  homeEl.querySelectorAll(".category-card").forEach((c) => c.classList.remove("active"));
  const card = homeEl.querySelector(`[data-category="${category}"]`);
  if (card) card.classList.add("active");

  input.placeholder = categoryPlaceholders[category] || "Search...";
  input.focus();

  const examples = categoryExamples[category] || [];
  homeExamples.innerHTML = examples.map((ex) =>
    `<button class="example-btn" data-prompt="${ex.prompt}">${ex.text}</button>`
  ).join("");

  homeExamples.querySelectorAll(".example-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const prompt = (btn as HTMLElement).dataset.prompt || "";
      input.value = prompt;
      hideHome();
      setLoading(true);
      ws.send(JSON.stringify({ type: "prompt", text: prompt }));
    });
  });
}

homeEl.querySelectorAll(".category-card").forEach((card) => {
  card.addEventListener("click", () => {
    const category = (card as HTMLElement).dataset.category || "";
    selectCategory(category);
  });
});

// ---------------------------------------------------------------------------
// Renderers registry
// ---------------------------------------------------------------------------
const renderers: Record<string, (data: any, container: HTMLElement) => void> = {
  flights: renderFlights,
  trends: renderTrends,
};

function renderSkillData(category: string, data: any, container: HTMLElement) {
  const fn = renderers[category] || renderDefault;
  fn(data, container);
}

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------
let ws: WebSocket;

function connect() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${proto}//${location.host}/ws`);
  ws.onopen = () => console.log("[ws] connected");
  ws.onmessage = (e) => handleMessage(JSON.parse(e.data));
  ws.onclose = () => setTimeout(connect, 2000);
}

connect();

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const sections = new Map<string, HTMLElement>();
const sourceData = new Map<string, any>();
let viewMode: "by-source" | "combined" = "by-source";
let lastArgs: Record<string, string> = {};
let lastCategory = "";
let activeSkills = new Set<string>();
const skillPriority = new Map<string, string>();
let lastProviderPriority: Record<string, string[]> | undefined;
let groupedTrendsData: { trends: any[]; groups: { label: string; description: string; items: number[] }[] } | null = null;

// ---------------------------------------------------------------------------
// Search status banner
// ---------------------------------------------------------------------------
function updateSearchBanner() {
  let banner = document.getElementById("search-banner");
  if (activeSkills.size === 0) {
    if (banner) banner.remove();
    return;
  }
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "search-banner";
    results.insertBefore(banner, results.firstChild);
  } else if (banner !== results.firstChild) {
    results.insertBefore(banner, results.firstChild);
  }

  // Group active skills by priority
  const tiers: Record<string, string[]> = { top: [], medium: [], low: [] };
  for (const id of activeSkills) {
    const p = skillPriority.get(id) || "top";
    const name = id.split("/").pop() || id;
    if (!tiers[p]) tiers[p] = [];
    tiers[p].push(name);
  }

  const parts: string[] = [];
  if (tiers.top.length) parts.push(`<span class="tier tier-top">${tiers.top.length} top</span> <span class="tier-names">${tiers.top.join(", ")}</span>`);
  if (tiers.medium.length) parts.push(`<span class="tier tier-mid">${tiers.medium.length} mid</span> <span class="tier-names">${tiers.medium.join(", ")}</span>`);
  if (tiers.low.length) parts.push(`<span class="tier tier-low">${tiers.low.length} low</span> <span class="tier-names">${tiers.low.join(", ")}</span>`);

  banner.innerHTML = `<span class="banner-dot"></span> Searching ${activeSkills.size} providers: ${parts.join(" · ")}`;
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------
function handleMessage(msg: any) {
  switch (msg.type) {
    case "routing": {
      hideHome();
      results.innerHTML = `<div class="suggestions-loading">Finding the best search for you...</div>`;
      break;
    }

    case "suggestions": {
      const suggestions: { label: string; category: string; args: Record<string, string> }[] = msg.suggestions;
      lastProviderPriority = msg.providerPriority;
      results.innerHTML = `
        <div class="suggestions">
          <h3>Pick a search</h3>
          ${suggestions.map((s, i) => `
            <button class="suggestion-btn" data-index="${i}">
              <span class="suggestion-label">${s.label}</span>
              <span class="suggestion-detail">${formatArgs(s.args)}</span>
            </button>
          `).join("")}
        </div>
      `;

      // Bind click handlers
      results.querySelectorAll(".suggestion-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const idx = parseInt((btn as HTMLElement).dataset.index || "0");
          const pick = suggestions[idx];
          executeSuggestion(pick);
        });
      });

      setLoading(false);
      break;
    }

    case "skill:start": {
      const id = `${msg.category}/${msg.skill}`;
      activeSkills.add(id);
      if (msg.priority) skillPriority.set(id, msg.priority);
      updateSearchBanner();
      const section = document.createElement("div");
      section.className = "source-section";
      section.dataset.id = id;
      section.innerHTML = `
        <div class="source-header">
          <span class="status loading"></span>
          <span>${msg.skill}</span>
        </div>
        <div class="source-body">
          <div class="skeleton"></div>
          <div class="skeleton"></div>
          <div class="skeleton"></div>
        </div>
      `;
      results.appendChild(section);
      sections.set(id, section);
      break;
    }

    case "skill:update": {
      const uid = `${msg.category}/${msg.skill}`;
      const usection = sections.get(uid);
      if (!usection) break;

      const udata = msg.data as any;
      udata.site = udata.site || msg.skill;
      sourceData.set(uid, udata);

      if (viewMode === "by-source") {
        const ubody = usection.querySelector(".source-body") as HTMLElement;
        renderSkillData(msg.category, udata, ubody);
      } else {
        renderCombinedView();
      }

      updateSourceFilter();
      updateCategoryFilter();
      applyFilters();
      if (getResultCards().length > 0) filtersEl.classList.remove("hidden");

      updateFlexDates();

      const itemsKey = Object.keys(udata).find((k) => Array.isArray(udata[k]) && udata[k].length > 0);
      const itemCount = itemsKey ? udata[itemsKey].length : 0;
      const header = usection.querySelector(".source-header span:last-of-type");
      if (header) header.textContent = `${msg.skill} (${itemCount} results...)`;
      break;
    }

    case "skill:done": {
      const id = `${msg.category}/${msg.skill}`;
      activeSkills.delete(id);
      updateSearchBanner();
      const section = sections.get(id);
      if (!section) break;

      const status = section.querySelector(".status")!;
      status.classList.remove("loading");
      status.classList.add("done");

      if (msg.data?.url) {
        const header = section.querySelector(".source-header")!;
        const link = document.createElement("a");
        link.href = msg.data.url;
        link.target = "_blank";
        link.textContent = "Open ↗";
        header.appendChild(link);
      }

      const data = msg.data as any;
      data.site = data.site || msg.skill;
      sourceData.set(id, data);

      const doneItemsKey = Object.keys(data).find((k: string) => Array.isArray(data[k]) && data[k].length > 0);
      const finalCount = doneItemsKey ? data[doneItemsKey].length : 0;
      const nameSpan = section.querySelector(".source-header span:last-of-type");
      if (nameSpan) nameSpan.textContent = `${msg.skill} (${finalCount})`;

      if (viewMode === "by-source") {
        const body = section.querySelector(".source-body") as HTMLElement;
        renderSkillData(msg.category, data, body);
      } else {
        renderCombinedView();
      }

      updateFlexDates();
      updateSourceFilter();
      updateCategoryFilter();
      applyFilters();
      if (getResultCards().length > 0) filtersEl.classList.remove("hidden");
      break;
    }

    case "skill:error": {
      const id = `${msg.category}/${msg.skill}`;
      activeSkills.delete(id);
      updateSearchBanner();
      const section = sections.get(id);
      if (!section) break;
      const status = section.querySelector(".status")!;
      status.classList.remove("loading");
      status.classList.add("error");
      const body = section.querySelector(".source-body") as HTMLElement;
      body.innerHTML = `<div class="source-error">${msg.error}</div>`;
      break;
    }

    case "done":
      activeSkills.clear();
      updateSearchBanner();
      setLoading(false);
      break;

    case "trends:grouping": {
      // LLM is working — button already shows "Grouping..."
      break;
    }

    case "trends:grouped": {
      const { trends: allTrends, groups } = msg as any;
      if (!groups || !allTrends) break;
      groupedTrendsData = { trends: allTrends, groups };
      stopGroupTimer();
      groupBtn.classList.remove("loading");
      groupBtn.textContent = "Refresh groups";
      // Switch to combined/grouped view
      viewMode = "combined";
      viewToggle.textContent = "By source";
      renderGroupedView();
      updateSourceFilter();
      updateCategoryFilter();
      applyFilters();
      if (getResultCards().length > 0) filtersEl.classList.remove("hidden");
      break;
    }

    case "prompt:generating": {
      // Modal already shows "Generating..." via the button state
      break;
    }

    case "prompt:result": {
      const r = msg.result as { hook: string; concept: string; prompt: string; hashtags: string[] };
      lastPromptResult = r;
      modalGenerate.disabled = false;
      modalGenerate.textContent = "Generate Video Prompt";
      modalResultHook.textContent = r.hook;
      modalResultConcept.textContent = r.concept;
      modalResultPrompt.textContent = r.prompt;
      modalResultHashtags.innerHTML = r.hashtags.map((h: string) => `<span class="trend-tag">#${h}</span>`).join("");
      modalResultEl.classList.remove("hidden");
      break;
    }

    case "prompt:error": {
      modalGenerate.disabled = false;
      modalGenerate.textContent = "Generate Video Prompt";
      modalResultEl.classList.remove("hidden");
      modalResultHook.textContent = "";
      modalResultConcept.textContent = msg.message || "Generation failed";
      modalResultPrompt.textContent = "";
      modalResultHashtags.innerHTML = "";
      break;
    }

    case "error":
      setLoading(false);
      // Reset group button if it was loading
      if (groupBtn.classList.contains("loading")) {
        stopGroupTimer();
        groupBtn.classList.remove("loading");
        groupBtn.textContent = "Group with AI";
      }
      // Don't wipe existing results — show error inline instead
      if (results.children.length > 0 && sourceData.size > 0) {
        const errEl = document.createElement("div");
        errEl.className = "source-error";
        errEl.textContent = msg.message;
        results.insertBefore(errEl, results.firstChild);
      } else {
        results.innerHTML = `<div class="source-error">${msg.message}</div>`;
      }
      break;
  }
}

// ---------------------------------------------------------------------------
// Suggestion helpers
// ---------------------------------------------------------------------------
function formatArgs(args: Record<string, string>): string {
  return Object.entries(args).map(([k, v]) => `${k}: ${v}`).join(" · ");
}

function executeSuggestion(s: { label: string; category: string; args: Record<string, string> }) {
  results.innerHTML = "";
  sections.clear();
  sourceData.clear();
  activeSkills.clear();
  skillPriority.clear();
  knownSources.clear();
  resetTrendDataStore();
  sourceFilterEl.innerHTML = '<option value="any">All sources</option>';
  categoryFilterEl.innerHTML = '<option value="any">All categories</option>';
  categoryFilter = "any";
  const combinedEl = document.getElementById("combined-results");
  if (combinedEl) combinedEl.remove();
  const flexEl = document.getElementById("flex-dates");
  if (flexEl) flexEl.remove();
  filtersEl.classList.add("hidden");

  lastCategory = s.category;
  lastArgs = { ...s.args };
  groupedTrendsData = null;
  stopGroupTimer();
  groupBtn.classList.remove("loading");
  groupBtn.textContent = "Group with AI";
  updateFiltersForCategory();

  // Show selected search in the input field with route details
  const details = [s.args.from, "→", s.args.to, s.args.departure, s.args.return].filter(Boolean).join(" ");
  input.value = s.label ? `${s.label} · ${details}` : details;

  setLoading(true);
  ws.send(JSON.stringify({ type: "execute", category: s.category, args: s.args, providerPriority: lastProviderPriority }));
}

// ---------------------------------------------------------------------------
// Flex dates aggregation
// ---------------------------------------------------------------------------
function aggregateFlexDates(): FlexDateEntry[] {
  const all: FlexDateEntry[] = [];
  for (const [id, data] of sourceData) {
    if (!data.flexDates || data.flexDates.length === 0) continue;
    const siteName = data.site || id.split("/")[1] || "";
    for (const fd of data.flexDates) {
      all.push({ ...fd, source: siteName });
    }
  }
  return all;
}

function getCheapestFlightPrice(): number | undefined {
  let min = Infinity;
  for (const data of sourceData.values()) {
    if (!data.flights) continue;
    for (const f of data.flights) {
      if (f.priceRaw && f.priceRaw < min) min = f.priceRaw;
    }
  }
  return min === Infinity ? undefined : min;
}

function updateFlexDates() {
  const flexDates = aggregateFlexDates();
  if (flexDates.length === 0) return;

  let flexEl = document.getElementById("flex-dates");
  if (!flexEl) {
    flexEl = document.createElement("div");
    flexEl.id = "flex-dates";
    results.insertBefore(flexEl, results.firstChild);
  }

  const cheapest = getCheapestFlightPrice();
  renderFlexDates(flexDates, flexEl, lastArgs["departure"] || "", lastArgs["return"], cheapest, (dep, ret) => {
    const newArgs: Record<string, string> = { ...lastArgs, departure: dep };
    if (ret) newArgs["return"] = ret; else delete newArgs["return"];
    executeSuggestion({ label: "", category: lastCategory, args: newArgs });
  });
}

// ---------------------------------------------------------------------------
// Combined view
// ---------------------------------------------------------------------------
function getAllItems(): any[] {
  const all: any[] = [];
  for (const [id, data] of sourceData) {
    // Look for the first array property (flights, hotels, etc.)
    const itemsKey = Object.keys(data).find((k) => Array.isArray(data[k]) && data[k].length > 0);
    if (!itemsKey) continue;

    const siteName = data.site || id.split("/")[1] || "";
    for (const item of data[itemsKey]) {
      all.push({ ...item, _source: siteName, _url: data.url });
    }
  }
  if (lastCategory === "trends") {
    all.sort((a, b) => (b.volume || 0) - (a.volume || 0));
  } else {
    all.sort((a, b) => (a.priceRaw || Infinity) - (b.priceRaw || Infinity));
  }
  return all;
}

function getOrCreateCombinedEl(): HTMLElement {
  let el = document.getElementById("combined-results");
  if (!el) {
    el = document.createElement("div");
    el.id = "combined-results";
    el.className = "source-section";
    results.appendChild(el);
  }
  el.style.display = "";
  return el;
}

function renderCombinedView() {
  for (const section of sections.values()) {
    section.style.display = "none";
  }

  const combinedEl = getOrCreateCombinedEl();

  // For trends, use LLM-grouped data if available
  if (lastCategory === "trends" && groupedTrendsData) {
    renderTrendsGrouped(groupedTrendsData.trends, groupedTrendsData.groups, combinedEl);
    return;
  }

  const items = getAllItems();
  if (lastCategory === "trends") {
    renderTrendsCombined(items, combinedEl);
  } else {
    renderCombined(items, combinedEl);
  }
}

function renderGroupedView() {
  if (!groupedTrendsData) return;
  for (const section of sections.values()) {
    section.style.display = "none";
  }
  const combinedEl = getOrCreateCombinedEl();
  renderTrendsGrouped(groupedTrendsData.trends, groupedTrendsData.groups, combinedEl);
}

function renderBySourceView() {
  const combinedEl = document.getElementById("combined-results");
  if (combinedEl) combinedEl.style.display = "none";

  for (const [id, section] of sections) {
    section.style.display = "";
    const data = sourceData.get(id);
    if (data) {
      const category = id.split("/")[0] || "";
      const body = section.querySelector(".source-body") as HTMLElement;
      if (body) renderSkillData(category, data, body);
    }
  }
}

// ---------------------------------------------------------------------------
// View toggle
// ---------------------------------------------------------------------------
viewToggle.addEventListener("click", () => {
  viewMode = viewMode === "by-source" ? "combined" : "by-source";
  viewToggle.textContent = viewMode === "combined" ? "By source" : "All combined";

  if (viewMode === "combined") {
    renderCombinedView();
  } else {
    renderBySourceView();
  }

  updateCategoryFilter();
  applyFilters();
});

// ---------------------------------------------------------------------------
// Prompt submission
// ---------------------------------------------------------------------------
form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || ws.readyState !== WebSocket.OPEN) return;

  // Cancel running search if any
  if (isSearching) {
    ws.send(JSON.stringify({ type: "cancel" }));
  }

  results.innerHTML = "";
  sections.clear();
  sourceData.clear();
  activeSkills.clear();
  skillPriority.clear();
  knownSources.clear();
  knownCategories.clear();
  resetTrendDataStore();
  sourceFilterEl.innerHTML = '<option value="any">All sources</option>';
  categoryFilterEl.innerHTML = '<option value="any">All categories</option>';
  categoryFilter = "any";
  const combinedEl = document.getElementById("combined-results");
  if (combinedEl) combinedEl.remove();
  const flexEl = document.getElementById("flex-dates");
  if (flexEl) flexEl.remove();
  const bannerEl = document.getElementById("search-banner");
  if (bannerEl) bannerEl.remove();
  filtersEl.classList.add("hidden");

  hideHome();
  setLoading(true);
  ws.send(JSON.stringify({ type: "prompt", text }));
});

// Show home when input is fully cleared
input.addEventListener("input", () => {
  if (!input.value.trim() && !isSearching) {
    showHome();
  }
});

let isSearching = false;

function setLoading(loading: boolean) {
  isSearching = loading;
  // Keep both input and button always enabled so user can cancel by starting a new search
  btn.disabled = false;
  input.disabled = false;
  if (!loading) input.focus();
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------
function getResultCards(): HTMLElement[] {
  return Array.from(results.querySelectorAll(".flight-card, .trend-card, .trend-group"));
}

function getFlightCards(): HTMLElement[] {
  return Array.from(results.querySelectorAll(".flight-card"));
}

let stopsFilter = "any";
let categoryFilter = "any";
const knownSources = new Set<string>();
const knownCategories = new Set<string>();

function updateSourceFilter() {
  // Collect all source names from sourceData
  for (const data of sourceData.values()) {
    const site = data.site || "";
    if (site) knownSources.add(site);
  }
  // Rebuild options
  const current = sourceFilterEl.value;
  sourceFilterEl.innerHTML = '<option value="any">All sources</option>';
  for (const src of [...knownSources].sort()) {
    const opt = document.createElement("option");
    opt.value = src;
    opt.textContent = src;
    sourceFilterEl.appendChild(opt);
  }
  sourceFilterEl.value = current;
}

function updateCategoryFilter() {
  // Collect all categories from trend cards
  knownCategories.clear();
  const cards = getResultCards();
  for (const card of cards) {
    const cat = card.dataset.source ? card.querySelector(".trend-category")?.textContent : "";
    if (cat && cat.trim()) {
      knownCategories.add(cat.trim());
    }
  }
  // Rebuild options
  const current = categoryFilterEl.value;
  categoryFilterEl.innerHTML = '<option value="any">All categories</option>';
  for (const cat of [...knownCategories].sort()) {
    const opt = document.createElement("option");
    opt.value = cat;
    opt.textContent = cat;
    categoryFilterEl.appendChild(opt);
  }
  categoryFilterEl.value = current;
}

function updateFiltersForCategory() {
  if (lastCategory === "trends") {
    filtersEl.classList.add("trends-mode");
    groupBtn.classList.remove("hidden");
  } else {
    filtersEl.classList.remove("trends-mode");
    groupBtn.classList.add("hidden");
  }
}

let groupTimer: ReturnType<typeof setInterval> | null = null;

groupBtn.addEventListener("click", () => {
  if (groupBtn.classList.contains("loading")) return;
  groupBtn.classList.add("loading");
  const start = Date.now();
  groupBtn.textContent = "Grouping... 0s";
  groupTimer = setInterval(() => {
    const elapsed = Math.floor((Date.now() - start) / 1000);
    groupBtn.textContent = `Grouping... ${elapsed}s`;
  }, 1000);
  ws.send(JSON.stringify({ type: "group-trends" }));
});

function stopGroupTimer() {
  if (groupTimer) { clearInterval(groupTimer); groupTimer = null; }
}

function applyFilters() {
  const sourceFilter = sourceFilterEl.value;
  const isTrends = lastCategory === "trends";
  const cards = isTrends ? getResultCards() : getFlightCards();

  const priceMax = priceFilterEl.value === "any" ? Infinity : parseInt(priceFilterEl.value);
  const durationMax = durationFilterEl.value === "any" ? Infinity : parseInt(durationFilterEl.value);

  let visible = 0;
  for (const card of cards) {
    let show = true;

    // Source filter (works for both)
    const src = card.dataset.source || "";
    if (sourceFilter !== "any") {
      if (src) {
        show = src.includes(sourceFilter);
      } else {
        const section = card.closest(".source-section") as HTMLElement;
        const sectionId = section?.dataset.id || "";
        const sectionSite = sourceData.get(sectionId)?.site || "";
        show = sectionSite.includes(sourceFilter);
      }
    }

    // Category filter (trends only)
    if (show && isTrends && categoryFilter !== "any") {
      const catEl = card.querySelector(".trend-category");
      const catText = catEl?.textContent?.trim() || "";
      show = catText === categoryFilter;
    }

    // Flight-specific filters
    if (show && !isTrends) {
      const p = parseFloat(card.dataset.price || "0");
      const d = parseFloat(card.dataset.duration || "0");
      const s = parseInt(card.dataset.stops || "0");
      const priceOk = p === 0 || p <= priceMax;
      const durationOk = d === 0 || d <= durationMax;
      const stopsOk = stopsFilter === "any"
        || (stopsFilter === "0" && s === 0)
        || (stopsFilter === "1" && s === 1)
        || (stopsFilter === "2" && s >= 2);
      show = priceOk && durationOk && stopsOk;
    }

    card.classList.toggle("filtered", !show);
    if (show) visible++;
  }

  filterCountEl.textContent = `${visible} of ${cards.length}`;

  // Hide source sections with zero visible cards
  const cardSelector = isTrends ? ".flight-card, .trend-card" : ".flight-card";
  for (const section of sections.values()) {
    const sectionCards = section.querySelectorAll(cardSelector);
    const sectionVisible = [...sectionCards].filter((c) => !c.classList.contains("filtered")).length;
    section.classList.toggle("section-hidden", sectionCards.length > 0 && sectionVisible === 0);
  }
}

priceFilterEl.addEventListener("change", applyFilters);
durationFilterEl.addEventListener("change", applyFilters);
sourceFilterEl.addEventListener("change", applyFilters);
categoryFilterEl.addEventListener("change", () => {
  categoryFilter = categoryFilterEl.value;
  applyFilters();
});

document.querySelectorAll(".stop-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".stop-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    stopsFilter = (btn as HTMLElement).dataset.stops || "any";
    applyFilters();
  });
});

filterResetEl.addEventListener("click", () => {
  priceFilterEl.value = "any";
  durationFilterEl.value = "any";
  sourceFilterEl.value = "any";
  categoryFilterEl.value = "any";
  categoryFilter = "any";
  stopsFilter = "any";
  document.querySelectorAll(".stop-btn").forEach((b) => b.classList.remove("active"));
  document.querySelector('.stop-btn[data-stops="any"]')?.classList.add("active");
  applyFilters();
});

// ---------------------------------------------------------------------------
// Connect modal — generate video prompt from a trend + user topic
// ---------------------------------------------------------------------------
const modal = document.createElement("div");
modal.id = "prompt-modal";
modal.className = "prompt-modal hidden";
modal.innerHTML = `
  <div class="prompt-modal-backdrop"></div>
  <div class="prompt-modal-content">
    <button class="prompt-modal-close">&times;</button>
    <div class="prompt-modal-header">
      <div class="prompt-modal-trend-title"></div>
      <div class="prompt-modal-trend-desc"></div>
      <div class="prompt-modal-trend-source"></div>
    </div>
    <div class="prompt-modal-body">
      <label class="prompt-modal-label">Connect this trend to your topic:</label>
      <textarea class="prompt-modal-input" rows="3" placeholder="e.g., Decentraland - social hug&#10;&#10;Describe the brand, product, or concept you want to relate this trend to"></textarea>
      <button class="prompt-modal-generate">Generate Video Prompt</button>
    </div>
    <div class="prompt-modal-result hidden">
      <div class="prompt-modal-result-section">
        <div class="prompt-modal-result-label">Hook</div>
        <div class="prompt-modal-result-hook"></div>
      </div>
      <div class="prompt-modal-result-section">
        <div class="prompt-modal-result-label">Concept</div>
        <div class="prompt-modal-result-concept"></div>
      </div>
      <div class="prompt-modal-result-section">
        <div class="prompt-modal-result-label">Video Generation Prompt</div>
        <div class="prompt-modal-result-prompt"></div>
      </div>
      <div class="prompt-modal-result-section">
        <div class="prompt-modal-result-hashtags"></div>
      </div>
      <div class="prompt-modal-actions">
        <button class="prompt-modal-copy" data-target="prompt">Copy prompt</button>
        <button class="prompt-modal-copy" data-target="all">Copy all</button>
        <button class="prompt-modal-retry">Try again</button>
      </div>
    </div>
  </div>
`;
document.body.appendChild(modal);

const modalBackdrop = modal.querySelector(".prompt-modal-backdrop") as HTMLElement;
const modalClose = modal.querySelector(".prompt-modal-close") as HTMLElement;
const modalTitle = modal.querySelector(".prompt-modal-trend-title") as HTMLElement;
const modalDesc = modal.querySelector(".prompt-modal-trend-desc") as HTMLElement;
const modalSource = modal.querySelector(".prompt-modal-trend-source") as HTMLElement;
const modalInput = modal.querySelector(".prompt-modal-input") as HTMLTextAreaElement;
const modalGenerate = modal.querySelector(".prompt-modal-generate") as HTMLButtonElement;
const modalResultEl = modal.querySelector(".prompt-modal-result") as HTMLElement;
const modalResultHook = modal.querySelector(".prompt-modal-result-hook") as HTMLElement;
const modalResultConcept = modal.querySelector(".prompt-modal-result-concept") as HTMLElement;
const modalResultPrompt = modal.querySelector(".prompt-modal-result-prompt") as HTMLElement;
const modalResultHashtags = modal.querySelector(".prompt-modal-result-hashtags") as HTMLElement;
const modalRetry = modal.querySelector(".prompt-modal-retry") as HTMLElement;

let currentModalTrend: { title: string; description: string; source: string; url?: string; relatedTerms?: string[]; category?: string } | null = null;
let lastPromptResult: { hook: string; concept: string; prompt: string; hashtags: string[] } | null = null;

function openModal(trendId: string) {
  const data = trendDataStore.get(trendId);
  if (!data) return;
  currentModalTrend = data;
  lastPromptResult = null;

  modalTitle.textContent = data.title;
  modalDesc.textContent = data.description || "";
  modalDesc.style.display = data.description ? "" : "none";
  modalSource.textContent = data.source;
  modalInput.value = "";
  modalGenerate.disabled = false;
  modalGenerate.textContent = "Generate Video Prompt";
  modalResultEl.classList.add("hidden");

  modal.classList.remove("hidden");
  modalInput.focus();
}

function closeModal() {
  modal.classList.add("hidden");
  currentModalTrend = null;
}

modalBackdrop.addEventListener("click", closeModal);
modalClose.addEventListener("click", closeModal);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !modal.classList.contains("hidden")) closeModal();
});

modalGenerate.addEventListener("click", () => {
  const topic = modalInput.value.trim();
  if (!topic || !currentModalTrend) return;
  modalGenerate.disabled = true;
  modalGenerate.textContent = "Generating...";
  modalResultEl.classList.add("hidden");
  ws.send(JSON.stringify({
    type: "generate-prompt",
    trend: currentModalTrend,
    userTopic: topic,
  }));
});

modalInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    modalGenerate.click();
  }
});

modalRetry.addEventListener("click", () => {
  modalGenerate.disabled = false;
  modalGenerate.textContent = "Generate Video Prompt";
  modalResultEl.classList.add("hidden");
  modalInput.focus();
});

// Copy buttons
modal.querySelectorAll(".prompt-modal-copy").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (!lastPromptResult) return;
    const target = (btn as HTMLElement).dataset.target;
    let text = "";
    if (target === "prompt") {
      text = lastPromptResult.prompt;
    } else {
      text = `Hook: ${lastPromptResult.hook}\n\nConcept: ${lastPromptResult.concept}\n\nVideo Prompt: ${lastPromptResult.prompt}\n\n${lastPromptResult.hashtags.map((h) => `#${h}`).join(" ")}`;
    }
    navigator.clipboard.writeText(text).then(() => {
      const orig = (btn as HTMLElement).textContent;
      (btn as HTMLElement).textContent = "Copied!";
      setTimeout(() => { (btn as HTMLElement).textContent = orig; }, 1500);
    });
  });
});

// Event delegation for Connect buttons on trend cards
results.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest(".trend-prompt-btn");
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  const trendId = (btn as HTMLElement).dataset.trendId || "";
  openModal(trendId);
});
