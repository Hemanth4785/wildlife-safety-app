
import { initializeApp } from 'firebase/app';
import { getFirestore, getDocs, collection } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyAnUXaLav6xcXVlOEaOyla3bA_HrUs5zc4", 
  authDomain: "wildlife-safety-d9769.firebaseapp.com", 
  projectId: "wildlife-safety-d9769", 
  storageBucket: "wildlife-safety-d9769.firebasestorage.app", 
  messagingSenderId: "596252120462", 
  appId: "1:596252120462:web:c9b1fb7e905625482b00df", 
  measurementId: "G-81E10RJRHF" 
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function testConnection() {
  try {
    console.log("Attempting to connect to Firestore...");
    // Try to access a collection, even if empty or non-existent, it should not throw a connection error
    // unless permissions deny it. We'll try a common one or just check if we can reach the service.
    const querySnapshot = await getDocs(collection(db, "animal_sightings")); 
    console.log("Connection successful!");
    console.log(`Found ${querySnapshot.size} documents in 'animal_sightings' collection.`);
    querySnapshot.forEach((doc) => {
      console.log(doc.id, " => ", doc.data().animal);
    });
  } catch (error) {
    console.error("Connection failed:", error.code, error.message);
    if (error.code === 'permission-denied') {
        console.log("Note: Permission denied implies connection WAS successful, but rules blocked access.");
    }
  }
}

testConnection();
