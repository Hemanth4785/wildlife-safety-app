import os
import json
import numpy as np
from tensorflow.keras.models import Sequential
from tensorflow.keras.layers import LSTM, Dense, Dropout
from tensorflow.keras.optimizers import Adam
import joblib

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TRJ_PATH = os.path.join(BASE_DIR, "dataset", "trajectories_v2.json")
MODELS_DIR = os.path.join(BASE_DIR, "models")
MODEL_PATH = os.path.join(MODELS_DIR, "movement_lstm_v2.h5")
SCALER_PATH = os.path.join(MODELS_DIR, "movement_scaler_v2.pkl")
WINDOW = 4

def make_sequences(feats, trajs):
    xs = []
    ys = []
    for sp, rows in feats.items():
        if sp not in trajs:
            continue
        # Build sequence of feature vectors aligned to prediction targets
        seq = []
        prev = None
        for r in rows:
            if prev is None:
                prev = r
                continue
            seq.append([
                float(prev.get("lat")),
                float(prev.get("lon")),
                float(r.get("speed", 0.0)),
                float(r.get("dir", 0.0)),
                float(r.get("month", 1)),
                float(r.get("season", 1)),
            ])
            prev = r
        latlon = [[float(r["lat"]), float(r["lon"])] for r in rows]
        for i in range(len(seq) - WINDOW):
            inp = seq[i:i+WINDOW]
            tgt = latlon[i+WINDOW]
            xs.append(inp)
            ys.append(tgt)
    if not xs:
        return np.zeros((0, WINDOW, 6), dtype=np.float32), np.zeros((0, 2), dtype=np.float32)
    return np.array(xs, dtype=np.float32), np.array(ys, dtype=np.float32)

def main():
    os.makedirs(MODELS_DIR, exist_ok=True)
    if not os.path.exists(TRJ_PATH):
        return
    with open(TRJ_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    trajs = data.get("trajectories", {})
    feats = data.get("features", {})
    X, y = make_sequences(feats, trajs)
    if X.size == 0 or y.size == 0:
        return
    fmean = X.reshape(-1, 6).mean(axis=0)
    fstd = X.reshape(-1, 6).std(axis=0) + 1e-6
    tmean = y.mean(axis=0)
    tstd = y.std(axis=0) + 1e-6
    joblib.dump({"fmean": fmean, "fstd": fstd, "tmean": tmean, "tstd": tstd, "window": WINDOW}, SCALER_PATH)
    Xn = (X - fmean) / fstd
    yn = (y - tmean) / tstd
    model = Sequential()
    model.add(LSTM(32, input_shape=(WINDOW, 6)))
    model.add(Dropout(0.1))
    model.add(Dense(32, activation="relu"))
    model.add(Dense(2, activation="linear"))
    model.compile(optimizer=Adam(), loss="mse")
    model.fit(Xn, yn, epochs=20, batch_size=16, validation_split=0.2, verbose=1)
    model.save(MODEL_PATH)
    print(MODEL_PATH)

if __name__ == "__main__":
    main()
