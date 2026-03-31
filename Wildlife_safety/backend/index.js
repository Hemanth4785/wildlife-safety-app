import express from 'express';
import cors from 'cors';
import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync, execFile } from 'child_process';
import { initializeApp } from 'firebase/app';
import { initializeFirestore, collection, doc, setDoc, deleteDoc, getDoc } from 'firebase/firestore';
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
    // FIX: Using long-polling for better stability in Node.js server environments
    db = initializeFirestore(firebaseApp, {
        experimentalForceLongPolling: true
    });
    console.log("Firebase initialized successfully (Long Polling enabled)");
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
const ML_LSTM_SCRIPT = path.join(ML_DIR, 'predict_lstm_seq.py');
const ML_MAXENT_SCRIPT = path.join(ML_DIR, 'predict_maxent.py');
const ML_EVAL_SCRIPT = path.join(ML_DIR, 'evaluate_model.py');
const ML_TS_SCRIPT = path.join(ML_DIR, 'predict_timeseries_risk.py');
const ML_HYBRID_SCRIPT = path.join(ML_DIR, 'predict_wildlife_hybrid.py');
const HEATMAP_PATH = path.join(__dirname, 'python', 'cache', 'corridor_heatmap.json');
const ML_SEQ_SCRIPT = path.join(ML_DIR, 'predict_lstm_seq.py');
const ML_MOVE_V2_SCRIPT = ML_SEQ_SCRIPT;
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://localhost:8000";

// Detect environment to use correct Python interpreter
const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';

// Force ML to use Python 3.10 virtual environment if available (Local Dev)
// On Render, we use the global 'python3' command.
const LOCAL_PYTHON = path.join(__dirname, "..", "lstm_env", process.platform === 'win32' ? path.join("Scripts", "python.exe") : path.join("bin", "python3"));
const ML_PYTHON_EXE = isProduction ? "python3" : (fs.existsSync(LOCAL_PYTHON) ? LOCAL_PYTHON : "python3");

// Function to start FastAPI ML Service
const startMLService = () => {
    console.log("[ML-Service] Starting FastAPI ML Service...");
    const mlProcess = execFile(ML_PYTHON_EXE, ["-m", "uvicorn", "ml.ml_service:app", "--host", "0.0.0.0", "--port", "8000"], {
        cwd: path.resolve(__dirname, ".."),
        env: { ...process.env, PYTHONPATH: path.resolve(__dirname, "..") }
    }, (error) => {
        if (error) {
            console.error("[ML-Service] Crashed or failed to start:", error.message);
        }
    });

    mlProcess.stdout.on('data', (data) => console.log(`[ML-Service-Log] ${data.trim()}`));
    mlProcess.stderr.on('data', (data) => console.error(`[ML-Service-Error] ${data.trim()}`));
    
    // Graceful shutdown
    process.on('SIGTERM', () => mlProcess.kill());
    process.on('SIGINT', () => mlProcess.kill());

    return mlProcess;
};

