import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, Dimensions, Platform, Image, ActivityIndicator, Modal, TouchableOpacity, TextInput, ScrollView, Alert, Pressable, unstable_batchedUpdates } from 'react-native';
import MapView, { Marker, Polyline, Circle, PROVIDER_GOOGLE, Callout, type Region } from 'react-native-maps';
import type { AnimalPrediction, Location, Route, NavigationStats, NavigationAlert, SafePlace, TravelMode, Report } from '../types';
import { AppState, UIMode } from '../types';
import { MAP_CENTER, MAP_ZOOM, ANIMATION_STEPS, ANIMALS } from '../constants';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { FilterIcon, PlayIcon, PauseIcon, AlertTriangleIcon, InfoIcon, StopIcon, XIcon, PaperPlaneIcon, SpinnerIcon, ErrorIcon, LocationMarkerIcon, SyncIcon, RainIcon, CarIcon, WalkIcon, BikeIcon, BusIcon } from './icons';
import AnimalDetailModal from './AnimalDetailModal';
import { LoadingOverlay } from './LoadingOverlay';
import * as api from '../services/apiService';
import { clusterAnimals, type AnimalCluster } from '../utils/clustering';
import { formatDistance, formatDuration, calculateMinDistanceToPolyline } from '../services/geoService';
import PredictionPanel from './PredictionPanel';

const easeInOutSine = (x: number): number => -(Math.cos(Math.PI * x) - 1) / 2;

const DUMMY_COORDINATES_2 = [
    { latitude: 0, longitude: 0 },
    { latitude: 0, longitude: 0 }
];

const PREDICTION_POINT_SLOTS = 3;


// Route Planner Sheet Component
interface RoutePlannerSheetProps {
    isOpen: boolean;
    onClose: () => void;
    onCalculateSafeRoute: (start: Location | string, end: Location | string, radius: number, mode: TravelMode) => Promise<Route | null>;
    routeStatus: AppState;
    routeMessage: string;
    suggestions: Location[];
    isSuggesting: boolean;
    onFetchSuggestions: (query: string) => void;
    onClearSuggestions: () => void;
    getCurrentLocation: () => Promise<Location>;
    nearbyRadiusKm: number;
    isLocationLoading: boolean;
    isRouteLoading: boolean;
    initialStartQuery?: string;
    initialDestQuery?: string;
}

