import type { Sighting, Location, ChatMessage, Route, WeatherData, SafePlace, TravelMode, SafeRouteResponse } from '../types';
import { logger } from '../utils/logger';
import { retry } from '../utils/retry';
import axios from 'axios';
import Constants from 'expo-constants';
import { Alert } from 'react-native';

// Native-safe fetch implementation (no CORS proxy needed)
const nativeFetch = async (url: string, options: RequestInit = {}): Promise<any> => {
    try {
        const response = await fetch(url, options);
        if (!response.ok) {
            throw new Error(`Request failed with status ${response.status}`);
        }
        return await response.json();
    } catch (error: any) {
        logger.error(`Failed to fetch ${url}`, error);
        throw error;
    }
};

export const findSafePlacesAlongRoute = async (routePath: [number, number][]): Promise<SafePlace[]> => {
    if (routePath.length === 0) return [];

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
    const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;

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
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`;
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
    const url = 'https://api.rainviewer.com/public/weather-maps.json';
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
    const baseUrl = Constants.expoConfig?.extra?.API_BASE_URL as string | undefined;
    if (!baseUrl) {
        logger.error('API_BASE_URL is not configured. Please set expo.extra.API_BASE_URL in app.config.js.');
        return false;
    }
    const url = `${baseUrl}/test`;
    try {
        const data = await nativeFetch(url);
        return !!data && data.ok === true;
    } catch (error) {
        logger.error('Backend health check failed', error);
        return false;
    }
};

export const searchLocations = async (query: string): Promise<Location[]> => {
    const baseUrl = Constants.expoConfig?.extra?.API_BASE_URL as string | undefined;

    if (!baseUrl) {
        throw new Error('API_BASE_URL is not configured. Please set expo.extra.API_BASE_URL in app.config.js.');
    }

    const url = `${baseUrl}/api/search-locations?q=${encodeURIComponent(query)}`;

    try {
        const data = await nativeFetch(url);
        if (!Array.isArray(data)) {
            logger.error("Unexpected response format from location search proxy", data);
            return [];
        }
        return data.map((item: any) => ({ lat: parseFloat(item.lat), lon: parseFloat(item.lon), name: item.display_name }));
    } catch (error) {
        logger.error("Failed to search locations via backend", error);
        return [];
    }
};

export const reverseGeocode = async (lat: number, lon: number): Promise<string> => {
    const baseUrl = Constants.expoConfig?.extra?.API_BASE_URL as string | undefined;

    if (!baseUrl) {
        throw new Error('API_BASE_URL is not configured. Please set expo.extra.API_BASE_URL in app.config.js.');
    }

    const url = `${baseUrl}/api/reverse-geocode?lat=${lat}&lon=${lon}`;

    try {
        const data = await nativeFetch(url);
        if (data && data.error) {
            logger.warn(`Reverse geocode error from backend proxy: ${data.error}`);
            return 'Address not found';
        }
        return data?.display_name || 'Unknown location';
    } catch (error: any) {
        logger.error("Failed to reverse geocode via backend", error);
        return 'Address not found';
    }
};

export const getAnimalSightings = async (scientificName: string, location: Location, radiusKm: number): Promise<Sighting[]> => {
    const baseUrl = Constants.expoConfig?.extra?.API_BASE_URL;

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

export const predictAnimalPaths = async (sightingSets: { scientificName: string, sightings: Sighting[] }[]): Promise<{ scientificName: string, predictions: { lat: number, lon: number }[] }[]> => {
    const baseUrl = Constants.expoConfig?.extra?.API_BASE_URL as string | undefined;

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

                const response = await axios.post(endpoint, {
                    animalSightings,
                    scientificName // Add scientificName to payload for validation/logging
                }, {
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    timeout: 30000 // 30 second timeout
                });

                if (!response.data || !response.data.success) {
                    logger.warn(`Backend prediction failed for ${scientificName}`, response.data);
                    return { scientificName, predictions: [] };
                }

                // Transform response: { lat, lng, risk } -> { lat, lon }
                const predictions = (response.data.predictedZones || []).map((zone: any) => ({
                    lat: zone.lat,
                    lon: zone.lng
                }));

                return { scientificName, predictions };
            })
        );

        return results;
    } catch (error: any) {
        logger.error('Failed to predict animal paths', error);
        if (error.response) {
            throw new Error(`Backend API error: ${error.response.status} - ${error.response.data?.message || 'Unknown error'}`);
        } else if (error.request) {
            throw new Error('Failed to connect to backend API. Please check your network connection and API_BASE_URL configuration.');
        } else {
            throw new Error(`Failed to predict animal paths: ${error.message}`);
        }
    }
};

export const getAIGuideResponse = async (history: ChatMessage[]): Promise<string> => {
    return "AI features are not available on mobile yet. Please use the web version of the app for AI-powered wildlife safety guidance. For now, stay alert, avoid known wildlife areas during active hours, and always inform someone of your route.";
};

export const getSafeNavigationRoute = async (start: Location, end: Location, mode: TravelMode): Promise<Route | null> => {
    const baseUrl = Constants.expoConfig?.extra?.API_BASE_URL as string | undefined;

    if (!baseUrl) {
        logger.error('API_BASE_URL is not configured. Please set expo.extra.API_BASE_URL in app.config.js.');
        Alert.alert('Error', 'Safe routing temporarily unavailable');
        return null;
    }

    // Map TravelMode to ORS profiles
    const orsMode = mode === 'walk' ? 'foot-walking' : 'driving-car';

    try {
        const response = await axios.post<SafeRouteResponse>(`${baseUrl}/api/safe-route`, {
            start,
            end,
            travelMode: orsMode
        }, {
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });

        const data = response.data;

        if (!data.success || !data.geometry || !data.geometry.coordinates) {
             Alert.alert('Error', 'Safe routing temporarily unavailable');
             return null;
        }

        if (data.provider === 'fallback' || data.warning) {
             Alert.alert('Route Warning', 'Approximate route shown (routing service unavailable)');
        }

        // ORS returns [lon, lat], swap to [lat, lon] for Leaflet/app usage
        const path: [number, number][] = data.geometry.coordinates.map((coord: number[]) => [coord[1], coord[0]]);

        return {
            path,
            distanceKm: data.distance || 0,
            durationMinutes: data.duration || 0,
            start,
            end,
            mode,
        };
    } catch (error) {
        logger.error('Failed to fetch safe navigation route from backend', error);
        Alert.alert('Error', 'Safe routing temporarily unavailable');
        return null;
    }
};
