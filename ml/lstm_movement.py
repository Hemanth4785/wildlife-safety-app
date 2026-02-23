"""
Wildlife Movement Prediction Module using LSTM.
Compliments the Random Forest risk classifier by predicting future animal locations.

Academic Justifications:
1. LSTM over GRU: 
   LSTM (Long Short-Term Memory) features a dedicated 'Forget Gate' which allows it to 
   regulate what information is discarded. For wildlife movement, where environmental 
   shifts might cause temporary behavioral changes, the LSTM is better at preserving 
   long-term spatial dependencies compared to the more computationally efficient but 
   gate-reduced GRU.
2. Avoiding Bi-LSTM: 
   Bidirectional LSTMs process sequences in both forward and backward directions. 
   While effective for offline text analysis, they are unsuitable for real-time 
   wildlife safety because we cannot 'see' the future movement points during inference. 
   Using Bi-LSTM would introduce look-ahead bias and fail in a live monitoring context.
3. Multi-Algorithm Synergy:
   By separating movement prediction (LSTM) from risk classification (Random Forest), 
   we create a robust safety system. LSTM specializes in non-linear spatial-temporal 
   patterns, while Random Forest excels at feature-based classification. This modularity 
   improves explainability and allows for rule-based safety overrides.
"""

import os
import json
import numpy as np
import pandas as pd
import joblib
from datetime import datetime
from sklearn.preprocessing import MinMaxScaler

# ---------------- CONFIGURATION ---------------- #
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_CACHE_PATH = os.path.abspath(os.path.join(BASE_DIR, "..", "backend", "python", "cache", "inat_historical.json"))
LSTM_MODEL_DIR = os.path.join(BASE_DIR, "models", "lstm")
SCALER_PATH = os.path.join(LSTM_MODEL_DIR, "gps_scaler.pkl")

os.makedirs(LSTM_MODEL_DIR, exist_ok=True)

WINDOW_SIZE = 5 

def prepare_lstm_data(records):
    df = pd.DataFrame(records)
    if df.empty:
        return None, None

    for col in ("lat", "lon"):
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    df["eventDate"] = pd.to_datetime(df.get("eventDate"), errors="coerce", utc=True)
    df["animal"] = df.get("animal").astype(str)

    df = df.dropna(subset=["animal", "lat", "lon", "eventDate"]).copy()
    if df.empty:
        return None, None

    df = df.sort_values(["animal", "eventDate"])
    coords_all = df[["lat", "lon"]].values.astype(np.float32)
    scaler = MinMaxScaler()
    scaler.fit(coords_all)
    joblib.dump(scaler, SCALER_PATH)

    X_all = []
    y_all = []
    for _, group in df.groupby("animal"):
        group = group.drop_duplicates(subset=["eventDate", "lat", "lon"])
        coords = group[["lat", "lon"]].values.astype(np.float32)
        if len(coords) <= WINDOW_SIZE:
            continue
        coords_scaled = scaler.transform(coords).astype(np.float32)
        for i in range(len(coords_scaled) - WINDOW_SIZE):
            X_all.append(coords_scaled[i:i + WINDOW_SIZE])
            y_all.append(coords_scaled[i + WINDOW_SIZE])

    if not X_all:
        return None, None
    return np.array(X_all, dtype=np.float32), np.array(y_all, dtype=np.float32)

def build_lstm_model(input_shape):
    from tensorflow.keras.models import Sequential
    from tensorflow.keras.layers import LSTM, Dense
    
    model = Sequential([
        LSTM(64, input_shape=input_shape, return_sequences=True),
        LSTM(32),
        Dense(16, activation="relu"),
        Dense(2)
    ])
    
    model.compile(optimizer='adam', loss='mse')
    return model

def train_generic_lstm(records, model_path):
    from tensorflow.keras.callbacks import EarlyStopping

    X, y = prepare_lstm_data(records)
    if X is None or y is None:
        raise RuntimeError("Insufficient training data")

    rng = np.random.default_rng(42)
    idx = rng.permutation(len(X))
    X = X[idx]
    y = y[idx]

    split = int(len(X) * 0.8)
    X_train, X_val = X[:split], X[split:]
    y_train, y_val = y[:split], y[split:]

    model = build_lstm_model((WINDOW_SIZE, 2))
    early_stop = EarlyStopping(monitor="val_loss", patience=5, restore_best_weights=True)
    model.fit(
        X_train,
        y_train,
        validation_data=(X_val, y_val),
        epochs=100,
        batch_size=32,
        verbose=1,
        callbacks=[early_stop],
    )
    model.save(model_path)
    return model_path

def main():
    if not os.path.exists(DATA_CACHE_PATH):
        print(f"Data source not found: {DATA_CACHE_PATH}")
        return

    try:
        with open(DATA_CACHE_PATH, "r", encoding="utf-8") as f:
            records = json.load(f)
        
        if not isinstance(records, list) or not records:
            print("Empty data source.")
            return

        model_path = os.path.join(LSTM_MODEL_DIR, "lstm_generic.h5")
        train_generic_lstm(records, model_path)
        print(f"Training Complete. Saved: {model_path} and {SCALER_PATH}")
        
    except Exception as e:
        print(f"Training failed: {e}")

if __name__ == "__main__":
    main()
