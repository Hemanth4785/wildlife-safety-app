/**
 * Centralized application state management
 * Reduces prop drilling and provides clean data flow
 */
import React, { createContext, useContext, useCallback, useState, useEffect, ReactNode } from 'react';
import { User as AppUser, Report } from '../types';
import { storage } from '../utils/storage';
import { logger } from '../utils/logger';
import { NEARBY_KM } from '../constants';
import * as authService from '../services/authService';
import { doc, getDoc, setDoc, serverTimestamp, collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../services/firebase';
import { auth } from '../services/firebase';
import { useAnimalData } from '../hooks/useAnimalData';
import { useLocalStorage } from '../hooks/useLocalStorage';

interface AppState {
  user: AppUser | null;
  reports: Report[];
  isLoading: boolean;
  showOnboarding: boolean;
}

interface AnimalDataState {
  status: any;
  message: string;
  userLocation: any;
  predictions: any[];
  processLocationSearch: (location: any) => Promise<void>;
  searchHistory: string[];
  clearSearchHistory: () => void;
  suggestions: any[];
  isSuggesting: boolean;
  fetchSuggestions: (query: string) => void;
  clearSuggestions: () => void;
  searchError: string | null;
  safeRoute: any;
  routeStatus: any;
  routeMessage: string;
  calculateSafeRoute: (...args: any[]) => Promise<any>;
  safePlaces: any[];
  riskZones: any[];
  riskySegments: any[];
  isNavigating: boolean;
  liveLocation: any;
  navigationStats: any;
  startNavigation: (radius: number) => void;
  stopNavigation: () => void;
  navigationAlert: any;
  clearNavigationAlert: () => void;
  closestPathIndex: number;
  getCurrentLocation: () => Promise<any>;
  weather: any;
  isApproachingStart: boolean;
  backendReady: boolean | null;
  backendError: string | null;
  recentSightings: any[];
  isWildlifeLoading: boolean;
  isLocationLoading: boolean;
  isRouteLoading: boolean;
  
  // Historical Mode
  historicalMode: boolean;
  setHistoricalMode: (val: boolean) => void;
  historicalDateRange: { startDate: string; endDate: string } | null;
  setHistoricalDateRange: (val: { startDate: string; endDate: string } | null | ((prev: { startDate: string; endDate: string } | null) => { startDate: string; endDate: string } | null)) => void;
  
  // Filters (moved to context for sync)
  visibleAnimals: Record<string, boolean>;
  setVisibleAnimals: (val: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>)) => void;
  showPredictions: boolean;
  setShowPredictions: (val: boolean) => void;
  showNearbyRadius: boolean;
  setShowNearbyRadius: (val: boolean) => void;
  showAnimalMarkers: boolean;
  setShowAnimalMarkers: (val: boolean) => void;
}

interface AppContextValue extends AppState, AnimalDataState {
  // User actions
  login: (email: string, password: string) => Promise<string | null>;
  signup: (name: string, email: string, password: string) => Promise<string | null>;
  logout: () => Promise<void>;
  updateUser: (user: AppUser) => Promise<void>;
  setUser: (user: AppUser | null) => void;
  setIsLoading: (isLoading: boolean) => void;
  closeOnboarding: () => Promise<void>;
  
  // Report actions
  addReport: (report: Omit<Report, 'id' | 'timestamp'>) => Promise<void>;
  removeReport: (reportId: string | number) => Promise<void>;
  
  // Session management
  initializeApp: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | undefined>(undefined);

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext must be used within AppProvider');
  }
  return context;
};

interface AppProviderProps {
  children: ReactNode;
}

