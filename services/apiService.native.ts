import type { Sighting, Location, ChatMessage, Route, WeatherData, SafePlace, TravelMode } from '../types';
import { logger } from '../utils/logger';
import { CONFIG } from '../config';
import { ANIMALS, canonicalScientific } from '../constants';
import wildlifeRecent from '../wildlife_recent.json';

// Helper to get API Base URL
const getApiBaseUrl = (): string | null => {
    const url = CONFIG.API_BASE_URL;
    if (url) {
        logger.debug(`[API] Using Base URL: ${url}`);
    } else {
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
        const response = await fetch(url, options);
        if (!response.ok) {
            // Requirement: Treat errors as degraded success, never throw
            logger.warn(`API request to ${url} returned status ${response.status}`);
            return { 
                status: 'degraded', 
                error: true, 
                statusCode: response.status,
                message: "Service temporarily unavailable" 
            };
        }
        return await response.json();
    } catch (error: any) {
        if (retries > 0 && error.message.includes('Network request failed')) {
             logger.warn(`Fetch failed (network). Retrying in ${backoff}ms... (${retries} attempts left)`, error);
             await new Promise(resolve => setTimeout(resolve, backoff));
             return nativeFetch(url, options, retries - 1, backoff * 2);
        }
        logger.error(`Critical fetch failure for ${url}`, error);
        // Fallback object instead of throwing
        return { 
            status: 'degraded', 
            error: true, 
            message: error.message || "Network error" 
        };
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
            const items = data.elements.map((el: any): SafePlace => {
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
            const priority = (t: string) => (t === 'police' ? 0 : 1);
            const centerPoint = { lat: (minLat + maxLat) / 2, lon: (minLon + maxLon) / 2 };
            return items.sort((a: SafePlace, b: SafePlace) => {
                const pa = priority(a.type);
                const pb = priority(b.type);
                if (pa !== pb) return pa - pb;
                const da = distKm(centerPoint, { lat: a.lat, lon: a.lon });
                const db = distKm(centerPoint, { lat: b.lat, lon: b.lon });
                return da - db;
            });
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

export const findSafePlacesNear = async (lat: number, lon: number, radiusKm: number = 5): Promise<SafePlace[]> => {
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) return [];
    const buffer = radiusKm / 111;
    const minLat = lat - buffer;
    const maxLat = lat + buffer;
    const minLon = lon - buffer;
    const maxLon = lon + buffer;
    const bbox = `${minLat},${minLon},${maxLat},${maxLon}`;
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
                const type = tags.amenity === 'police' ? 'police' : 'ranger';
                return {
                    id: el.id,
                    lat: center.lat,
                    lon: center.lon,
                    type: type,
                    name: tags.name || (type === 'police' ? 'Police Station' : 'Forest Office'),
                };
            }).filter((p: SafePlace) => p.lat && p.lon);
            const priority = (t: string) => (t === 'police' ? 0 : 1);
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
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        const response = await nativeFetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        return !!response && response.status === 'ok';
    } catch (error) {
        logger.error('Backend health check failed', error);
        return false;
    }
};

