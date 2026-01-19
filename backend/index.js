import express from 'express';
import cors from 'cors';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

const toRadians = (degrees) => (degrees * Math.PI) / 180;

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

app.use(
  cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
  })
);
app.use(express.json());

app.get('/test', (_req, res) => {
  res.json({ ok: true });
});

// Search Locations Proxy
app.get('/api/search-locations', async (req, res) => {
  const query = req.query.q;

  if (typeof query !== 'string' || !query.trim()) {
    return res.status(400).json({ error: 'Missing or invalid q parameter' });
  }

  try {
    const response = await axios.get('https://nominatim.openstreetmap.org/search', {
      params: {
        q: query,
        format: 'json',
        limit: 5,
      },
      headers: {
        'User-Agent': 'WildlifeSafetyApp/1.0 (React Native)',
      },
      timeout: 15000,
    });

    res.json(response.data);
  } catch (error) {
    console.error('Failed to search locations via Nominatim', error.message);
    res.status(502).json({ error: 'Failed to fetch locations from upstream service' });
  }
});

// Reverse Geocode Proxy
app.get('/api/reverse-geocode', async (req, res) => {
  const { lat, lon } = req.query;

  const latNum = typeof lat === 'string' ? parseFloat(lat) : NaN;
  const lonNum = typeof lon === 'string' ? parseFloat(lon) : NaN;

  if (!Number.isFinite(latNum) || !Number.isFinite(lonNum)) {
    return res.status(400).json({ error: 'Missing or invalid lat/lon parameters' });
  }

  try {
    const response = await axios.get('https://nominatim.openstreetmap.org/reverse', {
      params: {
        lat: latNum,
        lon: lonNum,
        format: 'json',
      },
      headers: {
        'User-Agent': 'WildlifeSafetyApp/1.0 (React Native)',
      },
      timeout: 15000,
    });

    res.json(response.data);
  } catch (error) {
    console.error('Failed to reverse geocode via Nominatim', error.message);
    // Return a mock response if upstream fails, or just the error
    res.status(502).json({ error: 'Failed to reverse geocode from upstream service' });
  }
});

// GBIF Caching and Throttling
const gbifCache = new Map();
const GBIF_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const fetchWithRetry = async (url, retries = 2, delayMs = 1000) => {
    for (let i = 0; i <= retries; i++) {
        try {
            return await axios.get(url, { timeout: 10000 });
        } catch (error) {
            if (i === retries) throw error;
            console.log(`Retrying GBIF request (${i + 1}/${retries})...`);
            await delay(delayMs);
        }
    }
};

app.get('/api/sightings', async (req, res) => {
    const { scientificName, lat, lon, radius } = req.query;

    if (!scientificName || !lat || !lon) {
        return res.status(400).json({ error: 'Missing parameters: scientificName, lat, lon' });
    }

    const cacheKey = `${scientificName}-${lat}-${lon}-${radius}`;
    if (gbifCache.has(cacheKey)) {
        const cached = gbifCache.get(cacheKey);
        if (Date.now() - cached.timestamp < GBIF_CACHE_TTL) {
            console.log(`Cache hit for ${scientificName}`);
            return res.json(cached.data);
        }
    }

    const latNum = parseFloat(lat);
    const lonNum = parseFloat(lon);
    const radiusKm = parseFloat(radius) || 10;

    const decimalLatitude = `${latNum - (radiusKm / 111.32)},${latNum + (radiusKm / 111.32)}`;
    const decimalLongitude = `${lonNum - (radiusKm / (111.32 * Math.cos(latNum * Math.PI / 180)))},${lonNum + (radiusKm / (111.32 * Math.cos(latNum * Math.PI / 180)))}`;

    try {
        console.log(`Fetching taxon key for ${scientificName}`);
        const taxonUrl = `https://api.gbif.org/v1/species/match?name=${encodeURIComponent(scientificName)}`;
        const taxonRes = await fetchWithRetry(taxonUrl);
        
        const taxonKey = taxonRes.data?.usageKey;
        if (!taxonKey) {
            console.warn(`No taxon key found for ${scientificName}`);
            return res.json([]);
        }

        // Delay to be polite to GBIF API
        await delay(Math.floor(Math.random() * 400) + 800); // 800-1200ms delay

        const sightingsUrl = `https://api.gbif.org/v1/occurrence/search?taxon_key=${taxonKey}&decimalLatitude=${decimalLatitude}&decimalLongitude=${decimalLongitude}&limit=50&hasCoordinate=true&hasGeospatialIssue=false`;
        console.log(`Fetching sightings for ${scientificName} (taxon: ${taxonKey})`);
        
        const sightingsRes = await fetchWithRetry(sightingsUrl);
        const sightings = sightingsRes.data.results.map((occ) => ({
            lat: occ.decimalLatitude,
            lon: occ.decimalLongitude,
            image: occ.media?.find((m) => m.type === 'StillImage')?.identifier
        })).filter(s => s.lat && s.lon);

        gbifCache.set(cacheKey, { timestamp: Date.now(), data: sightings });
        res.json(sightings);

    } catch (error) {
        console.error(`GBIF API failed for ${scientificName}:`, error.message);
        
        // Return empty list or cached fallback if available, don't crash
        // If we had stale cache, we could return it, but here we just return empty to avoid 503 crash
        res.json([]); 
    }
});

