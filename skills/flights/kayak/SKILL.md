---
name: kayak
description: Search for flights on Kayak.
---

# Command

```bash
node skills/flights/kayak/search.mjs --from {IATA} --to {IATA} --departure {YYYY-MM-DD} [--return {YYYY-MM-DD}]
```

# Output format

JSON to stdout: `{ "site": "Kayak", "url": "...", "flights": [...] }`

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

const browser = await puppeteerExtra.launch({
  headless: 'new',
  channel: 'chrome',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
  defaultViewport: { width: 1366, height: 768 }
})

try {
  const page = await browser.newPage()
  const url = returnDate
    ? `https://www.kayak.com/flights/${from}-${to}/${departure}/${returnDate}?sort=price_a&currency=USD`
    : `https://www.kayak.com/flights/${from}-${to}/${departure}?sort=price_a&currency=USD`

  let allPollData = [], csrfToken = '', originalPollBody = null
  page.on('request', (req) => {
    if (req.url().includes('flights/poll')) {
      const csrf = req.headers()['x-csrf'] || req.headers()['x-csrf-token']
      if (csrf) csrfToken = csrf
      if (req.method() === 'POST' && req.postData()) try { originalPollBody = JSON.parse(req.postData()) } catch {}
    }
  })
  page.on('response', async (res) => {
    if (res.url().includes('flights/poll') || res.url().includes('search/dynamic')) {
      try { const t = await res.text(); if (t.length > 5000) allPollData.push(JSON.parse(t)) } catch {}
    }
  })

  // Helper: build flights from all poll data collected so far
  function buildFlights() {
    const mergedLegs = {}, mergedSegments = {}, mergedAirlines = {}, mergedResults = [], seen = new Set()
    let filterData = null
    for (const poll of allPollData) {
      Object.assign(mergedLegs, poll.legs || {})
      Object.assign(mergedSegments, poll.segments || {})
      Object.assign(mergedAirlines, poll.airlines || {})
      if (poll.filterData) filterData = poll.filterData
      for (const r of (poll.results || [])) {
        if (r.type === 'core' && !seen.has(r.resultId)) { seen.add(r.resultId); mergedResults.push(r) }
      }
    }
    const flights = [], seenOutbound = new Set()
    for (const r of mergedResults) {
      const outLegInfo = r.legs?.[0]
      if (!outLegInfo) continue
      const outLeg = mergedLegs[outLegInfo.id]
      if (!outLeg) continue
      const segs = outLeg.segments.map(s => mergedSegments[s.id]).filter(Boolean)
      const code = segs[0]?.airline || ''
      let name = mergedAirlines[code]?.displayName || mergedAirlines[code]?.name || ''
      if (!name) { const f = filterData?.airlines?.items?.find(a => a.id === code); if (f) name = f.displayValue }
      const price = r.bookingOptions?.[0]?.displayPrice?.price
      const dep = outLeg.departure?.substring(11, 16) || ''
      const arr = outLeg.arrival?.substring(11, 16) || ''
      const dedupKey = `${code}|${dep}|${arr}|${outLeg.duration}`
      if (seenOutbound.has(dedupKey)) continue
      seenOutbound.add(dedupKey)
      const retLegInfo = r.legs?.[1]
      const retLeg = retLegInfo ? mergedLegs[retLegInfo.id] : null
      const retSegs = retLeg ? retLeg.segments.map(s => mergedSegments[s.id]).filter(Boolean) : []
      const retCode = retSegs[0]?.airline || ''
      let retName = mergedAirlines[retCode]?.displayName || mergedAirlines[retCode]?.name || ''
      if (!retName && retCode) { const f = filterData?.airlines?.items?.find(a => a.id === retCode); if (f) retName = f.displayValue }
      const flight = {
        price: price ? `$${price}` : '', priceRaw: price || null,
        airline: name || code, departure: dep, arrival: arr,
        duration: outLeg.duration ? `${Math.floor(outLeg.duration / 60)}h ${outLeg.duration % 60}m` : '',
        durationMin: outLeg.duration || 0,
        stops: segs.length - 1,
        stopCities: segs.slice(0, -1).map(s => s.destination),
        layovers: outLeg.segments.filter(s => s.layover).map(s => `${Math.floor(s.layover.duration / 60)}h ${s.layover.duration % 60}m`),
      }
      if (retLeg) {
        flight.returnDeparture = retLeg.departure?.substring(11, 16) || ''
        flight.returnArrival = retLeg.arrival?.substring(11, 16) || ''
        flight.returnDuration = retLeg.duration ? `${Math.floor(retLeg.duration / 60)}h ${retLeg.duration % 60}m` : ''
        flight.returnAirline = retName || retCode || name || code
        flight.returnStops = retSegs.length - 1
      }
      flights.push(flight)
    }
    flights.sort((a, b) => (a.priceRaw || Infinity) - (b.priceRaw || Infinity))
    return flights
  }

  const emit = (flights, partial) => console.log(JSON.stringify({ site: 'Kayak', url, flights, partial }))

  console.error('Kayak: loading...')
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 })

  // Streaming poll loop: emit partials, stop after 5s of no new flights
  let lastFlightCount = 0, lastNewTime = Date.now(), emitted = false
  const IDLE_TIMEOUT = 5000, HARD_TIMEOUT = 90000, CHECK_INTERVAL = 3000
  const startTime = Date.now()

  // Initial wait for first polls
  await wait(10000)

  for (let i = 0; i < 30; i++) {
    const flights = buildFlights()
    if (flights.length > lastFlightCount) {
      lastNewTime = Date.now()
      lastFlightCount = flights.length
      emit(flights, true)
      emitted = true
      console.error(`Kayak: ${flights.length} flights (partial)`)
    }
    if (emitted && Date.now() - lastNewTime > IDLE_TIMEOUT) {
      console.error('Kayak: no new flights for 5s, stopping')
      break
    }
    if (Date.now() - startTime > HARD_TIMEOUT) {
      console.error('Kayak: hard timeout')
      break
    }
    await wait(CHECK_INTERVAL)
  }

  // Paginate for more results
  if (allPollData.length > 0 && originalPollBody && csrfToken) {
    for (let pn = 2; pn <= 5; pn++) {
      try {
        const more = await page.evaluate(async (body, pn, csrf) => {
          const b = JSON.parse(JSON.stringify(body))
          if (b.searchMetaData) { b.searchMetaData.pageNumber = pn; b.searchMetaData.pageSize = 50 }
          const r = await fetch('/i/api/search/dynamic/flights/poll', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF': csrf }, credentials: 'include', body: JSON.stringify(b)
          })
          return r.text()
        }, originalPollBody, pn, csrfToken)
        if (more?.length > 5000) {
          const parsed = JSON.parse(more)
          if ((parsed.results || []).filter(r => r.type === 'core').length > 0) {
            allPollData.push(parsed)
            const flights = buildFlights()
            if (flights.length > lastFlightCount) {
              emit(flights, true)
              lastFlightCount = flights.length
              console.error(`Kayak: ${flights.length} flights after page ${pn}`)
            }
          } else break
        } else break
      } catch { break }
    }
  }

  // Final emit
  const finalFlights = buildFlights()
  console.error(`Kayak: ${finalFlights.length} flights final from ${allPollData.length} polls`)
  emit(finalFlights, false)
} catch (e) {
  console.error('Kayak: error:', e.message)
  console.log(JSON.stringify({ site: 'Kayak', url: '', flights: [], error: e.message, partial: false }))
} finally {
  await browser.close()
}
```
