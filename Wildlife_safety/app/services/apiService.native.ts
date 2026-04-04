import type { Sighting, Location, ChatMessage, Route, WeatherData, SafePlace, TravelMode } from '../types';
import { logger } from '../utils/logger';
import { getApiBaseUrl as resolveApiBaseUrl, ML_SERVICE_URL, CONFIG } from '../config';
import { ANIMALS, canonicalScientific, isWithinSouthIndia, SOUTH_INDIA_BOUNDS } from '../constants';
import wildlifeRecent from '../wildlife_recent.json';
import { calculateMinDistanceToPolyline } from './geoService';
import { auth } from './firebase';
import { safeObject } from '../utils/safety';

let wildlifeAllCache: any[] | null = null;
let wildlifeAllCacheAt = 0;

// Use config normalization so base always ends with /api (matches Express routes like /api/search-locations).
const getApiBaseUrl = (): string | null => {
    const url = resolveApiBaseUrl();
    console.log(`[API] Using API Base URL: ${url}`);
    if (!url) {
        logger.warn('[API] API_BASE_URL is missing!');
    }
    return url || null;
};

// Helper to get ML Service URL
const getMlServiceUrl = (): string | null => {
    const url = ML_SERVICE_URL;
    console.log(`[API] Using ML Service URL: ${url}`);
    if (!url) {
        logger.warn('[API] ML_SERVICE_URL is missing!');
    }
    return url;
};

const distKm = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
    const R = 6371;
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLon = ((b.lon - a.lon) * Math.PI) / 180;
    const lat1 = (a.lat * Math.PI) / 180;
    const lat2 = (b.lat * Math.PI) / 180;
    const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
    return 2 * R * Math.asin(Math.sqrt(x));
};

const MAX_FETCH_RETRIES = 5;

const fetchWithTimeout = async (url: string, init: RequestInit = {}, timeoutMs = 15000): Promise<Response> => {
    const C = (globalThis as any).AbortController;
    if (!C) {
        // Older RN runtimes may not support AbortController/AbortSignal.timeout.
        return fetch(url, init);
    }
    const controller = new C();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...init, signal: (init as any).signal || controller.signal } as any);
    } finally {
        clearTimeout(id);
    }
};

type MlPredictResult = {
    path: { lat: number; lon: number; address?: string }[];
    predictions?: any[];
    raw: any;
    error?: boolean;
    message?: string;
};

const mlPredictMovement = async (mlUrl: string, payload: any): Promise<MlPredictResult> => {
    try {
        const endpoint = `${String(mlUrl).replace(/\/+$/, '')}/predict-movement`;
        const body = safeObject(payload);
        const res = await fetchWithTimeout(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify(body),
        } as any, 60000);

        let data: any = null;
        try {
            data = await (res as any).json();
        } catch {
            data = null;
        }
        console.log("ML API Response:", data);

        if (!res.ok) {
            return {
                path: [],
                raw: data || {},
                error: true,
                message: `Prediction failed (HTTP ${res.status})`,
            };
        }

        const raw = data || {};
        const positions =
            Array.isArray(raw?.path) ? raw.path :
            Array.isArray(raw?.predictions) ? raw.predictions :
            (Array.isArray(raw?.predicted_positions) ? raw.predicted_positions : []);

        const path = Array.isArray(positions)
            ? positions.map((p: any) => ({
                lat: Number(p?.lat ?? p?.[0]),
                lon: Number(p?.lon ?? p?.[1]),
                address: typeof p?.address === 'string' ? p.address : undefined,
            })).filter((p: any) => Number.isFinite(p.lat) && Number.isFinite(p.lon))
            : [];

        return { path, raw, predictions: Array.isArray(raw?.predictions) ? raw.predictions : undefined };
    } catch (e: any) {
        logger.warn('[ML] predict failed', e);
        return { path: [], raw: {}, error: true, message: 'Prediction failed' };
    }
};

type MlRiskResult = {
    risk: string | null;
    probability: number | null;
    raw: any;
    error?: boolean;
    message?: string;
};

export const predictRisk = async (payload: {
    animal: string;
    latitude: number;
    longitude: number;
    distance_km?: number;
    sighting_date?: string;
    user_lat?: number;
    user_lon?: number;
}): Promise<MlRiskResult> => {
    const mlUrl = getMlServiceUrl();
    if (!mlUrl) return { risk: null, probability: null, raw: {}, error: true, message: 'ML service not configured' };

    try {
        const endpoint = `${String(mlUrl).replace(/\/+$/, '')}/predict-risk`;
        const body = safeObject(payload);
        const res = await fetchWithTimeout(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify(body),
        } as any, 60000);

        let data: any = null;
        try {
            data = await (res as any).json();
        } catch {
            data = null;
        }
        console.log("ML API Response:", data);

        if (!res.ok) {
            return { risk: null, probability: null, raw: data || {}, error: true, message: `Risk prediction failed (HTTP ${res.status})` };
        }

        const raw = data || {};
        const risk = typeof raw?.risk === 'string' ? String(raw.risk) : null;
        const probability = Number.isFinite(raw?.probability) ? Number(raw.probability) : null;
        return { risk, probability, raw };
    } catch (e: any) {
        logger.warn('[ML] predictRisk failed', e);
        return { risk: null, probability: null, raw: {}, error: true, message: 'Risk prediction failed' };
    }
};

/** Never return undefined — callers may use Object.keys / spread safely. */
const normalizeApiPayload = (raw: any): any => {
    if (raw === undefined || raw === null) {
        return { status: 'ok' as const, data: [] };
    }
    return raw;
};

