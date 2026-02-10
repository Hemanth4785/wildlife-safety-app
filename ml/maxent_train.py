import os
import json
import numpy as np
import pandas as pd
import joblib
from sklearn.preprocessing import MinMaxScaler
from sklearn.linear_model import LogisticRegression

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_CACHE_PATH = os.path.abspath(os.path.join(BASE_DIR, "..", "backend", "python", "cache", "inat_live.json"))
MODEL_DIR = os.path.join(BASE_DIR, "models", "maxent")
os.makedirs(MODEL_DIR, exist_ok=True)
MODELS_PATH = os.path.join(MODEL_DIR, "maxent_models.pkl")
SCALERS_PATH = os.path.join(MODEL_DIR, "maxent_scalers.pkl")

MIN_SAMPLES = 10
NEGATIVE_RATIO = 2
MARGIN_DEG = 0.1

def to_df(records):
    rows = []
    for r in records:
        try:
            rows.append({"animal": r.get("animal"), "lat": float(r.get("lat")), "lon": float(r.get("lon"))})
        except:
            pass
    return pd.DataFrame(rows)

def sample_background(df, n, bbox=None):
    if bbox is None:
        min_lat, max_lat = df["lat"].min(), df["lat"].max()
        min_lon, max_lon = df["lon"].min(), df["lon"].max()
    else:
        min_lat, max_lat, min_lon, max_lon = bbox
    min_lat -= MARGIN_DEG
    max_lat += MARGIN_DEG
    min_lon -= MARGIN_DEG
    max_lon += MARGIN_DEG
    lat = np.random.uniform(min_lat, max_lat, size=n)
    lon = np.random.uniform(min_lon, max_lon, size=n)
    return pd.DataFrame({"lat": lat, "lon": lon})

def train_per_animal(df):
    models = {}
    scalers = {}
    animals = df["animal"].dropna().unique().tolist()
    for animal in animals:
        pos = df[df["animal"] == animal][["lat", "lon"]]
        if len(pos) < MIN_SAMPLES:
            continue
        neg = sample_background(pos, len(pos) * NEGATIVE_RATIO)
        X = pd.concat([pos, neg], ignore_index=True)
        y = np.array([1] * len(pos) + [0] * len(neg))
        scaler = MinMaxScaler()
        Xs = scaler.fit_transform(X.values)
        model = LogisticRegression(max_iter=1000, class_weight="balanced", solver="liblinear", C=0.7)
        model.fit(Xs, y)
        models[animal] = model
        scalers[animal] = scaler
    if len(df) >= MIN_SAMPLES:
        pos_all = df[["lat", "lon"]]
        neg_all = sample_background(df, len(pos_all) * NEGATIVE_RATIO)
        Xg = pd.concat([pos_all, neg_all], ignore_index=True)
        yg = np.array([1] * len(pos_all) + [0] * len(neg_all))
        scaler_g = MinMaxScaler()
        Xsg = scaler_g.fit_transform(Xg.values)
        model_g = LogisticRegression(max_iter=1000, class_weight="balanced", solver="liblinear", C=0.7)
        model_g.fit(Xsg, yg)
        models["Generic"] = model_g
        scalers["Generic"] = scaler_g
    return models, scalers

def main():
    if not os.path.exists(DATA_CACHE_PATH):
        return
    with open(DATA_CACHE_PATH, "r", encoding="utf-8") as f:
        records = json.load(f)
    if not records:
        return
    df = to_df(records)
    if df.empty:
        return
    models, scalers = train_per_animal(df)
    joblib.dump(models, MODELS_PATH)
    joblib.dump(scalers, SCALERS_PATH)

if __name__ == "__main__":
    main()
