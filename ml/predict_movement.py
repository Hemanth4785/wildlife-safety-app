"""
LSTM Inference script for Wildlife Movement Prediction.
Combines LSTM (spatial prediction) with Random Forest (risk classification).
"""

import sys
import json
import os
import numpy as np
import joblib
import pandas as pd
from datetime import datetime
import warnings

# Suppress warnings
warnings.filterwarnings("ignore")

# Import Random Forest classifier
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(BASE_DIR)
from predict_risk import predict_risk

# ---------------- CONFIGURATION ---------------- #
LSTM_MODEL_DIR = os.path.join(BASE_DIR, "models", "lstm")
SCALER_PATH = os.path.join(LSTM_MODEL_DIR, "gps_scaler.pkl")

def haversine(lat1, lon1, lat2, lon2):
    """Calculate distance in KM between two points."""
    lat1, lon1, lat2, lon2 = map(np.radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = np.sin(dlat/2)**2 + np.cos(lat1) * np.cos(lat2) * np.sin(dlon/2)**2
    c = 2 * np.arcsin(np.sqrt(a))
    return 6371 * c

def load_lstm_model(animal):
    """Loads species-specific or generic fallback LSTM model."""
    from tensorflow.keras.models import load_model
    
    animal_file = f"{animal.replace(' ', '_')}_lstm.h5"
    path = os.path.join(LSTM_MODEL_DIR, animal_file)
    
    if os.path.exists(path):
        return load_model(path), "species_specific_lstm"
    
    generic_path = os.path.join(LSTM_MODEL_DIR, "generic_lstm.h5")
    if os.path.exists(generic_path):
        return load_model(generic_path), "generic_fallback_lstm"
        
    return None, None

def predict_future_risk(input_data):
    """
    1. Predicts future location via LSTM.
    2. Classifies risk via Random Forest.
    3. Applies safety overrides.
    """
    animal = input_data.get('animal', 'unknown')
    recent_gps = input_data.get('recent_gps', []) # List of [lat, lon]
    user_location = input_data.get('user_location', {"lat": 0, "lon": 0})
    
    if len(recent_gps) < 5:
        return {"error": "Need at least 5 recent GPS points for prediction", "status": "failed"}

    # 1. Prepare data for LSTM
    try:
        scaler = joblib.load(SCALER_PATH)
        recent_array = np.array(recent_gps[-5:]) # Take last 5 points
        scaled_input = scaler.transform(recent_array)
        lstm_input = scaled_input.reshape(1, 5, 2)
        
        model, lstm_type = load_lstm_model(animal)
        if not model:
            return {"error": "No movement models found", "status": "failed"}
            
        # 2. Predict next location
        predicted_scaled = model.predict(lstm_input, verbose=0)
        predicted_gps = scaler.inverse_transform(predicted_scaled)[0]
        pred_lat, pred_lon = predicted_gps[0], predicted_gps[1]
        
        # 3. Calculate distance from USER to PREDICTED location
        dist_km = haversine(user_location['lat'], user_location['lon'], pred_lat, pred_lon)
        
        # 4. Feed into Random Forest
        rf_record = {
            "animal": animal,
            "distance_km": dist_km,
            "eventDate": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "metadata": input_data.get('metadata', {"confidence": "high", "scope": "regional"})
        }
        
        rf_result = predict_risk(rf_record)
        
        # 5. SAFETY OVERRIDE: If < 500m, force HIGH risk
        final_risk = rf_result.get('risk', 'Low')
        safety_override = False
        if dist_km < 0.5:
            final_risk = "High"
            safety_override = True
            
        return {
            "animal": animal,
            "predicted_location": {"lat": float(pred_lat), "lon": float(pred_lon)},
            "risk_level": final_risk,
            "probability": rf_result.get('probability', 0.0),
            "distance_to_user_km": round(float(dist_km), 3),
            "lstm_model": lstm_type,
            "rf_model": rf_result.get('model_used', 'unknown'),
            "safety_override_applied": safety_override,
            "status": "success"
        }

    except Exception as e:
        return {"error": f"Movement prediction failed: {str(e)}", "status": "failed"}

if __name__ == "__main__":
    try:
        input_data = json.load(sys.stdin)
        result = predict_future_risk(input_data)
        print(json.dumps(result))
        sys.stdout.flush()
    except Exception as e:
        print(json.dumps({"error": f"Invalid input: {str(e)}", "status": "failed"}))
