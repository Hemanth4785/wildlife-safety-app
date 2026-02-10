
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc, writeBatch, Timestamp } from 'firebase/firestore';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID,
    measurementId: process.env.FIREBASE_MEASUREMENT_ID
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, 'python', 'cache', 'inat_historical.json');

/**
 * STRICT Sanitizer for Firestore
 * - Removes keys with dots or empty names
 * - Converts nested arrays of arrays (e.g. paths) to strings to avoid "nested arrays not supported"
 * - Converts NaN/Infinity to null
 * - Removes undefined
 */
function deepSanitizeForFirestore(value, path = 'root') {
    if (value === undefined) return undefined;
    if (value === null) return null;

    if (typeof value === 'number') {
        if (Number.isNaN(value) || !Number.isFinite(value)) {
            console.warn(`[Sanitizer] Removed invalid number at ${path}: ${value}`);
            return null;
        }
        return value;
    }

    if (typeof value === 'string') {
        return value;
    }

    if (value instanceof Date) {
        return isNaN(value.getTime()) ? null : value.toISOString();
    }

    if (Array.isArray(value)) {
        // Firestore doesn't support nested arrays directly (arrays of arrays).
        // Check if this array contains other arrays
        const hasNestedArray = value.some(v => Array.isArray(v));
        if (hasNestedArray) {
            // Convert to JSON string to preserve data without crashing
            try {
                return JSON.stringify(value);
            } catch (e) {
                return null;
            }
        }

        return value
            .map((item, index) => deepSanitizeForFirestore(item, `${path}[${index}]`))
            .filter(item => item !== undefined);
    }

    if (typeof value === 'object') {
        const newObj = {};
        for (const [key, val] of Object.entries(value)) {
            // Sanitize Key
            let cleanKey = key.trim();
            if (cleanKey.includes('.')) {
                cleanKey = cleanKey.replace(/\./g, '_');
            }
            if (!cleanKey) continue;
            
            // Sanitize Value
            const sanitizedVal = deepSanitizeForFirestore(val, `${path}.${cleanKey}`);
            if (sanitizedVal !== undefined) {
                newObj[cleanKey] = sanitizedVal;
            }
        }
        return newObj;
    }

    return value;
}

/**
 * Normalizes event date from various possible fields.
 * Priority: time_observed_at > observed_on > eventDate (if object/string)
 */
function normalizeEventDate(record) {
    let dateVal = null;

    // 1. time_observed_at (Preferred for precision)
    if (record.time_observed_at) {
        dateVal = record.time_observed_at;
    }
    // 2. observed_on
    else if (record.observed_on) {
        dateVal = record.observed_on;
    }
    // 3. eventDate (could be string or object)
    else if (record.eventDate) {
        if (typeof record.eventDate === 'object' && record.eventDate.start) {
            dateVal = record.eventDate.start;
        } else if (typeof record.eventDate === 'string') {
            dateVal = record.eventDate;
        }
    }

    // Validate and Format
    if (dateVal) {
        const d = new Date(dateVal);
        if (!isNaN(d.getTime())) {
            return d.toISOString();
        }
    }
    return null;
}

/**
 * Validate Wildlife Record
 * Returns the sanitized record or null if invalid.
 */
function validateAndSanitizeRecord(record) {
    // 1. Deep Sanitize first
    const cleanRecord = deepSanitizeForFirestore(record, `Record(${record.id || 'unknown'})`);
    if (!cleanRecord) return null;

    // 2. Validate Critical Fields (Lat/Lon)
    // Convert to number explicitly to be safe, though sanitizer handles numbers
    const lat = Number(cleanRecord.lat);
    const lon = Number(cleanRecord.lon);
    
    // Strict Geo Validation
    if (isNaN(lat) || lat < -90 || lat > 90) {
        console.warn(`[Skipping] Invalid Latitude: ${lat} (ID: ${cleanRecord.id})`);
        return null;
    }
    if (isNaN(lon) || lon < -180 || lon > 180) {
        console.warn(`[Skipping] Invalid Longitude: ${lon} (ID: ${cleanRecord.id})`);
        return null;
    }

    // 3. Date Handling
    const eventDateIso = normalizeEventDate(cleanRecord);

    if (!eventDateIso) {
        console.warn(`[Skipping] Invalid/Missing Date (ID: ${cleanRecord.id})`);
        return null; 
    }

    // 4. ID Validation
    let docId = cleanRecord.id ? String(cleanRecord.id) : `${cleanRecord.scientific_name}_${lat}_${lon}_${eventDateIso}`;
    docId = docId.replace(/\//g, '_').trim(); 
    
    if (!docId || docId.length > 1024) {
        console.warn(`[Skipping] Invalid ID: ${docId}`);
        return null;
    }

    // Construct final record
    return {
        docId,
        data: {
            ...cleanRecord,
            lat, 
            lon,
            generated_at: eventDateIso,
            synced_at: new Date().toISOString(),
            is_historical: true
        }
    };
}

async function uploadData() {
    if (!fs.existsSync(DATA_FILE)) {
        console.error(`File not found: ${DATA_FILE}`);
        console.error("Please run the python script first: python python/fetch_inat_historical.py");
        return;
    }

    const rawData = fs.readFileSync(DATA_FILE, 'utf-8');
    let records;
    try {
        records = JSON.parse(rawData);
    } catch (e) {
        console.error("Failed to parse JSON file:", e.message);
        return;
    }

    console.log(`Loaded ${records.length} records. Starting validation and upload...`);

    const BATCH_SIZE = 400;
    let batch = writeBatch(db);
    let count = 0;
    let totalUploaded = 0;
    let skippedCount = 0;

    for (const rawRecord of records) {
        const result = validateAndSanitizeRecord(rawRecord);
        
        if (!result) {
            skippedCount++;
            continue;
        }

        const { docId, data } = result;
        const docRef = doc(db, 'animal_sightings', docId);

        try {
            batch.set(docRef, data, { merge: true });
            count++;
        } catch (e) {
            console.error(`[Error] Failed to add to batch (ID: ${docId}):`, e.message);
            skippedCount++;
        }

        if (count >= BATCH_SIZE) {
            try {
                await batch.commit();
                totalUploaded += count;
                console.log(`Uploaded ${totalUploaded} records...`);
                batch = writeBatch(db);
                count = 0;
            } catch (e) {
                console.error("[Batch Error] Commit failed. This batch might contain invalid data not caught by sanitizer.", e.message);
                // Reset batch to avoid stuck loop if we want to continue
                batch = writeBatch(db);
                count = 0;
            }
        }
    }

    if (count > 0) {
        try {
            await batch.commit();
            totalUploaded += count;
        } catch (e) {
             console.error("[Batch Error] Final commit failed:", e.message);
        }
    }

    console.log(`\nProcess Complete!`);
    console.log(`- Uploaded: ${totalUploaded}`);
    console.log(`- Skipped: ${skippedCount}`);
}

uploadData().catch(console.error);
