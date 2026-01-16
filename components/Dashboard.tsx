import React, { useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import type { AnimalPrediction, User, WeatherData, Route } from '../types';
import { AppState, View as ViewType } from '../types';
import {
  SpinnerIcon,
  ErrorIcon,
  ShieldIcon,
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
                        <ShieldIcon width={24} height={24} color="#ffffff" />
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

const AlertItem: React.FC<{ alert: AnimalPrediction }> = ({ alert }: { alert: AnimalPrediction }) => (
    <View style={styles.alertItem}>
        <Text style={styles.alertEmoji}>{alert.emoji}</Text>
        <View style={styles.alertContent}>
            <Text style={styles.alertName}>{alert.common}</Text>
            <Text style={styles.alertDistance}>{alert.current.dist_km} km away near {alert.current.addr?.split(',').slice(0, 2).join(',') || 'Unknown location'}</Text>
        </View>
    </View>
);

// --- Main Dashboard Component ---
interface DashboardProps {
    user: User;
    status: AppState;
    message: string;
    predictions: AnimalPrediction[];
    nearbyRadiusKm: number;
    safeRoute: Route | null;
    weather: WeatherData | null;
    onNavigate: (view: ViewType) => void;
}

const Dashboard: React.FC<DashboardProps> = (props: DashboardProps) => {
    const { user, status, message, predictions, nearbyRadiusKm, safeRoute, weather, onNavigate } = props;

    const dashboardStats = useMemo(() => {
        const nearbyAlerts = predictions.filter((p: AnimalPrediction) => p.current.dist_km <= (user.nearbyRadiusKm ?? NEARBY_KM));
        const speciesTracked = new Set(predictions.map((p: AnimalPrediction) => p.common)).size;
        const totalSightings = predictions.length; 
        
        let riskScore = nearbyAlerts.length * 15 + totalSightings * 2;
        riskScore = Math.min(riskScore, 100);

        const riskLevel = riskScore > 65 ? 'High' : riskScore > 35 ? 'Medium' : 'Low';

        return {
            riskScore,
            riskLevel,
            speciesTracked,
            nearbyAlerts: nearbyAlerts.length,
            safeRoutes: safeRoute ? 1 : 0,
            totalSightings,
            alerts: nearbyAlerts,
        };
    }, [predictions, user, safeRoute]);

    const greeting = getGreeting();

    return (
        <ScrollView style={styles.container} contentContainerStyle={styles.content}>
            <View style={styles.header}>
                <Text style={styles.greeting}>{greeting}, {user.name.split(' ')[0]}</Text>
                <Text style={styles.title}>
                    {status === AppState.LOADING ? 'Loading Wildlife Data...' : 'Stay Safe Out There'}
                </Text>
            </View>
            
            {(status === AppState.IDLE || status === AppState.LOADING) && !predictions.length ? (
                <View style={styles.emptyState}>
                    {status === AppState.LOADING ? (
                        <SpinnerIcon width={32} height={32} color="#059669" />
                    ) : (
                        <ShieldIcon width={48} height={48} color="#059669" />
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
                        <Text style={styles.sectionTitle}>Recent Wildlife Alerts</Text>
                        <View style={styles.alertsList}>
                            {dashboardStats.alerts.length > 0 ? (
                                dashboardStats.alerts.map((alert: AnimalPrediction) => <AlertItem key={alert.id} alert={alert} />)
                            ) : (
                                <View style={styles.noAlerts}>
                                    <Text style={styles.noAlertsText}>No recent wildlife alerts in your area.</Text>
                                    <Text style={styles.noAlertsSubtext}>It's quiet for now. Stay vigilant.</Text>
                                </View>
                            )}
                        </View>
                    </View>
                </>
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
});

export default React.memo(Dashboard);
