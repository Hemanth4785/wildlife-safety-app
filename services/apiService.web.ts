import { GoogleGenAI, Type } from "@google/genai/web";
import Constants from 'expo-constants';
import type { Sighting, Location, ChatMessage, Route, WeatherData, SafePlace, TravelMode } from '../types';
import { GBIF_LIMIT } from '../constants';
import { logger } from '../utils/logger';

// Use Vite env for web builds, Expo Constants for Expo web builds
const apiKey = typeof import.meta !== 'undefined' && import.meta.env?.VITE_GEMINI_API_KEY
    ? import.meta.env.VITE_GEMINI_API_KEY
    : Constants.expoConfig?.extra?.GEMINI_API_KEY || Constants.manifest?.extra?.GEMINI_API_KEY;

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

export const searchLocations = async (query: string): Promise<Location[]> => {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5`;
    const headers = { 'User-Agent': 'WildlifeSafetyApp/1.0 (for aistudio.google.com)' };
    try {
        const data = await fetchWithProxyFallbacks(url, { method: 'GET', headers });
        if (!Array.isArray(data)) { logger.error("Unexpected response format from location search proxy", data); return []; }
        return data.map((item: any) => ({ lat: parseFloat(item.lat), lon: parseFloat(item.lon), name: item.display_name }));
    } catch (error) { logger.error("Failed to search locations", error); return []; }
};

export const reverseGeocode = async (lat: number, lon: number): Promise<string> => {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`;
    const headers = { 'User-Agent': 'WildlifeSafetyApp/1.0 (for aistudio.google.com)' };
    try {
        const data = await fetchWithProxyFallbacks(url, { method: 'GET', headers });
        if (data && data.error) { logger.warn(`Reverse geocode error from API: ${data.error}`); return 'Address not found'; }
        // Added a check to prevent crash on undefined display_name
        return data?.display_name || 'Unknown location';
    } catch (error: any) { logger.error("Failed to reverse geocode", error); return 'Address not found'; }
};

export const getAnimalSightings = async (scientificName: string, location: Location, radiusKm: number): Promise<Sighting[]> => {
    const decimalLatitude = `${location.lat - (radiusKm / 111.32)},${location.lat + (radiusKm / 111.32)}`;
    const decimalLongitude = `${location.lon - (radiusKm / (111.32 * Math.cos(location.lat * Math.PI / 180)))},${location.lon + (radiusKm / (111.32 * Math.cos(location.lat * Math.PI / 180)))}`;
    const taxonKeyUrl = `https://api.gbif.org/v1/species/match?name=${encodeURIComponent(scientificName)}`;
    try {
        logger.debug(`Fetching taxon key for ${scientificName}`);
        const taxonData = await fetchWithProxyFallbacks(taxonKeyUrl);
        const taxonKey = taxonData?.usageKey;
        if (!taxonKey) { logger.warn(`No taxon key found for ${scientificName}`); return []; }
        const sightingsUrl = `https://api.gbif.org/v1/occurrence/search?taxon_key=${taxonKey}&decimalLatitude=${decimalLatitude}&decimalLongitude=${decimalLongitude}&limit=${GBIF_LIMIT}&hasCoordinate=true&hasGeospatialIssue=false`;
        logger.debug(`Fetching sightings for taxon key ${taxonKey}`);
        const sightingsData = await fetchWithProxyFallbacks(sightingsUrl);
        const sightings = sightingsData.results.map((occ: any) => ({ lat: occ.decimalLatitude, lon: occ.decimalLongitude, image: occ.media?.find((m: any) => m.type === 'StillImage')?.identifier }));
        return sightings.filter((s: Sighting) => s.lat && s.lon);
    } catch (error: any) { logger.error(`Failed to get sightings for ${scientificName}`, error); return []; }
};

export const predictAnimalPaths = async (sightingSets: { scientificName: string, sightings: Sighting[] }[]): Promise<{ scientificName: string, predictions: { lat: number, lon: number }[] }[]> => {
    if (sightingSets.length === 0) {
        return [];
    }

    const prompt = `Based on the following sets of recent wildlife sightings, predict the next 3 likely locations for each animal's path. Each set is for a different animal, identified by its scientific name.
Sightings: ${JSON.stringify(sightingSets)}.
Provide the response as a single JSON array. Each element in the array should be an object with two keys: "scientificName" (the name of the animal) and "predictions" (an array of 3 predicted {lat, lon} locations for that animal's path). If there isn't enough data for a prediction, return an empty predictions array for that animal.`;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            scientificName: {
                                type: Type.STRING,
                                description: "The scientific name of the animal, e.g., 'Panthera pardus'."
                            },
                            predictions: {
                                type: Type.ARRAY,
                                items: {
                                    type: Type.OBJECT,
                                    properties: {
                                        lat: {
                                            type: Type.NUMBER,
                                            description: "Latitude of the predicted point."
                                        },
                                        lon: {
                                            type: Type.NUMBER,
                                            description: "Longitude of the predicted point."
                                        },
                                    },
                                    required: ["lat", "lon"],
                                },
                                description: "An array of 3 predicted {lat, lon} locations."
                            }
                        },
                        required: ["scientificName", "predictions"],
                    },
                },
            },
        });
        const text = response.text.trim();
        return JSON.parse(text);
    } catch (error) {
        logger.error("Failed to predict animal paths", error);
        // Re-throw the error to be handled by the calling function, which will set the app's error state.
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
        return response.text;
    } catch (error) { logger.error("Failed to get AI guide response", error); return "I'm sorry, I'm having trouble connecting right now. Please try again later."; }
};

const decodePolyline = (encoded: string): [number, number][] => {
    const len = encoded.length; let index = 0; const array: [number, number][] = []; let lat = 0; let lng = 0;
    while (index < len) {
        let b; let shift = 0; let result = 0;
        do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
        const dlat = ((result & 1) ? ~(result >> 1) : (result >> 1)); lat += dlat;
        shift = 0; result = 0;
        do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
        const dlng = ((result & 1) ? ~(result >> 1) : (result >> 1)); lng += dlng;
        array.push([lat * 1e-6, lng * 1e-6]);
    }
    return array;
};

export const getSafeNavigationRoute = async (start: Location, end: Location, avoidPolygons: number[][][], mode: TravelMode): Promise<Route | null> => {
    const url = 'https://valhalla1.openstreetmap.de/route';
    const multiPolygonCoordinates = avoidPolygons.map(polygonRing => [polygonRing]);
    
    const costingMap: Record<TravelMode, string> = {
        car: 'auto',
        bike: 'bicycle',
        bus: 'bus',
        walk: 'pedestrian'
    };
    const costing = costingMap[mode];

    const requestBody = {
        locations: [{ lat: start.lat, lon: start.lon }, { lat: end.lat, lon: end.lon }],
        costing: costing,
        ...(multiPolygonCoordinates.length > 0 && { avoid_polygons: { type: "MultiPolygon", coordinates: multiPolygonCoordinates } }),
        directions_options: { units: "kilometers" }
    };
    try {
        const data = await fetchWithProxyFallbacks(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody) });
        if (data && data.trip) {
            const leg = data.trip.legs[0];
            const shape = data.trip.legs.flatMap((l: any) => decodePolyline(l.shape));
            return { path: shape, distanceKm: parseFloat(leg.summary.length.toFixed(1)), durationMinutes: Math.round(leg.summary.time / 60), start: start, end: end, mode: mode };
        } else { throw new Error("Invalid route data received from Valhalla API."); }
    } catch (error: any) { logger.error("Failed to fetch safe navigation route", error); throw new Error(error.message || "Failed to fetch safe navigation route."); }
};