// Helper to check if ML service is ready
const checkMLServiceHealth = async (retries = 5) => {
    for (let i = 0; i < retries; i++) {
        try {
            const resp = await axios.get(`${ML_SERVICE_URL}/health`, { timeout: 2000 });
            if (resp.data.status === 'ok') {
                console.log("[ML-Service] Health check passed.");
                return true;
            }
        } catch (e) {
            console.log(`[ML-Service] Waiting for ML service to start (attempt ${i + 1}/${retries})...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
    return false;
};

// Start the ML service in production or if not already running
let mlServiceProcess = null;
if (isProduction || !process.env.ML_SERVICE_URL) {
    mlServiceProcess = startMLService();
    checkMLServiceHealth();
}

// Helper to run ML predictions via HTTP to the FastAPI service
const predictRiskML = async (payload) => {
    try {
        // Robust payload validation
        const cleanPayload = {
            animal: String(payload.animal || 'Elephant'),
            latitude: Number(payload.latitude) || 0.0,
            longitude: Number(payload.longitude) || 0.0,
            distance_km: Number(payload.distance_km) || 0.0,
            sighting_date: payload.sighting_date || payload.eventDate || new Date().toISOString(),
            forest_density: Number(payload.forest_density) || 0.5,
            distance_to_road: Number(payload.distance_to_road) || 1.0,
            human_population: Number(payload.human_population) || 100.0,
            elevation: Number(payload.elevation) || 500.0,
            habitat_suitability: Number(payload.habitat_suitability) || 0.5
        };

        const response = await axios.post(`${ML_SERVICE_URL}/predict-risk`, cleanPayload, { 
            timeout: 10000,
            headers: { 'Content-Type': 'application/json' }
        });
        return response.data;
    } catch (error) {
        console.error("[ML-HTTP] Prediction failed:", error.response?.data || error.message);
        // Fallback to Medium risk if ML service fails
        return { 
            risk: 'MEDIUM', 
            probability: 0.5, 
            distance_to_animal: Number(payload.distance_km) || 0.0,
            distance_to_water: 3.0,
            water_found: false,
            time_weight: 0.5,
            status: 'failed', 
            error: error.message 
        };
    }
};

// Helper to run ML movement predictions via HTTP
const predictMovementML = async (payload) => {
    try {
        const response = await axios.post(`${ML_SERVICE_URL}/predict-movement`, payload, { timeout: 10000 });
        return response.data;
    } catch (error) {
        console.error("[ML-HTTP] Movement prediction failed:", error.message);
        return { status: 'failed', error: error.message };
    }
};

console.log(`[ML] Environment: ${isProduction ? 'Production' : 'Development'}`);
console.log("[ML] Python interpreter:", ML_PYTHON_EXE);

// Log detected Python version at startup for verification
try {
    const v = spawnSync(ML_PYTHON_EXE, ['--version'], { cwd: ML_DIR, timeout: 8000, encoding: 'utf-8' });
    const out = String(v.stdout || '').trim();
    const err = String(v.stderr || '').trim();
    if (out) console.log(`[Python] Version: ${out}`);
    if (!out && err) console.log(`[Python] Version: ${err}`);
} catch (e) {
    console.log('[Python] Version check failed:', e?.message || String(e));
}
// Use the same Python for data fetching to ensure consistency
const INAT_PYTHON_EXE = ML_PYTHON_EXE;

// Helper to run Python scripts as promises
const runPythonScript = (scriptPath, payload) => {
    return new Promise((resolve, reject) => {
        execFile(ML_PYTHON_EXE, [scriptPath, payload], {
            cwd: ML_DIR,
            timeout: 60000,
            maxBuffer: 1024 * 1024 * 5
        }, (error, stdout, stderr) => {
            if (error) {
                console.error(`[ML Error] Script ${path.basename(scriptPath)} failed:`, error.message);
                if (stderr) console.error(`[ML Stderr] ${stderr}`);
                return reject(error);
            }
            try {
                const stdoutStr = String(stdout).trim();
                const jsonStart = stdoutStr.indexOf('{');
                const jsonEnd = stdoutStr.lastIndexOf('}');
                
                if (jsonStart === -1 || jsonEnd === -1) {
                    throw new Error("No JSON found in output");
                }
                
                const jsonStr = stdoutStr.substring(jsonStart, jsonEnd + 1);
                const parsed = JSON.parse(jsonStr);
                resolve(parsed);
            } catch (e) {
                console.error(`[ML Parse Error] Script ${path.basename(scriptPath)} output:`, stdout);
                reject(new Error(`Failed to parse JSON from ${path.basename(scriptPath)}: ${e.message}`));
            }
        });
    });
};

// --- Constants ---
const CACHE_DIR = path.join(__dirname, 'python', 'cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

// Helper for persistent JSON caching
const persistentCache = {
    load: (filename) => {
        const filePath = path.join(CACHE_DIR, filename);
        if (fs.existsSync(filePath)) {
            try {
                return JSON.parse(fs.readFileSync(filePath, 'utf8'));
            } catch (e) {
                console.error(`[Cache] Error loading ${filename}:`, e.message);
            }
        }
        return {};
    },
    save: (filename, data) => {
        const filePath = path.join(CACHE_DIR, filename);
        try {
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        } catch (e) {
            console.error(`[Cache] Error saving ${filename}:`, e.message);
        }
    }
};

const SOUTH_INDIA_BOUNDS = {
    minLat: 8.0,
    maxLat: 15.5,
    minLon: 74.0,
    maxLon: 84.0
};
const MAX_CORRIDOR_KM = 30;

const isWithinSouthIndia = (lat, lon) => {
    return lat >= SOUTH_INDIA_BOUNDS.minLat && 
           lat <= SOUTH_INDIA_BOUNDS.maxLat && 
           lon >= SOUTH_INDIA_BOUNDS.minLon && 
           lon <= SOUTH_INDIA_BOUNDS.maxLon;
};

const corridorClamp = (lat, lon) => {
    const clat = Math.max(8.0, Math.min(13.5, Number(lat)));
    const clon = Math.max(76.0, Math.min(80.5, Number(lon)));
    return { lat: clat, lon: clon };
};
const safeDistance = (distance) => {
    if (!Number.isFinite(distance)) {
        return 9999;
    }
    return distance;
};
function safeDistanceKm(distance) {
    if (!Number.isFinite(distance) || isNaN(distance)) {
        return null;
    }
    return Number(distance.toFixed(2));
}

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

const loadHeatmapGrid = () => {
    try {
        if (!fs.existsSync(HEATMAP_PATH)) return [];
        const raw = fs.readFileSync(HEATMAP_PATH, 'utf-8');
        const grid = JSON.parse(raw);
        return Array.isArray(grid) ? grid : [];
    } catch {
        return [];
    }
};

const nearestCellDensity = (lat, lon, grid) => {
    if (!grid || !grid.length) return 0;
    let best = 0, bestd = Infinity;
    for (const c of grid) {
        const clat = Number(c.cell_lat); const clon = Number(c.cell_lon);
        const d = haversineDistanceKm(lat, lon, clat, clon);
        if (d < bestd) { bestd = d; best = Number(c.density_score || 0); }
    }
    return best;
};

// Build Random Forest feature payload with dynamic environmental features
const buildRfPayload = (animal, lat, lon, distance_km, habitat_suitability = 0.5) => {
    const grid = loadHeatmapGrid();
    const forest_density_raw = nearestCellDensity(Number(lat), Number(lon), grid);
    const forest_density = Number.isFinite(forest_density_raw) ? forest_density_raw : 0.5;
    
    // Using realistic ranges based on standard ecological parameters for the Western Ghats (South India)
    const distance_to_water = 1.2; // km (fixed placeholder, can be refined if we have water layers)
    const human_population = 150.0; // pop/sqkm (fixed placeholder)
    const elevation = 750.0; // meters (fixed placeholder)
    
    const payloadObj = {
        animal,
        latitude: Number(lat),
        longitude: Number(lon),
        habitat_suitability: Number(habitat_suitability),
        forest_density,
        distance_to_water,
        human_population,
        elevation,
        distance_km: Number(distance_km),
        eventDate: new Date().toISOString()
    };
    
    console.log("[ML] RF FEATURE FUSION:", {
        animal,
        lat: Number(lat).toFixed(4),
        lon: Number(lon).toFixed(4),
        habitat_suitability: Number(habitat_suitability).toFixed(2),
        forest_density: forest_density.toFixed(2),
        distance_km: Number(distance_km).toFixed(2)
    });
    
    return JSON.stringify(payloadObj);
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
    methods: ['GET', 'POST', 'OPTIONS', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-user-id', 'x-user-email'],
  })
);
app.use(express.json({ limit: '10mb' }));

app.delete('/api/reports/:id', async (req, res) => {
    try {
        const reportId = String(req.params.id || '').trim();
        if (!reportId) return res.status(400).json({ status: 'failed', error: 'Missing report id' });
        if (!db) return res.status(500).json({ status: 'failed', error: 'Firestore not initialized' });
        const uid = String(req.header('x-user-id') || '').trim();
        if (!uid) return res.status(401).json({ status: 'failed', error: 'Unauthorized' });
        const ref = doc(db, 'reports', reportId);
        const snap = await getDoc(ref);
        if (!snap.exists()) return res.status(404).json({ status: 'failed', error: 'Not found' });
        const data = snap.data() || {};
        if (String(data.userId || '') !== uid) return res.status(403).json({ status: 'failed', error: 'Forbidden' });
        await deleteDoc(ref);
        return res.json({ status: 'success', deletedId: reportId });
    } catch (e) {
        return res.status(500).json({ status: 'failed', error: 'Delete failed' });
    }
});

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
        console.log("[ML] Executing script:", path.join(ML_DIR, 'species_classifier.py'));
        console.log("[ML] Payload:", payload);
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
                console.log("[ML] Output:", String(stdout).slice(0, 200));
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
        console.log("[ML] Executing script:", scriptPath);
        console.log("[ML] Payload:", payload);
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
                console.log("[ML] Output:", String(stdout).slice(0, 200));
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
        console.log("[ML] Executing script:", scriptPath);
        console.log("[ML] Payload:", payload);
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
                console.log("[ML] Output:", String(stdout).slice(0, 200));
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
const getRecentData = (days = 30, startDate = null, endDate = null) => {
    const allData = getHistoricalData();
    
    let cutoffStart, cutoffEnd;
    
    if (startDate && endDate) {
        cutoffStart = new Date(startDate);
        cutoffEnd = new Date(endDate);
        // Ensure end date includes the full day
        cutoffEnd.setHours(23, 59, 59, 999);
    } else {
        cutoffStart = new Date();
        cutoffStart.setDate(cutoffStart.getDate() - days);
        cutoffEnd = new Date();
    }
    
    // Regional Restriction: Filter by South India bounds and date range
    // Exclude user-submitted reports from AI data pool
    const recent = allData.filter(item => {
        if (item.isObservation === true || item.source === 'user_report') return false;
        if (!item.eventDate || item.eventDate === "Unknown") return false;
        
        const lat = parseFloat(item.lat);
        const lon = parseFloat(item.lon);
        if (!isWithinSouthIndia(lat, lon)) return false;

        const d = new Date(item.eventDate);
        return d >= cutoffStart && d <= cutoffEnd;
    });

    return recent;
};

/**
 * Shared logic for detecting wildlife near a route corridor
 * Standardized: 5km distance, 30 days window
 */
const getWildlifeNearRoute = (routePath, thresholdKm = 5.0, daysLimit = 30) => {
    const recentSightings = getRecentData(daysLimit);
    const results = [];
    
    recentSightings.forEach(animal => {
        const lat = parseFloat(animal.lat);
        const lon = parseFloat(animal.lon);
        if (isNaN(lat) || isNaN(lon)) return;

        const distKm = minDistanceToRoute(lat, lon, routePath);
        if (distKm <= thresholdKm) {
            results.push({
                ...animal,
                distanceToRoute: distKm
            });
        }
    });

    const uniqueSpeciesList = Array.from(new Set(results.map(r => r.animal || r.species).filter(Boolean)));
    
    console.log(`[RouteRisk]`);
    console.log(`Total sightings detected: ${results.length}`);
    console.log(`Unique species detected: ${uniqueSpeciesList.length}`);

    return {
        total_sightings: results.length,
        unique_species: uniqueSpeciesList.length,
        animals: uniqueSpeciesList,
        sightings: results // Detailed sightings for the map if needed
    };
};

const runInatPython = (isBackground = false) => {
    // Only run if cache is missing or explicitly requested (cache freshness handled in Python script)
    // The Python script now checks for existence.
    console.log(`${isBackground ? '[Background] ' : ''}Running iNaturalist fetcher...`);
    const r = spawnSync(INAT_PYTHON_EXE, [PYTHON_SCRIPT], {
        cwd: path.dirname(PYTHON_SCRIPT),
        encoding: 'utf8',
        timeout: 180000, // Increased timeout for historical fetch
    });
    if (r.error) {
        console.error("iNaturalist Python spawn error:", r.error.message);
        return false;
    }
    if (r.status !== 0) {
        console.error("iNaturalist Python stderr:", r.stderr || r.error);
        return false;
    }
    console.log(`${isBackground ? '[Background] ' : ''}iNaturalist fetcher completed successfully.`);
    return true;
};

// Schedule background data refresh every 24 hours
setInterval(() => {
    runInatPython(true);
}, 24 * 60 * 60 * 1000);

// Run fetcher on startup to ensure data is up to date
setTimeout(() => {
    runInatPython(true);
}, 5000); // Wait 5 seconds after startup to not block initial requests

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

app.get('/api/ml/health', (req, res) => {
    const scalerPath = path.join(ML_DIR, 'models', 'lstm', 'gps_scaler.pkl');
    const lstmDir = path.join(ML_DIR, 'models', 'lstm');
    const scaler_loaded = fs.existsSync(scalerPath);
    const generic = fs.existsSync(path.join(lstmDir, 'lstm_generic.h5')) || fs.existsSync(path.join(lstmDir, 'lstm_generic.keras'));
    const species_models_available = [];
    try {
        if (fs.existsSync(lstmDir)) {
            for (const f of fs.readdirSync(lstmDir)) {
                if ((f.startsWith('lstm_') && (f.endsWith('.h5') || f.endsWith('.keras'))) && !f.includes('generic')) {
                    species_models_available.push(f);
                }
            }
        }
    } catch {}

    let tensorflow_version = '';
    try {
        const p = spawnSync(
            ML_PYTHON_EXE,
            ['-c', 'import os; os.environ["TF_CPP_MIN_LOG_LEVEL"]="3"; import tensorflow as tf; print(tf.__version__)'],
            { cwd: ML_DIR, timeout: 15000, encoding: 'utf-8' }
        );
        const stdout = String(p.stdout || '').trim();
        const stderr = String(p.stderr || '').trim();
        if (stdout) tensorflow_version = stdout.split(/\r?\n/).slice(-1)[0].trim();
        else if (stderr) {
            const m = stderr.match(/(\d+\.\d+\.\d+)/g);
            tensorflow_version = m ? m[m.length - 1] : '';
        }
    } catch {}

    const model_loaded = Boolean(generic) || species_models_available.length > 0;
    return res.json({
        model_loaded,
        scaler_loaded,
        species_models_available,
        tensorflow_version,
    });
});

// Simple server health
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
});

// --- Simple Path Prediction (Heuristic) ---
// Input: { scientificName: string, animalSightings: [{ lat, lng }] }
// Output: { success: true, predictedZones: [{ lat, lng }] }
app.post('/api/predict-animal-paths', (req, res) => {
    try {
        const { scientificName, animalSightings } = req.body || {};
        const points = Array.isArray(animalSightings) ? animalSightings
            .map(p => ({ lat: Number(p.lat), lng: Number(p.lng ?? p.lon) }))
            .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng)) : [];
        if (points.length < 2) {
            return res.json({ success: true, predictedZones: [] });
        }
        const K = Math.min(5, points.length - 1);
        let dLat = 0, dLng = 0;
        for (let i = points.length - K - 1; i < points.length - 1; i++) {
            const a = points[i], b = points[i + 1];
            dLat += (b.lat - a.lat);
            dLng += (b.lng - a.lng);
        }
        dLat /= K;
        dLng /= K;
        const minDeg = 0.006;
        const mag = Math.sqrt(dLat * dLat + dLng * dLng);
        if (!Number.isFinite(mag) || mag === 0) {
            const theta = Math.random() * Math.PI * 2;
            dLat = minDeg * Math.cos(theta);
            dLng = minDeg * Math.sin(theta);
        } else if (mag < minDeg) {
            const s = minDeg / mag;
            dLat *= s;
            dLng *= s;
        }
        const FUTURE_STEPS = 3;
        const decay = 0.9;
        const start = points[points.length - 1];
        const predictedZones = [];
        let stepLat = dLat, stepLng = dLng;
        let curLat = start.lat, curLng = start.lng;
        for (let s = 0; s < FUTURE_STEPS; s++) {
            curLat += stepLat;
            curLng += stepLng;
            predictedZones.push({ lat: curLat, lng: curLng });
            stepLat *= decay;
            stepLng *= decay;
        }
        return res.json({ success: true, predictedZones, scientificName });
    } catch (e) {
        console.error('[PredictAnimalPaths] Error:', e.message);
        return res.status(200).json({ success: false, predictedZones: [], error: 'heuristic_failed' });
    }
});

// API: Get Recent Data (for UI/Routing)
app.get('/api/wildlife/recent', (req, res) => {
    const days = req.query.days ? parseInt(req.query.days) : 45;
    const startDate = req.query.startDate || null;
    const endDate = req.query.endDate || null;
    
    // Trigger fetch if missing
    if (!fs.existsSync(WILDLIFE_CACHE_PATH)) {
        runInatPython();
    }
    
    const recent = getRecentData(days, startDate, endDate);
    res.json(recent);
});

// Legacy support (optional, can redirect to recent)
app.get('/api/inat/recent', (req, res) => {
    res.redirect('/api/wildlife/recent');
});


app.get('/api/sightings', (req, res) => {
    const { scientificName, lat, lon, radius } = req.query;
    
    // Regional Restriction: If the request coordinates are outside South India, return empty
    if (lat && lon && !isWithinSouthIndia(parseFloat(lat), parseFloat(lon))) {
        return res.json([]);
    }

    // Use only recent data for map display
    const wildlife = getRecentData(45);
    
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
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;

    if (!apiKey) {
        console.error("[Route] Google Routes API key missing");
        // We can either throw or continue to fallback. 
        // The user said: "Only fall back to OSRM if the Google request fails."
        // But also "The /api/route endpoint should successfully call the Google Routes API using the key stored in .env"
        // Let's try Google first, and if key is missing, fall back to OSRM as per the logic flow.
    }

    if (!startLat || !startLon || !endLat || !endLon) {
        return res.status(400).json({ error: 'Missing coordinates' });
    }

    const startLatN = parseFloat(startLat);
    const startLonN = parseFloat(startLon);
    const endLatN = parseFloat(endLat);
    const endLonN = parseFloat(endLon);
    if (![startLatN, startLonN, endLatN, endLonN].every(Number.isFinite)) {
        return res.status(400).json({ error: 'Invalid coordinates' });
    }

    const routingFailed = (reason, extra = {}) => {
        console.error(`[Route] ROUTING FAILED: ${reason}`, extra);
        return res.status(502).json({
            status: 'routing_failed',
            reason,
            ...extra
        });
    };

    // --- Helper: OSRM Logic ---
    const fetchOsrmRoute = async () => {
        try {
            console.log('[Route] Routing via OSRM');
            // Try HTTPS first, then fallback to HTTP if needed.
            const OSRM_BASE_URL = process.env.OSRM_BASE_URL || 'https://router.project-osrm.org';
            
            let osrmProfile = 'driving';
            if (process.env.OSRM_BASE_URL) {
                if (mode === 'walk') osrmProfile = 'foot';
                else if (mode === 'bike') osrmProfile = 'bike';
            }
            
            const sLon = String(startLon).trim();
            const sLat = String(startLat).trim();
            const eLon = String(endLon).trim();
            const eLat = String(endLat).trim();

            // Use 'radiuses' parameter to help OSRM snap to nearest road (even if it's 3km away)
            const url = `${OSRM_BASE_URL}/route/v1/${osrmProfile}/${sLon},${sLat};${eLon},${eLat}?overview=full&geometries=geojson&radiuses=3000;3000`;
            console.log(`[OSRM] Fetching URL: ${url}`);
            
            const response = await axios.get(url, { 
                timeout: 20000, // Increased timeout to 20s
                headers: { 
                    'User-Agent': 'WildlifeSafetyApp/1.0',
                    'Accept': 'application/json'
                },
                validateStatus: (status) => status < 500 
            });

            if (response.status !== 200) {
                console.error(`[OSRM] Request failed with status ${response.status}:`, JSON.stringify(response.data));
                
                // Fallback: Try the lz4 mirror if the primary is down/failing
                if (OSRM_BASE_URL === 'https://router.project-osrm.org') {
                    console.warn('[OSRM] Trying fallback mirror...');
                    const fallbackUrl = `https://lz4.overpass-api.de/osrm/route/v1/${osrmProfile}/${sLon},${sLat};${eLon},${eLat}?overview=full&geometries=geojson&radiuses=3000;3000`;
                    try {
                         const fallbackRes = await axios.get(fallbackUrl, { timeout: 15000 });
                         if (fallbackRes.data && fallbackRes.data.routes && fallbackRes.data.routes.length > 0) {
                             console.log('[OSRM] Success using fallback mirror!');
                             const route = fallbackRes.data.routes[0];
                             return {
                                geometry: route.geometry,
                                distance: route.distance,
                                duration: route.duration,
                                status: 'success',
                                source: 'osrm_fallback'
                             };
                         }
                    } catch (e) {
                         console.error('[OSRM] Fallback mirror failed too.');
                    }
                }
                return { status: 'failed', error: `HTTP ${response.status}` };
            }

            if (!response.data.routes || response.data.routes.length === 0) {
                console.warn('[OSRM] WARNING: No routes found in response data.');
                return { status: 'failed', error: 'No OSRM route found' };
            }
            
            const route = response.data.routes[0];
            const pointCount = route.geometry?.coordinates?.length || 0;
            
            console.log(`[OSRM] Geometry points: ${pointCount}`);
            if (pointCount <= 2) {
                console.warn('[OSRM] WARNING: OSRM returned only 2 points (likely straight line).');
                return { status: 'failed', error: 'osrm_two_points' };
            }
            console.log('[OSRM] SUCCESS: Using OSRM route.');

            return {
                geometry: route.geometry,
                distance: route.distance,
                duration: route.duration,
                status: 'success',
                source: 'osrm'
            };
        } catch (error) {
            console.error("[OSRM] CRITICAL ERROR:", error.message);
            if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
                console.error("[OSRM] Service unreachable. Check your internet connection.");
            }
            return { status: 'failed', error: error.message };
        }
    };

    // --- Google Routes Logic ---
    const fetchGoogleRoute = async () => {
        if (!apiKey) {
            throw new Error("GOOGLE_MAPS_API_KEY not found");
        }
        console.log('[Route] Using Google Routes API');
        let travelMode = 'DRIVE';
        if (mode === 'walk') travelMode = 'WALK';
        else if (mode === 'bike') travelMode = 'BICYCLE';

        const url = 'https://routes.googleapis.com/directions/v2:computeRoutes';
        const payload = {
            origin: { location: { latLng: { latitude: parseFloat(startLat), longitude: parseFloat(startLon) } } },
            destination: { location: { latLng: { latitude: parseFloat(endLat), longitude: parseFloat(endLon) } } },
            travelMode: travelMode,
            routingPreference: travelMode === 'DRIVE' ? 'TRAFFIC_AWARE' : undefined,
            computeAlternativeRoutes: false,
            polylineEncoding: 'ENCODED_POLYLINE',
            languageCode: 'en-US',
            units: 'METRIC'
        };

        const response = await axios.post(url, payload, {
            headers: {
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': apiKey,
                'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline'
            },
            timeout: 10000
        });

        const routes = response.data.routes;
        if (!routes || routes.length === 0) throw new Error('No routes found');

        const route = routes[0];
        const encodedPolyline = route.polyline.encodedPolyline;
        const path = polyline.decode(encodedPolyline);
        const geoJsonCoordinates = path.map(p => [p[1], p[0]]); // [lat, lon] -> [lon, lat]

        let durationSeconds = 0;
        if (route.duration) durationSeconds = parseInt(route.duration.replace('s', ''), 10);

        console.log(`[Route] Route points count: ${geoJsonCoordinates.length}`);

        return {
            geometry: { coordinates: geoJsonCoordinates, type: 'LineString' },
            distance: route.distanceMeters,
            duration: durationSeconds,
            status: 'success',
            source: 'google'
        };
    };

    try {
        const googleResult = await fetchGoogleRoute();
        return res.json(googleResult);
    } catch (error) {
        console.error("[Route] Google Routes API Error:", error.message);
        if (error.response) console.error("[Route] Google Error Details:", JSON.stringify(error.response.data));
        
        console.log("[Route] Falling back to OSRM...");
        const osrmResult = await fetchOsrmRoute();
        if (osrmResult.status === 'success') {
            return res.json(osrmResult);
        }
        return routingFailed('google_routes_failed_and_osrm_failed', { details: error.message });
    }
});

