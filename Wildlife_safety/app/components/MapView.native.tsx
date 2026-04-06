import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, Dimensions, Platform, Image, ActivityIndicator, Modal, TouchableOpacity, TextInput, ScrollView, Alert, Pressable, unstable_batchedUpdates, Animated } from 'react-native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { Marker, Polyline, Circle, PROVIDER_GOOGLE, Callout, type Region } from 'react-native-maps';
import type { AnimalPrediction, Location, Route, NavigationStats, NavigationAlert, SafePlace, TravelMode, Report } from '../types';
import { AppState, UIMode } from '../types';
import { MAP_CENTER, MAP_ZOOM, ANIMATION_STEPS, ANIMALS, canonicalScientific } from '../constants';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { API_BASE_URL, CONFIG } from '../config';
import { FilterIcon, PlayIcon, PauseIcon, AlertTriangleIcon, InfoIcon, StopIcon, XIcon, PaperPlaneIcon, SpinnerIcon, ErrorIcon, LocationMarkerIcon, SyncIcon, RainIcon, CarIcon, WalkIcon, BikeIcon, BusIcon, ChartIcon } from './icons';
import { LoadingOverlay } from './LoadingOverlay';
import * as api from '../services/apiService';
import { formatDistance, formatDuration, formatArrivalTime, calculateMinDistanceToPolyline } from '../services/geoService';
import PredictionPanel from './PredictionPanel';
import { useAppContext } from '../contexts/AppContext';
import { stableRoutePathKey, stableJsonKey } from '../utils/stableKeys';
import { safeArray } from '../utils/safety';

const easeInOutSine = (x: number): number => -(Math.cos(Math.PI * x) - 1) / 2;

const DUMMY_COORDINATES_2 = [
    { latitude: 0, longitude: 0 },
    { latitude: 0, longitude: 0 }
];

const BOTTOM_TAB_HEIGHT = 80;

/** Shown when live API data is empty so the map always has at least one marker for demos. */
const FALLBACK_REPORTS: Report[] = [
    {
        id: 'demo-report-1',
        wildlifeType: 'Elephant',
        location: 'Chennai (demo)',
        description: 'Demo observation when offline or no API data',
        timestamp: new Date().toISOString(),
        lat: 13.0827,
        lon: 80.2707,
    },
];

const FALLBACK_SAFE_PLACES: SafePlace[] = [
    {
        id: 900001,
        lat: 13.08,
        lon: 80.27,
        type: 'ranger',
        name: 'Safe Zone (demo)',
    },
];

const FALLBACK_WILDLIFE_SIGHTING = {
    id: 'demo-sighting-1',
    scientificName: 'Elephas maximus',
    scientific_name: 'Elephas maximus',
    lat: 13.0827,
    lon: 80.2707,
};

const PREDICTION_POINT_SLOTS = 3;


// Route Planner Sheet Component
interface RoutePlannerSheetProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess?: () => void;
    onCalculateSafeRoute?: (start: Location | string, end: Location | string, radius: number, mode: TravelMode) => Promise<Route | null>;
    routeStatus?: AppState;
    routeMessage?: string;
    suggestions?: Location[];
    isSuggesting?: boolean;
    onFetchSuggestions?: (query: string) => void;
    onClearSuggestions?: () => void;
    searchError?: string | null;
    getCurrentLocation?: () => Promise<Location>;
    nearbyRadiusKm?: number;
    isLocationLoading?: boolean;
    isRouteLoading?: boolean;
    initialStartQuery?: string;
    initialDestQuery?: string;
}

