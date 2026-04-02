---
name: latam
description: Search for flights on LATAM Airlines.
---

# Command

```bash
node skills/flights/latam/search.mjs --from {IATA} --to {IATA} --departure {YYYY-MM-DD} [--return {YYYY-MM-DD}]
```

# Output format

JSON to stdout: `{ "site": "LATAM Airlines", "url": "...", "flights": [...], "flexDates": [] }`

# Rules

- Run the command above with the correct IATA codes and dates from the user's request.
- Your response must be ONLY the raw JSON from stdout. No other text.

## Script

```javascript
#!/usr/bin/env node
/**
 * LATAM Airlines flight search.
 * Fills booking form via CDP mouse events (React controlled inputs),
 * then captures flight data from the results page.
 */
import puppeteerExtra from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
puppeteerExtra.use(StealthPlugin())

const args = process.argv.slice(2)
const getArg = (n) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : null }
const from = getArg('from'), to = getArg('to'), departure = getArg('departure'), returnDate = getArg('return')
const wait = (ms) => new Promise(r => setTimeout(r, ms))

if (!from || !to || !departure) { console.error('Usage: search.mjs --from IATA --to IATA --departure YYYY-MM-DD [--return YYYY-MM-DD]'); process.exit(1) }

const tripType = returnDate ? 'RT' : 'OW'
const siteUrl = `https://www.latamairlines.com/us/en/flight-offers?origin=${from}&destination=${to}&outbound=${departure}T00:00:00.000Z${returnDate ? '&inbound=' + returnDate + 'T00:00:00.000Z' : ''}&adt=1&chd=0&inf=0&trip=${tripType}&cabin=Economy&redemption=false&sort=RECOMMENDED`

const browser = await puppeteerExtra.launch({
  headless: false,
  channel: 'chrome',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
  defaultViewport: { width: 1366, height: 768 }
})

