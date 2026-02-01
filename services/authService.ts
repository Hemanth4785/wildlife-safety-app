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

export const registerUser = async (email: string, password: string, name: string) => {
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // Create user profile in Firestore
    await setDoc(doc(db, 'users', user.uid), {
      name,
      email: user.email,
      created_at: serverTimestamp(),
      role: 'user',
      uid: user.uid,
      isNewUser: true,
      avatarId: 'tiger',
      nearbyRadiusKm: 5 // Default radius
    });

    return { user, error: null };
  } catch (error: any) {
    logger.error('Registration failed', error);
    return { user: null, error: error.message };
  }
};

export const loginUser = async (email: string, password: string) => {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // Ensure user document exists (in case of legacy users)
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (!userDoc.exists()) {
      await setDoc(doc(db, 'users', user.uid), {
        email: user.email,
        created_at: serverTimestamp(),
        role: 'user',
        uid: user.uid
      });
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