// Mock Prediction Endpoint
app.post('/api/predict-animal-paths', (req, res) => {
  const { animalSightings, scientificName } = req.body;

  if (!Array.isArray(animalSightings) || animalSightings.length === 0) {
    return res.status(400).json({ 
        success: false, 
        error: 'Missing or invalid animalSightings array' 
    });
  }

  // Generate mock predictions based on the last sighting
  const lastSighting = animalSightings[animalSightings.length - 1];
  const { lat, lng } = lastSighting;

  const startLon = lng !== undefined ? lng : lastSighting.lon;
  const startLat = lat;

  if (startLat === undefined || startLon === undefined) {
      return res.status(400).json({
          success: false,
          error: 'Invalid sighting coordinates'
      });
  }

  const predictedZones = [
    { lat: startLat + 0.001, lng: startLon + 0.001, risk: 0.8 },
    { lat: startLat + 0.002, lng: startLon + 0.0015, risk: 0.6 },
    { lat: startLat + 0.0025, lng: startLon + 0.0005, risk: 0.4 },
  ];

  console.log(`Generated mock predictions for ${scientificName || 'unknown species'}`);

  const speciesName = scientificName || 'Unknown';

  const predictions = predictedZones.map((zone, index) => ({
    id: `${speciesName}-${index}`,
    species: speciesName,
    lat: zone.lat,
    lon: zone.lng,
    distanceKm: 0,
    comment: 'Mock prediction'
  }));

  res.json({
    success: true,
    scientificName: speciesName,
    predictedZones,
    predictions,
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    backend: 'running',
    timestamp: new Date().toISOString()
  });
});

app.post('/api/safe-route', async (req, res) => {
  const { start, end, travelMode } = req.body;

  console.log('Incoming route request:', { start, end, travelMode });

  if (
    !start ||
    typeof start.lat !== 'number' ||
    typeof start.lon !== 'number' ||
    !end ||
    typeof end.lat !== 'number' ||
    typeof end.lon !== 'number'
  ) {
    return res.status(400).json({
      success: false,
      reason: 'INVALID_REQUEST',
    });
  }

  // Default to driving-car if not provided
  const travelModeInput = travelMode || 'driving-car';
  const OSRM_BASE_URL = process.env.OSRM_BASE_URL || 'http://localhost:5000';

  // Map travelMode to OSRM profile
  // "driving-car" -> "driving"
  // "foot-walking" -> "foot" (or "walking" depending on OSRM setup, usually 'foot' for standard profile)
  // Default fallback -> "driving"
  let profile = 'driving';
  if (travelModeInput === 'foot-walking') {
      profile = 'foot';
  } else if (travelModeInput === 'driving-car') {
      profile = 'driving';
  }

  try {
    // Construct OSRM URL
    // Format: {OSRM_BASE_URL}/route/v1/{profile}/{startLon},{startLat};{endLon},{endLat}?overview=full&geometries=geojson&steps=false
    const osrmUrl = `${OSRM_BASE_URL}/route/v1/${profile}/${start.lon},${start.lat};${end.lon},${end.lat}?overview=full&geometries=geojson&steps=false`;
    console.log(`OSRM Request URL (${travelModeInput} -> ${profile}):`, osrmUrl);

    const response = await axios.get(osrmUrl, {
        timeout: 5000 // 5 seconds timeout for local OSRM
    });

    const data = response.data;
    if (!data.routes || !data.routes[0]) {
      throw new Error('Invalid OSRM response: No routes found');
    }

    const route = data.routes[0];

    return res.json({
      success: true,
      geometry: route.geometry,
      distance: route.distance / 1000, // meters to km
      duration: route.duration / 60, // seconds to minutes
      provider: 'osrm',
    });

  } catch (error) {
    console.error('OSRM Routing failed:', error.message);
    
    console.warn('Attempting fallback (straight line)...');
    try {
        const distanceKm = haversineDistanceKm(start.lat, start.lon, end.lat, end.lon);
        // Estimate speed for duration calculation
        const speedKmh = profile === 'foot' ? 5 : 50;
        const durationMinutes = (distanceKm / speedKmh) * 60 || 0;
        const geometry = {
            type: 'LineString',
            coordinates: [
                [start.lon, start.lat],
                [end.lon, end.lat],
            ],
        };
        return res.json({
            success: true,
            geometry,
            distance: distanceKm,
            duration: durationMinutes,
            provider: 'fallback',
            warning: true
        });
    } catch (fallbackError) {
        console.error('Fallback routing error', fallbackError.message);
        return res.status(503).json({
            success: false,
            reason: 'ROUTING_SERVICE_UNAVAILABLE',
            details: error.message
        });
    }
  }
});

const port = process.env.PORT || 3000;

app.listen(port, '0.0.0.0', () => {
  console.log(`Backend server listening on port ${port}`);
});
