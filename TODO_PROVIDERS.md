# Flight Providers

## Active

| Provider | Type | Coverage | Flex Dates | Anti-bot | Notes |
|----------|------|----------|------------|----------|-------|
| Google Flights | Aggregator | Global | YES (date grid) | Low | Best overall coverage, nested array parsing |
| Skyscanner | Aggregator | Global | NO | HIGH (PerimeterX) | Needs rebrowser, EUR→USD conversion |
| Kayak | Aggregator | Global | NO | Medium | CSRF token needed, poll-based API |
| Turismocity | Aggregator | LATAM | NO | Low | Stride-based parsing, BUE metro code |
| Aerolíneas Argentinas | Direct airline | Argentina/SA | YES (calendar API) | Low | Auth0 JWT auto-captured |

## Recently Added

| Provider | Type | Approach | Status |
|----------|------|----------|--------|
| Kiwi.com | Aggregator | GraphQL API (skypicker) | **WORKING** — 50 flights, ~2s, no Puppeteer |
| LATAM Airlines | Direct airline | Form fill (CDP clicks) + DOM scrape | **WORKING** — 32 flights, ~50s |
| Emirates | Direct airline | Form fill + DOM scrape | **WORKING** — 2 flights (limited route), ~60s |
| Turkish Airlines | Direct airline | react-calendar form + API/DOM | **WORKING** — 25 flights, ~60s |

## On Hold (anti-bot protection)

| Provider | Type | Blocker | Status |
|----------|------|---------|--------|
| Iberia | Direct airline | Akamai Bot Manager | No form inputs detected |
| Despegar | OTA | DataDome captcha-delivery | Bot detected, error page shown |

**When to revisit**: Only if users report exclusive fares on these airlines that don't appear in aggregator results.

## Planned — Aggregators/OTAs

| # | Provider | Type | Priority | Why |
|---|----------|------|----------|-----|
| 1 | Despegar | OTA | High | Biggest LATAM OTA, exclusive AR fares |
| 2 | Momondo | Aggregator | Medium | Different inventory than Kayak |

## Planned — Airlines: Americas

| # | Provider | Hub/Region | Priority | Why |
|---|----------|------------|----------|-----|
| 3 | LATAM Airlines | Santiago, SA-wide | High | Major SA carrier |
| 4 | American Airlines | US hubs | Medium | US major, codeshares with AR |
| 5 | Delta | Atlanta, US | Medium | US major |
| 6 | United | US hubs | Medium | US major |
| 7 | Copa Airlines | Panama City | Medium | Key Americas hub |

## Planned — Airlines: Europe/Middle East

| # | Provider | Hub/Region | Priority | Why |
|---|----------|------------|----------|-----|
| 8 | Iberia | Madrid | High | Direct EZE→MAD, key for AR→Europe |
| 9 | Air Europa | Madrid | High | Direct EZE→MAD, competitive pricing |
| 10 | Lufthansa | Frankfurt | Medium | Europe hub, Star Alliance |
| 11 | Turkish Airlines | Istanbul | High | Global hub, competitive long-haul |
| 12 | Emirates | Dubai | High | Premium long-haul, good EZE routes |
| 13 | Qatar Airways | Doha | Medium | Premium long-haul |

## Planned — Airlines: Asia/Pacific/Africa

| # | Provider | Hub/Region | Priority | Why |
|---|----------|------------|----------|-----|
| 14 | ANA | Tokyo | Medium | Japan direct |
| 15 | Air China / China Southern | Beijing/Guangzhou | Low | China routes |
| 16 | Qantas | Sydney | Low | Australia routes |
| 17 | Ethiopian Airlines | Addis Ababa | Low | Africa hub, Star Alliance |
