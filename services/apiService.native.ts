import type { Sighting, Location, ChatMessage, Route, WeatherData, SafePlace, TravelMode } from '../types';
import { logger } from '../utils/logger';
import { API_BASE_URL, CONFIG } from '../config';
import { ANIMALS, canonicalScientific, isWithinSouthIndia, SOUTH_INDIA_BOUNDS } from '../constants';
import wildlifeRecent from '../wildlife_recent.json';
import { calculateMinDistanceToPolyline } from './geoService';
import { auth } from './firebase';

let wildlifeAllCache: any[] | null = null;
let wildlifeAllCacheAt = 0;

// Helper to get API Base URL
const getApiBaseUrl = (): string | null => {
    const url = API_BASE_URL;
    if (!url) {
        logger.warn('[API] API_BASE_URL is missing!');
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

// Native-safe fetch implementation (no CORS proxy needed)
const nativeFetch = async (url: string, options: RequestInit = {}, retries = 0, backoff = 2000): Promise<any> => {
    try {
        const mergedOptions = {
            ...options,
            headers: {
                'Accept': 'application/json',
                ...options.headers,
            },
        };

        const response = await fetch(url, mergedOptions);
        if (!response.ok) {
            logger.warn(`API request to ${url} returned status ${response.status}`);
            return { 
                status: 'degraded', 
                error: true, 
                statusCode: response.status,
                message: `HTTP Error ${response.status}`
            };
        }
        
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            const data = await response.json();
            logger.debug(`[API] Success from ${url.split('?')[0]}`);
            return data;
        } else {
            const text = await response.text();
            logger.debug(`[API] Success (text) from ${url.split('?')[0]}`);
            return { status: 'ok', data: text };
        }
    } catch (error: any) {
        const isAbort = error.name === 'AbortError' || error.message?.includes('Aborted');
        
        if (retries > 0 && !isAbort && (error.message.includes('Network request failed') || error.message.includes('network'))) {
             logger.warn(`Fetch failed (network). Retrying in ${backoff}ms... (${retries} attempts left)`, error);
             await new Promise(resolve => setTimeout(resolve, backoff));
             return nativeFetch(url, options, retries - 1, backoff * 2);
        }
        
        if (isAbort) {
            logger.error(`Critical fetch failure for ${url} - Request timed out (Aborted)`, { error: error.message });
        } else {
            logger.error(`Critical fetch failure for ${url}`, error);
        }
        
        return { 
            status: 'degraded', 
            error: true, 
            message: isAbort ? "Request timed out" : (error.message || "Network error")
        };
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
    const url = `${baseUrl}/api/overpass?data=${encodeURIComponent(query)}`;

    try {
        const data = await nativeFetch(url);
        if (data && data.elements) {
            const SAFE_PLACE_ROUTE_RADIUS_KM = 3; // 3km = 3000m
            
            const items = data.elements.map((el: any): SafePlace => {
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
    const url = `${baseUrl}/api/overpass?data=${encodeURIComponent(query)}`;
    try {
        const data = await nativeFetch(url);
        if (data && data.elements) {
            const items = data.elements.map((el: any): SafePlace => {
                const center = el.center || { lat: el.lat, lon: el.lon };
                const tags = el.tags || {};
                
                let type: 'police' | 'ranger' = 'ranger';
                if (tags.amenity === 'police') type = 'police';
                else if (tags.office === 'forestry') type = 'ranger';

                return {
                    id: el.id,
                    lat: center.lat,
                    lon: center.lon,
                    type: type,
                    name: tags.name || (
                        type === 'police' ? 'Police Station' : 'Forest Office'
                    ),
                };
            }).filter((p: SafePlace) => p.lat && p.lon);
            
            logger.info(`[SafePlaces] Found ${items.length} safe locations near user.`);
            
            const priority = (t: string) => {
                if (t === 'police') return 0;
                if (t === 'ranger') return 1;
                return 2;
            };
            const origin = { lat, lon };
            return items.sort((a: SafePlace, b: SafePlace) => {
                const pa = priority(a.type);
                const pb = priority(b.type);
                if (pa !== pb) return pa - pb;
                const da = distKm(origin, { lat: a.lat, lon: a.lon });
                const db = distKm(origin, { lat: b.lat, lon: b.lon });
                return da - db;
            });
        }
        return [];
    } catch (error: any) {
        logger.error("Failed to find safe places near gracefully", { message: error.message });
        return [];
    }
};

export const getWeatherData = async (lat: number, lon: number): Promise<WeatherData | null> => {
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) return null;

    const url = `${baseUrl}/api/weather?lat=${lat}&lon=${lon}`;
    try {
        const data = await nativeFetch(url);
        if (!data || data.status === 'degraded' || !data.current_weather) {
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

    const url = `${baseUrl}/api/rainviewer`;
    try {
        const data = await nativeFetch(url);
        if (data && data.status !== 'degraded') {
            return data;
        }
        return null;
    } catch (error) {
        logger.error("Failed to fetch RainViewer timestamps", error);
        return null;
    }
};

export const checkBackendHealth = async (retries = 3, delay = 5000): Promise<boolean> => {
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) return false;

    const url = `${baseUrl}/api/health`;
    
    for (let i = 0; i < retries; i++) {
        try {
            const controller = new AbortController();
            // Increase timeout to 45s for slower network environments and Render spin-up
            const timeoutId = setTimeout(() => {
                logger.warn(`[API] Health check timed out after 45s for ${url} (Attempt ${i + 1}/${retries})`);
                controller.abort();
            }, 45000);
            
            const response = await nativeFetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);
            
            if (!!response && response.status === 'ok') {
                return true;
            }
            
            logger.warn(`[API] Health check attempt ${i + 1}/${retries} failed or returned unexpected status`, response);
        } catch (error: any) {
            if (error.name === 'AbortError') {
                logger.error(`[API] Health check timed out (Aborted) - Attempt ${i + 1}/${retries}`, { url });
            } else {
                logger.error(`[API] Health check failed - Attempt ${i + 1}/${retries}`, error);
            }
        }
        
        if (i < retries - 1) {
            const waitTime = delay * Math.pow(2, i); // Exponential backoff: 5s, 10s, 20s
            logger.info(`[API] Retrying health check in ${waitTime}ms...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }
    
    return false;
};

export const searchLocations = async (query: string): Promise<Location[]> => {
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) {
        throw new Error("API_BASE_URL is not configured.");
    }

    const url = `${baseUrl}/api/search-locations?q=${encodeURIComponent(query)}`;
    
    try {
        const response = await nativeFetch(url);
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
        const res = await fetch(osmUrl, { 
            headers: { 'Accept': 'application/json' },
            signal: AbortSignal.timeout(10000) // 10s timeout for OSM
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

    const url = `${baseUrl}/api/reverse-geocode?lat=${lat}&lon=${lon}`;
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
        
        const url = `${baseUrl}/api/sightings?${params.toString()}`;
        const data = await nativeFetch(url);

        if (Array.isArray(data)) {
            return data.map((record: any) => ({
                lat: parseFloat(record.lat),
                lon: parseFloat(record.lon),
                image_url: record.image_url,
                date: record.eventDate,
            }));
        } else {
            logger.warn('Unexpected response format from backend sightings API');
            return [];
        }

    } catch (error: any) {
        logger.error(`Failed to get sightings for ${scientificName}`, error);
        // Return empty array instead of throwing, so the app doesn't crash
        return [];
    }
};

export const predictAnimalPaths = async (sightingSets: { scientificName: string, sightings: Sighting[] }[]): Promise<{ scientificName: string, predictions: { lat: number, lon: number }[] }[]> => {
    const baseUrl = getApiBaseUrl();

    if (!baseUrl) {
        logger.error('API_BASE_URL is not configured');
        return [];
    }

    const endpoint = `${baseUrl}/api/predict-animal-paths`;

    try {
        // Process each sighting set separately
        const results = await Promise.all(
            sightingSets.map(async ({ scientificName, sightings }) => {
                if (sightings.length === 0) {
                    return { scientificName, predictions: [] };
                }

                // Transform sightings to backend format: { lat, lon } -> { lat, lng }
                const animalSightings = sightings.map(sighting => ({
                    lat: sighting.lat,
                    lng: sighting.lon
                }));

                const response = await nativeFetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        animalSightings,
                        scientificName
                    })
                });

                if (!response || !response.success) {
                    logger.warn(`Backend prediction failed for ${scientificName}`, response);
                    return { scientificName, predictions: [] };
                }

                // Transform response: { lat, lng, risk } -> { lat, lon }
                const predictions = (response.predictedZones || []).map((zone: any) => ({
                    lat: zone.lat,
                    lon: zone.lng
                }));

                return { scientificName, predictions };
            })
        );

        return results;
    } catch (error: any) {
        logger.error('Failed to predict animal paths', error);
        return []; // Never throw
    }
};

/**
 * --- NEW: LSTM Movement Prediction API ---
 * Calls the backend to get future movement predictions based on recent path.
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
    safety_override: boolean,
    distance_to_user_km?: number,
    status?: string,
    message?: string,
    degraded?: boolean
} | null> => {
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) return null;
    
    const url = `${baseUrl}/api/predict-movement`;

    try {
        // ML retry logic is allowed here (3 retries for ML stability)
        const response = await nativeFetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                animal,
                user_location: userLocation,
                recent_path: recentPath,
                k_future: kFuture,
                wildlife_location: wildlifeLocation
            })
        }, 3); // 3 retries for ML

        if (!response || response.error) {
            return {
                animal,
                path: [],
                risk_level: "Medium",
                safety_override: false,
                distance_to_user_km: 0,
                status: 'degraded',
                degraded: true,
                message: response?.message || "Prediction engine unavailable"
            };
        }

        // Normalize backend formats:
        // - If backend returned predicted_locations, convert to path used by UI
        // - Ensure address uses the human-readable 'location' field
        if (Array.isArray(response?.predicted_locations)) {
            const path = response.predicted_locations
                .slice(0, 3)
                .map((p: any) => ({
                    lat: Number(p.lat),
                    lon: Number(p.lon),
                    address: String(p.location || 'Unknown wildlife area')
                }))
                .filter((p: any) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
            const predicted_path = path.map((p: { lat: number; lon: number; address?: string }) => ({ latitude: p.lat, longitude: p.lon }));
            return {
                animal,
                path,
                predicted_path,
                risk_level: response.risk_level || "Medium",
                safety_override: !!response.safety_override,
                distance_to_user_km: response.distance_to_user_km,
                status: 'ok',
                degraded: false,
                message: undefined
            } as any;
        }
        // New format: predicted_positions only (no addresses). Map to path with placeholder address
        if (Array.isArray(response?.predicted_positions)) {
            let path = response.predicted_positions
                .slice(0, 3)
                .map((p: any) => ({
                    lat: Number(p.lat),
                    lon: Number(p.lon),
                    address: 'Unknown wildlife area'
                }))
                .filter((p: any) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
            try {
                const names = await Promise.all(path.map((p: any) => reverseGeocode(p.lat, p.lon)));
                path = path.map((p: any, i: number) => ({ ...p, address: String(names[i] || 'Unknown wildlife area') }));
            } catch {}
            const predicted_path = path.map((p: { lat: number; lon: number; address?: string }) => ({ latitude: p.lat, longitude: p.lon }));
            try { console.log("Predictions received:", response.predicted_positions); } catch {}
            return {
                animal,
                path,
                predicted_path,
                risk_level: response.risk_level || "Medium",
                safety_override: !!response.safety_override,
                distance_to_user_km: response.distance_to_user_km,
                status: response?.status || 'ok',
                degraded: false,
                message: undefined
            } as any;
        }

        // Legacy format where backend returns { path: [...] }
        if (Array.isArray(response?.path)) {
            const path = response.path.map((p: any) => ({
                lat: Number(p.lat),
                lon: Number(p.lon),
                address: String(p.address || '')
            }));
            const predicted_path = path.map((p: { lat: number; lon: number; address?: string }) => ({ latitude: p.lat, longitude: p.lon }));
            return {
                animal,
                path,
                predicted_path,
                risk_level: response.risk_level || "Medium",
                safety_override: !!response.safety_override,
                distance_to_user_km: response.distance_to_user_km,
                status: 'ok',
                degraded: false,
                message: undefined
            } as any;
        }

        // Unexpected format: return safe default
        return {
            animal,
            path: [],
            risk_level: "Medium",
            safety_override: false,
            distance_to_user_km: 0,
            status: 'degraded',
            degraded: true,
            message: "Invalid prediction response"
        };
    } catch (error: any) {
        logger.error("Failed to predict movement", error);
        return {
            animal,
            path: [],
            risk_level: "Medium",
            safety_override: false,
            distance_to_user_km: 0,
            status: 'degraded',
            degraded: true,
            message: error.message || "Network failure"
        };
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
    const url = `${baseUrl}/api/predict-wildlife-risk`;
    try {
        const body = { route_coordinates: routeCoords.map(([lat, lon]) => [Number(lat), Number(lon)]) };
        const res = await nativeFetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        }, 1);
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

        const speciesList = Object.entries(ANIMALS).map(([sci, info]) => `${info.common} (${sci})`).join(', ');
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

        const response = await fetch(`${baseUrl}/api/gemini/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                history: history.slice(-10), // Send last 10 messages for context
                images,
                systemPrompt: sys
            })
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.details || err.error || 'Server error');
        }

        const data = await response.json();
        return data.text || "I'm sorry, I couldn't generate a response.";
    } catch (error: any) {
        logger.error('AI Guide error', error);
        
        // Fallback for when backend is down or API fails
        const last = history.filter(h => h.role === 'user').slice(-1)[0]?.text?.toLowerCase() || '';
        if (last.includes('elephant')) return "Elephants are common here. Stay 50m away, avoid noise, and stay in your vehicle.";
        if (last.includes('tiger')) return "Tiger spotted recently. Avoid night travel and stay inside your vehicle at all times.";
        
        return "I'm having trouble connecting to the AI guide. Please ensure the backend server is running and your Gemini API key is set in the .env file.";
    }
};

export const analyzeReportImage = async (image: { mimeType: string; data: string }): Promise<{ common?: string; scientific?: string; risk?: string; summary?: string; confidence?: number; behavior?: string; circumstance?: string; distance_advice?: string; actions?: string[]; emergency?: string[] } | null> => {
    try {
        const baseUrl = getApiBaseUrl();
        if (!baseUrl) return null;
        const species = Object.keys(ANIMALS);
        const prompt = `Identify the animal species in this photo from the allowed list only: ${species.join(', ')}.`;
        const url = `${baseUrl}/api/gemini/analyze-image`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mimeType: image.mimeType, data: image.data, prompt })
        });
        if (!res.ok) return null;
        const parsed = await res.json();
        const allowedScientific = Object.keys(ANIMALS);
        const allowedCommon = allowedScientific.map(sci => ANIMALS[sci].common);
        let sci: string | undefined = parsed.scientific ? canonicalScientific(String(parsed.scientific)) : undefined;
        let com: string | undefined = parsed.common;
        if (sci && allowedScientific.includes(sci)) {
            com = ANIMALS[sci].common;
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

export const deleteReport = async (reportId: string | number): Promise<{ status: string; deletedId?: string; error?: string } | null> => {
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) return null;
    const id = String(reportId);
    const url = `${baseUrl}/api/reports/${encodeURIComponent(id)}`;
    let headers: Record<string, string> = {};
    try {
        const uid = auth.currentUser?.uid || '';
        const email = auth.currentUser?.email || '';
        headers['x-user-id'] = uid;
        headers['x-user-email'] = email;
        const token = await auth.currentUser?.getIdToken?.();
        if (token) headers['Authorization'] = `Bearer ${token}`;
    } catch {}
    const res = await nativeFetch(url, { method: 'DELETE', headers });
    return res || null;
};
// Helper to process and balance wildlife data
const processWildlifeList = async (list: any[]): Promise<any[]> => {
    if (!Array.isArray(list) || list.length === 0) return [];

    // Filter by South India bounds and valid species
    const regionalList = list.filter(r => {
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

// --- TASK 3: Fetch Recent Wildlife from Backend ---
export const fetchRecentWildlife = async (startDate?: string, endDate?: string): Promise<any[]> => {
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) {
        logger.error("API_BASE_URL is not configured.");
        return [];
    }
    
    let url = `${baseUrl}/api/wildlife/recent`;
    if (startDate && endDate) {
        url += `?startDate=${startDate}&endDate=${endDate}`;
    }

    try {
        const data = await nativeFetch(url);
        let list: any[] = (data && Array.isArray(data)) ? data : [];
        
        // Only fallback if list is completely empty or fetch failed (and not in historical mode)
        if (!startDate && (list.length === 0 || data?.status === 'degraded')) {
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

    const url = `${baseUrl}/api/wildlife/all`;
    const res = await nativeFetch(url);
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
    const commonFromSci = ANIMALS[sciKey]?.common ? String(ANIMALS[sciKey].common).toLowerCase() : '';

    const filtered = list.filter((r: any) => {
        const animal = String(r?.animal || '').trim().toLowerCase();
        const sci = canonicalScientific(String(r?.scientific_name || ''));
        if (sciKey && sci === sciKey) return true;
        if (commonFromSci && animal === commonFromSci) return true;
        if (keyLower && animal === keyLower) return true;
        return false;
    });

    const withCoords = filtered
        .filter((r: any) => Number.isFinite(Number(r?.lat)) && Number.isFinite(Number(r?.lon)));

    const nearby = (anchor && Number.isFinite(anchor.lat) && Number.isFinite(anchor.lon))
        ? withCoords.filter((r: any) => distKm({ lat: Number(r.lat), lon: Number(r.lon) }, { lat: anchor.lat, lon: anchor.lon }) <= radiusKm)
        : withCoords;

    const sorted = nearby.sort((a: any, b: any) => new Date(a?.eventDate || 0).getTime() - new Date(b?.eventDate || 0).getTime());

    const points: [number, number][] = sorted.map((r: any) => [Number(r.lat), Number(r.lon)]);
    if (points.length < limit) return [];
    return points.slice(-limit);
};

export const getRoute = async (start: Location, end: Location, mode: TravelMode = 'car'): Promise<Route | null> => {
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) return null;
    
    // We still use the endpoint name 'osrm' but it now proxies to Google Maps Routes API
    // Ensure we pass the 'mode' parameter correctly
    const url = `${baseUrl}/api/route/osrm?startLat=${start.lat}&startLon=${start.lon}&endLat=${end.lat}&endLon=${end.lon}&mode=${mode}`;
    
    try {
        const response = await nativeFetch(url);
        
        let path: [number, number][] = [];
        let distanceVal = 0;
        let durationVal = 0;

        // Case 1: Standard Backend Response { geometry: { coordinates: ... }, ... }
        if (response && response.geometry && Array.isArray(response.geometry.coordinates)) {
            path = response.geometry.coordinates.map((coord: number[]) => [coord[1], coord[0]]);
            distanceVal = response.distance;
            durationVal = response.duration;
        } 
        // Case 4: GeoJSON FeatureCollection { features: [{ geometry: { coordinates: ... } }] }
        else if (response && Array.isArray(response.features) && response.features.length > 0) {
            const feature = response.features[0];
            if (feature.geometry && Array.isArray(feature.geometry.coordinates)) {
                path = feature.geometry.coordinates.map((coord: number[]) => [coord[1], coord[0]]);
                distanceVal = feature.properties?.summary?.distance || 0;
                durationVal = feature.properties?.summary?.duration || 0;
            }
        }
        // Case 5: Direct coordinates array (some simplified backends)
        else if (Array.isArray(response?.coordinates)) {
            path = response.coordinates.map((coord: number[]) => [coord[1], coord[0]]);
            distanceVal = response.distance || 0;
            durationVal = response.duration || 0;
        }
        // Case 2: Raw OSRM/ORS Response Structure { routes: [{ geometry: ... }] }
        else if (response && Array.isArray(response.routes) && response.routes.length > 0) {
            const route = response.routes[0];
            // Handle both GeoJSON geometry and encoded polyline
            if (route.geometry && Array.isArray(route.geometry.coordinates)) {
                 path = route.geometry.coordinates.map((coord: number[]) => [coord[1], coord[0]]);
            } else if (typeof route.geometry === 'string') {
                // If it's a string, it might be an encoded polyline (needs decoding lib, but we don't have it here easily without install)
                // Assuming backend handles decoding, but if we get raw OSRM with geojson:
                logger.warn("Received string geometry in raw route, cannot decode without polyline lib");
            }
            distanceVal = route.distance || 0;
            durationVal = route.duration || 0;
        }
        // Case 3: Data wrapped in 'data' field (Axios style, though nativeFetch returns body)
        else if (response && response.data && Array.isArray(response.data.routes) && response.data.routes.length > 0) {
             const route = response.data.routes[0];
             if (route.geometry && Array.isArray(route.geometry.coordinates)) {
                 path = route.geometry.coordinates.map((coord: number[]) => [coord[1], coord[0]]);
            }
            distanceVal = route.distance || 0;
            durationVal = route.duration || 0;
        }

        if (path.length === 0) {
            logger.warn("Route response missing geometry", response);
            return null;
        }
        
        return {
            path,
            distanceKm: distanceVal / 1000,
            durationMinutes: durationVal / 60,
            start,
            end,
            mode
        };
    } catch (error) {
        logger.error("Failed to fetch route", error);
        return null;
    }
};

export const getAnimalsNearRoute = async (routePath: [number, number][]): Promise<{ riskZones: any[], riskySegments: any[] }> => {
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) return { riskZones: [], riskySegments: [] };
    
    const url = `${baseUrl}/api/animals/near-route`;
    
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

/** Uses OSRM (getRoute) only. No /api/safe-route; no straight-line fallback. */
export const getSafeNavigationRoute = async (start: Location, end: Location, mode: TravelMode): Promise<Route | null> => {
    const route = await getRoute(start, end);
    if (!route) return null;
    return { ...route, mode };
};
