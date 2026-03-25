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
const MAX = 50, wait = (ms) => new Promise(r => setTimeout(r, ms))

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

    function extractOffers(arr, d = 0) {
      if (d > 6 || results.length >= MAX || !Array.isArray(arr)) return
      for (const item of arr) {
        if (!Array.isArray(item)) continue
        if (item.length >= 2 && Array.isArray(item[0]) && Array.isArray(item[1])) {
          const offer = item[0], priceInfo = item[1]
          if (typeof offer[0] === 'string' && offer[0].length === 2 && Array.isArray(offer[1])) {
            const airlineName = offer[1]?.[0] || offer[0]
            const origin = offer[3], dest = offer[6]
            const depTime = offer[5], arrTime = offer[8]
            const duration = offer[9], stops = offer[10]
            const price = priceInfo?.[0]?.[1]
            const stopovers = offer[11] || []
            if (origin && dest && typeof duration === 'number' && price) {
              const fmtTime = (t) => (Array.isArray(t) && typeof t[0] === 'number' && typeof t[1] === 'number') ? `${String(t[0]).padStart(2, '0')}:${String(t[1]).padStart(2, '0')}` : ''
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
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
  defaultViewport: { width: 1366, height: 768 }
})

try {
  const page = await browser.newPage()
  const apiCalls = []
  page.on('response', async (res) => {
    if ((res.url().includes('GetShoppingResults') || res.url().includes('FlightsFrontendService')) && !res.url().includes('gstatic.com')) {
      try { const t = await res.text(); if (t.length > 1000) apiCalls.push(t) } catch {}
    }
  })

  const dep = new Date(departure + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const ret = returnDate ? new Date(returnDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''
  const query = returnDate ? `flights from ${from} to ${to} on ${dep} returning ${ret}` : `flights from ${from} to ${to} on ${dep} one way`
  const url = `https://www.google.com/travel/flights?q=${encodeURIComponent(query)}&hl=en&curr=USD`

  console.error('Google Flights: loading...')
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 })
  try { const btn = await page.$('button[aria-label="Accept all"], button[id="L2AGLb"]'); if (btn) { await btn.click(); await wait(5000) } } catch {}

  // Wait for initial API response
  for (let i = 0; i < 10; i++) { if (apiCalls.length > 0) break; await wait(3000) }
  console.error(`Google Flights: ${apiCalls.length} initial API calls`)

  // Click "View more flights" repeatedly and wait for new data
  await wait(5000)
  for (let i = 0; i < 8; i++) {
    const prev = apiCalls.length
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
    console.error(`Google Flights: ${apiCalls.length} API calls after "View more" click ${i + 1}`)
  }

  // Final wait for any remaining API responses
  await wait(5000)

  let flights = []
  for (const call of apiCalls) {
    for (const f of parseResponse(call)) {
      if (!flights.some(e => e.priceRaw === f.priceRaw && e.airline === f.airline && e.departure === f.departure)) flights.push(f)
    }
  }
  flights.sort((a, b) => (a.priceRaw || Infinity) - (b.priceRaw || Infinity))
  console.error(`Google Flights: ${flights.length} flights from ${apiCalls.length} API calls`)
  console.log(JSON.stringify({ site: 'Google Flights', url, flights: flights.slice(0, MAX) }))
} finally {
  await browser.close()
}
```
