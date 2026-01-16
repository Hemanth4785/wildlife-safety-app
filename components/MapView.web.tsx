import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle, Polyline, useMap, CircleMarker } from 'react-leaflet';
import type { AnimalPrediction, Location, Route, NavigationStats, NavigationAlert, SafePlace, TravelMode } from '../types';
import { AppState } from '../types';
import { MAP_CENTER, MAP_ZOOM, ANIMATION_STEPS } from '../constants';
import L from 'leaflet';
import { FilterIcon, PlayIcon, PauseIcon, AlertTriangleIcon, InfoIcon, StopIcon, XIcon, PaperPlaneIcon, SpinnerIcon, ErrorIcon, LocationMarkerIcon, SyncIcon, ShieldIcon, RainIcon, CarIcon, WalkIcon, BikeIcon, BusIcon } from './icons';
import AnimalDetailModal from './AnimalDetailModal';
import * as api from '../services/apiService';


const easeInOutSine = (x: number): number => -(Math.cos(Math.PI * x) - 1) / 2;

// FIX: Added generic type parameter <T>, typed catch block error, and improved setter type to accept a function.
const useLocalStorage = <T,>(key: string, initialValue: T): [T, (value: T | ((val: T) => T)) => void] => {
    const [storedValue, setStoredValue] = useState<T>(() => {
        try {
            const item = window.localStorage.getItem(key);
            return item ? JSON.parse(item) : initialValue;
        } catch (error: any) {
            // Silently fail and return initial value
            return initialValue;
        }
    });

    const setValue = (value: T | ((val: T) => T)) => {
        try {
            const valueToStore = value instanceof Function ? value(storedValue) : value;
            setStoredValue(valueToStore);
            window.localStorage.setItem(key, JSON.stringify(valueToStore));
        } catch (error: any) {
            // Silently fail - localStorage might be full or disabled
        }
    };
    return [storedValue, setValue];
};


interface AnimalCluster {
    id: string;
    members: AnimalPrediction[];
    position: [number, number];
}

// --- Child Components for MapView ---

const WeatherRadarOverlay: React.FC = () => {
    const [tileUrl, setTileUrl] = useState<string | null>(null);
    
    useEffect(() => {
        const fetchAndSetUrl = async () => {
            const data = await api.getRainViewerTimestamps();
            if (data && data.radar && data.radar.past && data.radar.past.length > 0) {
                const latestTimestamp = data.radar.past[data.radar.past.length - 1];
                setTileUrl(`https://tilecache.rainviewer.com/v2/radar/${latestTimestamp}/{z}/{x}/{y}/512/1_1.png`);
            }
        };
        fetchAndSetUrl();
    }, []);

    if (!tileUrl) return null;

    return <TileLayer url={tileUrl} opacity={0.7} zIndex={5} />;
};

// FIX: Created explicit props interface to resolve parsing errors.
interface MapEventsProps {
    setMap: (map: L.Map) => void;
}
const MapEvents: React.FC<MapEventsProps> = ({ setMap }) => {
    const map = useMap();
    useEffect(() => {
        setMap(map);
    }, [map, setMap]);
    return null;
}

// FIX: Created explicit props interface to resolve parsing errors.
interface NavigationAlertBannerProps {
    alert: NavigationAlert;
    onClose: () => void;
}
const NavigationAlertBanner: React.FC<NavigationAlertBannerProps> = ({ alert, onClose }) => {
    return (
         <div className="leaflet-top w-full pt-4 px-4 pointer-events-none" style={{ zIndex: 1100 }}>
            <div className="w-full max-w-lg mx-auto bg-white rounded-xl shadow-2xl p-4 flex items-start gap-4 pointer-events-auto animate-slide-down border-t-4 border-yellow-500">
                <div className={`flex-shrink-0 text-3xl`}>
                    <AlertTriangleIcon className="w-8 h-8 text-yellow-500" />
                </div>
                <div className="flex-grow">
                    <p className="font-bold text-gray-800">Navigation Alert!</p>
                    <p className="text-sm text-gray-600">{alert.message}</p>
                </div>
                <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                    <XIcon className="w-5 h-5" />
                </button>
            </div>
            <style>{`
                @keyframes slide-down {
                    from { transform: translateY(-120%); opacity: 0; }
                    to { transform: translateY(0); opacity: 1; }
                }
                .animate-slide-down {
                    animation: slide-down 0.5s ease-out forwards;
                }
            `}</style>
        </div>
    );
};

