import React from 'react';
import { AvatarTigerIcon, AvatarElephantIcon, AvatarBisonIcon, AvatarLeopardIcon, AvatarBearIcon, AvatarRhinoIcon } from './components/icons';

export const RADIUS_KM = 50; // Search radius for initial sightings
export const NEARBY_KM = 5;  // Radius for "nearby" alerts on the map
export const SEQ_LEN = 10;   // Max number of sightings to use for prediction
export const SMOOTH_STEPS = 20; // Number of steps for spline path smoothing
export const GBIF_LIMIT = 200; // Max results from GBIF API

export const MAP_CENTER: [number, number] = [11.4102, 76.6950]; // Ooty, India
export const MAP_ZOOM = 10;

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
    'Bos gaurus': { common: 'Gaur (Indian Bison)', emoji: '🐃', color: '#1e293b' },
    'Panthera tigris': { common: 'Tiger', emoji: '🐅', color: '#dc2626' },
    'Melursus ursinus': { common: 'Sloth Bear', emoji: '🐻', color: '#78350f' },
    // Added Rhino for completeness if needed by other features
    'Rhinoceros unicornis': { common: 'Rhino', emoji: '🦏', color: '#4b5563' },
};

// --- Profile Avatars ---
interface Avatar {
    id: string;
    name: string;
    icon: React.FC<React.SVGProps<SVGSVGElement>>;
}

export const AVATARS: Record<string, Avatar> = {
    'tiger': { id: 'tiger', name: 'Tiger', icon: AvatarTigerIcon },
    'elephant': { id: 'elephant', name: 'Elephant', icon: AvatarElephantIcon },
    'bison': { id: 'bison', name: 'Bison', icon: AvatarBisonIcon },
    'leopard': { id: 'leopard', name: 'Leopard', icon: AvatarLeopardIcon },
    'bear': { id: 'bear', name: 'Bear', icon: AvatarBearIcon },
    'rhino': { id: 'rhino', name: 'Rhino', icon: AvatarRhinoIcon },
};