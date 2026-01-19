/**
 * Centralized application state management
 * Reduces prop drilling and provides clean data flow
 */
import React, { createContext, useContext, useCallback, useState, useEffect, ReactNode } from 'react';
import { User, Report } from '../types';
import { storage } from '../utils/storage';
import { secureSetItem, secureRemoveItem } from '../utils/secureStorage';
import { logger } from '../utils/logger';
import { NEARBY_KM } from '../constants';

interface AppState {
  user: User | null;
  reports: Report[];
  isLoading: boolean;
  showOnboarding: boolean;
}

interface AppContextValue extends AppState {
  // User actions
  login: (email: string, password: string) => Promise<string | null>;
  signup: (name: string, email: string, password: string) => Promise<string | null>;
  logout: () => Promise<void>;
  updateUser: (user: User) => Promise<void>;
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
  const [user, setUser] = useState<User | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);

  // Initialize app data
  const initializeApp = useCallback(async () => {
    try {
      setIsLoading(true);

      // Load saved session
      const savedSession = await storage.getItem<User>('wildlife-app-session');
      if (savedSession) {
        const loadedUser = savedSession;
        if (typeof loadedUser.nearbyRadiusKm === 'undefined') {
          loadedUser.nearbyRadiusKm = NEARBY_KM;
        }
        setUser(loadedUser);
        if (loadedUser.isNewUser) {
          setShowOnboarding(true);
        }
      }

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

  // Login user
  const login = useCallback(async (email: string, password: string): Promise<string | null> => {
    try {
      const normalizedEmail = email.toLowerCase();
      const userData = await storage.getItem<User>(`user-${normalizedEmail}`);
      if (!userData) {
        return 'Could not find user data. Please sign up again.';
      }

      if (typeof userData.nearbyRadiusKm === 'undefined') {
        userData.nearbyRadiusKm = NEARBY_KM;
      }

      setUser(userData);
      await storage.setItem('wildlife-app-session', userData);
      await secureSetItem('session-user', normalizedEmail);
      
      if (userData.isNewUser) {
        setShowOnboarding(true);
      }

      return null;
    } catch (error) {
      logger.error('Login error', error);
      return 'An error occurred during login. Please try again.';
    }
  }, []);

  // Sign up new user
  const signup = useCallback(async (name: string, email: string, password: string): Promise<string | null> => {
    try {
      const normalizedEmail = email.toLowerCase();

      const existingUser = await storage.getItem<User>(`user-${normalizedEmail}`);
      if (existingUser) {
        return 'An account with this email already exists.';
      }

      const newUser: User = {
        name,
        email: normalizedEmail,
        avatarId: 'tiger',
        nearbyRadiusKm: NEARBY_KM,
        isNewUser: true,
      };

      await storage.setItem(`user-${normalizedEmail}`, newUser);

      // Set as current user
      setUser(newUser);
      await storage.setItem('wildlife-app-session', newUser);
      await secureSetItem('session-user', normalizedEmail);
      setShowOnboarding(true);

      return null;
    } catch (error) {
      logger.error('Signup error', error);
      return 'An error occurred during signup. Please try again.';
    }
  }, []);

  // Logout user
  const logout = useCallback(async () => {
    try {
      setUser(null);
      await storage.removeItem('wildlife-app-session');
       await secureRemoveItem('session-user');
    } catch (error) {
      logger.error('Logout error', error);
    }
  }, []);

  // Update user data
  const updateUser = useCallback(async (updatedUser: User) => {
    try {
      setUser(updatedUser);
      await storage.setItem('wildlife-app-session', updatedUser);
      await storage.setItem(`user-${updatedUser.email.toLowerCase()}`, updatedUser);
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
    closeOnboarding,
    addReport,
    initializeApp,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};