// FIX: Created explicit props interface to resolve parsing errors.
interface LiveUserMarkerProps {
    location: Location;
}
const LiveUserMarker: React.FC<LiveUserMarkerProps> = React.memo(({ location }) => (
    <CircleMarker center={[location.lat, location.lon]} radius={8} pathOptions={{ color: 'white', fillColor: '#2563eb', fillOpacity: 1, weight: 2 }}>
        <Circle center={[location.lat, location.lon]} radius={20} pathOptions={{ color: '#2563eb', weight: 1, fillOpacity: 0.1 }}/>
    </CircleMarker>
));

// FIX: Created explicit props interface to resolve parsing errors.
interface MapControllerProps {
    userLocation: Location | null;
    route: Route | null;
    isNavigating: boolean;
    liveLocation: Location | null;
    isApproachingStart: boolean;
}
const MapController: React.FC<MapControllerProps> = ({ userLocation, route, isNavigating, liveLocation, isApproachingStart }) => {
    const map = useMap();

    useEffect(() => {
        if (isNavigating && liveLocation) {
            if (isApproachingStart && route && route.path.length > 0) {
                // In "approaching start" mode, fit both live location and route start in view.
                const startPoint = route.path[0];
                const bounds = L.latLngBounds([
                    [liveLocation.lat, liveLocation.lon],
                    startPoint
                ]);
                map.flyToBounds(bounds, { padding: [100, 100] });
            } else {
                // Regular "follow me" navigation view.
                const targetZoom = Math.max(map.getZoom(), 14);
                const mapSize = map.getSize();
                const offset = L.point(0, -mapSize.y * 0.2);
                const userPoint = map.project([liveLocation.lat, liveLocation.lon], targetZoom);
                const newCenterPoint = userPoint.add(offset);
                const newCenterLatLng = map.unproject(newCenterPoint, targetZoom);
                map.setView(newCenterLatLng, targetZoom, { animate: true, pan: { duration: 1 }, zoom: { animate: true } });
            }
        } else {
            // Not navigating, or no live location yet
            if (route && route.path.length > 0) {
                const bounds = L.latLngBounds(route.path);
                map.flyToBounds(bounds, { padding: [50, 50] });
            } else if (userLocation) {
                map.flyTo([userLocation.lat, userLocation.lon], 12);
            }
        }
    }, [userLocation, route, map, isNavigating, liveLocation, isApproachingStart]);
    
    return null;
};

// FIX: Created explicit props interface to resolve parsing errors.
interface UserMarkerProps {
    location: Location;
}
const UserMarker: React.FC<UserMarkerProps> = React.memo(({ location }) => {
    const icon = new L.DivIcon({
        html: `
            <div class="relative flex flex-col items-center">
                <div class="absolute -top-8 bg-white text-gray-800 text-sm font-bold px-3 py-1 rounded-lg shadow-md whitespace-nowrap">Your Location <div class="absolute bg-white h-2 w-2 transform rotate-45 -bottom-1 left-1/2 -ml-1"></div></div>
                <div class="bg-blue-600 w-4 h-4 rounded-full border-2 border-white shadow-lg"></div>
            </div>
        `,
        className: 'leaflet-div-icon',
        iconAnchor: [8, 8]
    });

    return (
        <Marker position={[location.lat, location.lon]} icon={icon}>
             <Popup><b>Your Location:</b><br/>{location.name}</Popup>
        </Marker>
    )
});

// FIX: Created explicit props interface to resolve parsing errors.
interface AnimatedAnimalMarkerProps {
    prediction: AnimalPrediction;
    progress: number;
    onViewDetails: (animal: AnimalPrediction) => void;
}
const AnimatedAnimalMarker: React.FC<AnimatedAnimalMarkerProps> = ({ prediction, progress, onViewDetails }) => {
    const icon = useMemo(() => new L.DivIcon({
        html: `<div class="relative text-3xl" style="text-shadow: 0 0 5px white;">${prediction.emoji}</div>`,
        className: 'leaflet-div-icon',
        iconSize: [32, 32],
        iconAnchor: [16, 16]
    }), [prediction.emoji]);
    
    const currentPosition = prediction.fullPath[progress];
    if (!currentPosition) return null;

    return (
        <Marker position={currentPosition} icon={icon}>
            <Popup>
                <div style={{width: 240}}>
                    <b className="text-lg">{prediction.emoji} {prediction.common}</b><br/>
                    <small><b>Current:</b> {prediction.current.addr} <br/><b>Distance:</b> {prediction.current.dist_km} km</small>
                    {prediction.image && <a href={prediction.image} target='_blank' rel="noreferrer"><img src={prediction.image} width='220' alt={prediction.common} className="mt-2 rounded-md" /></a>}
                    <button onClick={() => onViewDetails(prediction)} className="mt-2 w-full text-center p-2 bg-emerald-600 text-white text-sm font-semibold rounded-md hover:bg-emerald-700 transition-colors flex items-center justify-center gap-1">
                        <InfoIcon className="w-4 h-4" /> View Details
                    </button>
                </div>
            </Popup>
        </Marker>
    );
};

