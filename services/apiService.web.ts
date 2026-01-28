// Gemini / Google GenAI temporarily disabled. Imports and clients commented out.
// import { GoogleGenAI, Type } from "@google/genai/web";
import Constants from 'expo-constants';
import axios from 'axios';
import type { Sighting, Location, ChatMessage, Route, WeatherData, SafePlace, TravelMode } from '../types';
import { logger } from '../utils/logger';

const getApiBaseUrl = (): string => {
    const baseUrl = Constants.expoConfig?.extra?.API_BASE_URL;
    if (!baseUrl) {
        logger.error("API_BASE_URL is not configured. Please set expo.extra.API_BASE_URL in app.config.js.");
        return 'http://localhost:3000';
    }
    return baseUrl as string;
};


export const findSafePlacesAlongRoute = async (routePath: [number, number][]): Promise<SafePlace[]> => {
    const baseUrl = getApiBaseUrl();
    if (!baseUrl || routePath.length === 0) return [];

    const buffer = 0.05; // ~5km buffer
    let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
    routePath.forEach(([lat, lon]) => {
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
        minLon = Math.min(minLon, lon);
        maxLon = Math.max(maxLon, lon);
    });

    const bbox = `${minLat - buffer},${minLon - buffer},${maxLat + buffer},${maxLon + buffer}`;

    const query = `
        [out:json][timeout:25];
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
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Backend overpass proxy failed with status ${response.status}`);
        const data = await response.json();
        
        if (data && data.elements) {
            return data.elements.map((el: any): SafePlace => {
                const center = el.center || { lat: el.lat, lon: el.lon };
                const tags = el.tags || {};
                const type = tags.amenity === 'police' ? 'police' : 'ranger';
                return {
                    id: el.id,
                    lat: center.lat,
                    lon: center.lon,
                    type: type,
                    name: tags.name || (type === 'police' ? 'Police Station' : 'Forest Office'),
                };
            }).filter((p: SafePlace) => p.lat && p.lon);
        }
        return [];
    } catch (error) {
        logger.error("Failed to find safe places", error);
        return [];
    }
};


