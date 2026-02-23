import os
import json
import pandas as pd
import numpy as np
from datetime import timedelta

# Configuration
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_CACHE_PATH = os.path.abspath(os.path.join(BASE_DIR, "..", "backend", "python", "cache", "inat_historical.json"))
AUGMENTED_DATA_PATH = os.path.abspath(os.path.join(BASE_DIR, "..", "backend", "python", "cache", "inat_augmented.json"))

def haversine(lat1, lon1, lat2, lon2):
    R = 6371  # Earth radius in km
    dlat = np.radians(lat2 - lat1)
    dlon = np.radians(lon2 - lon1)
    a = np.sin(dlat/2)**2 + np.cos(np.radians(lat1)) * np.cos(np.radians(lat2)) * np.sin(dlon/2)**2
    c = 2 * np.arctan2(np.sqrt(a), np.sqrt(1-a))
    return R * c

def interpolate_points(p1, p2, num_points):
    """Linearly interpolate between two lat/lon points."""
    lats = np.linspace(p1[0], p2[0], num_points + 2)
    lons = np.linspace(p1[1], p2[1], num_points + 2)
    times = pd.date_range(start=p1[2], end=p2[2], periods=num_points + 2)
    # Return intermediate points (exclude start and end to avoid duplication)
    return list(zip(lats[1:-1], lons[1:-1], times[1:-1]))

def augment_data():
    if not os.path.exists(DATA_CACHE_PATH):
        print(f"Data file not found at {DATA_CACHE_PATH}")
        return

    print("Loading original data...")
    with open(DATA_CACHE_PATH, "r", encoding="utf-8") as f:
        records = json.load(f)

    if not records:
        print("No records found.")
        return

    # Convert to DataFrame
    df = pd.DataFrame(records)
    df['eventDate'] = pd.to_datetime(df['eventDate'], utc=True)
    df = df.dropna(subset=['lat', 'lon', 'eventDate', 'animal'])
    df = df.sort_values(['animal', 'eventDate'])

    augmented_records = []
    
    print(f"Processing {len(df)} records for augmentation...")
    
    # Group by animal to interpolate only within the same individual/species sequence
    for animal, group in df.groupby('animal'):
        group = group.reset_index(drop=True)
        # Add original points first
        for _, row in group.iterrows():
            augmented_records.append(row.to_dict())
            
        # Interpolate between consecutive points
        for i in range(len(group) - 1):
            curr = group.iloc[i]
            next_p = group.iloc[i+1]
            
            # Calculate gaps
            time_diff = (next_p['eventDate'] - curr['eventDate']).total_seconds() / 3600.0 # Hours
            dist_km = haversine(curr['lat'], curr['lon'], next_p['lat'], next_p['lon'])
            
            # Interpolation Rules:
            # 1. Gap must be "bridgeable" (e.g., < 48 hours)
            # 2. Distance must be reasonable (e.g., < 50 km)
            # 3. We want points roughly every 1 hour or 1 km
            
            if 0.5 < time_diff < 48 and dist_km < 50:
                # Determine number of points to insert
                # E.g., if gap is 5 hours, insert 4 points (1 per hour)
                num_points = int(time_diff) 
                
                if num_points > 0:
                    p1 = (curr['lat'], curr['lon'], curr['eventDate'])
                    p2 = (next_p['lat'], next_p['lon'], next_p['eventDate'])
                    
                    new_points = interpolate_points(p1, p2, num_points)
                    
                    for lat, lon, dt in new_points:
                        new_record = curr.to_dict().copy()
                        new_record['lat'] = lat
                        new_record['lon'] = lon
                        new_record['eventDate'] = dt.isoformat()
                        new_record['is_augmented'] = True # Flag as synthetic
                        augmented_records.append(new_record)

    # Convert timestamps back to string for JSON serialization
    # (Original records might have Timestamp objects now if we didn't copy carefully, 
    # but to_dict() usually keeps them. We ensure consistent string format.)
    final_output = []
    for r in augmented_records:
        if isinstance(r.get('eventDate'), (pd.Timestamp, datetime)):
            r['eventDate'] = r['eventDate'].isoformat()
        final_output.append(r)

    print(f"Augmentation Complete.")
    print(f"Original Records: {len(df)}")
    print(f"Total Records (Original + Augmented): {len(final_output)}")
    
    # Save Augmented Data
    with open(AUGMENTED_DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(final_output, f, indent=2)
    
    print(f"Saved augmented data to {AUGMENTED_DATA_PATH}")

if __name__ == "__main__":
    from datetime import datetime
    augment_data()
