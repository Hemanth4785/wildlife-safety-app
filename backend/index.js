import express from 'express';
import cors from 'cors';
import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

dotenv.config();

const app = express();
console.log("Server file loaded");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PYTHON_SCRIPT = path.join(__dirname, 'python', 'fetch_inat_recent.py');
const WILDLIFE_CACHE_PATH = path.join(__dirname, 'python', 'cache', 'inat_live.json');

// --- Constants ---
const SPECIES_CONFIG = {
    "Asian Elephant": { radiusKm: 3.0, taxon_id: 42910 },
    "Tiger": { radiusKm: 2.0, taxon_id: 47367 },
    "Leopard": { radiusKm: 1.5, taxon_id: 47369 },
    "Gaur": { radiusKm: 1.5, taxon_id: 42915 },
    "Sloth Bear": { radiusKm: 1.0, taxon_id: 42525 }
};

// --- Helpers ---

const toRadians = (degrees) => (degrees * Math.PI) / 180;
const toDegrees = (radians) => (radians * 180) / Math.PI;

const haversineDistanceKm = (lat1, lon1, lat2, lon2) => {
  const R = 6371;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
    Math.cos(toRadians(lat2)) *
    Math.sin(dLon / 2) *
    Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// Point (px, py) to Segment (x1, y1)-(x2, y2) distance
// Coordinates in Lat/Lon are roughly Euclidean for small distances, 
// but Haversine is better. For speed, we'll use Euclidean projection for "nearest point" logic 
// and then Haversine for the actual distance to that point.
const pointToSegmentDistanceKm = (plat, plon, lat1, lon1, lat2, lon2) => {
    // Convert to simple x/y for projection (valid for small segments)
    const x = plon;
    const y = plat;
    const x1 = lon1;
    const y1 = lat1;
    const x2 = lon2;
    const y2 = lat2;

    const A = x - x1;
    const B = y - y1;
    const C = x2 - x1;
    const D = y2 - y1;

    const dot = A * C + B * D;
    const len_sq = C * C + D * D;
    let param = -1;
    if (len_sq !== 0) // in case of 0 length line
        param = dot / len_sq;

    let xx, yy;

    if (param < 0) {
        xx = x1;
        yy = y1;
    } else if (param > 1) {
        xx = x2;
        yy = y2;
    } else {
        xx = x1 + param * C;
        yy = y1 + param * D;
    }

    return haversineDistanceKm(plat, plon, yy, xx);
};

const minDistanceToRoute = (lat, lon, routePath) => {
    let minDist = Infinity;
    // Sample every 5th point to speed up if route is huge
    // But for accuracy near animals, we might need finer grain. 
    // OSRM geometry usually has points close enough.
    // Optimization: Bounding box check? 
    // Let's iterate all segments.
    for (let i = 0; i < routePath.length - 1; i++) {
        const [p1Lat, p1Lon] = routePath[i];
        const [p2Lat, p2Lon] = routePath[i+1];
        
        // Quick bounding box check for segment
        if (Math.abs(lat - p1Lat) > 0.1 && Math.abs(lat - p2Lat) > 0.1) continue; 
        if (Math.abs(lon - p1Lon) > 0.1 && Math.abs(lon - p2Lon) > 0.1) continue;

        const d = pointToSegmentDistanceKm(lat, lon, p1Lat, p1Lon, p2Lat, p2Lon);
        if (d < minDist) minDist = d;
    }
    return minDist;
};

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.url} ${res.statusCode} - ${duration}ms`);
  });
  next();
});

app.use(
  cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
  })
);
app.use(express.json({ limit: '10mb' })); // Increase limit for large route geometries

// --- Wildlife data: run Python script, fall back to cached JSON ---
const getWildlifeData = () => {
    try {
        const raw = fs.readFileSync(WILDLIFE_CACHE_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        console.error("Error reading wildlife cache:", err.message);
        return [];
    }
};

const runInatPython = () => {
    const py = process.platform === 'win32' ? 'python' : 'python3';
    const r = spawnSync(py, [PYTHON_SCRIPT], {
        cwd: path.dirname(PYTHON_SCRIPT),
        encoding: 'utf8',
        timeout: 60000,
    });
    if (r.error) {
        console.error("iNaturalist Python spawn error:", r.error.message);
        return false;
    }
    if (r.status !== 0) {
        console.error("iNaturalist Python stderr:", r.stderr || r.error);
        return false;
    }
    return true;
};

app.get(['/api/wildlife/recent', '/api/inat/recent', '/api/gbif/recent'], (req, res) => {
    if (runInatPython()) {
        const fresh = getWildlifeData();
        return res.json(fresh);
    }
    const cached = getWildlifeData();
    res.json(cached);
});

// --- New: sightings API for useAnimalData hook ---
app.get('/api/sightings', (req, res) => {
    const { scientificName, lat, lon, radius } = req.query;
    const wildlife = getWildlifeData();
    
    const filtered = wildlife.filter(animal => {
        if (scientificName && animal.scientific_name !== scientificName) return false;
        
        if (lat && lon && radius) {
            const dist = haversineDistanceKm(
                parseFloat(lat), parseFloat(lon),
                parseFloat(animal.lat), parseFloat(animal.lon)
            );
            return dist <= parseFloat(radius);
        }
        return true;
    });
    
    res.json(filtered);
});

// --- NEW: Safe Route OSRM Proxy ---
app.get('/api/route/osrm', async (req, res) => {
    const { startLat, startLon, endLat, endLon } = req.query;

    if (!startLat || !startLon || !endLat || !endLon) {
        return res.status(400).json({ error: 'Missing coordinates' });
    }

    const OSRM_BASE_URL = process.env.OSRM_BASE_URL || 'http://router.project-osrm.org';
    // Use 'driving' profile by default
    const url = `${OSRM_BASE_URL}/route/v1/driving/${startLon},${startLat};${endLon},${endLat}?overview=full&geometries=geojson`;

    try {
        console.log(`Fetching OSRM route: ${url}`);
        const response = await axios.get(url, { timeout: 10000 });
        if (!response.data.routes || response.data.routes.length === 0) {
            return res.status(404).json({ error: 'No route found' });
        }
        
        const route = response.data.routes[0];
        res.json({
            geometry: route.geometry, // GeoJSON { type: 'LineString', coordinates: [[lon, lat], ...] }
            distance: route.distance, // meters
            duration: route.duration  // seconds
        });
    } catch (error) {
        console.error("OSRM Error:", error.message);
        res.status(502).json({ error: 'Routing service unavailable' });
    }
});

// --- NEW: Risk Analysis ---
app.post('/api/animals/near-route', (req, res) => {
    const { routeGeometry } = req.body; // Expects GeoJSON coordinates array: [[lon, lat], ...] or { type: 'LineString', coordinates: [...] }

    if (!routeGeometry) {
        return res.status(400).json({ error: 'Missing routeGeometry' });
    }

    let pathPoints = [];
    if (Array.isArray(routeGeometry)) {
        pathPoints = routeGeometry; // Assuming [[lon, lat], ...]
    } else if (routeGeometry.coordinates) {
        pathPoints = routeGeometry.coordinates;
    } else {
        return res.status(400).json({ error: 'Invalid geometry format' });
    }

    // Convert [lon, lat] to [lat, lon] for our helper
    const routePath = pathPoints.map(p => [p[1], p[0]]);

    const wildlife = getWildlifeData();
    const riskZones = [];

    // Filter logic
    wildlife.forEach(animal => {
        // Safe parsing
        const lat = parseFloat(animal.lat);
        const lon = parseFloat(animal.lon);
        
        if (isNaN(lat) || isNaN(lon)) return;

        const distKm = minDistanceToRoute(lat, lon, routePath);
        
        if (distKm <= 2.0) {
            riskZones.push({ ...animal, riskLevel: 'HIGH', distanceToRoute: distKm });
        } else if (distKm <= 5.0) {
            riskZones.push({ ...animal, riskLevel: 'CAUTION', distanceToRoute: distKm });
        }
    });

    res.json({
        riskZones,
        riskySegments: [],
        count: riskZones.length
    });
});

// --- Nominatim search proxy (frontend must never call Nominatim directly) ---
const searchCache = new Map();
app.get('/api/search-locations', async (req, res) => {
    const q = req.query.q;
    if (!q || typeof q !== 'string') return res.status(400).json({ error: 'Missing q' });
    const key = q.trim().toLowerCase();
    if (searchCache.has(key)) {
        return res.json(searchCache.get(key));
    }
    try {
        const r = await axios.get('https://nominatim.openstreetmap.org/search', {
            params: { q, format: 'json', limit: 10 },
            headers: { 
                'User-Agent': 'WildlifeSafetyApp/1.0 (edu-project)',
                'Referer': 'http://localhost'
            },
            timeout: 10000,
        });
        const arr = Array.isArray(r.data) ? r.data : [];
        const out = arr.map((x) => ({
            lat: x.lat,
            lon: x.lon,
            display_name: x.display_name || '',
        }));
        searchCache.set(key, out);
        res.json(out);
    } catch (e) {
        if (e.response) {
            console.error('Search upstream error:', e.response.status, e.response.data);
        } else {
            console.error('Search network error:', e.message);
        }
        res.status(502).json({ error: 'Geocoding search failed' });
    }
});

// --- Reverse Geocode with Caching ---
const geocodeCache = new Map();
app.get('/api/reverse-geocode', async (req, res) => {
  const { lat, lon } = req.query;
  if (!lat || !lon) return res.status(400).json({ error: 'Missing lat/lon' });

  // Round to 4 decimals (~11m precision) to improve cache hit rate
  const latKey = parseFloat(lat).toFixed(4);
  const lonKey = parseFloat(lon).toFixed(4);
  const key = `${latKey},${lonKey}`;

  if (geocodeCache.has(key)) {
      console.log('Geocode Cache Hit');
      return res.json(geocodeCache.get(key));
  }

  try {
    const response = await axios.get('https://nominatim.openstreetmap.org/reverse', {
      params: { lat, lon, format: 'json' },
      headers: { 
        'User-Agent': 'WildlifeSafetyApp/1.0 (edu-project)',
        'Referer': 'http://localhost' 
      },
      timeout: 10000
    });
    
    // Cache it
    geocodeCache.set(key, response.data);
    res.json(response.data);
  } catch (error) {
    if (error.response) {
        console.error('Geocode upstream error:', error.response.status, error.response.data);
    } else {
        console.error('Geocode network error:', error.message);
    }
    res.status(502).json({ error: 'Geocoding failed', details: error.message });
  }
});

// --- Overpass Proxy for Safe Places ---
app.get('/api/overpass', async (req, res) => {
    const { data } = req.query;
    if (!data) return res.status(400).json({ error: 'Missing data query' });

    const fetchOverpass = async (url) => {
        return axios.get(url, {
            params: { data },
            timeout: 60000 // Increased timeout to 60s
        });
    };

    try {
        // Try main server
        try {
            const response = await fetchOverpass('https://overpass-api.de/api/interpreter');
            return res.json(response.data);
        } catch (err) {
            console.warn('Primary Overpass failed, trying mirror...', err.message);
            // Try mirror
            const response = await fetchOverpass('https://lz4.overpass-api.de/api/interpreter');
            return res.json(response.data);
        }
    } catch (error) {
        console.error('All Overpass mirrors failed:', error.message);
        const status = error.response ? error.response.status : 502;
        res.status(status).json({ 
            error: 'Overpass API failed', 
            details: error.message,
            code: status 
        });
    }
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    backend: 'running',
    timestamp: new Date().toISOString()
  });
});

// --- Weather Proxy (OpenWeatherMap) ---
const weatherCache = new Map();
app.get('/api/weather', async (req, res) => {
    const { lat, lon } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: 'Missing lat/lon' });

    // Round to 2 decimals (~1km) for caching
    const key = `${parseFloat(lat).toFixed(2)},${parseFloat(lon).toFixed(2)}`;
    if (weatherCache.has(key)) {
        const cached = weatherCache.get(key);
        if (Date.now() - cached.timestamp < 10 * 60 * 1000) { // 10 min cache
            return res.json(cached.data);
        }
    }

    try {
        const apiKey = '0f965eb13fcac3cab46a6d13af345eac';
        const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&appid=${apiKey}`;
        const response = await axios.get(url, { timeout: 10000 });
        const d = response.data;

        // Map OWM to Open-Meteo format
        const owmId = d.weather[0].id;
        let wmoCode = 0;
        if (owmId === 800) wmoCode = 0;
        else if (owmId >= 801 && owmId <= 802) wmoCode = 2;
        else if (owmId >= 803 && owmId <= 804) wmoCode = 3;
        else if (owmId >= 200 && owmId < 600) wmoCode = 61; // Rain/Drizzle/Thunder
        else if (owmId >= 600 && owmId < 700) wmoCode = 71; // Snow
        else if (owmId >= 700 && owmId < 800) wmoCode = 45; // Fog/Atmosphere

        const isDay = (d.dt > d.sys.sunrise && d.dt < d.sys.sunset) ? 1 : 0;

        const mappedData = {
            current_weather: {
                temperature: d.main.temp,
                weathercode: wmoCode,
                windspeed: Math.round(d.wind.speed * 3.6), // Convert m/s to km/h
                is_day: isDay
            }
        };

        weatherCache.set(key, { timestamp: Date.now(), data: mappedData });
        res.json(mappedData);
    } catch (error) {
        console.error('Weather API error:', error.message);
        res.status(502).json({ error: 'Weather service unavailable' });
    }
});

const port = process.env.PORT || 3000;
const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Backend running on http://0.0.0.0:${port}`);
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use!`);
    console.error(`Please run 'taskkill /F /IM node.exe' to kill stale processes.`);
    process.exit(1);
  } else {
    console.error('Server error:', e);
  }
});
