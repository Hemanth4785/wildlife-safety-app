"""
iNaturalist Observation API fetcher.
Fetches wildlife observations for the Wildlife Safety App using an adaptive geographic and temporal strategy.

Adaptive Strategy Rationale:
Wildlife observations for large mammals are sparse and often geo-obscured for conservation.
A strict geographic filter often results in zero data. This script uses a two-stage fallback:
1. Regional Stage: Search within South India (Western Ghats). Strict geographic filtering 
   (has[]=geo) is applied to ensure mapping accuracy for recent local activity.
2. Global Fallback: If no regional data exists, the search expands globally. 
   Critically, 'has[]=geo' is RELAXED here. This ensures that geo-obscured observations 
   (common for endangered species like Elephants) are captured, matching website results.

Taxonomic Note: 
'include_subtaxa=true' is mandatory. Many observations are identified at the subspecies 
level (e.g., Indian Elephant). Without this flag, species-level queries return empty.
"""

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
OUTPUT_FILE = os.path.abspath(os.path.join(CACHE_DIR, "inat_live.json"))
INAT_API_URL = "https://api.inaturalist.org/v1/observations"

# User-Agent is required by iNaturalist API
HEADERS = {
    "User-Agent": "WildlifeSafetyApp/1.0 (edu-project; contact@example.com)",
    "Accept": "application/json"
}

# Species Configuration (Validated iNaturalist Taxon IDs)
# Note: IDs corrected to species-level to ensure API compatibility and matching website behavior.
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
    """
    Creates a requests Session with exponential backoff retry logic.
    Retries on common network/server errors (500, 502, 503, 504).
    """
    session = requests.Session()
    retry = Retry(
        total=3,
        backoff_factor=1,
        status_forcelist=[500, 502, 503, 504],
        allowed_methods=["GET"]
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session

def calculate_confidence(grade, scope):
    """
    Determines the confidence level based on quality grade and geographic scope.
    """
    if grade == "research" and scope == "regional":
        return "high"
    if grade == "research" or scope == "regional":
        return "medium"
    return "low"

def fetch_inat_data():
    all_records = []
    session = get_session()
    
    # Adaptive Temporal Window: Rolling 180-day window
    now_utc = datetime.now(timezone.utc)
    d1 = (now_utc - timedelta(days=180)).strftime('%Y-%m-%d')
    d2 = now_utc.strftime('%Y-%m-%d')
    
    print(f"Fetch Window (180 days): {d1} to {d2}")

    for taxon_id_str, info in SPECIES.items():
        common_name = info["name"]
        print(f"Processing {common_name} (Taxon ID: {taxon_id_str})...")
        
        species_results = []
        final_scope = "regional"
        final_grade = "none"

        def try_fetch(scope, grade):
            # include_subtaxa=true is required to capture subspecies in species-level queries
            params = {
                "taxon_id": int(taxon_id_str),
                "d1": d1,
                "d2": d2,
                "per_page": 50, # Reduced to avoid silent throttling
                "order_by": "observed_on",
                "order": "desc",
                "include_subtaxa": "true"
            }
            
            # Geographic filters and has[]=geo applied ONLY in regional stage
            if scope == "regional":
                params.update({
                    "has[]": "geo",
                    "lat": CENTER["lat"],
                    "lng": CENTER["lng"],
                    "radius": CENTER["radius"]
                })
            
            if grade != "any":
                params["quality_grade"] = grade

            try:
                response = session.get(INAT_API_URL, params=params, headers=HEADERS, timeout=30)
                response.raise_for_status()
                return response.json().get("results", [])
            except Exception as e:
                # Log error but continue to allow fallback logic to proceed
                print(f"  [Error] Fetch failed ({scope}/{grade}): {e}")
                return []

        # Two-stage adaptive strategy: Regional -> Global Fallback
        for current_scope in ["regional", "global"]:
            for current_grade in ["research", "needs_id", "any"]:
                results = try_fetch(current_scope, current_grade)
                if results:
                    species_results = results
                    final_scope = current_scope
                    final_grade = current_grade
                    break
            if species_results:
                break

        if not species_results:
            print(f"  [Empty] No records found for {common_name} even after fallback.")
            continue

        # Process and tag records
        confidence = calculate_confidence(final_grade, final_scope)
        count = 0
        
        for obs in species_results:
            location = obs.get("location")
            # For the map, we still require a location string (even if obscured/randomized)
            if not location: continue
            
            try:
                lat, lon = map(float, location.split(","))
            except ValueError: continue
            
            image_url = None
            photos = obs.get("photos", [])
            if photos:
                photo_url = photos[0].get("url")
                if photo_url:
                    image_url = photo_url.replace("square", "medium")
            
            all_records.append({
                "animal": common_name,
                "scientific_name": info["scientific"],
                "emoji": info["emoji"],
                "lat": lat,
                "lon": lon,
                "eventDate": obs.get("observed_on") or "Unknown",
                "image_url": image_url,
                "metadata": {
                    "scope": final_scope,
                    "quality_grade": final_grade,
                    "confidence": confidence
                }
            })
            count += 1
                
        print(f"  [OK] Found {count} records ({final_scope}/{final_grade}) - Confidence: {confidence}")
            
        # API Politeness
        time.sleep(1.2)
            
    return all_records

# ---------------- MAIN EXECUTION ---------------- #

def main():
    now_str = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
    print(f"\n--- iNaturalist Adaptive Fetch | {now_str} UTC ---")
    
    records = fetch_inat_data()
    
    if records:
        os.makedirs(CACHE_DIR, exist_ok=True)
        with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
            json.dump(records, f, indent=2)
        print(f"\nProcess Complete: Saved {len(records)} records to {OUTPUT_FILE}")
    else:
        print("\nNo records found across all adaptive stages.")

if __name__ == "__main__":
    main()
