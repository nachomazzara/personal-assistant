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
const priceMinEl = document.getElementById("price-min") as HTMLInputElement;
const priceMaxEl = document.getElementById("price-max") as HTMLInputElement;
const durationMaxEl = document.getElementById("duration-max") as HTMLInputElement;
const priceLabelEl = document.getElementById("price-label") as HTMLElement;
const durationLabelEl = document.getElementById("duration-label") as HTMLElement;
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
let durationRange = { max: 2000 };
let lastArgs: Record<string, string> = {};
let lastCategory = "";

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

      updateFilterBounds();
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
      updateFilterBounds();
      applyFilters();
      if (getFlightCards().length > 0) filtersEl.classList.remove("hidden");
      break;
    }

    case "skill:error": {
      const id = `${msg.category}/${msg.skill}`;
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
  const combinedEl = document.getElementById("combined-results");
  if (combinedEl) combinedEl.remove();
  const flexEl = document.getElementById("flex-dates");
  if (flexEl) flexEl.remove();
  filtersEl.classList.add("hidden");

  lastCategory = s.category;
  lastArgs = { ...s.args };

  setLoading(true);
  ws.send(JSON.stringify({ type: "execute", category: s.category, args: s.args }));
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

  updateFilterBounds();
  applyFilters();
});

// ---------------------------------------------------------------------------
// Prompt submission
// ---------------------------------------------------------------------------
form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || ws.readyState !== WebSocket.OPEN) return;

  results.innerHTML = "";
  sections.clear();
  sourceData.clear();
  const combinedEl = document.getElementById("combined-results");
  if (combinedEl) combinedEl.remove();
  filtersEl.classList.add("hidden");

  setLoading(true);
  ws.send(JSON.stringify({ type: "prompt", text }));
});

function setLoading(loading: boolean) {
  btn.disabled = loading;
  input.disabled = loading;
  if (!loading) input.focus();
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------
function getFlightCards(): HTMLElement[] {
  return Array.from(results.querySelectorAll(".flight-card"));
}

function updateFilterBounds() {
  const cards = getFlightCards();
  let minP = Infinity, maxP = 0, maxD = 0;
  for (const card of cards) {
    const p = parseFloat(card.dataset.price || "0");
    const d = parseFloat(card.dataset.duration || "0");
    if (p > 0 && p < minP) minP = p;
    if (p > maxP) maxP = p;
    if (d > maxD) maxD = d;
  }

  if (minP === Infinity) minP = 0;
  durationRange = { max: maxD || 2000 };

  priceMinEl.min = "0";
  priceMinEl.max = String(maxP);
  priceMinEl.value = "0";
  priceMaxEl.min = "0";
  priceMaxEl.max = String(maxP);
  priceMaxEl.value = String(maxP);
  durationMaxEl.min = "0";
  durationMaxEl.max = String(durationRange.max);
  durationMaxEl.value = String(durationRange.max);

  updateFilterLabels();
}

function updateFilterLabels() {
  const pMin = parseInt(priceMinEl.value);
  const pMax = parseInt(priceMaxEl.value);
  const dMax = parseInt(durationMaxEl.value);
  priceLabelEl.textContent = `$${pMin} – $${pMax}`;
  durationLabelEl.textContent = dMax >= durationRange.max ? "Any" : `${Math.floor(dMax / 60)}h ${dMax % 60}m`;
}

let stopsFilter = "any";

function applyFilters() {
  const pMin = parseInt(priceMinEl.value);
  const pMax = parseInt(priceMaxEl.value);
  const dMax = parseInt(durationMaxEl.value);
  const cards = getFlightCards();

  let visible = 0;
  for (const card of cards) {
    const p = parseFloat(card.dataset.price || "0");
    const d = parseFloat(card.dataset.duration || "0");
    const s = parseInt(card.dataset.stops || "0");

    const priceOk = p === 0 || (p >= pMin && p <= pMax);
    const durationOk = d === 0 || d <= dMax;
    const stopsOk = stopsFilter === "any"
      || (stopsFilter === "0" && s === 0)
      || (stopsFilter === "1" && s === 1)
      || (stopsFilter === "2" && s >= 2);
    const show = priceOk && durationOk && stopsOk;

    card.classList.toggle("filtered", !show);
    if (show) visible++;
  }

  filterCountEl.textContent = `${visible} of ${cards.length} flights`;
  updateFilterLabels();
}

priceMinEl.addEventListener("input", applyFilters);
priceMaxEl.addEventListener("input", applyFilters);
durationMaxEl.addEventListener("input", applyFilters);

document.querySelectorAll(".stop-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".stop-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    stopsFilter = (btn as HTMLElement).dataset.stops || "any";
    applyFilters();
  });
});

filterResetEl.addEventListener("click", () => {
  priceMinEl.value = "0";
  priceMaxEl.value = priceMaxEl.max;
  durationMaxEl.value = durationMaxEl.max;
  stopsFilter = "any";
  document.querySelectorAll(".stop-btn").forEach((b) => b.classList.remove("active"));
  document.querySelector('.stop-btn[data-stops="any"]')?.classList.add("active");
  applyFilters();
});
