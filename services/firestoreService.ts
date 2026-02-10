 import { db } from './firebase';
import { 
  collection, 
  query, 
  orderBy, 
  limit, 
  getDocs,
  Timestamp,
  doc,
  setDoc
} from 'firebase/firestore';
import { ANIMALS } from '../constants';

export interface FirestoreSighting {
  id: string;
  animal: string;
  generated_at: Timestamp;
  model: string;
  predicted_path: {
    lat: number;
    lon: number;
    address: string;
  }[];
  risk: string;
}

/**
 * Fetches the latest animal sightings from Firestore.
 * Results are ordered by 'generated_at' descending.
 */
export const fetchLatestSightings = async (limitCount: number = 10): Promise<FirestoreSighting[]> => {
  try {
    const sightingsRef = collection(db, 'animal_sightings');
    const q = query(
      sightingsRef, 
      orderBy('generated_at', 'desc'), 
      limit(limitCount)
    );
    
    const querySnapshot = await getDocs(q);
    const sightings: FirestoreSighting[] = [];
    
    querySnapshot.forEach((doc) => {
      sightings.push({
        id: doc.id,
        ...doc.data()
      } as FirestoreSighting);
    });
    
    return sightings;
  } catch (error) {
    console.error('[FirestoreService] Error fetching sightings:', error);
    return [];
  }
};

export default db;

export const syncAnimalsFromConstants = async (): Promise<void> => {
  try {
    const entries = Object.entries(ANIMALS);
    for (const [scientific, info] of entries) {
      const payload = {
        scientific,
        common: info.common,
        emoji: info.emoji,
        color: info.color,
        image_url: null,
        updated_at: new Date().toISOString()
      };
      await setDoc(doc(db, 'animals', scientific), payload, { merge: true });
    }
  } catch (error) {
    console.error('[FirestoreService] Failed syncing animals:', error);
  }
};
