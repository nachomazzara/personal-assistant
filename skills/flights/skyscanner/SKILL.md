---
name: skyscanner
description: Search for flights on Skyscanner.
---

# Command

```bash
node skills/flights/skyscanner/search.mjs --from {IATA} --to {IATA} --departure {YYYY-MM-DD} [--return {YYYY-MM-DD}]
```

# Output format

JSON to stdout: `{ "site": "Skyscanner", "url": "...", "flights": [...] }`

# Rules

- Run the command above with the correct IATA codes and dates from the user's request.
- Your response must be ONLY the raw JSON from stdout. No other text.

## Script

```javascript
#!/usr/bin/env node
/**
 * Skyscanner flight search — uses rebrowser-puppeteer to bypass PerimeterX.
 * Intercepts web-unified-search API responses for full flight data.
 */
import rebrowser from 'rebrowser-puppeteer'

const args = process.argv.slice(2)
const getArg = (n) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : null }
const from = getArg('from'), to = getArg('to'), departure = getArg('departure'), returnDate = getArg('return')
const wait = (ms) => new Promise(r => setTimeout(r, ms))

if (!from || !to || !departure) { console.error('Usage: search.mjs --from IATA --to IATA --departure YYYY-MM-DD [--return YYYY-MM-DD]'); process.exit(1) }

const depF = (d) => { const [y, m, dd] = d.split('-'); return y.slice(2) + m + dd }
const url = returnDate
  ? `https://www.skyscanner.es/transport/flights/${from.toLowerCase()}/${to.toLowerCase()}/${depF(departure)}/${depF(returnDate)}/`
  : `https://www.skyscanner.es/transport/flights/${from.toLowerCase()}/${to.toLowerCase()}/${depF(departure)}/`

const EUR_TO_USD = 1.08

const browser = await rebrowser.launch({
  headless: false,
  channel: 'chrome',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1512,982', '--window-position=-2000,-2000', '--user-data-dir=/tmp/sky-scraper-profile'],
  defaultViewport: null,
})

