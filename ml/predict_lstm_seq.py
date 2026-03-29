import os
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3' # Suppress TF logs
import sys
import json
import math
import numpy as np
import warnings
warnings.filterwarnings("ignore") # Suppress warnings
from sklearn.preprocessing import MinMaxScaler
from tensorflow.keras.models import load_model
import joblib
import traceback

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_PATH = os.path.abspath(os.path.join(BASE_DIR, "..", "backend", "python", "cache", "inat_historical.json"))
MODEL_PATH = os.path.join(BASE_DIR, "models", "lstm_seq.keras")
SCALER_PATH = os.path.join(BASE_DIR, "models", "gps_scaler_seq.pkl")
WINDOW = 15

def haversine(lat1, lon1, lat2, lon2):
    R = 6371.0
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dlon/2)**2
    c = 2*math.atan2(math.sqrt(a), math.sqrt(1-a))
    return R*c

def corridor_clamp(lat, lon):
    lat = max(8.0, min(15.5, float(lat)))
    lon = max(74.0, min(84.0, float(lon)))
    return lat, lon

def clamp_to_max_km(base_lat, base_lon, pred_lat, pred_lon, max_km=20.0):
    d = haversine(base_lat, base_lon, pred_lat, pred_lon)
    if not math.isfinite(d) or d <= max_km:
        return pred_lat, pred_lon
    ratio = max_km / d
    lat = base_lat + (pred_lat - base_lat) * ratio
    lon = base_lon + (pred_lon - base_lon) * ratio
    return lat, lon

def load_scaler_or_build():
    if os.path.exists(SCALER_PATH):
        try:
            return joblib.load(SCALER_PATH)
        except:
            pass
    coords = []
    try:
        if os.path.exists(CACHE_PATH):
            with open(CACHE_PATH, "r", encoding="utf-8") as f:
                arr = json.load(f)
            for r in arr:
                try:
                    lat = float(r.get("lat"))
                    lon = float(r.get("lon"))
                except:
                    continue
                if 8.0 <= lat <= 15.5 and 74.0 <= lon <= 84.0:
                    coords.append([lat, lon])
    except:
        pass
    if len(coords) < 100:
        coords = [[11.4, 76.7], [11.5, 76.8], [11.3, 76.6], [11.45, 76.75]]
    scaler = MinMaxScaler()
    scaler.fit(np.array(coords, dtype=np.float32))
    return scaler

def main():
    try:
        # Suppress stderr to avoid polluting stdout and causing parse errors in Node.js
        # But we want to see errors during development, so we'll be careful
        
        s = sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read().strip()
        if not s:
            print(json.dumps({"status":"failed","error":"no_input"})); return
            
        try:
            inp = json.loads(s)
        except Exception as je:
            # Fallback for Windows command line quote issues
            try:
                # Try to fix single quotes to double quotes if it looks like a dictionary string
                fixed_s = s.replace("'", '"')
                inp = json.loads(fixed_s)
            except:
                print(json.dumps({"status":"failed","error": str(je)})); return

        traj = inp.get("trajectory") or []
        animal = inp.get("animal") or "generic"
        steps = int(inp.get("steps", 3))
        
        # Load the best available model
        animal_key = str(animal).strip().lower().replace(" ", "_")
        specific_model_path = os.path.join(BASE_DIR, "models", f"lstm_{animal_key}.keras")
        
        active_model_path = MODEL_PATH
        model_name = "LSTM_Generic"
        
        if os.path.exists(specific_model_path):
            active_model_path = specific_model_path
            model_name = f"LSTM_{animal_key}"
            
        if not os.path.exists(active_model_path):
            print(json.dumps({"status":"failed","error":"model_unavailable"})); return
            
        scaler = load_scaler_or_build()
        # Suppress load_model output
        import contextlib
        with contextlib.redirect_stdout(None):
            model = load_model(active_model_path, compile=False)
        # Convert trajectory to float pairs
        coords_list = []
        for a in traj:
            if isinstance(a, (list, tuple)) and len(a) >= 2:
                try:
                    coords_list.append([float(a[0]), float(a[1])])
                except Exception:
                    pass
        if len(coords_list) == 0:
            print(json.dumps({"status":"failed","error":"invalid_trajectory"})); return
        # Pad to WINDOW length by repeating the first element at the front
        while len(coords_list) < WINDOW:
            coords_list.insert(0, coords_list[0])
        # Ensure correct shape (WINDOW, 2)
        seq = np.array(coords_list[-WINDOW:], dtype=np.float32)
        seq_n = scaler.transform(seq)
        # Reshape to (1, WINDOW, 2) for LSTM
        cur = seq_n.reshape(1, WINDOW, 2)
        last_lat, last_lon = float(seq[-1][0]), float(seq[-1][1])
        out = []
        for _ in range(max(1, min(steps, 10))):
            y_n = model.predict(cur, verbose=0)
            pred_vec = y_n[0]  # shape (2,)
            y = scaler.inverse_transform(pred_vec.reshape(1, -1))[0]
            plat, plon = float(y[0]), float(y[1])
            plat, plon = clamp_to_max_km(last_lat, last_lon, plat, plon, 20.0)
            plat, plon = corridor_clamp(plat, plon)
            out.append({"lat": plat, "lon": plon})
            last_lat, last_lon = plat, plon
            y_scaled = scaler.transform(np.array([[plat, plon]], dtype=np.float32))[0]
            # shift window left and append latest scaled prediction at the end
            cur[:, :-1, :] = cur[:, 1:, :]
            cur[:, -1, :] = y_scaled
        print(json.dumps({"status":"success", "model_used": model_name, "predictions": out}))
    except Exception as e:
        traceback.print_exc()
        print(json.dumps({"status":"failed","error": str(e)}))

if __name__ == "__main__":
    main()
