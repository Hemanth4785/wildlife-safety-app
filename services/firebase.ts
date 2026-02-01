import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { initializeAuth, getReactNativePersistence, browserLocalPersistence, getAuth, setPersistence, type Auth } from 'firebase/auth';
import ReactNativeAsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

/**
 * Firebase configuration for Wildlife Safety project.
 * Updated with user-provided credentials.
 */
const firebaseConfig = {
  apiKey: "AIzaSyAnUXaLav6xcXVlOEaOyla3bA_HrUs5zc4", 
  authDomain: "wildlife-safety-d9769.firebaseapp.com", 
  projectId: "wildlife-safety-d9769", 
  storageBucket: "wildlife-safety-d9769.firebasestorage.app", 
  messagingSenderId: "596252120462", 
  appId: "1:596252120462:web:c9b1fb7e905625482b00df", 
  measurementId: "G-81E10RJRHF" 
};

// Initialize Firebase once
const app = initializeApp(firebaseConfig);

// Initialize Auth with platform-specific persistence
const auth: Auth =
  Platform.OS === 'web'
    ? getAuth(app)
    : initializeAuth(app, {
        persistence: getReactNativePersistence(ReactNativeAsyncStorage),
      });

if (Platform.OS === 'web') {
  setPersistence(auth, browserLocalPersistence).catch(() => {});
}

export { auth };
export const db = getFirestore(app);

export default app;
