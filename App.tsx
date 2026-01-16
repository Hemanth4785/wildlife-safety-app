import React, { useState, useEffect, useCallback } from 'react';
import { View as RNView, StyleSheet, SafeAreaView } from 'react-native';
import { useAnimalData } from './hooks/useAnimalData';
import { View } from './types';
import { ANIMATION_STEPS, ANIMATION_DURATION_MS } from './constants';
import MapView from './components/MapView';
import GuideView from './components/GuideView';
import ReportsView from './components/ReportsView';
import ProfileView from './components/ProfileView';
import BottomNav from './components/BottomNav';
import LoginView from './components/LoginView';
import OnboardingGuide from './components/OnboardingGuide';
import Dashboard from './components/Dashboard';
import { AppProvider, useAppContext } from './contexts/AppContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoadingScreen } from './components/LoadingScreen';

const AppContent: React.FC = () => {
    const { 
        status, message, userLocation, predictions, processLocationSearch,
        searchHistory, clearSearchHistory,
        suggestions, isSuggesting, fetchSuggestions, clearSuggestions,
        safeRoute, routeStatus, routeMessage, calculateSafeRoute, safePlaces,
        isNavigating, liveLocation, navigationStats, startNavigation, stopNavigation,
        navigationAlert, clearNavigationAlert, closestPathIndex, getCurrentLocation,
        weather, isApproachingStart
    } = useAnimalData();
    
    const { 
        user, 
        reports, 
        isLoading, 
        showOnboarding, 
        login, 
        signup, 
        logout, 
        updateUser, 
        closeOnboarding, 
        addReport 
    } = useAppContext();
    
    const [currentView, setCurrentView] = useState(View.HOME);
    const [animationProgress, setAnimationProgress] = useState(0);
    const [isPlaying, setIsPlaying] = useState(true);

    const handleAuth = useCallback(async (mode: 'login' | 'signup', name: string, email: string, pass: string): Promise<string | null> => {
        if (mode === 'login') {
            return await login(email, pass);
        } else {
            return await signup(name, email, pass);
        }
    }, [login, signup]);

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

    if (isLoading) {
        return <LoadingScreen message="Initializing app..." />;
    }

    if (!user) return <LoginView onAuth={handleAuth} />;
    if (showOnboarding) return <OnboardingGuide onClose={closeOnboarding} />;

    const renderView = () => {
        switch (currentView) {
            case View.HOME:
                return <Dashboard 
                            user={user}
                            status={status}
                            message={message}
                            predictions={predictions}
                            nearbyRadiusKm={nearbyRadius}
                            safeRoute={safeRoute}
                            weather={weather}
                            onNavigate={handleNavigate}
                        />;
            case View.MAP:
                return <MapView 
                        status={status} message={message} userLocation={userLocation} predictions={predictions} safeRoute={safeRoute}
                        safePlaces={safePlaces}
                        onLocationSubmit={processLocationSearch} suggestions={suggestions} isSuggesting={isSuggesting}
                        onFetchSuggestions={fetchSuggestions} onClearSuggestions={clearSuggestions} routeStatus={routeStatus}
                        routeMessage={routeMessage} onCalculateSafeRoute={calculateSafeRoute} getCurrentLocation={getCurrentLocation}
                        isNavigating={isNavigating} liveLocation={liveLocation} navigationStats={navigationStats}
                        onStartNavigation={handleStartNavigation} onStopNavigation={stopNavigation} navigationAlert={navigationAlert}
                        clearNavigationAlert={clearNavigationAlert} closestPathIndex={closestPathIndex}
                        animationProgress={animationProgress} isPlaying={isPlaying}
                        onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)}
                        nearbyRadiusKm={nearbyRadius}
                        isApproachingStart={isApproachingStart}
                    />;
            case View.GUIDE: return <GuideView />;
            case View.REPORTS: return <ReportsView reports={reports} onAddReport={addReport} />;
            case View.PROFILE: return <ProfileView user={user} onLogout={handleLogout} onUpdateUser={updateUser} />;
            default: return <Dashboard 
                                user={user} status={status} message={message} predictions={predictions} 
                                nearbyRadiusKm={nearbyRadius} safeRoute={safeRoute} weather={weather}
                                onNavigate={handleNavigate}
                            />;
        }
    };

    return (
        <SafeAreaView style={styles.container}>
           <RNView style={styles.main}>
             {renderView()}
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
                <AppContent />
            </AppProvider>
        </ErrorBoundary>
    );
};

export default App;
