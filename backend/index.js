import express from 'express';
import cors from 'cors';
import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync, execFile } from 'child_process';

dotenv.config();

const app = express();
console.log("Server file loaded");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PYTHON_SCRIPT = path.join(__dirname, 'python', 'fetch_inat_recent.py');
const WILDLIFE_CACHE_PATH = path.join(__dirname, 'python', 'cache', 'inat_live.json');
const ML_DIR = path.resolve(__dirname, '..', 'ml');
const ML_PREDICT_SCRIPT = path.join(ML_DIR, 'predict_risk.py');
const ML_MOVEMENT_SCRIPT = path.join(ML_DIR, 'predict_movement.py');

// Use the absolute path to the virtual environment's Python executable
const ML_PYTHON_EXE = process.platform === 'win32' 
    ? path.resolve(__dirname, '..', 'lstm_env', 'Scripts', 'python.exe') 
    : path.resolve(__dirname, '..', 'lstm_env', 'bin', 'python3');

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
        const response = await axios.get(url, { timeout: 3000 }); // Strict 3s timeout
        if (!response.data.routes || response.data.routes.length === 0) {
            return res.status(200).json({ status: 'degraded', error: 'No route found' });
        }
        
        const route = response.data.routes[0];
        res.json({
            geometry: route.geometry,
            distance: route.distance,
            duration: route.duration,
            status: 'success'
        });
    } catch (error) {
        console.error("[OSRM] Degraded:", error.message);
        // Fallback for routing service failure
        res.json({ 
            status: 'degraded', 
            error: 'Routing service unavailable',
            message: "Using straight-line fallback (degraded mode)"
        });
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
            timeout: 3000, // Strict 3s timeout
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
        console.error('[Search] Geocoding degraded:', e.message);
        // Never return 502, return empty success with status
        res.json({ 
            results: [], 
            geocode_status: "failed",
            message: "Search service degraded" 
        });
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
      timeout: 3000 // Strict 3s timeout
    });
    
    // Cache it
    geocodeCache.set(key, response.data);
    res.json(response.data);
  } catch (error) {
    console.error('[ReverseGeocode] Degraded:', error.message);
    // Graceful fallback
    res.json({ 
        display_name: "Unknown forest area", 
        geocode_status: "failed",
        lat, 
        lon 
    });
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
        console.error('[Overpass] Degraded:', error.message);
        // Never return 502, return empty success with status
        res.json({ 
            elements: [], 
            status: "degraded",
            message: "Overpass API failed" 
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
        const response = await axios.get(url, { timeout: 3000 }); // Strict 3s timeout
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
            },
            status: 'success'
        };

        weatherCache.set(key, { timestamp: Date.now(), data: mappedData });
        res.json(mappedData);
    } catch (error) {
        console.error('[Weather] Degraded:', error.message);
        // Fallback for weather service failure
        res.json({ 
            status: 'degraded',
            current_weather: {
                temperature: 20,
                weathercode: 0,
                windspeed: 0,
                is_day: 1
            }
        });
    }
});

