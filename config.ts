import Constants from 'expo-constants';

/**
 * Single source of truth for API configuration.
 * In Expo Go, we prefer Constants.expoConfig.extra which is injected via app.config.js
 */
export const getApiBaseUrl = (): string => {
    // Standard pattern for Expo Go
    const configUrl = Constants.expoConfig?.extra?.API_BASE_URL;
    
    if (!configUrl) {
        console.warn("[Config] API_BASE_URL is not defined in Expo extra config!");
        return "";
    }

    let url = configUrl;

    // Clean up trailing slash
    if (url.endsWith('/')) {
        url = url.slice(0, -1);
    }
    
    return url;
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
