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
const MAX = 50, wait = (ms) => new Promise(r => setTimeout(r, ms))

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

  console.error('Turismocity: loading...')
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 })

  const is500 = await page.evaluate(() => document.body.innerText.includes('500'))
  if (is500) { console.log(JSON.stringify({ site: 'Turismocity', url, flights: [], error: 'City slug not found (500)' })); process.exit(0) }

  try { const btn = await page.$('button[class*="accept"], [class*="consent"] button'); if (btn) { await btn.click(); await wait(2000) } } catch {}

  // Poll until data stabilizes (sites keep loading providers for ~60s)
  let lastSize = 0
  for (let i = 0; i < 20; i++) {
    await wait(3000)
    const curSize = bestApiData?.length || 0
    if (curSize > 100000 && curSize === lastSize) {
      console.error(`Turismocity: data stabilized at ${Math.round(curSize/1024)}kb`)
      break
    }
    lastSize = curSize
    if (i % 3 === 0) console.error(`Turismocity: polling... ${Math.round(curSize/1024)}kb`)
  }

  if (!bestApiData) { console.log(JSON.stringify({ site: 'Turismocity', url, flights: [] })); process.exit(0) }

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

      // Real USD price is inside element [14] as [N, "USD", price]
      const offers = allItems[i + 14]
      let price = null
      if (Array.isArray(offers)) {
        const offersStr = JSON.stringify(offers)
        const priceMatch = offersStr.match(/\[\d+,"USD",([\d.]+)\]/)
        if (priceMatch) price = parseFloat(priceMatch[1])
      }
      // Fallback to element [17] if no USD price found
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
      if (Array.isArray(legData)) {
        // legData has outbound and return legs — extract all timestamps
        const allTimes = JSON.stringify(legData).match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/g) || []
        if (allTimes.length >= 2) { depTime = allTimes[0].substring(11, 16); arrTime = allTimes[1].substring(11, 16) }
        // Return leg is in the second sub-array
        if (legData.length >= 2 && Array.isArray(legData[1])) {
          const retTimes = JSON.stringify(legData[1]).match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/g) || []
          if (retTimes.length >= 2) { retDepTime = retTimes[0].substring(11, 16); retArrTime = retTimes[retTimes.length - 1].substring(11, 16) }
        }
      }

      const flight = {
        price: `$${price}`, priceRaw: price,
        airline: airlineNames[airlineCode] || airlineCode,
        departure: depTime, arrival: arrTime,
        duration: totalDuration > 0 ? `${Math.floor(totalDuration / 60)}h ${totalDuration % 60}m` : '',
        durationMin: totalDuration, stops, stopCities, provider
      }
      if (retDepTime || retDuration > 0) {
        flight.returnDeparture = retDepTime
        flight.returnArrival = retArrTime
        flight.returnDuration = retDuration > 0 ? `${Math.floor(retDuration / 60)}h ${retDuration % 60}m` : ''
        flight.returnAirline = airlineNames[retAirlineCode] || retAirlineCode || flight.airline
      }
      flights.push(flight)
    } catch {}
  }

  flights.sort((a, b) => (a.priceRaw || Infinity) - (b.priceRaw || Infinity))
  console.error(`Turismocity: ${flights.length} flights from ${data.totalItineraries || '?'} total`)
  console.log(JSON.stringify({ site: 'Turismocity', url, flights: flights.slice(0, MAX) }))
} finally {
  await browser.close()
}
```