// Native-safe fetch implementation with robust retry and timeout logic
const nativeFetch = async (
    url: string, 
    options: RequestInit = {}, 
    retries = MAX_FETCH_RETRIES, 
    backoff = 5000
): Promise<any> => {
    const timeout = 90000; // 90 seconds timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const mergedOptions: RequestInit = {
        ...options,
        signal: options.signal || controller.signal,
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            ...(options.headers || {}),
        },
    };

    try {
        const attempt = 6 - retries;
        logger.info(`[API] REQUEST: ${mergedOptions.method || 'GET'} ${url} (Attempt ${attempt}/5)`);
        if (mergedOptions.body) {
            logger.debug(`[API] PAYLOAD: ${mergedOptions.body}`);
        }

        const response = await fetch(url, mergedOptions);
        clearTimeout(timeoutId);

        logger.info(`[API] RESPONSE STATUS: ${response.status} (${url.split('?')[0]})`);

        if (!response.ok) {
            // Retry on 502 (Bad Gateway), 503 (Service Unavailable), 504 (Gateway Timeout), or 408 (Request Timeout)
            const shouldRetry = [408, 502, 503, 504].includes(response.status);
            
            if (retries > 1 && shouldRetry) {
                logger.warn(`[API] Server error ${response.status}. Retrying in ${backoff}ms... (${retries - 1} attempts left)`);
                await new Promise(resolve => setTimeout(resolve, backoff));
                return nativeFetch(url, options, retries - 1, backoff * 1.5);
            }
            
            const errorBody = await response.text().catch(() => 'No error body');
            logger.error(`[API] Request failed definitively: ${response.status} - ${errorBody}`);
            
            return { 
                status: 'error' as const,
                error: true, 
                statusCode: response.status,
                message: `Server Error: ${response.status}`,
                data: [] as any[]
            };
        }

        const text = await response.text();
        if (!text) {
            logger.warn(`[API] Received empty response body from ${url}`);
            const safe = { status: 'ok' as const, data: [] as any[], message: undefined as string | undefined };
            console.log("API Response:", safe);
            return safe;
        }

        let data: any;
        try {
            data = JSON.parse(text);
        } catch (parseErr) {
            logger.warn(`[API] Invalid JSON from ${url}`, parseErr);
            const safe = {
                status: 'error' as const,
                error: true,
                data: [] as any[],
                message: 'Invalid JSON response',
            };
            console.log("API Response:", safe);
            return safe;
        }
        logger.info(`[API] SUCCESS: ${url.split('?')[0]}`);
        const out = normalizeApiPayload(data);
        console.log("API Response:", out);
        return out;
    } catch (error: any) {
        clearTimeout(timeoutId);
        const isAbort = error.name === 'AbortError' || error.message?.includes('Aborted');
        const isNetwork = error.message?.includes('Network request failed') || error.message?.includes('Failed to fetch');
        
        // Retry on network errors or timeouts (Render cold starts)
        if (retries > 1 && (isNetwork || isAbort)) {
             const errorType = isAbort ? 'TIMEOUT' : 'NETWORK';
             logger.warn(`[API] ${errorType} error: ${error.message}. Retrying in ${backoff}ms... (${retries - 1} attempts left)`);
             await new Promise(resolve => setTimeout(resolve, backoff));
             return nativeFetch(url, options, retries - 1, backoff * 1.5);
        }
        
        if (isAbort) {
            logger.error(`[API] FINAL TIMEOUT: Request to ${url} failed after multiple attempts`);
        } else {
            logger.error(`[API] FINAL CRITICAL ERROR: ${url}`, error);
        }
        
        const safe = { 
            status: 'error' as const,
            error: true, 
            message: isAbort ? "Connection timed out. The server might be waking up. Please try again." : (error.message || "Network connection failed."),
            data: [] as any[]
        };
        console.log("API Response:", safe);
        return safe;
    }
};

/**
 * Wake up the Render backend if it is sleeping.
 * Should be called before any major ML processing request.
 */
export const wakeUpBackend = async (): Promise<boolean> => {
    const baseUrl = getApiBaseUrl();
    const mlUrl = getMlServiceUrl();
    if (!baseUrl) return false;
    
    try {
        logger.info("[API] Waking up services...");
        const pings = [
            // Backend home ping
            fetchWithTimeout(baseUrl.replace(/\/api$/, ''), { method: 'GET' } as any, 15000),
        ];
        
        if (mlUrl) {
            // ML health ping
            pings.push(fetchWithTimeout(`${mlUrl}/health`, { method: 'GET' } as any, 15000));
        }

        const results = await Promise.allSettled(pings);
        return results[0].status === 'fulfilled';
    } catch (e) {
        logger.warn("[API] Service wake-up ping failed", e);
        return false;
    }
};

// Cache for safe places to avoid redundant Overpass calls
const safePlacesCache: Record<string, { data: SafePlace[], timestamp: number }> = {};
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

