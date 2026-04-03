import React, { useMemo, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Modal, Image } from 'react-native';
import type { AnimalPrediction, User, WeatherData, Route } from '../types';
import { AppState, View as ViewType } from '../types';
import {
  SpinnerIcon,
  ErrorIcon,
  AlertTriangleIcon,
  PaperPlaneIcon,
  ChartIcon,
  SunIcon,
  CloudIcon,
  RainIcon,
  WindIcon,
  MoonIcon,
  PartlyCloudyIcon,
  SnowIcon
} from './icons';
import { NEARBY_KM } from '../constants';
import AnimalDetailModal from './AnimalDetailModal';
import { useAppContext } from '../contexts/AppContext';
import { stableJsonKey, stableRoutePathKey } from '../utils/stableKeys';

// --- Helper Functions ---
const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
};

const getWeatherInfo = (code: number, isDay: number): { text: string; icon: React.ReactNode } => {
    const getIcon = () => {
        switch (code) {
            case 0: return isDay ? <SunIcon width={32} height={32} color="#ffffff" /> : <MoonIcon width={32} height={32} color="#ffffff" />;
            case 1: return isDay ? <PartlyCloudyIcon width={32} height={32} color="#ffffff" /> : <MoonIcon width={32} height={32} color="#ffffff" />;
            case 2: case 3: return <CloudIcon width={32} height={32} color="#ffffff" />;
            case 45: case 48: return <CloudIcon width={32} height={32} color="#ffffff" />;
            case 51: case 53: case 55: case 61: case 63: case 65: case 80: case 81: case 82: return <RainIcon width={32} height={32} color="#ffffff" />;
            case 71: case 73: case 75: case 77: case 85: case 86: return <SnowIcon width={32} height={32} color="#ffffff" />;
            default: return isDay ? <SunIcon width={32} height={32} color="#ffffff" /> : <MoonIcon width={32} height={32} color="#ffffff" />;
        }
    };
    const text = (() => {
        switch (code) {
            case 0: return 'Clear sky';
            case 1: return 'Mainly clear';
            case 2: return 'Partly cloudy';
            case 3: return 'Overcast';
            case 45: case 48: return 'Fog';
            case 61: case 63: case 65: return 'Rain';
            case 80: case 81: case 82: return 'Rain showers';
            case 71: case 73: case 75: return 'Snowfall';
            default: return 'Clear';
        }
    })();
    return { text, icon: getIcon() };
};

// --- Child Components ---
const StatCard: React.FC<{ icon: React.ReactNode; value: number | string; label: string; }> = ({ icon, value, label }: { icon: React.ReactNode; value: number | string; label: string }) => (
    <View style={styles.statCard}>
        <View style={styles.iconContainer}>{icon}</View>
        <Text style={styles.statValue}>{value}</Text>
        <Text style={styles.statLabel}>{label}</Text>
    </View>
);

const RiskLevelCard: React.FC<{ riskScore: number; riskLevel: string; speciesTracked: number; weather: WeatherData | null; }> = ({ riskScore, riskLevel, speciesTracked, weather }: { riskScore: number; riskLevel: string; speciesTracked: number; weather: WeatherData | null }) => {
    const getGradientColors = () => {
        switch (riskLevel) {
            case 'Low': return ['#10b981', '#059669'];
            case 'Medium': return ['#eab308', '#f59e0b'];
            case 'High': return ['#ef4444', '#dc2626'];
            default: return ['#10b981', '#059669'];
        }
    };
    const weatherInfo = weather ? getWeatherInfo(weather.weatherCode, weather.isDay) : null;

    const backgroundColor = riskLevel === 'Low' ? '#10b981' : riskLevel === 'Medium' ? '#eab308' : '#ef4444';

    return (
        <View style={[styles.riskCard, { backgroundColor }]}>
            <View style={styles.riskContent}>
                <View style={styles.riskLeft}>
                    <View style={styles.riskHeader}>
                        <Text style={{ fontSize: 24 }}>🛡️</Text>
                        <Text style={styles.riskTitle}>Current Risk Level</Text>
                    </View>
                    <Text style={styles.riskLevel}>{riskLevel}</Text>
                    <Text style={styles.riskSubtext}>Risk Score: {riskScore}/100 • {speciesTracked} species</Text>
                </View>
                {weatherInfo && weather && (
                    <View style={styles.weatherInfo}>
                        <View style={styles.weatherRow}>
                            {weatherInfo.icon}
                            <Text style={styles.temperature}>{Math.round(weather.temperature)}°C</Text>
                        </View>
                        <Text style={styles.weatherText}>{weatherInfo.text}</Text>
                        <View style={styles.windRow}>
                            <WindIcon width={12} height={12} color="#ffffff" />
                            <Text style={styles.windText}>{weather.windSpeed} km/h</Text>
                        </View>
                    </View>
                )}
            </View>
        </View>
    );
};

