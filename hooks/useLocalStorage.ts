import { useState, useEffect, useCallback } from 'react';
import { storage } from '../utils/storage';
import { logger } from '../utils/logger';

export const useLocalStorage = <T,>(key: string, initialValue: T): [T, (value: T | ((val: T) => T)) => void] => {
    const [storedValue, setStoredValue] = useState<T>(initialValue);
    const [isLoaded, setIsLoaded] = useState(false);

    useEffect(() => {
        const loadValue = async () => {
            try {
                const item = await storage.getItem<T>(key);
                if (item !== null) {
                    setStoredValue(item);
                }
            } catch (error) {
                logger.error(`Error loading ${key}`, error);
            } finally {
                setIsLoaded(true);
            }
        };
        loadValue();
    }, [key]);

    const setValue = useCallback((value: T | ((val: T) => T)) => {
        try {
            const valueToStore = value instanceof Function ? value(storedValue) : value;
            setStoredValue(valueToStore);
            storage.setItem(key, valueToStore);
        } catch (error) {
            logger.error(`Error setting ${key}`, error);
        }
    }, [key, storedValue]);
    
    return [storedValue, setValue];
};
