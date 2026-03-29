import math

RANGES = {
    "elephant": (5.0, 20.0),
    "tiger": (2.0, 10.0),
    "leopard": (3.0, 15.0),
    "gaur": (2.0, 10.0),
    "sloth": (2.0, 8.0)
}

def species_key(name):
    s = str(name or "").lower()
    if "elephant" in s: return "elephant"
    if "tigris" in s or "tiger" in s: return "tiger"
    if "pardus" in s or "leopard" in s: return "leopard"
    if "gaur" in s or "bison" in s: return "gaur"
    if "sloth" in s or "melursus" in s: return "sloth"
    return "unknown"

def estimate_next(species, last_lat, last_lon, heat_cells):
    sk = species_key(species)
    rmin, rmax = RANGES.get(sk, (2.0, 8.0))
    step = (rmin + rmax) / 2.0
    best = None
    bestd = 1e9
    for c in heat_cells:
        lat = float(c["cell_lat"]); lon = float(c["cell_lon"])
        d = ((lat - last_lat)**2 + (lon - last_lon)**2)**0.5
        if d < bestd:
            bestd = d; best = (lat, lon, float(c["density_score"]))
    if best:
        lat, lon, den = best
        vlat = lat - last_lat
        vlon = lon - last_lon
        mag = (vlat**2 + vlon**2)**0.5 or 1.0
        scale = step / mag
        plat = last_lat + vlat * scale
        plon = last_lon + vlon * scale
        conf = 0.5 + 0.4 * min(1.0, den)
        return plat, plon, conf
    return last_lat, last_lon, 0.5

