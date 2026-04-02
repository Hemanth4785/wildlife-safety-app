import os
import json
import logging
import joblib
import asyncio
import numpy as np
import pandas as pd
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from tensorflow.keras.models import load_model
from sklearn.preprocessing import MinMaxScaler

# Use relative imports for the ml package
try:
    from .utils import haversine, calculate_time_weight
    from .water_distance import get_distance_to_water_async
except ImportError:
    # Fallback for direct script execution
    from utils import haversine, calculate_time_weight
    from water_distance import get_distance_to_water_async

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("ML-Service")

# --- GLOBAL CONFIG & PATHS ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
logger.info(f"BASE_DIR: {BASE_DIR}")

MODELS_PATH = os.path.join(BASE_DIR, "risk_models.pkl")
ENCODERS_PATH = os.path.join(BASE_DIR, "encoders.pkl")
FEATURE_ORDER_PATH = os.path.join(BASE_DIR, "feature_order.json")

# LSTM and MaxEnt assets - Using Absolute Paths for Render
LSTM_GENERIC_PATH = os.path.abspath(os.path.join(BASE_DIR, "models", "lstm_seq.keras"))
LSTM_WEIGHTS_PATH = os.path.abspath(os.path.join(BASE_DIR, "models", "lstm_weights.h5"))
SCALER_PATH = os.path.join(BASE_DIR, "models", "gps_scaler_seq.pkl")
MAXENT_MODELS_PATH = os.path.join(BASE_DIR, "models", "maxent", "maxent_models.pkl")
MAXENT_SCALERS_PATH = os.path.join(BASE_DIR, "models", "maxent", "maxent_scalers.pkl")
HISTORICAL_CACHE_PATH = os.path.join(BASE_DIR, "..", "backend", "python", "cache", "inat_historical.json")

# Global state for ML assets
assets = {
    "status": "loading",
    "risk_models": None,
    "encoders": None,
    "feature_order": None,
    "lstm_generic": None,
    "gps_scaler": None,
    "maxent_models": None,
    "maxent_scalers": None,
    "historical_data": {} # animal -> list of [lat, lon]
}

