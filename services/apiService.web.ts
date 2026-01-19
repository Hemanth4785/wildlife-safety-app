import { GoogleGenAI, Type } from "@google/genai/web";
import Constants from 'expo-constants';
import axios from 'axios';
import type { Sighting, Location, ChatMessage, Route, WeatherData, SafePlace, TravelMode, SafeRouteResponse } from '../types';
import { GBIF_LIMIT } from '../constants';
import { logger } from '../utils/logger';

// Use Vite env for web builds, Expo Constants for Expo web builds
const apiKey = typeof import.meta !== 'undefined' && import.meta.env?.VITE_GEMINI_API_KEY
    ? import.meta.env.VITE_GEMINI_API_KEY
    : Constants.expoConfig?.extra?.GEMINI_API_KEY || Constants.manifest?.extra?.GEMINI_API_KEY;

const getApiBaseUrl = () => {
    const baseUrl = Constants.expoConfig?.extra?.API_BASE_URL;
    if (!baseUrl) {
        logger.error("API_BASE_URL is not configured. Please set expo.extra.API_BASE_URL in app.config.js.");
        return 'http://localhost:3000';
    }
    return baseUrl as string;
};

if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured. Please set VITE_GEMINI_API_KEY in .env.local for Vite builds, or configure it in app.config.js under expo.extra.GEMINI_API_KEY for Expo builds.');
}

const ai = new GoogleGenAI({ apiKey });

const fetchWithProxyFallbacks = async (url: string, options: RequestInit = {}) => {
    const method = options.method?.toUpperCase() || 'GET';
    const PROXIES = [
        {
            name: 'CORS.eu.org',
            buildUrl: (targetUrl: string) => `https://cors.eu.org/${targetUrl.replace(/^https?:\/\//, '')}`,
            supportedMethods: ['GET', 'POST'],
            unwrapResponse: (res: Response) => res.json()
        }
        // { // Removed due to consistent 'Failed to fetch' errors
        //     name: 'ThingProxy',
        //     buildUrl: (targetUrl: string) => `https://thingproxy.freeboard.io/fetch/${targetUrl}`,
        //     supportedMethods: ['GET', 'POST'],
        //     unwrapResponse: (res: Response) => res.json()
        // },
        // { // Removed due to consistent 'Failed to fetch' errors
        //     name: 'AllOrigins',
        //     buildUrl: (targetUrl: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`,
        //     supportedMethods: ['GET'],
        //     unwrapResponse: (res: Response) => res.json()
        // }
    ];
    const suitableProxies = PROXIES.filter(p => p.supportedMethods.includes(method));
    if (suitableProxies.length === 0) throw new Error(`No suitable CORS proxy found for a ${method} request.`);
    const errors: string[] = [];
    for (const proxy of suitableProxies) {
        const proxyUrl = proxy.buildUrl(url);
        const finalHeaders = { 'X-Requested-With': 'XMLHttpRequest', ...options.headers, ...(proxy as any).headers };
        const requestOptionsWithHeaders = { ...options, headers: finalHeaders };
        try {
            logger.debug(`Fetching via proxy: ${proxy.name} for ${method} request to ${url}`);
            const response = await fetch(proxyUrl, requestOptionsWithHeaders);
            if (!response.ok) { const errorText = await response.text(); const truncatedError = errorText.length > 300 ? `${errorText.substring(0, 300)}...` : errorText; throw new Error(`Proxy service failed with status ${response.status}: ${truncatedError}`); }
            return await proxy.unwrapResponse(response);
        } catch (error: any) {
            logger.error(`Proxy ${proxy.name} failed`, error);
            errors.push(error.message);
        }
    }
    throw new Error(`All proxies failed to fetch the data. Last error: ${errors[errors.length-1]}`);
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
        const data = await fetchWithProxyFallbacks(url);
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
    const baseUrl = getApiBaseUrl();
    const url = `${baseUrl}/test`;
    try {
        const response = await fetch(url);
        if (!response.ok) {
            return false;
        }
        const data = await response.json();
        return !!data && data.ok === true;
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
        return data.map((item: any) => ({
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

export const getAIGuideResponse = async (history: ChatMessage[]): Promise<string> => {
    const systemInstruction = "You are a navigation and safety assistant. Given a user’s current location and their destination, your task is to find the safest route. Safety means avoiding unsafe areas such as isolated alleys, highways without pedestrian access, or regions flagged with higher risk. Always prioritize well-lit, populated, and frequently used roads.\n\nAlong the route, also identify and highlight the nearest safe places such as police stations, wildlife checkposts, or forest ranger posts that the user can approach in case of emergency. Provide the route directions, estimated time, and distance, along with markers showing these safe places. If multiple routes are available, rank them by safety first, and travel time second. Finally, explain why the chosen route and safe places are considered safe (e.g., ‘police station within 2 km’, ‘route passes through main road with public presence’)..";
    const contents = history.map(msg => ({ role: msg.role, parts: [{ text: msg.text }] }));
    try {
        const chat = ai.chats.create({ model: 'gemini-2.5-flash', config: { systemInstruction }, history: contents.slice(0, -1) });
        const lastMessage = contents[contents.length-1].parts[0].text;
        const response = await chat.sendMessage({ message: lastMessage });
        return response.text ?? "I'm sorry, I'm having trouble connecting right now. Please try again later.";
    } catch (error) { logger.error("Failed to get AI guide response", error); return "I'm sorry, I'm having trouble connecting right now. Please try again later."; }
};

export const getSafeNavigationRoute = async (start: Location, end: Location, mode: TravelMode): Promise<Route | null> => {
    const baseUrl = getApiBaseUrl();
    const endpoint = `${baseUrl}/api/safe-route`;

    // Map TravelMode to ORS profiles
    const orsMode = mode === 'walk' ? 'foot-walking' : 'driving-car';

    try {
        const response = await axios.post<SafeRouteResponse>(endpoint, {
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
            if (typeof window !== 'undefined' && typeof window.alert === 'function') {
                window.alert('Safe route unavailable, try again');
            }
            return null;
        }

        if (data.provider === 'fallback' || data.warning) {
            if (typeof window !== 'undefined' && typeof window.alert === 'function') {
                window.alert('Approximate route shown (routing service unavailable)');
            }
        }

        // ORS returns [lon, lat], swap to [lat, lon]
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
        if (typeof window !== 'undefined' && typeof window.alert === 'function') {
            window.alert('Safe route unavailable, try again');
        }
        return null;
    }
};