const toKm = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
    const R = 6371;
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLon = ((b.lon - a.lon) * Math.PI) / 180;
    const lat1 = (a.lat * Math.PI) / 180;
    const lat2 = (b.lat * Math.PI) / 180;
    const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
    return 2 * R * Math.asin(Math.sqrt(x));
};

const AlertItem: React.FC<{ alert: AnimalPrediction; recentSightings?: Array<{ id: string; name: string; scientificName: string; emoji?: string; lat: number; lon: number; date: string; address?: string; image_url?: string }> }> = ({ alert, recentSightings = [] }: { alert: AnimalPrediction; recentSightings?: Array<{ id: string; name: string; scientificName: string; emoji?: string; lat: number; lon: number; date: string; address?: string; image_url?: string }> }) => {
    if (!alert) return null;
    const sameSpecies = (Array.isArray(recentSightings) ? recentSightings : []).filter(s =>
        String(s?.name || '').toLowerCase() === String(alert?.common || '').toLowerCase() ||
        String(s?.scientificName || '').toLowerCase() === String(alert?.scientific || '').toLowerCase()
    );
    let thumb: string | undefined = undefined;
    if (sameSpecies.length > 0) {
        let nearest = sameSpecies[0];
        const base = { lat: Number(alert?.current?.lat), lon: Number(alert?.current?.lon) };
        if (!Number.isFinite(base.lat) || !Number.isFinite(base.lon)) {
            thumb = nearest?.image_url;
        } else {
            let best = toKm(base, { lat: nearest.lat, lon: nearest.lon });
            for (const s of sameSpecies.slice(1)) {
                const d = toKm(base, { lat: s.lat, lon: s.lon });
                if (d < best) { best = d; nearest = s; }
            }
            thumb = nearest.image_url;
        }
    }
    return (
        <View style={styles.alertItem}>
            {thumb ? <Image source={{ uri: thumb }} style={{ width: 44, height: 44, borderRadius: 8, marginRight: 10 }} /> : <Text style={styles.alertEmoji}>{alert?.emoji}</Text>}
            <View style={styles.alertContent}>
                <Text style={styles.alertName}>{alert?.common}</Text>
                <Text style={styles.alertDistance}>
                    {Number.isFinite(Number(alert?.current?.dist_km)) ? Number(alert?.current?.dist_km) : 0} km away near {String(alert?.current?.addr || '').split(',').slice(0, 2).join(',') || 'Unknown location'}
                </Text>
            </View>
        </View>
    );
};

// --- Main Dashboard Component ---
interface DashboardProps {
    onNavigate: (view: ViewType) => void;
    onStartNavigation?: () => void;
}