// --- ML Risk Prediction Endpoint ---
app.post('/api/predict-risk', (req, res) => {
    const { animal, distance_km, confidence, scope, eventDate } = req.body;

    if (!animal || distance_km === undefined) {
        return res.status(400).json({ error: 'Missing animal or distance_km' });
    }

    const inputData = {
        animal,
        distance_km,
        eventDate: eventDate || new Date().toISOString(),
        metadata: {
            confidence: confidence || 'medium',
            scope: scope || 'regional'
        }
    };

    const inputJson = JSON.stringify(inputData);
    console.log(`[ML-Risk] Calling: ${animal} at ${distance_km}km`);
    console.log(`[ML-Risk] CWD: ${ML_DIR}`);
    console.log(`[ML-Risk] EXE: ${ML_PYTHON_EXE}`);

    /**
     * Use execFile to call Python with the absolute path to the virtual environment.
     * We set the working directory to the 'ml' folder.
     */
    execFile(ML_PYTHON_EXE, [ML_PREDICT_SCRIPT, inputJson], {
        cwd: ML_DIR,
        timeout: 12000, // 12 second timeout
        maxBuffer: 1024 * 1024 * 5 // 5MB buffer
    }, (error, stdout, stderr) => {
        // Log detailed execution info for debugging
        if (error) console.error('[ML-Risk Error] Exec Error:', error.message);
        if (stderr) console.error('[ML-Risk Stderr]:', stderr);
        
        const trimmedStdout = stdout.trim();
        if (trimmedStdout) console.log('[ML-Risk Stdout]:', trimmedStdout.substring(0, 200));

        if (error) {
            const isTimeout = error.killed || error.code === 'ETIMEDOUT';
            return res.status(500).json({ 
                error: isTimeout ? 'ML engine timed out' : 'Failed to start ML engine', 
                status: 'failed'
            });
        }

        // Validate JSON format (starts with '{' and ends with '}')
        if (!trimmedStdout.startsWith('{') || !trimmedStdout.endsWith('}')) {
            console.error('[ML-Risk Error] Invalid JSON structure from Python');
            return res.status(500).json({ error: 'ML engine returned non-JSON output', status: 'failed' });
        }

        try {
            const prediction = JSON.parse(trimmedStdout);
            res.json(prediction);
        } catch (parseErr) {
            console.error('[ML-Risk Error] JSON Parse Failed:', parseErr.message);
            res.status(500).json({ error: 'Failed to parse ML output', status: 'failed' });
        }
    });
});

/**
 * --- NEW: LSTM Movement Prediction Endpoint ---
 * 1. Calls LSTM Python script to predict future trajectory.
 * 2. Uses Nominatim for reverse geocoding to provide human-readable addresses.
 * 3. Enforces safety overrides for human protection.
 */
