---
name: turkish
description: Search for flights on Turkish Airlines.
---

# Command

```bash
node skills/flights/turkish/search.mjs --from {IATA} --to {IATA} --departure {YYYY-MM-DD} [--return {YYYY-MM-DD}]
```

# Output format

JSON to stdout: `{ "site": "Turkish Airlines", "url": "...", "flights": [...], "flexDates": [] }`

# Rules

- Run the command above with the correct IATA codes and dates from the user's request.
- Your response must be ONLY the raw JSON from stdout. No other text.

## Script

```javascript
#!/usr/bin/env node
/**
 * Turkish Airlines flight search.
 * Fills react-calendar booking form, intercepts /api/v1/availability API.
 */
import puppeteerExtra from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
puppeteerExtra.use(StealthPlugin())

const args = process.argv.slice(2)
const getArg = (n) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : null }
const from = getArg('from'), to = getArg('to'), departure = getArg('departure'), returnDate = getArg('return')
const wait = (ms) => new Promise(r => setTimeout(r, ms))

if (!from || !to || !departure) { console.error('Usage: search.mjs --from IATA --to IATA --departure YYYY-MM-DD [--return YYYY-MM-DD]'); process.exit(1) }

const siteUrl = `https://www.turkishairlines.com/en-us/flights/booking/?origin=${from}&destination=${to}`
const cityNames = {
  EZE: 'Buenos Aires', AEP: 'Buenos Aires', JFK: 'New York', LHR: 'London', CDG: 'Paris',
  MAD: 'Madrid', FCO: 'Rome', FRA: 'Frankfurt', IST: 'Istanbul', DXB: 'Dubai',
  NRT: 'Tokyo', HND: 'Tokyo', SIN: 'Singapore', BKK: 'Bangkok', SYD: 'Sydney',
  GRU: 'Sao Paulo', SCL: 'Santiago', MIA: 'Miami', LAX: 'Los Angeles', BOG: 'Bogota',
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

  page.on('response', async (res) => {
    const u = res.url()
    if (u.includes('/api/v1/availability') || u.includes('ibs/booking/availability')) {
      const ct = res.headers()['content-type'] || ''
      if (!ct.includes('json')) return
      try {
        const t = await res.text()
        if (t.length > 5000) apiResponses.push(t)
      } catch {}
    }
  })

  console.error('Turkish: loading...')
  await page.goto('https://www.turkishairlines.com/en-us/flights/booking/', { waitUntil: 'networkidle2', timeout: 60000 })
  await wait(5000)
  await page.evaluate(() => document.querySelector('#onetrust-accept-btn-handler')?.click())
  await wait(2000)

  // Origin
  console.error('Turkish: origin...')
  await page.click('#fromPort')
  await page.type('#fromPort', cityNames[from] || from, { delay: 40 })
  await wait(3000)
  await page.evaluate(() => {
    const items = [...document.querySelectorAll('[class*="clickable"][class*="booker-input"]')]
    const first = items.find(e => e.offsetParent)
    if (first) first.click()
  })
  await wait(2000)

  // Destination
  console.error('Turkish: destination...')
  await page.click('#toPort')
  await page.type('#toPort', cityNames[to] || to, { delay: 40 })
  await wait(3000)
  await page.evaluate(() => {
    const items = [...document.querySelectorAll('[class*="clickable"][class*="booker-input"]')]
    const first = items.find(e => e.offsetParent)
    if (first) first.click()
  })
  await wait(2000)

  // Open calendar
  console.error('Turkish: dates...')
  await page.evaluate(() => {
    const el = document.querySelector('[class*="dateWrapper"], [class*="calendarValue"]')
    if (el) el.click()
  })
  await wait(2000)

  // Navigate to departure month using react-calendar › button
  const depDate = new Date(departure + 'T00:00:00')
  const now = new Date()
  const monthsAhead = (depDate.getFullYear() - now.getFullYear()) * 12 + (depDate.getMonth() - now.getMonth())

  for (let i = 0; i < monthsAhead; i++) {
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('.react-calendar__navigation__arrow')].find(b => b.textContent?.trim() === '›' && !b.disabled)
      if (btn) btn.click()
    })
    await wait(250)
  }

  // Click departure day
  const depDay = String(depDate.getDate())
  await page.evaluate((day) => {
    const tiles = [...document.querySelectorAll('.react-calendar__tile:not(.react-calendar__tile--disabled)')]
    const tile = tiles.find(t => t.querySelector('abbr')?.textContent?.trim() === day)
    if (tile) tile.click()
  }, depDay)
  await wait(500)

  // Click return day
  if (returnDate) {
    const retDate = new Date(returnDate + 'T00:00:00')
    const extraMonths = retDate.getMonth() - depDate.getMonth() + (retDate.getFullYear() - depDate.getFullYear()) * 12
    for (let i = 0; i < extraMonths; i++) {
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('.react-calendar__navigation__arrow')].find(b => b.textContent?.trim() === '›' && !b.disabled)
        if (btn) btn.click()
      })
      await wait(250)
    }
    const retDay = String(retDate.getDate())
    await page.evaluate((day) => {
      const tiles = [...document.querySelectorAll('.react-calendar__tile:not(.react-calendar__tile--disabled)')]
      const tile = tiles.find(t => t.querySelector('abbr')?.textContent?.trim() === day)
      if (tile) tile.click()
    }, retDay)
    await wait(500)
  }

  // Click OK
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => /^OK$/i.test(b.textContent?.trim()) && b.offsetParent)
    if (btn) btn.click()
  })
  await wait(1000)

  // Search
  console.error('Turkish: searching...')
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => /search flights/i.test(b.textContent?.trim()) && b.offsetParent)
    if (btn) btn.click()
  })

  try { await page.waitForNavigation({ timeout: 60000, waitUntil: 'networkidle2' }) } catch {}
  console.error('Turkish: results loaded')
  await wait(15000)

  // Parse availability API
  function buildFlights() {
    const flights = []
    for (const raw of apiResponses) {
      try {
        const data = JSON.parse(raw)
        const odList = data.data?.originDestinationInformationList || []
        for (const od of odList) {
          const options = od.originDestinationOptionList || []
          for (const opt of options) {
            const segments = opt.flightSegmentList || []
            if (segments.length === 0) continue

            const first = segments[0], last = segments[segments.length - 1]
            const depTime = (first.departureDateTime || '').substring(11, 16)
            const arrTime = (last.arrivalDateTime || '').substring(11, 16)
            const durMin = opt.totalJourneyDuration || 0

            // Prices from fareComponentList
            const fareList = opt.fareComponentList || []
            for (const fare of fareList) {
              const cabin = fare.cabinClassName || ''
              if (cabin && !cabin.toLowerCase().includes('economy') && !cabin.toLowerCase().includes('eco')) continue
              const price = fare.totalFare?.amount || fare.baseFare?.amount || 0
              const currency = fare.totalFare?.currencyCode || 'USD'
              if (!price || price <= 0) continue

              const airlines = [...new Set(segments.map(s => s.marketingAirlineName || s.operatingAirlineName || 'Turkish Airlines'))]
              const stopCities = segments.slice(0, -1).map(s => s.arrivalAirportCode || '').filter(Boolean)

              flights.push({
                price: `$${Math.round(price)}`, priceRaw: Math.round(price),
                airline: airlines.join(' + '),
                departure: depTime, arrival: arrTime,
                duration: durMin > 0 ? `${Math.floor(durMin / 60)}h ${durMin % 60}m` : '',
                durationMin: durMin,
                stops: Math.max(0, segments.length - 1),
                stopCities, layovers: [],
                provider: 'Turkish Airlines',
              })
              break // Only take first economy fare per option
            }
          }
        }
      } catch {}
    }
    flights.sort((a, b) => (a.priceRaw || Infinity) - (b.priceRaw || Infinity))
    return flights
  }

  let flights = buildFlights()

  // DOM fallback
  if (flights.length === 0) {
    console.error('Turkish: no API data, trying DOM...')
    flights = await page.evaluate(() => {
      const results = []
      const items = document.querySelectorAll('[class*="flightItem"], [class*="FlightItem"]')
      for (const item of items) {
        const text = item.textContent || ''
        const priceMatch = text.match(/USD([\d,]+\.?\d*)/)
        if (!priceMatch) continue
        const price = parseFloat(priceMatch[1].replace(/,/g, ''))
        if (!price || price <= 0) continue

        const times = text.match(/(\d{2}:\d{2})/g) || []
        const durMatch = text.match(/(\d+)h\s*(\d+)m/)
        const durationMin = durMatch ? parseInt(durMatch[1]) * 60 + parseInt(durMatch[2]) : 0

        results.push({
          price: `$${Math.round(price)}`, priceRaw: Math.round(price),
          airline: 'Turkish Airlines',
          departure: times[0] || '', arrival: times[1] || '',
          duration: durationMin > 0 ? `${Math.floor(durationMin / 60)}h ${durationMin % 60}m` : '',
          durationMin, stops: 0, stopCities: [], layovers: [],
          provider: 'Turkish Airlines',
        })
      }
      return results
    }).catch(() => [])
  }

  const emit = (f, p) => console.log(JSON.stringify({ site: 'Turkish Airlines', url: siteUrl, flights: f, flexDates: [], partial: p }))
  console.error(`Turkish: ${flights.length} flights`)
  emit(flights, false)
} catch (e) {
  console.error('Turkish: error:', e.message)
  console.log(JSON.stringify({ site: 'Turkish Airlines', url: siteUrl, flights: [], flexDates: [], error: e.message, partial: false }))
} finally {
  await browser.close()
}
```