// --- NEW: Risk Analysis ---
app.post('/api/animals/near-route', (req, res) => {
    const { routeGeometry } = req.body;

    if (!routeGeometry) {
        return res.status(400).json({ error: 'Missing routeGeometry' });
    }

    let pathPoints = [];
    if (Array.isArray(routeGeometry)) {
        pathPoints = routeGeometry;
    } else if (routeGeometry.coordinates) {
        pathPoints = routeGeometry.coordinates;
    } else {
        return res.status(400).json({ error: 'Invalid geometry format' });
    }

    // Convert [lon, lat] to [lat, lon]
    const routePath = pathPoints.map(p => [p[1], p[0]]);

    // Use shared logic: 5km, 30 days
    const result = getWildlifeNearRoute(routePath, 5.0, 30);

    res.json({
        total_sightings: result.total_sightings,
        unique_species: result.unique_species,
        animals: result.animals,
        riskZones: result.sightings, // For map compatibility
        riskySegments: []
    });
});

// --- Internal Geocoding Helper ---
let geocodeCacheData = persistentCache.load('geocode_cache.json');
const safeReverseGeocode = async (lat, lon) => {
  const latKey = parseFloat(lat).toFixed(4);
  const lonKey = parseFloat(lon).toFixed(4);
  const key = `${latKey},${lonKey}`;

  if (geocodeCacheData[key]) {
    const cached = geocodeCacheData[key];
    const addr = cached?.address || {};
    const name =
      addr.national_park || addr.nature_reserve || addr.protected_area ||
      addr.forest || addr.wood || addr.wildlife_sanctuary ||
      addr.village || addr.hamlet || addr.town || addr.city ||
      cached?.display_name || '';
    return String(name).trim() || `Unknown wildlife area near (${latKey}, ${lonKey})`;
  }

    try {
        const response = await axios.get('https://nominatim.openstreetmap.org/reverse', {
            params: { 
                lat, lon, format: 'json', zoom: 18, addressdetails: 1,
                email: 'hemac@example.com' // Nominatim likes having an email in params too
            },
            headers: { 
                'User-Agent': 'WildlifeSafetyApp-Edu-Research-v1.1',
                'Accept-Language': 'en'
            },
            timeout: 10000 
        });
    
    const data = response.data || {};
    geocodeCacheData[key] = data;
    persistentCache.save('geocode_cache.json', geocodeCacheData);
    
    const addr = data.address || {};
    const primary =
      addr.national_park || addr.nature_reserve || addr.protected_area ||
      addr.forest || addr.wood || addr.wildlife_sanctuary;
    const settlement = addr.village || addr.hamlet || addr.suburb || addr.town || addr.city;
    const district = addr.state_district || addr.county || addr.state;
    if (primary) {
      return String(primary).trim();
    }
    if (settlement && district) {
      return `${String(settlement).trim()}, ${String(district).trim()}`;
    }
    if (data.display_name) {
      const first = String(data.display_name).split(',')[0].trim();
      if (first) return first;
      return String(data.display_name).trim();
    }
    return `Unknown wildlife area near (${latKey}, ${lonKey})`;
  } catch (error) {
    console.error('[InternalGeocode] Failed:', error.message);
    return `Unknown wildlife area near (${latKey}, ${lonKey})`;
  }
};

