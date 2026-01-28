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
DATA_CACHE_PATH = os.path.abspath(os.path.join(BASE_DIR, "..", "backend", "python", "cache", "inat_live.json"))
LSTM_MODEL_DIR = os.path.join(BASE_DIR, "models", "lstm")
SCALER_PATH = os.path.join(LSTM_MODEL_DIR, "gps_scaler.pkl")

os.makedirs(LSTM_MODEL_DIR, exist_ok=True)

# Sliding window size (last N points to predict next 1)
WINDOW_SIZE = 5 
MIN_SAMPLES_FOR_LSTM = 15

def prepare_lstm_data(records):
    """
    Groups iNaturalist sightings by species, sorts by time, 
    and creates (X, y) sliding window sequences.
    """
    df = pd.DataFrame(records)
    if 'eventDate' not in df.columns:
        return {}, None
        
    df['eventDate'] = pd.to_datetime(df['eventDate'])
    df = df.sort_values(['animal', 'eventDate'])
    
    scaler = MinMaxScaler(feature_range=(0, 1))
    df[['lat_scaled', 'lon_scaled']] = scaler.fit_transform(df[['lat', 'lon']])
    
    # Save scaler for inference
    joblib.dump(scaler, SCALER_PATH)
    
    sequences = {}
    
    for animal, group in df.groupby('animal'):
        if len(group) < MIN_SAMPLES_FOR_LSTM:
            continue
            
        group_data = group[['lat_scaled', 'lon_scaled']].values
        X_animal, y_animal = [], []
        
        for i in range(len(group_data) - WINDOW_SIZE):
            X_animal.append(group_data[i:i + WINDOW_SIZE])
            y_animal.append(group_data[i + WINDOW_SIZE])
            
        if X_animal:
            sequences[animal] = (np.array(X_animal), np.array(y_animal))
            
    return sequences, scaler

def build_lstm_model(input_shape):
    """
    Standard LSTM architecture for spatial prediction.
    """
    from tensorflow.keras.models import Sequential
    from tensorflow.keras.layers import LSTM, Dense, Dropout
    
    model = Sequential([
        LSTM(64, input_shape=input_shape, return_sequences=True),
        Dropout(0.2),
        LSTM(32),
        Dropout(0.2),
        Dense(2) # Output: [lat_scaled, lon_scaled]
    ])
    
    model.compile(optimizer='adam', loss='mse')
    return model

def train_lstm_models(records):
    """
    Trains species-specific or generic LSTM models.
    """
    from tensorflow.keras.callbacks import EarlyStopping
    
    seqs, scaler = prepare_lstm_data(records)
    if not seqs:
        print("Insufficient data for LSTM training.")
        return []
        
    trained_models = []
    all_X, all_y = [], []
    
    # 1. Train Species-Specific Models
    for animal, (X, y) in seqs.items():
        print(f"\n[SPECIES] Training LSTM for {animal} (Samples: {len(X)})...")
        model = build_lstm_model((WINDOW_SIZE, 2))
        
        early_stop = EarlyStopping(monitor='loss', patience=5, restore_best_weights=True)
        history = model.fit(X, y, epochs=50, batch_size=16, verbose=0, callbacks=[early_stop])
        
        final_loss = history.history['loss'][-1]
        print(f"    - Final Training Loss (MSE): {final_loss:.6f}")
        
        model_name = animal.replace(' ', '_')
        model_path = os.path.join(LSTM_MODEL_DIR, f"lstm_{model_name}.keras")
        model.save(model_path)
        trained_models.append(animal)
        
        all_X.append(X)
        all_y.append(y)
    
    # 2. Train Generic Fallback Model
    if all_X:
        print("\n[GENERIC] Training Generic LSTM fallback model...")
        X_gen = np.concatenate(all_X)
        y_gen = np.concatenate(all_y)
        
        gen_model = build_lstm_model((WINDOW_SIZE, 2))
        gen_history = gen_model.fit(X_gen, y_gen, epochs=30, batch_size=32, verbose=0)
        
        gen_loss = gen_history.history['loss'][-1]
        print(f"    - Final Training Loss (MSE): {gen_loss:.6f}")
        
        gen_model_path = os.path.join(LSTM_MODEL_DIR, "lstm_generic.keras")
        gen_model.save(gen_model_path)
        trained_models.append("Generic")
        
    return trained_models

def main():
    if not os.path.exists(DATA_CACHE_PATH):
        print(f"Data source not found: {DATA_CACHE_PATH}")
        return

    try:
        with open(DATA_CACHE_PATH, "r", encoding="utf-8") as f:
            records = json.load(f)
        
        if not records:
            print("Empty data source.")
            return

        trained = train_lstm_models(records)
        print(f"\nTraining Complete. Models saved for: {', '.join(trained)}")
        
    except Exception as e:
        print(f"Training failed: {e}")

if __name__ == "__main__":
    main()
