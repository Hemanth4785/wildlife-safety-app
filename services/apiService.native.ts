import type { Sighting, Location, ChatMessage, Route, WeatherData, SafePlace, TravelMode } from '../types';
import { logger } from '../utils/logger';
import { retry } from '../utils/retry';

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

export const searchLocations = async (query: string): Promise<Location[]> => {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5`;
    const headers = { 'User-Agent': 'WildlifeSafetyApp/1.0 (React Native)' };
    try {
        const data = await nativeFetch(url, { method: 'GET', headers });
        if (!Array.isArray(data)) {
            logger.error("Unexpected response format from location search", data);
            return [];
        }
        return data.map((item: any) => ({ lat: parseFloat(item.lat), lon: parseFloat(item.lon), name: item.display_name }));
    } catch (error) {
        logger.error("Failed to search locations", error);
        return [];
    }
};

export const reverseGeocode = async (lat: number, lon: number): Promise<string> => {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`;
    const headers = { 'User-Agent': 'WildlifeSafetyApp/1.0 (React Native)' };
    try {
        const data = await nativeFetch(url, { method: 'GET', headers });
        if (data && data.error) {
            logger.warn(`Reverse geocode error from API: ${data.error}`);
            return 'Address not found';
        }
        return data?.display_name || 'Unknown location';
    } catch (error: any) {
        logger.error("Failed to reverse geocode", error);
        return 'Address not found';
    }
};

export const getAnimalSightings = async (scientificName: string, location: Location, radiusKm: number): Promise<Sighting[]> => {
    const decimalLatitude = `${location.lat - (radiusKm / 111.32)},${location.lat + (radiusKm / 111.32)}`;
    const decimalLongitude = `${location.lon - (radiusKm / (111.32 * Math.cos(location.lat * Math.PI / 180)))},${location.lon + (radiusKm / (111.32 * Math.cos(location.lat * Math.PI / 180)))}`;
    const taxonKeyUrl = `https://api.gbif.org/v1/species/match?name=${encodeURIComponent(scientificName)}`;
    try {
        logger.debug(`Fetching taxon key for ${scientificName}`);
        const taxonData = await nativeFetch(taxonKeyUrl);
        const taxonKey = taxonData?.usageKey;
        if (!taxonKey) {
            logger.warn(`No taxon key found for ${scientificName}`);
            return [];
        }
        const sightingsUrl = `https://api.gbif.org/v1/occurrence/search?taxon_key=${taxonKey}&decimalLatitude=${decimalLatitude}&decimalLongitude=${decimalLongitude}&limit=200&hasCoordinate=true&hasGeospatialIssue=false`;
        logger.debug(`Fetching sightings for taxon key ${taxonKey}`);
        const sightingsData = await nativeFetch(sightingsUrl);
        const sightings = sightingsData.results.map((occ: any) => ({
            lat: occ.decimalLatitude,
            lon: occ.decimalLongitude,
            image: occ.media?.find((m: any) => m.type === 'StillImage')?.identifier
        }));
        return sightings.filter((s: Sighting) => s.lat && s.lon);
    } catch (error: any) {
        logger.error(`Failed to get sightings for ${scientificName}`, error);
        return [];
    }
};

export const predictAnimalPaths = async (sightingSets: { scientificName: string, sightings: Sighting[] }[]): Promise<{ scientificName: string, predictions: { lat: number, lon: number }[] }[]> => {
    // Native implementation: return empty array gracefully
    // AI features are not available on mobile yet - return empty predictions
    console.warn('AI prediction is not available on mobile. Returning empty predictions.');
    return [];
};

export const getAIGuideResponse = async (history: ChatMessage[]): Promise<string> => {
    // Native implementation: return user-friendly fallback message
    return "AI features are not available on mobile yet. Please use the web version of the app for AI-powered wildlife safety guidance. For now, stay alert, avoid known wildlife areas during active hours, and always inform someone of your route.";
};

const decodePolyline = (encoded: string): [number, number][] => {
    const len = encoded.length;
    let index = 0;
    const array: [number, number][] = [];
    let lat = 0;
    let lng = 0;
    while (index < len) {
        let b;
        let shift = 0;
        let result = 0;
        do {
            b = encoded.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        const dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lat += dlat;
        shift = 0;
        result = 0;
        do {
            b = encoded.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        const dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lng += dlng;
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
        const data = await nativeFetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });
        if (data && data.trip) {
            const leg = data.trip.legs[0];
            const shape = data.trip.legs.flatMap((l: any) => decodePolyline(l.shape));
            return {
                path: shape,
                distanceKm: parseFloat(leg.summary.length.toFixed(1)),
                durationMinutes: Math.round(leg.summary.time / 60),
                start: start,
                end: end,
                mode: mode
            };
        } else {
            throw new Error("Invalid route data received from Valhalla API.");
        }
    } catch (error: any) {
        logger.error("Failed to fetch safe navigation route", error);
        throw new Error(error.message || "Failed to fetch safe navigation route.");
    }
};
