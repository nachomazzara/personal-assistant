---
name: emirates
description: Search for flights on Emirates.
---

# Command

```bash
node skills/flights/emirates/search.mjs --from {IATA} --to {IATA} --departure {YYYY-MM-DD} [--return {YYYY-MM-DD}]
```

# Output format

JSON to stdout: `{ "site": "Emirates", "url": "...", "flights": [...], "flexDates": [] }`

# Rules

- Run the command above with the correct IATA codes and dates from the user's request.
- Your response must be ONLY the raw JSON from stdout. No other text.

## Script

```javascript
#!/usr/bin/env node
/**
 * Emirates flight search.
 * Fills booking form, navigates to results, intercepts branded-fares API.
 */
import puppeteerExtra from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
puppeteerExtra.use(StealthPlugin())

const args = process.argv.slice(2)
const getArg = (n) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : null }
const from = getArg('from'), to = getArg('to'), departure = getArg('departure'), returnDate = getArg('return')
const wait = (ms) => new Promise(r => setTimeout(r, ms))

if (!from || !to || !departure) { console.error('Usage: search.mjs --from IATA --to IATA --departure YYYY-MM-DD [--return YYYY-MM-DD]'); process.exit(1) }

const siteUrl = `https://www.emirates.com/us/english/book/?from=${from}&to=${to}&departing=${departure}${returnDate ? '&returning=' + returnDate : ''}&pax=1,0,0&class=economy&type=${returnDate ? 'return' : 'oneway'}`

// City name lookup for common origins (Emirates autocomplete needs city names)
const cityNames = {
  EZE: 'Buenos Aires', AEP: 'Buenos Aires', JFK: 'New York', LHR: 'London', CDG: 'Paris',
  MAD: 'Madrid', FCO: 'Rome', FRA: 'Frankfurt', IST: 'Istanbul', DXB: 'Dubai',
  NRT: 'Tokyo', HND: 'Tokyo', SIN: 'Singapore', BKK: 'Bangkok', SYD: 'Sydney',
  GRU: 'Sao Paulo', SCL: 'Santiago', BOG: 'Bogota', MIA: 'Miami', LAX: 'Los Angeles',
}

const browser = await puppeteerExtra.launch({
  headless: false,
  channel: 'chrome',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
  defaultViewport: { width: 1366, height: 768 }
})

