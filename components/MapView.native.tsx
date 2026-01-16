import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, TextInput, ScrollView, Alert } from 'react-native';
import MapViewNative, { Marker, Polyline, Circle, PROVIDER_GOOGLE } from 'react-native-maps';
import type { AnimalPrediction, Location, Route, NavigationStats, NavigationAlert, SafePlace, TravelMode } from '../types';
import { AppState } from '../types';
import { MAP_CENTER, MAP_ZOOM, ANIMATION_STEPS } from '../constants';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { FilterIcon, PlayIcon, PauseIcon, AlertTriangleIcon, InfoIcon, StopIcon, XIcon, PaperPlaneIcon, SpinnerIcon, ErrorIcon, LocationMarkerIcon, SyncIcon, ShieldIcon, RainIcon, CarIcon, WalkIcon, BikeIcon, BusIcon } from './icons';
import AnimalDetailModal from './AnimalDetailModal';
import * as api from '../services/apiService';
import { clusterAnimals, type AnimalCluster } from '../utils/clustering';

const easeInOutSine = (x: number): number => -(Math.cos(Math.PI * x) - 1) / 2;


interface MapViewProps {
    status: AppState;
    message: string;
    userLocation: Location | null;
    predictions: AnimalPrediction[];
    safeRoute: Route | null;
    safePlaces: SafePlace[];
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
}

