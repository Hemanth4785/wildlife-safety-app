
import sys
import json
import os
import numpy as np
import joblib
from datetime import datetime
from haversine import haversine

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.path.join(BASE_DIR, "models", "maxent")
MODELS_PATH = os.path.join(MODEL_DIR, "maxent_models.pkl")
SCALERS_PATH = os.path.join(MODEL_DIR, "maxent_scalers.pkl")
CACHE_PATH = os.path.abspath(os.path.join(BASE_DIR, "..", "backend", "python", "cache", "inat_historical.json"))

def load_assets(animal):
    if not os.path.exists(MODELS_PATH) or not os.path.exists(SCALERS_PATH):
        return None, None, "assets_missing"
    try:
        models = joblib.load(MODELS_PATH)
        scalers = joblib.load(SCALERS_PATH)
        model = models.get(animal) or models.get("Generic")
        scaler = scalers.get(animal) or scalers.get("Generic")
        if not model or not scaler:
            return None, None, "model_missing"
        return model, scaler, None
    except Exception:
        return None, None, "load_failed"

def load_historical_data(animal):
    """Loads historical data for the specific animal from local cache."""
    if not os.path.exists(CACHE_PATH):
        return []
    try:
        with open(CACHE_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        # Filter for species
        points = []
        target = animal.lower()
        for item in data:
            if (item.get('species', '').lower() == target or 
                item.get('scientific_name', '').lower() == target or 
                item.get('animal', '').lower() == target):
                try:
                    points.append([float(item['lat']), float(item['lon'])])
                except:
                    pass
        return points
    except Exception as e:
        # specific error handling if needed, or just return empty
        return []

def get_historical_density_score(lat, lon, history_points):
    """Calculates a simple density score based on distance to nearest historical points."""
    if not history_points:
        return 0.0
    
    # Simple heuristic: sum of inverse distances to nearest 5 points
    # Optimization: Use a KDTree if points are many, but for prototype list comprehension is okay if < 10000
    # Actually, let's just find distance to NEAREST point
    min_dist = float('inf')
    for plat, plon in history_points:
        d = haversine((lat, lon), (plat, plon))
        if d < min_dist:
            min_dist = d
    
    # Score: 1.0 if right on top (0km), decays to 0 at 10km
    # e.g. exp(-dist)
    if min_dist == 0: return 1.0
    return np.exp(-min_dist) 

def generate_candidates(user, recent, k):
    d1 = 0.005
    d2 = 0.003
    d3 = 0.007
    ulat = float(user["lat"])
    ulon = float(user["lon"])
    cand = []
    for dx in [-d1, 0.0, d1]:
        for dy in [-d1, 0.0, d1]:
            cand.append([ulat + dx, ulon + dy])
    if isinstance(recent, list) and len(recent) > 0:
        last = recent[-1]
        try:
            llat = float(last[0])
            llon = float(last[1])
            for dx in [-d2, 0.0, d2]:
                for dy in [-d2, 0.0, d2]:
                    cand.append([llat + dx, llon + dy])
            if len(recent) >= 2:
                p0 = recent[-2]
                vx = float(last[0]) - float(p0[0])
                vy = float(last[1]) - float(p0[1])
                cand.append([llat + vx, llon + vy])
                cand.append([llat + vx * 0.5, llon + vy * 0.5])
                cand.append([llat + vx * 1.5, llon + vy * 1.5])
                for scale in [d3, d3 * 1.5]:
                    cand.append([llat + np.sign(vx) * scale, llon + np.sign(vy) * scale])
        except:
            pass
    uniq = []
    for p in cand:
        if not any(abs(p[0]-q[0]) < 1e-3 and abs(p[1]-q[1]) < 1e-3 for q in uniq):
            uniq.append(p)
    return uniq

def score_candidates(model, scaler, candidates, history_points):
    X = np.array(candidates)
    Xs = scaler.transform(X)
    proba = model.predict_proba(Xs)[:, 1]
    
    # Augment with historical density
    final_scores = []
    for i, p in enumerate(proba):
        lat, lon = candidates[i]
        hist_score = get_historical_density_score(lat, lon, history_points)
        # Weighted combination: 70% Model, 30% History
        final_score = 0.7 * p + 0.3 * hist_score
        final_scores.append(final_score)
        
    ranked = sorted(zip(candidates, final_scores), key=lambda t: t[1], reverse=True)
    return ranked

def safe_predict_risk(record):
    try:
        from predict_risk import predict_risk
        res = predict_risk(record)
        if isinstance(res, dict) and res.get("status") == "success":
            return res.get("risk", "Low")
        return "Medium"
    except:
        return "Medium"

def predict(input_data):
    animal = input_data.get("animal")
    recent = input_data.get("recent_path", [])
    user = input_data.get("user_location")
    k = int(input_data.get("k_future", 3))
    if not animal or not user:
        return {"error": "missing_fields", "status": "failed"}
    
    model, scaler, err = load_assets(animal)
    if err:
        # Fallback if model missing but we have historical data?
        # For now, fail as per original logic, or maybe return purely historical?
        # Let's keep strict check for now.
        return {"error": err, "status": "failed"}
        
    # Load historical data for this animal
    history_points = load_historical_data(animal)
    
    candidates = generate_candidates(user, recent, k)
    ranked = score_candidates(model, scaler, candidates, history_points)
    chosen = [pt for (pt, _) in ranked[:k]]
    
    if not chosen:
        return {"animal": animal, "predicted_path": [], "risk_level": "Medium", "distance_to_user_km": 0.0, "model_used": "maxent", "safety_override": False, "status": "degraded"}
    
    dist_km = haversine((user["lat"], user["lon"]), (chosen[0][0], chosen[0][1]))
    rf_record = {"animal": animal, "distance_km": float(dist_km), "eventDate": datetime.now().strftime("%Y-%m-%d %H:%M:%S"), "metadata": {"confidence": "high", "scope": "regional"}}
    risk = safe_predict_risk(rf_record)
    
    safety_override = False
    for lat, lon in chosen:
        d = haversine((user["lat"], user["lon"]), (lat, lon))
        if d < 0.5:
            risk = "High"
            safety_override = True
            break
            
    return {"animal": animal, "predicted_path": chosen, "risk_level": risk, "distance_to_user_km": round(float(dist_km), 3), "model_used": "maxent_plus_history", "safety_override": safety_override, "status": "success"}

if __name__ == "__main__":
    try:
        s = ""
        if len(sys.argv) > 1:
            s = sys.argv[1]
        else:
            s = sys.stdin.read()
        if not s:
            print(json.dumps({"error": "no_input", "status": "failed"}))
            sys.exit(0)
        data = json.loads(s)
        out = predict(data)
        print(json.dumps(out))
        sys.stdout.flush()
    except Exception as e:
        print(json.dumps({"error": f"runtime:{str(e)}", "status": "failed"}))