export const searchLocations = async (query: string): Promise<Location[]> => {
    const baseUrl = getApiBaseUrl();
    const url = baseUrl ? `${baseUrl}/api/search-locations?q=${encodeURIComponent(query)}` : '';
    try {
        if (url) {
            const response = await nativeFetch(url);
            if (Array.isArray(response)) {
                return response.map((item: any) => ({
                    lat: parseFloat(item.lat),
                    lon: parseFloat(item.lon),
                    name: item.display_name
                }));
            }
        }
    } catch {}
    try {
        const osmUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`;
        const res = await fetch(osmUrl, { headers: { 'Accept': 'application/json' } });
        if (!res.ok) return [];
        const data = await res.json();
        if (!Array.isArray(data)) return [];
        return data.slice(0, 5).map((item: any) => ({
            lat: parseFloat(item.lat),
            lon: parseFloat(item.lon),
            name: item.display_name
        }));
    } catch {
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
    kFuture: number = 3
): Promise<{ 
    animal: string, 
    predicted_path: { lat: number, lon: number, address: string }[], 
    risk_level: string, 
    safety_override: boolean,
    distance_to_user_km: number,
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
                k_future: kFuture
            })
        }, 3); // 3 retries for ML

        if (!response || response.error) {
            return {
                animal,
                predicted_path: [],
                risk_level: "Medium",
                safety_override: false,
                distance_to_user_km: 0,
                status: 'degraded',
                degraded: true,
                message: response?.message || "Prediction engine unavailable"
            };
        }

        return response;
    } catch (error: any) {
        logger.error("Failed to predict movement", error);
        return {
            animal,
            predicted_path: [],
            risk_level: "Medium",
            safety_override: false,
            distance_to_user_km: 0,
            status: 'degraded',
            degraded: true,
            message: error.message || "Network failure"
        };
    }
};

export const getAIGuideResponse = async (
    history: ChatMessage[],
    images?: { mimeType: string; data: string }[]
): Promise<string> => {
    try {
        const geminiKey = CONFIG.GEMINI_API_KEY;
        const geminiModel = CONFIG.GEMINI_MODEL;
        const openaiKey = CONFIG.OPENAI_API_KEY;
        const openaiModel = CONFIG.OPENAI_MODEL;

        const speciesList = Object.entries(ANIMALS).map(([sci, info]) => `${info.common} (${sci})`).join(', ');
        const sys = `You are the AI Wildlife Safety Guide for the Wildlife Safety app.
Project species: ${speciesList}.
Respond using these sections:
- Risk Summary: Low/Medium/High and 1–2 relevant species.
- Movement Forecast: short forecast near the user.
- Nearby Species: 2–3 bullets with behavior and risk.
- Safety Actions: 4–6 steps tailored to walk/car/bike.
- Route Tip: detours or timing to reduce risk.
Rules:
- Only reference the above species; if uncertain, state uncertainty.
- Never provide poaching/hunting/trapping instructions.
- Be concise and local.`;
        const geminiHistory = history.map((m) => ({
            role: m.role, // 'user' or 'model' (Gemini expects these)
            text: m.text
        }));
        const openaiHistory = history.map((m) => ({
            role: m.role === 'model' ? 'assistant' : 'user', // OpenAI expects 'assistant'
            text: m.text
        }));

        if (geminiKey) {
            const contents = [
                { role: 'user', parts: [{ text: sys }] },
                ...geminiHistory.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
                ...(Array.isArray(images) && images.length > 0
                    ? [{ role: 'user', parts: images.map(img => ({ inline_data: { mime_type: img.mimeType, data: img.data } })) }]
                    : [])
            ];
            const tryModel = async (model: string): Promise<{ ok: boolean; text?: string; status?: number; raw?: any }> => {
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents,
                        generationConfig: {
                            temperature: 0.15,
                            topP: 0.9,
                            maxOutputTokens: 800
                        }
                    })
                });
                if (!res.ok) {
                    let raw: any = null;
                    try { raw = await res.json(); } catch { raw = await res.text().catch(() => null); }
                    return { ok: false, status: res.status, raw };
                }
                const data = await res.json();
                const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
                return { ok: true, text };
            };
            const candidates = [geminiModel, 'gemini-1.5-flash-latest', 'gemini-1.5-pro-latest', 'gemini-1.5-flash', 'gemini-1.5-pro'];
            for (const m of candidates) {
                for (let i = 0; i < 3; i++) {
                    const attempt = await tryModel(m);
                    if (attempt.ok && attempt.text) {
                        return attempt.text;
                    }
                    const s = attempt.status || 0;
                    if (s === 404) break;
                    if (s === 429 || s === 500 || s === 503) {
                        const d = Math.min(1000 * Math.pow(2, i), 4000);
                        await new Promise(r => setTimeout(r, d));
                        continue;
                    }
                    break;
                }
            }
        }

        const last = history.filter(h => h.role === 'user').slice(-1)[0]?.text?.toLowerCase() || '';
        const hasImage = Array.isArray(images) && images.length > 0;
        if (geminiKey && hasImage) {
            return "Based on the photo, stay 50+ meters away, avoid eye contact, and back away calmly. Do not feed or provoke. Report the sighting with location and time. Keep children and pets close.";
        }
        if (geminiKey && ((last.includes('route') || last.includes('navigate')) || (last.includes('ooty') && last.includes('masinagudi')))) {
            return "Use the Map → Route Planner. Prefer well-lit roads and avoid dense forest at dusk/dawn. Keep 1–2 km buffer from recent sightings. If risk is high, delay or pick a detour.";
        }
        if (geminiKey && (last.includes('nearby') || last.includes('risk'))) {
            return "Nearby risk: watch for elephant and tiger zones. Move slowly, make noise, and avoid thick brush. If animals are seen, increase distance and choose an alternate path.";
        }
        if (geminiKey) {
            const routeCtx = [...history].reverse().find(h => h.role === 'model' && h.text.startsWith('Route plan:'));
            const areaCtx = [...history].reverse().find(h => h.role === 'model' && h.text.startsWith('Area check:'));
            const photoCtx = [...history].reverse().find(h => h.role === 'model' && h.text.startsWith('Photo analysis:'));
            const routeTip = routeCtx ? routeCtx.text : '';
            const areaTip = areaCtx ? areaCtx.text : '';
            const photoTip = photoCtx ? photoCtx.text : '';
            let speciesList = '';
            if (areaTip) {
                const m = areaTip.match(/Recent nearby wildlife:\s(.+?)\swithin/i);
                speciesList = m?.[1] || '';
            }
            let safePlaces = '';
            if (routeTip) {
                const sm = routeTip.match(/Nearby safe places:\s(.+)$/i);
                safePlaces = sm?.[1] || '';
            }
            const riskLevel = routeTip.includes('risky segments: 0') && routeTip.includes('Risk zones: 0') ? 'Low' : 'Medium';
            const lines = [
                `Risk Summary: ${riskLevel}. Species: ${speciesList || 'Elephant, Tiger (general caution)'}.`,
                `Movement Forecast: Movement likely near forest edges; avoid dense brush.`,
                `Nearby Species: ${speciesList || 'Elephant, Tiger'} — maintain distance; avoid provoking.`,
                `Safety Actions:`,
                `- Keep 50+ meters distance and move slowly`,
                `- Prefer daylight and well-used paths`,
                `- Do not feed or approach wildlife`,
                `- Use safe places: ${safePlaces || 'Police/Forest offices where available'}`,
                `Route Tip: ${routeTip || 'Use Route Planner; detour around recent sightings'}`
            ];
            return lines.join('\n');
        }
        return 'AI Guide is not configured. Set EXPO_PUBLIC_GEMINI_API_KEY.';
    } catch (error: any) {
        logger.error('AI Guide error', error);
        return "I'm sorry, I cannot respond right now.";
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
// --- TASK 3: Fetch Recent Wildlife from Backend ---
export const fetchRecentWildlife = async (): Promise<any[]> => {
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) {
        logger.error("API_BASE_URL is not configured.");
        return [];
    }
    const url = `${baseUrl}/api/wildlife/recent`;
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to fetch recent wildlife: ${response.status}`);
        const data = await response.json();
        let list: any[] = Array.isArray(data) ? data : [];
        // Only fallback if list is completely empty
        if (list.length === 0) {
            list = Array.isArray(wildlifeRecent) ? wildlifeRecent : [];
        }
        // Balance by species: pick up to 4 per species, then limit to 20
        const bySpecies: Record<string, any[]> = {};
        for (const r of list) {
            const sci = canonicalScientific(r.scientific_name);
            bySpecies[sci] = bySpecies[sci] || [];
            bySpecies[sci].push(r);
        }
        const balanced: any[] = [];
        const perSpeciesLimit = 4;
        Object.keys(bySpecies).forEach(sci => {
            const group = bySpecies[sci]
                .sort((a, b) => new Date(b.eventDate).getTime() - new Date(a.eventDate).getTime())
                .slice(0, perSpeciesLimit);
            balanced.push(...group);
        });
        const recentData = balanced
            .sort((a, b) => new Date(b.eventDate).getTime() - new Date(a.eventDate).getTime())
            .slice(0, 20);

        return await Promise.all(recentData.map(async (record: { animal: string; scientific_name: string; lat: number; lon: number; eventDate: string; emoji?: string; image_url?: string }) => {
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
            return {
                id: `${sci}-${record.eventDate}-${lat}`,
                name: animalInfo.common || record.animal,
                scientificName: sci,
                emoji: record.emoji ?? animalInfo.emoji,
                lat,
                lon,
                date: record.eventDate,
                address,
                type: 'sighting' as const,
                image_url: record.image_url || undefined,
            };
        }));
    } catch (error) {
        logger.error("Error fetching recent wildlife", error);
        try {
            const list: any[] = Array.isArray(wildlifeRecent) ? wildlifeRecent : [];
            const speciesSet = new Set(list.map((r: any) => canonicalScientific(r.scientific_name)));
            const bySpecies: Record<string, any[]> = {};
            for (const r of list) {
                const sci = canonicalScientific(r.scientific_name);
                bySpecies[sci] = bySpecies[sci] || [];
                bySpecies[sci].push(r);
            }
            const balanced: any[] = [];
            const perSpeciesLimit = 4;
            Object.keys(bySpecies).forEach(sci => {
                const group = bySpecies[sci]
                    .sort((a, b) => new Date(b.eventDate).getTime() - new Date(a.eventDate).getTime())
                    .slice(0, perSpeciesLimit);
                balanced.push(...group);
            });
            const recentData = balanced
                .sort((a, b) => new Date(b.eventDate).getTime() - new Date(a.eventDate).getTime())
                .slice(0, 20);
            return await Promise.all(recentData.map(async (record: any) => {
                const sci = canonicalScientific(record.scientific_name);
                const animalInfo = ANIMALS[sci] || { emoji: '🐾' };
                const lat = parseFloat(String(record.lat));
                const lon = parseFloat(String(record.lon));
                let address = record.eventDate;
                try {
                    const addr = await reverseGeocode(lat, lon);
                    if (addr && addr !== 'Address not found') address = addr;
                } catch {}
                return {
                    id: `${sci}-${record.eventDate}-${lat}`,
                    name: animalInfo.common || record.animal,
                    scientificName: sci,
                    emoji: animalInfo.emoji,
                    lat,
                    lon,
                    date: record.eventDate,
                    address,
                    type: 'sighting' as const,
                    image_url: record.image_url || undefined,
                };
            }));
        } catch {
            return [];
        }
    }
};

export const getRoute = async (start: Location, end: Location, mode: TravelMode = 'car'): Promise<Route | null> => {
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) return null;
    
    // We still use the endpoint name 'osrm' but it now proxies to Google Maps Routes API
    // Ensure we pass the 'mode' parameter correctly
    const url = `${baseUrl}/api/route/osrm?startLat=${start.lat}&startLon=${start.lon}&endLat=${end.lat}&endLon=${end.lon}&mode=${mode}`;
    
    try {
        const response = await nativeFetch(url);
        
        // Ensure response contains valid geometry before accessing coordinates
        if (!response || !response.geometry || !response.geometry.coordinates) {
            logger.warn("Route response missing geometry", response);
            return null;
        }

        const { geometry, distance, duration } = response;
        
        // Convert GeoJSON coordinates [lon, lat] to [lat, lon]
        const path: [number, number][] = geometry.coordinates.map((coord: number[]) => [coord[1], coord[0]]);
        
        return {
            path,
            distanceKm: distance / 1000,
            durationMinutes: duration / 60,
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
