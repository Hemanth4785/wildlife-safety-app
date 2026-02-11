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
        try:
            date_val = record.get('eventDate')
            # Fallback to current time if date is missing or invalid
            dt_obj = pd.to_datetime(date_val) if date_val else datetime.now()
            hour = dt_obj.hour
        except:
            hour = 12
            
        dist = float(record.get('distance_km', 0.0))
        animal = record.get('animal', 'unknown')
        
        # Handle flat or nested metadata
        meta = record.get('metadata', {})
        if isinstance(meta, dict):
            confidence = meta.get('confidence', record.get('confidence', 'unknown'))
            scope = meta.get('scope', record.get('scope', 'unknown'))
        else:
            confidence = record.get('confidence', 'unknown')
            scope = record.get('scope', 'unknown')
        
        # 2. Safe Categorical Encoding (matches training pipeline)
        def safe_encode(col, value):
            le = encoders.get(col)
            if not le: return 0
            # Use 'unknown' class if the value wasn't seen during training
            target = value if value in le.classes_ else 'unknown'
            return int(le.transform([target])[0])

        animal_enc = safe_encode('animal', animal)
        conf_enc = safe_encode('confidence', confidence)
        scope_enc = safe_encode('scope', scope)

        # 3. Model Routing
        # Use species-specific model if available, otherwise use the 'Generic' model
        if animal in models and animal != 'unknown':
            model = models[animal]
            # Features: [dist, hour, confidence, scope]
            feature_cols = ['distance_km', 'hour_of_day', 'confidence_encoded', 'scope_encoded']
            features = pd.DataFrame([[dist, hour, conf_enc, scope_enc]], columns=feature_cols)
            model_type = "species_specific"
        else:
            model = models.get('Generic')
            if not model:
                return {"error": "No model found for this animal and no Generic model available.", "status": "failed"}
            # Generic Features: [animal, dist, hour, confidence, scope]
            feature_cols = ['animal_encoded', 'distance_km', 'hour_of_day', 'confidence_encoded', 'scope_encoded']
            features = pd.DataFrame([[animal_enc, dist, hour, conf_enc, scope_enc]], columns=feature_cols)
            model_type = "generic_fallback"

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
    # Handle input from both stdin (preferred for Node.js) and argv (for manual testing)
    try:
        if len(sys.argv) > 1:
            # Manual test: python predict_risk.py '{"animal": "Tiger", ...}'
            input_data = json.loads(sys.argv[1])
        else:
            # Production: Node.js spawnSync sends data via stdin
            # Using read() to ensure we get all data before parsing
            raw_input = sys.stdin.read()
            if not raw_input:
                print(json.dumps({"error": "No input received via stdin", "status": "failed"}))
                sys.stdout.flush()
                sys.exit(1)
            input_data = json.loads(raw_input)
            
        result = predict_risk(input_data)
        # Final output MUST be a single line of valid JSON
        print(json.dumps(result))
        sys.stdout.flush()
        sys.exit(0) # Explicit exit to prevent hanging
    except Exception as e:
        print(json.dumps({"error": f"Invalid JSON input or runtime error: {str(e)}", "status": "failed"}))
        sys.stdout.flush()
        sys.exit(1) # Exit with error status
