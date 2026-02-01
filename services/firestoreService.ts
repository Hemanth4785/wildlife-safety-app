import { db } from './firebase';
import { 
  collection, 
  query, 
  orderBy, 
  limit, 
  getDocs,
  Timestamp 
} from 'firebase/firestore';

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