const MapViewComponent: React.FC<MapViewProps> = (props) => {
    const { 
        userLocation, predictions, animationProgress, nearbyRadiusKm, 
        safeRoute, safePlaces, isNavigating, liveLocation, navigationStats, 
        onStopNavigation, navigationAlert, clearNavigationAlert, closestPathIndex,
        isPlaying, onPlay, onPause, isApproachingStart,
        onCalculateSafeRoute, routeStatus, routeMessage, suggestions,
        isSuggesting, onFetchSuggestions, onClearSuggestions, getCurrentLocation
    } = props;
    
    const mapRef = useRef<MapViewNative>(null);
    const [isPlanningRoute, setIsPlanningRoute] = useState(false);
    const [detailModalAnimal, setDetailModalAnimal] = useState<AnimalPrediction | null>(null);
    const [animalClusters, setAnimalClusters] = useState<AnimalCluster[]>([]);
    const pathIndexRef = useRef(0);
    const [showRouteSummary, setShowRouteSummary] = useState(false);
    const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);
    const [visibleAnimals, setVisibleAnimals] = useLocalStorage<Record<string, boolean>>('map-filter-animals', {});
    const [showPredictions, setShowPredictions] = useLocalStorage<boolean>('map-filter-predictions', true);
    const [showNearbyRadius, setShowNearbyRadius] = useLocalStorage<boolean>('map-filter-radius', true);
    const [showWeatherOverlay, setShowWeatherOverlay] = useLocalStorage<boolean>('map-filter-weather', false);

    const animalTypes = useMemo(() => Array.from(new Set(predictions.map(p => p.common))).sort(), [predictions]);

    useEffect(() => {
        if (safeRoute && routeStatus === AppState.SUCCESS && !isNavigating) {
            setShowRouteSummary(true);
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

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.headerTitle}>Wildlife Safety Map</Text>
                <View style={styles.headerActions}>
                    <TouchableOpacity style={styles.headerButton} onPress={() => setIsFilterPanelOpen(!isFilterPanelOpen)}>
                        <FilterIcon width={20} height={20} color="#374151" />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.headerButton} onPress={() => setIsPlanningRoute(true)}>
                        <PaperPlaneIcon width={20} height={20} color="#374151" />
                        <Text style={styles.routeButtonText}>Route</Text>
                    </TouchableOpacity>
                </View>
            </View>

            <View style={styles.mapContainer}>
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

                <MapViewNative
                    ref={mapRef}
                    provider={PROVIDER_GOOGLE}
                    style={styles.map}
                    initialRegion={initialRegion}
                    showsUserLocation={!isNavigating && !!userLocation}
                    showsMyLocationButton={false}
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

                    {safeRoute && (
                        <>
                            {isNavigating ? (
                                <>
                                    <Polyline
                                        coordinates={completedPath.map(([lat, lon]) => ({ latitude: lat, longitude: lon }))}
                                        strokeColor="#6b7280"
                                        strokeWidth={5}
                                        lineDashPattern={[5, 10]}
                                    />
                                    <Polyline
                                        coordinates={remainingPath.map(([lat, lon]) => ({ latitude: lat, longitude: lon }))}
                                        strokeColor="#10b981"
                                        strokeWidth={7}
                                    />
                                </>
                            ) : (
                                <Polyline
                                    coordinates={safeRoute.path.map(([lat, lon]) => ({ latitude: lat, longitude: lon }))}
                                    strokeColor="#10b981"
                                    strokeWidth={6}
                                />
                            )}
                            <Marker
                                coordinate={{ latitude: safeRoute.end.lat, longitude: safeRoute.end.lon }}
                                title="Destination"
                                description={safeRoute.end.name}
                            />
                        </>
                    )}

                    {animalClusters.map(cluster => {
                        const pathIndex = pathIndexRef.current;
                        if (cluster.members.length > 1) {
                            return (
                                <Marker
                                    key={cluster.id}
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
                                <React.Fragment key={p.id}>
                                    <Polyline
                                        coordinates={p.fullPath.slice(0, pathIndex + 1).map(([lat, lon]) => ({ latitude: lat, longitude: lon }))}
                                        strokeColor={p.color}
                                        strokeWidth={4}
                                    />
                                    <Marker
                                        coordinate={{ latitude: p.fullPath[pathIndex][0], longitude: p.fullPath[pathIndex][1] }}
                                        title={p.common}
                                        description={p.current.addr}
                                        onPress={() => handleViewDetails(p)}
                                    >
                                        <Text style={styles.animalEmoji}>{p.emoji}</Text>
                                    </Marker>
                                </React.Fragment>
                            );
                        }
                        return null;
                    })}

                    {safePlaces.map(place => (
                        <Marker
                            key={place.id}
                            coordinate={{ latitude: place.lat, longitude: place.lon }}
                            title={place.name}
                            description={place.type}
                        >
                            <View style={[styles.safePlaceMarker, place.type === 'police' ? styles.policeMarker : styles.rangerMarker]}>
                                <ShieldIcon width={16} height={16} color="#ffffff" />
                            </View>
                        </Marker>
                    ))}
                </MapViewNative>

                <TouchableOpacity
                    style={styles.playButton}
                    onPress={isPlaying ? onPause : onPlay}
                >
                    {isPlaying ? <PauseIcon width={24} height={24} color="#374151" /> : <PlayIcon width={24} height={24} color="#374151" />}
                </TouchableOpacity>

                {isNavigating && navigationStats && (
                    <View style={styles.navigationPanel}>
                        <View style={styles.navigationStats}>
                            <Text style={styles.etaText}>{navigationStats.etaMinutes}<Text style={styles.etaUnit}> min</Text></Text>
                            <Text style={styles.distanceText}>{navigationStats.remainingKm} km remaining</Text>
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
                        <Text style={styles.statText}>{filteredPredictions.length} Risk Zones</Text>
                    </View>
                    <View style={styles.statItem}>
                        <ShieldIcon width={20} height={20} color="#10b981" />
                        <Text style={styles.statText}>{safeRoute ? 1 : 0} Safe Routes</Text>
                    </View>
                </View>
                <TouchableOpacity style={styles.planRouteButton} onPress={() => setIsPlanningRoute(true)}>
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

            {showRouteSummary && safeRoute && (
                <Modal visible={showRouteSummary} transparent animationType="slide">
                    <View style={styles.modalOverlay}>
                        <View style={styles.routeSummaryPanel}>
                            <View style={styles.routeSummaryHeader}>
                                <Text style={styles.routeSummaryTitle}>Your Safe Route is Ready!</Text>
                                <TouchableOpacity onPress={() => setShowRouteSummary(false)}>
                                    <XIcon width={24} height={24} color="#374151" />
                                </TouchableOpacity>
                            </View>
                            <View style={styles.routeSummaryStats}>
                                <View style={styles.routeStat}>
                                    <Text style={styles.routeStatValue}>{safeRoute.distanceKm}</Text>
                                    <Text style={styles.routeStatLabel}>KM</Text>
                                </View>
                                <View style={styles.routeStat}>
                                    <Text style={styles.routeStatValue}>{safeRoute.durationMinutes}</Text>
                                    <Text style={styles.routeStatLabel}>MINS</Text>
                                </View>
                                <View style={styles.routeStat}>
                                    <Text style={[styles.routeStatValue, styles.riskValue]}>{predictions.length}</Text>
                                    <Text style={styles.routeStatLabel}>RISKS AVOIDED</Text>
                                </View>
                                <View style={styles.routeStat}>
                                    <Text style={[styles.routeStatValue, styles.safeValue]}>{safePlaces.length}</Text>
                                    <Text style={styles.routeStatLabel}>SAFE SPOTS</Text>
                                </View>
                            </View>
                            <TouchableOpacity
                                style={styles.startNavigationButton}
                                onPress={() => {
                                    setShowRouteSummary(false);
                                    props.onStartNavigation();
                                }}
                            >
                                <Text style={styles.startNavigationText}>Start Navigation</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </Modal>
            )}

            <RoutePlannerSheet
                isOpen={isPlanningRoute}
                onClose={() => setIsPlanningRoute(false)}
                onCalculateSafeRoute={onCalculateSafeRoute}
                routeStatus={routeStatus}
                routeMessage={routeMessage}
                suggestions={suggestions}
                isSuggesting={isSuggesting}
                onFetchSuggestions={onFetchSuggestions}
                onClearSuggestions={onClearSuggestions}
                getCurrentLocation={getCurrentLocation}
                nearbyRadiusKm={nearbyRadiusKm}
            />

            {detailModalAnimal && (
                <AnimalDetailModal animal={detailModalAnimal} onClose={() => setDetailModalAnimal(null)} />
            )}
        </View>
    );
};

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
}

