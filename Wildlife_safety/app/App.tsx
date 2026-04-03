import React, { useState, useEffect, useCallback } from 'react';
import { View as RNView, StyleSheet } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useAnimalData } from './hooks/useAnimalData';
import { View } from './types';
import { ANIMATION_STEPS, ANIMATION_DURATION_MS } from './constants';
import MapView from './components/MapView';
import GuideView from './components/GuideView';
import ReportsView from './components/ReportsView';
import ProfileView from './components/ProfileView';
import BottomNav from './components/BottomNav';
import LoginScreen from './components/LoginScreen';
import RegisterScreen from './components/RegisterScreen';
import OnboardingGuide from './components/OnboardingGuide';
import Dashboard from './components/Dashboard';
import { AppProvider, useAppContext } from './contexts/AppContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoadingScreen } from './components/LoadingScreen';
import { auth, db } from "./services/firebase";
import { storage } from "./utils/storage";

import { wakeUpBackend } from './services/apiService.native';

console.log("Firebase connected:", auth.app.name);
console.log("Firestore initialized:", db.type === 'firestore' ? 'Yes' : 'No');

const AppContent: React.FC = () => {
    const { 
        user, 
        reports, 
        isLoading, 
        showOnboarding, 
        login, 
        signup, 
        logout, 
        updateUser, 
        setUser,
        setIsLoading,
        closeOnboarding, 
        addReport,

        // From Context (Animal Data)
        status, message, userLocation, predictions, processLocationSearch,
        searchHistory, clearSearchHistory,
        suggestions, isSuggesting, fetchSuggestions, clearSuggestions, searchError,
        safeRoute, routeStatus, routeMessage, calculateSafeRoute, safePlaces, riskZones, riskySegments,
        isNavigating, liveLocation, navigationStats, startNavigation, stopNavigation,
        navigationAlert, clearNavigationAlert, closestPathIndex, getCurrentLocation,
        weather, isApproachingStart,
        backendReady, backendError, checkBackend,
        recentSightings, isWildlifeLoading, isLocationLoading, isRouteLoading,

        // Filters from Context
        visibleAnimals, setVisibleAnimals,
        showPredictions, setShowPredictions,
        showNearbyRadius, setShowNearbyRadius,
        showAnimalMarkers, setShowAnimalMarkers,
        historicalMode, setHistoricalMode,
        historicalDateRange, setHistoricalDateRange
    } = useAppContext();

    const safePredictions = Array.isArray(predictions) ? predictions : [];

    const [currentView, setCurrentView] = useState(View.HOME);
    const [routeIntent, setRouteIntent] = useState<{ start: string; end: string } | null>(null);
    const [authScreen, setAuthScreen] = useState<'login' | 'signup'>('login');
    const [animationProgress, setAnimationProgress] = useState(0);
    const [isPlaying, setIsPlaying] = useState(true);
    const [isBackendWaking, setIsBackendWaking] = useState(false);

    useEffect(() => {
        let mounted = true;
        const initBackend = async () => {
            if (!mounted) return;
            setIsBackendWaking(true);
            try {
                await wakeUpBackend();
            } finally {
                if (mounted) setIsBackendWaking(false);
            }
        };
        initBackend();
        return () => { mounted = false; };
    }, []);

    const handleLogout = useCallback(async () => {
        await logout();
        setCurrentView(View.HOME);
    }, [logout]);

    useEffect(() => {
        if (!isPlaying || safePredictions.length === 0) return;
        const interval = setInterval(() => { 
            setAnimationProgress(prev => (prev + 1) % (ANIMATION_STEPS + 1)); 
        }, ANIMATION_DURATION_MS / ANIMATION_STEPS);
        return () => clearInterval(interval);
    }, [isPlaying, safePredictions.length]);

    const nearbyRadius = user?.nearbyRadiusKm ?? 5; // Default from constants

    const handleStartNavigation = useCallback(() => {
        startNavigation(nearbyRadius);
        setCurrentView(View.MAP);
    }, [startNavigation, nearbyRadius]);
    
    const handleNavigate = (view: View) => {
        setCurrentView(view);
    };

    // 1. Wait for Auth to initialize or Backend to wake up
    if (isLoading || isBackendWaking) {
        return <LoadingScreen message={isBackendWaking ? "Connecting to wildlife services..." : "Initializing Wildlife Safety..."} />;
    }

    // 2. If no user, show Auth screens (Login/Signup)
    if (!user) {
        if (authScreen === 'login') {
            return <LoginScreen onLogin={login} onSwitchToSignup={() => setAuthScreen('signup')} />;
        } else {
            return <RegisterScreen onRegister={signup} onSwitchToLogin={() => setAuthScreen('login')} />;
        }
    }

    const viewStyle = (active: boolean) => [
        StyleSheet.absoluteFill,
        { opacity: active ? 1 : 0 }
    ];
    const viewPointerEvents = (active: boolean): 'auto' | 'none' => (active ? 'auto' : 'none');

    // 3. Global Safety Wrapper: Ensure backend state doesn't crash app
    // We render the main app but ensure sub-components handle nulls
    return (
        <ErrorBoundary>
            <SafeAreaProvider>
                <RNView style={styles.container}>
                    {/* Main Content */}
                    <RNView style={viewStyle(currentView === View.HOME)} pointerEvents={viewPointerEvents(currentView === View.HOME)}>
                        <Dashboard 
                            onNavigate={handleNavigate}
                            onStartNavigation={handleStartNavigation}
                        />
                    </RNView>

                    <RNView style={viewStyle(currentView === View.MAP)} pointerEvents={viewPointerEvents(currentView === View.MAP)}>
                        <MapView 
                            initialRouteStart={routeIntent?.start}
                            initialRouteEnd={routeIntent?.end}
                            onRouteHandled={() => setRouteIntent(null)}
                        />
                    </RNView>

                    <RNView style={viewStyle(currentView === View.GUIDE)} pointerEvents={viewPointerEvents(currentView === View.GUIDE)}>
                        <GuideView />
                    </RNView>

                    <RNView style={viewStyle(currentView === View.REPORTS)} pointerEvents={viewPointerEvents(currentView === View.REPORTS)}>
                        <ReportsView onAddReport={addReport} />
                    </RNView>

                    <RNView style={viewStyle(currentView === View.PROFILE)} pointerEvents={viewPointerEvents(currentView === View.PROFILE)}>
                        <ProfileView onLogout={handleLogout} />
                    </RNView>

                    {/* Navigation Bar */}
                    <BottomNav currentView={currentView} onNavigate={handleNavigate} />

                    {/* Onboarding Overlay */}
                    {showOnboarding && (
                        <OnboardingGuide onClose={closeOnboarding} />
                    )}
                </RNView>
            </SafeAreaProvider>
        </ErrorBoundary>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f9fafb',
    },
    main: {
        flex: 1,
        paddingBottom: 64, // Space for bottom nav
    },
});

const App: React.FC = () => {
    return (
        <ErrorBoundary>
            <AppProvider>
                <SafeAreaProvider>
                    <AppContent />
                </SafeAreaProvider>
            </AppProvider>
        </ErrorBoundary>
    );
};

export default App;
