import json
import math
import os
import sys
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import numpy as np


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_PATH = os.path.abspath(os.path.join(BASE_DIR, "..", "backend", "python", "cache", "inat_historical.json"))


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p = math.pi / 180.0
    dlat = (lat2 - lat1) * p
    dlon = (lon2 - lon1) * p
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1 * p) * math.cos(lat2 * p) * math.sin(dlon / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p = math.pi / 180.0
    lat1r = lat1 * p
    lat2r = lat2 * p
    dlon = (lon2 - lon1) * p
    y = math.sin(dlon) * math.cos(lat2r)
    x = math.cos(lat1r) * math.sin(lat2r) - math.sin(lat1r) * math.cos(lat2r) * math.cos(dlon)
    b = math.degrees(math.atan2(y, x))
    return (b + 360.0) % 360.0


def angle_delta_deg(a: float, b: float) -> float:
    return (b - a + 180.0) % 360.0 - 180.0


def parse_dt(s: Any) -> Optional[datetime]:
    if not s:
        return None
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except Exception:
        return None


def load_history() -> List[Dict[str, Any]]:
    if not os.path.exists(CACHE_PATH):
        raise RuntimeError(f"Missing cache file: {CACHE_PATH}")
    with open(CACHE_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, list):
        raise RuntimeError("inat_historical.json is not a list")
    return [x for x in data if isinstance(x, dict)]


def norm_animal(rec: Dict[str, Any]) -> str:
    return str(rec.get("animal") or rec.get("species") or rec.get("common_name") or "").strip()


def extract_points(history: List[Dict[str, Any]], animal: str) -> List[Tuple[datetime, float, float]]:
    out: List[Tuple[datetime, float, float]] = []
    target = animal.strip().lower()
    for r in history:
        a = norm_animal(r).lower()
        if a != target:
            continue
        lat = r.get("lat")
        lon = r.get("lon")
        if lat is None or lon is None:
            continue
        try:
            latf = float(lat)
            lonf = float(lon)
        except Exception:
            continue
        dt = parse_dt(r.get("eventDate") or r.get("created_at"))
        if dt is None:
            continue
        out.append((dt, latf, lonf))
    out.sort(key=lambda x: x[0])
    return out


def main() -> int:
    animals = ["Asian Elephant", "Gaur", "Tiger", "Sloth Bear", "Leopard"]
    history = load_history()

    from predict_movement import load_lstm_model, WINDOW_SIZE, SCALER_PATH
    import joblib

    if not os.path.exists(SCALER_PATH):
        print(json.dumps({"status": "failed", "error": "Model unavailable"}))
        return 0

    scaler = joblib.load(SCALER_PATH)

    errors_km: List[float] = []
    dir_errors: List[float] = []

    for animal in animals:
        model, _model_used = load_lstm_model(animal)
        if not model:
            continue

        pts = extract_points(history, animal)
        if len(pts) < WINDOW_SIZE + 1:
            continue

        start_idx = max(0, len(pts) - 2000)
        for i in range(start_idx, len(pts) - (WINDOW_SIZE + 1)):
            window = [[pts[j][1], pts[j][2]] for j in range(i, i + WINDOW_SIZE)]
            actual = (pts[i + WINDOW_SIZE][1], pts[i + WINDOW_SIZE][2])

            path_array = np.array(window[-WINDOW_SIZE:], dtype=float)
            scaled_path = scaler.transform(path_array)
            current_seq = scaled_path.reshape(1, WINDOW_SIZE, 2)

            next_step_scaled = model.predict(current_seq, verbose=0)
            next_step_scaled = np.clip(next_step_scaled, 0.0, 1.0)
            next_latlon = scaler.inverse_transform(next_step_scaled).tolist()[0]

            prev = (float(window[-2][0]), float(window[-2][1]))
            last = (float(window[-1][0]), float(window[-1][1]))
            cur = np.array([last[0], last[1]], dtype=float)
            prev_vec = np.array([last[0] - prev[0], last[1] - prev[1]], dtype=float)
            pred_raw = np.array([float(next_latlon[0]), float(next_latlon[1])], dtype=float)
            pred_vec = pred_raw - cur
            blended = 0.7 * prev_vec + 0.3 * pred_vec
            pred_len = float(np.linalg.norm(pred_vec))
            blend_len = float(np.linalg.norm(blended))
            if blend_len > 0 and pred_len > 0:
                blended = blended / blend_len * pred_len
            candidate = cur + blended

            cap = 8.0
            al = animal.strip().lower()
            if "elephant" in al:
                cap = 6.0
            elif "tiger" in al:
                cap = 10.0
            elif "gaur" in al:
                cap = 5.0
            elif "sloth" in al and "bear" in al:
                cap = 7.0
            step_km = float(haversine_km(cur[0], cur[1], candidate[0], candidate[1]))
            if math.isfinite(step_km) and step_km > cap and step_km > 0:
                ratio = cap / step_km
                candidate = cur + (candidate - cur) * ratio

            pred = (float(candidate[0]), float(candidate[1]))

            e = haversine_km(pred[0], pred[1], float(actual[0]), float(actual[1]))
            if not math.isfinite(e):
                continue
            errors_km.append(e)

            if len(window) >= 2:
                actual_b = bearing_deg(last[0], last[1], actual[0], actual[1])
                pred_b = bearing_deg(last[0], last[1], pred[0], pred[1])
                dir_errors.append(abs(angle_delta_deg(actual_b, pred_b)))

            if len(errors_km) >= 5000:
                break
        if len(errors_km) >= 5000:
            break

    n = len(errors_km)
    if n == 0:
        print(json.dumps({"mae_km": None, "rmse_km": None, "mean_direction_error": None, "max_error_km": None, "samples": 0}))
        return 0

    mae = float(np.mean(errors_km))
    rmse = float(np.sqrt(np.mean(np.square(errors_km))))
    max_err = float(np.max(errors_km))
    mdir = float(np.mean(dir_errors)) if dir_errors else None

    print(json.dumps({
        "mae_km": round(mae, 3),
        "rmse_km": round(rmse, 3),
        "mean_direction_error": round(mdir, 3) if mdir is not None else None,
        "max_error_km": round(max_err, 3),
        "samples": n
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
