import os
import json
import math
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
COMBINED_PATH = os.path.abspath(os.path.join(BASE_DIR, "..", "backend", "python", "cache", "wildlife_combined.json"))
OUT_PATH = os.path.join(BASE_DIR, "dataset", "trajectories_v2.json")

def to_ts(s):
    try:
        return datetime.fromisoformat(str(s).replace("Z","").replace("z",""))
    except:
        try:
            return datetime.strptime(str(s)[:19], "%Y-%m-%dT%H:%M:%S")
        except:
            try:
                return datetime.strptime(str(s)[:10], "%Y-%m-%d")
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
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    if not os.path.exists(COMBINED_PATH):
        with open(OUT_PATH, "w", encoding="utf-8") as f:
            json.dump({"trajectories": {}, "features": {}}, f)
        print(OUT_PATH)
        return
    with open(COMBINED_PATH, "r", encoding="utf-8") as f:
        recs = json.load(f)
    groups = {}
    for r in recs:
        sp = r.get("species")
        lat = r.get("latitude")
        lon = r.get("longitude")
        ts = r.get("timestamp")
        try:
            lat = float(lat); lon = float(lon)
        except:
            continue
        dt = to_ts(ts)
        if not sp or not dt:
            continue
        groups.setdefault(sp, []).append({"lat": lat, "lon": lon, "time": dt.isoformat()})
    for k in list(groups.keys()):
        arr = sorted(groups[k], key=lambda x: x["time"])
        trajs = []
        cur = []
        for i in range(len(arr)):
            if not cur:
                cur = [arr[i]]
                continue
            prev = cur[-1]
            d = haversine(prev["lat"], prev["lon"], arr[i]["lat"], arr[i]["lon"])
            t1 = to_ts(prev["time"]); t2 = to_ts(arr[i]["time"])
            dh = abs((t2 - t1).total_seconds())/3600.0 if (t1 and t2) else 1e9
            if d < 50.0 and dh < 24.0*7.0:
                cur.append(arr[i])
            else:
                if len(cur) >= 3:
                    trajs.append(cur)
                cur = [arr[i]]
        if len(cur) >= 3:
            trajs.append(cur)
        if trajs:
            groups[k] = trajs
        else:
            del groups[k]
    feats = {}
    for sp, trajs in groups.items():
        frows = []
        for tr in trajs:
            for i in range(1, len(tr)):
                a = tr[i-1]; b = tr[i]
                t1 = to_ts(a["time"]); t2 = to_ts(b["time"])
                dh = max((t2 - t1).total_seconds()/3600.0, 1e-6) if (t1 and t2) else 1.0
                dkm = haversine(a["lat"], a["lon"], b["lat"], b["lon"])
                spd = dkm/dh
                brg = bearing(a["lat"], a["lon"], b["lat"], b["lon"])
                mon = t2.month if t2 else 1
                doy = t2.timetuple().tm_yday if t2 else 1
                # Simple season encoding: 1=Winter, 2=Pre-monsoon, 3=Monsoon, 4=Post-monsoon
                if mon in (1,2): season = 1
                elif mon in (3,4,5): season = 2
                elif mon in (6,7,8,9): season = 3
                else: season = 4
                frows.append({"lat": b["lat"], "lon": b["lon"], "speed": spd, "dir": brg, "month": mon, "season": season, "day_of_year": doy, "time": b["time"]})
        feats[sp] = frows
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump({"trajectories": groups, "features": feats}, f)
    print(OUT_PATH)

if __name__ == "__main__":
    main()