// FIX: Created explicit props interface to resolve parsing errors.
interface ClusterMarkerProps {
    cluster: AnimalCluster;
    progress: number;
    onViewDetails: (animal: AnimalPrediction) => void;
}
const ClusterMarker: React.FC<ClusterMarkerProps> = ({ cluster, progress, onViewDetails }) => {
    const icon = useMemo(() => new L.DivIcon({
        html: `
            <div class="relative flex flex-col items-center cursor-pointer p-2">
                ${cluster.members.slice(0, 4).map((animal, index) => `
                    <div class="relative text-3xl transition-transform duration-200 ease-out hover:scale-110" style="z-index: ${10 - index}; transform: translateY(${index * -18}px); text-shadow: 0 0 5px white;">
                        ${animal.emoji}
                    </div>
                `).join('')}
                ${cluster.members.length > 4 ? `
                    <div class="absolute -bottom-2 w-6 h-6 bg-gray-700 text-white text-xs font-bold rounded-full flex items-center justify-center border-2 border-white shadow-lg" style="z-index: 11;">+${cluster.members.length - 4}</div>
                ` : ''}
            </div>`,
        className: 'leaflet-div-icon',
        iconAnchor: [24, 24 + (Math.min(cluster.members.length, 4) - 1) * 18],
    }), [cluster.members]);

    const position = cluster.position;
    if (!position) return null;
    const primaryAnimal = cluster.members[0];

    return (
        <Marker position={position} icon={icon}>
            <Popup>
                <div style={{width: 240}}>
                    <b className="text-lg">Wildlife Cluster</b><br/>
                    <small>{cluster.members.length} animals detected nearby.</small>
                    <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
                        {cluster.members.map(animal => (
                            <div key={animal.id} className="text-sm flex items-center gap-2">
                                <span>{animal.emoji}</span>
                                <span className="font-semibold">{animal.common}</span>
                                <span className="text-gray-500">{animal.current.dist_km} km away</span>
                            </div>
                        ))}
                    </div>
                     <button onClick={() => onViewDetails(primaryAnimal)} className="mt-2 w-full text-center p-2 bg-emerald-600 text-white text-sm font-semibold rounded-md hover:bg-emerald-700 transition-colors flex items-center justify-center gap-1">
                        <InfoIcon className="w-4 h-4" /> View Details of First Sighting
                    </button>
                </div>
            </Popup>
        </Marker>
    );
};

// FIX: Created explicit props interface to resolve parsing errors.
interface NavigationInfoPanelProps {
    stats: NavigationStats;
    onStop: () => void;
}
const NavigationInfoPanel: React.FC<NavigationInfoPanelProps> = ({ stats, onStop }) => (
    <div className="leaflet-bottom w-full pb-4 px-4 pointer-events-none" style={{zIndex: 1000}}>
        <div className="w-full max-w-sm mx-auto bg-white rounded-xl shadow-2xl p-4 pointer-events-auto">
             <div className="flex items-center justify-between">
                <div className="text-left flex-grow">
                    <p className="text-3xl font-bold text-gray-800">{stats.etaMinutes}<span className="text-xl font-medium"> min</span></p>
                    <p className="text-gray-500 font-semibold">{stats.remainingKm} km remaining</p>
                </div>
                <button onClick={onStop} className="bg-red-600 text-white rounded-full p-4 hover:bg-red-700 transition-colors shadow-lg flex-shrink-0">
                    <StopIcon className="w-6 h-6" />
                </button>
            </div>
            {/* Progress Bar Section */}
            <div className="mt-3">
                <div className="flex justify-between items-center mb-1">
                    <span className="text-xs font-semibold text-gray-500">Progress</span>
                    <span className="text-sm font-bold text-emerald-600">{stats.progressPercent}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2.5">
                    <div 
                        className="bg-emerald-500 h-2.5 rounded-full transition-all duration-500 ease-out" 
                        style={{ width: `${stats.progressPercent}%` }}
                    ></div>
                </div>
            </div>
        </div>
    </div>
);

