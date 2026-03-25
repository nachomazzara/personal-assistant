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
const MAX = 50, wait = (ms) => new Promise(r => setTimeout(r, ms))

if (!from || !to || !departure) { console.error('Usage: search.mjs --from IATA --to IATA --departure YYYY-MM-DD [--return YYYY-MM-DD]'); process.exit(1) }

const browser = await puppeteerExtra.launch({
  headless: 'new',
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

  console.error('Kayak: loading...')
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 })

  // Wait for initial polls to come in, then keep waiting for more
  await wait(15000)
  const initialPolls = allPollData.length
  console.error(`Kayak: ${initialPolls} initial polls, waiting for more...`)
  for (let i = 0; i < 8; i++) {
    await wait(5000)
    if (allPollData.length > initialPolls) {
      console.error(`Kayak: ${allPollData.length} polls (new data arriving)`)
    } else {
      console.error(`Kayak: ${allPollData.length} polls (stable)`)
      break
    }
  }

  if (allPollData.length > 0 && originalPollBody) {
    const searchId = allPollData[0].searchId
    if (searchId && csrfToken) {
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
            if ((parsed.results || []).filter(r => r.type === 'core').length > 0) allPollData.push(parsed)
            else break
          } else break
        } catch { break }
      }
    }
  }

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

  const flights = []
  const seenOutbound = new Set()
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
    // Dedup by outbound leg: same airline + departure + arrival + duration = same flight
    const dedupKey = `${code}|${dep}|${arr}|${outLeg.duration}`
    if (seenOutbound.has(dedupKey)) continue
    seenOutbound.add(dedupKey)

    // Return leg
    const retLegInfo = r.legs?.[1]
    const retLeg = retLegInfo ? mergedLegs[retLegInfo.id] : null
    const retSegs = retLeg ? retLeg.segments.map(s => mergedSegments[s.id]).filter(Boolean) : []
    const retCode = retSegs[0]?.airline || ''
    let retName = mergedAirlines[retCode]?.displayName || mergedAirlines[retCode]?.name || ''
    if (!retName && retCode) { const f = filterData?.airlines?.items?.find(a => a.id === retCode); if (f) retName = f.displayValue }

    const flight = {
      price: price ? `$${price}` : '', priceRaw: price || null,
      airline: name || code,
      departure: dep,
      arrival: arr,
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
  console.error(`Kayak: ${flights.length} flights from ${allPollData.length} polls`)
  console.log(JSON.stringify({ site: 'Kayak', url, flights: flights.slice(0, MAX) }))
} finally {
  await browser.close()
}
```
