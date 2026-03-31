import { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  signOut,
  onAuthStateChanged,
  User
} from 'firebase/auth';
import { 
  doc, 
  setDoc, 
  getDoc,
  serverTimestamp 
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { logger } from '../utils/logger';

/**
 * ACADEMIC JUSTIFICATION:
 * Identity management is a critical layer for human-life critical systems.
 * By using Firebase Auth UID, we ensure that movement predictions and 
 * risk data are only accessible to verified identities, preventing 
 * unauthorized misuse of sensitive wildlife location data.
 */

/**
 * Helper to perform Auth actions with retry for network errors
 */
const withRetry = async <T>(action: () => Promise<T>, retries = 2, delay = 2000): Promise<T> => {
  try {
    return await action();
  } catch (error: any) {
    const isNetworkError = error.code === 'auth/network-request-failed' || 
                           error.message?.toLowerCase().includes('network request failed');
    
    if (isNetworkError && retries > 0) {
      logger.warn(`Auth network failure. Retrying in ${delay}ms... (${retries} left)`, error);
      await new Promise(resolve => setTimeout(resolve, delay));
      return withRetry(action, retries - 1, delay * 2);
    }
    throw error;
  }
};

export const registerUser = async (email: string, password: string, name: string) => {
  try {
    const userCredential = await withRetry(() => createUserWithEmailAndPassword(auth, email, password));
    const user = userCredential.user;

    // Create user profile in Firestore
    await withRetry(() => setDoc(doc(db, 'users', user.uid), {
      name,
      email: user.email,
      created_at: serverTimestamp(),
      role: 'user',
      uid: user.uid,
      isNewUser: true,
      avatarId: 'tiger',
      nearbyRadiusKm: 5 // Default radius
    }));

    return { user, error: null };
  } catch (error: any) {
    logger.error('Registration failed', error);
    return { user: null, error: error.message };
  }
};

export const loginUser = async (email: string, password: string) => {
  try {
    const userCredential = await withRetry(() => signInWithEmailAndPassword(auth, email, password));
    const user = userCredential.user;

    // Ensure user document exists (in case of legacy users)
    const userDoc = await withRetry(() => getDoc(doc(db, 'users', user.uid)));
    if (!userDoc.exists()) {
      await withRetry(() => setDoc(doc(db, 'users', user.uid), {
        email: user.email,
        created_at: serverTimestamp(),
        role: 'user',
        uid: user.uid
      }));
    }

    return { user, error: null };
  } catch (error: any) {
    logger.error('Login failed', error);
    return { user: null, error: error.message };
  }
};

export const logoutUser = async () => {
  try {
    await signOut(auth);
    return { error: null };
  } catch (error: any) {
    logger.error('Logout failed', error);
    return { error: error.message };
  }
};

export const subscribeToAuthChanges = (callback: (user: User | null) => void) => {
  return onAuthStateChanged(auth, callback);
};
