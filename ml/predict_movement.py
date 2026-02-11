
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
import pandas as pd
from datetime import datetime
import warnings

# Suppress TensorFlow and other logs
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3' 
os.environ['PYTHONWARNINGS'] = 'ignore'
os.environ['AUTOGRAPH_VERBOSITY'] = '0'
warnings.filterwarnings("ignore")

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

def load_historical_data(animal):
    """Loads historical data for the specific animal from local cache."""
    if not os.path.exists(CACHE_PATH):
        return []
    try:
        with open(CACHE_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
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
    except Exception:
        return []

def load_lstm_model(animal):
    """Loads species-specific or generic fallback LSTM model (.keras)."""
    try:
        from tensorflow.keras.models import load_model
    except ImportError:
        return None, "tensorflow_missing"
    
    animal_file = f"lstm_{animal.replace(' ', '_')}.keras"
    path = os.path.join(LSTM_MODEL_DIR, animal_file)
    
    if os.path.exists(path):
        try:
            return load_model(path), "species_specific"
        except Exception:
            pass
    
    generic_path = os.path.join(LSTM_MODEL_DIR, "lstm_generic.keras")
    if os.path.exists(generic_path):
        try:
            return load_model(generic_path), "generic"
        except Exception:
            pass
        
    return None, None

def predict_future_risk(input_data):
    """
    1. Predicts next K future locations via LSTM.
    2. Validates against historical corridors.
    3. Classifies risk via Random Forest.
    """
    # 1. Validation
    animal = input_data.get('animal')
    recent_path = input_data.get('recent_path')
    user_location = input_data.get('user_location')
    k_future = input_data.get('k_future', 3)
    
    if not animal or not recent_path or not user_location:
        return {
            "error": "Missing required fields: animal, recent_path, and user_location",
            "status": "failed"
        }

    # Load Historical Context
    history_points = load_historical_data(animal)
    has_history = len(history_points) > 0

    if len(recent_path) < WINDOW_SIZE:
        # Fallback Logic
        try:
            last_lat, last_lon = float(recent_path[-1][0]), float(recent_path[-1][1])
            dist_km = haversine(user_location['lat'], user_location['lon'], last_lat, last_lon)
        except Exception:
            dist_km = 0.0

        rf_record = {
            "animal": animal,
            "distance_km": float(dist_km),
            "eventDate": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "metadata": input_data.get('metadata', {"confidence": "medium", "scope": "regional"})
        }

        try:
            rf_result = predict_risk(rf_record)
            final_risk = rf_result.get('risk', 'Medium')
        except Exception:
            final_risk = "Medium"

        return {
            "error": f"Insufficient path history.",
            "status": "degraded",
            "animal": animal,
            "predicted_path": [],
            "risk_level": final_risk,
            "distance_to_user_km": round(float(dist_km), 3),
            "model_used": "skipped"
        }

    try:
        if not os.path.exists(SCALER_PATH):
            return {"error": f"Scaler model missing at {SCALER_PATH}", "status": "failed"}
            
        scaler = joblib.load(SCALER_PATH)
        model, model_used = load_lstm_model(animal)
        
        if not model:
            if model_used == "tensorflow_missing":
                return {"error": "TensorFlow not installed", "status": "failed"}
            return {"error": "No trained LSTM models found", "status": "degraded"}

        # Recursive multi-step prediction
        predicted_path = []
        path_array = np.array([[float(p[0]), float(p[1])] for p in recent_path])
        
        deltas = np.diff(path_array, axis=0)
        
        if len(deltas) < WINDOW_SIZE:
            missing = WINDOW_SIZE - len(deltas)
            if len(deltas) > 0:
                padding = np.tile(deltas[-1], (missing, 1))
                deltas = np.vstack([padding, deltas])
            else:
                deltas = np.zeros((WINDOW_SIZE, 2))

        current_sequence = deltas[-WINDOW_SIZE:]
        last_gps = path_array[-1]
        
        for _ in range(k_future):
            lstm_input = scaler.transform(current_sequence.reshape(-1, 2)).reshape(1, WINDOW_SIZE, 2)
            pred_scaled_delta = model.predict(lstm_input, verbose=0)
            pred_delta = scaler.inverse_transform(pred_scaled_delta)[0]
            
            # Historical Bias (Simple Gravity Model)
            # If there's a nearby historical cluster, slightly pull the prediction towards it
            if has_history:
                next_raw = last_gps + pred_delta
                # Find nearest historical point
                nearest_pt = None
                min_h_dist = float('inf')
                for hp in history_points:
                    d = np.sqrt((hp[0]-next_raw[0])**2 + (hp[1]-next_raw[1])**2) # Euclidian for speed
                    if d < min_h_dist:
                        min_h_dist = d
                        nearest_pt = hp
                
                # If nearest point is close (e.g. within ~1km approx 0.01 deg), nudge
                if nearest_pt and min_h_dist < 0.01:
                    # Nudge 10% towards history
                    nudge_vector = np.array(nearest_pt) - next_raw
                    pred_delta += nudge_vector * 0.1
            
            next_gps = last_gps + pred_delta
            predicted_path.append([float(next_gps[0]), float(next_gps[1])])
            
            last_gps = next_gps
            current_sequence = np.vstack([current_sequence[1:], pred_delta])

        next_lat, next_lon = predicted_path[0]
        dist_km = haversine(user_location['lat'], user_location['lon'], next_lat, next_lon)
        
        rf_record = {
            "animal": animal,
            "distance_km": dist_km,
            "eventDate": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "metadata": input_data.get('metadata', {"confidence": "high", "scope": "regional"})
        }
        
        try:
            rf_result = predict_risk(rf_record)
            final_risk = rf_result.get('risk', 'Low')
        except Exception:
            final_risk = "Medium"
            
        safety_override = False
        for p_lat, p_lon in predicted_path:
            p_dist = haversine(user_location['lat'], user_location['lon'], p_lat, p_lon)
            if p_dist < 0.5:
                final_risk = "High"
                safety_override = True
                break
            
        return {
            "animal": animal,
            "predicted_path": predicted_path,
            "risk_level": final_risk,
            "distance_to_user_km": round(float(dist_km), 3),
            "model_used": f"{model_used}_plus_history",
            "safety_override": safety_override,
            "status": "success"
        }

    except Exception as e:
        return {"error": f"Internal prediction logic error: {str(e)}", "status": "failed"}

if __name__ == "__main__":
    devnull = open(os.devnull, 'w')
    old_stdout = sys.stdout
    try:
        input_str = ""
        if len(sys.argv) > 1:
            input_str = sys.argv[1]
        else:
            input_str = sys.stdin.read()
            
        if not input_str:
            print(json.dumps({"error": "No input data provided", "status": "failed"}))
            sys.exit(0)
            
        input_data = json.loads(input_str)
        result = predict_future_risk(input_data)
        print(json.dumps(result))
        sys.stdout.flush()
    except Exception as e:
        print(json.dumps({"error": f"Script execution failed: {str(e)}", "status": "failed"}))
    finally:
        devnull.close()
