import Constants from 'expo-constants';

// The single source of truth for the API URL
const DEFAULT_API_URL = "http://192.168.0.105:3000";

const getExtra = (key: string, envKey?: string, fallback: string = ""): string => {
    const expoExtra = Constants.expoConfig?.extra;
    const configValue = expoExtra?.[key];
    const envValue = envKey ? process.env[envKey] : undefined;
    return configValue || envValue || fallback;
};

export const getApiBaseUrl = (): string => {
    // 1. Try from Expo Config (app.config.js / app.json) - Preferred way in Expo
    const expoExtra = Constants.expoConfig?.extra;
    const configUrl = expoExtra?.API_BASE_URL;

    // 2. Try from Environment Variable (if available in process.env)
    const envUrl = process.env.EXPO_PUBLIC_API_BASE_URL;

    // 3. Fallback
    // Ensure this NEVER points to 192.168.1.7
    let url = configUrl || envUrl || DEFAULT_API_URL;

    // Web-specific fallback if URL is still missing (unlikely given the default above)
    if (!url && typeof window !== 'undefined') {
        const hostname = window.location.hostname;
        url = `http://${hostname}:3000`;
    }

    // Strip trailing slash if present
    if (url.endsWith('/')) {
        url = url.slice(0, -1);
    }

    return url;
};

export const CONFIG = {
    API_BASE_URL: getApiBaseUrl(),
    OPENAI_API_KEY: getExtra('OPENAI_API_KEY', 'EXPO_PUBLIC_OPENAI_API_KEY'),
    OPENAI_MODEL: getExtra('OPENAI_MODEL', 'EXPO_PUBLIC_OPENAI_MODEL', 'gpt-3.5-turbo'),
    GEMINI_API_KEY: getExtra('GEMINI_API_KEY', 'EXPO_PUBLIC_GEMINI_API_KEY'),
    GEMINI_MODEL: getExtra('GEMINI_MODEL', 'EXPO_PUBLIC_GEMINI_MODEL', 'gemini-1.5-flash'),
};