export const findSafePlacesAlongRoute = async (routePath: [number, number][]): Promise<SafePlace[]> => {
    const baseUrl = getApiBaseUrl();
    if (!baseUrl || routePath.length === 0) return [];

    const buffer = 0.08; // Increased buffer to ~9km to catch more places
    let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
    routePath.forEach(([lat, lon]) => {
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
    });

    // Regional Constraint: Restrict bounding box to South India
    const finalMinLat = Math.max(SOUTH_INDIA_BOUNDS.minLat, minLat - buffer);
    const finalMaxLat = Math.min(SOUTH_INDIA_BOUNDS.maxLat, maxLat + buffer);
    const finalMinLon = Math.max(SOUTH_INDIA_BOUNDS.minLon, minLon - buffer);
    const finalMaxLon = Math.min(SOUTH_INDIA_BOUNDS.maxLon, maxLon + buffer);

    if (finalMinLat >= finalMaxLat || finalMinLon >= finalMaxLon) {
        logger.warn("[SafePlaces] Route is outside South India bounds.");
        return [];
    }

    const bbox = `${finalMinLat.toFixed(3)},${finalMinLon.toFixed(3)},${finalMaxLat.toFixed(3)},${finalMaxLon.toFixed(3)}`;
    
    // Check cache
    const now = Date.now();
    if (safePlacesCache[bbox] && (now - safePlacesCache[bbox].timestamp < CACHE_TTL)) {
        logger.debug(`[SafePlaces] Returning cached results for bbox: ${bbox}`);
        return safePlacesCache[bbox].data;
    }

    // Updated Overpass query: ONLY Police Stations and Forest Offices
    const query = `
        [out:json][timeout:30];
        (
          node["amenity"="police"](${bbox});
          way["amenity"="police"](${bbox});
          node["office"="forestry"](${bbox});
          way["office"="forestry"](${bbox});
        );
        out center;
    `;
    const url = `${baseUrl}/overpass?data=${encodeURIComponent(query)}`;

    try {
        const data = await nativeFetch(url, { method: 'GET' }, 2, 4000);
        const elements = Array.isArray(data?.elements) ? data.elements : [];
        if (elements.length > 0) {
            const SAFE_PLACE_ROUTE_RADIUS_KM = 3; // 3km = 3000m
            
            const items = elements.map((el: any): SafePlace => {
                const center = el.center || { lat: el.lat, lon: el.lon };
                const tags = el.tags || {};
                
                let type: 'police' | 'ranger' = 'ranger';
                if (tags.amenity === 'police') type = 'police';
                else if (tags.office === 'forestry') type = 'ranger'; // Using ranger as internal key for forestry

                return {
                    id: el.id,
                    lat: center.lat,
                    lon: center.lon,
                    type: type,
                    name: tags.name || (
                        type === 'police' ? 'Police Station' : 'Forest Office'
                    ),
                    contact: tags.phone || tags['contact:phone'] || tags.operator || tags.website,
                    address: tags['addr:street'] ? `${tags['addr:street']} ${tags['addr:housenumber'] || ''}`.trim() : undefined,
                };
            }).filter((p: SafePlace) => {
                if (!p.lat || !p.lon) return false;
                
                // Proximity Filter: Only return safe places within 3km of the route
                const distToRoute = calculateMinDistanceToPolyline({ lat: p.lat, lon: p.lon }, routePath);
                return distToRoute <= SAFE_PLACE_ROUTE_RADIUS_KM;
            });
            
            logger.info(`[SafePlaces] Found ${items.length} safe locations near route (3km radius).`);
            console.log("Safe places near route:", items.length);
            
            const priorityMap: Record<string, number> = { 'police': 0, 'ranger': 1 };
            const centerPoint = { lat: (minLat + maxLat) / 2, lon: (minLon + maxLon) / 2 };
            const sorted = items.sort((a: SafePlace, b: SafePlace) => {
                const pa = priorityMap[a.type] || 99;
                const pb = priorityMap[b.type] || 99;
                if (pa !== pb) return pa - pb;
                const da = distKm(centerPoint, { lat: a.lat, lon: a.lon });
                const db = distKm(centerPoint, { lat: b.lat, lon: b.lon });
                return da - db;
            });

            // Cache the result
            safePlacesCache[bbox] = { data: sorted, timestamp: now };
            return sorted;
        }
        return [];
    } catch (error: any) {
        logger.error("Failed to find safe places gracefully", {
            message: error.message,
            url: url
        });
        return [];
    }
};

export const findSafePlacesNear = async (lat: number, lon: number, radiusKm: number = 5): Promise<SafePlace[]> => {
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) return [];
    const buffer = radiusKm / 111;
    const minLat = lat - buffer;
    const maxLat = lat + buffer;
    const minLon = lon - buffer;
    const maxLon = lon + buffer;
    const bbox = `${minLat},${minLon},${maxLat},${maxLon}`;
    
    // Consistent with along-route search: ONLY Police and Forestry
    const query = `
        [out:json][timeout:60];
        (
          node["amenity"="police"](${bbox});
          way["amenity"="police"](${bbox});
          node["office"="forestry"](${bbox});
          way["office"="forestry"](${bbox});
        );
        out center;
    `;
    const url = `${baseUrl}/overpass?data=${encodeURIComponent(query)}`;
    try {
        const data = await nativeFetch(url, { method: 'GET' }, 2, 4000);
        const elements = Array.isArray(data?.elements) ? data.elements : [];
        if (elements.length > 0) {
            return elements.map((el: any): SafePlace => {
                const center = el.center || { lat: el.lat, lon: el.lon };
                const tags = el.tags || {};
                let type: 'police' | 'ranger' = 'ranger';
                if (tags.amenity === 'police') type = 'police';
                return {
                    id: el.id,
                    lat: center.lat,
                    lon: center.lon,
                    type,
                    name: tags.name || (type === 'police' ? 'Police Station' : 'Forest Office'),
                    contact: tags.phone || tags['contact:phone'] || tags.operator,
                };
            });
        }
        return [];
    } catch (error) {
        logger.error("Failed to find safe places near location gracefully", error);
        return [];
    }
};

export const getWeatherData = async (lat: number, lon: number): Promise<WeatherData | null> => {
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) return null;

    const url = `${baseUrl}/weather?lat=${lat}&lon=${lon}`;
    try {
        const data = await nativeFetch(url, { method: 'GET' }, 1, 3000);
        if (!data || data.error || data.status === 'error' || !data.current_weather) {
            return null;
        }
        return {
            temperature: data.current_weather.temperature,
            weatherCode: data.current_weather.weathercode,
            windSpeed: data.current_weather.windspeed,
            isDay: data.current_weather.is_day
        };
    } catch (error: any) {
        logger.warn("Weather degraded or unavailable", { message: error.message });
        return null;
    }
};

