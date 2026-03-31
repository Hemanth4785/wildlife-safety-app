
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INPUT_FILE = path.join(__dirname, 'python', 'cache', 'inat_historical.json');
const OUTPUT_FILE = path.join(__dirname, 'inat_observations.xlsx');

/**
 * Flattens a nested object into a single-level object with dot-notation keys.
 * Handles arrays by joining them with a delimiter or JSON stringifying.
 */
function flattenObject(obj, prefix = '', res = {}) {
    for (const key in obj) {
        if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
        
        const val = obj[key];
        const newKey = prefix ? `${prefix}.${key}` : key;
        
        if (typeof val === 'object' && val !== null) {
            if (Array.isArray(val)) {
                // For arrays, convert to string representation
                // If it's an array of primitives, join them.
                // If objects, stringify.
                if (val.length === 0) {
                     res[newKey] = '';
                } else if (typeof val[0] === 'object') {
                     res[newKey] = JSON.stringify(val);
                } else {
                     res[newKey] = val.join(', ');
                }
            } else if (val instanceof Date) {
                 res[newKey] = val.toISOString();
            } else {
                 // Recursive flatten for objects
                 flattenObject(val, newKey, res);
            }
        } else {
            res[newKey] = val;
        }
    }
    return res;
}

/**
 * Normalizes event date from various possible fields.
 * Priority: time_observed_at > observed_on > eventDate (if object/string)
 * Adds `event_date` and `event_date_source` to the record.
 */
function normalizeEventDate(record) {
    let dateVal = null;
    let source = '';

    // 1. time_observed_at
    if (record.time_observed_at) {
        dateVal = record.time_observed_at;
        source = 'time_observed_at';
    }
    // 2. observed_on
    else if (record.observed_on) {
        dateVal = record.observed_on;
        source = 'observed_on';
    }
    // 3. eventDate (could be string or object)
    else if (record.eventDate) {
        if (typeof record.eventDate === 'object' && record.eventDate.start) {
            dateVal = record.eventDate.start;
            source = 'eventDate.start';
        } else if (typeof record.eventDate === 'string') {
            dateVal = record.eventDate;
            source = 'eventDate';
        }
    }

    // Validate and Format
    let isoDate = '';
    if (dateVal) {
        const d = new Date(dateVal);
        if (!isNaN(d.getTime())) {
            isoDate = d.toISOString();
        }
    }

    record.event_date = isoDate;
    record.event_date_source = source || 'none';
}

/**
 * Validates a record based on Firestore constraints (but for reporting).
 * Returns { valid: boolean, reason: string | null }
 */
function validateRecord(record) {
    const reasons = [];

    // 1. Lat/Lon Validation
    const lat = Number(record.lat);
    const lon = Number(record.lon);
    
    if (isNaN(lat) || lat < -90 || lat > 90) {
        reasons.push(`Invalid Latitude: ${record.lat}`);
    }
    if (isNaN(lon) || lon < -180 || lon > 180) {
        reasons.push(`Invalid Longitude: ${record.lon}`);
    }

    // 2. ID Validation
    if (!record.id && !record.scientific_name) {
        reasons.push("Missing ID and Scientific Name");
    }

    if (reasons.length > 0) {
        return { valid: false, reason: reasons.join('; ') };
    }
    return { valid: true, reason: null };
}

/**
 * Sanitizes values for Excel (undefined -> '', NaN -> '', Date -> ISO)
 */
function sanitizeForExcel(flatRecord) {
    const clean = {};
    for (const [key, val] of Object.entries(flatRecord)) {
        if (val === undefined || val === null) {
            clean[key] = '';
        } else if (typeof val === 'number') {
            if (isNaN(val) || !isFinite(val)) {
                clean[key] = '';
            } else {
                clean[key] = val;
            }
        } else if (val instanceof Date) {
            clean[key] = val.toISOString();
        } else {
            clean[key] = String(val); // Force string for safety
        }
    }
    return clean;
}

async function exportToExcel() {
    console.log("Starting Export to Excel...");
    
    if (!fs.existsSync(INPUT_FILE)) {
        console.error(`Input file not found: ${INPUT_FILE}`);
        return;
    }

    const rawData = fs.readFileSync(INPUT_FILE, 'utf-8');
    let records = [];
    try {
        records = JSON.parse(rawData);
    } catch (e) {
        console.error("JSON Parse Error:", e.message);
        return;
    }

    console.log(`Loaded ${records.length} records.`);

    const validRows = [];
    const invalidRows = [];

    for (const record of records) {
        // Normalize Date First
        normalizeEventDate(record);

        const validation = validateRecord(record);
        
        // Flatten and Sanitize
        const flat = flattenObject(record);
        const clean = sanitizeForExcel(flat);

        if (validation.valid) {
            validRows.push(clean);
        } else {
            // Add error reason to the invalid row
            clean['EXPORT_ERROR'] = validation.reason;
            invalidRows.push(clean);
        }
    }

    console.log(`Processing complete:`);
    console.log(`- Valid Records: ${validRows.length}`);
    console.log(`- Invalid Records: ${invalidRows.length}`);

    // Create Workbook
    const wb = XLSX.utils.book_new();

    // 1. Valid Sheet
    if (validRows.length > 0) {
        const wsValid = XLSX.utils.json_to_sheet(validRows);
        // Auto-width (basic approximation)
        const colWidths = Object.keys(validRows[0] || {}).map(k => ({ wch: k.length + 5 }));
        wsValid['!cols'] = colWidths;
        XLSX.utils.book_append_sheet(wb, wsValid, "Valid Observations");
    }

    // 2. Invalid Sheet
    if (invalidRows.length > 0) {
        const wsInvalid = XLSX.utils.json_to_sheet(invalidRows);
        const colWidthsInv = Object.keys(invalidRows[0] || {}).map(k => ({ wch: k.length + 5 }));
        wsInvalid['!cols'] = colWidthsInv;
        XLSX.utils.book_append_sheet(wb, wsInvalid, "Invalid Records");
    }

    // Write File
    XLSX.writeFile(wb, OUTPUT_FILE);
    console.log(`\nSuccess! Excel file saved to:`);
    console.log(OUTPUT_FILE);
}

exportToExcel().catch(console.error);
