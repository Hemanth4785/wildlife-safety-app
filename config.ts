import Constants from 'expo-constants';

/**
 * Single source of truth for API configuration.
 * In Expo Go, we prefer Constants.expoConfig.extra which is injected via app.config.js
 */
const getExtra = (key: string, fallback: string = ""): string => {
    return Constants.expoConfig?.extra?.[key] || fallback;
};

// Fallback to production URL if no environment variable is provided
export const API_BASE_URL = "https://wildlife-safety-api.onrender.com";

export const getApiBaseUrl = (): string => {
    const url = API_BASE_URL;
    return url.endsWith('/') ? url.slice(0, -1) : url;
};

export const CONFIG = {
    API_BASE_URL: getApiBaseUrl(),
    OPENAI_API_KEY: getExtra('OPENAI_API_KEY'),
    OPENAI_MODEL: getExtra('OPENAI_MODEL', 'gpt-3.5-turbo'),
    GEMINI_API_KEY: getExtra('GEMINI_API_KEY'),
    GEMINI_MODEL: getExtra('GEMINI_MODEL', 'gemini-1.5-flash'),
};