export const getRainViewerTimestamps = async (): Promise<any> => {
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) return null;

    const url = `${baseUrl}/rainviewer`;
    try {
        const data = await nativeFetch(url, { method: 'GET' }, 1, 3000);
        if (data && !data.error && data.status !== 'error') {
            return data;
        }
        return null;
    } catch (error) {
        logger.error("Failed to fetch RainViewer timestamps", error);
        return null;
    }
};

export const checkBackendHealth = async (): Promise<boolean> => {
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) return false;

    const url = `${baseUrl}/health`;
    try {
        const response = await nativeFetch(url, { method: 'GET' }, 2, 5000);
        return !!response && response.status === 'ok';
    } catch (error: any) {
        logger.error('Backend health check failed definitively', error);
        return false;
    }
};

export const searchLocations = async (query: string): Promise<Location[]> => {
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) {
        throw new Error("API_BASE_URL is not configured.");
    }

    const url = `${baseUrl}/search-locations?q=${encodeURIComponent(query)}`;
    
    try {
        const response = await nativeFetch(url, { method: 'GET' }, 2, 3000);
        if (Array.isArray(response)) {
            return response
                .map((item: any) => ({
                    lat: parseFloat(item.lat),
                    lon: parseFloat(item.lon),
                    name: item.display_name
                }))
                .filter(loc => isWithinSouthIndia(loc.lat, loc.lon));
        }
    } catch (error) {
        logger.warn(`Backend location search failed for "${query}", attempting direct OSM fallback`, error);
    }

    try {
        const osmUrl = `https://nominatim.openstreetmap.org/search?format=json&countrycodes=in&limit=10&q=${encodeURIComponent(query)}`;
        const res = await fetchWithTimeout(osmUrl, { 
            headers: { 
                'Accept': 'application/json',
                'User-Agent': 'WildlifeSafetyApp/1.0 (Contact: hemac@example.com)'
            },
        } as any);
        if (!(res as any)?.ok) return [];
        const data: any = await (res as any).json();
        if (!Array.isArray(data)) return [];
        return data
            .map((item: any) => ({
                lat: parseFloat(item.lat),
                lon: parseFloat(item.lon),
                name: item.display_name
            }))
            .filter((loc: Location) => isWithinSouthIndia(loc.lat, loc.lon));
    } catch (e: any) {
        logger.error(`Location search fallback (OSM) failed for "${query}"`, e);
        if (e.message?.includes('Network request failed')) {
            // Throwing a more descriptive error for the UI
            throw new Error(`Internet connection required for location search. (Query: ${query})`);
        }
        return [];
    }
};

export const reverseGeocode = async (lat: number, lon: number): Promise<string> => {
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) return 'Unknown forest area';

    const url = `${baseUrl}/reverse-geocode?lat=${lat}&lon=${lon}`;
    try {
        const response = await nativeFetch(url);
        // Requirement: Treat all errors as success, fallback to safe string
        return response?.display_name || 'Unknown forest area';
    } catch (error: any) {
        logger.error("Unexpected failure in reverseGeocode", error);
        return 'Unknown forest area';
    }
};

export const getAnimalSightings = async (scientificName: string, location: Location, radiusKm: number): Promise<Sighting[]> => {
    const baseUrl = getApiBaseUrl();

    if (!baseUrl) {
        logger.error('API_BASE_URL is not configured');
        return [];
    }

    try {
        logger.debug(`Fetching sightings for ${scientificName} via backend`);
        
        const params = new URLSearchParams({
            scientificName,
            lat: location.lat.toString(),
            lon: location.lon.toString(),
            radius: radiusKm.toString()
        });
        
        const url = `${baseUrl}/sightings?${params.toString()}`;
        const data = await nativeFetch(url, { method: 'GET' }, 2, 4000);

        const list = Array.isArray(data) ? data : [];
        if (list.length > 0) {
            return list.map((s: any) => ({
                id: s.id,
                lat: Number(s.lat),
                lon: Number(s.lon),
                timestamp: s.timestamp,
                animal: s.animal,
                scientific: s.scientific,
                source: s.source
            }));
        }
        return [];
    } catch (error) {
        logger.error(`Failed to fetch sightings for ${scientificName}`, error);
        return [];
    }
};

export const fetchSightingDensity = async (animalSightings: Sighting[], scientificName: string): Promise<any> => {
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) return null;

    // Use /api/sightings/analyze if available, otherwise proxy through backend
    const endpoint = `${baseUrl}/sightings/analyze`;

    try {
        const response = await nativeFetch(endpoint, {
                    method: 'POST',
                    body: JSON.stringify({
                        animalSightings,
                        scientificName
                    })
                }, 2, 4000);
        
        if (!response || response.error) return null;
        return response;
    } catch (error) {
        logger.warn(`Sighting density analysis failed for ${scientificName}`, error);
        return null;
    }
};

/**
 * --- NEW: LSTM Movement Prediction API ---
 * Calls the backend or ML service directly to get future movement predictions.
 */
