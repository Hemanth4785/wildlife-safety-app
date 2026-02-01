"""
LSTM Inference script for Wildlife Movement Prediction.
Combines LSTM (spatial prediction) with Random Forest (risk classification).

ACADEMIC JUSTIFICATIONS:
- Why LSTM: Chosen for its ability to capture long-term temporal dependencies in non-linear 
  movement patterns. The gate mechanism prevents vanishing gradients, making it safer for 
  multi-step trajectory forecasting.
- Why Random Forest: Retained as the final classifier because it handles discrete feature 
  interactions (distance, species, time of day) with high stability and interpretable results.
- Why No Bi-LSTM: Avoided because bidirectional models require future context to predict 
  past points, which is impossible in a real-time safety system. Bi-LSTM would introduce 
  temporal leakage and non-causal inference.
- Multi-algorithm Design: This hybrid approach separates 'where' (spatial LSTM) from 'risk' 
  (classification RF), creating a 'defense-in-depth' safety architecture.
"""

import sys
import json
import os
import numpy as np
import joblib
import pandas as pd
from datetime import datetime
import warnings

# Suppress TensorFlow and other logs (must be set BEFORE importing ML libs)
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3' 
os.environ['PYTHONWARNINGS'] = 'ignore'
os.environ['AUTOGRAPH_VERBOSITY'] = '0'

# Suppress warnings
warnings.filterwarnings("ignore")

# Import Random Forest classifier
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(BASE_DIR)

try:
    from predict_risk import predict_risk
except ImportError:
    # Define a dummy predict_risk if it cannot be imported
    def predict_risk(record):
        return {"risk": "Medium"}

# ---------------- CONFIGURATION ---------------- #
LSTM_MODEL_DIR = os.path.join(BASE_DIR, "models", "lstm")
SCALER_PATH = os.path.join(LSTM_MODEL_DIR, "gps_scaler.pkl")
WINDOW_SIZE = 5

def haversine(lat1, lon1, lat2, lon2):
    """Calculate distance in KM between two points."""
    lat1, lon1, lat2, lon2 = map(np.radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = np.sin(dlat/2)**2 + np.cos(lat1) * np.cos(lat2) * np.sin(dlon/2)**2
    c = 2 * np.arcsin(np.sqrt(a))
    return 6371 * c

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
    1. Predicts next K future locations via LSTM (recursive).
    2. Classifies risk for the nearest future point via Random Forest.
    3. Applies mandatory human-safety overrides.
    """
    # 1. Validation
    animal = input_data.get('animal')
    recent_path = input_data.get('recent_path')
    user_location = input_data.get('user_location')
    k_future = input_data.get('k_future', 3)
    
    if not animal or not recent_path or not user_location:
        return {
            "error": "Missing required fields: animal, recent_path, and user_location are mandatory",
            "status": "failed"
        }

    if len(recent_path) < WINDOW_SIZE:
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
            "error": f"Insufficient path history. Need at least {WINDOW_SIZE} recent GPS points (received {len(recent_path)})",
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
                return {"error": "TensorFlow not installed in environment", "status": "failed"}
            return {"error": "No trained LSTM models found (species or generic)", "status": "degraded", "animal": animal, "predicted_path": [], "risk_level": "Medium", "distance_to_user_km": 0, "model_used": "skipped"}

        # Recursive multi-step prediction
        predicted_path = []
        # Ensure points are floats and handled correctly
        path_array = np.array([[float(p[0]), float(p[1])] for p in recent_path[-WINDOW_SIZE:]])
        current_sequence = path_array
        
        for _ in range(k_future):
            # Scale input
            scaled_input = scaler.transform(current_sequence)
            lstm_input = scaled_input.reshape(1, WINDOW_SIZE, 2)
            
            # Predict next point
            pred_scaled = model.predict(lstm_input, verbose=0)
            pred_gps = scaler.inverse_transform(pred_scaled)[0]
            
            predicted_path.append([float(pred_gps[0]), float(pred_gps[1])])
            
            # Update sequence for next step (recursive)
            current_sequence = np.vstack([current_sequence[1:], pred_gps])

        # Evaluate risk for the immediate next predicted point
        next_lat, next_lon = predicted_path[0]
        dist_km = haversine(user_location['lat'], user_location['lon'], next_lat, next_lon)
        
        # 4. Feed into Random Forest for classification
        rf_record = {
            "animal": animal,
            "distance_km": dist_km,
            "eventDate": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "metadata": input_data.get('metadata', {"confidence": "high", "scope": "regional"})
        }
        
        try:
            rf_result = predict_risk(rf_record)
            final_risk = rf_result.get('risk', 'Low')
        except Exception as rf_err:
            final_risk = "Medium" # Fallback if RF fails
            
        # 5. SAFETY OVERRIDE (MANDATORY)
        safety_override = False
        
        # Check all predicted points for safety breach
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
            "model_used": model_used,
            "safety_override": safety_override,
            "status": "success"
        }

    except Exception as e:
        return {"error": f"Internal prediction logic error: {str(e)}", "status": "failed"}

if __name__ == "__main__":
    # Suppress all stdout/stderr from libraries during initialization
    devnull = open(os.devnull, 'w')
    old_stdout = sys.stdout
    # We don't redirect sys.stdout yet because we need to print the final JSON
    
    try:
        # Step 2 fix: Support both stdin and command line argument
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
