---
name: kiwi
description: Search for flights on Kiwi.com.
---

# Command

```bash
node skills/flights/kiwi/search.mjs --from {IATA} --to {IATA} --departure {YYYY-MM-DD} [--return {YYYY-MM-DD}]
```

# Output format

JSON to stdout: `{ "site": "Kiwi.com", "url": "...", "flights": [...], "flexDates": [] }`

# Rules

- Run the command above with the correct IATA codes and dates from the user's request.
- Your response must be ONLY the raw JSON from stdout. No other text.

## Script

```javascript
#!/usr/bin/env node
/**
 * Kiwi.com flight search via skypicker GraphQL API.
 * No Puppeteer — direct fetch.
 */
const args = process.argv.slice(2)
const getArg = (n) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : null }
const from = getArg('from'), to = getArg('to'), departure = getArg('departure'), returnDate = getArg('return')

if (!from || !to || !departure) { console.error('Usage: search.mjs --from IATA --to IATA --departure YYYY-MM-DD [--return YYYY-MM-DD]'); process.exit(1) }

const siteUrl = `https://www.kiwi.com/en/search/results/${from}/${to}/${departure}${returnDate ? '/' + returnDate : ''}?adults=1&cabinClass=economy`

const QUERY = `query SearchReturnItinerariesQuery(
  $search: SearchReturnInput
  $filter: ItinerariesFilterInput
  $options: ItinerariesOptionsInput
) {
  returnItineraries(search: $search, filter: $filter, options: $options) {
    __typename
    ... on AppError { error: message }
    ... on Itineraries {
      itineraries {
        __typename
        ... on ItineraryReturn {
          __isItinerary: __typename
          id
          shareId
          price { amount priceBeforeDiscount }
          priceEur { amount }
          provider { name code id }
          outbound {
            sectorSegments {
              segment {
                source { station { code name } localTime }
                destination { station { code name } localTime }
                carrier { code name }
                duration
                code
              }
              layover { duration }
            }
            duration
          }
          inbound {
            sectorSegments {
              segment {
                source { station { code name } localTime }
                destination { station { code name } localTime }
                carrier { code name }
                duration
                code
              }
              layover { duration }
            }
            duration
          }
        }
      }
    }
  }
}`

const ONEWAY_QUERY = `query SearchOnewayItinerariesQuery(
  $search: SearchOnewayInput
  $filter: ItinerariesFilterInput
  $options: ItinerariesOptionsInput
) {
  onewayItineraries(search: $search, filter: $filter, options: $options) {
    __typename
    ... on AppError { error: message }
    ... on Itineraries {
      itineraries {
        __typename
        ... on ItineraryOneWay {
          __isItinerary: __typename
          id
          price { amount }
          priceEur { amount }
          provider { name code id }
          sector {
            sectorSegments {
              segment {
                source { station { code name } localTime }
                destination { station { code name } localTime }
                carrier { code name }
                duration
                code
              }
              layover { duration }
            }
            duration
          }
        }
      }
    }
  }
}`

const isReturn = !!returnDate
const depStart = `${departure}T00:00:00`
const depEnd = `${departure}T23:59:59`

const itinerary = {
  source: { ids: [`Station:airport:${from}`] },
  destination: { ids: [`Station:airport:${to}`] },
  outboundDepartureDate: { start: depStart, end: depEnd },
}
if (isReturn) {
  itinerary.inboundDepartureDate = { start: `${returnDate}T00:00:00`, end: `${returnDate}T23:59:59` }
}

const variables = {
  search: {
    itinerary,
    passengers: { adults: 1, children: 0, infants: 0, adultsHoldBags: [0], adultsHandBags: [0], childrenHoldBags: [], childrenHandBags: [] },
    cabinClass: { cabinClass: 'ECONOMY', applyMixedClasses: true }
  },
  filter: {
    allowChangeInboundDestination: true, allowChangeInboundSource: true,
    allowDifferentStationConnection: true, enableSelfTransfer: true,
    transportTypes: ['FLIGHT']
  },
  options: {
    sortBy: 'PRICE', currency: 'usd', locale: 'en', partner: 'skypicker',
    sortOrder: 'ASCENDING'
  }
}

