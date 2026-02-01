import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, Dimensions, Platform, Image, ActivityIndicator, Modal, TouchableOpacity, TextInput, ScrollView, Alert, Pressable } from 'react-native';
import MapView, { Marker, Polyline, Circle, PROVIDER_GOOGLE, Callout, type Region } from 'react-native-maps';
import type { AnimalPrediction, Location, Route, NavigationStats, NavigationAlert, SafePlace, TravelMode } from '../types';
import { AppState, UIMode } from '../types';
import { MAP_CENTER, MAP_ZOOM, ANIMATION_STEPS, ANIMALS } from '../constants';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { FilterIcon, PlayIcon, PauseIcon, AlertTriangleIcon, InfoIcon, StopIcon, XIcon, PaperPlaneIcon, SpinnerIcon, ErrorIcon, LocationMarkerIcon, SyncIcon, RainIcon, CarIcon, WalkIcon, BikeIcon, BusIcon } from './icons';
import AnimalDetailModal from './AnimalDetailModal';
import { LoadingOverlay } from './LoadingOverlay';
import * as api from '../services/apiService';
import { fetchLatestSightings, type FirestoreSighting } from '../services/firestoreService';
import { clusterAnimals, type AnimalCluster } from '../utils/clustering';
import { formatDistance, formatDuration, calculateMinDistanceToPolyline } from '../services/geoService';
import PredictionPanel from './PredictionPanel';

const easeInOutSine = (x: number): number => -(Math.cos(Math.PI * x) - 1) / 2;


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
}

const RoutePlannerSheet: React.FC<RoutePlannerSheetProps> = ({
    isOpen, onClose, onCalculateSafeRoute, routeStatus, routeMessage,
    suggestions, isSuggesting, onFetchSuggestions, onClearSuggestions,
    getCurrentLocation, nearbyRadiusKm, isLocationLoading, isRouteLoading
}) => {
    const [startQuery, setStartQuery] = useState('');
    const [destQuery, setDestQuery] = useState('');
    const [selectedStart, setSelectedStart] = useState<Location | null>(null);
    const [selectedDest, setSelectedDest] = useState<Location | null>(null);
    const [activeInput, setActiveInput] = useState<'start' | 'dest' | null>(null);
    const [localError, setLocalError] = useState('');
    const [travelMode, setTravelMode] = useState<TravelMode>('car');
    const [isLocatingStart, setIsLocatingStart] = useState(false);

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
}