const RoutePlannerSheet: React.FC<RoutePlannerSheetProps> = ({
    isOpen, onClose, onCalculateSafeRoute, routeStatus, routeMessage,
    suggestions, isSuggesting, onFetchSuggestions, onClearSuggestions,
    getCurrentLocation, nearbyRadiusKm
}) => {
    const [startQuery, setStartQuery] = useState('');
    const [destQuery, setDestQuery] = useState('');
    const [selectedStart, setSelectedStart] = useState<Location | null>(null);
    const [selectedDest, setSelectedDest] = useState<Location | null>(null);
    const [activeInput, setActiveInput] = useState<'start' | 'dest' | null>(null);
    const [isGettingLocation, setIsGettingLocation] = useState(false);
    const [localError, setLocalError] = useState('');
    const [travelMode, setTravelMode] = useState<TravelMode>('car');

    const travelModes: { mode: TravelMode; label: string }[] = [
        { mode: 'car', label: 'Car' },
        { mode: 'walk', label: 'Walk' },
        { mode: 'bike', label: 'Bike' },
        { mode: 'bus', label: 'Bus' },
    ];

    const handleUseMyLocation = async () => {
        setIsGettingLocation(true);
        onClearSuggestions();
        try {
            const location = await getCurrentLocation();
            setSelectedStart(location);
            setStartQuery(location.name.split(',').slice(0, 2).join(', '));
        } catch (error: any) {
            // Error already handled by getCurrentLocation
            setStartQuery("Could not fetch location");
        } finally {
            setIsGettingLocation(false);
        }
    };

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
        <Modal visible={isOpen} transparent animationType="slide">
            <View style={styles.modalOverlay}>
                <View style={styles.routePlannerSheet}>
                    <View style={styles.routePlannerHeader}>
                        <Text style={styles.routePlannerTitle}>Plan a Safe Route</Text>
                        <TouchableOpacity onPress={onClose}>
                            <XIcon width={24} height={24} color="#374151" />
                        </TouchableOpacity>
                    </View>
                    <ScrollView style={styles.routePlannerContent}>
                        <View style={styles.inputGroup}>
                            <Text style={styles.inputLabel}>Start</Text>
                            <View style={styles.inputRow}>
                                <TextInput
                                    style={styles.textInput}
                                    value={startQuery}
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
                                    disabled={isGettingLocation}
                                >
                                    {isGettingLocation ? (
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
                            style={[styles.submitButton, routeStatus === AppState.LOADING && styles.submitButtonDisabled]}
                            onPress={handleSubmit}
                            disabled={routeStatus === AppState.LOADING}
                        >
                            <Text style={styles.submitButtonText}>
                                {routeStatus === AppState.LOADING ? 'Calculating...' : 'Find Safe Route'}
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
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#ffffff',
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
        gap: 8,
    },
    headerButton: {
        padding: 8,
        borderRadius: 8,
    },
    routeButtonText: {
        marginLeft: 4,
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
    safePlaceMarker: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 2,
        borderColor: '#ffffff',
    },
    policeMarker: {
        backgroundColor: '#2563eb',
    },
    rangerMarker: {
        backgroundColor: '#16a34a',
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
        bottom: 16,
        left: 16,
        right: 16,
        backgroundColor: '#ffffff',
        borderRadius: 12,
        padding: 16,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 8,
        elevation: 5,
    },
    navigationStats: {
        flex: 1,
    },
    etaText: {
        fontSize: 32,
        fontWeight: 'bold',
        color: '#1f2937',
    },
    etaUnit: {
        fontSize: 20,
        fontWeight: '500',
    },
    distanceText: {
        fontSize: 14,
        color: '#6b7280',
        fontWeight: '600',
        marginTop: 4,
    },
    stopButton: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: '#dc2626',
        alignItems: 'center',
        justifyContent: 'center',
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
    routeSummaryPanel: {
        backgroundColor: '#ffffff',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        padding: 16,
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
    routeSummaryStats: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        backgroundColor: '#f9fafb',
        borderRadius: 8,
        padding: 16,
        marginBottom: 16,
    },
    routeStat: {
        alignItems: 'center',
    },
    routeStatValue: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#1f2937',
    },
    riskValue: {
        color: '#ef4444',
    },
    safeValue: {
        color: '#2563eb',
    },
    routeStatLabel: {
        fontSize: 10,
        color: '#6b7280',
        marginTop: 4,
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
        backgroundColor: '#ffffff',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        maxHeight: '90%',
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
});

export default React.memo(MapViewComponent);