const Dashboard: React.FC<DashboardProps> = ({ onNavigate, onStartNavigation }: DashboardProps) => {
    const { 
        user, 
        status, 
        message, 
        predictions = [], 
        safeRoute, 
        weather, 
        recentSightings = [], 
        visibleAnimals = {} 
    } = useAppContext();

    if (!user) return null;

    const nearbyRadiusKm = user.nearbyRadiusKm ?? NEARBY_KM;

    const predictionsKey = stableJsonKey(
        (Array.isArray(predictions) ? predictions : []).map((p: AnimalPrediction) => p?.id ?? p?.scientific)
    );
    const visibleAnimalsKey = stableJsonKey(visibleAnimals);
    const recentSightingsKey = stableJsonKey(recentSightings);
    const routePathKey = stableRoutePathKey(safeRoute?.path as [number, number][] | undefined);

    const filteredPredictions = useMemo(() => {
        if (!Array.isArray(predictions)) return [];
        return predictions.filter(p => p && (visibleAnimals as any)[p.scientific] !== false);
    }, [predictionsKey, visibleAnimalsKey]);

    const dashboardStats = useMemo(() => {
        const nearbyAlerts = filteredPredictions.filter((p: AnimalPrediction) => p?.current?.dist_km <= nearbyRadiusKm);
        const speciesTracked = new Set(filteredPredictions.map((p: AnimalPrediction) => p?.common)).size;
        const totalSightings = filteredPredictions.length; 
        
        let riskScore = nearbyAlerts.length * 15 + totalSightings * 2;
        riskScore = Math.min(riskScore, 100);

        const riskLevel = riskScore > 65 ? 'High' : riskScore > 35 ? 'Medium' : 'Low';

        return {
            riskScore,
            riskLevel,
            speciesTracked,
            nearbyAlerts: nearbyAlerts.length,
            safeRoutes: routePathKey ? 1 : 0,
            totalSightings,
            alerts: nearbyAlerts,
        };
    }, [filteredPredictions, nearbyRadiusKm, routePathKey]);

    const filteredSightings = useMemo(() => {
        if (!Array.isArray(recentSightings)) return [];
        // Only show sightings that the user has viewed/loaded on the Map (provided via props)
        return recentSightings.filter(s => s && (visibleAnimals as any)[s.scientificName] !== false);
    }, [recentSightingsKey, visibleAnimalsKey]);

    const displaySightings = useMemo(() => {
        // Map predictions into sighting format if needed, but ensure they are within the filtered set
        const predAsSightings = filteredPredictions.map((p) => ({
            id: `pred-${p?.id}`,
            name: p?.common,
            scientificName: p?.scientific,
            emoji: p?.emoji,
            image_url: p?.image,
            lat: p?.current?.lat,
            lon: p?.current?.lon,
            date: new Date().toISOString(),
            address: p?.current?.addr,
            risk: p?.metadata?.confidence === 'high' ? 'High' : 'Medium'
        }));
        
        // Merge recent sightings (which are region-specific from Map) with current predictions
        const merged = [...filteredSightings, ...predAsSightings];
        const seen = new Set<string>();
        const unique = [];
        
        for (const s of merged) {
            if (!s) continue;
            // Deduplicate by name and address to show only unique visible data
            const key = `${(s.name || '').toLowerCase()}|${(s.address || '').toLowerCase()}`;
            if (seen.has(key)) continue;
            seen.add(key);
            unique.push(s);
        }
        
        // Sort by date descending so the most recent viewed data is first
        return unique.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }, [predictionsKey, visibleAnimalsKey, recentSightingsKey]);

    useEffect(() => {
        console.log("Rendering with data:", {
            displaySightings: Array.isArray(displaySightings) ? displaySightings.length : 0,
            filteredPredictions: Array.isArray(filteredPredictions) ? filteredPredictions.length : 0,
        });
    }, [displaySightings.length, filteredPredictions.length]);

    const highRiskAlerts = useMemo(() => {
        // Alerts must derive strictly from the currently viewed high-risk data
        return filteredPredictions.filter(p => 
            p && (p.metadata?.confidence === 'high' || 
            p.current?.dist_km <= (user.nearbyRadiusKm ?? NEARBY_KM) ||
            ['tiger', 'elephant', 'leopard', 'bear'].some(danger => (p.scientific || '').toLowerCase().includes(danger)))
        ).slice(0, 5);
    }, [filteredPredictions, nearbyRadiusKm]);

    const greeting = getGreeting();

    const [selectedAlert, setSelectedAlert] = React.useState<AnimalPrediction | null>(null);
    const [selectedSighting, setSelectedSighting] = React.useState<{ id: string; name: string; scientificName: string; emoji?: string; image_url?: string; date: string; address?: string } | null>(null);

    return (
        <ScrollView style={styles.container} contentContainerStyle={styles.content}>
            <View style={styles.header}>
                <Text style={styles.greeting}>{greeting}, {user.name.split(' ')[0]}</Text>
                <Text style={styles.title}>
                    {status === AppState.LOADING ? 'Loading Wildlife Data...' : 'Stay Safe Out There'}
                </Text>
            </View>
            
            {(status === AppState.IDLE || status === AppState.LOADING) && !filteredPredictions.length ? (
                <View style={styles.emptyState}>
                    {status === AppState.LOADING ? (
                        <SpinnerIcon width={32} height={32} color="#059669" />
                    ) : (
                        <Text style={{ fontSize: 48 }}>🛡️</Text>
                    )}
                    <Text style={styles.emptyTitle}>
                        {status === AppState.LOADING ? message : 'Welcome to Wildlife Safety!'}
                    </Text>
                    <Text style={styles.emptySubtitle}>
                        {status === AppState.LOADING ? 'Fetching the latest wildlife and weather data for you.' : 'Plan a route to see risks in your area.'}
                    </Text>
                    {status === AppState.IDLE && (
                        <TouchableOpacity 
                            style={styles.primaryButton} 
                            onPress={() => onNavigate(ViewType.MAP)}
                        >
                            <PaperPlaneIcon width={20} height={20} color="#ffffff" />
                            <Text style={styles.primaryButtonText}>Plan Safe Route</Text>
                        </TouchableOpacity>
                    )}
                </View>
            ) : status === AppState.ERROR ? (
                <View style={styles.errorContainer}>
                    <ErrorIcon width={24} height={24} color="#dc2626" />
                    <Text style={styles.errorText}>{message}</Text>
                </View>
            ) : (
                <>
                    <RiskLevelCard 
                        riskScore={dashboardStats.riskScore}
                        riskLevel={dashboardStats.riskLevel}
                        speciesTracked={dashboardStats.speciesTracked}
                        weather={weather}
                    />
                    
                    <View style={styles.statsGrid}>
                        <StatCard icon={<AlertTriangleIcon width={24} height={24} color="#059669" />} value={dashboardStats.nearbyAlerts} label="Nearby Alerts" />
                        <StatCard icon={<PaperPlaneIcon width={24} height={24} color="#059669" />} value={dashboardStats.safeRoutes} label="Safe Routes" />
                        <StatCard icon={<ChartIcon width={24} height={24} color="#059669" />} value={dashboardStats.totalSightings} label="Total Sights" />
                    </View>

                    <View style={styles.alertsSection}>
                        <Text style={styles.sectionTitle}>Sightings by Species</Text>
                        <View style={styles.alertsList}>
                            {displaySightings.length > 0 ? (
                                Object.entries((Array.isArray(displaySightings) ? displaySightings : []).reduce((acc: Record<string, number>, s) => {
                                    if (!s?.name) return acc;
                                    acc[s.name] = (acc[s.name] || 0) + 1;
                                    return acc;
                                }, {} as Record<string, number>)).map(([name, count]) => {
                                    const sighting = displaySightings.find(s => s.name === name);
                                    return (
                                        <View key={name} style={styles.alertItem}>
                                            <Text style={styles.alertEmoji}>{sighting?.emoji || '🐾'}</Text>
                                            <View style={styles.alertContent}>
                                                <Text style={styles.alertName}>{name}</Text>
                                                <Text style={styles.alertDistance}>{count} active marker{count === 1 ? '' : 's'} on map</Text>
                                            </View>
                                        </View>
                                    );
                                })
                            ) : (
                                <View style={styles.noAlerts}>
                                    <Text style={styles.noAlertsText}>No species sightings in view.</Text>
                                    <Text style={styles.noAlertsSubtext}>Move the map or adjust filters to see wildlife data.</Text>
                                </View>
                            )}
                        </View>
                    </View>

                    <View style={styles.buttonContainer}>
                        <TouchableOpacity 
                            style={styles.primaryButton} 
                            onPress={() => onNavigate(ViewType.MAP)}
                        >
                            <PaperPlaneIcon width={20} height={20} color="#ffffff" />
                            <Text style={styles.primaryButtonText}>Plan Safe Route</Text>
                        </TouchableOpacity>
                        <TouchableOpacity 
                            style={styles.secondaryButton} 
                            onPress={() => onNavigate(ViewType.GUIDE)}
                        >
                            <Text style={styles.secondaryButtonText}>Ask AI Guide</Text>
                        </TouchableOpacity>
                    </View>

                    <View style={styles.alertsSection}>
                        <Text style={styles.sectionTitle}>Recent Wildlife Sightings</Text>
                        <View style={styles.alertsList}>
                            {displaySightings.length > 0 ? (
                                displaySightings.slice(0, 5).map((s) => (
                                    <TouchableOpacity key={s.id} style={styles.alertItem} onPress={() => setSelectedSighting(s)}>
                                        {s.image_url ? <Image source={{ uri: s.image_url }} style={{ width: 44, height: 44, borderRadius: 8, marginRight: 10 }} /> : <Text style={styles.alertEmoji}>{s.emoji || '🐾'}</Text>}
                                        <View style={styles.alertContent}>
                                            <Text style={styles.alertName}>{s.name}</Text>
                                            <Text style={styles.alertDistance}>{s.address?.split(',').slice(0,2).join(', ') || new Date(s.date).toLocaleString()}</Text>
                                        </View>
                                    </TouchableOpacity>
                                ))
                            ) : (
                                <View style={styles.noAlerts}>
                                    <Text style={styles.noAlertsText}>No sightings in current view.</Text>
                                    <Text style={styles.noAlertsSubtext}>Wildlife data updates as you explore the map.</Text>
                                </View>
                            )}
                        </View>
                    </View>

                    <View style={styles.alertsSection}>
                        <Text style={styles.sectionTitle}>Recent Wildlife Alerts</Text>
                        <View style={styles.alertsList}>
                            {highRiskAlerts.length > 0 ? (
                                highRiskAlerts.map((alert: AnimalPrediction) => (
                                    <TouchableOpacity key={alert.id} onPress={() => setSelectedAlert(alert)}>
                                        <AlertItem alert={alert} recentSightings={recentSightings} />
                                    </TouchableOpacity>
                                ))
                            ) : (
                                <View style={styles.noAlerts}>
                                    <Text style={styles.noAlertsText}>No high-risk alerts in current view.</Text>
                                    <Text style={styles.noAlertsSubtext}>Everything looks safe in your explored area.</Text>
                                </View>
                            )}
                        </View>
                    </View>
                </>
            )}
            {selectedAlert && <AnimalDetailModal animal={selectedAlert} onClose={() => setSelectedAlert(null)} />}
            {selectedSighting && (
                <Modal visible={true} transparent={true} animationType="fade" onRequestClose={() => setSelectedSighting(null)}>
                    <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setSelectedSighting(null)}>
                        <View style={styles.modalCard} onStartShouldSetResponder={() => true}>
                            <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' }}>
                                <Text style={{ fontSize: 18, fontWeight: 'bold', color: '#111827' }}>{selectedSighting.name}</Text>
                                <Text style={{ fontSize: 14, color: '#6b7280' }}>{selectedSighting.address || new Date(selectedSighting.date).toLocaleString()}</Text>
                            </View>
                            <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
                                {selectedSighting.image_url && (
                                    <Image source={{ uri: selectedSighting.image_url }} style={{ width: '100%', height: 200, borderRadius: 8 }} resizeMode="cover" />
                                )}
                                <Text style={{ fontSize: 14, color: '#111827' }}>Species: {selectedSighting.scientificName}</Text>
                                <Text style={{ fontSize: 14, color: '#6b7280' }}>Date: {new Date(selectedSighting.date).toLocaleString()}</Text>
                            </ScrollView>
                            <View style={{ padding: 16 }}>
                                <TouchableOpacity style={styles.primaryButton} onPress={() => { setSelectedSighting(null); onNavigate(ViewType.MAP); }}>
                                    <Text style={styles.primaryButtonText}>Open in Map</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    </TouchableOpacity>
                </Modal>
            )}
        </ScrollView>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f9fafb',
    },
    content: {
        padding: 16,
        paddingBottom: 100,
    },
    header: {
        marginBottom: 20,
    },
    greeting: {
        fontSize: 14,
        color: '#6b7280',
        marginBottom: 4,
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#111827',
    },
    emptyState: {
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#ffffff',
        padding: 32,
        borderRadius: 8,
        marginTop: 20,
    },
    emptyTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#374151',
        marginTop: 12,
        textAlign: 'center',
    },
    emptySubtitle: {
        fontSize: 14,
        color: '#6b7280',
        marginTop: 8,
        textAlign: 'center',
    },
    errorContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#fee2e2',
        padding: 16,
        borderRadius: 8,
        marginTop: 20,
    },
    errorText: {
        fontSize: 14,
        color: '#dc2626',
        marginLeft: 12,
    },
    riskCard: {
        borderRadius: 12,
        marginBottom: 20,
        padding: 20,
    },
    riskContent: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    riskLeft: {
        flex: 1,
    },
    riskHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 4,
    },
    riskTitle: {
        fontSize: 14,
        fontWeight: '600',
        color: '#ffffff',
        marginLeft: 12,
    },
    riskLevel: {
        fontSize: 48,
        fontWeight: 'bold',
        color: '#ffffff',
        marginLeft: 36,
        marginTop: 4,
    },
    riskSubtext: {
        fontSize: 12,
        color: '#ffffff',
        opacity: 0.9,
        marginLeft: 36,
        marginTop: 4,
    },
    weatherInfo: {
        alignItems: 'flex-end',
    },
    weatherRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 4,
    },
    temperature: {
        fontSize: 28,
        fontWeight: 'bold',
        color: '#ffffff',
        marginLeft: 8,
    },
    weatherText: {
        fontSize: 12,
        color: '#ffffff',
        opacity: 0.9,
    },
    windRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 4,
    },
    windText: {
        fontSize: 12,
        color: '#ffffff',
        opacity: 0.9,
        marginLeft: 4,
    },
    statsGrid: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 20,
        gap: 12,
    },
    statCard: {
        flex: 1,
        backgroundColor: '#ffffff',
        padding: 16,
        borderRadius: 8,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#e5e7eb',
    },
    iconContainer: {
        marginBottom: 8,
    },
    statValue: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#111827',
        marginBottom: 4,
    },
    statLabel: {
        fontSize: 12,
        color: '#6b7280',
        fontWeight: '500',
    },
    buttonContainer: {
        marginBottom: 20,
        gap: 12,
    },
    primaryButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#059669',
        paddingVertical: 12,
        borderRadius: 8,
        gap: 8,
    },
    primaryButtonText: {
        color: '#ffffff',
        fontSize: 16,
        fontWeight: '600',
    },
    secondaryButton: {
        backgroundColor: '#ffffff',
        paddingVertical: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#e5e7eb',
        alignItems: 'center',
    },
    secondaryButtonText: {
        color: '#059669',
        fontSize: 16,
        fontWeight: '600',
    },
    alertsSection: {
        marginTop: 8,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#111827',
        marginBottom: 12,
    },
    alertsList: {
        gap: 12,
    },
    alertItem: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#ffffff',
        padding: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#e5e7eb',
    },
    alertEmoji: {
        fontSize: 24,
        marginRight: 12,
    },
    alertContent: {
        flex: 1,
    },
    alertName: {
        fontSize: 14,
        fontWeight: '600',
        color: '#111827',
        marginBottom: 4,
    },
    alertDistance: {
        fontSize: 14,
        color: '#6b7280',
    },
    noAlerts: {
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#ffffff',
        padding: 24,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#e5e7eb',
    },
    noAlertsText: {
        fontSize: 14,
        fontWeight: '500',
        color: '#6b7280',
        marginBottom: 4,
    },
    noAlertsSubtext: {
        fontSize: 12,
        color: '#9ca3af',
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 16,
    },
    modalCard: {
        backgroundColor: '#ffffff',
        borderRadius: 12,
        width: '100%',
        maxWidth: 520,
        maxHeight: '80%',
    },
});

export default React.memo(Dashboard);
