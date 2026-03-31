import os
# Suppress TensorFlow logs before importing keras
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")
import sys
import json
import math
import numpy as np
import joblib
from datetime import datetime
from tensorflow.keras.models import load_model

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATASET_DIR = os.path.join(BASE_DIR, "dataset")
CACHE_PATH = os.path.abspath(os.path.join(BASE_DIR, "..", "backend", "python", "cache", "inat_historical.json"))
# Model/scaler candidates (support both canonical and v2 naming)
MODELS_DIR = os.path.join(BASE_DIR, "models")
MODEL_CANDIDATES = [
    os.path.join(MODELS_DIR, "movement_lstm_model.h5"),
    os.path.join(MODELS_DIR, "movement_lstm_model.keras"),
    os.path.join(MODELS_DIR, "movement_lstm_v2.h5"),
    os.path.join(MODELS_DIR, "movement_lstm_v2.keras"),
]
SCALER_CANDIDATES = [
    os.path.join(MODELS_DIR, "movement_scaler.pkl"),
    os.path.join(MODELS_DIR, "movement_scaler_v2.pkl"),
]

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

def dir_name(deg):
    dirs = ["north","north-east","east","south-east","south","south-west","west","north-west"]
    idx = int(((deg + 22.5) % 360) / 45.0)
    return dirs[idx]

def load_history(animal):
    pts = []
    if not os.path.exists(CACHE_PATH):
        return pts
    with open(CACHE_PATH, "r", encoding="utf-8") as f:
        recs = json.load(f)
    for r in recs:
        sp = r.get("species", r.get("animal"))
        if not sp or str(sp).lower() not in str(animal).lower():
            continue
        lat = r.get("latitude", r.get("lat"))
        lon = r.get("longitude", r.get("lon"))
        try:
            lat = float(lat); lon = float(lon)
        except:
            continue
        pts.append((lat, lon))
    return pts

def constrain_to_corridor(lat, lon, history_pts):
    if not history_pts:
        return lat, lon
    dmin = 1e9
    best = None
    for h in history_pts:
        d = haversine(lat, lon, h[0], h[1])
        if d < dmin:
            dmin = d; best = h
    if dmin > 20.0:
        ratio = 20.0 / dmin
        lat = lat + (best[0] - lat) * ratio
        lon = lon + (best[1] - lon) * ratio
    lat = max(8.0, min(13.5, lat))
    lon = max(76.0, min(80.5, lon))
    return lat, lon

def clamp_near_base(lat, lon, base_lat, base_lon, max_deg=0.2):
    dlat = lat - base_lat
    dlon = lon - base_lon
    if dlat > max_deg: dlat = max_deg
    if dlat < -max_deg: dlat = -max_deg
    if dlon > max_deg: dlon = max_deg
    if dlon < -max_deg: dlon = -max_deg
    return base_lat + dlat, base_lon + dlon

def build_features(points, window, fallback_month=None, fallback_season=None):
    feats = []
    for i in range(1, len(points)):
        a = points[i-1]
        b = points[i]
        ta = to_ts(a.get("time")) if isinstance(a, dict) else None
        tb = to_ts(b.get("time")) if isinstance(b, dict) else None
        lat1 = float(a.get("lat") if isinstance(a, dict) else a[0])
        lon1 = float(a.get("lon") if isinstance(a, dict) else a[1])
        lat2 = float(b.get("lat") if isinstance(b, dict) else b[0])
        lon2 = float(b.get("lon") if isinstance(b, dict) else b[1])
        dh = 1.0
        if ta and tb:
            dh = max((tb - ta).total_seconds()/3600.0, 1e-6)
        dkm = haversine(lat1, lon1, lat2, lon2)
        spd = dkm / dh
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
        return np.array(feats[-window:], dtype=np.float32)
    pad = window - len(feats)
    if feats:
        first = feats[0]
    else:
        first = [0.0, 0.0, 0.0, 0.0, 1.0, 1.0]
    feats = [first]*pad + feats
    return np.array(feats, dtype=np.float32)

def find_first_existing(paths):
    for p in paths:
        if os.path.exists(p):
            return p
    return None