const RoutePlannerSheet: React.FC<RoutePlannerSheetProps> = ({
    isOpen, onClose, onCalculateSafeRoute, routeStatus, routeMessage,
    suggestions, isSuggesting, onFetchSuggestions, onClearSuggestions,
    getCurrentLocation, nearbyRadiusKm, isLocationLoading, isRouteLoading,
    initialStartQuery, initialDestQuery
}) => {
    const [startQuery, setStartQuery] = useState('');
    const [destQuery, setDestQuery] = useState('');
    const [selectedStart, setSelectedStart] = useState<Location | null>(null);
    const [selectedDest, setSelectedDest] = useState<Location | null>(null);
    const [activeInput, setActiveInput] = useState<'start' | 'dest' | null>(null);
    const [localError, setLocalError] = useState('');
    const [travelMode, setTravelMode] = useState<TravelMode>('car');
    const [isLocatingStart, setIsLocatingStart] = useState(false);
    useEffect(() => {
        if (isOpen) {
            if (initialStartQuery) setStartQuery(initialStartQuery);
            if (initialDestQuery) setDestQuery(initialDestQuery);
        }
    }, [isOpen, initialStartQuery, initialDestQuery]);

    const travelModes: { mode: TravelMode; label: string }[] = [
        { mode: 'car', label: 'Car' },
        { mode: 'walk', label: 'Walk' },
        { mode: 'bike', label: 'Bike' },
        { mode: 'bus', label: 'Bus' },
    ];

    const isFetchingLocation = useRef(false);

    const handleUseMyLocation = useCallback(async () => {
        if (isFetchingLocation.current || isLocatingStart || isLocationLoading || isRouteLoading) return;
        
        isFetchingLocation.current = true;
        setIsLocatingStart(true);
        onClearSuggestions();
        setActiveInput(null);
        
        try {
            await new Promise(resolve => setTimeout(resolve, 900));
            const location = await getCurrentLocation();
            if (location) {
                setSelectedStart(location);
                setStartQuery(location.name.split(',').slice(0, 2).join(', '));
            }
        } catch (error: any) {
            setLocalError('Could not fetch your current location. Please try again.');
        } finally {
            isFetchingLocation.current = false;
            setIsLocatingStart(false);
        }
    }, [getCurrentLocation, onClearSuggestions, isLocatingStart, isLocationLoading, isRouteLoading]);

    const handleSuggestionClick = (location: Location) => {
        if (activeInput === 'start') {
            setStartQuery(location.name);
            setSelectedStart(location);
        } else if (activeInput === 'dest') {
            setDestQuery(location.name);
            setSelectedDest(location);
        }
        onClearSuggestions();
        setActiveInput(null);
    };

    const handleSubmit = async () => {
        setLocalError('');
        const startInput = selectedStart || startQuery;
        const endInput = selectedDest || destQuery;

        if (!startQuery.trim() || !destQuery.trim()) {
            setLocalError('Please provide both a start and destination.');
            return;
        }

        if (startInput && endInput) {
            const newRoute = await onCalculateSafeRoute(startInput, endInput, nearbyRadiusKm, travelMode);
            if (newRoute) {
                setStartQuery('');
                setDestQuery('');
                setSelectedStart(null);
                setSelectedDest(null);
                onClearSuggestions();
                onClose();
            }
        }
    };

    if (!isOpen) return null;

    return (
        <View style={styles.routePlannerSheet}>
            <View style={styles.routePlannerHeader}>
                <Text style={styles.routePlannerTitle}>Plan a Safe Route</Text>
                <TouchableOpacity onPress={onClose}>
                    <XIcon width={24} height={24} color="#374151" />
                </TouchableOpacity>
            </View>
            <ScrollView style={styles.routePlannerContent} keyboardShouldPersistTaps="handled">
                <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Start</Text>
                    <View style={styles.inputRow}>
                        <TextInput
                            style={styles.textInput}
                            value={startQuery}
                            editable={!isLocatingStart && !isLocationLoading && !isRouteLoading}
                            onChangeText={(text) => {
                                setStartQuery(text);
                                setSelectedStart(null);
                                onFetchSuggestions(text);
                            }}
                            onFocus={() => setActiveInput('start')}
                            placeholder="Enter start location"
                        />
                        <TouchableOpacity
                            style={styles.locationButton}
                            onPress={handleUseMyLocation}
                            disabled={isLocatingStart || isLocationLoading || isRouteLoading}
                        >
                            {isLocatingStart || isLocationLoading ? (
                                <SpinnerIcon width={20} height={20} color="#374151" />
                            ) : (
                                <LocationMarkerIcon width={20} height={20} color="#374151" />
                            )}
                        </TouchableOpacity>
                    </View>
                    {activeInput === 'start' && suggestions.length > 0 && (
                        <View style={styles.suggestionsList}>
                            {suggestions.map((s) => (
                                <TouchableOpacity
                                    key={`${s.lat}-${s.lon}`}
                                    style={styles.suggestionItem}
                                    onPress={() => handleSuggestionClick(s)}
                                >
                                    <Text style={styles.suggestionText}>{s.name}</Text>
                                </TouchableOpacity>
                            ))}
                        </View>
                    )}
                </View>
                <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Destination</Text>
                    <TextInput
                        style={styles.textInput}
                        value={destQuery}
                        editable={!isRouteLoading}
                        onChangeText={(text) => {
                            setDestQuery(text);
                            setSelectedDest(null);
                            onFetchSuggestions(text);
                        }}
                        onFocus={() => setActiveInput('dest')}
                        placeholder="Enter destination"
                    />
                    {activeInput === 'dest' && suggestions.length > 0 && (
                        <View style={styles.suggestionsList}>
                            {suggestions.map((s) => (
                                <TouchableOpacity
                                    key={`${s.lat}-${s.lon}`}
                                    style={styles.suggestionItem}
                                    onPress={() => handleSuggestionClick(s)}
                                >
                                    <Text style={styles.suggestionText}>{s.name}</Text>
                                </TouchableOpacity>
                            ))}
                        </View>
                    )}
                </View>
                <View style={styles.travelModeContainer}>
                    {travelModes.map(({ mode, label }) => (
                        <TouchableOpacity
                            key={mode}
                            style={[styles.travelModeButton, travelMode === mode && styles.travelModeButtonActive]}
                            onPress={() => setTravelMode(mode)}
                        >
                            <Text style={[styles.travelModeText, travelMode === mode && styles.travelModeTextActive]}>
                                {label}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </View>
                <TouchableOpacity
                    style={[styles.submitButton, isRouteLoading && styles.submitButtonDisabled]}
                    onPress={handleSubmit}
                    disabled={isRouteLoading}
                >
                    <Text style={styles.submitButtonText}>
                        {isRouteLoading ? 'Calculating...' : 'Find Safe Route'}
                    </Text>
                </TouchableOpacity>
                {(localError || (routeStatus === AppState.ERROR && routeMessage)) && (
                    <View style={styles.errorContainer}>
                        <ErrorIcon width={20} height={20} color="#ef4444" />
                        <Text style={styles.errorText}>{localError || routeMessage}</Text>
                    </View>
                )}
            </ScrollView>
        </View>
    );
};


interface MapViewProps {
    status: AppState;
    message: string;
    userLocation: Location | null;
    predictions: AnimalPrediction[];
    safeRoute: Route | null;
    safePlaces: SafePlace[];
    riskZones: any[];
    riskySegments: any[];
    onLocationSubmit: (location: string) => void;
    suggestions: Location[];
    isSuggesting: boolean;
    onFetchSuggestions: (query: string) => void;
    onClearSuggestions: () => void;
    routeStatus: AppState;
    routeMessage: string;
    onCalculateSafeRoute: (start: Location | string, end: Location | string, radius: number, mode: TravelMode) => Promise<Route | null>;
    getCurrentLocation: () => Promise<Location>;
    isNavigating: boolean;
    liveLocation: Location | null;
    navigationStats: NavigationStats | null;
    onStartNavigation: () => void;
    onStopNavigation: () => void;
    navigationAlert: NavigationAlert | null;
    clearNavigationAlert: () => void;
    closestPathIndex: number;
    animationProgress: number;
    isPlaying: boolean;
    onPlay: () => void;
    onPause: () => void;
    nearbyRadiusKm: number;
    isApproachingStart: boolean;
    recentSightings: any[];
    isWildlifeLoading: boolean;
    isLocationLoading: boolean;
    isRouteLoading: boolean;
    reports?: Report[];
    initialRouteStart?: string;
    initialRouteEnd?: string;
}

const MapViewComponent: React.FC<MapViewProps> = (props) => {
    const { 
        userLocation, predictions, animationProgress, nearbyRadiusKm, 
        safeRoute, safePlaces, riskZones, riskySegments, isNavigating, liveLocation, navigationStats, 
        onStopNavigation, navigationAlert, clearNavigationAlert, closestPathIndex,
        isPlaying, onPlay, onPause, isApproachingStart,
        onCalculateSafeRoute, routeStatus, routeMessage, suggestions,
        isSuggesting, onFetchSuggestions, onClearSuggestions, getCurrentLocation,
        recentSightings, isWildlifeLoading, isLocationLoading, isRouteLoading,
        reports = []
    } = props;
    
    const mapRef = useRef<MapView>(null);
    const [uiMode, setUiMode] = useState<UIMode>(UIMode.MAP);
    const [animalClusters, setAnimalClusters] = useState<AnimalCluster[]>([]);
    const [selectedAnimal, setSelectedAnimal] = useState<{
        name: string;
        scientificName?: string;
        image_url?: string;
        date: string;
        metadata: { scope: string; confidence: string };
        lat: number;
        lon: number;
        address?: string;
        fullPath?: any[];
    } | null>(null);
    const [detailModalAnimal, setDetailModalAnimal] = useState<AnimalPrediction | null>(null);
    const pathIndexRef = useRef(0);
    const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);
    const [visibleAnimals, setVisibleAnimals] = useLocalStorage<Record<string, boolean>>('map-filter-animals', {});
    const [showPredictions, setShowPredictions] = useLocalStorage<boolean>('map-filter-predictions', false);
    const [showNearbyRadius, setShowNearbyRadius] = useLocalStorage<boolean>('map-filter-radius', true);
    const [showWeatherOverlay, setShowWeatherOverlay] = useLocalStorage<boolean>('map-filter-weather', false);
    const [mapRegion, setMapRegion] = useState<{ latitudeDelta: number; longitudeDelta: number } | null>(null);
    const [isCenteringOnUser, setIsCenteringOnUser] = useState(false);
    
    // LSTM Prediction State - STABLE: never unmounted
    const [predictedPath, setPredictedPath] = useState<{ lat: number, lon: number, address: string }[]>([]);
    const safePredictedPath = predictedPath;
    const [predictionLoading, setPredictionLoading] = useState(false);
    const [predictionRisk, setPredictionRisk] = useState<string | null>(null);
    const [predictedAnimalName, setPredictedAnimalName] = useState<string>('');
    const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null);

    const animalTypes = useMemo(() => Array.from(new Set(predictions.map(p => p.common))).sort(), [predictions]);

    useEffect(() => {
        if (props.initialRouteStart && props.initialRouteEnd) {
            setUiMode(UIMode.ROUTE_PLANNER);
        }
    }, [props.initialRouteStart, props.initialRouteEnd]);

    useEffect(() => {
        if (safeRoute && routeStatus === AppState.SUCCESS && !isNavigating) {
            setUiMode(UIMode.ROUTE_SUMMARY);
        }
    }, [safeRoute, routeStatus, isNavigating]);

    useEffect(() => {
        let hasChanged = false;
        const newVisibleAnimals = { ...visibleAnimals };
        animalTypes.forEach(animalName => {
            if (typeof newVisibleAnimals[animalName] === 'undefined') {
                newVisibleAnimals[animalName] = true;
                hasChanged = true;
            }
        });
        if (hasChanged) {
            setVisibleAnimals(newVisibleAnimals);
        }
    }, [animalTypes, visibleAnimals, setVisibleAnimals]);

    const handleToggleAnimal = (commonName: string) => {
        setVisibleAnimals(prev => ({...prev, [commonName]: !prev[commonName]}));
    };

    const filteredPredictions = useMemo(() => {
        if (!showPredictions) return [];
        return predictions.filter(p => visibleAnimals[p.common]);
    }, [predictions, visibleAnimals, showPredictions]);

    useEffect(() => {
        const easedProgress = easeInOutSine(animationProgress / ANIMATION_STEPS);
        const firstPred = filteredPredictions[0];
        if (firstPred && firstPred.fullPath.length > 1) {
             pathIndexRef.current = Math.floor(easedProgress * (firstPred.fullPath.length - 1));
        } else {
            pathIndexRef.current = 0;
        }
    }, [animationProgress, filteredPredictions]);

    useEffect(() => {
        const latest = reports.find(r => typeof r.lat === 'number' && typeof r.lon === 'number');
        if (latest && mapRef.current) {
            mapRef.current.animateToRegion({
                latitude: latest.lat as number,
                longitude: latest.lon as number,
                latitudeDelta: 0.02,
                longitudeDelta: 0.02
            }, 800);
        }
    }, [reports]);
    // Optimized clustering using spatial grid algorithm
    useEffect(() => {
        if (filteredPredictions.length === 0) {
            setAnimalClusters([]);
            return;
        }
        const pathIndex = pathIndexRef.current;
        const clusters = clusterAnimals(filteredPredictions, pathIndex, 0.01);
        setAnimalClusters(clusters);
    }, [filteredPredictions, animationProgress]);

    const handleViewDetails = useCallback((animal: AnimalPrediction) => {
        setDetailModalAnimal(animal);
        // Also populate selectedAnimal for the generic detail view to work and to enable prediction
        setSelectedAnimal({
            name: animal.common,
            image_url: animal.image,
            date: new Date().toISOString(), 
            metadata: { scope: 'prediction', confidence: 'high' },
            lat: animal.current.lat,
            lon: animal.current.lon,
            address: animal.current.addr,
            fullPath: animal.fullPath
        });
        setUiMode(UIMode.DETAIL);
    }, []);

    useEffect(() => {
        let isMounted = true;
        const fetchAddress = async () => {
            if (selectedAnimal && !selectedAnimal.address) {
                try {
                    const address = await api.reverseGeocode(selectedAnimal.lat, selectedAnimal.lon);
                    if (isMounted) {
                        setSelectedAnimal(prev => prev ? { ...prev, address } : null);
                    }
                } catch (error) {
                    console.error('[MapView] Error fetching address for selected animal:', error);
                }
            }
        };
        fetchAddress();
        return () => { isMounted = false; };
    }, [selectedAnimal?.lat, selectedAnimal?.lon]);

    const handlePredictMovement = async () => {
        if (!selectedAnimal || !userLocation) {
            if (!userLocation) Alert.alert("Location Required", "Please enable location services to use prediction.");
            return;
        }
        
        setPredictionLoading(true);
        console.log('[MapView] Fetching prediction from backend API');
        
        // Capture animal data before clearing state
        const animalData = { ...selectedAnimal };
        
        try {
            const animalLat = animalData.lat ?? 0;
            const animalLon = animalData.lon ?? 0;

            // Build recent path:
            // 1) Prefer fullPath if available and has enough history
            // 2) Else construct from recent sightings of the same species (last 5 by date)
            // 3) Else fall back to current point
            let recentPath: [number, number][] = [];
            if (animalData.fullPath && animalData.fullPath.length >= 5) {
                recentPath = animalData.fullPath.map(p => Array.isArray(p) ? [p[0], p[1]] : [p.lat, p.lon]);
            } else {
                const sciName = animalData.scientificName;
                if (sciName) {
                    const sameSpecies = recentSightings
                        .filter(s => s.scientificName === sciName)
                        .sort((a, b) => {
                            const ta = new Date(a.date).getTime();
                            const tb = new Date(b.date).getTime();
                            return ta - tb;
                        })
                        .slice(-5)
                        .map(s => [s.lat, s.lon] as [number, number]);
                    if (sameSpecies.length >= 2) {
                        recentPath = sameSpecies;
                    }
                }
                if (recentPath.length === 0) {
                    recentPath = [[animalLat, animalLon]];
                }
                if (recentPath.length === 1) {
                    const [lat, lon] = recentPath[0];
                    recentPath = [
                        [lat, lon],
                        [lat + 0.0001, lon + 0.0001]
                    ];
                }
            }

            const result = await api.predictMovement(
                animalData.name,
                userLocation,
                recentPath,
                3 // k_future
            );

            if (result && Array.isArray(result.predicted_path) && result.predicted_path.length > 0) {
                const baseLat = Number(animalData.lat ?? 0);
                const baseLon = Number(animalData.lon ?? 0);
                const baseAddr = String(animalData.address || 'current area');
                const toRad = (d: number) => (d * Math.PI) / 180;
                const toDeg = (r: number) => (r * 180) / Math.PI;
                const haversineKm = (lat1: number, lon1: number, lat2: number, lon2: number) => {
                    const R = 6371;
                    const dLat = toRad(lat2 - lat1);
                    const dLon = toRad(lon2 - lon1);
                    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
                    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                    return R * c;
                };
                const bearingDeg = (lat1: number, lon1: number, lat2: number, lon2: number) => {
                    const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
                    const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
                    const brng = toDeg(Math.atan2(y, x));
                    return (brng + 360) % 360;
                };
                const dirOf = (deg: number) => {
                    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
                    const idx = Math.round(deg / 45) % 8;
                    return dirs[idx];
                };
                const enriched = result.predicted_path.map(p => {
                    const lat = Number(p.lat), lon = Number(p.lon);
                    let address = p.address;
                    if (!address || address.startsWith('Unknown')) {
                        const d = haversineKm(baseLat, baseLon, lat, lon);
                        const b = bearingDeg(baseLat, baseLon, lat, lon);
                        address = `${d.toFixed(1)} km ${dirOf(b)} of ${baseAddr}`;
                    }
                    return { lat, lon, address };
                });
                unstable_batchedUpdates(() => {
                    setPredictedPath(enriched);
                    setPredictionRisk(result.risk_level);
                    setPredictedAnimalName(animalData.name);
                    setSelectedPointIndex(null);
                    setSelectedAnimal(null);
                    setUiMode(UIMode.PREDICTION);
                });

                if (result.status === 'degraded') {
                    console.warn(`[MapView] Prediction received in degraded mode: ${result.message || 'Check logs'}`);
                }

                if (mapRef.current && enriched.length > 0) {
                    const coords = enriched
                        .map(p => ({ latitude: Number(p.lat), longitude: Number(p.lon) }))
                        .filter(c => Number.isFinite(c.latitude) && Number.isFinite(c.longitude));
                    const endLat = Number(animalData.lat);
                    const endLon = Number(animalData.lon);
                    if (Number.isFinite(endLat) && Number.isFinite(endLon)) coords.push({ latitude: endLat, longitude: endLon });
                    if (coords.length > 0) {
                    mapRef.current.fitToCoordinates(coords, {
                        edgePadding: { top: 100, right: 50, bottom: 250, left: 50 },
                        animated: true
                    });
                    }
                }
            } else {
                const k = 3;
                const path = Array.isArray(recentPath) ? recentPath : [];
                const n = path.length;
                let lastLat = 0, lastLon = 0, dLat = 0.0005, dLon = 0.0005;
                if (n >= 1) { lastLat = Number(path[n - 1][0]); lastLon = Number(path[n - 1][1]); }
                if (n >= 2) {
                    const prevLat = Number(path[n - 2][0]);
                    const prevLon = Number(path[n - 2][1]);
                    dLat = lastLat - prevLat;
                    dLon = lastLon - prevLon;
                    dLat = Math.max(Math.min(dLat, 0.01), -0.01);
                    dLon = Math.max(Math.min(dLon, 0.01), -0.01);
                }
                const synth = [];
                for (let i = 1; i <= k; i++) synth.push([lastLat + dLat * i, lastLon + dLon * i]);
                const baseLat = Number(animalData.lat ?? 0);
                const baseLon = Number(animalData.lon ?? 0);
                const baseAddr = String(animalData.address || 'current area');
                const toRad = (d: number) => (d * Math.PI) / 180;
                const toDeg = (r: number) => (r * 180) / Math.PI;
                const haversineKm = (lat1: number, lon1: number, lat2: number, lon2: number) => {
                    const R = 6371;
                    const dLat = toRad(lat2 - lat1);
                    const dLon = toRad(lon2 - lon1);
                    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
                    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                    return R * c;
                };
                const bearingDeg = (lat1: number, lon1: number, lat2: number, lon2: number) => {
                    const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
                    const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
                    const brng = toDeg(Math.atan2(y, x));
                    return (brng + 360) % 360;
                };
                const dirOf = (deg: number) => {
                    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
                    const idx = Math.round(deg / 45) % 8;
                    return dirs[idx];
                };
                const enhanced = synth.map(([lat, lon]) => {
                    const d = haversineKm(baseLat, baseLon, lat, lon);
                    const b = bearingDeg(baseLat, baseLon, lat, lon);
                    const address = `${d.toFixed(1)} km ${dirOf(b)} of ${baseAddr}`;
                    return { lat, lon, address };
                });
                unstable_batchedUpdates(() => {
                    setPredictedPath(enhanced);
                    setPredictionRisk('Medium');
                    setPredictedAnimalName(animalData.name);
                    setSelectedPointIndex(null);
                    setSelectedAnimal(null);
                    setUiMode(UIMode.PREDICTION);
                });
                if (mapRef.current && enhanced.length > 0) {
                    const coords = enhanced
                        .map(p => ({ latitude: Number(p.lat), longitude: Number(p.lon) }))
                        .filter(c => Number.isFinite(c.latitude) && Number.isFinite(c.longitude));
                    const endLat = Number(animalData.lat);
                    const endLon = Number(animalData.lon);
                    if (Number.isFinite(endLat) && Number.isFinite(endLon)) coords.push({ latitude: endLat, longitude: endLon });
                    if (coords.length > 0) {
                    mapRef.current.fitToCoordinates(coords, {
                        edgePadding: { top: 100, right: 50, bottom: 250, left: 50 },
                        animated: true
                    });
                    }
                }
            }
        } catch (e) {
            console.error('[MapView] Error in prediction flow:', e);
            Alert.alert("Error", "An error occurred while fetching movement prediction.");
        } finally {
            setPredictionLoading(false);
        }
    };

    const handlePointSelect = (point: { lat: number, lon: number, address: string }, index: number) => {
        setSelectedPointIndex(index);
        if (mapRef.current) {
            mapRef.current.animateToRegion({
                latitude: point.lat,
                longitude: point.lon,
                latitudeDelta: 0.02,
                longitudeDelta: 0.02,
            }, 1000);
        }
    };

    const initialRegion = useMemo(() => {
        if (userLocation) {
            return {
                latitude: userLocation.lat,
                longitude: userLocation.lon,
                latitudeDelta: 0.1,
                longitudeDelta: 0.1,
            };
        }
        return {
            latitude: MAP_CENTER[0],
            longitude: MAP_CENTER[1],
            latitudeDelta: 0.5,
            longitudeDelta: 0.5,
        };
    }, [userLocation]);

    const effectiveLatitudeDelta = mapRegion?.latitudeDelta ?? initialRegion.latitudeDelta;
    // Relaxed zoom limit to allow viewing distant animals (e.g. Bison in US while user in India)
    const isZoomSufficient = effectiveLatitudeDelta <= 50.0;
    const showAnimalMarkers = showPredictions || isZoomSufficient;

    const handleCenterOnUser = useCallback(async () => {
        if (isCenteringOnUser || isLocationLoading) return;
        setIsCenteringOnUser(true);
        try {
            const loc = await getCurrentLocation();
            if (mapRef.current && loc) {
                mapRef.current.animateToRegion(
                    {
                        latitude: loc.lat,
                        longitude: loc.lon,
                        latitudeDelta: 0.05,
                        longitudeDelta: 0.05,
                    },
                    600
                );
            }
        } catch {
        } finally {
            setIsCenteringOnUser(false);
        }
    }, [getCurrentLocation, isCenteringOnUser, isLocationLoading]);

    const { completedPath, remainingPath } = useMemo(() => {
        if (isNavigating && safeRoute && liveLocation) {
            const completed = safeRoute.path.slice(0, closestPathIndex + 1);
            const remaining = safeRoute.path.slice(closestPathIndex);
            remaining.unshift([liveLocation.lat, liveLocation.lon]);
            return { completedPath: completed, remainingPath: remaining };
        }
        return { completedPath: [], remainingPath: safeRoute?.path || [] };
    }, [isNavigating, safeRoute, liveLocation, closestPathIndex]);

    const predictedPointsSanitized = useMemo(() => {
        return safePredictedPath
            .map((pt) => ({
                lat: Number(pt?.lat),
                lon: Number(pt?.lon),
                address: String(pt?.address || '')
            }))
            .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
    }, [safePredictedPath]);

    const predictedPolylineCoords = useMemo(() => {
        const coords = predictedPointsSanitized.map((p) => ({ latitude: p.lat, longitude: p.lon }));
        return coords.length >= 2 ? coords : DUMMY_COORDINATES_2;
    }, [predictedPointsSanitized]);

    const predictedPolylineStrokeWidth = predictedPointsSanitized.length >= 2 ? 4 : 0;

    const predictedMarkerSlots = useMemo(() => {
        const slots: { lat: number; lon: number; address: string; visible: boolean; index: number }[] = [];
        for (let i = 0; i < PREDICTION_POINT_SLOTS; i++) {
            const p = predictedPointsSanitized[i];
            if (p) {
                slots.push({ lat: p.lat, lon: p.lon, address: p.address, visible: true, index: i });
            } else {
                slots.push({ lat: 0, lon: 0, address: '', visible: false, index: i });
            }
        }
        return slots;
    }, [predictedPointsSanitized]);

    const remainingPolylineCoords = useMemo(() => {
        if (!Array.isArray(remainingPath)) return [];
        return remainingPath
            .map((p: any) => ({ latitude: Number(p?.[0]), longitude: Number(p?.[1]) }))
            .filter(c => Number.isFinite(c.latitude) && Number.isFinite(c.longitude));
    }, [remainingPath]);

    const completedPolylineCoords = useMemo(() => {
        if (!Array.isArray(completedPath)) return [];
        return completedPath
            .map((p: any) => ({ latitude: Number(p?.[0]), longitude: Number(p?.[1]) }))
            .filter(c => Number.isFinite(c.latitude) && Number.isFinite(c.longitude));
    }, [completedPath]);

    const safeRoutePolylineCoords = useMemo(() => {
        if (!safeRoute || !Array.isArray(safeRoute.path)) return [];
        return safeRoute.path
            .map((p: any) => ({ latitude: Number(p?.[0]), longitude: Number(p?.[1]) }))
            .filter(c => Number.isFinite(c.latitude) && Number.isFinite(c.longitude));
    }, [safeRoute]);

    // Map camera control
    useEffect(() => {
        if (!mapRef.current) return;
        
        if (isNavigating && liveLocation) {
            if (isApproachingStart && safeRoute && safeRoute.path.length > 0) {
                const startPoint = safeRoute.path[0];
                mapRef.current.fitToCoordinates(
                    [
                        { latitude: liveLocation.lat, longitude: liveLocation.lon },
                        { latitude: startPoint[0], longitude: startPoint[1] }
                    ],
                    { edgePadding: { top: 100, right: 50, bottom: 100, left: 50 }, animated: true }
                );
            } else {
                mapRef.current.animateToRegion({
                    latitude: liveLocation.lat,
                    longitude: liveLocation.lon,
                    latitudeDelta: 0.01,
                    longitudeDelta: 0.01,
                }, 1000);
            }
        } else if (safeRoute && safeRoute.path.length > 0) {
            const routeCoords = safeRoute.path
                .map(([lat, lon]) => ({ latitude: Number(lat), longitude: Number(lon) }))
                .filter(c => Number.isFinite(c.latitude) && Number.isFinite(c.longitude));
            const safeCoords = (Array.isArray(safePlaces) ? safePlaces : [])
                .map((p: any) => ({ latitude: Number(p?.lat), longitude: Number(p?.lon) }))
                .filter(c => Number.isFinite(c.latitude) && Number.isFinite(c.longitude));
            const coordinates = [...routeCoords, ...safeCoords];
            if (coordinates.length > 0) {
                mapRef.current.fitToCoordinates(coordinates, { edgePadding: { top: 60, right: 60, bottom: 260, left: 60 }, animated: true });
            }
        } else if (userLocation) {
            mapRef.current.animateToRegion({
                latitude: userLocation.lat,
                longitude: userLocation.lon,
                latitudeDelta: 0.1,
                longitudeDelta: 0.1,
            }, 1000);
        } else if (recentSightings.length > 0) {
            const coordinates = recentSightings.map(s => ({ latitude: s.lat, longitude: s.lon }));
            mapRef.current.fitToCoordinates(coordinates, { edgePadding: { top: 50, right: 50, bottom: 50, left: 50 }, animated: true });
        }
    }, [userLocation, safeRoute, isNavigating, liveLocation, isApproachingStart, recentSightings, safePlaces]);

    const processedSafePlaces = useMemo(() => {
        const sanitized = (Array.isArray(safePlaces) ? safePlaces : [])
            .map((p) => ({
                ...p,
                lat: Number((p as any).lat),
                lon: Number((p as any).lon),
            }))
            .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));

        if (!safeRoute) return sanitized.map(p => ({ ...p, distanceStr: undefined, durationStr: undefined }));

        const placesWithDist = sanitized.map(place => {
            const distKm = calculateMinDistanceToPolyline({ lat: place.lat, lon: place.lon }, safeRoute.path);
            return { ...place, distKm };
        });

        const maxDistKm = 5;
        const nearby = placesWithDist.filter(p => typeof p.distKm === 'number' && p.distKm <= maxDistKm);
        const selected = nearby.length > 0 ? nearby : placesWithDist.slice(0, 10);

        return selected.map(p => {
            const distKm = typeof p.distKm === 'number' ? p.distKm : undefined;
            const distMeters = typeof distKm === 'number' ? distKm * 1000 : 0;
            const durationMin = typeof distKm === 'number' ? (distKm / 5) * 60 : 0;
            return {
                ...p,
                distanceStr: typeof distKm === 'number' ? formatDistance(distMeters) : undefined,
                durationStr: typeof distKm === 'number' ? formatDuration(durationMin) : undefined
            };
        });
    }, [safePlaces, safeRoute]);

    return (
        <View style={styles.container}>
            <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
                <LoadingOverlay visible={isWildlifeLoading} message="Loading wildlife data..." />
            </View>

            {/* STABLE OVERLAYS - Always mounted, controlled by visibility */}
            <View style={[StyleSheet.absoluteFill, { opacity: uiMode === UIMode.MAP ? 1 : 0, pointerEvents: uiMode === UIMode.MAP ? 'auto' : 'none' }]}>
            </View>

            <View style={styles.header}>
                <Text style={styles.headerTitle}>Wildlife Safety Map</Text>
                <View style={styles.headerActions}>
                    <TouchableOpacity style={styles.headerButton} onPress={() => setIsFilterPanelOpen(!isFilterPanelOpen)}>
                        <FilterIcon width={22} height={22} color="#374151" />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.headerButton} onPress={() => setUiMode(UIMode.ROUTE_PLANNER)}>
                        <PaperPlaneIcon width={22} height={22} color="#374151" />
                        <Text style={styles.routeButtonText}>Route</Text>
                    </TouchableOpacity>
                </View>
            </View>

            <View style={styles.mapContainer}>
                <View style={styles.alertOverlay} pointerEvents="box-none">
                    {isNavigating && navigationAlert && (
                        <View style={styles.alertBanner}>
                            <AlertTriangleIcon width={24} height={24} color="#f59e0b" />
                            <View style={styles.alertContent}>
                                <Text style={styles.alertTitle}>Navigation Alert!</Text>
                                <Text style={styles.alertMessage}>{navigationAlert.message}</Text>
                            </View>
                            <TouchableOpacity onPress={clearNavigationAlert}>
                                <XIcon width={20} height={20} color="#6b7280" />
                            </TouchableOpacity>
                        </View>
                    )}
                </View>

                <MapView
                    ref={mapRef}
                    provider={PROVIDER_GOOGLE}
                    style={styles.map}
                    initialRegion={initialRegion}
                    showsUserLocation={!isNavigating && !!userLocation}
                    showsMyLocationButton={false}
                    onRegionChangeComplete={(region: Region) =>
                        setMapRegion({ latitudeDelta: region.latitudeDelta, longitudeDelta: region.longitudeDelta })
                    }
                >
                    <>
                    {Array.isArray(reports) ? reports.filter(r => typeof r.lat === 'number' && typeof r.lon === 'number').map(r => (
                        <Marker
                            key={`report-${r.id}`}
                            coordinate={{ latitude: r.lat as number, longitude: r.lon as number }}
                            title={r.wildlifeType || r.ai?.common || 'Report'}
                            description={r.location}
                            onPress={() => {
                                setSelectedAnimal({
                                    name: r.wildlifeType || r.ai?.common || 'Report',
                                    image_url: r.imageUri,
                                    date: r.timestamp,
                                    metadata: { scope: 'report', confidence: 'medium' },
                                    lat: r.lat as number,
                                    lon: r.lon as number,
                                    address: r.location
                                });
                                setUiMode(UIMode.DETAIL);
                            }}
                        >
                            <View style={styles.markerContainer}>
                                <Text style={styles.animalEmoji}>
                                    {(() => {
                                        const t = (r.wildlifeType || r.ai?.common || '').toLowerCase();
                                        if (t.includes('tiger')) return '🐅';
                                        if (t.includes('elephant')) return '🐘';
                                        if (t.includes('bear')) return '🐻';
                                        if (t.includes('leopard')) return '🐆';
                                        if (t.includes('gaur')) return '🐃';
                                        if (t.includes('bison')) return '🦬';
                                        return '🐾';
                                    })()}
                                </Text>
                            </View>
                            <Callout>
                                <View style={{ maxWidth: 240 }}>
                                    <Text style={{ fontWeight: 'bold' }}>{r.wildlifeType || r.ai?.common}</Text>
                                    {r.ai?.scientific ? <Text style={{ color: '#6b7280' }}>{r.ai.scientific}</Text> : null}
                                    <Text>{r.description}</Text>
                                    <Text style={{ color: '#6b7280' }}>{new Date(r.timestamp).toLocaleString()}</Text>
                                    {r.imageUri ? (
                                        <Image source={{ uri: r.imageUri }} style={{ width: 200, height: 120, marginTop: 6, borderRadius: 6 }} />
                                    ) : null}
                                </View>
                            </Callout>
                        </Marker>
                    )) : null}
                    <Marker
                        key="live-location"
                        coordinate={{
                            latitude: Number(isNavigating && liveLocation ? liveLocation.lat : 0),
                            longitude: Number(isNavigating && liveLocation ? liveLocation.lon : 0)
                        }}
                        title={isNavigating && liveLocation ? "Your Location" : ""}
                        description={isNavigating && liveLocation ? liveLocation.name : ""}
                        opacity={isNavigating && liveLocation ? 1 : 0}
                    />

                    {isNavigating && liveLocation && showNearbyRadius ? (
                        <Circle
                            center={{ latitude: liveLocation.lat, longitude: liveLocation.lon }}
                            radius={nearbyRadiusKm * 1000}
                            strokeColor="#f97316"
                            fillColor="rgba(249, 115, 22, 0.1)"
                            strokeWidth={1}
                        />
                    ) : null}

                    {/* NOTE: With Fabric (new architecture) + react-native-maps, keep MapView child hierarchy stable to avoid addViewAt crashes on Android. */}
                    {/* LSTM Predicted Path (always rendered; hidden when insufficient points) */}
                    <Polyline
                        key="predicted-path"
                        coordinates={predictedPolylineCoords}
                        strokeColor={
                            predictionRisk?.toLowerCase() === 'high' ? '#ef4444' : 
                            predictionRisk?.toLowerCase() === 'medium' ? '#f59e0b' : '#10b981'
                        }
                        strokeWidth={predictedPolylineStrokeWidth}
                        lineDashPattern={[5, 5]}
                        zIndex={10}
                    />
                    
                    {/* Predicted points (always rendered; hidden when not available) */}
                    {predictedMarkerSlots.map((p) => (
                        <Marker
                            key={`pred-point-${p.index}`}
                            coordinate={{ latitude: p.lat, longitude: p.lon }}
                            opacity={p.visible ? 1 : 0}
                            onPress={() => {
                                if (!p.visible) return;
                                handlePointSelect({ lat: p.lat, lon: p.lon, address: p.address }, p.index);
                            }}
                        >
                            {p.visible ? (
                                <Callout tooltip={true}>
                                    <View style={styles.customCallout}>
                                        <Text style={styles.calloutTitle}>Next Location #{p.index + 1}</Text>
                                        <Text style={styles.calloutDetail}>{p.address || 'Unknown forest area (coordinates available)'}</Text>
                                        <Text style={[styles.calloutDetail, { marginTop: 4, fontStyle: 'italic' }]}>
                                            Lat: {p.lat.toFixed(4)}, Lon: {p.lon.toFixed(4)}
                                        </Text>
                                    </View>
                                </Callout>
                            ) : (
                                <View />
                            )}
                            <View style={[
                                styles.indexCircle,
                                {
                                    backgroundColor:
                                        predictionRisk?.toLowerCase() === 'high' ? '#ef4444' :
                                        predictionRisk?.toLowerCase() === 'medium' ? '#f59e0b' : '#10b981',
                                    transform: [{ scale: selectedPointIndex === p.index ? 1.2 : 0.8 }],
                                    opacity: p.visible ? 1 : 0
                                }
                            ]}>
                                <Text style={styles.indexText}>{p.index + 1}</Text>
                            </View>
                        </Marker>
                    ))}

                    <>
                            <Polyline
                                key="route-full"
                                coordinates={Array.isArray(safeRoutePolylineCoords) && safeRoutePolylineCoords.length >= 2 ? safeRoutePolylineCoords : DUMMY_COORDINATES_2}
                                strokeColor="#10b981"
                                strokeWidth={!isNavigating && Array.isArray(safeRoutePolylineCoords) && safeRoutePolylineCoords.length >= 2 ? 6 : 0}
                                zIndex={1}
                            />
                            <Polyline
                                key="route-remaining"
                                coordinates={Array.isArray(remainingPolylineCoords) && remainingPolylineCoords.length >= 2 ? remainingPolylineCoords : DUMMY_COORDINATES_2}
                                strokeColor="#10b981"
                                strokeWidth={isNavigating && Array.isArray(remainingPolylineCoords) && remainingPolylineCoords.length >= 2 ? 6 : 0}
                                zIndex={1}
                            />

                            {/* Risky Segments (Red) */}
                            {Array.isArray(riskySegments) && riskySegments
                                .filter((segment: any) => Array.isArray(segment) && segment.length >= 2)
                                .map((segment: [number, number][], index: number) => (
                                <Polyline
                                    key={`risky-${segment[0]?.[0]}-${segment[0]?.[1]}-${segment[segment.length - 1]?.[0]}-${segment[segment.length - 1]?.[1]}-${index}`}
                                    coordinates={segment.map(([lat, lon]: [number, number]) => ({ latitude: lat, longitude: lon }))}
                                    strokeColor="#ef4444"
                                    strokeWidth={6}
                                    zIndex={2}
                                />
                            ))}

                            <Polyline
                                key="route-completed"
                                coordinates={Array.isArray(completedPolylineCoords) && completedPolylineCoords.length >= 2 ? completedPolylineCoords : DUMMY_COORDINATES_2}
                                strokeColor="#6b7280"
                                strokeWidth={isNavigating && Array.isArray(completedPolylineCoords) && completedPolylineCoords.length >= 2 ? 5 : 0}
                                lineDashPattern={[5, 10]}
                                zIndex={3}
                            />

                            <Marker
                                key="destination"
                                coordinate={{
                                    latitude: Number(safeRoute ? safeRoute.end.lat : 0),
                                    longitude: Number(safeRoute ? safeRoute.end.lon : 0)
                                }}
                                title={safeRoute ? "Destination" : ""}
                                description={safeRoute ? safeRoute.end.name : ""}
                                opacity={safeRoute ? 1 : 0}
                            />
                        </>

                    {/* Risk Zones Circles */}
                    {showAnimalMarkers && Array.isArray(riskZones) && riskZones
                        .filter((zone) => Number.isFinite(parseFloat(String(zone?.lat))) && Number.isFinite(parseFloat(String(zone?.lon))))
                        .map((zone, index) => {
                         const lat = parseFloat(String(zone.lat));
                         const lon = parseFloat(String(zone.lon));
                         return (
                            <Circle
                                key={`risk-circle-${zone.id || zone.scientific_name}-${index}`}
                                center={{ latitude: lat, longitude: lon }}
                                radius={(zone.alertRadius ?? 1.5) * 1000}
                                strokeColor="rgba(239, 68, 68, 0.5)"
                                fillColor="rgba(239, 68, 68, 0.1)"
                                strokeWidth={1}
                            />
                        );
                    })}

                    {/* Risk Zones Markers */}
                    {showAnimalMarkers && Array.isArray(riskZones) && riskZones
                        .filter((zone) => Number.isFinite(parseFloat(String(zone?.lat))) && Number.isFinite(parseFloat(String(zone?.lon))))
                        .map((zone, index) => {
                         const lat = parseFloat(String(zone.lat));
                         const lon = parseFloat(String(zone.lon));
                         const animalInfo = ANIMALS[zone.scientific_name];
                         const commonName = animalInfo?.common ?? zone.name ?? zone.scientific_name;
                         const emoji = animalInfo?.emoji ?? zone.emoji ?? '⚠️';
                         return (
                            <Marker
                                key={`risk-marker-${zone.id || zone.scientific_name}-${index}`}
                                coordinate={{ latitude: lat, longitude: lon }}
                                onPress={() => {
                                    setSelectedAnimal({
                                        name: commonName,
                                        image_url: zone.image_url,
                                        date: zone.eventDate,
                                        metadata: zone.metadata || { scope: 'regional', confidence: 'medium' },
                                        lat: lat,
                                        lon: lon,
                                        address: zone.address
                                    });
                                    setUiMode(UIMode.DETAIL);
                                }}
                            >
                                <View style={styles.markerContainer}>
                                    <Text style={styles.animalEmoji}>{emoji}</Text>
                                </View>
                            </Marker>
                        );
                    })}

                    {/* Safe Places */}
                    {(Array.isArray(processedSafePlaces) ? processedSafePlaces : [])
                        .filter((p: any) => Number.isFinite(Number(p?.lat)) && Number.isFinite(Number(p?.lon)))
                        .map((place: any, index: number) => (
                        <Marker
                            key={`safeplace-${place.id || `${Number(place.lat).toFixed(6)}-${Number(place.lon).toFixed(6)}-${place.name || ''}-${index}`}`}
                            coordinate={{ latitude: Number(place.lat), longitude: Number(place.lon) }}
                            zIndex={30}
                        >
                            <Text style={{ fontSize: 28 }}>
                                {place.type === 'police' ? '👮' : '🌲'}
                            </Text>
                            <Callout tooltip={true}>
                                <View style={styles.customCallout}>
                                    <Text style={styles.calloutTitle}>{place.name}</Text>
                                    <Text style={styles.calloutType}>{place.type === 'police' ? 'Police Station' : 'Forest Office'}</Text>
                                    {place.contact && <Text style={styles.calloutDetail}>Contact: {place.contact}</Text>}
                                    {place.address && <Text style={styles.calloutDetail}>Addr: {place.address}</Text>}
                                    {place.distanceStr && <Text style={styles.calloutDetail}>Dist: {place.distanceStr}</Text>}
                                    {place.durationStr && <Text style={styles.calloutDetail}>Time: {place.durationStr}</Text>}
                                </View>
                            </Callout>
                        </Marker>
                    ))}

                    {/* Recent wildlife: near-route only when we have a route; otherwise all recent */}
                    {showAnimalMarkers && !safeRoute && recentSightings
                        .filter(s => Number.isFinite(Number(s?.lat)) && Number.isFinite(Number(s?.lon)))
                        .map((sighting) => {
                         const animalInfo = ANIMALS[sighting.scientificName];
                         const commonName = animalInfo?.common ?? sighting.name;
                         const emoji = animalInfo?.emoji ?? sighting.emoji ?? '🐾';
                         const latKey = Number(sighting.lat).toFixed(6);
                         const lonKey = Number(sighting.lon).toFixed(6);
                         const dateKey = String(sighting.date || sighting.eventDate || '');
                         return (
                            <Marker
                                key={`sighting-${sighting.id || `${sighting.scientificName}-${latKey}-${lonKey}-${dateKey}`}`}
                                coordinate={{ latitude: Number(sighting.lat), longitude: Number(sighting.lon) }}
                                onPress={() => {
                                    setSelectedAnimal({
                                        name: commonName,
                                        scientificName: sighting.scientificName,
                                        image_url: sighting.image_url,
                                        date: sighting.date,
                                        metadata: sighting.metadata || { scope: 'regional', confidence: 'medium' },
                                        lat: sighting.lat,
                                        lon: sighting.lon,
                                        address: sighting.address
                                    });
                                    setUiMode(UIMode.DETAIL);
                                }}
                            >
                                <View style={styles.markerContainer}>
                                    <Text style={styles.animalEmoji}>{emoji}</Text>
                                </View>
                            </Marker>
                         );
                    })}

                    {/* Animal Clusters Polylines */}
                    {showAnimalMarkers && animalClusters.map(cluster => {
                        const pathIndex = pathIndexRef.current;
                        if (cluster.members.length === 1) {
                            const p = cluster.members[0];
                            if (!Array.isArray(p.fullPath) || p.fullPath.length < 2) return null;
                            const coords = p.fullPath
                                .slice(0, Math.min(pathIndex + 1, p.fullPath.length))
                                .map(([lat, lon]) => ({ latitude: Number(lat), longitude: Number(lon) }))
                                .filter(c => Number.isFinite(c.latitude) && Number.isFinite(c.longitude));
                            if (coords.length < 2) return null;
                            return (
                                <Polyline
                                    key={`cluster-path-${p.id}`}
                                    coordinates={coords}
                                    strokeColor={p.color}
                                    strokeWidth={4}
                                />
                            );
                        }
                        return null;
                    })}

                    {/* Animal Clusters Markers */}
                    {showAnimalMarkers && animalClusters.map(cluster => {
                        const pathIndex = pathIndexRef.current;
                        if (cluster.members.length > 1) {
                            return (
                                <Marker
                                    key={`cluster-marker-${cluster.id}`}
                                    coordinate={{ latitude: cluster.position[0], longitude: cluster.position[1] }}
                                    title={`${cluster.members.length} animals`}
                                    description={cluster.members.map(m => m.common).join(', ')}
                                >
                                    <View style={styles.clusterMarker}>
                                        <Text style={styles.clusterEmoji}>{cluster.members[0].emoji}</Text>
                                        <Text style={styles.clusterCount}>+{cluster.members.length - 1}</Text>
                                    </View>
                                </Marker>
                            );
                        } else if (cluster.members.length === 1) {
                            const p = cluster.members[0];
                            const point = Array.isArray(p.fullPath) ? p.fullPath[pathIndex] : null;
                            if (!Array.isArray(point) || point.length < 2) return null;
                            return (
                                <Marker
                                    key={`cluster-marker-single-${p.id}`}
                                    coordinate={{ latitude: point[0], longitude: point[1] }}
                                    title={p.common}
                                    description={p.current.addr}
                                    onPress={() => handleViewDetails(p)}
                                >
                                    <View style={styles.markerContainer}>
                                        <Text style={styles.animalEmoji}>{p.emoji}</Text>
                                    </View>
                                </Marker>
                            );
                        }
                        return null;
                    })}

                    </>
                </MapView>

                <TouchableOpacity
                    style={styles.playButton}
                    onPress={handleCenterOnUser}
                    disabled={isCenteringOnUser || isLocationLoading}
                >
                    {isCenteringOnUser || isLocationLoading ? (
                        <ActivityIndicator color="#374151" />
                    ) : (
                        <LocationMarkerIcon width={24} height={24} color="#374151" />
                    )}
                </TouchableOpacity>

                {isNavigating && navigationStats && (
                    <View style={styles.navigationPanel}>
                        <View style={styles.navigationStats}>
                            <Text style={styles.etaText}>{formatDuration(navigationStats.etaMinutes)}</Text>
                            <Text style={styles.distanceText}>{navigationStats.remainingKm.toFixed(1)} km remaining</Text>
                        </View>
                        <TouchableOpacity style={styles.stopButton} onPress={onStopNavigation}>
                            <StopIcon width={24} height={24} color="#ffffff" />
                        </TouchableOpacity>
                    </View>
                )}
            </View>

            <View style={styles.footer}>
                <View style={styles.footerStats}>
                    <View style={styles.statItem}>
                        <AlertTriangleIcon width={20} height={20} color="#ef4444" />
                        <Text style={styles.statText}>{safeRoute && riskZones ? riskZones.length : filteredPredictions.length} Risk Zones</Text>
                    </View>
                    <View style={styles.statItem}>
                        <Text style={{ fontSize: 16 }}>🛡️</Text>
                        <Text style={styles.statText}>{safeRoute ? 1 : 0} Safe Routes</Text>
                    </View>
                </View>
                <TouchableOpacity style={styles.planRouteButton} onPress={() => setUiMode(UIMode.ROUTE_PLANNER)}>
                    <PaperPlaneIcon width={20} height={20} color="#059669" />
                    <Text style={styles.planRouteText}>Plan Safe Route</Text>
                </TouchableOpacity>
            </View>

            {isFilterPanelOpen && (
                <Modal visible={isFilterPanelOpen} transparent animationType="slide" onRequestClose={() => setIsFilterPanelOpen(false)}>
                    <Pressable style={styles.modalOverlay} onPress={() => setIsFilterPanelOpen(false)}>
                        <Pressable style={styles.filterPanel} onPress={(e) => { if (e.stopPropagation) e.stopPropagation(); }}>
                            <View style={styles.filterHeader}>
                                <Text style={styles.filterTitle}>Filters</Text>
                                <TouchableOpacity onPress={() => setIsFilterPanelOpen(false)}>
                                    <XIcon width={24} height={24} color="#374151" />
                                </TouchableOpacity>
                            </View>
                            <ScrollView style={styles.filterContent}>
                                <View style={styles.filterRow}>
                                    <Text style={styles.filterLabel}>AI Predictions</Text>
                                    <TouchableOpacity
                                        style={[styles.toggle, showPredictions && styles.toggleActive]}
                                        onPress={() => setShowPredictions(!showPredictions)}
                                    />
                                </View>
                                <View style={styles.filterRow}>
                                    <Text style={styles.filterLabel}>Nearby Alert Zone</Text>
                                    <TouchableOpacity
                                        style={[styles.toggle, showNearbyRadius && styles.toggleActive]}
                                        onPress={() => setShowNearbyRadius(!showNearbyRadius)}
                                    />
                                </View>
                                <View style={styles.filterRow}>
                                    <Text style={styles.filterLabel}>Weather Radar</Text>
                                    <TouchableOpacity
                                        style={[styles.toggle, showWeatherOverlay && styles.toggleActive]}
                                        onPress={() => setShowWeatherOverlay(!showWeatherOverlay)}
                                    />
                                </View>
                                <Text style={styles.animalsLabel}>Visible Animals</Text>
                                {animalTypes.map(animalName => (
                                    <View key={animalName} style={styles.filterRow}>
                                        <Text style={styles.filterLabel}>{animalName}</Text>
                                        <TouchableOpacity
                                            style={[styles.checkbox, visibleAnimals[animalName] && styles.checkboxChecked]}
                                            onPress={() => handleToggleAnimal(animalName)}
                                        />
                                    </View>
                                ))}
                            </ScrollView>
                        </Pressable>
                    </Pressable>
                </Modal>
            )}

            {/* SINGLE MODAL - Android-safe architecture */}
            <Modal
                visible={uiMode !== UIMode.MAP}
                transparent={true}
                animationType="slide"
                onRequestClose={() => setUiMode(UIMode.MAP)}
            >
                <Pressable 
                    style={styles.modalOverlay}
                    onPress={() => setUiMode(UIMode.MAP)}
                >
                    <Pressable 
                        style={styles.modalContent} 
                        onPress={(e) => {
                            if (e.stopPropagation) e.stopPropagation();
                        }}
                    >
                        {/* Route Summary Content */}
                        {uiMode === UIMode.ROUTE_SUMMARY && safeRoute && (
                            <View style={styles.routeSummaryContainer}>
                                <View style={styles.routeSummaryHeader}>
                                    <Text style={styles.routeSummaryTitle}>Safe Route Found</Text>
                                    <TouchableOpacity onPress={() => setUiMode(UIMode.MAP)}>
                                        <XIcon width={24} height={24} color="#374151" />
                                    </TouchableOpacity>
                                </View>
                                
                                <View style={styles.routeSummaryStats}>
                                    <View style={styles.routeStatGroup}>
                                        <View style={styles.routeStat}>
                                            <Text style={styles.routeStatValue}>{safeRoute.distanceKm.toFixed(1)}</Text>
                                            <Text style={styles.routeStatLabel}>KM</Text>
                                        </View>
                                        <View style={styles.routeStat}>
                                            <Text style={styles.routeStatValue}>{formatDuration(safeRoute.durationMinutes)}</Text>
                                            <Text style={styles.routeStatLabel}>DURATION</Text>
                                        </View>
                                        <View style={styles.routeStat}>
                                            <Text style={[styles.routeStatValue, styles.safeValue]}>{safePlaces.length}</Text>
                                            <Text style={styles.routeStatLabel}>SAFE SPOTS</Text>
                                        </View>
                                    </View>
                                </View>
                                
                                <TouchableOpacity
                                    style={styles.startNavigationButton}
                                    onPress={() => {
                                        setUiMode(UIMode.MAP);
                                        props.onStartNavigation();
                                    }}
                                >
                                    <Text style={styles.startNavigationText}>Start Navigation</Text>
                                </TouchableOpacity>
                            </View>
                        )}

                        {/* Animal Detail Content */}
                        {uiMode === UIMode.DETAIL && selectedAnimal && (
                            <View style={styles.animalDetailSheet}>
                                <View style={styles.popupHeader}>
                                    <Text style={styles.popupTitle}>Animal Observation</Text>
                                    <TouchableOpacity onPress={() => setUiMode(UIMode.MAP)}>
                                        <XIcon width={24} height={24} color="#374151" />
                                    </TouchableOpacity>
                                </View>

                                <ScrollView contentContainerStyle={styles.animalDetailScroll} keyboardShouldPersistTaps="handled">
                                    <View style={styles.popupContent}>
                                        {selectedAnimal?.image_url ? (
                                            <Image
                                                source={{ uri: selectedAnimal.image_url }}
                                                style={styles.popupImage}
                                                resizeMode="cover"
                                            />
                                        ) : (
                                            <View style={styles.imagePlaceholder}>
                                                <Text style={styles.placeholderEmoji}>📷</Text>
                                                <Text style={styles.placeholderText}>No image available</Text>
                                            </View>
                                        )}

                                        <View style={styles.popupMeta}>
                                            <Text style={styles.popupAnimalName}>{selectedAnimal.name}</Text>

                                            {selectedAnimal.address && (
                                                <View style={styles.popupMetaRow}>
                                                    <Text style={styles.popupMetaLabel}>Address:</Text>
                                                    <Text
                                                        style={[styles.popupMetaValue, styles.popupMetaValueRight]}
                                                        numberOfLines={3}
                                                    >
                                                        {selectedAnimal.address}
                                                    </Text>
                                                </View>
                                            )}

                                            <View style={styles.popupMetaRow}>
                                                <Text style={styles.popupMetaLabel}>Confidence:</Text>
                                                <View
                                                    style={[
                                                        styles.confidenceBadge,
                                                        selectedAnimal?.metadata?.confidence === 'high'
                                                            ? styles.confidenceHigh
                                                            : selectedAnimal?.metadata?.confidence === 'medium'
                                                              ? styles.confidenceMedium
                                                              : styles.confidenceLow,
                                                    ]}
                                                >
                                                    <Text style={styles.confidenceText}>
                                                        {selectedAnimal?.metadata?.confidence || 'medium'}
                                                    </Text>
                                                </View>
                                            </View>

                                            <View style={styles.popupMetaRow}>
                                                <Text style={styles.popupMetaLabel}>Data scope:</Text>
                                                <Text style={styles.popupMetaValue}>{selectedAnimal?.metadata?.scope || 'regional'}</Text>
                                            </View>
                                        </View>
                                    </View>

                                    <TouchableOpacity
                                        style={[styles.popupCloseButton, styles.primaryActionButton]}
                                        onPress={handlePredictMovement}
                                        disabled={predictionLoading}
                                    >
                                        {predictionLoading ? (
                                            <ActivityIndicator color="#ffffff" />
                                        ) : (
                                            <View style={styles.primaryActionRow}>
                                                <InfoIcon width={20} height={20} color="#ffffff" />
                                                <Text style={styles.popupCloseButtonText}>View Prediction</Text>
                                            </View>
                                        )}
                                    </TouchableOpacity>

                                    <TouchableOpacity style={styles.popupCloseButton} onPress={() => setUiMode(UIMode.MAP)}>
                                        <Text style={styles.popupCloseButtonText}>Close</Text>
                                    </TouchableOpacity>
                                </ScrollView>
                            </View>
                        )}

                        {/* Prediction Panel Content - Conditionally mounted to avoid Android addViewAt index errors */}
                        {uiMode === UIMode.PREDICTION && (
                            <PredictionPanel 
                                animal={predictedAnimalName || 'Animal'}
                                predictedPath={safePredictedPath}
                                riskLevel={predictionRisk || 'Low'}
                                onClose={() => {
                                    console.log('[MapView] Closing prediction panel');
                                    setUiMode(UIMode.MAP);
                                    setPredictedPath([]);
                                }}
                                onPointSelect={handlePointSelect}
                                selectedPointIndex={selectedPointIndex}
                            />
                        )}

                        {/* Route Planner Content */}
                        {uiMode === UIMode.ROUTE_PLANNER && (
                            <RoutePlannerSheet
                                isOpen={true}
                                onClose={() => setUiMode(UIMode.MAP)}
                                onCalculateSafeRoute={onCalculateSafeRoute}
                                routeStatus={routeStatus}
                                routeMessage={routeMessage}
                                suggestions={suggestions}
                                isSuggesting={isSuggesting}
                                onFetchSuggestions={onFetchSuggestions}
                                onClearSuggestions={onClearSuggestions}
                                getCurrentLocation={getCurrentLocation}
                                nearbyRadiusKm={nearbyRadiusKm}
                                isLocationLoading={isLocationLoading}
                                isRouteLoading={isRouteLoading}
                                initialStartQuery={props.initialRouteStart}
                                initialDestQuery={props.initialRouteEnd}
                            />
                        )}
                    </Pressable>
                </Pressable>
            </Modal>

        </View>
    );
};

