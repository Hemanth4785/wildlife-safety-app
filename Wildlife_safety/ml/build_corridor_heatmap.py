import os
import json
import math

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
COMBINED_PATH = os.path.abspath(os.path.join(BASE_DIR, "..", "backend", "python", "cache", "wildlife_combined.json"))
OUT_PATH = os.path.abspath(os.path.join(BASE_DIR, "..", "backend", "python", "cache", "corridor_heatmap.json"))

CELL = 0.05

def cell_coord(v):
    return round(math.floor(v / CELL) * CELL, 2)

def main():
    if not os.path.exists(COMBINED_PATH):
        with open(OUT_PATH, "w", encoding="utf-8") as f:
            json.dump([], f)
        print(OUT_PATH)
        return
    with open(COMBINED_PATH, "r", encoding="utf-8") as f:
        recs = json.load(f)
    counts = {}
    for r in recs:
        try:
            lat = float(r.get("latitude"))
            lon = float(r.get("longitude"))
        except:
            continue
        clat = cell_coord(lat)
        clon = cell_coord(lon)
        key = f"{clat},{clon}"
        counts[key] = counts.get(key, 0) + 1
    vmax = max(counts.values()) if counts else 1
    grid = []
    for k, v in counts.items():
        lat, lon = map(float, k.split(","))
        grid.append({"cell_lat": lat, "cell_lon": lon, "density_score": round(v / vmax, 4)})
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(grid, f)
    print(OUT_PATH)

if __name__ == "__main__":
    main()

