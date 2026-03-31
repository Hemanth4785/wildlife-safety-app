import { useState, useCallback, useRef, useEffect } from 'react';
import type { Location, AnimalPrediction, Sighting, Route, NavigationStats, NavigationAlert, WeatherData, SafePlace, TravelMode } from '../types';
import { AppState } from '../types';
import * as api from '../services/apiService';
import * as geo from '../services/geoService';
import { ANIMALS, RADIUS_KM, SEQ_LEN, SMOOTH_STEPS, MAP_CENTER, isWithinSouthIndia } from '../constants';
import { storage } from '../utils/storage';
import { logger } from '../utils/logger';
import * as ExpoLocation from 'expo-location';

const useLocalStorage = <T,>(key: string, initialValue: T): [T, (value: T | ((val: T) => T)) => void] => {
    const [storedValue, setStoredValue] = useState<T>(initialValue);
    const [isLoaded, setIsLoaded] = useState(false);

    useEffect(() => {
        const loadValue = async () => {
            try {
                const item = await storage.getItem<T>(key);
                if (item !== null) {
                    setStoredValue(item);
                }
            } catch (error) {
                logger.error(`Error loading ${key}`, error);
            } finally {
                setIsLoaded(true);
            }
        };
        loadValue();
    }, [key]);

    const setValue = useCallback((value: T | ((val: T) => T)) => {
        try {
            const valueToStore = value instanceof Function ? value(storedValue) : value;
            setStoredValue(valueToStore);
            storage.setItem(key, valueToStore);
        } catch (error) {
            logger.error(`Error setting ${key}`, error);
        }
    }, [key, storedValue]);
    
    return [storedValue, setValue];
};

const DEVIATION_THRESHOLD_KM = 0.1; // 100 meters
const REROUTE_COOLDOWN_MS = 15000; // 15 seconds

