import os
import json
import pandas as pd
from datetime import datetime, timedelta

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_PATH = os.path.abspath(os.path.join(BASE_DIR, "..", "backend", "python", "cache", "inat_historical.json"))
DATASET_DIR = os.path.join(BASE_DIR, "dataset")
OUT_CSV = os.path.join(DATASET_DIR, "wildlife_timeseries.csv")

os.makedirs(DATASET_DIR, exist_ok=True)

SPECIES_MAP = {
    "asian elephant": "elephant",
    "elephas maximus": "elephant",
    "bengal tiger": "tiger",
    "tiger": "tiger",
    "panthera tigris": "tiger",
    "indian leopard": "leopard",
    "leopard": "leopard",
    "panthera pardus": "leopard",
    "gaur": "bison",
    "indian bison": "bison",
    "bos gaurus": "bison",
    "sloth bear": "slothbear",
    "melursus ursinus": "slothbear"
}

def to_species_key(s):
    if not s:
        return None
    k = str(s).strip().lower()
    for key in SPECIES_MAP:
        if key in k:
            return SPECIES_MAP[key]
    return None

def parse_date(x):
    if not x:
        return None
    try:
        return pd.to_datetime(x).date()
    except:
        try:
            return datetime.strptime(str(x)[:10], "%Y-%m-%d").date()
        except:
            return None

def in_bounds(lat, lon):
    try:
        lat = float(lat)
        lon = float(lon)
    except:
        return False
    return 8.0 <= lat <= 15.0 and 74.0 <= lon <= 80.0

def load_records():
    if not os.path.exists(CACHE_PATH):
        return []
    with open(CACHE_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, list):
        return []
    out = []
    for r in data:
        lat = r.get("latitude", r.get("lat"))
        lon = r.get("longitude", r.get("lon"))
        sp = r.get("species", r.get("animal"))
        d = r.get("observed_on", r.get("eventDate"))
        if not in_bounds(lat, lon):
            continue
        sk = to_species_key(sp)
        if not sk:
            continue
        dt = parse_date(d)
        if not dt:
            continue
        out.append({"date": dt, "species": sk})
    return out

def main():
    recs = load_records()
    if not recs:
        df = pd.DataFrame(columns=["date", "elephant", "tiger", "leopard", "bison", "slothbear", "rainfall"])
        df.to_csv(OUT_CSV, index=False)
        print(OUT_CSV)
        return
    dates = [r["date"] for r in recs]
    start = min(dates)
    end = max(dates)
    idx = pd.date_range(start=start, end=end, freq="D").date
    rows = []
    for d in idx:
        rows.append({"date": d, "elephant": 0, "tiger": 0, "leopard": 0, "bison": 0, "slothbear": 0, "rainfall": 0})
    per_day = {}
    for r in recs:
        per_day.setdefault(r["date"], []).append(r["species"])
    for i, d in enumerate(idx):
        counts = {"elephant": 0, "tiger": 0, "leopard": 0, "bison": 0, "slothbear": 0}
        for s in per_day.get(d, []):
            if s in counts:
                counts[s] += 1
        rows[i].update(counts)
    df = pd.DataFrame(rows)
    df["date"] = df["date"].astype(str)
    df.to_csv(OUT_CSV, index=False)
    print(OUT_CSV)

if __name__ == "__main__":
    main()

