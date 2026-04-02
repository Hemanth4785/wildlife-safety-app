import os
import sys
import json
import numpy as np
import joblib
from datetime import datetime
from sklearn.preprocessing import MinMaxScaler
import tensorflow as tf
from tensorflow.keras.models import Sequential
from tensorflow.keras.layers import LSTM, Dense, Dropout
from tensorflow.keras.optimizers import Adam

# --- CONFIG ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(BASE_DIR, "models")
MODEL_PATH = os.path.join(MODELS_DIR, "lstm_seq.keras")
SCALER_PATH = os.path.join(MODELS_DIR, "gps_scaler_seq.pkl")
CACHE_PATH = os.path.abspath(os.path.join(BASE_DIR, "..", "backend", "python", "cache", "inat_historical.json"))
WINDOW = 15

def get_data():
    records = []
    if os.path.exists(CACHE_PATH):
        try:
            with open(CACHE_PATH, "r", encoding="utf-8") as f:
                arr = json.load(f)
            start = datetime.fromisoformat("2020-01-01T00:00:00")
            for r in arr:
                try:
                    d = datetime.fromisoformat(str(r.get("eventDate"))[:19])
                except:
                    continue
                if d < start or d > datetime.utcnow():
                    continue
                try:
                    lat = float(r.get("lat"))
                    lon = float(r.get("lon"))
                except:
                    continue
                if not (8.0 <= lat <= 19.0 and 74.0 <= lon <= 84.0):
                    continue
                records.append([lat, lon])
            print(f"Loaded {len(records)} filtered historical records.")
        except Exception as e:
            print(f"Warning: Could not load cache: {e}")

    if len(records) < 100:
        print("Using synthetic data for training (insufficient historical data)...")
        t = np.linspace(0, 100, 1000)
        lat = 13.0 + 2.0 * np.sin(t/10) + 0.3 * np.random.normal(size=1000)
        lon = 79.0 + 2.0 * np.cos(t/10) + 0.3 * np.random.normal(size=1000)
        records = np.column_stack([lat, lon])
    else:
        records = np.array(records)

    return records

def build_sequences(data):
    scaler = MinMaxScaler()
    scaled_data = scaler.fit_transform(data)
    
    X, y = [], []
    for i in range(len(scaled_data) - WINDOW):
        X.append(scaled_data[i:i+WINDOW])
        y.append(scaled_data[i+WINDOW])
    
    return np.array(X), np.array(y), scaler

def create_model():
    model = Sequential([
        LSTM(64, return_sequences=True, input_shape=(WINDOW, 2)),
        Dropout(0.2),
        LSTM(64),
        Dropout(0.2),
        Dense(32, activation='relu'),
        Dense(2, activation='linear')
    ])
    model.compile(optimizer=Adam(learning_rate=0.001), loss='mse')
    return model

def train():
    os.makedirs(MODELS_DIR, exist_ok=True)
    
    # 1. Prepare Data
    raw_data = get_data()
    X, y, scaler = build_sequences(raw_data)
    print(f"Dataset shape: X={X.shape}, y={y.shape}")

    # 2. Build and Train
    print("Building LSTM model...")
    model = create_model()
    model.summary()
    
    print("Starting training (20 epochs)...")
    model.fit(X, y, epochs=20, batch_size=32, validation_split=0.1, verbose=1)

    # 3. Save Assets
    print(f"Saving model to {MODEL_PATH}...")
    model.save(MODEL_PATH) # Native .keras format
    
    # Also save weights to .h5 for robust cross-platform loading
    weights_path = os.path.join(MODELS_DIR, "lstm_weights.h5")
    model.save_weights(weights_path)
    print(f"Weights saved to {weights_path}")
    
    print(f"Saving scaler to {SCALER_PATH}...")
    joblib.dump(scaler, SCALER_PATH)

    # 4. Final Verification
    print("\n--- Final Verification ---")
    try:
        from tensorflow.keras.models import load_model
        v_model = load_model(MODEL_PATH, compile=False)
        dummy_input = np.random.rand(1, WINDOW, 2).astype(np.float32)
        prediction = v_model.predict(dummy_input, verbose=0)
        print(f"Verification Success!")
        print(f"Input shape: {dummy_input.shape}")
        print(f"Output shape: {prediction.shape}")
        if prediction.shape == (1, 2):
            print("Model output shape is correct (1, 2).")
    except Exception as e:
        print(f"Verification Failed: {e}")

if __name__ == "__main__":
    train()
