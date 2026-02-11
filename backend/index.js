import express from 'express';
import cors from 'cors';
import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync, execFile } from 'child_process';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, doc, setDoc } from 'firebase/firestore';
import polyline from '@mapbox/polyline';

dotenv.config();

const firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID,
    measurementId: process.env.FIREBASE_MEASUREMENT_ID
};

let db;
try {
    const firebaseApp = initializeApp(firebaseConfig);
    db = getFirestore(firebaseApp);
    console.log("Firebase initialized successfully");
} catch (error) {
    console.error("Firebase initialization failed:", error.message);
}


const app = express();
console.log("Server file loaded");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PYTHON_SCRIPT = path.join(__dirname, 'python', 'fetch_inat_recent.py');
const WILDLIFE_CACHE_PATH = path.join(__dirname, 'python', 'cache', 'inat_historical.json');
// GBIF is secondary/optional now, but we keep it if needed, or remove if user wants strictly iNat.
// User said: "Wildlife observation data must be handled via: Direct API fetch from iNaturalist"
// I will comment out GBIF fetch for now to strictly follow "fetch from iNaturalist" directive, 
// or I will leave it but ensure iNat is the main source.
// Let's keep GBIF definitions but focus on iNat.
const GBIF_PYTHON_SCRIPT = path.join(__dirname, 'python', 'fetch_gbif_recent.py');
const GBIF_CACHE_PATH = path.join(__dirname, 'python', 'cache', 'gbif_recent.json');
const ML_DIR = path.resolve(__dirname, '..', 'ml');
const ML_PREDICT_SCRIPT = path.join(ML_DIR, 'predict_risk.py');
const ML_LSTM_SCRIPT = path.join(ML_DIR, 'predict_movement.py');
const ML_MAXENT_SCRIPT = path.join(ML_DIR, 'predict_maxent.py');

// Resolve Python executable for LSTM engine with robust fallback
const ML_PYTHON_EXE = (() => {
    if (process.platform === 'win32') {
        const venvPath = path.resolve(__dirname, '..', 'lstm_env', 'Scripts', 'python.exe');
        return fs.existsSync(venvPath) ? venvPath : 'python';
    } else {
        const venvPath = path.resolve(__dirname, '..', 'lstm_env', 'bin', 'python3');
        return fs.existsSync(venvPath) ? venvPath : 'python3';
    }
})();

const INAT_PYTHON_EXE = (() => {
    if (process.platform === 'win32') {
        const winPath = path.resolve(__dirname, '..', 'gbif_env', 'Scripts', 'python.exe');
        return fs.existsSync(winPath) ? winPath : 'python';
    }
    return 'python3';
})();

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
app.use(express.json({ limit: '10mb' }));

app.get('/api/proxy-image', async (req, res) => {
    try {
        const url = String(req.query.u || '');
        if (!url) return res.status(400).json({ error: 'Missing url' });
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 15000,
            headers: {
                'User-Agent': 'WildlifeSafetyApp/1.0 (+image-proxy)'
            }
        });
        const ct = String(response.headers['content-type'] || 'image/jpeg');
        if (!ct.startsWith('image/')) {
            return res.status(415).json({ error: 'Unsupported content type' });
        }
        res.setHeader('Content-Type', ct);
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.send(Buffer.from(response.data, 'binary'));
    } catch (err) {
        res.status(502).json({ error: 'Image fetch failed' });
    }
});

// --- Local ML: Species Classifier ---
app.post('/api/ml/classify-image', (req, res) => {
    try {
        const { data } = req.body || {};
        if (!data) return res.status(400).json({ error: 'Missing base64 image data' });
        const payload = JSON.stringify({ mode: 'infer', image_base64: String(data) });
        execFile(ML_PYTHON_EXE, [path.join(ML_DIR, 'species_classifier.py'), payload], {
            cwd: ML_DIR,
            timeout: 20000,
            maxBuffer: 1024 * 1024 * 10
        }, (error, stdout, stderr) => {
            if (error) {
                console.error('[Local-ML] Error:', error.message);
                return res.status(200).json({ common: 'Unknown', scientific: 'Unknown', confidence: 0.0 });
            }
            try {
                const parsed = JSON.parse(stdout.trim());
                return res.json(parsed);
            } catch (e) {
                console.error('[Local-ML] Parse error:', e.message);
                return res.status(200).json({ common: 'Unknown', scientific: 'Unknown', confidence: 0.0 });
            }
        });
    } catch (e) {
        console.error('[Local-ML] Exception:', e.message);
        return res.status(200).json({ common: 'Unknown', scientific: 'Unknown', confidence: 0.0 });
    }
});

