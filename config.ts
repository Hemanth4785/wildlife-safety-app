import Constants from 'expo-constants';

/**
 * Single source of truth for API configuration.
 * In Expo Go, we prefer Constants.expoConfig.extra which is injected via app.config.js
 */
export const API_BASE_URL = "http://10.18.247.199:3000";

export const getApiBaseUrl = (): string => {
    return API_BASE_URL.endsWith('/') ? API_BASE_URL.slice(0, -1) : API_BASE_URL;
};

const getExtra = (key: string, fallback: string = ""): string => {
    return Constants.expoConfig?.extra?.[key] || fallback;
};

export const CONFIG = {
    API_BASE_URL: getApiBaseUrl(),
    OPENAI_API_KEY: getExtra('OPENAI_API_KEY'),
    OPENAI_MODEL: getExtra('OPENAI_MODEL', 'gpt-3.5-turbo'),
    GEMINI_API_KEY: getExtra('GEMINI_API_KEY'),
    GEMINI_MODEL: getExtra('GEMINI_MODEL', 'gemini-1.5-flash'),
};
