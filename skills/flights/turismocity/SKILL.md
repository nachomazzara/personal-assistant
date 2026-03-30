---
name: turismocity
description: Search for flights on Turismocity.
---

# Command

```bash
node skills/flights/turismocity/search.mjs --from {IATA} --to {IATA} --departure {YYYY-MM-DD} [--return {YYYY-MM-DD}]
```

# Output format

JSON to stdout: `{ "site": "Turismocity", "url": "...", "flights": [...] }`

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

const metroCode = (c) => (c === 'EZE' || c === 'AEP') ? 'BUE' : c
const fmtDate = (d) => { const [y, m, dd] = d.split('-'); return `${dd}-${m}-${y}` }

const origin = metroCode(from)
const depF = fmtDate(departure)
const retF = returnDate ? fmtDate(returnDate) : null
const searchParam = retF ? `${origin}-${to}.${depF}.${to}-${origin}.${retF}` : `${origin}-${to}.${depF}`
const url = `https://www.turismocity.com.ar/vuelos/resultados-a-${to.toLowerCase()}-${to}?cabinClass=Economy&currency=USD&s=${searchParam}`

const browser = await puppeteerExtra.launch({
  headless: 'new',
  channel: 'chrome',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
  defaultViewport: { width: 1366, height: 768 }
})