async def load_ml_assets():
    """Background task to load heavy ML models without blocking port binding."""
    logger.info("Starting background loading of ML assets...")
    try:
        # 1. Load Risk Models (Random Forest)
        if os.path.exists(MODELS_PATH) and os.path.exists(ENCODERS_PATH):
            assets['risk_models'] = joblib.load(MODELS_PATH)
            assets['encoders'] = joblib.load(ENCODERS_PATH)
            logger.info("Risk models (Random Forest) and encoders loaded successfully.")
        else:
            logger.warning(f"Risk models or encoders missing at {MODELS_PATH}")
        
        # 2. Load Feature Order
        if os.path.exists(FEATURE_ORDER_PATH):
            with open(FEATURE_ORDER_PATH, "r", encoding="utf-8") as f:
                assets['feature_order'] = json.load(f)
            logger.info("Feature order config loaded.")

        # 3. Load LSTM and Scaler
        logger.info(f"Attempting to load LSTM from: {LSTM_WEIGHTS_PATH}")
        logger.info(f"Weights file exists: {os.path.exists(LSTM_WEIGHTS_PATH)}")

        if os.path.exists(LSTM_WEIGHTS_PATH):
            try:
                import tensorflow as tf
                # Rebuild architecture exactly as trained to bypass serialization bugs
                model = tf.keras.Sequential([
                    tf.keras.layers.LSTM(64, return_sequences=True, input_shape=(15, 2)),
                    tf.keras.layers.Dropout(0.2),
                    tf.keras.layers.LSTM(64),
                    tf.keras.layers.Dropout(0.2),
                    tf.keras.layers.Dense(32, activation='relu'),
                    tf.keras.layers.Dense(2, activation='linear')
                ])
                model.load_weights(LSTM_WEIGHTS_PATH)
                
                # Validation: check input shape and run dummy inference
                dummy_input = np.zeros((1, 15, 2), dtype=np.float32)
                model.predict(dummy_input, verbose=0)
                
                assets['lstm_generic'] = model
                logger.info(f"LSTM model verified and loaded successfully using weights. Input shape: {model.input_shape}")
            except Exception as e:
                logger.error(f"LSTM failed to load or verify via weights: {e}")
                assets['lstm_generic'] = None # Safe fallback
        else:
            logger.warning(f"LSTM weights file not found at {LSTM_WEIGHTS_PATH}")

        if os.path.exists(SCALER_PATH):
            assets['gps_scaler'] = joblib.load(SCALER_PATH)
            logger.info("GPS Scaler for LSTM loaded successfully.")

        # 4. Load MaxEnt
        if os.path.exists(MAXENT_MODELS_PATH) and os.path.exists(MAXENT_SCALERS_PATH):
            assets['maxent_models'] = joblib.load(MAXENT_MODELS_PATH)
            assets['maxent_scalers'] = joblib.load(MAXENT_SCALERS_PATH)
            logger.info("MaxEnt models and scalers loaded successfully.")

        # 5. Load Historical Data
        if os.path.exists(HISTORICAL_CACHE_PATH):
            try:
                with open(HISTORICAL_CACHE_PATH, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                grouped = {}
                for item in data:
                    animal = (item.get('animal') or item.get('species') or 'generic').lower()
                    if animal not in grouped: grouped[animal] = []
                    try:
                        grouped[animal].append([float(item['lat']), float(item['lon'])])
                    except: continue
                assets['historical_data'] = grouped
                logger.info(f"Historical data loaded for {len(grouped)} species.")
            except Exception as e:
                logger.error(f"Historical data load failed: {str(e)}")

        assets["status"] = "ready"
        logger.info("All ML assets loaded successfully. Service is fully production-ready.")

    except Exception as e:
        assets["status"] = "error"
        logger.error(f"CRITICAL: Failed to load ML assets: {str(e)}")

def calculate_suitability(animal: str, lat: float, lon: float) -> float:
    """Calculates habitat suitability score using MaxEnt logic."""
    if assets["status"] != "ready": return 0.5
    animal_key = animal.lower()
    model_score = 0.5
    if assets['maxent_models'] and assets['maxent_scalers']:
        model = assets['maxent_models'].get(animal) or assets['maxent_models'].get("Generic")
        scaler = assets['maxent_scalers'].get(animal) or assets['maxent_scalers'].get("Generic")
        if model and scaler:
            try:
                X = np.array([[lat, lon]])
                Xs = scaler.transform(X)
                model_score = float(model.predict_proba(Xs)[0][1])
            except: pass
    density_score = 0.0
    history = assets['historical_data'].get(animal_key) or assets['historical_data'].get('generic')
    if history:
        min_dist = float('inf')
        for plat, plon in history:
            d = haversine((lat, lon), (plat, plon))
            if d < min_dist: min_dist = d
        density_score = float(np.exp(-min_dist)) if min_dist != 0 else 1.0
    return round(0.7 * model_score + 0.3 * density_score, 3)

@asynccontextmanager
async def lifespan(app: FastAPI):
    asyncio.create_task(load_ml_assets())
    yield
    assets.clear()
    logger.info("ML Service shutting down...")

app = FastAPI(
    title="Wildlife Safety ML Service",
    description="Production-ready FastAPI service for Wildlife Risk and Movement Prediction",
    version="1.1.1",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- SCHEMAS ---
class RiskRequest(BaseModel):
    animal: str = Field(default="Elephant", description="Animal species name")
    latitude: Optional[float] = Field(None, ge=-90, le=90)
    longitude: Optional[float] = Field(None, ge=-180, le=180)
    distance_km: float = Field(0.0, ge=0)
    sighting_date: Optional[str] = None
    forest_density: Optional[float] = Field(None, ge=0, le=1)
    distance_to_road: Optional[float] = None
    human_population: Optional[float] = None
    elevation: Optional[float] = None
    habitat_suitability: Optional[float] = None

class PredictionResponse(BaseModel):
    risk: str
    probability: float
    distance_to_animal: float
    distance_to_water: float
    water_found: bool
    time_weight: float
    status: str = "success"
    model_info: Optional[str] = None
    suitability: float = 0.5

class MovementRequest(BaseModel):
    animal: str = "Elephant"
    trajectory: List[List[float]] = Field(..., min_items=1, description="List of [lat, lon] coordinates")
    steps: int = Field(default=3, ge=1, le=10)

class MovementResponse(BaseModel):
    status: str = "success"
    model_used: str
    predictions: List[Dict[str, float]]
    suitability: float = 0.5

# --- BASE ENDPOINTS ---
@app.get("/")
async def root():
    return {
        "message": "Wildlife Safety ML Service is running",
        "status": assets["status"],
        "version": "1.1.1",
        "docs": "/docs"
    }

@app.get("/health")
async def health():
    return {
        "status": "ok" if assets["status"] == "ready" else assets["status"],
        "lstm": "loaded" if assets["lstm_generic"] else "failed",
        "rf": "loaded" if assets["risk_models"] else "failed",
        "maxent": "loaded" if assets["maxent_models"] else "failed",
        "historical": "loaded" if assets["historical_data"] else "failed"
    }

# --- ML ENDPOINTS ---
@app.post("/predict", response_model=PredictionResponse)
@app.post("/predict-risk", response_model=PredictionResponse)
async def predict_risk(req: RiskRequest):
    if assets["status"] != "ready":
        raise HTTPException(status_code=503, detail="Models are still loading.")
    try:
        logger.info(f"Risk prediction requested for {req.animal}")
        models = assets['risk_models']
        encoders = assets['encoders']
        feature_order = assets.get('feature_order', {})
        if not models or not encoders:
            raise HTTPException(status_code=500, detail="Risk models not available")
        time_weight = calculate_time_weight(req.sighting_date)
        dwater, water_found = await get_distance_to_water_async(req.latitude, req.longitude)
        suitability = req.habitat_suitability
        if suitability is None and req.latitude is not None and req.longitude is not None:
            suitability = calculate_suitability(req.animal, req.latitude, req.longitude)
        elif suitability is None: suitability = 0.5
        def safe_encode(col, value):
            le = encoders.get(col)
            if not le: return 0
            target = value if value in le.classes_ else 'unknown'
            return int(le.transform([target])[0])
        animal_enc = safe_encode('animal', req.animal)
        vals = {
            'animal_encoded': animal_enc,
            'latitude': float(req.latitude) if req.latitude is not None else 0.0,
            'longitude': float(req.longitude) if req.longitude is not None else 0.0,
            'forest_density': float(req.forest_density) if req.forest_density is not None else 0.5,
            'distance_to_water': float(dwater),
            'distance_to_road': float(req.distance_to_road) if req.distance_to_road is not None else 1.0,
            'human_population': float(req.human_population) if req.human_population is not None else 100.0,
            'elevation': float(req.elevation) if req.elevation is not None else 500.0,
            'distance_km': float(req.distance_km),
            'time_weight': float(time_weight),
            'habitat_suitability': float(suitability)
        }
        has_env = all(v is not None for v in [req.latitude, req.longitude, req.forest_density])
        if has_env and 'Generic' in models:
            model = models['Generic']; cols = feature_order.get('generic', list(vals.keys())); model_type = "Environmental"
        elif 'Basic' in models:
            model = models['Basic']; cols = feature_order.get('basic', ['animal_encoded', 'distance_km']); model_type = "Basic"
        else: raise HTTPException(status_code=500, detail="No suitable ML model found")
        features = pd.DataFrame([[vals.get(c, 0.0) for c in cols]], columns=cols)
        risk_class = model.predict(features)[0]
        probs = model.predict_proba(features)[0]
        max_prob = float(np.max(probs))
        return PredictionResponse(
            risk=str(risk_class).upper(), probability=round(max_prob, 2), distance_to_animal=round(req.distance_km, 2),
            distance_to_water=round(dwater, 2), water_found=water_found, time_weight=round(time_weight, 2),
            model_info=model_type, suitability=suitability
        )
    except Exception as e:
        logger.exception("Risk prediction failed")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/predict-movement", response_model=MovementResponse)
async def predict_movement(req: MovementRequest):
    if assets["status"] != "ready":
        raise HTTPException(status_code=503, detail="Models are still loading.")
    try:
        logger.info(f"Movement prediction requested for {req.animal} with {len(req.trajectory)} points")
        model = assets['lstm_generic']
        scaler = assets['gps_scaler']
        last_lat, last_lon = req.trajectory[-1]
        current_suitability = calculate_suitability(req.animal, last_lat, last_lon)

        # Fallback handling if LSTM is missing
        if not model or not scaler:
            logger.warning(f"LSTM or Scaler missing. Using Heuristic-Fallback for {req.animal}")
            predictions = []
            for i in range(req.steps):
                last_lat += 0.002; last_lon += 0.002
                predictions.append({"lat": round(last_lat, 5), "lon": round(last_lon, 5)})
            return MovementResponse(model_used="Heuristic-Fallback", predictions=predictions, suitability=current_suitability)

        # Production-safe Preprocessing
        WINDOW = 15
        coords_list = [[float(p[0]), float(p[1])] for p in req.trajectory]
        # Pad to WINDOW length if input is shorter
        while len(coords_list) < WINDOW:
            coords_list.insert(0, coords_list[0])
        
        # Take only last WINDOW points
        seq = np.array(coords_list[-WINDOW:], dtype=np.float32)
        seq_n = scaler.transform(seq)
        cur = seq_n.reshape(1, WINDOW, 2)
        
        predictions = []
        logger.info(f"Executing recursive LSTM inference for {req.steps} steps...")
        for i in range(req.steps):
            y_n = model.predict(cur, verbose=0)
            # Recursive shifting logic: move window left, add latest prediction at end
            y = scaler.inverse_transform(y_n[0].reshape(1, -1))[0]
            plat, plon = float(y[0]), float(y[1])
            predictions.append({"lat": round(plat, 5), "lon": round(plon, 5)})
            
            y_scaled = scaler.transform(np.array([[plat, plon]], dtype=np.float32))[0]
            cur[:, :-1, :] = cur[:, 1:, :] # Shift left
            cur[:, -1, :] = y_scaled        # Add new prediction
        
        return MovementResponse(
            model_used="LSTM",
            predictions=predictions,
            suitability=current_suitability
        )
    except Exception as e:
        logger.exception("Movement prediction failed")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 10000))
    logger.info(f"Starting Production Wildlife ML Service on port {port}")
    uvicorn.run(app, host="0.0.0.0", port=port)
