# TFI Go

A fast, modern web app for real-time Irish public transport departures. Built with vanilla HTML/CSS/JS and a lightweight Express proxy.

**Live:** [claudiusthebot.duckdns.org/tfi](https://claudiusthebot.duckdns.org/tfi)

![Material You](https://img.shields.io/badge/design-Material%20You-00B74F) ![TFI API](https://img.shields.io/badge/data-TFI%20API-blue)

## Features

- **Real-time departures** — Live countdown timers with auto-refresh
- **Nearby stops** — GPS-based discovery with distance badges and quick departure previews
- **Interactive map** — Leaflet with marker clustering, stop browsing, and locate-me button
- **Trip tracking** — Full stop-by-stop timeline with live vehicle position on map
- **Service alerts** — Disruption banners pulled from TFI situations API
- **Stop facilities** — Shelter, wheelchair access, real-time display info
- **Scheduled fallback** — Falls back to timetable data when real-time isn't available
- **Favourites** — Save frequently used stops (localStorage)
- **Dark mode** — Automatic + manual toggle, full Material You theming
- **PWA-ready** — Mobile-optimised with viewport-fit cover

## Stack

| Layer | Tech |
|-------|------|
| Frontend | Vanilla JS, CSS custom properties, Leaflet.js |
| Backend | Express.js proxy server |
| Data | TFI Public LTS API |
| Design | Material Design 3 / Material You |

## Setup

```bash
# Clone
git clone https://github.com/dylanneve1/tfi-go-html.git
cd tfi-go-html

# Install deps
npm install

# Run
node server.js
# → http://127.0.0.1:3847
```

## Architecture

The Express server acts as a thin proxy to the TFI API, injecting the API subscription key server-side. This keeps the key out of client code and avoids CORS issues.

```
Browser  →  Express proxy (:3847)  →  TFI Public LTS API
                ↓
         Static files (public/)
```

### API Endpoints

**GET (proxied):**
- `/api/locationLookup` — Search stops/stations by name
- `/api/operatorList` — List transport operators
- `/api/stops` — Fetch stops in bounding box (uses `visibleLookupRequest` internally, cached 2min)

**POST (proxied):**
- `/api/departures` — Real-time departures for a stop
- `/api/estimatedTimetable` — Estimated arrival times
- `/api/timetable` — Scheduled timetable (fallback)
- `/api/vehicleLocation` — Live vehicle positions
- `/api/visibleLookupRequest` — Stops within map viewport
- `/api/serviceLookup` — Service/route details
- `/api/situations/stops` — Service alerts for stops
- `/api/situations/services` — Service alerts for routes
- `/api/stopsAssets` — Stop facilities (shelter, accessibility)
- `/api/servicesAssets` — Service/route metadata

### Caching

The `/api/stops` endpoint uses server-side caching with:
- 500m grid snapping on coordinates (reduces duplicate requests)
- 2-minute TTL

## Deployment

Designed to sit behind a reverse proxy. Example Caddy config:

```
handle_path /tfi/* {
    reverse_proxy 127.0.0.1:3847
}
```

Or run standalone with PM2:

```bash
pm2 start server.js --name tfi-go
```

## License

MIT