try {
  const page = await browser.newPage()
  const client = await page.createCDPSession()
  try { const { windowId } = await client.send('Browser.getWindowForTarget'); await client.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } }) } catch {}

  const apiResponses = []

  // Intercept branded-fares API
  page.on('response', async (res) => {
    const u = res.url()
    if (u.includes('branded-fares') || u.includes('search-results')) {
      const ct = res.headers()['content-type'] || ''
      if (!ct.includes('json')) return
      try {
        const t = await res.text()
        if (t.length > 1000) apiResponses.push(t)
      } catch {}
    }
  })

  console.error('Emirates: loading booking page...')
  await page.goto('https://www.emirates.com/us/english/book/', { waitUntil: 'networkidle2', timeout: 60000 })
  await wait(3000)

  // Accept cookies
  await page.evaluate(() => document.querySelector('#onetrust-accept-btn-handler')?.click())
  await wait(2000)

  // Fill origin
  console.error('Emirates: filling origin...')
  const inputs = await page.$$('.input-field__input.ellipsis')
  if (inputs[0]) {
    await inputs[0].click()
    await inputs[0].type(cityNames[from] || from, { delay: 50 })
    await wait(3000)
    await page.evaluate((code) => {
      const items = [...document.querySelectorAll('[role="option"], li[class*="suggestion"], li[class*="item"]')]
      const match = items.find(i => i.offsetParent && i.textContent?.includes(code))
      if (match) match.click()
      else if (items[0]?.offsetParent) items[0].click()
    }, from)
    await wait(2000)
  }

  // Fill destination
  console.error('Emirates: filling destination...')
  if (inputs[1]) {
    await inputs[1].click()
    await inputs[1].type(cityNames[to] || to, { delay: 50 })
    await wait(3000)
    await page.evaluate((code) => {
      const items = [...document.querySelectorAll('[role="option"], li[class*="suggestion"], li[class*="item"]')]
      const match = items.find(i => i.offsetParent && i.textContent?.includes(code))
      if (match) match.click()
      else if (items[0]?.offsetParent) items[0].click()
    }, to)
    await wait(2000)
  }

  // Fill dates
  console.error('Emirates: filling dates...')
  await page.click('#startDate').catch(() => {})
  await wait(1000)

  // Navigate calendar to departure month
  const depDate = new Date(departure + 'T00:00:00')
  const depMonth = depDate.toLocaleString('en-US', { month: 'long' })
  const depYear = depDate.getFullYear()
  const depDay = depDate.getDate()

  for (let i = 0; i < 24; i++) {
    const currentMonth = await page.evaluate(() => {
      const el = document.querySelector('.CalendarMonth_caption strong, [class*="CalendarMonth"] strong')
      return el?.textContent || ''
    })
    if (currentMonth.includes(depMonth) && currentMonth.includes(String(depYear))) break
    await page.evaluate(() => {
      const next = document.querySelector('.DayPickerNavigation_button:last-child, [aria-label*="forward"], [aria-label*="Next"]')
      if (next) next.click()
    })
    await wait(200)
  }

  // Click departure day
  await page.evaluate((month, day) => {
    const pattern = new RegExp(`${month}.*${day}|${day}.*${month}`, 'i')
    for (const td of document.querySelectorAll('td')) {
      if (pattern.test(td.getAttribute('aria-label') || '')) { td.click(); return }
    }
  }, depMonth, depDay)
  await wait(500)

  // Click return day if round trip
  if (returnDate) {
    const retDate = new Date(returnDate + 'T00:00:00')
    const retMonth = retDate.toLocaleString('en-US', { month: 'long' })
    const retYear = retDate.getFullYear()
    const retDay = retDate.getDate()

    // Navigate to return month if different
    if (retMonth !== depMonth || retYear !== depYear) {
      for (let i = 0; i < 12; i++) {
        const currentMonth = await page.evaluate(() => {
          const els = document.querySelectorAll('.CalendarMonth_caption strong')
          return els[els.length - 1]?.textContent || ''
        })
        if (currentMonth.includes(retMonth) && currentMonth.includes(String(retYear))) break
        await page.evaluate(() => {
          document.querySelector('.DayPickerNavigation_button:last-child, [aria-label*="forward"]')?.click()
        })
        await wait(200)
      }
    }

    await page.evaluate((month, day) => {
      const pattern = new RegExp(`${month}.*${day}|${day}.*${month}`, 'i')
      for (const td of document.querySelectorAll('td')) {
        if (pattern.test(td.getAttribute('aria-label') || '') && !td.classList.contains('CalendarDay__selected_start')) { td.click(); return }
      }
    }, retMonth, retDay)
    await wait(1000)
  }

  // Click search
  console.error('Emirates: searching...')
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => /search flights/i.test(b.textContent) && b.offsetParent)
    if (btn) btn.click()
  })

  // Wait for navigation to results
  try { await page.waitForNavigation({ timeout: 45000, waitUntil: 'networkidle2' }) } catch {}
  console.error('Emirates: results page loaded')
  await wait(15000)

  // Parse branded-fares API response
  function buildFlights() {
    const flights = []
    for (const raw of apiResponses) {
      try {
        const data = JSON.parse(raw)
        if (!data.bounds) continue
        const currency = data.currency?.sale?.code || 'USD'

        for (const bound of data.bounds) {
          if (bound.type !== 'OUTBOUND') continue
          const options = bound.options || bound.flightOptions || []
          for (const opt of options) {
            const segments = opt.segments || opt.legs || []
            if (segments.length === 0) continue

            const firstSeg = segments[0]
            const lastSeg = segments[segments.length - 1]
            const depTime = (firstSeg.departureTime || firstSeg.departure || '').substring(11, 16)
            const arrTime = (lastSeg.arrivalTime || lastSeg.arrival || '').substring(11, 16)

            // Duration
            const durMin = opt.duration || opt.totalDuration || 0
            const duration = durMin > 0 ? `${Math.floor(durMin / 60)}h ${durMin % 60}m` : ''

            // Price — check fares array
            let price = 0
            if (opt.fares) {
              const econFare = opt.fares.find(f => f.cabinClass === 'ECONOMY' || f.cabin === 'Y') || opt.fares[0]
              price = econFare?.total?.[0]?.amount || econFare?.price?.amount || 0
            }
            if (!price) price = opt.price?.amount || opt.totalPrice || 0
            if (!price || price <= 0) continue

            // Airline
            const airlines = [...new Set(segments.map(s => s.airline?.name || s.carrier || 'Emirates').filter(Boolean))]

            flights.push({
              price: `$${Math.round(price)}`, priceRaw: Math.round(price),
              airline: airlines.join(' + '),
              departure: depTime, arrival: arrTime,
              duration, durationMin: durMin,
              stops: Math.max(0, segments.length - 1),
              stopCities: segments.slice(0, -1).map(s => s.destination?.code || s.arrival || '').filter(Boolean),
              layovers: [], provider: 'Emirates',
            })
          }
        }
      } catch {}
    }
    flights.sort((a, b) => (a.priceRaw || Infinity) - (b.priceRaw || Infinity))
    return flights
  }

  // If API didn't capture, try DOM scraping
  let flights = buildFlights()
  if (flights.length === 0) {
    console.error('Emirates: no API data, trying DOM scrape...')
    flights = await page.evaluate(() => {
      const results = []
      const text = document.body.innerText
      // Find all USD prices
      const priceMatches = text.matchAll(/USD\s+([\d,]+\.\d{2})/g)
      for (const m of priceMatches) {
        const price = parseFloat(m[1].replace(/,/g, ''))
        if (price > 100 && price < 50000) {
          results.push({
            price: `$${Math.round(price)}`, priceRaw: Math.round(price),
            airline: 'Emirates', departure: '', arrival: '',
            duration: '', durationMin: 0, stops: 0,
            stopCities: [], layovers: [], provider: 'Emirates',
          })
        }
      }
      // Dedup
      const seen = new Set()
      return results.filter(f => { if (seen.has(f.priceRaw)) return false; seen.add(f.priceRaw); return true })
    }).catch(() => [])
  }

  const emit = (f, p) => console.log(JSON.stringify({ site: 'Emirates', url: siteUrl, flights: f, flexDates: [], partial: p }))
  console.error(`Emirates: ${flights.length} flights`)
  emit(flights, false)
} catch (e) {
  console.error('Emirates: error:', e.message)
  console.log(JSON.stringify({ site: 'Emirates', url: siteUrl, flights: [], flexDates: [], error: e.message, partial: false }))
} finally {
  await browser.close()
}
```
