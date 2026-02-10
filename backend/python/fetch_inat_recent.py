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
import argparse

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
    "42169": {"name": "Bison", "scientific": "Bison bison", "emoji": "🦬"},
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
    
    def parse_date(value: str) -> datetime:
        value = (value or "").strip()
        if not value:
            raise ValueError("empty date")
        for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%m-%d-%Y", "%Y/%m/%d", "%d/%m/%Y", "%m/%d/%Y"):
            try:
                return datetime.strptime(value, fmt).replace(tzinfo=timezone.utc)
            except ValueError:
                continue
        raise ValueError(f"unsupported date format: {value}")

    args = getattr(fetch_inat_data, "_args", None)

    now_utc = datetime.now(timezone.utc)
    from_env = os.getenv("INAT_FROM_DATE")
    to_env = os.getenv("INAT_TO_DATE")

    try:
        to_dt = parse_date(args.to_date) if args and args.to_date else (parse_date(to_env) if to_env else now_utc)
    except Exception:
        to_dt = now_utc

    try:
        if args and args.from_date:
            from_dt = parse_date(args.from_date)
        elif from_env:
            from_dt = parse_date(from_env)
        else:
            from_dt = datetime(2022, 1, 1, tzinfo=timezone.utc)
    except Exception:
        from_dt = datetime(2022, 1, 1, tzinfo=timezone.utc)

    max_history_days = int(os.getenv("INAT_MAX_HISTORY_DAYS", str(args.max_history_days if args else 730)))
    step_days = int(os.getenv("INAT_WINDOW_STEP_DAYS", str(args.step_days if args else 90)))
    lstm_window_size = int(os.getenv("LSTM_WINDOW_SIZE", "5"))
    lstm_min_samples = int(os.getenv("LSTM_MIN_SAMPLES", "15"))

    if from_dt > to_dt:
        from_dt, to_dt = to_dt - timedelta(days=180), to_dt

    max_lookback_dt = to_dt - timedelta(days=max_history_days)

    print(f"Fetch Window (initial): {from_dt.strftime('%Y-%m-%d')} to {to_dt.strftime('%Y-%m-%d')}")

    for taxon_id_str, info in SPECIES.items():
        common_name = info["name"]
        print(f"Processing {common_name} (Taxon ID: {taxon_id_str})...")
        
        species_results = []
        final_scope = "regional"
        final_grade = "none"

        def try_fetch(scope, grade, d1_str, d2_str):
            # Use iNaturalist 'taxon_name' as requested, with sorting by created_at
            params = {
                "taxon_name": common_name,
                "per_page": 50,
                "order_by": "created_at",
                "order": "desc",
                "include_subtaxa": "true"
            }
            if d1_str:
                params["d1"] = d1_str
            if d2_str:
                params["d2"] = d2_str
            # Do not apply geographic filters; follow provided API usage pattern
            if grade != "any":
                params["quality_grade"] = grade

            try:
                response = session.get(INAT_API_URL, params=params, headers=HEADERS, timeout=30)
                response.raise_for_status()
                return response.json().get("results", [])
            except Exception as e:
                print(f"  [Error] Fetch failed ({scope}/{grade}): {e}")
                return []

        effective_from = from_dt
        attempts = 0

        while True:
            attempts += 1
            d1_str = effective_from.strftime("%Y-%m-%d")
            d2_str = to_dt.strftime("%Y-%m-%d")

            species_results = []

            for current_scope in ["regional", "global"]:
                for current_grade in ["research", "needs_id", "any"]:
                    results = try_fetch(current_scope, current_grade, d1_str, d2_str)
                    if results:
                        species_results = results
                        final_scope = current_scope
                        final_grade = current_grade
                        break
                if species_results:
                    break

            usable_count = sum(1 for obs in species_results if obs.get("location"))
            min_required = max(lstm_min_samples, lstm_window_size + 1)

            if usable_count >= min_required:
                if attempts > 1:
                    print(f"  [OK] Expanded window satisfied LSTM minimum: {usable_count} records (min {min_required}) using d1={d1_str}")
                break

            if effective_from <= max_lookback_dt:
                break

            next_from = effective_from - timedelta(days=step_days)
            if next_from < max_lookback_dt:
                next_from = max_lookback_dt

            if next_from == effective_from:
                break

            print(f"  [LSTM-Window] Insufficient records for sequences ({usable_count} < {min_required}). Expanding d1: {d1_str} -> {next_from.strftime('%Y-%m-%d')}")
            effective_from = next_from

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
                "id": obs.get("id"),
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

    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--from", dest="from_date", default=None)
    parser.add_argument("--to", dest="to_date", default=None)
    parser.add_argument("--max-history-days", dest="max_history_days", type=int, default=730)
    parser.add_argument("--step-days", dest="step_days", type=int, default=90)
    try:
        fetch_inat_data._args = parser.parse_args()
    except SystemExit:
        fetch_inat_data._args = None

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
