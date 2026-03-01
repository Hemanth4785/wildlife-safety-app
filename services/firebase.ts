import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
// @ts-ignore: getReactNativePersistence is available in React Native but types might miss it in the wrapper
import { initializeAuth, browserLocalPersistence, getAuth, setPersistence, getReactNativePersistence, type Auth } from 'firebase/auth';
import { Platform } from 'react-native';
import ReactNativeAsyncStorage from '@react-native-async-storage/async-storage';

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
let auth: Auth;

if (Platform.OS === 'web') {
  auth = getAuth(app);
  setPersistence(auth, browserLocalPersistence).catch(() => {});
} else {
  auth = initializeAuth(app, {
    persistence: getReactNativePersistence(ReactNativeAsyncStorage)
  });
}

export { auth };
export const db = getFirestore(app);

console.log("Firebase Auth Persistence initialized");
console.log("Firestore Persistence enabled by default");

export default app;