try {
  const page = await browser.newPage()
  const client = await page.createCDPSession()
  // Minimize window
  try { const { windowId } = await client.send('Browser.getWindowForTarget'); await client.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } }) } catch {}

  const apiResponses = []

  // CDP click helper — needed for LATAM's React controlled inputs
  async function cdpClick(selector) {
    const box = await page.evaluate(sel => {
      const el = document.querySelector(sel)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    }, selector)
    if (!box || box.x <= 0) return false
    await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 })
    await wait(50)
    await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 })
    return true
  }

  // Calculate months to navigate from current month to target month
  const now = new Date()
  const depDate = new Date(departure + 'T00:00:00')
  const monthsAhead = (depDate.getFullYear() - now.getFullYear()) * 12 + (depDate.getMonth() - now.getMonth())
  const depDay = depDate.getDate().toString()
  const retDay = returnDate ? new Date(returnDate + 'T00:00:00').getDate().toString() : null

  console.error('LATAM: loading homepage...')
  await page.goto('https://www.latamairlines.com/us/en/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {})
  await wait(8000)

  // Dismiss popups aggressively
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => {
      document.querySelector('[data-testid="country-suggestion--dialog"] button')?.click()
      document.querySelector('#onetrust-accept-btn-handler')?.click()
      for (const b of document.querySelectorAll('button')) {
        if (b.offsetParent && /close/i.test(b.getAttribute('aria-label') || '')) b.click()
      }
    })
    await wait(800)
  }

  // Fill origin
  console.error('LATAM: filling origin...')
  const originEl = await page.$('[data-testid="fsb-origin--text-field"]')
  await originEl.click({ clickCount: 3 })
  await originEl.type(from, { delay: 50 })
  await wait(3000)
  // Click the matching suggestion via CDP
  const originClicked = await cdpClick(`[id*="${from.toLowerCase()}_"][id*="autocomplete__listitem--menuitem__content"]`)
  if (!originClicked) {
    // Fallback: click first listbox item
    await cdpClick('ul[role="listbox"] li')
  }
  await wait(2000)

  // Fill destination
  console.error('LATAM: filling destination...')
  const destEl = await page.$('[data-testid="fsb-destination--text-field"]')
  await destEl.click()
  await destEl.type(to, { delay: 50 })
  await wait(3000)
  const destClicked = await cdpClick(`[id*="${to.toLowerCase()}_"][id*="autocomplete__listitem--menuitem__content"]`)
  if (!destClicked) {
    await cdpClick('ul[role="listbox"] li')
  }
  await wait(2000)

  // Open calendar
  console.error('LATAM: selecting dates...')
  for (let i = 0; i < 3; i++) {
    await cdpClick('[data-testid="fsb-departure--text-field"]')
    await wait(2000)
    const open = await page.$('[data-testid="fsb-calendar-container-desktop"]')
    if (open) break
  }

  // Navigate to target month
  for (let i = 0; i < monthsAhead; i++) {
    await cdpClick('[data-testid="fsb-calendar-desktop--btn-next-month"]')
    await wait(250)
  }

  // Click departure day
  await page.evaluate((day) => {
    for (const b of document.querySelectorAll('button')) {
      if (b.textContent?.trim() === day && b.offsetParent && !b.disabled && b.closest('[data-testid*="calendar"]')) { b.click(); return }
    }
  }, depDay)
  await wait(500)

  // Click return day if round trip
  if (retDay) {
    await page.evaluate((day) => {
      for (const b of document.querySelectorAll('button')) {
        if (b.textContent?.trim() === day && b.offsetParent && !b.disabled && b.closest('[data-testid*="calendar"]')) { b.click(); return }
      }
    }, retDay)
    await wait(500)
  }

  // Confirm dates
  await page.evaluate(() => {
    for (const b of document.querySelectorAll('button')) {
      if (/confirm|apply|done|select/i.test(b.textContent?.trim()) && b.offsetParent) b.click()
    }
  })
  await wait(1000)

  // Click search — this opens flight-offers in a new tab
  console.error('LATAM: searching...')
  await page.evaluate(() => window.scrollTo(0, 0))
  await wait(300)

  // Listen for new page (results open in new tab)
  const newPagePromise = new Promise(resolve => browser.once('targetcreated', async target => {
    const p = await target.page()
    if (p) resolve(p)
  }))

  await cdpClick('[data-testid="fsb-search-flights--button"]')

  // Wait for the new page with flight results
  let resultsPage = await Promise.race([newPagePromise, wait(10000).then(() => null)])

  if (!resultsPage) {
    // Maybe it navigated in same tab
    const pages = await browser.pages()
    resultsPage = pages.find(p => p.url().includes('flight-offers')) || page
  }

  // Set up API interception on results page
  resultsPage.on('response', async (res) => {
    const ct = res.headers()['content-type'] || ''
    if (!ct.includes('json')) return
    const u = res.url()
    if (/google|medallia|exponea|absmartly|fullstory|onetrust|cookielaw|segment|insider|pisano|booking/.test(u)) return
    try {
      const t = await res.text()
      if (t.length > 5000 && (t.includes('"price"') || t.includes('"fare"') || t.includes('"amount"') || u.includes('offer') || u.includes('bff/air'))) {
        apiResponses.push(t)
      }
    } catch {}
  })

  console.error('LATAM: waiting for results...')
  try { await resultsPage.waitForNetworkIdle({ timeout: 30000 }) } catch {}
  await wait(10000)

  // Parse flight data from API responses
  function buildFlights() {
    const flights = []
    for (const raw of apiResponses) {
      try {
        const data = JSON.parse(raw)
        // LATAM BFF response structure — try common patterns
        const items = data.flights || data.itineraries || data.data?.flights || data.data?.itineraries || []
        const arr = Array.isArray(items) ? items : Object.values(items)
        for (const item of arr) {
          try {
            const price = item.price?.amount || item.fare?.total || item.lowestPrice?.amount || item.totalPrice || 0
            if (!price || price <= 0) continue
            flights.push({
              price: `$${Math.round(price)}`, priceRaw: Math.round(price),
              airline: item.airline || item.carrier || item.airlines?.[0] || 'LATAM',
              departure: (item.departure || item.departureTime || '').substring(11, 16),
              arrival: (item.arrival || item.arrivalTime || '').substring(11, 16),
              duration: '', durationMin: 0,
              stops: item.stops || 0, stopCities: [], layovers: [],
              provider: 'LATAM Airlines',
            })
          } catch {}
        }
      } catch {}
    }
    flights.sort((a, b) => (a.priceRaw || Infinity) - (b.priceRaw || Infinity))
    return flights
  }

  const emit = (flights, partial) => console.log(JSON.stringify({ site: 'LATAM Airlines', url: siteUrl, flights, flexDates: [], partial }))

  // Dismiss country dialog on results page
  await wait(2000)
  await resultsPage.evaluate(() => {
    for (const b of document.querySelectorAll('button')) {
      if (b.offsetParent && /continue|united states|close/i.test(b.textContent?.trim())) b.click()
    }
  }).catch(() => {})
  await wait(2000)

  // If no API data captured, scrape the page DOM
  let flights = buildFlights()
  if (flights.length === 0) {
    console.error('LATAM: no API data, trying DOM scrape...')
    flights = await resultsPage.evaluate(() => {
      const results = []
      // LATAM uses data-testid="flight-info-N" for each flight card
      // Text format: "12:15 PMEZEDuration20h 40m1:55 PM+1MADPer passenger fromusd 1,244.84Includes taxes"
      for (let i = 0; i < 50; i++) {
        const card = document.querySelector(`[data-testid="flight-info-${i}"]`)
        if (!card) break
        const text = card.textContent || ''

        // Price: match "usd X,XXX.XX"
        const priceMatch = text.match(/usd\s+([\d,]+\.?\d*)/i)
        if (!priceMatch) continue
        const price = parseFloat(priceMatch[1].replace(/,/g, ''))
        if (!price || price <= 0) continue

        // Times: first two times in "HH:MM AM/PM" format
        const times = text.match(/(\d{1,2}:\d{2}\s*[AP]M)/gi) || []
        const depTime = times[0]?.trim() || ''
        const arrTime = times[1]?.trim() || ''

        // Duration: "XXh YYm"
        const durMatch = text.match(/(\d+)h\s*(\d+)m/)
        const durationMin = durMatch ? parseInt(durMatch[1]) * 60 + parseInt(durMatch[2]) : 0

        // Stops: "Direct" or "N stop(s)"
        const stopsMatch = text.match(/(\d+)\s*stop/i)
        const stops = text.includes('Direct') ? 0 : (stopsMatch ? parseInt(stopsMatch[1]) : 0)

        // Convert 12h to 24h format
        const to24h = (t) => {
          if (!t) return ''
          const m = t.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i)
          if (!m) return t
          let h = parseInt(m[1])
          if (m[3].toUpperCase() === 'PM' && h !== 12) h += 12
          if (m[3].toUpperCase() === 'AM' && h === 12) h = 0
          return `${String(h).padStart(2, '0')}:${m[2]}`
        }

        results.push({
          price: `$${Math.round(price)}`, priceRaw: Math.round(price),
          airline: 'LATAM',
          departure: to24h(depTime), arrival: to24h(arrTime),
          duration: durationMin > 0 ? `${Math.floor(durationMin / 60)}h ${durationMin % 60}m` : '',
          durationMin, stops, stopCities: [], layovers: [],
          provider: 'LATAM Airlines',
        })
      }
      return results
    }).catch(() => [])
  }

  console.error(`LATAM: ${flights.length} flights`)
  emit(flights, false)
} catch (e) {
  console.error('LATAM: error:', e.message)
  console.log(JSON.stringify({ site: 'LATAM Airlines', url: siteUrl, flights: [], flexDates: [], error: e.message, partial: false }))
} finally {
  await browser.close()
}
```
