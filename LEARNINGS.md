# Technical Learnings

Patterns, gotchas, and strategies discovered while building flight search providers.

## Anti-Bot Patterns

### Skyscanner — PerimeterX (Hardest)
- Requires `rebrowser-puppeteer` (regular puppeteer detected immediately)
- Cannot run headless — needs `headless: false` with window minimized via CDP
- Captcha bypass: simulate mouse press-and-hold for 7s with randomized movement
- User agent + client hints override via CDP `Network.setUserAgentOverride`
- Uses shared Chrome profile (`--user-data-dir`) to persist cookies across runs
- If captcha fails, graceful exit — don't retry endlessly

### Google Flights — Cookie Consent
- May show "Accept all" cookie dialog on first load
- Simple button click bypass: `button[aria-label="Accept all"]`
- No bot detection issues with standard puppeteer-extra + stealth plugin

### Kayak — CSRF Token
- Requires CSRF token extraction from request headers for pagination
- Poll-based API (`flights/poll`) — must wait for results to populate
- Standard stealth plugin sufficient

### Turismocity / Aerolíneas — Minimal
- Standard puppeteer-extra with stealth plugin works fine
- No captcha or bot detection encountered

## API Response Formats

### Google Flights — Nested Arrays (most complex)
- Response starts with `)]}'\n` prefix — must strip before parsing
- May have a numeric line before JSON — strip that too
- Data is `outer[0][2]` which is a JSON string that needs second parse
- Flight data buried 6+ levels deep in nested arrays
- Price at `[priceInfo][1]` or `[priceInfo][0][1]`
- Date grid (GetCalendarGrid): `inner[1][]` = `[depDate, retDate, [[null, price], token], flag]`

### Aerolíneas — Branded Offers
- `brandedOffers["0"]` = outbound flights, `brandedOffers["1"]` = return flights
- Each offer has `legs[0].segments[]` for flight details
- Economy filter: `offers.filter(o => o.cabinClass === 'Economy')`
- Flex calendar: `calendarOffers["0"]` = outbound dates, `calendarOffers["1"]` = return dates
- Flex API needs same auth headers: `Authorization`, `x-channel-id`, `accept-language`

### Turismocity — Stride-Based Arrays (most fragile)
- Itineraries stored as flat arrays with STRIDE=18 elements per flight
- Key indices: [6]=provider, [7]=routeStr, [13]=segStr, [14]=offers, [15]=legData, [17]=fallback price
- Price extraction: regex `\[\d+,"USD",([\d.]+)\]` on stringified offers array
- segStr format: `AIRLINE:FLIGHT:DEP_MIN:AIRLINE:FLIGHT:ARR_MIN:0|return...`
- legData has TWO formats: object with `.flights[]` array, or flat array with flights at index [8]
- Minutes-from-midnight in segStr is reliable fallback for missing departure/arrival times

### Kayak — Merged Poll Responses
- Multiple poll responses need merging (legs map, segments map, airlines map)
- Pagination via POST with `pageNumber` parameter and CSRF headers

## Flex Dates Strategies

### Aerolíneas — Separate API Call
- Page loads with `flexDates=false` for normal flights
- Separate `fetch()` with `flexDates=true` captures `calendarOffers`
- Must reuse same auth token captured from page's API request
- Round-trip: outbound + return prices are per-leg, total = sum
- Returns ~30 dates per leg (full month)

### Google Flights — Date Grid Button
- After normal search, click "Date grid" button
- Intercept `GetCalendarGrid` API response
- Returns departure×return price matrix (49 combos typically)
- Parse: `inner[1][]` entries with `[depDate, retDate, [[null, price]]]`

### Kiwi.com — Native Date Range (best approach)
- API accepts `date_from`/`date_to` range — returns cheapest per date automatically
- No separate call needed, no UI interaction
- Can search entire month in one request

## Price Normalization

- **Always round to integers**: `Math.round(priceRaw)` — Turismocity returns 15+ decimal places
- **Skyscanner EUR→USD**: Hardcoded `1.08` multiplier (should use live rate eventually)
- **Aerolíneas USD**: Use `es-us` locale in URL for USD pricing
- **Format display**: `$${Math.round(priceRaw)}` — never show decimals

## Time Parsing

- **ISO strings**: `"2026-09-15T15:05:00".substring(11, 16)` → `"15:05"`
- **Minutes from midnight**: `minToTime(m) = HH:MM` where `1015` = `16:55` — used by Turismocity segStr
- **Google's time arrays**: `[hours, minutes]` → padded to `HH:MM`
- **Fallback chain**: object.departureTime → array[].departureTime → regex on JSON → segStr minutes

## Kiwi.com — Direct GraphQL API (No Puppeteer!)

- **Endpoint**: `POST https://api.skypicker.com/umbrella/v2/graphql?featureName=SearchReturnItinerariesQuery`
- **No auth needed** — just needs `Origin: https://www.kiwi.com` and `Referer` headers
- **Source ID format**: `Station:airport:EZE` (not just `EZE`)
- **Price is a string**: `amount: "1323"` — needs `parseFloat()`
- **Time field**: `source.localTime` / `destination.localTime` (not `time`)
- **No `limit` option**: GraphQL schema doesn't support it — returns ~50 results by default
- **Round-trip structure**: `outbound` and `inbound` (not `sector[0]`/`sector[1]`)
- **Duration in seconds** at both segment and sector level
- **~2 second response** vs 30-60s for Puppeteer providers
- **Also has price graph API**: `useQuickNavPricesQuery` returns date→price map for flex dates

## Airline Sites vs Aggregators — Key Difference

- **Aggregators** (Google, Skyscanner, Kayak, Turismocity, Kiwi): auto-search when URL has params → intercept API responses
- **Airlines** (Iberia, Emirates, Turkish, LATAM): present a booking form that needs interaction → either fill+submit form via Puppeteer, or reverse-engineer their internal search API
- Airlines fire CMS/config/station APIs on page load, but NOT the flight search API until user submits the form
- For airlines, the two approaches are: (1) use Puppeteer to fill form fields and click Search, then intercept results; (2) find and call their internal search API directly with correct headers/tokens

### Why direct airline scrapers have low ROI
- Our 6 aggregators already show flights from ALL airlines (LATAM, Turkish, Emirates, Iberia, etc.)
- Airline SPAs are complex: custom React date pickers, country redirect dialogs, anti-bot (Akamai)
- Form interaction is fragile — any UI change breaks the scraper
- Only worth it if airlines have exclusive fares not on aggregators (rare)
- **Recommendation**: Focus on more aggregators (Despegar, Momondo) rather than fighting airline SPAs

## Multi-Airport Routing

- Router outputs comma-separated IATA codes: `EZE,AEP` for Buenos Aires
- Orchestrator expands into all from×to combinations
- Each skill runs once per airport combo
- Metro codes: some sites accept them (Turismocity: BUE), most need individual airports
- UI shows airport pair in skill name: `google (EZE→NRT)`

## Provider Priority System

- Router (Haiku) ranks providers as top/medium/low based on route
- Orchestrator sorts jobs by priority, fills batches of maxConcurrent
- Top providers always get slots first, medium fills remaining, low goes last
- Example: EZE→NRT → Google+Skyscanner=top, Kayak+Turismocity=medium, Aerolineas=low
