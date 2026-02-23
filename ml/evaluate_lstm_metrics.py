import os
import json
import numpy as np
import pandas as pd
import joblib
from sklearn.preprocessing import MinMaxScaler
from tensorflow.keras.models import Sequential
from tensorflow.keras.layers import LSTM, Dense
from tensorflow.keras.callbacks import EarlyStopping

# ---------------- CONFIGURATION ---------------- #
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_CACHE_PATH = os.path.abspath(os.path.join(BASE_DIR, "..", "backend", "python", "cache", "inat_historical.json"))
WINDOW_SIZE = 5

# Heuristics for valid path segments
MAX_TIME_GAP_HOURS = 48
MAX_DIST_KM = 50

def haversine_np(lat1, lon1, lat2, lon2):
    lat1, lon1, lat2, lon2 = map(np.radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1 
    dlon = lon2 - lon1 
    a = np.sin(dlat/2)**2 + np.cos(lat1) * np.cos(lat2) * np.sin(dlon/2)**2
    c = 2 * np.arcsin(np.sqrt(a)) 
    r = 6371 
    return c * r

def prepare_data(records):
    df = pd.DataFrame(records)
    if df.empty: return None, None, None

    for col in ("lat", "lon"):
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    df["eventDate"] = pd.to_datetime(df.get("eventDate"), errors="coerce", utc=True)
    df["animal"] = df.get("animal").astype(str)
    df = df.dropna(subset=["animal", "lat", "lon", "eventDate"]).copy()
    
    if df.empty: return None, None, None

    df = df.sort_values(["animal", "eventDate"])
    
    # Filter for valid segments
    valid_sequences = []
    
    for _, group in df.groupby("animal"):
        group = group.sort_values("eventDate")
        # Calculate deltas
        group['time_diff'] = group['eventDate'].diff().dt.total_seconds() / 3600.0
        # Simple lat/lon diff as proxy for distance check pre-calculation
        group['dist_proxy'] = np.sqrt(group['lat'].diff()**2 + group['lon'].diff()**2)
        
        # Identify breaks
        # A break occurs if time gap is too large OR distance is too large
        # We start a new segment after every break
        group['new_segment'] = ((group['time_diff'] > MAX_TIME_GAP_HOURS) | (group['dist_proxy'] > 0.5)).cumsum().fillna(0)
        
        for _, segment in group.groupby('new_segment'):
            if len(segment) > WINDOW_SIZE:
                valid_sequences.append(segment[["lat", "lon"]].values.astype(np.float32))

    if not valid_sequences:
        print("No valid movement sequences found (gaps too large). Evaluating on raw sorted data as fallback.")
        # Fallback to previous logic if strict filtering leaves nothing
        coords_all = df[["lat", "lon"]].values.astype(np.float32)
        scaler = MinMaxScaler()
        scaler.fit(coords_all)
        X_all, y_all = [], []
        for _, group in df.groupby("animal"):
            coords = group[["lat", "lon"]].values.astype(np.float32)
            if len(coords) <= WINDOW_SIZE: continue
            scaled = scaler.transform(coords)
            for i in range(len(scaled) - WINDOW_SIZE):
                X_all.append(scaled[i:i+WINDOW_SIZE])
                y_all.append(scaled[i+WINDOW_SIZE])
        return np.array(X_all), np.array(y_all), scaler

    # Process valid sequences
    # We need a global scaler for the whole dataset range
    all_coords = np.vstack(valid_sequences)
    scaler = MinMaxScaler()
    scaler.fit(all_coords)
    
    X_all = []
    y_all = []
    
    for seq in valid_sequences:
        seq_scaled = scaler.transform(seq)
        for i in range(len(seq_scaled) - WINDOW_SIZE):
            X_all.append(seq_scaled[i:i + WINDOW_SIZE])
            y_all.append(seq_scaled[i + WINDOW_SIZE])
            
    return np.array(X_all), np.array(y_all), scaler

def build_model(input_shape):
    model = Sequential([
        LSTM(64, input_shape=input_shape, return_sequences=True),
        LSTM(32),
        Dense(16, activation="relu"),
        Dense(2)
    ])
    model.compile(optimizer='adam', loss='mse')
    return model

def evaluate():
    if not os.path.exists(DATA_CACHE_PATH):
        print("Data not found.")
        return

    with open(DATA_CACHE_PATH, "r", encoding="utf-8") as f:
        records = json.load(f)

    X, y, scaler = prepare_data(records)
    if X is None or len(X) < 10:
        print("Insufficient data after filtering.")
        return

    # Train/Test Split (80/20)
    split_idx = int(len(X) * 0.8)
    X_train, X_test = X[:split_idx], X[split_idx:]
    y_train, y_test = y[:split_idx], y[split_idx:]

    print(f"Training LSTM on {len(X_train)} samples...")
    model = build_model((WINDOW_SIZE, 2))
    early_stop = EarlyStopping(monitor='val_loss', patience=5, restore_best_weights=True)
    
    model.fit(
        X_train, y_train,
        validation_split=0.1,
        epochs=20,
        batch_size=16,
        verbose=0,
        callbacks=[early_stop]
    )

    print("Evaluating...")
    y_pred_scaled = model.predict(X_test, verbose=0)
    y_test_real = scaler.inverse_transform(y_test)
    y_pred_real = scaler.inverse_transform(y_pred_scaled)
    
    distances_km = haversine_np(
        y_test_real[:, 0], y_test_real[:, 1],
        y_pred_real[:, 0], y_pred_real[:, 1]
    )
    
    ade_km = np.mean(distances_km)
    rmse_km = np.sqrt(np.mean(distances_km**2))
    
    print("\nTable Y: Trajectory Prediction Performance (LSTM)\n")
    print("| Metric | Value | Unit |")
    print("|--------|-------|------|")
    print(f"| **ADE (Avg Displacement Error)** | {ade_km:.4f} | km |")
    print(f"| **RMSE (Root Mean Sq Error)** | {rmse_km:.4f} | km |")

if __name__ == "__main__":
    evaluate()