const RoutePlannerSheet: React.FC<RoutePlannerSheetProps> = ({
    isOpen, onClose, onSuccess, onCalculateSafeRoute, routeStatus, routeMessage,
    suggestions = [], isSuggesting = false, onFetchSuggestions, onClearSuggestions, searchError,
    getCurrentLocation, nearbyRadiusKm = 5, isLocationLoading = false, isRouteLoading = false,
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
    ];

    const isFetchingLocation = useRef(false);

    const handleUseMyLocation = useCallback(async () => {
        if (isFetchingLocation.current || isLocatingStart || isLocationLoading || isRouteLoading) return;
        
        isFetchingLocation.current = true;
        setIsLocatingStart(true);
        if (onClearSuggestions) onClearSuggestions();
        setActiveInput(null);
        
        try {
            await new Promise(resolve => setTimeout(resolve, 900));
            const location = await getCurrentLocation?.();
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
        if (onClearSuggestions) onClearSuggestions();
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

        if (startInput && endInput && onCalculateSafeRoute) {
            const newRoute = await onCalculateSafeRoute(startInput, endInput, nearbyRadiusKm, travelMode);
            if (newRoute) {
                setStartQuery('');
                setDestQuery('');
                setSelectedStart(null);
                setSelectedDest(null);
                if (onClearSuggestions) onClearSuggestions();
                if (typeof onSuccess === 'function') {
                    onSuccess();
                } else {
                    onClose();
                }
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
                                if (onFetchSuggestions) onFetchSuggestions(text);
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
                    {activeInput === 'start' && safeArray<Location>(suggestions).length > 0 && (
                        <View style={styles.suggestionsList}>
                            {safeArray<Location>(suggestions).map((s) => (
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
                            if (onFetchSuggestions) onFetchSuggestions(text);
                        }}
                        onFocus={() => setActiveInput('dest')}
                        placeholder="Enter destination"
                    />
                    {activeInput === 'dest' && safeArray<Location>(suggestions).length > 0 && (
                        <View style={styles.suggestionsList}>
                            {safeArray<Location>(suggestions).map((s) => (
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
                {(localError || searchError || (routeStatus === AppState.ERROR && routeMessage)) && (
                    <View style={styles.errorContainer}>
                        <ErrorIcon width={20} height={20} color="#ef4444" />
                        <Text style={styles.errorText}>{localError || searchError || routeMessage}</Text>
                    </View>
                )}
            </ScrollView>
        </View>
    );
};


interface MapViewProps {
    status?: AppState;
    message?: string;
    userLocation?: Location | null;
    predictions?: AnimalPrediction[];
    safeRoute?: Route | null;
    safePlaces?: SafePlace[];
    riskZones?: any[];
    riskySegments?: any[];
    onLocationSubmit?: (location: string) => void;
    suggestions?: Location[];
    isSuggesting?: boolean;
    onFetchSuggestions?: (query: string) => void;
    onClearSuggestions?: () => void;
    searchError?: string | null;
    routeStatus?: AppState;
    routeMessage?: string;
    onCalculateSafeRoute?: (start: Location | string, end: Location | string, radius: number, mode: TravelMode) => Promise<Route | null>;
    getCurrentLocation?: () => Promise<Location>;
    isNavigating?: boolean;
    liveLocation?: Location | null;
    navigationStats?: NavigationStats | null;
    onStartNavigation?: () => void;
    onStopNavigation?: () => void;
    navigationAlert?: NavigationAlert | null;
    clearNavigationAlert?: () => void;
    closestPathIndex?: number;
    animationProgress?: number;
    isPlaying?: boolean;
    onPlay?: () => void;
    onPause?: () => void;
    nearbyRadiusKm?: number;
    isApproachingStart?: boolean;
    recentSightings?: any[];
    isWildlifeLoading?: boolean;
    isLocationLoading?: boolean;
    isRouteLoading?: boolean;
    reports?: Report[];
    initialRouteStart?: string;
    initialRouteEnd?: string;
    onRouteHandled?: () => void;
    
    // Filters from context
    visibleAnimals?: Record<string, boolean>;
    setVisibleAnimals?: (val: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>)) => void;
    showPredictions?: boolean;
    setShowPredictions?: (val: boolean) => void;
    showNearbyRadius?: boolean;
    setShowNearbyRadius?: (val: boolean) => void;
    showAnimalMarkers?: boolean;
    setShowAnimalMarkers?: (val: boolean) => void;

    // Historical Mode
    historicalMode?: boolean;
    setHistoricalMode?: (val: boolean) => void;
    historicalDateRange?: { startDate: string; endDate: string } | null;
    setHistoricalDateRange?: (val: { startDate: string; endDate: string } | null | ((prev: { startDate: string; endDate: string } | null) => { startDate: string; endDate: string } | null)) => void;
}

const MapViewComponent: React.FC<MapViewProps> = (props) => {
    const context = useAppContext();
    const insets = useSafeAreaInsets();
    let tabBarHeight = 0;
    try {
        tabBarHeight = useBottomTabBarHeight();
    } catch (e) {
        tabBarHeight = 0;
    }

    // Fallback if hook returns 0 (common in some Expo/Nav setups)
    // 50 is approx standard tab bar height + bottom safe area
    const bottomPadding = tabBarHeight > 0 ? tabBarHeight : (50 + insets.bottom);


    const { 
        userLocation = context.userLocation, 
        predictions: predictionsIn = context.predictions, 
        animationProgress = 0, 
        nearbyRadiusKm = context.user?.nearbyRadiusKm || 5, 
        safeRoute = context.safeRoute, 
        safePlaces: safePlacesIn = context.safePlaces, 
        riskZones: riskZonesIn = context.riskZones, 
        riskySegments: riskySegmentsIn = context.riskySegments, 
        isNavigating = context.isNavigating, 
        liveLocation = context.liveLocation, 
        navigationStats = context.navigationStats, 
        onStartNavigation = context.startNavigation, 
        onStopNavigation = context.stopNavigation, 
        navigationAlert = context.navigationAlert, 
        clearNavigationAlert = context.clearNavigationAlert, 
        closestPathIndex = context.closestPathIndex,
        isPlaying = true, 
        onPlay, 
        onPause, 
        isApproachingStart = context.isApproachingStart,
        onCalculateSafeRoute = context.calculateSafeRoute, 
        routeStatus = context.routeStatus, 
        routeMessage = context.routeMessage, 
        suggestions = context.suggestions,
        isSuggesting = context.isSuggesting, 
        onFetchSuggestions = context.fetchSuggestions, 
        onClearSuggestions = context.clearSuggestions, 
        searchError = context.searchError, 
        getCurrentLocation = context.getCurrentLocation,
        recentSightings: recentSightingsIn = context.recentSightings, 
        isWildlifeLoading = context.isWildlifeLoading, 
        isLocationLoading = context.isLocationLoading, 
        isRouteLoading = context.isRouteLoading,
        reports: reportsIn = context.reports,
        visibleAnimals: visibleAnimalsIn = context.visibleAnimals, 
        setVisibleAnimals = context.setVisibleAnimals,
        showPredictions = context.showPredictions, 
        setShowPredictions = context.setShowPredictions,
        showNearbyRadius = context.showNearbyRadius, 
        setShowNearbyRadius = context.setShowNearbyRadius,
        showAnimalMarkers = context.showAnimalMarkers, 
        setShowAnimalMarkers = context.setShowAnimalMarkers,
        historicalMode = context.historicalMode, 
        setHistoricalMode = context.setHistoricalMode,
        historicalDateRange = context.historicalDateRange, 
        setHistoricalDateRange = context.setHistoricalDateRange
    } = props;

    const predictions = Array.isArray(predictionsIn) ? predictionsIn : [];
    const safePlaces = Array.isArray(safePlacesIn) ? safePlacesIn : [];
    const riskZones = Array.isArray(riskZonesIn) ? riskZonesIn : [];
    const riskySegments = Array.isArray(riskySegmentsIn) ? riskySegmentsIn : [];
    const recentSightings = Array.isArray(recentSightingsIn) ? recentSightingsIn : [];
    const visibleAnimals =
        visibleAnimalsIn && typeof visibleAnimalsIn === 'object' ? visibleAnimalsIn : {};
    const reports = Array.isArray(reportsIn) ? reportsIn : [];

    console.log('Reports:', reports);

    const routePathKey = stableRoutePathKey(safeRoute?.path as [number, number][] | undefined);
    const hasRoute = Boolean(routePathKey);
    const safePlacesKey = stableJsonKey(safePlaces);
    const visibleAnimalsKey = stableJsonKey(visibleAnimals);
    const predictionsFilterKey = stableJsonKey(
        (Array.isArray(predictions) ? predictions : []).map((p: AnimalPrediction) => p?.id ?? p?.scientific)
    );
    const recentSightingsKey = stableJsonKey(recentSightings);
    const riskZonesKey = stableJsonKey(riskZones);
    const reportsKey = stableJsonKey(reports);
    const setShowAnimalMarkersRef = useRef(setShowAnimalMarkers);
    setShowAnimalMarkersRef.current = setShowAnimalMarkers;
    
    const mapRef = useRef<MapView>(null);
    const initialMapKey = useRef(Math.random().toString(36).substring(7));
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
        isObservation?: boolean;
    } | null>(null);
    const [detailModalAnimal, setDetailModalAnimal] = useState<AnimalPrediction | null>(null);
    const pathIndexRef = useRef(0);
    const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);
    
    const [showWeatherOverlay, setShowWeatherOverlay] = useLocalStorage<boolean>('map-filter-weather', false);
    const [mapRegion, setMapRegion] = useState<{ latitudeDelta: number; longitudeDelta: number } | null>(null);
    const [isCenteringOnUser, setIsCenteringOnUser] = useState(false);
    
    // Navigation & Loading State
    const [isNavLoading, setIsNavLoading] = useState(false);
    useEffect(() => {
        let timer: any;
        if (isRouteLoading) {
            setIsNavLoading(true);
        } else {
            // Add a small delay for smoother transition after loading
            timer = setTimeout(() => setIsNavLoading(false), 500);
        }
        return () => {
            if (timer) clearTimeout(timer);
        };
    }, [isRouteLoading]);
    
    const bottomSheetTranslateY = useRef(new Animated.Value(300)).current;

    // --- Center on user location on first load ---
    const hasCenteredOnLoad = useRef(false);
    useEffect(() => {
        if (!hasCenteredOnLoad.current && userLocation && mapRef.current) {
            // Only auto-center if there's no active route being shown
            if (!safeRoute || !safeRoute.path || safeRoute.path.length === 0) {
                hasCenteredOnLoad.current = true;
                mapRef.current.animateToRegion({
                    latitude: userLocation.lat,
                    longitude: userLocation.lon,
                    latitudeDelta: 0.05,
                    longitudeDelta: 0.05,
                }, 1000);
            }
        }
    }, [userLocation?.lat, userLocation?.lon, routePathKey]);
    

    // --- RESTORED MISSING VARIABLES & LOGIC ---
    const initialRegion = {
        latitude: userLocation?.lat ?? MAP_CENTER[0],
        longitude: userLocation?.lon ?? MAP_CENTER[1],
        latitudeDelta: 0.0922,
        longitudeDelta: 0.0421,
    };

    // Enforce stable initial state for arrays
    const [uiMode, setUiMode] = useState<UIMode>(UIMode.MAP);
    
    useEffect(() => {
        const fetchAddress = async () => {
            if (!selectedAnimal || selectedAnimal.address) return;
            try {
                const addr = await api.reverseGeocode(selectedAnimal.lat, selectedAnimal.lon);
                if (addr && addr.trim().length > 0) {
                    setSelectedAnimal(prev => prev ? { ...prev, address: addr } : prev);
                }
            } catch (e) {
                // ignore reverse geocoding failure; fallback will be lat/lon
            }
        };
        fetchAddress();
    }, [selectedAnimal?.lat, selectedAnimal?.lon, selectedAnimal?.address]);

    // Optimize reverse geocoding for routes: only fetch names for start, mid, end
    const [routeLocations, setRouteLocations] = useState<string[] | null>(null);
    useEffect(() => {
        let isMounted = true;
        const fetchRouteLocations = async () => {
            try {
                if (!safeRoute?.path || safeRoute.path.length < 1) {
                    if (isMounted) setRouteLocations(null);
                    return;
                }
                const routeCoords = safeRoute.path.map(([lat, lon]: [number, number]) => ({ latitude: Number(lat), longitude: Number(lon) }));
                if (routeCoords.length === 1) {
                    const only = routeCoords[0];
                    const name = await api.reverseGeocode(only.latitude, only.longitude);
                    if (isMounted) {
                        console.log("Route location names:", [name]);
                        setRouteLocations([name]);
                    }
                    return;
                }
                const keyPoints = [
                    routeCoords[0],
                    routeCoords[Math.floor(routeCoords.length / 2)],
                    routeCoords[routeCoords.length - 1],
                ];
                const results = await Promise.all(
                    keyPoints.map(p => api.reverseGeocode(p.latitude, p.longitude))
                );
                if (isMounted) {
                    console.log("Route location names:", results);
                    setRouteLocations(results);
                }
            } catch (err) {
                console.error("Reverse geocode failed:", err);
            }
        };
        fetchRouteLocations();
        return () => { isMounted = false; };
    }, [routePathKey]);
    
    useEffect(() => {
        const shouldShowSheet =
            isNavLoading ||
            (!isNavigating && uiMode === UIMode.ROUTE_SUMMARY && hasRoute);
        Animated.timing(bottomSheetTranslateY, {
            toValue: shouldShowSheet ? 0 : 300,
            duration: 300,
            useNativeDriver: true,
        }).start();
    }, [isNavLoading, isNavigating, hasRoute, uiMode]);
    
    // Stable derived state
    const filteredPredictions = useMemo(() => {
        if (!Array.isArray(predictions)) return [];
        
        // Issue 3: Hide predictions unless navigating or planning a route
        if (!showPredictions || (!isNavigating && !hasRoute)) return [];

        return predictions.filter(p => 
            p && (visibleAnimals && (visibleAnimals as any)[canonicalScientific(p.scientific)] !== false)
        );
    }, [predictionsFilterKey, visibleAnimalsKey, isNavigating, hasRoute, showPredictions, predictions]);

    // LSTM Prediction State - STABLE initialization
    const [predictedPath, setPredictedPath] = useState<{ lat: number, lon: number, address: string }[]>([]);
    const predictedPathKey = stableJsonKey(predictedPath);
    const [predictionRisk, setPredictionRisk] = useState<string | null>(null);
    const [predictedAnimalName, setPredictedAnimalName] = useState<string>('');
    const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null);
    const [predictionModel, setPredictionModel] = useState<string | null>(null);

    // Weather State for Destination
    const [destinationWeather, setDestinationWeather] = useState<{
        temp: number;
        main: string;
        icon: string;
    } | null>(null);

    // Fetch Destination Weather
    useEffect(() => {
        const fetchDestinationWeather = async () => {
            if (safeRoute?.end?.lat && safeRoute?.end?.lon) {
                try {
                    const apiKey = CONFIG.WEATHER_API_KEY;
                    const { lat, lon } = safeRoute.end;
                    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&appid=${apiKey}`;
                    const response = await fetch(url);
                    const data = await response.json();
                    if (data && data.main && data.weather && data.weather.length > 0) {
                        setDestinationWeather({
                            temp: Math.round(data.main.temp),
                            main: data.weather[0].main,
                            icon: data.weather[0].icon
                        });
                    } else {
                        setDestinationWeather(null);
                    }
                } catch (error) {
                    console.error("Failed to fetch destination weather", error);
                    setDestinationWeather(null);
                }
            } else {
                setDestinationWeather(null);
            }
        };
        fetchDestinationWeather();
    }, [safeRoute?.end?.lat, safeRoute?.end?.lon]);

    const [predictionLoading, setPredictionLoading] = useState(false);
    const [routeRiskLevel, setRouteRiskLevel] = useState<'LOW'|'MEDIUM'|'HIGH'|null>(null);
    const [routeRiskProb, setRouteRiskProb] = useState<number | null>(null);
    const [routeColor, setRouteColor] = useState<string>('#16a34a');
    const [showRiskAlert, setShowRiskAlert] = useState<boolean>(false);

    const animalTypes = useMemo(() => Object.keys(ANIMALS || {}), []);

    const [isDatePickerVisible, setIsDatePickerVisible] = useState(false);

    const handleHistoricalPreset = (days: number) => {
        const end = new Date();
        const start = new Date();
        start.setDate(end.getDate() - days);
        if (setHistoricalDateRange) {
            setHistoricalDateRange({
                startDate: start.toISOString().split('T')[0],
                endDate: end.toISOString().split('T')[0]
            });
        }
    };

    const showFallbackDemo = useMemo(() => {
        if (isWildlifeLoading) return false;
        const hasReports = reports.some(
            (r) => r && Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lon))
        );
        const hasPlaces = safePlaces.some(
            (p) => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lon))
        );
        const hasSightings = recentSightings.some(
            (s) => s && Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lon))
        );
        const hasRisk = riskZones.length > 0;
        return !hasReports && !hasPlaces && !hasSightings && !hasRisk;
    }, [reportsKey, safePlacesKey, recentSightingsKey, riskZonesKey, isWildlifeLoading, reports, safePlaces, recentSightings, riskZones]);

    const safePlacesWithFallback = useMemo(() => {
        const valid = safePlaces.filter(
            (p) => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lon))
        );
        if (valid.length > 0) return safePlaces;
        if (showFallbackDemo) return FALLBACK_SAFE_PLACES;
        return [];
    }, [safePlaces, showFallbackDemo, safePlacesKey]);

    const processedSafePlaces = useMemo(() => {
        if (!Array.isArray(safePlacesWithFallback) || safePlacesWithFallback.length === 0) return [];
        return safePlacesWithFallback.filter((p) => p && p.lat && p.lon);
    }, [safePlacesWithFallback, routePathKey, safePlacesKey]);

    const safePredictedPath = useMemo(() => {
        if (!Array.isArray(predictedPath)) return [];
        return predictedPath.map(p => ({ 
            lat: p?.lat || 0, 
            lon: p?.lon || 0, 
            address: p?.address || '' 
        }));
    }, [predictedPathKey]);

    const handleToggleAnimal = useCallback((animal: string) => {
        if (setVisibleAnimals) {
            setVisibleAnimals((prev: Record<string, boolean>) => ({
                ...(prev || {}),
                [animal]: !(prev && prev[animal])
            }));
        }
    }, [setVisibleAnimals]);

    const handleCenterOnUser = useCallback(async () => {
        if (userLocation && mapRef.current) {
            setIsCenteringOnUser(true);
            mapRef.current.animateToRegion({
                latitude: userLocation.lat,
                longitude: userLocation.lon,
                latitudeDelta: 0.01,
                longitudeDelta: 0.01,
            }, 1000);
            setTimeout(() => setIsCenteringOnUser(false), 1000);
        } else if (getCurrentLocation) {
             try {
                setIsCenteringOnUser(true);
                const loc = await getCurrentLocation();
                if (loc && mapRef.current) {
                     mapRef.current.animateToRegion({
                        latitude: loc.lat,
                        longitude: loc.lon,
                        latitudeDelta: 0.01,
                        longitudeDelta: 0.01,
                    }, 1000);
                }
             } catch (e) {
                  Alert.alert('Location Error', 'Could not fetch current location.');
             } finally {
                 setIsCenteringOnUser(false);
             }
        }
    }, [userLocation?.lat, userLocation?.lon, getCurrentLocation]);

    const handleStartNavigation = useCallback(() => {
        if (hasRoute) {
            onStartNavigation?.(nearbyRadiusKm || 5);
        }
    }, [hasRoute, onStartNavigation, nearbyRadiusKm]);

    const handleStopNavigation = useCallback(() => {
        onStopNavigation?.();
    }, [onStopNavigation]);

    const handlePredictMovement = useCallback(async () => {
        if (!selectedAnimal || predictionLoading) return;
        setPredictionLoading(true);
        try {
            // ISSUE: Wake up backend before major ML processing request
            await api.wakeUpBackend();

            // Prepare arguments for the service call
            const animalName = selectedAnimal.scientificName || selectedAnimal.name;
            
            // Use user location only for risk calculation
            const userLoc = userLocation 
                ? { lat: userLocation.lat, lon: userLocation.lon }
                : { lat: selectedAnimal.lat, lon: selectedAnimal.lon };

            setPredictedPath([]);
            setPredictionRisk(null);

            const wildlifeBase = { lat: selectedAnimal.lat, lon: selectedAnimal.lon };
            const recentPath: [number, number][] = [
                [wildlifeBase.lat, wildlifeBase.lon]
            ];
            console.log("Wildlife Base Coordinate:", wildlifeBase);

            // Use API to predict with 60s timeout (via nativeFetch)
            const result = await api.predictMovement(
                animalName,
                userLoc,
                recentPath,
                3,
                wildlifeBase
            );
            console.log("ML API Response:", result);
            console.log('[Movement] RN api_response:', JSON.stringify({ status: (result as any)?.status, path_len: (result as any)?.path?.length }));
            
            const path = Array.isArray(result?.path) ? result.path : [];
            if (path.length > 0) {
                setPredictedPath(path);
                setPredictionRisk(result?.risk_level || null);
                setPredictedAnimalName(selectedAnimal.name);
                setPredictionModel((result as any)?.model_used || 'simulation');
                setUiMode(UIMode.PREDICTION);
            } else {
                // If no movement path, try risk endpoint explicitly (different response type)
                try {
                    const dKm = Number.isFinite(Number(result?.distance_to_user_km))
                        ? Number(result?.distance_to_user_km)
                        : calculateMinDistanceToPolyline(
                            { lat: userLoc.lat, lon: userLoc.lon },
                            [[wildlifeBase.lat, wildlifeBase.lon]]
                        );
                    const riskRes = await api.predictRisk({
                        animal: animalName,
                        latitude: wildlifeBase.lat,
                        longitude: wildlifeBase.lon,
                        distance_km: dKm,
                        sighting_date: new Date().toISOString(),
                    } as any);
                    console.log("ML API Response:", riskRes);

                    if (riskRes && !riskRes.error && riskRes.risk) {
                        const risk = String(riskRes.risk).toUpperCase();
                        const prob = typeof riskRes.probability === 'number' ? riskRes.probability : null;
                        const extra = [
                            prob !== null ? `Probability: ${(prob * 100).toFixed(0)}%` : null,
                        ].filter(Boolean).join('\n');

                        Alert.alert(
                            '⚠️ High wildlife risk detected',
                            `${risk}${extra ? `\n\n${extra}` : ''}`
                        );
                        return;
                    }
                } catch (e) {
                    // ignore risk fallback failures; degrade handling below
                }

                console.log('[Movement] No valid path returned or backend error.', result?.message);
                if ((result as any)?.degraded) {
                    Alert.alert('Prediction Unavailable', result?.message || 'The prediction engine is currently busy. Please try again in a few moments.');
                }
            }
        } catch (e: any) {
            console.error('Prediction error:', e);
            const msg = e?.message || 'Failed to predict movement. Please check your connection and try again.';
            Alert.alert('Error', msg);
        } finally {
            setPredictionLoading(false);
        }
    }, [
        selectedAnimal?.lat,
        selectedAnimal?.lon,
        selectedAnimal?.name,
        selectedAnimal?.scientificName,
        predictionLoading,
        userLocation?.lat,
        userLocation?.lon,
    ]);

    const handlePointSelect = useCallback((point: any, index: number) => {
        setSelectedPointIndex(index);
        mapRef.current?.animateToRegion({
            latitude: point.lat,
            longitude: point.lon,
            latitudeDelta: 0.005,
            longitudeDelta: 0.005
        }, 500);
    }, []);

    // STABLE MEMOIZATION for map children props
    const predictedPolylineCoords = useMemo(() => {
        if (!Array.isArray(predictedPath)) return [];
        return predictedPath.map(p => ({ latitude: Number(p?.lat), longitude: Number(p?.lon) }))
            .filter(p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude));
    }, [predictedPathKey]);

    const safeRoutePolylineCoords = useMemo(() => {
        if (!safeRoute?.path || !Array.isArray(safeRoute.path)) return [];
        // Requirement: Convert [lat, lon] -> { latitude, longitude }
        const coords = safeRoute.path.map(([lat, lon]: [number, number]) => ({ 
            latitude: Number(lat), 
            longitude: Number(lon) 
        }));
        // Requirement: Log route coordinates length
        console.log(`[Route] Full route polyline rendering with ${coords.length} coordinates.`);
        return coords;
    }, [routePathKey]);

    const remainingPolylineCoords = useMemo(() => {
        if (!safeRoute?.path || !isNavigating || !Array.isArray(safeRoute.path)) return [];
        const coords = safeRoute.path.slice(closestPathIndex || 0).map(([lat, lon]: [number, number]) => ({ 
            latitude: Number(lat), 
            longitude: Number(lon) 
        }));
        console.log(`[Route] Remaining route polyline rendering with ${coords.length} coordinates.`);
        return coords;
    }, [routePathKey, isNavigating, closestPathIndex]);

    // Debug: ensure predictions reach UI
    useEffect(() => {
        if (Array.isArray(predictedPath) && predictedPath.length > 0) {
            try {
                console.log("Movement Prediction:", predictedPath.map((p: any) => ({ latitude: p.lat, longitude: p.lon })));
            } catch {}
        }
    }, [predictedPathKey]);

    const completedPolylineCoords = useMemo(() => {
        if (!safeRoute?.path || !isNavigating || !Array.isArray(safeRoute.path)) return [];
        const coords = safeRoute.path.slice(0, (closestPathIndex || 0) + 1).map(([lat, lon]: [number, number]) => ({ 
            latitude: Number(lat), 
            longitude: Number(lon) 
        }));
        console.log(`[Route] Completed route polyline rendering with ${coords.length} coordinates.`);
        return coords;
    }, [routePathKey, isNavigating, closestPathIndex]);

    // Route risk detection and route color update (stable deps — avoid re-fetch loops)
    const routeRiskInFlight = useRef(false);
    useEffect(() => {
        let isMounted = true;
        const update = async () => {
            if (routeRiskInFlight.current) return;
            try {
                if (!safeRoute?.path || safeRoute.path.length < 2) {
                    if (isMounted) {
                        setRouteRiskLevel(null);
                        setRouteRiskProb(null);
                        setRouteColor('#16a34a');
                        setShowRiskAlert(false);
                    }
                    return;
                }
                routeRiskInFlight.current = true;
                const res = await api.predictRouteRisk(safeRoute.path as any);
                console.log("API Response:", res);
                if (!isMounted) return;

                if (res && typeof res.routeRisk === 'string') {
                    const lvl = (res.routeRisk || 'LOW').toUpperCase() as 'LOW'|'MEDIUM'|'HIGH';
                    setRouteRiskLevel(lvl);
                    setRouteRiskProb(typeof res.probability === 'number' ? res.probability : null);
                    const color = lvl === 'HIGH' ? '#ef4444' : (lvl === 'MEDIUM' ? '#f59e0b' : '#16a34a');
                    setRouteColor(color);
                    setShowRiskAlert(lvl !== 'LOW');
                } else {
                    setRouteRiskLevel(null);
                    setRouteRiskProb(null);
                    setRouteColor('#16a34a');
                    setShowRiskAlert(false);
                }
            } catch (e) {
                console.warn('route risk check failed', e);
                if (isMounted) {
                    setRouteColor('#16a34a');
                    setShowRiskAlert(false);
                }
            } finally {
                routeRiskInFlight.current = false;
            }
        };
        update();
        return () => { isMounted = false; };
    }, [routePathKey]);

    // Flatten data for markers to ensure stable keys and no undefined access
    const reportMarkers = useMemo(() => {
        // Issue 3: Hide markers unless navigating or planning a route
        if (!showAnimalMarkers || (!isNavigating && !hasRoute)) return [];

        const base = reports.filter(
            (r) => r && Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lon))
        );
        return base.length > 0 ? base : (showFallbackDemo ? FALLBACK_REPORTS.filter(
                (r) => r && Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lon))
            ) : []);
    }, [reportsKey, reports, showFallbackDemo, isNavigating, hasRoute, showAnimalMarkers]);

    const recentSightingsForMap = useMemo(() => {
        const valid = recentSightings.filter(
            (s) => s && Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lon))
        );
        if (valid.length > 0) return recentSightings;
        if (showFallbackDemo) return [FALLBACK_WILDLIFE_SIGHTING];
        return recentSightings;
    }, [recentSightingsKey, recentSightings, showFallbackDemo]);
    
    useEffect(() => {
        if (processedSafePlaces && processedSafePlaces.length > 0) {
            console.log(`[MapView] Rendering ${processedSafePlaces.length} safe places on map.`);
        }
    }, [processedSafePlaces.length]);

    useEffect(() => {
        if (uiMode === UIMode.MAP && !showAnimalMarkers) {
            if (
                (Array.isArray(recentSightingsForMap) && recentSightingsForMap.length > 0) ||
                (Array.isArray(riskZones) && riskZones.length > 0)
            ) {
                setShowAnimalMarkersRef.current?.(true);
            }
        }
    }, [uiMode, showAnimalMarkers, recentSightingsKey, riskZonesKey, recentSightingsForMap]);

    // NEW: Conditional marker logic based on route activity
    const animalMarkers = useMemo(() => {
        // Issue 3: Hide markers unless navigating or planning a route
        if (!showAnimalMarkers || (!isNavigating && !hasRoute)) return [];

        // Combine recent sightings and risk zones
        const combined = [...(recentSightingsForMap || [])];
        if (Array.isArray(riskZones)) {
            riskZones.forEach(zone => {
                if (!zone) return;
                const isDuplicate = combined.some(s => 
                    s && ((s.id && s.id === zone.id) || 
                    (Math.abs(Number(s.lat) - Number(zone.lat)) < 0.0001 && Math.abs(Number(s.lon) - Number(zone.lon)) < 0.0001))
                );
                if (!isDuplicate) {
                    combined.push(zone);
                }
            });
        }

        // Apply species filter
        return combined.filter(s => {
            if (!s) return false;
            const sci = s.scientificName || s.scientific_name;
            const lat = Number(s.lat);
            const lon = Number(s.lon);
            
            if (!lat || !lon) return false;
            
            // Check species filter
            if (sci && visibleAnimals && (visibleAnimals as any)[canonicalScientific(String(sci))] === false) {
                return false;
            }
            
            return true;
        });
    }, [showAnimalMarkers, isNavigating, hasRoute, recentSightingsKey, riskZonesKey, visibleAnimalsKey, recentSightingsForMap]);
    
    // 🔎 STEP 1 – LOG RAW DATA
    const isRouteActive = !!(safeRoute?.path && safeRoute.path.length > 0);
    console.log(`[MapView] Animals visible: ${animalMarkers.length} (Route Active: ${isRouteActive}, showMarkers: ${showAnimalMarkers})`);
    console.log(`[MapView] Reports visible: ${reportMarkers.length}`);
    console.log(`[MapView] Safe Places visible: ${processedSafePlaces.length} (Total raw: ${safePlaces?.length || 0})`);
    if (riskZones && riskZones.length > 0) {
        console.log(`[MapView] Found ${riskZones.length} risk zones for current route.`);
    }

    // FIX: Offset risk markers so they appear next to the animal
    // Removed riskZoneMarkers to eliminate ⚠️ icons from map

    return (
        <View style={styles.container}>
            <View style={styles.screen}>
                <MapView
                    ref={mapRef}
                    key={initialMapKey.current}
                    provider={PROVIDER_GOOGLE}
                    style={styles.map}
                    initialRegion={initialRegion}
                    showsUserLocation={true}
                    followsUserLocation={isNavigating}
                    showsMyLocationButton={true}
                    onMapReady={() => {
                        console.log('[MapView] Google Maps loaded.');
                    }}
                    onRegionChangeComplete={(region: Region) => {
                        console.log(`[MapView] Viewport updated: lat=${region.latitude}, lon=${region.longitude}, zoomLevel=${Math.log2(360 / region.longitudeDelta)}`);
                        setMapRegion({ latitudeDelta: region.latitudeDelta, longitudeDelta: region.longitudeDelta });
                    }}
                >
                    {/* 1. RISK CIRCLES (Bottom Layer) - ONLY SHOWN WHEN ROUTE IS ACTIVE (Issue 3) */}
                    {(isNavigating || hasRoute) && (Array.isArray(riskZones) ? riskZones : []).map((zone, index) => (
                        <Circle
                            key={`risk-circle-${zone?.id ?? 'z'}-${index}-${Number(zone?.lat)}-${Number(zone?.lon)}`}
                            center={{ latitude: Number(zone.lat), longitude: Number(zone.lon) }}
                            radius={2000}
                            fillColor="rgba(255, 0, 0, 0.12)"
                            strokeColor="rgba(255, 0, 0, 0.3)"
                            strokeWidth={1}
                            zIndex={1}
                        />
                    ))}

                    {/* 2. ROUTE POLYLINES */}
                    {Array.isArray(safeRoutePolylineCoords) && safeRoutePolylineCoords.length > 0 && (
                        <Polyline
                            key="route-full"
                            coordinates={safeRoutePolylineCoords}
                            strokeColor={routeColor}
                            strokeWidth={!isNavigating ? 6 : 0}
                            zIndex={2}
                            lineCap="round"
                            lineJoin="round"
                        />
                    )}
                    {Array.isArray(remainingPolylineCoords) && remainingPolylineCoords.length > 0 && (
                        <Polyline
                            key="route-remaining"
                            coordinates={remainingPolylineCoords}
                            strokeColor="#16a34a"
                            strokeWidth={isNavigating ? 4 : 0}
                            zIndex={2}
                            lineCap="round"
                            lineJoin="round"
                        />
                    )}
                    {Array.isArray(completedPolylineCoords) && completedPolylineCoords.length > 0 && (
                        <Polyline
                            key="route-completed"
                            coordinates={completedPolylineCoords}
                            strokeColor="#6b7280"
                            strokeWidth={isNavigating ? 4 : 0}
                            lineDashPattern={[5, 10]}
                            zIndex={2}
                            lineCap="round"
                            lineJoin="round"
                        />
                    )}

                    {/* 3. SAFE PLACES (Modern Badge) */}
                    {(Array.isArray(processedSafePlaces) ? processedSafePlaces : []).map((place) => {
                        let emoji = '🌲'; // Default Forest Office
                        if (place.type === 'police') emoji = '👮';
                        
                        return (
                            <Marker
                                key={`safe-${place.id || `${place.lat}-${place.lon}`}`}
                                coordinate={{ latitude: Number(place.lat), longitude: Number(place.lon) }}
                                zIndex={3}
                                anchor={{ x: 0.5, y: 0.5 }}
                                title={place.name || 'Safe Place'}
                                description={place.address || ''}
                            >
                                <View style={styles.safeBadge}>
                                    <Text style={styles.safeEmoji}>{emoji}</Text>
                                </View>
                            </Marker>
                        );
                    })}

                    {/* 4. ANIMAL & RISK MARKERS */}
                    {(Array.isArray(animalMarkers) ? animalMarkers : []).map((sighting) => {
                        const sci = sighting.scientificName || sighting.scientific_name;
                        const sciCanon = sci ? canonicalScientific(String(sci)) : '';
                        const animalInfo = ANIMALS[sciCanon];
                        
                        let emoji = sighting.emoji || sighting.emojji || animalInfo?.emoji || '🐾';
                        const name = sighting.name || animalInfo?.common || 'Animal';
                        const date = sighting.date || sighting.eventDate;

                        if (!sighting.lat || !sighting.lon) return null;

                        return (
                            <Marker
                                key={`sighting-${sighting.id || `${sighting.lat}-${sighting.lon}`}`}
                                coordinate={{ latitude: Number(sighting.lat), longitude: Number(sighting.lon) }}
                                zIndex={4}
                                onPress={() => {
                                    setSelectedAnimal({
                                        name: name,
                                        scientificName: sci,
                                        image_url: sighting.image_url,
                                        date: date,
                                        metadata: {
                                            scope: sighting.metadata?.scope || 'regional',
                                            confidence: sighting.metadata?.confidence || 'medium'
                                        },
                                        lat: Number(sighting.lat),
                                        lon: Number(sighting.lon),
                                        address: sighting.address
                                    });
                                    setUiMode(UIMode.DETAIL);
                                }}
                            >
                                <View style={[styles.markerContainer, (historicalMode && !safeRoute) && styles.historicalMarker]}>
                                    <Text style={{ fontSize: isNavigating ? 24 : 30, textAlign: 'center' }}>{emoji}</Text>
                                    {(historicalMode && !safeRoute) && (
                                        <View style={styles.historicalIndicator}>
                                            <SyncIcon width={10} height={10} color="#ffffff" />
                                        </View>
                                    )}
                                </View>
                            </Marker>
                        );
                    })}

                    {/* 5. DESTINATION PIN (ONLY) */}
                    {safeRoute && safeRoute.end && (
                        <Marker
                            key="route-destination"
                            coordinate={{ latitude: Number(safeRoute.end.lat), longitude: Number(safeRoute.end.lon) }}
                            title="Destination"
                            description={safeRoute.end.name}
                            pinColor="#ef4444"
                            zIndex={5}
                        />
                    )}

                    {/* 6. ADDITIONAL OVERLAYS (Predictions, Reports, etc.) - HIDDEN IF NO ACTIVE ROUTE (Issue 3) */}
                    {(isNavigating || hasRoute) && uiMode === UIMode.PREDICTION && Array.isArray(predictedPolylineCoords) && predictedPolylineCoords.length > 0 && (
                        <Polyline
                            key="prediction-line"
                            coordinates={predictedPolylineCoords}
                            strokeColor={
                                predictionRisk?.toLowerCase() === 'high' ? '#ef4444' : 
                                predictionRisk?.toLowerCase() === 'medium' ? '#f59e0b' : '#10b981'
                            }
                            strokeWidth={4}
                            lineDashPattern={[8, 6]}
                            zIndex={6}
                        />
                    )}

                    {(isNavigating || hasRoute) && uiMode === UIMode.PREDICTION && Array.isArray(predictedPath) && predictedPath.map((p, index) => (
                        <Marker
                            key={`pred-point-${index}`}
                            coordinate={{ latitude: p.lat, longitude: p.lon }}
                            zIndex={7}
                            onPress={() => handlePointSelect(p, index)}
                        >
                            <View style={[
                                styles.indexCircle,
                                {
                                    backgroundColor: predictionRisk?.toLowerCase() === 'high' ? '#ef4444' : '#f59e0b',
                                    transform: [{ scale: selectedPointIndex === index ? 1.2 : 0.8 }]
                                }
                            ]}>
                                <Text style={styles.indexText}>{index + 1}</Text>
                            </View>
                        </Marker>
                    ))}

                    {/* Last predicted location marker */}
                    {(isNavigating || hasRoute) && uiMode === UIMode.PREDICTION && Array.isArray(predictedPath) && predictedPath.length > 0 && (
                        <Marker
                            key="predicted-last"
                            coordinate={{ latitude: Number(predictedPath[predictedPath.length - 1]?.lat), longitude: Number(predictedPath[predictedPath.length - 1]?.lon) }}
                            title="Predicted Wildlife Location"
                            zIndex={7}
                        />
                    )}

                    {(isNavigating || hasRoute) && uiMode === UIMode.PREDICTION && Array.isArray(predictedPath) && predictedPath.length > 0 && (
                        <Circle
                            key="predicted-danger"
                            center={{ latitude: Number(predictedPath[predictedPath.length - 1]?.lat), longitude: Number(predictedPath[predictedPath.length - 1]?.lon) }}
                            radius={5000}
                            strokeColor="#ef4444"
                            fillColor="rgba(239,68,68,0.2)"
                            strokeWidth={1}
                            zIndex={6}
                        />
                    )}

                    {/* 6. WILDLIFE REPORTS MARKERS */}
                    {showAnimalMarkers && Array.isArray(reportMarkers) && reportMarkers.map((r) => {
                        let emoji = '🐾';
                        const name = r.wildlifeType || r.ai?.common;
                        if (name) {
                             const entry = safeArray<any>(Object.values(ANIMALS || {})).find(a => a?.common === name);
                             if (entry) emoji = entry.emoji;
                        }
                        return (
                                    <Marker
                                        key={`report-${r.id || `${r.lat}-${r.lon}`}`}
                                        coordinate={{ latitude: Number(r.lat), longitude: Number(r.lon) }}
                                        title={`${r.wildlifeType || 'Wildlife Report'} (User Observation)`}
                                        description={r.description}
                                        zIndex={8}
                                        onPress={() => {
                                    setSelectedAnimal({
                                        name: name || 'Report',
                                        image_url: r.imageUri,
                                        date: r.timestamp,
                                        metadata: { scope: 'report', confidence: 'medium' },
                                        lat: Number(r.lat),
                                        lon: Number(r.lon),
                                        address: r.location,
                                        isObservation: true
                                    });
                                    setUiMode(UIMode.DETAIL);
                                }}
                            >
                                <View style={styles.markerContainer}>
                                    <Text style={styles.emojiMarker}>{emoji}</Text>
                                </View>
                            </Marker>
                        );
                    })}

                    {/* 7. PREDICTION MARKERS (Current predicted locations) */}
                    {showPredictions && Array.isArray(filteredPredictions) && filteredPredictions.map((p) => (
                        <Marker
                            key={`prediction-marker-${p.id || p.scientific}`}
                            coordinate={{ latitude: Number(p?.current?.lat), longitude: Number(p?.current?.lon) }}
                            zIndex={8}
                            onPress={() => {
                                if (!p || !p.current) return;
                                setSelectedAnimal({
                                    name: p?.common,
                                    scientificName: p?.scientific,
                                    image_url: p?.image,
                                    date: new Date().toISOString(),
                                    metadata: {
                                        scope: p?.metadata?.scope || 'prediction',
                                        confidence: p?.metadata?.confidence || 'medium'
                                    },
                                    lat: Number(p?.current?.lat),
                                    lon: Number(p?.current?.lon),
                                    address: p?.current?.addr
                                });
                                setUiMode(UIMode.DETAIL);
                            }}
                        >
                            <View style={[styles.markerContainer, styles.predictionMarker]}>
                                <Text style={{ fontSize: 30 }}>{p.emoji}</Text>
                                <View style={styles.predictionIndicator}>
                                    <ChartIcon width={10} height={10} color="#ffffff" />
                                </View>
                            </View>
                        </Marker>
                    ))}

                    {!isNavigating && (
                        <>
                            {(showPredictions ? Array.isArray(filteredPredictions) ? filteredPredictions : [] : [])
                                .filter(p => p && Array.isArray(p.fullPath) && p.fullPath.length >= 2)
                                .map((p: AnimalPrediction) => (
                                    <Polyline
                                        key={`auto-path-${p.id || p.scientific}`}
                                        coordinates={(p.fullPath || []).map(([lat, lon]: [number, number]) => ({ latitude: Number(lat), longitude: Number(lon) }))}
                                        strokeColor={p.color || '#F59E0B'}
                                        strokeWidth={3}
                                        lineDashPattern={[5, 5]}
                                        zIndex={9}
                                    />
                                ))
                            }

                            {(Array.isArray(riskySegments) ? riskySegments : [])
                                .filter((s: any) => Array.isArray(s) && s.length >= 2)
                                .map((segment: [number, number][], index: number) => (
                                    <Polyline
                                        key={`risky-${index}`}
                                        coordinates={segment.map(([lat, lon]) => ({ latitude: lat, longitude: lon }))}
                                        strokeColor="#ef4444"
                                        strokeWidth={6}
                                        zIndex={10}
                                    />
                                ))
                            }
                            
                            {(liveLocation && showNearbyRadius ? [liveLocation] : []).map((loc) => (
                                <Circle
                                    key="live-circle"
                                    center={{ latitude: Number(loc.lat), longitude: Number(loc.lon) }}
                                    radius={nearbyRadiusKm * 1000}
                                    strokeColor="#f97316"
                                    fillColor="rgba(249, 115, 22, 0.1)"
                                    strokeWidth={1}
                                    zIndex={11}
                                />
                            ))}
                        </>
                    )}
                </MapView>

                {/* NO WILDLIFE INDICATOR */}
                {!showFallbackDemo &&
                    !isWildlifeLoading &&
                    animalMarkers.length === 0 &&
                    reportMarkers.length === 0 &&
                    uiMode === UIMode.MAP &&
                    !safeRoute && (
                        <View style={styles.noWildlifeContainer}>
                            <Text style={styles.noWildlifeText}>No wildlife sightings in this area</Text>
                        </View>
                    )}

                {showFallbackDemo && (
                    <View style={styles.demoDataBanner}>
                        <Text style={styles.demoDataBannerText}>
                            Demo markers — connect for live wildlife and safe places
                        </Text>
                    </View>
                )}

                <SafeAreaView style={styles.headerContainer}>
                    <View style={styles.headerContent}>
                        <Text style={styles.headerTitle}>Wildlife Safety Map</Text>
                        <View style={styles.headerActions}>
                            <TouchableOpacity style={styles.iconButton} onPress={() => setIsFilterPanelOpen(true)}>
                                <FilterIcon width={22} height={22} color="#059669" />
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.pillButton} onPress={() => setUiMode(UIMode.ROUTE_PLANNER)}>
                                <PaperPlaneIcon width={20} height={20} color="#059669" />
                                <Text style={styles.routeButtonText}>Route</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </SafeAreaView>

                {isNavigating && (
                    <View style={[styles.etaContainer, { bottom: insets.bottom + 20 }]}>
                        <View style={styles.navHeaderRow}>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.navDuration}>{formatDuration(navigationStats?.etaMinutes || safeRoute?.durationMinutes || 0)}</Text>
                                <Text style={styles.navDistance}>{(navigationStats?.remainingKm || safeRoute?.distanceKm || 0).toFixed(1)} km remaining</Text>
                                
                                {destinationWeather && (
                                    <>
                                        <Text style={styles.navWeatherLabel}>Weather at destination</Text>
                                        <View style={styles.navWeatherContainer}>
                                            <Image 
                                                source={{ uri: `https://openweathermap.org/img/wn/${destinationWeather.icon}@2x.png` }} 
                                                style={styles.navWeatherIcon} 
                                            />
                                            <Text style={styles.navWeatherText}>
                                                {destinationWeather.temp}°C | {destinationWeather.main}
                                            </Text>
                                        </View>
                                    </>
                                )}

                                <Text style={styles.navEta}>Arrive by {formatArrivalTime(navigationStats?.etaMinutes || safeRoute?.durationMinutes || 0)}</Text>
                            </View>
                            <TouchableOpacity style={styles.endNavButton} onPress={handleStopNavigation}>
                                <Text style={styles.endNavText}>End Navigation</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                )}

                {!showAnimalMarkers && !isNavigating && uiMode === UIMode.MAP && (
                    <TouchableOpacity 
                        style={styles.hiddenMarkersIndicator}
                        onPress={() => setShowAnimalMarkers(true)}
                    >
                        <AlertTriangleIcon width={16} height={16} color="#059669" />
                        <Text style={styles.hiddenMarkersText}>Wildlife Markers Hidden (Tap to show)</Text>
                    </TouchableOpacity>
                )}

                <TouchableOpacity
                    style={[styles.gpsButton, { bottom: bottomPadding + (uiMode === UIMode.ROUTE_SUMMARY || isNavigating ? 200 : 110) }]}
                    onPress={handleCenterOnUser}
                    disabled={isCenteringOnUser || isLocationLoading}
                >
                    {isCenteringOnUser || isLocationLoading ? (
                        <ActivityIndicator color="#374151" />
                    ) : (
                        <LocationMarkerIcon width={24} height={24} color="#374151" />
                    )}
                </TouchableOpacity>
                {!isNavigating && uiMode !== UIMode.ROUTE_SUMMARY && (
                    <View style={[styles.riskContainer, { bottom: bottomPadding + 80 }]}>
                        <View style={styles.riskPill}>
                            <AlertTriangleIcon width={18} height={18} color="#ef4444" />
                            <Text style={styles.riskText}>{safeRoute && Array.isArray(riskZones) ? riskZones.length : filteredPredictions.length} Risks</Text>
                            <View style={styles.divider} />
                            <Text style={{ fontSize: 18 }}>👮</Text>
                            <Text style={styles.safeText}>{safeRoute && Array.isArray(processedSafePlaces) ? processedSafePlaces.length : 0} Safe</Text>
                        </View>
                    </View>
                )}

                {historicalMode && !safeRoute && (
                    <View style={styles.historicalBanner}>
                        <SyncIcon width={16} height={16} color="#ffffff" />
                        <Text style={styles.historicalBannerText}>
                            Viewing Historical Data ({historicalDateRange?.startDate || '...'})
                        </Text>
                        <Text style={styles.historicalBannerWarning}>
                            Analysis only. Not for real-time safety.
                        </Text>
                    </View>
                )}

                {!isNavigating && uiMode === UIMode.MAP && !safeRoute && (
                    <TouchableOpacity
                        style={[styles.planButton, { bottom: bottomPadding + 16 }]}
                        onPress={() => setUiMode(UIMode.ROUTE_PLANNER)}
                    >
                        <PaperPlaneIcon width={20} height={20} color="#ffffff" />
                        <Text style={styles.planText}>Plan Safe Route</Text>
                    </TouchableOpacity>
                )}

                {(isNavLoading || (!isNavigating && uiMode === UIMode.ROUTE_SUMMARY && safeRoute)) && (
                    <Animated.View
                        style={[
                            styles.bottomSheet,
                            {
                                transform: [{ translateY: bottomSheetTranslateY }],
                                bottom: 0
                            }
                        ]}
                    >
                        <View style={styles.dragIndicator} />

                        {isNavLoading && (
                            <View style={styles.loadingContainer}>
                                <ActivityIndicator size="large" color="#1E8E3E" />
                                <Text style={styles.loadingText}>Preparing Safe Navigation...</Text>
                            </View>
                        )}

                        {!isNavLoading && !isNavigating && uiMode === UIMode.ROUTE_SUMMARY && safeRoute && (
                            <>
                                <View style={styles.sheetHeader}>
                                    <Text style={styles.sheetTitle}>Safe Route Found</Text>
                                    <TouchableOpacity onPress={() => setUiMode(UIMode.MAP)}>
                                        <XIcon width={22} height={22} color="#444" />
                                    </TouchableOpacity>
                                </View>

                                <View style={styles.metricsContainer}>
                                    <View style={styles.metricBox}>
                                        <Text style={styles.metricValue}>{safeRoute.distanceKm.toFixed(1)}</Text>
                                        <Text style={styles.metricLabel}>KM</Text>
                                    </View>

                                    <View style={styles.metricDivider} />

                                    <View style={styles.metricBox}>
                                        <Text style={styles.metricValue}>{formatDuration(safeRoute.durationMinutes)}</Text>
                                        <Text style={styles.metricLabel}>DURATION</Text>
                                    </View>

                                    <View style={styles.metricDivider} />

                                    <View style={styles.metricBox}>
                                        <Text style={[styles.metricValue, { color: '#2E6CF6' }]}>
                                            {safePlaces.length}
                                        </Text>
                                        <Text style={styles.metricLabel}>SAFE SPOTS</Text>
                                    </View>
                                </View>

                                {destinationWeather && (
                                    <View style={{ marginBottom: 12 }}>
                                        <Text style={styles.navWeatherLabel}>Weather at destination</Text>
                                        <View style={styles.navWeatherContainer}>
                                            <Image 
                                                source={{ uri: `https://openweathermap.org/img/wn/${destinationWeather.icon}@2x.png` }} 
                                                style={styles.navWeatherIcon} 
                                            />
                                            <Text style={styles.navWeatherText}>
                                                {destinationWeather.temp}°C | {destinationWeather.main}
                                            </Text>
                                        </View>
                                    </View>
                                )}

                                <Text style={styles.etaText}>ETA: Arrive by {formatArrivalTime(safeRoute.durationMinutes)}</Text>

                                <TouchableOpacity style={styles.startButton} onPress={handleStartNavigation}>
                                    <Text style={styles.startButtonText}>Start Navigation</Text>
                                </TouchableOpacity>
                            </>
                        )}
                    </Animated.View>
                )}
            </View>

            {showRiskAlert && routeRiskLevel && (
                <View style={styles.routeRiskAlert}>
                    <Text style={styles.routeRiskTitle}>⚠ Wildlife Risk</Text>
                    <Text style={styles.routeRiskBody}>
                        {routeRiskLevel === 'HIGH' ? 'High' : routeRiskLevel === 'MEDIUM' ? 'Medium' : 'Low'} risk detected near your route.
                    </Text>
                    {typeof routeRiskProb === 'number' && (
                        <Text style={styles.routeRiskProb}>Probability: {(routeRiskProb * 100).toFixed(0)}%</Text>
                    )}
                </View>
            )}

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
                                    <Text style={styles.filterLabel}>Wildlife Markers</Text>
                                    <TouchableOpacity
                                        style={[styles.toggle, showAnimalMarkers && styles.toggleActive]}
                                        onPress={() => setShowAnimalMarkers?.(!showAnimalMarkers)}
                                    />
                                </View>
                                <View style={styles.filterRow}>
                                    <Text style={styles.filterLabel}>AI Predictions</Text>
                                    <TouchableOpacity
                                        style={[styles.toggle, showPredictions && styles.toggleActive]}
                                        onPress={() => setShowPredictions?.(!showPredictions)}
                                    />
                                </View>
                                <View style={styles.filterRow}>
                                    <Text style={styles.filterLabel}>Nearby Alert Zone</Text>
                                    <TouchableOpacity
                                        style={[styles.toggle, showNearbyRadius && styles.toggleActive]}
                                        onPress={() => setShowNearbyRadius?.(!showNearbyRadius)}
                                    />
                                </View>
                                <View style={styles.filterRow}>
                                    <Text style={styles.filterLabel}>Weather Radar</Text>
                                    <TouchableOpacity
                                        style={[styles.toggle, showWeatherOverlay && styles.toggleActive]}
                                        onPress={() => setShowWeatherOverlay?.(!showWeatherOverlay)}
                                    />
                                </View>
                                <Text style={styles.animalsLabel}>Visible Animals</Text>
                                {animalTypes.map(scientificName => (
                                    <View key={scientificName} style={styles.filterRow}>
                                        <Text style={styles.filterLabel}>{ANIMALS[scientificName]?.common || scientificName}</Text>
                                        <TouchableOpacity
                                            style={[styles.checkbox, visibleAnimals && visibleAnimals[scientificName] !== false && styles.checkboxChecked]}
                                            onPress={() => handleToggleAnimal(scientificName)}
                                        />
                                    </View>
                                ))}
                                
                                <View style={styles.divider} />
                                
                                <View style={styles.filterRow}>
                                    <View>
                                        <Text style={styles.filterLabel}>Historical Mode</Text>
                                        <Text style={styles.filterSubLabel}>Analyze past wildlife patterns</Text>
                                    </View>
                                    <TouchableOpacity
                                        style={[styles.toggle, historicalMode && styles.toggleActive]}
                                        onPress={() => {
                                            setHistoricalMode?.(!historicalMode);
                                            if (!historicalMode) setIsDatePickerVisible(true);
                                        }}
                                    />
                                </View>

                                {historicalMode && (
                                    <View style={styles.dateRangeContainer}>
                                        <Text style={styles.dateRangeTitle}>Selected Range:</Text>
                                        <Text style={styles.dateRangeValue}>
                                            {historicalDateRange ? `${historicalDateRange.startDate} to ${historicalDateRange.endDate}` : 'Last 30 days (default)'}
                                        </Text>
                                        <TouchableOpacity 
                                            style={styles.changeDateButton}
                                            onPress={() => setIsDatePickerVisible(true)}
                                        >
                                            <Text style={styles.changeDateText}>Change Date Range</Text>
                                        </TouchableOpacity>
                                    </View>
                                )}
                            </ScrollView>
                        </Pressable>
                    </Pressable>
                </Modal>
            )}

            {isDatePickerVisible && (
                <Modal visible={isDatePickerVisible} transparent animationType="fade">
                    <Pressable style={styles.modalOverlay} onPress={() => setIsDatePickerVisible(false)}>
                        <View style={styles.datePickerContent}>
                            <Text style={styles.datePickerTitle}>Historical Data Range</Text>
                            
                            <View style={styles.presetGrid}>
                                {[7, 30, 90, 180].map(days => (
                                    <TouchableOpacity 
                                        key={days}
                                        style={styles.presetButton}
                                        onPress={() => {
                                            handleHistoricalPreset(days);
                                            setIsDatePickerVisible(false);
                                        }}
                                    >
                                        <Text style={styles.presetText}>Last {days} Days</Text>
                                    </TouchableOpacity>
                                ))}
                            </View>

                            <View style={styles.customDateInputs}>
                                <View style={styles.dateInputBox}>
                                    <Text style={styles.dateInputLabel}>Start (YYYY-MM-DD)</Text>
                                    <TextInput 
                                        style={styles.dateInput}
                                        placeholder="2024-01-01"
                                        defaultValue={historicalDateRange?.startDate}
                                        onChangeText={(t) =>
                                            setHistoricalDateRange?.((prev: { startDate: string; endDate: string } | null) => ({
                                                ...(prev || { startDate: '', endDate: '' }),
                                                startDate: t
                                            }))
                                        }
                                    />
                                </View>
                                <View style={styles.dateInputBox}>
                                    <Text style={styles.dateInputLabel}>End (YYYY-MM-DD)</Text>
                                    <TextInput 
                                        style={styles.dateInput}
                                        placeholder="2024-02-01"
                                        defaultValue={historicalDateRange?.endDate}
                                        onChangeText={(t) =>
                                            setHistoricalDateRange?.((prev: { startDate: string; endDate: string } | null) => ({
                                                ...(prev || { startDate: '', endDate: '' }),
                                                endDate: t
                                            }))
                                        }
                                    />
                                </View>
                            </View>

                            <TouchableOpacity 
                                style={styles.applyDateButton}
                                onPress={() => setIsDatePickerVisible(false)}
                            >
                                <Text style={styles.applyDateText}>Apply Range</Text>
                            </TouchableOpacity>
                        </View>
                    </Pressable>
                </Modal>
            )}

            {/* SINGLE MODAL - Android-safe architecture */}
            <Modal
                visible={uiMode !== UIMode.MAP && uiMode !== UIMode.ROUTE_SUMMARY}
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

                    {/* FIX 3: Always show address with fallback */}
                                            <View style={styles.popupMetaRow}>
                                                <Text style={styles.popupMetaLabel}>Address:</Text>
                                                <Text
                                                    style={[styles.popupMetaValue, styles.popupMetaValueRight]}
                                                    numberOfLines={3}
                                                >
                                                    {selectedAnimal.address || `${selectedAnimal.lat.toFixed(4)}, ${selectedAnimal.lon.toFixed(4)}`}
                                                </Text>
                                            </View>

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

                                    {selectedAnimal && !selectedAnimal.isObservation && (
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
                                    )}

                                    {selectedAnimal && selectedAnimal.isObservation && (
                                         <View style={styles.infoBox}>
                                             <Text style={[styles.infoText, { textAlign: 'center', color: '#6b7280', fontStyle: 'italic' }]}>
                                                 This is a user observation. AI movement predictions are disabled for reports.
                                             </Text>
                                         </View>
                                     )}

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
                                onSuccess={() => setUiMode(UIMode.ROUTE_SUMMARY)}
                                onCalculateSafeRoute={onCalculateSafeRoute}
                                routeStatus={routeStatus}
                                routeMessage={routeMessage}
                                suggestions={suggestions}
                                isSuggesting={isSuggesting}
                                onFetchSuggestions={onFetchSuggestions}
                                onClearSuggestions={onClearSuggestions}
                                searchError={searchError}
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
    screen: {
        flex: 1,
    },
    map: {
        ...StyleSheet.absoluteFillObject,
        flex: 1,
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
    headerContainer: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 1000,
        elevation: 10,
        backgroundColor: '#ffffff',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 6,
    },
    headerContent: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 10,
        paddingVertical: 0,
    },
    headerTitle: {
        fontSize: 20,
        fontWeight: '700',
        color: '#111827',
        letterSpacing: -0.5,
    },
    routeRiskAlert: {
        position: 'absolute',
        left: 16,
        right: 16,
        bottom: 24,
        backgroundColor: '#fff7ed',
        borderColor: '#f97316',
        borderWidth: 1,
        borderRadius: 12,
        paddingVertical: 12,
        paddingHorizontal: 16,
        shadowColor: '#000',
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 3,
        zIndex: 50
    },
    routeRiskTitle: {
        fontSize: 16,
        fontWeight: '700',
        color: '#b91c1c',
        marginBottom: 4
    },
    routeRiskBody: {
        fontSize: 14,
        color: '#7f1d1d'
    },
    routeRiskProb: {
        marginTop: 6,
        fontSize: 12,
        color: '#7c2d12'
    },
    headerActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    iconButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#ECFDF5',
        shadowColor: '#059669',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 2,
    },
    pillButton: {
        height: 40,
        paddingHorizontal: 16,
        borderRadius: 20,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: '#ECFDF5',
        shadowColor: '#059669',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 2,
    },
    routeButtonText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#059669',
    },
    mapContainer: {
        flex: 1,
        position: 'relative',
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
    emojiMarker: {
        fontSize: 28,
        textAlign: 'center'
    },
    markerContainer: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    predictionMarker: {
        // Visual cue that it is a prediction
    },
    predictionIndicator: {
        position: 'absolute',
        top: -4,
        right: -4,
        backgroundColor: '#f59e0b',
        width: 14,
        height: 14,
        borderRadius: 7,
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#ffffff',
    },
    historicalMarker: {
        opacity: 0.7,
    },
    historicalIndicator: {
        position: 'absolute',
        bottom: -2,
        right: -2,
        backgroundColor: '#6366f1',
        borderRadius: 8,
        padding: 2,
        borderWidth: 1,
        borderColor: '#ffffff',
    },
    historicalBanner: {
        position: 'absolute',
        top: 100,
        left: 20,
        right: 20,
        backgroundColor: 'rgba(99, 102, 241, 0.95)',
        padding: 12,
        borderRadius: 12,
        flexDirection: 'column',
        alignItems: 'center',
        zIndex: 100,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 4,
        elevation: 4,
    },
    historicalBannerText: {
        color: '#ffffff',
        fontWeight: 'bold',
        fontSize: 14,
    },
    historicalBannerWarning: {
        color: 'rgba(255, 255, 255, 0.8)',
        fontSize: 11,
        marginTop: 2,
    },
    demoDataBanner: {
        position: 'absolute',
        top: 56,
        left: 16,
        right: 16,
        backgroundColor: 'rgba(5, 150, 105, 0.92)',
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 10,
        zIndex: 99,
        elevation: 3,
    },
    demoDataBannerText: {
        color: '#ffffff',
        fontSize: 13,
        fontWeight: '600',
        textAlign: 'center',
    },
    filterSubLabel: {
        fontSize: 12,
        color: '#6b7280',
    },
    dateRangeContainer: {
        padding: 12,
        backgroundColor: '#f3f4f6',
        borderRadius: 8,
        marginTop: 8,
    },
    dateRangeTitle: {
        fontSize: 12,
        fontWeight: 'bold',
        color: '#374151',
    },
    dateRangeValue: {
        fontSize: 14,
        color: '#4b5563',
        marginTop: 4,
    },
    changeDateButton: {
        marginTop: 8,
        backgroundColor: '#ffffff',
        padding: 8,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: '#d1d5db',
        alignItems: 'center',
    },
    changeDateText: {
        fontSize: 12,
        color: '#6366f1',
        fontWeight: '600',
    },
    datePickerContent: {
        backgroundColor: '#ffffff',
        width: '85%',
        borderRadius: 20,
        padding: 20,
        alignItems: 'center',
    },
    datePickerTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#1f2937',
        marginBottom: 16,
    },
    presetGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        justifyContent: 'center',
        marginBottom: 20,
    },
    presetButton: {
        backgroundColor: '#f3f4f6',
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 20,
        minWidth: '45%',
        alignItems: 'center',
    },
    presetText: {
        fontSize: 13,
        color: '#4b5563',
    },
    customDateInputs: {
        width: '100%',
        gap: 12,
        marginBottom: 20,
    },
    dateInputBox: {
        width: '100%',
    },
    dateInputLabel: {
        fontSize: 12,
        color: '#6b7280',
        marginBottom: 4,
    },
    dateInput: {
        borderWidth: 1,
        borderColor: '#d1d5db',
        borderRadius: 8,
        padding: 10,
        fontSize: 14,
    },
    applyDateButton: {
        backgroundColor: '#6366f1',
        width: '100%',
        padding: 14,
        borderRadius: 12,
        alignItems: 'center',
    },
    applyDateText: {
        color: '#ffffff',
        fontWeight: 'bold',
        fontSize: 16,
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
    gpsButton: {
        position: 'absolute',
        right: 20,
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: '#FFFFFF',
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 10,
        elevation: 8,
        zIndex: 50,
    },
    etaContainer: {
        position: 'absolute',
        left: 20,
        right: 20,
        zIndex: 1000,
        elevation: 10,
        backgroundColor: '#ffffff',
        borderRadius: 20,
        padding: 20,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 8,
    },
    riskContainer: {
        position: 'absolute',
        left: 0,
        right: 0,
        alignItems: 'center',
        zIndex: 90,
    },
    riskPill: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#ffffff',
        paddingVertical: 10,
        paddingHorizontal: 18,
        borderRadius: 30,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 10,
        elevation: 6,
    },
    divider: {
        width: 1,
        height: 18,
        backgroundColor: '#e5e7eb',
        marginHorizontal: 12,
    },
    riskText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#374151',
        marginLeft: 6,
    },
    safeText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#374151',
        marginLeft: 6,
    },
    planButton: {
        position: 'absolute',
        left: 16,
        right: 16,
        backgroundColor: '#059669',
        paddingVertical: 18,
        borderRadius: 28,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.25,
        shadowRadius: 12,
        elevation: 10,
        zIndex: 100,
        gap: 8,
    },
    planText: {
        color: '#ffffff',
        fontSize: 16,
        fontWeight: '600',
        marginLeft: 8,
    },
    safeBadge: {
        backgroundColor: 'rgba(220, 252, 231, 0.85)', // Soft green badge style
        padding: 4,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#059669',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 36,
        minHeight: 36,
    },
    safeEmoji: {
        fontSize: 24,
        textAlign: 'center',
        lineHeight: 30, // Added to prevent clipping
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'flex-end',
    },
    modalContent: {
        backgroundColor: '#ffffff',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        maxHeight: '90%',
        width: '100%',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.1,
        shadowRadius: 10,
        elevation: 20,
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
    infoBox: {
        backgroundColor: '#f9fafb',
        padding: 16,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#e5e7eb',
        marginTop: 10,
    },
    infoText: {
        fontSize: 14,
        color: '#374151',
        lineHeight: 20,
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
    bottomSheet: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: '#FFFFFF',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        paddingHorizontal: 20,
        paddingTop: 16,
        paddingBottom: 24,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
        elevation: 16,
        zIndex: 1000,
    },
    dragIndicator: {
        alignSelf: 'center',
        width: 48,
        height: 6,
        borderRadius: 3,
        backgroundColor: '#E5E7EB',
        marginBottom: 20,
    },
    loadingContainer: {
        alignItems: 'center',
        paddingVertical: 32,
    },
    loadingText: {
        marginTop: 16,
        fontSize: 16,
        color: '#6B7280',
        fontWeight: '500',
    },
    navigationCard: {
        width: '100%',
        paddingBottom: 16,
        paddingTop: 8,
    },
    navHeaderRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    navDuration: {
        fontSize: 32,
        fontWeight: '700',
        color: '#111827',
        letterSpacing: -1,
        marginBottom: 4,
    },
    navDistance: {
        fontSize: 14,
        color: '#6B7280',
        fontWeight: '500',
        marginTop: 0,
        marginBottom: 4,
    },
    navEta: {
        fontSize: 14, // Increased size for visibility
        color: '#059669', // Green color to stand out
        fontWeight: '700',
        marginTop: 2,
    },
    navWeatherContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 4,
        marginBottom: 4,
    },
    navWeatherIcon: {
        width: 32,
        height: 32,
        marginRight: 4,
    },
    navWeatherText: {
        fontSize: 14,
        color: '#374151',
        fontWeight: '500',
    },
    navWeatherLabel: {
        fontSize: 12,
        color: '#6B7280',
        fontWeight: '600',
        marginBottom: 2,
    },
    endNavButton: {
        backgroundColor: '#FEE2E2',
        paddingVertical: 12,
        paddingHorizontal: 24,
        borderRadius: 24,
    },
    endNavText: {
        color: '#DC2626',
        fontWeight: '600',
        fontSize: 14,
    },
    sheetHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 20,
    },
    sheetTitle: {
        fontSize: 22,
        fontWeight: '600',
        color: '#111',
    },
    metricsContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: '#F6F7F9',
        borderRadius: 18,
        paddingVertical: 16,
        paddingHorizontal: 10,
        marginBottom: 20,
    },
    metricBox: {
        flex: 1,
        alignItems: 'center',
    },
    metricValue: {
        fontSize: 20,
        fontWeight: '600',
        color: '#111',
    },
    metricLabel: {
        marginTop: 4,
        fontSize: 12,
        color: '#777',
        letterSpacing: 1,
    },
    metricDivider: {
        width: 1,
        height: 40,
        backgroundColor: '#E0E0E0',
    },
    etaText: {
        fontSize: 14,
        color: '#374151',
        fontWeight: '500',
        marginBottom: 12,
        paddingHorizontal: 2,
    },
    startButton: {
        backgroundColor: '#21A772',
        paddingVertical: 18,
        borderRadius: 30,
        alignItems: 'center',
        shadowColor: '#21A772',
        shadowOpacity: 0.4,
        shadowRadius: 10,
        elevation: 8,
    },
    startButtonText: {
        color: '#fff',
        fontSize: 18,
        fontWeight: '600',
    },
    hiddenMarkersIndicator: {
        position: 'absolute',
        top: 60,
        alignSelf: 'center',
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        paddingVertical: 10,
        paddingHorizontal: 20,
        borderRadius: 25,
        flexDirection: 'row',
        alignItems: 'center',
        elevation: 10,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 6,
        zIndex: 100,
        borderWidth: 1,
        borderColor: '#059669',
    },
    hiddenMarkersText: {
        color: '#059669',
        fontWeight: '700',
        marginLeft: 8,
        fontSize: 14,
    },
});