export const predictMovement = async (
    animal: string, 
    userLocation: { lat: number, lon: number }, 
    recentPath: [number, number][], 
    kFuture: number = 3,
    wildlifeLocation?: { lat: number, lon: number }
): Promise<{ 
    animal: string, 
    path: { lat: number, lon: number, address: string }[], 
    risk_level: string, 
    risk?: string,
    probability?: number,
    safety_override: boolean,
    distance_to_user_km?: number,
    status?: string,
    message?: string,
    degraded?: boolean
} | null> => {
    const baseUrl = getApiBaseUrl();
    const mlUrl = getMlServiceUrl();
    
    // Default safe response if everything fails
    const safeDefault = {
        animal,
        path: [],
        risk_level: "Medium",
        risk: undefined as any,
        probability: undefined as any,
        safety_override: false,
        distance_to_user_km: 0,
        status: 'degraded',
        degraded: true,
        message: "Prediction engine temporarily unavailable"
    };

    // TRY ML SERVICE DIRECTLY FIRST
    if (mlUrl) {
        try {
            const mlPayload = { animal, trajectory: recentPath, steps: kFuture };
            logger.info(`[ML] Requesting movement prediction from ML API: ${String(mlUrl).replace(/\/+$/, '')}/predict-movement`);
            logger.debug(`[ML] Payload: ${JSON.stringify(mlPayload)}`);

            const mlResult = await mlPredictMovement(mlUrl, mlPayload);
            
            const rawPath = Array.isArray(mlResult.path) && mlResult.path.length > 0 
                ? mlResult.path 
                : Array.isArray((mlResult.raw as any)?.predictions) && (mlResult.raw as any).predictions.length > 0 
                    ? (mlResult.raw as any).predictions 
                    : Array.isArray(mlResult.predictions) && (mlResult.predictions as any).length > 0 
                        ? mlResult.predictions 
                        : null;

            if (!mlResult.error && rawPath) {
                logger.info("[ML] Direct ML prediction successful");
                let path = rawPath.map((p: any) => ({
                    lat: Number(p?.lat),
                    lon: Number(p?.lon),
                    address: String(p?.address || 'Wildlife corridor'),
                }));
                try {
                    const names = await Promise.all(path.map((p: any) => reverseGeocode(p.lat, p.lon)));
                    path = path.map((p: any, i: number) => ({ ...p, address: String(names[i] || p.address || 'Wildlife corridor') }));
                } catch {}

                // Call Random Forest risk prediction using first predicted point
                let riskLevel = "Medium";
                let riskValue: string | undefined = undefined;
                let probabilityValue: number | undefined = undefined;

                try {
                    const riskPayload = {
                        animal,
                        latitude: rawPath[0].lat ?? rawPath[0][0],
                        longitude: rawPath[0].lon ?? rawPath[0][1],
                        user_lat: userLocation.lat,
                        user_lon: userLocation.lon,
                    };
                    const riskResult = await predictRisk(riskPayload as any);
                    if (riskResult && !riskResult.error) {
                        riskValue = typeof riskResult.risk === 'string' ? String(riskResult.risk) : undefined;
                        riskLevel = String(riskResult.risk || 'Medium');
                        probabilityValue = Number.isFinite(riskResult.probability) ? Number(riskResult.probability) : undefined;
                        logger.info(`[ML] ✅ Random Forest risk result — risk: ${riskValue}, probability: ${probabilityValue}`);
                    }
                } catch (e) {
                    logger.warn("[ML] Risk prediction failed, using default Medium", e);
                }

                return {
                    animal,
                    path,
                    risk_level: riskLevel,
                    risk: riskValue,
                    probability: probabilityValue,
                    safety_override: false,
                    status: 'ok',
                } as any;
            }
        } catch (e) {
            logger.warn("[ML] Direct ML prediction failed, falling back to backend proxy", e);
        }
    }

    if (!baseUrl) return safeDefault;
    const url = `${baseUrl}/predict-movement`;

    try {
        logger.info(`[API] Requesting movement prediction from backend: ${url}`);
        const response = await nativeFetch(url, {
            method: 'POST',
            body: JSON.stringify({
                animal,
                user_location: userLocation,
                recent_path: recentPath,
                k_future: kFuture,
                wildlife_location: wildlifeLocation
            })
        }, 5, 5000);
        console.log("API Response:", response);

        if (!response || response.error) {
            return safeDefault;
        }

        if (String((response as any)?.status || '').toLowerCase() === 'no_prediction') {
            return {
                ...safeDefault,
                message: String((response as any)?.message || 'No movement prediction available'),
                status: 'no_prediction',
            };
        }

        // Normalize backend formats...
        if (Array.isArray(response?.predicted_locations)) {
            const path = response.predicted_locations
                .slice(0, 3)
                .map((p: any) => ({
                    lat: Number(p.lat),
                    lon: Number(p.lon),
                    address: String(p.location || 'Unknown wildlife area')
                }))
                .filter((p: any) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
            if (path.length === 0) {
                return {
                    ...safeDefault,
                    message: 'No predicted path returned',
                    status: 'no_prediction',
                };
            }
            return {
                animal,
                path,
                risk_level: response.risk_level || "Medium",
                risk: typeof response?.risk === 'string' ? String(response.risk) : undefined,
                probability: Number.isFinite(response?.probability) ? Number(response.probability) : undefined,
                safety_override: !!response.safety_override,
                distance_to_user_km: response.distance_to_user_km,
                status: 'ok',
                degraded: false,
                message: undefined
            } as any;
        }

        if (Array.isArray(response?.path)) {
            const path = response.path.map((p: any) => ({
                lat: Number(p.lat),
                lon: Number(p.lon),
                address: String(p.address || '')
            }));
            return {
                animal,
                path,
                risk_level: response.risk_level || "Medium",
                risk: typeof response?.risk === 'string' ? String(response.risk) : undefined,
                probability: Number.isFinite(response?.probability) ? Number(response.probability) : undefined,
                safety_override: !!response.safety_override,
                distance_to_user_km: response.distance_to_user_km,
                status: 'ok',
                degraded: false,
                message: undefined
            } as any;
        }

        return safeDefault;
    } catch (error: any) {
        logger.error("Failed to predict movement definitively", error);
        return safeDefault;
    }
};

/**
 * Route Risk Prediction API
 * Evaluates wildlife risk for a polyline route using backend hybrid risk logic.
 */
export const predictRouteRisk = async (
    routeCoords: Array<[number, number]>
): Promise<{ routeRisk: 'LOW' | 'MEDIUM' | 'HIGH' | string; probability: number; animalsDetected?: string[]; predictionSources?: string[] } | null> => {
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) return null;
    const url = `${baseUrl}/predict-wildlife-risk`;
    try {
        const body = { route_coordinates: routeCoords.map(([lat, lon]) => [Number(lat), Number(lon)]) };
        const res = await nativeFetch(url, {
            method: 'POST',
            body: JSON.stringify(body)
        }, 2, 4000);
        console.log("API Response:", res);
        if (!res || res.error) return null;
        return res as any;
    } catch (e) {
        logger.error('predictRouteRisk failed', e);
        return null;
    }
};