const featureName = isReturn ? 'SearchReturnItinerariesQuery' : 'SearchOnewayItinerariesQuery'
const query = isReturn ? QUERY : ONEWAY_QUERY

async function searchKiwi() {
  const resp = await fetch(`https://api.skypicker.com/umbrella/v2/graphql?featureName=${featureName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
      'Origin': 'https://www.kiwi.com',
      'Referer': 'https://www.kiwi.com/',
    },
    body: JSON.stringify({ operationName: featureName, query, variables })
  })
  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`API ${resp.status}: ${text.slice(0, 300)}`)
  }
  return await resp.json()
}

function parseLeg(leg) {
  if (!leg) return null
  const segs = leg.sectorSegments || []
  if (segs.length === 0) return null
  const first = segs[0].segment, last = segs[segs.length - 1].segment
  const dep = (first.source.localTime || '').substring(11, 16)
  const arr = (last.destination.localTime || '').substring(11, 16)
  const airlines = [...new Set(segs.map(s => s.segment.carrier?.name || s.segment.carrier?.code || '').filter(Boolean))]
  const durMin = Math.round((leg.duration || 0) / 60)
  const stops = Math.max(0, segs.length - 1)
  const stopCities = segs.slice(0, -1).map(s => s.segment.destination.station?.code || '').filter(Boolean)
  const layovers = segs.filter(s => s.layover?.duration).map(s => {
    const m = Math.round(s.layover.duration / 60)
    return `${Math.floor(m / 60)}h ${m % 60}m`
  })
  return { dep, arr, airlines, durMin, stops, stopCities, layovers }
}

function parseFlights(data) {
  const result = data.data?.returnItineraries || data.data?.onewayItineraries
  if (!result || result.__typename === 'AppError') return []
  const itineraries = result.itineraries || []
  const flights = []

  for (const itin of itineraries) {
    try {
      const price = parseFloat(itin.price?.amount)
      if (!price || price <= 0) continue

      const outLeg = parseLeg(itin.outbound || itin.sector)
      if (!outLeg) continue

      const flight = {
        price: `$${Math.round(price)}`, priceRaw: Math.round(price),
        airline: outLeg.airlines.join(' + ') || 'Unknown',
        departure: outLeg.dep, arrival: outLeg.arr,
        duration: outLeg.durMin > 0 ? `${Math.floor(outLeg.durMin / 60)}h ${outLeg.durMin % 60}m` : '',
        durationMin: outLeg.durMin, stops: outLeg.stops, stopCities: outLeg.stopCities,
        layovers: outLeg.layovers, provider: 'Kiwi.com',
      }

      if (itin.inbound) {
        const retLeg = parseLeg(itin.inbound)
        if (retLeg) {
          flight.returnDeparture = retLeg.dep
          flight.returnArrival = retLeg.arr
          flight.returnDuration = retLeg.durMin > 0 ? `${Math.floor(retLeg.durMin / 60)}h ${retLeg.durMin % 60}m` : ''
          flight.returnAirline = retLeg.airlines.join(' + ') || flight.airline
          flight.returnStops = retLeg.stops
        }
      }

      flights.push(flight)
    } catch {}
  }

  flights.sort((a, b) => (a.priceRaw || Infinity) - (b.priceRaw || Infinity))
  return flights
}

const emit = (flights, partial) => console.log(JSON.stringify({ site: 'Kiwi.com', url: siteUrl, flights, flexDates: [], partial }))

try {
  console.error('Kiwi.com: searching...')
  const data = await searchKiwi()
  const flights = parseFlights(data)
  console.error(`Kiwi.com: ${flights.length} flights`)
  emit(flights, false)
} catch (e) {
  console.error('Kiwi.com: error:', e.message)
  emit([], false)
}
```