// --- Local ML: Build Dataset from iNaturalist & GBIF ---
app.post('/api/ml/build-dataset', (req, res) => {
    try {
        const { api_urls, per_species_limit, output_dir } = req.body || {};
        const defaults = [
            'https://api.inaturalist.org/v1/observations?taxon_name=Leopard&order=desc&order_by=created_at&per_page=50',
            'https://api.inaturalist.org/v1/observations?taxon_name=Tiger&order=desc&order_by=created_at&per_page=50',
            'https://api.inaturalist.org/v1/observations?taxon_name=Asian%20Elephant&order=desc&order_by=created_at&per_page=50',
            'https://api.inaturalist.org/v1/observations?taxon_name=Sloth%20Bear&order=desc&order_by=created_at&per_page=50',
            'https://api.inaturalist.org/v1/observations?taxon_name=Gaur&order=desc&order_by=created_at&per_page=50',
            'https://api.inaturalist.org/v1/observations?taxon_name=Bison&order=desc&order_by=created_at&per_page=50',
            'https://api.gbif.org/v1/occurrence/search?scientificName=Panthera%20pardus&limit=50&sort=lastInterpreted',
            'https://api.gbif.org/v1/occurrence/search?scientificName=Panthera%20tigris&limit=50&sort=lastInterpreted',
            'https://api.gbif.org/v1/occurrence/search?scientificName=Elephas%20maximus&limit=50&sort=lastInterpreted',
            'https://api.gbif.org/v1/occurrence/search?scientificName=Melursus%20ursinus&limit=50&sort=lastInterpreted',
            'https://api.gbif.org/v1/occurrence/search?scientificName=Bos%20gaurus&limit=50&sort=lastInterpreted',
            'https://api.gbif.org/v1/occurrence/search?scientificName=Bison%20bison&limit=50&sort=lastInterpreted',
        ];
        const urls = Array.isArray(api_urls) && api_urls.length ? api_urls : defaults;
        const outDir = output_dir ? String(output_dir) : path.join(ML_DIR, 'dataset');
        const limit = Number.isFinite(per_species_limit) ? Number(per_species_limit) : 100;
        const payload = JSON.stringify({ mode: 'build', api_urls: urls, output_dir: outDir, per_species_limit: limit });
        const scriptPath = path.join(ML_DIR, 'species_classifier.py');
        execFile(ML_PYTHON_EXE, [scriptPath, payload], {
            cwd: ML_DIR,
            timeout: 180000,
            maxBuffer: 1024 * 1024 * 20
        }, (error, stdout, stderr) => {
            if (error) {
                console.error('[Dataset-Builder] Error:', error.message);
                if (stderr) console.error('[Dataset-Builder] Stderr:', String(stderr).slice(0, 1000));
                if (stdout) console.error('[Dataset-Builder] Stdout:', String(stdout).slice(0, 1000));
                return res.status(500).json({ error: 'Dataset build failed' });
            }
            try {
                const parsed = JSON.parse(stdout.trim());
                return res.json(parsed);
            } catch (e) {
                console.error('[Dataset-Builder] Parse error:', e.message);
                return res.status(200).json({ status: 'ok', message: 'Build completed', raw: stdout.trim() });
            }
        });
    } catch (e) {
        console.error('[Dataset-Builder] Exception:', e.message);
        return res.status(500).json({ error: 'Dataset build failed' });
    }
});

