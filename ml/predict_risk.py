"""
ML Inference script for Wildlife Risk Classification.
This script performs PER-ANIMAL risk assessment using specialized models.
Optimized for Node.js integration with robust error handling and absolute pathing.
"""

import sys
import json
import os
import warnings
from datetime import datetime
from water_distance import get_distance_to_water

# Suppress TensorFlow and other logs (must be set BEFORE importing ML libs)
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3' 
os.environ['PYTHONWARNINGS'] = 'ignore'

# Suppress warnings for cleaner stdout (crucial for Node.js JSON parsing)
warnings.filterwarnings("ignore")

# ---------------- DEPENDENCY CHECK ---------------- #
try:
    import joblib
    import numpy as np
    import pandas as pd
    import sklearn
except ImportError as e:
    # If dependencies are missing, return a JSON error so Node.js can display it
    print(json.dumps({
        "error": f"Missing Python dependencies: {str(e)}. Please run 'pip install joblib pandas scikit-learn'",
        "status": "failed"
    }))
    sys.stdout.flush()
    sys.exit(0)

# ---------------- CONFIGURATION ---------------- #

# Use absolute paths based on the script location to avoid issues when called from different directories
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_PATH = os.path.join(BASE_DIR, "risk_models.pkl")
ENCODERS_PATH = os.path.join(BASE_DIR, "encoders.pkl")
FEATURE_ORDER_PATH = os.path.join(BASE_DIR, "feature_order.json")

def load_assets():
    """
    Safely load the serialized models and encoders.
    Returns (models_dict, encoders_dict) or (None, None) on failure.
    """
    if not os.path.exists(MODELS_PATH):
        return None, f"Models file not found at {MODELS_PATH}"
    if not os.path.exists(ENCODERS_PATH):
        return None, f"Encoders file not found at {ENCODERS_PATH}"
        
    try:
        models = joblib.load(MODELS_PATH)
        encoders = joblib.load(ENCODERS_PATH)
        return (models, encoders), None
    except Exception as e:
        return None, f"Error loading .pkl files: {str(e)}"

def predict_risk(record):
    """
    Core prediction logic.
    Supports species-specific models with a generic fallback.
    """
    assets, error_msg = load_assets()
    if not assets:
        return {"error": error_msg, "status": "failed"}
    
    models, encoders = assets

    try:
        # 1. Feature Extraction & Validation
        dist = float(record.get('distance_km', 0.0))
        animal = record.get('animal', 'unknown')
        
        # 2. Safe Categorical Encoding (matches training pipeline)
        def safe_encode(col, value):
            le = encoders.get(col)
            if not le: return 0
            # Use 'unknown' class if the value wasn't seen during training
            target = value if value in le.classes_ else 'unknown'
            return int(le.transform([target])[0])

        animal_enc = safe_encode('animal', animal)
        
        # 3. Feature Routing: Prefer Environmental Vector, fallback to Basic
        feature_order = None
        try:
            if os.path.exists(FEATURE_ORDER_PATH):
                with open(FEATURE_ORDER_PATH, "r", encoding="utf-8") as f:
                    feature_order = json.load(f)
        except:
            feature_order = None
        
        lat = record.get('latitude'); lon = record.get('longitude')
        fd = record.get('forest_density')
        
        # Dynamic calculation of distance to water using Overpass API
        if lat is not None and lon is not None:
            dwater = get_distance_to_water(float(lat), float(lon))
        else:
            dwater = record.get('distance_to_water')
            
        droad = record.get('distance_to_road'); pop = record.get('human_population')
        elev = record.get('elevation')
        has_env = all(x is not None for x in [lat, lon, fd, dwater, droad, pop, elev])
        
        if has_env and ('Generic' in models):
            model = models['Generic']
            env_cols = ['animal_encoded','latitude','longitude','forest_density','distance_to_water','distance_to_road','human_population','elevation','distance_km']
            # Use feature_order.json if available
            if feature_order and 'generic' in feature_order:
                env_cols = feature_order['generic']
            vals = {
                'animal_encoded': animal_enc,
                'latitude': float(lat),
                'longitude': float(lon),
                'forest_density': float(fd),
                'distance_to_water': float(dwater),
                'distance_to_road': float(droad),
                'human_population': float(pop),
                'elevation': float(elev),
                'distance_km': float(dist)
            }
            row = [vals.get(c, 0.0) for c in env_cols]
            features = pd.DataFrame([row], columns=env_cols)
            model_type = "random_forest_environmental"
        elif 'Basic' in models:
            model = models['Basic']
            basic_cols = ['animal_encoded','distance_km']
            if feature_order and 'basic' in feature_order:
                basic_cols = feature_order['basic']
            features = pd.DataFrame([[animal_enc, dist]], columns=basic_cols)
            model_type = "random_forest_basic"
        else:
            # Fallback: if per-species exists, use it; else error
            if animal in models and animal != 'unknown':
                model = models[animal]
                species_cols = ['distance_km'] + ([] if feature_order is None else [])
                features = pd.DataFrame([[dist]], columns=['distance_km'])
                model_type = "species_specific"
            else:
                return {"error": "No suitable model available", "status": "failed"}

        # 4. Inference
        risk_class = model.predict(features)[0]
        probabilities = model.predict_proba(features)[0]
        max_prob = float(np.max(probabilities))
        
        return {
            "animal": animal,
            "risk": risk_class,
            "probability": round(max_prob, 2),
            "distance": round(dist, 2),
            "model_used": model_type,
            "status": "success"
        }

    except Exception as e:
        return {"error": f"Inference runtime error: {str(e)}", "status": "failed"}

if __name__ == "__main__":
    # Strict argv-only input handling to avoid stdin hangs
    try:
        if len(sys.argv) < 2:
            print(json.dumps({"status": "error", "message": "missing input"}))
            sys.stdout.flush()
            sys.exit(1)
        try:
            payload = json.loads(sys.argv[1])
        except Exception as e:
            print(json.dumps({"status": "error", "message": str(e)}))
            sys.stdout.flush()
            sys.exit(1)
        # Minimal field extraction (optional): ensure primary fields exist
        _animal = payload.get("animal")
        _distance = payload.get("distance_km")
        # Run prediction
        result = predict_risk(payload)
        # Always print single-line JSON and exit quickly
        print(json.dumps(result))
        sys.stdout.flush()
        sys.exit(0)
    except Exception as e:
        print(json.dumps({"status": "error", "message": f"runtime error: {str(e)}"}))
        sys.stdout.flush()
        sys.exit(1)