export const getWeatherData = async (lat: number, lon: number): Promise<WeatherData | null> => {
    const baseUrl = getApiBaseUrl();
    const url = `${baseUrl}/api/weather?lat=${lat}&lon=${lon}`;
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Weather API failed with status ${response.status}`);
        }
        const data = await response.json();
        if (data && data.current_weather) {
            return {
                temperature: data.current_weather.temperature,
                weatherCode: data.current_weather.weathercode,
                windSpeed: data.current_weather.windspeed,
                isDay: data.current_weather.is_day
            };
        }
        return null;
    } catch (error) {
        logger.error("Failed to fetch weather data", error);
        return null;
    }
};

export const getRainViewerTimestamps = async (): Promise<any> => {
    const baseUrl = getApiBaseUrl();
    const url = `${baseUrl}/api/rainviewer`;
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`RainViewer API failed with status ${response.status}`);
        }
        const data = await response.json();
        return data;
    } catch (error) {
        logger.error("Failed to fetch RainViewer timestamps", error);
        return null;
    }
};

export const checkBackendHealth = async (): Promise<boolean> => {
    const baseUrl = getApiBaseUrl();
    const url = `${baseUrl}/api/health`;
    try {
        const response = await fetch(url);
        if (!response.ok) return false;
        const data = await response.json();
        return !!data && data.status === 'ok';
    } catch (error) {
        logger.error('Backend health check failed', error);
        return false;
    }
};

export const searchLocations = async (query: string): Promise<Location[]> => {
    const baseUrl = getApiBaseUrl();
    const url = `${baseUrl}/api/search-locations?q=${encodeURIComponent(query)}`;
    try {
        const response = await axios.get(url);
        const data = response.data;
        if (!Array.isArray(data)) {
            logger.error("Unexpected response format from location search proxy", data);
            return [];
        }
        return data.map((item: { lat: string; lon: string; display_name: string }) => ({
            lat: parseFloat(item.lat),
            lon: parseFloat(item.lon),
            name: item.display_name
        }));
    } catch (error) {
        logger.error("Failed to search locations", error);
        return [];
    }
};

export const reverseGeocode = async (lat: number, lon: number): Promise<string> => {
    const baseUrl = getApiBaseUrl();
    const url = `${baseUrl}/api/reverse-geocode?lat=${lat}&lon=${lon}`;

    try {
        const response = await axios.get(url);
        const data = response.data;
        if (data && data.error) {
            logger.warn(`Reverse geocode error from backend: ${data.error}`);
            return 'Address not found';
        }
        return data?.display_name || 'Unknown location';
    } catch (error: any) {
        logger.error("Failed to reverse geocode", error);
        return 'Address not found';
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
        const response = await axios.get(`${baseUrl}/api/sightings`, {
            params: {
                scientificName,
                lat: location.lat,
                lon: location.lon,
                radius: radiusKm
            },
            timeout: 20000 // 20s timeout
        });

        if (Array.isArray(response.data)) {
            return response.data;
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

export const getRoute = async (start: Location, end: Location): Promise<Route | null> => {
    const baseUrl = getApiBaseUrl();
    const url = `${baseUrl}/api/route/osrm`;
    try {
        const response = await axios.get(url, {
            params: {
                startLat: start.lat,
                startLon: start.lon,
                endLat: end.lat,
                endLon: end.lon
            }
        });
        
        const { geometry, distance, duration } = response.data;
        
        // Convert GeoJSON coordinates [lon, lat] to [lat, lon]
        const path: [number, number][] = geometry.coordinates.map((coord: number[]) => [coord[1], coord[0]]);
        
        return {
            path,
            distanceKm: distance / 1000,
            durationMinutes: duration / 60,
            start,
            end,
            mode: 'car' // Default
        };
    } catch (error) {
        logger.error("Failed to fetch route", error);
        return null;
    }
};

export const getAnimalsNearRoute = async (routePath: [number, number][]): Promise<{ riskZones: any[]; riskySegments: any[] }> => {
    const baseUrl = getApiBaseUrl();
    const url = `${baseUrl}/api/animals/near-route`;
    const routeGeometry = routePath.map(p => [p[1], p[0]]);
    try {
        const response = await axios.post(url, { routeGeometry });
        const d = response.data;
        return { riskZones: d.riskZones || [], riskySegments: d.riskySegments || [] };
    } catch (error) {
        logger.error("Failed to fetch animals near route", error);
        return { riskZones: [], riskySegments: [] };
    }
};

export const predictAnimalPaths = async (sightingSets: { scientificName: string, sightings: Sighting[] }[]): Promise<{ scientificName: string, predictions: { lat: number, lon: number }[] }[]> => {
    if (sightingSets.length === 0) {
        return [];
    }

    const baseUrl = getApiBaseUrl();
    const endpoint = `${baseUrl}/api/predict-animal-paths`;

    try {
        // Process each sighting set separately to match native implementation and backend mock expectation
        const results = await Promise.all(
            sightingSets.map(async ({ scientificName, sightings }) => {
                if (sightings.length === 0) {
                    return { scientificName, predictions: [] };
                }

                // Transform sightings to backend format: { lat, lon } -> { lat, lng }
                // The backend mock expects 'animalSightings' with { lat, lng } or { lat, lon }
                const animalSightings = sightings.map(sighting => ({
                    lat: sighting.lat,
                    lng: sighting.lon
                }));

                try {
                    const response = await axios.post(endpoint, {
                        animalSightings,
                        scientificName
                    }, {
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        timeout: 30000
                    });

                    if (!response.data || !response.data.success) {
                        logger.warn(`Backend prediction failed for ${scientificName}`, response.data);
                        return { scientificName, predictions: [] };
                    }

                    // Transform response: { lat, lng, risk } -> { lat, lon }
                    const predictions = (response.data.predictedZones || []).map((zone: any) => ({
                        lat: zone.lat,
                        lon: zone.lng || zone.lon
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
        logger.error("Failed to predict animal paths", error);
        throw error;
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
    kFuture: number = 3
): Promise<{ 
    animal: string, 
    predicted_path: { lat: number, lon: number, address: string }[], 
    risk_level: string, 
    safety_override: boolean,
    distance_to_user_km: number
} | null> => {
    const baseUrl = getApiBaseUrl();
    const url = `${baseUrl}/api/predict-movement`;

    try {
        const response = await axios.post(url, {
            animal,
            user_location: userLocation,
            recent_path: recentPath,
            k_future: kFuture
        });
        return response.data;
    } catch (error) {
        logger.error("Failed to predict movement", error);
        return null;
    }
};

export const getAIGuideResponse = async (history: ChatMessage[]): Promise<string> => {
    return "AI Guide is temporarily unavailable. Please rely on map markers for safety.";
};

// --- Fetch Recent Wildlife from Backend (GBIF via Python) ---
export const fetchRecentWildlife = async (): Promise<any[]> => {
    const baseUrl = getApiBaseUrl();
    const url = `${baseUrl}/api/gbif/recent`;
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to fetch recent wildlife: ${response.status}`);
        const data = await response.json();
        const list = Array.isArray(data) ? data : [];
        const limited = list.slice(0, 20);
        return await Promise.all(limited.map(async (record: { animal: string; scientific_name: string; lat: number; lon: number; eventDate: string; emoji?: string }) => {
            const lat = parseFloat(String(record.lat));
            const lon = parseFloat(String(record.lon));
            let address = record.eventDate;
            try {
                const addr = await reverseGeocode(lat, lon);
                if (addr && addr !== 'Address not found') address = addr;
            } catch {
                /* ignore */
            }
            return {
                id: `${record.scientific_name}-${record.eventDate}-${lat}`,
                name: record.animal,
                scientificName: record.scientific_name,
                emoji: record.emoji || '🐾',
                lat,
                lon,
                date: record.eventDate,
                address,
                type: 'sighting' as const,
            };
        }));
    } catch (error) {
        logger.error("Error fetching recent wildlife", error);
        return [];
    }
};

/** Uses OSRM (getRoute) only. No /api/safe-route; no straight-line fallback. */
export const getSafeNavigationRoute = async (start: Location, end: Location, mode: TravelMode): Promise<Route | null> => {
    const route = await getRoute(start, end);
    if (!route) return null;
    return { ...route, mode };
};