export const AppProvider: React.FC<AppProviderProps> = ({ children }) => {
  const [user, setUser] = useState<AppUser | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);

  // Hook into animal data
   const animalData = useAnimalData(!!user);
 
   // Filters state (moved from MapView to context with persistence)
   const [visibleAnimals, setVisibleAnimals] = useLocalStorage<Record<string, boolean>>('map-filter-animals', {});
   const [showPredictions, setShowPredictions] = useLocalStorage<boolean>('map-filter-predictions', false);
   const [showNearbyRadius, setShowNearbyRadius] = useLocalStorage<boolean>('map-filter-radius', true);
   const [showAnimalMarkers, setShowAnimalMarkers] = useLocalStorage<boolean>('map-filter-markers', true);
 
   // Initialize app data
  const initializeApp = useCallback(async () => {
    try {
      setIsLoading(true);

      // Load reports
      const savedReports = await storage.getItem<Report[]>('reports');
      if (savedReports) {
        setReports(savedReports);
      }
    } catch (error) {
      logger.error('Error initializing app', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    initializeApp();
  }, [initializeApp]);

  useEffect(() => {
    if (!user?.uid) return;
    const q = query(collection(db, 'reports'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      const next: Report[] = snap.docs.map((d) => {
        const data: any = d.data() || {};
        const createdAt = data.createdAt;
        const createdAtDate = createdAt && typeof createdAt.toDate === 'function' ? createdAt.toDate() : null;
        const createdAtIso = createdAtDate ? createdAtDate.toISOString() : (typeof data.created_at === 'string' ? data.created_at : '');
        const timestamp = createdAtIso || (typeof data.created_at === 'string' ? data.created_at : new Date().toISOString());
        return {
          id: d.id,
          wildlifeType: String(data.wildlifeType || data.animal || ''),
          location: String(data.location || ''),
          description: String(data.description || ''),
          timestamp,
          imageUri: typeof data.imageUri === 'string' ? data.imageUri : undefined,
          lat: Number.isFinite(Number(data.lat)) ? Number(data.lat) : undefined,
          lon: Number.isFinite(Number(data.lon)) ? Number(data.lon) : undefined,
          userId: typeof data.userId === 'string' ? data.userId : undefined,
          userEmail: typeof data.userEmail === 'string' ? data.userEmail : undefined,
          ai: data.ai || undefined,
          createdAt: createdAt || undefined,
          created_at: typeof data.created_at === 'string' ? data.created_at : undefined,
        };
      });
      setReports(next);
      storage.setItem('reports', next);
    }, () => {
      setReports([]);
      storage.setItem('reports', []);
    });
    return () => unsub();
  }, [user?.uid]);

  // Auth state listener
  useEffect(() => {
    const unsubscribe = authService.subscribeToAuthChanges(async (firebaseUser) => {
      if (!firebaseUser) {
        setUser(null);
        setIsLoading(false);
        // Clear cached profile on logout
        storage.removeItem('user_profile');
        return;
      }

      try {
        // Try loading cached profile first for immediate responsiveness
        const cachedProfile = await storage.getItem<AppUser>('user_profile');
        if (cachedProfile && cachedProfile.uid === firebaseUser.uid) {
          setUser(cachedProfile);
          setShowOnboarding(cachedProfile.isNewUser ?? false);
        }

        // Load Firestore profile with timeout/error handling
        try {
          const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
          if (userDoc.exists()) {
            const userData = userDoc.data() as AppUser;
            setUser(userData);
            setShowOnboarding(userData.isNewUser ?? false);
            // Cache the successful profile
            storage.setItem('user_profile', userData);
          }
        } catch (firestoreError: any) {
          // If offline, we already set the user from cache if it existed
          if (firestoreError.code === 'unavailable' || firestoreError.message?.includes('offline')) {
            logger.warn('Firestore offline, using cached profile if available');
          } else {
            throw firestoreError;
          }
        }
      } catch (error) {
        logger.error('Failed to load user profile', error);
      } finally {
        setIsLoading(false);
      }
    });

    return unsubscribe;
  }, []);

  // Login user
  const login = useCallback(async (email: string, password: string): Promise<string | null> => {
    const { user: firebaseUser, error } = await authService.loginUser(email, password);
    if (error) return error;
    return null;
  }, []);

  // Sign up new user
  const signup = useCallback(async (name: string, email: string, password: string): Promise<string | null> => {
    const { user: firebaseUser, error } = await authService.registerUser(email, password, name);
    if (error) return error;
    return null;
  }, []);

  // Logout user
  const logout = useCallback(async () => {
    await authService.logoutUser();
  }, []);

  // Update user data
  const updateUser = useCallback(async (updatedUser: AppUser) => {
    try {
      setUser(updatedUser);
      if (updatedUser.uid) {
        await setDoc(doc(db, 'users', updatedUser.uid), {
          ...updatedUser
        }, { merge: true });
      }
    } catch (error) {
      logger.error('Update user error', error);
    }
  }, []);

  // Close onboarding
  const closeOnboarding = useCallback(async () => {
    if (user) {
      const updatedUser = { ...user, isNewUser: false };
      await updateUser(updatedUser);
    }
    setShowOnboarding(false);
  }, [user, updateUser]);

  // Add report
  const addReport = useCallback(async (report: Omit<Report, 'id' | 'timestamp'>) => {
    try {
      const uid = auth.currentUser?.uid || '';
      const email = auth.currentUser?.email || '';
      const newReport: Report = {
        ...report,
        id: Date.now(),
        timestamp: new Date().toISOString(),
        userId: uid || undefined,
        userEmail: email || undefined,
        isObservation: true,
        source: "user_report"
      };
      
      setReports((prev) => {
        const updatedReports = [newReport, ...prev];
        storage.setItem('reports', updatedReports);
        return updatedReports;
      });
      
      try {
        const data = {
          animal: (newReport as any).wildlifeType || (newReport as any).animal || '',
          lat: Number((newReport as any).lat),
          lon: Number((newReport as any).lon),
          description: String((newReport as any).description || ''),
          createdAt: serverTimestamp(),
          userId: uid,
          userEmail: email,
          wildlifeType: (newReport as any).wildlifeType || '',
          location: (newReport as any).location || '',
          imageUri: (newReport as any).imageUri || null,
          ai: (newReport as any).ai || null,
          created_at: newReport.timestamp,
          isObservation: true,
          source: "user_report"
        };
        await setDoc(doc(db, 'reports', String(newReport.id)), data, { merge: true });
      } catch (e) {
        logger.warn('Failed to write report to Firestore; continuing with local storage', e);
      }
    } catch (error) {
      logger.error('Add report error', error);
      throw error;
    }
  }, []);

  const removeReport = useCallback(async (reportId: string | number) => {
    const deletedId = String(reportId);
    setReports((prev) => {
      const next = prev.filter((r) => String(r.id) !== deletedId);
      storage.setItem('reports', next);
      return next;
    });
  }, []);

  const value: AppContextValue = {
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
    removeReport,
    initializeApp,
    ...animalData,
    visibleAnimals,
    setVisibleAnimals,
    showPredictions,
    setShowPredictions,
    showNearbyRadius,
    setShowNearbyRadius,
    showAnimalMarkers,
    setShowAnimalMarkers,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};
