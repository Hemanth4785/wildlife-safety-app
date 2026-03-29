import os
import json
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
INAT_PATH = os.path.abspath(os.path.join(BASE_DIR, "..", "backend", "python", "cache", "inat_historical.json"))
GBIF_PATH = os.path.abspath(os.path.join(BASE_DIR, "..", "backend", "python", "cache", "gbif_recent.json"))
LOCAL_PATHS = [
    os.path.abspath(os.path.join(BASE_DIR, "..", "backend", "python", "cache", "local_wildlife.json")),
    os.path.abspath(os.path.join(BASE_DIR, "dataset", "local_wildlife.json")),
]
OUT_PATH = os.path.abspath(os.path.join(BASE_DIR, "..", "backend", "python", "cache", "wildlife_combined.json"))

def to_ts(v):
    s = str(v or "")
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z","").replace("z",""))
    except:
        try:
            return datetime.strptime(s[:19], "%Y-%m-%dT%H:%M:%S")
        except:
            try:
                return datetime.strptime(s[:10], "%Y-%m-%d")
            except:
                return None

def load_json(path):
    if not os.path.exists(path):
        return []
    try:
        with open(path, "r", encoding="utf-8") as f:
            d = json.load(f)
            if isinstance(d, list):
                return d
            if isinstance(d, dict) and "results" in d and isinstance(d["results"], list):
                return d["results"]
    except:
        pass
    return []

def season_from_month(m: int) -> int:
    # Simple season encoding for South India
    # 1: Winter(Jan-Feb), 2: Pre-monsoon(Mar-May), 3: Monsoon(Jun-Sep), 4: Post-monsoon(Oct-Dec)
    if m in (1, 2): return 1
    if m in (3, 4, 5): return 2
    if m in (6, 7, 8, 9): return 3
    return 4

def norm_inat(rec):
    lat = rec.get("latitude", rec.get("lat"))
    lon = rec.get("longitude", rec.get("lon"))
    sp = rec.get("species", rec.get("animal")) or rec.get("taxon", {}).get("name")
    ts = rec.get("observed_on", rec.get("time_observed_at") or rec.get("eventDate"))
    try:
        lat = float(lat); lon = float(lon)
    except:
        return None
    tsn = to_ts(ts)
    if not tsn or not sp:
        return None
    y = tsn.year
    m = tsn.month
    doy = tsn.timetuple().tm_yday
    return {"species": str(sp), "latitude": lat, "longitude": lon, "timestamp": tsn.isoformat(), "year": y, "month": m, "day_of_year": doy, "source": "inat"}

def norm_gbif(rec):
    lat = rec.get("decimalLatitude", rec.get("latitude", rec.get("lat")))
    lon = rec.get("decimalLongitude", rec.get("longitude", rec.get("lon")))
    sp = rec.get("species") or rec.get("scientificName") or rec.get("animal")
    ts = rec.get("eventDate") or rec.get("observed_on") or rec.get("day")
    try:
        lat = float(lat); lon = float(lon)
    except:
        return None
    tsn = to_ts(ts)
    if not tsn or not sp:
        return None
    y = tsn.year
    m = tsn.month
    doy = tsn.timetuple().tm_yday
    return {"species": str(sp), "latitude": lat, "longitude": lon, "timestamp": tsn.isoformat(), "year": y, "month": m, "day_of_year": doy, "source": "gbif"}

def norm_local(rec):
    lat = rec.get("latitude", rec.get("lat"))
    lon = rec.get("longitude", rec.get("lon"))
    sp = rec.get("species", rec.get("animal"))
    ts = rec.get("timestamp") or rec.get("eventDate") or rec.get("observed_on")
    try:
        lat = float(lat); lon = float(lon)
    except:
        return None
    tsn = to_ts(ts)
    if not tsn or not sp:
        return None
    y = tsn.year
    m = tsn.month
    doy = tsn.timetuple().tm_yday
    return {"species": str(sp), "latitude": lat, "longitude": lon, "timestamp": tsn.isoformat(), "year": y, "month": m, "day_of_year": doy, "source": "local"}

def main():
    inat = load_json(INAT_PATH)
    gbif = load_json(GBIF_PATH)
    local_all = []
    for p in LOCAL_PATHS:
        local_all.extend(load_json(p))
    out = []
    for r in inat:
        x = norm_inat(r)
        if x: out.append(x)
    for r in gbif:
        x = norm_gbif(r)
        if x: out.append(x)
    for r in local_all:
        x = norm_local(r)
        if x: out.append(x)

    # Filter last 6 years
    try:
        from datetime import datetime, timedelta
        now = datetime.utcnow()
        cutoff = now.replace(year=now.year - 6)
        out = [o for o in out if to_ts(o.get("timestamp")) and to_ts(o["timestamp"]) >= cutoff]
    except Exception:
        pass
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f)
    print(OUT_PATH)

if __name__ == "__main__":
    main()
