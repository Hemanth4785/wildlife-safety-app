export type TravelMode = 'car' | 'bike' | 'bus' | 'walk';

export interface Location {
    lat: number;
    lon: number;
    name: string;
}

export interface Sighting {
    lat: number;
    lon: number;
    image?: string;
    image_url?: string;
    dist?: number; // Distance from user
}

export interface PredictionPoint {
    lat: number;
    lon: number;
    addr?: string;
}

export interface AnimalPrediction {
    id: string;
    scientific: string;
    common: string;
    emoji: string;
    color: string;
    image?: string;
    current: PredictionPoint & { dist_km: number };
    preds: PredictionPoint[];
    fullPath: [number, number][];
}

export interface Route {
    path: [number, number][]; // [[lat, lon], ...]
    distanceKm: number;
    durationMinutes: number;
    start: Location;
    end: Location;
    mode: TravelMode;
}

export interface SafeRouteResponse {
    success: boolean;
    geometry?: {
        coordinates: number[][];
        type: string;
    };
    distance?: number;
    duration?: number;
    provider?: string;
    reason?: string;
    warning?: boolean;
}

export interface NavigationStats {
    remainingKm: number;
    etaMinutes: number;
    progressPercent: number;
}

export interface NavigationAlert {
    animal: AnimalPrediction | null;
    message: string;
}

export interface ChatMessage {
    role: 'user' | 'model';
    text: string;
}

export enum AppState {
    IDLE = 'idle',
    LOADING = 'loading',
    SUCCESS = 'success',
    ERROR = 'error',
}

export enum View {
    LOGIN = 'login',
    HOME = 'home',
    MAP = 'map',
    GUIDE = 'guide',
    REPORTS = 'reports',
    PROFILE = 'profile',
}

export enum UIMode {
    MAP = 'MAP',
    DETAIL = 'DETAIL',
    PREDICTION = 'PREDICTION',
    ROUTE_SUMMARY = 'ROUTE_SUMMARY',
    ROUTE_PLANNER = 'ROUTE_PLANNER',
}

export interface Report {
    id: number;
    wildlifeType: string;
    location: string;
    description: string;
    timestamp: string;
    imageUri?: string;
    lat?: number;
    lon?: number;
    ai?: {
        common?: string;
        scientific?: string;
        risk?: string;
        summary?: string;
    };
}

export interface User {
    uid?: string;
    name: string;
    email: string;
    avatarId: string; // References an ID from the AVATARS constant
    nearbyRadiusKm?: number;
    isNewUser?: boolean;
}

export interface WeatherData {
    temperature: number;
    weatherCode: number;
    windSpeed: number;
    isDay: number;
}

export interface SafePlace {
    id: number;
    lat: number;
    lon: number;
    type: 'police' | 'ranger';
    name: string;
    contact?: string;
    address?: string;
}
