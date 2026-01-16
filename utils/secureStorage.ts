/**
 * Secure storage utility for sensitive data
 * Uses expo-secure-store for encrypted storage on device
 */
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { logger } from './logger';

// Fallback to AsyncStorage for non-sensitive data
const SECURE_KEYS = ['user-password-hash', 'session-token', 'api-keys'];

/**
 * Simple password hashing using a combination approach
 * Note: For production, consider using a proper library like expo-crypto
 * or implementing bcrypt via a native module
 * This is a basic hash function suitable for demo purposes
 */
const simpleHash = (str: string): string => {
  // Add salt
  const salt = 'wildlife_safety_2024';
  const salted = str + salt;
  
  // Simple hash function
  let hash = 0;
  for (let i = 0; i < salted.length; i++) {
    const char = salted.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  
  // Convert to positive hex string
  return Math.abs(hash).toString(16).padStart(8, '0');
};

/**
 * Hash a password
 * In production, use a proper cryptographic library
 */
export const hashPassword = (password: string): string => {
  return simpleHash(password);
};

/**
 * Verify a password against a stored hash
 */
export const verifyPassword = (password: string, hash: string): boolean => {
  const passwordHash = hashPassword(password);
  return passwordHash === hash;
};

/**
 * Store a value securely
 */
export const secureSetItem = async (key: string, value: string): Promise<void> => {
  try {
    if (SECURE_KEYS.includes(key)) {
      await SecureStore.setItemAsync(key, value);
    } else {
      await AsyncStorage.setItem(key, value);
    }
  } catch (error) {
    logger.error(`Failed to store ${key}`, error);
    throw new Error(`Failed to store ${key}`);
  }
};

/**
 * Retrieve a value from secure storage
 */
export const secureGetItem = async (key: string): Promise<string | null> => {
  try {
    if (SECURE_KEYS.includes(key)) {
      return await SecureStore.getItemAsync(key);
    } else {
      return await AsyncStorage.getItem(key);
    }
  } catch (error) {
    logger.error(`Failed to retrieve ${key}`, error);
    return null;
  }
};

/**
 * Remove a value from secure storage
 */
export const secureRemoveItem = async (key: string): Promise<void> => {
  try {
    if (SECURE_KEYS.includes(key)) {
      await SecureStore.deleteItemAsync(key);
    } else {
      await AsyncStorage.removeItem(key);
    }
  } catch (error) {
    logger.warn(`Failed to remove ${key}`, error);
  }
};