const MapViewComponent: React.FC<MapViewProps> = (props) => {
    const { 
        userLocation, predictions, animationProgress, nearbyRadiusKm, 
        safeRoute, safePlaces, riskZones, riskySegments, isNavigating, liveLocation, navigationStats, 
        onStopNavigation, navigationAlert, clearNavigationAlert, closestPathIndex,
        isPlaying, onPlay, onPause, isApproachingStart,
        onCalculateSafeRoute, routeStatus, routeMessage, suggestions,
        isSuggesting, onFetchSuggestions, onClearSuggestions, getCurrentLocation,
        recentSightings, isWildlifeLoading, isLocationLoading, isRouteLoading
    } = props;
    
    const mapRef = useRef<MapView>(null);
    const [uiMode, setUiMode] = useState<UIMode>(UIMode.MAP);
    const [animalClusters, setAnimalClusters] = useState<AnimalCluster[]>([]);
    const [selectedAnimal, setSelectedAnimal] = useState<{
        name: string;
        image_url?: string;
        date: string;
        metadata: { scope: string; confidence: string };
        lat: number;
        lon: number;
        address?: string;
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
    const [predictedPath, setPredictedPath] = useState<{ lat: number, lon: number, address: string }[] | null>(null);
    const safePredictedPath = useMemo(() => Array.isArray(predictedPath) ? predictedPath : [], [predictedPath]);
    const [predictionLoading, setPredictionLoading] = useState(false);
    const [predictionRisk, setPredictionRisk] = useState<string | null>(null);
    const [predictedAnimalName, setPredictedAnimalName] = useState<string>('');
    const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null);
    const [firestoreSightings, setFirestoreSightings] = useState<FirestoreSighting[]>([]);

    const animalTypes = useMemo(() => Array.from(new Set(predictions.map(p => p.common))).sort(), [predictions]);

    // Fetch latest Firestore sightings on mount
    useEffect(() => {
        const loadFirestoreData = async () => {
            const sightings = await fetchLatestSightings(5); // Fetch top 5 latest
            setFirestoreSightings(sightings);
        };
        loadFirestoreData();
        // Refresh every 5 minutes
        const interval = setInterval(loadFirestoreData, 5 * 60 * 1000);
        return () => clearInterval(interval);
    }, []);

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
        console.log(`[MapView] Fetching prediction for ${selectedAnimal.name} from Firestore`);
        
        // Capture animal data before clearing state
        const animalData = { ...selectedAnimal };
        
        try {
            // 1. Try to find the latest prediction in Firestore for this specific animal
            const animalSighting = firestoreSightings.find(s => s.animal === animalData.name);
            
            if (animalSighting && animalSighting.predicted_path) {
                console.log(`[MapView] Found Firestore prediction for ${animalData.name}`);
                
                // Close observation popup first
                setUiMode(UIMode.MAP);
                
                // Small delay to ensure smooth modal transition
                setTimeout(() => {
                    setPredictedPath(animalSighting.predicted_path);
                    setPredictionRisk(animalSighting.risk);
                    setPredictedAnimalName(animalData.name);
                    setSelectedPointIndex(null);
                    setUiMode(UIMode.PREDICTION);
                    
                    // Fit map to prediction
                    if (mapRef.current && animalSighting.predicted_path.length > 0) {
                         const coords = animalSighting.predicted_path.map(p => ({ latitude: p.lat, longitude: p.lon }));
                         coords.push({ latitude: animalData.lat, longitude: animalData.lon });
                         mapRef.current.fitToCoordinates(coords, {
                             edgePadding: { top: 100, right: 50, bottom: 250, left: 50 },
                             animated: true
                         });
                    }
                }, 300); // 300ms delay to ensure smooth modal transition
                
            } else {
                // 2. Fallback to API if not in Firestore (maybe it's a new sighting)
                console.log(`[MapView] No Firestore prediction found, falling back to API for ${animalData.name}`);
                
                const animalLat = animalData.lat ?? 0;
                const animalLon = animalData.lon ?? 0;
                const recentPath: [number, number][] = [[animalLat, animalLon]];
                
                const result = await api.predictMovement(
                    animalData.name,
                    userLocation,
                    recentPath,
                    3 // k_future
                );
                
                if (result && result.predicted_path) {
                    // Close observation popup first
                    setUiMode(UIMode.MAP);
                    
                    setTimeout(() => {
                        setPredictedPath(result.predicted_path);
                        setPredictionRisk(result.risk_level);
                        setPredictedAnimalName(animalData.name);
                        setSelectedPointIndex(null);
                        setUiMode(UIMode.PREDICTION);
                        
                        if (result.status === 'degraded') {
                            console.warn(`[MapView] Prediction received in degraded mode: ${result.message || 'Check logs'}`);
                        }
                        
                        // Fit map to prediction
                        if (mapRef.current && result.predicted_path.length > 0) {
                             const coords = result.predicted_path.map(p => ({ latitude: p.lat, longitude: p.lon }));
                             coords.push({ latitude: animalData.lat, longitude: animalData.lon });
                             mapRef.current.fitToCoordinates(coords, {
                                 edgePadding: { top: 100, right: 50, bottom: 250, left: 50 },
                                 animated: true
                             });
                        }
                    }, 300);
                    
                } else {
                    // Even if prediction fails, show the panel with empty data for fallback UI
                    setUiMode(UIMode.MAP);
                    
                    setTimeout(() => {
                        setPredictedPath([]);
                        setPredictionRisk('Unknown');
                        setPredictedAnimalName(animalData.name);
                        setSelectedPointIndex(null);
                        setUiMode(UIMode.PREDICTION);
                        console.log("[MapView] Prediction unavailable - showing fallback panel");
                    }, 300);
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
    const isZoomSufficient = effectiveLatitudeDelta <= 0.08;
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
            const coordinates = safeRoute.path.map(([lat, lon]) => ({ latitude: lat, longitude: lon }));
            mapRef.current.fitToCoordinates(coordinates, { edgePadding: { top: 50, right: 50, bottom: 50, left: 50 }, animated: true });
        } else if (userLocation) {
            mapRef.current.animateToRegion({
                latitude: userLocation.lat,
                longitude: userLocation.lon,
                latitudeDelta: 0.1,
                longitudeDelta: 0.1,
            }, 1000);
        }
    }, [userLocation, safeRoute, isNavigating, liveLocation, isApproachingStart]);

    const processedSafePlaces = useMemo(() => {
        if (!safeRoute) return safePlaces.map(p => ({ ...p, distanceStr: undefined, durationStr: undefined }));

        const placesWithDist = safePlaces.map(place => {
            const distKm = calculateMinDistanceToPolyline({lat: place.lat, lon: place.lon}, safeRoute.path);
            return { ...place, distKm };
        });

        const filtered = placesWithDist.filter(p => p.distKm <= 1);

        return filtered.map(p => {
             const distMeters = p.distKm * 1000;
             const durationMin = (p.distKm / 5) * 60; 
             
             return {
                 ...p,
                 distanceStr: formatDistance(distMeters),
                 durationStr: formatDuration(durationMin)
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
                    {isNavigating && liveLocation && (
                        <Marker
                            coordinate={{ latitude: liveLocation.lat, longitude: liveLocation.lon }}
                            title="Your Location"
                            description={liveLocation.name}
                        />
                    )}

                    {isNavigating && liveLocation && showNearbyRadius && (
                        <Circle
                            center={{ latitude: liveLocation.lat, longitude: liveLocation.lon }}
                            radius={nearbyRadiusKm * 1000}
                            strokeColor="#f97316"
                            fillColor="rgba(249, 115, 22, 0.1)"
                            strokeWidth={1}
                        />
                    )}

                    {/* LSTM Predicted Path */}
                    {safePredictedPath.length > 0 && (
                        <Polyline
                            coordinates={safePredictedPath.map(pt => ({ latitude: pt.lat, longitude: pt.lon }))}
                            strokeColor={
                                predictionRisk?.toLowerCase() === 'high' ? '#ef4444' : 
                                predictionRisk?.toLowerCase() === 'medium' ? '#f59e0b' : '#10b981'
                            }
                            strokeWidth={4}
                            lineDashPattern={[5, 5]}
                            zIndex={10}
                        />
                    )}
                    
                    {safePredictedPath.length > 0 && safePredictedPath.map((p, i) => (
                        <Marker
                            key={`pred-marker-${i}`}
                            coordinate={{ latitude: p.lat, longitude: p.lon }}
                            onPress={() => handlePointSelect(p, i)}
                        >
                            <Callout tooltip={true}>
                                <View style={styles.customCallout}>
                                    <Text style={styles.calloutTitle}>Next Location #{i + 1}</Text>
                                    <Text style={styles.calloutDetail}>{p.address || 'Unknown forest area (coordinates available)'}</Text>
                                    <Text style={[styles.calloutDetail, { marginTop: 4, fontStyle: 'italic' }]}>
                                        Lat: {p.lat.toFixed(4)}, Lon: {p.lon.toFixed(4)}
                                    </Text>
                                </View>
                            </Callout>
                            <View style={[
                                styles.indexCircle, 
                                { 
                                    backgroundColor: 
                                        predictionRisk?.toLowerCase() === 'high' ? '#ef4444' : 
                                        predictionRisk?.toLowerCase() === 'medium' ? '#f59e0b' : '#10b981',
                                    transform: [{ scale: selectedPointIndex === i ? 1.2 : 0.8 }]
                                }
                            ]}>
                                <Text style={styles.indexText}>{i + 1}</Text>
                            </View>
                        </Marker>
                    ))}

                    {safeRoute && (
                        <>
                            {/* Base Safe Route (Green) */}
                            <Polyline
                                coordinates={safeRoute.path.map(([lat, lon]) => ({ latitude: lat, longitude: lon }))}
                                strokeColor="#10b981"
                                strokeWidth={6}
                                zIndex={1}
                            />

                            {/* Risky Segments (Red) */}
                            {riskySegments && riskySegments.map((segment: [number, number][], index: number) => (
                                <Polyline
                                    key={`risky-${index}`}
                                    coordinates={segment.map(([lat, lon]: [number, number]) => ({ latitude: lat, longitude: lon }))}
                                    strokeColor="#ef4444"
                                    strokeWidth={6}
                                    zIndex={2}
                                />
                            ))}

                            {isNavigating ? (
                                <Polyline
                                    coordinates={completedPath.map(([lat, lon]) => ({ latitude: lat, longitude: lon }))}
                                    strokeColor="#6b7280"
                                    strokeWidth={5}
                                    lineDashPattern={[5, 10]}
                                    zIndex={3}
                                />
                            ) : null}

                            <Marker
                                coordinate={{ latitude: safeRoute.end.lat, longitude: safeRoute.end.lon }}
                                title="Destination"
                                description={safeRoute.end.name}
                            />
                        </>
                    )}

                    {/* Risk Zones Circles */}
                    {showAnimalMarkers && riskZones && riskZones.map((zone, index) => {
                         const lat = parseFloat(String(zone.lat));
                         const lon = parseFloat(String(zone.lon));
                         if (isNaN(lat) || isNaN(lon)) return null;
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
                    {showAnimalMarkers && riskZones && riskZones.map((zone, index) => {
                         const lat = parseFloat(String(zone.lat));
                         const lon = parseFloat(String(zone.lon));
                         if (isNaN(lat) || isNaN(lon)) return null;
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
                    {processedSafePlaces.map(place => (
                        <Marker
                            key={place.id}
                            coordinate={{ latitude: place.lat, longitude: place.lon }}
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
                    {showAnimalMarkers && !safeRoute && recentSightings.map((sighting) => {
                         const animalInfo = ANIMALS[sighting.scientificName];
                         const commonName = animalInfo?.common ?? sighting.name;
                         const emoji = animalInfo?.emoji ?? sighting.emoji ?? '🐾';
                         return (
                            <Marker
                                key={`marker-${sighting.id || sighting.scientificName}`}
                                coordinate={{ latitude: sighting.lat, longitude: sighting.lon }}
                                onPress={() => {
                                    setSelectedAnimal({
                                        name: commonName,
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
                            return (
                                <Polyline
                                    key={`cluster-path-${p.id}`}
                                    coordinates={p.fullPath.slice(0, pathIndex + 1).map(([lat, lon]) => ({ latitude: lat, longitude: lon }))}
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
                            return (
                                <Marker
                                    key={`cluster-marker-single-${p.id}`}
                                    coordinate={{ latitude: p.fullPath[pathIndex][0], longitude: p.fullPath[pathIndex][1] }}
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
                <Modal visible={isFilterPanelOpen} transparent animationType="slide">
                    <View style={styles.modalOverlay}>
                        <View style={styles.filterPanel}>
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
                        </View>
                    </View>
                </Modal>
            )}

            {/* SINGLE MODAL - Android-safe architecture */}
            <Modal
                visible={uiMode !== UIMode.MAP}
                transparent={true}
                animationType="slide"
                onRequestClose={() => setUiMode(UIMode.MAP)}
            >
                <TouchableOpacity 
                    style={styles.modalOverlay} 
                    activeOpacity={1} 
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

                        {/* Prediction Panel Content - STABLE: never unmounted */}
                        {uiMode === UIMode.PREDICTION && (
                            <PredictionPanel 
                                visible={true} /* Always visible when in PREDICTION mode */
                                animal={predictedAnimalName || 'Animal'}
                                predictedPath={safePredictedPath}
                                riskLevel={predictionRisk || 'Low'}
                                onClose={() => {
                                    console.log('[MapView] Closing prediction panel');
                                    setUiMode(UIMode.MAP);
                                    setPredictedPath(null);
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
                            />
                        )}
                    </Pressable>
                </TouchableOpacity>
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
