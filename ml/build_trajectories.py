import os
import json
import math
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_PATH = os.path.abspath(os.path.join(BASE_DIR, "..", "backend", "python", "cache", "inat_historical.json"))
DATASET_DIR = os.path.join(BASE_DIR, "dataset")
OUT_TRAJ = os.path.join(DATASET_DIR, "trajectories.json")
OUT_SEQ_X = os.path.join(DATASET_DIR, "move_X.npy")
OUT_SEQ_Y = os.path.join(DATASET_DIR, "move_y.npy")

def to_timestamp(s):
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

def haversine(lat1, lon1, lat2, lon2):
    r = 6371.0
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dlon/2)**2
    c = 2*math.atan2(math.sqrt(a), math.sqrt(1-a))
    return r*c

def bearing(lat1, lon1, lat2, lon2):
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dlon = math.radians(lon2 - lon1)
    y = math.sin(dlon) * math.cos(p2)
    x = math.cos(p1)*math.sin(p2) - math.sin(p1)*math.cos(p2)*math.cos(dlon)
    brng = (math.degrees(math.atan2(y, x)) + 360.0) % 360.0
    return brng

def main():
    os.makedirs(DATASET_DIR, exist_ok=True)
    if not os.path.exists(CACHE_PATH):
        with open(OUT_TRAJ, "w", encoding="utf-8") as f:
            json.dump({}, f)
        return
    with open(CACHE_PATH, "r", encoding="utf-8") as f:
        recs = json.load(f)
    groups = {}
    for r in recs:
        lat = r.get("latitude", r.get("lat"))
        lon = r.get("longitude", r.get("lon"))
        sp = r.get("species", r.get("animal"))
        ts = r.get("observed_on", r.get("eventDate"))
        try:
            lat = float(lat)
            lon = float(lon)
        except:
            continue
        if not sp or not ts:
            continue
        dt = to_timestamp(str(ts))
        if not dt:
            continue
        groups.setdefault(str(sp), []).append({"lat": lat, "lon": lon, "time": dt.isoformat()})
    for k in groups:
        groups[k].sort(key=lambda x: x["time"])
    filtered = {k: v for k, v in groups.items() if len(v) >= 3}
    feats = {}
    for sp, traj in filtered.items():
        rows = []
        for i in range(1, len(traj)):
            a = traj[i-1]
            b = traj[i]
            t1 = to_timestamp(a["time"])
            t2 = to_timestamp(b["time"])
            if not t1 or not t2:
                continue
            dh = max((t2 - t1).total_seconds() / 3600.0, 1e-6)
            dkm = haversine(a["lat"], a["lon"], b["lat"], b["lon"])
            spd = dkm / dh
            brg = bearing(a["lat"], a["lon"], b["lat"], b["lon"])
            rows.append({"lat": b["lat"], "lon": b["lon"], "speed": spd, "dir": brg, "time": b["time"]})
        feats[sp] = rows
    with open(OUT_TRAJ, "w", encoding="utf-8") as f:
        json.dump({"trajectories": filtered, "features": feats}, f)

if __name__ == "__main__":
    main()

