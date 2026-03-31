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
import Constants from 'expo-constants';
import { API_BASE_URL } from './config';

console.log("Firebase connected:", auth.app.name);
console.log("Firestore initialized:", db.type === 'firestore' ? 'Yes' : 'No');
console.log("[DEBUG] API_BASE_URL:", API_BASE_URL);
console.log("[DEBUG] NODE_ENV:", Constants.expoConfig?.extra?.NODE_ENV);
console.log("[DEBUG] EAS Project ID:", Constants.expoConfig?.extra?.eas?.projectId);

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
        backendReady, backendError,
        recentSightings, isWildlifeLoading, isLocationLoading, isRouteLoading,

        // Filters from Context
        visibleAnimals, setVisibleAnimals,
        showPredictions, setShowPredictions,
        showNearbyRadius, setShowNearbyRadius,
        showAnimalMarkers, setShowAnimalMarkers,
        historicalMode, setHistoricalMode,
        historicalDateRange, setHistoricalDateRange
    } = useAppContext();

    const [currentView, setCurrentView] = useState(View.HOME);
    const [routeIntent, setRouteIntent] = useState<{ start: string; end: string } | null>(null);
    const [authScreen, setAuthScreen] = useState<'login' | 'signup'>('login');
    const [animationProgress, setAnimationProgress] = useState(0);
    const [isPlaying, setIsPlaying] = useState(true);

    const handleLogout = useCallback(async () => {
        await logout();
        setCurrentView(View.HOME);
    }, [logout]);

    useEffect(() => {
        if (!isPlaying || predictions.length === 0) return;
        const interval = setInterval(() => { 
            setAnimationProgress(prev => (prev + 1) % (ANIMATION_STEPS + 1)); 
        }, ANIMATION_DURATION_MS / ANIMATION_STEPS);
        return () => clearInterval(interval);
    }, [isPlaying, predictions]);

    const nearbyRadius = user?.nearbyRadiusKm ?? 5; // Default from constants

    const handleStartNavigation = useCallback(() => {
        startNavigation(nearbyRadius);
        setCurrentView(View.MAP);
    }, [startNavigation, nearbyRadius]);
    
    const handleNavigate = (view: View) => {
        setCurrentView(view);
    };

    // 1. Wait for Auth to initialize
    if (isLoading) {
        return <LoadingScreen message="Checking authentication..." />;
    }

    // 2. If no user, show Auth screens (Login/Signup)
    // We don't need backendReady for this.
    if (!user) {
        if (authScreen === 'login') {
            return <LoginScreen onLogin={login} onSwitchToSignup={() => setAuthScreen('signup')} />;
        } else {
            return <RegisterScreen onSignup={signup} onSwitchToLogin={() => setAuthScreen('login')} />;
        }
    }

    // 3. User is logged in. Now we wait for Backend check.
    if (backendReady === null) {
        return <LoadingScreen message="Connecting to backend..." />;
    }

    if (backendReady === false) {
        return (
            <LoadingScreen 
                message={backendError || "Backend is not reachable. Please start the backend server and try again."} 
                showRetryButton={true}
                onRetry={() => {
                    setIsLoading(true);
                    // This will trigger the checkBackend useEffect in useAnimalData
                    // because we're toggling isLoading which might affect shouldFetch
                }}
            />
        );
    }
    
    if (showOnboarding) return <OnboardingGuide onClose={closeOnboarding} />;

    const viewStyle = (active: boolean) => [
        StyleSheet.absoluteFill,
        { opacity: active ? 1 : 0 }
    ];
    const viewPointerEvents = (active: boolean): 'auto' | 'none' => (active ? 'auto' : 'none');

    return (
        <SafeAreaView style={styles.container}>
           <RNView style={styles.main}>
             <RNView style={viewStyle(currentView === View.HOME)} pointerEvents={viewPointerEvents(currentView === View.HOME)}>
                 <Dashboard
                     user={user}
                     status={status}
                     message={message}
                     predictions={predictions}
                     nearbyRadiusKm={nearbyRadius}
                     safeRoute={safeRoute}
                     weather={weather}
                     recentSightings={recentSightings}
                     onNavigate={handleNavigate}
                     visibleAnimals={visibleAnimals}
                 />
             </RNView>

             <RNView style={viewStyle(currentView === View.MAP)} pointerEvents={viewPointerEvents(currentView === View.MAP)}>
                 <MapView
                     status={status} message={message} userLocation={userLocation} predictions={predictions} safeRoute={safeRoute}
                     safePlaces={safePlaces} riskZones={riskZones} riskySegments={riskySegments}
                     onLocationSubmit={processLocationSearch} suggestions={suggestions} isSuggesting={isSuggesting}
                     onFetchSuggestions={fetchSuggestions} onClearSuggestions={clearSuggestions} searchError={searchError}
                     routeStatus={routeStatus}
                     routeMessage={routeMessage} onCalculateSafeRoute={calculateSafeRoute} getCurrentLocation={getCurrentLocation}
                     isNavigating={isNavigating} liveLocation={liveLocation} navigationStats={navigationStats}
                     onStopNavigation={stopNavigation} navigationAlert={navigationAlert}
                     clearNavigationAlert={clearNavigationAlert} closestPathIndex={closestPathIndex}
                     animationProgress={animationProgress} isPlaying={isPlaying}
                     onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)}
                     nearbyRadiusKm={nearbyRadius}
                     isApproachingStart={isApproachingStart}
                     recentSightings={recentSightings}
                     isWildlifeLoading={isWildlifeLoading}
                     isLocationLoading={isLocationLoading}
                     isRouteLoading={isRouteLoading}
                     reports={reports}
                     initialRouteStart={routeIntent?.start}
                     initialRouteEnd={routeIntent?.end}
                     visibleAnimals={visibleAnimals}
                     setVisibleAnimals={setVisibleAnimals}
                     showPredictions={showPredictions}
                     setShowPredictions={setShowPredictions}
                     showNearbyRadius={showNearbyRadius}
                     setShowNearbyRadius={setShowNearbyRadius}
                     showAnimalMarkers={showAnimalMarkers}
                     setShowAnimalMarkers={setShowAnimalMarkers}
                     historicalMode={historicalMode}
                     setHistoricalMode={setHistoricalMode}
                     historicalDateRange={historicalDateRange}
                     setHistoricalDateRange={setHistoricalDateRange}
                     onStartNavigation={handleStartNavigation}
                 />
             </RNView>

             <RNView style={viewStyle(currentView === View.GUIDE)} pointerEvents={viewPointerEvents(currentView === View.GUIDE)}>
                 <GuideView 
                    recentSightings={recentSightings}
                    riskZones={riskZones}
                    onOpenRouteLink={(startQuery, destQuery) => {
                        setRouteIntent({ start: startQuery, end: destQuery });
                        setCurrentView(View.MAP);
                 }} />
             </RNView>

             <RNView style={viewStyle(currentView === View.REPORTS)} pointerEvents={viewPointerEvents(currentView === View.REPORTS)}>
                 <ReportsView onAddReport={addReport} />
             </RNView>

             <RNView style={viewStyle(currentView === View.PROFILE)} pointerEvents={viewPointerEvents(currentView === View.PROFILE)}>
                 <ProfileView user={user} onLogout={handleLogout} onUpdateUser={updateUser} onNavigate={setCurrentView} />
             </RNView>
           </RNView>
           <BottomNav currentView={currentView} onNavigate={setCurrentView} />
        </SafeAreaView>
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
