import type { Sighting, Location, ChatMessage, Route, WeatherData, SafePlace, TravelMode } from '../types';
import { logger } from '../utils/logger';
import Constants from 'expo-constants';
import { ANIMALS } from '../constants';

// Helper to get API Base URL
const getApiBaseUrl = (): string | null => {
    return Constants.expoConfig?.extra?.API_BASE_URL || null;
};

// Native-safe fetch implementation (no CORS proxy needed)
const nativeFetch = async (url: string, options: RequestInit = {}, retries = 3, backoff = 2000): Promise<any> => {
    try {
        const response = await fetch(url, options);
        // Handle 502 and 504 specifically as requested
        if ((response.status === 502 || response.status === 504) && retries > 0) {
            logger.warn(`Fetch failed with ${response.status}. Retrying in ${backoff}ms... (${retries} attempts left)`);
            await new Promise(resolve => setTimeout(resolve, backoff));
            return nativeFetch(url, options, retries - 1, backoff * 2);
        }
        if (!response.ok) {
            throw new Error(`Request failed with status ${response.status}`);
        }
        return await response.json();
    } catch (error: any) {
        // Also catch network errors and potential 502/504 errors that throw
        if (retries > 0 && (error.message.includes('Network request failed') || error.message.includes('502') || error.message.includes('504'))) {
             logger.warn(`Fetch failed (error). Retrying in ${backoff}ms... (${retries} attempts left)`, error);
             await new Promise(resolve => setTimeout(resolve, backoff));
             return nativeFetch(url, options, retries - 1, backoff * 2);
        }
        logger.error(`Failed to fetch ${url}`, error);
        throw error;
    }
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

    // Increased Overpass QL timeout to 60s
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
                    contact: tags.phone || tags['contact:phone'] || tags.operator || tags.website,
                    address: tags['addr:street'] ? `${tags['addr:street']} ${tags['addr:housenumber'] || ''}`.trim() : undefined,
                };
            }).filter((p: SafePlace) => p.lat && p.lon);
        }
        return [];
    } catch (error: any) {
        logger.error("Failed to find safe places gracefully", {
            message: error.message,
            url: url
        });
        // Return empty array instead of throwing to prevent app crash/stuck state
        return [];
    }
};

export const getWeatherData = async (lat: number, lon: number): Promise<WeatherData | null> => {
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) return null;

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
    if (!baseUrl) return null;

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
    if (!baseUrl) return false;

    if (baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1')) {
        logger.error('Invalid API_BASE_URL for mobile: localhost is not accessible');
        return false;
    }

    const url = `${baseUrl}/api/health`;
    try {
        const response = await nativeFetch(url);
        return !!response && response.status === 'ok';
    } catch (error) {
        logger.error('Backend health check failed', error);
        return false;
    }
};

export const searchLocations = async (query: string): Promise<Location[]> => {
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) return [];

    const url = `${baseUrl}/api/search-locations?q=${encodeURIComponent(query)}`;

    try {
        const response = await nativeFetch(url);
        if (!Array.isArray(response)) {
            logger.error("Unexpected response format from location search proxy", response);
            return [];
        }
        return response.map((item: any) => ({
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
    if (!baseUrl) return 'Address not found';

    const url = `${baseUrl}/api/reverse-geocode?lat=${lat}&lon=${lon}`;
    try {
        const response = await nativeFetch(url);
        if (response && response.error) {
            logger.warn(`Reverse geocode error from backend: ${response.error}`);
            return 'Address not found';
        }
        return response?.display_name || 'Unknown location';
    } catch (error: any) {
        logger.error("Failed to reverse geocode via backend", error);
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
        throw new Error('API_BASE_URL is not configured. Please set expo.extra.API_BASE_URL in app.config.js.');
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
        throw new Error(`Failed to predict animal paths: ${error.message}`);
    }
};

export const getAIGuideResponse = async (history: ChatMessage[]): Promise<string> => {
    return "AI Guide is temporarily unavailable. Please rely on map markers for safety.";
};

// --- TASK 3: Fetch Recent Wildlife from Backend ---
export const fetchRecentWildlife = async (): Promise<any[]> => {
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) {
        logger.error("API_BASE_URL is not configured.");
        return [];
    }
    const url = `${baseUrl}/api/gbif/recent`;
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to fetch recent wildlife: ${response.status}`);
        const data = await response.json();
        const recentData = Array.isArray(data) ? data.slice(0, 20) : [];

        return await Promise.all(recentData.map(async (record: { animal: string; scientific_name: string; lat: number; lon: number; eventDate: string; emoji?: string; image_url?: string }) => {
            const animalInfo = ANIMALS[record.scientific_name] || { emoji: '🐾' };
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
                name: animalInfo.common || record.animal,
                scientificName: record.scientific_name,
                emoji: record.emoji ?? animalInfo.emoji,
                lat,
                lon,
                date: record.eventDate,
                address,
                type: 'sighting' as const,
                image_url: record.image_url,
            };
        }));
    } catch (error) {
        logger.error("Error fetching recent wildlife", error);
        return [];
    }
};

export const getRoute = async (start: Location, end: Location): Promise<Route | null> => {
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) return null;
    
    const url = `${baseUrl}/api/route/osrm?startLat=${start.lat}&startLon=${start.lon}&endLat=${end.lat}&endLon=${end.lon}`;
    
    try {
        const response = await nativeFetch(url);
        
        const { geometry, distance, duration } = response;
        
        // Convert GeoJSON coordinates [lon, lat] to [lat, lon]
        const path: [number, number][] = geometry.coordinates.map((coord: number[]) => [coord[1], coord[0]]);
        
        return {
            path,
            distanceKm: distance / 1000,
            durationMinutes: duration / 60,
            start,
            end,
            mode: 'car'
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
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ routeGeometry })
        });
        
        if (!response.ok) throw new Error(`Status ${response.status}`);
        const data = await response.json();
        return {
            riskZones: data.riskZones || [],
            riskySegments: data.riskySegments || []
        };
    } catch (error) {
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
