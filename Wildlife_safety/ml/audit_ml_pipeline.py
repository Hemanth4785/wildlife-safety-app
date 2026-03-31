import json
import math
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple


ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BACKEND_CACHE = os.path.join(ROOT_DIR, "backend", "python", "cache", "inat_historical.json")
LSTM_PY = os.path.join(ROOT_DIR, "ml", "predict_movement.py")
MAXENT_PY = os.path.join(ROOT_DIR, "ml", "predict_maxent.py")
RISK_PY = os.path.join(ROOT_DIR, "ml", "predict_risk.py")
PY_EXE = os.path.join(ROOT_DIR, "lstm_env", "Scripts", "python.exe")
BASE_URL = os.environ.get("AUDIT_BASE_URL", "http://10.18.247.199:3000").rstrip("/")


ANIMALS = ["Asian Elephant", "Gaur", "Tiger", "Sloth Bear", "Leopard"]


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
    d = (b - a + 180.0) % 360.0 - 180.0
    return d


def parse_dt(s: Any) -> Optional[datetime]:
    if not s:
        return None
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except Exception:
        return None


def load_history() -> List[Dict[str, Any]]:
    if not os.path.exists(BACKEND_CACHE):
        raise RuntimeError(f"Missing cache file: {BACKEND_CACHE}")
    with open(BACKEND_CACHE, "r", encoding="utf-8") as f:
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


