import React from 'react';
import { AvatarTigerIcon, AvatarElephantIcon, AvatarBisonIcon, AvatarLeopardIcon, AvatarBearIcon } from './components/icons';

export const RADIUS_KM = 50; // Search radius for initial sightings
export const NEARBY_KM = 5;  // Radius for "nearby" alerts on the map
export const SEQ_LEN = 10;   // Max number of sightings to use for prediction
export const SMOOTH_STEPS = 20; // Number of steps for spline path smoothing
export const GBIF_LIMIT = 200; // Max results from GBIF API

export const MAP_CENTER: [number, number] = [11.4102, 76.6950]; // Ooty, India
export const MAP_ZOOM = 10;

export const SOUTH_INDIA_BOUNDS = {
    minLat: 8.0,
    maxLat: 15.5,
    minLon: 74.0,
    maxLon: 84.0
};

export const isWithinSouthIndia = (lat: number, lon: number): boolean => {
    return lat >= SOUTH_INDIA_BOUNDS.minLat && 
           lat <= SOUTH_INDIA_BOUNDS.maxLat && 
           lon >= SOUTH_INDIA_BOUNDS.minLon && 
           lon <= SOUTH_INDIA_BOUNDS.maxLon;
};

export const ANIMATION_DURATION_MS = 10000; // 10 seconds for one loop
export const ANIMATION_STEPS = 100; // Number of steps in the animation

interface AnimalInfo {
    common: string;
    emoji: string;
    color: string;
}

export const ANIMALS: Record<string, AnimalInfo> = {
    'Panthera pardus': { common: 'Leopard', emoji: '🐆', color: '#f97316' },
    'Elephas maximus': { common: 'Asian Elephant', emoji: '🐘', color: '#64748b' },
    'Bos gaurus': { common: 'Gaur', emoji: '🦬', color: '#1e293b' },
    'Bison bison': { common: 'Bison', emoji: '🦬', color: '#334155' },
    'Panthera tigris': { common: 'Tiger', emoji: '🐅', color: '#dc2626' },
    'Melursus ursinus': { common: 'Sloth Bear', emoji: '🐻', color: '#78350f' },
};

export const SPECIES_IMAGES: Record<string, string> = {
    'Panthera pardus': 'https://upload.wikimedia.org/wikipedia/commons/1/1e/African_Leopard.jpg',
    'Panthera tigris': 'https://upload.wikimedia.org/wikipedia/commons/5/56/Tiger.50.jpg',
    'Bos gaurus': 'https://upload.wikimedia.org/wikipedia/commons/1/16/Bos_gaurus_in_Kaziranga.jpg',
    'Bison bison': 'https://upload.wikimedia.org/wikipedia/commons/6/6f/American_bison_k5680-1.jpg',
    'Elephas maximus': 'https://upload.wikimedia.org/wikipedia/commons/5/5f/Elephas_maximus_-_Royal_Botanic_Gardens%2C_Sydney_-_April_2023.jpg',
    'Melursus ursinus': 'https://upload.wikimedia.org/wikipedia/commons/8/8e/Melursus_ursinus.jpg'
};

export const canonicalScientific = (name: string): string => {
    const parts = String(name || '').replace(/[",()]/g, '').trim().split(/\s+/);
    return parts.slice(0, 2).join(' ');
};

// --- Profile Avatars ---
interface Avatar {
    id: string;
    name: string;
    icon: any;
}

export const AVATARS: Record<string, Avatar> = {
    'tiger': { id: 'tiger', name: 'Tiger', icon: AvatarTigerIcon },
    'elephant': { id: 'elephant', name: 'Elephant', icon: AvatarElephantIcon },
    'bison': { id: 'bison', name: 'Bison', icon: AvatarBisonIcon },
    'leopard': { id: 'leopard', name: 'Leopard', icon: AvatarLeopardIcon },
    'bear': { id: 'bear', name: 'Bear', icon: AvatarBearIcon },
};
