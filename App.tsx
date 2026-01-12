import React, { useState, useEffect, useCallback } from 'react';
import { useAnimalData } from './hooks/useAnimalData';
import { View, Report, User } from './types';
import { NEARBY_KM, ANIMATION_STEPS, ANIMATION_DURATION_MS } from './constants';
import MapView from './components/MapView';
import GuideView from './components/GuideView';
import ReportsView from './components/ReportsView';
import ProfileView from './components/ProfileView';
import BottomNav from './components/BottomNav';
import LoginView from './components/LoginView';
import OnboardingGuide from './components/OnboardingGuide';
import Dashboard from './components/Dashboard';

const App: React.FC = () => {
    const { 
        status, message, userLocation, predictions, processLocationSearch,
        searchHistory, clearSearchHistory,
        suggestions, isSuggesting, fetchSuggestions, clearSuggestions,
        safeRoute, routeStatus, routeMessage, calculateSafeRoute, safePlaces,
        isNavigating, liveLocation, navigationStats, startNavigation, stopNavigation,
        navigationAlert, clearNavigationAlert, closestPathIndex, getCurrentLocation,
        weather, isApproachingStart
    } = useAnimalData();
    
    const [user, setUser] = useState<User | null>(null);
    const [usersDB, setUsersDB] = useState<Record<string, string>>({}); // email -> password
    const [showOnboarding, setShowOnboarding] = useState(false);
    const [currentView, setCurrentView] = useState(View.HOME);

    useEffect(() => {
        try {
            const savedUsers = localStorage.getItem('wildlife-app-users');
            if (savedUsers) setUsersDB(JSON.parse(savedUsers));
            else {
                const defaultUser = { email: 'explorer@wildlife-safety.com', pass: 'password', name: 'Trail Explorer', avatarId: 'tiger', nearbyRadiusKm: NEARBY_KM, isNewUser: true };
                const defaultDB = { [defaultUser.email]: defaultUser.pass };
                localStorage.setItem('wildlife-app-users', JSON.stringify(defaultDB));
                const { pass, ...userData } = defaultUser;
                localStorage.setItem(`user-${defaultUser.email}`, JSON.stringify(userData));
                setUsersDB(defaultDB);
            }
            const savedSession = localStorage.getItem('wildlife-app-session');
            if (savedSession) {
                const loadedUser: User = JSON.parse(savedSession);
                if (typeof loadedUser.nearbyRadiusKm === 'undefined') loadedUser.nearbyRadiusKm = NEARBY_KM;
                setUser(loadedUser);
                if (loadedUser.isNewUser) setShowOnboarding(true);
            }
        } catch {}
    }, []);

    const [animationProgress, setAnimationProgress] = useState(0);
    const [isPlaying, setIsPlaying] = useState(true);

    const [reports, setReports] = useState<Report[]>(() => {
        try { const saved = localStorage.getItem('reports'); return saved ? JSON.parse(saved) : []; }
        catch { return []; }
    });

    const handleUpdateUser = useCallback((updatedUser: User) => {
        setUser(updatedUser);
        localStorage.setItem('wildlife-app-session', JSON.stringify(updatedUser));
        localStorage.setItem(`user-${updatedUser.email.toLowerCase()}`, JSON.stringify(updatedUser));
    }, []);

    const handleAuth = useCallback((mode: 'login' | 'signup', name: string, email: string, pass: string): string | null => {
        const normalizedEmail = email.toLowerCase();
        if (mode === 'login') {
            if (usersDB[normalizedEmail] && usersDB[normalizedEmail] === pass) {
                const userDataString = localStorage.getItem(`user-${normalizedEmail}`);
                if (!userDataString) return "Could not find user data. Please sign up again.";
                const userData: User = JSON.parse(userDataString);
                if (typeof userData.nearbyRadiusKm === 'undefined') userData.nearbyRadiusKm = NEARBY_KM;
                setUser(userData);
                localStorage.setItem('wildlife-app-session', JSON.stringify(userData));
                if (userData.isNewUser) setShowOnboarding(true);
                return null;
            }
            return 'Invalid credentials. Please try again.';
        } else {
            if (usersDB[normalizedEmail]) return 'An account with this email already exists.';
            const newUser: User = { name, email: normalizedEmail, avatarId: 'tiger', nearbyRadiusKm: NEARBY_KM, isNewUser: true };
            const newDB = { ...usersDB, [normalizedEmail]: pass };
            setUsersDB(newDB);
            localStorage.setItem('wildlife-app-users', JSON.stringify(newDB));
            localStorage.setItem(`user-${normalizedEmail}`, JSON.stringify(newUser));
            setUser(newUser);
            localStorage.setItem('wildlife-app-session', JSON.stringify(newUser));
            setShowOnboarding(true);
            return null;
        }
    }, [usersDB]);

    const handleLogout = useCallback(() => {
        setUser(null);
        localStorage.removeItem('wildlife-app-session');
        setCurrentView(View.HOME);
    }, []);

    const handleCloseOnboarding = () => {
        if (user) {
            const updatedUser = { ...user, isNewUser: false };
            handleUpdateUser(updatedUser);
        }
        setShowOnboarding(false);
    };

    const addReport = useCallback((report: Omit<Report, 'id' | 'timestamp'>) => {
        setReports(prev => {
            const newReport = { ...report, id: Date.now(), timestamp: new Date().toISOString() };
            const updated = [newReport, ...prev];
            localStorage.setItem('reports', JSON.stringify(updated));
            return updated;
        });
    }, []);

    useEffect(() => {
        if (!isPlaying || predictions.length === 0) return;
        const interval = setInterval(() => { setAnimationProgress(prev => (prev + 1) % (ANIMATION_STEPS + 1)); }, ANIMATION_DURATION_MS / ANIMATION_STEPS);
        return () => clearInterval(interval);
    }, [isPlaying, predictions]);

    const nearbyRadius = user?.nearbyRadiusKm ?? NEARBY_KM;

    const handleStartNavigation = useCallback(() => {
        startNavigation(nearbyRadius);
        setCurrentView(View.MAP);
    }, [startNavigation, nearbyRadius]);
    
    const handleNavigate = (view: View) => {
        setCurrentView(view);
    };

    if (!user) return <LoginView onAuth={handleAuth} />;
    if (showOnboarding) return <OnboardingGuide onClose={handleCloseOnboarding} />;

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
            case View.PROFILE: return <ProfileView user={user} onLogout={handleLogout} onUpdateUser={handleUpdateUser} />;
            default: return <Dashboard 
                                user={user} status={status} message={message} predictions={predictions} 
                                nearbyRadiusKm={nearbyRadius} safeRoute={safeRoute} weather={weather}
                                onNavigate={handleNavigate}
                            />;
        }
    };

    return (
        <div className="h-screen w-screen flex flex-col bg-gray-50">
           <main className="flex-grow overflow-hidden pb-16">
             {renderView()}
           </main>
           <BottomNav currentView={currentView} onNavigate={setCurrentView} />
        </div>
    );
};

export default App;