def main():
    try:
        s = sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read().strip()
        if not s:
            print(json.dumps({"status":"failed","error":"no_input"})); return
        inp = json.loads(s)
        animal = inp.get("animal") or "Unknown"
        recent = inp.get("recent_path") or []
        in_month = inp.get("month")
        in_season = inp.get("season")
        if len(recent) < 3:
            print(json.dumps({"status":"degraded","error":"insufficient_trajectory"})); return
        model_path = find_first_existing(MODEL_CANDIDATES)
        scaler_path = find_first_existing(SCALER_CANDIDATES)
        movement_model_used = "lstm"
        if not model_path or not scaler_path:
            movement_model_used = "rules"
            # Fallback: return rule-based prediction with message
            last = recent[-1]
            clast = {
                "lat": float(last.get("lat") if isinstance(last, dict) else last[0]),
                "lon": float(last.get("lon") if isinstance(last, dict) else last[1])
            }
            hist = load_history(animal)
            # Simple directional nudge based on last step
            prev = recent[-2]
            prev_lat = float(prev.get("lat") if isinstance(prev, dict) else prev[0])
            prev_lon = float(prev.get("lon") if isinstance(prev, dict) else prev[1])
            dlat = max(min(clast["lat"] - prev_lat, 0.2), -0.2)
            dlon = max(min(clast["lon"] - prev_lon, 0.2), -0.2)
            plat, plon = clamp_near_base(clast["lat"] + dlat, clast["lon"] + dlon, clast["lat"], clast["lon"], 0.2)
            clat, clon = constrain_to_corridor(plat, plon, hist)
            dirdeg = bearing(clast["lat"], clast["lon"], clat, clon)
            conf = 0.5
            out = {
                "species": animal,
                "current_location": clast,
                "predicted_location": {"lat": clat, "lon": clon},
                "predicted_path": [{"lat": clat, "lon": clon}],
                "movement_direction": dir_name(dirdeg),
                "confidence": round(conf, 2),
                "movement_model_used": movement_model_used,
                "message": "LSTM model file not found, falling back to rule-based prediction",
                "status": "success"
            }
            print(json.dumps(out)); return
        scal = joblib.load(scaler_path)
        window = int(scal.get("window", 4))
        X = build_features(recent, window, in_month, in_season)
        Xn = (X - scal["fmean"]) / scal["fstd"]
        model = load_model(model_path)
        ypred_n = model.predict(np.expand_dims(Xn, 0), verbose=0)
        debug_raw = ypred_n.tolist()
        ypred = None
        try:
            if hasattr(scal, "inverse_transform"):
                ypred = scal.inverse_transform(ypred_n)
        except:
            ypred = None
        if ypred is None:
            ypred = ypred_n[0] * scal["tstd"] + scal["tmean"]
        else:
            ypred = ypred[0]
        plat = float(ypred[0]); plon = float(ypred[1])
        # NaN/invalid protection: synthesize tiny movement from last point
        if not (math.isfinite(plat) and math.isfinite(plon)):
            last = recent[-1]
            last_lat = float(last.get("lat") if isinstance(last, dict) else last[0])
            last_lon = float(last.get("lon") if isinstance(last, dict) else last[1])
            plat = last_lat + 0.002
            plon = last_lon + 0.002
        hist = load_history(animal)
        last = recent[-1]
        clast = {"lat": float(last.get("lat") if isinstance(last, dict) else last[0]), "lon": float(last.get("lon") if isinstance(last, dict) else last[1])}
        plat, plon = clamp_near_base(plat, plon, clast["lat"], clast["lon"], 0.2)
        clat, clon = constrain_to_corridor(plat, plon, hist)
        dirdeg = bearing(clast["lat"], clast["lon"], clat, clon)
        d2 = haversine(clast["lat"], clast["lon"], clat, clon)
        spd_feats = []
        for i in range(2, len(recent)):
            a = recent[i-1]; b = recent[i]
            ta = to_ts(a.get("time")) if isinstance(a, dict) else None
            tb = to_ts(b.get("time")) if isinstance(b, dict) else None
            lat1 = float(a.get("lat") if isinstance(a, dict) else a[0])
            lon1 = float(a.get("lon") if isinstance(a, dict) else a[1])
            lat2 = float(b.get("lat") if isinstance(b, dict) else b[0])
            lon2 = float(b.get("lon") if isinstance(b, dict) else b[1])
            dh = 1.0
            if ta and tb:
                dh = max((tb - ta).total_seconds()/3600.0, 1e-6)
            dkm = haversine(lat1, lon1, lat2, lon2)
            spd_feats.append(dkm/dh)
        if spd_feats:
            v = float(np.std(spd_feats))
            conf = max(0.3, min(0.95, 0.95 - v*0.1))
        else:
            conf = 0.6
        out = {
            "status": "success",
            "ml_connection": "success",
            "species": animal,
            "current_location": clast,
            "predicted_position": {"lat": clat, "lon": clon},
            "predicted_path": [
                [clast["lat"], clast["lon"]],
                [clat, clon]
            ],
            "movement_direction": dir_name(dirdeg),
            "confidence": "medium",
            "movement_model_used": "lstm_v2",
            "debug_raw_pred_scaled": debug_raw,
            "debug_final_coords": [clat, clon]
        }
        print(json.dumps(out))
    except Exception as e:
        print(json.dumps({"status":"failed","error":"runtime_error"}))

if __name__ == "__main__":
    main()