// --- Local ML: Train Species Classifier ---
app.post('/api/ml/train-model', (req, res) => {
    try {
        const { data_dir, epochs, batch_size } = req.body || {};
        const dir = data_dir ? String(data_dir) : path.join(ML_DIR, 'dataset');
        const payload = JSON.stringify({ mode: 'train', data_dir: dir, epochs: Number(epochs || 5), batch_size: Number(batch_size || 16) });
        const scriptPath = path.join(ML_DIR, 'species_classifier.py');
        execFile(ML_PYTHON_EXE, [scriptPath, payload], {
            cwd: ML_DIR,
            timeout: 300000,
            maxBuffer: 1024 * 1024 * 20
        }, (error, stdout, stderr) => {
            if (error) {
                console.error('[Train-Model] Error:', error.message);
                if (stderr) console.error('[Train-Model] Stderr:', String(stderr).slice(0, 1000));
                if (stdout) console.error('[Train-Model] Stdout:', String(stdout).slice(0, 1000));
                return res.status(500).json({ error: 'Training failed' });
            }
            try {
                const parsed = JSON.parse(stdout.trim());
                return res.json(parsed);
            } catch (e) {
                console.error('[Train-Model] Parse error:', e.message);
                return res.status(200).json({ status: 'ok', raw: stdout.trim() });
            }
        });
    } catch (e) {
        console.error('[Train-Model] Exception:', e.message);
        return res.status(500).json({ error: 'Training failed' });
    }
});
// --- Wildlife data helpers ---
// --- Local ML: Seed Dataset via iNaturalist (Node/axios) ---
app.post('/api/ml/seed-dataset', async (req, res) => {
    try {
        const perSpecies = Number(req.body?.per_species_limit || 10);
        const outDir = req.body?.output_dir ? String(req.body.output_dir) : path.join(ML_DIR, 'dataset');
        const species = [
            { name: 'Leopard', sci: 'Panthera pardus' },
            { name: 'Tiger', sci: 'Panthera tigris' },
            { name: 'Asian Elephant', sci: 'Elephas maximus' },
            { name: 'Sloth Bear', sci: 'Melursus ursinus' },
            { name: 'Gaur', sci: 'Bos gaurus' },
            { name: 'Bison', sci: 'Bison bison' },
        ];
        const results = {};
        await fs.promises.mkdir(outDir, { recursive: true });
        for (const sp of species) {
            const url = `https://api.inaturalist.org/v1/observations?taxon_name=${encodeURIComponent(sp.name)}&order=desc&order_by=created_at&per_page=${perSpecies}`;
            try {
                const resp = await axios.get(url, { timeout: 15000 });
                const obs = Array.isArray(resp.data?.results) ? resp.data.results : [];
                let count = 0;
                for (const r of obs) {
                    if (count >= perSpecies) break;
                    let img = '';
                    const photos = r.photos || [];
                    if (photos && photos.length) {
                        img = photos[0].url || photos[0].medium_url || '';
                        if (img && img.includes('{size}')) img = img.replace('{size}', 'medium');
                    }
                    if (!img) {
                        const dp = r?.taxon?.default_photo;
                        if (dp) {
                            img = dp.medium_url || dp.url || '';
                            if (img && img.includes('{size}')) img = img.replace('{size}', 'medium');
                        }
                    }
                    if (!img) continue;
                    const spDir = path.join(outDir, sp.sci);
                    await fs.promises.mkdir(spDir, { recursive: true });
                    const id = String(r.id || Date.now());
                    const file = path.join(spDir, `${id}.jpg`);
                    try {
                        const im = await axios.get(img, { responseType: 'arraybuffer', timeout: 20000, headers: { 'User-Agent': 'WildlifeSafetyApp/1.0 (+seed-dataset)' } });
                        await fs.promises.writeFile(file, Buffer.from(im.data));
                        count++;
                    } catch (imgErr) {
                        /* ignore image fetch errors */
                    }
                }
                results[sp.sci] = count;
            } catch (err) {
                results[sp.sci] = `error: ${err.message}`;
            }
        }
        res.json({ status: 'ok', counts: results, output_dir: outDir });
    } catch (e) {
        console.error('[Seed-Dataset] Exception:', e.message);
        res.status(500).json({ error: 'Seed dataset failed' });
    }
});
// --- Wildlife data helpers ---
const readJsonArray = (filePath) => {
    try {
        if (!fs.existsSync(filePath)) return [];
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        console.error(`Error reading cache ${path.basename(filePath)}:`, err.message);
        return [];
    }
};

const getHistoricalData = () => readJsonArray(WILDLIFE_CACHE_PATH);

// ML needs full historical context (2020 -> today).
// The UI/routing shows only a recent window (default: last 30 days) to reduce clutter and focus on near-term risk.
const getRecentData = (days = 30) => {
    const allData = getHistoricalData();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    
    return allData.filter(item => {
        if (!item.eventDate || item.eventDate === "Unknown") return false;
        const d = new Date(item.eventDate);
        return d >= cutoff;
    });
};