// --- Nominatim search proxy (frontend must never call Nominatim directly) ---
let searchCacheData = persistentCache.load('search_cache.json');
app.get('/api/search-locations', async (req, res) => {
    const q = req.query.q;
    if (!q || typeof q !== 'string') return res.status(400).json({ error: 'Missing q' });
    const key = q.trim().toLowerCase();
    
    if (searchCacheData[key]) {
        return res.json(searchCacheData[key]);
    }

    try {
        const r = await axios.get('https://nominatim.openstreetmap.org/search', {
            params: { 
                q, format: 'json', limit: 10, countrycodes: 'in',
                email: 'hemac@example.com'
            },
            headers: { 
                'User-Agent': 'WildlifeSafetyApp-Edu-Research-v1.1',
                'Accept-Language': 'en'
            },
            timeout: 10000, 
        });

        const arr = Array.isArray(r.data) ? r.data : [];
        const out = arr.map((x) => ({
            lat: x.lat,
            lon: x.lon,
            display_name: x.display_name || '',
        }));

        searchCacheData[key] = out;
        persistentCache.save('search_cache.json', searchCacheData);
        res.json(out);
    } catch (e) {
        console.error('[Search] Geocoding error:', e.message);
        // Requirement: Always return an array to avoid breaking the frontend
        res.status(200).json([]);
    }
});

