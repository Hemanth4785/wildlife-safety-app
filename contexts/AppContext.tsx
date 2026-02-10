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
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { auth } from '../services/firebase';

interface AppState {
  user: AppUser | null;
  reports: Report[];
  isLoading: boolean;
  showOnboarding: boolean;
}

interface AppContextValue extends AppState {
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

  // Auth state listener
  useEffect(() => {
    const unsubscribe = authService.subscribeToAuthChanges(async (firebaseUser) => {
      if (!firebaseUser) {
        setUser(null);
        setIsLoading(false);
        return;
      }

      try {
        // Load Firestore profile
        const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
        if (userDoc.exists()) {
          setUser(userDoc.data() as AppUser);
          setShowOnboarding(userDoc.data().isNewUser ?? false);
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
      const newReport: Report = {
        ...report,
        id: Date.now(),
        timestamp: new Date().toISOString(),
      };
      
      const updatedReports = [newReport, ...reports];
      setReports(updatedReports);
      await storage.setItem('reports', updatedReports);
      
      try {
        const uid = auth.currentUser?.uid;
        const data = {
          ...newReport,
          userId: uid || null,
          created_at: new Date().toISOString()
        };
        await setDoc(doc(db, 'reports', String(newReport.id)), data, { merge: true });
      } catch (e) {
        logger.warn('Failed to write report to Firestore; continuing with local storage', e);
      }
    } catch (error) {
      logger.error('Add report error', error);
      throw error;
    }
  }, [reports]);

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
    initializeApp,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};
