---
name: aerolineas
description: Search for flights on Aerolíneas Argentinas.
---

# Command

```bash
node skills/flights/aerolineas/search.mjs --from {IATA} --to {IATA} --departure {YYYY-MM-DD} [--return {YYYY-MM-DD}]
```

# Output format

JSON to stdout: `{ "site": "Aerolíneas Argentinas", "url": "...", "flights": [...] }`

# Rules

- Run the command above with the correct IATA codes and dates from the user's request.
- Your response must be ONLY the raw JSON from stdout. No other text.

## Script

```javascript
#!/usr/bin/env node
/**
 * Aerolíneas Argentinas flight search.
 * Navigates to the flights-offers page, intercepts the API response.
 * API: GET https://api.aerolineas.com.ar/v1/flights/offers
 * Auth: Bearer JWT obtained automatically via Auth0 client credentials on page load.
 * Prices in ARS.
 */
import puppeteerExtra from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
puppeteerExtra.use(StealthPlugin())

const args = process.argv.slice(2)
const getArg = (n) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : null }
const from = getArg('from'), to = getArg('to'), departure = getArg('departure'), returnDate = getArg('return')
const wait = (ms) => new Promise(r => setTimeout(r, ms))

if (!from || !to || !departure) { console.error('Usage: search.mjs --from IATA --to IATA --departure YYYY-MM-DD [--return YYYY-MM-DD]'); process.exit(1) }

const depFormatted = departure.replace(/-/g, '').slice(0, 8)
const retFormatted = returnDate ? returnDate.replace(/-/g, '').slice(0, 8) : null
const flightType = retFormatted ? 'ROUND_TRIP' : 'ONE_WAY'
const legParams = retFormatted
  ? `leg=${from}-${to}-${depFormatted}&leg=${to}-${from}-${retFormatted}`
  : `leg=${from}-${to}-${depFormatted}`
// Use es-us locale for USD pricing
const pageUrl = `https://www.aerolineas.com.ar/es-us/flights-offers?adt=1&inf=0&chd=0&flexDates=false&cabinClass=Economy&flightType=${flightType}&${legParams}`
const siteUrl = pageUrl

const browser = await puppeteerExtra.launch({
  headless: 'new',
  channel: 'chrome',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
  defaultViewport: { width: 1366, height: 768 }
})

try {
  const page = await browser.newPage()
  const apiResponses = []

  page.on('response', async (res) => {
    const u = res.url()
    if (u.includes('flights/offers') && !u.includes('flexDates=true')) {
      try {
        const t = await res.text()
        if (t.length > 1000) apiResponses.push(t)
      } catch {}
    }
  })

  console.error('Aerolíneas: loading...')
  await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 60000 })

  // Wait for API response
  for (let i = 0; i < 10; i++) {
    if (apiResponses.length > 0) break
    await wait(3000)
  }

  function buildFlights() {
    if (apiResponses.length === 0) return []
    try {
      const data = JSON.parse(apiResponses[apiResponses.length - 1])
      const flights = []
      const airlineNames = { 'AR': 'Aerolíneas Argentinas', 'DL': 'Delta', 'AA': 'American Airlines', 'AM': 'Aeroméxico', 'UX': 'Air Europa', 'AZ': 'ITA Airways', 'KL': 'KLM', 'AF': 'Air France', 'LA': 'LATAM', 'CM': 'Copa Airlines' }

      const branded = data.brandedOffers || {}
      // brandedOffers["0"] = outbound flights, brandedOffers["1"] = return flights (RT only)
      const outboundOffers = branded['0'] || []
      const returnOffers = branded['1'] || []

      function parseLeg(leg) {
        const segs = leg.segments || []
        if (segs.length === 0) return null
        const dep = segs[0].departure?.substring(11, 16) || ''
        const arr = segs[segs.length - 1].arrival?.substring(11, 16) || ''
        const name = segs.map(s => airlineNames[s.airline] || s.airline).filter((v, i, a) => a.indexOf(v) === i).join(' + ')
        const stopCities = segs.slice(0, -1).map(s => s.destination)
        const layovers = (leg.connectionsInformation || []).map(c => `${Math.floor((c.duration || 0) / 60)}h ${(c.duration || 0) % 60}m`)
        return { dep, arr, name, stopCities, layovers, duration: leg.totalDuration || 0, stops: leg.stops ?? (segs.length - 1) }
      }

      for (const item of outboundOffers) {
        const outLeg = (item.legs || [])[0]
        if (!outLeg) continue
        const out = parseLeg(outLeg)
        if (!out) continue

        const econOffers = (item.offers || []).filter(o => o.cabinClass === 'Economy')
        const cheapest = econOffers.sort((a, b) => (a.fare?.total || Infinity) - (b.fare?.total || Infinity))[0]
        if (!cheapest) continue

        const priceRaw = cheapest.fare?.total || 0

        const flight = {
          price: `$${priceRaw}`, priceRaw,
          airline: out.name, departure: out.dep, arrival: out.arr,
          duration: out.duration ? `${Math.floor(out.duration / 60)}h ${out.duration % 60}m` : '',
          durationMin: out.duration, stops: out.stops, stopCities: out.stopCities,
          layovers: out.layovers, provider: 'Aerolíneas Argentinas',
        }

        // For RT, pair with cheapest return flight
        if (returnOffers.length > 0) {
          const retItem = returnOffers[0] // cheapest return
          const retLeg = (retItem.legs || [])[0]
          if (retLeg) {
            const ret = parseLeg(retLeg)
            if (ret) {
              flight.returnDeparture = ret.dep
              flight.returnArrival = ret.arr
              flight.returnDuration = ret.duration ? `${Math.floor(ret.duration / 60)}h ${ret.duration % 60}m` : ''
              flight.returnAirline = ret.name
              flight.returnStops = ret.stops
            }
          }
        }

        flights.push(flight)
      }

      flights.sort((a, b) => (a.priceRaw || Infinity) - (b.priceRaw || Infinity))
      return flights
    } catch (e) {
      console.error('Aerolíneas: parse error:', e.message)
      return []
    }
  }

  const emit = (flights, partial) => console.log(JSON.stringify({ site: 'Aerolíneas Argentinas', url: siteUrl, flights, partial }))

  // Streaming: check periodically
  let lastFlightCount = 0, lastNewTime = Date.now()
  for (let i = 0; i < 10; i++) {
    await wait(3000)
    const flights = buildFlights()
    if (flights.length > lastFlightCount) {
      lastNewTime = Date.now()
      lastFlightCount = flights.length
      emit(flights, true)
      console.error(`Aerolíneas: ${flights.length} flights (partial)`)
    } else if (lastFlightCount > 0 && Date.now() - lastNewTime > 5000) {
      break
    }
  }

  const finalFlights = buildFlights()
  console.error(`Aerolíneas: ${finalFlights.length} flights final`)
  emit(finalFlights, false)
} catch (e) {
  console.error('Aerolíneas: error:', e.message)
  console.log(JSON.stringify({ site: 'Aerolíneas Argentinas', url: siteUrl, flights: [], error: e.message, partial: false }))
} finally {
  await browser.close()
}
```