export const getAIGuideResponse = async (
    history: ChatMessage[],
    images?: { mimeType: string; data: string }[],
    context?: string
): Promise<string> => {
    try {
        const baseUrl = getApiBaseUrl();
        if (!baseUrl) return "Backend server not connected.";

        const speciesList = Object.entries(ANIMALS || {}).map(([sci, info]) => `${info.common} (${sci})`).join(', ');
        const sys = `You are the AI Wildlife Safety Guide for the Wildlife Safety app.
Project species: ${speciesList}.
${context ? `IMPORTANT: Use this real-time data from the map to answer the user's questions: ${context}` : 'The map currently shows no recent sightings.'}
Respond using these sections:
- Risk Summary: Low/Medium/High and 1–2 relevant species.
- Movement Forecast: short forecast near the user.
- Nearby Species: 2–3 bullets with behavior and risk.
- Safety Actions: 4–6 steps tailored to walk/car/bike.
- Route Tip: detours or timing to reduce risk.
Rules:
- Prioritize using the "Current Context" data provided above.
- Only reference the above species; if uncertain, state uncertainty.
- Never provide poaching/hunting/trapping instructions.
- Be concise and local.
- Avoid markdown (no asterisks, no bolding, no code fences) as it will not render correctly in the app. Use plain text formatting.`;

        const data = await nativeFetch(`${baseUrl}/gemini/chat`, {
            method: 'POST',
            body: JSON.stringify({
                history: (history || []).slice(-10), // Send last 10 messages for context
                images: images || [],
                systemPrompt: sys
            })
        }, 2, 4000);

        if (!data || data.error) {
            throw new Error(data?.message || 'Server error');
        }

        return data.text || "I'm sorry, I couldn't generate a response.";
    } catch (error: any) {
        logger.error('AI Guide error', error);
        
        // Fallback for when backend is down or API fails
        const last = (history || []).filter(h => h.role === 'user').slice(-1)[0]?.text?.toLowerCase() || '';
        if (last.includes('elephant')) return "Elephants are common here. Stay 50m away, avoid noise, and stay in your vehicle.";
        if (last.includes('tiger')) return "Tiger spotted recently. Avoid night travel and stay inside your vehicle at all times.";
        
        return "I'm having trouble connecting to the AI guide. Please ensure the backend server is running and your Gemini API key is set in the .env file.";
    }
};

export const analyzeReportImage = async (image: { mimeType: string; data: string }): Promise<{ common?: string; scientific?: string; risk?: string; summary?: string; confidence?: number; behavior?: string; circumstance?: string; distance_advice?: string; actions?: string[]; emergency?: string[] } | null> => {
    try {
        const baseUrl = getApiBaseUrl();
        if (!baseUrl) return null;
        console.log("DEBUG:", ANIMALS);
        const species = Object.keys(safeObject<any>(ANIMALS));
        const prompt = `Identify the animal species in this photo from the allowed list only: ${species.join(', ')}.`;
        const url = `${baseUrl}/gemini/analyze-image`;
        const parsed = await nativeFetch(url, {
            method: 'POST',
            body: JSON.stringify({ mimeType: image?.mimeType, data: image?.data, prompt })
        }, 1, 3000);
        
        if (!parsed || parsed.error) return null;
        
        console.log("DEBUG:", ANIMALS);
        const allowedScientific = Object.keys(safeObject<any>(ANIMALS));
        const allowedCommon = allowedScientific.map(sci => (ANIMALS as any)[sci]?.common || 'Unknown');
        let sci: string | undefined = parsed.scientific ? canonicalScientific(String(parsed.scientific)) : undefined;
        let com: string | undefined = parsed.common;
        if (sci && allowedScientific.includes(sci)) {
            com = (ANIMALS as any)[sci]?.common;
        } else if (com) {
            const lc = String(com).toLowerCase();
            const matchIdx = allowedCommon.findIndex(c => c.toLowerCase() === lc || lc.includes(c.toLowerCase()));
            if (matchIdx >= 0) {
                sci = allowedScientific[matchIdx];
                com = allowedCommon[matchIdx];
            } else {
                sci = 'Unknown';
                com = 'Unknown';
            }
        } else {
            sci = 'Unknown';
            com = 'Unknown';
        }
        const risk = ['Low','Medium','High'].includes(parsed.risk) ? parsed.risk : 'Medium';
        const summary = typeof parsed.summary === 'string' ? parsed.summary : (com === 'Unknown' ? 'Uncertain identification from the photo.' : `Likely ${com}.`);
        const confidence = Number.isFinite(parsed.confidence) ? Math.max(0, Math.min(1, Number(parsed.confidence))) : undefined;
        const behavior = typeof parsed.behavior === 'string' ? parsed.behavior : undefined;
        const circumstance = typeof parsed.circumstance === 'string' ? parsed.circumstance : undefined;
        const distance_advice = typeof parsed.distance_advice === 'string' ? parsed.distance_advice : undefined;
        const actions = Array.isArray(parsed.actions) ? parsed.actions.filter((a: any) => typeof a === 'string') : undefined;
        const emergency = Array.isArray(parsed.emergency) ? parsed.emergency.filter((a: any) => typeof a === 'string') : undefined;
        return { common: com, scientific: sci, risk, summary, confidence, behavior, circumstance, distance_advice, actions, emergency };
    } catch {
        return null;
    }
};

export const deleteUserReport = async (reportId: string): Promise<any> => {
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) return null;
    const url = `${baseUrl}/reports/${reportId}`;
    const headers: Record<string, string> = {};
    try {
        const uid = auth.currentUser?.uid || '';
        const email = auth.currentUser?.email || '';
        headers['x-user-id'] = uid;
        headers['x-user-email'] = email;
        const token = await auth.currentUser?.getIdToken?.();
        if (token) headers['Authorization'] = `Bearer ${token}`;
    } catch {}
    const res = await nativeFetch(url, { method: 'DELETE', headers }, 1, 3000);
    return res || null;
};
// Helper to process and balance wildlife data
const processWildlifeList = async (list: any[]): Promise<any[]> => {
    if (!Array.isArray(list) || list.length === 0) return [];

    // Filter by South India bounds and valid species
    const regionalList = list.filter(r => r && typeof r === 'object').filter(r => {
        const lat = parseFloat(String(r.lat));
        const lon = parseFloat(String(r.lon));
        const sci = canonicalScientific(r.scientific_name);
        return isWithinSouthIndia(lat, lon) && !!ANIMALS[sci];
    });

    if (regionalList.length === 0) return [];

    // Simplify: Sort by date and return the list (no balancing or arbitrary caps as per "no other logic")
    const sortedData = regionalList
        .sort((a, b) => new Date(b.eventDate).getTime() - new Date(a.eventDate).getTime());

    return await Promise.all(sortedData.map(async (record: { animal: string; scientific_name: string; lat: number; lon: number; eventDate: string; emoji?: string; image_url?: string }) => {
        const sci = canonicalScientific(record.scientific_name);
        const animalInfo = ANIMALS[sci] || { emoji: '🐾' };
        const lat = parseFloat(String(record.lat));
        const lon = parseFloat(String(record.lon));
        let address = record.eventDate;
        try {
            const addr = await reverseGeocode(lat, lon);
            if (addr && addr !== 'Address not found') address = addr;
        } catch {
            /* ignore */
        }
        
        // Enforce emoji from constants if backend sends warning icon or missing
        let emoji = record.emoji;
        if (!emoji || emoji === '⚠️' || emoji === '?' || emoji.length > 4) {
            emoji = animalInfo.emoji;
        }

        return {
            id: `${sci}-${record.eventDate}-${lat}`,
            name: animalInfo.common || record.animal,
            scientificName: sci,
            emoji: emoji,
            lat,
            lon,
            date: record.eventDate,
            address,
            type: 'sighting' as const,
            image_url: record.image_url || undefined,
        };
    }));
};

/** Normalize API body to an array (handles raw arrays or wrapped payloads). */
function arrayFromApiPayload(data: any): any[] {
    if (data == null) return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data?.reports)) return data.reports;
    if (Array.isArray(data?.wildlife)) return data.wildlife;
    if (Array.isArray(data?.sightings)) return data.sightings;
    if (Array.isArray(data?.items)) return data.items;
    return [];
}

// --- TASK 3: Fetch Recent Wildlife from Backend ---
export const fetchRecentWildlife = async (startDate?: string, endDate?: string): Promise<any[]> => {
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) {
        logger.error("API_BASE_URL is not configured.");
        return [];
    }
    
    let url = `${baseUrl}/wildlife/recent`;
    if (startDate && endDate) {
        url += `?startDate=${startDate}&endDate=${endDate}`;
    }

    try {
        // High retry count for initial cold start fetch (5 retries, 8s backoff)
        const data = await nativeFetch(url, { method: 'GET' }, 5, 8000);
        let list: any[] = arrayFromApiPayload(data);
        
        // Only fallback if list is completely empty or fetch failed (and not in historical mode)
        if (!startDate && (list.length === 0 || data?.status === 'degraded' || data?.status === 'error' || data?.error)) {
            logger.warn("[API] fetchRecentWildlife returned degraded/empty data. Using static fallback.");
            list = Array.isArray(wildlifeRecent) ? wildlifeRecent : [];
        }
        
        return await processWildlifeList(list);
    } catch (error) {
        logger.error("Error fetching recent wildlife", error);
        if (startDate) return []; // No fallback for historical mode
        return await processWildlifeList(Array.isArray(wildlifeRecent) ? wildlifeRecent : []);
    }
};

export const fetchWildlifeAll = async (): Promise<any[]> => {
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) return [];

    const now = Date.now();
    if (wildlifeAllCache && now - wildlifeAllCacheAt < 10 * 60 * 1000) {
        return wildlifeAllCache;
    }

    const url = `${baseUrl}/wildlife/all`;
    const res = await nativeFetch(url, { method: 'GET' }, 2, 5000);
    const list: any[] = Array.isArray(res) ? res : [];
    wildlifeAllCache = list;
    wildlifeAllCacheAt = now;
    return list;
};

export const fetchHistoricalPathPoints = async (
    speciesKey: string,
    limit = 5,
    anchor?: { lat: number; lon: number },
    radiusKm = 50
): Promise<[number, number][]> => {
    const list = await fetchWildlifeAll();
    if (!Array.isArray(list) || list.length === 0) return [];

    const key = String(speciesKey || '').trim();
    const keyLower = key.toLowerCase();
    const sciKey = canonicalScientific(key);
    const commonFromSci = (ANIMALS as any)[sciKey]?.common ? String((ANIMALS as any)[sciKey].common).toLowerCase() : '';

    const filtered = list.filter((r: any) => {
        const animal = String(r?.animal || '').trim().toLowerCase();
        const sci = canonicalScientific(String(r?.scientific_name || ''));
        if (sciKey && sci === sciKey) return true;
        if (commonFromSci && animal === commonFromSci) return true;
        if (keyLower && animal === keyLower) return true;
        return false;
    });

    const withCoords = filtered
        .filter((r: any) => r && Number.isFinite(Number(r?.lat)) && Number.isFinite(Number(r?.lon)));

    const nearby = (anchor && Number.isFinite(anchor.lat) && Number.isFinite(anchor.lon))
        ? withCoords.filter((r: any) => distKm({ lat: Number(r.lat), lon: Number(r.lon) }, { lat: anchor.lat, lon: anchor.lon }) <= radiusKm)
        : withCoords;

    const sorted = nearby.sort((a: any, b: any) => {
        const timeA = a?.eventDate ? new Date(a.eventDate).getTime() : 0;
        const timeB = b?.eventDate ? new Date(b.eventDate).getTime() : 0;
        return timeA - timeB;
    });

    const points: [number, number][] = sorted.map((r: any) => [Number(r.lat), Number(r.lon)]);
    if (points.length < limit) return [];
    return points.slice(-limit);
};

export const getRoute = async (start: Location, end: Location, mode: TravelMode = 'car'): Promise<Route | null> => {
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) return null;

    const url = `${baseUrl}/route/osrm?startLat=${start.lat}&startLon=${start.lon}&endLat=${end.lat}&endLon=${end.lon}&mode=${mode}`;

    try {
        const response = await nativeFetch(url, { method: 'GET' }, 2, 5000);

        if (!response || response.error === true || response.status === 'routing_failed') {
            return null;
        }

        let path: [number, number][] = [];

        const lineCoords = response?.geometry?.coordinates;
        if (Array.isArray(lineCoords) && lineCoords.length > 0) {
            path = lineCoords.map(
                (coord: number[]) => [Number(coord[1]), Number(coord[0])] as [number, number]
            );
        } else if (response?.path && Array.isArray(response.path)) {
            path = response.path.map((p: any) => {
                if (Array.isArray(p) && p.length >= 2) {
                    return [Number(p[0]), Number(p[1])] as [number, number];
                }
                return [Number(p.lat), Number(p.lon)] as [number, number];
            });
        }

        if (path.length === 0) {
            logger.warn('[getRoute] No geometry/path in OSRM response; cannot render polyline.');
            return null;
        }

        const distanceMeters = Number(response.distance ?? 0);
        const durationSeconds = Number(response.duration ?? 0);

        // Capture multi-mode ETAs if available from OSRM
        const modes = response?.modes || {};

        return {
            path,
            distanceKm: distanceMeters / 1000,
            durationMinutes: durationSeconds / 60,
            start,
            end,
            mode,
            modes: {
                drive: modes.drive?.eta || 'N/A',
                motorcycle: modes.motorcycle?.eta || 'N/A',
                walk: modes.walk?.eta || 'N/A'
            }
        };
    } catch (error) {
        logger.error("Failed to fetch route gracefully", error);
        return null;
    }
};

export const getAnimalsNearRoute = async (routePath: [number, number][]): Promise<{ riskZones: any[], riskySegments: any[] }> => {
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) return { riskZones: [], riskySegments: [] };
    
    const url = `${baseUrl}/animals/near-route`;
    
    // Convert [lat, lon] back to [lon, lat]
    const routeGeometry = routePath.map(p => [p[1], p[0]]);

    try {
        const response = await nativeFetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ routeGeometry })
        });
        
        if (response.error) throw new Error(response.message);
        
        const riskZones = response.riskZones || [];
        logger.debug(`[API] Found ${riskZones.length} animals near route.`);
        
        return {
            riskZones,
            riskySegments: response.riskySegments || []
        };
    } catch (error: any) {
        logger.error("Failed to fetch animals near route", error);
        return { riskZones: [], riskySegments: [] };
    }
};

export const predictAnimalPaths = async (
    sightingSets: { scientificName: string; sightings: Sighting[] }[]
): Promise<{ scientificName: string; predictions: { lat: number; lon: number }[] }[]> => {
    if (!Array.isArray(sightingSets) || sightingSets.length === 0) {
        return [];
    }

    const baseUrl = getApiBaseUrl();
    if (!baseUrl) {
        return sightingSets.map((s) => ({ scientificName: s.scientificName, predictions: [] }));
    }

    const endpoint = `${baseUrl}/predict-animal-paths`;

    try {
        const results = await Promise.all(
            sightingSets.map(async ({ scientificName, sightings }) => {
                if (!Array.isArray(sightings) || sightings.length === 0) {
                    return { scientificName, predictions: [] };
                }

                const animalSightings = sightings.map((sighting) => ({
                    lat: sighting.lat,
                    lng: sighting.lon,
                }));

                try {
                    const response = await nativeFetch(
                        endpoint,
                        {
                            method: 'POST',
                            body: JSON.stringify({ animalSightings, scientificName }),
                        },
                        5,
                        5000
                    );
                    console.log('API Response:', response);

                    if (!response || response.error) {
                        logger.warn(`Backend prediction failed for ${scientificName}`, response);
                        return { scientificName, predictions: [] };
                    }
                    if (response.success === false) {
                        logger.warn(`Backend prediction unsuccessful for ${scientificName}`, response);
                        return { scientificName, predictions: [] };
                    }

                    const predictions = (Array.isArray(response.predictedZones) ? response.predictedZones : []).map((zone: any) => ({
                        lat: zone.lat,
                        lon: zone.lng ?? zone.lon,
                    }));

                    return { scientificName, predictions };
                } catch (err) {
                    logger.error(`Prediction request failed for ${scientificName}`, err);
                    return { scientificName, predictions: [] };
                }
            })
        );

        return results;
    } catch (error) {
        logger.error('Failed to predict animal paths', error);
        return [];
    }
};

/** Uses OSRM (getRoute) only. No /api/safe-route; no straight-line fallback. */
export const getSafeNavigationRoute = async (start: Location, end: Location, mode: TravelMode): Promise<Route | null> => {
    const route = await getRoute(start, end);
    if (!route) return null;
    return { ...route, mode };
};
