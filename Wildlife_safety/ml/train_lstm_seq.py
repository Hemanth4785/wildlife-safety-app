import os
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3' # Suppress TF logs
import sys
import json
import numpy as np
import warnings
warnings.filterwarnings("ignore") # Suppress warnings
from datetime import datetime
from sklearn.preprocessing import MinMaxScaler
from tensorflow.keras.models import Sequential
from tensorflow.keras.layers import LSTM, Dense, Dropout
from tensorflow.keras.optimizers import Adam
import joblib

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_PATH = os.path.abspath(os.path.join(BASE_DIR, "..", "backend", "python", "cache", "inat_historical.json"))
MODELS_DIR = os.path.join(BASE_DIR, "models")
MODEL_PATH = os.path.join(MODELS_DIR, "lstm_seq.keras")
SCALER_PATH = os.path.join(MODELS_DIR, "gps_scaler_seq.pkl")
WINDOW = 15

def load_records():
    if not os.path.exists(CACHE_PATH):
        return []
    with open(CACHE_PATH, "r", encoding="utf-8") as f:
        arr = json.load(f)
    out = []
    start = datetime.fromisoformat("2020-01-01T00:00:00")
    for r in arr:
        try:
            d = datetime.fromisoformat(str(r.get("eventDate"))[:19])
        except:
            continue
        if d < start or d > datetime.utcnow():
            continue
        lat = float(r.get("lat"))
        lon = float(r.get("lon"))
        if not (8.0 <= lat <= 13.5 and 76.0 <= lon <= 80.5):
            continue
        out.append({"animal": str(r.get("scientific_name") or r.get("animal") or ""),
                    "lat": lat, "lon": lon, "ts": d.timestamp()})
    return out

def build_dataset(records):
    if not records:
        return None, None, None
    records = sorted(records, key=lambda r: r["ts"])
    coords_all = np.array([[r["lat"], r["lon"]] for r in records], dtype=np.float32)
    scaler = MinMaxScaler()
    scaler.fit(coords_all)
    X, y = [], []
    by_animal = {}
    for r in records:
        k = r["animal"].strip().lower() or "unknown"
        by_animal.setdefault(k, []).append([r["lat"], r["lon"]])
    for k, seq in by_animal.items():
        if len(seq) <= WINDOW:
            continue
        seq = np.array(seq, dtype=np.float32)
        seq_scaled = scaler.transform(seq)
        for i in range(len(seq_scaled) - WINDOW):
            X.append(seq_scaled[i:i+WINDOW])
            y.append(seq_scaled[i+WINDOW])
    if not X:
        return None, None, None
    return np.array(X, dtype=np.float32), np.array(y, dtype=np.float32), scaler

def train_model(X, y, model_path):
    model = Sequential()
    model.add(LSTM(64, return_sequences=True, input_shape=(WINDOW, 2)))
    model.add(Dropout(0.2))
    model.add(LSTM(64))
    model.add(Dropout(0.2))
    model.add(Dense(32, activation="relu"))
    model.add(Dense(2, activation="linear"))
    model.compile(optimizer=Adam(learning_rate=1e-3), loss="mse")
    model.fit(X, y, epochs=25, batch_size=64, validation_split=0.2, verbose=0)
    model.save(model_path)
    print(f"Saved: {model_path}")

def main():
    os.makedirs(MODELS_DIR, exist_ok=True)
    recs = load_records()
    
    # 1. Build global dataset for fallback model
    X_all, y_all, scaler = build_dataset(recs)
    if X_all is not None:
        joblib.dump(scaler, SCALER_PATH)
        print("Training global fallback model...")
        train_model(X_all, y_all, MODEL_PATH)
    
    # 2. Train species-specific models
    by_animal = {}
    for r in recs:
        k = r["animal"].strip().lower().replace(" ", "_") or "unknown"
        by_animal.setdefault(k, []).append(r)
    
    for species, s_recs in by_animal.items():
        if len(s_recs) <= WINDOW + 10: # Minimum data threshold
            continue
        
        print(f"Training species-specific model for: {species}")
        # Re-use global scaler for consistency
        X, y = [], []
        coords = np.array([[r["lat"], r["lon"]] for r in s_recs], dtype=np.float32)
        seq_scaled = scaler.transform(coords)
        for i in range(len(seq_scaled) - WINDOW):
            X.append(seq_scaled[i:i+WINDOW])
            y.append(seq_scaled[i+WINDOW])
            
        if X:
            s_model_path = os.path.join(MODELS_DIR, f"lstm_{species}.keras")
            train_model(np.array(X), np.array(y), s_model_path)

if __name__ == "__main__":
    main()