// FIX: Created explicit props interface to resolve parsing errors.
interface SuggestionListProps {
    suggestions: Location[];
    isLoading: boolean;
    onSelect: (location: Location) => void;
}
const SuggestionList: React.FC<SuggestionListProps> = ({ suggestions, isLoading, onSelect }) => (
    <div className="absolute w-full bg-white rounded-md shadow-lg border border-gray-200 mt-1 z-10 max-h-48 overflow-y-auto">
        {isLoading ? (
            <div className="p-3 text-center text-sm text-gray-500">Loading...</div>
        ) : (
            <ul>
                {suggestions.map((s) => (
                    <li key={`${s.lat}-${s.lon}`} onClick={() => onSelect(s)} className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 cursor-pointer truncate">
                        {s.name}
                    </li>
                ))}
            </ul>
        )}
    </div>
);

// FIX: Created explicit props interface to resolve parsing errors.
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
const RoutePlannerSheet: React.FC<RoutePlannerSheetProps> = (props) => {
    const { isOpen, onClose, onCalculateSafeRoute, routeStatus, routeMessage, suggestions, isSuggesting, onFetchSuggestions, onClearSuggestions, getCurrentLocation, nearbyRadiusKm } = props;
    const [startQuery, setStartQuery] = useState('');
    const [destQuery, setDestQuery] = useState('');
    const [selectedStart, setSelectedStart] = useState<Location | null>(null);
    const [selectedDest, setSelectedDest] = useState<Location | null>(null);
    const [activeInput, setActiveInput] = useState<'start' | 'dest' | null>(null);
    const [isGettingLocation, setIsGettingLocation] = useState(false);
    const [localError, setLocalError] = useState('');
    const [travelMode, setTravelMode] = useState<TravelMode>('car');

    const travelModes: { mode: TravelMode; icon: React.ReactNode; label: string }[] = [
        { mode: 'car', icon: <CarIcon className="w-6 h-6" />, label: 'Car' },
        { mode: 'walk', icon: <WalkIcon className="w-6 h-6" />, label: 'Walk' },
        { mode: 'bike', icon: <BikeIcon className="w-6 h-6" />, label: 'Bike' },
        { mode: 'bus', icon: <BusIcon className="w-6 h-6" />, label: 'Bus' },
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
    }

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

    return (
        <div className={`fixed inset-0 z-[2000] transition-colors ${isOpen ? 'bg-black/40' : 'bg-transparent pointer-events-none'}`} onClick={onClose}>
            <div 
                className={`fixed bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-2xl p-4 transform transition-transform duration-300 ease-in-out ${isOpen ? 'translate-y-0' : 'translate-y-full'}`} 
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold text-gray-800">Plan a Safe Route</h2>
                    <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><XIcon /></button>
                </div>
                <div className="space-y-4">
                     <div className="relative">
                        <label className="text-sm font-semibold text-gray-600">Start</label>
                        <div className="flex items-center gap-2 mt-1">
                            <input 
                                type="text" 
                                value={startQuery} 
                                onChange={(e) => {
                                    setStartQuery(e.target.value);
                                    setSelectedStart(null);
                                    onFetchSuggestions(e.target.value);
                                }}
                                onFocus={() => setActiveInput('start')}
                                placeholder="Enter start location" 
                                className="w-full px-3 py-2 text-sm text-gray-700 bg-gray-100 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
                            />
                            <button onClick={handleUseMyLocation} disabled={isGettingLocation} className="p-2 bg-gray-200 rounded-md hover:bg-gray-300 disabled:opacity-50">
                                {isGettingLocation ? <SpinnerIcon /> : <LocationMarkerIcon className="w-5 h-5 text-gray-600"/>}
                            </button>
                        </div>
                        {activeInput === 'start' && (suggestions.length > 0 || isSuggesting) && (
                            <SuggestionList suggestions={suggestions} isLoading={isSuggesting} onSelect={handleSuggestionClick} />
                        )}
                    </div>
                     <div className="relative">
                        <label className="text-sm font-semibold text-gray-600">Destination</label>
                        <input 
                            type="text" 
                            value={destQuery} 
                            onChange={(e) => {
                                setDestQuery(e.target.value);
                                setSelectedDest(null);
                                onFetchSuggestions(e.target.value);
                            }}
                            onFocus={() => setActiveInput('dest')}
                            placeholder="Enter destination" 
                            className="w-full px-3 py-2 text-sm text-gray-700 bg-gray-100 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500 mt-1"
                        />
                         {activeInput === 'dest' && (suggestions.length > 0 || isSuggesting) && (
                            <SuggestionList suggestions={suggestions} isLoading={isSuggesting} onSelect={handleSuggestionClick} />
                        )}
                    </div>
                    <div className="flex justify-around items-center bg-gray-100 rounded-lg p-1">
                        {travelModes.map(({ mode, icon, label }) => (
                            <button
                                key={mode}
                                type="button"
                                onClick={() => setTravelMode(mode)}
                                className={`flex-1 flex flex-col items-center justify-center p-2 rounded-md transition-colors text-sm ${travelMode === mode ? 'bg-white text-emerald-600 shadow' : 'text-gray-600 hover:bg-gray-200'}`}
                                aria-label={`Select travel mode: ${label}`}
                            >
                                {icon}
                                <span className="font-semibold mt-1">{label}</span>
                            </button>
                        ))}
                    </div>
                    <button onClick={handleSubmit} disabled={routeStatus === AppState.LOADING} className="w-full py-3 bg-emerald-600 text-white font-semibold rounded-lg shadow hover:bg-emerald-700 disabled:bg-gray-400 flex items-center justify-center gap-2">
                         {routeStatus === AppState.LOADING ? <><SpinnerIcon/> Calculating...</> : 'Find Safe Route'}
                    </button>
                    {(localError || (routeStatus === AppState.ERROR && routeMessage)) && (
                        <div className="mt-3 text-center text-sm text-red-600 p-3 bg-red-50 rounded-md border border-red-200 flex items-center justify-center gap-2">
                           <ErrorIcon className="w-5 h-5" /> {localError || routeMessage}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

// FIX: Created explicit props interface to resolve parsing errors.
interface FilterPanelProps {
    animalTypes: string[];
    visibleAnimals: Record<string, boolean>;
    onToggleAnimal: (commonName: string) => void;
    showPredictions: boolean;
    onTogglePredictions: () => void;
    showNearbyRadius: boolean;
    onToggleNearbyRadius: () => void;
    showWeatherOverlay: boolean;
    onToggleWeatherOverlay: () => void;
}
const FilterPanel: React.FC<FilterPanelProps> = (props) => {
    return (
        <div className="absolute top-full right-0 mt-2 w-64 bg-white rounded-lg shadow-lg border border-gray-200 p-4 z-[1000]">
            <div className="space-y-4">
                <div>
                    <div className="flex justify-between items-center">
                        <label className="font-semibold text-gray-700 text-sm">AI Predictions</label>
                        <button onClick={props.onTogglePredictions} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${props.showPredictions ? 'bg-emerald-600' : 'bg-gray-200'}`}>
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${props.showPredictions ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                    </div>
                </div>
                <div className="border-t border-gray-200 -mx-4"></div>
                <div>
                     <label className="font-semibold text-gray-700 text-sm mb-2 block">Visible Animals</label>
                     <div className="space-y-2 max-h-40 overflow-y-auto pr-2">
                        {props.animalTypes.map(animalName => (
                             <div key={animalName} className="flex items-center">
                                <input type="checkbox" id={`animal-${animalName}`} checked={props.visibleAnimals[animalName] ?? false} onChange={() => props.onToggleAnimal(animalName)} className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"/>
                                <label htmlFor={`animal-${animalName}`} className="ml-2 block text-sm text-gray-600 truncate">{animalName}</label>
                            </div>
                        ))}
                     </div>
                </div>
                <div className="border-t border-gray-200 -mx-4"></div>
                <div>
                     <div className="flex justify-between items-center">
                        <label className="font-semibold text-gray-700 text-sm">Nearby Alert Zone</label>
                        <button onClick={props.onToggleNearbyRadius} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${props.showNearbyRadius ? 'bg-emerald-600' : 'bg-gray-200'}`}>
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${props.showNearbyRadius ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                    </div>
                </div>
                <div className="border-t border-gray-200 -mx-4"></div>
                <div>
                     <div className="flex justify-between items-center">
                        <label className="font-semibold text-gray-700 text-sm flex items-center gap-2">
                            <RainIcon className="w-5 h-5 text-gray-500" />
                            <span>Weather Radar</span>
                        </label>
                        <button onClick={props.onToggleWeatherOverlay} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${props.showWeatherOverlay ? 'bg-emerald-600' : 'bg-gray-200'}`}>
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${props.showWeatherOverlay ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">Show precipitation overlay.</p>
                </div>
            </div>
        </div>
    );
}

const policeSvgPath = `<path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />`;
const rangerSvgPath = `<path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />`;

interface SafePlaceMarkerProps {
    place: SafePlace;
}
const SafePlaceMarker: React.FC<SafePlaceMarkerProps> = ({ place }) => {
    const icon = useMemo(() => {
        const isPolice = place.type === 'police';
        const bgColor = isPolice ? 'bg-blue-600' : 'bg-green-700';
        const svgPath = isPolice ? policeSvgPath : rangerSvgPath;
        const iconHtml = `
            <div class="relative flex items-center justify-center w-8 h-8 rounded-full border-2 border-white shadow-lg ${bgColor}">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-5 h-5 text-white">
                    ${svgPath}
                </svg>
            </div>
        `;
        return new L.DivIcon({
            html: iconHtml,
            className: 'leaflet-div-icon',
            iconSize: [32, 32],
            iconAnchor: [16, 16]
        });
    }, [place.type]);

    return (
        <Marker position={[place.lat, place.lon]} icon={icon} zIndexOffset={500}>
            <Popup>
                <b>{place.name}</b><br/>
                <span className="capitalize">{place.type}</span>
            </Popup>
        </Marker>
    );
};

interface RouteSummaryPanelProps {
    route: Route;
    safePlaces: SafePlace[];
    predictions: AnimalPrediction[];
    onClose: () => void;
    onStartNavigation: () => void;
}
const RouteSummaryPanel: React.FC<RouteSummaryPanelProps> = ({ route, safePlaces, predictions, onClose, onStartNavigation }) => (
    <div className="absolute bottom-0 left-0 right-0 z-[1100] p-4 bg-white rounded-t-2xl shadow-2xl animate-slide-up">
        <div className="flex justify-between items-center mb-3">
            <h2 className="text-xl font-bold text-gray-800">Your Safe Route is Ready!</h2>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><XIcon /></button>
        </div>
        <div className="flex justify-around items-center text-center mb-4 p-3 bg-gray-50 rounded-lg">
            <div>
                <p className="text-2xl font-bold text-gray-800">{route.distanceKm}</p>
                <p className="text-xs text-gray-500">KM</p>
            </div>
            <div>
                <p className="text-2xl font-bold text-gray-800">{route.durationMinutes}</p>
                <p className="text-xs text-gray-500">MINS</p>
            </div>
            <div>
                <p className="text-2xl font-bold text-red-500">{predictions.length}</p>
                <p className="text-xs text-gray-500">RISKS AVOIDED</p>
            </div>
             <div>
                <p className="text-2xl font-bold text-blue-600">{safePlaces.length}</p>
                <p className="text-xs text-gray-500">SAFE SPOTS</p>
            </div>
        </div>
        <p className="text-sm text-gray-600 mb-4 px-2">This route has been optimized to avoid {predictions.length} predicted wildlife paths and passes near {safePlaces.length} designated safe places.</p>
        <button onClick={onStartNavigation} className="w-full py-3 bg-emerald-600 text-white font-semibold rounded-lg shadow hover:bg-emerald-700 flex items-center justify-center gap-2">
            Start Navigation
        </button>
        <style>{`
            @keyframes slide-up {
                from { transform: translateY(100%); }
                to { transform: translateY(0); }
            }
            .animate-slide-up { animation: slide-up 0.3s ease-out forwards; }
        `}</style>
    </div>
);

// --- Main Map View ---
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

const MapView: React.FC<MapViewProps> = (props) => {
    const { 
        userLocation, predictions, animationProgress, nearbyRadiusKm, 
        safeRoute, safePlaces, isNavigating, liveLocation, navigationStats, 
        onStopNavigation, navigationAlert, clearNavigationAlert, closestPathIndex,
        isPlaying, onPlay, onPause, isApproachingStart
    } = props;
    
    const [isPlanningRoute, setIsPlanningRoute] = useState(false);
    const [detailModalAnimal, setDetailModalAnimal] = useState<AnimalPrediction | null>(null);
    const [map, setMap] = useState<L.Map | null>(null);
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
        if (safeRoute && props.routeStatus === AppState.SUCCESS && !isNavigating) {
            setShowRouteSummary(true);
        }
    }, [safeRoute, props.routeStatus, isNavigating]);

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
        if (!map || filteredPredictions.length === 0) {
            setAnimalClusters([]);
            return;
        }
        const pathIndex = pathIndexRef.current;
        const clusters: AnimalCluster[] = [];
        const processedIds = new Set<string>();
        const pixelThreshold = 35;

        filteredPredictions.forEach(p1 => {
            if (processedIds.has(p1.id)) return;
            const p1Position = p1.fullPath[pathIndex];
            if (!p1Position) return;

            const p1Point = map.latLngToLayerPoint(L.latLng(p1Position));
            const newCluster: AnimalCluster = { id: p1.id, members: [p1], position: p1Position };
            processedIds.add(p1.id);

            filteredPredictions.forEach(p2 => {
                if (processedIds.has(p2.id)) return;
                const p2Position = p2.fullPath[pathIndex];
                if (!p2Position) return;
                const p2Point = map.latLngToLayerPoint(L.latLng(p2Position));
                if (p1Point.distanceTo(p2Point) < pixelThreshold) {
                    newCluster.members.push(p2);
                    processedIds.add(p2.id);
                }
            });
            clusters.push(newCluster);
        });

        setAnimalClusters(clusters);
    }, [filteredPredictions, map, animationProgress]);

    const handleViewDetails = useCallback((animal: AnimalPrediction) => {
        setDetailModalAnimal(animal);
    }, []);

    const initialCenter: [number, number] = userLocation ? [userLocation.lat, userLocation.lon] : MAP_CENTER;
    const initialZoom = userLocation ? 12 : MAP_ZOOM;
    
    const { completedPath, remainingPath } = useMemo(() => {
        if (isNavigating && safeRoute && liveLocation) {
            const completed = safeRoute.path.slice(0, closestPathIndex + 1);
            const remaining = safeRoute.path.slice(closestPathIndex);
            remaining.unshift([liveLocation.lat, liveLocation.lon]);
            return { completedPath: completed, remainingPath: remaining };
        }
        return { completedPath: [], remainingPath: safeRoute?.path || [] };
    }, [isNavigating, safeRoute, liveLocation, closestPathIndex]);


    return (
        <div className="h-full w-full flex flex-col bg-white">
            <header className="px-4 py-3 flex justify-between items-center border-b border-gray-200 bg-white z-10">
                <h1 className="text-xl font-bold text-gray-800">Wildlife Safety Map</h1>
                <div className="flex items-center gap-2">
                    <button className="p-2 rounded-lg hover:bg-gray-100 transition-colors"><SyncIcon className="w-5 h-5 text-gray-600"/></button>
                     <div className="relative">
                        <button onClick={() => setIsFilterPanelOpen(p => !p)} className="p-2 rounded-lg hover:bg-gray-100 transition-colors">
                            <FilterIcon className="w-5 h-5 text-gray-600"/>
                        </button>
                        {isFilterPanelOpen && (
                            <FilterPanel 
                                animalTypes={animalTypes}
                                visibleAnimals={visibleAnimals}
                                onToggleAnimal={handleToggleAnimal}
                                showPredictions={showPredictions}
                                onTogglePredictions={() => setShowPredictions(p => !p)}
                                showNearbyRadius={showNearbyRadius}
                                onToggleNearbyRadius={() => setShowNearbyRadius(p => !p)}
                                showWeatherOverlay={showWeatherOverlay}
                                onToggleWeatherOverlay={() => setShowWeatherOverlay(p => !p)}
                            />
                        )}
                    </div>
                    <button onClick={() => setIsPlanningRoute(true)} className="flex items-center gap-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold px-3 py-1.5 rounded-lg text-sm transition-colors">
                        <PaperPlaneIcon className="w-4 h-4" /> Route
                    </button>
                </div>
            </header>
            
            <div className="flex-grow relative">
                {isNavigating && navigationAlert && (
                    <NavigationAlertBanner alert={navigationAlert} onClose={clearNavigationAlert} />
                )}
                <MapContainer center={initialCenter} zoom={initialZoom} scrollWheelZoom={true} style={{ height: '100%', width: '100%', zIndex: 0 }}>
                    <MapEvents setMap={setMap} />
                    <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/>
                    <MapController userLocation={userLocation} route={safeRoute} isNavigating={isNavigating} liveLocation={liveLocation} isApproachingStart={isApproachingStart} />
                    
                    {userLocation && !isNavigating && <UserMarker location={userLocation} />}
                    {isNavigating && liveLocation && <LiveUserMarker location={liveLocation} />}
                    {isNavigating && liveLocation && showNearbyRadius && (
                        <Circle center={[liveLocation.lat, liveLocation.lon]} radius={nearbyRadiusKm * 1000} pathOptions={{ color: '#f97316', weight: 1, fillOpacity: 0.1, dashArray: '5, 5' }} />
                    )}

                    {safeRoute && (
                        <>
                             {isNavigating ? (
                                <>
                                    <Polyline positions={completedPath} color="#6b7280" weight={5} opacity={0.6} dashArray="5, 10" />
                                    <Polyline positions={remainingPath} color="#10b981" weight={7} opacity={0.9} />
                                </>
                            ) : (
                                <Polyline positions={safeRoute.path} color="#10b981" weight={6} opacity={0.8} />
                            )}
                            <Marker position={L.latLng(safeRoute.end.lat, safeRoute.end.lon)}><Popup><b>Destination:</b> {safeRoute.end.name}</Popup></Marker>
                        </>
                    )}
                    
                    {animalClusters.map(cluster => {
                        const pathIndex = pathIndexRef.current;
                        if (cluster.members.length > 1) {
                           return <ClusterMarker key={cluster.id} cluster={cluster} progress={pathIndex} onViewDetails={handleViewDetails} />;
                        } else if (cluster.members.length === 1) {
                            const p = cluster.members[0];
                            return (
                                <React.Fragment key={p.id}>
                                    <Polyline positions={p.fullPath.slice(0, pathIndex + 1)} color={p.color} weight={4} opacity={0.7} />
                                    <AnimatedAnimalMarker prediction={p} progress={pathIndex} onViewDetails={handleViewDetails} />
                                </React.Fragment>
                            );
                        }
                        return null;
                    })}
                    {safePlaces.map(place => <SafePlaceMarker key={place.id} place={place} />)}
                    {isNavigating && navigationStats && <NavigationInfoPanel stats={navigationStats} onStop={onStopNavigation} />}
                    {showWeatherOverlay && <WeatherRadarOverlay />}
                </MapContainer>
                <div className="absolute bottom-4 right-4 z-[1000]">
                    <button
                        onClick={isPlaying ? onPause : onPlay}
                        className="w-12 h-12 bg-white rounded-full shadow-lg flex items-center justify-center text-gray-600 hover:text-gray-700 hover:bg-gray-50 transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500"
                        aria-label={isPlaying ? 'Pause Animations' : 'Play Animations'}
                    >
                        {isPlaying ? <PauseIcon className="w-6 h-6" /> : <PlayIcon className="w-6 h-6" />}
                    </button>
                </div>
                 {showRouteSummary && safeRoute && (
                    <RouteSummaryPanel 
                        route={safeRoute}
                        safePlaces={safePlaces}
                        predictions={predictions}
                        onClose={() => setShowRouteSummary(false)}
                        onStartNavigation={() => {
                            setShowRouteSummary(false);
                            props.onStartNavigation();
                        }}
                    />
                )}
            </div>
            
            <div className="p-4 bg-white border-t border-gray-200 z-10 shadow-[0_-2px_5px_rgba(0,0,0,0.05)]">
                <div className="flex justify-around items-center text-center mb-3 text-sm text-gray-600">
                    <div className="flex items-center gap-2">
                        <AlertTriangleIcon className="w-5 h-5 text-red-500" />
                        <div>
                            <span className="font-bold">{filteredPredictions.length}</span> Risk Zones
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <ShieldIcon className="w-5 h-5 text-emerald-600" />
                        <div>
                           <span className="font-bold">{safeRoute ? 1 : 0}</span> Safe Routes
                        </div>
                    </div>
                    <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">
                        © OpenStreetMap
                    </a>
                </div>
                <button 
                    onClick={() => setIsPlanningRoute(true)} 
                    className="w-full py-3 bg-emerald-50 text-emerald-700 font-bold rounded-lg shadow-md hover:bg-emerald-100 border-2 border-emerald-600 flex items-center justify-center gap-2 transition-colors text-base"
                >
                    <PaperPlaneIcon className="w-5 h-5" /> Plan Safe Route
                </button>
            </div>

            <RoutePlannerSheet 
                isOpen={isPlanningRoute}
                onClose={() => setIsPlanningRoute(false)}
                onCalculateSafeRoute={props.onCalculateSafeRoute}
                routeStatus={props.routeStatus}
                routeMessage={props.routeMessage}
                suggestions={props.suggestions}
                isSuggesting={props.isSuggesting}
                onFetchSuggestions={props.onFetchSuggestions}
                onClearSuggestions={props.onClearSuggestions}
                getCurrentLocation={props.getCurrentLocation}
                nearbyRadiusKm={props.nearbyRadiusKm}
            />
            {detailModalAnimal && <AnimalDetailModal animal={detailModalAnimal} onClose={() => setDetailModalAnimal(null)} />}
        </div>
    );
};

export default React.memo(MapView);