import Constants from 'expo-constants';
import { Platform } from 'react-native';

// The single source of truth for the API URL
const DEFAULT_API_URL = "http://10.211.106.199:3000";

const getExtra = (key: string, envKey?: string, fallback: string = ""): string => {
    const expoExtra = Constants.expoConfig?.extra;
    const configValue = expoExtra?.[key];
    const envValue = envKey ? process.env[envKey] : undefined;
    return configValue || envValue || fallback;
};

export const getApiBaseUrl = (): string => {
    const expoExtra = Constants.expoConfig?.extra;
    const envUrl = process.env.EXPO_PUBLIC_API_BASE_URL;
    const configUrl = expoExtra?.API_BASE_URL;
    const configNative = expoExtra?.API_BASE_URL_NATIVE || configUrl;
    const configWeb = expoExtra?.API_BASE_URL_WEB || configUrl;

    let url = DEFAULT_API_URL;

    if (Platform?.OS === 'web') {
        url = (configWeb || envUrl || DEFAULT_API_URL);
        if (!url && typeof window !== 'undefined') {
            const hostname = window.location.hostname;
            url = `http://${hostname}:3000`;
        }
    } else {
        // Prefer env for native to avoid localhost
        url = (envUrl || configNative || DEFAULT_API_URL);
        // Android emulator special-case
        if (Platform.OS === 'android') {
            if (url.includes('localhost') || url.includes('127.0.0.1')) {
                url = 'http://10.0.2.2:3000';
            }
        }
        // General native safety: avoid localhost
        if (url.includes('localhost') || url.includes('127.0.0.1')) {
            url = DEFAULT_API_URL;
        }
    }

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
