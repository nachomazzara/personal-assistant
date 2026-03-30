export interface Flight {
  price?: string;
  priceRaw?: number;
  airline?: string;
  departure?: string;
  arrival?: string;
  duration?: string;
  durationMin?: number;
  stops?: number;
  stopCities?: string[];
  layovers?: string[];
  provider?: string;
  // return leg
  returnDeparture?: string;
  returnArrival?: string;
  returnDuration?: string;
  returnAirline?: string;
  returnStops?: number;
  // added by app.ts when pooling
  _source?: string;
  _sources?: string[];
  _url?: string;
}

export interface FlexDateEntry {
  departure: string;    // YYYY-MM-DD
  return?: string;      // YYYY-MM-DD (omitted for one-way)
  price: number;
  source?: string;
}

export interface FlightData {
  source?: string;
  site?: string;
  url?: string;
  flights?: Flight[];
  flexDates?: FlexDateEntry[];
  note?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Airline name normalization
// ---------------------------------------------------------------------------
const AIRLINE_NAMES: Record<string, string> = {
  // Normalize casing and abbreviations
  "avianca": "Avianca",
  "copa airlines": "Copa Airlines",
  "copa": "Copa Airlines",
  "latam airlines": "LATAM",
  "latam": "LATAM",
  "la": "LATAM",
  "american airlines": "American Airlines",
  "american": "American Airlines",
  "aa": "American Airlines",
  "delta air lines": "Delta",
  "delta": "Delta",
  "dl": "Delta",
  "united airlines": "United Airlines",
  "united": "United Airlines",
  "ua": "United Airlines",
  "gol linhas aereas": "GOL",
  "gol": "GOL",
  "g3": "GOL",
  "aerolineas argentinas": "Aerolíneas Argentinas",
  "aerolíneas argentinas": "Aerolíneas Argentinas",
  "ar": "Aerolíneas Argentinas",
  "turkish airlines": "Turkish Airlines",
  "tk": "Turkish Airlines",
  "lufthansa": "Lufthansa",
  "lh": "Lufthansa",
  "ita airways": "ITA Airways",
  "ita": "ITA Airways",
  "air europa": "Air Europa",
  "ux": "Air Europa",
  "iberia": "Iberia",
  "ib": "Iberia",
  "qatar airways": "Qatar Airways",
  "qatar": "Qatar Airways",
  "qr": "Qatar Airways",
  "sky airline": "Sky Airline",
  "h2": "Sky Airline",
  "jetsmart": "JetSmart",
  "ja": "JetSmart",
  "arajet": "Arajet",
  "dm": "Arajet",
  "aeromexico": "Aeroméxico",
  "am": "Aeroméxico",
  "air canada": "Air Canada",
  "ac": "Air Canada",
  "emirates": "Emirates",
  "ek": "Emirates",
  "british airways": "British Airways",
  "ba": "British Airways",
  "klm": "KLM",
  "air france": "Air France",
  "af": "Air France",
  "tap portugal": "TAP Portugal",
  "tap": "TAP Portugal",
  "tp": "TAP Portugal",
  "world ticket": "World Ticket",
  "w1": "World Ticket",
  "x1": "X1",
};

function normalizeAirline(name: string): string {
  if (!name) return name;
  const key = name.toLowerCase().trim();
  return AIRLINE_NAMES[key] || name;
}

// ---------------------------------------------------------------------------
// Dedup: merge same flights from different sources, keep cheapest
// ---------------------------------------------------------------------------
function dedupFlights(flights: Flight[]): Flight[] {
  const groups = new Map<string, Flight[]>();

  for (const f of flights) {
    // Normalize before dedup
    if (f.priceRaw != null) f.priceRaw = Math.round(f.priceRaw);
    f.airline = normalizeAirline(f.airline || "");
    if (f.returnAirline) f.returnAirline = normalizeAirline(f.returnAirline);

    const key = [
      f.airline,
      f.departure,
      f.arrival,
      f.durationMin || 0,
    ].join("|");

    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(f);
  }

  const deduped: Flight[] = [];
  for (const group of groups.values()) {
    // Sort by price, keep cheapest
    group.sort((a, b) => (a.priceRaw || Infinity) - (b.priceRaw || Infinity));
    const best = { ...group[0] };

    // Collect all sources
    const sources = new Set<string>();
    for (const f of group) {
      if (f._source) sources.add(f._source);
    }
    best._sources = [...sources];
    best._source = [...sources].join(", ");

    deduped.push(best);
  }

  deduped.sort((a, b) => (a.priceRaw || Infinity) - (b.priceRaw || Infinity));
  return deduped;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
export function renderFlights(data: FlightData, container: HTMLElement): void {
  if (data.error && !data.flights?.length) {
    container.innerHTML = `<div class="source-error">${data.error}</div>`;
    return;
  }

  if (data.note && (!data.flights || data.flights.length === 0)) {
    container.innerHTML = `<div class="source-note">${data.note}</div>`;
    return;
  }

  const flights = (data.flights || []).map((f) => ({
    ...f,
    priceRaw: f.priceRaw != null ? Math.round(f.priceRaw) : f.priceRaw,
    airline: normalizeAirline(f.airline || ""),
    returnAirline: f.returnAirline ? normalizeAirline(f.returnAirline) : f.returnAirline,
  }));

  if (flights.length === 0) {
    container.innerHTML = `<div class="source-error">No flights found</div>`;
    return;
  }

  container.innerHTML = renderCards(flights, false);
}

export function renderCombined(flights: Flight[], container: HTMLElement): void {
  if (flights.length === 0) {
    container.innerHTML = `<div class="source-error">No flights found</div>`;
    return;
  }
  const deduped = dedupFlights(flights);
  container.innerHTML = `
    <div class="combined-header">${deduped.length} unique flights (from ${flights.length} total)</div>
    ${renderCards(deduped, true)}
  `;
}

function formatPrice(f: Flight): string {
  if (f.priceRaw != null) return `$${Math.round(f.priceRaw)}`;
  if (f.price) return f.price.replace(/(\$\d+)\.\d+/, "$1");
  return "—";
}

function isMultiAirline(f: Flight): boolean {
  const name = f.airline || "";
  return name.includes(",") || name.includes("+") || name.includes("/");
}

function renderCards(flights: Flight[], showSource: boolean): string {
  return flights.map((f) => {
    const layoverInfo = f.layovers?.length
      ? `<br><span class="flight-layover">${f.stopCities?.map((c, i) => `${c} ${f.layovers![i] || ""}`).join(", ") || f.layovers.join(", ")}</span>`
      : f.stopCities?.length ? `<br><span class="flight-layover">${f.stopCities.join(", ")}</span>` : "";

    const stopsText = f.stops === 0
      ? `<span class="flight-stops nonstop">Direct</span>`
      : `<span class="flight-stops">${f.stops} stop${f.stops! > 1 ? "s" : ""}${layoverInfo}</span>`;

    const providerText = f.provider
      ? `<span class="flight-provider">via ${f.provider}</span>`
      : "";

    const sourceTag = showSource && f._source
      ? (f._sources || [f._source]).map((s) => `<span class="flight-source-tag">${s}</span>`).join(" ")
      : "";

    const multiTag = isMultiAirline(f)
      ? `<span class="flight-multi-tag">Multi-airline</span>`
      : "";

    const hasReturn = f.returnDeparture || f.returnArrival || f.returnDuration;
    const returnRow = hasReturn ? `
        <div class="flight-return-label">Return</div>
        <div class="flight-airline flight-return">${f.returnAirline || f.airline || "—"}</div>
        <div class="flight-times flight-return">
          <span>${f.returnDeparture || "—"}</span>
          <span class="arrow">→</span>
          <span>${f.returnArrival || "—"}</span>
        </div>
        <div class="flight-duration flight-return">${f.returnDuration || "—"}</div>
        <div class="flight-meta flight-return">
          <span class="flight-stops">${f.returnStops === 0 ? "Direct" : (f.returnStops || "—") + " stop" + ((f.returnStops || 0) > 1 ? "s" : "")}</span>
        </div>` : "";

    return `
      <div class="flight-card ${hasReturn ? "has-return" : ""}" data-price="${f.priceRaw || 0}" data-duration="${f.durationMin || 0}" data-stops="${f.stops ?? 0}" data-source="${f._source || ""}">
        <div class="flight-price">${formatPrice(f)}</div>
        <div class="flight-airline">
          <span>${f.airline || "—"} ${multiTag} ${providerText}</span>
          ${sourceTag ? `<div class="flight-sources">${sourceTag}</div>` : ""}
        </div>
        <div class="flight-times">
          <span>${f.departure || "—"}</span>
          <span class="arrow">→</span>
          <span>${f.arrival || "—"}</span>
        </div>
        <div class="flight-duration">${f.duration || "—"}</div>
        <div class="flight-meta">
          ${stopsText}
        </div>${returnRow}
      </div>
    `;
  }).join("");
}

// ---------------------------------------------------------------------------
// Flex dates: cheapest nearby date combos
// ---------------------------------------------------------------------------
function formatFlexDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function renderFlexDates(
  flexDates: FlexDateEntry[],
  container: HTMLElement,
  currentDep: string,
  currentRet?: string,
  currentCheapestPrice?: number,
  onSearch?: (departure: string, returnDate?: string) => void,
): void {
  if (!flexDates || flexDates.length === 0) {
    container.innerHTML = "";
    return;
  }

  // Dedup by date combo, keep min price
  const byKey = new Map<string, FlexDateEntry>();
  for (const fd of flexDates) {
    const key = `${fd.departure}|${fd.return || ""}`;
    const existing = byKey.get(key);
    if (!existing || fd.price < existing.price) {
      byKey.set(key, fd);
    }
  }
  const sorted = [...byKey.values()].sort((a, b) => a.price - b.price);
  const top = sorted.slice(0, 7);
  if (top.length === 0) { container.innerHTML = ""; return; }

  // Use the actual cheapest flight price as baseline, falling back to flex calendar price for current dates
  const currentKey = `${currentDep}|${currentRet || ""}`;
  const baseline = currentCheapestPrice || byKey.get(currentKey)?.price || 0;

  const cards = top.map((fd, i) => {
    const key = `${fd.departure}|${fd.return || ""}`;
    const isCurrent = key === currentKey;
    const isCheapest = i === 0 && !isCurrent && fd.price < baseline;
    const cls = ["flex-date-card"];
    if (isCurrent) cls.push("current");
    if (isCheapest) cls.push("cheapest");

    const savings = isCurrent || !baseline ? "" : (() => {
      if (fd.price < baseline) {
        const diff = baseline - fd.price;
        return `<span class="flex-savings">Save $${diff}</span>`;
      }
      return "";
    })();

    return `
      <div class="${cls.join(" ")}" data-dep="${fd.departure}" data-ret="${fd.return || ""}">
        <div class="flex-date-price">$${fd.price}</div>
        <div class="flex-date-dates">
          <span>${formatFlexDate(fd.departure)}</span>
          ${fd.return ? `<span class="arrow">→</span><span>${formatFlexDate(fd.return)}</span>` : ""}
        </div>
        ${isCurrent ? '<span class="flex-badge current-badge">Your dates</span>' : ""}
        ${isCheapest ? '<span class="flex-badge cheapest-badge">Cheapest</span>' : ""}
        ${savings}
        ${!isCurrent ? '<button class="flex-search-btn">Search</button>' : ""}
      </div>
    `;
  }).join("");

  container.innerHTML = `
    <div class="flex-dates-section">
      <div class="flex-dates-header">Cheapest nearby dates</div>
      <div class="flex-dates-list">${cards}</div>
    </div>
  `;

  // Bind search buttons
  if (onSearch) {
    container.querySelectorAll(".flex-search-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const card = btn.closest(".flex-date-card") as HTMLElement;
        const dep = card?.dataset.dep;
        const ret = card?.dataset.ret || undefined;
        if (dep) onSearch(dep, ret);
      });
    });
  }
}
