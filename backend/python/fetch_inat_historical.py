
import json
import os
import time
from datetime import datetime, timedelta, timezone
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

# ---------------- CONFIGURATION ---------------- #

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.abspath(os.path.join(BASE_DIR, "cache"))
OUTPUT_FILE = os.path.abspath(os.path.join(CACHE_DIR, "inat_historical.json"))
INAT_API_URL = "https://api.inaturalist.org/v1/observations"

# User-Agent is required by iNaturalist API
HEADERS = {
    "User-Agent": "WildlifeSafetyApp/1.0 (edu-project; contact@example.com)",
    "Accept": "application/json"
}

# Species Configuration
SPECIES = {
    "43697": {"name": "Asian Elephant", "scientific": "Elephas maximus", "emoji": "🐘"},
    "41967": {"name": "Tiger", "scientific": "Panthera tigris", "emoji": "🐅"},
    "42057": {"name": "Leopard", "scientific": "Panthera pardus", "emoji": "🐆"},
    "74111": {"name": "Gaur", "scientific": "Bos gaurus", "emoji": "🦬"},
    "41651": {"name": "Sloth Bear", "scientific": "Melursus ursinus", "emoji": "🐻"},
}

# Geographic Center (Western Ghats, South India)
CENTER = {
    "lat": 12.5,
    "lng": 76.5,
    "radius": 500, # km
}

# ---------------- HELPERS ---------------- #

def get_session():
    session = requests.Session()
    retry = Retry(
        total=5,
        backoff_factor=1,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["GET"]
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session

def fetch_all_data(start_date_str):
    session = get_session()
    all_records = []
    
    start_date = datetime.strptime(start_date_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    end_date = datetime.now(timezone.utc)
    
    # Iterate by month to be polite and manage result sizes
    current_start = start_date
    window_days = 30
    
    print(f"Starting historical fetch from {start_date_str} to {end_date.strftime('%Y-%m-%d')}")
    
    for taxon_id, info in SPECIES.items():
        print(f"\nFetching {info['name']} ({taxon_id})...")
        species_records = []
        
        curr = current_start
        while curr < end_date:
            next_window = curr + timedelta(days=window_days)
            if next_window > end_date:
                next_window = end_date
            
            d1 = curr.strftime("%Y-%m-%d")
            d2 = next_window.strftime("%Y-%m-%d")
            
            # print(f"  Range: {d1} to {d2}")
            
            page = 1
            while True:
                params = {
                    "taxon_id": taxon_id,
                    "d1": d1,
                    "d2": d2,
                    "per_page": 200,
                    "order_by": "observed_on",
                    "order": "asc",
                    "include_subtaxa": "true",
                    "page": page,
                    "lat": CENTER["lat"],
                    "lng": CENTER["lng"],
                    "radius": CENTER["radius"]
                }
                
                try:
                    resp = session.get(INAT_API_URL, params=params, headers=HEADERS, timeout=30)
                    resp.raise_for_status()
                    data = resp.json()
                    results = data.get("results", [])
                    
                    if not results:
                        break
                        
                    for obs in results:
                        location = obs.get("location")
                        if not location:
                            continue
                        try:
                            lat, lon = map(float, location.split(","))
                        except ValueError:
                            continue

                        # Basic fields
                        record = {
                            "id": obs.get("id"),
                            "animal": info["name"],
                            "scientific_name": info["scientific"],
                            "emoji": info["emoji"],
                            "lat": lat,
                            "lon": lon,
                            "eventDate": obs.get("observed_on") or obs.get("time_observed_at") or d1,
                            "image_url": obs.get("photos", [{}])[0].get("url", "").replace("square", "medium") if obs.get("photos") else None,
                            "src": "inat_hist"
                        }
                        species_records.append(record)
                        
                    # Pagination check
                    total_results = data.get("total_results", 0)
                    if page * 200 >= total_results:
                        break
                    
                    page += 1
                    time.sleep(0.5) # Politeness
                    
                except Exception as e:
                    print(f"    Error fetching {d1}-{d2} page {page}: {e}")
                    time.sleep(5)
                    break
            
            curr = next_window + timedelta(days=1) # Move to next day
            print(f"  > {len(species_records)} records so far...")
            
        all_records.extend(species_records)
        print(f"Finished {info['name']}: {len(species_records)} total records.")

    return all_records

if __name__ == "__main__":
    import sys
    start_date = sys.argv[1] if len(sys.argv) > 1 else "2021-01-01"
    records = fetch_all_data(start_date)
    
    os.makedirs(CACHE_DIR, exist_ok=True)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(records, f, indent=2)
    
    print(f"\nSaved {len(records)} historical records to {OUTPUT_FILE}")