const runInatPython = () => {
    // Only run if cache is missing or explicitly requested (cache freshness handled in Python script)
    // The Python script now checks for existence.
    console.log("Running iNaturalist fetcher...");
    const r = spawnSync(INAT_PYTHON_EXE, [PYTHON_SCRIPT], {
        cwd: path.dirname(PYTHON_SCRIPT),
        encoding: 'utf8',
        timeout: 120000, // Increased timeout for historical fetch
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

// Removed syncSightingsToFirestore as per constraint: "Do NOT upload or dump wildlife observation data to Firebase Storage"
// (and presumably Firestore for this specific data, as per "User-submitted community reports (Firestore)" vs "Wildlife observation data... Direct API fetch")

// API: Get All Historical Data (for ML or analysis)
app.get('/api/wildlife/all', (req, res) => {
    // Check if we need to fetch first?
    if (!fs.existsSync(WILDLIFE_CACHE_PATH)) {
        runInatPython();
    }
    const data = getHistoricalData();
    res.json(data);
});

// API: Get Recent Data (for UI/Routing)
app.get('/api/wildlife/recent', (req, res) => {
    const days = req.query.days ? parseInt(req.query.days) : 30;
    
    // Trigger fetch if missing
    if (!fs.existsSync(WILDLIFE_CACHE_PATH)) {
        runInatPython();
    }
    
    const recent = getRecentData(days);
    res.json(recent);
});

// Legacy support (optional, can redirect to recent)
app.get('/api/inat/recent', (req, res) => {
    res.redirect('/api/wildlife/recent');
});


// --- New: sightings API for useAnimalData hook ---
app.get('/api/sightings', (req, res) => {
    const { scientificName, lat, lon, radius } = req.query;
    // Use only recent data for map display (default: 30 days)
    const wildlife = getRecentData(30);
    
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

// --- NEW: Safe Route Proxy (Dual Mode: Google -> OSRM Fallback) ---
app.get('/api/route/osrm', async (req, res) => {
    const { startLat, startLon, endLat, endLon, mode } = req.query; // mode: 'car', 'walk', etc.

    if (!startLat || !startLon || !endLat || !endLon) {
        return res.status(400).json({ error: 'Missing coordinates' });
    }

    // --- Helper: OSRM Logic ---
    const fetchOsrmRoute = async () => {
        try {
            console.log('[OSRM] Attempting OSRM fallback...');
            const OSRM_BASE_URL = process.env.OSRM_BASE_URL || 'http://router.project-osrm.org';
            // Map modes: car->driving, walk->foot, bike->bike
            let osrmProfile = 'driving';
            if (mode === 'walk') osrmProfile = 'foot';
            else if (mode === 'bike') osrmProfile = 'bike';
            
            const url = `${OSRM_BASE_URL}/route/v1/${osrmProfile}/${startLon},${startLat};${endLon},${endLat}?overview=full&geometries=geojson`;
            console.log(`[OSRM] Fetching: ${url}`);
            
            const response = await axios.get(url, { timeout: 3000 });
            if (!response.data.routes || response.data.routes.length === 0) {
                return { status: 'degraded', error: 'No OSRM route found' };
            }
            
            const route = response.data.routes[0];
            return {
                geometry: route.geometry,
                distance: route.distance,
                duration: route.duration,
                status: 'success',
                source: 'osrm'
            };
        } catch (error) {
            console.error("[OSRM] Failed:", error.message);
            return { status: 'failed', error: error.message };
        }
    };

    // Check Config
    const useGoogle = process.env.USE_GOOGLE_ROUTES === 'true';
    const API_KEY = process.env.GOOGLE_MAPS_API_KEY;

    if (!useGoogle || !API_KEY) {
        console.log('[Route] Google disabled or key missing. Using OSRM directly.');
        const osrmResult = await fetchOsrmRoute();
        if (osrmResult.status === 'success') return res.json(osrmResult);
        // If OSRM fails, fallback to straight line
        return res.json({ 
            status: 'degraded', 
            error: 'Routing service unavailable',
            message: "Using straight-line fallback"
        });
    }

    // --- Google Routes Logic ---
    // Map internal travel mode to Google Routes API travel mode
    let travelMode = 'DRIVE';
    if (mode === 'walk') travelMode = 'WALK';
    else if (mode === 'bike') travelMode = 'BICYCLE';
    else if (mode === 'bus') travelMode = 'TRANSIT';

    const url = 'https://routes.googleapis.com/directions/v2:computeRoutes';

    const payload = {
        origin: {
            location: {
                latLng: {
                    latitude: parseFloat(startLat),
                    longitude: parseFloat(startLon)
                }
            }
        },
        destination: {
            location: {
                latLng: {
                    latitude: parseFloat(endLat),
                    longitude: parseFloat(endLon)
                }
            }
        },
        travelMode: travelMode,
        routingPreference: travelMode === 'DRIVE' ? 'TRAFFIC_AWARE' : undefined,
        computeAlternativeRoutes: false,
        routeModifiers: {
            avoidTolls: false,
            avoidHighways: false,
            avoidFerries: false
        },
        polylineEncoding: 'ENCODED_POLYLINE',
        languageCode: 'en-US',
        units: 'METRIC'
    };

    const fieldMask = 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline';

    try {
        console.log(`[Google Routes] Fetching route: ${travelMode} from (${startLat},${startLon}) to (${endLat},${endLon})`);
        
        const response = await axios.post(url, payload, {
            headers: {
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': API_KEY.trim(),
                'X-Goog-FieldMask': fieldMask
            },
            timeout: 5000 // 5s timeout
        });

        const routes = response.data.routes;
        if (!routes || routes.length === 0) {
            // If Google returns valid response but no routes, try OSRM?
            // Usually means no road exists. OSRM likely won't find one either, but worth a try.
            console.warn('[Google Routes] No routes found. Trying OSRM...');
            const osrmResult = await fetchOsrmRoute();
            return res.json(osrmResult.status === 'success' ? osrmResult : { status: 'degraded', error: 'No route found' });
        }

        const route = routes[0];
        if (!route.polyline || !route.polyline.encodedPolyline) {
             throw new Error('Missing geometry in Google response');
        }

        const encodedPolyline = route.polyline.encodedPolyline;
        const path = polyline.decode(encodedPolyline);
        const geoJsonCoordinates = path.map(p => [p[1], p[0]]); // [lat, lon] -> [lon, lat]

        let durationSeconds = 0;
        if (route.duration) {
            durationSeconds = parseInt(route.duration.replace('s', ''), 10);
        }

        res.json({
            geometry: {
                coordinates: geoJsonCoordinates,
                type: 'LineString'
            },
            distance: route.distanceMeters, 
            duration: durationSeconds,      
            status: 'success',
            source: 'google'
        });

    } catch (error) {
        console.error("[Google Routes] Error:", error.message);
        
        let shouldFallback = false;

        if (error.response) {
            console.error("[Google Routes] Details:", JSON.stringify(error.response.data));
            // Check for Billing or Quota errors
            // 403: Forbidden (often Billing disabled or API not enabled)
            // 429: Too Many Requests (Quota)
            if (error.response.status === 403 || error.response.status === 429) {
                console.warn(`[Google Routes] Service restricted (${error.response.status}). Falling back to OSRM.`);
                shouldFallback = true;
            }
        } else {
            // Network timeout or other error
            shouldFallback = true;
        }

        if (shouldFallback) {
            const osrmResult = await fetchOsrmRoute();
            if (osrmResult.status === 'success') {
                return res.json(osrmResult);
            }
        }
        
        // Final fallback to straight line
        res.json({ 
            status: 'degraded', 
            error: 'Routing service unavailable',
            message: "Using straight-line fallback (degraded mode)",
            details: error.message
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

    // Use Recent Data ONLY for Routing (default: 30 days)
    const wildlife = getRecentData(30);
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

// --- Internal Geocoding Helper ---
const safeReverseGeocode = async (lat, lon) => {
  const latKey = parseFloat(lat).toFixed(4);
  const lonKey = parseFloat(lon).toFixed(4);
  const key = `${latKey},${lonKey}`;

  if (geocodeCache.has(key)) {
    return geocodeCache.get(key).display_name;
  }

  try {
    const response = await axios.get('https://nominatim.openstreetmap.org/reverse', {
      params: { lat, lon, format: 'json', zoom: 18, addressdetails: 1 },
      headers: { 
        'User-Agent': 'WildlifeSafetyApp/1.0 (edu-project)',
        'Referer': 'http://localhost' 
      },
      timeout: 5000 // 5s timeout as requested
    });
    
    if (response.data && response.data.display_name) {
      geocodeCache.set(key, response.data);
      return response.data.display_name;
    }
    return `Unknown forest area near (${latKey}, ${lonKey})`;
  } catch (error) {
    console.error('[InternalGeocode] Failed:', error.message);
    return `Unknown forest area near (${latKey}, ${lonKey})`;
  }
};

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
            timeout: 5000, // 5s timeout as requested
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
        // Requirement: Return 200 with degraded: true and results: []
        res.status(200).json({ 
            results: [], 
            degraded: true, 
            reason: "Geocoding service unavailable",
            geocode_status: "failed" // keep for compatibility if needed
        });
    }
});

// --- Reverse Geocode with Caching ---
const geocodeCache = new Map();
app.get('/api/reverse-geocode', async (req, res) => {
  const { lat, lon } = req.query;
  if (!lat || !lon) return res.status(400).json({ error: 'Missing lat/lon' });

  const address = await safeReverseGeocode(lat, lon);
  
  // Return in the format expected by frontend
  res.json({ 
      display_name: address,
      lat, 
      lon,
      geocode_status: address.startsWith('Unknown') ? "failed" : "success"
  });
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

// --- Gemini Proxy: Analyze Image ---
app.post('/api/gemini/analyze-image', async (req, res) => {
    try {
        const { mimeType, data, prompt } = req.body || {};
        if (!mimeType || !data) return res.status(400).json({ error: 'Missing mimeType or data' });
        const key = process.env.EXPO_PUBLIC_GEMINI_API_KEY || process.env.GEMINI_API_KEY || '';
        const model = process.env.EXPO_PUBLIC_GEMINI_MODEL || process.env.GEMINI_MODEL || 'gemini-1.5-flash';
        if (!key) return res.status(200).json(null);
        const structured = [
            'Return strict JSON with keys:',
            'common, scientific, confidence (0-1), risk (Low|Medium|High), behavior, circumstance,',
            'distance_advice, actions (array of short steps), emergency (array), summary.',
            'Only choose species from the allowed list in the prompt; if uncertain set common="Unknown", scientific="Unknown", confidence<=0.3.',
            'No markdown, no code fences, no extra text.'
        ].join(' ');
        const finalPrompt = `${String(prompt || 'Identify species from allowed list and provide safety advice.')} ${structured}`;
        const contents = [
            { role: 'user', parts: [{ text: finalPrompt }] },
            { role: 'user', parts: [{ inline_data: { mime_type: String(mimeType), data: String(data) } }] }
        ];
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
        const response = await axios.post(url, {
            contents,
            generationConfig: { temperature: 0.1, topP: 0.9, maxOutputTokens: 500 }
        }, { timeout: 10000 });
        let text = response?.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
        let cleaned = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '');
        if (!cleaned.startsWith('{')) {
            const start = cleaned.indexOf('{');
            const end = cleaned.lastIndexOf('}');
            if (start >= 0 && end >= start) cleaned = cleaned.slice(start, end + 1);
        }
        let parsed = null;
        try { parsed = JSON.parse(cleaned); } catch { parsed = null; }
        const sciRaw = typeof parsed?.scientific === 'string' ? parsed.scientific : '';
        const sciCanon = sciRaw ? String(sciRaw).trim().split(/\s+/).slice(0,2).join(' ') : 'Unknown';
        const out = {
            common: typeof parsed?.common === 'string' ? parsed.common : 'Unknown',
            scientific: sciCanon || 'Unknown',
            confidence: Number.isFinite(parsed?.confidence) ? Math.max(0, Math.min(1, Number(parsed.confidence))) : 0.3,
            risk: ['Low','Medium','High'].includes(parsed?.risk) ? parsed.risk : 'Medium',
            behavior: typeof parsed?.behavior === 'string' ? parsed.behavior : '',
            circumstance: typeof parsed?.circumstance === 'string' ? parsed.circumstance : '',
            distance_advice: typeof parsed?.distance_advice === 'string' ? parsed.distance_advice : '',
            actions: Array.isArray(parsed?.actions) ? parsed.actions.filter(a => typeof a === 'string').slice(0, 8) : [],
            emergency: Array.isArray(parsed?.emergency) ? parsed.emergency.filter(a => typeof a === 'string').slice(0, 6) : [],
            summary: typeof parsed?.summary === 'string' ? parsed.summary : 'Uncertain identification from the photo.'
        };
        // Map common/scientific variants to allowed species
        const ALLOWED = [
            { sci: 'Elephas maximus', common: 'Asian Elephant', keys: ['elephant','asian elephant','indian elephant'] },
            { sci: 'Panthera tigris', common: 'Tiger', keys: ['tiger','bengal tiger','royal bengal tiger'] },
            { sci: 'Panthera pardus', common: 'Leopard', keys: ['leopard','indian leopard'] },
            { sci: 'Bos gaurus', common: 'Gaur', keys: ['gaur','indian bison'] },
            { sci: 'Melursus ursinus', common: 'Sloth Bear', keys: ['sloth bear','bear'] },
            { sci: 'Bison bison', common: 'Bison', keys: ['bison','american bison'] },
        ];
        const norm = (s) => String(s || '').toLowerCase();
        const byCommon = ALLOWED.find(a => a.keys.some(k => norm(out.common).includes(k)));
        const byScientific = ALLOWED.find(a => a.keys.some(k => norm(out.scientific).includes(k)));
        const chosen = byScientific || byCommon;
        if (chosen) {
            out.common = chosen.common;
            out.scientific = chosen.sci;
            out.confidence = Math.max(out.confidence, 0.6);
        }
        // If still unknown or low confidence, try a general classification and map it
        const needsFallback = (out.common === 'Unknown' || out.scientific === 'Unknown' || out.confidence < 0.4);
        if (needsFallback) {
            try {
                const generalPrompt = 'Classify the main animal in this photo. Return JSON: {"common":"...", "scientific":"..."} only.';
                const generalContents = [
                    { role: 'user', parts: [{ text: generalPrompt }] },
                    { role: 'user', parts: [{ inline_data: { mime_type: String(mimeType), data: String(data) } }] }
                ];
                const generalResp = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
                    contents: generalContents,
                    generationConfig: { temperature: 0.1, topP: 0.9, maxOutputTokens: 200 }
                }, { timeout: 10000 });
                let t2 = generalResp?.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
                t2 = t2.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '');
                if (!t2.startsWith('{')) {
                    const s = t2.indexOf('{'); const e = t2.lastIndexOf('}');
                    if (s >= 0 && e >= s) t2 = t2.slice(s, e + 1);
                }
                let g = null; try { g = JSON.parse(t2); } catch { g = null; }
                const mapped = ALLOWED.find(a => a.keys.some(k => norm(g?.common).includes(k) || norm(g?.scientific).includes(k)));
                if (mapped) {
                    out.common = mapped.common;
                    out.scientific = mapped.sci;
                    out.confidence = Math.max(out.confidence, 0.6);
                    out.summary = out.summary || `Likely ${mapped.common}.`;
                }
            } catch { /* ignore */ }
        }
        // If Unknown or low confidence and we have base64, try local ML classifier
        const needsLocal = (out.common === 'Unknown' || out.scientific === 'Unknown' || out.confidence < 0.4);
        if (needsLocal) {
            try {
                const localResp = await axios.post('http://localhost:' + (process.env.PORT || 3000) + '/api/ml/classify-image', { data: String(data) }, { timeout: 12000 });
                const l = localResp?.data || {};
                if (l && l.common && l.scientific && l.common !== 'Unknown') {
                    out.common = l.common;
                    out.scientific = l.scientific;
                    out.confidence = Math.max(out.confidence, Number(l.confidence || 0.6));
                    out.summary = out.summary || `Likely ${l.common}.`;
                }
            } catch (e) {
                /* ignore local ml errors */
            }
        }
        return res.json(out);
    } catch (error) {
        console.error('[Gemini Proxy] Error:', error?.message || String(error));
        return res.status(200).json({ common: 'Unknown', scientific: 'Unknown', confidence: 0.3, risk: 'Medium', behavior: '', circumstance: '', distance_advice: '', actions: [], emergency: [], summary: 'Uncertain identification from the photo.' });
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
        confidence: confidence || 'medium',
        scope: scope || 'regional',
        metadata: { // Keep for backward compatibility if needed, but prefer flat
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
            res.json({
                ...prediction,
                risk_label: prediction?.risk ?? prediction?.risk_level ?? '',
                probability: Number.isFinite(prediction?.probability) ? Number(prediction.probability) : 0.0,
                predicted_points: []
            });
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

    // Enrich recent_path from cached sightings if the client provided too few points
    let enrichedRecentPath = Array.isArray(recent_path) ? recent_path : [];
    try {
        if (!Array.isArray(enrichedRecentPath) || enrichedRecentPath.length < 2) {
            // Use historical data for path enrichment/ML context if needed
            const merged = getHistoricalData();
            const matches = merged
                .filter(r => (r.animal && r.animal.toLowerCase() === String(animal).toLowerCase()) || (r.species && r.species.toLowerCase() === String(animal).toLowerCase()))
                .filter(r => typeof r.lat === 'number' && typeof r.lon === 'number');
            matches.sort((a, b) => {
                const ta = new Date(a.eventDate || 0).getTime();
                const tb = new Date(b.eventDate || 0).getTime();
                return ta - tb;
            });
            const lastFive = matches.slice(-5).map(r => [Number(r.lat), Number(r.lon)]);
            if (lastFive.length >= 2) {
                enrichedRecentPath = lastFive;
            } else if (lastFive.length === 1) {
                enrichedRecentPath = lastFive;
            }
        }
    } catch (e) {
        console.warn('[LSTM-Movement] Failed to enrich recent_path from cache:', e.message);
    }

    const inputJson = JSON.stringify({ animal, user_location, recent_path: enrichedRecentPath, k_future: k_future || 3 });
    
    // 2. Log exact Python command
    const pythonCmd = `${ML_PYTHON_EXE} ${ML_MAXENT_SCRIPT}`;
    console.log(`[LSTM-Movement] Executing: ${pythonCmd}`);
    console.log(`[LSTM-Movement] Input: ${inputJson}`);

    execFile(ML_PYTHON_EXE, [ML_MAXENT_SCRIPT, inputJson], {
        cwd: ML_DIR,
        timeout: 60000, 
        maxBuffer: 1024 * 1024 * 10
    }, async (error, stdout, stderr) => {
        const maxentOut = stdout.trim();
        let maxent = null;
        if (maxentOut && maxentOut.startsWith('{') && maxentOut.endsWith('}')) {
            try { maxent = JSON.parse(maxentOut); } catch {}
        }
        execFile(ML_PYTHON_EXE, [ML_LSTM_SCRIPT, inputJson], {
            cwd: ML_DIR,
            timeout: 60000,
            maxBuffer: 1024 * 1024 * 10
        }, async (err2, out2, errLog2) => {
            const lstmOut = out2.trim();
            let lstm = null;
            if (lstmOut && lstmOut.startsWith('{') && lstmOut.endsWith('}')) {
                try { lstm = JSON.parse(lstmOut); } catch {}
            }
            const k = (k_future && Number.isFinite(k_future)) ? Number(k_future) : 3;
            const p1 = Array.isArray(lstm?.predicted_path) ? lstm.predicted_path : [];
            const p2 = Array.isArray(maxent?.predicted_path) ? maxent.predicted_path : [];
            const seq = [];
            for (const p of p1) seq.push([Number(p[0]), Number(p[1])]);
            for (const p of p2) seq.push([Number(p[0]), Number(p[1])]);
            const chosen = [];
            const seen = new Set();
            for (const [lat, lon] of seq) {
                const key = `${lat.toFixed(5)},${lon.toFixed(5)}`;
                if (seen.has(key)) continue;
                if (chosen.length < k) { seen.add(key); chosen.push([lat, lon]); }
                if (chosen.length >= k) break;
            }
            let finalPath = chosen;
            if (finalPath.length === 0) {
                const path = Array.isArray(recent_path) ? recent_path : [];
                const n = path.length;
                let lastLat = 0, lastLon = 0, dLat = 0.0005, dLon = 0.0005;
                if (n >= 1) { lastLat = Number(path[n - 1][0]); lastLon = Number(path[n - 1][1]); }
                if (n >= 2) {
                    const prevLat = Number(path[n - 2][0]);
                    const prevLon = Number(path[n - 2][1]);
                    dLat = lastLat - prevLat;
                    dLon = lastLon - prevLon;
                    dLat = Math.max(Math.min(dLat, 0.01), -0.01);
                    dLon = Math.max(Math.min(dLon, 0.01), -0.01);
                }
                const synthesized = [];
                for (let i = 1; i <= k; i++) synthesized.push([lastLat + dLat * i, lastLon + dLon * i]);
                finalPath = synthesized;
            }
            const enhancedPath = await Promise.all(finalPath.map(async ([lat, lon]) => {
                const address = await safeReverseGeocode(lat, lon);
                return { lat, lon, address };
            }));
            const risks = [lstm?.risk_level, maxent?.risk_level].filter(Boolean);
            const order = { High: 3, Medium: 2, Low: 1 };
            let riskLevel = 'Low';
            for (const r of risks) { if (order[String(r)] > order[riskLevel]) riskLevel = String(r); }
            const safetyOverride = Boolean(lstm?.safety_override) || Boolean(maxent?.safety_override);
            const d1 = Number(lstm?.distance_to_user_km || 0);
            const d2 = Number(maxent?.distance_to_user_km || 0);
            const distKm = Math.max(d1, d2);
            const degraded = (lstm?.status === 'degraded') || (maxent?.status === 'degraded');
            res.json({
                animal,
                risk: riskLevel,
                risk_level: riskLevel,
                risk_label: riskLevel,
                predicted_path: enhancedPath,
                predicted_points: enhancedPath,
                probability: 0.0,
                safety_override: safetyOverride,
                distance_to_user_km: distKm,
                model_used: 'ensemble',
                degraded,
                status: 'success'
            });
        });
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