try {
  const page = await browser.newPage()

  // Minimize the browser window immediately (can't use headless with rebrowser)
  const client = await page.createCDPSession()
  try {
    const { windowId } = await client.send('Browser.getWindowForTarget')
    await client.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } })
  } catch {}

  // Override client hints to look like real Google Chrome
  await client.send('Network.setUserAgentOverride', {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
    acceptLanguage: 'en,es-ES;q=0.9,es;q=0.8',
    platform: 'macOS',
    userAgentMetadata: {
      brands: [
        { brand: 'Chromium', version: '146' },
        { brand: 'Not-A.Brand', version: '24' },
        { brand: 'Google Chrome', version: '146' },
      ],
      fullVersionList: [
        { brand: 'Chromium', version: '146.0.7680.153' },
        { brand: 'Not-A.Brand', version: '24.0.0.0' },
        { brand: 'Google Chrome', version: '146.0.7680.153' },
      ],
      fullVersion: '146.0.7680.153',
      platform: 'macOS',
      platformVersion: '15.3.0',
      architecture: 'arm',
      model: '',
      mobile: false,
      bitness: '64',
      wow64: false,
    },
  })

  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'languages', { get: () => ['en', 'es-ES', 'es'] })
  })

  // Intercept API responses
  const apiResponses = []
  page.on('response', async (res) => {
    const u = res.url()
    if (u.includes('web-unified-search')) {
      try {
        const t = await res.text()
        if (t.length > 5000) apiResponses.push(t)
      } catch {}
    }
  })

  // Navigate with captcha retry (up to 3 attempts)
  let captchaPassed = false
  for (let attempt = 1; attempt <= 3; attempt++) {
    console.error(`Skyscanner: loading... (attempt ${attempt}/3)`)
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {})

    if (!page.url().includes('captcha')) { captchaPassed = true; break }

    console.error('Skyscanner: captcha detected, attempting press & hold...')
    await wait(3000)

    const pxBox = await page.evaluate(() => {
      const el = document.getElementById('px-captcha')
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y, w: r.width, h: r.height }
    })

    if (pxBox && pxBox.w > 0) {
      const cx = pxBox.x + pxBox.w / 2, cy = pxBox.y + pxBox.h / 2
      const sx = 200 + Math.random() * 200, sy = 150 + Math.random() * 100
      await page.mouse.move(sx, sy)
      await wait(400)

      for (let i = 1; i <= 25; i++) {
        const t = i / 25, e = t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t+2, 2)/2
        await page.mouse.move(sx + (cx-sx)*e + (Math.random()*2-1), sy + (cy-sy)*e + (Math.random()*2-1))
        await wait(10 + Math.random()*15)
      }

      await wait(200)
      await page.mouse.down()
      const hold = 7000 + Math.random()*1000, t0 = Date.now()
      while (Date.now()-t0 < hold) {
        await wait(80 + Math.random()*120)
        await page.mouse.move(cx + (Math.random()-0.5), cy + (Math.random()-0.5))
      }
      await page.mouse.up()
      console.error(`Skyscanner: released after ${Date.now()-t0}ms`)
      await wait(10000)

      if (!page.url().includes('captcha')) { captchaPassed = true; break }
      console.error(`Skyscanner: captcha attempt ${attempt} failed`)
    } else {
      console.error('Skyscanner: no captcha element found')
    }
  }

  if (!captchaPassed) {
    console.error('Skyscanner: captcha failed after 3 attempts')
    console.log(JSON.stringify({ site: 'Skyscanner', url: url.replace('skyscanner.es', 'skyscanner.com'), flights: [], flexDates: [], error: 'PerimeterX captcha failed after 3 attempts' }))
    process.exit(0)
  }

  // Dismiss cookie consent
  try {
    const acceptBtn = await page.$('button::-p-text(Aceptar todo), button::-p-text(Accept all)')
    if (acceptBtn) { await acceptBtn.click(); await wait(2000) }
  } catch {}

  function buildFlights() {
    const biggest = [...apiResponses].sort((a, b) => b.length - a.length)[0]
    if (!biggest) return []
    try {
      const data = JSON.parse(biggest)
      const results = data.itineraries?.results || []
      const agents = data.itineraries?.agents || {}
      const fmtTime = (t) => t ? t.slice(11, 16) : ''
      const flights = [], seen = new Set()
      for (const r of results) {
        const priceEur = r.price?.raw
        if (!priceEur) continue
        const priceRaw = Math.round(priceEur * EUR_TO_USD)
        const leg0 = r.legs?.[0]
        if (!leg0) continue
        const airline = leg0.carriers?.marketing?.[0]?.name || ''
        const dep = fmtTime(leg0.departure), arr = fmtTime(leg0.arrival)
        const duration = leg0.durationInMinutes || 0
        const stops = leg0.stopCount ?? 0
        const stopCities = (leg0.segments || []).slice(0, -1).map(s => s.destination?.displayCode).filter(Boolean)
        const dedupKey = `${airline}|${dep}|${arr}|${duration}`
        if (seen.has(dedupKey)) continue
        seen.add(dedupKey)
        const flight = {
          price: `$${priceRaw}`, priceRaw, airline, departure: dep, arrival: arr,
          duration: duration > 0 ? `${Math.floor(duration / 60)}h ${duration % 60}m` : '',
          durationMin: duration, stops, stopCities,
        }
        const leg1 = r.legs?.[1]
        if (leg1) {
          flight.returnDeparture = fmtTime(leg1.departure)
          flight.returnArrival = fmtTime(leg1.arrival)
          flight.returnDuration = leg1.durationInMinutes > 0 ? `${Math.floor(leg1.durationInMinutes / 60)}h ${leg1.durationInMinutes % 60}m` : ''
          flight.returnAirline = leg1.carriers?.marketing?.[0]?.name || airline
          flight.returnStops = leg1.stopCount ?? 0
        }
        const agentId = r.pricingOptions?.[0]?.agentIds?.[0]
        if (agentId && agents[agentId]?.name) flight.provider = agents[agentId].name
        flights.push(flight)
      }
      flights.sort((a, b) => (a.priceRaw || Infinity) - (b.priceRaw || Infinity))
      return flights
    } catch (e) { console.error('Skyscanner: parse error:', e.message); return [] }
  }

  const skyUrl = url.replace('skyscanner.es', 'skyscanner.com')
  const emit = (flights, partial) => console.log(JSON.stringify({ site: 'Skyscanner', url: skyUrl, flights, flexDates: [], partial }))

  // Streaming poll loop
  console.error('Skyscanner: waiting for flight data...')
  let lastFlightCount = 0, lastNewTime = Date.now()
  for (let i = 0; i < 20; i++) {
    await wait(3000)
    const flights = buildFlights()
    if (flights.length > lastFlightCount) {
      lastNewTime = Date.now()
      lastFlightCount = flights.length
      emit(flights, true)
      console.error(`Skyscanner: ${flights.length} flights (partial)`)
    } else if (lastFlightCount > 0 && Date.now() - lastNewTime > 5000) {
      console.error('Skyscanner: no new flights for 5s, stopping')
      break
    }
  }

  const finalFlights = buildFlights()
  console.error(`Skyscanner: ${finalFlights.length} flights final`)
  emit(finalFlights, false)
} catch (e) {
  console.error('Skyscanner: error:', e.message)
  console.log(JSON.stringify({ site: 'Skyscanner', url: url.replace('skyscanner.es', 'skyscanner.com'), flights: [], flexDates: [], error: e.message, partial: false }))
} finally {
  await browser.close()
}
```
