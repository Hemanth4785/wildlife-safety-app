import Constants from 'expo-constants';

/**
 * Single source of truth for API configuration.
 * In Expo Go, we prefer Constants.expoConfig.extra which is injected via app.config.js
 */
const getExtra = (key: string, fallback: string = ""): string => {
    return Constants.expoConfig?.extra?.[key] || fallback;
};

// Fallback to production URL if no environment variable is provided
// Updated: Backend API now includes /api prefix by default to match production routes
export const API_BASE_URL = getExtra('API_BASE_URL', "https://wildlife-safety-api.onrender.com/api");
export const ML_SERVICE_URL = getExtra('ML_SERVICE_URL', "https://wildlife-safety-app-1.onrender.com");

export const getApiBaseUrl = (): string => {
    let url = API_BASE_URL;
    if (url.endsWith('/')) url = url.slice(0, -1);
    // Ensure we have /api but not //api
    if (!url.endsWith('/api')) {
        url = url.replace(/\/api$/, '') + '/api';
    }
    return url;
};

export const getMlServiceUrl = (): string => {
    let url = ML_SERVICE_URL;
    if (url.endsWith('/')) url = url.slice(0, -1);
    return url;
};

export const CONFIG = {
    API_BASE_URL: getApiBaseUrl(),
    ML_SERVICE_URL: getMlServiceUrl(),
    OPENAI_API_KEY: getExtra('OPENAI_API_KEY'),
    OPENAI_MODEL: getExtra('OPENAI_MODEL', 'gpt-3.5-turbo'),
    GEMINI_API_KEY: getExtra('GEMINI_API_KEY'),
    GEMINI_MODEL: getExtra('GEMINI_MODEL', 'gemini-1.5-flash'),
    WEATHER_API_KEY: getExtra('WEATHER_API_KEY', '0f965eb13fcac3cab46a6d13af345eac'),
    /** Optional OSM-style raster URL; must include {z}, {x}, {y}. See MapView.native UrlTile. */
    tileUrl: getExtra('TILE_URL') || getExtra('OSM_TILE_URL') || '',
};
