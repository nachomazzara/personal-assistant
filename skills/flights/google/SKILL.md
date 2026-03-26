---
name: google
description: Search for flights on Google Flights.
---

# Command

```bash
node skills/flights/google/search.mjs --from {IATA} --to {IATA} --departure {YYYY-MM-DD} [--return {YYYY-MM-DD}]
```

# Output format

JSON to stdout: `{ "site": "Google Flights", "url": "...", "flights": [...] }`

# Rules

- Run the command above with the correct IATA codes and dates from the user's request.
- Your response must be ONLY the raw JSON from stdout. No other text.

## Script

```javascript
#!/usr/bin/env node
import puppeteerExtra from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
puppeteerExtra.use(StealthPlugin())

const args = process.argv.slice(2)
const getArg = (n) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : null }
const from = getArg('from'), to = getArg('to'), departure = getArg('departure'), returnDate = getArg('return')
const wait = (ms) => new Promise(r => setTimeout(r, ms))

if (!from || !to || !departure) { console.error('Usage: search.mjs --from IATA --to IATA --departure YYYY-MM-DD [--return YYYY-MM-DD]'); process.exit(1) }

function parseResponse(raw) {
  const results = []
  try {
    let cleaned = raw
    if (cleaned.startsWith(")]}'")) cleaned = cleaned.substring(4)
    cleaned = cleaned.trim()
    const nlIdx = cleaned.indexOf('\n')
    if (nlIdx > 0 && nlIdx < 10 && /^\d+$/.test(cleaned.substring(0, nlIdx))) cleaned = cleaned.substring(nlIdx + 1)

    let depth = 0, end = 0
    for (let i = 0; i < cleaned.length; i++) {
      if (cleaned[i] === '[') depth++
      else if (cleaned[i] === ']') { depth--; if (depth === 0) { end = i + 1; break } }
    }
    if (end === 0) return results
    const outer = JSON.parse(cleaned.substring(0, end))
    const flightDataStr = outer[0]?.[2]
    if (!flightDataStr) return results
    const flightData = JSON.parse(flightDataStr)

    const fmtTime = (t) => (Array.isArray(t) && typeof t[0] === 'number' && typeof t[1] === 'number') ? `${String(t[0]).padStart(2, '0')}:${String(t[1]).padStart(2, '0')}` : ''

    function extractOffers(arr, d = 0) {
      if (d > 6 || !Array.isArray(arr)) return
      for (const item of arr) {
        if (!Array.isArray(item)) continue
        if (item.length >= 2 && Array.isArray(item[0]) && Array.isArray(item[1])) {
          const offer = item[0], priceInfo = item[1]
          if (typeof offer[0] === 'string' && offer[0].length <= 3 && Array.isArray(offer[1])) {
            const airlineName = offer[1]?.[0] || offer[0]
            const origin = offer[3], dest = offer[6]
            const depTime = offer[5], arrTime = offer[8]
            const duration = offer[9], stops = offer[10]
            // Price: try [null, price] format first, then nested [[null, price]] format
            const price = (typeof priceInfo[1] === 'number') ? priceInfo[1]
              : (Array.isArray(priceInfo[0]) && typeof priceInfo[0][1] === 'number') ? priceInfo[0][1]
              : null
            const stopovers = offer[13] || offer[11] || []
            if (origin && dest && typeof duration === 'number' && price) {
              const depStr = fmtTime(depTime)
              const arrStr = fmtTime(arrTime)
              const stopCities = []
              for (const seg of (offer[2] || [])) {
                if (Array.isArray(seg)) {
                  for (const field of [seg[3], seg[6]]) {
                    if (typeof field === 'string' && field.length === 3 && field !== origin && field !== dest && !stopCities.includes(field))
                      stopCities.push(field)
                  }
                }
              }
              const layovers = []
              if (Array.isArray(stopovers)) for (const sv of stopovers) {
                if (Array.isArray(sv) && typeof sv[0] === 'number') layovers.push(`${Math.floor(sv[0] / 60)}h ${sv[0] % 60}m`)
              }
              results.push({
                price: `$${price}`, priceRaw: price, airline: airlineName,
                departure: depStr, arrival: arrStr,
                duration: `${Math.floor(duration / 60)}h ${duration % 60}m`, durationMin: duration,
                stops: typeof stops === 'number' ? stops : 0, stopCities, layovers
              })
            }
          }
        }
        extractOffers(item, d + 1)
      }
    }
    extractOffers(flightData)
  } catch {}
  results.sort((a, b) => (a.priceRaw || Infinity) - (b.priceRaw || Infinity))
  return results
}

const browser = await puppeteerExtra.launch({
  headless: 'new',
  channel: 'chrome',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
  defaultViewport: { width: 1366, height: 768 }
})

try {
  const page = await browser.newPage()
  const apiCalls = []
  const gridCalls = []
  page.on('response', async (res) => {
    const u = res.url()
    if (u.includes('GetCalendarGrid')) {
      try { const t = await res.text(); if (t.length > 500) gridCalls.push(t) } catch {}
    } else if ((u.includes('GetShoppingResults') || u.includes('FlightsFrontendService')) && !u.includes('gstatic.com')) {
      try { const t = await res.text(); if (t.length > 1000) apiCalls.push(t) } catch {}
    }
  })

  const dep = new Date(departure + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const ret = returnDate ? new Date(returnDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''
  const query = returnDate ? `flights from ${from} to ${to} on ${dep} returning ${ret}` : `flights from ${from} to ${to} on ${dep} one way`
  const url = `https://www.google.com/travel/flights?q=${encodeURIComponent(query)}&hl=en&curr=USD`

  function buildFlights() {
    const flights = []
    for (const call of apiCalls) {
      for (const f of parseResponse(call)) {
        if (!flights.some(e => e.priceRaw === f.priceRaw && e.airline === f.airline && e.departure === f.departure)) flights.push(f)
      }
    }
    flights.sort((a, b) => (a.priceRaw || Infinity) - (b.priceRaw || Infinity))
    return flights
  }

  function buildFlexDates() {
    if (gridCalls.length === 0) return []
    try {
      let raw = gridCalls[gridCalls.length - 1]
      if (raw.startsWith(")]}'")) raw = raw.substring(4)
      raw = raw.trim()
      const nlIdx = raw.indexOf('\n')
      if (nlIdx > 0 && nlIdx < 10 && /^\d+$/.test(raw.substring(0, nlIdx))) raw = raw.substring(nlIdx + 1)
      let depth = 0, end = 0
      for (let j = 0; j < raw.length; j++) {
        if (raw[j] === '[') depth++
        else if (raw[j] === ']') { depth--; if (depth === 0) { end = j + 1; break } }
      }
      const outer = JSON.parse(raw.substring(0, end))
      const innerStr = outer[0]?.[2]
      if (!innerStr) return []
      const inner = typeof innerStr === 'string' ? JSON.parse(innerStr) : innerStr
      const entries = inner[1] || []
      const results = []
      for (const entry of entries) {
        if (!Array.isArray(entry) || entry.length < 3) continue
        const depDate = entry[0], retDate = entry[1]
        const price = entry[2]?.[0]?.[1]
        if (depDate && price && typeof price === 'number') {
          const r = { departure: depDate, price }
          if (retDate) r.return = retDate
          results.push(r)
        }
      }
      results.sort((a, b) => a.price - b.price)
      return results.slice(0, 20)
    } catch (e) {
      console.error('Google Flights: flex parse error:', e.message)
      return []
    }
  }

  const emit = (flights, partial, flexDates) => console.log(JSON.stringify({ site: 'Google Flights', url, flights, flexDates: flexDates || [], partial }))

  console.error('Google Flights: loading...')
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 })
  try { const btn = await page.$('button[aria-label="Accept all"], button[id="L2AGLb"]'); if (btn) { await btn.click(); await wait(5000) } } catch {}

  // Wait for initial API response
  for (let i = 0; i < 10; i++) { if (apiCalls.length > 0) break; await wait(3000) }

  // Emit first partial
  let lastFlightCount = 0
  let flights = buildFlights()
  if (flights.length > 0) {
    emit(flights, true)
    lastFlightCount = flights.length
    console.error(`Google Flights: ${flights.length} flights (initial partial)`)
  }

  // Click "View more flights" and stream updates
  let lastNewTime = Date.now()
  for (let i = 0; i < 8; i++) {
    const clicked = await page.evaluate(() => {
      const btn = document.querySelector('button[aria-label="View more flights"]')
      if (btn && btn.offsetParent) { btn.click(); return true }
      const btns = [...document.querySelectorAll('button')]
      const t = btns.find(b => /view more|more flights/i.test(b.textContent + (b.getAttribute('aria-label') || '')) && b.offsetParent)
      if (t) { t.click(); return true }
      return false
    })
    if (!clicked) break
    await wait(8000)
    flights = buildFlights()
    if (flights.length > lastFlightCount) {
      lastNewTime = Date.now()
      lastFlightCount = flights.length
      emit(flights, true)
      console.error(`Google Flights: ${flights.length} flights after "View more" ${i + 1}`)
    } else if (Date.now() - lastNewTime > 5000) {
      console.error('Google Flights: no new flights for 5s, stopping')
      break
    }
  }

  // Click "Date grid" to get flex date prices
  try {
    const gridClicked = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find(b => /date grid/i.test(b.textContent) && b.offsetParent)
      if (btn) { btn.click(); return true }
      return false
    })
    if (gridClicked) {
      console.error('Google Flights: clicked Date grid, waiting for data...')
      for (let i = 0; i < 5; i++) { if (gridCalls.length > 0) break; await wait(2000) }
      console.error(`Google Flights: ${gridCalls.length} grid API calls captured`)
    }
  } catch (e) { console.error('Google Flights: date grid error:', e.message) }

  const finalFlights = buildFlights()
  const finalFlexDates = buildFlexDates()
  console.error(`Google Flights: ${finalFlights.length} flights, ${finalFlexDates.length} flex dates`)
  emit(finalFlights, false, finalFlexDates)
} catch (e) {
  console.error('Google Flights: error:', e.message)
  console.log(JSON.stringify({ site: 'Google Flights', url: '', flights: [], flexDates: [], error: e.message, partial: false }))
} finally {
  await browser.close()
}
```
