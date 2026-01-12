import React, { useMemo } from 'react';
import type { AnimalPrediction, User, WeatherData, Route } from '../types';
import { AppState, View } from '../types';
import { SpinnerIcon, ErrorIcon, ShieldIcon, AlertTriangleIcon, PaperPlaneIcon, ChartIcon, SunIcon, CloudIcon, RainIcon, WindIcon, MoonIcon, PartlyCloudyIcon, SnowIcon } from './icons';
import { NEARBY_KM } from '../constants';

// --- Helper Functions ---
const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
};

const getWeatherInfo = (code: number, isDay: number): { text: string; icon: React.ReactNode } => {
    const Icon = (props: React.SVGProps<SVGSVGElement>) => {
        switch (code) {
            case 0: return isDay ? <SunIcon {...props} /> : <MoonIcon {...props} />;
            case 1: return isDay ? <PartlyCloudyIcon {...props} /> : <MoonIcon {...props} />;
            case 2: case 3: return <CloudIcon {...props} />;
            case 45: case 48: return <CloudIcon {...props} />; // Fog
            case 51: case 53: case 55: case 61: case 63: case 65: case 80: case 81: case 82: return <RainIcon {...props} />;
            case 71: case 73: case 75: case 77: case 85: case 86: return <SnowIcon {...props} />;
            default: return isDay ? <SunIcon {...props} /> : <MoonIcon {...props} />;
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
    return { text, icon: <Icon className="w-8 h-8" /> };
};

// --- Child Components ---
const StatCard: React.FC<{ icon: React.ReactNode; value: number | string; label: string; }> = ({ icon, value, label }) => (
    <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200/80 flex flex-col items-center justify-center text-center">
        <div className="text-emerald-600 mb-2">{icon}</div>
        <p className="text-2xl font-bold text-gray-800">{value}</p>
        <p className="text-xs text-gray-500 font-medium">{label}</p>
    </div>
);

const RiskLevelCard: React.FC<{ riskScore: number; riskLevel: string; speciesTracked: number; weather: WeatherData | null; }> = ({ riskScore, riskLevel, speciesTracked, weather }) => {
    const colorClasses = {
        Low: 'from-emerald-500 to-green-500',
        Medium: 'from-yellow-500 to-amber-500',
        High: 'from-red-500 to-rose-500',
    };
    const weatherInfo = weather ? getWeatherInfo(weather.weatherCode, weather.isDay) : null;

    return (
        <div className={`p-5 rounded-xl text-white bg-gradient-to-br ${colorClasses[riskLevel as keyof typeof colorClasses]}`}>
            <div className="flex justify-between items-start">
                <div>
                    <div className="flex items-center gap-3 mb-1">
                        <ShieldIcon className="w-6 h-6" />
                        <h3 className="font-semibold">Current Risk Level</h3>
                    </div>
                    <p className="text-5xl font-bold ml-9">{riskLevel}</p>
                    <p className="text-sm ml-9 opacity-90">Risk Score: {riskScore}/100 • {speciesTracked} species</p>
                </div>
                {weatherInfo && (
                    <div className="text-right flex-shrink-0">
                        <div className="flex items-center justify-end gap-2">
                           {weatherInfo.icon}
                           <p className="text-3xl font-bold">{Math.round(weather.temperature)}°C</p>
                        </div>
                        <p className="text-xs opacity-90">{weatherInfo.text}</p>
                         <p className="text-xs opacity-90 flex items-center justify-end gap-1"><WindIcon className="w-3 h-3"/>{weather.windSpeed} km/h</p>
                    </div>
                )}
            </div>
        </div>
    );
};

const AlertItem: React.FC<{ alert: AnimalPrediction }> = ({ alert }) => (
    <div className="flex items-center gap-3 text-sm p-3 bg-white rounded-lg shadow-sm border border-gray-200/80">
        <span className="text-2xl">{alert.emoji}</span>
        <div>
            <p className="font-semibold text-gray-800">{alert.common}</p>
            <p className="text-gray-500">{alert.current.dist_km} km away near {alert.current.addr.split(',').slice(0, 2).join(',')}</p>
        </div>
    </div>
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
    onNavigate: (view: View) => void;
}

const Dashboard: React.FC<DashboardProps> = (props) => {
    const { user, status, message, predictions, nearbyRadiusKm, safeRoute, weather, onNavigate } = props;

    const dashboardStats = useMemo(() => {
        const nearbyAlerts = predictions.filter(p => p.current.dist_km <= (user.nearbyRadiusKm ?? NEARBY_KM));
        const speciesTracked = new Set(predictions.map(p => p.common)).size;
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
        <div className="p-4 space-y-5 overflow-y-auto h-full pb-24 bg-gray-50">
            <header>
                <p className="text-gray-500 text-sm">{greeting}, {user.name.split(' ')[0]}</p>
                <h1 className="text-2xl font-bold text-gray-800">
                    {status === AppState.LOADING ? 'Loading Wildlife Data...' : 'Stay Safe Out There'}
                </h1>
            </header>
            
            {(status === AppState.IDLE || status === AppState.LOADING) && !predictions.length ? (
                <div className="flex flex-col items-center justify-center gap-3 bg-white p-8 rounded-lg shadow text-center">
                    {status === AppState.LOADING ? (
                        <SpinnerIcon className="w-8 h-8 text-emerald-500" />
                    ) : (
                        <ShieldIcon className="w-12 h-12 text-emerald-500" />
                    )}
                    <p className="text-gray-600 font-semibold">
                        {status === AppState.LOADING ? message : 'Welcome to Wildlife Safety!'}
                    </p>
                    <p className="text-sm text-gray-500">
                        {status === AppState.LOADING ? 'Fetching the latest wildlife and weather data for you.' : 'Plan a route to see risks in your area.'}
                    </p>
                    {status === AppState.IDLE && (
                         <button onClick={() => onNavigate(View.MAP)} className="w-full max-w-xs mt-4 py-3 bg-emerald-600 text-white font-semibold rounded-lg shadow hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2">
                            <PaperPlaneIcon className="w-5 h-5" /> Plan Safe Route
                        </button>
                    )}
                </div>
            ) : status === AppState.ERROR ? (
                 <div className="flex items-center justify-center gap-3 bg-red-100 text-red-700 p-4 rounded-lg shadow">
                    <ErrorIcon /> <span>{message}</span>
                </div>
            ) : (
                <>
                    <RiskLevelCard 
                        riskScore={dashboardStats.riskScore}
                        riskLevel={dashboardStats.riskLevel}
                        speciesTracked={dashboardStats.speciesTracked}
                        weather={weather}
                    />
                    
                    <div className="grid grid-cols-3 gap-3">
                        <StatCard icon={<AlertTriangleIcon />} value={dashboardStats.nearbyAlerts} label="Nearby Alerts" />
                        <StatCard icon={<PaperPlaneIcon />} value={dashboardStats.safeRoutes} label="Safe Routes" />
                        <StatCard icon={<ChartIcon />} value={dashboardStats.totalSightings} label="Total Sightings" />
                    </div>

                    <div className="space-y-3">
                         <button onClick={() => onNavigate(View.MAP)} className="w-full py-3 bg-emerald-600 text-white font-semibold rounded-lg shadow hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2">
                            <PaperPlaneIcon className="w-5 h-5" /> Plan Safe Route
                        </button>
                         <button onClick={() => onNavigate(View.GUIDE)} className="w-full py-3 bg-white text-emerald-600 font-semibold rounded-lg shadow border border-gray-200 hover:bg-gray-100 transition-colors">
                            Ask AI Guide
                        </button>
                    </div>

                    <div>
                        <h2 className="text-lg font-bold text-gray-800 mb-3">Recent Wildlife Alerts</h2>
                        <div className="space-y-3">
                            {dashboardStats.alerts.length > 0 ? (
                                dashboardStats.alerts.map(alert => <AlertItem key={alert.id} alert={alert} />)
                            ) : (
                                <div className="text-center text-gray-500 py-6 bg-white rounded-lg shadow-sm border">
                                    <p className="text-sm font-medium">No recent wildlife alerts in your area.</p>
                                    <p className="text-xs text-gray-400 mt-1">It's quiet for now. Stay vigilant.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default React.memo(Dashboard);