export default React.memo(MapViewComponent);

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#ffffff',
    },
    noWildlifeContainer: {
        position: 'absolute',
        top: 100,
        alignSelf: 'center',
        backgroundColor: '#ffffff',
        paddingVertical: 10,
        paddingHorizontal: 20,
        borderRadius: 20,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 4,
        elevation: 3,
        zIndex: 100,
        pointerEvents: 'none',
    },
    noWildlifeText: {
        color: '#6b7280',
        fontWeight: '600',
        fontSize: 14,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
        backgroundColor: '#ffffff',
    },
    headerTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#1f2937',
    },
    headerActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    headerButton: {
        padding: 8,
        borderRadius: 8,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    routeButtonText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#374151',
    },
    mapContainer: {
        flex: 1,
        position: 'relative',
    },
    map: {
        flex: 1,
    },
    alertBanner: {
        position: 'absolute',
        top: 16,
        left: 16,
        right: 16,
        backgroundColor: '#ffffff',
        borderRadius: 12,
        padding: 16,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        zIndex: 1000,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 8,
        elevation: 5,
    },
    alertContent: {
        flex: 1,
    },
    alertTitle: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#1f2937',
    },
    alertMessage: {
        fontSize: 14,
        color: '#4b5563',
        marginTop: 4,
    },
    clusterMarker: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    clusterEmoji: {
        fontSize: 24,
    },
    clusterCount: {
        fontSize: 12,
        fontWeight: 'bold',
        backgroundColor: '#374151',
        color: '#ffffff',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 10,
        marginTop: -8,
    },
    animalEmoji: {
        fontSize: 32,
    },
    markerContainer: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    indexCircle: {
        width: 24,
        height: 24,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 2,
        borderColor: '#ffffff',
    },
    indexText: {
        color: '#ffffff',
        fontSize: 12,
        fontWeight: 'bold',
    },
    customCallout: {
        backgroundColor: '#ffffff',
        borderRadius: 12,
        padding: 12,
        width: 200,
        borderWidth: 1,
        borderColor: '#e5e7eb',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
        elevation: 5,
    },
    calloutTitle: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#1f2937',
        marginBottom: 4,
    },
    calloutType: {
        fontSize: 14,
        color: '#6b7280',
        marginBottom: 8,
    },
    calloutDetail: {
        fontSize: 12,
        color: '#4b5563',
    },
    calloutImage: {
        width: 150,
        height: 100,
        marginTop: 8,
        marginBottom: 8,
        borderRadius: 8,
        backgroundColor: '#f3f4f6', // Placeholder color while loading
    },
    playButton: {
        position: 'absolute',
        bottom: 100,
        right: 16,
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: '#ffffff',
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 8,
        elevation: 5,
    },
    navigationPanel: {
        position: 'absolute',
        bottom: 20,
        left: 20,
        right: 20,
        backgroundColor: '#ffffff',
        borderRadius: 16,
        padding: 20,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 10,
        elevation: 8,
    },
    navigationStats: {
        flex: 1,
        paddingRight: 16,
    },
    etaText: {
        fontSize: 28,
        fontWeight: 'bold',
        color: '#1f2937',
        letterSpacing: -0.5,
    },
    distanceText: {
        fontSize: 15,
        color: '#6b7280',
        fontWeight: '600',
        marginTop: 2,
        textTransform: 'lowercase',
    },
    stopButton: {
        width: 52,
        height: 52,
        borderRadius: 26,
        backgroundColor: '#dc2626',
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#dc2626',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.4,
        shadowRadius: 4,
        elevation: 4,
    },
    footer: {
        padding: 16,
        backgroundColor: '#ffffff',
        borderTopWidth: 1,
        borderTopColor: '#e5e7eb',
    },
    footerStats: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        alignItems: 'center',
        marginBottom: 12,
    },
    statItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    statText: {
        fontSize: 14,
        color: '#374151',
        fontWeight: '600',
    },
    planRouteButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#ecfdf5',
        paddingVertical: 12,
        borderRadius: 8,
        borderWidth: 2,
        borderColor: '#059669',
        gap: 8,
    },
    planRouteText: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#059669',
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'flex-end',
    },
    modalContent: {
        backgroundColor: '#ffffff',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        maxHeight: '80%',
    },
    routeSummaryContainer: {
        backgroundColor: '#ffffff',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        padding: 20,
    },
    routeSummaryHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
    },
    routeSummaryTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#1f2937',
    },
    filterPanel: {
        backgroundColor: '#ffffff',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        maxHeight: '80%',
    },
    filterHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
    },
    filterTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#1f2937',
    },
    filterContent: {
        padding: 16,
    },
    filterRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#f3f4f6',
    },
    filterLabel: {
        fontSize: 14,
        fontWeight: '600',
        color: '#374151',
    },
    animalsLabel: {
        fontSize: 14,
        fontWeight: '600',
        color: '#374151',
        marginTop: 8,
        marginBottom: 8,
    },
    toggle: {
        width: 44,
        height: 24,
        borderRadius: 12,
        backgroundColor: '#e5e7eb',
        position: 'relative',
    },
    toggleActive: {
        backgroundColor: '#10b981',
    },
    checkbox: {
        width: 20,
        height: 20,
        borderRadius: 4,
        borderWidth: 2,
        borderColor: '#d1d5db',
    },
    checkboxChecked: {
        backgroundColor: '#10b981',
        borderColor: '#10b981',
    },

    routeSummaryStats: {
        flexDirection: 'column',
        backgroundColor: '#f9fafb',
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
        gap: 16,
    },
    routeStatGroup: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        alignItems: 'center',
    },
    routeStatDivider: {
        height: 1,
        backgroundColor: '#e5e7eb',
        marginHorizontal: 8,
    },
    routeStat: {
        alignItems: 'center',
        flex: 1,
    },
    routeStatValue: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#1f2937',
        textAlign: 'center',
    },
    riskValue: {
        color: '#ef4444',
    },
    safeValue: {
        color: '#2563eb',
    },
    routeStatLabel: {
        fontSize: 11,
        color: '#6b7280',
        fontWeight: '600',
        marginTop: 4,
        letterSpacing: 0.5,
    },
    startNavigationButton: {
        backgroundColor: '#10b981',
        paddingVertical: 12,
        borderRadius: 8,
        alignItems: 'center',
    },
    startNavigationText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#ffffff',
    },
    routePlannerSheet: {
        flexGrow: 1,
    },
    routePlannerHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
    },
    routePlannerTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#1f2937',
    },
    routePlannerContent: {
        padding: 16,
    },
    inputGroup: {
        marginBottom: 16,
    },
    inputLabel: {
        fontSize: 14,
        fontWeight: '600',
        color: '#374151',
        marginBottom: 8,
    },
    inputRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    textInput: {
        flex: 1,
        backgroundColor: '#f3f4f6',
        borderWidth: 1,
        borderColor: '#d1d5db',
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
        fontSize: 14,
        color: '#1f2937',
    },
    locationButton: {
        padding: 10,
        backgroundColor: '#e5e7eb',
        borderRadius: 8,
    },
    suggestionsList: {
        marginTop: 8,
        backgroundColor: '#ffffff',
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#e5e7eb',
        maxHeight: 200,
    },
    suggestionItem: {
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#f3f4f6',
    },
    suggestionText: {
        fontSize: 14,
        color: '#374151',
    },
    travelModeContainer: {
        flexDirection: 'row',
        backgroundColor: '#f3f4f6',
        borderRadius: 8,
        padding: 4,
        marginBottom: 16,
    },
    travelModeButton: {
        flex: 1,
        paddingVertical: 8,
        alignItems: 'center',
        borderRadius: 6,
    },
    travelModeButtonActive: {
        backgroundColor: '#ffffff',
    },
    travelModeText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#6b7280',
    },
    travelModeTextActive: {
        color: '#10b981',
    },
    submitButton: {
        backgroundColor: '#10b981',
        paddingVertical: 12,
        borderRadius: 8,
        alignItems: 'center',
        marginBottom: 16,
    },
    submitButtonDisabled: {
        backgroundColor: '#9ca3af',
    },
    submitButtonText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#ffffff',
    },
    errorContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#fef2f2',
        padding: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#fecaca',
        gap: 8,
    },
    errorText: {
        flex: 1,
        fontSize: 14,
        color: '#dc2626',
    },
    animalDetailSheet: {
        padding: 20,
    },
    animalDetailScroll: {
        paddingBottom: 8,
    },
    popupHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 15,
    },
    popupTitle: {
        fontSize: 14,
        fontWeight: '600',
        color: '#6b7280',
        textTransform: 'uppercase',
        letterSpacing: 1,
    },
    popupContent: {
        flexDirection: 'column',
    },
    popupImage: {
        width: '100%',
        height: 180,
        borderRadius: 12,
        marginBottom: 15,
        backgroundColor: '#f3f4f6',
    },
    imagePlaceholder: {
        width: '100%',
        height: 180,
        borderRadius: 12,
        marginBottom: 15,
        backgroundColor: '#f3f4f6',
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#e5e7eb',
        borderStyle: 'dashed',
    },
    placeholderEmoji: {
        fontSize: 32,
        marginBottom: 8,
    },
    placeholderText: {
        fontSize: 14,
        color: '#9ca3af',
        fontWeight: '500',
    },
    popupInfo: {
        gap: 8,
    },
    popupAnimalName: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#1f2937',
        marginBottom: 10,
    },
    popupMeta: {
        gap: 8,
    },
    popupMetaRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    popupMetaLabel: {
        fontSize: 14,
        color: '#6b7280',
    },
    popupMetaValue: {
        fontSize: 14,
        fontWeight: '500',
        color: '#374151',
    },
    popupMetaValueRight: {
        flex: 1,
        textAlign: 'right',
        marginLeft: 12,
    },
    confidenceBadge: {
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 6,
    },
    confidenceHigh: {
        backgroundColor: '#d1fae5',
    },
    confidenceMedium: {
        backgroundColor: '#fef3c7',
    },
    confidenceLow: {
        backgroundColor: '#fee2e2',
    },
    confidenceText: {
        fontSize: 12,
        fontWeight: '600',
        textTransform: 'capitalize',
    },
    popupCloseButton: {
        marginTop: 20,
        backgroundColor: '#1f2937',
        paddingVertical: 12,
        borderRadius: 10,
        alignItems: 'center',
    },
    primaryActionButton: {
        marginBottom: 10,
        backgroundColor: '#059669',
    },
    primaryActionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    popupCloseButtonText: {
        color: '#ffffff',
        fontSize: 16,
        fontWeight: '600',
    },
    predictionWrapper: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 2000,
    },
    overlayContainer: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 100,
    },
    alertOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 1000,
    },
});
