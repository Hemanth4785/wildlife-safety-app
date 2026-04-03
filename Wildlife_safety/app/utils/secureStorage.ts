// import * as SecureStore from 'expo-secure-store'; // DISABLED for now
import AsyncStorage from '@react-native-async-storage/async-storage';
import { logger } from './logger';

const NAMESPACE = 'ws_wildlifesafety';

const buildKey = (key: string): string => {
  if (!key || !key.trim()) {
    throw new Error('Storage key must be a non-empty string');
  }
  return `${NAMESPACE}_${key}`;
};

// Mock SecureStore availability since we are disabling it
const ensureSecureStoreAvailable = async (): Promise<void> => {
  return Promise.resolve();
};

export const setSecureItem = async (key: string, value: string): Promise<void> => {
  const namespacedKey = buildKey(key);
  try {
    // Fallback to AsyncStorage
    await AsyncStorage.setItem(namespacedKey, value);
  } catch (error) {
    logger.error('setSecureItem (fallback) failed', error);
    throw new Error('Storage operation failed');
  }
};

export const getSecureItem = async (key: string): Promise<string | null> => {
  const namespacedKey = buildKey(key);
  try {
    // Fallback to AsyncStorage
    return await AsyncStorage.getItem(namespacedKey);
  } catch (error) {
    logger.error('getSecureItem (fallback) failed', error);
    return null;
  }
};

export const removeSecureItem = async (key: string): Promise<void> => {
  const namespacedKey = buildKey(key);
  try {
    // Fallback to AsyncStorage
    await AsyncStorage.removeItem(namespacedKey);
  } catch (error) {
    logger.error('removeSecureItem (fallback) failed', error);
  }
};

export const setPlainItem = async (key: string, value: string): Promise<void> => {
  const namespacedKey = buildKey(key);
  try {
    await AsyncStorage.setItem(namespacedKey, value);
  } catch (error) {
    logger.error('setPlainItem failed', error);
    throw new Error('Storage operation failed');
  }
};

export const getPlainItem = async (key: string): Promise<string | null> => {
  const namespacedKey = buildKey(key);
  try {
    return await AsyncStorage.getItem(namespacedKey);
  } catch (error) {
    logger.error('getPlainItem failed', error);
    return null;
  }
};

export const removePlainItem = async (key: string): Promise<void> => {
  const namespacedKey = buildKey(key);
  try {
    await AsyncStorage.removeItem(namespacedKey);
  } catch (error) {
    logger.error('removePlainItem failed', error);
  }
};

export const secureSetItem = setSecureItem;
export const secureGetItem = getSecureItem;
export const secureRemoveItem = removeSecureItem;

export const hashPassword = (_password: string): string => {
  logger.error('hashPassword called on client; this is not supported');
  throw new Error('Client-side password hashing is not supported');
};

export const verifyPassword = (_password: string, _hash: string): boolean => {
  logger.error('verifyPassword called on client; this is not supported');
  throw new Error('Client-side password verification is not supported');
};
