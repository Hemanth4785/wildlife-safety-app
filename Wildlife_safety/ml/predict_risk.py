import sys
import json
import os
import warnings
import joblib
import numpy as np
import pandas as pd
from utils import haversine, calculate_time_weight
from water_distance import get_distance_to_water

# Suppress TensorFlow and other logs
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3' 
warnings.filterwarnings("ignore")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_PATH = os.path.join(BASE_DIR, "risk_models.pkl")
ENCODERS_PATH = os.path.join(BASE_DIR, "encoders.pkl")
FEATURE_ORDER_PATH = os.path.join(BASE_DIR, "feature_order.json")

def load_assets():
    if not os.path.exists(MODELS_PATH) or not os.path.exists(ENCODERS_PATH):
        return None, "Assets missing"
    try:
        models = joblib.load(MODELS_PATH)
        encoders = joblib.load(ENCODERS_PATH)
        return (models, encoders), None
    except Exception as e:
        return None, str(e)

def predict_risk_cli(record):
    assets, error_msg = load_assets()
    if not assets:
        return {"error": error_msg, "status": "failed"}
    
    models, encoders = assets
    
    try:
        # Feature: Time Decay
        sighting_date = record.get('sighting_date') or record.get('eventDate')
        time_weight = calculate_time_weight(sighting_date)

        # Feature: Water Distance
        lat, lon = record.get('latitude'), record.get('longitude')
        dwater, water_found = 3.0, False
        if lat is not None and lon is not None:
            dwater = get_distance_to_water(lat, lon)
            water_found = dwater != 3.0

        # Feature: Animal Distance
        dist_km = float(record.get('distance_km', 0.0))
        animal = record.get('animal', 'unknown')

        # Encoding
        le = encoders.get('animal')
        animal_enc = int(le.transform([animal if animal in le.classes_ else 'unknown'])[0]) if le else 0

        # Feature Routing
        vals = {
            'animal_encoded': animal_enc,
            'latitude': float(lat) if lat is not None else 0.0,
            'longitude': float(lon) if lon is not None else 0.0,
            'forest_density': float(record.get('forest_density', 0.5)),
            'distance_to_water': float(dwater),
            'distance_to_road': float(record.get('distance_to_road', 1.0)),
            'human_population': float(record.get('human_population', 100.0)),
            'elevation': float(record.get('elevation', 500.0)),
            'distance_km': float(dist_km),
            'time_weight': float(time_weight),
            'habitat_suitability': float(record.get('habitat_suitability', 0.5))
        }

        # Select Model
        model = models.get('Generic') or models.get('Basic')
        if not model:
            return {"error": "No model found", "status": "failed"}

        # Build features DataFrame in correct order
        feature_order = {}
        if os.path.exists(FEATURE_ORDER_PATH):
            with open(FEATURE_ORDER_PATH, "r") as f:
                feature_order = json.load(f)
        
        cols = feature_order.get('generic', list(vals.keys()))
        features = pd.DataFrame([[vals.get(c, 0.0) for c in cols]], columns=cols)

        # Inference
        risk_class = model.predict(features)[0]
        probs = model.predict_proba(features)[0]
        
        return {
            "risk": str(risk_class),
            "probability": round(float(np.max(probs)), 2),
            "distance_to_animal": round(dist_km, 2),
            "distance_to_water": round(dwater, 2),
            "water_found": water_found,
            "time_weight": round(time_weight, 2),
            "status": "success"
        }
    except Exception as e:
        return {"error": str(e), "status": "failed"}

if __name__ == "__main__":
    try:
        if len(sys.argv) > 1:
            payload = json.loads(sys.argv[1])
            print(json.dumps(predict_risk_cli(payload)))
    except Exception as e:
        print(json.dumps({"status": "failed", "error": str(e)}))
