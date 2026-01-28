"""
GBIF Occurrence API fetcher with robust retry logic and GBIF-safe date handling.
Updated for Python 3.12+ compatibility and enhanced server error handling.
"""

import json
import os
import time
from datetime import datetime, timedelta, timezone
import requests
from requests.exceptions import RequestException, HTTPError

# ---------------- CONFIGURATION ---------------- #

# Ensuring paths are absolute and relative to the script location
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.abspath(os.path.join(BASE_DIR, "cache"))
OUTPUT_FILE = os.path.abspath(os.path.join(CACHE_DIR, "gbif_recent.json"))
GBIF_API_URL = "https://api.gbif.org/v1/occurrence/search"

# Exactly 5 animals: scientific name -> (common name, emoji)
SPECIES = [
    ("Elephas maximus", "Asian Elephant", "\U0001F418"),
    ("Panthera tigris", "Tiger", "\U0001F405"),
    ("Panthera pardus", "Leopard", "\U0001F406"),
    ("Bos gaurus", "Gaur", "\U0001F9AC"),
    ("Melursus ursinus", "Sloth Bear", "\U0001F43B"),
]

# ---------------- DATE HANDLING ---------------- #

def get_date_range():
    """
    Returns a GBIF-safe rolling date range.
    Uses modern timezone-aware objects to avoid DeprecationWarnings.
    """
    # Use timezone-aware UTC now
    today = datetime.now(timezone.utc).date()
    end_date = today - timedelta(days=1)          # GBIF-safe (yesterday)
    start_date = end_date - timedelta(days=90)    # last 90 days
    return f"{start_date.isoformat()},{end_date.isoformat()}"

# ---------------- FETCH LOGIC ---------------- #

def fetch_with_retry(scientific_name, common_name, date_range, retries=3, backoff=3):
    """
    Fetch GBIF data for one species with retry + exponential backoff.
    Specifically handles 503 (Server Unavailable) and 429 (Rate Limited).
    """
    params = {
        "scientificName": scientific_name,
        "eventDate": date_range,
        "hasCoordinate": "true",
        "occurrenceStatus": "PRESENT",
        "basisOfRecord": "OBSERVATION",
        "limit": 10,
    }

    headers = {
        "User-Agent": "WildlifeSafetyApp/1.1 (contact: research@example.com)"
    }

    for attempt in range(1, retries + 1):
        try:
            response = requests.get(
                GBIF_API_URL,
                params=params,
                headers=headers,
                timeout=30 # Increased timeout for slow GBIF backends
            )

            # Handle Rate Limiting
            if response.status_code == 429:
                wait = backoff ** attempt
                print(f"  [Rate Limit] {common_name} – waiting {wait}s")
                time.sleep(wait)
                continue

            # Handle Server Overload (The 503 issue)
            if response.status_code in [502, 503, 504]:
                # Implement longer backoff for server-side errors
                wait = (backoff * 5) + (attempt * 2) 
                print(f"  [Server Error {response.status_code}] {common_name} – attempt {attempt} – waiting {wait}s (longer backoff)")
                time.sleep(wait)
                continue

            response.raise_for_status()
            return response.json().get("results", [])

        except (HTTPError, RequestException) as e:
            wait = backoff ** attempt
            print(f"  [Request Failed] {common_name} (Attempt {attempt}/{retries}): {e}")
            if attempt < retries:
                time.sleep(wait)
            else:
                print(f"  [Final Failure] {common_name} - Moving to next species.")
                return None

# ---------------- MAIN EXECUTION ---------------- #

def main():
    # Use timezone-aware UTC for the timestamp
    now_str = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
    print(f"\n--- GBIF Production Fetch | {now_str} UTC ---")

    date_range = get_date_range()
    print(f"Date range used: {date_range}")

    all_records = []
    any_success = False

    for sci_name, common_name, emoji in SPECIES:
        print(f"Fetching data for {common_name}...")
        results = fetch_with_retry(sci_name, common_name, date_range)

        if results is not None:
            any_success = True
            count = 0

            for rec in results:
                lat = rec.get("decimalLatitude")
                lon = rec.get("decimalLongitude")
                if lat is None or lon is None:
                    continue

                raw_date = rec.get("eventDate", "Unknown")
                event_date = raw_date.split("T")[0] if isinstance(raw_date, str) else "Unknown"

                all_records.append({
                    "animal": common_name,
                    "scientific_name": sci_name,
                    "emoji": emoji,
                    "lat": float(lat),
                    "lon": float(lon),
                    "eventDate": event_date
                })
                count += 1

            print(f"  [Success] {common_name}: {count} records found")
        else:
            print(f"  [Warning] Could not retrieve data for {common_name}.")

    # ---------------- SAVE / FALLBACK ---------------- #

    os.makedirs(CACHE_DIR, exist_ok=True)

    if any_success:
        with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
            json.dump(all_records, f, indent=2)
        print(f"\nProcess Complete: Saved {len(all_records)} records → {OUTPUT_FILE}")
    else:
        print("\nCRITICAL ERROR: All species fetches failed due to server issues.")
        if not os.path.exists(OUTPUT_FILE):
            with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
                json.dump([], f)
            print("Initialized empty cache file.")

if __name__ == "__main__":
    main()