export const useAnimalData = (shouldFetch: boolean = false) => {
    const [status, setStatus] = useState<AppState>(AppState.IDLE);
    const [message, setMessage] = useState('');
    const [userLocation, setUserLocation] = useState<Location | null>(null);
    const [predictions, setPredictions] = useState<AnimalPrediction[]>([]);
    const [searchHistory, setSearchHistory] = useLocalStorage<string[]>('searchHistory', []);
    const [suggestions, setSuggestions] = useState<Location[]>([]);
    const [isSuggesting, setIsSuggesting] = useState(false);
    const debounceTimeout = useRef<number | null>(null);
    const [safeRoute, setSafeRoute] = useState<Route | null>(null);
    const [safePlaces, setSafePlaces] = useState<SafePlace[]>([]);
    const [riskZones, setRiskZones] = useState<any[]>([]);
    const [riskySegments, setRiskySegments] = useState<any[]>([]);
    const [routeStatus, setRouteStatus] = useState<AppState>(AppState.IDLE);
    const [routeMessage, setRouteMessage] = useState('');
    const [searchError, setSearchError] = useState<string | null>(null);
    const [weather, setWeather] = useState<WeatherData | null>(null);
    const isPredictingRef = useRef(false);
    const [backendReady, setBackendReady] = useState<boolean | null>(null);
    const [backendError, setBackendError] = useState<string | null>(null);

    // --- Wildlife Sightings State (Loaded once on start) ---
    const [recentSightings, setRecentSightings] = useState<any[]>([]);
    const [isWildlifeLoading, setIsWildlifeLoading] = useState(true);

    // --- Historical Mode State ---
    const [historicalMode, setHistoricalMode] = useState(false);
    const [historicalDateRange, setHistoricalDateRange] = useState<{ startDate: string; endDate: string } | null>(null);

    // --- Loading States for UX ---
    const [isLocationLoading, setIsLocationLoading] = useState(false);
    const [isRouteLoading, setIsRouteLoading] = useState(false);

    // --- State for Live Navigation ---
    const [isNavigating, setIsNavigating] = useState(false);
    const [liveLocation, setLiveLocation] = useState<Location | null>(null);
    const [navigationStats, setNavigationStats] = useState<NavigationStats | null>(null);
    const [navigationAlert, setNavigationAlert] = useState<NavigationAlert | null>(null);
    const [closestPathIndex, setClosestPathIndex] = useState(0);
    const [isApproachingStart, setIsApproachingStart] = useState(false);
    const isApproachingStartRef = useRef(false);
    const watchSubscriptionRef = useRef<ExpoLocation.LocationSubscription | null>(null);
    const lastRerouteTimestampRef = useRef<number>(0);
    const isNavigatingRef = useRef(isNavigating);
    useEffect(() => {
        isNavigatingRef.current = isNavigating;
    }, [isNavigating]);
    const predictionsRef = useRef<AnimalPrediction[]>(predictions);
    useEffect(() => { predictionsRef.current = predictions; }, [predictions]);
    const navigationAlertRef = useRef(navigationAlert);
    useEffect(() => { navigationAlertRef.current = navigationAlert; }, [navigationAlert]);

    const getPredictionsForArea = useCallback(async (location: Location): Promise<AnimalPrediction[]> => {
        if (isPredictingRef.current) {
            logger.warn("Prediction already in progress. Skipping.");
            return predictionsRef.current;
        }
        isPredictingRef.current = true;
        setStatus(AppState.LOADING);
        setMessage('Analyzing wildlife activity...');

        try {
            const animalSightingsPromises = Object.entries(ANIMALS).map(([scientificName, info]) =>
                api.getAnimalSightings(scientificName, location, RADIUS_KM).then((sightings: Sighting[]) => ({
                    scientificName,
                    sightings: sightings.slice(0, SEQ_LEN)
                }))
            );

            const sightingSets: { scientificName: string; sightings: Sighting[] }[] = (await Promise.all(animalSightingsPromises))
                .filter((set: { scientificName: string; sightings: Sighting[] }) => set.sightings.length > 0);

            if (sightingSets.length === 0) {
                setStatus(AppState.SUCCESS);
                setMessage(`No recent wildlife sightings within ${RADIUS_KM} km.`);
                setPredictions([]);
                return [];
            }

            setMessage(`Found sightings for ${sightingSets.length} species. Predicting paths...`);

            const pathPredictions = await api.predictAnimalPaths(sightingSets);

            if (pathPredictions.length === 0) {
                setStatus(AppState.SUCCESS);
                setMessage(`Found ${sightingSets.length} species with sightings, but AI predictions are not available on mobile. Please use the web version for AI-powered path predictions.`);
                setPredictions([]);
                return [];
            }

            const detailedPredictionsPromises = pathPredictions.map(async (predGroup: { scientificName: string; predictions: { lat: number; lon: number }[] }) => {
                const { scientificName, predictions: pathPoints } = predGroup;
                const sightingSet = sightingSets.find((s: { scientificName: string; sightings: Sighting[] }) => s.scientificName === scientificName);
                if (!sightingSet || sightingSet.sightings.length === 0 || pathPoints.length === 0) return null;

                const animalInfo = ANIMALS[scientificName];
                const currentSighting = sightingSet.sightings[0];
                const currentPoint = { lat: currentSighting.lat, lon: currentSighting.lon };
                const distance = geo.calculateDistance(location, currentPoint);
                const currentAddr = await api.reverseGeocode(currentPoint.lat, currentPoint.lon);

                const waypoints: [number, number][] = [
                    [currentPoint.lat, currentPoint.lon],
                    ...pathPoints.map((p: { lat: number; lon: number }) => [p.lat, p.lon] as [number, number])
                ];

                const fullPath = geo.createSplinePath(waypoints, SMOOTH_STEPS);
                
                return {
                    id: `${scientificName}-${Date.now()}`,
                    scientific: scientificName,
                    common: animalInfo.common,
                    emoji: animalInfo.emoji,
                    color: animalInfo.color,
                    image: currentSighting.image_url,
                    current: { ...currentPoint, addr: currentAddr, dist_km: parseFloat(distance.toFixed(1)) },
                    preds: pathPoints, // No reverse geocoding for all points
                    fullPath
                };
            });

            const newPredictions = (await Promise.all(detailedPredictionsPromises)).filter(Boolean) as AnimalPrediction[];
            setPredictions(newPredictions);
            setStatus(AppState.SUCCESS);
            setMessage(`Found ${newPredictions.length} potential wildlife paths.`);
            return newPredictions;
        } catch (error) {
            logger.error("Prediction process failed", error);
            setStatus(AppState.ERROR);
            setMessage("Could not predict animal paths due to an API or network error.");
            setPredictions([]);
            throw error;
        } finally {
            isPredictingRef.current = false;
        }
    }, []);

    const processLocationSearch = useCallback(async (location: Location | string) => {
        setSafeRoute(null);
        setSafePlaces([]);
        setSuggestions([]);

        let finalLocation: Location;
        if (typeof location === 'string') {
            setStatus(AppState.LOADING);
            setMessage(`Searching for "${location}"...`);
            const results = await api.searchLocations(location);
            if (results.length === 0) {
                setStatus(AppState.ERROR);
                setMessage(`Could not find location: "${location}".`);
                return;
            }
            finalLocation = results[0];
        } else {
            finalLocation = location;
        }
        
        setUserLocation(finalLocation);

        if (typeof location === 'string' && !searchHistory.includes(location)) {
            setSearchHistory(prev => [location, ...prev.slice(0, 4)]);
        }

        const weatherData = await api.getWeatherData(finalLocation.lat, finalLocation.lon);
        setWeather(weatherData);

        // Fetch safe places for the new area
        try {
            const places = await api.findSafePlacesNear(finalLocation.lat, finalLocation.lon, 15);
            if (places && places.length > 0) {
                setSafePlaces(places);
            }
        } catch (e) {
            logger.warn("Failed to fetch safe places for new area", e);
        }

        await getPredictionsForArea(finalLocation);
    }, [searchHistory, setSearchHistory, getPredictionsForArea]);

    const calculateSafeRoute = useCallback(async (start: Location | string, end: Location | string, radius: number, mode: TravelMode, excludedAnimalIds: string[] = []) => {
        setRouteStatus(AppState.LOADING);
        setIsRouteLoading(true);
        setRouteMessage('Calculating safest route...');
        setSafeRoute(null);
        setSafePlaces([]);
        setRiskZones([]);
        setRiskySegments([]);

        try {
            let startLoc: Location, endLoc: Location;
            if (typeof start === 'string') {
                const results = await api.searchLocations(start);
                if (results.length === 0) throw new Error(`Could not find start location: "${start}"`);
                startLoc = results[0];
            } else {
                startLoc = start;
            }
            if (typeof end === 'string') {
                const results = await api.searchLocations(end);
                if (results.length === 0) throw new Error(`Could not find destination: "${end}"`);
                endLoc = results[0];
            } else {
                endLoc = end;
            }

            // Regional Restriction: Check if start or end is outside South India
            if (!isWithinSouthIndia(startLoc.lat, startLoc.lon) || !isWithinSouthIndia(endLoc.lat, endLoc.lon)) {
                setRouteStatus(AppState.ERROR);
                setIsRouteLoading(false);
                setRouteMessage('Wildlife Safety is currently supported only in South India.');
                return null;
            }

            const route = await api.getRoute(startLoc, endLoc);
            if (route) {
                setSafeRoute(route);
                
                // Fetch risk zones and safe places in parallel
                const [places, riskData] = await Promise.all([
                    api.findSafePlacesAlongRoute(route.path),
                    api.getAnimalsNearRoute(route.path)
                ]);

                setSafePlaces(places);
                setRiskZones(riskData.riskZones);
                setRiskySegments(riskData.riskySegments);
                
                setRouteStatus(AppState.SUCCESS);
                setIsRouteLoading(false);
                setRouteMessage('Safe route found!');
                return route;
            } else {
                setRouteStatus(AppState.ERROR);
                setIsRouteLoading(false);
                setRouteMessage('Safe route unavailable, try again');
                return null;
            }
        } catch (error: any) {
            setRouteStatus(AppState.ERROR);
            setIsRouteLoading(false);
            setRouteMessage(error.message || 'Failed to calculate route.');
            return null;
        }
    }, []);
    

    const fetchSuggestions = useCallback((query: string) => {
        if (debounceTimeout.current) clearTimeout(debounceTimeout.current);
        
        const q = query.trim();
        if (q.length < 3) {
            setSuggestions([]);
            setIsSuggesting(false);
            setSearchError(null);
            return;
        }

        setIsSuggesting(true);
        setSearchError(null);
        debounceTimeout.current = setTimeout(async () => {
            try {
                const results = await api.searchLocations(q);
                setSuggestions(results);
            } catch (error: any) {
                logger.error("Suggestion fetch error", error);
                setSuggestions([]);
                setSearchError("Location search unavailable");
            } finally {
                setIsSuggesting(false);
            }
        }, 500) as unknown as number; // 500ms debounce
    }, []);

    const clearSuggestions = useCallback(() => {
        setSuggestions([]);
        setSearchError(null);
    }, []);

    const getCurrentLocation = useCallback(async (): Promise<Location> => {
        setIsLocationLoading(true);
        const { status } = await ExpoLocation.requestForegroundPermissionsAsync();

        if (status !== 'granted') {
            setIsLocationLoading(false);
            const error: any = new Error('Location permission was denied');
            error.code = 'LOCATION_PERMISSION_DENIED';
            throw error;
        }

        try {
            const position = await ExpoLocation.getCurrentPositionAsync({
                accuracy: ExpoLocation.Accuracy.High,
            });
            const { latitude, longitude } = position.coords;
            const name = await api.reverseGeocode(latitude, longitude);
            setIsLocationLoading(false);
            return { lat: latitude, lon: longitude, name };
        } catch (error: any) {
            setIsLocationLoading(false);
            logger.error("Geolocation error", error);
            throw new Error("Could not get current location. Please check your device's permissions.");
        }
    }, []);
    
    useEffect(() => {
        if (!shouldFetch) {
            setBackendReady(null);
            setBackendError(null);
        }
    }, [shouldFetch]);

    useEffect(() => {
        if (!shouldFetch) return;

        const checkBackend = async () => {
            try {
                logger.info('[Health] Checking backend status...');
                const ok = await api.checkBackendHealth();
                if (!ok) {
                    setBackendReady(false);
                    setBackendError('Backend API is not reachable. Some features may be limited.');
                } else {
                    setBackendReady(true);
                    setBackendError(null);
                }
            } catch (error) {
                logger.error('Backend health check failed', error);
                setBackendReady(false);
                setBackendError('Backend API is not reachable. Some features may be limited.');
            }

            // If a route is active, we IGNORE historical mode and strictly show current to 30 days
            const isHistoricalActive = historicalMode && historicalDateRange && !safeRoute;

            // Always try to fetch wildlife, as api.fetchRecentWildlife has a static fallback
            try {
                setIsWildlifeLoading(true);
                const data = isHistoricalActive
                    ? await api.fetchRecentWildlife(historicalDateRange.startDate, historicalDateRange.endDate)
                    : await api.fetchRecentWildlife();
                setRecentSightings(data);
            } catch (err) {
                logger.error('Failed to fetch wildlife sightings', err);
            } finally {
                setIsWildlifeLoading(false);
            }
        };
        checkBackend();
    }, [shouldFetch, historicalMode, historicalDateRange, safeRoute]);

    useEffect(() => {
        if (!shouldFetch) return;

        const fetchInitialData = async () => {
            try {
                setStatus(AppState.LOADING);
                setMessage("Getting your location for weather data...");
                const location = await getCurrentLocation();
                setUserLocation(location);
                
                // Fetch weather and safe places in parallel
                const [weatherData, places] = await Promise.all([
                    api.getWeatherData(location.lat, location.lon),
                    api.findSafePlacesNear(location.lat, location.lon, 10)
                ]);
                
                setWeather(weatherData);
                if (places && places.length > 0) {
                    setSafePlaces(places);
                }
                
                setStatus(AppState.SUCCESS);
                setMessage("Displaying local weather and safe spots. Search an area to see wildlife risks.");
            } catch (error: any) {
                logger.error("Failed to fetch initial location/weather", error);
                const fallbackLocation = { lat: MAP_CENTER[0], lon: MAP_CENTER[1], name: 'Default Center' };
                try {
                    setUserLocation(fallbackLocation);
                    const weatherData = await api.getWeatherData(fallbackLocation.lat, fallbackLocation.lon);
                    setWeather(weatherData);
                    setStatus(AppState.SUCCESS);
                    setMessage("Using default center. Enable location permissions for precise data.");
                } catch {
                    setStatus(AppState.ERROR);
                    setMessage(error.message || "Could not fetch your location for weather data.");
                }
            }
        };

        fetchInitialData();
    }, [shouldFetch, getCurrentLocation]);
    
    const clearNavigationAlert = useCallback(() => setNavigationAlert(null), []);

    const stopNavigation = useCallback(() => {
        if (watchSubscriptionRef.current !== null) {
            watchSubscriptionRef.current.remove();
            watchSubscriptionRef.current = null;
        }
        setIsNavigating(false);
        setLiveLocation(null);
        setNavigationStats(null);
        setNavigationAlert(null);
        setSafeRoute(null);
        // Do NOT clear safe places here so they remain visible on the map
        setIsApproachingStart(false);
        isApproachingStartRef.current = false;
    }, []);

    const safeRouteRef = useRef(safeRoute);
    useEffect(() => { safeRouteRef.current = safeRoute; }, [safeRoute]);

    const startNavigation = useCallback(async (nearbyRadius: number) => {
        try {
            if (!safeRouteRef.current || !safeRouteRef.current.path || safeRouteRef.current.path.length === 0) {
                setRouteMessage('Cannot start navigation without a calculated route.');
                setRouteStatus(AppState.ERROR);
                return;
            }

            const PROXIMITY_ALERT_KM = nearbyRadius / 5;
            const APPROACHING_START_THRESHOLD_KM = 0.5;

            setIsNavigating(true);
            setNavigationAlert(null);

            if (watchSubscriptionRef.current !== null) {
                watchSubscriptionRef.current.remove();
            }

            // Request permissions
            const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                setNavigationAlert({ animal: null, message: 'Location permission denied. Please enable location services.' });
                setIsNavigating(false);
                return;
            }

            watchSubscriptionRef.current = await ExpoLocation.watchPositionAsync(
                {
                    accuracy: ExpoLocation.Accuracy.High,
                    timeInterval: 1000,
                    distanceInterval: 10,
                },
                async (position: ExpoLocation.LocationObject) => {
                    try {
                        if (!position || !position.coords) return;
                        
                        // If we just recovered from a GPS error, clear the alert.
                        if (navigationAlertRef.current?.message.includes("Live location signal lost")) {
                            clearNavigationAlert();
                        }

                        const currentLiveLocation: Location = {
                            lat: position.coords.latitude,
                            lon: position.coords.longitude,
                            name: 'Live Location'
                        };
                        setLiveLocation(currentLiveLocation);

                        if (!safeRouteRef.current || !Array.isArray(safeRouteRef.current.path) || safeRouteRef.current.path.length < 2) return;

                        const { path: routePath, end: routeEnd, mode: routeMode } = safeRouteRef.current;
                        const { remainingPath, distanceToPathKm, closestPointIndex: newClosestPointIndex } = geo.getPathDataFromLocation(currentLiveLocation, routePath);
                        
                        // Check if path point exists before accessing
                        if (!routePath[0] || routePath[0].length < 2) return;
                        const distanceToStart = geo.calculateDistance(currentLiveLocation, { lat: routePath[0][0], lon: routePath[0][1] });

                        // Handle approaching start logic
                        const wasApproaching = isApproachingStartRef.current;
                        const isNowApproaching = newClosestPointIndex === 0 && distanceToStart > APPROACHING_START_THRESHOLD_KM;
                        
                        if (isNowApproaching) {
                            if (!wasApproaching) {
                                isApproachingStartRef.current = true;
                                setIsApproachingStart(true);
                            }
                            setMessage(`Proceed to the starting point. You are ${distanceToStart.toFixed(1)} km away.`);
                            setNavigationStats({
                                remainingKm: safeRouteRef.current.distanceKm,
                                etaMinutes: safeRouteRef.current.durationMinutes,
                                progressPercent: 0
                            });
                            return;
                        } else if (wasApproaching && !isNowApproaching) {
                            isApproachingStartRef.current = false;
                            setIsApproachingStart(false);
                            setNavigationAlert({ animal: null, message: "You've reached the start. Navigation has begun!" });
                        }

                        setClosestPathIndex(newClosestPointIndex);

                        const remainingDistanceKm = geo.calculatePolylineDistance(remainingPath);
                        const totalDistanceKm = safeRouteRef.current.distanceKm || 0;
                        const progressPercent = totalDistanceKm > 0 ? Math.round(((totalDistanceKm - remainingDistanceKm) / totalDistanceKm) * 100) : 0;
                        
                        // Robust avg speed calculation
                        let avgSpeedKpm = 0.5; // Default: ~30km/h
                        const duration = safeRouteRef.current.durationMinutes;
                        if (totalDistanceKm > 0 && typeof duration === 'number' && duration > 0) {
                            avgSpeedKpm = totalDistanceKm / duration;
                        } else {
                            // Use travel mode as fallback
                            const mode = safeRouteRef.current.mode;
                            if (mode === 'walk') avgSpeedKpm = 4 / 60;
                            else if (mode === 'bike') avgSpeedKpm = 12 / 60;
                            else if (mode === 'bus') avgSpeedKpm = 30 / 60;
                            else avgSpeedKpm = 45 / 60; // car/default
                        }

                        const etaMinutes = remainingDistanceKm / (avgSpeedKpm || 0.1);

                        setNavigationStats({
                            remainingKm: parseFloat(remainingDistanceKm.toFixed(1)),
                            etaMinutes: Math.round(Number.isFinite(etaMinutes) ? etaMinutes : 0),
                            progressPercent: Math.max(0, Math.min(100, progressPercent)),
                        });

                        const now = Date.now();

                        if (now - lastRerouteTimestampRef.current > REROUTE_COOLDOWN_MS) {
                            // Check for route deviation
                            if (distanceToPathKm > DEVIATION_THRESHOLD_KM) {
                                lastRerouteTimestampRef.current = now;
                                setNavigationAlert({ animal: null, message: "You've deviated from the safe route. Rerouting..." });
                                await calculateSafeRoute(currentLiveLocation, routeEnd, nearbyRadius, routeMode);
                                return;
                            }
                            
                            let closestAnimal: AnimalPrediction | null = null;
                            let closestDistKm = Infinity;
                            const preds = predictionsRef.current;
                            for (const animal of preds) {
                                const { distanceToPathKm: distKm } = geo.getPathDataFromLocation(currentLiveLocation, animal.fullPath);
                                if (distKm < closestDistKm) {
                                    closestDistKm = distKm;
                                    closestAnimal = animal;
                                }
                            }

                            if (closestAnimal && closestDistKm < PROXIMITY_ALERT_KM) {
                                lastRerouteTimestampRef.current = now;
                                const alertAnimal = closestAnimal;
                                setNavigationAlert({ animal: alertAnimal, message: `Approaching ${alertAnimal.common}! Rerouting to a safer path.` });
                                await calculateSafeRoute(currentLiveLocation, routeEnd, nearbyRadius, routeMode, [alertAnimal.id]);
                                return;
                            }
                        }
                    } catch (err) {
                        logger.error("Error in location watch callback", err);
                    }
                }
            );
        } catch (error) {
            logger.error("Failed to start navigation", error);
            setIsNavigating(false);
            setNavigationAlert({ animal: null, message: 'Could not start navigation. Please try again.' });
        }
    }, [stopNavigation, calculateSafeRoute, clearNavigationAlert]);

    const clearSearchHistory = () => setSearchHistory([]);

    return {
        status, message, userLocation, predictions, processLocationSearch,
        searchHistory, clearSearchHistory,
        suggestions, isSuggesting, fetchSuggestions, clearSuggestions, searchError,
        safeRoute, routeStatus, routeMessage, calculateSafeRoute, safePlaces, riskZones, riskySegments,
        isNavigating, liveLocation, navigationStats, startNavigation, stopNavigation,
        navigationAlert, clearNavigationAlert, closestPathIndex, getCurrentLocation,
        weather, isApproachingStart,
        backendReady, backendError,
        recentSightings, isWildlifeLoading, isLocationLoading, isRouteLoading,
        historicalMode, setHistoricalMode, historicalDateRange, setHistoricalDateRange
    };
};