// --- Reverse Geocode with Caching ---
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
let overpassCacheData = persistentCache.load('overpass_cache.json');
app.get('/api/overpass', async (req, res) => {
    const { data } = req.query;
    if (!data) return res.status(400).json({ error: 'Missing data query' });

    const key = Buffer.from(data).toString('base64').substring(0, 50); // Use start of query as key
    if (overpassCacheData[key]) {
        return res.json(overpassCacheData[key]);
    }

    const fetchOverpass = async (url) => {
        return axios.get(url, {
            params: { data },
            timeout: 60000 // Increased timeout to 60s
        });
    };

    try {
        let response;
        try {
            response = await fetchOverpass('https://overpass-api.de/api/interpreter');
        } catch (err) {
            console.warn('Primary Overpass failed, trying mirror...', err.message);
            response = await fetchOverpass('https://lz4.overpass-api.de/api/interpreter');
        }
        
        overpassCacheData[key] = response.data;
        persistentCache.save('overpass_cache.json', overpassCacheData);
        return res.json(response.data);
    } catch (error) {
        console.error('[Overpass] Degraded:', error.message);
        res.json({ 
            elements: [], 
            status: "degraded",
            message: "Overpass API failed" 
        });
    }
});

app.get('/api/health', async (req, res) => {
  let connectivity = 'ok';
  try {
      await axios.get('https://www.google.com', { timeout: 2000 });
  } catch (e) {
      connectivity = 'limited (offline/dns issue)';
  }

  res.json({
    status: 'ok',
    backend: 'running',
    connectivity,
    timestamp: new Date().toISOString()
  });
});