try {
  const page = await browser.newPage()
  let bestApiData = null
  page.on('response', async (res) => {
    const u = res.url()
    if (u.includes('flights/rpull')) {
      try {
        const t = await res.text()
        if (t.length > 10000 && (!bestApiData || t.length > bestApiData.length)) bestApiData = t
      } catch {}
    }
  })

  function buildFlights() {
    if (!bestApiData) return []
    try {
      const data = JSON.parse(bestApiData)
      const itinerariesMap = data.itineraries || {}
      const airlineNames = data.dictionary?.airline || {}
      const STRIDE = 18
      const allItems = []
      for (const key of Object.keys(itinerariesMap)) {
        const group = itinerariesMap[key]
        if (Array.isArray(group)) allItems.push(...group)
      }
      const flights = []
      for (let i = 0; i + STRIDE <= allItems.length; i += STRIDE) {
        try {
          const provider = allItems[i + 6] || ''
          const segStr = allItems[i + 13] || ''
          const routeStr = allItems[i + 7] || ''
          const offers = allItems[i + 14]
          let price = null
          if (Array.isArray(offers)) {
            const offersStr = JSON.stringify(offers)
            const priceMatch = offersStr.match(/\[\d+,"USD",([\d.]+)\]/)
            if (priceMatch) price = parseFloat(priceMatch[1])
          }
          if (!price) price = typeof allItems[i + 17] === 'number' ? allItems[i + 17] : null
          if (!price || price <= 0) continue
          const legParts = segStr.split('|')
          const outSegs = (legParts[0] || '').split(':')
          const retSegs = (legParts[1] || '').split(':')
          const airlineCode = outSegs[0] || ''
          const retAirlineCode = retSegs[0] || ''
          let totalDuration = 0
          for (let s = 2; s < outSegs.length; s += 3) { const d = parseInt(outSegs[s]); if (!isNaN(d)) totalDuration += d }
          let retDuration = 0
          for (let s = 2; s < retSegs.length; s += 3) { const d = parseInt(retSegs[s]); if (!isNaN(d)) retDuration += d }
          const stopsMatch = routeStr.match(/stops=(\d+)/)
          const stops = stopsMatch ? parseInt(stopsMatch[1]) : 0
          const segMatch = routeStr.match(/segments=([A-Z,-]+)/)
          const stopCities = segMatch ? segMatch[1].split('-').filter(c => c.length === 3 && c !== from && c !== to).filter((c, i, a) => a.indexOf(c) === i) : []
          const legData = allItems[i + 15]
          let depTime = '', arrTime = '', retDepTime = '', retArrTime = ''
          function extractTimes(leg) {
            // Object format: { flights: [{ departureTime, arrivalTime }, ...] }
            if (leg && typeof leg === 'object' && !Array.isArray(leg) && leg.flights) {
              const segs = leg.flights
              if (segs.length > 0) return { dep: segs[0].departureTime?.substring(11, 16) || '', arr: segs[segs.length - 1].arrivalTime?.substring(11, 16) || '' }
            }
            // Array format: [..., flights-at-index-8, ...] where flights is [{departureTime, arrivalTime}]
            if (Array.isArray(leg)) {
              const flightsArr = leg.find(el => Array.isArray(el) && el.length > 0 && el[0]?.departureTime)
              if (flightsArr) return { dep: flightsArr[0].departureTime?.substring(11, 16) || '', arr: flightsArr[flightsArr.length - 1].arrivalTime?.substring(11, 16) || '' }
            }
            // Fallback: regex on stringified JSON
            const times = JSON.stringify(leg).match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/g) || []
            if (times.length >= 2) return { dep: times[0].substring(11, 16), arr: times[times.length - 1].substring(11, 16) }
            return { dep: '', arr: '' }
          }
          if (Array.isArray(legData)) {
            const out = extractTimes(legData[0])
            depTime = out.dep; arrTime = out.arr
            if (legData.length >= 2) {
              const ret = extractTimes(legData[1])
              retDepTime = ret.dep; retArrTime = ret.arr
            }
          }
          // Fallback: derive times from segStr (minutes from midnight)
          // Format: AIRLINE:FLIGHT:DEP_MIN:AIRLINE:FLIGHT:ARR_MIN:0|...
          const minToTime = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
          if (!depTime && legParts[0]) {
            const p = legParts[0].split(':')
            if (p.length >= 6) { depTime = minToTime(parseInt(p[2]) || 0); arrTime = minToTime(parseInt(p[p.length - 2]) || 0) }
          }
          if (!retDepTime && legParts[1]) {
            const p = legParts[1].split(':')
            if (p.length >= 6) { retDepTime = minToTime(parseInt(p[2]) || 0); retArrTime = minToTime(parseInt(p[p.length - 2]) || 0) }
          }
          const flight = {
            price: `$${price}`, priceRaw: price,
            airline: airlineNames[airlineCode] || airlineCode,
            departure: depTime, arrival: arrTime,
            duration: totalDuration > 0 ? `${Math.floor(totalDuration / 60)}h ${totalDuration % 60}m` : '',
            durationMin: totalDuration, stops, stopCities, provider
          }
          if (returnDate && (retDepTime || retArrTime || retDuration > 0)) {
            flight.returnDeparture = retDepTime
            flight.returnArrival = retArrTime
            flight.returnDuration = retDuration > 0 ? `${Math.floor(retDuration / 60)}h ${retDuration % 60}m` : ''
            flight.returnAirline = airlineNames[retAirlineCode] || retAirlineCode || flight.airline
            // Count return stops from segments
            const retSegParts = (legParts[1] || '').split(':')
            flight.returnStops = Math.max(0, Math.floor((retSegParts.length - 1) / 3) - 1)
          } else if (returnDate && routeStr.includes('RoundTrip')) {
            // Round trip but no return data parsed — still mark as having return
            flight.returnDeparture = ''
            flight.returnArrival = ''
            flight.returnDuration = ''
            flight.returnAirline = airlineNames[retAirlineCode] || retAirlineCode || flight.airline
          }
          flights.push(flight)
        } catch {}
      }
      flights.sort((a, b) => (a.priceRaw || Infinity) - (b.priceRaw || Infinity))
      return flights
    } catch { return [] }
  }

  const emit = (flights, partial) => console.log(JSON.stringify({ site: 'Turismocity', url, flights, flexDates: [], partial }))

  console.error('Turismocity: loading...')
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 })

  const is500 = await page.evaluate(() => document.body.innerText.includes('500'))
  if (is500) { emit([], false); process.exit(0) }

  try { const btn = await page.$('button[class*="accept"], [class*="consent"] button'); if (btn) { await btn.click(); await wait(2000) } } catch {}

  // Streaming poll loop
  let lastFlightCount = 0, lastNewTime = Date.now()
  for (let i = 0; i < 20; i++) {
    await wait(3000)
    const flights = buildFlights()
    if (flights.length > lastFlightCount) {
      lastNewTime = Date.now()
      lastFlightCount = flights.length
      emit(flights, true)
      console.error(`Turismocity: ${flights.length} flights (partial)`)
    } else if (lastFlightCount > 0 && Date.now() - lastNewTime > 5000) {
      console.error('Turismocity: no new flights for 5s, stopping')
      break
    }
  }

  const finalFlights = buildFlights()
  console.error(`Turismocity: ${finalFlights.length} flights final`)
  emit(finalFlights, false)
} catch (e) {
  console.error('Turismocity: error:', e.message)
  console.log(JSON.stringify({ site: 'Turismocity', url: '', flights: [], flexDates: [], error: e.message, partial: false }))
} finally {
  await browser.close()
}
```
