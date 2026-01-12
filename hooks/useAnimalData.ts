import { useState, useCallback, useRef, useEffect } from 'react';
import type { Location, AnimalPrediction, Sighting, Route, NavigationStats, NavigationAlert, WeatherData, SafePlace, TravelMode } from '../types';
import { AppState } from '../types';
import * as api from '../services/apiService';
import * as geo from '../services/geoService';
import { ANIMALS, RADIUS_KM, SEQ_LEN, SMOOTH_STEPS } from '../constants';

const useLocalStorage = <T,>(key: string, initialValue: T): [T, (value: T | ((val: T) => T)) => void] => {
    const [storedValue, setStoredValue] = useState<T>(() => {
        try {
            const item = window.localStorage.getItem(key);
            return item ? JSON.parse(item) : initialValue;
        } catch (error) {
            console.error(error);
            return initialValue;
        }
    });

    const setValue = (value: T | ((val: T) => T)) => {
        try {
            const valueToStore = value instanceof Function ? value(storedValue) : value;
            setStoredValue(valueToStore);
            window.localStorage.setItem(key, JSON.stringify(valueToStore));
        } catch (error) {
            console.error(error);
        }
    };
    return [storedValue, setValue];
};

const DEVIATION_THRESHOLD_KM = 0.1; // 100 meters
const REROUTE_COOLDOWN_MS = 15000; // 15 seconds

