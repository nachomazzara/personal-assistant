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
  // skyscanner
  date?: string;
  priceGroup?: string;
  // added by app.ts when pooling
  _source?: string;
  _url?: string;
}

export interface FlightData {
  source?: string;
  site?: string;
  url?: string;
  flights?: Flight[];
  note?: string;
  error?: string;
}

// Render flights inside a source section (by-source mode)
export function renderFlights(data: FlightData, container: HTMLElement): void {
  if (data.error && !data.flights?.length) {
    container.innerHTML = `<div class="source-error">${data.error}</div>`;
    return;
  }

  if (data.note && (!data.flights || data.flights.length === 0)) {
    container.innerHTML = `<div class="source-note">${data.note}</div>`;
    return;
  }

  const flights = data.flights || [];
  if (flights.length === 0) {
    container.innerHTML = `<div class="source-error">No flights found</div>`;
    return;
  }

  if (flights[0].date != null) {
    renderCalendar(flights, container);
  } else {
    container.innerHTML = renderCards(flights, false);
  }
}

// Render a combined list (all-sources mode)
export function renderCombined(flights: Flight[], container: HTMLElement): void {
  if (flights.length === 0) {
    container.innerHTML = `<div class="source-error">No flights found</div>`;
    return;
  }
  container.innerHTML = renderCards(flights, true);
}

function isMultiAirline(f: Flight): boolean {
  const name = f.airline || "";
  if (name.includes(",") || name.includes("+") || name.includes("/")) return true;
  // Check if stop cities imply different operating carriers (heuristic)
  if ((f.stops || 0) >= 1 && f.provider) return false; // provider doesn't mean multi-airline
  return false;
}

function renderCards(flights: Flight[], showSource: boolean): string {
  return flights.map((f) => {
    const stopsText = f.stops === 0
      ? `<span class="flight-stops nonstop">Direct</span>`
      : `<span class="flight-stops">${f.stops} stop${f.stops! > 1 ? "s" : ""}${f.stopCities?.length ? ` (${f.stopCities.join(", ")})` : ""}</span>`;

    const providerText = f.provider
      ? `<span class="flight-provider">via ${f.provider}</span>`
      : "";

    const sourceTag = showSource && f._source
      ? `<span class="flight-source-tag">${f._source}</span>`
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
        <div class="flight-price">${f.price || "—"}</div>
        <div class="flight-airline">
          ${f.airline || "—"}
          ${multiTag}
          ${providerText}
        </div>
        <div class="flight-times">
          <span>${f.departure || "—"}</span>
          <span class="arrow">→</span>
          <span>${f.arrival || "—"}</span>
        </div>
        <div class="flight-duration">${f.duration || "—"}</div>
        <div class="flight-meta">
          ${stopsText}
          ${sourceTag}
        </div>${returnRow}
      </div>
    `;
  }).join("");
}

function renderCalendar(flights: Flight[], container: HTMLElement): void {
  const html = flights.map((f) => {
    const date = f.date || "";
    const formatted = date ? new Date(date + "T00:00:00").toLocaleDateString("en-US", {
      weekday: "short", month: "short", day: "numeric"
    }) : "—";

    const groupClass = f.priceGroup === "low" ? "tag-low" : f.priceGroup === "high" ? "tag-high" : "tag-mid";

    return `
      <div class="calendar-card" data-price="${f.priceRaw || 0}" data-duration="0">
        <div class="calendar-price">${f.price || "—"}</div>
        <div class="calendar-date">${formatted}</div>
        <span class="calendar-tag ${groupClass}">${f.priceGroup || ""}</span>
      </div>
    `;
  }).join("");

  container.innerHTML = `<div class="calendar-grid">${html}</div>`;
}
