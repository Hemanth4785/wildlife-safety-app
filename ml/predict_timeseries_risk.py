import os
import sys
import json
import numpy as np
import tensorflow as tf
from tensorflow.keras.models import load_model

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(BASE_DIR, "models", "wildlife_lstm_model.h5")
COMBINED_PATH = os.path.abspath(os.path.join(BASE_DIR, "..", "backend", "python", "cache", "wildlife_combined.json"))

def risk_level(p):
    if p < 0.3:
        return "LOW"
    if p < 0.7:
        return "MEDIUM"
    return "HIGH"

_seasonal_cache = None
def seasonal_prior(month: int) -> float:
    global _seasonal_cache
    if _seasonal_cache is None:
        counts = np.ones(12, dtype=np.float64)
        total = 12.0
        try:
            if os.path.exists(COMBINED_PATH):
                with open(COMBINED_PATH, "r", encoding="utf-8") as f:
                    recs = json.load(f)
                for r in recs:
                    m = int(r.get("month") or 0)
                    if 1 <= m <= 12:
                        counts[m-1] += 1.0
                        total += 1.0
        except:
            pass
        _seasonal_cache = counts / total
    m = int(month or 1)
    m = 1 if m < 1 or m > 12 else m
    return float(_seasonal_cache[m-1])

def main():
    try:
        if len(sys.argv) > 1:
            s = sys.argv[1]
        else:
            s = sys.stdin.read().strip()
        if not s:
            print(json.dumps({"error": "no_input"}))
            return
        try:
            payload = json.loads(s)
        except:
            print(json.dumps({"error": "invalid_json"}))
            return
        seq = payload.get("sequence") or payload.get("recent_7d")
        if seq is None:
            print(json.dumps({"error": "missing_sequence"}))
            return
        arr = np.array(seq, dtype=np.float32)
        if arr.shape != (7, arr.shape[1]):
            if arr.ndim == 2 and arr.shape[0] == 7:
                pass
            else:
                print(json.dumps({"error": "invalid_shape"}))
                return
        if not os.path.exists(MODEL_PATH):
            print(json.dumps({"error": "model_missing"}))
            return
        model = load_model(MODEL_PATH)
        x = np.expand_dims(arr, axis=0)
        p_lstm = float(model.predict(x, verbose=0)[0][0])
        month = payload.get("month")
        season = payload.get("season")
        hist_dens = float(payload.get("historical_density") or 0.0)
        p_season = seasonal_prior(month or 1)
        p_hist = max(0.0, min(1.0, hist_dens))
        p = 0.6 * p_lstm + 0.3 * p_season + 0.1 * p_hist
        out = {"risk_probability": round(p, 4), "risk_level": risk_level(p)}
        print(json.dumps(out))
    except Exception as e:
        print(json.dumps({"error": "runtime_error"}))

if __name__ == "__main__":
    main()