export const useAnimalData = () => {
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
    const [routeStatus, setRouteStatus] = useState<AppState>(AppState.IDLE);
    const [routeMessage, setRouteMessage] = useState('');
    const [weather, setWeather] = useState<WeatherData | null>(null);
    const isPredictingRef = useRef(false);

    // --- State for Live Navigation ---
    const [isNavigating, setIsNavigating] = useState(false);
    const [liveLocation, setLiveLocation] = useState<Location | null>(null);
    const [navigationStats, setNavigationStats] = useState<NavigationStats | null>(null);
    const [navigationAlert, setNavigationAlert] = useState<NavigationAlert | null>(null);
    const [closestPathIndex, setClosestPathIndex] = useState(0);
    const [isApproachingStart, setIsApproachingStart] = useState(false);
    const isApproachingStartRef = useRef(false);
    const watchIdRef = useRef<number | null>(null);
    const lastRerouteTimestampRef = useRef<number>(0);
    const isNavigatingRef = useRef(isNavigating);
    useEffect(() => {
        isNavigatingRef.current = isNavigating;
    }, [isNavigating]);
    const predictionsRef = useRef(predictions);
    useEffect(() => { predictionsRef.current = predictions; }, [predictions]);
    const navigationAlertRef = useRef(navigationAlert);
    useEffect(() => { navigationAlertRef.current = navigationAlert; }, [navigationAlert]);

    const getPredictionsForArea = useCallback(async (location: Location): Promise<AnimalPrediction[]> => {
        if (isPredictingRef.current) {
            console.warn("Prediction already in progress. Skipping.");
            return predictionsRef.current;
        }
        isPredictingRef.current = true;
        setStatus(AppState.LOADING);
        setMessage('Analyzing wildlife activity...');

        try {
            const animalSightingsPromises = Object.entries(ANIMALS).map(([scientificName, info]) =>
                api.getAnimalSightings(scientificName, location, RADIUS_KM).then(sightings => ({
                    scientificName,
                    sightings: sightings.slice(0, SEQ_LEN)
                }))
            );

            const sightingSets = (await Promise.all(animalSightingsPromises))
                .filter(set => set.sightings.length > 0);

            if (sightingSets.length === 0) {
                setStatus(AppState.SUCCESS);
                setMessage(`No recent wildlife sightings within ${RADIUS_KM} km.`);
                setPredictions([]);
                return [];
            }

            setMessage(`Found sightings for ${sightingSets.length} species. Predicting paths...`);

            const pathPredictions = await api.predictAnimalPaths(sightingSets);

            const detailedPredictionsPromises = pathPredictions.map(async (predGroup) => {
                const { scientificName, predictions: pathPoints } = predGroup;
                const sightingSet = sightingSets.find(s => s.scientificName === scientificName);
                if (!sightingSet || sightingSet.sightings.length === 0 || pathPoints.length === 0) return null;

                const animalInfo = ANIMALS[scientificName];
                const currentSighting = sightingSet.sightings[0];
                const currentPoint = { lat: currentSighting.lat, lon: currentSighting.lon };
                const distance = geo.calculateDistance(location, currentPoint);
                const currentAddr = await api.reverseGeocode(currentPoint.lat, currentPoint.lon);

                const waypoints: [number, number][] = [
                    [currentPoint.lat, currentPoint.lon],
                    ...pathPoints.map(p => [p.lat, p.lon] as [number, number])
                ];

                const fullPath = geo.createSplinePath(waypoints, SMOOTH_STEPS);
                
                return {
                    id: `${scientificName}-${Date.now()}`,
                    scientific: scientificName,
                    common: animalInfo.common,
                    emoji: animalInfo.emoji,
                    color: animalInfo.color,
                    image: currentSighting.image,
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
            console.error("Prediction process failed:", error);
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

        await getPredictionsForArea(finalLocation);
    }, [searchHistory, setSearchHistory, getPredictionsForArea]);

    const calculateSafeRoute = useCallback(async (start: Location | string, end: Location | string, radius: number, mode: TravelMode, excludedAnimalIds: string[] = []) => {
        setRouteStatus(AppState.LOADING);
        setRouteMessage('Calculating safest route...');
        setSafeRoute(null);
        setSafePlaces([]);
    
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
    
            const searchCenter = geo.getMidpoint(startLoc, endLoc);
            const relevantPredictions = isNavigatingRef.current
                ? predictionsRef.current
                : await getPredictionsForArea(searchCenter);
    
            const avoidancePolygons = relevantPredictions
                .filter(p => !excludedAnimalIds.includes(p.id))
                .map(p => geo.createCirclePolygon([p.current.lat, p.current.lon], radius / 10)); // smaller avoidance for individual points
    
            const route = await api.getSafeNavigationRoute(startLoc, endLoc, avoidancePolygons, mode);
            if (route) {
                setSafeRoute(route);
                const places = await api.findSafePlacesAlongRoute(route.path);
                setSafePlaces(places);
                setRouteStatus(AppState.SUCCESS);
                setRouteMessage('Safe route found!');
                return route;
            } else {
                throw new Error('Could not find a route.');
            }
        } catch (error: any) {
            setRouteStatus(AppState.ERROR);
            setRouteMessage(error.message || 'Failed to calculate route.');
            return null;
        }
    }, [getPredictionsForArea]);
    

    const fetchSuggestions = useCallback((query: string) => {
        if (debounceTimeout.current) clearTimeout(debounceTimeout.current);
        if (!query.trim()) {
            setSuggestions([]);
            return;
        }
        setIsSuggesting(true);
        debounceTimeout.current = window.setTimeout(async () => {
            const results = await api.searchLocations(query);
            setSuggestions(results);
            setIsSuggesting(false);
        }, 300);
    }, []);

    const clearSuggestions = useCallback(() => setSuggestions([]), []);

    const getCurrentLocation = useCallback(async (): Promise<Location> => {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                reject(new Error("Geolocation is not supported by your browser."));
                return;
            }
            navigator.geolocation.getCurrentPosition(
                async (position) => {
                    const { latitude, longitude } = position.coords;
                    const name = await api.reverseGeocode(latitude, longitude);
                    resolve({ lat: latitude, lon: longitude, name });
                },
                (error) => {
                     console.error("Geolocation error:", error);
                     reject(new Error("Could not get current location. Please check your browser's permissions."));
                },
                { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
            );
        });
    }, []);
    
    // Initial load effect
    useEffect(() => {
        const fetchInitialData = async () => {
            try {
                setStatus(AppState.LOADING);
                setMessage("Getting your location for weather data...");
                const location = await getCurrentLocation();
                setUserLocation(location);
                const weatherData = await api.getWeatherData(location.lat, location.lon);
                setWeather(weatherData);
                setStatus(AppState.SUCCESS);
                setMessage("Displaying local weather. Search an area to see wildlife risks.");
            } catch (error: any) {
                console.error("Failed to fetch initial location/weather:", error);
                setStatus(AppState.ERROR);
                setMessage(error.message || "Could not fetch your location for weather data.");
            }
        };

        fetchInitialData();
    }, [getCurrentLocation]);
    
    const clearNavigationAlert = useCallback(() => setNavigationAlert(null), []);

    const stopNavigation = useCallback(() => {
        if (watchIdRef.current !== null) {
            navigator.geolocation.clearWatch(watchIdRef.current);
            watchIdRef.current = null;
        }
        setIsNavigating(false);
        setLiveLocation(null);
        setNavigationStats(null);
        setNavigationAlert(null);
        setSafeRoute(null);
        setSafePlaces([]);
        setIsApproachingStart(false);
        isApproachingStartRef.current = false;
    }, []);

    const safeRouteRef = useRef(safeRoute);
    useEffect(() => { safeRouteRef.current = safeRoute; }, [safeRoute]);

    const startNavigation = useCallback((nearbyRadius: number) => {
        if (!safeRouteRef.current || !safeRouteRef.current.path || safeRouteRef.current.path.length === 0) {
            setRouteMessage('Cannot start navigation without a calculated route.');
            setRouteStatus(AppState.ERROR);
            return;
        }

        const PROXIMITY_ALERT_KM = nearbyRadius / 5;
        const APPROACHING_START_THRESHOLD_KM = 0.5;

        setIsNavigating(true);
        setNavigationAlert(null);

        if (watchIdRef.current !== null) {
            navigator.geolocation.clearWatch(watchIdRef.current);
        }

        watchIdRef.current = navigator.geolocation.watchPosition(
            async (position) => {
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

                if (!safeRouteRef.current) return;

                const { path: routePath, end: routeEnd, mode: routeMode } = safeRouteRef.current;
                const { remainingPath, distanceToPathKm, closestPointIndex: newClosestPointIndex } = geo.getPathDataFromLocation(currentLiveLocation, routePath);
                
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
                const totalDistanceKm = safeRouteRef.current.distanceKm;
                const progressPercent = totalDistanceKm > 0 ? Math.round(((totalDistanceKm - remainingDistanceKm) / totalDistanceKm) * 100) : 0;
                
                const avgSpeedKpm = totalDistanceKm > 0 ? totalDistanceKm / safeRouteRef.current.durationMinutes : 1;
                const etaMinutes = remainingDistanceKm / avgSpeedKpm;

                setNavigationStats({
                    remainingKm: parseFloat(remainingDistanceKm.toFixed(1)),
                    etaMinutes: Math.round(etaMinutes),
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
                    
                    // Check for proximity to animal paths
                    let closestAnimal: { animal: AnimalPrediction; distKm: number } | null = null;
                    predictionsRef.current.forEach(animal => {
                        const { distanceToPathKm: distKm } = geo.getPathDataFromLocation(currentLiveLocation, animal.fullPath);
                        if (distKm < (closestAnimal?.distKm ?? Infinity)) {
                            closestAnimal = { animal, distKm };
                        }
                    });

                    if (closestAnimal && closestAnimal.distKm < PROXIMITY_ALERT_KM) {
                        lastRerouteTimestampRef.current = now;
                        setNavigationAlert({ animal: closestAnimal.animal, message: `Approaching ${closestAnimal.animal.common}! Rerouting to a safer path.` });
                        await calculateSafeRoute(currentLiveLocation, routeEnd, nearbyRadius, routeMode, [closestAnimal.animal.id]);
                        return;
                    }
                }

            },
            (error) => {
                console.error("Geolocation watch error:", error);
                setNavigationAlert({ animal: null, message: "Live location signal lost. Please check your GPS and permissions." });
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    }, [stopNavigation, calculateSafeRoute, clearNavigationAlert]);

    const clearSearchHistory = () => setSearchHistory([]);

    return {
        status, message, userLocation, predictions, processLocationSearch,
        searchHistory, clearSearchHistory,
        suggestions, isSuggesting, fetchSuggestions, clearSuggestions,
        safeRoute, routeStatus, routeMessage, calculateSafeRoute, safePlaces,
        isNavigating, liveLocation, navigationStats, startNavigation, stopNavigation,
        navigationAlert, clearNavigationAlert, closestPathIndex, getCurrentLocation,
        weather, isApproachingStart
    };
};