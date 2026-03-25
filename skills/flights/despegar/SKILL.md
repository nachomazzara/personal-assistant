---
name: despegar
description: Generate a Despegar.com search link.
---

# No script — generate URL directly

Roundtrip: `https://www.despegar.com.ar/shop/flights/results/roundtrip/{FROM}/{TO}/{YYYY-MM-DD}/{YYYY-MM-DD}/1/0/0`
One-way: `https://www.despegar.com.ar/shop/flights/results/oneway/{FROM}/{TO}/{YYYY-MM-DD}/1/0/0`

Use `BUE` instead of `EZE`/`AEP` for Buenos Aires.

# Rules

- Return ONLY this JSON: `{"site": "Despegar", "url": "<generated URL>", "flights": [], "note": "Manual search required — open URL in browser"}`
- No other text.
