const express = require('express');
const https = require('https');
const path = require('path');

const app = express();
const PORT = 3847;
const API_BASE = 'https://api-lts.transportforireland.ie/lts/lts/v1/public';
const API_KEY = '630688984d38409689932a37a8641bb9';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// === Generic TFI API proxy helper ===
function proxyGet(endpoint, req, res) {
  const qs = new URLSearchParams(req.query).toString();
  const url = `${API_BASE}/${endpoint}${qs ? '?' + qs : ''}`;
  const proxyReq = https.request(url, {
    method: 'GET',
    headers: { 'Ocp-Apim-Subscription-Key': API_KEY, 'Accept': 'application/json' },
  }, (proxyRes) => {
    res.status(proxyRes.statusCode);
    for (const [k, v] of Object.entries(proxyRes.headers)) {
      if (k.toLowerCase() !== 'transfer-encoding') res.setHeader(k, v);
    }
    let body = '';
    proxyRes.on('data', d => body += d);
    proxyRes.on('end', () => res.send(body));
  });
  proxyReq.on('error', (e) => {
    console.error(`Proxy GET /${endpoint} error:`, e.message);
    res.status(502).json({ error: 'Upstream request failed' });
  });
  proxyReq.end();
}

function proxyPost(endpoint, req, res) {
  const url = `${API_BASE}/${endpoint}`;
  const payload = JSON.stringify(req.body);
  const proxyReq = https.request(url, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
  }, (proxyRes) => {
    res.status(proxyRes.statusCode);
    for (const [k, v] of Object.entries(proxyRes.headers)) {
      if (k.toLowerCase() !== 'transfer-encoding') res.setHeader(k, v);
    }
    let body = '';
    proxyRes.on('data', d => body += d);
    proxyRes.on('end', () => res.send(body));
  });
  proxyReq.on('error', (e) => {
    console.error(`Proxy POST /${endpoint} error:`, e.message);
    res.status(502).json({ error: 'Upstream request failed' });
  });
  proxyReq.write(payload);
  proxyReq.end();
}

// === GET endpoints ===
app.get('/api/locationLookup', (req, res) => proxyGet('locationLookup', req, res));
app.get('/api/operatorList', (req, res) => proxyGet('operatorList', req, res));
app.get('/api/status', (req, res) => proxyGet('status', req, res));
app.get('/api/lookup', (req, res) => proxyGet('lookup', req, res));

// === POST endpoints ===
app.post('/api/departures', (req, res) => proxyPost('departures', req, res));
app.post('/api/estimatedTimetable', (req, res) => proxyPost('estimatedTimetable', req, res));
app.post('/api/timetable', (req, res) => proxyPost('timetable', req, res));
app.post('/api/vehicleLocation', (req, res) => proxyPost('vehicleLocation', req, res));
app.post('/api/visibleLookupRequest', (req, res) => proxyPost('visibleLookupRequest', req, res));
app.post('/api/serviceLookup', (req, res) => proxyPost('serviceLookup', req, res));
app.post('/api/situations/services', (req, res) => proxyPost('situations/services', req, res));
app.post('/api/situations/stops', (req, res) => proxyPost('situations/stops', req, res));
app.post('/api/stopsAssets', (req, res) => proxyPost('stopsAssets', req, res));
app.post('/api/servicesAssets', (req, res) => proxyPost('servicesAssets', req, res));

// === Native stops endpoint using TFI visibleLookupRequest (replaces Overpass) ===
const stopsCache = new Map();
const CACHE_TTL = 2 * 60 * 1000; // 2 min (TFI API is fast, shorter TTL = fresher data)

function roundCoord(v, precision) {
  const p = precision || 0.005;
  return (Math.round(parseFloat(v) / p) * p).toFixed(4);
}

app.get('/api/stops', (req, res) => {
  const { south, west, north, east } = req.query;
  if (!south || !west || !north || !east) {
    return res.status(400).json({ error: 'Missing bbox params: south, west, north, east' });
  }

  const s = roundCoord(south), w = roundCoord(west), n = roundCoord(north), e2 = roundCoord(east);
  const cacheKey = `${s},${w},${n},${e2}`;

  const cached = stopsCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return res.json(cached.data);
  }

  // Use native TFI API instead of Overpass
  const centerLat = (parseFloat(s) + parseFloat(n)) / 2;
  const centerLon = (parseFloat(w) + parseFloat(e2)) / 2;

  const payload = JSON.stringify({
    center: { latitude: centerLat, longitude: centerLon },
    upperRight: { latitude: parseFloat(n), longitude: parseFloat(e2) },
    lowerLeft: { latitude: parseFloat(s), longitude: parseFloat(w) },
    visibleLookupOrigin: 'LIVE_DEPARTURE',
    filteringTypes: ['BUS_STOP', 'TRAM_STOP_AREA', 'TRAIN_STATION'],
    language: 'en',
  });

  const url = `${API_BASE}/visibleLookupRequest`;
  console.log(`[stops] Fetching TFI visibleLookup for bbox ${cacheKey}`);

  const proxyReq = https.request(url, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
  }, (proxyRes) => {
    let body = '';
    proxyRes.on('data', d => body += d);
    proxyRes.on('end', () => {
      try {
        const data = JSON.parse(body);
        const locations = Array.isArray(data) ? data : [];
        const stops = locations.map(loc => ({
          id: loc.id || null,
          name: loc.name || 'Unknown stop',
          type: loc.type || 'BUS_STOP',
          lat: loc.coordinate?.latitude || null,
          lon: loc.coordinate?.longitude || null,
          ref: loc.shortCode || loc.id || null,
        })).filter(s => s.lat && s.lon);

        stopsCache.set(cacheKey, { data: stops, timestamp: Date.now() });
        console.log(`[stops] Cached ${stops.length} stops for ${cacheKey} (TFI native)`);
        res.json(stops);
      } catch (err) {
        console.error('[stops] Parse error:', err.message);
        res.status(502).json({ error: 'Failed to parse TFI response' });
      }
    });
  });

  proxyReq.on('error', (err) => {
    console.error('[stops] TFI visibleLookup error:', err.message);
    res.status(502).json({ error: 'TFI request failed' });
  });

  proxyReq.write(payload);
  proxyReq.end();
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`TFI Go server running on http://127.0.0.1:${PORT}`);
});
