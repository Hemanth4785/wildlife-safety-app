
"""
iNaturalist Observation Fetcher (external biodiversity data).

Design notes:
- Wildlife observations are fetched directly from the iNaturalist API and cached locally.
- We avoid Firebase Storage for wildlife data on purpose: Firebase remains reserved for
  user authentication and user-submitted community reports only.
- ML models require long historical context (2020-01-01 -> today).
- The UI/routing should show only a recent window (default: 30 days) to reduce clutter
  and represent near-term risk more accurately.
"""

from __future__ import annotations

import json
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple

import requests

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.join(BASE_DIR, "cache")
OUTPUT_FILE = os.path.join(CACHE_DIR, "inat_historical.json")

INAT_API_URL = "https://api.inaturalist.org/v1/observations"

HEADERS = {
    "User-Agent": "WildlifeSafetyApp/1.0 (edu-project; contact@example.com)",
    "Accept": "application/json",
}

SPECIES: List[Dict[str, str]] = [
    {"species": "Elephant", "scientific_name": "Elephas maximus"},
    {"species": "Tiger", "scientific_name": "Panthera tigris"},
    {"species": "Leopard", "scientific_name": "Panthera pardus"},
    {"species": "Gaur", "scientific_name": "Bos gaurus"},
    {"species": "Sloth Bear", "scientific_name": "Melursus ursinus"},
    {"species": "Bison", "scientific_name": "Bison bison"},
]

DEFAULT_FROM_DATE = "2020-01-01"


def filter_recent_days(data: List[Dict[str, Any]], days: int = 30) -> List[Dict[str, Any]]:
    """
    Returns only records whose eventDate is within the last `days` days.
    This is intended for routing/map visualization, not for ML training.
    """
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=int(days))
    out: List[Dict[str, Any]] = []
    for r in data:
        dt = parse_event_date(r.get("eventDate"))
        if dt and dt >= cutoff:
            out.append(r)
    return out