def pick_sequences(points: List[Tuple[datetime, float, float]], window: int, per_animal: int) -> List[List[List[float]]]:
    if len(points) < window:
        return []
    seqs: List[List[List[float]]] = []
    max_start = len(points) - window
    if max_start <= 0:
        return []
    idxs = []
    if per_animal == 1:
        idxs = [max_start - 1]
    else:
        idxs = [0, max_start // 2, max_start - 1]
        idxs = idxs[:per_animal]
    seen = set()
    for i in idxs:
        i = max(0, min(i, max_start - 1))
        key = (points[i][1], points[i][2], points[i + window - 1][1], points[i + window - 1][2])
        if key in seen:
            continue
        seen.add(key)
        seq = [[points[j][1], points[j][2]] for j in range(i, i + window)]
        seqs.append(seq)
    return seqs


def http_json(method: str, path: str, body: Optional[Dict[str, Any]] = None, timeout_sec: int = 30) -> Tuple[int, Any]:
    url = f"{BASE_URL}{path}"
    data = None
    headers = {"Content-Type": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url=url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            return resp.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace") if hasattr(e, "read") else ""
        try:
            return e.code, json.loads(raw) if raw else {"error": "http_error"}
        except Exception:
            return e.code, {"error": raw or "http_error"}
    except Exception as e:
        return 0, {"error": str(e)}


def run_py(script_path: str, payload: Dict[str, Any], timeout_sec: int = 60) -> Dict[str, Any]:
    if not os.path.exists(PY_EXE):
        raise RuntimeError(f"Missing python exe: {PY_EXE}")
    if not os.path.exists(script_path):
        raise RuntimeError(f"Missing script: {script_path}")
    p = subprocess.run(
        [PY_EXE, script_path, json.dumps(payload)],
        cwd=os.path.dirname(script_path),
        capture_output=True,
        text=True,
        timeout=timeout_sec,
    )
    out = (p.stdout or "").strip()
    if not out:
        return {"status": "failed", "error": "no_stdout", "stderr": (p.stderr or "").strip()}
    try:
        return json.loads(out)
    except Exception:
        return {"status": "failed", "error": "non_json_stdout", "stdout": out[:200], "stderr": (p.stderr or "").strip()}


def analyze_realism(recent_path: List[List[float]], predicted: List[Dict[str, Any]]) -> Dict[str, Any]:
    if not isinstance(recent_path, list) or len(recent_path) == 0:
        return {"ok": False, "reason": "invalid_recent_path"}
    pts: List[Tuple[float, float]] = []
    for p in predicted:
        try:
            pts.append((float(p["lat"]), float(p["lon"])))
        except Exception:
            pass
    if len(pts) < 2:
        return {"ok": False, "reason": "too_few_points"}
    last = recent_path[-1]
    if not isinstance(last, (list, tuple)) or len(last) < 2:
        return {"ok": False, "reason": "invalid_recent_tail"}
    base = (float(last[0]), float(last[1]))
    chain = [base] + pts

    seg_km = [haversine_km(chain[i][0], chain[i][1], chain[i + 1][0], chain[i + 1][1]) for i in range(len(chain) - 1)]
    max_step = max(seg_km) if seg_km else 0.0

    equal_spacing = False
    if len(seg_km) >= 2:
        eps = 0.05
        equal_spacing = all(abs(seg_km[i] - seg_km[0]) <= eps for i in range(1, len(seg_km)))

    deltas = [(chain[i + 1][0] - chain[i][0], chain[i + 1][1] - chain[i][1]) for i in range(len(chain) - 1)]
    identical_deltas = False
    if len(deltas) >= 2:
        eps = 1e-6
        identical_deltas = all(abs(deltas[i][0] - deltas[0][0]) <= eps and abs(deltas[i][1] - deltas[0][1]) <= eps for i in range(1, len(deltas)))

    straight_line = False
    if len(chain) >= 3:
        bearings = [bearing_deg(chain[i][0], chain[i][1], chain[i + 1][0], chain[i + 1][1]) for i in range(len(chain) - 1)]
        turns = [abs(angle_delta_deg(bearings[i - 1], bearings[i])) for i in range(1, len(bearings))]
        straight_line = max(turns) <= 2.0 if turns else False

    unrealistic_jump = max_step > 15.0
    return {
        "ok": True,
        "seg_km": [round(x, 3) for x in seg_km],
        "max_step_km": round(max_step, 3),
        "equal_spacing": bool(equal_spacing),
        "identical_deltas": bool(identical_deltas),
        "straight_line": bool(straight_line),
        "unrealistic_jump": bool(unrealistic_jump),
    }


def ensemble_expected(maxent: Dict[str, Any], lstm: Dict[str, Any], k: int) -> List[Tuple[float, float]]:
    seq: List[Tuple[float, float]] = []
    for src in (lstm, maxent):
        pp = src.get("predicted_path")
        if not isinstance(pp, list):
            continue
        for p in pp:
            if isinstance(p, (list, tuple)) and len(p) >= 2:
                try:
                    seq.append((float(p[0]), float(p[1])))
                except Exception:
                    pass
    chosen: List[Tuple[float, float]] = []
    seen = set()
    for lat, lon in seq:
        key = f"{lat:.5f},{lon:.5f}"
        if key in seen:
            continue
        seen.add(key)
        chosen.append((lat, lon))
        if len(chosen) >= k:
            break
    return chosen


def main() -> int:
    started = time.time()
    history = load_history()

    movement_tests: List[Dict[str, Any]] = []
    for animal in ANIMALS:
        pts = extract_points(history, animal)
        seqs = pick_sequences(pts, window=5, per_animal=3)
        for seq in seqs:
            last = seq[-1]
            user_loc = {"lat": float(last[0]) + 0.05, "lon": float(last[1]) + 0.05}
            movement_tests.append({"animal": animal, "recent_path": seq, "user_location": user_loc, "k_future": 3})

    movement_tests.extend([
        {"animal": "Asian Elephant", "recent_path": [[11.0, 76.0]], "user_location": {"lat": 11.1, "lon": 76.1}, "k_future": 3},
        {"animal": "Tiger", "recent_path": [[11.0, 76.0], [11.001, 76.001]], "user_location": {"lat": 11.1, "lon": 76.1}, "k_future": 3},
        {"animal": "Gaur", "recent_path": [[11.0, 76.0], [11.001, 76.001], [11.002, 76.002], [11.003, 76.003], [11.004, 76.004]], "user_location": {"lat": 11.1, "lon": 76.1}, "k_future": 3},
        {"animal": "Sloth Bear", "recent_path": "not-an-array", "user_location": {"lat": 11.1, "lon": 76.1}, "k_future": 3},
        {"animal": "", "recent_path": [[11.0, 76.0], [11.001, 76.001]], "user_location": {"lat": 11.1, "lon": 76.1}, "k_future": 3},
    ])
    movement_tests = movement_tests[:20]

    risk_tests: List[Dict[str, Any]] = []
    for animal in ANIMALS:
        for d in (0.1, 0.6, 2.0, 10.0):
            risk_tests.append({"animal": animal, "distance_km": d, "confidence": "high", "scope": "regional", "eventDate": datetime.now().isoformat()})
    risk_tests = risk_tests[:20]

    movement_results = []
    for t in movement_tests:
        status, resp = http_json("POST", "/api/predict-movement", t, timeout_sec=60)
        movement_results.append({"http": status, "input": t, "resp": resp})

    risk_results = []
    for t in risk_tests:
        status, resp = http_json("POST", "/api/predict-risk", t, timeout_sec=30)
        risk_results.append({"http": status, "input": t, "resp": resp})

    def is_success(x: Any) -> bool:
        return isinstance(x, dict) and x.get("status") == "success"

    movement_success = [r for r in movement_results if r["http"] == 200 and is_success(r["resp"])]
    movement_fail = [r for r in movement_results if r not in movement_success]
    risk_success = [r for r in risk_results if r["http"] == 200 and is_success(r["resp"])]
    risk_fail = [r for r in risk_results if r not in risk_success]

    stability_score = round(100.0 * (len(movement_success) + len(risk_success)) / (len(movement_results) + len(risk_results)), 1)

    realism_flags = []
    for r in movement_success:
        pred = r["resp"].get("predicted_path")
        if not isinstance(pred, list):
            continue
        realism = analyze_realism(r["input"]["recent_path"], pred)
        realism_flags.append(realism)
    realism_ok = [x for x in realism_flags if x.get("ok")]
    realism_bad = [
        x for x in realism_ok
        if x.get("unrealistic_jump") or (x.get("equal_spacing") and x.get("straight_line")) or x.get("identical_deltas")
    ]
    realism_score = round(100.0 * (len(realism_ok) - len(realism_bad)) / max(1, len(realism_ok)), 1)

    authenticity_penalty = 0
    if os.path.exists(os.path.join(ROOT_DIR, "ml", "models", "lstm", "lstm_generic.h5")) and os.path.exists(os.path.join(ROOT_DIR, "ml", "models", "lstm", "gps_scaler.pkl")):
        authenticity_penalty += 0
    else:
        authenticity_penalty += 50

    code_flag_repeated_step = True
    if code_flag_repeated_step:
        authenticity_penalty += 35

    authenticity_score = max(0.0, round(100.0 - authenticity_penalty, 1))

    ensemble_checks = []
    for r in movement_success[:8]:
        inp = r["input"]
        payload = {"animal": inp["animal"], "user_location": inp["user_location"], "recent_path": inp["recent_path"], "k_future": inp["k_future"]}
        try:
            maxent = run_py(MAXENT_PY, payload, timeout_sec=60)
            lstm = run_py(LSTM_PY, payload, timeout_sec=60)
        except Exception as e:
            ensemble_checks.append({"ok": False, "error": str(e)})
            continue
        expected = ensemble_expected(maxent, lstm, int(inp["k_future"]))
        got = []
        for p in (r["resp"].get("predicted_path") or []):
            try:
                got.append((float(p["lat"]), float(p["lon"])))
            except Exception:
                pass
        exp_keys = [f"{a:.5f},{b:.5f}" for a, b in expected]
        got_keys = [f"{a:.5f},{b:.5f}" for a, b in got]
        ok = exp_keys == got_keys[: len(exp_keys)]
        ensemble_checks.append({"ok": ok, "expected": exp_keys[:3], "got": got_keys[:3]})

    ensemble_ok = sum(1 for x in ensemble_checks if x.get("ok"))
    ensemble_score = round(100.0 * ensemble_ok / max(1, len(ensemble_checks)), 1)

    accuracy_cases: List[Tuple[str, List[List[float]], List[float]]] = []
    for animal in ANIMALS:
        pts = extract_points(history, animal)
        if len(pts) < 7:
            continue
        for start in range(max(0, len(pts) - 20), len(pts) - 6):
            window = [[pts[i][1], pts[i][2]] for i in range(start, start + 5)]
            actual = [pts[start + 5][1], pts[start + 5][2]]
            accuracy_cases.append((animal, window, actual))
    accuracy_cases = accuracy_cases[-10:]

    errors = []
    for animal, window, actual in accuracy_cases:
        payload = {"animal": animal, "recent_path": window, "user_location": {"lat": actual[0], "lon": actual[1]}, "k_future": 1}
        out = run_py(LSTM_PY, payload, timeout_sec=60)
        pp = out.get("predicted_path")
        if not isinstance(pp, list) or not pp:
            continue
        pred0 = pp[0]
        try:
            plat = float(pred0[0])
            plon = float(pred0[1])
        except Exception:
            continue
        e = haversine_km(plat, plon, float(actual[0]), float(actual[1]))
        errors.append(e)

    mean_err = round(sum(errors) / max(1, len(errors)), 3)
    accuracy_score = round(max(0.0, 100.0 * (1.0 - (mean_err / 10.0))), 1)

    overall = round(
        0.25 * stability_score +
        0.25 * realism_score +
        0.20 * authenticity_score +
        0.15 * ensemble_score +
        0.15 * accuracy_score,
        1
    )

    bugs = []
    silent = []
    fake = []

    if code_flag_repeated_step:
        bugs.append("LSTM predicts only 1 step then repeats it for k_future (not true multi-step).")
        fake.append("k_future multi-step behavior is dominated by deterministic shaping, not model outputs.")

    if any(isinstance(r["resp"], dict) and r["resp"].get("status") == "success" and r["resp"].get("degraded") for r in movement_success):
        silent.append("Backend returns status=success with degraded=true; clients may not surface this clearly.")

    if any(isinstance(x, dict) and x.get("unrealistic_jump") for x in realism_ok):
        bugs.append("Some predictions include >15km step jumps (violates realism constraint).")

    report = {
        "overall_ml_working_percentage": overall,
        "breakdown": {
            "stability": stability_score,
            "realism": realism_score,
            "authenticity": authenticity_score,
            "ensemble_integrity": ensemble_score,
            "accuracy_proxy": accuracy_score,
        },
        "accuracy_proxy": {
            "mean_prediction_error_km": mean_err,
            "n_cases": len(errors),
        },
        "stability": {
            "movement_success": len(movement_success),
            "movement_fail": len(movement_fail),
            "risk_success": len(risk_success),
            "risk_fail": len(risk_fail),
        },
        "realism_examples": realism_bad[:5],
        "ensemble_checks": ensemble_checks[:5],
        "detected_bugs": bugs,
        "silent_failures": silent,
        "fake_logic": fake,
        "elapsed_sec": round(time.time() - started, 2),
    }

    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
