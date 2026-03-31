import os
import sys
import json
import numpy as np
import joblib
from datetime import datetime
from tensorflow.keras.models import load_model

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(BASE_DIR, "models")
MODEL_V2 = os.path.join(MODELS_DIR, "movement_lstm_v2.h5")
SCALER_V2 = os.path.join(MODELS_DIR, "movement_scaler_v2.pkl")
HEATMAP_PATH = os.path.abspath(os.path.join(BASE_DIR, "..", "backend", "python", "cache", "corridor_heatmap.json"))

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
    import math
    r = 6371.0
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dlon/2)**2
    c = 2*math.atan2(math.sqrt(a), math.sqrt(1-a))
    return r*c

def bearing(lat1, lon1, lat2, lon2):
    import math
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dlon = math.radians(lon2 - lon1)
    y = math.sin(dlon) * math.cos(p2)
    x = math.cos(p1)*math.sin(p2) - math.sin(p1)*math.cos(p2)*math.cos(dlon)
    brng = (math.degrees(math.atan2(y, x)) + 360.0) % 360.0
    return brng

def dir_name(deg):
    dirs = ["north","north-east","east","south-east","south","south-west","west","north-west"]
    idx = int(((deg + 22.5) % 360) / 45.0)
    return dirs[idx]

def build_features(points, window, fmean, fstd, fallback_month=None, fallback_season=None):
    feats = []
    for i in range(1, len(points)):
        a = points[i-1]; b = points[i]
        ta = to_ts(a.get("time")) if isinstance(a, dict) else None
        tb = to_ts(b.get("time")) if isinstance(b, dict) else None
        lat1 = float(a.get("lat")); lon1 = float(a.get("lon"))
        lat2 = float(b.get("lat")); lon2 = float(b.get("lon"))
        dh = 1.0
        if ta and tb:
            dh = max((tb - ta).total_seconds()/3600.0, 1e-6)
        dkm = haversine(lat1, lon1, lat2, lon2)
        spd = dkm/dh
        brg = bearing(lat1, lon1, lat2, lon2)
        mon = tb.month if tb else (int(fallback_month) if fallback_month else 1)
        if mon in (1,2): season = 1
        elif mon in (3,4,5): season = 2
        elif mon in (6,7,8,9): season = 3
        else: season = 4
        if fallback_season:
            try:
                season = int(fallback_season)
            except:
                pass
        feats.append([lat1, lon1, spd, brg, float(mon), float(season)])
    if len(feats) >= window:
        X = np.array(feats[-window:], dtype=np.float32)
    else:
        pad = window - len(feats)
        first = feats[0] if feats else [0.0,0.0,0.0,0.0,1.0,1.0]
        X = np.array([first]*pad + feats, dtype=np.float32)
    return (X - fmean) / fstd

def load_heatmap():
    if not os.path.exists(HEATMAP_PATH):
        return []
    with open(HEATMAP_PATH, "r", encoding="utf-8") as f:
        d = json.load(f)
        if isinstance(d, list):
            return d
    return []

def nearest_cell_density(lat, lon, grid):
    if not grid:
        return 0.0
    best = 0.0
    bestd = 1e9
    for c in grid:
        clat = float(c["cell_lat"]); clon = float(c["cell_lon"])
        d = haversine(lat, lon, clat, clon)
        if d < bestd:
            bestd = d; best = float(c["density_score"])
    return best

def rules_predict(species, last_lat, last_lon, grid):
    from species_movement_model import estimate_next
    plat, plon, conf = estimate_next(species, last_lat, last_lon, grid)
    return {"species": species, "predicted_location": {"lat": plat, "lon": plon}, "prediction_method": "species_rules", "confidence_score": round(float(conf), 2)}

def lstm_predict(species, recent):
    if not (os.path.exists(MODEL_V2) and os.path.exists(SCALER_V2)):
        return None
    scal = joblib.load(SCALER_V2)
    window = int(scal.get("window", 4))
    fb_mon = None
    fb_sea = None
    try:
        if isinstance(recent[-1], dict):
            tb = to_ts(recent[-1].get("time"))
            if tb:
                fb_mon = tb.month
    except:
        pass
    Xn = build_features(recent, window, scal["fmean"], scal["fstd"], fb_mon, fb_sea)
    model = load_model(MODEL_V2)
    y_n = model.predict(np.expand_dims(Xn, 0), verbose=0)[0]
    y = y_n * scal["tstd"] + scal["tmean"]
    last = recent[-1]
    bl = float(last["lat"]); bo = float(last["lon"])
    dy_lat = float(y[0]) - bl
    dy_lon = float(y[1]) - bo
    if dy_lat > 2.0: dy_lat = 2.0
    if dy_lat < -2.0: dy_lat = -2.0
    if dy_lon > 2.0: dy_lon = 2.0
    if dy_lon < -2.0: dy_lon = -2.0
    y0 = bl + dy_lat
    y1 = bo + dy_lon
    if y0 < 8.0: y0 = 8.0
    if y0 > 15.5: y0 = 15.5
    if y1 < 74.0: y1 = 74.0
    if y1 > 84.0: y1 = 84.0
    d = haversine(bl, bo, y0, y1)
    conf = max(0.3, min(0.95, 0.9 - 0.02*d))
    deg = bearing(bl, bo, y0, y1)
    return {"species": species, "predicted_location": {"lat": float(y0), "lon": float(y1)}, "prediction_method": "lstm_v2", "confidence_score": round(float(conf), 2), "direction": dir_name(deg)}

def main():
    try:
        s = sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read().strip()
        if not s:
            print(json.dumps({"error":"no_input"})); return
        inp = json.loads(s)
        species = inp.get("species") or inp.get("animal")
        recent = inp.get("recent_path") or []
        in_month = inp.get("month")
        in_season = inp.get("season")
        in_hist_dens = inp.get("historical_density")
        if not species or len(recent) == 0:
            print(json.dumps({"error":"missing_fields"})); return
        grid = load_heatmap()
        last = recent[-1]
        last_lat = float(last.get("lat")); last_lon = float(last.get("lon"))
        dens = nearest_cell_density(last_lat, last_lon, grid)
        try:
            if in_hist_dens is not None:
                dens = max(dens, float(in_hist_dens))
        except:
            pass
        if len(recent) >= 3:
            out = lstm_predict(species, recent)
            if out:
                out["corridor_density"] = round(float(dens), 2)
                try:
                    if float(dens) > 0.5:
                        out["confidence_score"] = round(min(0.99, float(out.get("confidence_score", 0.6)) + 0.05), 2)
                except:
                    pass
                print(json.dumps(out)); return
        if dens > 0.5:
            best = None
            bestd = -1.0
            for c in grid:
                d = float(c["density_score"])
                if d > bestd:
                    bestd = d; best = c
            if best:
                print(json.dumps({"species": species, "predicted_location": {"lat": float(best["cell_lat"]), "lon": float(best["cell_lon"])}, "prediction_method": "corridor_heatmap", "confidence_score": 0.6, "corridor_density": round(float(dens), 2)}))
                return
        rp = rules_predict(species, last_lat, last_lon, grid)
        rp["corridor_density"] = round(float(dens), 2)
        print(json.dumps(rp))
    except Exception as e:
        print(json.dumps({"error":"runtime_error"}))

if __name__ == "__main__":
    main()
