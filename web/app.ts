import { renderFlights, renderCombined, renderFlexDates } from "./renderers/flights.js";
import type { FlexDateEntry } from "./renderers/flights.js";
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
const filterCountEl = document.getElementById("filter-count") as HTMLElement;
const filterResetEl = document.getElementById("filter-reset") as HTMLButtonElement;
const viewToggle = document.getElementById("view-toggle") as HTMLButtonElement;

// ---------------------------------------------------------------------------
// Renderers registry
// ---------------------------------------------------------------------------
const renderers: Record<string, (data: any, container: HTMLElement) => void> = {
  flights: renderFlights,
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
      applyFilters();
      if (getFlightCards().length > 0) filtersEl.classList.remove("hidden");

      updateFlexDates();

      const itemsKey = Object.keys(udata).find((k) => k === "flights" && Array.isArray(udata[k]));
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

      const doneItemsKey = Object.keys(data).find((k: string) => k === "flights" && Array.isArray(data[k]));
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
      applyFilters();
      if (getFlightCards().length > 0) filtersEl.classList.remove("hidden");
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

    case "error":
      setLoading(false);
      results.innerHTML = `<div class="source-error">${msg.message}</div>`;
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
  sourceFilterEl.innerHTML = '<option value="any">All sources</option>';
  const combinedEl = document.getElementById("combined-results");
  if (combinedEl) combinedEl.remove();
  const flexEl = document.getElementById("flex-dates");
  if (flexEl) flexEl.remove();
  filtersEl.classList.add("hidden");

  lastCategory = s.category;
  lastArgs = { ...s.args };

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
  all.sort((a, b) => (a.priceRaw || Infinity) - (b.priceRaw || Infinity));
  return all;
}

function renderCombinedView() {
  for (const section of sections.values()) {
    section.style.display = "none";
  }

  let combinedEl = document.getElementById("combined-results");
  if (!combinedEl) {
    combinedEl = document.createElement("div");
    combinedEl.id = "combined-results";
    combinedEl.className = "source-section";
    results.appendChild(combinedEl);
  }
  combinedEl.style.display = "";

  const flights = getAllItems();
  renderCombined(flights, combinedEl);
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
  sourceFilterEl.innerHTML = '<option value="any">All sources</option>';
  const combinedEl = document.getElementById("combined-results");
  if (combinedEl) combinedEl.remove();
  const flexEl = document.getElementById("flex-dates");
  if (flexEl) flexEl.remove();
  const bannerEl = document.getElementById("search-banner");
  if (bannerEl) bannerEl.remove();
  filtersEl.classList.add("hidden");

  setLoading(true);
  ws.send(JSON.stringify({ type: "prompt", text }));
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
function getFlightCards(): HTMLElement[] {
  return Array.from(results.querySelectorAll(".flight-card"));
}

let stopsFilter = "any";
const knownSources = new Set<string>();

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

function applyFilters() {
  const priceMax = priceFilterEl.value === "any" ? Infinity : parseInt(priceFilterEl.value);
  const durationMax = durationFilterEl.value === "any" ? Infinity : parseInt(durationFilterEl.value);
  const sourceFilter = sourceFilterEl.value;
  const cards = getFlightCards();

  let visible = 0;
  for (const card of cards) {
    const p = parseFloat(card.dataset.price || "0");
    const d = parseFloat(card.dataset.duration || "0");
    const s = parseInt(card.dataset.stops || "0");
    const src = card.dataset.source || "";

    const priceOk = p === 0 || p <= priceMax;
    const durationOk = d === 0 || d <= durationMax;
    const stopsOk = stopsFilter === "any"
      || (stopsFilter === "0" && s === 0)
      || (stopsFilter === "1" && s === 1)
      || (stopsFilter === "2" && s >= 2);
    // In combined view, _source is on the card; in by-source view, check parent section
    let sourceOk = sourceFilter === "any";
    if (!sourceOk) {
      if (src) {
        sourceOk = src.includes(sourceFilter);
      } else {
        // By-source view: check the section's site name
        const section = card.closest(".source-section") as HTMLElement;
        const sectionId = section?.dataset.id || "";
        const sectionSite = sourceData.get(sectionId)?.site || "";
        sourceOk = sectionSite.includes(sourceFilter);
      }
    }
    const show = priceOk && durationOk && stopsOk && sourceOk;

    card.classList.toggle("filtered", !show);
    if (show) visible++;
  }

  filterCountEl.textContent = `${visible} of ${cards.length}`;

  // Hide source sections with zero visible flights
  for (const section of sections.values()) {
    const sectionCards = section.querySelectorAll(".flight-card");
    const sectionVisible = [...sectionCards].filter((c) => !c.classList.contains("filtered")).length;
    section.classList.toggle("section-hidden", sectionCards.length > 0 && sectionVisible === 0);
  }
}

priceFilterEl.addEventListener("change", applyFilters);
durationFilterEl.addEventListener("change", applyFilters);
sourceFilterEl.addEventListener("change", applyFilters);

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
  stopsFilter = "any";
  document.querySelectorAll(".stop-btn").forEach((b) => b.classList.remove("active"));
  document.querySelector('.stop-btn[data-stops="any"]')?.classList.add("active");
  applyFilters();
});
