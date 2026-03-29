import requests
import math
import json
import os

# --- CONFIGURATION ---
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
RADIUS_KM = 5.0
DEFAULT_DISTANCE = 3.0  # km
CACHE_FILE = os.path.join(os.path.dirname(__file__), "water_cache.json")

# In-memory cache
water_cache = {}

def load_cache():
    """Load the cache from a JSON file."""
    global water_cache
    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, 'r') as f:
                water_cache = json.load(f)
        except (json.JSONDecodeError, IOError):
            water_cache = {}

def save_cache():
    """Save the in-memory cache to a JSON file."""
    try:
        with open(CACHE_FILE, 'w') as f:
            json.dump(water_cache, f)
    except IOError:
        pass

def haversine_distance(lat1, lon1, lat2, lon2):
    """
    Calculate the great circle distance between two points 
    on the earth (specified in decimal degrees).
    """
    # Convert decimal degrees to radians 
    lat1, lon1, lat2, lon2 = map(math.radians, [lat1, lon1, lat2, lon2])

    # Haversine formula 
    dlat = lat2 - lat1 
    dlon = lon2 - lon1 
    a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon/2)**2
    c = 2 * math.asin(math.sqrt(a)) 
    r = 6371 # Radius of earth in kilometers
    return c * r

def get_distance_to_water(lat, lon):
    """
    Fetch the nearest water feature using the Overpass API 
    within a 5 km radius.
    """
    # 1. Round coordinates for caching (2 decimal places ~ 1.1km precision)
    lat_rounded = round(lat, 2)
    lon_rounded = round(lon, 2)
    cache_key = f"{lat_rounded},{lon_rounded}"

    load_cache()
    if cache_key in water_cache:
        return water_cache[cache_key]

    # 2. Build Overpass Query
    # Consider waterways (rivers, streams), natural water, and reservoirs
    overpass_query = f"""
    [out:json][timeout:25];
    (
      node["waterway"~"river|stream"](around:{RADIUS_KM * 1000},{lat},{lon});
      way["waterway"~"river|stream"](around:{RADIUS_KM * 1000},{lat},{lon});
      node["natural"="water"](around:{RADIUS_KM * 1000},{lat},{lon});
      way["natural"="water"](around:{RADIUS_KM * 1000},{lat},{lon});
      node["water"="reservoir"](around:{RADIUS_KM * 1000},{lat},{lon});
      way["water"="reservoir"](around:{RADIUS_KM * 1000},{lat},{lon});
    );
    out body;
    >;
    out skel qt;
    """

    try:
        response = requests.post(OVERPASS_URL, data={'data': overpass_query}, timeout=30)
        response.raise_for_status()
        data = response.json()

        # 3. Extract nodes and calculate minimum distance
        min_dist = DEFAULT_DISTANCE
        found_water = False

        if 'elements' in data:
            for element in data['elements']:
                if element['type'] == 'node':
                    dist = haversine_distance(lat, lon, element['lat'], element['lon'])
                    if dist < min_dist:
                        min_dist = dist
                        found_water = True
                # Ways contain nodes, but the 'around' query returns the nodes 
                # belonging to the way if 'out skel' is used.

        # If no water features are found within the radius, return default
        result = round(min_dist, 2) if found_water else DEFAULT_DISTANCE

        # 4. Cache and return
        water_cache[cache_key] = result
        save_cache()
        return result

    except (requests.RequestException, json.JSONDecodeError, KeyError) as e:
        print(f"Overpass API error: {e}")
        # Fallback to default distance on failure
        return DEFAULT_DISTANCE

if __name__ == "__main__":
    # Test coordinates (e.g., near Ooty Lake)
    test_lat = 11.41
    test_lon = 76.69
    dist = get_distance_to_water(test_lat, test_lon)
    print(f"distance_to_water = {dist}  # km")