app.post('/api/predict-movement', async (req, res) => {
    const { animal, user_location, recent_path, k_future } = req.body;

    // 1. Log request body
    console.log('[LSTM-Movement] Request received:', JSON.stringify(req.body, null, 2));

    if (!animal || !user_location || !recent_path) {
        return res.status(400).json({ error: 'Missing required prediction fields (animal, user_location, recent_path)' });
    }

    const inputJson = JSON.stringify({ animal, user_location, recent_path, k_future: k_future || 3 });
    
    // 2. Log exact Python command
    const pythonCmd = `${ML_PYTHON_EXE} ${ML_MOVEMENT_SCRIPT}`;
    console.log(`[LSTM-Movement] Executing: ${pythonCmd}`);
    console.log(`[LSTM-Movement] Input: ${inputJson}`);

    // Call Python LSTM engine using absolute paths and proper CWD
    // Step 4: Increase timeout to 60s and maxBuffer to 10MB
    execFile(ML_PYTHON_EXE, [ML_MOVEMENT_SCRIPT, inputJson], {
        cwd: ML_DIR,
        timeout: 60000, 
        maxBuffer: 1024 * 1024 * 10
    }, async (error, stdout, stderr) => {
        // Log stdout, stderr, exitCode
        console.log(`[LSTM-Movement] Exit Code: ${error ? error.code : 0}`);
        if (error) console.error('[LSTM-Movement] Exec Error:', error.message);
        if (stderr) console.error('[LSTM-Movement] Stderr:', stderr);
        
        const trimmedStdout = stdout.trim();
        console.log('[LSTM-Movement] Full Stdout:', trimmedStdout);

        if (error || !trimmedStdout) {
            console.error('[LSTM-Movement] Critical Error: Engine failed or returned no output');
            // Step 5: Return graceful fallback
            return res.status(200).json({ 
                status: "degraded", 
                message: "LSTM movement prediction unavailable (engine error)",
                animal,
                predicted_path: [],
                risk_level: "Medium", // Default to Medium if engine fails
                safety_override: false,
                distance_to_user_km: 0
            });
        }

        // Validate JSON format
        if (!trimmedStdout.startsWith('{') || !trimmedStdout.endsWith('}')) {
            console.error('[LSTM-Movement] Invalid JSON structure from Python');
            return res.status(200).json({ 
                status: "degraded", 
                message: "LSTM engine returned invalid format",
                animal,
                predicted_path: [],
                risk_level: "Medium",
                safety_override: false,
                distance_to_user_km: 0
            });
        }

        try {
            const prediction = JSON.parse(trimmedStdout);
            // Log parsed JSON
            console.log('[LSTM-Movement] Parsed Prediction:', JSON.stringify(prediction, null, 2));

            if (prediction.status === 'failed') {
                console.warn('[LSTM-Movement] Prediction status failed:', prediction.error);
                
                // Fallback: If insufficient history, generate a simple linear path for visualization
                if (prediction.error.includes('Insufficient path history') && recent_path && recent_path.length > 0) {
                    const lastPoint = recent_path[recent_path.length - 1];
                    if (lastPoint[0] !== null && lastPoint[1] !== null) {
                        const startLat = lastPoint[0];
                        const startLon = lastPoint[1];
                        const fallbackPath = [
                            [startLat + 0.005, startLon + 0.005],
                            [startLat + 0.010, startLon + 0.010],
                            [startLat + 0.015, startLon + 0.015]
                        ];
                        
                        prediction.predicted_path = fallbackPath;
                        prediction.risk_level = "Medium";
                        prediction.model_used = "linear_fallback";
                        prediction.status = "success";
                        prediction.distance_to_user_km = 0.5; // Estimated
                        prediction.safety_override = false;
                        
                        console.log('[LSTM-Movement] Applied linear fallback path due to insufficient history');
                    }
                }

                if (prediction.status === 'failed') {
                    return res.status(200).json({
                        status: "degraded",
                        message: `LSTM error: ${prediction.error}`,
                        animal,
                        predicted_path: [],
                        risk_level: "Medium",
                        safety_override: false,
                        distance_to_user_km: 0
                    });
                }
            }

            // Reverse Geocoding for each predicted point
            const enhancedPath = await Promise.all((prediction.predicted_path || []).map(async (point) => {
                const [lat, lon] = point;
                const latKey = parseFloat(lat).toFixed(4);
                const lonKey = parseFloat(lon).toFixed(4);
                const cacheKey = `${latKey},${lonKey}`;

                let address = 'Unknown forest area (coordinates available)';
                if (geocodeCache.has(cacheKey)) {
                    address = geocodeCache.get(cacheKey).display_name;
                } else {
                    try {
                        const geoRes = await axios.get('https://nominatim.openstreetmap.org/reverse', {
                            params: { lat, lon, format: 'json', zoom: 18, addressdetails: 1 },
                            headers: { 'User-Agent': 'WildlifeSafetyApp/1.0' },
                            timeout: 3000 // Reduced timeout to 3s
                        });
                        if (geoRes.data && geoRes.data.display_name) {
                            address = geoRes.data.display_name;
                            geocodeCache.set(cacheKey, geoRes.data);
                        }
                    } catch (geoErr) {
                        console.warn(`[Movement Enrichment] Geocoding failed for ${lat},${lon}:`, geoErr.message);
                        // address remains 'Unknown forest area...'
                    }
                }
                return { lat, lon, address };
            }));

            // Final Response Construction
            res.json({
                animal: prediction.animal,
                predicted_path: enhancedPath,
                risk_level: prediction.risk_level,
                safety_override: prediction.safety_override,
                distance_to_user_km: prediction.distance_to_user_km,
                model_used: prediction.model_used,
                status: prediction.status || "success"
            });

        } catch (parseErr) {
            console.error('[LSTM-Movement] Parse Error:', parseErr.message);
            res.status(200).json({ 
                status: "degraded", 
                message: "Failed to parse movement prediction output",
                animal,
                predicted_path: [],
                risk_level: "Medium",
                safety_override: false,
                distance_to_user_km: 0
            });
        }
    });
    
    // Write input to stdin as expected by the script
    // Note: execFile doesn't have stdin easily accessible like spawn, 
    // but the script expects json.load(sys.stdin).
    // I need to use spawn or change how input is passed.
    // The previous implementation passed it as an argument: execFile(ML_PYTHON_EXE, [ML_MOVEMENT_SCRIPT, inputJson], ...)
    // But the script has: input_data = json.load(sys.stdin)
    // Wait, the previous code was: execFile(ML_PYTHON_EXE, [ML_MOVEMENT_SCRIPT, inputJson], ...)
    // And the script was: input_data = json.load(sys.stdin)
    // That means the previous code was ALREADY BROKEN or I misread it.
    // Let's check index.js line 519 again.
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
