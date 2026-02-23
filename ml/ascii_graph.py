import os
import json
import math
from collections import Counter

# Configuration
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_PATH = os.path.abspath(os.path.join(BASE_DIR, "..", "backend", "python", "cache", "inat_historical.json"))

def haversine(lat1, lon1, lat2, lon2):
    R = 6371  # Earth radius in km
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) * math.sin(dlat / 2) +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(dlon / 2) * math.sin(dlon / 2))
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

def get_risk_label(distance_km):
    if distance_km < 2.0: return "High"
    elif 2.0 <= distance_km < 10.0: return "Medium"
    else: return "Low"

def print_ascii_bar_chart(data_dict, title, scale=50):
    print(f"\n--- {title} ---")
    if not data_dict:
        print("No data to display.")
        return

    # Filter out zero values if needed, or handle empty max
    values = list(data_dict.values())
    if not values or max(values) == 0:
        print("No non-zero data to display.")
        return

    max_val = max(values)
    labels = sorted(data_dict.keys())
    
    # Specific order for Risk if present
    if "High" in labels or "Low" in labels:
        labels = [l for l in ["High", "Medium", "Low"] if l in data_dict]

    for label in labels:
        value = data_dict[label]
        bar_len = int((value / max_val) * scale)
        bar = "█" * bar_len
        print(f"{label:15} | {bar} {value}")

def main():
    if not os.path.exists(DATA_PATH):
        print(f"Data file not found: {DATA_PATH}")
        return

    try:
        with open(DATA_PATH, "r", encoding="utf-8") as f:
            records = json.load(f)
    except Exception as e:
        print(f"Error reading data: {e}")
        return

    print(f"Loaded {len(records)} records.")

    # We need a reference point to calculate 'distance'. 
    lats = [r['lat'] for r in records if r.get('lat') is not None]
    lons = [r['lon'] for r in records if r.get('lon') is not None]
    
    if not lats:
        print("No valid coordinates found.")
        return

    center_lat = sum(lats) / len(lats)
    center_lon = sum(lons) / len(lons)
    
    # Calculate Risk Distribution based on distance to Center (Simulation of 'User')
    risk_counts = Counter()
    animal_counts = Counter()

    for r in records:
        if r.get('lat') is None or r.get('lon') is None: continue
        
        # Risk
        dist = haversine(r['lat'], r['lon'], center_lat, center_lon)
        risk = get_risk_label(dist)
        risk_counts[risk] += 1
        
        # Animal
        if 'animal' in r:
            animal_counts[r['animal']] += 1

    # 1. Risk Distribution
    print_ascii_bar_chart(risk_counts, "Risk Level Distribution (Relative to Dataset Center)")

    # 2. Top 10 Animals
    top_animals = dict(animal_counts.most_common(10))
    print_ascii_bar_chart(top_animals, "Top 10 Recorded Species")

if __name__ == "__main__":
    main()