def parse_event_date(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    s = str(value).strip()
    if not s or s.lower() == "unknown":
        return None

    try:
        if len(s) == 10 and s[4] == "-" and s[7] == "-":
            return datetime.strptime(s, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except Exception:
        pass

    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return dt.astimezone(timezone.utc) if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def iso_date(dt: Optional[datetime]) -> str:
    if not dt:
        return "Unknown"
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%d")


def confidence_from_quality(quality_grade: str) -> str:
    q = (quality_grade or "").lower()
    if q == "research":
        return "high"
    if q == "needs_id":
        return "medium"
    if q == "casual":
        return "low"
    return "unknown"


def get_session() -> requests.Session:
    s = requests.Session()
    s.headers.update(HEADERS)
    return s


def request_json(session: requests.Session, params: Dict[str, Any], timeout_s: int = 30) -> Dict[str, Any]:
    backoff_s = 2.0
    for attempt in range(6):
        resp = session.get(INAT_API_URL, params=params, timeout=timeout_s)
        if resp.status_code == 429:
            retry_after = resp.headers.get("Retry-After")
            sleep_s = float(retry_after) if retry_after and retry_after.isdigit() else backoff_s
            time.sleep(min(60.0, sleep_s))
            backoff_s *= 2.0
            continue
        resp.raise_for_status()
        return resp.json()
    raise RuntimeError("Exceeded retry attempts due to rate limiting (HTTP 429).")


def normalize_observation(
    species_common: str,
    scientific_name: str,
    obs: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    location = obs.get("location")
    if not location or "," not in str(location):
        return None

    try:
        lat_str, lon_str = str(location).split(",", 1)
        lat, lon = float(lat_str), float(lon_str)
    except Exception:
        return None

    quality_grade = str(obs.get("quality_grade") or "")
    confidence = confidence_from_quality(quality_grade)

    dt = parse_event_date(obs.get("time_observed_at")) or parse_event_date(obs.get("observed_on")) or parse_event_date(obs.get("created_at"))

    image_url = None
    photos = obs.get("photos") or []
    if isinstance(photos, list) and photos:
        u = photos[0].get("url") if isinstance(photos[0], dict) else None
        if isinstance(u, str) and u:
            image_url = u.replace("square", "medium")

    return {
        "species": species_common,
        "scientific_name": scientific_name,
        "lat": lat,
        "lon": lon,
        "eventDate": iso_date(dt),
        "quality_grade": quality_grade,
        "confidence": confidence,
        "scope": "inat_api",
        "animal": species_common,
        "id": obs.get("id"),
        "image_url": image_url,
        "src": "inat_hist",
    }


def fetch_species_observations(
    session: requests.Session,
    species_common: str,
    scientific_name: str,
    d1: str,
    d2: str,
    per_page: int = 200,
    politeness_sleep_s: float = 1.0,
) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    page = 1
    while True:
        params: Dict[str, Any] = {
            "taxon_name": scientific_name,
            "include_subtaxa": "true",
            "d1": d1,
            "d2": d2,
            "per_page": per_page,
            "page": page,
            "order_by": "created_at",
            "order": "desc",
            "quality_grade": "any",
            "has[]": "geo",
        }

        data = request_json(session, params=params)
        results = data.get("results") or []
        if not isinstance(results, list) or not results:
            break

        for obs in results:
            if not isinstance(obs, dict):
                continue
            rec = normalize_observation(species_common, scientific_name, obs)
            if rec:
                out.append(rec)

        if len(results) < per_page:
            break

        page += 1
        time.sleep(politeness_sleep_s)

    return out


def load_cache() -> List[Dict[str, Any]]:
    if not os.path.exists(OUTPUT_FILE):
        return []
    try:
        with open(OUTPUT_FILE, "r", encoding="utf-8") as f:
            parsed = json.load(f)
        return parsed if isinstance(parsed, list) else []
    except Exception:
        return []


def max_event_date(records: Iterable[Dict[str, Any]]) -> Optional[datetime]:
    best: Optional[datetime] = None
    for r in records:
        dt = parse_event_date(r.get("eventDate"))
        if not dt:
            continue
        if best is None or dt > best:
            best = dt
    return best


def dedupe_records(records: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen = set()
    out: List[Dict[str, Any]] = []
    for r in records:
        key = (
            str(r.get("id") or ""),
            str(r.get("scientific_name") or ""),
            str(r.get("eventDate") or ""),
            f"{float(r.get('lat', 0.0)):.6f}",
            f"{float(r.get('lon', 0.0)):.6f}",
        )
        if key in seen:
            continue
        seen.add(key)
        out.append(r)
    return out


def main() -> None:
    os.makedirs(CACHE_DIR, exist_ok=True)

    existing = load_cache()
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    start_date = DEFAULT_FROM_DATE
    if existing:
        latest = max_event_date(existing)
        if latest:
            start_dt = latest + timedelta(days=1)
            start_date = start_dt.strftime("%Y-%m-%d")

    if start_date > today:
        print(f"Cache is up to date ({len(existing)} records).")
        return

    mode = "full_fetch" if not existing else "incremental_update"
    print(f"[iNat] Mode: {mode} | d1={start_date} d2={today}")

    session = get_session()

    fetched: List[Dict[str, Any]] = []
    for sp in SPECIES:
        common = sp["species"]
        sci = sp["scientific_name"]
        print(f"[iNat] Fetching {sci} ({common}) ...")
        try:
            part = fetch_species_observations(session, common, sci, start_date, today)
            print(f"[iNat]   +{len(part)} records")
            fetched.extend(part)
        except Exception as e:
            print(f"[iNat]   error: {e}")

    combined = existing + fetched
    combined = dedupe_records(combined)

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(combined, f, indent=2)

    print(f"[iNat] Saved {len(combined)} records to {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
