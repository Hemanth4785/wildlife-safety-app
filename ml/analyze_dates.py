import os
import json
from datetime import datetime

# Configuration
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_PATH = os.path.abspath(os.path.join(BASE_DIR, "..", "backend", "python", "cache", "inat_historical.json"))

def analyze_date_range():
    if not os.path.exists(DATA_PATH):
        print(f"Data file not found: {DATA_PATH}")
        return

    try:
        with open(DATA_PATH, "r", encoding="utf-8") as f:
            records = json.load(f)
    except Exception as e:
        print(f"Error reading data: {e}")
        return

    dates = []
    for r in records:
        event_date = r.get('eventDate')
        if event_date:
            try:
                # Assuming ISO format like "2023-10-27T14:30:00+00:00" or similar
                # We'll parse purely the date part to be safe
                dt = datetime.fromisoformat(event_date.replace('Z', '+00:00'))
                dates.append(dt)
            except ValueError:
                continue

    if not dates:
        print("No valid dates found in records.")
        return

    min_date = min(dates)
    # End date dynamically set to runtime system date
    max_date = datetime.now().replace(tzinfo=min_date.tzinfo) 

    print(f"\n--- Data Temporal Scope ---")
    print(f"Total Records with Dates: {len(dates)}")
    print(f"Start Date: {min_date.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"End Date:   {max_date.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Duration:   {(max_date - min_date).days} days")

if __name__ == "__main__":
    analyze_date_range()
