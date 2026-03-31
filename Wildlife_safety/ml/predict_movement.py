
"""
LSTM Inference script for Wildlife Movement Prediction.
Combines LSTM (spatial prediction) with Random Forest (risk classification).
Incorporates historical data for context-aware validation.
"""

import sys
import json
import os
import numpy as np
import joblib
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(BASE_DIR)

try:
    from predict_risk import predict_risk
except ImportError:
    def predict_risk(record):
        return {"risk": "Medium"}

# ---------------- CONFIGURATION ---------------- #
LSTM_MODEL_DIR = os.path.join(BASE_DIR, "models", "lstm")
SCALER_PATH = os.path.join(LSTM_MODEL_DIR, "gps_scaler.pkl")
WINDOW_SIZE = 5
CACHE_PATH = os.path.abspath(os.path.join(BASE_DIR, "..", "backend", "python", "cache", "inat_historical.json"))

def haversine(lat1, lon1, lat2, lon2):
    """Calculate distance in KM between two points."""
    lat1, lon1, lat2, lon2 = map(np.radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = np.sin(dlat/2)**2 + np.cos(lat1) * np.cos(lat2) * np.sin(dlon/2)**2
    c = 2 * np.arcsin(np.sqrt(a))
    return 6371 * c

def _species_key(animal):
    s = str(animal or "").strip()
    if not s:
        return ""
    return "_".join(s.replace("/", " ").replace("\\", " ").split())

def load_historical_data(animal):
    """Loads historical data for the specific animal from local cache."""
    if not os.path.exists(CACHE_PATH):
        return []
    try:
        with open(CACHE_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        points = []
        target = str(animal).strip().lower()
        if isinstance(data, list):
            for obs in data:
                a = str(obs.get("animal", "")).strip().lower()
                if a != target:
                    continue
                lat = obs.get("lat")
                lon = obs.get("lon")
                if lat is None or lon is None:
                    continue
                points.append([float(lat), float(lon)])
        return points
    except Exception:
        return []

def load_historical_records(animal):
    if not os.path.exists(CACHE_PATH):
        return []
    try:
        with open(CACHE_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
        target = str(animal).strip().lower()
        out = []
        if isinstance(data, list):
            for obs in data:
                a = str(obs.get("animal", "")).strip().lower()
                if a != target:
                    continue
                lat = obs.get("lat")
                lon = obs.get("lon")
                if lat is None or lon is None:
                    continue
                ds = obs.get("eventDate")
                try:
                    dt = datetime.fromisoformat(str(ds).strip())
                except Exception:
                    dt = None
                out.append((dt, float(lat), float(lon)))
        out.sort(key=lambda x: (x[0] is None, x[0]))
        return out
    except Exception:
        return []

def bearing_deg(lat1, lon1, lat2, lon2):
    lat1r = np.radians(lat1)
    lat2r = np.radians(lat2)
    dlon = np.radians(lon2 - lon1)
    y = np.sin(dlon) * np.cos(lat2r)
    x = np.cos(lat1r) * np.sin(lat2r) - np.sin(lat1r) * np.cos(lat2r) * np.cos(dlon)
    brng = np.degrees(np.arctan2(y, x))
    return float((brng + 360.0) % 360.0)

def signed_angle_delta_deg(a_deg, b_deg):
    d = (b_deg - a_deg + 180.0) % 360.0 - 180.0
    return float(d)

def rotate_delta(dlat, dlon, angle_deg):
    theta = np.radians(angle_deg)
    c = float(np.cos(theta))
    s = float(np.sin(theta))
    return dlat * c - dlon * s, dlat * s + dlon * c

def build_corridor_centroids(records, anchor_lat, anchor_lon, radius_km=50.0, grid_deg=0.02):
    if not records:
        return []
    buckets = {}
    for _, lat, lon in records:
        if haversine(anchor_lat, anchor_lon, lat, lon) > radius_km:
            continue
        key = (int(lat / grid_deg), int(lon / grid_deg))
        buckets.setdefault(key, []).append((lat, lon))
    centroids = []
    for pts in buckets.values():
        if len(pts) < 3:
            continue
        lat_c = float(np.mean([p[0] for p in pts]))
        lon_c = float(np.mean([p[1] for p in pts]))
        centroids.append((lat_c, lon_c))
    return centroids

def nearest_corridor_centroid(centroids, lat, lon):
    if not centroids:
        return None, None
    best = None
    best_d = None
    for clat, clon in centroids:
        d = float(haversine(lat, lon, clat, clon))
        if best_d is None or d < best_d:
            best_d = d
            best = (clat, clon)
    return best, best_d

def species_step_cap_km(animal):
    a = str(animal).strip().lower()
    if "sloth" in a and "bear" in a:
        return 3.0
    if "elephant" in a:
        return 4.0
    if "gaur" in a:
        return 5.0
    if "tiger" in a:
        return 6.0
    return 5.0

def load_lstm_model(animal):
    os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")
    try:
        from tensorflow.keras.models import load_model
    except ImportError:
        return None, "missing_tensorflow"

    key = _species_key(animal)
    candidates = []
    if key:
        candidates.append(os.path.join(LSTM_MODEL_DIR, f"lstm_{key}.h5"))
        candidates.append(os.path.join(LSTM_MODEL_DIR, f"lstm_{key}.keras"))
    candidates.append(os.path.join(LSTM_MODEL_DIR, "lstm_generic.h5"))
    candidates.append(os.path.join(LSTM_MODEL_DIR, "lstm_generic.keras"))

    for p in candidates:
        if not os.path.exists(p):
            continue
        try:
            m = load_model(p, compile=False)
            if key and (p.endswith(f"lstm_{key}.h5") or p.endswith(f"lstm_{key}.keras")):
                return m, "species_specific"
            return m, "generic"
        except Exception:
            continue
    return None, "model_missing"

def _speed_cap_km(animal):
    a = str(animal).strip().lower()
    if "elephant" in a:
        return 6.0
    if "tiger" in a:
        return 10.0
    if "gaur" in a:
        return 5.0
    if "sloth" in a and "bear" in a:
        return 7.0
    return 8.0

def _realism_checks(last_point, predicted_points):
    if not predicted_points or len(predicted_points) == 0:
        return False
    chain = [last_point] + predicted_points
    seg_km = [float(haversine(chain[i][0], chain[i][1], chain[i + 1][0], chain[i + 1][1])) for i in range(len(chain) - 1)]
    if any((not np.isfinite(d)) or d > 15.0 for d in seg_km):
        return True
    if len(chain) >= 4:
        deltas = [(chain[i + 1][0] - chain[i][0], chain[i + 1][1] - chain[i][1]) for i in range(len(chain) - 1)]
        eps = 1e-7
        identical = all(abs(deltas[i][0] - deltas[0][0]) <= eps and abs(deltas[i][1] - deltas[0][1]) <= eps for i in range(1, len(deltas)))
        if identical:
            return True
        bearings = [bearing_deg(chain[i][0], chain[i][1], chain[i + 1][0], chain[i + 1][1]) for i in range(len(chain) - 1)]
        turns = [abs(signed_angle_delta_deg(bearings[i - 1], bearings[i])) for i in range(1, len(bearings))]
        if turns and max(turns) <= 1.0:
            if max(seg_km) - min(seg_km) <= 0.05:
                return True
    return False

def _confidence_score(animal, last_lat, last_lon, history_points, predicted_points):
    try:
        if not history_points:
            return 0.35
        near = []
        for lat, lon in history_points:
            d = haversine(last_lat, last_lon, float(lat), float(lon))
            if np.isfinite(d) and d <= 30.0:
                near.append((float(lat), float(lon)))
        if len(near) < 20:
            base = 0.4
        else:
            clat = float(np.mean([p[0] for p in near]))
            clon = float(np.mean([p[1] for p in near]))
            dists = [float(haversine(p[0], p[1], clat, clon)) for p in near]
            std = float(np.std(dists)) if dists else 50.0
            compact = float(np.exp(-std / 10.0))
            prox = float(np.exp(-float(haversine(last_lat, last_lon, clat, clon)) / 30.0))
            base = 0.25 + 0.45 * compact + 0.30 * prox
        if predicted_points and len(predicted_points) >= 2:
            steps = [float(haversine(predicted_points[i][0], predicted_points[i][1], predicted_points[i + 1][0], predicted_points[i + 1][1])) for i in range(len(predicted_points) - 1)]
            mu = float(np.mean(steps)) if steps else 0.0
            sd = float(np.std(steps)) if steps else 0.0
            stability = 1.0 if mu <= 0 else max(0.0, 1.0 - min(1.0, sd / mu))
        else:
            stability = 0.7
        out = float(base * (0.6 + 0.4 * stability))
        return float(max(0.0, min(1.0, out)))
    except Exception:
        return 0.35


def predict_future_risk(input_data):
    """
    1. Predicts next K future locations via LSTM.
    2. Validates against historical corridors.
    3. Classifies risk via Random Forest.
    """
    try:
        animal = input_data.get('animal')
        recent_path = input_data.get('recent_path')
        user_location = input_data.get('user_location')
        try:
            k_future = int(input_data.get('k_future', 3))
        except Exception:
            k_future = 3
        k_future = max(1, min(k_future, 10))
        
        if not animal or not recent_path or not user_location:
            return {
                "error": "Missing required fields: animal, recent_path, and user_location",
                "status": "failed"
            }

        # Load Historical Context
        history_points = load_historical_data(animal)
        has_history = len(history_points) > 0

        if len(recent_path) < WINDOW_SIZE:
            return {
                "status": "failed",
                "error": "Insufficient path history"
            }

        if not os.path.exists(SCALER_PATH):
            return {"status": "failed", "error": "Model unavailable"}
            
        scaler = joblib.load(SCALER_PATH)
        model, model_used = load_lstm_model(animal)
        
        if not model:
            return {"status": "failed", "error": "Model unavailable"}

        # 2. LSTM Prediction
        path_array = np.array(recent_path[-WINDOW_SIZE:])
        scaled_path = scaler.transform(path_array)
        input_seq = scaled_path.reshape(1, WINDOW_SIZE, 2)

        current_seq = input_seq.copy()
        predictions_scaled = []
        for _ in range(k_future):
            next_step_scaled = model.predict(current_seq, verbose=0)
            next_step_scaled = np.clip(next_step_scaled, 0.0, 1.0)
            predictions_scaled.append(next_step_scaled[0])
            current_seq = np.roll(current_seq, -1, axis=1)
            current_seq[0, -1, :] = next_step_scaled[0]

        lstm_path = scaler.inverse_transform(np.array(predictions_scaled)).tolist()

        recent_last = recent_path[-1]
        recent_prev = recent_path[-2]
        last_lat = float(recent_last[0])
        last_lon = float(recent_last[1])
        prev_lat = float(recent_prev[0])
        prev_lon = float(recent_prev[1])

        cap_km = min(15.0, _speed_cap_km(animal))
        prev_vec = np.array([last_lat - prev_lat, last_lon - prev_lon], dtype=float)
        predicted_points = []
        cur = np.array([last_lat, last_lon], dtype=float)
        for i in range(k_future):
            p = np.array([float(lstm_path[i][0]), float(lstm_path[i][1])], dtype=float)
            pred_vec = p - cur
            blended = 0.7 * prev_vec + 0.3 * pred_vec
            pred_len = float(np.linalg.norm(pred_vec))
            blend_len = float(np.linalg.norm(blended))
            if blend_len > 0 and pred_len > 0:
                blended = blended / blend_len * pred_len
            candidate = cur + blended
            step_km = float(haversine(cur[0], cur[1], candidate[0], candidate[1]))
            if np.isfinite(step_km) and step_km > cap_km and step_km > 0:
                ratio = cap_km / step_km
                candidate = cur + (candidate - cur) * ratio
            prev_vec = candidate - cur
            cur = candidate
            predicted_points.append([float(cur[0]), float(cur[1])])

        history_points = load_historical_data(animal)
        confidence_score = _confidence_score(animal, last_lat, last_lon, history_points, predicted_points)
        degraded = _realism_checks([last_lat, last_lon], predicted_points)
        predicted_path = predicted_points

        # 3. Context Validation & Risk Assessment
        last_pred_lat, last_pred_lon = predicted_path[-1]
        dist_to_user = haversine(user_location['lat'], user_location['lon'], last_pred_lat, last_pred_lon)
        
        safety_override = False
        if has_history:
            min_history_dist = min([haversine(last_pred_lat, last_pred_lon, hp[0], hp[1]) for hp in history_points])
            if min_history_dist < 0.5:
                safety_override = True

        rf_record = {
            "animal": animal,
            "distance_km": float(dist_to_user),
            "eventDate": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "metadata": {
                "lstm_confidence": 0.85,
                "historical_match": safety_override,
                "path_length": len(recent_path)
            }
        }
        
        rf_result = predict_risk(rf_record)
        final_risk = rf_result.get('risk', 'Medium')
        if safety_override and final_risk == 'Low':
            final_risk = 'Medium'

        return {
            "animal": animal,
            "predicted_path": predicted_path,
            "risk_level": final_risk,
            "distance_to_user_km": round(float(dist_to_user), 3),
            "safety_override": safety_override,
            "confidence_score": float(confidence_score),
            "model_used": model_used,
            "status": "degraded" if degraded else "success"
        }

    except Exception as e:
        return {"status": "failed", "error": "Model unavailable"}

if __name__ == "__main__":
    try:
        # Check for command line argument first, then fall back to stdin
        if len(sys.argv) > 1:
            input_str = sys.argv[1]
        else:
            input_str = sys.stdin.read().strip()
        
        if not input_str:
            print(json.dumps({"error": "No input data provided via arguments or stdin", "status": "failed"}))
            sys.exit(0)
        
        try:
            input_data = json.loads(input_str)
        except json.JSONDecodeError as e:
            print(json.dumps({"error": f"Invalid JSON input: {str(e)}", "status": "failed"}))
            sys.exit(0)
            
        result = predict_future_risk(input_data)
        print(json.dumps(result))
        sys.stdout.flush()
    except Exception as e:
        print(json.dumps({"error": f"Script execution failed: {str(e)}", "status": "failed"}))