// --- Weather Proxy (OpenWeatherMap) ---
let weatherCacheData = persistentCache.load('weather_cache.json');
app.get('/api/weather', async (req, res) => {
    const { lat, lon } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: 'Missing lat/lon' });

    // Round to 2 decimals (~1km) for caching
    const key = `${parseFloat(lat).toFixed(2)},${parseFloat(lon).toFixed(2)}`;
    if (weatherCacheData[key]) {
        const cached = weatherCacheData[key];
        if (Date.now() - cached.timestamp < 60 * 60 * 1000) { // Increased to 60 min for better offline support
            return res.json(cached.data);
        }
    }

    try {
        const apiKey = '0f965eb13fcac3cab46a6d13af345eac';
        const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&appid=${apiKey}`;
        const response = await axios.get(url, { timeout: 5000 }); // Increased timeout to 5s to handle slower responses
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

        weatherCacheData[key] = { timestamp: Date.now(), data: mappedData };
        persistentCache.save('weather_cache.json', weatherCacheData);
        res.json(mappedData);
    } catch (error) {
        console.error('[Weather] Degraded:', error.message);
        
        // Return cached data even if expired if we are offline
        if (weatherCacheData[key]) {
            console.log(`[Weather] Using expired cache for ${key} due to network error`);
            return res.json(weatherCacheData[key].data);
        }

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
app.post('/api/gemini/chat', async (req, res) => {
    try {
        const { history, images, systemPrompt } = req.body || {};
        const key = process.env.EXPO_PUBLIC_GEMINI_API_KEY || process.env.GEMINI_API_KEY || '';
        const model = process.env.EXPO_PUBLIC_GEMINI_MODEL || process.env.GEMINI_MODEL || 'gemini-1.5-flash';
        
        if (!key) {
            return res.status(503).json({ error: 'Gemini API key not configured on server' });
        }

        const contents = [];
        if (systemPrompt) {
            contents.push({ role: 'user', parts: [{ text: systemPrompt }] });
        }

        if (Array.isArray(history)) {
            history.forEach(m => {
                contents.push({
                    role: m.role === 'model' ? 'model' : 'user',
                    parts: [{ text: String(m.text || m.content || '') }]
                });
            });
        }

        if (Array.isArray(images) && images.length > 0) {
            const imageParts = images.map(img => ({
                inline_data: { mime_type: img.mimeType, data: img.data }
            }));
            contents.push({ role: 'user', parts: imageParts });
        }

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
        const response = await axios.post(url, {
            contents,
            generationConfig: {
                temperature: 0.2,
                topP: 0.9,
                maxOutputTokens: 1000
            }
        }, { timeout: 15000 });

        const text = response?.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (!text) {
            throw new Error('Empty response from Gemini');
        }

        res.json({ text });
    } catch (error) {
        console.error('[Gemini Chat] Error:', error.message);
        res.status(500).json({ error: 'Failed to get AI response', details: error.message });
    }
});

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
app.post('/api/predict-risk', async (req, res) => {
    try {
        const { animal, distance_km, eventDate, latitude, longitude, forest_density, distance_to_water, distance_to_road, human_population, elevation, habitat_suitability } = req.body;

        if (!animal || distance_km === undefined) {
            return res.status(400).json({ error: 'Missing animal or distance_km' });
        }

        const payload = {
            animal,
            distance_km,
            latitude,
            longitude,
            forest_density,
            distance_to_water,
            distance_to_road,
            human_population,
            elevation,
            sighting_date: eventDate || new Date().toISOString(),
            habitat_suitability: habitat_suitability || 0.5
        };

        console.log(`[ML-Risk] Requesting: ${animal} at ${distance_km}km`);
        const result = await predictRiskML(payload);
        
        if (result.status === 'failed') {
            return res.status(500).json({ error: "prediction_failed", message: result.error });
        }

        return res.json({
            ...result,
            risk_label: result.risk,
            probability: result.probability,
            predicted_points: []
        });
    } catch (e) {
        console.error('[API-Risk] Error:', e.message);
        return res.status(500).json({ error: 'internal_error', message: e.message });
    }
});

app.post('/api/predict-wildlife-risk', async (req, res) => {
    try {
        const route = Array.isArray(req.body?.route_coordinates) ? req.body.route_coordinates : [];
        if (!Array.isArray(route) || route.length < 2) {
            return res.status(400).json({ error: 'route_coordinates must be an array with at least 2 points' });
        }
        const routePath = route.map(p => {
            if (Array.isArray(p) && p.length >= 2) return [Number(p[0]), Number(p[1])];
            if (p && typeof p === 'object') return [Number(p.lat ?? p.latitude), Number(p.lon ?? p.lng ?? p.longitude)];
            return [NaN, NaN];
        }).filter(a => Number.isFinite(a[0]) && Number.isFinite(a[1]));
        
        if (routePath.length < 2) {
            return res.status(400).json({ error: 'Invalid coordinate format' });
        }

        // --- Standardized Animal Detection (Consistency Fix) ---
        // Corridor: 5km, Window: 30 days
        const detectionResult = getWildlifeNearRoute(routePath, 5.0, 30);
        const animalsDetected = detectionResult.animals;
        
        const today = new Date();
        const daysWindow = 30;
        const daysAll = [];
        for (let i = daysWindow - 1; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(today.getDate() - i);
            daysAll.push(d.toISOString().slice(0, 10));
        }

        const initRow = () => ({ elephant: 0, tiger: 0, leopard: 0, bison: 0, slothbear: 0, rainfall: 0 });
        const perDayCounts = daysAll.map(() => initRow());
        const toKey = (s) => {
            if (!s) return null;
            const k = String(s).toLowerCase();
            if (k.includes('elephas') || k.includes('elephant')) return 'elephant';
            if (k.includes('tigris') || k.includes('tiger')) return 'tiger';
            if (k.includes('pardus') || k.includes('leopard')) return 'leopard';
            if (k.includes('gaurus') || k.includes('gaur') || k.includes('bison')) return 'bison';
            if (k.includes('melursus') || k.includes('sloth')) return 'slothbear';
            return null;
        };

        // Populate timeseries using standardized detections
        detectionResult.sightings.forEach(r => {
            const s = r?.species ?? r?.animal ?? '';
            const key = toKey(s);
            if (!key) return;
            const dt = String(r?.observed_on ?? r?.eventDate ?? '');
            if (dt.length >= 10) {
                const day = dt.slice(0, 10);
                const idx = daysAll.indexOf(day);
                if (idx !== -1) perDayCounts[idx][key] += 1;
            }
        });

        // Historical density (all-time, standardized to 5km corridor)
        let historicalCount = 0;
        try {
            if (fs.existsSync(WILDLIFE_CACHE_PATH)) {
                const data = JSON.parse(fs.readFileSync(WILDLIFE_CACHE_PATH, 'utf-8'));
                if (Array.isArray(data)) {
                    data.forEach(r => {
                        // Exclude user observations from historical density calculations
                        if (r.isObservation === true || r.source === 'user_report') return;
                        const lat = Number(r?.latitude ?? r?.lat);
                        const lon = Number(r?.longitude ?? r?.lon);
                        if (Number.isFinite(lat) && Number.isFinite(lon)) {
                            if (minDistanceToRoute(lat, lon, routePath) <= 5.0) historicalCount++;
                        }
                    });
                }
            }
        } catch {}

        const last7 = perDayCounts.slice(-7);
        const features = last7.map(r => [r.elephant, r.tiger, r.leopard, r.bison, r.slothbear, r.rainfall]);

        // Corridor heatmap density (standardized to 5km)
        let corridorDensity = 0.0;
        try {
            if (fs.existsSync(HEATMAP_PATH)) {
                const grid = JSON.parse(fs.readFileSync(HEATMAP_PATH, 'utf-8'));
                if (Array.isArray(grid)) {
                    const vals = grid.filter(c => minDistanceToRoute(Number(c.cell_lat), Number(c.cell_lon), routePath) <= 5.0)
                                    .map(c => Number(c.density_score || 0));
                    if (vals.length) corridorDensity = vals.reduce((a,b)=>a+b,0)/vals.length;
                }
            }
        } catch {}

        const finishRouteRisk = (prob, lstmLvl) => {
            const rank = (r) => r === 'HIGH' ? 3 : (r === 'MEDIUM' ? 2 : 1);
            let baselineRisk = historicalCount > 50 ? 'MEDIUM' : 'LOW';
            const finalRank = Math.max(rank(lstmLvl), rank(baselineRisk));
            
            const score = Math.max(0, Math.min(1, 0.4*prob + 0.4*corridorDensity + 0.2*(finalRank/3)));
            const lvl = score > 0.6 ? 'HIGH' : (score >= 0.3 ? 'MEDIUM' : 'LOW');

            return res.json({ 
                routeRisk: lvl, 
                probability: score, 
                animalsDetected, 
                predictionSources: ['lstm_timeseries', 'historical_density', 'heatmap'],
                total_sightings: detectionResult.total_sightings,
                unique_species: detectionResult.unique_species,
                animals: detectionResult.animals
            });
        };

        const isEmptySequence = features.every(day => day.every(val => val === 0));
        if (isEmptySequence) {
            return finishRouteRisk(0.0, 'LOW');
        }

        const now = new Date();
        const mon = now.getMonth() + 1;
        const seas = mon <= 2 ? 1 : (mon <= 5 ? 2 : (mon <= 9 ? 3 : 4));
        const routeLenKm = (() => {
            let sum = 0;
            for (let i = 0; i < routePath.length - 1; i++) {
                const a = routePath[i], b = routePath[i+1];
                sum += haversineDistanceKm(a[0], a[1], b[0], b[1]);
            }
            return sum;
        })();
        const areaCorridor = Math.max(1e-6, routeLenKm * (2 * 5.0));
        const historical_density = historicalCount / areaCorridor;

        const payload = JSON.stringify({ sequence: features, month: mon, season: seas, historical_density });
        execFile(ML_PYTHON_EXE, [ML_TS_SCRIPT, payload], { cwd: ML_DIR, timeout: 15000 }, (error, stdout) => {
            let prob = 0.0, lvl = 'LOW';
            if (!error && stdout) {
                try {
                    const out = JSON.parse(stdout.trim());
                    prob = Number(out?.risk_probability ?? 0);
                    lvl = String(out?.risk_level ?? 'LOW').toUpperCase();
                } catch {}
            }
            finishRouteRisk(prob, lvl);
        });

    } catch (error) {
        console.error('[RouteRisk] Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/wildlife-heatmap', (req, res) => {
    try {
        if (!fs.existsSync(HEATMAP_PATH)) return res.json([]);
        const raw = fs.readFileSync(HEATMAP_PATH, 'utf-8');
        const grid = JSON.parse(raw);
        if (!Array.isArray(grid)) return res.json([]);
        return res.json(grid);
    } catch {
        return res.json([]);
    }
});

// --- NEW: LSTM + MaxEnt Hybrid Movement Prediction Endpoint ---
app.post('/api/predict-movement', async (req, res) => {
    try {
        const b = req.body || {};
        const animal = String(b.animal || 'Elephant');
        const userLoc = b.user_location || { lat: 11.4, lon: 76.7 };
        const recentPath = Array.isArray(b.recent_path) ? b.recent_path : [];
        const kFuture = Number(b.k_future || 3);

        // Normalize and deduplicate trajectory
        const norm = (p) => Array.isArray(p) ? [Number(p[0]), Number(p[1])] : [Number(p?.lat), Number(p?.lon)];
        const rawTraj = recentPath.map(norm).filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon));
        
        const dedup = [];
        for (let i = 0; i < rawTraj.length; i++) {
            const cur = rawTraj[i];
            const prev = dedup[dedup.length - 1];
            if (!prev || prev[0] !== cur[0] || prev[1] !== cur[1]) dedup.push(cur);
        }
        
        let trajectory = dedup.slice(-15);
        if (trajectory.length === 0) {
            // Use current user location as a single point trajectory if no history exists
            trajectory = [[userLoc.lat, userLoc.lon]];
        }

        let predictedPositions = [];
        let modelUsed = 'LSTM';
        let habitatScore = 0.5;

        // --- EXCLUSIVE: FastAPI Service for Movement Prediction ---
        console.log(`[ML] Requesting movement prediction for ${animal} from FastAPI service`);
        
        const mlPayload = { trajectory, animal, steps: kFuture };

        try {
            const mlResult = await predictMovementML(mlPayload);

            if (mlResult.status === 'success' && Array.isArray(mlResult.predictions)) {
                predictedPositions = mlResult.predictions.map(p => corridorClamp(p.lat, p.lon));
                modelUsed = mlResult.model_used || 'LSTM-Service';
                habitatScore = Number(mlResult.suitability ?? 0.5);
                console.log(`[ML] Received movement predictions from ML service`);
            } else {
                throw new Error(mlResult.error || "ML service movement prediction failed");
            }
        } catch (err) {
            console.error("[ML] Movement prediction failed:", err.message);
            return res.status(500).json({ status: 'failed', error: 'ML movement prediction failed' });
        }

        // FEATURE FUSION: Combine LSTM path and MaxEnt suitability for Random Forest
        console.log(`[ML] Running Random Forest risk classification`);
        const firstPoint = predictedPositions[0];
        const distToUser = haversineDistanceKm(userLoc.lat, userLoc.lon, firstPoint.lat, firstPoint.lon);
        
        const rfPayload = {
            animal: animal,
            latitude: firstPoint.lat,
            longitude: firstPoint.lon,
            distance_km: distToUser,
            habitat_suitability: habitatScore,
            sighting_date: b.sighting_date || new Date().toISOString()
        };

        const rfResult = await predictRiskML(rfPayload);
        const riskLevel = String(rfResult.risk || 'Medium').toUpperCase();

        // Reverse Geocoding for output locations (Sequential to avoid Nominatim 403 blocks)
        const names = [];
        for (const pt of predictedPositions) {
            const name = await safeReverseGeocode(pt.lat, pt.lon);
            names.push(name);
            // Small delay if not the last point to respect 1 req/sec policy (increased to 1.5s)
            if (predictedPositions.indexOf(pt) < predictedPositions.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1500));
            }
        }

        const predictedLocations = predictedPositions.map((pt, i) => ({
            step: i + 1,
            location: names[i] || `Wildlife Area (${pt.lat.toFixed(3)}, ${pt.lon.toFixed(3)})`,
            lat: pt.lat,
            lon: pt.lon
        }));

        console.log(`[ML] Prediction complete. Model: ${modelUsed}, Risk: ${riskLevel}`);

        return res.status(200).json({
            status: 'success',
            predicted_positions: predictedPositions,
            predicted_locations: predictedLocations,
            model_used: modelUsed,
            risk_level: riskLevel,
            habitat_suitability: habitatScore
        });

    } catch (err) {
        console.error("[ML-API] Global Error:", err.message);
        return res.status(500).json({ status: 'failed', error: err.message });
    }
});

// --- Server Startup ---
const port = process.env.PORT || 3000;
const server = app.listen(port, '0.0.0.0', () => {
  console.log("=================================");
  console.log("Wildlife Safety Backend Starting");
  console.log("Server Port:", port);
  console.log("=================================");
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
